import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { BountyRecord, BountySnapshot } from '../src/types/command-center.ts';
import { buildEnhancementContext, canonicalJson, EnhancementContextError, reconcileGateCoverage, renderGateChecklist } from '../server/enhancement-context.ts';

function fixtures() {
  const bounty = { slug: 'exact-bounty', title: 'Exact competition', category: 'coding', skills: [],
    url: 'https://make.fun/competitions/exact-bounty' } as unknown as BountyRecord;
  const snapshot: BountySnapshot = {
    id: 12, bountySlug: bounty.slug, sourceEndpoint: 'https://make.fun/api/competitions/exact-bounty',
    rawCompetition: { slug: bounty.slug, rules: 'Full rules', description: 'Full description', rulesNote: 'Full rules note' },
    rawRequirements: { checks: [{ check: 'gate-a', applies: true, description: 'Verify a' }],
      deliverables: ['Complete artifact'], judging: { criterion: 'Measured performance' }, how_to_submit: 'Exact submission instructions' },
    rawKit: { files: [{ path: 'kit/readme.md', content: 'Entire kit content' }] },
    rawLeaderboard: { entries: [{ rank: 1, title: 'Full entry', details: 'Observed details' }] },
    officialPromptText: ' \nExact official standard prompt.\t\n', manualPromptOverride: 'Stale manual override',
    promptSource: { kind: 'official_api', locator: 'https://make.fun/api/competitions/exact-bounty',
      capturedAt: '2026-11-19T00:00:00Z', bountySlug: bounty.slug },
    requirementsComplete: true, refreshIssues: [], rulesHash: 'rules-sha256',
    fetchedAt: '2026-11-19T00:00:00Z', contentHash: 'snapshot-sha256',
  };
  return { bounty, snapshot };
}

test('preserves exact sourced prompt whitespace and does not choose stale overrides', () => {
  const input = fixtures();
  const built = buildEnhancementContext(input);
  assert.equal(built.standardPrompt, input.snapshot.officialPromptText);
  assert.ok(built.userPrompt.includes(input.snapshot.officialPromptText));
  assert.ok(!built.userPrompt.includes('Stale manual override'));
  input.snapshot.promptSource!.kind = 'manual';
  input.snapshot.manualPromptOverride = '\n\t Manual exact prompt \n ';
  assert.equal(buildEnhancementContext(input).standardPrompt, input.snapshot.manualPromptOverride);
});

test('rejects missing and whitespace-only effective prompts without constructing a fallback', () => {
  for (const prompt of ['', ' \t\n']) {
    const input = fixtures();
    input.snapshot.officialPromptText = prompt;
    assert.throws(() => buildEnhancementContext(input), /missing or blank/);
  }
  const manual = fixtures();
  manual.snapshot.promptSource!.kind = 'manual';
  manual.snapshot.manualPromptOverride = null;
  assert.throws(() => buildEnhancementContext(manual), /missing or blank/);
  assert.throws(() => buildEnhancementContext({ ...fixtures(), snapshot: null }), /snapshot is required/);
});

test('rejects incomplete requirements, missing provenance and mismatched context slugs', () => {
  const incomplete = fixtures();
  incomplete.snapshot.requirementsComplete = false;
  assert.throws(() => buildEnhancementContext(incomplete), /including when using a cached snapshot/);
  const empty = fixtures();
  empty.snapshot.rawRequirements = {};
  assert.throws(() => buildEnhancementContext(empty), /Complete official requirements/);
  const noSource = fixtures();
  noSource.snapshot.promptSource = null;
  assert.throws(() => buildEnhancementContext(noSource), /provenance/);
  const source = fixtures();
  source.snapshot.promptSource!.bountySlug = 'different';
  assert.throws(() => buildEnhancementContext(source), /provenance/);
  const snapshot = fixtures();
  snapshot.snapshot.bountySlug = 'different';
  assert.throws(() => buildEnhancementContext(snapshot), /slug/);
  const raw = fixtures();
  raw.snapshot.rawRequirements!.slug = 'different';
  assert.throws(() => buildEnhancementContext(raw), /slug/);
});

test('includes complete long prompt, all checks, deliverables, judging, submission, kit and leaderboard', () => {
  const input = fixtures();
  input.snapshot.officialPromptText = 'p'.repeat(15000) + 'PROMPT-END';
  input.snapshot.rawRequirements!.checks = Array.from({ length: 35 }, (_, i) => ({ check: `gate-${i}`, description: 'd'.repeat(300) + `CHECK-END-${i}` }));
  input.snapshot.rawRequirements!.deliverables = Array.from({ length: 30 }, (_, i) => `DELIVERABLE-${i}`);
  input.snapshot.rawRequirements!.judging = { long: 'j'.repeat(5000) + 'JUDGING-END' };
  input.snapshot.rawRequirements!.how_to_submit = 's'.repeat(5000) + 'SUBMIT-END';
  input.snapshot.rawKit = { files: Array.from({ length: 40 }, (_, i) => ({ path: `FILE-${i}`, content: `KIT-CONTENT-${i}` })) };
  input.snapshot.rawLeaderboard = { entries: Array.from({ length: 30 }, (_, i) => ({ name: `LEADER-${i}`, evidence: `LEADER-EVIDENCE-${i}` })) };
  const built = buildEnhancementContext(input);
  for (const marker of ['PROMPT-END', 'CHECK-END-34', 'DELIVERABLE-29', 'JUDGING-END', 'SUBMIT-END', 'KIT-CONTENT-39', 'LEADER-EVIDENCE-29', 'Full rules note', 'Full description']) {
    assert.ok(built.userPrompt.includes(marker), `Missing complete context marker ${marker}`);
  }
  assert.equal(built.gates.length, 35);
  assert.equal(built.userPrompt.split('CHECK-END-34').length - 1, 1, 'Full check text must appear once, without gate-index duplication');
  assert.equal(built.gates[34].requirementPointer, 'rawRequirements.checks[34]');
  assert.ok(built.userPrompt.includes('rawRequirements.checks[34]'));
});

test('replaces only exact duplicate text with a reference and reports original and sent sizes', () => {
  const input = fixtures();
  const rules = 'Distinct rule text '.repeat(20);
  input.snapshot.rawCompetition!.rules = rules;
  input.snapshot.rawRequirements!.rules = rules;
  input.snapshot.rawKit = { rules: rules + ' ' };
  const built = buildEnhancementContext(input);
  const section = 'allRawRequirementsDeliverablesChecksJudgingAndHowToSubmit';
  assert.ok(built.sectionLengths[section] < built.originalSectionLengths[section]);
  assert.ok(built.userPrompt.includes('identicalTextAt'));
  assert.ok(built.userPrompt.includes(JSON.stringify(rules)));
  assert.ok(built.userPrompt.includes(JSON.stringify(rules + ' ')));
  assert.equal(built.standardPrompt, input.snapshot.officialPromptText);
  assert.equal(built.gates.length, 1);
});

test('overflow rejects with 413 and complete section lengths and every uncovered gate', () => {
  const input = fixtures();
  input.snapshot.rawRequirements!.checks = Array.from({ length: 28 }, (_, i) => ({ check: `gate-${i}` }));
  assert.throws(() => buildEnhancementContext({ ...input, maxContextChars: 100 }), (error: unknown) => {
    assert.ok(error instanceof EnhancementContextError);
    assert.equal(error.statusCode, 413);
    assert.ok(Number(error.details?.totalChars) > 100);
    assert.equal((error.details?.uncoveredGates as unknown[]).length, 28);
    assert.equal((error.details?.sectionLengths as Record<string, number>).exactStandardPrompt, input.snapshot.officialPromptText.length);
    return true;
  });
});

test('default budget accepts a bounty above the previous 200,000 character ceiling', (t) => {
  const previous = process.env.LLM_MAX_CONTEXT_CHARS;
  delete process.env.LLM_MAX_CONTEXT_CHARS;
  t.after(() => {
    if (previous !== undefined) process.env.LLM_MAX_CONTEXT_CHARS = previous;
  });
  const input = fixtures();
  input.snapshot.rawCompetition!.rules = 'r'.repeat(218_988) + 'RULE-END';
  const built = buildEnhancementContext(input);
  assert.ok(built.totalChars > 218_988);
  assert.ok(built.userPrompt.includes('RULE-END'));
  assert.equal(built.gates.length, 1);
});

test('context limit counts both exact provider strings and permits the exact boundary', () => {
  const input = fixtures();
  const built = buildEnhancementContext({ ...input, systemPrompt: 'EXACT SYSTEM\n ' });
  assert.equal(built.totalChars, built.systemPrompt.length + built.userPrompt.length);
  assert.doesNotThrow(() => buildEnhancementContext({ ...input, systemPrompt: built.systemPrompt, maxContextChars: built.totalChars }));
  assert.throws(() => buildEnhancementContext({ ...input, systemPrompt: built.systemPrompt, maxContextChars: built.totalChars - 1 }), { statusCode: 413 });
});

test('hash deterministically commits the exact system and user strings actually sent', () => {
  const input = fixtures();
  const first = buildEnhancementContext({ ...input, systemPrompt: 'system\n', researchNotes: 'Background only' });
  assert.equal(first.contextHash, crypto.createHash('sha256').update(canonicalJson({ systemPrompt: first.systemPrompt, userPrompt: first.userPrompt })).digest('hex'));
  const reordered = fixtures();
  reordered.snapshot.rawCompetition = { rulesNote: 'Full rules note', description: 'Full description', rules: 'Full rules', slug: input.bounty.slug };
  assert.equal(first.contextHash, buildEnhancementContext({ ...reordered, systemPrompt: 'system\n', researchNotes: 'Background only' }).contextHash);
  assert.notEqual(first.contextHash, buildEnhancementContext({ ...input, systemPrompt: 'system', researchNotes: 'Background only' }).contextHash);
  input.snapshot.officialPromptText += ' ';
  assert.notEqual(first.contextHash, buildEnhancementContext({ ...input, systemPrompt: 'system\n', researchNotes: 'Background only' }).contextHash);
  assert.ok(first.userPrompt.includes('optionalExternalResearch_NOT_AUTHORITATIVE'));
});

test('missing model coverage preserves every active gate and marks it uncovered', () => {
  const input = fixtures();
  input.snapshot.rawRequirements!.checks = [{ check: 'gate-a' }, { check: 'gate-b', applies: true }, { check: 'inactive', applies: false }];
  const gates = buildEnhancementContext(input).gates;
  const coverage = reconcileGateCoverage(gates);
  assert.deepEqual(coverage.map((gate) => gate.gateId), ['gate-a', 'gate-b']);
  assert.ok(coverage.every((gate) => gate.status === 'uncovered' && gate.reason.includes('did not supply')));
  const checklist = renderGateChecklist(coverage);
  for (const gate of coverage) assert.ok(checklist.includes(JSON.stringify(gate.gateId)));
  assert.match(checklist, /not an executed check/);
});

test('duplicate official gate IDs remain individually present and uncovered despite a covered model claim', () => {
  const input = fixtures();
  input.snapshot.rawRequirements!.checks = [
    { check: 'duplicated', description: 'First official requirement' },
    { check: 'duplicated', description: 'Second official requirement' },
    { check: 'unique', description: 'Unique official requirement' },
  ];
  const gates = buildEnhancementContext(input).gates;
  const coverage = reconcileGateCoverage(gates, ['duplicated', 'unique'].map((gateId) => ({
    gateId, status: 'covered', verification: 'Run verifier', evidence: 'report.json',
  })));
  assert.equal(coverage.length, 3);
  for (const row of coverage.slice(0, 2)) {
    assert.equal(row.status, 'uncovered');
    assert.match(row.reason, /Ambiguous official gate ID/);
  }
  assert.equal(coverage[2].status, 'covered');
  const absent = reconcileGateCoverage(gates);
  assert.match(absent[0].reason, /Ambiguous official gate ID/);
  assert.match(absent[1].reason, /Ambiguous official gate ID/);
});

test('only exact, unique gate IDs with verification and evidence can claim proposed coverage', () => {
  const gates = buildEnhancementContext(fixtures()).gates;
  const missingEvidence = reconcileGateCoverage(gates, [{ gateId: 'gate-a', status: 'covered', verification: 'Run verifier', evidence: '' }]);
  assert.equal(missingEvidence[0].status, 'uncovered');
  const unknown = reconcileGateCoverage(gates, [{ gateId: 'GATE-A', status: 'covered', verification: 'Run verifier', evidence: 'report.json' }]);
  assert.equal(unknown[0].status, 'uncovered');
  assert.equal(unknown[1].status, 'uncovered');
  assert.match(unknown[1].reason, /Unknown model gate ID/);
  const row = { gateId: 'gate-a', status: 'covered', verification: 'Run verifier', evidence: 'report.json' };
  assert.equal(reconcileGateCoverage(gates, [row, row])[0].status, 'uncovered');
  assert.equal(reconcileGateCoverage(gates, [row])[0].status, 'covered');
  assert.match(reconcileGateCoverage(gates, [row])[0].reason, /remain unverified/);
});

test('omits only explicitly disclosed unrelated activity while retaining all rule fields', () => {
  const input = fixtures();
  Object.assign(input.snapshot.rawCompetition!, {
    submissions: [{ content: 'UNRELATED-SUBMISSION'.repeat(20000) }],
    chat: ['UNRELATED-CHAT'.repeat(20000)], payouts: ['UNRELATED-PAYOUT'], escrow: { balance: 100 },
    scoring: { full: 'SCORING-TAIL' }, evaluation: { required: 'EVALUATION-TAIL' },
    prerequisites: { required: 'PREREQUISITE-TAIL' }, deadlines: ['DEADLINE-TAIL'],
    unknownFutureRule: 'FUTURE-MANDATORY-RULE-TAIL',
  });
  const built = buildEnhancementContext(input);
  for (const marker of ['SCORING-TAIL', 'EVALUATION-TAIL', 'PREREQUISITE-TAIL', 'DEADLINE-TAIL', 'FUTURE-MANDATORY-RULE-TAIL', 'Full rules note']) assert.ok(built.userPrompt.includes(marker));
  assert.ok(!built.userPrompt.includes('UNRELATED-SUBMISSION'));
  assert.ok(!built.userPrompt.includes('UNRELATED-CHAT'));
  assert.ok(!built.userPrompt.includes('UNRELATED-PAYOUT'));
  assert.ok(built.contextSections.includes('competitionFieldInclusionDisclosure'));
  assert.match(built.userPrompt, /excludedUnrelatedActivityAccountingFields/);
  for (const key of ['submissions', 'chat', 'payouts', 'escrow']) assert.ok(built.userPrompt.includes(JSON.stringify(key)));
});

test('discloses optional oversized leaderboard omission and retains complete required context', () => {
  const input = fixtures();
  input.snapshot.rawLeaderboard = { entries: [{ title: 'OPTIONAL-LEADERBOARD'.repeat(20000) }] };
  const built = buildEnhancementContext({ ...input, leaderboardInsights: { gapSummary: 'DISCLOSED-SUMMARY' } });
  assert.ok(built.contextSections.includes('leaderboard_not_included_optional_bulk_exceeds_20000_chars'));
  assert.ok(built.contextSections.includes('derivedLeaderboardInsights_summary_not_full_leaderboard'));
  assert.ok(!built.userPrompt.includes('OPTIONAL-LEADERBOARD'));
  assert.ok(built.userPrompt.includes('DISCLOSED-SUMMARY'));
  assert.ok(built.userPrompt.includes('Exact submission instructions'));
  assert.ok(built.userPrompt.includes('Entire kit content'));
});

test('rejects nested requirements competition slug mismatch', () => {
  const input = fixtures();
  input.snapshot.rawRequirements!.competition = { slug: 'other-bounty' };
  assert.throws(() => buildEnhancementContext(input), /Requirements competition slug/);
});

test('unidentified checks are retained as uncovered rather than silently omitted', () => {
  const input = fixtures();
  input.snapshot.rawRequirements!.checks = [{ title: 'Missing ID' }, null, { check: 'known' }];
  const gates = buildEnhancementContext(input).gates;
  const coverage = reconcileGateCoverage(gates, gates.map((gate) => ({ gateId: gate.gateId, status: 'covered', verification: 'Run', evidence: 'report.json' })));
  assert.equal(coverage.length, 3);
  assert.equal(coverage[0].status, 'uncovered');
  assert.equal(coverage[1].status, 'uncovered');
  assert.equal(coverage[2].status, 'covered');
});
