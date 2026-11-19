import crypto from 'node:crypto';
import type { BountyRecord, BountySnapshot } from '../src/types/command-center.ts';
import type { GateCoverage, PromptSource } from '../src/types/enhancement.ts';

export class EnhancementContextError extends Error {
  constructor(message: string, public statusCode = 400, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'EnhancementContextError';
  }
}

export interface ActiveGate {
  gateId: string;
  requirementPointer: string;
  identified: boolean;
}

/** Stable object-key ordering, preserving array order and every string byte. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function referenceRepeatedText(value: unknown, path: string, firstOccurrences: Map<string, string>): unknown {
  if (typeof value === 'string' && value.length >= 128) {
    const first = firstOccurrences.get(value);
    if (first === undefined) firstOccurrences.set(value, path);
    else {
      const reference = { identicalTextAt: first };
      if (canonicalJson(reference).length < canonicalJson(value).length) return reference;
    }
  }
  if (Array.isArray(value)) return value.map((item, index) => referenceRepeatedText(item, `${path}[${index}]`, firstOccurrences));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key,
      referenceRepeatedText(record[key], `${path}[${JSON.stringify(key)}]`, firstOccurrences)]));
  }
  return value;
}

function activeGates(requirements: Record<string, unknown>): ActiveGate[] {
  if (!Array.isArray(requirements.checks)) return [];
  return requirements.checks.flatMap((check, index) => {
    const record = check && typeof check === 'object' ? check as Record<string, unknown> : {};
    if (record.applies === false) return [];
    const id = record.check ?? record.gateId ?? record.id;
    const identified = typeof id === 'string' && id.trim().length > 0;
    return [{ gateId: identified ? id : `unidentified-gate-${index + 1}`,
      requirementPointer: `rawRequirements.checks[${index}]`, identified }];
  });
}

function validateSnapshot(bounty: BountyRecord, snapshot: BountySnapshot | null) {
  if (!snapshot) throw new EnhancementContextError('A verified competition snapshot is required.');
  if (snapshot.bountySlug !== bounty.slug) throw new EnhancementContextError('Snapshot competition slug does not match the requested bounty.');
  const source = snapshot.promptSource;
  if (!source || !['official_api', 'manual'].includes(source.kind) || source.bountySlug !== bounty.slug ||
      !source.locator?.trim() || !source.capturedAt?.trim()) {
    throw new EnhancementContextError('Standard prompt provenance is missing or does not match the requested bounty.');
  }
  for (const raw of [snapshot.rawCompetition, snapshot.rawRequirements]) {
    if (!raw) continue;
    for (const field of ['slug', 'bountySlug', 'competitionSlug']) {
      if (typeof raw[field] === 'string' && raw[field] !== bounty.slug) {
        throw new EnhancementContextError('Official context competition slug does not match the requested bounty.');
      }
    }
  }
  const nestedCompetition = snapshot.rawRequirements?.competition;
  if (nestedCompetition && typeof nestedCompetition === 'object' &&
      typeof (nestedCompetition as Record<string, unknown>).slug === 'string' &&
      (nestedCompetition as Record<string, unknown>).slug !== bounty.slug) {
    throw new EnhancementContextError('Requirements competition slug does not match the requested bounty.');
  }
  // The recorded source, rather than the presence of a stale override, selects the effective prompt.
  const standardPrompt = source.kind === 'manual' ? snapshot.manualPromptOverride : snapshot.officialPromptText;
  if (typeof standardPrompt !== 'string' || !standardPrompt.trim()) {
    throw new EnhancementContextError('The exact standard competition prompt is missing or blank. Sync it or provide a verified manual prompt first.');
  }
  if (snapshot.requirementsComplete !== true || !snapshot.rawRequirements ||
      Object.keys(snapshot.rawRequirements).length === 0 || !snapshot.rulesHash?.trim()) {
    throw new EnhancementContextError('Complete official requirements and their rules hash are required, including when using a cached snapshot.', 400,
      { refreshIssues: snapshot.refreshIssues ?? [], usedCacheCannotBypassCompleteness: true });
  }
  if (!snapshot.contentHash?.trim() || !snapshot.fetchedAt?.trim()) {
    throw new EnhancementContextError('Snapshot hash and capture time are required.');
  }
  return { snapshot, standardPrompt, promptSource: source as PromptSource, rulesHash: snapshot.rulesHash };
}

export function buildEnhancementContext(input: {
  bounty: BountyRecord;
  snapshot: BountySnapshot | null;
  systemPrompt?: string;
  founderInstructions?: string;
  researchNotes?: string;
  leaderboardInsights?: unknown;
  maxContextChars?: number;
}) {
  const { snapshot, standardPrompt, promptSource, rulesHash } = validateSnapshot(input.bounty, input.snapshot);
  const gates = activeGates(snapshot.rawRequirements!);
  // Exclude only known activity/accounting collections. Unknown official fields stay
  // intact so a future mandatory rule field cannot silently disappear.
  const unrelatedCompetitionFields = new Set([
    'submissions', 'chat', 'messages', 'comments', 'activity', 'activityFeed',
    'payouts', 'escrow', 'transactions', 'paymentTransactions', 'rewardClaims',
  ]);
  const competition = snapshot.rawCompetition ?? {};
  const omittedCompetitionFields = Object.keys(competition).filter((key) => unrelatedCompetitionFields.has(key)).sort();
  const relevantCompetition = Object.fromEntries(Object.entries(competition)
    .filter(([key]) => !unrelatedCompetitionFields.has(key)));
  const leaderboardText = canonicalJson(snapshot.rawLeaderboard);
  const includeLeaderboard = leaderboardText.length <= 20000;
  const firstOccurrences = new Map<string, string>([[standardPrompt, 'exactStandardPrompt']]);
  const originalSectionLengths: Record<string, number> = {};
  const officialSection = (name: string, value: unknown) => {
    originalSectionLengths[name] = canonicalJson(value).length;
    return { name, text: canonicalJson(referenceRepeatedText(value, name, firstOccurrences)) };
  };
  const sections: Array<{ name: string; text: string }> = [
    officialSection('competitionMetadata', input.bounty),
    { name: 'promptSource', text: canonicalJson(promptSource) },
    { name: 'exactStandardPrompt', text: standardPrompt },
    officialSection('fullCompetitionRulesDescriptionAndRulesNote', relevantCompetition),
    { name: 'competitionFieldInclusionDisclosure', text: canonicalJson({
      includedFields: Object.keys(relevantCompetition).sort(),
      excludedUnrelatedActivityAccountingFields: omittedCompetitionFields,
      policy: 'All official fields are retained except these explicitly named activity/accounting collections. Rules, description, rulesNote, judging, scoring, evaluation, prerequisites, deadlines and submission requirements are never shortened.',
    }) },
    officialSection('allRawRequirementsDeliverablesChecksJudgingAndHowToSubmit', snapshot.rawRequirements),
    officialSection('fullOfficialKit', snapshot.rawKit),
    includeLeaderboard
      ? { name: 'fullOfficialLeaderboard', text: leaderboardText }
      : { name: 'leaderboard_not_included_optional_bulk_exceeds_20000_chars', text: canonicalJson({
          omitted: 'rawLeaderboard', sourceChars: leaderboardText.length,
          reason: 'Optional leaderboard collection exceeds its independent context allowance. No raw entries are included; any separately supplied derived insights are a disclosed summary only, not the full leaderboard.',
        }) },
    { name: 'allActiveGates', text: canonicalJson(gates) },
  ];
  if (sections.some(({ name, text }) => (originalSectionLengths[name] ?? 0) > text.length)) {
    sections.unshift({ name: 'exactTextReferences', text: 'In the official JSON sections, an identicalTextAt reference replaces an exact duplicate string. Read the full string at the named section and bracket path as the value at every reference.' });
  }
  if (input.leaderboardInsights != null) sections.push({ name: 'derivedLeaderboardInsights_summary_not_full_leaderboard', text: canonicalJson(input.leaderboardInsights) });
  if (input.researchNotes) sections.push({ name: 'optionalExternalResearch_NOT_AUTHORITATIVE', text: input.researchNotes });
  if (input.founderInstructions) sections.push({ name: 'founderInstructions', text: input.founderInstructions });
  const systemPrompt = input.systemPrompt ?? 'Analyze this competition using its exact standard prompt and complete official requirements. External research is not authoritative.';
  const userPrompt = sections.map((section) => `=== ${section.name} ===\n${section.text}`).join('\n\n');
  const envLimit = process.env.LLM_MAX_CONTEXT_CHARS;
  const maxContextChars = input.maxContextChars ?? (envLimit === undefined || envLimit === '' ? 400_000 : Number(envLimit));
  if (!Number.isSafeInteger(maxContextChars) || maxContextChars < 1) {
    throw new EnhancementContextError('LLM_MAX_CONTEXT_CHARS must be a positive safe integer.');
  }
  const totalChars = systemPrompt.length + userPrompt.length;
  const sectionLengths = Object.fromEntries(sections.map((section) => [section.name, section.text.length]));
  if (totalChars > maxContextChars) {
    throw new EnhancementContextError('Complete enhancement context exceeds the configured limit. No required context was truncated or sent.', 413, {
      maxContextChars, totalChars, sectionLengths: { systemPrompt: systemPrompt.length, ...sectionLengths },
      uncoveredGates: gates.map((gate) => ({ gateId: gate.gateId, status: 'uncovered', reason: 'Context was rejected before provider invocation.' })),
    });
  }
  // Hash exactly the two message strings passed to the provider, not a source subset or a reconstructed prompt.
  const contextHash = crypto.createHash('sha256').update(canonicalJson({ systemPrompt, userPrompt })).digest('hex');
  return { snapshot, standardPrompt, promptSource, rulesHash, systemPrompt, userPrompt, contextHash, gates,
    contextSections: sections.map((section) => section.name), sectionLengths, originalSectionLengths, totalChars };
}

/** Missing, duplicate, unknown or incomplete model claims can never hide a required gate. */
export function reconcileGateCoverage(gates: readonly ActiveGate[], modelCoverage?: unknown): GateCoverage[] {
  const rows = Array.isArray(modelCoverage) ? modelCoverage : [];
  const knownIds = new Set(gates.map((gate) => gate.gateId));
  const officialIdCounts = new Map<string, number>();
  for (const gate of gates) officialIdCounts.set(gate.gateId, (officialIdCounts.get(gate.gateId) ?? 0) + 1);
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const result: GateCoverage[] = gates.map((gate) => {
    const matches = rows.filter((row) => row && typeof row === 'object' && row.gateId === gate.gateId);
    const row = matches.length === 1 ? matches[0] : undefined;
    const verification = text(row?.verification);
    const evidence = text(row?.evidence);
    let reason = text(row?.reason);
    let covered = row?.status === 'covered' && Boolean(verification.trim()) && Boolean(evidence.trim());
    if (!gate.identified) { covered = false; reason = 'Official check has no usable exact gate ID; resolve its identity before submission.'; }
    else if ((officialIdCounts.get(gate.gateId) ?? 0) > 1) {
      covered = false;
      reason = 'Ambiguous official gate ID: multiple active official checks use this exact ID; resolve their identities before submission.';
    }
    else if (matches.length === 0) reason = 'The model did not supply coverage for this active gate.';
    else if (matches.length > 1) { covered = false; reason = 'The model supplied duplicate coverage for this exact gate ID.'; }
    else if (!covered) reason = reason || 'The model did not provide both a verification procedure and deliverable evidence for this gate.';
    return { gateId: gate.gateId, status: covered ? 'covered' : 'uncovered', verification, evidence,
      reason: reason || 'Proposed coverage only; execution and submission compliance remain unverified.' };
  });
  for (const row of rows) {
    if (!row || typeof row !== 'object' || knownIds.has(row.gateId)) continue;
    result.push({ gateId: text(row.gateId) || '(missing model gate ID)', status: 'uncovered',
      verification: text(row.verification), evidence: text(row.evidence), reason: 'Unknown model gate ID; it does not satisfy any active official gate.' });
  }
  return result;
}

export function renderGateChecklist(coverage: readonly GateCoverage[]): string {
  return ['## Deterministic official gate checklist',
    'Coverage describes proposed verification and evidence, not an executed check or a compliance pass. Every active official gate is listed; unresolved items must be addressed before submission.',
    ...(coverage.length ? coverage.map((gate) => [
      `### Gate ${JSON.stringify(gate.gateId)} — ${gate.status}`,
      `- Verification: ${gate.verification || 'Unspecified — requires an explicit verification procedure.'}`,
      `- Deliverable evidence: ${gate.evidence || 'Unspecified — requires submission evidence.'}`,
      `- Uncertainty: ${gate.reason}`,
    ].join('\n')) : ['No active check manifest entries were supplied; this does not establish that submission has no gates. Review all official requirements and submission instructions.']),
  ].join('\n\n');
}
