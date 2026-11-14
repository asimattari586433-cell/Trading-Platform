import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Moon, PauseCircle, PlayCircle, Sun, Unlock } from 'lucide-react';
import type { Lang } from './i18n.ts';
import { COPY_TEXT } from './i18n.ts';
import type {
  AccountMode,
  AccountTier,
  AuthStatus,
  Candle,
  ConnectionMethod,
  CopierRiskRule,
  CopierSnapshot,
  GlobalCopierSettings,
  IndicatorConfig,
  Mt5ManagerSnapshot,
  ServerWsMessage,
  Timeframe,
  TradeSide,
} from './types/trading.ts';
import { AccountsManager } from './components/AccountsManager.tsx';
import type { Mt5LaunchResult } from './components/AccountsManager.tsx';
import { AuthGateModal } from './components/AuthGateModal.tsx';
import { CandlestickChart } from './components/CandlestickChart.tsx';
import { ConnectAccountModal } from './components/ConnectAccountModal.tsx';
import { CopierRulesPanel } from './components/CopierRulesPanel.tsx';
import { MarketWatch } from './components/MarketWatch.tsx';
import { MT5BridgePanel } from './components/MT5BridgePanel.tsx';
import { MultiMT5ManagerPanel } from './components/MultiMT5ManagerPanel.tsx';
import { OrderTicket } from './components/OrderTicket.tsx';
import { PositionsToolbox } from './components/PositionsToolbox.tsx';
import { SetupWizardModal } from './components/SetupWizardModal.tsx';
import { TopBar } from './components/TopBar.tsx';
import type { NavTab } from './components/TopBar.tsx';
import { DEFAULT_ASIM_INDICATOR_CONFIG } from './utils/asimIndicator.ts';

const INDICATOR_STORAGE_KEY = 'tradesync_asim_indicator_v1';

function loadIndicatorConfig(): IndicatorConfig {
  try {
    const raw = localStorage.getItem(INDICATOR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ASIM_INDICATOR_CONFIG };
    const parsed = JSON.parse(raw) as Partial<IndicatorConfig>;
    return { ...DEFAULT_ASIM_INDICATOR_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_ASIM_INDICATOR_CONFIG };
  }
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CopierSnapshot | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [activeTab, setActiveTab] = useState<NavTab>('terminal');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('EURUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('M15');
  const [selectedMasterId, setSelectedMasterId] = useState<string>('');
  const [selectedRuleAccountId, setSelectedRuleAccountId] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [wizardAutoPrompted, setWizardAutoPrompted] = useState(false);
  const [managerSnapshot, setManagerSnapshot] = useState<Mt5ManagerSnapshot | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [isDark, setIsDark] = useState<boolean>(true);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastLaunchNotice, setLastLaunchNotice] = useState<{
    accountId: string;
    login: string;
    result: Mt5LaunchResult;
  } | null>(null);
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(() =>
    loadIndicatorConfig()
  );

  useEffect(() => {
    try {
      localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(indicatorConfig));
    } catch {
      // ignore storage quota failures
    }
  }, [indicatorConfig]);

  const wsRef = useRef<WebSocket | null>(null);
  const t = COPY_TEXT[lang];

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const readJsonSafely = async <T,>(res: Response): Promise<T | null> => {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    const text = await res.text();
    if (!text || text.trimStart().startsWith('<')) {
      return null;
    }
    return JSON.parse(text) as T;
  };

  const checkAuthStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await readJsonSafely<AuthStatus>(res);
      if (data) setAuthStatus(data);
    } catch {
      // retry cleanly on transient boot
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const handleUnauthorized = useCallback(() => {
    setSnapshot(null);
    setWsConnected(false);
    wsRef.current?.close();
    void checkAuthStatus();
  }, [checkAuthStatus]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      handleUnauthorized();
    }
  };

  const isAuthenticated = Boolean(authStatus?.authenticated);

  const fetchCandles = useCallback(
    async (sym: string, tf: Timeframe) => {
      if (!isAuthenticated) return;
      try {
        const res = await fetch(
          `/api/candles?symbol=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(tf)}`,
          { headers: { Accept: 'application/json' } }
        );
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!res.ok) return;
        const data = await readJsonSafely<{ candles: Candle[] }>(res);
        if (data && Array.isArray(data.candles)) {
          setCandles(data.candles);
        }
      } catch {
        // Transient network error while server is restarting
      }
    },
    [isAuthenticated, handleUnauthorized]
  );

  const refreshManager = useCallback(async (): Promise<Mt5ManagerSnapshot | null> => {
    if (!isAuthenticated) return null;
    try {
      const res = await fetch('/api/mt5-manager/status', { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        handleUnauthorized();
        return null;
      }
      if (!res.ok) return null;
      const data = await readJsonSafely<Mt5ManagerSnapshot>(res);
      if (data) setManagerSnapshot(data);
      return data;
    } catch {
      return null;
    }
  }, [isAuthenticated, handleUnauthorized]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshManager();
  }, [isAuthenticated, refreshManager]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab !== 'manager' && !showSetupWizard) return;
    refreshManager();
    const id = setInterval(refreshManager, 4000);
    return () => clearInterval(id);
  }, [isAuthenticated, activeTab, showSetupWizard, refreshManager]);

  useEffect(() => {
    if (snapshot && !snapshot.settings.setupCompleted && !wizardAutoPrompted) {
      setShowSetupWizard(true);
      setWizardAutoPrompted(true);
    }
  }, [snapshot, wizardAutoPrompted]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchCandles(selectedSymbol, timeframe);
    const id = setInterval(() => fetchCandles(selectedSymbol, timeframe), 5000);
    return () => clearInterval(id);
  }, [isAuthenticated, fetchCandles, selectedSymbol, timeframe]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    let reconnectTimer: number | undefined;
    let retryStateTimer: number | undefined;

    const loadInitial = async () => {
      try {
        const res = await fetch('/api/state', { headers: { Accept: 'application/json' } });
        if (res.status === 401) {
          if (active) handleUnauthorized();
          return;
        }
        const data = res.ok ? await readJsonSafely<CopierSnapshot>(res) : null;
        if (data && active) {
          setSnapshot(data);
          const firstMaster = data.accounts.find((a) => a.role === 'master');
          if (firstMaster) setSelectedMasterId((prev) => prev || firstMaster.id);
          return;
        }
      } catch {
        // Retry cleanly if backend is still warming up
      }
      if (active) {
        retryStateTimer = window.setTimeout(loadInitial, 1200);
      }
    };

    const connectWs = async () => {
      if (!active) return;
      try {
        const ticketRes = await fetch('/api/auth/ws-ticket', {
          headers: { Accept: 'application/json' },
        });
        if (ticketRes.status === 401) {
          if (active) handleUnauthorized();
          return;
        }
        const ticketData = ticketRes.ok
          ? await readJsonSafely<{ wsTicket?: string }>(ticketRes)
          : null;
        if (!active) return;

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const qs = ticketData?.wsTicket
          ? `?wsTicket=${encodeURIComponent(ticketData.wsTicket)}`
          : '';
        const ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (active) setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as ServerWsMessage;
            if (msg.type === 'snapshot' || msg.type === 'state_changed') {
              setSnapshot(msg.payload);
              const firstMaster = msg.payload.accounts.find((a) => a.role === 'master');
              if (firstMaster) setSelectedMasterId((prev) => prev || firstMaster.id);
            } else if (msg.type === 'tick') {
              setSnapshot((prev) => {
                if (!prev) return prev;
                const posMap = new Map(msg.payload.positionUpdates.map((u) => [u.id, u]));
                const accMap = new Map(msg.payload.accountUpdates.map((u) => [u.id, u]));
                return {
                  ...prev,
                  quotes: msg.payload.quotes,
                  positions: prev.positions.map((p) => {
                    const u = posMap.get(p.id);
                    return u ? { ...p, currentPrice: u.currentPrice, profit: u.profit } : p;
                  }),
                  accounts: prev.accounts.map((a) => {
                    const u = accMap.get(a.id);
                    return u
                      ? {
                          ...a,
                          equity: u.equity,
                          floatingPnl: u.floatingPnl,
                          margin: u.margin,
                          freeMargin: u.freeMargin,
                        }
                      : a;
                  }),
                };
              });
            }
          } catch {
            // ignore malformed tick
          }
        };

        ws.onclose = () => {
          if (!active) return;
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 1800);
        };
      } catch {
        if (active) {
          reconnectTimer = window.setTimeout(connectWs, 1800);
        }
      }
    };

    loadInitial();
    void connectWs();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (retryStateTimer) clearTimeout(retryStateTimer);
      wsRef.current?.close();
    };
  }, [isAuthenticated, handleUnauthorized]);

  const apiPost = async <T = Record<string, unknown>>(url: string, body: unknown): Promise<T> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Session expired. Please sign in.');
    }
    const data = await readJsonSafely<T & { error?: string }>(res);
    if (!data) {
      throw new Error(`Unexpected response from server (HTTP ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  };

  const handleExecuteOrder = async (payload: {
    masterAccountId: string;
    symbol: string;
    side: TradeSide;
    lots: number;
    sl: number | null;
    tp: number | null;
  }) => {
    return apiPost<{ pendingMasterConfirm?: boolean }>('/api/trades/open', payload);
  };

  const handleClosePosition = async (positionId: string, closeLots?: number) => {
    await apiPost('/api/trades/close', { positionId, closeLots });
  };

  const handleModifyPosition = async (positionId: string, sl: number | null, tp: number | null) => {
    await apiPost('/api/trades/modify', { positionId, sl, tp });
  };

  const handleCloseAll = async () => {
    await apiPost('/api/trades/close-all', {});
  };

  const handleConnectAccount = async (payload: {
    label: string;
    login: string;
    password: string;
    server: string;
    role: 'master' | 'follower';
    mode: AccountMode;
    accountTier?: AccountTier;
    connectionMethod: ConnectionMethod;
    masterId: string | null;
    initialBalance: number;
    mt5TerminalPath?: string;
    autoLaunchMt5?: boolean;
    riskRule: Partial<CopierRiskRule>;
  }) => {
    const data = await apiPost<{
      account: { id: string; login: string };
      launch?: Mt5LaunchResult;
    }>('/api/accounts', payload);
    refreshManager();
    if (data.launch && data.account) {
      setLastLaunchNotice({
        accountId: data.account.id,
        login: data.account.login,
        result: data.launch,
      });
      setActiveTab('accounts');
    }
  };

  const handleLaunchMt5 = async (
    accountId: string,
    opts?: { password?: string; terminalPath?: string }
  ): Promise<Mt5LaunchResult> => {
    return apiPost<Mt5LaunchResult>(
      `/api/accounts/${encodeURIComponent(accountId)}/launch-mt5`,
      opts || {}
    );
  };

  const handleToggleCopy = async (accountId: string, enabled: boolean) => {
    const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyEnabled: enabled }),
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!res.ok) throw new Error('Failed to toggle account');
  };

  const handleUpdateAccountRule = async (
    accountId: string,
    patch: { masterId?: string | null; riskRule: Partial<CopierRiskRule> }
  ) => {
    const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!res.ok) throw new Error('Failed to update rule');
  };

  const handleBulkToggle = async (copyEnabled: boolean) => {
    await apiPost('/api/accounts/bulk-toggle', { copyEnabled });
  };

  const handleRemoveAccount = async (accountId: string) => {
    const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    if (res.status === 401) handleUnauthorized();
  };

  const handleBulkProvision = async (payload: {
    count?: number;
    mode?: AccountMode;
    accountTier?: AccountTier;
    connectionMethod?: ConnectionMethod;
    csvLines?: string;
    lotMultiplier?: number;
  }) => {
    await apiPost('/api/accounts/bulk', payload);
    refreshManager();
  };

  const handleUpdateGlobalSettings = async (patch: Partial<GlobalCopierSettings>) => {
    await apiPost('/api/copier/settings', patch);
  };

  const handleCompleteSetup = async () => {
    await apiPost('/api/setup/complete', {});
  };

  const handleTriggerBridgeTest = async () => {
    await apiPost('/api/bridge/test', { symbol: selectedSymbol, side: 'BUY', lots: 0.1 });
  };

  const selectedQuote = useMemo(
    () => snapshot?.quotes.find((q) => q.symbol === selectedSymbol),
    [snapshot?.quotes, selectedSymbol]
  );

  const selectedOverlay = useMemo(
    () => snapshot?.indicatorOverlays?.[`${selectedSymbol}:${timeframe}`],
    [snapshot?.indicatorOverlays, selectedSymbol, timeframe]
  );

  const masters = useMemo(
    () => (snapshot?.accounts || []).filter((a) => a.role === 'master'),
    [snapshot?.accounts]
  );

  const followers = useMemo(
    () => (snapshot?.accounts || []).filter((a) => a.role === 'follower'),
    [snapshot?.accounts]
  );

  const activeFollowersCount = useMemo(
    () => followers.filter((f) => f.copyEnabled && f.status !== 'disconnected').length,
    [followers]
  );

  const netFloatingPnl = useMemo(
    () => (snapshot?.accounts || []).reduce((sum, a) => sum + a.floatingPnl, 0),
    [snapshot?.accounts]
  );

  const totalEquity = useMemo(
    () => (snapshot?.accounts || []).reduce((sum, a) => sum + a.equity, 0),
    [snapshot?.accounts]
  );

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Checking TradeSync MT5 session...
        </div>
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <AuthGateModal
        authStatus={authStatus}
        onAuthenticated={(next) => setAuthStatus(next)}
      />
    );
  }

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          Connecting to TradeSync MT5 engine...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenConnectModal={() => setShowConnectModal(true)}
        onOpenSetupWizard={() => setShowSetupWizard(true)}
        onLogout={handleLogout}
        username={authStatus.username}
        lang={lang}
      />

      {/* Workspace Summary & Control Toolbar */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-[#0E141F] px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Masters: </span>
            <span className="font-mono font-semibold tabular-nums">{masters.length}</span>
          </div>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Followers: </span>
            <span className="font-mono font-semibold tabular-nums">
              {activeFollowersCount}/{followers.length}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Combined Equity: </span>
            <span className="font-mono font-semibold tabular-nums">
              ${totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Net Floating: </span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                netFloatingPnl >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {netFloatingPnl >= 0 ? '+' : ''}${netFloatingPnl.toFixed(2)}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wsConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span>{wsConnected ? 'Live Stream' : 'Reconnecting'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              handleUpdateGlobalSettings({ realTradingArmed: !snapshot.settings.realTradingArmed })
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              snapshot.settings.realTradingArmed
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-[#111827] text-slate-600 dark:text-slate-300'
            }`}
          >
            {snapshot.settings.realTradingArmed ? (
              <Unlock className="w-3.5 h-3.5" />
            ) : (
              <Lock className="w-3.5 h-3.5" />
            )}
            {snapshot.settings.realTradingArmed ? 'Real-Money Armed' : 'Real-Money Locked'}
          </button>

          <button
            type="button"
            onClick={() =>
              handleUpdateGlobalSettings({ copierActive: !snapshot.settings.copierActive })
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              snapshot.settings.copierActive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
            }`}
          >
            {snapshot.settings.copierActive ? (
              <PlayCircle className="w-3.5 h-3.5" />
            ) : (
              <PauseCircle className="w-3.5 h-3.5" />
            )}
            {snapshot.settings.copierActive ? t.copierActive : t.copierPaused}
          </button>

          <div className="flex items-center bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2 py-1 text-[11px] font-medium rounded cursor-pointer ${
                lang === 'en'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang('ur')}
              className={`px-2 py-1 text-[11px] font-medium rounded cursor-pointer ${
                lang === 'ur'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              اردو
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            aria-label="Toggle light or dark theme"
            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <main className="flex-1 p-4 lg:p-5 max-w-[1600px] w-full mx-auto space-y-4">
        {activeTab === 'terminal' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch min-h-[430px]">
              <div className="lg:col-span-3">
                <MarketWatch
                  quotes={snapshot.quotes}
                  selectedSymbol={selectedSymbol}
                  onSelectSymbol={setSelectedSymbol}
                  title={t.marketWatch}
                />
              </div>
              <div className="lg:col-span-6">
                <CandlestickChart
                  symbol={selectedSymbol}
                  quote={selectedQuote}
                  timeframe={timeframe}
                  onTimeframeChange={setTimeframe}
                  candles={candles}
                  positions={snapshot.positions}
                  indicatorOverlay={selectedOverlay}
                  indicatorConfig={indicatorConfig}
                  onUpdateIndicatorConfig={(patch) =>
                    setIndicatorConfig((prev) => ({ ...prev, ...patch }))
                  }
                  onResetIndicatorConfig={() =>
                    setIndicatorConfig({ ...DEFAULT_ASIM_INDICATOR_CONFIG })
                  }
                />
              </div>
              <div className="lg:col-span-3">
                <OrderTicket
                  lang={lang}
                  accounts={snapshot.accounts}
                  selectedMasterId={selectedMasterId}
                  onSelectMasterId={setSelectedMasterId}
                  quote={selectedQuote}
                  copierActive={snapshot.settings.copierActive}
                  realTradingArmed={snapshot.settings.realTradingArmed}
                  onToggleRealArmed={(armed) =>
                    handleUpdateGlobalSettings({ realTradingArmed: armed })
                  }
                  onExecuteOrder={handleExecuteOrder}
                />
              </div>
            </div>

            <PositionsToolbox
              lang={lang}
              positions={snapshot.positions}
              logs={snapshot.logs}
              history={snapshot.history}
              onClosePosition={handleClosePosition}
              onModifyPosition={handleModifyPosition}
              onCloseAll={handleCloseAll}
            />
          </>
        )}

        {activeTab === 'accounts' && (
          <AccountsManager
            lang={lang}
            accounts={snapshot.accounts}
            lastLaunchNotice={lastLaunchNotice}
            onDismissLaunchNotice={() => setLastLaunchNotice(null)}
            onOpenConnectModal={() => setShowConnectModal(true)}
            onToggleCopy={handleToggleCopy}
            onBulkToggle={handleBulkToggle}
            onRemoveAccount={handleRemoveAccount}
            onLaunchMt5={handleLaunchMt5}
            onBulkProvision={handleBulkProvision}
            onSelectForRules={(id) => {
              setSelectedRuleAccountId(id);
              setActiveTab('rules');
            }}
          />
        )}

        {activeTab === 'manager' && (
          <MultiMT5ManagerPanel
            accounts={snapshot.accounts}
            settings={snapshot.settings}
            managerSnapshot={managerSnapshot}
            onRefresh={refreshManager}
            onUpdateGlobalSettings={handleUpdateGlobalSettings}
            onOpenWizard={() => setShowSetupWizard(true)}
          />
        )}

        {activeTab === 'rules' && (
          <CopierRulesPanel
            accounts={snapshot.accounts}
            settings={snapshot.settings}
            selectedAccountId={selectedRuleAccountId}
            onSelectAccountId={setSelectedRuleAccountId}
            onUpdateAccountRule={handleUpdateAccountRule}
            onUpdateGlobalSettings={handleUpdateGlobalSettings}
          />
        )}

        {activeTab === 'bridge' && (
          <MT5BridgePanel
            lang={lang}
            bridgeTokenConfigured={snapshot.bridgeTokenConfigured}
            pendingCommandsCount={snapshot.pendingBridgeCommandsCount}
            pendingMasterCommandsCount={snapshot.pendingMasterCommandsCount}
            onTriggerBridgeTest={handleTriggerBridgeTest}
          />
        )}
      </main>

      {showConnectModal && (
        <ConnectAccountModal
          lang={lang}
          masters={masters}
          onClose={() => setShowConnectModal(false)}
          onSubmit={handleConnectAccount}
        />
      )}

      {showSetupWizard && (
        <SetupWizardModal
          accounts={snapshot.accounts}
          settings={snapshot.settings}
          managerSnapshot={managerSnapshot}
          onRefreshManager={refreshManager}
          onConnectAccount={handleConnectAccount}
          onBulkProvision={handleBulkProvision}
          onUpdateGlobalSettings={handleUpdateGlobalSettings}
          onCompleteSetup={handleCompleteSetup}
          onClose={() => setShowSetupWizard(false)}
        />
      )}
    </div>
  );
}
