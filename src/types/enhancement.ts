export interface PromptSource {
  kind: 'official_api' | 'manual';
  locator: string;
  capturedAt: string;
  bountySlug: string;
}

export interface GateCoverage {
  gateId: string;
  status: 'covered' | 'uncovered';
  verification: string;
  evidence: string;
  reason: string;
}

export interface AnalysisEvidence {
  snapshotId: number;
  snapshotHash: string;
  rulesHash: string;
  contextHash: string;
  contextFetchedAt: string;
  usedCache: boolean;
  promptSource: PromptSource;
  gateCoverage: GateCoverage[];
  contextSections: string[];
}

export interface GlobalSyncStatus {
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}
