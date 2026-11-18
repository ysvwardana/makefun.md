import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import type { NextFunction, Request, Response } from 'express';

const DEFAULT_LOCAL_OPENAI_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const BLOCKED_METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  '169.254.169.254',
  '100.100.100.200',
  'fd00:ec2::254',
]);

export class SecurityPolicyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getAllowedOpenAICompatHosts(): Set<string> {
  const hosts = new Set(DEFAULT_LOCAL_OPENAI_HOSTS);
  const raw = process.env.ALLOWED_OPENAI_COMPAT_HOSTS?.trim();
  if (raw) {
    for (const entry of raw.split(',')) {
      const normalized = entry.trim().toLowerCase().replace(/^\[|\]$/g, '');
      if (normalized) {
        hosts.add(normalized);
      }
    }
  }
  return hosts;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

function isBlockedIPv4(ip: string, allowLoopbackLiteral: boolean): boolean {
  const num = ipv4ToInt(ip);
  if (num === null) return true;

  const first = (num >>> 24) & 0xff;
  const second = (num >>> 16) & 0xff;

  // 0.0.0.0/8 ("this network")
  if (first === 0) return true;
  // 127.0.0.0/8 (loopback)
  if (first === 127) return !allowLoopbackLiteral;
  // 10.0.0.0/8 (RFC1918 private)
  if (first === 10) return true;
  // 172.16.0.0/12 (RFC1918 private)
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.168.0.0/16 (RFC1918 private)
  if (first === 192 && second === 168) return true;
  // 169.254.0.0/16 (link-local & cloud metadata)
  if (first === 169 && second === 254) return true;
  // 100.64.0.0/10 (CGNAT)
  if (first === 100 && second >= 64 && second <= 127) return true;
  // 224.0.0.0/4 (multicast & reserved)
  if (first >= 224) return true;

  return false;
}

export function isBlockedIpAddress(rawIp: string, allowLoopbackLiteral = false): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const ipType = net.isIP(ip);
  if (ipType === 4) {
    return isBlockedIPv4(ip, allowLoopbackLiteral);
  }
  if (ipType === 6) {
    if (ip === '::' || ip === '::0') return true;
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return !allowLoopbackLiteral;
    if (ip.startsWith('::ffff:')) {
      return isBlockedIPv4(ip.slice(7), allowLoopbackLiteral);
    }
    // Unique local fc00::/7 (fc.. / fd..)
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    // Link-local fe80::/10
    if (/^fe[89ab]/i.test(ip)) return true;
    // Multicast ff00::/8
    if (ip.startsWith('ff')) return true;
    return false;
  }
  return true;
}

export async function validateOpenAICompatBaseUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new SecurityPolicyError('OpenAI-compatible Base URL cannot be empty.', 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SecurityPolicyError('OpenAI-compatible Base URL must be a valid http or https URL.', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SecurityPolicyError('Only http:// and https:// schemes are permitted for OpenAI-compatible endpoints.', 400);
  }

  if (parsed.username || parsed.password) {
    throw new SecurityPolicyError('Embedded credentials in provider URLs are forbidden.', 400);
  }

  if (parsed.hash) {
    throw new SecurityPolicyError('URL fragments are not permitted in provider Base URLs.', 400);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || BLOCKED_METADATA_HOSTS.has(hostname)) {
    throw new SecurityPolicyError(`Target host "${hostname}" is blocked by SSRF policy.`, 403);
  }

  const allowedHosts = getAllowedOpenAICompatHosts();
  if (!allowedHosts.has(hostname)) {
    throw new SecurityPolicyError(
      `Host "${hostname}" is not in the administrator allowlist (ALLOWED_OPENAI_COMPAT_HOSTS). Only localhost/loopback or explicitly allowlisted hosts are permitted.`,
      403
    );
  }

  const isExplicitLocalAllowlisted = DEFAULT_LOCAL_OPENAI_HOSTS.has(hostname);

  if (net.isIP(hostname) !== 0) {
    if (isBlockedIpAddress(hostname, isExplicitLocalAllowlisted)) {
      throw new SecurityPolicyError(`IP address "${hostname}" is blocked by SSRF policy.`, 403);
    }
  } else {
    let resolved: Array<{ address: string; family: number }>;
    try {
      resolved = await dns.lookup(hostname, { all: true });
    } catch {
      throw new SecurityPolicyError(`Failed to resolve hostname "${hostname}".`, 400);
    }

    if (resolved.length === 0) {
      throw new SecurityPolicyError(`Hostname "${hostname}" returned no DNS records.`, 400);
    }

    for (const record of resolved) {
      if (isBlockedIpAddress(record.address, isExplicitLocalAllowlisted)) {
        throw new SecurityPolicyError(
          `DNS resolution for "${hostname}" resolved to restricted IP "${record.address}" and was blocked to prevent SSRF / DNS rebinding.`,
          403
        );
      }
    }
  }

  return parsed.toString().replace(/\/$/, '');
}

export function isServerPaidLlmAuthorized(): boolean {
  return process.env.ALLOW_PAID_LLM_REQUESTS?.trim().toLowerCase() === 'true';
}

export function getDailyLlmRequestCap(): number {
  const raw = Number(process.env.MAX_DAILY_LLM_CALLS || 50);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

export function getMaxLlmOutputTokens(): number {
  const raw = Number(process.env.MAX_LLM_OUTPUT_TOKENS || 8192);
  return Number.isFinite(raw) && raw >= 512 && raw <= 32768 ? Math.floor(raw) : 8192;
}

export function getOperatorAuthToken(): string | null {
  const token = process.env.COMMAND_CENTER_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireOperatorAuth(req: Request, res: Response, next: NextFunction): void {
  const configuredToken = getOperatorAuthToken();
  if (!configuredToken) {
    next();
    return;
  }

  const authHeader = req.get('authorization') || '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const operatorHeader = (req.get('x-operator-token') || '').trim();
  const supplied = bearerToken || operatorHeader;

  if (!supplied || !safeTokenEquals(supplied, configuredToken)) {
    res.status(401).json({
      error: 'Operator authentication required. Supply valid Bearer or X-Operator-Token matching server COMMAND_CENTER_TOKEN.',
    });
    return;
  }

  next();
}

export function enforceSameOriginCsrf(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const originHeader = req.get('origin');
  const hostHeader = (req.get('host') || '').toLowerCase();
  const refererHeader = (req.get('referer') || '').toLowerCase();

  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      const originHost = originUrl.host.toLowerCase();
      const originHostname = originUrl.hostname.toLowerCase();

      const allowedHosts = new Set<string>();
      if (hostHeader) allowedHosts.add(hostHeader);
      if (process.env.APP_URL) {
        try {
          allowedHosts.add(new URL(process.env.APP_URL).host.toLowerCase());
        } catch {
          // ignore malformed APP_URL
        }
      }

      const isLocalOrigin =
        originHost.startsWith('localhost:') ||
        originHost === 'localhost' ||
        originHost.startsWith('127.0.0.1:') ||
        originHost === '127.0.0.1';

      const isCloudRunPreview =
        originHostname.endsWith('.run.app') ||
        originHostname.endsWith('.aistudio.google.com') ||
        refererHeader.includes('.run.app') ||
        refererHeader.includes('.aistudio.google.com');

      if (!allowedHosts.has(originHost) && !(isLocalOrigin && hostHeader.startsWith('localhost:')) && !isCloudRunPreview) {
        res.status(403).json({ error: `Origin "${originHost}" is not permitted to mutate server state.` });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Malformed Origin header rejected by CSRF policy.' });
      return;
    }
  }

  next();
}

// Sliding-window rate limiter per client IP + route bucket
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(options: {
  bucket: string;
  windowMs: number;
  maxRequests: number;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.bucket}:${ip}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const timestamps = (rateBuckets.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((timestamps[0] + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded for ${options.bucket}. Retry in ${retryAfterSec}s.`,
      });
      return;
    }

    timestamps.push(now);
    rateBuckets.set(key, timestamps);
    next();
  };
}

// Concurrency & Daily Budget Controls for LLM invocations
let activeLlmCount = 0;
const MAX_CONCURRENT_LLM = 2;

let dailyBucketDay = new Date().toISOString().slice(0, 10);
let dailyLlmCallCount = 0;

export async function withLlmExecutionGuard<T>(fn: () => Promise<T>): Promise<T> {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyBucketDay) {
    dailyBucketDay = today;
    dailyLlmCallCount = 0;
  }

  const dailyCap = getDailyLlmRequestCap();
  if (dailyLlmCallCount >= dailyCap) {
    throw new SecurityPolicyError(
      `Daily server LLM budget cap reached (${dailyLlmCallCount}/${dailyCap} requests). Adjust MAX_DAILY_LLM_CALLS on server to increase.`,
      429
    );
  }

  if (activeLlmCount >= MAX_CONCURRENT_LLM) {
    throw new SecurityPolicyError(
      `Too many concurrent LLM requests (${activeLlmCount}/${MAX_CONCURRENT_LLM} active). Wait for the current request to finish.`,
      429
    );
  }

  activeLlmCount += 1;
  dailyLlmCallCount += 1;
  try {
    return await fn();
  } finally {
    activeLlmCount = Math.max(0, activeLlmCount - 1);
  }
}

export function resetSecurityCountersForTest(): void {
  rateBuckets.clear();
  activeLlmCount = 0;
  dailyLlmCallCount = 0;
}
