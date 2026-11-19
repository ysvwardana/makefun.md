import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandCenterCrud } from '../server/crud.ts';
import { createDatabaseConnection, initSqliteSchema } from '../server/db.ts';

function setup() {
  const { sqlite, orm } = createDatabaseConnection(':memory:');
  const crud = createCommandCenterCrud(orm);
  crud.upsertBounty({
    slug: 'storage-integrity', id: 'storage-1', title: 'Storage Integrity',
    url: 'https://make.fun/bounty/storage-integrity', category: 'Software', skills: [],
    rewardAmount: 100, potUsd: 100, entryFeeUsd: null, deadline: null, publishedAt: null,
    status: 'open', submissionCount: 0, sponsorName: null, sponsorVerified: false,
    summary: null, harnessKind: null, acceptingSubmissions: true, isDemo: false,
    syncState: 'LIVE', lastSyncedAt: '2026-11-19T00:00:00.000Z',
  });
  return { sqlite, crud };
}

function snapshotInput(prompt = 'Official exact prompt\r\nSecond line  ', contentHash = 'base-hash') {
  return {
    bountySlug: 'storage-integrity', sourceEndpoint: 'https://make.fun/api/competitions/storage-integrity',
    rawCompetition: { slug: 'storage-integrity', description: 'Rules' },
    rawRequirements: { competition: { slug: 'storage-integrity' }, checks: [{ check: 'gate-1' }] },
    rawLeaderboard: null, rawKit: null, officialPromptText: prompt,
    fetchedAt: '2026-11-19T00:00:00.000Z', contentHash,
    promptSource: { kind: 'official_api' as const, locator: 'https://make.fun/api/competitions/storage-integrity', capturedAt: '2026-11-19T00:00:00.000Z', bountySlug: 'storage-integrity' },
    refreshIssues: [], requirementsComplete: true, rulesHash: 'rules-hash-1',
  };
}

test('manual prompt override is append-only and preserves every prompt byte', () => {
  const { sqlite, crud } = setup();
  try {
    const first = crud.saveBountySnapshot(snapshotInput());
    const exact = '  Start with spaces\r\nKeep CRLF\r\nEnd with spaces  ';
    const manual = crud.upsertManualPromptOverride('storage-integrity', exact);
    assert.notEqual(manual.id, first.id);
    assert.equal(manual.manualPromptOverride, exact);
    assert.equal(manual.promptSource?.kind, 'manual');
    assert.equal(manual.promptSource?.locator, 'manual:user-paste');
    assert.equal(crud.getBountySnapshotById(first.id)?.fetchedAt, first.fetchedAt);
    assert.equal(crud.getBountySnapshotById(manual.id)?.manualPromptOverride, exact);
    assert.throws(() => crud.upsertManualPromptOverride('storage-integrity', ' \n\t '), (error: unknown) => (error as {statusCode?:number}).statusCode === 400);
  } finally { sqlite.close(); }
});

test('prompt version binds server Part 1 to same-bounty verified snapshot', () => {
  const { sqlite, crud } = setup();
  try {
    const snapshot = crud.saveBountySnapshot(snapshotInput('  official\r\nexact  '));
    const version = crud.createPromptVersionTransactional({
      bountySlug: 'storage-integrity', bountyTitle: 'spoof title', sourceSnapshotId: snapshot.id,
      part1OriginalPrompt: '  official\r\nexact  ', part2AiEnhancement: 'Improve implementation details.',
      part3ExecutionGuidelines: 'Run tests and validate outputs.', fullMarkdown: 'caller markdown is ignored',
    });
    assert.equal(version.version.part1OriginalPrompt, '  official\r\nexact  ');
    assert.equal(version.version.sourceSnapshotId, snapshot.id);
    assert.equal(version.version.provenanceStatus, 'verified');
    assert.ok(version.version.fullMarkdown.includes('  official\r\nexact  '));
    assert.notEqual(version.version.fullMarkdown, 'caller markdown is ignored');

    const other = crud.upsertBounty({
      slug: 'other-bounty', id: 'other-1', title: 'Other', url: 'https://make.fun/bounty/other-bounty', category: 'Software', skills: [],
      rewardAmount: 1, potUsd: 1, entryFeeUsd: null, deadline: null, publishedAt: null, status: 'open', submissionCount: 0,
      sponsorName: null, sponsorVerified: false, summary: null, harnessKind: null, acceptingSubmissions: true, isDemo: false,
      syncState: 'LIVE', lastSyncedAt: '2026-11-19T00:00:00.000Z',
    });
    assert.equal(other.slug, 'other-bounty');
    const foreignAnalysis = crud.createAIAnalysis({
      bountySlug: other.slug, provider: 'openai_compatible', model: 'test-model', stageStatus: 'complete',
      objectiveSummary: 'A deliberately minimal test summary.', mandatoryRequirements: [], judgingCriteria: [],
      recommendedApproach: 'A deliberately minimal test approach.', differentiationStrategy: 'A deliberately minimal differentiation.',
      architectureOrMethodology: 'A deliberately minimal architecture.', priorityMatrix: [], implementationGuidance: [],
      qualityStandards: [], testingValidation: [], complianceConsiderations: [], assumptionsUncertainties: [],
      risks: [], researchReferences: [], researchDisclosures: '', rawLlmResponse: '', tokenUsage: null,
    });
    assert.throws(() => crud.createPromptVersionTransactional({
      bountySlug: 'storage-integrity', bountyTitle: 'Storage Integrity', sourceSnapshotId: snapshot.id,
      analysisId: foreignAnalysis.id, part1OriginalPrompt: '  official\r\nexact  ',
      part2AiEnhancement: 'Enhancement.', part3ExecutionGuidelines: 'Guidelines.', fullMarkdown: '',
    }), (error: unknown) => (error as {statusCode?:number}).statusCode === 409);
    assert.throws(() => crud.createPromptVersionTransactional({
      bountySlug: 'other-bounty', bountyTitle: 'Other', sourceSnapshotId: snapshot.id,
      part1OriginalPrompt: '  official\r\nexact  ', part2AiEnhancement: 'Enhancement.',
      part3ExecutionGuidelines: 'Guidelines.', fullMarkdown: '',
    }), (error: unknown) => (error as {statusCode?:number}).statusCode === 409);
    assert.throws(() => crud.createPromptVersionTransactional({
      bountySlug: 'storage-integrity', bountyTitle: 'Storage Integrity', sourceSnapshotId: snapshot.id,
      part1OriginalPrompt: 'altered prompt', part2AiEnhancement: 'Enhancement.',
      part3ExecutionGuidelines: 'Guidelines.', fullMarkdown: '',
    }), (error: unknown) => (error as {statusCode?:number}).statusCode === 409);
  } finally { sqlite.close(); }
});

test('stale rules require a hash-bound confirmation that is checked transactionally', () => {
  const { sqlite, crud } = setup();
  try {
    const source = crud.saveBountySnapshot(snapshotInput('Exact prompt', 'source-content'));
    crud.saveBountySnapshot({
      ...snapshotInput('Exact prompt', 'new-content'),
      rawCompetition: { slug: 'storage-integrity', description: 'Updated rules', scoring: { metric: 'new' } },
      rulesHash: 'current-rules-hash',
      fetchedAt: '2026-11-20T00:00:00.000Z',
    });
    const baseInput = {
      bountySlug: 'storage-integrity', bountyTitle: 'Storage Integrity', sourceSnapshotId: source.id,
      part1OriginalPrompt: 'Exact prompt', part2AiEnhancement: 'Enhance implementation.',
      part3ExecutionGuidelines: 'Run complete tests.', fullMarkdown: 'ignored', allowStaleRules: true,
    };
    assert.throws(() => crud.createPromptVersionTransactional(baseInput),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    assert.throws(() => crud.createPromptVersionTransactional({ ...baseInput, expectedCurrentRulesHash: 'old-hash' }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    const accepted = crud.createPromptVersionTransactional({ ...baseInput, expectedCurrentRulesHash: 'current-rules-hash' });
    assert.equal(accepted.version.sourceSnapshotId, source.id);
    assert.equal(accepted.version.provenanceStatus, 'verified');

    const incomplete = crud.saveBountySnapshot({
      ...snapshotInput('Exact prompt', 'partial-content'),
      rawRequirements: null,
      requirementsComplete: false,
      rulesHash: '',
      fetchedAt: '2026-11-21T00:00:00.000Z',
    });
    const unknownRulesInput = { ...baseInput, expectedCurrentRulesHash: null as string | null,
      expectedCurrentSnapshotId: incomplete.id, expectedCurrentSnapshotHash: incomplete.contentHash };
    const acknowledged = crud.createPromptVersionTransactional(unknownRulesInput);
    assert.equal(acknowledged.version.sourceSnapshotId, source.id);
    const changed = crud.saveBountySnapshot({
      ...snapshotInput('Exact prompt', 'newer-partial-content'), rawRequirements: null,
      requirementsComplete: false, rulesHash: '', fetchedAt: '2026-11-22T00:00:00.000Z',
    });
    assert.throws(() => crud.createPromptVersionTransactional(unknownRulesInput),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    assert.notEqual(changed.id, incomplete.id);
  } finally { sqlite.close(); }
});

test('legacy database rows survive additive migration and stay unverified', () => {
  const { sqlite } = createDatabaseConnection(':memory:');
  try {
    sqlite.exec(`
      INSERT INTO bounties (slug,id,title,url,category,last_synced_at) VALUES ('legacy','legacy-1','Legacy','https://example.test','Other','2025-01-01');
      INSERT INTO prompt_drafts (id,bounty_slug,title,created_at,updated_at) VALUES ('draft-legacy','legacy','Legacy','2025-01-01','2025-01-01');
      INSERT INTO prompt_versions (id,draft_id,bounty_slug,version_number,part1_original_prompt,part2_ai_enhancement,part3_execution_guidelines,full_markdown,created_at) VALUES ('version-legacy','draft-legacy','legacy',1,'old prompt','old enhancement','old guidelines','old markdown','2025-01-01');
    `);
    // Reproduce an older schema, then run the real additive migration twice.
    sqlite.exec('ALTER TABLE prompt_versions DROP COLUMN provenance_status');
    sqlite.exec('ALTER TABLE prompt_versions DROP COLUMN source_snapshot_id');
    sqlite.exec('ALTER TABLE prompt_versions DROP COLUMN source_rules_hash');
    sqlite.exec('ALTER TABLE ai_analyses DROP COLUMN evidence_json');
    sqlite.exec('ALTER TABLE bounty_snapshots DROP COLUMN prompt_source_json');
    sqlite.exec('ALTER TABLE bounty_snapshots DROP COLUMN refresh_issues_json');
    sqlite.exec('ALTER TABLE bounty_snapshots DROP COLUMN requirements_complete');
    sqlite.exec('ALTER TABLE bounty_snapshots DROP COLUMN rules_hash');
    initSqliteSchema(sqlite);
    initSqliteSchema(sqlite);
    const cols = sqlite.prepare('PRAGMA table_info(prompt_versions)').all() as Array<{name:string}>;
    assert.ok(cols.some((column) => column.name === 'provenance_status'));
    const status = sqlite.prepare('SELECT provenance_status, source_snapshot_id, full_markdown FROM prompt_versions WHERE id = ?').get('version-legacy') as {provenance_status:string;source_snapshot_id:number|null;full_markdown:string};
    assert.equal(status.provenance_status, 'legacy_unverified');
    assert.equal(status.source_snapshot_id, null);
    assert.equal(status.full_markdown, 'old markdown');
  } finally { sqlite.close(); }
});
