import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Save, ShieldCheck, Zap } from 'lucide-react';
import { Button, Input, Panel, PanelHeader, Select } from '../ui/primitives';
import { fetch } from '../../lib/api';
import type {
  AppSettings,
  LLMConnectionTestReport,
  LLMProviderId,
} from '../../types/command-center';

interface SettingsViewProps {
  settings: AppSettings | null;
  onSettingsSaved: (updated: AppSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onSettingsSaved }) => {
  const [provider, setProvider] = useState<LLMProviderId>('gemini');
  const [model, setModel] = useState('gemini-4-hydrogen');
  const [openaiCompatBaseUrl, setOpenaiCompatBaseUrl] = useState('http://localhost:11434/v1');
  const [openaiCompatModel, setOpenaiCompatModel] = useState('llama3.1:8b');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiCompatApiKey, setOpenaiCompatApiKey] = useState('');
  const [enableSearchGrounding, setEnableSearchGrounding] = useState(true);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
  const [accountHandle, setAccountHandle] = useState('@0xkeinara');
  const [permittedPathsText, setPermittedPathsText] = useState('./evidence');
  const [operatorToken, setOperatorToken] = useState(() =>
    typeof window !== 'undefined' ? window.sessionStorage.getItem('cosmiclabs_op_token') || '' : ''
  );

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    report?: LLMConnectionTestReport;
  } | null>(null);

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider);
      setModel(settings.model);
      setOpenaiCompatBaseUrl(settings.openaiCompatBaseUrl);
      setOpenaiCompatModel(settings.openaiCompatModel);
      setEnableSearchGrounding(settings.enableSearchGrounding);
      setSyncIntervalMinutes(settings.syncIntervalMinutes);
      setAccountHandle(settings.accountHandle);
      setPermittedPathsText(settings.permittedEvidencePaths.join('\n'));
    }
  }, [settings]);

  const buildRequestHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (operatorToken.trim()) {
      headers['X-Operator-Token'] = operatorToken.trim();
    }
    return headers;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    setSaveError(null);
    try {
      const paths = permittedPathsText
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: buildRequestHeaders(),
        body: JSON.stringify({
          provider,
          model,
          openaiCompatBaseUrl,
          openaiCompatModel,
          geminiApiKey: geminiApiKey.trim() || undefined,
          openaiCompatApiKey: openaiCompatApiKey.trim() || undefined,
          enableSearchGrounding,
          syncIntervalMinutes: Number(syncIntervalMinutes) || 30,
          accountHandle,
          permittedEvidencePaths: paths,
        }),
      });
      const updated = await res.json();
      if (res.ok) {
        onSettingsSaved(updated);
        setGeminiApiKey('');
        setOpenaiCompatApiKey('');
        setSaveMsg('Settings persisted locally in SQLite.');
      } else {
        setSaveError(updated.error || 'Failed to save settings.');
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Network error while saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (mode: 'connectivity' | 'full' = 'full') => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test-llm', {
        method: 'POST',
        headers: buildRequestHeaders(),
        body: JSON.stringify({
          provider,
          model,
          openaiCompatBaseUrl: provider === 'openai_compatible' ? openaiCompatBaseUrl : undefined,
          openaiCompatModel: provider === 'openai_compatible' ? openaiCompatModel : undefined,
          mode,
        }),
      });
      const data = (await res.json()) as LLMConnectionTestReport & { error?: string };
      if (res.ok && data.connectivity) {
        setTestResult({
          ok: data.ok,
          message: data.ok
            ? `Passed connectivity & capability check on ${data.provider} (${data.model}) in ${data.latencyMs}ms.`
            : `Reachable (${data.connectivity.latencyMs}ms), but production capability check failed: ${data.capability.detail}`,
          report: data,
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
          Configure LLM providers, server-enforced safety &amp; budget policies, make.fun sync preferences, and read-only Hermes evidence sources
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        <Panel>
          <PanelHeader
            title="LLM Provider & Model Configuration"
            subtitle="All LLM API calls execute strictly server-side with timeouts, SSRF checks, and response caps. No simulated fallbacks are ever substituted."
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTestConnection('connectivity')}
                  disabled={testing}
                >
                  <span>Ping Only</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleTestConnection('full')}
                  disabled={testing}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{testing ? 'Testing...' : 'Test Connection & Capability'}</span>
                </Button>
              </div>
            }
          />
          <div className="p-5 space-y-4">
            {/* Read-only server credential & security policy status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3 flex items-center justify-between gap-2">
                <span className="text-[#9CA3AF]">Server GEMINI_API_KEY (Env)</span>
                {settings?.credentialStatus.geminiKeyConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[#10B981] font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Configured</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[#F59E0B] font-mono">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Not Set</span>
                  </span>
                )}
              </div>
              <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3 flex items-center justify-between gap-2">
                <span className="text-[#9CA3AF]">Server OPENAI_COMPAT_API_KEY</span>
                {settings?.credentialStatus.openaiCompatKeyConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[#10B981] font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Configured</span>
                  </span>
                ) : (
                  <span className="text-[#9CA3AF] font-mono">Optional</span>
                )}
              </div>
            </div>

            {/* API Key Input Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Update Gemini API Key
                </label>
                <Input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={settings?.credentialStatus.geminiKeyConfigured ? 'Configured (leave blank to keep)' : 'Enter Gemini API key...'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Update OpenAI-Compatible API Key
                </label>
                <Input
                  type="password"
                  value={openaiCompatApiKey}
                  onChange={(e) => setOpenaiCompatApiKey(e.target.value)}
                  placeholder={settings?.credentialStatus.openaiCompatKeyConfigured ? 'Configured (leave blank to keep)' : 'Optional bearer token...'}
                />
              </div>
            </div>

            {/* Server-enforced policy summary (non-editable by client) */}
            <div className="rounded-md bg-[#090B0E] border border-white/[0.07] p-3.5 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-[#F3F4F6]">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Server-Side Security &amp; Budget Policy (Read-Only)</span>
                </span>
                <span className="font-mono text-[11px] text-[#9CA3AF] tabular-nums">
                  {settings?.dailyLlmCap ?? 50} req/day · {settings?.maxLlmOutputTokens ?? 8192} max tokens
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px] text-[#9CA3AF]">
                <div>
                  Paid Gemini Models:{' '}
                  <span className={settings?.allowPaidRequests ? 'text-[#F59E0B] font-mono' : 'text-[#10B981] font-mono'}>
                    {settings?.allowPaidRequests
                      ? 'Authorized (ALLOW_PAID_LLM_REQUESTS=true)'
                      : 'Blocked ($0 Gemini Free-Tier Enforced)'}
                  </span>
                </div>
                <div>
                  Operator Auth:{' '}
                  <span className="font-mono text-[#D1D5DB]">
                    {settings?.authRequired ? 'Required (COMMAND_CENTER_TOKEN)' : 'Local Origin Policy Active'}
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-[#9CA3AF] font-mono break-all">
                Allowlisted OpenAI Hosts: {(settings?.allowedOpenAICompatHosts || ['localhost', '127.0.0.1']).join(', ')}
              </div>
            </div>

            {settings?.authRequired && (
              <div>
                <label className="block text-xs font-medium text-[#D1D5DB] mb-1.5">
                  Operator Session Token (Required by Server COMMAND_CENTER_TOKEN)
                </label>
                <Input
                  type="password"
                  value={operatorToken}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOperatorToken(val);
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.setItem('cosmiclabs_op_token', val);
                    }
                  }}
                  placeholder="Enter operator token for this browser session..."
                />
              </div>
            )}

            {testResult && (
              <div
                className={`rounded-md px-3.5 py-2.5 text-xs border space-y-1.5 ${
                  testResult.ok
                    ? 'bg-[#10B981]/10 border-[#10B981]/30 text-[#6EE7B7]'
                    : 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#FCA5A5]'
                }`}
              >
                <div className="font-medium">{testResult.message}</div>
                {testResult.report && (
                  <div className="text-[11px] font-mono opacity-90 space-y-0.5">
                    <div>
                      Connectivity: {testResult.report.connectivity.ok ? 'PASS' : 'FAIL'} ({testResult.report.connectivity.latencyMs}ms) — {testResult.report.connectivity.detail}
                    </div>
                    <div>
                      Capability: {testResult.report.capability.ok ? 'PASS' : 'FAIL'} — {testResult.report.capability.detail}
                    </div>
                  </div>
                )}
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
                  <option value="openai_compatible">OpenAI-Compatible (Cost Depends on Endpoint)</option>
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
                          {m.label} ({m.tier === 'free' ? 'Free Tier' : 'Paid — Server Env Required'})
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
                  OpenAI-Compatible Base URL (Allowlisted Hosts Only)
                </label>
                <Input
                  value={openaiCompatBaseUrl}
                  onChange={(e) => setOpenaiCompatBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  Cost depends on target endpoint: local Ollama/vLLM/LM Studio runs at $0, whereas commercial external gateways may charge per token. Non-loopback hosts must be allowlisted via server ALLOWED_OPENAI_COMPAT_HOSTS, and server OPENAI_COMPAT_API_KEY is never sent to unsaved override URLs.
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
          <div className="text-xs">
            {saveMsg && <span className="text-[#10B981]">{saveMsg}</span>}
            {saveError && <span className="text-[#FCA5A5]">{saveError}</span>}
          </div>
          <Button type="submit" variant="primary" disabled={saving}>
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </Button>
        </div>
      </form>
    </div>
  );
};
