import React, { useEffect, useState } from 'react';
import { ExternalLink, History, Sparkles } from 'lucide-react';
import { Button, EmptyState, Panel, PanelHeader } from '../ui/primitives';
import { formatDateTime } from '../../lib/utils';
import type { PromptDraftRecord, PromptVersionRecord } from '../../types/command-center';

interface PromptLibraryViewProps {
  onOpenPromptStudio: (slug: string) => void;
}

export const PromptLibraryView: React.FC<PromptLibraryViewProps> = ({ onOpenPromptStudio }) => {
  const [drafts, setDrafts] = useState<PromptDraftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptVersionRecord[]>([]);
  const [activeVersion, setActiveVersion] = useState<PromptVersionRecord | null>(null);

  useEffect(() => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.drafts || []) as PromptDraftRecord[];
        setDrafts(list);
        if (list.length > 0) {
          selectDraft(list[0].bountySlug);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const selectDraft = async (slug: string) => {
    setSelectedSlug(slug);
    const res = await fetch(`/api/prompts/${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      const vers = (data.versions || []) as PromptVersionRecord[];
      setVersions(vers);
      setActiveVersion(vers[0] || null);
    }
  };


  return (
    <div className="space-y-5">
      <div className="pb-2 border-b border-white/[0.07]">
        <h1 className="text-xl font-semibold text-[#F3F4F6] tracking-tight">Prompt Library</h1>
        <p className="text-xs text-[#9CA3AF] mt-1">
          Append-only SQLite repository of enhanced Master Prompts across synced competitions
        </p>
      </div>

      {loading ? (
        <div className="h-64 rounded-lg bg-[#0F1216] border border-white/[0.08] animate-pulse" />
      ) : drafts.length === 0 ? (
        <Panel>
          <EmptyState
            title="Prompt Library is empty"
            description="Generate and save an enhanced prompt in AI Prompt Enhancer to build your persistent version library."
            action={
              <Button variant="primary" size="sm" onClick={() => onOpenPromptStudio('')}>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Open Prompt Studio</span>
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          <Panel className="xl:col-span-4">
            <PanelHeader
              title={`Saved Bounty Prompts (${drafts.length})`}
              subtitle="Select a competition to view its version timeline"
            />
            <div className="divide-y divide-white/[0.06]">
              {drafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDraft(d.bountySlug)}
                  className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer ${
                    selectedSlug === d.bountySlug ? 'bg-[#3B82F6]/10' : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="text-sm font-medium text-[#F3F4F6] line-clamp-1">
                    {d.bountyTitle || d.title}
                  </div>
                  <div className="text-xs text-[#9CA3AF] mt-1 font-mono tabular-nums">
                    {d.bountyCategory || 'General'} · {d.versionCount || 0} version(s) · Updated{' '}
                    {formatDateTime(d.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="xl:col-span-8">
            <PanelHeader
              title={
                activeVersion
                  ? `${selectedSlug} — Version v${activeVersion.versionNumber}`
                  : 'Prompt Version Inspector'
              }
              subtitle={
                activeVersion
                  ? `${activeVersion.editSummary} · Saved ${formatDateTime(activeVersion.createdAt)}`
                  : 'Select a saved version'
              }
              actions={
                activeVersion && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onOpenPromptStudio(activeVersion.bountySlug)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Edit in Studio</span>
                    </Button>
                  </div>
                )
              }
            />
            <div className="p-5 space-y-4">
              {activeVersion && <div className="text-xs text-[#FBBF24]" role="status">
                {activeVersion.provenanceStatus !== 'verified' ? 'Legacy — sumber Part 1 belum terbukti. ' : 'Riwayat sumber tersimpan; aturan terbaru belum diperiksa. '}
                Buka Studio untuk meninjau versi dan aturan sebelum Copy atau ekspor Master Prompt.
              </div>}
              {versions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-white/[0.07]">
                  <History className="w-3.5 h-3.5 text-[#9CA3AF]" />
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setActiveVersion(v)}
                      className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer transition-colors ${
                        activeVersion?.id === v.id
                          ? 'bg-[#3B82F6] text-white'
                          : 'bg-[#14181E] text-[#9CA3AF] hover:text-[#F3F4F6]'
                      }`}
                    >
                      v{v.versionNumber}
                    </button>
                  ))}
                </div>
              )}

              {activeVersion ? (
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed bg-[#090B0E] border border-white/[0.07] rounded-md p-4 text-[#E5E7EB] max-h-[540px] overflow-y-auto">
                  {activeVersion.fullMarkdown}
                </pre>
              ) : (
                <EmptyState
                  title="No versions available"
                  description="Save a version in Prompt Studio to preview it here."
                />
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
};
