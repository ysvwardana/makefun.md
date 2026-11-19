import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLineDiff, formatUsd } from '../src/lib/utils.ts';
import {
  buildMasterMarkdown,
  extractOfficialBountySkills,
  mergeRecommendedSkills,
} from '../src/lib/prompt-builder.ts';
import { extractLeaderboardInsights, extractOfficialPromptText } from '../server/makefun.ts';
import { evaluateTranscriptGates } from '../server/transcript-gate.ts';
import type { BountyRecord, RecommendedSkill } from '../src/types/command-center.ts';

test('formatUsd formats integers and decimals consistently', () => {
  assert.equal(formatUsd(250), '$250');
  assert.equal(formatUsd(1325.5), '$1,325.50');
  assert.equal(formatUsd(null), '$0.00');
});

test('computeLineDiff identifies additions and removals across prompt versions', () => {
  const diff = computeLineDiff('line A\nline B', 'line A\nline B modified\nline C');
  assert.ok(diff.some((d) => d.type === 'unchanged' && d.text === 'line A'));
  assert.ok(diff.some((d) => d.type === 'removed' && d.text === 'line B'));
  assert.ok(diff.some((d) => d.type === 'added' && d.text === 'line B modified'));
  assert.ok(diff.some((d) => d.type === 'added' && d.text === 'line C'));
});

test('buildMasterMarkdown preserves Part 1 verbatim and separates all 3 parts', () => {
  const part1 = '  \r\nEXACT OFFICIAL TEXT — DO NOT ALTER 4096 BYTES.\r\n\n  ';
  const md = buildMasterMarkdown({
    bountyTitle: 'Tiny Chess',
    bountySlug: 'tiny-chess-01',
    bountyUrl: 'https://make.fun/bounty/tiny-chess-01',
    part1OriginalPrompt: part1,
    part2AiEnhancement: 'Use bitboard + negamax.',
    part3ExecutionGuidelines: 'Verify deterministic 6-trial test.',
    founderInstructions: 'Target Python 3.13.',
  });
  assert.ok(md.includes('## PART 1 — ORIGINAL MAKE.FUN PROMPT'));
  assert.ok(md.includes(part1));
  assert.ok(md.includes('## PART 2 — COSMICLABS AI ENHANCEMENT'));
  assert.ok(md.includes('## PART 3 — EXECUTION GUIDELINES'));
  assert.ok(md.includes('Target Python 3.13.'));
});

test('extractOfficialPromptText refuses to invent a standard prompt from research context', () => {
  const text = extractOfficialPromptText(
    {
      title: 'Test Bounty',
      summary: 'Short summary',
      description: 'Detailed prompt text',
      rules: 'Must be MIT licensed',
    },
    {
      deliverables: [
        { name: 'repo_url', kind: 'form_field', required: true, description: 'GitHub URL' },
      ],
    }
  );
  assert.equal(text, '');
  assert.equal(extractOfficialPromptText({ prompt: ' \r\nEXACT\t\n ' }, null), ' \r\nEXACT\t\n ');
});

test('extractLeaderboardInsights computes #1, house baseline, and @0xkeinara gap', () => {
  const insights = extractLeaderboardInsights(
    {
      rank_key: 'elo',
      columns: [{ key: 'elo', title: 'Elo' }],
      entries: [
        { rank: 1, handle: 'leader-dev', title: 'Alpha Engine', display: { elo: '2110' }, baseline: false },
        { rank: 2103, handle: '0xkeinara', title: 'Quiet Rook', display: { elo: '1550' }, baseline: false },
        { rank: 10576, handle: 'house', title: 'sunfish-4k', display: { elo: '0' }, baseline: true },
      ],
    },
    null,
    '@0xkeinara'
  );
  assert.ok(insights);
  assert.equal(insights.topEntries[0].primaryMetricValue, '2110');
  assert.equal(insights.houseBaseline?.title, 'sunfish-4k');
  assert.equal(insights.accountEntry?.rank, 2103);
  assert.ok(insights.gapSummary.includes('gap to #1: 560 Elo'));
});

test('evaluateTranscriptGates flags minimal log and passes full multi-turn JSONL transcript', () => {
  const minimalReport = evaluateTranscriptGates({
    rawContent: 'plain text log without timestamps',
    bountySlug: null,
  });
  assert.equal(minimalReport.overallReady, false);
  assert.equal(minimalReport.checks.find((c) => c.gateId === 'thinking_turns')?.status, 'fail');

  const lines = [
    JSON.stringify({ role: 'user', timestamp: '2026-11-10T10:00:00Z', content: 'Build tiny chess makefun anchor abc1234 round 1' }),
    JSON.stringify({ role: 'assistant', timestamp: '2026-11-10T10:01:00Z', model: 'gemini-3.1-flash-lite', usage: { total_tokens: 120 }, content: [{ type: 'text', text: 'Turn 1 plan' }, { type: 'tool_use', name: 'write_to_file' }] }),
    JSON.stringify({ role: 'assistant', timestamp: '2026-11-10T10:02:00Z', model: 'gemini-3.1-flash-lite', content: [{ type: 'text', text: 'Turn 2 bitboard' }, { type: 'tool_use', name: 'replace_file_content' }] }),
    JSON.stringify({ role: 'assistant', timestamp: '2026-11-10T10:03:00Z', model: 'gemini-3.1-flash-lite', content: 'Turn 3 search' }),
    JSON.stringify({ role: 'assistant', timestamp: '2026-11-10T10:04:00Z', model: 'gemini-3.1-flash-lite', content: 'Turn 4 eval' }),
    JSON.stringify({ role: 'assistant', timestamp: '2026-11-10T10:05:00Z', model: 'gemini-3.1-flash-lite', content: 'Turn 5 verify' }),
  ].join('\n');

  const passingReport = evaluateTranscriptGates({
    rawContent: lines,
    bountySlug: 'tiny-chess-01',
    competitionPublishedAt: '2026-11-01T00:00:00Z',
    competitionDeadline: '2026-12-01T00:00:00Z',
  });
  assert.equal(passingReport.overallReady, true);
  assert.equal(passingReport.assistantTextTurns, 5);
  assert.equal(passingReport.toolEditTurns, 2);
  assert.equal(passingReport.anchorDetected, true);
  assert.equal(passingReport.checks.find((c) => c.gateId === 'thinking_in_window')?.status, 'pass');
});

test('extractOfficialBountySkills & mergeRecommendedSkills deduplicate and order by priority', () => {
  const bounty: BountyRecord = {
    slug: 'tiny-chess-01',
    id: 'tc-1',
    title: 'Tiny Chess',
    url: 'https://make.fun/bounty/tiny-chess-01',
    category: 'Algorithms',
    skills: ['Python', 'Chess Search'],
    rewardAmount: 250,
    potUsd: 250,
    entryFeeUsd: null,
    deadline: null,
    publishedAt: null,
    status: 'open',
    submissionCount: 5,
    sponsorName: null,
    sponsorVerified: false,
    summary: null,
    harnessKind: 'elo',
    acceptingSubmissions: true,
    isDemo: false,
    syncState: 'LIVE',
    lastSyncedAt: '2026-11-18T00:00:00Z',
    watchlisted: false,
    founderNotes: '',
    prerequisites: {
      mcp: [{ name: 'playwright-mcp', required: true, why: 'Browser verification' }],
    },
  };

  const official = extractOfficialBountySkills(bounty);
  assert.equal(official.length, 3);
  assert.equal(official[0].source, 'official_mcp');
  assert.equal(official[0].priority, 'essential');

  const aiSkills: RecommendedSkill[] = [
    {
      id: 'ai-python',
      name: 'Python',
      category: 'Bytecode & Packing',
      source: 'ai_curated',
      priority: 'essential',
      rationale: 'Upgrade official tag with zlib packing directive.',
      agentDirective: 'Use zlib -9 self-extracting stub and verify wc -c <= 4096.',
      enabled: true,
    },
    {
      id: 'ai-pesto',
      name: 'PeSTO Tapered Eval',
      category: 'Game Search',
      source: 'ai_curated',
      priority: 'recommended',
      rationale: 'Strong compact chess evaluation.',
      agentDirective: 'Encode 6 piece tables compactly with tapered phase interpolation.',
      enabled: true,
    },
  ];

  const customSkills: RecommendedSkill[] = [
    {
      id: 'custom-1',
      name: 'hermes-6-trial-verifier',
      category: 'Verification',
      source: 'founder_custom',
      priority: 'essential',
      rationale: 'Founder determinism gate.',
      agentDirective: 'Run 6 deterministic self-play trials before finalizing.',
      enabled: true,
    },
  ];

  const merged = mergeRecommendedSkills({ officialSkills: official, aiSkills, customSkills });
  assert.equal(merged.length, 5);
  const pythonEntry = merged.find((s) => s.name === 'Python');
  assert.equal(pythonEntry?.priority, 'essential');
  assert.ok(pythonEntry?.agentDirective.includes('zlib -9'));
  assert.equal(merged[0].priority, 'essential');
});

test('buildMasterMarkdown injects only enabled skills into Agent Skill & Tooling Directives', () => {
  const md = buildMasterMarkdown({
    bountyTitle: 'Tiny Chess',
    bountySlug: 'tiny-chess-01',
    bountyUrl: 'https://make.fun/bounty/tiny-chess-01',
    part1OriginalPrompt: 'Official 4KB prompt.',
    part2AiEnhancement: 'Use negamax + PVS.',
    part3ExecutionGuidelines: 'Stay under 4096 bytes.',
    founderInstructions: '',
    selectedSkills: [
      {
        id: 'sk-1',
        name: 'zlib-self-extractor',
        category: 'Compression',
        source: 'ai_curated',
        priority: 'essential',
        rationale: 'Fits stronger search in 4KB.',
        agentDirective: 'Compress source with zlib.compress level 9.',
        enabled: true,
      },
      {
        id: 'sk-2',
        name: 'disabled-optional-tool',
        category: 'Misc',
        source: 'founder_custom',
        priority: 'optional',
        rationale: 'Unchecked by Founder.',
        agentDirective: 'Should not appear in markdown.',
        enabled: false,
      },
    ],
  });

  assert.ok(md.includes('### Agent Skill & Tooling Directives'));
  assert.ok(md.includes('`skills_list()`'));
  assert.ok(md.includes('`skill_view(name)`'));
  assert.ok(md.includes('zlib-self-extractor'));
  assert.ok(md.includes('Compress source with zlib.compress level 9.'));
  assert.ok(!md.includes('disabled-optional-tool'));
});
