import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import {
  fetchCompatibleJson,
  resolveCompatibleBaseUrl,
  runProviderRequest,
  validateCompatibleBaseUrl,
} from '../server/llm-policy.ts';

const envKeys = ['LLM_REQUEST_TIMEOUT_MS', 'LLM_MAX_CONCURRENT_REQUESTS',
  'LLM_MAX_REQUESTS_PER_MINUTE', 'LLM_MAX_RESPONSE_BYTES', 'OPENAI_COMPAT_BASE_URL', 'OPENAI_COMPAT_API_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function localServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Unexpected local server address.'));
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });
}

test('normalizes and validates configured URL while refusing credential, query and fragment components', () => {
  process.env.OPENAI_COMPAT_BASE_URL = 'http://localhost:11434/v1/';
  assert.equal(resolveCompatibleBaseUrl(), 'http://localhost:11434/v1');
  assert.equal(validateCompatibleBaseUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  for (const invalid of ['http://user:pass@localhost/v1', 'http://localhost/v1?x=y', 'http://localhost/v1#x']) {
    assert.throws(() => validateCompatibleBaseUrl(invalid));
  }
});

test('binds credentials to the exact configured URL and returns parsed JSON', async () => {
  let authorization: string | undefined;
  const baseUrl = await localServer((_req, res) => {
    authorization = _req.headers.authorization;
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  process.env.OPENAI_COMPAT_BASE_URL = baseUrl;
  process.env.OPENAI_COMPAT_API_KEY = 'local-test-secret';
  assert.deepEqual(await fetchCompatibleJson(`${baseUrl}/`, { prompt: 'test' }), { ok: true });
  assert.equal(authorization, 'Bearer local-test-secret');
  await assert.rejects(fetchCompatibleJson(`${baseUrl}/elsewhere`, {}), { statusCode: 403 });
});

test('does not follow redirects or forward credentials to their destination', async () => {
  let destinationRequests = 0;
  const destination = await localServer((_req, res) => { destinationRequests++; res.end('{}'); });
  const redirect = await localServer((_req, res) => { res.writeHead(302, { Location: `${destination}/chat/completions` }); res.end(); });
  process.env.OPENAI_COMPAT_BASE_URL = redirect;
  process.env.OPENAI_COMPAT_API_KEY = 'local-test-secret';
  await assert.rejects(fetchCompatibleJson(redirect, {}), /HTTP 302/);
  assert.equal(destinationRequests, 0);
});

test('rejects oversized responses and sanitizes upstream error bodies', async () => {
  const large = await localServer((_req, res) => { res.end('x'.repeat(128)); });
  process.env.OPENAI_COMPAT_BASE_URL = large;
  process.env.LLM_MAX_RESPONSE_BYTES = '32';
  await assert.rejects(fetchCompatibleJson(large, {}), { statusCode: 502 });

  const errorUrl = await localServer((_req, res) => { res.writeHead(500); res.end('private upstream details'); });
  process.env.OPENAI_COMPAT_BASE_URL = errorUrl;
  await assert.rejects(fetchCompatibleJson(errorUrl, {}), (error: Error) => {
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, /private upstream details/);
    return true;
  });
});

test('aborts timed out provider work and enforces concurrency and rate limits', async () => {
  process.env.LLM_REQUEST_TIMEOUT_MS = '20';
  let aborted = false;
  await assert.rejects(runProviderRequest((signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  })), { statusCode: 504 });
  assert.equal(aborted, true);

  process.env.LLM_MAX_CONCURRENT_REQUESTS = '1';
  process.env.LLM_REQUEST_TIMEOUT_MS = '1000';
  let finish!: () => void;
  const held = runProviderRequest(() => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  await assert.rejects(runProviderRequest(async () => undefined), { statusCode: 429 });
  finish();
  await held;
});
