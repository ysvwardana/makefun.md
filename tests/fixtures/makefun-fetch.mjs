import { createServer } from 'node:http';
import { isMainThread } from 'node:worker_threads';

const port = Number(process.env.MAKEFUN_FIXTURE_PROVIDER_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('MAKEFUN_FIXTURE_PROVIDER_PORT must be a valid local port.');
}

const makefunFetches = [];
const providerRequests = [];
const blockedExternalFetches = [];
let requirementsFailure = false;

const exactPromptMarkup = '  Build a source-grounded test plan &amp; preserve exact ordering.\nSecond line says &quot;do not normalize&quot; &amp; keep trailing spaces.  ';
const alphaCompetition = {
  id: 'competition-alpha-offline',
  slug: 'alpha-offline',
  title: 'Offline Alpha Verification Challenge',
  url: 'https://make.fun/bounty/alpha-offline',
  category: 'Software engineering',
  skills: ['typescript', 'testing'],
  description: 'alpha-official-kit-full-context-sentinel Official description preserved.',
  rules: 'Use deterministic local checks. Preserve every official requirement.',
  rulesNote: { text: 'alpha rules note sentinel' },
  potUsd: 2500,
  rewardAmount: 2500,
  entryFeeUsd: 0,
  deadline: '2027-01-20T00:00:00.000Z',
  publishedAt: '2026-11-01T00:00:00.000Z',
  status: 'open',
  acceptingSubmissions: true,
  submissionCount: 1,
  sponsor: { name: 'Offline Sponsor', isVerified: true },
  summary: 'Full official context should be included.',
};
const betaCompetition = {
  id: 'competition-beta-offline',
  slug: 'beta-offline',
  title: 'Offline Beta Verification Challenge',
  url: 'https://make.fun/bounty/beta-offline',
  category: 'Software engineering',
  skills: ['typescript'],
  description: 'beta context sentinel',
  rules: 'A separate bounty for source identity checks.',
  potUsd: 900,
  rewardAmount: 900,
  deadline: '2027-02-01T00:00:00.000Z',
  publishedAt: '2026-11-02T00:00:00.000Z',
  status: 'open',
  acceptingSubmissions: true,
  submissionCount: 0,
};

function itemFor(competition) {
  const { id, slug, title, url, category, skills, rewardAmount, potUsd, deadline, publishedAt, status, acceptingSubmissions, submissionCount, description, summary } = competition;
  return { id, slug, title, url, category, skills, rewardAmount, potUsd, deadline, publishedAt, status, acceptingSubmissions, submissionCount, description, summary };
}

const alphaRequirements = {
  competition: { slug: 'alpha-offline' },
  deliverables: [
    { name: 'source repository', detail: 'Commit the regression suite.', sentinel: 'how-to-submit-alpha-sentinel' },
    { name: 'test report', detail: 'Include exact command output.' },
  ],
  checks: [
    { id: 'check-automated-test', check: 'automated-test', description: 'Run the deterministic HTTP integration suite.', applies: true },
    { id: 'check-license-audit', check: 'license-audit', description: 'Inspect and document all dependency licenses.', applies: true },
  ],
  judging: [{ criterion: 'Reproducibility', weight: '40%', description: 'A clean offline run yields stable evidence.' }],
  how_to_submit: 'how-to-submit-alpha-sentinel: submit the repository and report through the official entry form.',
  prerequisites: { label: 'Local Node runtime', software: [{ name: 'Node.js', required: true, version: '>=20' }] },
};
const betaRequirements = {
  competition: { slug: 'beta-offline' },
  deliverables: [{ name: 'separate repository' }],
  checks: [{ id: 'beta-check-id', check: 'beta-test', applies: true }],
  how_to_submit: 'Submit beta materials separately.',
};

const analysis = {
  objectiveSummary: 'Produce a reliable, evidence-backed implementation.',
  mandatoryRequirements: ['Preserve official source text exactly.'],
  judgingCriteria: ['Reproducibility and traceable evidence.'],
  recommendedApproach: 'Build a narrow deterministic workflow and exercise every public boundary.',
  differentiationStrategy: 'Bind every saved artifact to its exact source snapshot and capture time.',
  architectureOrMethodology: 'Use a loopback-only mock service and an isolated temporary database.',
  priorityMatrix: [{ criterion: 'Reproducibility', weightOrEmphasis: 'High', actionableFocus: 'Run the suite without network access.' }],
  implementationGuidance: ['Use explicit fixtures.', 'Assert source identity at each save boundary.'],
  qualityStandards: ['Keep test output stable.'],
  testingValidation: ['Run the offline HTTP integration workflow.'],
  complianceConsiderations: ['Do not infer unprovided gate coverage.'],
  assumptionsUncertainties: ['The mock reflects only the endpoint shapes declared in this fixture.'],
  risks: ['Production endpoint changes may require fixture updates.'],
  recommendedSkills: [{
    name: 'Deterministic Integration Testing',
    category: 'Testing',
    priority: 'essential',
    rationale: 'Isolates state and avoids external dependencies.',
    agentDirective: 'Keep the provider local and assert every provenance boundary.',
  }],
  part2AiEnhancement: '# Offline enhancement\n\nPreserve source identity, validate every input, and document evidence for each measured claim. Use the exact official criteria and no fabricated results.',
  part3ExecutionGuidelines: '# Execution guidelines\n\n1. Run deterministic tests.\n2. Save all outputs with their source snapshot ID.\n3. Record what was not verified.',
  // Deliberately omits license-audit; the server must restore it as uncovered.
  gateCoverage: [{
    gateId: 'automated-test',
    status: 'covered',
    verification: 'Run npm test and preserve its exit code.',
    evidence: 'Attach the complete deterministic test output.',
    reason: '',
  }],
};

const provider = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  response.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/__fixture/control' && request.method === 'POST') {
    requirementsFailure = url.searchParams.get('requirementsFailure') === '1';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/__fixture/state' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ makefunFetches, providerRequests, blockedExternalFetches }));
    return;
  }

  if (url.pathname.endsWith('/chat/completions') && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    providerRequests.push(body);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(analysis) } }],
      usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 },
    }));
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: 'unknown local fixture endpoint' }));
});

// Node's module customization loader runs in a worker thread and inherits --import. Only
// the child application's main thread should own the mock provider listener.
if (isMainThread) provider.listen(port, '127.0.0.1');

const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  if (url.origin === 'https://make.fun') {
    makefunFetches.push(url.toString());
    let status = 200;
    let payload;
    if (url.pathname === '/api/competitions' && url.searchParams.get('status') === 'open') {
      payload = { items: [itemFor(alphaCompetition)] };
    } else if (url.pathname === '/api/competitions') {
      globalThis.__makefunFullListRequests = (globalThis.__makefunFullListRequests || 0) + 1;
      payload = globalThis.__makefunFullListRequests === 1
        ? { items: [itemFor(alphaCompetition)], next_cursor: 'cursor-offline-page-2' }
        : { items: [itemFor(alphaCompetition), itemFor(betaCompetition)], next_cursor: null };
    } else if (url.pathname === '/api/competitions/alpha-offline') {
      payload = alphaCompetition;
    } else if (url.pathname === '/api/competitions/alpha-offline/requirements') {
      if (requirementsFailure) status = 503;
      else payload = alphaRequirements;
    } else if (url.pathname === '/api/competitions/alpha-offline/leaderboard') {
      payload = { competition: { slug: 'alpha-offline' }, entries: [{ handle: '@leader-one', score: 900, note: 'alpha-leaderboard-full-context-sentinel' }] };
    } else if (url.pathname === '/api/competitions/alpha-offline/kit') {
      payload = { kitId: 'kit-alpha-v1', version: 1, files: [{ path: 'README.md', contents: 'alpha-official-kit-full-context-sentinel' }] };
    } else if (url.pathname === '/api/competitions/beta-offline') {
      payload = betaCompetition;
    } else if (url.pathname === '/api/competitions/beta-offline/requirements') {
      payload = betaRequirements;
    } else if (url.pathname === '/api/competitions/beta-offline/leaderboard') {
      payload = { competition: { slug: 'beta-offline' }, entries: [] };
    } else if (url.pathname === '/api/competitions/beta-offline/kit') {
      payload = { kitId: 'kit-beta-v1', files: [] };
    } else if (url.pathname === '/bounty/alpha-offline') {
      return new Response(`<html><body><p class="crawl-body-prompt">${exactPromptMarkup}</p></body></html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } else if (url.pathname === '/bounty/beta-offline') {
      return new Response('<html><body><p class="crawl-body-prompt">Beta exact standard prompt that belongs only to beta.</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } else {
      status = 404;
      payload = { error: `No Make.fun fixture for ${url.pathname}` };
    }
    return new Response(status === 200 ? JSON.stringify(payload) : JSON.stringify({ error: 'fixture upstream unavailable' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Optional external research is explicitly kept offline; never delegate it to the host network.
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1') {
    blockedExternalFetches.push(url.toString());
    return new Response(JSON.stringify({ error: 'offline integration fixture blocks external network access' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};
