import React, { useEffect, useMemo, useState } from 'react';
import type {
  CopierRiskRule,
  GlobalCopierSettings,
  LotSizingMode,
  TradingAccount,
} from '../types/trading.ts';

interface CopierRulesPanelProps {
  accounts: TradingAccount[];
  settings: GlobalCopierSettings;
  selectedAccountId: string | null;
  onSelectAccountId: (id: string) => void;
  onUpdateAccountRule: (
    accountId: string,
    patch: { masterId?: string | null; riskRule: Partial<CopierRiskRule> }
  ) => Promise<void>;
  onUpdateGlobalSettings: (patch: Partial<GlobalCopierSettings>) => Promise<void>;
}

export const CopierRulesPanel: React.FC<CopierRulesPanelProps> = ({
  accounts,
  settings,
  selectedAccountId,
  onSelectAccountId,
  onUpdateAccountRule,
  onUpdateGlobalSettings,
}) => {
  const masters = useMemo(() => accounts.filter((a) => a.role === 'master'), [accounts]);
  const followers = useMemo(() => accounts.filter((a) => a.role === 'follower'), [accounts]);
  const activeFollower =
    followers.find((f) => f.id === selectedAccountId) || followers[0] || null;

  const [masterId, setMasterId] = useState<string>('');
  const [rule, setRule] = useState<CopierRiskRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (activeFollower) {
      setMasterId(activeFollower.masterId || '');
      setRule({ ...activeFollower.riskRule });
    } else {
      setRule(null);
    }
  }, [activeFollower?.id]);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFollower || !rule) return;
    setSaving(true);
    setSavedNotice(null);
    try {
      await onUpdateAccountRule(activeFollower.id, {
        masterId: masterId || null,
        riskRule: rule,
      });
      setSavedNotice(`Saved risk & replication rules for ${activeFollower.login}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Follower selector list */}
      <div className="lg:col-span-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col max-h-[600px]">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Follower Accounts ({followers.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Select a follower account to configure lot sizing, SL/TP sync, and broker symbol suffixes.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
          {followers.map((f) => {
            const selected = activeFollower?.id === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelectAccountId(f.id)}
                className={`w-full px-4 py-3 text-left transition-colors cursor-pointer ${
                  selected
                    ? 'bg-blue-600/10 dark:bg-blue-600/15'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    {f.label}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{f.login}</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {f.server} · {f.riskRule.lotMode} ({f.riskRule.lotMode === 'fixed' ? f.riskRule.fixedLot : `${f.riskRule.lotMultiplier}x`})
                </div>
              </button>
            );
          })}
          {followers.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No Follower accounts connected yet.
            </div>
          )}
        </div>
      </div>

      {/* Right: Rule Editor + Global Settings */}
      <div className="lg:col-span-8 space-y-5">
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
            Global Copier Safeguards
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md cursor-pointer">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Master Copier Switch
              </span>
              <input
                type="checkbox"
                checked={settings.copierActive}
                onChange={(e) => onUpdateGlobalSettings({ copierActive: e.target.checked })}
                className="w-4 h-4 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md cursor-pointer">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Auto-Pause Drawdown
              </span>
              <input
                type="checkbox"
                checked={settings.autoPauseOnDrawdown}
                onChange={(e) => onUpdateGlobalSettings({ autoPauseOnDrawdown: e.target.checked })}
                className="w-4 h-4 accent-blue-600"
              />
            </label>
            <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md cursor-pointer">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Sync Partial Closes
              </span>
              <input
                type="checkbox"
                checked={settings.syncPartialCloses}
                onChange={(e) => onUpdateGlobalSettings({ syncPartialCloses: e.target.checked })}
                className="w-4 h-4 accent-blue-600"
              />
            </label>
          </div>
        </div>

        {activeFollower && rule ? (
          <form
            onSubmit={handleSaveRule}
            className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Replication Rules — {activeFollower.label} ({activeFollower.login})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {activeFollower.server} · {activeFollower.accountTier === 'cent' ? 'CENT (USC)' : 'STANDARD (USD)'} · Balance {activeFollower.balance.toLocaleString()} {activeFollower.currency}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setRule({
                    ...rule,
                    lotMode: 'multiplier',
                    lotMultiplier: 1.0,
                    minLot: 0.01,
                    warnOnContractMismatch: true,
                    symbolSuffix: activeFollower.accountTier === 'cent' && !rule.symbolSuffix ? 'c' : rule.symbolSuffix,
                  })
                }
                className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded-md cursor-pointer"
              >
                Apply Exact 1:1 Preset
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Source Master Account
                </label>
                <select
                  value={masterId}
                  onChange={(e) => setMasterId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                >
                  <option value="">Any Connected Master</option>
                  {masters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.login} ({m.server})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Lot Sizing Mode
                </label>
                <select
                  value={rule.lotMode}
                  onChange={(e) => setRule({ ...rule, lotMode: e.target.value as LotSizingMode })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                >
                  <option value="multiplier">Lot Multiplier (e.g. 0.5x, 1x, 2x)</option>
                  <option value="equity_ratio">Proportional by Equity Ratio</option>
                  <option value="balance_ratio">Proportional by Balance Ratio</option>
                  <option value="fixed">Fixed Lot Size per Trade</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {rule.lotMode === 'fixed' ? 'Fixed Lot Size' : 'Multiplier'}
                </label>
                {rule.lotMode === 'fixed' ? (
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={rule.fixedLot}
                    onChange={(e) => setRule({ ...rule, fixedLot: Number(e.target.value) || 0.01 })}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                  />
                ) : (
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    value={rule.lotMultiplier}
                    onChange={(e) => setRule({ ...rule, lotMultiplier: Number(e.target.value) || 1 })}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Min Lot Floor
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={rule.minLot}
                  onChange={(e) => setRule({ ...rule, minLot: Number(e.target.value) || 0.01 })}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Max Lot Cap
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  value={rule.maxLot}
                  onChange={(e) => setRule({ ...rule, maxLot: Number(e.target.value) || 50 })}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Max Daily Drawdown (%)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="100"
                  value={rule.maxDrawdownPct}
                  onChange={(e) => setRule({ ...rule, maxDrawdownPct: Number(e.target.value) || 15 })}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Broker Symbol Prefix
                </label>
                <input
                  type="text"
                  value={rule.symbolPrefix}
                  onChange={(e) => setRule({ ...rule, symbolPrefix: e.target.value })}
                  placeholder="Optional (e.g. fx.)"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Broker Symbol Suffix
                </label>
                <input
                  type="text"
                  value={rule.symbolSuffix}
                  onChange={(e) => setRule({ ...rule, symbolSuffix: e.target.value })}
                  placeholder="e.g. m, .pro, _i"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Max Slippage (Pips)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={rule.maxSlippagePips}
                  onChange={(e) => setRule({ ...rule, maxSlippagePips: Number(e.target.value) || 3 })}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-2 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.copySlTp}
                  onChange={(e) => setRule({ ...rule, copySlTp: e.target.checked })}
                  className="w-4 h-4 accent-blue-600"
                />
                <span>Copy Stop Loss &amp; Take Profit automatically</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.reverseCopy}
                  onChange={(e) => setRule({ ...rule, reverseCopy: e.target.checked })}
                  className="w-4 h-4 accent-blue-600"
                />
                <span>Reverse Copy (Invert Master Buy ↔ Sell)</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.warnOnContractMismatch ?? true}
                  onChange={(e) => setRule({ ...rule, warnOnContractMismatch: e.target.checked })}
                  className="w-4 h-4 accent-blue-600"
                />
                <span>Warn on Cent ↔ Standard exposure difference (keep 1:1 lot)</span>
              </label>
            </div>

            {savedNotice && (
              <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2">
                {savedNotice}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Follower Risk Rule'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
};
