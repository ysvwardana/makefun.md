import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import { drizzleSchema } from './schema.ts';
import { renderGateChecklist } from './enhancement-context.ts';
import type {
  AIAnalysisRecord,
  BountyRecord,
  BountySnapshot,
  AnalysisEvidence,
  HermesEvidenceRecord,
  LLMProviderId,
  ModelOption,
  PrerequisitesData,
  PromptDraftRecord,
  PromptSource,
  PromptVersionRecord,
  RecommendedSkill,
  RewardRecord,
  SubmissionRecord,
  SyncState,
} from '../src/types/command-center.ts';
import type {
  AIAnalysisSelectRow,
  BountySelectRow,
  BountySnapshotSelectRow,
  HermesEvidenceSelectRow,
  PromptDraftSelectRow,
  PromptVersionSelectRow,
  RewardSelectRow,
  SubmissionSelectRow,
} from './schema.ts';

export type CommandCenterDatabase = BetterSQLite3Database<typeof drizzleSchema>;

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'openai-compatible-custom',
    label: 'OpenAI-Compatible Endpoint',
    provider: 'openai_compatible',
    tier: 'free',
    description: 'Server-configured OpenAI-compatible endpoint (local or hosted; provider pricing may apply).',
    supportsGrounding: false,
  },
];

export function initSqliteSchema(sqlite: Database.Database): void {
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bounties (
      slug TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      skills_json TEXT NOT NULL DEFAULT '[]',
      reward_amount REAL NOT NULL DEFAULT 0,
      pot_usd REAL NOT NULL DEFAULT 0,
      entry_fee_usd REAL,
      deadline TEXT,
      published_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      submission_count INTEGER NOT NULL DEFAULT 0,
      sponsor_name TEXT,
      sponsor_verified INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      harness_kind TEXT,
      accepting_submissions INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      sync_state TEXT NOT NULL DEFAULT 'UNVERIFIED',
      last_synced_at TEXT NOT NULL,
      watchlisted INTEGER NOT NULL DEFAULT 0,
      founder_notes TEXT NOT NULL DEFAULT '',
      prerequisites_json TEXT
    );

    CREATE TABLE IF NOT EXISTS bounty_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bounty_slug TEXT NOT NULL,
      source_endpoint TEXT NOT NULL,
      raw_competition_json TEXT,
      raw_requirements_json TEXT,
      raw_leaderboard_json TEXT,
      raw_kit_json TEXT,
      official_prompt_text TEXT NOT NULL DEFAULT '',
      manual_prompt_override TEXT,
       prompt_source_json TEXT,
       refresh_issues_json TEXT,
       requirements_complete INTEGER NOT NULL DEFAULT 0,
       rules_hash TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      FOREIGN KEY (bounty_slug) REFERENCES bounties(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_slug_fetched
      ON bounty_snapshots(bounty_slug, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id TEXT PRIMARY KEY,
      bounty_slug TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      stage_status TEXT NOT NULL,
      objective_summary TEXT NOT NULL,
      mandatory_requirements_json TEXT NOT NULL,
      judging_criteria_json TEXT NOT NULL,
      recommended_approach TEXT NOT NULL,
      differentiation_strategy TEXT NOT NULL,
      architecture_or_methodology TEXT NOT NULL,
      priority_matrix_json TEXT NOT NULL,
      implementation_guidance_json TEXT NOT NULL,
      quality_standards_json TEXT NOT NULL,
      testing_validation_json TEXT NOT NULL,
      compliance_considerations_json TEXT NOT NULL,
      assumptions_uncertainties_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      research_references_json TEXT NOT NULL,
      research_disclosures TEXT NOT NULL DEFAULT '',
      recommended_skills_json TEXT,
       evidence_json TEXT,
      raw_llm_response TEXT NOT NULL DEFAULT '',
      token_usage_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bounty_slug) REFERENCES bounties(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_slug_created
      ON ai_analyses(bounty_slug, created_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_drafts (
      id TEXT PRIMARY KEY,
      bounty_slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      latest_version_id TEXT,
      founder_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bounty_slug) REFERENCES bounties(slug) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      bounty_slug TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      analysis_id TEXT,
       source_snapshot_id INTEGER,
       source_rules_hash TEXT,
       provenance_status TEXT NOT NULL DEFAULT 'legacy_unverified',
      part1_original_prompt TEXT NOT NULL,
      part2_ai_enhancement TEXT NOT NULL,
      part3_execution_guidelines TEXT NOT NULL,
      founder_instructions TEXT NOT NULL DEFAULT '',
      selected_skills_json TEXT,
      full_markdown TEXT NOT NULL,
      edit_summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'Founder',
      created_at TEXT NOT NULL,
      FOREIGN KEY (draft_id) REFERENCES prompt_drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (bounty_slug) REFERENCES bounties(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_versions_draft
      ON prompt_versions(draft_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS hermes_evidence (
      id TEXT PRIMARY KEY,
      bounty_slug TEXT,
      source_type TEXT NOT NULL,
      source_path_or_name TEXT NOT NULL,
      session_id TEXT,
      summary TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      bounty_slug TEXT NOT NULL,
      hunter_handle TEXT NOT NULL,
      entry_title TEXT NOT NULL,
      commit_sha TEXT,
      repo_url TEXT,
      status TEXT NOT NULL,
      rank INTEGER,
      score_display TEXT,
      source TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      bounty_slug TEXT NOT NULL,
      announced_prize_usd REAL NOT NULL DEFAULT 0,
      verified_award_usd REAL NOT NULL DEFAULT 0,
      received_usd REAL NOT NULL DEFAULT 0,
      tx_signature TEXT,
      claim_status TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Serialize incremental DDL so concurrent application/test connections cannot race ALTER TABLE.
  const migrateColumns = sqlite.transaction(() => {
  const bountyCols = sqlite.prepare('PRAGMA table_info(bounties)').all() as Array<{ name: string }>;
  if (!bountyCols.some((c) => c.name === 'prerequisites_json')) {
    sqlite.exec('ALTER TABLE bounties ADD COLUMN prerequisites_json TEXT');
  }
  const addMissingColumns = (table: string, columns: Record<string, string>) => {
    const existing = new Set(
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
    );
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  addMissingColumns('bounty_snapshots', {
    prompt_source_json: 'TEXT',
    refresh_issues_json: 'TEXT',
    requirements_complete: 'INTEGER NOT NULL DEFAULT 0',
    rules_hash: "TEXT NOT NULL DEFAULT ''",
  });
  addMissingColumns('ai_analyses', {
    recommended_skills_json: 'TEXT',
    evidence_json: 'TEXT',
  });
  addMissingColumns('prompt_versions', {
    selected_skills_json: 'TEXT',
    source_snapshot_id: 'INTEGER',
    source_rules_hash: 'TEXT',
    provenance_status: "TEXT NOT NULL DEFAULT 'legacy_unverified'",
  });

  const defaults: Record<string, string> = {
    provider: 'openai_compatible',
    openaiCompatModel: 'cx/gpt-6.1-sol',
    syncIntervalMinutes: '30',
    accountHandle: '@0xkeinara',
    permittedEvidencePaths: JSON.stringify(['./evidence']),
    lastGlobalSyncAt: '',
    nextCursor: '',
  };

  const insertSetting = sqlite.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }
  sqlite.prepare('UPDATE app_settings SET value = ? WHERE key = ? AND value <> ?')
    .run(defaults.provider, 'provider', defaults.provider);
  });
  migrateColumns.immediate();
}

export function createDatabaseConnection(dbFilePath?: string): {
  sqlite: Database.Database;
  orm: CommandCenterDatabase;
} {
  const targetPath =
    dbFilePath ||
    process.env.COSMICLABS_DB_PATH ||
    path.join(path.resolve(process.cwd(), 'data'), 'cosmiclabs.db');

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqliteInstance = new Database(targetPath);
  initSqliteSchema(sqliteInstance);
  const ormInstance = drizzle(sqliteInstance, { schema: drizzleSchema });
  return { sqlite: sqliteInstance, orm: ormInstance };
}

const defaultConnection = createDatabaseConnection();
export const db = defaultConnection.sqlite;
export const orm = defaultConnection.orm;

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapBountyRecord(row: BountySelectRow): BountyRecord {
  return {
    slug: row.slug,
    id: row.id,
    title: row.title,
    url: row.url,
    category: row.category || 'Uncategorized',
    skills: safeJsonParse<string[]>(row.skillsJson, []),
    rewardAmount: Number(row.rewardAmount || 0),
    potUsd: Number(row.potUsd || 0),
    entryFeeUsd: row.entryFeeUsd ?? null,
    deadline: row.deadline ?? null,
    publishedAt: row.publishedAt ?? null,
    status: row.status || 'unknown',
    submissionCount: Number(row.submissionCount || 0),
    sponsorName: row.sponsorName ?? null,
    sponsorVerified: Boolean(row.sponsorVerified),
    summary: row.summary ?? null,
    harnessKind: row.harnessKind ?? null,
    acceptingSubmissions: Boolean(row.acceptingSubmissions),
    isDemo: Boolean(row.isDemo),
    syncState: (row.syncState as SyncState) || 'UNVERIFIED',
    lastSyncedAt: row.lastSyncedAt,
    watchlisted: Boolean(row.watchlisted),
    founderNotes: row.founderNotes || '',
    prerequisites: safeJsonParse<PrerequisitesData | null>(row.prerequisitesJson, null),
  };
}

export function mapSnapshotRecord(row: BountySnapshotSelectRow): BountySnapshot {
  return {
    id: Number(row.id),
    bountySlug: row.bountySlug,
    sourceEndpoint: row.sourceEndpoint,
    rawCompetition: safeJsonParse(row.rawCompetitionJson, null),
    rawRequirements: safeJsonParse(row.rawRequirementsJson, null),
    rawLeaderboard: safeJsonParse(row.rawLeaderboardJson, null),
    rawKit: safeJsonParse(row.rawKitJson, null),
    officialPromptText: row.officialPromptText || '',
    manualPromptOverride: row.manualPromptOverride ?? null,
    promptSource: safeJsonParse<PromptSource | null>(row.promptSourceJson, null),
    refreshIssues: safeJsonParse<string[]>(row.refreshIssuesJson, []),
    requirementsComplete: Boolean(row.requirementsComplete),
    rulesHash: row.rulesHash || '',
    fetchedAt: row.fetchedAt,
    contentHash: row.contentHash,
  };
}

export function mapAnalysisRecord(row: AIAnalysisSelectRow): AIAnalysisRecord {
  const evidence = safeJsonParse<AnalysisEvidence | null>(row.evidenceJson, null);
  let recovered: { part2AiEnhancement: string; part3ExecutionGuidelines: string } | null = null;
  if (evidence) {
    const raw = safeJsonParse<Record<string, unknown> | null>(row.rawLlmResponse, null);
    if (typeof raw?.part2AiEnhancement === 'string' && typeof raw?.part3ExecutionGuidelines === 'string') {
      const claims = /\b(guarantee[sd]?\s+(to\s+)?win|100%\s+win|guaranteed\s+victory)\b/gi;
      recovered = {
        part2AiEnhancement: raw.part2AiEnhancement.replace(claims, 'aims to improve competitive positioning'),
        part3ExecutionGuidelines: raw.part3ExecutionGuidelines.replace(claims, 'aims to improve compliance and quality') + '\n\n' + renderGateChecklist(evidence.gateCoverage),
      };
    }
  }
  return {
    id: row.id,
    bountySlug: row.bountySlug,
    provider: row.provider as LLMProviderId,
    model: row.model,
    stageStatus: row.stageStatus,
    objectiveSummary: row.objectiveSummary,
    mandatoryRequirements: safeJsonParse(row.mandatoryRequirementsJson, []),
    judgingCriteria: safeJsonParse(row.judgingCriteriaJson, []),
    recommendedApproach: row.recommendedApproach,
    differentiationStrategy: row.differentiationStrategy,
    architectureOrMethodology: row.architectureOrMethodology,
    priorityMatrix: safeJsonParse(row.priorityMatrixJson, []),
    implementationGuidance: safeJsonParse(row.implementationGuidanceJson, []),
    qualityStandards: safeJsonParse(row.qualityStandardsJson, []),
    testingValidation: safeJsonParse(row.testingValidationJson, []),
    complianceConsiderations: safeJsonParse(row.complianceConsiderationsJson, []),
    assumptionsUncertainties: safeJsonParse(row.assumptionsUncertaintiesJson, []),
    risks: safeJsonParse(row.risksJson, []),
    researchReferences: safeJsonParse(row.researchReferencesJson, []),
    researchDisclosures: row.researchDisclosures || '',
    recommendedSkills: safeJsonParse<RecommendedSkill[]>(row.recommendedSkillsJson, []),
    evidence,
    part2AiEnhancement: recovered?.part2AiEnhancement ?? null,
    part3ExecutionGuidelines: recovered?.part3ExecutionGuidelines ?? null,
    tokenUsage: safeJsonParse(row.tokenUsageJson, null),
    createdAt: row.createdAt,
  };
}

export function mapPromptVersionRecord(row: PromptVersionSelectRow): PromptVersionRecord {
  return {
    id: row.id,
    draftId: row.draftId,
    bountySlug: row.bountySlug,
    versionNumber: Number(row.versionNumber),
    analysisId: row.analysisId ?? null,
    sourceSnapshotId: row.sourceSnapshotId ?? null,
    sourceRulesHash: row.sourceRulesHash ?? null,
    provenanceStatus: row.provenanceStatus === 'verified' ? 'verified' : 'legacy_unverified',
    part1OriginalPrompt: row.part1OriginalPrompt,
    part2AiEnhancement: row.part2AiEnhancement,
    part3ExecutionGuidelines: row.part3ExecutionGuidelines,
    founderInstructions: row.founderInstructions || '',
    selectedSkills: safeJsonParse<RecommendedSkill[]>(row.selectedSkillsJson, []),
    fullMarkdown: row.fullMarkdown,
    editSummary: row.editSummary || '',
    createdBy: row.createdBy || 'Founder',
    createdAt: row.createdAt,
  };
}

export function mapPromptDraftRecord(
  row: PromptDraftSelectRow,
  extras?: { bountyTitle?: string | null; bountyCategory?: string | null }
): PromptDraftRecord {
  return {
    id: row.id,
    bountySlug: row.bountySlug,
    bountyTitle: extras?.bountyTitle ?? undefined,
    bountyCategory: extras?.bountyCategory ?? undefined,
    title: row.title,
    latestVersionId: row.latestVersionId ?? null,
    founderNotes: row.founderNotes || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapEvidenceRecord(row: HermesEvidenceSelectRow): HermesEvidenceRecord {
  return {
    id: row.id,
    bountySlug: row.bountySlug ?? null,
    sourceType: row.sourceType as HermesEvidenceRecord['sourceType'],
    sourcePathOrName: row.sourcePathOrName,
    sessionId: row.sessionId ?? null,
    summary: row.summary,
    rawContent: row.rawContent,
    metadata: safeJsonParse(row.metadataJson, {}),
    importedAt: row.importedAt,
  };
}

export function mapSubmissionRecord(
  row: SubmissionSelectRow,
  bountyTitle?: string | null
): SubmissionRecord {
  return {
    id: row.id,
    bountySlug: row.bountySlug,
    bountyTitle: bountyTitle ?? undefined,
    hunterHandle: row.hunterHandle,
    entryTitle: row.entryTitle,
    commitSha: row.commitSha ?? null,
    repoUrl: row.repoUrl ?? null,
    status: row.status as SubmissionRecord['status'],
    rank: row.rank ?? null,
    scoreDisplay: row.scoreDisplay ?? null,
    source: row.source as SubmissionRecord['source'],
    verifiedAt: row.verifiedAt,
    rawJson: row.rawJson ?? null,
  };
}

export function mapRewardRecord(
  row: RewardSelectRow,
  bountyTitle?: string | null
): RewardRecord {
  return {
    id: row.id,
    bountySlug: row.bountySlug,
    bountyTitle: bountyTitle ?? undefined,
    announcedPrizeUsd: Number(row.announcedPrizeUsd || 0),
    verifiedAwardUsd: Number(row.verifiedAwardUsd || 0),
    receivedUsd: Number(row.receivedUsd || 0),
    txSignature: row.txSignature ?? null,
    claimStatus: row.claimStatus as RewardRecord['claimStatus'],
    verifiedAt: row.verifiedAt,
    notes: row.notes || '',
  };
}
