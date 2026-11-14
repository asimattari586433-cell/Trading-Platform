import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Cpu,
  Download,
  FolderSearch,
  HardDrive,
  KeyRound,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  Upload,
  X,
} from 'lucide-react';
import type {
  GlobalCopierSettings,
  Mt5FollowerRuntime,
  Mt5ManagerSnapshot,
  TradingAccount,
} from '../types/trading.ts';

interface MultiMT5ManagerPanelProps {
  accounts: TradingAccount[];
  settings: GlobalCopierSettings;
  managerSnapshot: Mt5ManagerSnapshot | null;
  onRefresh: () => Promise<Mt5ManagerSnapshot | null>;
  onUpdateGlobalSettings: (patch: Partial<GlobalCopierSettings>) => Promise<void>;
  onOpenWizard: () => void;
}

export const MultiMT5ManagerPanel: React.FC<MultiMT5ManagerPanelProps> = ({
  accounts,
  settings,
  managerSnapshot,
  onRefresh,
  onUpdateGlobalSettings,
  onOpenWizard,
}) => {
  const [sourcePath, setSourcePath] = useState(
    settings.mt5SourcePath || 'C:\\Program Files\\MetaTrader 5'
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [vaultModalAccount, setVaultModalAccount] = useState<Mt5FollowerRuntime | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const postAction = async <T,>(key: string, url: string, body?: unknown): Promise<T | null> => {
    setBusyAction(key);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = (await res.json()) as T & { error?: string; message?: string };
      if (!res.ok) {
        setNotice({ ok: false, text: data.error || 'Operation failed' });
        return null;
      }
      if (data.message) {
        setNotice({ ok: true, text: data.message });
      }
      await onRefresh();
      return data;
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Request failed' });
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveVaultPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultModalAccount) return;
    const res = await postAction<{ account?: TradingAccount }>(
      `vault-${vaultModalAccount.accountId}`,
      `/api/accounts/${encodeURIComponent(vaultModalAccount.accountId)}/credential`,
      { password: vaultPassword }
    );
    if (res) {
      setNotice({
        ok: true,
        text: `Encrypted password for ${vaultModalAccount.login} saved into local credential vault.`,
      });
      setVaultModalAccount(null);
      setVaultPassword('');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await postAction<{ importedCount?: number }>(
        'import-config',
        '/api/config/import',
        parsed
      );
      if (res) {
        setNotice({
          ok: true,
          text: `Imported ${res.importedCount ?? 0} account profiles & 1:1 rules. Enter MT5 passwords into the Vault column before starting MT5 instances.`,
        });
      }
    } catch {
      setNotice({ ok: false, text: 'Invalid migration JSON file.' });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const health = managerSnapshot?.health;
  const followers = managerSnapshot?.followers || [];
  const accountLookup = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-5">
      {/* Architecture Clarity Banner */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Automatic Multi-MT5 Follower Manager (1 Master + Isolated Portable Followers)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Standard retail Exness MT5 accounts require local terminal processes for simultaneous execution—TradeSync does NOT claim terminal-free MT5 where unavailable. Instead, it automatically provisions isolated portable MT5 terminals, compiles <span className="font-mono">TradeSync_Follower.mq5</span>, encrypts passwords with Windows DPAPI, and runs/restarts minimized terminals in safe batches.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenWizard}
          className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer whitespace-nowrap"
        >
          Open Setup Wizard
        </button>
      </div>

      {/* System Health & Capacity Guard KPIs */}
      {health && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>CPU Load ({health.cpuCores} cores)</span>
              <Cpu className="w-3.5 h-3.5 text-blue-500" />
            </div>
            <div className="text-xl font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-1">
              {health.cpuUsagePct.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Host: {health.isWindows ? 'Windows Local' : `${health.platform} Preview`}
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Host RAM Utilization</span>
              <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-xl font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-1">
              {(health.totalRamMb > 0 ? (health.usedRamMb / health.totalRamMb) * 100 : 0).toFixed(1)}%
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              {Math.round((health.freeRamMb / 1024) * 10) / 10} GB free / {Math.round(health.totalRamMb / 1024)} GB total
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Safe Follower Capacity</span>
              <Layers className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="text-xl font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-1">
              {health.activeRunningProcesses} / {health.recommendedMaxFollowers}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              ~{health.estimatedMbPerMt5} MB RAM per MT5 terminal
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Credential Vault</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-sm font-mono font-bold text-slate-900 dark:text-white mt-1.5">
              {health.vaultMethod === 'windows_dpapi' ? 'Windows DPAPI' : 'RAM Session Vault'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Zero plaintext INI or export leaks
            </div>
          </div>
        </div>
      )}

      {health?.resourceWarning && (
        <div className="flex items-start gap-2.5 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{health.resourceWarning}</span>
        </div>
      )}

      {notice && (
        <div
          className={`p-3.5 rounded-lg border text-xs ${
            notice.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* One-Click Farm Controls & MT5 Source Folder */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Source MetaTrader 5 Installation Folder (Windows)
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                onBlur={() => onUpdateGlobalSettings({ mt5SourcePath: sourcePath })}
                className="flex-1 min-w-[220px] px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
              />
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => postAction('detect', '/api/mt5-manager/detect')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-md cursor-pointer"
              >
                <FolderSearch className="w-3.5 h-3.5" />
                Detect MT5
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  postAction('master-ea', '/api/mt5-manager/install-master-ea', {
                    sourceDir: sourcePath,
                  })
                }
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-md cursor-pointer"
              >
                Install Master EA
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                postAction('provision-all', '/api/mt5-manager/provision-all', {
                  sourceDir: sourcePath,
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded-md cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              Provision All &amp; Verify EAs
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => postAction('start-all', '/api/mt5-manager/followers/start-all')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Start All Followers
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => postAction('restart-all', '/api/mt5-manager/followers/restart-all')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 rounded-md cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restart All
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => postAction('stop-all', '/api/mt5-manager/followers/stop-all')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 rounded-md cursor-pointer"
            >
              <Square className="w-3.5 h-3.5" />
              Stop All
            </button>
            <button
              type="button"
              onClick={() => onRefresh()}
              title="Refresh Telemetry"
              className="p-2 border border-slate-200 dark:border-slate-800 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Batch Concurrency:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.maxConcurrentStarts}
              onChange={(e) =>
                onUpdateGlobalSettings({
                  maxConcurrentStarts: Math.max(1, Number(e.target.value) || 3),
                })
              }
              className="w-16 px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
            />
            <span className="text-slate-400">terminals / batch</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Batch Delay:</span>
            <input
              type="number"
              min={500}
              step={200}
              value={settings.startupDelayMs}
              onChange={(e) =>
                onUpdateGlobalSettings({
                  startupDelayMs: Math.max(500, Number(e.target.value) || 1800),
                })
              }
              className="w-20 px-2 py-1 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
            />
            <span className="text-slate-400">ms</span>
          </div>
        </div>
      </div>

      {/* Managed Follower Processes Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Auto-Managed Follower Terminals ({followers.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each MT5 follower uses an isolated portable profile (<span className="font-mono">data/mt5-instances/</span>) with automatic crash restart &amp; duplicate protection.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-[#0E141F] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Follower / Server</th>
                <th className="py-2.5 px-4">Tier · Map</th>
                <th className="py-2.5 px-4">Provisioning &amp; EA</th>
                <th className="py-2.5 px-4">Vault Credential</th>
                <th className="py-2.5 px-4">Process State</th>
                <th className="py-2.5 px-4 text-right">Balance / Equity</th>
                <th className="py-2.5 px-4 text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {followers.map((rt) => {
                const acc = accountLookup.get(rt.accountId);
                return (
                  <tr key={rt.accountId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{rt.label}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {rt.login} · {rt.server}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">
                      <div className={rt.accountTier === 'cent' ? 'text-amber-500 font-semibold' : 'text-slate-700 dark:text-slate-300'}>
                        {rt.accountTier === 'cent' ? 'CENT (USC)' : 'STANDARD (USD)'}
                      </div>
                      <div className="text-slate-500">
                        {acc?.riskRule.lotMultiplier || 1}x · suffix &quot;{acc?.riskRule.symbolSuffix || (rt.accountTier === 'cent' ? 'c' : '')}&quot;
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-[11px]">
                      <div className={rt.provisioned ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'}>
                        {rt.provisioned ? 'Profile + Preset Ready' : 'Needs Provisioning'}
                      </div>
                      <div className="text-slate-500 font-mono">
                        {rt.eaCompiled ? '.ex5 Compiled' : 'Pending Win Compile'}
                      </div>
                      <div
                        className={
                          rt.eaAttachedVerified
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-amber-500'
                        }
                      >
                        {rt.eaAttachedVerified ? 'EA Heartbeat Verified' : 'Awaiting EA Heartbeat'}
                      </div>
                      {rt.compileError && (
                        <div className="text-[10px] text-rose-500 truncate max-w-[210px]" title={rt.compileError}>
                          {rt.compileError}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-[11px]">
                      {rt.hasVaultCredential ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          Encrypted in Vault
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setVaultModalAccount(rt);
                            setVaultPassword('');
                          }}
                          className="inline-flex items-center gap-1 text-rose-500 hover:underline font-medium cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          Enter Password
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2 font-mono text-[11px] capitalize">
                        <span
                          className={
                            rt.processState === 'running'
                              ? 'text-emerald-500 font-semibold'
                              : rt.processState === 'crashed' || rt.processState === 'error'
                                ? 'text-rose-500 font-semibold'
                                : rt.processState === 'starting' || rt.processState === 'queued' || rt.processState === 'restarting'
                                  ? 'text-amber-500'
                                  : 'text-slate-500'
                          }
                        >
                          {rt.processState}
                        </span>
                        {rt.pid && <span className="text-slate-400">PID {rt.pid}</span>}
                        {(rt.crashCount > 0 || rt.restartCount > 0) && (
                          <span className="text-amber-500">
                            ({rt.restartCount || rt.crashCount} restarts)
                          </span>
                        )}
                      </div>
                      {rt.lastMessage && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[220px]" title={rt.lastMessage}>
                          {rt.lastMessage}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      <div className="text-slate-900 dark:text-white">
                        {acc ? `${acc.balance.toLocaleString()} ${acc.currency}` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Eq {acc ? acc.equity.toLocaleString() : '—'} · {acc?.openTradesCount ?? 0} pos
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            postAction(
                              `prov-${rt.accountId}`,
                              `/api/mt5-manager/followers/${encodeURIComponent(rt.accountId)}/provision`,
                              { sourceDir: sourcePath }
                            )
                          }
                          title="Provision & Verify EA"
                          className="p-1.5 border border-slate-200 dark:border-slate-800 rounded text-slate-500 hover:text-blue-500 cursor-pointer"
                        >
                          <Layers className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            postAction(
                              `start-${rt.accountId}`,
                              `/api/mt5-manager/followers/${encodeURIComponent(rt.accountId)}/start`
                            )
                          }
                          title="Start Follower MT5"
                          className="p-1.5 border border-slate-200 dark:border-slate-800 rounded text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            postAction(
                              `restart-${rt.accountId}`,
                              `/api/mt5-manager/followers/${encodeURIComponent(rt.accountId)}/restart`
                            )
                          }
                          title="Restart Follower MT5"
                          className="p-1.5 border border-slate-200 dark:border-slate-800 rounded text-amber-500 hover:bg-amber-500/10 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            postAction(
                              `stop-${rt.accountId}`,
                              `/api/mt5-manager/followers/${encodeURIComponent(rt.accountId)}/stop`
                            )
                          }
                          title="Stop Follower MT5"
                          className="p-1.5 border border-slate-200 dark:border-slate-800 rounded text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                        >
                          <Square className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {followers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    No Real MT5 bridge followers added yet. Use the Setup Wizard or Connect Account with Real MT5 Bridge.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Moving to Another Windows PC Card */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Move Configuration to Another Windows PC (Zero Plaintext Credentials)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Export account IDs, servers, Standard/Cent tiers, symbol mappings, and 1:1 risk rules cleanly. Passwords, DPAPI blobs, and Bridge Tokens are excluded—re-enter passwords on the destination PC with Real-Money execution locked by default.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/config/export"
            download="tradesync-pc-migration.json"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-md"
          >
            <Download className="w-3.5 h-3.5" />
            Export PC Config (.json)
          </a>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Config Bundle
          </button>
        </div>
      </div>

      {/* Vault Password Entry Modal */}
      {vaultModalAccount && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveVaultPassword}
            className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Store MT5 Password in DPAPI Vault · {vaultModalAccount.login}
              </h3>
              <button
                type="button"
                onClick={() => setVaultModalAccount(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Imported accounts require re-entering the MT5 Trader Password on this Windows machine so it can be encrypted locally with Windows DPAPI.
            </p>
            <input
              type="password"
              required
              autoFocus
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              placeholder="MT5 Trader Password"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVaultModalAccount(null)}
                className="px-3 py-1.5 text-xs text-slate-500 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
              >
                Save to Vault
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
