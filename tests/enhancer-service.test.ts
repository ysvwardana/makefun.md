import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEnhancement } from '../server/enhancer-service.ts';
import type { BountyRecord, BountySnapshot } from '../src/types/command-center.ts';

const bounty = { slug: 'a' } as BountyRecord;
const snapshot = {
  id: 1, bountySlug: 'a', sourceEndpoint: 'https://make.fun/api/competitions/a', rawCompetition: { slug: 'a' }, rawLeaderboard: null, rawKit: null, officialPromptText: ' \r\nOriginal\t ', manualPromptOverride: null,
  rawRequirements: { deliverables: [{ name: 'repo' }], checks: [{ check: 'license', applies: true }] },
  requirementsComplete: true, rulesHash: 'rules', contentHash: 'snapshot', fetchedAt: '2026-11-19T00:00:00Z',
  promptSource: { kind: 'official_api', bountySlug: 'a', locator: 'https://make.fun/api/competitions/a#/prompt', capturedAt: '2026-11-19T00:00:00Z' },
} as BountySnapshot;

function deps(refresh: () => Promise<any>) {
  return { refresh, getSnapshot: (id: number) => id === 1 ? snapshot : { ...snapshot, id, bountySlug: 'b' }, getCached: () => snapshot, getBounty: () => bounty };
}

test('refresh is invoked on every enhance and failed requirements cannot silently use cache', async () => {
  let calls = 0;
  const dependencies = deps(async () => { calls++; return { bounty, snapshot: { ...snapshot, requirementsComplete: false }, refreshIssues: ['requirements: HTTP 503'] }; });
  await assert.rejects(prepareEnhancement({ slug: 'a' }, dependencies), (error: any) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.details.cacheAvailable, true);
    assert.equal(error.details.cachedSnapshot.fetchedAt, snapshot.fetchedAt);
    assert.match(error.details.refreshIssues.join(), /requirements/);
    return true;
  });
  assert.equal(calls, 1);
  const cached = await prepareEnhancement({ slug: 'a', useCachedSnapshotId: 1 }, dependencies);
  assert.equal(calls, 2);
  assert.equal(cached.usedCache, true);
  assert.equal(cached.snapshot.id, 1);
  await assert.rejects(prepareEnhancement({ slug: 'a', useCachedSnapshotId: 2 }, dependencies), { statusCode: 409 });
});

test('fresh detail with no provable exact standard prompt blocks before provider', async () => {
  await assert.rejects(prepareEnhancement({ slug: 'a' }, deps(async () => ({ bounty, snapshot: { ...snapshot, officialPromptText: '', promptSource: null } }))), (error: any) => {
    assert.equal(error.statusCode, 422);
    assert.equal(error.details.promptMissing, true);
    return true;
  });
});

test('fresh proven source preserves whitespace and bounty identity', async () => {
  const result = await prepareEnhancement({ slug: 'a' }, deps(async () => ({ bounty, snapshot })));
  assert.equal(result.usedCache, false);
  assert.equal(result.snapshot.officialPromptText, ' \r\nOriginal\t ');
  await assert.rejects(prepareEnhancement({ slug: 'b' }, deps(async () => ({ bounty, snapshot }))), { statusCode: 409 });
});
