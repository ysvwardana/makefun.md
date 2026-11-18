import React, { useEffect, useMemo, useState } from 'react';
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
import { computeLineDiff, downloadMarkdownFile, formatDateTime, formatUsd } from '../../lib/utils';
import { fetch } from '../../lib/api';
import type {
  AIAnalysisRecord,
  AppSettings,
  BountyRecord,
  BountySnapshot,
  LeaderboardGapInsights,
  LLMProviderId,
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
  const [selectedSlug, setSelectedSlug] = useState<string>(initialSlug || '');
  const [loadingBounty, setLoadingBounty] = useState(false);

  const [bounty, setBounty] = useState<BountyRecord | null>(null);
  const [snapshot, setSnapshot] = useState<BountySnapshot | null>(null);
  const [leaderboardInsights, setLeaderboardInsights] = useState<LeaderboardGapInsights | null>(null);
  const [analyses, setAnalyses] = useState<AIAnalysisRecord[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<AIAnalysisRecord | null>(null);
  const [draft, setDraft] = useState<PromptDraftRecord | null>(null);
  const [versions, setVersions] = useState<PromptVersionRecord[]>([]);

  // LLM Configuration controls for this Studio run
  const [provider, setProvider] = useState<LLMProviderId>(settings?.provider || 'gemini');
  const [model, setModel] = useState<string>(settings?.model || 'gemini-4-hydrogen');
  const [enableGrounding, setEnableGrounding] = useState<boolean>(
    settings?.enableSearchGrounding ?? true
  );

  // Manual Official Prompt Fallback Drawer
  const [showManualPromptBox, setShowManualPromptBox] = useState(false);
  const [manualPromptDraft, setManualPromptDraft] = useState('');
  const [savingManualPrompt, setSavingManualPrompt] = useState(false);

  // Editor state
  const [part1Original, setPart1Original] = useState('');
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
  const [enhanceStageLabel, setEnhanceStageLabel] = useState('');
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [savingVersion, setSavingVersion] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Version comparison
  const [previewTab, setPreviewTab] = useState<'preview' | 'versions' | 'diff'>('preview');
  const [diffBaseId, setDiffBaseId] = useState<string>('');
  const [diffTargetId, setDiffTargetId] = useState<string>('');

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
      setModel(settings.provider === 'gemini' ? settings.model : settings.openaiCompatModel);
      setEnableGrounding(settings.enableSearchGrounding);
    }
  }, [settings]);

  useEffect(() => {
    if (initialSlug) {
      setSelectedSlug(initialSlug);
    }
  }, [initialSlug]);

  useEffect(() => {
    fetch('/api/bounties?status=all')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.items || []) as BountyRecord[];
        setBounties(list);
        if (!selectedSlug && list.length > 0) {
          const openFirst = list.find((b) => b.status === 'open') || list[0];
          setSelectedSlug(openFirst.slug);
        }
      })
      .catch(() => {});
  }, []);

  const loadBountyContext = async (slug: string, refresh = false) => {
    if (!slug) return;
    setLoadingBounty(true);
    setEnhanceError(null);
    setSaveNotice(null);
    try {
      const res = await fetch(`/api/bounties/${encodeURIComponent(slug)}${refresh ? '?refresh=1' : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setBounty(data.bounty);
      setSnapshot(data.snapshot);
      setLeaderboardInsights(data.leaderboardInsights || null);
      const latestAnalysis = ((data.analyses && data.analyses[0]) || null) as AIAnalysisRecord | null;
      setAnalyses(data.analyses || []);
      setActiveAnalysis(latestAnalysis);
      setDraft(data.draft || null);
      const vers = (data.versions || []) as PromptVersionRecord[];
      setVersions(vers);

      const verbatim =
        data.snapshot?.manualPromptOverride ||
        data.snapshot?.officialPromptText ||
        `${data.bounty.title}\n\n${data.bounty.summary || ''}`.trim();

      setPart1Original(verbatim);
      setManualPromptDraft(data.snapshot?.manualPromptOverride || data.snapshot?.officialPromptText || '');
      setFounderNotes(data.draft?.founderNotes || data.bounty.founderNotes || '');

      const officialSkills = extractOfficialBountySkills(data.bounty as BountyRecord);

      if (vers.length > 0) {
        const latest = vers[0];
        setPart2Enhancement(latest.part2AiEnhancement);
        setPart3Guidelines(latest.part3ExecutionGuidelines);
        setFounderInstructions(latest.founderInstructions);
        setSelectedSkills(
          latest.selectedSkills && latest.selectedSkills.length > 0
            ? latest.selectedSkills
            : mergeRecommendedSkills({
                officialSkills,
                aiSkills: latestAnalysis?.recommendedSkills || [],
              })
        );
        setDiffTargetId(latest.id);
        setDiffBaseId(vers[1]?.id || latest.id);
      } else {
        setPart2Enhancement('');
        setPart3Guidelines('');
        setFounderInstructions('');
        setSelectedSkills(
          mergeRecommendedSkills({
            officialSkills,
            aiSkills: latestAnalysis?.recommendedSkills || [],
          })
        );
        setDiffTargetId('');
        setDiffBaseId('');
      }
    } finally {
      setLoadingBounty(false);
    }
  };

  useEffect(() => {
    if (selectedSlug) {
      loadBountyContext(selectedSlug);
    }
  }, [selectedSlug]);

  const handleSaveManualPrompt = async () => {
    if (!selectedSlug || manualPromptDraft.trim().length < 10) return;
    setSavingManualPrompt(true);
    try {
      const res = await fetch(`/api/bounties/${encodeURIComponent(selectedSlug)}/manual-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualPromptText: manualPromptDraft }),
      });
      if (res.ok) {
        const data = await res.json();
        setSnapshot(data.snapshot);
        setPart1Original(data.snapshot.manualPromptOverride || data.snapshot.officialPromptText);
        setShowManualPromptBox(false);
        setSaveNotice('Saved manually verified official prompt text.');
      }
    } finally {
      setSavingManualPrompt(false);
    }
  };

  const handleEnhanceWithAI = async () => {
    if (!selectedSlug) return;
    setEnhancing(true);
    setEnhanceError(null);
    setSaveNotice(null);
    setEnhanceStageLabel('Stage 1/4: Verifying official bounty context...');

    const stageTimers = [
      setTimeout(() => setEnhanceStageLabel('Stage 2/4: Running read-only technical research...'), 1500),
      setTimeout(() => setEnhanceStageLabel('Stage 3/4: Synthesizing category-tailored enhancement...'), 4200),
      setTimeout(() => setEnhanceStageLabel('Stage 4/4: Verifying compliance & assembling prompt...'), 7500),
    ];

    try {
      const res = await fetch('/api/enhancer/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: selectedSlug,
          provider,
          model,
          enableGrounding,
          founderInstructions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEnhanceError(data.error || 'LLM enhancement failed.');
        return;
      }

      setActiveAnalysis(data.analysis);
      setAnalyses((prev) => [data.analysis, ...prev]);
      setPart1Original(data.part1OriginalPrompt);
      setPart2Enhancement(data.part2AiEnhancement);
      setPart3Guidelines(data.part3ExecutionGuidelines);
      if (bounty) {
        const customOnly = selectedSkills.filter((s) => s.source === 'founder_custom');
        setSelectedSkills(
          mergeRecommendedSkills({
            officialSkills: extractOfficialBountySkills(bounty),
            aiSkills: data.recommendedSkills || data.analysis?.recommendedSkills || [],
            customSkills: customOnly,
          })
        );
      } else if (Array.isArray(data.recommendedSkills)) {
        setSelectedSkills(data.recommendedSkills);
      }
      setEditSummary(`AI generated with ${data.analysis.model}`);
      setSaveNotice(
        'AI analysis & optimal skill stack generated. Review skills or prompt below, then click "Save New Version" to persist to SQLite.'
      );
      onDataMutated();
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : 'Network failure during enhancement');
    } finally {
      stageTimers.forEach(clearTimeout);
      setEnhancing(false);
      setEnhanceStageLabel('');
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

  const handleSaveVersion = async () => {
    if (!selectedSlug || !part2Enhancement.trim() || !part3Guidelines.trim()) {
      setEnhanceError('Part 2 Enhancement and Part 3 Execution Guidelines must be populated before saving a version.');
      return;
    }
    setSavingVersion(true);
    setEnhanceError(null);
    setSaveNotice(null);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(selectedSlug)}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId: activeAnalysis?.id || null,
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
      const data = await res.json();
      if (!res.ok) {
        setEnhanceError(data.error || 'Failed to save prompt version.');
        return;
      }
      setDraft(data.draft);
      setVersions((prev) => [data.version, ...prev]);
      setDiffTargetId(data.version.id);
      if (versions[0]) setDiffBaseId(versions[0].id);
      setEditSummary('');
      setSaveNotice(`Saved Version v${data.version.versionNumber} (including curated skill directives) to SQLite.`);
      onDataMutated();
    } finally {
      setSavingVersion(false);
    }
  };

  const handleLoadVersionIntoEditor = (v: PromptVersionRecord) => {
    setPart1Original(v.part1OriginalPrompt);
    setPart2Enhancement(v.part2AiEnhancement);
    setPart3Guidelines(v.part3ExecutionGuidelines);
    setFounderInstructions(v.founderInstructions);
    if (v.selectedSkills && v.selectedSkills.length > 0) {
      setSelectedSkills(v.selectedSkills);
    } else if (bounty) {
      setSelectedSkills(
        mergeRecommendedSkills({
          officialSkills: extractOfficialBountySkills(bounty),
          aiSkills: activeAnalysis?.recommendedSkills || [],
        })
      );
    }
    setSaveNotice(`Loaded saved version v${v.versionNumber} into editor.`);
  };

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(assembledMasterPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
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
  const checks = Array.isArray(rawReq.checks)
    ? (rawReq.checks as Array<{ check?: string; title?: string; applies?: boolean }>).filter(
        (c) => c.applies !== false
      )
    : [];

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
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="w-full"
                aria-label="Select bounty"
              >
                {bounties.length === 0 && <option value="">Sync bounties first...</option>}
                {bounties.map((b) => (
                  <option key={b.slug} value={b.slug}>
                    [{b.status.toUpperCase()}] {b.title} ({formatUsd(b.potUsd || b.rewardAmount)})
                  </option>
                ))}
              </Select>
            </div>

            <div className="w-56">
              <label className="block text-[11px] text-[#9CA3AF] mb-1">LLM Provider & Model</label>
              <Select
                value={provider === 'openai_compatible' ? 'openai_compatible' : model}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'openai_compatible') {
                    setProvider('openai_compatible');
                    setModel(settings?.openaiCompatModel || 'llama3.1:8b');
                  } else {
                    setProvider('gemini');
                    setModel(val);
                  }
                }}
                className="w-full"
                aria-label="Select LLM model"
              >
                {(settings?.availableModels || []).map((m) => (
                  <option
                    key={m.id}
                    value={m.provider === 'openai_compatible' ? 'openai_compatible' : m.id}
                  >
                    {m.label} (
                    {m.tier === 'free'
                      ? 'Free Tier'
                      : m.tier === 'depends_on_endpoint'
                        ? 'Cost Depends on Endpoint'
                        : 'Paid — Server Policy'}
                    )
                  </option>
                ))}
              </Select>
            </div>

            {provider === 'gemini' && (
              <label className="inline-flex items-center gap-2 text-xs text-[#D1D5DB] pt-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableGrounding}
                  onChange={(e) => setEnableGrounding(e.target.checked)}
                  className="rounded border-white/20 bg-[#090B0E] accent-[#3B82F6]"
                />
                <span>Google Search Research</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0 pt-3 sm:pt-0">
            {bounty && <SyncStateIndicator state={bounty.syncState} />}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => selectedSlug && loadBountyContext(selectedSlug, true)}
              disabled={loadingBounty || !selectedSlug}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingBounty ? 'animate-spin' : ''}`} />
              <span>Refresh Official</span>
            </Button>
            <Button
              variant="primary"
              onClick={handleEnhanceWithAI}
              disabled={enhancing || !selectedSlug}
            >
              <Sparkles className={`w-4 h-4 ${enhancing ? 'animate-spin' : ''}`} />
              <span>{enhancing ? 'Enhancing...' : 'Enhance with AI'}</span>
            </Button>
          </div>
        </div>

        {enhancing && enhanceStageLabel && (
          <div className="mt-3 pt-3 border-t border-white/[0.07] text-xs font-mono text-[#3B82F6]">
            {enhanceStageLabel}
          </div>
        )}

        {enhanceError && (
          <div className="mt-3 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/30 px-3.5 py-2.5 text-xs text-[#FCA5A5]">
            {enhanceError}
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
            title="Select a bounty to open Prompt Studio"
            description="Choose an open or resolved make.fun competition above to inspect its verbatim official requirements and run AI enhancement."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Panel 1 (Official Requirements) + Panel 2 (AI Analysis) */}
          <div className="xl:col-span-6 space-y-5">
            {/* PANEL 1: Official Requirements Panel */}
            <Panel>
              <PanelHeader
                title="1. Official Requirements Panel"
                subtitle={`${bounty.category} · ${formatUsd(bounty.potUsd || bounty.rewardAmount)} · Provenance: ${
                  snapshot?.manualPromptOverride ? 'manual_verified_paste' : 'make.fun official API'
                }`}
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowManualPromptBox((v) => !v)}
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                      <span>Manual Override</span>
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
                {showManualPromptBox && (
                  <div className="space-y-2 pb-4 border-b border-white/[0.07]">
                    <p className="text-[#9CA3AF]">
                      If the official API omitted part of the competition prompt, paste verified official text from the competition page below (tagged separately as manual override).
                    </p>
                    <Textarea
                      rows={5}
                      value={manualPromptDraft}
                      onChange={(e) => setManualPromptDraft(e.target.value)}
                      placeholder="Paste verified official prompt text..."
                      className="font-mono text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveManualPrompt}
                        disabled={savingManualPrompt}
                      >
                        {savingManualPrompt ? 'Saving...' : 'Save Official Override'}
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
                    {part1Original || 'No official prompt text available.'}
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
                      Verified Gate Checks ({checks.length} active)
                    </h4>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[#9CA3AF]">
                      {checks.slice(0, 14).map((c, i) => (
                        <span key={i}>{c.check}</span>
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
                    <Button variant="primary" size="sm" onClick={handleEnhanceWithAI} disabled={enhancing}>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Enhance with AI</span>
                    </Button>
                  }
                />
              ) : (
                <div className="p-5 space-y-5 text-xs leading-relaxed">
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
                    disabled={savingVersion}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingVersion ? 'Saving...' : 'Save New Version'}</span>
                  </Button>
                }
              />
              <div className="p-5 space-y-4">
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
                          placeholder="Concrete execution directive (how & when to apply this skill)..."
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
                    Part 3 — Execution & Compliance Guidelines (Editable)
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
                      placeholder="Optional constraints, language preferences, or local tooling notes for agents/developers..."
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
                subtitle="Ready to copy into AI coding agents, IDE assistants, or developer workflows (read-only command center — never executes prompts)"
                actions={
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={handleCopyPrompt}>
                      {copied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        downloadMarkdownFile(
                          `${bounty.slug}-cosmiclabs-master-prompt.md`,
                          assembledMasterPrompt
                        )
                      }
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
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-[#090B0E] border border-white/[0.07] rounded-md p-4 text-[#E5E7EB] max-h-[460px] overflow-y-auto">
                    {assembledMasterPrompt}
                  </pre>
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
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleLoadVersionIntoEditor(v)}
                            >
                              Load into Editor
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                downloadMarkdownFile(`${bounty.slug}-v${v.versionNumber}.md`, v.fullMarkdown)
                              }
                            >
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          </div>
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
