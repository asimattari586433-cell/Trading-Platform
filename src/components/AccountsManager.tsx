import React, { useMemo, useState } from 'react';
import { Download, Pause, Play, Plus, Power, Search, Trash2, Upload, X } from 'lucide-react';
import type { Lang } from '../i18n.ts';
import { COPY_TEXT } from '../i18n.ts';
import type { AccountMode, ConnectionMethod, TradingAccount } from '../types/trading.ts';

export interface Mt5LaunchResult {
  launched: boolean;
  needsPassword?: boolean;
  mode: string;
  exePath: string;
  iniPath: string;
  commandLine: string;
  message: string;
}

interface AccountsManagerProps {
  lang: Lang;
  accounts: TradingAccount[];
  lastLaunchNotice: { accountId: string; login: string; result: Mt5LaunchResult } | null;
  onDismissLaunchNotice: () => void;
  onOpenConnectModal: () => void;
  onToggleCopy: (accountId: string, enabled: boolean) => Promise<void>;
  onBulkToggle: (enabled: boolean) => Promise<void>;
  onRemoveAccount: (accountId: string) => Promise<void>;
  onLaunchMt5: (
    accountId: string,
    opts?: { password?: string; terminalPath?: string }
  ) => Promise<Mt5LaunchResult>;
  onBulkProvision: (payload: {
    count?: number;
    mode?: AccountMode;
    connectionMethod?: ConnectionMethod;
    csvLines?: string;
    lotMultiplier?: number;
  }) => Promise<void>;
  onSelectForRules: (accountId: string) => void;
}

type AccountFilter = 'all' | 'master' | 'follower' | 'demo' | 'real';

export const AccountsManager: React.FC<AccountsManagerProps> = ({
  lang,
  accounts,
  lastLaunchNotice,
  onDismissLaunchNotice,
  onOpenConnectModal,
  onToggleCopy,
  onBulkToggle,
  onRemoveAccount,
  onLaunchMt5,
  onBulkProvision,
  onSelectForRules,
}) => {
  const t = COPY_TEXT[lang];
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [search, setSearch] = useState('');
  const [showCsvBox, setShowCsvBox] = useState(false);
  const [csvText, setCsvText] = useState(
    '801001,Pass@123,Exness-MT5Real12,real,1.0,standard\n801002,Pass@456,Exness-MT5TrialCent9,demo,1.0,cent\n801003,Pass@789,XMGlobal-MT5 3,demo,1.0,standard'
  );
  const [csvMethod, setCsvMethod] = useState<ConnectionMethod>('mql5_ea');
  const [busyBatch, setBusyBatch] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<{
    accountId: string;
    login: string;
    result: Mt5LaunchResult;
  } | null>(null);
  const [promptAccount, setPromptAccount] = useState<TradingAccount | null>(null);
  const [launchPassword, setLaunchPassword] = useState('');
  const [launchPath, setLaunchPath] = useState('C:\\Program Files\\MetaTrader 5\\terminal64.exe');

  const activeLaunchNotice = launchNotice || lastLaunchNotice;

  const triggerLaunch = async (
    acc: TradingAccount,
    opts?: { password?: string; terminalPath?: string }
  ) => {
    setLaunchingId(acc.id);
    try {
      const res = await onLaunchMt5(acc.id, opts);
      if (res.needsPassword) {
        setLaunchPath(acc.mt5TerminalPath || 'C:\\Program Files\\MetaTrader 5\\terminal64.exe');
        setLaunchPassword('');
        setPromptAccount(acc);
      } else {
        setPromptAccount(null);
        setLaunchNotice({ accountId: acc.id, login: acc.login, result: res });
      }
    } finally {
      setLaunchingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (filter === 'master' && acc.role !== 'master') return false;
      if (filter === 'follower' && acc.role !== 'follower') return false;
      if (filter === 'demo' && acc.mode !== 'demo') return false;
      if (filter === 'real' && acc.mode !== 'real') return false;
      if (!q) return true;
      return (
        acc.login.toLowerCase().includes(q) ||
        acc.server.toLowerCase().includes(q) ||
        acc.label.toLowerCase().includes(q) ||
        acc.broker.toLowerCase().includes(q)
      );
    });
  }, [accounts, filter, search]);

  const stats = useMemo(() => {
    const masters = accounts.filter((a) => a.role === 'master').length;
    const followers = accounts.filter((a) => a.role === 'follower');
    const activeFollowers = followers.filter((a) => a.copyEnabled).length;
    const totalEquity = accounts.reduce((s, a) => s + a.equity, 0);
    const totalFloating = accounts.reduce((s, a) => s + a.floatingPnl, 0);
    return {
      masters,
      followersCount: followers.length,
      activeFollowers,
      totalEquity,
      totalFloating,
    };
  }, [accounts]);

  const runBatchDemo = async (count: number) => {
    setBusyBatch(true);
    try {
      await onBulkProvision({
        count,
        mode: 'demo',
        connectionMethod: 'sandbox',
        lotMultiplier: 1.0,
      });
    } finally {
      setBusyBatch(false);
    }
  };

  const runCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyBatch(true);
    try {
      await onBulkProvision({
        csvLines: csvText,
        connectionMethod: csvMethod,
      });
      setShowCsvBox(false);
    } finally {
      setBusyBatch(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Master Accounts</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-1">
            {stats.masters}
          </div>
        </div>
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Follower Accounts</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-1">
            {stats.activeFollowers} / {stats.followersCount}
          </div>
        </div>
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Combined Equity</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-1">
            ${stats.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Net Floating P&amp;L</div>
          <div
            className={`text-2xl font-mono tabular-nums font-bold mt-1 ${
              stats.totalFloating >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {stats.totalFloating >= 0 ? '+' : ''}${stats.totalFloating.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Multi-Account Scaling Toolbar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t.bulkAddTitle}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Scale copy execution to 5, 50, or 100+ Follower accounts simultaneously or bulk import Real/Demo MT5 credentials via CSV.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyBatch}
            onClick={() => runBatchDemo(5)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 hover:border-blue-500 rounded-md cursor-pointer whitespace-nowrap"
          >
            +5 Demo Followers
          </button>
          <button
            type="button"
            disabled={busyBatch}
            onClick={() => runBatchDemo(50)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 hover:border-blue-500 rounded-md cursor-pointer whitespace-nowrap"
          >
            +50 Demo Followers
          </button>
          <button
            type="button"
            disabled={busyBatch}
            onClick={() => runBatchDemo(100)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 hover:border-blue-500 rounded-md cursor-pointer whitespace-nowrap"
          >
            +100 Demo Followers
          </button>
          <button
            type="button"
            onClick={() => setShowCsvBox((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded-md cursor-pointer whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Bulk CSV Import
          </button>
        </div>
      </div>

      {showCsvBox && (
        <form
          onSubmit={runCsvImport}
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Format: <span className="font-mono">login,password,server,mode(real/demo),lotMultiplier,tier(standard/cent)</span>
            </div>
            <select
              value={csvMethod}
              onChange={(e) => setCsvMethod(e.target.value as ConnectionMethod)}
              className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
            >
              <option value="mql5_ea">Real MT5 EA Bridge</option>
              <option value="sandbox">Demo Sandbox Engine</option>
            </select>
          </div>
          <textarea
            rows={4}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCsvBox(false)}
              className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyBatch}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
            >
              Import All Accounts
            </button>
          </div>
        </form>
      )}

      {/* MT5 Direct Start Feedback Banner */}
      {activeLaunchNotice && (
        <div
          className={`rounded-lg border p-4 flex flex-wrap items-start justify-between gap-3 text-xs ${
            activeLaunchNotice.result.launched
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
          }`}
        >
          <div className="space-y-1.5 max-w-3xl">
            <div className="font-semibold">
              MT5 Direct Launcher · Login {activeLaunchNotice.login}
            </div>
            <p className="leading-relaxed">{activeLaunchNotice.result.message}</p>
            <div className="font-mono text-[11px] opacity-85 break-all">
              {activeLaunchNotice.result.commandLine}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/accounts/${encodeURIComponent(activeLaunchNotice.accountId)}/mt5-config.ini`}
              download={`mt5_${activeLaunchNotice.login}.ini`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded-md hover:border-blue-500"
            >
              <Download className="w-3.5 h-3.5" />
              Download .ini
            </a>
            <button
              type="button"
              onClick={() => {
                setLaunchNotice(null);
                onDismissLaunchNotice();
              }}
              className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Accounts Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#0B0F17] p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
            {(['all', 'master', 'follower', 'demo', 'real'] as AccountFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs capitalize rounded transition-colors cursor-pointer whitespace-nowrap ${
                  filter === f
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search login, server..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={() => onBulkToggle(true)}
              className="px-2.5 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10 rounded-md cursor-pointer whitespace-nowrap"
            >
              Resume All
            </button>
            <button
              type="button"
              onClick={() => onBulkToggle(false)}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 rounded-md cursor-pointer whitespace-nowrap"
            >
              Pause All
            </button>
            <button
              type="button"
              onClick={onOpenConnectModal}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add MT5 Login
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[520px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 dark:bg-[#0E141F] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Account / Login</th>
                <th className="py-2.5 px-4">Server / Engine</th>
                <th className="py-2.5 px-4">Role · Mode</th>
                <th className="py-2.5 px-4">Sizing Rule</th>
                <th className="py-2.5 px-4 text-right">Balance</th>
                <th className="py-2.5 px-4 text-right">Equity</th>
                <th className="py-2.5 px-4 text-right">Floating</th>
                <th className="py-2.5 px-4 text-right">Open</th>
                <th className="py-2.5 px-4">Copy Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {filtered.map((acc) => {
                const pnlUp = acc.floatingPnl >= 0;
                return (
                  <tr key={acc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{acc.label}</div>
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        Login {acc.login}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-slate-800 dark:text-slate-200">{acc.server}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {acc.connectionMethod === 'sandbox'
                          ? 'Sandbox Engine'
                          : 'Free Local MT5 Bridge'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-medium ${
                          acc.role === 'master'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {acc.role === 'master' ? 'Master' : 'Follower'}
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span
                        className={`font-mono uppercase text-[11px] ${
                          acc.mode === 'real'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {acc.mode}
                      </span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span
                        className={`font-mono uppercase text-[11px] ${
                          acc.accountTier === 'cent'
                            ? 'text-amber-500 font-semibold'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {acc.accountTier === 'cent' ? 'CENT' : 'STD'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {acc.role === 'master' ? (
                        'Signal Source'
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectForRules(acc.id)}
                          className="hover:underline text-left cursor-pointer"
                        >
                          {acc.riskRule.lotMode === 'fixed'
                            ? `Fixed ${acc.riskRule.fixedLot.toFixed(2)}`
                            : `${acc.riskRule.lotMode.replace('_', ' ')} ${acc.riskRule.lotMultiplier}x`}
                          {acc.riskRule.symbolSuffix ? ` (${acc.riskRule.symbolSuffix})` : ''}
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {acc.currency}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-white">
                      {acc.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {acc.currency}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        pnlUp
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {pnlUp ? '+' : ''}{acc.floatingPnl.toFixed(2)} {acc.currency}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {acc.openTradesCount}
                    </td>
                    <td className="py-2.5 px-4">
                      <div>
                        <span
                          className={`text-xs font-medium ${
                            acc.copyEnabled
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {acc.copyEnabled ? 'Active' : 'Paused'}
                        </span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span
                          className={`text-[11px] capitalize ${
                            acc.status === 'connected'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : acc.status === 'disconnected' || acc.status === 'error'
                                ? 'text-rose-500'
                                : 'text-amber-500'
                          }`}
                        >
                          {acc.status}
                        </span>
                      </div>
                      {acc.lastError && (
                        <div className="text-[10px] text-rose-500 truncate max-w-[200px]" title={acc.lastError}>
                          {acc.lastError}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {acc.connectionMethod === 'mql5_ea' && (
                          <button
                            type="button"
                            disabled={launchingId === acc.id}
                            onClick={() => triggerLaunch(acc)}
                            title="Start Windows MT5 terminal directly with Login + Password + Server"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            <Power className="w-3 h-3" />
                            {launchingId === acc.id ? 'Starting...' : 'Start MT5'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleCopy(acc.id, !acc.copyEnabled)}
                          title={acc.copyEnabled ? 'Pause copying' : 'Resume copying'}
                          className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 rounded cursor-pointer"
                        >
                          {acc.copyEnabled ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveAccount(acc.id)}
                          title="Disconnect account"
                          className="p-1.5 text-rose-500 hover:text-rose-400 border border-slate-200 dark:border-slate-800 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    No accounts match your filter. Click Add MT5 Login to connect a Master or Follower account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Password Prompt Modal when starting MT5 after a server restart */}
      {promptAccount && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              triggerLaunch(promptAccount, {
                password: launchPassword,
                terminalPath: launchPath,
              });
            }}
            className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Start MT5 Terminal · Login {promptAccount.login}
              </h3>
              <button
                type="button"
                onClick={() => setPromptAccount(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              For security, MT5 passwords are never saved to disk. Enter your trader password once to generate the local startup config and start MT5 on <span className="font-mono">{promptAccount.server}</span>.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                MT5 Trader Password
              </label>
              <input
                type="password"
                required
                autoFocus
                value={launchPassword}
                onChange={(e) => setLaunchPassword(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Windows <span className="font-mono">terminal64.exe</span> Path
              </label>
              <input
                type="text"
                value={launchPath}
                onChange={(e) => setLaunchPath(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPromptAccount(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={launchingId === promptAccount.id}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
              >
                <Power className="w-3.5 h-3.5" />
                Start MT5
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
