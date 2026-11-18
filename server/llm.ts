import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import { crud } from './crud.ts';
import { AVAILABLE_MODELS } from './db.ts';
import { extractLeaderboardInsights } from './makefun.ts';
import {
  buildMasterMarkdown,
  extractOfficialBountySkills,
  mergeRecommendedSkills,
} from '../src/lib/prompt-builder.ts';
import type {
  AIAnalysisRecord,
  BountyRecord,
  BountySnapshot,
  LLMProviderId,
  RecommendedSkill,
  ResearchReference,
} from '../src/types/command-center.ts';

const PAID_GEMINI_MODELS = new Set(['gemini-4-argon', 'gemini-4-carbon']);

const AnalysisOutputSchema = z.object({
  objectiveSummary: z.string().min(10),
  mandatoryRequirements: z.array(z.string()).min(1),
  judgingCriteria: z.array(z.string()).min(1),
  recommendedApproach: z.string().min(20),
  differentiationStrategy: z.string().min(20),
  architectureOrMethodology: z.string().min(20),
  priorityMatrix: z
    .array(
      z.object({
        criterion: z.string(),
        weightOrEmphasis: z.string(),
        actionableFocus: z.string(),
      })
    )
    .min(1),
  implementationGuidance: z.array(z.string()).min(2),
  qualityStandards: z.array(z.string()).min(1),
  testingValidation: z.array(z.string()).min(1),
  complianceConsiderations: z.array(z.string()).min(1),
  assumptionsUncertainties: z.array(z.string()).min(1),
  risks: z.array(z.string()).min(1),
  recommendedSkills: z
    .array(
      z.object({
        name: z.string().min(1),
        category: z.string().min(1),
        priority: z.enum(['essential', 'recommended', 'optional']),
        rationale: z.string().min(5),
        agentDirective: z.string().min(10),
      })
    )
    .min(1),
  part2AiEnhancement: z.string().min(50),
  part3ExecutionGuidelines: z.string().min(40),
});

export class LLMConfigurationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new LLMConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in Settings > Secrets (or switch to a local OpenAI-compatible endpoint in Settings).',
      400
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withTransientRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('ECONNRESET');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function validateModelAuthorization(provider: LLMProviderId, model: string, allowPaidRequests: boolean): void {
  if (provider === 'gemini') {
    const valid = AVAILABLE_MODELS.some((m) => m.provider === 'gemini' && m.id === model);
    if (!valid) {
      throw new LLMConfigurationError(`Unsupported Gemini model "${model}". Choose a supported model in Settings.`, 400);
    }
    if (PAID_GEMINI_MODELS.has(model) && !allowPaidRequests) {
      throw new LLMConfigurationError(
        `Model "${model}" is a paid-tier model and paid requests are disabled. Enable explicit paid authorization in Settings or choose a free-tier model (e.g. gemini-4-hydrogen).`,
        403
      );
    }
  }
}

async function runOpenAICompatibleChat(params: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
}): Promise<{ text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }> {
  const cleanBase = params.baseUrl.replace(/\/$/, '');
  if (!cleanBase) {
    throw new LLMConfigurationError('OpenAI-compatible Base URL is empty. Configure it in Settings.', 400);
  }
  const apiKey = process.env.OPENAI_COMPAT_API_KEY?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
  };
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let res: Response;
  try {
    res = await fetch(`${cleanBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LLMConfigurationError(
      `Failed to connect to OpenAI-compatible endpoint (${cleanBase}): ${err instanceof Error ? err.message : 'Network error'}`,
      502
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const status = res.status === 429 ? 429 : res.status >= 400 && res.status < 500 ? res.status : 502;
    throw new LLMConfigurationError(
      `OpenAI-compatible provider returned HTTP ${res.status}: ${errText.slice(0, 300)}`,
      status
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new LLMConfigurationError('OpenAI-compatible provider returned an empty response.', 502);
  }

  return {
    text,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

export async function testLLMConnection(overrides?: {
  provider?: LLMProviderId;
  model?: string;
  openaiCompatBaseUrl?: string;
  openaiCompatModel?: string;
  allowPaidRequests?: boolean;
}): Promise<{ ok: boolean; provider: LLMProviderId; model: string; reply: string; latencyMs: number }> {
  const provider = overrides?.provider ?? ((crud.getSettingValue('provider') as LLMProviderId) || 'gemini');
  const allowPaid = overrides?.allowPaidRequests ?? crud.getSettingValue('allowPaidRequests') === 'true';
  const model =
    provider === 'gemini'
      ? overrides?.model ?? (crud.getSettingValue('model') || 'gemini-4-hydrogen')
      : overrides?.openaiCompatModel ?? (crud.getSettingValue('openaiCompatModel') || 'llama3.1:8b');
  const baseUrl = overrides?.openaiCompatBaseUrl ?? crud.getSettingValue('openaiCompatBaseUrl');

  validateModelAuthorization(provider, model, allowPaid);

  const startedAt = Date.now();
  if (provider === 'gemini') {
    const ai = createGeminiClient();
    try {
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model,
          contents: 'Reply with exactly: COSMICLABS_LLM_READY',
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );
      const reply = (response.text || '').trim();
      if (!reply) {
        throw new LLMConfigurationError('Gemini returned an empty response during connection check.', 502);
      }
      return {
        ok: true,
        provider,
        model,
        reply,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (err instanceof LLMConfigurationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') ? 429 : 502;
      throw new LLMConfigurationError(`Gemini connection check failed: ${msg}`, status);
    }
  } else {
    const result = await runOpenAICompatibleChat({
      baseUrl,
      model,
      systemPrompt: 'You are a diagnostic connectivity responder.',
      userPrompt: 'Reply with exactly: COSMICLABS_LLM_READY',
    });
    return {
      ok: true,
      provider,
      model,
      reply: result.text,
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function runFreeReadOnlyResearchFallback(bounty: BountyRecord): Promise<{
  refs: ResearchReference[];
  notes: string[];
}> {
  const refs: ResearchReference[] = [];
  const notes: string[] = [];

  const stopWords = new Set([
    'make', 'build', 'the', 'best', 'for', 'and', 'with', 'into', 'from', 'your',
    'one', 'hour', 'hours', 'days', 'day', 'world', 'live', 'sum', 'makefun',
  ]);
  const titleTerms = bounty.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 4);

  const skillTerms = bounty.skills.slice(0, 2);
  const queryStr = [...titleTerms, ...skillTerms].join(' ').trim() || bounty.category;

  // 1. Free GitHub Public Repository Search API (no paid key required)
  try {
    const ghController = new AbortController();
    const ghTimer = setTimeout(() => ghController.abort(), 6000);
    const ghRes = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(queryStr)}&sort=stars&per_page=3`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'COSMICLABS-CommandCenter/1.0',
        },
        signal: ghController.signal,
      }
    );
    clearTimeout(ghTimer);
    if (ghRes.ok) {
      const ghData = (await ghRes.json()) as {
        items?: Array<{
          full_name?: string;
          html_url?: string;
          description?: string | null;
          stargazers_count?: number;
          language?: string | null;
        }>;
      };
      const items = Array.isArray(ghData.items) ? ghData.items : [];
      for (const repo of items) {
        if (!repo.html_url || !repo.full_name) continue;
        refs.push({
          title: `GitHub: ${repo.full_name} (${repo.stargazers_count ?? 0}★${repo.language ? `, ${repo.language}` : ''})`,
          url: repo.html_url,
          sourceType: 'github_public',
          relevance: (repo.description || 'Public open-source reference repository').slice(0, 180),
        });
        notes.push(
          `Open-source reference ${repo.full_name} (${repo.stargazers_count ?? 0} stars): ${repo.description || 'No description'}`
        );
      }
    }
  } catch {
    // Non-fatal fallback
  }

  // 2. Free Wikipedia Public Search API (domain algorithms & concepts)
  try {
    const wikiController = new AbortController();
    const wikiTimer = setTimeout(() => wikiController.abort(), 5000);
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      titleTerms.slice(0, 3).join(' ') || bounty.category
    )}&srlimit=2&format=json`;
    const wikiRes = await fetch(wikiUrl, {
      headers: { 'User-Agent': 'COSMICLABS-CommandCenter/1.0' },
      signal: wikiController.signal,
    });
    clearTimeout(wikiTimer);
    if (wikiRes.ok) {
      const wikiData = (await wikiRes.json()) as {
        query?: { search?: Array<{ title?: string; snippet?: string; pageid?: number }> };
      };
      const hits = wikiData.query?.search || [];
      for (const hit of hits) {
        if (!hit.title) continue;
        const cleanSnippet = (hit.snippet || '').replace(/<[^>]+>/g, '').trim();
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`;
        refs.push({
          title: `Wikipedia: ${hit.title}`,
          url,
          sourceType: 'wikipedia_api',
          relevance: cleanSnippet.slice(0, 180) || 'Domain background reference',
        });
        notes.push(`Wikipedia (${hit.title}): ${cleanSnippet}`);
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return { refs, notes };
}

export async function runBountyEnhancementWorkflow(input: {
  bounty: BountyRecord;
  snapshot: BountySnapshot | null;
  providerOverride?: LLMProviderId;
  modelOverride?: string;
  enableGroundingOverride?: boolean;
  founderInstructions?: string;
}): Promise<{
  analysis: AIAnalysisRecord;
  recommendedSkills: RecommendedSkill[];
  part1OriginalPrompt: string;
  part2AiEnhancement: string;
  part3ExecutionGuidelines: string;
  fullMarkdown: string;
}> {
  const provider = input.providerOverride ?? ((crud.getSettingValue('provider') as LLMProviderId) || 'gemini');
  const allowPaid = crud.getSettingValue('allowPaidRequests') === 'true';
  const model =
    provider === 'gemini'
      ? input.modelOverride || crud.getSettingValue('model') || 'gemini-4-hydrogen'
      : input.modelOverride || crud.getSettingValue('openaiCompatModel') || 'llama3.1:8b';
  const enableGrounding =
    input.enableGroundingOverride ?? crud.getSettingValue('enableSearchGrounding') === 'true';

  validateModelAuthorization(provider, model, allowPaid);

  // STAGE 1: Official Context & Verbatim Prompt Verification
  const verbatimOfficialPrompt =
    input.snapshot?.manualPromptOverride?.trim() ||
    input.snapshot?.officialPromptText?.trim() ||
    [
      `# ${input.bounty.title}`,
      input.bounty.summary ? `Summary: ${input.bounty.summary}` : '',
      `Official URL: ${input.bounty.url}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  if (!verbatimOfficialPrompt || verbatimOfficialPrompt.length < 20) {
    throw new LLMConfigurationError(
      'Official competition prompt text is unavailable or too short. Sync competition details from make.fun or paste the verified official prompt manually first.',
      400
    );
  }

  const rawReq = input.snapshot?.rawRequirements as Record<string, unknown> | null;
  const rawComp = input.snapshot?.rawCompetition as Record<string, unknown> | null;
  const rawLeaderboard = input.snapshot?.rawLeaderboard as Record<string, unknown> | null;
  const rawKit = input.snapshot?.rawKit as Record<string, unknown> | null;
  const accountHandle = crud.getSettingValue('accountHandle') || '@0xkeinara';
  const leaderboardInsights = extractLeaderboardInsights(rawLeaderboard, rawComp, accountHandle);

  const leaderboardContextText = leaderboardInsights
    ? [
        `Gap Summary: ${leaderboardInsights.gapSummary}`,
        ...leaderboardInsights.topEntries.slice(0, 5).map(
          (e) =>
            `  - #${e.rank ?? '?'} "${e.title}" by @${e.handle}: ${e.primaryMetricLabel}=${e.primaryMetricValue}`
        ),
        leaderboardInsights.houseBaseline
          ? `  - House Baseline #${leaderboardInsights.houseBaseline.rank ?? '?'}: "${leaderboardInsights.houseBaseline.title}" (${leaderboardInsights.houseBaseline.primaryMetricLabel}=${leaderboardInsights.houseBaseline.primaryMetricValue})`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No leaderboard entries available yet in snapshot.';

  const activeChecks = Array.isArray(rawReq?.checks)
    ? (rawReq?.checks as Array<{ check?: string; title?: string; description?: string; applies?: boolean }>)
        .filter((c) => c.applies !== false)
        .slice(0, 18)
        .map((c) => `- ${c.check}: ${c.title} — ${(c.description || '').slice(0, 260)}`)
        .join('\n')
    : 'No granular check manifest captured in snapshot.';

  const payoutCurveText = Array.isArray(rawReq?.payout_curve)
    ? JSON.stringify(rawReq.payout_curve.slice(0, 10))
    : JSON.stringify(rawComp?.rewardsNow || rawComp?.rewards || {});

  const baselineText = rawComp?.baseline ? JSON.stringify(rawComp.baseline) : 'Not specified in API';
  const kitFilesText = Array.isArray(rawKit?.files)
    ? (rawKit.files as Array<{ path?: string; name?: string }>)
        .slice(0, 20)
        .map((f) => f.path || f.name || JSON.stringify(f))
        .join(', ')
    : rawKit?.files && typeof rawKit.files === 'object'
      ? Object.keys(rawKit.files as Record<string, unknown>)
          .slice(0, 20)
          .join(', ')
      : 'Kit manifest not fetched';

  // STAGE 2: Read-Only Research & Grounding (with Free GitHub/Wikipedia Fallback)
  const researchReferences: ResearchReference[] = [];
  let researchSummaryNotes = '';
  let researchDisclosures = '';
  let needsFallbackResearch = false;

  if (kitFilesText !== 'Kit manifest not fetched') {
    researchReferences.push({
      title: `Official make.fun Competition Kit (${input.bounty.slug})`,
      url: `https://make.fun/api/competitions/${input.bounty.slug}/kit`,
      sourceType: 'makefun_kit',
      relevance: `Kit manifest files inspected read-only: ${kitFilesText}`,
    });
  }

  researchReferences.push({
    title: `Official Bounty Specification — ${input.bounty.title}`,
    url: input.bounty.url,
    sourceType: 'official_docs',
    relevance: 'Primary competition specification, rules, deliverables, and payout structure.',
  });

  if (provider === 'gemini' && enableGrounding) {
    const ai = createGeminiClient();
    try {
      const researchPrompt = [
        `You are conducting read-only technical and domain research for a competitive bounty on make.fun.`,
        `Competition Title: ${input.bounty.title}`,
        `Category: ${input.bounty.category}`,
        `Skills: ${input.bounty.skills.join(', ') || 'General'}`,
        `Summary: ${input.bounty.summary || verbatimOfficialPrompt.slice(0, 600)}`,
        '',
        `Find the strongest real-world engineering, algorithmic, creative, or domain techniques, benchmarks, open-source references, and evaluation best practices specifically applicable to this competition category and constraints.`,
        `Summarize key technical insights concisely with exact constraints in mind.`,
      ].join('\n');

      const searchResponse = await withTransientRetry(() =>
        ai.models.generateContent({
          model,
          contents: researchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      researchSummaryNotes = (searchResponse.text || '').trim();
      const chunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks as
        | Array<{ web?: { uri?: string; title?: string } }>
        | undefined;

      if (Array.isArray(chunks)) {
        const seenUrls = new Set<string>();
        for (const chunk of chunks) {
          const uri = chunk.web?.uri;
          const title = chunk.web?.title;
          if (uri && !seenUrls.has(uri)) {
            seenUrls.add(uri);
            researchReferences.push({
              title: title || uri,
              url: uri,
              sourceType: 'google_search',
              relevance: `Web grounding source retrieved during Stage 2 research for ${input.bounty.category}.`,
            });
          }
        }
      }

      if (chunks && chunks.length > 0) {
        researchDisclosures = `Live Google Search grounding retrieved ${chunks.length} web source(s) during research.`;
      } else {
        needsFallbackResearch = true;
        researchDisclosures =
          'Google Search grounding returned no web chunks; supplemented with free read-only GitHub/Wikipedia lookup.';
      }
    } catch (err) {
      needsFallbackResearch = true;
      const msg = err instanceof Error ? err.message : String(err);
      const cleanReason =
        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
          ? 'Google Search grounding quota unavailable on current API tier'
          : msg.slice(0, 140);
      researchDisclosures = `Google Search grounding unavailable (${cleanReason}); used free read-only GitHub/Wikipedia lookup + official bounty specs.`;
    }
  } else {
    needsFallbackResearch = true;
    researchDisclosures =
      provider === 'openai_compatible'
        ? 'Live Google Search grounding is unavailable on OpenAI-compatible provider; used free read-only GitHub/Wikipedia lookup + official bounty specs.'
        : 'Google Search grounding disabled by user; used free read-only GitHub/Wikipedia lookup + official bounty specs.';
  }

  if (needsFallbackResearch) {
    const fb = await runFreeReadOnlyResearchFallback(input.bounty);
    if (fb.refs.length > 0) {
      researchReferences.push(...fb.refs);
      researchSummaryNotes = [researchSummaryNotes, ...fb.notes].filter(Boolean).join('\n');
    } else {
      researchDisclosures += ' (No additional external GitHub/Wikipedia hits matched.)';
    }
  }

  const officialMcpNames = (input.bounty.prerequisites?.mcp || []).map((m) => m.name).filter(Boolean);
  const officialSoftwareNames = (input.bounty.prerequisites?.software || []).map((s) => s.name).filter(Boolean);

  // STAGE 3: Category-Adapted Deep Analysis & Prompt Enhancement Synthesis
  const systemPrompt = [
    `You are the Senior Principal Strategist for COSMICLABS (make.fun account ${accountHandle}), preparing a tailored, actionable enhancement strategy for Hermes (an autonomous coding agent).`,
    `CRITICAL RULES:`,
    `1. Adapt your entire reasoning and terminology to the exact competition category (${input.bounty.category}) and constraints. Never produce generic boilerplate.`,
    `2. Every recommendation must be concrete, technical/creative, and actionable. Ban meaningless phrases like "make it amazing", "build the best possible solution", or "ensure high quality" without specifying exact mechanisms, thresholds, or validation checks.`,
    `3. Never claim or imply that any strategy guarantees winning or placing.`,
    `4. Respect all official constraints (file size caps, network bans, determinism, transcript authorship rules, submission quotas).`,
    `5. Use the live Leaderboard Gap Insights to target concrete score/metric improvements over current leaders and baselines.`,
    `6. In "part2AiEnhancement", write rich, well-structured Markdown ready to paste directly into Hermes as supplemental architectural and competitive instructions.`,
    `7. In "part3ExecutionGuidelines", write concrete Hermes execution, verification, transcript-hygiene, and compliance rules tailored to this bounty's checks.`,
    `8. In "recommendedSkills", curate 3 to 6 optimal engineering/domain skills, MCP integrations, or Hermes tool workflows tailored to this specific bounty (combining official skills/prerequisites with specialized optimization/verification skills). Each item must include concrete "agentDirective" telling Hermes exactly how and when to apply that skill.`,
    `9. Explicitly state assumptions and uncertainties where official details are missing or unverified.`,
  ].join('\n');

  const analysisPrompt = [
    `Analyze the following make.fun bounty and produce a structured JSON strategy and tailored enhancement prompt.`,
    '',
    `COMPETITION METADATA:`,
    `- Slug: ${input.bounty.slug}`,
    `- Title: ${input.bounty.title}`,
    `- Category: ${input.bounty.category}`,
    `- Official Skills Tags: ${input.bounty.skills.join(', ') || 'Not specified'}`,
    `- Official MCP Prerequisites: ${officialMcpNames.join(', ') || 'None specified'}`,
    `- Official Software Prerequisites: ${officialSoftwareNames.join(', ') || 'None specified'}`,
    `- Reward Pool: $${input.bounty.potUsd || input.bounty.rewardAmount} USDC`,
    `- Payout Curve: ${payoutCurveText}`,
    `- Baseline: ${baselineText}`,
    `- Deadline: ${input.bounty.deadline || 'Not specified'}`,
    `- Current Submissions: ${input.bounty.submissionCount}`,
    `- Harness Kind: ${input.bounty.harnessKind || 'Not specified'}`,
    `- Kit Manifest Files: ${kitFilesText}`,
    '',
    `LIVE LEADERBOARD GAP INSIGHTS:`,
    leaderboardContextText,
    '',
    `OFFICIAL VERBATIM PROMPT & RULES:`,
    verbatimOfficialPrompt.slice(0, 14000),
    '',
    `ACTIVE INTAKE & GRADING CHECKS:`,
    activeChecks.slice(0, 4000),
    '',
    researchSummaryNotes
      ? `STAGE 2 VERIFIED RESEARCH NOTES:\n${researchSummaryNotes.slice(0, 4500)}`
      : `STAGE 2 RESEARCH NOTES: ${researchDisclosures}`,
    '',
    input.founderInstructions?.trim()
      ? `FOUNDER SPECIFIC FOCUS:\n${input.founderInstructions.trim()}`
      : '',
    '',
    `Return strict JSON matching the required schema. Ensure part2AiEnhancement, part3ExecutionGuidelines, and recommendedSkills are detailed, specific to "${input.bounty.title}" (${input.bounty.category}), and directly actionable by a coding agent.`,
  ]
    .filter(Boolean)
    .join('\n');

  let parsedOutput: z.infer<typeof AnalysisOutputSchema>;
  let rawLlmText = '';
  let tokenUsage: AIAnalysisRecord['tokenUsage'] = null;

  if (provider === 'gemini') {
    const ai = createGeminiClient();
    try {
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model,
          contents: analysisPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            thinkingConfig: {
              thinkingLevel: model === 'gemini-3.1-flash-lite' ? ThinkingLevel.MEDIUM : ThinkingLevel.HIGH,
            },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                objectiveSummary: { type: Type.STRING },
                mandatoryRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
                judgingCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendedApproach: { type: Type.STRING },
                differentiationStrategy: { type: Type.STRING },
                architectureOrMethodology: { type: Type.STRING },
                priorityMatrix: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      criterion: { type: Type.STRING },
                      weightOrEmphasis: { type: Type.STRING },
                      actionableFocus: { type: Type.STRING },
                    },
                    required: ['criterion', 'weightOrEmphasis', 'actionableFocus'],
                  },
                },
                implementationGuidance: { type: Type.ARRAY, items: { type: Type.STRING } },
                qualityStandards: { type: Type.ARRAY, items: { type: Type.STRING } },
                testingValidation: { type: Type.ARRAY, items: { type: Type.STRING } },
                complianceConsiderations: { type: Type.ARRAY, items: { type: Type.STRING } },
                assumptionsUncertainties: { type: Type.ARRAY, items: { type: Type.STRING } },
                risks: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendedSkills: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      category: { type: Type.STRING },
                      priority: { type: Type.STRING, enum: ['essential', 'recommended', 'optional'] },
                      rationale: { type: Type.STRING },
                      agentDirective: { type: Type.STRING },
                    },
                    required: ['name', 'category', 'priority', 'rationale', 'agentDirective'],
                  },
                },
                part2AiEnhancement: { type: Type.STRING },
                part3ExecutionGuidelines: { type: Type.STRING },
              },
              required: [
                'objectiveSummary',
                'mandatoryRequirements',
                'judgingCriteria',
                'recommendedApproach',
                'differentiationStrategy',
                'architectureOrMethodology',
                'priorityMatrix',
                'implementationGuidance',
                'qualityStandards',
                'testingValidation',
                'complianceConsiderations',
                'assumptionsUncertainties',
                'risks',
                'recommendedSkills',
                'part2AiEnhancement',
                'part3ExecutionGuidelines',
              ],
            },
          },
        })
      );

      rawLlmText = (response.text || '').trim();
      if (!rawLlmText) {
        throw new LLMConfigurationError('Gemini returned an empty synthesis response.', 502);
      }

      if (response.usageMetadata) {
        tokenUsage = {
          promptTokens: response.usageMetadata.promptTokenCount,
          completionTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
        };
      }

      const jsonObj = JSON.parse(rawLlmText);
      parsedOutput = AnalysisOutputSchema.parse(jsonObj);
    } catch (err) {
      if (err instanceof LLMConfigurationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        throw new LLMConfigurationError(`Gemini quota exhausted (429): ${msg}`, 429);
      }
      if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
        throw new LLMConfigurationError(
          `Gemini authentication error: check GEMINI_API_KEY in Settings > Secrets. (${msg})`,
          403
        );
      }
      throw new LLMConfigurationError(`LLM synthesis failed: ${msg}`, 502);
    }
  } else {
    const baseUrl = crud.getSettingValue('openaiCompatBaseUrl');
    const jsonInstruction = `\n\nRespond ONLY with a valid JSON object containing keys: objectiveSummary (string), mandatoryRequirements (string[]), judgingCriteria (string[]), recommendedApproach (string), differentiationStrategy (string), architectureOrMethodology (string), priorityMatrix ({criterion, weightOrEmphasis, actionableFocus}[]), implementationGuidance (string[]), qualityStandards (string[]), testingValidation (string[]), complianceConsiderations (string[]), assumptionsUncertainties (string[]), risks (string[]), recommendedSkills ({name, category, priority: "essential"|"recommended"|"optional", rationale, agentDirective}[]), part2AiEnhancement (string), part3ExecutionGuidelines (string).`;
    const result = await runOpenAICompatibleChat({
      baseUrl,
      model,
      systemPrompt: systemPrompt + jsonInstruction,
      userPrompt: analysisPrompt,
      jsonMode: true,
    });
    rawLlmText = result.text;
    tokenUsage = result.usage || null;
    try {
      const cleaned = rawLlmText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      parsedOutput = AnalysisOutputSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      throw new LLMConfigurationError(
        `OpenAI-compatible endpoint returned malformed JSON schema: ${err instanceof Error ? err.message : 'Parse error'}`,
        502
      );
    }
  }

  // STAGE 4: Compliance Verification & Assembly
  const forbiddenClaimsRegex = /\b(guarantee[sd]?\s+(to\s+)?win|100%\s+win|guaranteed\s+victory)\b/gi;
  const sanitizedPart2 = parsedOutput.part2AiEnhancement.replace(
    forbiddenClaimsRegex,
    'aims to improve competitive positioning'
  );
  const sanitizedPart3 = parsedOutput.part3ExecutionGuidelines.replace(
    forbiddenClaimsRegex,
    'aims to improve compliance and quality'
  );

  const aiCuratedSkills: RecommendedSkill[] = parsedOutput.recommendedSkills.map((s, idx) => {
    const cleanId =
      s.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `skill-${idx + 1}`;
    return {
      id: `ai-${cleanId}-${idx + 1}`,
      name: s.name.trim(),
      category: s.category.trim(),
      source: 'ai_curated',
      priority: s.priority,
      rationale: s.rationale.trim(),
      agentDirective: s.agentDirective.trim(),
      enabled: true,
    };
  });

  const mergedSkills = mergeRecommendedSkills({
    officialSkills: extractOfficialBountySkills(input.bounty),
    aiSkills: aiCuratedSkills,
  });

  const analysisId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const savedAnalysis = crud.createAIAnalysis({
    id: analysisId,
    bountySlug: input.bounty.slug,
    provider,
    model,
    stageStatus: 'completed_4_stage_pipeline',
    objectiveSummary: parsedOutput.objectiveSummary,
    mandatoryRequirements: parsedOutput.mandatoryRequirements,
    judgingCriteria: parsedOutput.judgingCriteria,
    recommendedApproach: parsedOutput.recommendedApproach,
    differentiationStrategy: parsedOutput.differentiationStrategy,
    architectureOrMethodology: parsedOutput.architectureOrMethodology,
    priorityMatrix: parsedOutput.priorityMatrix,
    implementationGuidance: parsedOutput.implementationGuidance,
    qualityStandards: parsedOutput.qualityStandards,
    testingValidation: parsedOutput.testingValidation,
    complianceConsiderations: parsedOutput.complianceConsiderations,
    assumptionsUncertainties: parsedOutput.assumptionsUncertainties,
    risks: parsedOutput.risks,
    recommendedSkills: mergedSkills,
    researchReferences,
    researchDisclosures,
    rawLlmResponse: rawLlmText,
    tokenUsage,
    createdAt,
  });

  const fullMarkdown = buildMasterMarkdown({
    bountyTitle: input.bounty.title,
    bountySlug: input.bounty.slug,
    bountyUrl: input.bounty.url,
    part1OriginalPrompt: verbatimOfficialPrompt,
    part2AiEnhancement: sanitizedPart2,
    part3ExecutionGuidelines: sanitizedPart3,
    founderInstructions: input.founderInstructions || '',
    selectedSkills: mergedSkills,
  });

  return {
    analysis: savedAnalysis,
    recommendedSkills: mergedSkills,
    part1OriginalPrompt: verbatimOfficialPrompt,
    part2AiEnhancement: sanitizedPart2,
    part3ExecutionGuidelines: sanitizedPart3,
    fullMarkdown,
  };
}

export { buildMasterMarkdown };
