import test from 'node:test';
import assert from 'node:assert/strict';
import { studioSnapshot } from '../server/studio-response.ts';
import type { BountySnapshot } from '../src/types/command-center.ts';

test('UI projection bounds optional activity while preserving exact prompt and all requirements', () => {
  const original: BountySnapshot = { id: 1, bountySlug: 'a', sourceEndpoint: 'official', rawCompetition: { slug: 'a', rules: 'all mandatory rules', submissions: ['huge'], chat: ['activity'] },
    rawRequirements: { checks: Array.from({ length: 70 }, (_, i) => ({ check: `gate${i}` })), deliverables: ['all'] },
    rawLeaderboard: { entries: Array.from({ length: 100 }, (_, i) => ({ id: i })) }, rawKit: { rule: 'complete' },
    officialPromptText: ' \r\nExact\t ', manualPromptOverride: null, fetchedAt: 'time', contentHash: 'raw-hash', rulesHash: 'rules', requirementsComplete: true };
  const result = studioSnapshot(original)!;
  assert.equal(result.officialPromptText, original.officialPromptText);
  assert.equal(result.contentHash, 'raw-hash');
  assert.deepEqual(result.rawRequirements, original.rawRequirements);
  assert.deepEqual(result.rawKit, original.rawKit);
  assert.equal(result.rawCompetition?.rules, 'all mandatory rules');
  assert.equal(result.rawCompetition?.submissions, undefined);
  assert.equal((result.rawLeaderboard?.entries as unknown[]).length, 20);
  assert.equal((original.rawLeaderboard?.entries as unknown[]).length, 100);
  assert.match(result.refreshIssues!.join(' '), /not a complete leaderboard/);
});
