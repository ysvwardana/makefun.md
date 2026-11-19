import type { BountyRecord, BountySnapshot } from '../src/types/command-center.ts';

export function publicSnapshot(snapshot: BountySnapshot | null) {
  return snapshot ? { id: snapshot.id, fetchedAt: snapshot.fetchedAt, contentHash: snapshot.contentHash, rulesHash: snapshot.rulesHash || '' } : null;
}

export class EnhancementPreflightError extends Error {
  constructor(message: string, public statusCode: number, public details: Record<string, unknown>) { super(message); }
}

export async function prepareEnhancement(
  input: { slug: string; useCachedSnapshotId?: number },
  deps: {
    refresh: (slug: string) => Promise<{ bounty: BountyRecord | null; snapshot: BountySnapshot | null; error?: string; refreshIssues?: string[]; requirementsComplete?: boolean }>;
    getSnapshot: (id: number) => BountySnapshot | null;
    getCached: (slug: string) => BountySnapshot | null;
    getBounty: (slug: string) => BountyRecord | null;
  },
) {
  const cached = deps.getCached(input.slug);
  let refreshed: Awaited<ReturnType<typeof deps.refresh>>;
  try { refreshed = await deps.refresh(input.slug); }
  catch { refreshed = { bounty: deps.getBounty(input.slug), snapshot: null, error: 'Official detail and requirements refresh failed.', refreshIssues: ['detail', 'requirements'] }; }
  const issues = [...(refreshed.refreshIssues || [])];
  if (refreshed.error && !issues.includes(refreshed.error)) issues.push(refreshed.error);
  const complete = Boolean(refreshed.snapshot?.requirementsComplete && refreshed.snapshot.rawRequirements && !refreshed.error);
  let snapshot = refreshed.snapshot;
  let usedCache = false;
  if (input.useCachedSnapshotId !== undefined) {
    snapshot = deps.getSnapshot(input.useCachedSnapshotId);
    if (!snapshot || snapshot.bountySlug !== input.slug || !snapshot.requirementsComplete || !snapshot.promptSource) {
      throw new EnhancementPreflightError('Cached snapshot is missing, incomplete, or belongs to another bounty.', 409, { refreshIssues: issues });
    }
    usedCache = true;
  } else if (!complete) {
    throw new EnhancementPreflightError('Detail atau requirements bounty gagal diperbarui. Tinjau kegagalan atau pilih snapshot cache secara eksplisit.', 409, {
      refreshIssues: issues.length ? issues : ['Requirements or active gate manifest is incomplete.'],
      cacheAvailable: Boolean(cached?.requirementsComplete && cached.promptSource),
      cachedSnapshot: publicSnapshot(cached?.requirementsComplete && cached.promptSource ? cached : null),
    });
  }
  const currentBounty = refreshed.bounty || deps.getBounty(input.slug);
  // A cache run must not mix a newer list row into the older captured rule context.
  const bounty = usedCache && currentBounty ? {
    ...currentBounty,
    ...(typeof snapshot?.rawCompetition?.title === 'string' ? { title: snapshot.rawCompetition.title } : {}),
    ...(typeof snapshot?.rawCompetition?.category === 'string' ? { category: snapshot.rawCompetition.category } : {}),
    ...(typeof snapshot?.rawCompetition?.deadline === 'string' ? { deadline: snapshot.rawCompetition.deadline } : {}),
  } : currentBounty;
  if (!bounty || bounty.slug !== input.slug || !snapshot || snapshot.bountySlug !== input.slug) {
    throw new EnhancementPreflightError('Bounty context does not match the selected bounty.', 409, {});
  }
  const text = snapshot.promptSource?.kind === 'manual' ? snapshot.manualPromptOverride : snapshot.officialPromptText;
  if (!snapshot.promptSource || snapshot.promptSource.bountySlug !== input.slug || !text?.trim()) {
    throw new EnhancementPreflightError('Prompt standar persis belum tersedia. Tempel prompt standar Make.fun sebagai input manual untuk bounty ini.', 422, { promptMissing: true, snapshot, refreshIssues: issues });
  }
  return { bounty, snapshot, usedCache, currentSnapshot: complete ? publicSnapshot(refreshed.snapshot) : null, refreshIssues: issues };
}
