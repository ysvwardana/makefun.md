import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Save, Zap } from 'lucide-react';
import { Button, Input, Panel, PanelHeader, Select } from '../ui/primitives';
import type { AppSettings, LLMProviderId } from '../../types/command-center';

interface SettingsViewProps {
  settings: AppSettings | null;
  onSettingsSaved: (updated: AppSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onSettingsSaved }) => {
  const [provider, setProvider] = useState<LLMProviderId>('gemini');
  const [model, setModel] = useState('gemini-4-hydrogen');
  const [openaiCompatBaseUrl, setOpenaiCompatBaseUrl] = useState('http://localhost:11434/v1');
  const [openaiCompatModel, setOpenaiCompatModel] = useState('llama3.1:8b');
  const [allowPaidRequests, setAllowPaidRequests] = useState(false);
  const [enableSearchGrounding, setEnableSearchGrounding] = useState(true);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
  const [accountHandle, setAccountHandle] = useState('@0xkeinara');
  const [permittedPathsText, setPermittedPathsText] = useState('./evidence');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
      setModel(settings.model);
      setOpenaiCompatBaseUrl(settings.openaiCompatBaseUrl);
      setOpenaiCompatModel(settings.openaiCompatModel);
      setAllowPaidRequests(settings.allowPaidRequests);
      setEnableSearchGrounding(settings.enableSearchGrounding);
      setSyncIntervalMinutes(settings.syncIntervalMinutes);
      setAccountHandle(settings.accountHandle);
      setPermittedPathsText(settings.permittedEvidencePaths.join('\n'));
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const paths = permittedPathsText
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          openaiCompatBaseUrl,
          openaiCompatModel,
          allowPaidRequests,
          enableSearchGrounding,
          syncIntervalMinutes: Number(syncIntervalMinutes) || 30,
          accountHandle,
          permittedEvidencePaths: paths,
        }),
      });
      const updated = await res.json();
      if (res.ok) {
        onSettingsSaved(updated);
        setSaveMsg('Settings persisted locally in SQLite.');
      } else {
        setSaveMsg(updated.error || 'Failed to save settings.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          openaiCompatBaseUrl,
          openaiCompatModel,
          allowPaidRequests,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          message: `Connected to ${data.provider} (${data.model}) in ${data.latencyMs}ms · Reply: "${data.reply}"`,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || 'LLM connection check failed.',
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error during check.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="pb-2 border-b border-white/[0.07]">
        <h1 className="text-xl font-semibold text-[#F3F4F6] tracking-tight">Settings</h1>
        <p className="text-xs text-[#9CA3AF] mt-1">
          Configure LLM providers, model budget gating, make.fun sync preferences, and read-only Hermes evidence sources
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <Panel>
          <PanelHeader
            title="LLM Provider & Model Configuration"
            subtitle="All LLM API calls execute strictly server-side. No simulated fallback responses are ever substituted."
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{testing ? 'Testing...' : 'Test LLM Connection'}</span>
              </Button>
            }
          />
          <div className="p-5 space-y-4">
            {/* Read-only server credential status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3 flex items-center justify-between">
                <span className="text-[#9CA3AF]">Server GEMINI_API_KEY</span>
                {settings?.credentialStatus.geminiKeyConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[#10B981] font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Configured (Env)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[#F59E0B] font-mono">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Not Set</span>
                  </span>
                )}
              </div>
              <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3 flex items-center justify-between">
                <span className="text-[#9CA3AF]">Server OPENAI_COMPAT_API_KEY</span>
                {settings?.credentialStatus.openaiCompatKeyConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[#10B981] font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Configured (Env)</span>
                  </span>
                ) : (
                  <span className="text-[#9CA3AF] font-mono">Optional (Local Ollama needs none)</span>
                )}
              </div>
            </div>

            {testResult && (
              <div
                className={`rounded-md px-3.5 py-2.5 text-xs border ${
                  testResult.ok
                    ? 'bg-[#10B981]/10 border-[#10B981]/30 text-[#6EE7B7]'
                    : 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#FCA5A5]'
                }`}
              >
                {testResult.message}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Active LLM Provider
                </label>
                <Select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as LLMProviderId)}
                  className="w-full"
                >
                  <option value="gemini">Google Gemini (Server SDK)</option>
                  <option value="openai_compatible">OpenAI-Compatible Endpoint (Local / Free)</option>
                </Select>
              </div>

              {provider === 'gemini' ? (
                <div>
                  <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                    Gemini Model
                  </label>
                  <Select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full"
                  >
                    {(settings?.availableModels || [])
                      .filter((m) => m.provider === 'gemini')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.tier === 'free' ? 'Free Tier' : 'Paid — Requires Auth'})
                        </option>
                      ))}
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                    OpenAI-Compatible Model Name
                  </label>
                  <Input
                    value={openaiCompatModel}
                    onChange={(e) => setOpenaiCompatModel(e.target.value)}
                    placeholder="e.g. llama3.1:8b or qwen2.5-coder:14b"
                  />
                </div>
              )}
            </div>

            {provider === 'openai_compatible' && (
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  OpenAI-Compatible Base URL
                </label>
                <Input
                  value={openaiCompatBaseUrl}
                  onChange={(e) => setOpenaiCompatBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  Compatible with local Ollama, LM Studio, vLLM, or free OpenAI-compatible gateways configured via server environment variables.
                </p>
              </div>
            )}

            <div className="space-y-2.5 pt-2 border-t border-white/[0.07]">
              <label className="flex items-start gap-2.5 text-xs text-[#D1D5DB] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSearchGrounding}
                  onChange={(e) => setEnableSearchGrounding(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 accent-[#3B82F6]"
                />
                <span>
                  Enable Stage 2 Google Search Grounding (Gemini provider only) to retrieve verifiable external technical references during bounty analysis.
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-[#D1D5DB] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPaidRequests}
                  onChange={(e) => setAllowPaidRequests(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 accent-[#F59E0B]"
                />
                <span>
                  Explicit Founder Authorization for Paid Models (unlocks paid-tier models such as Gemini 4 Argon / Carbon; leave unchecked for Rp0 / $0 free-tier enforcement).
                </span>
              </label>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="make.fun Account & Read-Only Evidence Sources"
            subtitle="Read-only synchronization preferences and permitted local workspace evidence directories"
          />
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  make.fun Account Handle (Read-Only Filter)
                </label>
                <Input
                  value={accountHandle}
                  onChange={(e) => setAccountHandle(e.target.value)}
                  placeholder="@0xkeinara"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Target Sync Interval (Minutes)
                </label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={syncIntervalMinutes}
                  onChange={(e) => setSyncIntervalMinutes(Number(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                Permitted Local Evidence Directories (One relative path per line)
              </label>
              <textarea
                rows={3}
                value={permittedPathsText}
                onChange={(e) => setPermittedPathsText(e.target.value)}
                className="w-full rounded-md bg-[#0D1015] border border-white/[0.1] p-3 text-xs font-mono text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/60"
              />
              <p className="text-[11px] text-[#9CA3AF] mt-1">
                Strictly constrained within the workspace directory for read-only Hermes Monitor scans.
              </p>
            </div>
          </div>
        </Panel>

        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-[#10B981]">{saveMsg}</div>
          <Button type="submit" variant="primary" disabled={saving}>
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </Button>
        </div>
      </form>
    </div>
  );
};
