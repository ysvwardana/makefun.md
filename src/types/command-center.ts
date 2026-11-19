import type { AnalysisEvidence, PromptSource } from './enhancement.ts';
export type { AnalysisEvidence, PromptSource, GateCoverage, GlobalSyncStatus } from './enhancement.ts';

export type SyncState = 'LIVE' | 'STALE' | 'OFFLINE' | 'UNVERIFIED';

export type LLMProviderId = 'openai_compatible';

export type SubmissionStatus = 'submitted' | 'accepted' | 'judged' | 'awarded' | 'rejected';

export type ClaimStatus = 'announced' | 'awarded_unclaimed' | 'claimed_received';

export type SkillSource = 'official_bounty' | 'official_mcp' | 'ai_curated' | 'founder_custom';

export type SkillPriority = 'essential' | 'recommended' | 'optional';

export interface RecommendedSkill {
  id: string;
  name: string;
  category: string;
  source: SkillSource;
  priority: SkillPriority;
  rationale: string;
  agentDirective: string;
  enabled: boolean;
}

export interface PrerequisiteItem {
  id?: string;
  name: string;
  required: boolean;
  url?: string;
  why?: string;
  how_to_check?: string;
  fix?: string;
  tell_person?: string;
  platforms?: string[];
  version?: string;
}

export interface PrerequisitesData {
  as_of?: string;
  label?: string;
  summary?: string;
  if_unmet?: string;
  software?: PrerequisiteItem[];
  accounts?: PrerequisiteItem[];
  mcp?: PrerequisiteItem[];
}

export interface LeaderboardEntryInsight {
  rank: number | null;
  handle: string;
  title: string;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  isBaseline: boolean;
  isAccountMatch: boolean;
  display: Record<string, string>;
}

export interface LeaderboardGapInsights {
  rankKey: string;
  rankKeyTitle: string;
  totalRanked: number;
  topEntries: LeaderboardEntryInsight[];
  houseBaseline: LeaderboardEntryInsight | null;
  accountEntry: LeaderboardEntryInsight | null;
  gapSummary: string;
}

export interface TranscriptGateCheckResult {
  gateId:
    | 'transcripts_present'
    | 'thinking_wellformed'
    | 'thinking_in_window'
    | 'thinking_committed'
    | 'thinking_reproduces'
    | 'thinking_turns'
    | 'thinking_priced'
    | 'thinking_revised'
    | 'thinking_fresh';
  title: string;
  status: 'pass' | 'fail' | 'warn' | 'manual_at_submit';
  detail: string;
}

export interface TranscriptGateReport {
  checkedAt: string;
  bountySlug: string | null;
  parsedRecords: number;
  assistantTextTurns: number;
  toolEditTurns: number;
  timestampsCount: number;
  usageRecordsCount: number;
  anchorDetected: boolean;
  overallReady: boolean;
  checks: TranscriptGateCheckResult[];
}

export interface BountyRecord {
  slug: string;
  id: string;
  title: string;
  url: string;
  category: string;
  skills: string[];
  rewardAmount: number;
  potUsd: number;
  entryFeeUsd: number | null;
  deadline: string | null;
  publishedAt: string | null;
  status: string;
  submissionCount: number;
  sponsorName: string | null;
  sponsorVerified: boolean;
  summary: string | null;
  harnessKind: string | null;
  acceptingSubmissions: boolean;
  isDemo: boolean;
  syncState: SyncState;
  lastSyncedAt: string;
  watchlisted: boolean;
  founderNotes: string;
  prerequisites?: PrerequisitesData | null;
}

export interface BountySnapshot {
  id: number;
  bountySlug: string;
  sourceEndpoint: string;
  rawCompetition: Record<string, unknown> | null;
  rawRequirements: Record<string, unknown> | null;
  rawLeaderboard: Record<string, unknown> | null;
  rawKit: Record<string, unknown> | null;
  officialPromptText: string;
  manualPromptOverride: string | null;
  fetchedAt: string;
  contentHash: string;
  promptSource?: PromptSource | null;
  refreshIssues?: string[];
  requirementsComplete?: boolean;
  rulesHash?: string;
}

export interface ResearchReference {
  title: string;
  url: string;
  sourceType:
    | 'google_search'
    | 'makefun_kit'
    | 'official_docs'
    | 'github_public'
    | 'wikipedia_api'
    | 'model_note';
  relevance: string;
}

export interface PriorityItem {
  criterion: string;
  weightOrEmphasis: string;
  actionableFocus: string;
}

export interface AIAnalysisRecord {
  id: string;
  bountySlug: string;
  provider: LLMProviderId;
  model: string;
  stageStatus: string;
  objectiveSummary: string;
  mandatoryRequirements: string[];
  judgingCriteria: string[];
  recommendedApproach: string;
  differentiationStrategy: string;
  architectureOrMethodology: string;
  priorityMatrix: PriorityItem[];
  implementationGuidance: string[];
  qualityStandards: string[];
  testingValidation: string[];
  complianceConsiderations: string[];
  assumptionsUncertainties: string[];
  risks: string[];
  researchReferences: ResearchReference[];
  researchDisclosures: string;
  recommendedSkills?: RecommendedSkill[];
  evidence?: AnalysisEvidence | null;
  part2AiEnhancement?: string | null;
  part3ExecutionGuidelines?: string | null;
  tokenUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  createdAt: string;
}

export interface PromptVersionRecord {
  id: string;
  draftId: string;
  bountySlug: string;
  versionNumber: number;
  analysisId: string | null;
  sourceSnapshotId?: number | null;
  sourceRulesHash?: string | null;
  provenanceStatus?: 'verified' | 'legacy_unverified';
  part1OriginalPrompt: string;
  part2AiEnhancement: string;
  part3ExecutionGuidelines: string;
  founderInstructions: string;
  selectedSkills?: RecommendedSkill[];
  fullMarkdown: string;
  editSummary: string;
  createdBy: string;
  createdAt: string;
}

export interface PromptDraftRecord {
  id: string;
  bountySlug: string;
  bountyTitle?: string;
  bountyCategory?: string;
  title: string;
  latestVersionId: string | null;
  founderNotes: string;
  createdAt: string;
  updatedAt: string;
  latestVersion?: PromptVersionRecord | null;
  versionCount?: number;
}

export interface HermesEvidenceRecord {
  id: string;
  bountySlug: string | null;
  sourceType: 'session_export' | 'local_log' | 'project_artifact';
  sourcePathOrName: string;
  sessionId: string | null;
  summary: string;
  rawContent: string;
  metadata: {
    turnCount?: number;
    timestampsFound?: number;
    modelsMentioned?: string[];
    byteSize?: number;
    readOnlyVerified?: boolean;
  };
  importedAt: string;
}

export interface SubmissionRecord {
  id: string;
  bountySlug: string;
  bountyTitle?: string;
  hunterHandle: string;
  entryTitle: string;
  commitSha: string | null;
  repoUrl: string | null;
  status: SubmissionStatus;
  rank: number | null;
  scoreDisplay: string | null;
  source: 'makefun_api' | 'manual_verified';
  verifiedAt: string;
  rawJson: string | null;
}

export interface RewardRecord {
  id: string;
  bountySlug: string;
  bountyTitle?: string;
  announcedPrizeUsd: number;
  verifiedAwardUsd: number;
  receivedUsd: number;
  txSignature: string | null;
  claimStatus: ClaimStatus;
  verifiedAt: string;
  notes: string;
}

export interface ModelOption {
  id: string;
  label: string;
  provider: LLMProviderId;
  tier: 'free' | 'paid';
  description: string;
  supportsGrounding: boolean;
}

export interface AppSettings {
  provider: LLMProviderId;
  model: string;
  openaiCompatBaseUrl: string;
  openaiCompatModel: string;
  syncIntervalMinutes: number;
  accountHandle: string;
  permittedEvidencePaths: string[];
  lastGlobalSyncAt: string | null;
  nextCursor: string | null;
  credentialStatus: {
    openaiCompatKeyConfigured: boolean;
  };
  availableModels: ModelOption[];
}
