import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileEdit,
  GitCompare,
  History,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Input,
  Panel,
  PanelHeader,
  Select,
  SyncStateIndicator,
  Textarea,
} from '../ui/primitives';
import {
  buildMasterMarkdown,
  extractOfficialBountySkills,
  mergeRecommendedSkills,
} from '../../lib/prompt-builder';
import { createStudioRequestGuard } from '../../lib/studio-request';
import { readEnhancementStream, type EnhancementLogEntry } from '../../lib/enhancement-stream';
import { BountyResearchPanel } from './BountyResearchPanel';
import { computeLineDiff, downloadMarkdownFile, formatDateTime, formatUsd } from '../../lib/utils';
import type {
  AIAnalysisRecord,
  AppSettings,
  BountyRecord,
  BountySnapshot,
  LeaderboardGapInsights,
  PromptDraftRecord,
  PromptVersionRecord,
  RecommendedSkill,
  ResearchReference,
  SkillPriority,
  SkillSource,
} from '../../types/command-center';

function formatSkillSourceLabel(source: SkillSource): string {
  switch (source) {
    case 'official_mcp':
      return 'Official MCP';
    case 'official_bounty':
      return 'Official Bounty';
    case 'founder_custom':
      return 'Founder Custom';
    default:
      return 'AI Curated';
  }
}

function formatSourceTypeLabel(sourceType: ResearchReference['sourceType']): string {
  switch (sourceType) {
    case 'google_search':
      return 'Google Search';
    case 'github_public':
      return 'GitHub Public';
    case 'wikipedia_api':
      return 'Wikipedia';
    case 'makefun_kit':
      return 'make.fun Kit';
    case 'official_docs':
      return 'make.fun Docs';
    default:
      return 'Model Note';
  }
}

interface CachedSnapshot {
  id: number;
  fetchedAt: string;
  contentHash: string;
  rulesHash: string;
}

interface StudioApiError {
  error?: string;
  refreshIssues?: string[];
  cacheAvailable?: boolean;
  cachedSnapshot?: CachedSnapshot;
  refreshError?: string | null;
}

interface BountyContext extends StudioApiError {
  bounty: BountyRecord;
  snapshot: BountySnapshot | null;
  analysisSourceSnapshot?: BountySnapshot | null;
  leaderboardInsights?: LeaderboardGapInsights | null;
  analyses?: AIAnalysisRecord[];
  draft?: PromptDraftRecord | null;
  versions?: PromptVersionRecord[];
}

interface EditorSource {
  part1: string;
  snapshotId: number | null;
  rulesHash: string | null;
  analysisId: string | null;
  legacy: boolean;
}

function readStandardPrompt(snapshot: BountySnapshot | null, slug: string): string {
  const source = snapshot?.promptSource;
  if (!snapshot || snapshot.bountySlug !== slug || source?.bountySlug !== slug ||
      !source.locator?.trim() || !source.capturedAt?.trim()) return '';
  const standard = source.kind === 'manual' ? snapshot.manualPromptOverride :
    source.kind === 'official_api' ? snapshot.officialPromptText : null;
  return typeof standard === 'string' && standard.trim() && snapshot.contentHash.trim() ? standard : '';
}

function snapshotIdentity(snapshot: BountySnapshot | null | undefined): CachedSnapshot | null {
  if (!snapshot) return null;
  return { id: snapshot.id, fetchedAt: snapshot.fetchedAt, contentHash: snapshot.contentHash, rulesHash: snapshot.rulesHash ?? '' };
}

function versionSource(version: PromptVersionRecord): EditorSource {
  const legacy = version.provenanceStatus !== 'verified' ||
    !version.sourceSnapshotId || !version.sourceRulesHash;
  return {
    part1: version.part1OriginalPrompt,
    snapshotId: legacy ? null : version.sourceSnapshotId ?? null,
    rulesHash: legacy ? null : version.sourceRulesHash ?? null,
    analysisId: legacy ? null : version.analysisId,
    legacy,
  };
}

function mergeIssues(...issues: (string[] | undefined)[]): string[] {
  return [...new Set(issues.flatMap((list) => list ?? []))];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function readStudioJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch (error) {
    if (response.ok) throw error;
    throw new Error(`Request failed (HTTP ${response.status}).`);
  }
}

interface PromptStudioViewProps {
  initialSlug: string | null;
  settings: AppSettings | null;
  onDataMutated: () => void;
}

export const PromptStudioView: React.FC<PromptStudioViewProps> = ({
  initialSlug,
  settings,
  onDataMutated,
}) => {
  const [bounties, setBounties] = useState<BountyRecord[]>([]);
  const [requestGuard] = useState(() => createStudioRequestGuard(initialSlug || ''));
  const [selection, setSelection] = useState(() => ({ slug: initialSlug || '' }));
  const selectedSlug = selection.slug;
  const [loadingBounty, setLoadingBounty] = useState(Boolean(initialSlug));
  const [listError, setListError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [refreshIssues, setRefreshIssues] = useState<string[]>([]);
  const [cacheOffer, setCacheOffer] = useState<(CachedSnapshot & { founderInstructions: string }) | null>(null);
  const [staleAcknowledgment, setStaleAcknowledgment] = useState<string | null>(null);

  const [bounty, setBounty] = useState<BountyRecord | null>(null);
  const [snapshot, setSnapshot] = useState<BountySnapshot | null>(null);
  const [leaderboardInsights, setLeaderboardInsights] = useState<LeaderboardGapInsights | null>(null);
  const [researchSnapshot, setResearchSnapshot] = useState<BountySnapshot | null>(null);
  const [researchRefreshError, setResearchRefreshError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<AIAnalysisRecord[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<AIAnalysisRecord | null>(null);
  const [enhancementLog, setEnhancementLog] = useState<EnhancementLogEntry[]>([]);
  const enhancementLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = enhancementLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [enhancementLog]);
  const [draft, setDraft] = useState<PromptDraftRecord | null>(null);
  const [versions, setVersions] = useState<PromptVersionRecord[]>([]);

  const model = settings?.openaiCompatModel || 'llama3.1:8b';

  // Manual Official Prompt Fallback Drawer
  const [showManualPromptBox, setShowManualPromptBox] = useState(false);
  const [manualPromptDraft, setManualPromptDraft] = useState('');
  const [savingManualPrompt, setSavingManualPrompt] = useState(false);

  // Editor state
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const [currentRules, setCurrentRules] = useState<CachedSnapshot | null>(null);
  const [part2Enhancement, setPart2Enhancement] = useState('');
  const [part3Guidelines, setPart3Guidelines] = useState('');
  const [founderInstructions, setFounderInstructions] = useState('');
  const [founderNotes, setFounderNotes] = useState('');
  const [editSummary, setEditSummary] = useState('');

  // Agent Skill Playbook state
  const [selectedSkills, setSelectedSkills] = useState<RecommendedSkill[]>([]);
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [customSkillName, setCustomSkillName] = useState('');
  const [customSkillCategory, setCustomSkillCategory] = useState('Hermes Skill');
  const [customSkillPriority, setCustomSkillPriority] = useState<SkillPriority>('essential');
  const [customSkillDirective, setCustomSkillDirective] = useState('');

  // Run & Save feedback
  const [enhancing, setEnhancing] = useState(false);
  const [uncoveredGateError, setUncoveredGateError] = useState<Array<{ gateId: string; reason?: string }>>([]);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [savingVersion, setSavingVersion] = useState(false);
  const [checkingReuseRules, setCheckingReuseRules] = useState(false);
  const [reuseRulesFailure, setReuseRulesFailure] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Version comparison
  const [previewTab, setPreviewTab] = useState<'preview' | 'versions' | 'diff'>('preview');
  const [diffBaseId, setDiffBaseId] = useState<string>('');
  const [diffTargetId, setDiffTargetId] = useState<string>('');

  const changeSelection = useCallback((slug: string) => {
    if (!requestGuard.select(slug)) return;
    setSelection({ slug });
    setLoadingBounty(Boolean(slug));
    setBounty(null);
    setSnapshot(null);
    setCurrentRules(null);
    setLeaderboardInsights(null);
    setResearchSnapshot(null);
    setResearchRefreshError(null);
    setAnalyses([]);
    setActiveAnalysis(null);
    setEnhancementLog([]);
    setDraft(null);
    setVersions([]);
    setEditorSource(null);
    setPart2Enhancement('');
    setPart3Guidelines('');
    setFounderInstructions('');
    setFounderNotes('');
    setEditSummary('');
    setSelectedSkills([]);
    setShowAddSkill(false);
    setCustomSkillName('');
    setCustomSkillCategory('Hermes Skill');
    setCustomSkillPriority('essential');
    setCustomSkillDirective('');
    setShowManualPromptBox(false);
    setManualPromptDraft('');
    setSavingManualPrompt(false);
    setSavingVersion(false);
    setCheckingReuseRules(false);
    setReuseRulesFailure(null);
    setEnhancing(false);
    setCopied(false);
    setContextError(null);
    setEnhanceError(null);
    setSaveNotice(null);
    setRefreshIssues([]);
    setUncoveredGateError([]);
    setCacheOffer(null);
    setStaleAcknowledgment(null);
    setPreviewTab('preview');
    setDiffBaseId('');
    setDiffTargetId('');
  }, [requestGuard]);

  useLayoutEffect(() => {
    if (initialSlug) changeSelection(initialSlug);
  }, [initialSlug, changeSelection]);

  useLayoutEffect(() => () => requestGuard.invalidate(), [requestGuard]);

  useEffect(() => {
    // List refreshes are independent of the selected bounty's request scope.
    const listGuard = createStudioRequestGuard();
    const refreshList = async () => {
      const request = listGuard.begin('list')!;
      try {
        const res = await fetch('/api/bounties?status=all', { signal: request.signal });
        const data = await readStudioJson<StudioApiError & { items?: BountyRecord[] }>(res);
        if (!request.isCurrent()) return;
        if (!res.ok) throw new Error(data.error || 'Failed to load bounties.');
        const list = data.items ?? [];
        setBounties(list);
        setListError(null);
        if (!requestGuard.slug && list.length > 0) {
          changeSelection((list.find((b) => b.status === 'open') ?? list[0]).slug);
        }
      } catch (err) {
        if (request.isCurrent()) setListError(errorMessage(err, 'Failed to load bounties.'));
      } finally {
        request.finish();
      }
    };
    void refreshList();
    window.addEventListener('makefun:bounties-updated', refreshList);
    window.addEventListener('focus', refreshList);
    return () => {
      listGuard.invalidate();
      window.removeEventListener('makefun:bounties-updated', refreshList);
      window.removeEventListener('focus', refreshList);
    };
  }, [changeSelection, requestGuard]);

  const loadBountyContext = useCallback(async (slug: string, refresh = false, preserveEditor = false) => {
    if (!slug) return;
    const request = requestGuard.begin('context', slug);
    if (!request) return;
    setLoadingBounty(true);
    setContextError(null);
    setEnhanceError(null);
    setUncoveredGateError([]);
    setSaveNotice(null);
    setCacheOffer(null);
    setStaleAcknowledgment(null);
    try {
      const res = await fetch(`/api/bounties/${encodeURIComponent(slug)}${refresh ? '?refresh=1' : ''}`, {
        signal: request.signal,
      });
      const data = await readStudioJson<BountyContext>(res);
      if (!request.isCurrent()) return;
      if (!res.ok) throw new Error(data.error || 'Failed to load bounty context.');
      if (data.bounty?.slug !== slug || (data.snapshot && data.snapshot.bountySlug !== slug)) {
        throw new Error('The returned bounty context did not match the selected bounty.');
      }
      setBounty(data.bounty);
      setSnapshot(data.snapshot ?? null);
      setCurrentRules(snapshotIdentity(data.snapshot));
      setRefreshIssues(mergeIssues(data.snapshot?.refreshIssues, data.refreshIssues, data.refreshError ? [data.refreshError] : []));
      setLeaderboardInsights(data.leaderboardInsights ?? null);
      setResearchSnapshot(data.snapshot ?? null);
      setResearchRefreshError(data.refreshError ?? null);
      const historyAnalyses = (data.analyses ?? []).filter((item) => item.bountySlug === slug);
      setAnalyses(historyAnalyses);
      const history = (data.versions ?? []).filter((item) => item.bountySlug === slug);
      setVersions(history);
      const currentDraft = data.draft?.bountySlug === slug ? data.draft : null;
      setDraft(currentDraft);

      if (preserveEditor) return;
      const latest = history.find((item) => item.id === currentDraft?.latestVersionId) ?? history[0];
      const versionEvidence = latest ? versionSource(latest) : null;
      const latestAnalysis = historyAnalyses.find((item) => item.id === latest?.analysisId) ??
        (versionEvidence?.legacy ? null : historyAnalyses[0] ?? null);
      setActiveAnalysis(latestAnalysis);
      const standard = readStandardPrompt(data.snapshot ?? null, slug);
      setManualPromptDraft(data.snapshot?.promptSource?.kind === 'manual' ? standard : '');
      setFounderNotes(data.draft?.founderNotes ?? data.bounty.founderNotes ?? '');
      const analysisSnapshot = data.analysisSourceSnapshot ?? null;
      const analysisStandard = readStandardPrompt(analysisSnapshot, slug);
      const evidence = latestAnalysis?.evidence;
      const source = analysisSnapshot?.promptSource;
      const recoverAnalysis = !latest && latestAnalysis && analysisSnapshot && evidence && analysisStandard &&
        latestAnalysis.part2AiEnhancement?.trim() && latestAnalysis.part3ExecutionGuidelines?.trim() &&
        evidence.snapshotId === analysisSnapshot.id && evidence.snapshotHash === analysisSnapshot.contentHash &&
        evidence.rulesHash === analysisSnapshot.rulesHash && analysisSnapshot.requirementsComplete === true &&
        evidence.promptSource?.bountySlug === slug && evidence.promptSource.kind === source?.kind &&
        evidence.promptSource.locator === source?.locator && evidence.promptSource.capturedAt === source?.capturedAt;
      setEditorSource(latest ? versionSource(latest) : recoverAnalysis ? {
        part1: analysisStandard,
        snapshotId: analysisSnapshot.id,
        rulesHash: evidence.rulesHash,
        analysisId: latestAnalysis.id,
        legacy: false,
      } : null);
      setPart2Enhancement(latest?.part2AiEnhancement ?? (recoverAnalysis ? latestAnalysis.part2AiEnhancement! : ''));
      setPart3Guidelines(latest?.part3ExecutionGuidelines ?? (recoverAnalysis ? latestAnalysis.part3ExecutionGuidelines! : ''));
      setFounderInstructions(latest?.founderInstructions ?? '');
      setSelectedSkills(latest?.selectedSkills?.length ? latest.selectedSkills : mergeRecommendedSkills({
        officialSkills: extractOfficialBountySkills(data.bounty),
        aiSkills: latestAnalysis?.recommendedSkills ?? [],
      }));
      setDiffTargetId(latest?.id ?? '');
      setDiffBaseId(history.find((item) => item.id !== latest?.id)?.id ?? latest?.id ?? '');
    } catch (err) {
      if (request.isCurrent()) {
        const message = errorMessage(err, 'Failed to load bounty context.');
        setContextError(message);
        setResearchRefreshError(message);
      }
    } finally {
      if (request.finish()) setLoadingBounty(false);
    }
  }, [requestGuard]);

  useEffect(() => {
    if (selection.slug) void loadBountyContext(selection.slug);
  }, [selection, loadBountyContext]);

  const contextMatches = Boolean(bounty && bounty.slug === selectedSlug);
  const working = loadingBounty || enhancing || savingVersion || savingManualPrompt || checkingReuseRules;
  const canStart = () => contextMatches && requestGuard.slug === selectedSlug && !working &&
    !['context', 'enhance', 'save', 'manual', 'reuse'].some(requestGuard.isPending);
  const standardPrompt = readStandardPrompt(snapshot, selectedSlug);
  const sourceSnapshotId = editorSource ? editorSource.snapshotId : snapshot?.id;
  const sourceRulesHash = editorSource ? editorSource.rulesHash : snapshot?.rulesHash;
  const part1Original = editorSource ? editorSource.part1 : standardPrompt;
  const analysisEvidence = activeAnalysis?.evidence;
  const coverage = analysisEvidence?.gateCoverage ?? [];
  // A source decision applies only to the precise current and editor snapshots on screen.
  const currentRulesUnknown = !currentRules;
  const staleKey = sourceRulesHash && ((currentRules && sourceRulesHash !== currentRules.rulesHash) || currentRulesUnknown)
    ? JSON.stringify([selectedSlug, sourceSnapshotId, sourceRulesHash, currentRules?.rulesHash ?? 'unknown']) : null;
  const allowStaleRules = staleKey !== null && staleAcknowledgment === staleKey;
  const sourceMatches = !snapshot || sourceSnapshotId !== snapshot.id || part1Original === standardPrompt;
  const canEnhance = contextMatches && !working && (!editorSource?.legacy || Boolean(standardPrompt));
  const canRunEnhancement = canEnhance && Boolean(standardPrompt);
  const canUseEditor = contextMatches && !working && !contextError && !editorSource?.legacy && sourceMatches &&
    Boolean(part1Original.trim() && part2Enhancement.trim() && part3Guidelines.trim() && sourceSnapshotId && sourceRulesHash) &&
    (!staleKey || allowStaleRules);

  const handleSaveManualPrompt = async () => {
    if (!canStart() || !manualPromptDraft.trim()) return;
    const request = requestGuard.begin('manual', selectedSlug);
    if (!request) return;
    setSavingManualPrompt(true);
    setEnhanceError(null);
    setUncoveredGateError([]);
    setSaveNotice(null);
    try {
      const res = await fetch(`/api/bounties/${encodeURIComponent(selectedSlug)}/manual-prompt`, {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualPromptText: manualPromptDraft }),
      });
      const data = await readStudioJson<StudioApiError & { snapshot: BountySnapshot }>(res);
      if (!request.isCurrent()) return;
      if (!res.ok) throw new Error(data.error || 'Failed to save manual prompt.');
      const standard = readStandardPrompt(data.snapshot, selectedSlug);
      if (data.snapshot?.promptSource?.kind !== 'manual' || standard !== manualPromptDraft) {
        throw new Error('The server did not return the exact manual prompt as the current source.');
      }
      setSnapshot(data.snapshot);
      setCurrentRules(snapshotIdentity(data.snapshot));
      setRefreshIssues(data.snapshot.refreshIssues ?? []);
      setContextError(null);
      setManualPromptDraft(standard);
      setShowManualPromptBox(false);
      setEditorSource(null);
      setActiveAnalysis(null);
      setAnalyses([]);
      setPart2Enhancement('');
      setPart3Guidelines('');
      setSelectedSkills((previous) => mergeRecommendedSkills({
        officialSkills: bounty ? extractOfficialBountySkills(bounty) : [],
        customSkills: previous.filter((skill) => skill.source === 'founder_custom'),
      }));
      setStaleAcknowledgment(null);
      setCacheOffer(null);
      setSaveNotice('Saved the pasted prompt as the current manual source. Review or regenerate Parts 2 and 3 against this source before saving.');
    } catch (err) {
      if (request.isCurrent()) setEnhanceError(errorMessage(err, 'Failed to save manual prompt.'));
    } finally {
      if (request.finish()) setSavingManualPrompt(false);
    }
  };

  const handleEnhanceWithAI = async (cached?: NonNullable<typeof cacheOffer>) => {
    if (!canStart() || !canEnhance || (!cached && !standardPrompt)) return;
    const request = requestGuard.begin('enhance', selectedSlug);
    if (!request) return;
    const instructions = cached?.founderInstructions ?? founderInstructions;
    setEnhancementLog([{ timestamp: new Date().toISOString(), message: 'Menghubungi server Command Center.' }]);
    setEnhancing(true);
    setEnhanceError(null);
    setUncoveredGateError([]);
    setSaveNotice(null);
    setCacheOffer(null);
    try {
      const res = await fetch('/api/enhancer/run', {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({
          slug: selectedSlug,
          founderInstructions: instructions,
          ...(cached ? { useCachedSnapshotId: cached.id } : {}),
        }),
      });
      type EnhancementResponse = StudioApiError & {
        analysis: AIAnalysisRecord;
        snapshot: BountySnapshot;
        currentSnapshot?: CachedSnapshot | null;
        part1OriginalPrompt: string;
        part2AiEnhancement: string;
        part3ExecutionGuidelines: string;
        recommendedSkills?: RecommendedSkill[];
        details?: { uncoveredGates?: Array<{ gateId: string; reason?: string }>; refreshIssues?: string[]; snapshot?: BountySnapshot; totalChars?: number; maxContextChars?: number; sectionLengths?: Record<string, number> };
      };
      const { data, status } = res.headers.get('content-type')?.includes('application/x-ndjson')
        ? await readEnhancementStream<EnhancementResponse>(res, (entry) => {
          if (request.isCurrent()) setEnhancementLog((previous) => [...previous, entry]);
        })
        : { status: res.status, data: await readStudioJson<EnhancementResponse>(res) };
      if (!request.isCurrent()) return;
      if (status < 200 || status >= 300) {
        if (data.details?.snapshot?.bountySlug === selectedSlug && !data.cachedSnapshot) {
          setSnapshot(data.details.snapshot);
          setCurrentRules(snapshotIdentity(data.details.snapshot));
          setStaleAcknowledgment(null);
        }
        setRefreshIssues((previous) => mergeIssues(previous, data.refreshIssues, data.details?.refreshIssues));
        setUncoveredGateError(data.details?.uncoveredGates ?? []);
        if (status === 409 && data.cacheAvailable === true && data.cachedSnapshot?.id) {
          setCacheOffer({ ...data.cachedSnapshot, founderInstructions: instructions });
        }
        const sizeReport = data.details?.sectionLengths
          ? ` Context: ${data.details.totalChars} / ${data.details.maxContextChars} characters. Sections not sent: ${Object.entries(data.details.sectionLengths).map(([name, length]) => `${name} (${length})`).join(', ')}.`
          : '';
        throw new Error((data.error || 'LLM enhancement failed.') + sizeReport);
      }

      const evidence = data.analysis?.evidence;
      const standard = readStandardPrompt(data.snapshot, selectedSlug);
      const source = data.snapshot?.promptSource;
      if (!standard || data.part1OriginalPrompt !== standard || data.analysis?.bountySlug !== selectedSlug ||
          !evidence || evidence.snapshotId !== data.snapshot.id || evidence.snapshotHash !== data.snapshot.contentHash ||
          !evidence.rulesHash || evidence.rulesHash !== data.snapshot.rulesHash ||
          evidence.usedCache !== Boolean(cached) || (cached && evidence.snapshotId !== cached.id) ||
          evidence.promptSource?.kind !== source?.kind || evidence.promptSource?.bountySlug !== selectedSlug ||
          evidence.promptSource.locator !== source?.locator || evidence.promptSource.capturedAt !== source?.capturedAt) {
        throw new Error('The returned enhancement did not match its recorded prompt snapshot. Refresh Official and try again.');
      }
      if (!evidence.usedCache || data.currentSnapshot?.id === data.snapshot.id) {
        setSnapshot(data.snapshot);
        setManualPromptDraft(data.snapshot.promptSource?.kind === 'manual' ? standard : '');
      }
      if (data.currentSnapshot !== undefined) {
        setCurrentRules(data.currentSnapshot);
      } else if (!evidence.usedCache) {
        setCurrentRules(snapshotIdentity(data.snapshot));
      }
      setRefreshIssues((previous) => mergeIssues(evidence.usedCache ? previous : [], data.snapshot.refreshIssues, data.refreshIssues));
      setContextError(null);
      setActiveAnalysis(data.analysis);
      setAnalyses((prev) => [data.analysis, ...prev.filter((item) => item.id !== data.analysis.id)]);
      setEditorSource({ part1: standard, snapshotId: evidence.snapshotId, rulesHash: evidence.rulesHash, analysisId: data.analysis.id, legacy: false });
      setStaleAcknowledgment(null);
      setPart2Enhancement(data.part2AiEnhancement);
      setPart3Guidelines(data.part3ExecutionGuidelines);
      setFounderInstructions(instructions);
      setSelectedSkills((previous) => mergeRecommendedSkills({
        officialSkills: bounty ? extractOfficialBountySkills(bounty) : [],
        aiSkills: data.recommendedSkills ?? data.analysis.recommendedSkills ?? [],
        customSkills: previous.filter((skill) => skill.source === 'founder_custom'),
      }));
      setEditSummary(`AI generated with ${data.analysis.model}`);
      setSaveNotice('AI enhancement is ready to review and save as a new version.');
      onDataMutated();
    } catch (err) {
      if (request.isCurrent()) setEnhanceError(errorMessage(err, 'Network failure during enhancement.'));
    } finally {
      if (request.finish()) setEnhancing(false);
    }
  };

  const assembledMasterPrompt = useMemo(() => {
    if (!bounty) return '';
    return buildMasterMarkdown({
      bountyTitle: bounty.title,
      bountySlug: bounty.slug,
      bountyUrl: bounty.url,
      part1OriginalPrompt: part1Original,
      part2AiEnhancement: part2Enhancement,
      part3ExecutionGuidelines: part3Guidelines,
      founderInstructions,
      selectedSkills,
    });
  }, [bounty, part1Original, part2Enhancement, part3Guidelines, founderInstructions, selectedSkills]);

  const handleToggleSkill = (skillId: string) => {
    setSelectedSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const handleRemoveCustomSkill = (skillId: string) => {
    setSelectedSkills((prev) => prev.filter((s) => s.id !== skillId));
  };

  const handleAddCustomSkill = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = customSkillName.trim();
    const cleanDirective = customSkillDirective.trim();
    if (!cleanName || !cleanDirective) return;

    const newSkill: RecommendedSkill = {
      id: `custom-${Date.now()}`,
      name: cleanName,
      category: customSkillCategory.trim() || 'Hermes Skill',
      source: 'founder_custom',
      priority: customSkillPriority,
      rationale: 'Added manually by Founder for this competition.',
      agentDirective: cleanDirective,
      enabled: true,
    };

    setSelectedSkills((prev) =>
      mergeRecommendedSkills({
        officialSkills: prev.filter((s) => s.source !== 'founder_custom'),
        customSkills: [...prev.filter((s) => s.source === 'founder_custom'), newSkill],
      })
    );
    setCustomSkillName('');
    setCustomSkillDirective('');
    setShowAddSkill(false);
  };

  const verifyRulesBeforeReuse = async () => {
    if (!canStart() || !canUseEditor || !sourceSnapshotId || !sourceRulesHash) return null;
    const request = requestGuard.begin('reuse', selectedSlug);
    if (!request) return null;
    // Keep the editor bound to its original source while the current snapshot advances.
    setEditorSource((previous) => previous ?? {
      part1: part1Original,
      snapshotId: sourceSnapshotId,
      rulesHash: sourceRulesHash,
      analysisId: null,
      legacy: false,
    });
    setCheckingReuseRules(true);
    setEnhanceError(null);
    setSaveNotice(null);
    let accepted = false;
    let observedSnapshot = snapshotIdentity(snapshot);
    try {
      const res = await fetch(`/api/bounties/${encodeURIComponent(selectedSlug)}?refresh=1`, {
        signal: request.signal,
      });
      const data = await readStudioJson<BountyContext>(res);
      if (!request.isCurrent()) return null;
      if (!res.ok) throw new Error(data.error || 'Could not verify the current bounty rules.');
      if (data.bounty?.slug !== selectedSlug || (data.snapshot && data.snapshot.bountySlug !== selectedSlug)) {
        setContextError('The rules refresh did not match the selected bounty.');
        setStaleAcknowledgment(null);
        return null;
      }
      observedSnapshot = snapshotIdentity(data.snapshot);
      if (!data.snapshot) throw new Error('The current rules snapshot is unavailable.');
      setSnapshot(data.snapshot);
      const issues = mergeIssues(data.snapshot.refreshIssues, data.refreshIssues,
        data.refreshError ? [data.refreshError] : []);
      setRefreshIssues(issues);
      if (data.refreshError || data.snapshot.requirementsComplete !== true || !data.snapshot.rulesHash?.trim()) {
        throw new Error(data.refreshError || 'The current official rules could not be verified completely.');
      }
      setSnapshot(data.snapshot);
      setCurrentRules(snapshotIdentity(data.snapshot));
      setReuseRulesFailure(null);
      setContextError(null);
      const changed = data.snapshot.rulesHash !== sourceRulesHash;
      const currentKey = JSON.stringify([selectedSlug, sourceSnapshotId, sourceRulesHash, data.snapshot.rulesHash]);
      if (changed && staleAcknowledgment !== currentKey) {
        setStaleAcknowledgment(null);
        setEnhanceError('Official rules changed since this prompt source. Review the stale-rules warning and acknowledge it before retrying Copy, export, or Save.');
        return null;
      }
      accepted = true;
      return {
        request,
        allowStaleRules: changed,
        expectedCurrentRulesHash: data.snapshot.rulesHash,
        expectedCurrentSnapshotId: data.snapshot.id,
        expectedCurrentSnapshotHash: data.snapshot.contentHash,
      };
    } catch (err) {
      if (!request.isCurrent()) return null;
      const failure = errorMessage(err, 'Could not verify the current bounty rules.');
      const unknownKey = JSON.stringify([selectedSlug, sourceSnapshotId, sourceRulesHash, 'unknown']);
      setCurrentRules(null);
      setContextError(null);
      setReuseRulesFailure(failure);
      setRefreshIssues((previous) => mergeIssues(previous, [failure]));
      if (staleAcknowledgment === unknownKey) {
        accepted = true;
        return {
          request,
          allowStaleRules: true,
          expectedCurrentRulesHash: null,
          expectedCurrentSnapshotId: observedSnapshot?.id ?? null,
          expectedCurrentSnapshotHash: observedSnapshot?.contentHash ?? null,
        };
      }
      setStaleAcknowledgment(null);
      return null;
    } finally {
      if (request.isCurrent()) setCheckingReuseRules(false);
      if (!accepted) request.finish();
    }
  };

  const handleSaveVersion = async () => {
    if (!canStart() || !canUseEditor || !sourceSnapshotId) return;
    if (part2Enhancement.trim().length < 10 || part3Guidelines.trim().length < 10) {
      setEnhanceError('Part 2 Enhancement and Part 3 Execution Guidelines must each contain at least 10 characters.');
      return;
    }
    const verified = await verifyRulesBeforeReuse();
    if (!verified || !verified.request.isCurrent()) return;
    const request = requestGuard.begin('save', selectedSlug);
    verified.request.finish();
    if (!request) return;
    setSavingVersion(true);
    setEnhanceError(null);
    setUncoveredGateError([]);
    setSaveNotice(null);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(selectedSlug)}/versions`, {
        method: 'POST',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId: editorSource?.analysisId ?? null,
          sourceSnapshotId,
          allowStaleRules: verified.allowStaleRules,
          expectedCurrentRulesHash: verified.expectedCurrentRulesHash,
          expectedCurrentSnapshotId: verified.expectedCurrentSnapshotId,
          expectedCurrentSnapshotHash: verified.expectedCurrentSnapshotHash,
          part1OriginalPrompt: part1Original,
          part2AiEnhancement: part2Enhancement,
          part3ExecutionGuidelines: part3Guidelines,
          founderInstructions,
          selectedSkills,
          editSummary: editSummary || `Manual save (${new Date().toLocaleTimeString()})`,
          founderNotes,
          createdBy: 'Founder',
        }),
      });
      const data = await readStudioJson<StudioApiError & {
        draft: PromptDraftRecord;
        version: PromptVersionRecord;
        currentSnapshot?: CachedSnapshot | null;
      }>(res);
      if (!request.isCurrent()) return;
      if (!res.ok) {
        if (res.status === 409) {
          setStaleAcknowledgment(null);
          if (data.currentSnapshot !== undefined) setCurrentRules(data.currentSnapshot);
          else setContextError('Refresh Official to check the current rules before copying or saving.');
        }
        throw new Error(data.error || 'Failed to save prompt version.');
      }
      if (data.version?.bountySlug !== selectedSlug || data.version.sourceSnapshotId !== sourceSnapshotId ||
          data.version.part1OriginalPrompt !== part1Original || data.version.sourceRulesHash !== sourceRulesHash ||
          data.version.provenanceStatus !== 'verified') {
        throw new Error('The saved version did not match its recorded source. Refresh Official to view server history.');
      }
      setEditorSource(versionSource(data.version));
      setDraft(data.draft);
      setVersions((prev) => [data.version, ...prev]);
      setDiffTargetId(data.version.id);
      if (versions[0]) setDiffBaseId(versions[0].id);
      setEditSummary('');
      setSaveNotice(`Saved Version v${data.version.versionNumber} (including curated skill directives) to SQLite.`);
      onDataMutated();
    } catch (err) {
      if (request.isCurrent()) setEnhanceError(errorMessage(err, 'Failed to save prompt version.'));
    } finally {
      if (request.finish()) setSavingVersion(false);
    }
  };

  const handleLoadVersionIntoEditor = (version: PromptVersionRecord) => {
    if (!canStart() || version.bountySlug !== selectedSlug) return;
    const analysis = analyses.find((item) => item.id === version.analysisId) ?? null;
    setActiveAnalysis(analysis);
    setEditorSource(versionSource(version));
    setCacheOffer(null);
    setStaleAcknowledgment(null);
    setPart2Enhancement(version.part2AiEnhancement);
    setPart3Guidelines(version.part3ExecutionGuidelines);
    setFounderInstructions(version.founderInstructions);
    setSelectedSkills(version.selectedSkills?.length ? version.selectedSkills : mergeRecommendedSkills({
      officialSkills: bounty ? extractOfficialBountySkills(bounty) : [],
      aiSkills: analysis?.recommendedSkills ?? [],
    }));
    setPreviewTab('preview');
    setSaveNotice(`Loaded saved version v${version.versionNumber} into the editor.`);
  };

  const handleAdoptCurrentSource = () => {
    if (!canStart() || !editorSource?.legacy || !standardPrompt || !snapshot?.id || !snapshot.rulesHash) return;
    const linked = analyses.find((analysis) => analysis.id === draft?.latestVersion?.analysisId)?.evidence;
    setEditorSource({
      part1: standardPrompt,
      snapshotId: snapshot.id,
      rulesHash: snapshot.rulesHash,
      analysisId: linked?.snapshotId === snapshot.id && linked.rulesHash === snapshot.rulesHash ? draft?.latestVersion?.analysisId ?? null : null,
      legacy: false,
    });
    setStaleAcknowledgment(null);
    setSaveNotice('Part 1 now uses the current verified standard source. Review Parts 2 and 3 against the current rules before saving.');
  };

  const handleCopyPrompt = async () => {
    if (!canStart() || !canUseEditor) return;
    const verified = await verifyRulesBeforeReuse();
    if (!verified || !verified.request.isCurrent()) return;
    const request = requestGuard.begin('copy', selectedSlug);
    verified.request.finish();
    if (!request) return;
    try {
      await navigator.clipboard.writeText(assembledMasterPrompt);
      if (!request.isCurrent()) return;
      setCopied(true);
      window.setTimeout(() => {
        if (request.finish()) setCopied(false);
      }, 1800);
    } catch (err) {
      if (request.finish()) setEnhanceError(errorMessage(err, 'Failed to copy the master prompt.'));
    }
  };

  const diffResult = useMemo(() => {
    const base = versions.find((v) => v.id === diffBaseId);
    const target = versions.find((v) => v.id === diffTargetId);
    if (!base || !target) return [];
    return computeLineDiff(base.fullMarkdown, target.fullMarkdown);
  }, [versions, diffBaseId, diffTargetId]);

  const rawReq = (snapshot?.rawRequirements || {}) as Record<string, unknown>;
  const deliverables = Array.isArray(rawReq.deliverables)
    ? (rawReq.deliverables as Array<{ name?: string; kind?: string; description?: string }>)
    : [];
  const checks = Array.isArray(rawReq.checks) ? rawReq.checks.map((check, index) => {
    const record = check && typeof check === 'object' ? check as Record<string, unknown> : {};
    const id = record.check ?? record.gateId ?? record.id;
    return {
      id: typeof id === 'string' && id.trim() ? id : `unidentified-gate-${index + 1}`,
      title: typeof record.title === 'string' ? record.title : '',
      applies: record.applies !== false,
    };
  }) : [];

  return (
    <div className="space-y-5">
      {/* Studio Control Header */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
            <div className="min-w-[260px] flex-1 max-w-md">
              <label className="block text-[11px] text-[#9CA3AF] mb-1">Active Bounty</label>
              <Select
                value={selectedSlug}
                onChange={(e) => changeSelection(e.target.value)}
                className="w-full"
                aria-label="Select bounty"
              >
                {!selectedSlug && <option value="">{bounties.length ? 'Select a bounty...' : 'Sync bounties first...'}</option>}
                {selectedSlug && !bounties.some((item) => item.slug === selectedSlug) && (
                  <option value={selectedSlug}>{bounty?.title ?? selectedSlug}</option>
                )}
                {bounties.map((b) => (
                  <option key={b.slug} value={b.slug}>
                    [{b.status.toUpperCase()}] {b.title} ({formatUsd(b.potUsd || b.rewardAmount)})
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-w-0 max-w-56">
              <div className="text-[11px] text-[#9CA3AF]">OpenAI-compatible model</div>
              <div className="truncate text-xs text-[#D1D5DB] font-mono" title={model}>{model}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 pt-3 sm:pt-0">
            {bounty && <SyncStateIndicator state={bounty.syncState} />}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (requestGuard.slug === selectedSlug && !working &&
                    !['context', 'enhance', 'save', 'manual', 'reuse'].some(requestGuard.isPending)) {
                  void loadBountyContext(selectedSlug, true, contextMatches);
                }
              }}
              disabled={working || !selectedSlug}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBounty ? 'animate-spin' : ''}`} />
              <span>Refresh Official</span>
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleEnhanceWithAI()}
              disabled={!canRunEnhancement}
            >
              <Sparkles className={`w-4 h-4 ${enhancing ? 'animate-spin' : ''}`} />
              <span>Enhance with AI</span>
            </Button>
          </div>
        </div>

        {enhancing && (
          <div role="status" className="mt-3 pt-3 border-t border-white/[0.07] text-xs font-mono text-[#3B82F6]">
            Sedang menganalisis bounty
          </div>
        )}

        {enhancementLog.length > 0 && (
          <div className="mt-2 rounded-md border border-white/10 bg-[#090B0E] p-3">
            <h3 className="text-xs font-semibold text-[#D1D5DB]" id="enhancement-log-title">Terminal log</h3>
            <div ref={enhancementLogRef} role="log" aria-labelledby="enhancement-log-title" className="mt-2 max-h-44 space-y-1 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-[#D1D5DB]">
              {enhancementLog.map(({ timestamp, message }, index) => (
                <p key={index}>
                  <time dateTime={timestamp} className="mr-2 text-[#9CA3AF]">{new Date(timestamp).toLocaleTimeString('id-ID')}</time>
                  {message}
                </p>
              ))}
            </div>
          </div>
        )}

        {loadingBounty && <p role="status" className="mt-3 text-xs text-[#9CA3AF]">Loading bounty context…</p>}
        {checkingReuseRules && <p role="status" className="mt-3 text-xs text-[#9CA3AF]">Verifying current official rules…</p>}
        {[listError, contextError].filter(Boolean).map((message, i) => (
          <p key={i} role="alert" className="mt-3 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/30 px-3.5 py-2.5 text-xs text-[#FCA5A5]">{message}</p>
        ))}

        {enhanceError && (
          <div className="mt-3 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/30 px-3.5 py-2.5 text-xs text-[#FCA5A5]">
            <p role="alert">{enhanceError}</p>
            {uncoveredGateError.length > 0 && (
              <ul className="mt-1 list-disc pl-4" aria-label="Uncovered gates">
                {uncoveredGateError.map((gate, index) => (
                  <li key={index}>{gate.gateId}{gate.reason && ` — ${gate.reason}`}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {cacheOffer && (
          <div className="mt-3 rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2.5 text-xs text-[#FCD34D] space-y-2">
            <p>Official refresh failed. Using this cached snapshot may omit newer rules.</p>
            <p className="font-mono break-all">Snapshot #{cacheOffer.id} · {cacheOffer.contentHash}</p>
            <Button variant="secondary" size="sm" disabled={!canEnhance} onClick={() => void handleEnhanceWithAI(cacheOffer)}>
              Use cached snapshot from {formatDateTime(cacheOffer.fetchedAt)}
            </Button>
          </div>
        )}

        {saveNotice && (
          <div className="mt-3 rounded-md bg-[#10B981]/10 border border-[#10B981]/30 px-3.5 py-2.5 text-xs text-[#6EE7B7]">
            {saveNotice}
          </div>
        )}
      </Panel>

      {!bounty ? (
        <Panel>
          <EmptyState
            title={contextError ? 'Bounty context failed to load' : loadingBounty ? 'Loading bounty context…' : 'Select a bounty to open Prompt Studio'}
            description="Choose an open or resolved make.fun competition above to inspect its verbatim official requirements and run AI enhancement."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Panel 1 (Official Requirements) + Panel 2 (AI Analysis) */}
          <div className="xl:col-span-6 space-y-5">
            <BountyResearchPanel bounty={bounty} snapshot={researchSnapshot} leaderboard={leaderboardInsights}
              refreshError={researchRefreshError} analysis={activeAnalysis} />
            {/* PANEL 1: Official Requirements Panel */}
            <Panel>
              <PanelHeader
                title="1. Official Requirements Panel"
                subtitle={`${bounty.category} · ${formatUsd(bounty.potUsd || bounty.rewardAmount)}`}
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowManualPromptBox((v) => !v)}
                      disabled={working}
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                      <span>Paste Manual Source</span>
                    </Button>
                    <a
                      href={bounty.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#3B82F6] hover:underline"
                    >
                      <span>Source</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                }
              />
              <div className="p-5 space-y-4 text-xs">
                {!standardPrompt && (
                  <p role="status" className="rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2.5 text-[#FCD34D]">
                    No verified standard prompt source is available. Refresh Official or paste the exact prompt from the bounty page as a manual source.
                  </p>
                )}
                <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)] text-[11px] text-[#9CA3AF]">
                  <dt>Source kind</dt><dd>{standardPrompt ? snapshot?.promptSource?.kind : 'Unavailable'}</dd>
                  <dt>Source locator</dt><dd className="break-all">{standardPrompt ? snapshot?.promptSource?.locator : '—'}</dd>
                  <dt>Source captured</dt><dd>{standardPrompt && snapshot?.promptSource ? formatDateTime(snapshot.promptSource.capturedAt) : '—'}</dd>
                  <dt>Snapshot ID</dt><dd className="font-mono">{snapshot?.id ?? '—'}</dd>
                  <dt>Snapshot hash</dt><dd className="font-mono break-all">{snapshot?.contentHash ?? '—'}</dd>
                  <dt>Requirements complete</dt><dd>{snapshot?.requirementsComplete === true ? 'Yes' : snapshot?.requirementsComplete === false ? 'No' : 'Unknown'}</dd>
                </dl>
                {refreshIssues.length > 0 && (
                  <div className="rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2.5 text-[#FCD34D]">
                    <p className="font-semibold">Official refresh issues</p>
                    <ul className="list-disc pl-4 mt-1">
                      {refreshIssues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                )}
                {showManualPromptBox && (
                  <div className="space-y-2 pb-4 border-b border-white/[0.07]">
                    <p className="text-[#9CA3AF]">
                      If Make.fun’s standard prompt is unavailable, paste the entire prompt from the competition page. The source will be labeled Manual input.
                    </p>
                    <Textarea
                      rows={5}
                      value={manualPromptDraft}
                      onChange={(e) => setManualPromptDraft(e.target.value)}
                      onPaste={(event) => {
                        const { value, selectionStart, selectionEnd } = event.currentTarget;
                        if (selectionStart !== 0 || selectionEnd !== value.length) return;
                        const text = event.clipboardData.getData('text/plain');
                        if (!text) return;
                        event.preventDefault();
                        setManualPromptDraft(text);
                      }}
                      placeholder="Paste verified official prompt text..."
                      className="font-mono text-xs"
                      disabled={working}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveManualPrompt}
                        disabled={working || !manualPromptDraft.trim()}
                      >
                        {savingManualPrompt ? 'Saving…' : 'Save Manual Prompt'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowManualPromptBox(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-[#F3F4F6]">
                      Verbatim Official Prompt (Preserved Unmodified)
                    </span>
                    <span className="font-mono text-[11px] text-[#9CA3AF]">
                      Captured {snapshot ? formatDateTime(snapshot.fetchedAt) : 'N/A'}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-[#090B0E] border border-white/[0.07] rounded-md p-3.5 text-[#D1D5DB] max-h-56 overflow-y-auto">
                    {standardPrompt}
                  </pre>
                </div>

                {deliverables.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-[#F3F4F6] mb-1">Deliverables</h4>
                    <ul className="space-y-1 text-[#9CA3AF]">
                      {deliverables.map((d, i) => (
                        <li key={i}>
                          <span className="font-mono text-[#D1D5DB]">{d.name}</span> ({d.kind}):{' '}
                          {d.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {checks.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-[#F3F4F6] mb-1">
                      Official Gate Checks ({checks.filter((check) => check.applies).length} active)
                    </h4>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[#9CA3AF]">
                      {checks.map((check, i) => (
                        <span key={i}>{check.id}{check.title && ` — ${check.title}`}{!check.applies && ' (not applicable)'}</span>
                      ))}
                    </div>
                  </div>
                )}

                {leaderboardInsights && (
                  <div className="pt-3 border-t border-white/[0.06] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-semibold text-[#F3F4F6]">
                        Leaderboard Gap Insights ({leaderboardInsights.rankKeyTitle})
                      </h4>
                      <span className="font-mono text-[11px] text-[#9CA3AF] tabular-nums">
                        {leaderboardInsights.totalRanked} ranked
                      </span>
                    </div>
                    <p className="text-[#D1D5DB] leading-relaxed">
                      {leaderboardInsights.gapSummary}
                    </p>
                    {leaderboardInsights.topEntries.length > 0 && (
                      <div className="bg-[#090B0E] border border-white/[0.06] rounded p-2.5 overflow-x-auto">
                        <table className="w-full text-left text-[11px]">
                          <thead className="text-[#9CA3AF] border-b border-white/[0.06]">
                            <tr>
                              <th className="py-1 pr-2 font-medium">Rank</th>
                              <th className="py-1 pr-2 font-medium">Entry</th>
                              <th className="py-1 pr-2 font-medium">Hunter</th>
                              <th className="py-1 text-right font-medium">
                                {leaderboardInsights.rankKeyTitle}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.04]">
                            {leaderboardInsights.topEntries.slice(0, 3).map((entry, idx) => (
                              <tr key={idx} className="text-[#D1D5DB]">
                                <td className="py-1 pr-2 font-mono tabular-nums">
                                  #{entry.rank ?? idx + 1}
                                </td>
                                <td className="py-1 pr-2 truncate max-w-[160px]">{entry.title}</td>
                                <td className="py-1 pr-2 font-mono text-[#9CA3AF]">@{entry.handle}</td>
                                <td className="py-1 text-right font-mono tabular-nums text-[#10B981]">
                                  {entry.primaryMetricValue}
                                </td>
                              </tr>
                            ))}
                            {leaderboardInsights.houseBaseline && (
                              <tr className="text-[#9CA3AF]">
                                <td className="py-1 pr-2 font-mono tabular-nums">
                                  #{leaderboardInsights.houseBaseline.rank ?? '—'}
                                </td>
                                <td className="py-1 pr-2 truncate max-w-[160px]">
                                  {leaderboardInsights.houseBaseline.title} (Baseline)
                                </td>
                                <td className="py-1 pr-2 font-mono">house</td>
                                <td className="py-1 text-right font-mono tabular-nums">
                                  {leaderboardInsights.houseBaseline.primaryMetricValue}
                                </td>
                              </tr>
                            )}
                            {leaderboardInsights.accountEntry &&
                              !leaderboardInsights.topEntries
                                .slice(0, 3)
                                .some((e) => e.isAccountMatch) && (
                                <tr className="text-[#93C5FD] bg-[#3B82F6]/10">
                                  <td className="py-1 pr-2 font-mono tabular-nums">
                                    #{leaderboardInsights.accountEntry.rank ?? '—'}
                                  </td>
                                  <td className="py-1 pr-2 truncate max-w-[160px]">
                                    {leaderboardInsights.accountEntry.title}
                                  </td>
                                  <td className="py-1 pr-2 font-mono">
                                    @{leaderboardInsights.accountEntry.handle}
                                  </td>
                                  <td className="py-1 text-right font-mono tabular-nums">
                                    {leaderboardInsights.accountEntry.primaryMetricValue}
                                  </td>
                                </tr>
                              )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>

            {/* PANEL 2: AI Analysis Panel */}
            <Panel>
              <PanelHeader
                title="2. AI Analysis & Research Panel"
                subtitle={
                  activeAnalysis
                    ? `Model: ${activeAnalysis.model} · Generated ${formatDateTime(activeAnalysis.createdAt)}`
                    : 'Click "Enhance with AI" to run real multi-stage research and competitive analysis'
                }
                actions={
                  analyses.length > 1 && (
                    <Select
                      value={activeAnalysis?.id || ''}
                      disabled={working}
                      onChange={(e) => {
                        const found = analyses.find((a) => a.id === e.target.value);
                        if (found) {
                          setActiveAnalysis(found);
                          if (bounty) {
                            const customOnly = selectedSkills.filter((s) => s.source === 'founder_custom');
                            setSelectedSkills(
                              mergeRecommendedSkills({
                                officialSkills: extractOfficialBountySkills(bounty),
                                aiSkills: found.recommendedSkills || [],
                                customSkills: customOnly,
                              })
                            );
                          }
                        }
                      }}
                      className="h-7 text-xs"
                    >
                      {analyses.map((a, idx) => (
                        <option key={a.id} value={a.id}>
                          Run #{analyses.length - idx} ({a.model})
                        </option>
                      ))}
                    </Select>
                  )
                }
              />

              {!activeAnalysis ? (
                <EmptyState
                  title="No AI analysis generated for this bounty yet"
                  description="Prompt Studio never generates drafts automatically. Click Enhance with AI above when you are ready to analyze this competition."
                  action={
                    <Button variant="primary" size="sm" onClick={() => void handleEnhanceWithAI()} disabled={!canRunEnhancement}>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Enhance with AI</span>
                    </Button>
                  }
                />
              ) : (
                <div className="p-5 space-y-5 text-xs leading-relaxed">
                  {analysisEvidence ? (
                    <div className="space-y-2 rounded-md bg-[#090B0E] border border-white/[0.07] p-3">
                      <h4 className="font-semibold text-[#F3F4F6]">Analysis Evidence</h4>
                      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)] text-[11px] text-[#9CA3AF]">
                        <dt>Snapshot ID</dt><dd className="font-mono">{analysisEvidence.snapshotId}</dd>
                        <dt>Snapshot hash</dt><dd className="font-mono break-all">{analysisEvidence.snapshotHash}</dd>
                        <dt>Rules hash</dt><dd className="font-mono break-all">{analysisEvidence.rulesHash}</dd>
                        <dt>Context hash</dt><dd className="font-mono break-all">{analysisEvidence.contextHash}</dd>
                        <dt>Context fetched</dt><dd>{formatDateTime(analysisEvidence.contextFetchedAt)}</dd>
                        <dt>Used cache</dt><dd>{analysisEvidence.usedCache ? 'Yes' : 'No'}</dd>
                        <dt>Source kind</dt><dd>{analysisEvidence.promptSource.kind}</dd>
                        <dt>Source locator</dt><dd className="break-all">{analysisEvidence.promptSource.locator}</dd>
                        <dt>Source captured</dt><dd>{formatDateTime(analysisEvidence.promptSource.capturedAt)}</dd>
                      </dl>
                      <h5 className="font-semibold text-[#F3F4F6]">Gate Coverage ({coverage.filter((gate) => gate.status === 'uncovered').length} uncovered)</h5>
                      {coverage.length === 0 ? <p className="text-[#9CA3AF]">No applicable gates were recorded for this run.</p> : (
                        <ul className="space-y-1">
                          {coverage.map((gate, index) => (
                            <li key={index} className={gate.status === 'uncovered' ? 'text-[#FCD34D]' : 'text-[#D1D5DB]'}>
                              <span className="font-mono">{gate.gateId}</span> · {gate.status}
                              {gate.reason && <p>{gate.reason}</p>}
                              {gate.verification && <p>Verification: {gate.verification}</p>}
                              {gate.evidence && <p>Evidence: {gate.evidence}</p>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : <p className="text-[#FCD34D]">This saved analysis has no snapshot evidence or gate coverage.</p>}
                  <div>
                    <h4 className="font-semibold text-[#F3F4F6] mb-1">Objective & Core Strategy</h4>
                    <p className="text-[#D1D5DB]">{activeAnalysis.objectiveSummary}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/[0.06]">
                    <div>
                      <h4 className="font-semibold text-[#F3F4F6] mb-1">Recommended Approach</h4>
                      <p className="text-[#D1D5DB]">{activeAnalysis.recommendedApproach}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#F3F4F6] mb-1">Differentiation Opportunities</h4>
                      <p className="text-[#D1D5DB]">{activeAnalysis.differentiationStrategy}</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/[0.06]">
                    <h4 className="font-semibold text-[#F3F4F6] mb-1">
                      Architecture / Domain Methodology
                    </h4>
                    <p className="text-[#D1D5DB]">{activeAnalysis.architectureOrMethodology}</p>
                  </div>

                  {activeAnalysis.priorityMatrix.length > 0 && (
                    <div className="pt-3 border-t border-white/[0.06]">
                      <h4 className="font-semibold text-[#F3F4F6] mb-2">
                        Judging Criteria Priority Matrix
                      </h4>
                      <div className="space-y-2">
                        {activeAnalysis.priorityMatrix.map((p, idx) => (
                          <div
                            key={idx}
                            className="bg-[#090B0E] border border-white/[0.06] rounded p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2 font-medium text-[#F3F4F6]">
                              <span>{p.criterion}</span>
                              <span className="font-mono text-[11px] text-[#3B82F6]">
                                {p.weightOrEmphasis}
                              </span>
                            </div>
                            <p className="text-[#9CA3AF] mt-1">{p.actionableFocus}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeAnalysis.recommendedSkills && activeAnalysis.recommendedSkills.length > 0 && (
                    <div className="pt-3 border-t border-white/[0.06]">
                      <h4 className="font-semibold text-[#F3F4F6] mb-2">
                        AI-Recommended Agent Skill Stack ({activeAnalysis.recommendedSkills.length})
                      </h4>
                      <div className="space-y-2">
                        {activeAnalysis.recommendedSkills.map((sk) => (
                          <div
                            key={sk.id}
                            className="bg-[#090B0E] border border-white/[0.06] rounded p-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-[#F3F4F6]">{sk.name}</span>
                              <span className="font-mono text-[11px] text-[#9CA3AF]">
                                {sk.priority} · {sk.category} · {formatSkillSourceLabel(sk.source)}
                              </span>
                            </div>
                            <p className="text-[#9CA3AF] mt-1">{sk.rationale}</p>
                            <p className="text-[#D1D5DB] mt-1 font-mono text-[11px]">
                              Directive: {sk.agentDirective}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-white/[0.06]">
                    <h4 className="font-semibold text-[#F3F4F6] mb-1.5">
                      Verifiable Research References ({activeAnalysis.researchReferences.length})
                    </h4>
                    <p className="text-[11px] text-[#9CA3AF] mb-2">
                      {activeAnalysis.researchDisclosures}
                    </p>
                    <ul className="space-y-1.5">
                      {activeAnalysis.researchReferences.map((ref, idx) => (
                        <li key={idx} className="flex items-start justify-between gap-2">
                          <a
                            href={ref.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#3B82F6] hover:underline inline-flex items-center gap-1 break-all"
                          >
                            <span>{ref.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                          <span className="font-mono text-[10px] text-[#9CA3AF] shrink-0">
                            {formatSourceTypeLabel(ref.sourceType)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/[0.06]">
                    <div>
                      <h4 className="font-semibold text-[#F3F4F6] mb-1">Implementation Risks</h4>
                      <ul className="list-disc pl-4 space-y-1 text-[#FCA5A5]">
                        {activeAnalysis.risks.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#F3F4F6] mb-1">
                        Assumptions & Uncertainties
                      </h4>
                      <ul className="list-disc pl-4 space-y-1 text-[#FCD34D]">
                        {activeAnalysis.assumptionsUncertainties.map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          {/* RIGHT COLUMN: Panel 3 (Enhanced Prompt Editor) + Panel 4 (Final Prompt Preview & Versions) */}
          <div className="xl:col-span-6 space-y-5">
            {/* PANEL 3: Enhanced Prompt Editor */}
            <Panel>
              <PanelHeader
                title="3. Enhanced Prompt Editor"
                subtitle={
                  draft
                    ? `Draft persisted · ${versions.length} saved version(s)`
                    : 'Edit AI enhancement, add Founder instructions, and save an append-only version'
                }
                actions={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveVersion}
                    disabled={!canUseEditor}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingVersion ? 'Saving...' : 'Save New Version'}</span>
                  </Button>
                }
              />
              <div className="p-5 space-y-4">
                {editorSource?.legacy && (
                  <div role="status" className="space-y-2 rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2.5 text-xs text-[#FCD34D]">
                    <p><span className="font-mono">legacy_unverified</span> · This saved Part 1 has no verified source. Copy, export, and save are disabled until you adopt the current standard prompt or supply a manual source. Enhancement can be run against a refreshed verified context; doing so replaces this legacy Part 1 in the editor.</p>
                    <pre className="whitespace-pre-wrap font-mono max-h-56 overflow-y-auto">{editorSource.part1}</pre>
                    {standardPrompt && (
                      <Button variant="secondary" size="sm" disabled={working} onClick={handleAdoptCurrentSource}>
                        Use current standard prompt
                      </Button>
                    )}
                    {!standardPrompt && (
                      <p>Paste and save the exact prompt from the competition page to replace the unverified Part 1 source.</p>
                    )}
                  </div>
                )}
                {staleKey && (
                  <div className="space-y-2 rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-3.5 py-2.5 text-xs text-[#FCD34D]">
                    <p role="status">{currentRules
                      ? `Stale rules · This editor uses snapshot #${sourceSnapshotId}. The current snapshot #${currentRules.id} does not match its rules hash. Run Enhance with AI again for the current rules, or acknowledge the older rules below.`
                      : `Current rules unavailable · This editor uses snapshot #${sourceSnapshotId}, but the latest rules could not be verified. Copy, export, and Save require explicit acknowledgment below.`}</p>
                    {reuseRulesFailure && <p>{reuseRulesFailure}</p>}
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={allowStaleRules} disabled={working} className="mt-0.5 accent-[#3B82F6]"
                        onChange={(e) => setStaleAcknowledgment(e.target.checked ? staleKey : null)} />
                      {currentRules ? 'I understand that Copy, export, and Save will use the older rules.'
                        : 'I understand that the latest rules are unverified. Use the recorded source snapshot for Copy, export, and Save.'}
                    </label>
                  </div>
                )}
                {/* Agent Skill Playbook */}
                <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-semibold text-[#F3F4F6]">
                        Agent Skill Playbook
                      </h4>
                      <p className="text-[11px] text-[#9CA3AF] tabular-nums">
                        {selectedSkills.filter((s) => s.enabled).length} of {selectedSkills.length} skill(s) enabled · Injected into Part 2 of Master Prompt
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAddSkill((v) => !v)}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{showAddSkill ? 'Close Form' : 'Add Custom Skill'}</span>
                    </Button>
                  </div>

                  {showAddSkill && (
                    <form
                      onSubmit={handleAddCustomSkill}
                      className="pt-2.5 border-t border-white/[0.06] space-y-2.5 text-xs"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Input
                          value={customSkillName}
                          onChange={(e) => setCustomSkillName(e.target.value)}
                          placeholder="Skill / tool name (e.g. minimax-bitboard)"
                          className="h-8 text-xs"
                          required
                        />
                        <Input
                          value={customSkillCategory}
                          onChange={(e) => setCustomSkillCategory(e.target.value)}
                          placeholder="Category (e.g. Optimization)"
                          className="h-8 text-xs"
                        />
                        <Select
                          value={customSkillPriority}
                          onChange={(e) => setCustomSkillPriority(e.target.value as SkillPriority)}
                          className="h-8 text-xs"
                        >
                          <option value="essential">essential</option>
                          <option value="recommended">recommended</option>
                          <option value="optional">optional</option>
                        </Select>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          value={customSkillDirective}
                          onChange={(e) => setCustomSkillDirective(e.target.value)}
                          placeholder="Concrete Hermes directive (how & when to apply this skill)..."
                          className="h-8 text-xs flex-1"
                          required
                        />
                        <Button type="submit" variant="primary" size="sm">
                          Add Skill
                        </Button>
                      </div>
                    </form>
                  )}

                  {selectedSkills.length === 0 ? (
                    <p className="text-[11px] text-[#9CA3AF]">
                      No official or AI-curated skills loaded yet. Click &quot;Enhance with AI&quot; to generate tailored skill directives or add a custom skill above.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {selectedSkills.map((sk) => (
                        <div
                          key={sk.id}
                          className={`rounded border px-3 py-2 text-xs transition-colors ${
                            sk.enabled
                              ? 'bg-[#11151B] border-white/[0.08]'
                              : 'bg-[#090B0E]/60 border-white/[0.04] opacity-60'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={sk.enabled}
                                onChange={() => handleToggleSkill(sk.id)}
                                className="mt-0.5 rounded border-white/20 bg-[#090B0E] accent-[#3B82F6] shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="font-medium text-[#F3F4F6]">{sk.name}</span>
                                  <span className="font-mono text-[11px] text-[#9CA3AF]">
                                    {sk.priority} · {sk.category} · {formatSkillSourceLabel(sk.source)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[#9CA3AF] mt-0.5">{sk.rationale}</p>
                                <p className="text-[11px] text-[#D1D5DB] font-mono mt-1 break-words">
                                  Directive: {sk.agentDirective}
                                </p>
                              </div>
                            </label>
                            {sk.source === 'founder_custom' && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomSkill(sk.id)}
                                className="text-[#9CA3AF] hover:text-[#EF4444] p-1 cursor-pointer shrink-0"
                                title="Remove custom skill"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                    Part 2 — COSMICLABS AI Enhancement (Editable)
                  </label>
                  <Textarea
                    rows={8}
                    value={part2Enhancement}
                    onChange={(e) => setPart2Enhancement(e.target.value)}
                    placeholder="Run Enhance with AI to populate competition-specific enhancement instructions, or author them directly..."
                    className="font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                    Part 3 — Hermes Execution & Compliance Guidelines (Editable)
                  </label>
                  <Textarea
                    rows={5}
                    value={part3Guidelines}
                    onChange={(e) => setPart3Guidelines(e.target.value)}
                    placeholder="Run Enhance with AI to populate bounty-specific execution constraints..."
                    className="font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                      Founder Instructions (Injected into Part 2)
                    </label>
                    <Textarea
                      rows={3}
                      value={founderInstructions}
                      onChange={(e) => setFounderInstructions(e.target.value)}
                      placeholder="Optional constraints, language preferences, or local tooling notes for Hermes..."
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                      Founder Notes & Version Summary
                    </label>
                    <Textarea
                      rows={2}
                      value={founderNotes}
                      onChange={(e) => setFounderNotes(e.target.value)}
                      placeholder="Private strategy notes..."
                      className="text-xs mb-2"
                    />
                    <Input
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      placeholder="Version edit summary (e.g. Tightened byte budget)"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            </Panel>

            {/* PANEL 4: Final Master Prompt Preview, Export & Version Comparison */}
            <Panel>
              <PanelHeader
                title="4. Final Master Prompt Preview"
                subtitle="Ready to copy into Hermes (read-only command center — never executes prompts)"
                actions={
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" disabled={!canUseEditor} onClick={handleCopyPrompt}>
                      {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!canUseEditor}
                      onClick={async () => {
                        const verified = await verifyRulesBeforeReuse();
                        if (!verified || !verified.request.isCurrent()) return;
                        downloadMarkdownFile(`${bounty.slug}-cosmiclabs-master-prompt.md`, assembledMasterPrompt);
                        verified.request.finish();
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export .md</span>
                    </Button>
                  </div>
                }
              />

              <div className="px-5 pt-3 border-b border-white/[0.07] flex items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewTab('preview')}
                  className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                    previewTab === 'preview'
                      ? 'border-[#3B82F6] text-[#F3F4F6]'
                      : 'border-transparent text-[#9CA3AF] hover:text-[#F3F4F6]'
                  }`}
                >
                  Master Prompt Markdown
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('versions')}
                  className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                    previewTab === 'versions'
                      ? 'border-[#3B82F6] text-[#F3F4F6]'
                      : 'border-transparent text-[#9CA3AF] hover:text-[#F3F4F6]'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Saved Versions ({versions.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('diff')}
                  className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                    previewTab === 'diff'
                      ? 'border-[#3B82F6] text-[#F3F4F6]'
                      : 'border-transparent text-[#9CA3AF] hover:text-[#F3F4F6]'
                  }`}
                >
                  <GitCompare className="w-3.5 h-3.5" />
                  <span>Compare Versions</span>
                </button>
              </div>

              <div className="p-5">
                {previewTab === 'preview' && (
                  canUseEditor ? (
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-[#090B0E] border border-white/[0.07] rounded-md p-4 text-[#E5E7EB] max-h-[460px] overflow-y-auto">
                      {assembledMasterPrompt}
                    </pre>
                  ) : (
                    <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-4 text-xs text-[#9CA3AF]">
                      Prompt preview requires a verified Part 1 source, nonblank Parts 2 and 3, and acknowledgment of any changed or unavailable current rules.
                    </div>
                  )
                )}

                {previewTab === 'versions' && (
                  <div className="space-y-2.5">
                    {versions.length === 0 ? (
                      <EmptyState
                        title="No saved versions yet"
                        description="Click Save New Version in the Editor above to create the first append-only version in SQLite."
                      />
                    ) : (
                      versions.map((v) => (
                        <div
                          key={v.id}
                          className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3.5 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div>
                            <div className="text-xs font-semibold text-[#F3F4F6]">
                              Version v{v.versionNumber} · {v.editSummary || 'Saved snapshot'}
                            </div>
                            <div className="text-[11px] text-[#9CA3AF] mt-0.5 font-mono">
                              {formatDateTime(v.createdAt)} · by {v.createdBy}
                              <br />
                              {versionSource(v).legacy ? 'legacy_unverified' : `verified · Snapshot #${v.sourceSnapshotId}`}
                              {v.sourceRulesHash && <p className="break-all">Rules hash: {v.sourceRulesHash}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={working}
                              onClick={() => handleLoadVersionIntoEditor(v)}
                            >
                              Load into Editor
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={working || versionSource(v).legacy}
                              title={versionSource(v).legacy ? 'Legacy Part 1 source is unverified' : 'Review this version in the editor before export'}
                              onClick={() => {
                                if (!canStart()) return;
                                handleLoadVersionIntoEditor(v);
                                setSaveNotice(`Loaded saved version v${v.versionNumber}. Review it, then use Export .md to verify current rules before downloading.`);
                              }}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <details className="w-full text-xs text-[#9CA3AF]">
                            <summary className="cursor-pointer">View saved Markdown</summary>
                            <pre className="mt-2 whitespace-pre-wrap font-mono max-h-72 overflow-y-auto text-[#E5E7EB]">{v.fullMarkdown}</pre>
                          </details>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {previewTab === 'diff' && (
                  <div className="space-y-3">
                    {versions.length < 2 ? (
                      <EmptyState
                        title="Save at least two versions to compare diffs"
                        description="Once you save a revised version in the Editor, you can inspect line-by-line additions and removals here."
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-[#9CA3AF] mb-1">Base Version</label>
                            <Select
                              value={diffBaseId}
                              onChange={(e) => setDiffBaseId(e.target.value)}
                              className="w-full h-8 text-xs"
                            >
                              {versions.map((v) => (
                                <option key={v.id} value={v.id}>
                                  v{v.versionNumber} — {v.editSummary}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#9CA3AF] mb-1">Target Version</label>
                            <Select
                              value={diffTargetId}
                              onChange={(e) => setDiffTargetId(e.target.value)}
                              className="w-full h-8 text-xs"
                            >
                              {versions.map((v) => (
                                <option key={v.id} value={v.id}>
                                  v{v.versionNumber} — {v.editSummary}
                                </option>
                              ))}
                            </Select>
                          </div>
                        </div>
                        <div className="font-mono text-[11px] bg-[#090B0E] border border-white/[0.07] rounded-md p-3 max-h-96 overflow-y-auto space-y-0.5">
                          {diffResult.map((line, i) => (
                            <div
                              key={i}
                              className={
                                line.type === 'added'
                                  ? 'bg-[#10B981]/15 text-[#6EE7B7] px-1.5'
                                  : line.type === 'removed'
                                    ? 'bg-[#EF4444]/15 text-[#FCA5A5] px-1.5'
                                    : 'text-[#9CA3AF] px-1.5'
                              }
                            >
                              {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                              {line.text || ' '}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
};
