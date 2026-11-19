import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Award,
  BookOpen,
  Compass,
  FileCheck2,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { OverviewView, type OverviewData } from './components/views/OverviewView';
import { BountyExplorerView } from './components/views/BountyExplorerView';
import { PromptStudioView } from './components/views/PromptStudioView';
import { PromptLibraryView } from './components/views/PromptLibraryView';
import { HermesMonitorView } from './components/views/HermesMonitorView';
import { SubmissionsView } from './components/views/SubmissionsView';
import { RewardsAnalyticsView } from './components/views/RewardsAnalyticsView';
import { SettingsView } from './components/views/SettingsView';
import { Button } from './components/ui/primitives';
import type { AppSettings } from './types/command-center';

type NavId =
  | 'overview'
  | 'explorer'
  | 'enhancer'
  | 'library'
  | 'monitor'
  | 'submissions'
  | 'rewards'
  | 'settings';

const NAV_ITEMS: Array<{
  id: NavId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'explorer', label: 'Bounty Explorer', Icon: Compass },
  { id: 'enhancer', label: 'AI Prompt Enhancer', Icon: Sparkles },
  { id: 'library', label: 'Prompt Library', Icon: BookOpen },
  { id: 'monitor', label: 'Hermes Monitor', Icon: Activity },
  { id: 'submissions', label: 'Submissions', Icon: FileCheck2 },
  { id: 'rewards', label: 'Rewards Analytics', Icon: Award },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [studioSlug, setStudioSlug] = useState<string | null>(null);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ running: boolean; lastSuccessAt: string | null; lastError: string | null } | null>(null);
  const lastSyncRef = useRef<string | null>(null);

  const fetchOverviewAndSettings = async () => {
    try {
      const [ovRes, setRes] = await Promise.all([
        fetch('/api/overview'),
        fetch('/api/settings'),
      ]);
      if (ovRes.ok) {
        setOverviewData(await ovRes.json());
        setOverviewError(null);
      } else {
        setOverviewError('Failed to load overview data.');
      }
      if (setRes.ok) {
        setSettings(await setRes.json());
      }
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : 'Server unreachable');
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    fetchOverviewAndSettings();
    let disposed = false;
    const controller = new AbortController();
    const readSyncStatus = async () => {
      try {
        const res = await fetch('/api/bounties/sync-status', { signal: controller.signal });
        if (!res.ok) return;
        const status = await res.json();
        if (disposed) return;
        setSyncStatus(status);
        setSyncing(status.running);
        if (status.lastSuccessAt && status.lastSuccessAt !== lastSyncRef.current) {
          lastSyncRef.current = status.lastSuccessAt;
          window.dispatchEvent(new Event('makefun:bounties-updated'));
          await fetchOverviewAndSettings();
        }
      } catch { /* Retry on the next status poll. */ }
    };
    void readSyncStatus();
    const timer = window.setInterval(readSyncStatus, 15000);
    window.addEventListener('focus', readSyncStatus);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', readSyncStatus);
    };
  }, []);

  const handleGlobalSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/bounties/sync', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || result.error) {
        setOverviewError(result.error || 'Bounty sync failed.');
      } else {
        window.dispatchEvent(new Event('makefun:bounties-updated'));
        await fetchOverviewAndSettings();
      }
    } finally {
      setSyncing(false);
    }
  };

  const openPromptStudioForBounty = (slug: string) => {
    if (slug) setStudioSlug(slug);
    setActiveTab('enhancer');
    setMobileMenuOpen(false);
  };

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-[#090B0E] text-[#F3F4F6] flex">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex flex-col border-r border-white/[0.08] bg-[#0B0D11] transition-all duration-200 shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className="h-14 px-4 border-b border-white/[0.08] flex items-center justify-between gap-2">
          {!sidebarCollapsed && (
            <span className="font-display font-semibold text-sm tracking-tight text-[#F3F4F6] whitespace-nowrap truncate">
              COSMICLABS
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-md text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-white/[0.05] cursor-pointer"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 p-2.5 space-y-1">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                title={sidebarCollapsed ? label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#14181E] text-[#F3F4F6] border border-white/[0.08]'
                    : 'text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#3B82F6]' : ''}`} />
                {!sidebarCollapsed && <span className="truncate">{label}</span>}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="p-4 border-t border-white/[0.07] text-[11px] text-[#6B7280] space-y-1">
            <div className="text-[#9CA3AF] font-medium">make.fun Command Center</div>
            <div>Account: {settings?.accountHandle || '@0xkeinara'}</div>
            <div>Mode: Read-Only · Local SQLite</div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 bg-[#0B0D11] border-r border-white/[0.08] flex flex-col h-full">
            <div className="h-14 px-4 border-b border-white/[0.08] flex items-center justify-between">
              <span className="font-display font-semibold text-sm text-[#F3F4F6]">COSMICLABS</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-[#9CA3AF] hover:text-[#F3F4F6]"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map(({ id, label, Icon }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setActiveTab(id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium cursor-pointer ${
                      active
                        ? 'bg-[#14181E] text-[#F3F4F6] border border-white/[0.08]'
                        : 'text-[#9CA3AF] hover:text-[#F3F4F6]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#3B82F6]' : ''}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 px-5 border-b border-white/[0.08] bg-[#0B0D11] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-md text-[#9CA3AF] hover:text-[#F3F4F6]"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs whitespace-nowrap truncate">
              <span className="text-[#6B7280]">COSMICLABS</span>
              <span className="text-[#4B5563]">/</span>
              <span className="text-[#F3F4F6] font-medium">{activeNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setActiveTab('enhancer')}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Enhance Prompt</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-6 max-w-[1440px] w-full mx-auto">
          <div role="status" className="mb-4 text-xs text-[#9CA3AF]">
            {syncStatus?.running ? 'Sinkronisasi bounty berjalan…' : `Sync terakhir berhasil: ${syncStatus?.lastSuccessAt ? new Date(syncStatus.lastSuccessAt).toLocaleString() : 'belum tersedia'}`}
            {syncStatus?.lastError && <span className="ml-3 text-[#FCA5A5]">Refresh gagal: {syncStatus.lastError}</span>}
          </div>
          {activeTab === 'overview' && (
            <OverviewView
              data={overviewData}
              loading={overviewLoading}
              syncing={syncing}
              error={overviewError}
              onSyncNow={handleGlobalSync}
              onOpenExplorer={() => setActiveTab('explorer')}
              onOpenPromptStudio={openPromptStudioForBounty}
              onOpenModule={(tab) => setActiveTab(tab as NavId)}
            />
          )}

          {activeTab === 'explorer' && (
            <BountyExplorerView
              onOpenPromptStudio={openPromptStudioForBounty}
              onDataMutated={fetchOverviewAndSettings}
            />
          )}

          {activeTab === 'enhancer' && (
            <PromptStudioView
              initialSlug={studioSlug}
              settings={settings}
              onDataMutated={fetchOverviewAndSettings}
            />
          )}

          {activeTab === 'library' && (
            <PromptLibraryView onOpenPromptStudio={openPromptStudioForBounty} />
          )}

          {activeTab === 'monitor' && <HermesMonitorView />}

          {activeTab === 'submissions' && <SubmissionsView />}

          {activeTab === 'rewards' && <RewardsAnalyticsView />}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              onSettingsSaved={(updated) => {
                setSettings(updated);
                fetchOverviewAndSettings();
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
