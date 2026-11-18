import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlockedIpAddress,
  isServerPaidLlmAuthorized,
  resetSecurityCountersForTest,
  SecurityPolicyError,
  validateOpenAICompatBaseUrl,
  withLlmExecutionGuard,
} from '../server/security.ts';
import { LLMConfigurationError, validateModelAuthorization } from '../server/llm.ts';

test('validateOpenAICompatBaseUrl permits loopback and blocks SSRF, metadata, credentials, and unallowlisted hosts', async () => {
  const prevAllowed = process.env.ALLOWED_OPENAI_COMPAT_HOSTS;
  delete process.env.ALLOWED_OPENAI_COMPAT_HOSTS;

  try {
    assert.equal(
      await validateOpenAICompatBaseUrl('http://localhost:11434/v1/'),
      'http://localhost:11434/v1'
    );
    assert.equal(
      await validateOpenAICompatBaseUrl('http://127.0.0.1:8080/v1'),
      'http://127.0.0.1:8080/v1'
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl(''),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 400
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl('file:///etc/passwd'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 400
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl('http://admin:secret@localhost:11434/v1'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 400
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl('https://evil-exfil.example.com/v1'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 403
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl('http://169.254.169.254/latest/meta-data'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 403
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl('http://10.0.0.1:11434/v1'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 403
    );

    await assert.rejects(
      () => validateOpenAICompatBaseUrl('http://metadata.google.internal/computeMetadata/v1'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 403
    );

    // IPv4-mapped IPv6 and cloud link-local always blocked for external hosts
    assert.equal(isBlockedIpAddress('::ffff:127.0.0.1', false), true);
    assert.equal(isBlockedIpAddress('169.254.169.254', true), true);
    assert.equal(isBlockedIpAddress('192.168.1.5', true), true);
    assert.equal(isBlockedIpAddress('127.0.0.1', true), false);
    assert.equal(isBlockedIpAddress('8.8.8.8', false), false);
  } finally {
    if (prevAllowed === undefined) {
      delete process.env.ALLOWED_OPENAI_COMPAT_HOSTS;
    } else {
      process.env.ALLOWED_OPENAI_COMPAT_HOSTS = prevAllowed;
    }
  }
});

test('Server-side paid authorization policy cannot be bypassed and enforces model allowlist', () => {
  const prevPaid = process.env.ALLOW_PAID_LLM_REQUESTS;
  try {
    delete process.env.ALLOW_PAID_LLM_REQUESTS;
    assert.equal(isServerPaidLlmAuthorized(), false);

    assert.doesNotThrow(() => validateModelAuthorization('gemini', 'gemini-4-hydrogen', false));
    assert.throws(
      () => validateModelAuthorization('gemini', 'gemini-4-argon', false),
      (err: unknown) => err instanceof LLMConfigurationError && err.statusCode === 403
    );
    assert.throws(
      () => validateModelAuthorization('gemini', 'non-existent-model', true),
      (err: unknown) => err instanceof LLMConfigurationError && err.statusCode === 400
    );

    process.env.ALLOW_PAID_LLM_REQUESTS = 'true';
    assert.equal(isServerPaidLlmAuthorized(), true);
    assert.doesNotThrow(() => validateModelAuthorization('gemini', 'gemini-4-argon', true));
  } finally {
    if (prevPaid === undefined) {
      delete process.env.ALLOW_PAID_LLM_REQUESTS;
    } else {
      process.env.ALLOW_PAID_LLM_REQUESTS = prevPaid;
    }
  }
});

test('withLlmExecutionGuard enforces concurrency and daily request limits', async () => {
  const prevCap = process.env.MAX_DAILY_LLM_CALLS;
  resetSecurityCountersForTest();

  try {
    process.env.MAX_DAILY_LLM_CALLS = '2';

    // 1st + 2nd concurrent calls succeed; 3rd concurrent call exceeds concurrency limit (MAX=2)
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const p1 = withLlmExecutionGuard(() => gate);
    const p2 = withLlmExecutionGuard(() => gate);

    await assert.rejects(
      () => withLlmExecutionGuard(async () => 'blocked'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 429
    );

    release();
    await Promise.all([p1, p2]);

    // Daily cap (2) is now exhausted
    await assert.rejects(
      () => withLlmExecutionGuard(async () => 'over-daily-cap'),
      (err: unknown) => err instanceof SecurityPolicyError && err.statusCode === 429
    );
  } finally {
    resetSecurityCountersForTest();
    if (prevCap === undefined) {
      delete process.env.MAX_DAILY_LLM_CALLS;
    } else {
      process.env.MAX_DAILY_LLM_CALLS = prevCap;
    }
  }
});
