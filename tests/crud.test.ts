import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandCenterCrud } from '../server/crud.ts';
import { createDatabaseConnection } from '../server/db.ts';

function setupIsolatedCrud() {
  const { sqlite, orm } = createDatabaseConnection(':memory:');
  const crud = createCommandCenterCrud(orm);
  return { sqlite, orm, crud };
}

test('Drizzle Bounties CRUD: upsert preserves watchlist/notes and supports sorting/filtering', () => {
  const { sqlite, crud } = setupIsolatedCrud();
  try {
    const now = '2026-11-18T02:00:00.000Z';
    crud.upsertBounty({
      slug: 'alpha-bounty',
      id: 'b-1',
      title: 'Alpha Coding Challenge',
      url: 'https://make.fun/bounty/alpha-bounty',
      category: 'Software',
      skills: ['typescript', 'rust'],
      rewardAmount: 1000,
      potUsd: 1000,
      entryFeeUsd: null,
      deadline: '2026-12-01T00:00:00Z',
      publishedAt: '2026-11-10T00:00:00Z',
      status: 'open',
      submissionCount: 2,
      sponsorName: 'MakeFun',
      sponsorVerified: true,
      summary: 'Original summary',
      harnessKind: 'code',
      acceptingSubmissions: true,
      isDemo: false,
      syncState: 'LIVE',
      lastSyncedAt: now,
      prerequisites: {
        label: 'Needs Node 22',
        software: [{ name: 'Node.js', required: true, version: '>=22' }],
      },
    });

    crud.upsertBounty({
      slug: 'beta-bounty',
      id: 'b-2',
      title: 'Beta Crowded Challenge',
      url: 'https://make.fun/bounty/beta-bounty',
      category: 'Creative',
      skills: ['design'],
      rewardAmount: 500,
      potUsd: 500,
      entryFeeUsd: null,
      deadline: '2026-11-25T00:00:00Z',
      publishedAt: '2026-11-10T00:00:00Z',
      status: 'open',
      submissionCount: 100,
      sponsorName: null,
      sponsorVerified: false,
      summary: 'Crowded',
      harnessKind: null,
      acceptingSubmissions: true,
      isDemo: false,
      syncState: 'LIVE',
      lastSyncedAt: now,
    });

    assert.equal(crud.updateBountyWatchlist('alpha-bounty', true), true);
    assert.equal(crud.updateBountyNotes('alpha-bounty', 'Focus on latency'), true);

    // Re-upsert without prerequisites or summary should preserve existing values and watchlist/notes
    const updated = crud.upsertBounty({
      slug: 'alpha-bounty',
      id: 'b-1',
      title: 'Alpha Coding Challenge v2',
      url: 'https://make.fun/bounty/alpha-bounty',
      category: 'Software',
      skills: ['typescript'],
      rewardAmount: 1200,
      potUsd: 1200,
      entryFeeUsd: null,
      deadline: '2026-12-01T00:00:00Z',
      publishedAt: '2026-11-10T00:00:00Z',
      status: 'open',
      submissionCount: 2,
      sponsorName: 'MakeFun',
      sponsorVerified: true,
      summary: null,
      harnessKind: null,
      acceptingSubmissions: true,
      isDemo: false,
      syncState: 'LIVE',
      lastSyncedAt: '2026-11-18T02:05:00.000Z',
      prerequisites: null,
    });

    assert.equal(updated.title, 'Alpha Coding Challenge v2');
    assert.equal(updated.summary, 'Original summary');
    assert.equal(updated.watchlisted, true);
    assert.equal(updated.founderNotes, 'Focus on latency');
    assert.equal(updated.prerequisites?.label, 'Needs Node 22');

    const byRatio = crud.listBounties({ sortBy: 'ratio_desc' });
    assert.equal(byRatio.items[0].slug, 'alpha-bounty');
    assert.equal(byRatio.items[1].slug, 'beta-bounty');

    const watchlisted = crud.listBounties({ watchlistedOnly: true });
    assert.equal(watchlisted.items.length, 1);
    assert.equal(watchlisted.items[0].slug, 'alpha-bounty');
  } finally {
    sqlite.close();
  }
});

test('Drizzle Snapshots, AI Analyses, Prompt Versions (transactional) & Cascade Delete', () => {
  const { sqlite, crud } = setupIsolatedCrud();
  try {
    crud.upsertBounty({
      slug: 'tiny-chess-01',
      id: 'tc-1',
      title: 'Tiny Chess',
      url: 'https://make.fun/bounty/tiny-chess-01',
      category: 'Algorithms',
      skills: ['chess', 'python'],
      rewardAmount: 250,
      potUsd: 250,
      entryFeeUsd: null,
      deadline: '2026-12-10T00:00:00Z',
      publishedAt: '2026-11-01T00:00:00Z',
      status: 'open',
      submissionCount: 10,
      sponsorName: 'MakeFun',
      sponsorVerified: true,
      summary: '4KB chess bot',
      harnessKind: 'elo',
      acceptingSubmissions: true,
      isDemo: false,
      syncState: 'LIVE',
      lastSyncedAt: '2026-11-18T02:00:00Z',
    });

    // Snapshots + manual override
    const snap1 = crud.saveBountySnapshot({
      bountySlug: 'tiny-chess-01',
      sourceEndpoint: 'https://make.fun/api/competitions/tiny-chess-01',
      rawCompetition: { slug: 'tiny-chess-01' },
      rawRequirements: { max_bytes: 4096 },
      rawLeaderboard: null,
      rawKit: null,
      officialPromptText: 'Build a 4KB chess engine.',
      fetchedAt: '2026-11-18T02:00:00Z',
      contentHash: 'hash-1',
      rulesHash: 'rules-1',
      requirementsComplete: true,
      promptSource: { kind: 'official_api', locator: 'https://make.fun/api/competitions/tiny-chess-01#/prompt', bountySlug: 'tiny-chess-01', capturedAt: '2026-11-18T02:00:00Z' },
    });
    assert.equal(snap1.officialPromptText, 'Build a 4KB chess engine.');

    const snapWithOverride = crud.upsertManualPromptOverride(
      'tiny-chess-01',
      'Verified full manual official rules text.'
    );
    assert.equal(snapWithOverride.manualPromptOverride, 'Verified full manual official rules text.');

    // AI Analysis CRUD
    const analysis = crud.createAIAnalysis({
      bountySlug: 'tiny-chess-01',
      provider: 'openai_compatible',
      model: 'llama3.1:8b',
      stageStatus: 'completed_4_stage_pipeline',
      objectiveSummary: '4096 byte compressed chess bot.',
      mandatoryRequirements: ['Single file <= 4096 bytes'],
      judgingCriteria: ['Elo rating'],
      recommendedApproach: 'PeSTO + alpha-beta + zlib self-extract.',
      differentiationStrategy: 'Compact LMR & aspiration windows.',
      architectureOrMethodology: 'Single Python script compressed with zlib.',
      priorityMatrix: [{ criterion: 'Elo', weightOrEmphasis: 'Primary', actionableFocus: 'Tactical search' }],
      implementationGuidance: ['Use 0x88 or bitboard'],
      qualityStandards: ['Zero illegal moves'],
      testingValidation: ['Run 6-trial suite'],
      complianceConsiderations: ['No network access'],
      assumptionsUncertainties: ['Clock budget'],
      risks: ['Byte overflow'],
      researchReferences: [
        {
          title: 'PeSTO Evaluation',
          url: 'https://www.chessprogramming.org/PeSTO',
          sourceType: 'official_docs',
          relevance: 'Piece-square tables',
        },
      ],
      researchDisclosures: 'Official specs verified.',
      recommendedSkills: [
        {
          id: 'ai-pesto-1',
          name: 'PeSTO Tapered Eval',
          category: 'Chess Search',
          source: 'ai_curated',
          priority: 'essential',
          rationale: 'Maximizes strength per byte.',
          agentDirective: 'Use compact signed byte PSQT tables.',
          enabled: true,
        },
      ],
      evidence: {
        snapshotId: snapWithOverride.id, snapshotHash: snapWithOverride.contentHash,
        rulesHash: snapWithOverride.rulesHash!, contextHash: 'exact-sent-context-hash',
        contextFetchedAt: snapWithOverride.fetchedAt, usedCache: false,
        promptSource: snapWithOverride.promptSource!, gateCoverage: [], contextSections: ['standardPrompt', 'requirements'],
      },
      rawLlmResponse: '{"ok":true}',
      tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    });
    const fetchedAnalysis = crud.getAIAnalysisById(analysis.id);
    assert.equal(fetchedAnalysis?.provider, 'openai_compatible');
    assert.equal(fetchedAnalysis?.model, 'llama3.1:8b');
    assert.equal(fetchedAnalysis?.recommendedSkills?.[0]?.name, 'PeSTO Tapered Eval');
    assert.equal(crud.listAIAnalysesByBounty('tiny-chess-01').length, 1);

    // Transactional append-only prompt versions
    const v1 = crud.createPromptVersionTransactional({
      bountySlug: 'tiny-chess-01',
      bountyTitle: 'Tiny Chess',
      analysisId: analysis.id,
      sourceSnapshotId: snapWithOverride.id,
      part1OriginalPrompt: 'Verified full manual official rules text.',
      part2AiEnhancement: 'Use PeSTO + PVS.',
      part3ExecutionGuidelines: 'Stay under 4096 bytes.',
      founderInstructions: 'Python 3.13',
      fullMarkdown: '# v1',
      editSummary: 'Initial v1',
      founderNotes: 'Track bytes',
    });
    assert.equal(v1.version.versionNumber, 1);
    assert.equal(v1.draft.latestVersionId, v1.version.id);

    const v2 = crud.createPromptVersionTransactional({
      bountySlug: 'tiny-chess-01',
      bountyTitle: 'Tiny Chess',
      analysisId: analysis.id,
      sourceSnapshotId: snapWithOverride.id,
      part1OriginalPrompt: 'Verified full manual official rules text.',
      part2AiEnhancement: 'Use PeSTO + PVS + CRC32 opening book.',
      part3ExecutionGuidelines: 'Stay under 4096 bytes and log 5+ turns.',
      founderInstructions: 'Python 3.13',
      selectedSkills: [
        {
          id: 'ai-pesto-1',
          name: 'PeSTO Tapered Eval',
          category: 'Chess Search',
          source: 'ai_curated',
          priority: 'essential',
          rationale: 'Maximizes strength per byte.',
          agentDirective: 'Use compact signed byte PSQT tables.',
          enabled: true,
        },
        {
          id: 'custom-verify',
          name: 'hermes-byte-guard',
          category: 'Verification',
          source: 'founder_custom',
          priority: 'essential',
          rationale: 'Enforces 4096 byte limit.',
          agentDirective: 'Assert output script size <= 4096 bytes.',
          enabled: true,
        },
      ],
      fullMarkdown: '# v2',
      editSummary: 'Added opening book',
      founderNotes: 'Track bytes closely',
    });
    assert.equal(v2.version.versionNumber, 2);
    assert.equal(v2.draft.latestVersionId, v2.version.id);
    assert.equal(v2.version.selectedSkills?.length, 2);

    const { draft, versions } = crud.getPromptDraftAndVersionsBySlug('tiny-chess-01');
    assert.equal(draft?.founderNotes, 'Track bytes closely');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].versionNumber, 2);
    assert.equal(versions[0].selectedSkills?.[1]?.name, 'hermes-byte-guard');
    assert.equal(versions[1].versionNumber, 1);
    assert.deepEqual(versions[1].selectedSkills, []);

    // Cascade delete bounty removes snapshots, analyses, drafts, versions
    assert.equal(crud.deleteBounty('tiny-chess-01'), true);
    assert.equal(crud.getLatestBountySnapshot('tiny-chess-01'), null);
    assert.equal(crud.listAIAnalysesByBounty('tiny-chess-01').length, 0);
    assert.equal(crud.getPromptDraftAndVersionsBySlug('tiny-chess-01').versions.length, 0);
  } finally {
    sqlite.close();
  }
});

test('Drizzle Submissions, Rewards, Evidence & Settings CRUD', () => {
  const { sqlite, crud } = setupIsolatedCrud();
  try {
    // Submissions CRUD
    const sub = crud.createSubmission({
      bountySlug: 'tiny-chess-01',
      hunterHandle: '@0xkeinara',
      entryTitle: 'Quiet Rook',
      commitSha: 'abc1234',
      repoUrl: 'https://github.com/0xkeinara/quiet-rook',
      status: 'submitted',
      rank: null,
      scoreDisplay: null,
      source: 'manual_verified',
    });
    assert.equal(crud.listSubmissions().length, 1);

    const updatedSub = crud.updateSubmission(sub.id, {
      status: 'judged',
      rank: 2103,
      scoreDisplay: '1550',
    });
    assert.equal(updatedSub?.status, 'judged');
    assert.equal(updatedSub?.rank, 2103);

    // Upsert from API should update existing ID cleanly
    const upsertedSub = crud.upsertSubmission({
      id: sub.id,
      bountySlug: 'tiny-chess-01',
      hunterHandle: '@0xkeinara',
      entryTitle: 'Quiet Rook',
      status: 'awarded',
      rank: 3,
      scoreDisplay: '2050',
      source: 'makefun_api',
    });
    assert.equal(upsertedSub.status, 'awarded');
    assert.equal(upsertedSub.rank, 3);
    assert.equal(crud.deleteSubmission(sub.id), true);
    assert.equal(crud.listSubmissions().length, 0);

    // Rewards CRUD
    const reward = crud.createReward({
      bountySlug: 'tiny-chess-01',
      announcedPrizeUsd: 250,
      verifiedAwardUsd: 100,
      receivedUsd: 0,
      claimStatus: 'awarded_unclaimed',
      notes: 'Pending claim',
    });
    const updatedReward = crud.updateReward(reward.id, {
      receivedUsd: 100,
      claimStatus: 'claimed_received',
      txSignature: '5xTxSig',
    });
    assert.equal(updatedReward?.claimStatus, 'claimed_received');
    const summary = crud.listRewardsWithTotals();
    assert.equal(summary.totals.actuallyReceivedUsd, 100);
    assert.equal(crud.deleteReward(reward.id), true);

    // Evidence CRUD
    const ev = crud.createEvidence({
      bountySlug: 'tiny-chess-01',
      sourceType: 'session_export',
      sourcePathOrName: 'hermes-run.jsonl',
      sessionId: 'sess-1',
      summary: 'Imported 10 lines',
      rawContent: '{"role":"assistant"}',
      metadata: { turnCount: 1, readOnlyVerified: true },
    });
    assert.equal(crud.findEvidenceBySourcePath('hermes-run.jsonl')?.id, ev.id);
    assert.equal(crud.deleteEvidence(ev.id), true);

    // Settings CRUD
    crud.setSettingValue('accountHandle', '@0xkeinara_test');
    assert.equal(crud.getSettingValue('accountHandle'), '@0xkeinara_test');
  } finally {
    sqlite.close();
  }
});
