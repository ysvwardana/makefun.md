import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { crud } from './server/crud.ts';
import { AVAILABLE_MODELS, safeJsonParse } from './server/db.ts';
import {
  LLMConfigurationError,
  runBountyEnhancementWorkflow,
  testLLMConnection,
} from './server/llm.ts';
import { buildMasterMarkdown } from './src/lib/prompt-builder.ts';
import {
  computeEffectiveSyncState,
  extractLeaderboardInsights,
  syncCompetitionsFromMakefun,
  syncSingleBountyDetails,
} from './server/makefun.ts';
import { evaluateTranscriptGates } from './server/transcript-gate.ts';
import type { AppSettings, LLMProviderId } from './src/types/command-center.ts';

const PORT = Number(process.env.PORT || 3000);

function buildSettingsResponse(): AppSettings {
  const provider = (crud.getSettingValue('provider') as LLMProviderId) || 'gemini';
  return {
    provider,
    model: crud.getSettingValue('model') || 'gemini-4-hydrogen',
    openaiCompatBaseUrl: crud.getSettingValue('openaiCompatBaseUrl') || 'http://localhost:11434/v1',
    openaiCompatModel: crud.getSettingValue('openaiCompatModel') || 'llama3.1:8b',
    allowPaidRequests: crud.getSettingValue('allowPaidRequests') === 'true',
    enableSearchGrounding: crud.getSettingValue('enableSearchGrounding') === 'true',
    syncIntervalMinutes: Number(crud.getSettingValue('syncIntervalMinutes') || 30),
    accountHandle: crud.getSettingValue('accountHandle') || '@0xkeinara',
    permittedEvidencePaths: safeJsonParse<string[]>(
      crud.getSettingValue('permittedEvidencePaths'),
      ['./evidence']
    ),
    lastGlobalSyncAt: crud.getSettingValue('lastGlobalSyncAt') || null,
    nextCursor: crud.getSettingValue('nextCursor') || null,
    credentialStatus: {
      geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openaiCompatKeyConfigured: Boolean(process.env.OPENAI_COMPAT_API_KEY?.trim()),
    },
    availableModels: AVAILABLE_MODELS,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'COSMICLABS Make.fun Command Center',
      timestamp: new Date().toISOString(),
    });
  });

  // Overview summary
  app.get('/api/overview', (_req, res) => {
    res.json(crud.getOverviewData(buildSettingsResponse(), computeEffectiveSyncState));
  });

  // Bounties list (auto-syncs once if DB is empty)
  app.get('/api/bounties', async (req, res) => {
    const initial = crud.listBounties();
    let syncWarning: string | undefined;
    if (initial.items.length === 0) {
      const syncResult = await syncCompetitionsFromMakefun({ includeOpenFirst: true });
      if (syncResult.error) syncWarning = syncResult.error;
    }

    const { items, categories } = crud.listBounties(
      {
        search: String(req.query.search || ''),
        category: String(req.query.category || 'all'),
        status: String(req.query.status || 'all'),
        watchlistedOnly: req.query.watchlisted === '1',
        sortBy: String(req.query.sort || 'status_deadline'),
      },
      computeEffectiveSyncState
    );

    res.json({
      items,
      categories,
      nextCursor: crud.getSettingValue('nextCursor') || null,
      lastGlobalSyncAt: crud.getSettingValue('lastGlobalSyncAt') || null,
      syncWarning,
    });
  });

  app.post('/api/bounties/sync', async (_req, res) => {
    const result = await syncCompetitionsFromMakefun({ includeOpenFirst: true });
    res.json(result);
  });

  app.post('/api/bounties/load-more', async (_req, res) => {
    const cursor = crud.getSettingValue('nextCursor');
    if (!cursor) {
      res.json({ syncedCount: 0, nextCursor: null, syncState: 'LIVE' });
      return;
    }
    const result = await syncCompetitionsFromMakefun({ cursor, includeOpenFirst: false });
    res.json(result);
  });

  app.get('/api/bounties/:slug', async (req, res) => {
    const { slug } = req.params;
    const forceRefresh = req.query.refresh === '1';

    let bounty = crud.getBountyBySlug(slug);
    let snapshot = crud.getLatestBountySnapshot(slug);

    let refreshError: string | undefined;
    if (forceRefresh || !bounty || !snapshot || !snapshot.rawRequirements) {
      const synced = await syncSingleBountyDetails(slug);
      refreshError = synced.error;
      bounty = crud.getBountyBySlug(slug);
      snapshot = crud.getLatestBountySnapshot(slug);
    }

    if (!bounty) {
      res.status(404).json({ error: `Bounty "${slug}" not found.` });
      return;
    }

    bounty.syncState = computeEffectiveSyncState(bounty);

    const analyses = crud.listAIAnalysesByBounty(slug);
    const { draft, versions } = crud.getPromptDraftAndVersionsBySlug(slug);
    const leaderboardInsights = extractLeaderboardInsights(
      snapshot?.rawLeaderboard ?? null,
      snapshot?.rawCompetition ?? null,
      crud.getSettingValue('accountHandle') || '@0xkeinara'
    );

    res.json({
      bounty,
      snapshot,
      leaderboardInsights,
      analyses,
      draft,
      versions,
      refreshError,
    });
  });

  app.patch('/api/bounties/:slug/watchlist', (req, res) => {
    const { slug } = req.params;
    const body = z.object({ watchlisted: z.boolean() }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid watchlist payload.' });
      return;
    }
    const updated = crud.updateBountyWatchlist(slug, body.data.watchlisted);
    if (!updated) {
      res.status(404).json({ error: 'Bounty not found.' });
      return;
    }
    res.json({ ok: true, slug, watchlisted: body.data.watchlisted });
  });

  app.patch('/api/bounties/:slug/notes', (req, res) => {
    const { slug } = req.params;
    const body = z.object({ founderNotes: z.string() }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid notes payload.' });
      return;
    }
    const updated = crud.updateBountyNotes(slug, body.data.founderNotes);
    if (!updated) {
      res.status(404).json({ error: 'Bounty not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/bounties/:slug/manual-prompt', (req, res) => {
    const { slug } = req.params;
    const body = z.object({ manualPromptText: z.string().min(10) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Manual prompt must be at least 10 characters.' });
      return;
    }
    const bounty = crud.getBountyBySlug(slug);
    if (!bounty) {
      res.status(404).json({ error: 'Bounty not found.' });
      return;
    }

    const snapshot = crud.upsertManualPromptOverride(slug, body.data.manualPromptText);
    res.json({ ok: true, snapshot });
  });

  // CORE FEATURE: Genuine LLM Enhancement Workflow
  app.post('/api/enhancer/run', async (req, res) => {
    const schema = z.object({
      slug: z.string().min(1),
      provider: z.enum(['gemini', 'openai_compatible']).optional(),
      model: z.string().optional(),
      enableGrounding: z.boolean().optional(),
      founderInstructions: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid enhancer request payload.' });
      return;
    }

    const { slug, provider, model, enableGrounding, founderInstructions } = parsed.data;

    let bounty = crud.getBountyBySlug(slug);
    let snapshot = crud.getLatestBountySnapshot(slug);

    if (!bounty || !snapshot || !snapshot.rawRequirements) {
      await syncSingleBountyDetails(slug);
      bounty = crud.getBountyBySlug(slug);
      snapshot = crud.getLatestBountySnapshot(slug);
    }

    if (!bounty) {
      res.status(404).json({ error: `Bounty "${slug}" not found.` });
      return;
    }

    bounty.syncState = computeEffectiveSyncState(bounty);

    try {
      const result = await runBountyEnhancementWorkflow({
        bounty,
        snapshot,
        providerOverride: provider,
        modelOverride: model,
        enableGroundingOverride: enableGrounding,
        founderInstructions,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof LLMConfigurationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unexpected LLM workflow error.',
      });
    }
  });

  // Prompts & Append-Only Version History
  app.get('/api/prompts', (_req, res) => {
    res.json({ drafts: crud.listPromptDraftsWithLatest() });
  });

  app.get('/api/prompts/:slug', (req, res) => {
    res.json(crud.getPromptDraftAndVersionsBySlug(req.params.slug));
  });

  app.post('/api/prompts/:slug/versions', (req, res) => {
    const { slug } = req.params;
    const skillSchema = z.object({
      id: z.string(),
      name: z.string().min(1),
      category: z.string().min(1),
      source: z.enum(['official_bounty', 'official_mcp', 'ai_curated', 'founder_custom']),
      priority: z.enum(['essential', 'recommended', 'optional']),
      rationale: z.string(),
      agentDirective: z.string(),
      enabled: z.boolean(),
    });
    const schema = z.object({
      analysisId: z.string().nullable().optional(),
      part1OriginalPrompt: z.string().min(10),
      part2AiEnhancement: z.string().min(10),
      part3ExecutionGuidelines: z.string().min(10),
      founderInstructions: z.string().optional().default(''),
      selectedSkills: z.array(skillSchema).optional().default([]),
      editSummary: z.string().optional().default(''),
      founderNotes: z.string().optional().default(''),
      createdBy: z.string().optional().default('Founder'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid prompt version payload.' });
      return;
    }

    const bounty = crud.getBountyBySlug(slug);
    if (!bounty) {
      res.status(404).json({ error: `Bounty "${slug}" not found.` });
      return;
    }

    const fullMarkdown = buildMasterMarkdown({
      bountyTitle: bounty.title,
      bountySlug: bounty.slug,
      bountyUrl: bounty.url,
      part1OriginalPrompt: parsed.data.part1OriginalPrompt,
      part2AiEnhancement: parsed.data.part2AiEnhancement,
      part3ExecutionGuidelines: parsed.data.part3ExecutionGuidelines,
      founderInstructions: parsed.data.founderInstructions,
      selectedSkills: parsed.data.selectedSkills,
    });

    const result = crud.createPromptVersionTransactional({
      bountySlug: slug,
      bountyTitle: bounty.title,
      analysisId: parsed.data.analysisId ?? null,
      part1OriginalPrompt: parsed.data.part1OriginalPrompt,
      part2AiEnhancement: parsed.data.part2AiEnhancement,
      part3ExecutionGuidelines: parsed.data.part3ExecutionGuidelines,
      founderInstructions: parsed.data.founderInstructions,
      selectedSkills: parsed.data.selectedSkills,
      fullMarkdown,
      editSummary: parsed.data.editSummary,
      founderNotes: parsed.data.founderNotes,
      createdBy: parsed.data.createdBy,
    });

    res.status(201).json(result);
  });

  // Hermes Read-Only Evidence Monitor
  app.get('/api/evidence', (_req, res) => {
    res.json({
      evidence: crud.listEvidence(),
      permittedPaths: safeJsonParse<string[]>(
        crud.getSettingValue('permittedEvidencePaths'),
        ['./evidence']
      ),
    });
  });

  app.post('/api/evidence/import', (req, res) => {
    const schema = z.object({
      bountySlug: z.string().nullable().optional(),
      sourceType: z.enum(['session_export', 'local_log', 'project_artifact']),
      sourcePathOrName: z.string().min(1),
      sessionId: z.string().nullable().optional(),
      rawContent: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid evidence import payload.' });
      return;
    }

    const raw = parsed.data.rawContent;
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const timestampMatches = raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g) || [];
    const summary =
      lines.length > 0
        ? `Imported ${lines.length} line(s) (${Buffer.byteLength(raw, 'utf8')} bytes) from ${parsed.data.sourcePathOrName}.`
        : 'Empty file';

    const item = crud.createEvidence({
      bountySlug: parsed.data.bountySlug || null,
      sourceType: parsed.data.sourceType,
      sourcePathOrName: parsed.data.sourcePathOrName,
      sessionId: parsed.data.sessionId || null,
      summary,
      rawContent: raw.slice(0, 200000),
      metadata: {
        turnCount: lines.length,
        timestampsFound: timestampMatches.length,
        byteSize: Buffer.byteLength(raw, 'utf8'),
        readOnlyVerified: true,
      },
    });

    res.status(201).json({ item });
  });

  app.post('/api/evidence/scan-local', (_req, res) => {
    const permittedPaths = safeJsonParse<string[]>(
      crud.getSettingValue('permittedEvidencePaths'),
      ['./evidence']
    );
    const workspaceRoot = process.cwd();
    const scannedFiles: Array<{ path: string; size: number; modifiedAt: string }> = [];
    const skippedPaths: Array<{ path: string; reason: string }> = [];

    for (const relOrAbs of permittedPaths) {
      const resolved = path.resolve(workspaceRoot, relOrAbs);
      if (!resolved.startsWith(workspaceRoot)) {
        skippedPaths.push({ path: relOrAbs, reason: 'Outside workspace directory boundary' });
        continue;
      }
      if (!fs.existsSync(resolved)) {
        skippedPaths.push({ path: relOrAbs, reason: 'Directory does not exist on disk' });
        continue;
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        skippedPaths.push({ path: relOrAbs, reason: 'Path is not a directory' });
        continue;
      }
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries.slice(0, 25)) {
        if (!entry.isFile()) continue;
        if (!/\.(json|jsonl|log|md|txt)$/i.test(entry.name)) continue;
        const fullFile = path.join(resolved, entry.name);
        const fStat = fs.statSync(fullFile);
        const content = fs.readFileSync(fullFile, 'utf8').slice(0, 150000);
        const relPath = path.relative(workspaceRoot, fullFile);

        const existing = crud.findEvidenceBySourcePath(relPath);
        if (!existing) {
          const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
          crud.createEvidence({
            bountySlug: null,
            sourceType: 'local_log',
            sourcePathOrName: relPath,
            sessionId: null,
            summary: `Read-only scan from ${relPath} (${lines.length} lines, ${fStat.size} bytes)`,
            rawContent: content,
            metadata: {
              turnCount: lines.length,
              byteSize: fStat.size,
              readOnlyVerified: true,
            },
          });
        }
        scannedFiles.push({
          path: relPath,
          size: fStat.size,
          modifiedAt: fStat.mtime.toISOString(),
        });
      }
    }

    res.json({ scannedFiles, skippedPaths });
  });

  app.post('/api/evidence/:id/precheck', (req, res) => {
    const { id } = req.params;
    const body = z
      .object({
        bountySlug: z.string().nullable().optional(),
      })
      .safeParse(req.body || {});
    if (!body.success) {
      res.status(400).json({ error: 'Invalid pre-check request payload.' });
      return;
    }

    const evidenceItem = crud.getEvidenceById(id);
    if (!evidenceItem) {
      res.status(404).json({ error: 'Evidence artifact not found.' });
      return;
    }

    const targetSlug =
      body.data.bountySlug !== undefined ? body.data.bountySlug : evidenceItem.bountySlug;

    let publishedAt: string | null = null;
    let deadline: string | null = null;
    if (targetSlug) {
      const bounty = crud.getBountyBySlug(targetSlug);
      if (bounty) {
        publishedAt = bounty.publishedAt;
        deadline = bounty.deadline;
      }
    }

    const report = evaluateTranscriptGates({
      rawContent: evidenceItem.rawContent,
      bountySlug: targetSlug || null,
      competitionPublishedAt: publishedAt,
      competitionDeadline: deadline,
    });

    res.json({ report });
  });

  app.delete('/api/evidence/:id', (req, res) => {
    const deleted = crud.deleteEvidence(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Evidence artifact not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Verified Submissions
  app.get('/api/submissions', (_req, res) => {
    res.json({
      accountHandle: crud.getSettingValue('accountHandle') || '@0xkeinara',
      submissions: crud.listSubmissions(),
    });
  });

  app.post('/api/submissions', (req, res) => {
    const schema = z.object({
      bountySlug: z.string().min(1),
      entryTitle: z.string().min(1),
      commitSha: z.string().nullable().optional(),
      repoUrl: z.string().nullable().optional(),
      status: z.enum(['submitted', 'accepted', 'judged', 'awarded', 'rejected']),
      rank: z.number().int().nullable().optional(),
      scoreDisplay: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid verified submission payload.' });
      return;
    }

    const accountHandle = crud.getSettingValue('accountHandle') || '@0xkeinara';
    const submission = crud.createSubmission({
      bountySlug: parsed.data.bountySlug,
      hunterHandle: accountHandle,
      entryTitle: parsed.data.entryTitle,
      commitSha: parsed.data.commitSha || null,
      repoUrl: parsed.data.repoUrl || null,
      status: parsed.data.status,
      rank: parsed.data.rank ?? null,
      scoreDisplay: parsed.data.scoreDisplay || null,
      source: 'manual_verified',
    });

    res.status(201).json({ submission });
  });

  app.patch('/api/submissions/:id', (req, res) => {
    const schema = z.object({
      entryTitle: z.string().min(1).optional(),
      commitSha: z.string().nullable().optional(),
      repoUrl: z.string().nullable().optional(),
      status: z.enum(['submitted', 'accepted', 'judged', 'awarded', 'rejected']).optional(),
      rank: z.number().int().nullable().optional(),
      scoreDisplay: z.string().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid submission update payload.' });
      return;
    }
    const updated = crud.updateSubmission(req.params.id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }
    res.json({ submission: updated });
  });

  app.delete('/api/submissions/:id', (req, res) => {
    const deleted = crud.deleteSubmission(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Rewards Ledger & Analytics
  app.get('/api/rewards', (_req, res) => {
    res.json(crud.listRewardsWithTotals());
  });

  app.post('/api/rewards', (req, res) => {
    const schema = z.object({
      bountySlug: z.string().min(1),
      announcedPrizeUsd: z.number().min(0),
      verifiedAwardUsd: z.number().min(0),
      receivedUsd: z.number().min(0),
      txSignature: z.string().nullable().optional(),
      claimStatus: z.enum(['announced', 'awarded_unclaimed', 'claimed_received']),
      notes: z.string().optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reward record payload.' });
      return;
    }

    const record = crud.createReward({
      bountySlug: parsed.data.bountySlug,
      announcedPrizeUsd: parsed.data.announcedPrizeUsd,
      verifiedAwardUsd: parsed.data.verifiedAwardUsd,
      receivedUsd: parsed.data.receivedUsd,
      txSignature: parsed.data.txSignature || null,
      claimStatus: parsed.data.claimStatus,
      notes: parsed.data.notes,
    });

    res.status(201).json({ record });
  });

  app.patch('/api/rewards/:id', (req, res) => {
    const schema = z.object({
      announcedPrizeUsd: z.number().min(0).optional(),
      verifiedAwardUsd: z.number().min(0).optional(),
      receivedUsd: z.number().min(0).optional(),
      txSignature: z.string().nullable().optional(),
      claimStatus: z.enum(['announced', 'awarded_unclaimed', 'claimed_received']).optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reward update payload.' });
      return;
    }
    const record = crud.updateReward(req.params.id, parsed.data);
    if (!record) {
      res.status(404).json({ error: 'Reward record not found.' });
      return;
    }
    res.json({ record });
  });

  app.delete('/api/rewards/:id', (req, res) => {
    const deleted = crud.deleteReward(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Reward record not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // Settings & Connection Test
  app.get('/api/settings', (_req, res) => {
    res.json(buildSettingsResponse());
  });

  app.patch('/api/settings', (req, res) => {
    const schema = z.object({
      provider: z.enum(['gemini', 'openai_compatible']).optional(),
      model: z.string().min(1).optional(),
      openaiCompatBaseUrl: z.string().optional(),
      openaiCompatModel: z.string().optional(),
      allowPaidRequests: z.boolean().optional(),
      enableSearchGrounding: z.boolean().optional(),
      syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
      accountHandle: z.string().min(1).optional(),
      permittedEvidencePaths: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settings update.' });
      return;
    }
    const d = parsed.data;
    if (d.provider !== undefined) crud.setSettingValue('provider', d.provider);
    if (d.model !== undefined) crud.setSettingValue('model', d.model);
    if (d.openaiCompatBaseUrl !== undefined) {
      crud.setSettingValue('openaiCompatBaseUrl', d.openaiCompatBaseUrl.trim());
    }
    if (d.openaiCompatModel !== undefined) {
      crud.setSettingValue('openaiCompatModel', d.openaiCompatModel.trim());
    }
    if (d.allowPaidRequests !== undefined) {
      crud.setSettingValue('allowPaidRequests', String(d.allowPaidRequests));
    }
    if (d.enableSearchGrounding !== undefined) {
      crud.setSettingValue('enableSearchGrounding', String(d.enableSearchGrounding));
    }
    if (d.syncIntervalMinutes !== undefined) {
      crud.setSettingValue('syncIntervalMinutes', String(d.syncIntervalMinutes));
    }
    if (d.accountHandle !== undefined) {
      crud.setSettingValue('accountHandle', d.accountHandle.trim());
    }
    if (d.permittedEvidencePaths !== undefined) {
      crud.setSettingValue('permittedEvidencePaths', JSON.stringify(d.permittedEvidencePaths));
    }
    res.json(buildSettingsResponse());
  });

  app.post('/api/settings/test-llm', async (req, res) => {
    const schema = z.object({
      provider: z.enum(['gemini', 'openai_compatible']).optional(),
      model: z.string().optional(),
      openaiCompatBaseUrl: z.string().optional(),
      openaiCompatModel: z.string().optional(),
      allowPaidRequests: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid test payload.' });
      return;
    }
    try {
      const result = await testLLMConnection(parsed.data);
      res.json(result);
    } catch (err) {
      if (err instanceof LLMConfigurationError) {
        res.status(err.statusCode).json({ ok: false, error: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Test failed' });
    }
  });

  // Vite or Static Frontend Mounting
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`COSMICLABS Make.fun Command Center listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
