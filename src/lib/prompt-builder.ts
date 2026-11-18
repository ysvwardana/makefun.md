import type {
  BountyRecord,
  RecommendedSkill,
  SkillPriority,
} from '../types/command-center.ts';

function slugifySkillId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'skill';
}

const PRIORITY_ORDER: Record<SkillPriority, number> = {
  essential: 0,
  recommended: 1,
  optional: 2,
};

export function extractOfficialBountySkills(bounty: BountyRecord): RecommendedSkill[] {
  const results: RecommendedSkill[] = [];
  const seen = new Set<string>();

  const mcpList = Array.isArray(bounty.prerequisites?.mcp) ? bounty.prerequisites!.mcp : [];
  for (const mcp of mcpList) {
    const cleanName = String(mcp.name || '').trim();
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: `mcp-${slugifySkillId(cleanName)}`,
      name: cleanName,
      category: 'MCP / Tooling',
      source: 'official_mcp',
      priority: mcp.required ? 'essential' : 'recommended',
      rationale: mcp.why || 'Official MCP prerequisite specified by competition requirements.',
      agentDirective:
        mcp.how_to_check
          ? `Activate and verify ${cleanName} MCP access (${mcp.how_to_check}) before implementing deliverables.`
          : `Use the official ${cleanName} MCP integration to execute and verify domain actions.`,
      enabled: true,
    });
  }

  for (const rawSkill of bounty.skills || []) {
    const cleanName = String(rawSkill || '').trim();
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: `official-${slugifySkillId(cleanName)}`,
      name: cleanName,
      category: bounty.category || 'Official Tag',
      source: 'official_bounty',
      priority: 'recommended',
      rationale: `Listed directly in official make.fun competition skills for "${bounty.title}".`,
      agentDirective: `Apply domain best practices and automated verification checks specific to ${cleanName}.`,
      enabled: true,
    });
  }

  return results;
}

export function mergeRecommendedSkills(params: {
  officialSkills: RecommendedSkill[];
  aiSkills?: RecommendedSkill[];
  customSkills?: RecommendedSkill[];
}): RecommendedSkill[] {
  const byKey = new Map<string, RecommendedSkill>();

  for (const s of params.officialSkills) {
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    byKey.set(key, { ...s });
  }

  for (const s of params.aiSkills || []) {
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        category: s.category || existing.category,
        priority:
          PRIORITY_ORDER[s.priority] < PRIORITY_ORDER[existing.priority]
            ? s.priority
            : existing.priority,
        rationale: s.rationale || existing.rationale,
        agentDirective: s.agentDirective || existing.agentDirective,
      });
    } else {
      byKey.set(key, { ...s });
    }
  }

  for (const s of params.customSkills || []) {
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    byKey.set(key, { ...s, source: 'founder_custom' });
  }

  return Array.from(byKey.values()).sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );
}

export function formatSkillsDirectiveSection(skills?: RecommendedSkill[]): string {
  const active = (skills || []).filter((s) => s.enabled !== false && s.name.trim().length > 0);
  if (active.length === 0) return '';

  const lines = [
    '### Agent Skill & Tooling Directives',
    '',
    'Activate and follow the curated skill stack below when planning, implementing, and verifying this bounty:',
    '',
  ];

  for (const skill of active) {
    const sourceTag =
      skill.source === 'official_mcp'
        ? 'Official MCP'
        : skill.source === 'official_bounty'
          ? 'Official Bounty Skill'
          : skill.source === 'founder_custom'
            ? 'Founder Custom'
            : 'AI Curated';
    lines.push(
      `- **${skill.name}** [${skill.priority.toUpperCase()} · ${skill.category} · ${sourceTag}]`,
      `  - Why: ${skill.rationale}`,
      `  - Directive: ${skill.agentDirective}`
    );
  }

  return lines.join('\n');
}

export function buildMasterMarkdown(params: {
  bountyTitle: string;
  bountySlug: string;
  bountyUrl: string;
  part1OriginalPrompt: string;
  part2AiEnhancement: string;
  part3ExecutionGuidelines: string;
  founderInstructions: string;
  selectedSkills?: RecommendedSkill[];
}): string {
  const sections = [
    `# COSMICLABS Master Prompt — ${params.bountyTitle} (${params.bountySlug})`,
    `Official Bounty URL: ${params.bountyUrl}`,
    `Notice: Official make.fun competition rules always take precedence over enhancement suggestions.`,
    '',
    '---',
    '',
    '## PART 1 — ORIGINAL MAKE.FUN PROMPT',
    '',
    params.part1OriginalPrompt.trim() || '(Official prompt not loaded)',
    '',
    '---',
    '',
    '## PART 2 — COSMICLABS AI ENHANCEMENT',
    '',
    params.part2AiEnhancement.trim() || '(Click "Enhance with AI" or author tailored instructions here)',
  ];

  const skillsBlock = formatSkillsDirectiveSection(params.selectedSkills);
  if (skillsBlock) {
    sections.push('', skillsBlock);
  }

  if (params.founderInstructions.trim()) {
    sections.push('', '### Founder Additional Instructions', '', params.founderInstructions.trim());
  }

  sections.push(
    '',
    '---',
    '',
    '## PART 3 — EXECUTION GUIDELINES',
    '',
    params.part3ExecutionGuidelines.trim() || '(Execution & compliance guidelines will appear here)'
  );

  return sections.join('\n');
}
