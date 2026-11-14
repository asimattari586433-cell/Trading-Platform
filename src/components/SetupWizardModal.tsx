import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FolderSearch,
  Layers,
  Play,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type {
  AccountMode,
  AccountTier,
  ConnectionMethod,
  CopierRiskRule,
  GlobalCopierSettings,
  Mt5ManagerSnapshot,
  TradingAccount,
} from '../types/trading.ts';

interface SetupWizardModalProps {
  accounts: TradingAccount[];
  settings: GlobalCopierSettings;
  managerSnapshot: Mt5ManagerSnapshot | null;
  onRefreshManager: () => Promise<Mt5ManagerSnapshot | null>;
  onConnectAccount: (payload: {
    label: string;
    login: string;
    password: string;
    server: string;
    role: 'master' | 'follower';
    mode: AccountMode;
    accountTier: AccountTier;
    connectionMethod: ConnectionMethod;
    masterId: string | null;
    initialBalance: number;
    mt5TerminalPath?: string;
    autoLaunchMt5?: boolean;
    riskRule: Partial<CopierRiskRule>;
  }) => Promise<void>;
  onBulkProvision: (payload: {
    count?: number;
    mode?: AccountMode;
    accountTier?: AccountTier;
    connectionMethod?: ConnectionMethod;
    csvLines?: string;
    lotMultiplier?: number;
  }) => Promise<void>;
  onUpdateGlobalSettings: (patch: Partial<GlobalCopierSettings>) => Promise<void>;
  onCompleteSetup: () => Promise<void>;
  onClose: () => void;
}

const STEPS = [
  '1. Master MT5',
  '2. Followers & CSV',
  '3. 1:1 Rules',
  '4. Provision EAs',
  '5. Start Copier',
];

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  accounts,
  settings,
  managerSnapshot,
  onRefreshManager,
  onConnectAccount,
  onBulkProvision,
  onUpdateGlobalSettings,
  onCompleteSetup,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Master fields
  const [mLogin, setMLogin] = useState('');
  const [mPassword, setMPassword] = useState('');
  const [mServer, setMServer] = useState('Exness-MT5Trial9');
  const [mMode, setMMode] = useState<AccountMode>('demo');
  const [mTier, setMTier] = useState<AccountTier>('standard');
  const [mConn, setMConn] = useState<ConnectionMethod>('mql5_ea');
  const [mt5Path, setMt5Path] = useState(
    settings.mt5SourcePath || 'C:\\Program Files\\MetaTrader 5'
  );

  // Step 2: Single follower or CSV
  const [fLogin, setFLogin] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fServer, setFServer] = useState('Exness-MT5TrialCent9');
  const [fMode, setFMode] = useState<AccountMode>('demo');
  const [fTier, setFTier] = useState<AccountTier>('cent');
  const [fConn, setFConn] = useState<ConnectionMethod>('mql5_ea');
  const [csvText, setCsvText] = useState(
    '# Format: login,password,server,mode,lotMultiplier,tier(standard/cent)\n'
  );

  const masters = useMemo(() => accounts.filter((a) => a.role === 'master'), [accounts]);
  const followers = useMemo(() => accounts.filter((a) => a.role === 'follower'), [accounts]);
  const mt5Followers = useMemo(
    () => followers.filter((f) => f.connectionMethod === 'mql5_ea'),
    [followers]
  );

  const callJson = async <T,>(url: string, body?: unknown): Promise<T> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const handleAddMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await onConnectAccount({
        label: `Master ${mLogin} (${mTier === 'cent' ? 'Cent' : 'Standard'})`,
        login: mLogin,
        password: mPassword,
        server: mServer,
        role: 'master',
        mode: mMode,
        accountTier: mTier,
        connectionMethod: mConn,
        masterId: null,
        initialBalance: 10000,
        mt5TerminalPath: `${mt5Path.replace(/\\+$/, '')}\\terminal64.exe`,
        autoLaunchMt5: false,
        riskRule: {
          lotMode: 'multiplier',
          lotMultiplier: 1.0,
          symbolSuffix: mTier === 'cent' ? 'c' : '',
        },
      });
      setNotice(`Master ${mLogin} saved. Click Install Master EA or proceed to Step 2.`);
      setMLogin('');
      setMPassword('');
      await onRefreshManager();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Master');
    } finally {
      setBusy(false);
    }
  };

  const handleDetectMt5 = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await callJson<{ recommendedSourcePath: string; message: string }>(
        '/api/mt5-manager/detect'
      );
      if (res.recommendedSourcePath) setMt5Path(res.recommendedSourcePath);
      setNotice(res.message);
      await onRefreshManager();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setBusy(false);
    }
  };

  const handleInstallMasterEa = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await callJson<{ message: string }>('/api/mt5-manager/install-master-ea', {
        sourceDir: mt5Path,
      });
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install Master EA failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAddSingleFollower = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await onConnectAccount({
        label: `Follower ${fLogin} (${fTier === 'cent' ? 'Cent 1:1' : 'Std 1:1'})`,
        login: fLogin,
        password: fPassword,
        server: fServer,
        role: 'follower',
        mode: fMode,
        accountTier: fTier,
        connectionMethod: fConn,
        masterId: masters[0]?.id || null,
        initialBalance: 10000,
        autoLaunchMt5: false,
        riskRule: {
          lotMode: 'multiplier',
          lotMultiplier: 1.0,
          symbolSuffix: fTier === 'cent' ? 'c' : '',
          warnOnContractMismatch: true,
        },
      });
      setNotice(`Follower ${fLogin} saved with 1.00x exact lot rule & DPAPI vault encryption.`);
      setFLogin('');
      setFPassword('');
      await onRefreshManager();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add follower');
    } finally {
      setBusy(false);
    }
  };

  const handleImportCsv = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await onBulkProvision({
        csvLines: csvText,
        connectionMethod: 'mql5_ea',
        lotMultiplier: 1.0,
      });
      setNotice('CSV Follower accounts imported cleanly into the DPAPI Vault.');
      await onRefreshManager();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setBusy(false);
    }
  };

  const handleProvisionAll = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await callJson<{ provisionedCount: number; compiledCount: number; total: number }>(
        '/api/mt5-manager/provision-all',
        { sourceDir: mt5Path }
      );
      setNotice(
        `Provisioned ${res.provisionedCount}/${res.total} isolated Follower profiles (${res.compiledCount} compiled on Windows host).`
      );
      await onRefreshManager();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provision failed');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalStart = async () => {
    setError(null);
    setBusy(true);
    try {
      await onUpdateGlobalSettings({ copierActive: true, mt5SourcePath: mt5Path });
      if (mt5Followers.length > 0) {
        const res = await callJson<{ message: string }>('/api/mt5-manager/followers/start-all');
        setNotice(res.message);
      }
      await onCompleteSetup();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Startup error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden my-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              TradeSync MT5 First-Run Setup Wizard
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              100% Free Local Windows Setup · Standard &amp; Cent 1:1 Copier · Multi-MT5 Automation
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper */}
        <div className="grid grid-cols-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E141F]">
          {STEPS.map((label, idx) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(idx)}
              className={`py-2.5 px-2 text-[11px] font-medium text-center border-b-2 transition-colors cursor-pointer ${
                step === idx
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-[#111827]'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto">
          {error && (
            <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
              {error}
            </div>
          )}
          {notice && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2">
              {notice}
            </div>
          )}

          {/* STEP 1 */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md space-y-2">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  MetaTrader 5 Source Installation Folder (Windows)
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={mt5Path}
                    onChange={(e) => setMt5Path(e.target.value)}
                    className="flex-1 min-w-[240px] px-3 py-1.5 text-xs font-mono bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleDetectMt5}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:border-blue-500 cursor-pointer"
                  >
                    <FolderSearch className="w-3.5 h-3.5" />
                    Auto-Detect MT5
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleInstallMasterEa}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded cursor-pointer"
                  >
                    Install Master EA
                  </button>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Connected Masters: <span className="font-mono font-semibold">{masters.length}</span> (
                  {masters.map((m) => `${m.login} [${m.accountTier.toUpperCase()}]`).join(', ') || 'None'})
                </div>
              </div>

              <form
                onSubmit={handleAddMaster}
                className="p-4 border border-slate-200 dark:border-slate-800 rounded-md space-y-3"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Add or Link Your Master MT5 Account
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    value={mLogin}
                    onChange={(e) => setMLogin(e.target.value)}
                    placeholder="Master Login ID"
                    className="px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <input
                    type="password"
                    required
                    value={mPassword}
                    onChange={(e) => setMPassword(e.target.value)}
                    placeholder="MT5 Password"
                    className="px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <input
                    type="text"
                    required
                    value={mServer}
                    onChange={(e) => setMServer(e.target.value)}
                    placeholder="e.g. Exness-MT5Real12"
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <select
                    value={mTier}
                    onChange={(e) => setMTier(e.target.value as AccountTier)}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  >
                    <option value="standard">Standard (USD)</option>
                    <option value="cent">Standard Cent (USC)</option>
                  </select>
                  <select
                    value={mMode}
                    onChange={(e) => setMMode(e.target.value as AccountMode)}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  >
                    <option value="demo">Demo / Trial</option>
                    <option value="real">Real Account</option>
                  </select>
                  <select
                    value={mConn}
                    onChange={(e) => setMConn(e.target.value as ConnectionMethod)}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  >
                    <option value="mql5_ea">Real MT5 EA Bridge</option>
                    <option value="sandbox">Demo Sandbox Engine</option>
                  </select>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded cursor-pointer"
                  >
                    Save Master Account
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 2 */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 p-3 bg-blue-500/10 border border-blue-500/30 rounded-md text-xs text-blue-700 dark:text-blue-300">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  Passwords entered here or via CSV are immediately encrypted into the{' '}
                  <span className="font-semibold">Windows DPAPI Credential Vault</span> ({managerSnapshot?.health.vaultMethod || 'DPAPI'}) and are never saved in plaintext configs, logs, or PC migration exports.
                </div>
              </div>

              <form
                onSubmit={handleAddSingleFollower}
                className="p-4 border border-slate-200 dark:border-slate-800 rounded-md space-y-3"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Add Single Follower (1.00x Exact Lot Default)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    value={fLogin}
                    onChange={(e) => setFLogin(e.target.value)}
                    placeholder="Follower Login ID"
                    className="px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <input
                    type="password"
                    required
                    value={fPassword}
                    onChange={(e) => setFPassword(e.target.value)}
                    placeholder="MT5 Password"
                    className="px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <input
                    type="text"
                    required
                    value={fServer}
                    onChange={(e) => setFServer(e.target.value)}
                    placeholder="Exness-MT5TrialCent9"
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  />
                  <select
                    value={fTier}
                    onChange={(e) => {
                      const next = e.target.value as AccountTier;
                      setFTier(next);
                      if (next === 'cent' && !fServer.toLowerCase().includes('cent')) {
                        setFServer('Exness-MT5TrialCent9');
                      }
                    }}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  >
                    <option value="cent">Standard Cent (XAUUSDc)</option>
                    <option value="standard">Standard (XAUUSD)</option>
                  </select>
                  <select
                    value={fMode}
                    onChange={(e) => setFMode(e.target.value as AccountMode)}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  >
                    <option value="demo">Demo / Trial</option>
                    <option value="real">Real Account</option>
                  </select>
                  <select
                    value={fConn}
                    onChange={(e) => setFConn(e.target.value as ConnectionMethod)}
                    className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                  >
                    <option value="mql5_ea">Auto-Managed MT5</option>
                    <option value="sandbox">Demo Sandbox</option>
                  </select>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded cursor-pointer"
                  >
                    Add Follower
                  </button>
                </div>
              </form>

              <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Bulk CSV Import (5, 20, 50+ Followers)
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    Total Followers: {followers.length} ({mt5Followers.length} Real MT5)
                  </span>
                </div>
                <textarea
                  rows={4}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleImportCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import CSV into Vault
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-md space-y-2 text-xs">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Exact 1:1 Lot Copying Across Standard &amp; Cent Accounts
                </div>
                <ul className="space-y-1 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                  <li>Master XAUUSD BUY 0.01 → Cent Follower XAUUSDc BUY 0.01</li>
                  <li>Master XAUUSD BUY 0.10 → Cent Follower XAUUSDc BUY 0.10</li>
                  <li>Master XAUUSDc SELL 0.05 → Standard Follower XAUUSD SELL 0.05</li>
                </ul>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Lot sizes are never auto-multiplied or auto-divided by 10x or 100x. If broker volume limits reject an order, the exact broker retcode is logged instead of altering your lot size.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md cursor-pointer">
                  <span>Sync Partial Closes Proportionally</span>
                  <input
                    type="checkbox"
                    checked={settings.syncPartialCloses}
                    onChange={(e) =>
                      onUpdateGlobalSettings({ syncPartialCloses: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md cursor-pointer">
                  <span>Auto-Pause on Drawdown Limit</span>
                  <input
                    type="checkbox"
                    checked={settings.autoPauseOnDrawdown}
                    onChange={(e) =>
                      onUpdateGlobalSettings({ autoPauseOnDrawdown: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>
                <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Max Concurrent MT5 Launches (Batch Size)
                  </label>
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
                    className="w-full px-2.5 py-1 text-xs font-mono bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded"
                  />
                </div>
                <div className="p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Delay Between Batches (ms)
                  </label>
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
                    className="w-full px-2.5 py-1 text-xs font-mono bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 3 && (
            <div className="space-y-4">
              {managerSnapshot && (
                <div className="p-3.5 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                      <Cpu className="w-4 h-4 text-blue-500" />
                      PC Capacity Guard
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      RAM {Math.round(managerSnapshot.health.totalRamMb / 1024)} GB · Safe Limit ~{managerSnapshot.health.recommendedMaxFollowers} MT5 Instances
                    </span>
                  </div>
                  {managerSnapshot.health.resourceWarning && (
                    <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400 text-[11px]">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{managerSnapshot.health.resourceWarning}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 p-4 border border-slate-200 dark:border-slate-800 rounded-md">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Provision Isolated Portable MT5 Folders &amp; Compile EAs
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Creates isolated <span className="font-mono">data/mt5-instances/follower_*</span> profiles, installs <span className="font-mono">TradeSync_Follower.mq5</span> with your Bridge Token, and compiles via <span className="font-mono">metaeditor64.exe</span> on Windows.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || mt5Followers.length === 0}
                  onClick={handleProvisionAll}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Provision All ({mt5Followers.length})
                </button>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto text-xs">
                {(managerSnapshot?.followers || []).map((f) => (
                  <div key={f.accountId} className="px-3 py-2 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">{f.login}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-500">{f.server}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <span className={f.provisioned ? 'text-emerald-500' : 'text-amber-500'}>
                        {f.provisioned ? 'Profile OK' : 'Not Provisioned'}
                      </span>
                      <span className={f.hasVaultCredential ? 'text-emerald-500' : 'text-rose-500'}>
                        {f.hasVaultCredential ? 'Vault OK' : 'No Password'}
                      </span>
                    </div>
                  </div>
                ))}
                {mt5Followers.length === 0 && (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No Real MT5 followers queued (Demo Sandbox accounts run directly in Node.js without terminal64.exe).
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5 */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Ready to Launch TradeSync MT5
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Summary: <span className="font-mono font-semibold">{masters.length}</span> Master(s),{' '}
                  <span className="font-mono font-semibold">{followers.length}</span> Follower(s) ({mt5Followers.length} Auto-Managed MT5), Exact 1:1 lot copying enabled, Real-Money execution safety lock stays{' '}
                  <span className="font-semibold">{settings.realTradingArmed ? 'ARMED' : 'LOCKED'}</span>.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Note: Standard retail Exness MT5 Follower accounts run as isolated minimized portable Windows terminals managed automatically by TradeSync. Verify on Demo first before arming Real accounts.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E141F] flex items-center justify-between">
          <button
            type="button"
            onClick={async () => {
              await onCompleteSetup();
              onClose();
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            Skip Wizard for Now
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="px-3.5 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md cursor-pointer"
              >
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
              >
                Next Step
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleFinalStart}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {busy ? 'Starting...' : 'Start TradeSync'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
