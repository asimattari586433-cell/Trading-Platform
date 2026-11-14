import React, { useMemo, useState } from 'react';
import { Lock, ShieldAlert, Unlock } from 'lucide-react';
import type { Lang } from '../i18n.ts';
import { COPY_TEXT } from '../i18n.ts';
import type { SymbolQuote, TradeSide, TradingAccount } from '../types/trading.ts';

interface OrderTicketProps {
  lang: Lang;
  accounts: TradingAccount[];
  selectedMasterId: string;
  onSelectMasterId: (id: string) => void;
  quote: SymbolQuote | undefined;
  copierActive: boolean;
  realTradingArmed: boolean;
  onToggleRealArmed: (armed: boolean) => Promise<void>;
  onExecuteOrder: (payload: {
    masterAccountId: string;
    symbol: string;
    side: TradeSide;
    lots: number;
    sl: number | null;
    tp: number | null;
  }) => Promise<{ pendingMasterConfirm?: boolean } | void>;
}

const LOT_PRESETS = [0.01, 0.1, 0.5, 1.0, 2.0];

export const OrderTicket: React.FC<OrderTicketProps> = ({
  lang,
  accounts,
  selectedMasterId,
  onSelectMasterId,
  quote,
  copierActive,
  realTradingArmed,
  onToggleRealArmed,
  onExecuteOrder,
}) => {
  const t = COPY_TEXT[lang];
  const [lots, setLots] = useState<string>('0.10');
  const [slInput, setSlInput] = useState<string>('');
  const [tpInput, setTpInput] = useState<string>('');
  const [submitting, setSubmitting] = useState<TradeSide | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const masters = useMemo(() => accounts.filter((a) => a.role === 'master'), [accounts]);
  const selectedMaster = masters.find((m) => m.id === selectedMasterId) || masters[0];

  const activeFollowers = useMemo(() => {
    if (!selectedMaster) return [];
    return accounts.filter(
      (a) =>
        a.role === 'follower' &&
        a.copyEnabled &&
        a.status !== 'disconnected' &&
        (a.masterId === selectedMaster.id || a.masterId === null) &&
        (a.mode === 'demo' || realTradingArmed)
    );
  }, [accounts, realTradingArmed, selectedMaster]);

  const parsedLots = Math.max(0.01, Number(lots) || 0.01);

  const projectedFollowerLots = useMemo(() => {
    if (!selectedMaster) return 0;
    return activeFollowers.reduce((sum, f) => {
      const r = f.riskRule;
      let val = parsedLots;
      if (r.lotMode === 'fixed') val = r.fixedLot;
      else if (r.lotMode === 'multiplier') val = parsedLots * r.lotMultiplier;
      else if (r.lotMode === 'equity_ratio') {
        val = parsedLots * (selectedMaster.equity > 0 ? f.equity / selectedMaster.equity : 1) * r.lotMultiplier;
      } else if (r.lotMode === 'balance_ratio') {
        val = parsedLots * (selectedMaster.balance > 0 ? f.balance / selectedMaster.balance : 1) * r.lotMultiplier;
      }
      const clamped = Math.max(r.minLot, Math.min(r.maxLot, Math.round(val * 100) / 100));
      return sum + clamped;
    }, 0);
  }, [activeFollowers, parsedLots, selectedMaster]);

  const isRealMasterLocked = selectedMaster?.mode === 'real' && !realTradingArmed;

  const submitSide = async (side: TradeSide) => {
    if (!quote || !selectedMaster) return;
    setSubmitting(side);
    setFeedback(null);
    try {
      const sl = slInput.trim() ? Number(slInput) : null;
      const tp = tpInput.trim() ? Number(tpInput) : null;
      const res = await onExecuteOrder({
        masterAccountId: selectedMaster.id,
        symbol: quote.symbol,
        side,
        lots: parsedLots,
        sl: sl && !Number.isNaN(sl) ? sl : null,
        tp: tp && !Number.isNaN(tp) ? tp : null,
      });
      if (res && res.pendingMasterConfirm) {
        setFeedback(
          `Dispatched ${side} ${parsedLots.toFixed(2)} ${quote.symbol} to Master MT5 (${selectedMaster.login}). Waiting for broker fill confirmation before copying to ${activeFollowers.length} Followers.`
        );
      } else {
        setFeedback(
          `${side} ${parsedLots.toFixed(2)} ${quote.symbol} executed on Master & copied to ${copierActive ? activeFollowers.length : 0} accounts.`
        );
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 tracking-wide">
          {t.orderTicket}
        </h2>
        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
          {quote?.symbol || 'EURUSD'}
        </span>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-3 overflow-y-auto">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Master Source Account
          </label>
          <select
            value={selectedMaster?.id || ''}
            onChange={(e) => onSelectMasterId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {masters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.login} ({m.mode.toUpperCase()} · {m.connectionMethod === 'mql5_ea' ? 'Real MT5 EA' : 'Demo Engine'}) — ${m.equity.toLocaleString()}
              </option>
            ))}
            {masters.length === 0 && <option value="">No Master connected</option>}
          </select>
        </div>

        {isRealMasterLocked && (
          <div className="p-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              Real-Money Execution Locked
            </div>
            <p className="opacity-90 leading-relaxed">
              Complete Demo Master/Follower verification first before arming live broker trades.
            </p>
            <button
              type="button"
              onClick={() => onToggleRealArmed(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer"
            >
              <Unlock className="w-3 h-3" />
              Arm Real-Money Execution
            </button>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t.volumeLots}
            </label>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Min 0.01
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLots(Math.max(0.01, Number((parsedLots - 0.01).toFixed(2))).toFixed(2))}
              className="px-3 py-2 text-xs font-mono font-semibold bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              value={lots}
              onChange={(e) => setLots(e.target.value)}
              className="flex-1 text-center py-2 text-sm font-mono tabular-nums font-semibold bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setLots(Math.min(100, Number((parsedLots + 0.01).toFixed(2))).toFixed(2))}
              className="px-3 py-2 text-xs font-mono font-semibold bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              +
            </button>
          </div>
          <div className="grid grid-cols-5 gap-1.5 mt-1.5">
            {LOT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setLots(preset.toFixed(2))}
                className={`py-1 text-[11px] font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                  Math.abs(parsedLots - preset) < 0.001
                    ? 'border-blue-500 bg-blue-600/10 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              {t.stopLoss}
            </label>
            <input
              type="number"
              step={quote ? Math.pow(10, -quote.digits) : 0.0001}
              value={slInput}
              onChange={(e) => setSlInput(e.target.value)}
              placeholder="Optional"
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              {t.takeProfit}
            </label>
            <input
              type="number"
              step={quote ? Math.pow(10, -quote.digits) : 0.0001}
              value={tpInput}
              onChange={(e) => setTpInput(e.target.value)}
              placeholder="Optional"
              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">{t.replicationPreview}</span>
            <span
              className={`font-mono font-semibold ${
                copierActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {copierActive ? `${activeFollowers.length} Active Accounts` : 'Copier Paused'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Projected Total Copied</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {copierActive ? projectedFollowerLots.toFixed(2) : '0.00'} lots
            </span>
          </div>
          {selectedMaster?.connectionMethod === 'mql5_ea' && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Master-first broker confirmation enabled
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-auto pt-2">
          <button
            type="button"
            disabled={!quote || !selectedMaster || submitting !== null || isRealMasterLocked}
            onClick={() => submitSide('SELL')}
            className="flex flex-col items-center justify-center py-2.5 px-3 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white transition-colors cursor-pointer"
          >
            <span className="text-[11px] font-medium opacity-90 inline-flex items-center gap-1">
              {isRealMasterLocked && <Lock className="w-3 h-3" />}
              {t.sellByMarket}
            </span>
            <span className="text-sm font-mono tabular-nums font-bold mt-0.5">
              {quote ? quote.bid.toFixed(quote.digits) : '---'}
            </span>
          </button>
          <button
            type="button"
            disabled={!quote || !selectedMaster || submitting !== null || isRealMasterLocked}
            onClick={() => submitSide('BUY')}
            className="flex flex-col items-center justify-center py-2.5 px-3 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors cursor-pointer"
          >
            <span className="text-[11px] font-medium opacity-90 inline-flex items-center gap-1">
              {isRealMasterLocked && <Lock className="w-3 h-3" />}
              {t.buyByMarket}
            </span>
            <span className="text-sm font-mono tabular-nums font-bold mt-0.5">
              {quote ? quote.ask.toFixed(quote.digits) : '---'}
            </span>
          </button>
        </div>

        {feedback && (
          <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5">
            {feedback}
          </div>
        )}
      </div>
    </aside>
  );
};
