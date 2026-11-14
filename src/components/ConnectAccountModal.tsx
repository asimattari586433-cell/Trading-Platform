import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { Lang } from '../i18n.ts';
import { COPY_TEXT } from '../i18n.ts';
import type {
  AccountMode,
  AccountRole,
  AccountTier,
  ConnectionMethod,
  LotSizingMode,
  TradingAccount,
} from '../types/trading.ts';

interface ConnectAccountModalProps {
  lang: Lang;
  masters: TradingAccount[];
  onClose: () => void;
  onSubmit: (payload: {
    label: string;
    login: string;
    password: string;
    server: string;
    role: AccountRole;
    mode: AccountMode;
    accountTier: AccountTier;
    connectionMethod: ConnectionMethod;
    masterId: string | null;
    initialBalance: number;
    mt5TerminalPath?: string;
    autoLaunchMt5?: boolean;
    riskRule: {
      lotMode: LotSizingMode;
      lotMultiplier: number;
      fixedLot: number;
      symbolSuffix: string;
    };
  }) => Promise<void>;
}

const SERVER_PRESETS = [
  'Exness-MT5Real12',
  'Exness-MT5Trial9',
  'Exness-MT5RealCent4',
  'Exness-MT5TrialCent9',
  'ICMarketsSC-MT5',
  'ICMarketsSC-Demo',
  'XMGlobal-MT5 3',
  'Pepperstone-MT5-Live',
  'Deriv-Server',
  'FTMO-Server',
];

export const ConnectAccountModal: React.FC<ConnectAccountModalProps> = ({
  lang,
  masters,
  onClose,
  onSubmit,
}) => {
  const t = COPY_TEXT[lang];
  const [role, setRole] = useState<AccountRole>('follower');
  const [mode, setMode] = useState<AccountMode>('demo');
  const [accountTier, setAccountTier] = useState<AccountTier>('standard');
  const [connectionMethod, setConnectionMethod] = useState<ConnectionMethod>('sandbox');
  const [label, setLabel] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('Exness-MT5Trial9');
  const [masterId, setMasterId] = useState(masters[0]?.id || '');
  const [initialBalance, setInitialBalance] = useState('10000');
  const [lotMode, setLotMode] = useState<LotSizingMode>('multiplier');
  const [lotMultiplier, setLotMultiplier] = useState('1.0');
  const [fixedLot, setFixedLot] = useState('0.10');
  const [symbolSuffix, setSymbolSuffix] = useState('');
  const [mt5TerminalPath, setMt5TerminalPath] = useState('C:\\Program Files\\MetaTrader 5\\terminal64.exe');
  const [autoLaunchMt5, setAutoLaunchMt5] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleModeChange = (nextMode: AccountMode) => {
    setMode(nextMode);
    if (nextMode === 'real' && connectionMethod === 'sandbox') {
      setConnectionMethod('mql5_ea');
    } else if (nextMode === 'demo' && connectionMethod === 'mql5_ea') {
      setConnectionMethod('sandbox');
    }
  };

  const handleTierChange = (nextTier: AccountTier) => {
    setAccountTier(nextTier);
    if (nextTier === 'cent') {
      if (!symbolSuffix) setSymbolSuffix('c');
      if (server === 'Exness-MT5Trial9') setServer('Exness-MT5TrialCent9');
    } else {
      if (symbolSuffix === 'c') setSymbolSuffix('');
      if (server === 'Exness-MT5TrialCent9') setServer('Exness-MT5Trial9');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit({
        label: label.trim() || `${role === 'master' ? 'Master' : 'Follower'} ${login}`,
        login,
        password,
        server,
        role,
        mode,
        accountTier,
        connectionMethod,
        masterId: role === 'follower' ? masterId || null : null,
        initialBalance: Number(initialBalance) || 10000,
        mt5TerminalPath: connectionMethod === 'mql5_ea' ? mt5TerminalPath.trim() : undefined,
        autoLaunchMt5: connectionMethod === 'mql5_ea' ? autoLaunchMt5 : false,
        riskRule: {
          lotMode,
          lotMultiplier: Number(lotMultiplier) || 1.0,
          fixedLot: Number(fixedLot) || 0.1,
          symbolSuffix: symbolSuffix.trim(),
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden my-auto">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t.addAccountTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.accountRole}
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#0B0F17] rounded-md border border-slate-200 dark:border-slate-800">
                {(['master', 'follower'] as AccountRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`py-1.5 text-xs font-medium rounded capitalize cursor-pointer ${
                      role === r
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.accountMode}
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#0B0F17] rounded-md border border-slate-200 dark:border-slate-800">
                {(['demo', 'real'] as AccountMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleModeChange(m)}
                    className={`py-1.5 text-xs font-medium rounded uppercase cursor-pointer ${
                      mode === m
                        ? m === 'real'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Account Tier (1:1)
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-[#0B0F17] rounded-md border border-slate-200 dark:border-slate-800">
                {(['standard', 'cent'] as AccountTier[]).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => handleTierChange(tier)}
                    className={`py-1.5 text-xs font-medium rounded capitalize cursor-pointer ${
                      accountTier === tier
                        ? tier === 'cent'
                          ? 'bg-amber-600 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {tier === 'cent' ? 'Cent' : 'Std'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.loginId}
              </label>
              <input
                type="text"
                required
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="e.g. 50182934"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.password}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="MT5 Trader Password"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                {t.serverName}
              </label>
              <input
                type="text"
                required
                list="mt5-server-presets"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="e.g. Exness-MT5Real12"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
              <datalist id="mt5-server-presets">
                {SERVER_PRESETS.map((srv) => (
                  <option key={srv} value={srv} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Account Label (Optional)
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Client Account 1"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              {t.connectionMethod}
            </label>
            <select
              value={connectionMethod}
              onChange={(e) => setConnectionMethod(e.target.value as ConnectionMethod)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            >
              <option value="mql5_ea">Real MT5 Terminal (100% Free Local Bridge / Auto-Start)</option>
              <option value="sandbox">Built-in Demo Execution Engine (Instant Local Testing)</option>
            </select>
          </div>

          {connectionMethod === 'mql5_ea' && (
            <div className="space-y-2.5 p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Windows MT5 Terminal Path (<span className="font-mono">terminal64.exe</span>)
                </label>
                <input
                  type="text"
                  value={mt5TerminalPath}
                  onChange={(e) => setMt5TerminalPath(e.target.value)}
                  placeholder="C:\Program Files\MetaTrader 5\terminal64.exe"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoLaunchMt5}
                  onChange={(e) => setAutoLaunchMt5(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
                />
                <span>Start MT5 directly with Login, Password &amp; Server (Windows Local)</span>
              </label>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                100% Free Local Setup — attach <span className="font-mono">TradeSync_{role === 'master' ? 'Master' : 'Follower'}.mq5</span> or run <span className="font-mono">Start-Python-MT5-Bridge.bat</span> from the MT5 Bridge tab.
              </div>
            </div>
          )}

          {role === 'follower' ? (
            <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Copy From Master
                </label>
                <select
                  value={masterId}
                  onChange={(e) => setMasterId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                >
                  {masters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.login}
                    </option>
                  ))}
                  <option value="">Any Master</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  {t.lotSizing}
                </label>
                <select
                  value={lotMode}
                  onChange={(e) => setLotMode(e.target.value as LotSizingMode)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                >
                  <option value="multiplier">Multiplier</option>
                  <option value="equity_ratio">Equity Ratio</option>
                  <option value="balance_ratio">Balance Ratio</option>
                  <option value="fixed">Fixed Lot</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  {lotMode === 'fixed' ? 'Fixed Lot' : t.multiplier}
                </label>
                {lotMode === 'fixed' ? (
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={fixedLot}
                    onChange={(e) => setFixedLot(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                  />
                ) : (
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    value={lotMultiplier}
                    onChange={(e) => setLotMultiplier(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                  />
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Starting Balance (USD)
                </label>
                <input
                  type="number"
                  min="100"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Symbol Suffix
                </label>
                <input
                  type="text"
                  value={symbolSuffix}
                  onChange={(e) => setSymbolSuffix(e.target.value)}
                  placeholder="e.g. m or .pro"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Master Starting Balance (USD)
              </label>
              <input
                type="number"
                min="100"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md cursor-pointer"
            >
              {loading ? 'Connecting...' : 'Login & Connect Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
