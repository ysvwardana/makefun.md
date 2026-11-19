import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSnapshotHashes,
  extractOfficialPromptText,
  extractPromptSource,
  isRequirementsComplete,
} from '../server/makefun.ts';

test('official prompt extraction preserves a dedicated API string exactly and records its field path', () => {
  const exact = '  First line\r\nSecond line — keep whitespace.  ';
  const extracted = extractPromptSource({ prompt_text: exact, description: 'not the standard prompt' }, null,
    'token-radar-01', '2026-11-19T00:00:00Z', 'https://make.fun/api/competitions/token-radar-01');
  assert.equal(extracted.text, exact);
  const requirementsPrompt = extractPromptSource(null, { prompt: 'requirements source' }, 'token-radar-01', 'captured',
    'https://make.fun/api/competitions/token-radar-01');
  assert.equal(requirementsPrompt.source?.locator, 'https://make.fun/api/competitions/token-radar-01/requirements?format=json#/prompt');
  const blankThenAvailable = extractPromptSource({ prompt: '   ' }, { standard_prompt: 'Exact fallback' }, 'token-radar-01', 'captured',
    'https://make.fun/api/competitions/token-radar-01');
  assert.equal(blankThenAvailable.text, 'Exact fallback');
  assert.deepEqual(extracted.source, {
    kind: 'official_api',
    locator: 'https://make.fun/api/competitions/token-radar-01#/prompt_text',
    capturedAt: '2026-11-19T00:00:00Z',
    bountySlug: 'token-radar-01',
  });
});

test('description, rules, title and submission instructions do not synthesize standard prompt text', () => {
  const text = extractOfficialPromptText({
    title: 'Title', description: 'Description prompt', rules: 'Rules',
  }, { deliverables: [{ name: 'repo_url' }], how_to_submit: 'submit here' });
  assert.equal(text, '');
  assert.deepEqual(extractPromptSource({ how_to_submit: 'not prompt' }, null, 'x', 'now', 'https://make.fun/api/competitions/x'), {
    text: '', source: null,
  });
});

test('unique verified HTML prompt is entity decoded and tied to its matching bounty page', () => {
  const html = '<main><p class="intro">No.</p><p class="crawl-body-prompt">Read make.fun/skill.md &amp; enter the bounty &quot;Build the best token launch radar&quot; (make.fun/bounty/token-radar-01).</p></main>';
  const extracted = extractPromptSource(null, null, 'token-radar-01', 'captured',
    'https://make.fun/api/competitions/token-radar-01', html, 'https://make.fun/bounty/token-radar-01');
  assert.equal(extracted.text, 'Read make.fun/skill.md & enter the bounty "Build the best token launch radar" (make.fun/bounty/token-radar-01).');
  assert.equal(extracted.source?.locator, 'https://make.fun/bounty/token-radar-01#p.crawl-body-prompt');
  assert.equal(extractPromptSource(null, null, 'other', 'captured', 'https://make.fun/api/competitions/other', html,
    'https://make.fun/bounty/token-radar-01').source, null);
  assert.equal(extractPromptSource(null, null, 'token-radar-01', 'captured', 'https://make.fun/api/competitions/token-radar-01',
    html + '<p class="crawl-body-prompt">duplicate</p>', 'https://make.fun/bounty/token-radar-01').source, null);
});

test('requirements completeness requires matching competition, all deliverables, and identified checks', () => {
  const req = { competition: { slug: 'abc' }, deliverables: [{ name: 'repo' }], checks: [{ check: 'license' }, { id: 'size' }] };
  assert.equal(isRequirementsComplete(req, 'abc'), true);
  assert.equal(isRequirementsComplete({ ...req, competition: { slug: 'wrong' } }, 'abc'), false);
  assert.equal(isRequirementsComplete({ ...req, deliverables: [] }, 'abc'), false);
  assert.equal(isRequirementsComplete({ ...req, checks: [{ check: 'good' }, {}] }, 'abc'), false);
  assert.equal(isRequirementsComplete({ ...req, checks: [{ check: 'same' }, { id: 'same' }] }, 'abc'), false);
});

test('content hash includes mutable leaderboard while rules hash does not', () => {
  const base = {
    competition: { slug: 'abc', description: 'D', rules: 'R', rulesNote: { text: 'N' } },
    requirements: { competition: { slug: 'abc' }, deliverables: [{ name: 'x' }], checks: [{ id: 'g' }] },
    leaderboard: { entries: [1] }, kit: { version: 1 }, prompt: 'Exact prompt',
    promptSource: { kind: 'official_api' as const, locator: 'https://make.fun/bounty/abc#p.crawl-body-prompt', capturedAt: 't1', bountySlug: 'abc' },
  };
  const first = computeSnapshotHashes(base);
  const changedLeaderboard = computeSnapshotHashes({ ...base, leaderboard: { entries: [2] } });
  assert.notEqual(first.contentHash, changedLeaderboard.contentHash);
  assert.equal(first.rulesHash, changedLeaderboard.rulesHash);
  const changedRules = computeSnapshotHashes({ ...base, competition: { ...base.competition, rules: 'changed' } });
  assert.notEqual(first.rulesHash, changedRules.rulesHash);
  for (const changedCompetition of [
    { ...base.competition, deadline: '2027-01-01' },
    { ...base.competition, judging: { metric: 'new' } },
    { ...base.competition, prerequisites: { mcp: ['browser'] } },
  ]) {
    assert.notEqual(first.rulesHash, computeSnapshotHashes({ ...base, competition: changedCompetition }).rulesHash);
  }
  assert.notEqual(first.rulesHash, computeSnapshotHashes({ ...base, kit: { version: 2 } }).rulesHash);
});
