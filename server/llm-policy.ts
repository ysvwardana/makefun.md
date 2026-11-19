import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';

const DEFAULT_COMPAT_BASE_URL = 'http://localhost:11434/v1';
const RATE_WINDOW_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;
let inFlight = 0;
const requestStarts: number[] = [];

function policyError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function limit(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = process.env[name]?.trim();
  const number = Number(value);
  return value && /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 && number <= maximum
    ? number
    : fallback;
}

export async function runProviderRequest<T>(fn: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
  externalSignal?.throwIfAborted();
  const now = performance.now();
  let expired = 0;
  while (expired < requestStarts.length && now - requestStarts[expired] >= RATE_WINDOW_MS) expired++;
  if (expired) requestStarts.splice(0, expired);
  if (inFlight >= limit('LLM_MAX_CONCURRENT_REQUESTS', 2)) {
    throw policyError(429, 'Too many concurrent LLM provider requests.');
  }
  if (requestStarts.length >= limit('LLM_MAX_REQUESTS_PER_MINUTE', 10)) {
    throw policyError(429, 'LLM provider request rate limit exceeded.');
  }

  requestStarts.push(now);
  inFlight++;
  const controller = new AbortController();
  const timeoutMs = limit('LLM_REQUEST_TIMEOUT_MS', 60_000, MAX_TIMER_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = policyError(504, 'LLM provider request timed out.');
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  // Keep the slot occupied until the provider settles, even if it ignores cancellation.
  const pending = Promise.resolve().then(() => fn(signal)).finally(() => { inFlight--; });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const ipv4Loopback = new BlockList();
ipv4Loopback.addSubnet('127.0.0.0', 8, 'ipv4');
const blockedIPv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blockedIPv4.addSubnet(address, prefix, 'ipv4');

const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
const blockedIPv6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) blockedIPv6.addSubnet(address, prefix, 'ipv6');

function isLoopback(address: string): boolean {
  return address === '::1' || (isIP(address) === 4 && ipv4Loopback.check(address));
}

function isPublic(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIPv4.check(address);
  // Only ordinary global unicast is eligible; this excludes local and IPv4-mapped IPv6.
  return family === 6 && globalIPv6.check(address, 'ipv6') && !blockedIPv6.check(address, 'ipv6');
}

export function resolveCompatibleBaseUrl(input?: string): string {
  const normalized = (input ?? process.env.OPENAI_COMPAT_BASE_URL ?? DEFAULT_COMPAT_BASE_URL).trim().replace(/\/+$/, '');
  parseBaseUrl(normalized);
  const configured = (process.env.OPENAI_COMPAT_BASE_URL ?? DEFAULT_COMPAT_BASE_URL).trim().replace(/\/+$/, '');
  if (normalized !== configured) throw policyError(403, 'OpenAI-compatible base URL must match the server configuration.');
  return normalized;
}

export function validateCompatibleBaseUrl(input: string): string {
  return resolveCompatibleBaseUrl(input);
}

function parseBaseUrl(value: string): URL {
  const authority = /^https?:\/\/([^/]+)/i.exec(value)?.[1];
  if (!authority || authority.includes('@') || /[\s\u0000-\u001f\u007f\\?#]/u.test(value)) {
    throw policyError(400, 'Invalid OpenAI-compatible base URL.');
  }
  try {
    const url = new URL(value);
    if (!url.username && !url.password && (url.protocol === 'http:' || url.protocol === 'https:')) return url;
  } catch {
    // Do not expose parsing errors, which can contain the input URL.
  }
  throw policyError(400, 'Invalid OpenAI-compatible base URL.');
}

async function resolveAddresses(host: string, local: boolean): Promise<Awaited<ReturnType<typeof resolveHost>>> {
  const family = isIP(host);
  let addresses: Awaited<ReturnType<typeof resolveHost>>;
  try {
    addresses = family ? [{ address: host, family }] : await resolveHost(host);
  } catch {
    throw policyError(502, 'Could not resolve the OpenAI-compatible endpoint.');
  }
  if (!addresses.length || addresses.some(({ address, family }) =>
    family !== isIP(address) || !(local ? isLoopback(address) : isPublic(address)))) {
    throw policyError(403, 'OpenAI-compatible endpoint resolved to a disallowed address.');
  }
  return addresses;
}

function resolveHost(host: string): Promise<{ address: string; family: number }[]> {
  return lookup(host, { all: true });
}

export async function fetchCompatibleJson(baseUrl: string, body: unknown, externalSignal?: AbortSignal): Promise<any> {
  const explicitBase = process.env.OPENAI_COMPAT_BASE_URL;
  const configuredBase = resolveCompatibleBaseUrl();
  const url = parseBaseUrl(configuredBase);
  if (validateCompatibleBaseUrl(baseUrl) !== configuredBase) {
    throw policyError(403, 'OpenAI-compatible base URL must match the server configuration.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || isLoopback(host);
  if (!local && (!explicitBase || url.protocol !== 'https:' || process.env.LLM_ALLOW_PAID_REQUESTS !== 'true')) {
    throw policyError(403, 'Remote OpenAI-compatible endpoints require server-configured HTTPS and LLM_ALLOW_PAID_REQUESTS=true.');
  }

  return runProviderRequest(async (signal) => {
    const addresses = await resolveAddresses(host, local);
    signal.throwIfAborted();
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      const candidates = options.family ? addresses.filter(({ family }) => family === options.family) : addresses;
      if (!candidates.length) {
        callback(Object.assign(new Error('No approved address for the requested family.'), { code: 'ENOTFOUND' }), '', 0);
      } else if (options.all) {
        callback(null, candidates);
      } else {
        callback(null, candidates[0].address, candidates[0].family);
      }
    };
    const maxBytes = limit('LLM_MAX_RESPONSE_BYTES', 2 * 1024 * 1024);
    const key = process.env.OPENAI_COMPAT_API_KEY?.trim();
    const networkError = () => policyError(502, 'Failed to communicate with the OpenAI-compatible endpoint.');
    return new Promise((resolve, reject) => {
      try {
        const payload = JSON.stringify(body);
        const headers: http.OutgoingHttpHeaders = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        };
        if (key) headers.Authorization = `Bearer ${key}`;
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, {
          path: `${url.pathname.replace(/\/+$/, '')}/chat/completions`,
          method: 'POST', headers, signal, lookup: pinnedLookup, agent: false,
        }, (response) => {
          response.on('error', () => reject(networkError()));
          const status = response.statusCode ?? 502;
          if (status < 200 || status >= 300) {
            const code = status >= 400 && status < 500 ? status : 502;
            reject(policyError(code, `OpenAI-compatible provider returned HTTP ${status}.`));
            response.destroy();
            return;
          }
          const tooLarge = () => {
            reject(policyError(502, 'OpenAI-compatible provider response exceeded the size limit.'));
            response.destroy();
          };
          if (Number(response.headers['content-length']) > maxBytes) {
            tooLarge();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) tooLarge();
            else chunks.push(chunk);
          });
          response.once('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
            } catch {
              reject(policyError(502, 'OpenAI-compatible provider returned invalid JSON.'));
            }
          });
        });
        request.on('error', () => reject(networkError()));
        request.end(payload);
      } catch {
        reject(networkError());
      }
    });
  }, externalSignal);
}
