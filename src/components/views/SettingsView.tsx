import React, { useEffect, useState } from 'react';
import { CheckCircle2, Save, Zap } from 'lucide-react';
import { Button, Input, Panel, PanelHeader } from '../ui/primitives';
import type { AppSettings } from '../../types/command-center';

interface SettingsViewProps {
  settings: AppSettings | null;
  onSettingsSaved: (updated: AppSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onSettingsSaved }) => {
  const [openaiCompatModel, setOpenaiCompatModel] = useState('llama3.1:8b');
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
  const [accountHandle, setAccountHandle] = useState('@0xkeinara');
  const [permittedPathsText, setPermittedPathsText] = useState('./evidence');

  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (settings) {
      setOpenaiCompatModel(settings.openaiCompatModel);
      setSyncIntervalMinutes(settings.syncIntervalMinutes);
      setAccountHandle(settings.accountHandle);
      setPermittedPathsText(settings.permittedEvidencePaths.join('\n'));
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    setSaveError(false);
    try {
      const paths = permittedPathsText
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openaiCompatModel,
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
        setSaveError(true);
        setSaveMsg(updated.error || 'Failed to save settings.');
      }
    } catch (err) {
      setSaveError(true);
      setSaveMsg(err instanceof Error ? err.message : 'Network error while saving settings.');
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
          openaiCompatModel,
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
          Configure the OpenAI-compatible model, make.fun sync preferences, and read-only Hermes evidence sources
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <Panel>
          <PanelHeader
            title="OpenAI-Compatible LLM"
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
            <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-[#9CA3AF]">Server OPENAI_COMPAT_API_KEY</span>
              {settings?.credentialStatus.openaiCompatKeyConfigured ? (
                <span className="inline-flex items-center gap-1.5 text-[#10B981] font-mono">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Configured (Env)</span>
                </span>
              ) : (
                <span className="text-[#9CA3AF] font-mono">Unset (Optional for local Ollama)</span>
              )}
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
                <label htmlFor="settings-llm-model" className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Model name
                </label>
                <Input
                  id="settings-llm-model"
                  value={openaiCompatModel}
                  onChange={(e) => setOpenaiCompatModel(e.target.value)}
                  placeholder="e.g. llama3.1:8b or qwen2.5-coder:14b"
                  maxLength={200}
                  required
                />
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  Provider pricing and quotas apply to enhancement and connection tests.
                </p>
              </div>
              <div>
                <label htmlFor="settings-llm-endpoint" className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Approved base URL
                </label>
                <Input id="settings-llm-endpoint" value={settings?.openaiCompatBaseUrl ?? ''} readOnly />
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  Set OPENAI_COMPAT_BASE_URL in the server environment and restart to change this endpoint.
                </p>
              </div>
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
          <div role="status" className={`text-xs ${saveError ? 'text-[#FCA5A5]' : 'text-[#10B981]'}`}>{saveMsg}</div>
          <Button type="submit" variant="primary" disabled={saving}>
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </Button>
        </div>
      </form>
    </div>
  );
};
