import crypto from 'node:crypto';
import type { PromptSource } from '../src/types/command-center.ts';

export function canonicalSnapshotJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalSnapshotJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalSnapshotJson(record[key])}`).join(',')}}`;
}

export function computeSnapshotHashes(input: {
  competition: Record<string, unknown> | null;
  requirements: Record<string, unknown> | null;
  leaderboard: Record<string, unknown> | null;
  kit: Record<string, unknown> | null;
  prompt: string;
  promptSource: PromptSource | null;
}): { contentHash: string; rulesHash: string } {
  const hash = (value: unknown) => crypto.createHash('sha256').update(canonicalSnapshotJson(value)).digest('hex');
  const source = input.promptSource ? { kind: input.promptSource.kind, locator: input.promptSource.locator, bountySlug: input.promptSource.bountySlug } : null;
  const contentHash = hash({ ...input, promptSource: source });
  // Explicit activity/accounting collections cannot define submission rules. Retain every
  // other current or future competition field (including deadlines, judging and prerequisites).
  const mutable = new Set(['submissions', 'entries', 'chat', 'messages', 'comments', 'commentCount', 'activity', 'activityFeed',
    'submissionCount', 'entryCount', 'participantCount', 'potUsd', 'rewardAmount', 'rewards', 'rewardsNow', 'entryFeePayers',
    'walletPaid', 'prizesPaid', 'payouts', 'paidOutUsd', 'escrowBalance', 'currentPotUsd', 'escrow', 'transactions',
    'paymentTransactions', 'rewardClaims', 'updatedAt', 'lastActivityAt', 'viewCount', 'leaderboard']);
  const competition = input.competition ? Object.fromEntries(Object.entries(input.competition).filter(([key]) => !mutable.has(key))) : null;
  const rulesHash = hash({ competition, requirements: input.requirements, kit: input.kit, prompt: input.prompt, promptSource: source });
  return { contentHash, rulesHash };
}
