import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnhancementStream } from '../src/lib/enhancement-stream.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mockFetchPath = path.join(projectRoot, 'tests', 'fixtures', 'makefun-fetch.mjs');
const exactPrompt = '  Build a source-grounded test plan & preserve exact ordering.\nSecond line says "do not normalize" & keep trailing spaces.  ';

async function availablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const exited = () => { cleanup(); resolve(true); };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', exited);
    };
    child.once('exit', exited);
  });
}

function jsonRequest(baseUrl: string, pathname: string, method = 'GET', body?: unknown) {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function postEnhancement(baseUrl: string, extra: Record<string, unknown> = {}) {
  return jsonRequest(baseUrl, '/api/enhancer/run', 'POST', { slug: 'alpha-offline', ...extra });
}

test('offline HTTP workflow syncs, proves exact prompt provenance, enhances, and saves a bound version', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'makefun-http-workflow-'));
  const appPort = await availablePort();
  let providerPort = await availablePort();
  while (providerPort === appPort) providerPort = await availablePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const providerUrl = `http://127.0.0.1:${providerPort}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(appPort),
    COSMICLABS_DB_PATH: path.join(tempDir, 'workflow.sqlite'),
    OPENAI_COMPAT_BASE_URL: `${providerUrl}/v1`,
    MAKEFUN_FIXTURE_PROVIDER_PORT: String(providerPort),
    LLM_MAX_CONTEXT_CHARS: '200000',
  };
  let child: ChildProcess | undefined;

  try {
    child = spawn('node', ['--import', pathToFileURL(mockFetchPath).href, '--import', 'tsx', 'server.ts'], {
      cwd: projectRoot,
      env: childEnv,
      stdio: 'inherit',
      windowsHide: true,
    });

    const startupDeadline = Date.now() + 20_000;
    let healthy = false;
    while (Date.now() < startupDeadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        assert.fail(`Server exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode}).`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(750) });
        if (response.ok && (await response.json()).ok === true) { healthy = true; break; }
      } catch {
        // The listener may not yet be ready.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, 'production HTTP server should become healthy within the startup bound');

    // The empty database triggers the documented first-list sync through the public HTTP route.
    const firstListResponse = await fetch(`${baseUrl}/api/bounties`);
    assert.equal(firstListResponse.status, 200);
    const firstList = await readJson(firstListResponse);
    assert.deepEqual(firstList.items.map((item: { slug: string }) => item.slug), ['alpha-offline']);

    const firstStatusResponse = await fetch(`${baseUrl}/api/bounties/sync-status`);
    assert.equal(firstStatusResponse.status, 200);
    const firstStatus = await readJson(firstStatusResponse);
    assert.ok(firstStatus.lastSuccessAt, 'auto-sync success should be visible through sync-status');

    // A subsequent sync sees the expanded list; alpha is already persisted and beta is new.
    const syncResponse = await jsonRequest(baseUrl, '/api/bounties/sync', 'POST', {});
    assert.equal(syncResponse.status, 200);
    const syncResult = await readJson(syncResponse);
    assert.equal(syncResult.syncState, 'LIVE');
    const expandedListResponse = await fetch(`${baseUrl}/api/bounties`);
    assert.equal(expandedListResponse.status, 200);
    const expandedList = await readJson(expandedListResponse);
    assert.deepEqual(new Set(expandedList.items.map((item: { slug: string }) => item.slug)), new Set(['alpha-offline', 'beta-offline']));

    // Detail refresh exercises all four API resources plus the matching competition page.
    const detailResponse = await fetch(`${baseUrl}/api/bounties/alpha-offline`);
    assert.equal(detailResponse.status, 200);
    const detail = await readJson(detailResponse);
    assert.equal(detail.snapshot.requirementsComplete, true);
    assert.deepEqual(detail.snapshot.rawRequirements.checks.map((gate: { check: string }) => gate.check), ['automated-test', 'license-audit']);
    assert.deepEqual(detail.snapshot.rawLeaderboard.entries.map((row: { handle: string }) => row.handle), ['@leader-one']);
    assert.equal(detail.snapshot.rawKit.kitId, 'kit-alpha-v1');
    assert.equal(detail.snapshot.officialPromptText, exactPrompt, 'page prompt whitespace and decoded HTML entities must be preserved exactly');
    assert.deepEqual(detail.snapshot.promptSource, {
      kind: 'official_api',
      locator: 'https://make.fun/bounty/alpha-offline#p.crawl-body-prompt',
      capturedAt: detail.snapshot.fetchedAt,
      bountySlug: 'alpha-offline',
    });
    const cachedAlphaSnapshotId = detail.snapshot.id;

    const enhanceResponse = await postEnhancement(baseUrl, { founderInstructions: 'Prefer small deterministic test cases.' });
    assert.equal(enhanceResponse.status, 200);
    const enhancement = await readJson(enhanceResponse);
    assert.equal(enhancement.part1OriginalPrompt, exactPrompt);
    // Enhancement refreshes detail itself, so bind the exact newer capture returned by that request.
    const alphaSnapshotId = enhancement.evidence.snapshotId;
    assert.notEqual(alphaSnapshotId, cachedAlphaSnapshotId);
    assert.deepEqual(enhancement.evidence.gateCoverage.map((gate: { gateId: string; status: string }) => [gate.gateId, gate.status]), [
      ['automated-test', 'covered'],
      ['license-audit', 'uncovered'],
    ]);
    assert.match(enhancement.evidence.gateCoverage[1].reason, /did not supply coverage/i);
    const recoveredContext = await readJson(await fetch(`${baseUrl}/api/bounties/alpha-offline`));
    assert.equal(recoveredContext.analyses[0].part2AiEnhancement, enhancement.part2AiEnhancement);
    assert.equal(recoveredContext.analyses[0].part3ExecutionGuidelines, enhancement.part3ExecutionGuidelines);
    assert.equal(recoveredContext.analysisSourceSnapshot.id, alphaSnapshotId);
    assert.equal(recoveredContext.analysisSourceSnapshot.officialPromptText, exactPrompt);

    // Save Part 1 exactly as returned, with the selected source and analysis bound together.
    const versionPayload = {
      analysisId: enhancement.analysis.id,
      sourceSnapshotId: alphaSnapshotId,
      part1OriginalPrompt: enhancement.part1OriginalPrompt,
      part2AiEnhancement: enhancement.part2AiEnhancement,
      part3ExecutionGuidelines: enhancement.part3ExecutionGuidelines,
      selectedSkills: enhancement.recommendedSkills,
      editSummary: 'Offline integration regression',
    };
    const saveResponse = await jsonRequest(baseUrl, '/api/prompts/alpha-offline/versions', 'POST', versionPayload);
    const saved = await readJson(saveResponse);
    assert.equal(saveResponse.status, 201, JSON.stringify(saved));
    assert.equal(saved.version.part1OriginalPrompt, exactPrompt);
    assert.equal(saved.version.sourceSnapshotId, alphaSnapshotId);
    assert.equal(saved.version.analysisId, enhancement.analysis.id);
    const promptHistoryResponse = await fetch(`${baseUrl}/api/prompts/alpha-offline`);
    assert.equal(promptHistoryResponse.status, 200);
    const promptHistory = await readJson(promptHistoryResponse);
    assert.equal(promptHistory.versions[0].part1OriginalPrompt, exactPrompt);

    // A detail snapshot for beta is valid for beta, never a substitute for alpha's selected source.
    const betaDetailResponse = await fetch(`${baseUrl}/api/bounties/beta-offline`);
    assert.equal(betaDetailResponse.status, 200);
    const betaDetail = await readJson(betaDetailResponse);
    const crossBountyResponse = await jsonRequest(baseUrl, '/api/prompts/beta-offline/versions', 'POST', {
      ...versionPayload,
      sourceSnapshotId: betaDetail.snapshot.id,
      part1OriginalPrompt: betaDetail.snapshot.officialPromptText,
    });
    assert.equal(crossBountyResponse.status, 409);
    assert.match((await readJson(crossBountyResponse)).error, /analysis does not exist for this bounty/i);

    // The newly synced beta bounty is selectable and can be independently analyzed.
    const betaEnhanceResponse = await fetch(`${baseUrl}/api/enhancer/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ slug: 'beta-offline' }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(betaEnhanceResponse.status, 200);
    assert.match(betaEnhanceResponse.headers.get('content-type') ?? '', /application\/x-ndjson/);
    const progress: string[] = [];
    const betaResult = await readEnhancementStream<typeof enhancement>(betaEnhanceResponse, (entry) => progress.push(entry.message));
    assert.equal(betaResult.status, 200);
    assert.match(progress[0], /Memperbarui detail/);
    assert.match(progress[3], /Karakter per bagian/);
    assert.match(progress[4], /Meminta analisis ke provider/);
    assert.match(progress.at(-1) ?? '', /Analisis tersimpan/);
    const betaEnhancement = betaResult.data;
    assert.equal(betaEnhancement.analysis.bountySlug, 'beta-offline');
    assert.equal(betaEnhancement.part1OriginalPrompt, 'Beta exact standard prompt that belongs only to beta.');
    assert.equal(betaEnhancement.evidence.snapshotId, betaDetail.snapshot.id + 1);

    // Make the requirements endpoint fail after a complete snapshot has been cached.
    const enableFailure = await jsonRequest(providerUrl, '/__fixture/control?requirementsFailure=1', 'POST', {});
    assert.equal(enableFailure.status, 200);
    const failedRefreshResponse = await postEnhancement(baseUrl);
    assert.equal(failedRefreshResponse.status, 409);
    const failedRefresh = await readJson(failedRefreshResponse);
    assert.equal(failedRefresh.cacheAvailable, true);
    assert.equal(failedRefresh.cachedSnapshot.fetchedAt, enhancement.snapshot.fetchedAt);
    assert.match(failedRefresh.refreshIssues.join(' '), /requirements endpoint failed: HTTP 503/i);

    // Cache use is opt-in, explicitly source-bound, and keeps the old capture time in analysis evidence.
    const cachedEnhanceResponse = await postEnhancement(baseUrl, { useCachedSnapshotId: alphaSnapshotId });
    assert.equal(cachedEnhanceResponse.status, 200);
    const cachedEnhancement = await readJson(cachedEnhanceResponse);
    assert.equal(cachedEnhancement.evidence.usedCache, true);
    assert.equal(cachedEnhancement.evidence.snapshotId, alphaSnapshotId);
    assert.equal(cachedEnhancement.evidence.contextFetchedAt, enhancement.snapshot.fetchedAt);

    // Confirm the offline provider saw the complete context and no required section was shortened.
    const fixtureStateResponse = await fetch(`${providerUrl}/__fixture/state`);
    assert.equal(fixtureStateResponse.status, 200);
    const fixtureState = await readJson(fixtureStateResponse);
    assert.equal(fixtureState.providerRequests.length, 3);
    const providerUserPrompt = fixtureState.providerRequests[0].messages.find((message: { role: string }) => message.role === 'user').content as string;
    assert.ok(providerUserPrompt.includes(exactPrompt));
    assert.ok(providerUserPrompt.includes('alpha-official-kit-full-context-sentinel'));
    assert.ok(providerUserPrompt.includes('alpha-leaderboard-full-context-sentinel'));
    assert.ok(providerUserPrompt.includes('license-audit'));
    assert.ok(providerUserPrompt.includes('how-to-submit-alpha-sentinel'));
    assert.ok(providerUserPrompt.length < 200_000, 'context remains under the configured default-sized budget');
    assert.ok(fixtureState.makefunFetches.some((url: string) => url === 'https://make.fun/api/competitions?status=open'));
    assert.ok(fixtureState.makefunFetches.some((url: string) => url === 'https://make.fun/api/competitions/alpha-offline/requirements?format=json'));
    assert.ok(fixtureState.makefunFetches.some((url: string) => url === 'https://make.fun/api/competitions/alpha-offline/leaderboard'));
    assert.ok(fixtureState.makefunFetches.some((url: string) => url === 'https://make.fun/api/competitions/alpha-offline/kit'));
    assert.ok(fixtureState.makefunFetches.some((url: string) => url === 'https://make.fun/bounty/alpha-offline'));
    assert.ok(fixtureState.blockedExternalFetches.length > 0, 'optional external research attempts must be intercepted by the preload fixture');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      if (!await waitForExit(child, 5_000)) {
        child.kill('SIGKILL');
        await waitForExit(child, 5_000);
      }
    }
    // This directory is created exclusively for this test run.
    await rm(tempDir, { recursive: true, force: true });
  }
});
