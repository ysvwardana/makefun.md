import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const bounties = sqliteTable('bounties', {
  slug: text('slug').primaryKey(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  category: text('category').notNull(),
  skillsJson: text('skills_json').notNull().default('[]'),
  rewardAmount: real('reward_amount').notNull().default(0),
  potUsd: real('pot_usd').notNull().default(0),
  entryFeeUsd: real('entry_fee_usd'),
  deadline: text('deadline'),
  publishedAt: text('published_at'),
  status: text('status').notNull().default('open'),
  submissionCount: integer('submission_count').notNull().default(0),
  sponsorName: text('sponsor_name'),
  sponsorVerified: integer('sponsor_verified', { mode: 'boolean' }).notNull().default(false),
  summary: text('summary'),
  harnessKind: text('harness_kind'),
  acceptingSubmissions: integer('accepting_submissions', { mode: 'boolean' }).notNull().default(false),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  syncState: text('sync_state').notNull().default('UNVERIFIED'),
  lastSyncedAt: text('last_synced_at').notNull(),
  watchlisted: integer('watchlisted', { mode: 'boolean' }).notNull().default(false),
  founderNotes: text('founder_notes').notNull().default(''),
  prerequisitesJson: text('prerequisites_json'),
});

export const bountySnapshots = sqliteTable(
  'bounty_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bountySlug: text('bounty_slug')
      .notNull()
      .references(() => bounties.slug, { onDelete: 'cascade' }),
    sourceEndpoint: text('source_endpoint').notNull(),
    rawCompetitionJson: text('raw_competition_json'),
    rawRequirementsJson: text('raw_requirements_json'),
    rawLeaderboardJson: text('raw_leaderboard_json'),
    rawKitJson: text('raw_kit_json'),
    officialPromptText: text('official_prompt_text').notNull().default(''),
    manualPromptOverride: text('manual_prompt_override'),
    promptSourceJson: text('prompt_source_json'),
    refreshIssuesJson: text('refresh_issues_json'),
    requirementsComplete: integer('requirements_complete', { mode: 'boolean' }).notNull().default(false),
    rulesHash: text('rules_hash').notNull().default(''),
    fetchedAt: text('fetched_at').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  (table) => [index('idx_snapshots_slug_fetched').on(table.bountySlug, table.fetchedAt)]
);

export const aiAnalyses = sqliteTable(
  'ai_analyses',
  {
    id: text('id').primaryKey(),
    bountySlug: text('bounty_slug')
      .notNull()
      .references(() => bounties.slug, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    stageStatus: text('stage_status').notNull(),
    objectiveSummary: text('objective_summary').notNull(),
    mandatoryRequirementsJson: text('mandatory_requirements_json').notNull(),
    judgingCriteriaJson: text('judging_criteria_json').notNull(),
    recommendedApproach: text('recommended_approach').notNull(),
    differentiationStrategy: text('differentiation_strategy').notNull(),
    architectureOrMethodology: text('architecture_or_methodology').notNull(),
    priorityMatrixJson: text('priority_matrix_json').notNull(),
    implementationGuidanceJson: text('implementation_guidance_json').notNull(),
    qualityStandardsJson: text('quality_standards_json').notNull(),
    testingValidationJson: text('testing_validation_json').notNull(),
    complianceConsiderationsJson: text('compliance_considerations_json').notNull(),
    assumptionsUncertaintiesJson: text('assumptions_uncertainties_json').notNull(),
    risksJson: text('risks_json').notNull(),
    researchReferencesJson: text('research_references_json').notNull(),
    researchDisclosures: text('research_disclosures').notNull().default(''),
    recommendedSkillsJson: text('recommended_skills_json'),
    evidenceJson: text('evidence_json'),
    rawLlmResponse: text('raw_llm_response').notNull().default(''),
    tokenUsageJson: text('token_usage_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_analyses_slug_created').on(table.bountySlug, table.createdAt)]
);

export const promptDrafts = sqliteTable('prompt_drafts', {
  id: text('id').primaryKey(),
  bountySlug: text('bounty_slug')
    .notNull()
    .unique()
    .references(() => bounties.slug, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  latestVersionId: text('latest_version_id'),
  founderNotes: text('founder_notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const promptVersions = sqliteTable(
  'prompt_versions',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => promptDrafts.id, { onDelete: 'cascade' }),
    bountySlug: text('bounty_slug')
      .notNull()
      .references(() => bounties.slug, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    analysisId: text('analysis_id'),
    sourceSnapshotId: integer('source_snapshot_id'),
    sourceRulesHash: text('source_rules_hash'),
    provenanceStatus: text('provenance_status').notNull().default('legacy_unverified'),
    part1OriginalPrompt: text('part1_original_prompt').notNull(),
    part2AiEnhancement: text('part2_ai_enhancement').notNull(),
    part3ExecutionGuidelines: text('part3_execution_guidelines').notNull(),
    founderInstructions: text('founder_instructions').notNull().default(''),
    selectedSkillsJson: text('selected_skills_json'),
    fullMarkdown: text('full_markdown').notNull(),
    editSummary: text('edit_summary').notNull().default(''),
    createdBy: text('created_by').notNull().default('Founder'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_prompt_versions_draft').on(table.draftId, table.versionNumber)]
);

export const hermesEvidence = sqliteTable('hermes_evidence', {
  id: text('id').primaryKey(),
  bountySlug: text('bounty_slug'),
  sourceType: text('source_type').notNull(),
  sourcePathOrName: text('source_path_or_name').notNull(),
  sessionId: text('session_id'),
  summary: text('summary').notNull(),
  rawContent: text('raw_content').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  importedAt: text('imported_at').notNull(),
});

export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(),
  bountySlug: text('bounty_slug').notNull(),
  hunterHandle: text('hunter_handle').notNull(),
  entryTitle: text('entry_title').notNull(),
  commitSha: text('commit_sha'),
  repoUrl: text('repo_url'),
  status: text('status').notNull(),
  rank: integer('rank'),
  scoreDisplay: text('score_display'),
  source: text('source').notNull(),
  verifiedAt: text('verified_at').notNull(),
  rawJson: text('raw_json'),
});

export const rewards = sqliteTable('rewards', {
  id: text('id').primaryKey(),
  bountySlug: text('bounty_slug').notNull(),
  announcedPrizeUsd: real('announced_prize_usd').notNull().default(0),
  verifiedAwardUsd: real('verified_award_usd').notNull().default(0),
  receivedUsd: real('received_usd').notNull().default(0),
  txSignature: text('tx_signature'),
  claimStatus: text('claim_status').notNull(),
  verifiedAt: text('verified_at').notNull(),
  notes: text('notes').notNull().default(''),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Drizzle Relations
export const bountiesRelations = relations(bounties, ({ many, one }) => ({
  snapshots: many(bountySnapshots),
  analyses: many(aiAnalyses),
  promptDraft: one(promptDrafts, {
    fields: [bounties.slug],
    references: [promptDrafts.bountySlug],
  }),
  promptVersions: many(promptVersions),
}));

export const bountySnapshotsRelations = relations(bountySnapshots, ({ one }) => ({
  bounty: one(bounties, {
    fields: [bountySnapshots.bountySlug],
    references: [bounties.slug],
  }),
}));

export const aiAnalysesRelations = relations(aiAnalyses, ({ one }) => ({
  bounty: one(bounties, {
    fields: [aiAnalyses.bountySlug],
    references: [bounties.slug],
  }),
}));

export const promptDraftsRelations = relations(promptDrafts, ({ one, many }) => ({
  bounty: one(bounties, {
    fields: [promptDrafts.bountySlug],
    references: [bounties.slug],
  }),
  versions: many(promptVersions),
}));

export const promptVersionsRelations = relations(promptVersions, ({ one }) => ({
  draft: one(promptDrafts, {
    fields: [promptVersions.draftId],
    references: [promptDrafts.id],
  }),
  bounty: one(bounties, {
    fields: [promptVersions.bountySlug],
    references: [bounties.slug],
  }),
}));

export const drizzleSchema = {
  bounties,
  bountySnapshots,
  aiAnalyses,
  promptDrafts,
  promptVersions,
  hermesEvidence,
  submissions,
  rewards,
  appSettings,
  bountiesRelations,
  bountySnapshotsRelations,
  aiAnalysesRelations,
  promptDraftsRelations,
  promptVersionsRelations,
};

export type BountySelectRow = typeof bounties.$inferSelect;
export type BountyInsertRow = typeof bounties.$inferInsert;
export type BountySnapshotSelectRow = typeof bountySnapshots.$inferSelect;
export type AIAnalysisSelectRow = typeof aiAnalyses.$inferSelect;
export type PromptDraftSelectRow = typeof promptDrafts.$inferSelect;
export type PromptVersionSelectRow = typeof promptVersions.$inferSelect;
export type HermesEvidenceSelectRow = typeof hermesEvidence.$inferSelect;
export type SubmissionSelectRow = typeof submissions.$inferSelect;
export type RewardSelectRow = typeof rewards.$inferSelect;
export type AppSettingSelectRow = typeof appSettings.$inferSelect;
