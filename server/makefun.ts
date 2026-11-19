import crypto from 'node:crypto';
import { crud } from './crud.ts';
import { canonicalSnapshotJson, computeSnapshotHashes } from './snapshot-hash.ts';
export { computeSnapshotHashes } from './snapshot-hash.ts';
const hashContent = (value: unknown) => crypto.createHash('sha256').update(canonicalSnapshotJson(value)).digest('hex');
import type {
  BountyRecord,
  BountySnapshot,
  LeaderboardEntryInsight,
  LeaderboardGapInsights,
  PrerequisitesData,
  PromptSource,
  GlobalSyncStatus,
  SyncState,
} from '../src/types/command-center.ts';

const MAKEFUN_BASE = 'https://make.fun';
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

interface MakefunCompetitionListItem {
  id?: string;
  slug: string;
  title?: string;
  url?: string;
  rewardAmount?: number;
  potUsd?: string | number;
  entryFeeUsd?: number | null;
  deadline?: string | null;
  publishedAt?: string | null;
  status?: string;
  submissionCount?: number;
  sponsor?: {
    name?: string | null;
    slug?: string | null;
    isVerified?: boolean;
  } | null;
  category?: string;
  skills?: string[];
  description?: string;
  summary?: string | null;
  harnessKind?: string | null;
  acceptingSubmissions?: boolean;
  demo?: boolean;
  prerequisites?: PrerequisitesData | null;
  submissions?: Array<{
    id?: string;
    hunter?: string;
    title?: string;
    status?: string;
    score?: unknown;
    createdAt?: string;
    link?: string;
  }>;
}

async function fetchTextReadOnly(url: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; text: string; finalUrl: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/html', 'User-Agent': 'COSMICLABS-CommandCenter/1.0 (read-only)' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, text: '', finalUrl: response.url, error: `HTTP ${response.status}` };
    return { ok: true, status: response.status, text: await response.text(), finalUrl: response.url };
  } catch (err) {
    return { ok: false, status: 0, text: '', finalUrl: '', error: err instanceof Error ? err.message : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonReadOnly(url: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'COSMICLABS-CommandCenter/1.0 (read-only)',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

const STANDARD_PROMPT_FIELDS = ['standardPrompt', 'standard_prompt', 'promptText', 'prompt_text', 'prompt'] as const;

/** Extract only a dedicated prompt field, preserving its exact string value and provenance. */
export function extractPromptSource(
  competition: Record<string, unknown> | null,
  requirements: Record<string, unknown> | null,
  slug: string,
  fetchedAt: string,
  endpoint: string,
  pageHtml?: string | null,
  pageEndpoint?: string
): { text: string; source: PromptSource | null } {
  const requirementsEndpoint = endpoint.includes('/requirements')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/requirements?format=json`;
  for (const [record, recordEndpoint] of [
    [competition, endpoint],
    [requirements, requirementsEndpoint],
  ] as const) {
    if (!record) continue;
    for (const field of STANDARD_PROMPT_FIELDS) {
      if (typeof record[field] === 'string' && (record[field] as string).trim().length > 0) {
        return {
          text: record[field] as string,
          source: { kind: 'official_api', locator: `${recordEndpoint}#/${field}`, capturedAt: fetchedAt, bountySlug: slug },
        };
      }
    }
  }

  if (pageHtml != null && pageEndpoint) {
    const pageSlug = /\/bounty\/([^/?#]+)/.exec(new URL(pageEndpoint).pathname)?.[1];
    const matches = Array.from(pageHtml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi))
      .filter((match) => {
        const classAttribute = /(?:^|\s)class\s*=\s*(["'])(.*?)\1/i.exec(match[1]);
        return Boolean(classAttribute?.[2].split(/\s+/).includes('crawl-body-prompt'));
      });
    if (pageSlug === slug && matches.length === 1) {
      const decoded = decodeHtmlText(matches[0][2]);
      if (decoded !== null) {
        return {
          text: decoded,
          source: { kind: 'official_api', locator: `${pageEndpoint}#p.crawl-body-prompt`, capturedAt: fetchedAt, bountySlug: slug },
        };
      }
    }
  }
  return { text: '', source: null };
}

function decodeHtmlText(html: string): string | null {
  if (/<[^>]*>/.test(html)) return null;
  let unsupported = false;
  const decoded = html.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (entity, name: string) => {
    const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (name[0] !== '#') {
      const value = named[name.toLowerCase()];
      if (value === undefined) { unsupported = true; return entity; }
      return value;
    }
    const codePoint = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      unsupported = true;
      return entity;
    }
    return String.fromCodePoint(codePoint);
  });
  return unsupported ? null : decoded;
}

/** Backwards-compatible text-only helper; it no longer synthesizes a prompt from surrounding metadata. */
export function extractOfficialPromptText(
  competition: Record<string, unknown> | null,
  requirements: Record<string, unknown> | null
): string {
  return extractPromptSource(competition, requirements, '', '', `${MAKEFUN_BASE}/api/competitions`).text;
}

export function isRequirementsComplete(
  requirements: Record<string, unknown> | null,
  requestedSlug: string
): boolean {
  if (!requirements || !requirements.competition || typeof requirements.competition !== 'object') return false;
  const competition = requirements.competition as Record<string, unknown>;
  if (competition.slug !== requestedSlug) return false;
  if (!Array.isArray(requirements.deliverables) || requirements.deliverables.length === 0) return false;
  if (!Array.isArray(requirements.checks) || requirements.checks.length === 0) return false;
  const checkIds = requirements.checks.map((check) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) return null;
    const row = check as Record<string, unknown>;
    const id = [row.check, row.id].find((value) => typeof value === 'string' && value.trim().length > 0);
    return typeof id === 'string' ? id.trim() : null;
  });
  return checkIds.every((id): id is string => id !== null) && new Set(checkIds).size === checkIds.length;
}

function collectRefreshIssues(input: {
  compRes: { ok: boolean; error?: string };
  reqRes: { ok: boolean; error?: string };
  lbRes: { ok: boolean; error?: string };
  kitRes: { ok: boolean; error?: string };
  comp: Record<string, unknown>;
  reqData: Record<string, unknown> | null;
  requestedSlug: string;
}): string[] {
  const issues: string[] = [];
  for (const [name, result] of [
    ['competition', input.compRes], ['requirements', input.reqRes],
    ['leaderboard', input.lbRes], ['kit', input.kitRes],
  ] as const) {
    if (!result.ok) issues.push(`${name} endpoint failed: ${result.error || 'unknown error'}`);
  }
  if (typeof input.comp.slug !== 'string') issues.push('Competition response is missing its slug.');
  else if (input.comp.slug !== input.requestedSlug) issues.push(`Competition response slug mismatch: requested ${input.requestedSlug}, received ${input.comp.slug}.`);
  const reqCompetition = input.reqData?.competition;
  const reqSlug = reqCompetition && typeof reqCompetition === 'object'
    ? (reqCompetition as Record<string, unknown>).slug : undefined;
  if (typeof reqSlug !== 'string') issues.push('Requirements response is missing competition.slug.');
  else if (reqSlug !== input.requestedSlug) issues.push(`Requirements competition slug mismatch: requested ${input.requestedSlug}, received ${reqSlug}.`);
  if (!isRequirementsComplete(input.reqData, input.requestedSlug)) {
    issues.push('Requirements are incomplete: expected a matching competition, deliverables, and identified checks.');
  }
  return issues;
}

function upsertBountyFromItem(item: MakefunCompetitionListItem, syncState: SyncState, nowIso: string): void {
  const fullUrl = item.url?.startsWith('http')
    ? item.url
    : `${MAKEFUN_BASE}${item.url || `/bounty/${item.slug}`}`;

  const potNum =
    typeof item.potUsd === 'number'
      ? item.potUsd
      : typeof item.potUsd === 'string'
        ? parseFloat(item.potUsd) || Number(item.rewardAmount || 0)
        : Number(item.rewardAmount || 0);

  crud.upsertBounty({
    slug: item.slug,
    id: item.id || item.slug,
    title: item.title || item.slug,
    url: fullUrl,
    category: item.category || 'Uncategorized',
    skills: Array.isArray(item.skills) ? item.skills : [],
    rewardAmount: Number(item.rewardAmount || 0),
    potUsd: potNum,
    entryFeeUsd: item.entryFeeUsd ?? null,
    deadline: item.deadline ?? null,
    publishedAt: item.publishedAt ?? null,
    status: item.status || (item.acceptingSubmissions ? 'open' : 'resolved'),
    submissionCount: Number(item.submissionCount || 0),
    sponsorName: item.sponsor?.name ?? null,
    sponsorVerified: Boolean(item.sponsor?.isVerified),
    summary: item.summary ?? null,
    harnessKind: item.harnessKind ?? null,
    acceptingSubmissions: Boolean(item.acceptingSubmissions || item.status === 'open'),
    isDemo: Boolean(item.demo),
    syncState,
    lastSyncedAt: nowIso,
    prerequisites: item.prerequisites ?? null,
  });
}

function recordMatchingAccountSubmissions(
  slug: string,
  competition: Record<string, unknown> | null,
  leaderboard: Record<string, unknown> | null,
  nowIso: string
): void {
  const configuredHandle = crud.getSettingValue('accountHandle').replace(/^@/, '').trim().toLowerCase();
  if (!configuredHandle) return;

  const subs = Array.isArray(competition?.submissions)
    ? (competition?.submissions as Array<Record<string, unknown>>)
    : [];

  for (const sub of subs) {
    const hunter = String(sub.hunter || '').toLowerCase();
    if (hunter === configuredHandle) {
      const subId = String(sub.id || `${slug}-${hunter}-${sub.createdAt || nowIso}`);
      const rawStatus = String(sub.status || 'submitted').toLowerCase();
      const mappedStatus =
        rawStatus === 'passed' || rawStatus === 'accepted'
          ? 'accepted'
          : rawStatus === 'rejected' || rawStatus === 'failed'
            ? 'rejected'
            : rawStatus === 'awarded'
              ? 'awarded'
              : rawStatus === 'judged'
                ? 'judged'
                : 'submitted';

      crud.upsertSubmission({
        id: subId,
        bountySlug: slug,
        hunterHandle: `@${configuredHandle}`,
        entryTitle: String(sub.title || slug),
        commitSha: null,
        repoUrl: sub.link ? String(sub.link) : null,
        status: mappedStatus,
        rank: null,
        scoreDisplay: sub.score !== undefined && sub.score !== null ? String(sub.score) : null,
        source: 'makefun_api',
        verifiedAt: nowIso,
        rawJson: JSON.stringify(sub),
      });
    }
  }

  const lbEntries = Array.isArray(leaderboard?.entries)
    ? (leaderboard?.entries as Array<Record<string, unknown>>)
    : [];

  for (const entry of lbEntries) {
    const hunter = String(entry.hunter || entry.handle || '').toLowerCase();
    if (hunter === configuredHandle) {
      const entryId = String(entry.submission_id || entry.id || `${slug}-lb-${hunter}`);
      const rank = typeof entry.rank === 'number' ? entry.rank : null;
      const prizeUsd = Number(entry.prize_usd || entry.prizeUsd || 0);
      const status = prizeUsd > 0 ? 'awarded' : 'judged';

      crud.upsertSubmission({
        id: entryId,
        bountySlug: slug,
        hunterHandle: `@${configuredHandle}`,
        entryTitle: String(entry.title || slug),
        commitSha: entry.commit_sha ? String(entry.commit_sha) : null,
        repoUrl: entry.repo_url ? String(entry.repo_url) : null,
        status,
        rank,
        scoreDisplay: entry.score !== undefined && entry.score !== null ? String(entry.score) : null,
        source: 'makefun_api',
        verifiedAt: nowIso,
        rawJson: JSON.stringify(entry),
      });
    }
  }
}

async function syncCompetitionsFromMakefunImpl(options?: {
  cursor?: string | null;
  includeOpenFirst?: boolean;
}): Promise<{
  syncedCount: number;
  openCount: number;
  nextCursor: string | null;
  syncState: SyncState;
  error?: string;
}> {
  const nowIso = new Date().toISOString();
  const seenSlugs = new Set<string>();
  let syncedCount = 0;
  let openCount = 0;
  let openListError: string | undefined;

  if (!options?.cursor && options?.includeOpenFirst !== false) {
    const openRes = await fetchJsonReadOnly(`${MAKEFUN_BASE}/api/competitions?status=open`);
    if (!openRes.ok || !openRes.data || typeof openRes.data !== 'object') {
      openListError = `Open competitions endpoint failed: ${openRes.error || 'invalid response object'}`;
    }
    if (openRes.ok && openRes.data && typeof openRes.data === 'object') {
      const items = (openRes.data as { items?: MakefunCompetitionListItem[] }).items || [];
      for (const item of items) {
        if (!item.slug) continue;
        seenSlugs.add(item.slug);
        upsertBountyFromItem(
          { ...item, status: item.status || 'open', acceptingSubmissions: true },
          'UNVERIFIED',
          nowIso
        );
        if (!crud.hasAnyBountySnapshot(item.slug)) {
          crud.saveBountySnapshot({
            bountySlug: item.slug,
            sourceEndpoint: `${MAKEFUN_BASE}/api/competitions?status=open`,
            rawCompetition: item as unknown as Record<string, unknown>,
            rawRequirements: null,
            rawLeaderboard: null,
            rawKit: null,
            officialPromptText: '',
            fetchedAt: nowIso,
            contentHash: hashContent({ competition: item, requirements: null, leaderboard: null, kit: null, prompt: '' }),
            promptSource: null,
            refreshIssues: ['Requirements, leaderboard, and kit were not fetched by the competition list endpoint.'],
            requirementsComplete: false,
            rulesHash: '',
          });
        }
        syncedCount += 1;
        openCount += 1;
      }
    }
  }

  const listUrl = options?.cursor
    ? `${MAKEFUN_BASE}/api/competitions?cursor=${encodeURIComponent(options.cursor)}`
    : `${MAKEFUN_BASE}/api/competitions`;

  const listRes = await fetchJsonReadOnly(listUrl);
  if (!listRes.ok || !listRes.data || typeof listRes.data !== 'object') {
    crud.markBountiesOffline();
    return {
      syncedCount,
      openCount,
      nextCursor: crud.getSettingValue('nextCursor') || null,
      syncState: 'OFFLINE',
      error: listRes.error || 'Failed to reach make.fun API',
    };
  }

  const payload = listRes.data as { items?: MakefunCompetitionListItem[]; next_cursor?: string | null };
  const items = Array.isArray(payload.items) ? payload.items : [];

  for (const item of items) {
    if (!item.slug) continue;
    if (!seenSlugs.has(item.slug)) {
      upsertBountyFromItem(item, 'UNVERIFIED', nowIso);
      if (!crud.hasAnyBountySnapshot(item.slug)) {
        crud.saveBountySnapshot({
          bountySlug: item.slug,
          sourceEndpoint: listUrl,
          rawCompetition: item as unknown as Record<string, unknown>,
          rawRequirements: null,
          rawLeaderboard: null,
          rawKit: null,
          officialPromptText: '',
          fetchedAt: nowIso,
          contentHash: hashContent({ competition: item, requirements: null, leaderboard: null, kit: null, prompt: '' }),
          promptSource: null,
          refreshIssues: ['Requirements, leaderboard, and kit were not fetched by the competition list endpoint.'],
          requirementsComplete: false,
          rulesHash: '',
        });
      }
      syncedCount += 1;
    }
  }

  const nextCursor = payload.next_cursor ?? null;
  crud.setSettingValue('nextCursor', nextCursor || '');

  return {
    syncedCount,
    openCount,
    nextCursor,
    syncState: 'LIVE',
    ...(openListError ? { error: openListError } : {}),
  };
}

type GlobalSyncResult = Awaited<ReturnType<typeof syncCompetitionsFromMakefunImpl>>;
const globalSyncPromises = new Map<string, Promise<GlobalSyncResult>>();
let globalSyncQueue: Promise<void> = Promise.resolve();

export function getGlobalSyncStatus(): GlobalSyncStatus {
  return {
    running: globalSyncPromises.size > 0,
    lastAttemptAt: crud.getSettingValue('lastGlobalSyncAttemptAt') || null,
    lastSuccessAt: crud.getSettingValue('lastGlobalSyncAt') || null,
    lastError: crud.getSettingValue('lastGlobalSyncError') || null,
  };
}

export function syncCompetitionsFromMakefun(options?: {
  cursor?: string | null;
  includeOpenFirst?: boolean;
}): Promise<GlobalSyncResult> {
  const key = canonicalSnapshotJson({ cursor: options?.cursor ?? null, includeOpenFirst: options?.includeOpenFirst ?? true });
  const existing = globalSyncPromises.get(key);
  if (existing) return existing;

  crud.setSettingValue('lastGlobalSyncAttemptAt', new Date().toISOString());
  crud.setSettingValue('lastGlobalSyncError', '');
  const run = globalSyncQueue.then(() => syncCompetitionsFromMakefunImpl(options))
    .then((result) => {
      const error = result.error || (result.syncState !== 'LIVE' ? 'MakeFun sync did not complete successfully.' : undefined);
      if (error) {
        crud.setSettingValue('lastGlobalSyncError', error);
      } else {
        crud.setSettingValue('lastGlobalSyncAt', new Date().toISOString());
        crud.setSettingValue('lastGlobalSyncError', '');
      }
      return error && !result.error ? { ...result, error } : result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      crud.setSettingValue('lastGlobalSyncError', message);
      throw error;
    })
    .finally(() => {
      if (globalSyncPromises.get(key) === run) globalSyncPromises.delete(key);
    });
  globalSyncPromises.set(key, run);
  globalSyncQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function syncSingleBountyDetailsImpl(slug: string): Promise<{
  bounty: BountyRecord | null;
  snapshot: BountySnapshot | null;
  syncState: SyncState;
  error?: string;
  refreshIssues: string[];
  requirementsComplete: boolean;
}> {
  const nowIso = new Date().toISOString();

  const competitionEndpoint = `${MAKEFUN_BASE}/api/competitions/${encodeURIComponent(slug)}`;
  const pageEndpoint = `${MAKEFUN_BASE}/bounty/${encodeURIComponent(slug)}`;
  const [compRes, reqRes, lbRes, kitRes, pageRes] = await Promise.all([
    fetchJsonReadOnly(competitionEndpoint),
    fetchJsonReadOnly(`${competitionEndpoint}/requirements?format=json`),
    fetchJsonReadOnly(`${competitionEndpoint}/leaderboard`),
    fetchJsonReadOnly(`${competitionEndpoint}/kit`),
    fetchTextReadOnly(pageEndpoint),
  ]);

  if (!compRes.ok || !compRes.data || typeof compRes.data !== 'object' || Array.isArray(compRes.data)) {
    const existingBounty = crud.getBountyBySlug(slug);
    const existingSnap = crud.getLatestBountySnapshot(slug);
    const refreshIssues = [
      `competition endpoint failed: ${compRes.error || 'invalid response object'}`,
      ...(!reqRes.ok ? [`requirements endpoint failed: ${reqRes.error || 'unknown error'}`] : []),
      ...(!lbRes.ok ? [`leaderboard endpoint failed: ${lbRes.error || 'unknown error'}`] : []),
      ...(!kitRes.ok ? [`kit endpoint failed: ${kitRes.error || 'unknown error'}`] : []),
    ];

    if (existingBounty) {
      crud.markBountiesOffline(slug);
      existingBounty.syncState = 'OFFLINE';
    }

    return {
      bounty: existingBounty,
      snapshot: existingSnap,
      syncState: 'OFFLINE',
      error: compRes.error || 'Could not fetch official competition details',
      refreshIssues,
      requirementsComplete: existingSnap?.requirementsComplete === true,
    };
  }

  const comp = compRes.data as Record<string, unknown>;
  if (comp.slug !== slug) {
    const issue = typeof comp.slug === 'string'
      ? `Competition response slug mismatch: requested ${slug}, received ${comp.slug}.`
      : 'Competition response is missing its slug.';
    return {
      bounty: crud.getBountyBySlug(slug),
      snapshot: crud.getLatestBountySnapshot(slug),
      syncState: 'UNVERIFIED',
      error: issue,
      refreshIssues: [issue],
      requirementsComplete: crud.getLatestBountySnapshot(slug)?.requirementsComplete === true,
    };
  }
  let reqData = reqRes.ok && reqRes.data && typeof reqRes.data === 'object' && !Array.isArray(reqRes.data) ? (reqRes.data as Record<string, unknown>) : null;
  const reqCompetitionSlug = reqData?.competition && typeof reqData.competition === 'object'
    ? (reqData.competition as Record<string, unknown>).slug : undefined;
  const reqDeclaredSlug = typeof reqData?.slug === 'string' ? reqData.slug
    : typeof reqData?.competitionSlug === 'string' ? reqData.competitionSlug : undefined;
  if (reqData && ((typeof reqCompetitionSlug === 'string' && reqCompetitionSlug !== slug) ||
      (reqDeclaredSlug !== undefined && reqDeclaredSlug !== slug))) {
    const wrongSlug = reqDeclaredSlug !== undefined && reqDeclaredSlug !== slug ? reqDeclaredSlug : reqCompetitionSlug;
    const issue = `Requirements competition slug mismatch: requested ${slug}, received ${String(wrongSlug)}.`;
    return {
      bounty: crud.getBountyBySlug(slug),
      snapshot: crud.getLatestBountySnapshot(slug),
      syncState: 'UNVERIFIED',
      error: issue,
      refreshIssues: [issue],
      requirementsComplete: crud.getLatestBountySnapshot(slug)?.requirementsComplete === true,
    };
  }
  if (reqData && (reqCompetitionSlug === undefined || (reqDeclaredSlug !== undefined && reqDeclaredSlug !== slug))) {
    reqData = null;
  }
  const lbData = lbRes.ok && lbRes.data && typeof lbRes.data === 'object' && !Array.isArray(lbRes.data) ? (lbRes.data as Record<string, unknown>) : null;
  const kitData = kitRes.ok && kitRes.data && typeof kitRes.data === 'object' && !Array.isArray(kitRes.data) ? (kitRes.data as Record<string, unknown>) : null;

  const requestedSlug = slug;
  const requirementsComplete = isRequirementsComplete(reqData, requestedSlug);
  const endpoint = competitionEndpoint;
  const promptExtraction = extractPromptSource(
    comp, reqData, slug, nowIso, endpoint,
    pageRes.ok ? pageRes.text : null,
    pageRes.finalUrl || pageEndpoint
  );
  let { text: officialPromptText, source: promptSource } = promptExtraction;
  const previousSnapshot = crud.getLatestBountySnapshot(slug);
  const carriedManualSource = !promptSource && previousSnapshot?.promptSource?.kind === 'manual' &&
    Boolean(previousSnapshot.manualPromptOverride?.trim());
  if (carriedManualSource) {
    officialPromptText = previousSnapshot!.manualPromptOverride!;
    promptSource = previousSnapshot!.promptSource!;
  }
  const refreshIssues = collectRefreshIssues({ compRes, reqRes, lbRes, kitRes, comp, reqData, requestedSlug: slug });
  if (!promptSource && !pageRes.ok) refreshIssues.push(`bounty page prompt source unavailable: ${pageRes.error || 'HTTP failure'}`);
  if (!promptSource) refreshIssues.push('No dedicated standard prompt field or unique verified page prompt was found.');
  const { contentHash, rulesHash } = computeSnapshotHashes({
    competition: comp,
    requirements: reqData,
    leaderboard: lbData,
    kit: kitData,
    prompt: officialPromptText,
    promptSource,
  });
  const criticalRefreshIssues = refreshIssues.filter((issue) =>
    issue.startsWith('competition endpoint failed:') || issue.startsWith('requirements endpoint failed:') ||
    issue.startsWith('Competition response') || issue.startsWith('Requirements response') ||
    issue.startsWith('Requirements competition slug mismatch:') || issue.startsWith('Requirements are incomplete:')
  );
  const syncState: SyncState = criticalRefreshIssues.length === 0 && requirementsComplete ? 'LIVE' : 'UNVERIFIED';
  const prerequisitesObj =
    (reqData?.prerequisites as PrerequisitesData | undefined) ||
    (comp.prerequisites as PrerequisitesData | undefined) ||
    null;
  upsertBountyFromItem(
    { ...(comp as unknown as MakefunCompetitionListItem), prerequisites: prerequisitesObj },
    syncState,
    nowIso
  );

  const snapshot = crud.saveBountySnapshot({
    bountySlug: slug,
    sourceEndpoint: endpoint,
    rawCompetition: comp,
    rawRequirements: reqData,
    rawLeaderboard: lbData,
    rawKit: kitData,
    officialPromptText,
    fetchedAt: nowIso,
    contentHash,
    promptSource,
    refreshIssues,
    requirementsComplete,
    rulesHash,
  });

  recordMatchingAccountSubmissions(slug, comp, lbData, nowIso);

  const bounty = crud.getBountyBySlug(slug);

  return {
    bounty,
    snapshot,
    syncState,
    ...(criticalRefreshIssues.length > 0 ? { error: criticalRefreshIssues.join('; ') } : {}),
    refreshIssues,
    requirementsComplete,
  };
}

const detailSyncPromises = new Map<string, ReturnType<typeof syncSingleBountyDetailsImpl>>();
export function syncSingleBountyDetails(slug: string): ReturnType<typeof syncSingleBountyDetailsImpl> {
  const existing = detailSyncPromises.get(slug);
  if (existing) return existing;
  const run = syncSingleBountyDetailsImpl(slug).finally(() => {
    if (detailSyncPromises.get(slug) === run) detailSyncPromises.delete(slug);
  });
  detailSyncPromises.set(slug, run);
  return run;
}

export function computeEffectiveSyncState(bounty: BountyRecord): SyncState {
  if (bounty.syncState === 'OFFLINE' || bounty.syncState === 'UNVERIFIED') {
    return bounty.syncState;
  }
  const ageMs = Date.now() - new Date(bounty.lastSyncedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs > STALE_THRESHOLD_MS) {
    return 'STALE';
  }
  return 'LIVE';
}

export function extractLeaderboardInsights(
  rawLeaderboard: Record<string, unknown> | null,
  rawCompetition: Record<string, unknown> | null,
  accountHandle: string
): LeaderboardGapInsights | null {
  if (!rawLeaderboard || !Array.isArray(rawLeaderboard.entries)) {
    return null;
  }

  const rankKey = String(rawLeaderboard.rank_key || 'score');
  const columns = Array.isArray(rawLeaderboard.columns)
    ? (rawLeaderboard.columns as Array<{ key?: string; title?: string }>)
    : [];
  const rankCol = columns.find((c) => c.key === rankKey);
  const rankKeyTitle = rankCol?.title || rankKey;

  const cleanHandle = accountHandle.replace(/^@/, '').trim().toLowerCase();
  const entries = rawLeaderboard.entries as Array<Record<string, unknown>>;

  const toInsight = (e: Record<string, unknown>): LeaderboardEntryInsight => {
    const displayObj = (e.display && typeof e.display === 'object' ? e.display : {}) as Record<
      string,
      unknown
    >;
    const valuesObj = (e.values && typeof e.values === 'object' ? e.values : {}) as Record<
      string,
      unknown
    >;
    const display: Record<string, string> = {};
    for (const [k, v] of Object.entries(displayObj)) {
      display[k] = String(v ?? '');
    }
    const rawPrimary = displayObj[rankKey] ?? valuesObj[rankKey] ?? '—';
    const handle = String(e.handle || e.hunter || 'unknown');
    return {
      rank: typeof e.rank === 'number' ? e.rank : null,
      handle,
      title: String(e.title || 'Untitled entry'),
      primaryMetricLabel: rankKeyTitle,
      primaryMetricValue: String(rawPrimary),
      isBaseline: Boolean(e.baseline || e.house),
      isAccountMatch: cleanHandle.length > 0 && handle.toLowerCase() === cleanHandle,
      display,
    };
  };

  const mapped = entries.map(toInsight);
  const topEntries = mapped.filter((m) => !m.isBaseline).slice(0, 5);
  const houseBaseline = mapped.find((m) => m.isBaseline) || null;
  const accountEntry = mapped.find((m) => m.isAccountMatch) || null;

  const leader = topEntries[0] || null;
  const baselineObj = rawCompetition?.baseline as { display?: string; unit?: string } | undefined;
  const summaryParts: string[] = [];

  if (leader) {
    summaryParts.push(
      `Current #1 ("${leader.title}" by @${leader.handle}) holds ${rankKeyTitle}: ${leader.primaryMetricValue}.`
    );
  }
  if (houseBaseline) {
    summaryParts.push(
      `House baseline ("${houseBaseline.title}") sits at rank #${houseBaseline.rank ?? '?'} (${rankKeyTitle}: ${houseBaseline.primaryMetricValue}).`
    );
  } else if (baselineObj?.display) {
    summaryParts.push(
      `Official baseline threshold: ${baselineObj.display} ${baselineObj.unit || ''}.`.trim()
    );
  }
  if (accountEntry) {
    const leaderNum = leader ? Number(leader.primaryMetricValue.replace(/,/g, '')) : NaN;
    const acctNum = Number(accountEntry.primaryMetricValue.replace(/,/g, ''));
    const gapText =
      Number.isFinite(leaderNum) && Number.isFinite(acctNum)
        ? ` (gap to #1: ${(leaderNum - acctNum).toFixed(leaderNum % 1 === 0 && acctNum % 1 === 0 ? 0 : 2)} ${rankKeyTitle})`
        : '';
    summaryParts.push(
      `Tracked account ${accountHandle} ("${accountEntry.title}") is rank #${accountEntry.rank ?? '?'} with ${rankKeyTitle}: ${accountEntry.primaryMetricValue}${gapText}.`
    );
  } else {
    summaryParts.push(`No public leaderboard entry matched for ${accountHandle} in this competition yet.`);
  }

  return {
    rankKey,
    rankKeyTitle,
    totalRanked: mapped.length,
    topEntries,
    houseBaseline,
    accountEntry,
    gapSummary: summaryParts.join(' '),
  };
}

