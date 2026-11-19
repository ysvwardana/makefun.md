import type { BountySnapshot } from '../src/types/command-center.ts';

/** UI projection only. The immutable raw snapshot and model evidence stay unchanged in SQLite. */
export function studioSnapshot(snapshot: BountySnapshot | null): BountySnapshot | null {
  if (!snapshot) return null;
  const activity = new Set(['submissions', 'entries', 'chat', 'messages', 'comments', 'activity', 'activityFeed', 'payouts', 'transactions', 'paymentTransactions', 'rewardClaims']);
  const omitted = Object.keys(snapshot.rawCompetition || {}).filter((key) => activity.has(key));
  const competition = snapshot.rawCompetition ? Object.fromEntries(Object.entries(snapshot.rawCompetition).filter(([key]) => !activity.has(key))) : null;
  const entries = snapshot.rawLeaderboard?.entries;
  const limited = Array.isArray(entries) && entries.length > 20;
  const leaderboard = limited ? { ...snapshot.rawLeaderboard, entries: entries.slice(0, 20), uiTotalEntries: entries.length } : snapshot.rawLeaderboard;
  const notes = [...(snapshot.refreshIssues || [])];
  if (omitted.length) notes.push(`UI projection excludes optional activity fields: ${omitted.join(', ')}. Full raw source remains stored in snapshot #${snapshot.id}.`);
  if (limited) notes.push(`UI leaderboard preview shows 20 of ${entries.length} entries. This is not a complete leaderboard; model context inclusion is recorded separately.`);
  return { ...snapshot, rawCompetition: competition, rawLeaderboard: leaderboard, refreshIssues: notes };
}
