import React, { useMemo, useState } from 'react';
import { Pencil, Scissors, X } from 'lucide-react';
import type { Lang } from '../i18n.ts';
import { COPY_TEXT } from '../i18n.ts';
import type { ClosedTrade, CopierLogEntry, Position } from '../types/trading.ts';

interface PositionsToolboxProps {
  lang: Lang;
  positions: Position[];
  logs: CopierLogEntry[];
  history: ClosedTrade[];
  onClosePosition: (positionId: string, closeLots?: number) => Promise<void>;
  onModifyPosition: (positionId: string, sl: number | null, tp: number | null) => Promise<void>;
  onCloseAll: () => Promise<void>;
}

type ToolboxTab = 'positions' | 'logs' | 'history';
type RoleFilter = 'all' | 'master' | 'follower';

export const PositionsToolbox: React.FC<PositionsToolboxProps> = ({
  lang,
  positions,
  logs,
  history,
  onClosePosition,
  onModifyPosition,
  onCloseAll,
}) => {
  const t = COPY_TEXT[lang];
  const [tab, setTab] = useState<ToolboxTab>('positions');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [search, setSearch] = useState('');
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [partialPos, setPartialPos] = useState<Position | null>(null);
  const [partialLots, setPartialLots] = useState('');

  const filteredPositions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions.filter((p) => {
      if (roleFilter !== 'all' && p.accountRole !== roleFilter) return false;
      if (!q) return true;
      return (
        p.symbol.toLowerCase().includes(q) ||
        p.accountLogin.toLowerCase().includes(q) ||
        p.accountLabel.toLowerCase().includes(q)
      );
    });
  }, [positions, roleFilter, search]);

  const totalFloating = useMemo(
    () => filteredPositions.reduce((s, p) => s + p.profit, 0),
    [filteredPositions]
  );

  const openModify = (pos: Position) => {
    setEditingPos(pos);
    setEditSl(pos.sl !== null ? String(pos.sl) : '');
    setEditTp(pos.tp !== null ? String(pos.tp) : '');
  };

  const openPartialClose = (pos: Position) => {
    setPartialPos(pos);
    setPartialLots((Math.max(0.01, Math.round((pos.lots / 2) * 100) / 100)).toFixed(2));
  };

  const saveModify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPos) return;
    await onModifyPosition(
      editingPos.id,
      editSl.trim() ? Number(editSl) : null,
      editTp.trim() ? Number(editTp) : null
    );
    setEditingPos(null);
  };

  const formatLotExact = (lots: number) => {
    const fixed = lots.toFixed(4).replace(/(\.\d{2})0+$/, '$1').replace(/(\.\d{3})0$/, '$1');
    return fixed;
  };

  const submitPartialClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partialPos) return;
    const raw = Number(partialLots);
    const lots = raw > 0 ? Math.min(partialPos.lots, raw) : partialPos.lots;
    await onClosePosition(partialPos.id, lots);
    setPartialPos(null);
  };

  const formatStatusText = (p: Position) => {
    if (p.status === 'pending_master_confirm') return 'Awaiting Master MT5';
    if (p.status === 'queued_mt5') return 'Queued Follower MT5';
    if (p.pendingAction === 'PARTIAL_CLOSE') {
      return `Pending Partial Close (${formatLotExact(p.pendingCloseLots || 0)} lots)`;
    }
    if (p.pendingAction === 'CLOSE') return 'Pending Full Close';
    if (p.pendingAction === 'MODIFY') return 'Pending SL/TP Sync';
    if (p.status === 'rejected') return p.errorMessage || 'Broker Rejected';
    if (p.errorMessage) return p.errorMessage;
    return p.externalTicket ? `MT5 #${p.externalTicket}` : 'Open';
  };

  return (
    <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {(
            [
              { id: 'positions', label: `${t.openPositions} (${positions.length})` },
              { id: 'logs', label: `${t.copierLog} (${logs.length})` },
              { id: 'history', label: `${t.tradeHistory} (${history.length})` },
            ] as Array<{ id: ToolboxTab; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id
                  ? 'bg-slate-900 dark:bg-slate-800 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          {tab === 'positions' && (
            <>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#0B0F17] p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
                {(['all', 'master', 'follower'] as RoleFilter[]).map((rf) => (
                  <button
                    key={rf}
                    type="button"
                    onClick={() => setRoleFilter(rf)}
                    className={`px-2 py-1 text-[11px] capitalize rounded transition-colors cursor-pointer ${
                      roleFilter === rf
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {rf}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search login or symbol..."
                className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
              />
              {positions.length > 0 && (
                <button
                  type="button"
                  onClick={onCloseAll}
                  className="px-3 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t.closeAll}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="max-h-72 overflow-auto">
        {tab === 'positions' && (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 dark:bg-[#0E141F] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2 px-3">Account / Role</th>
                <th className="py-2 px-3">Ticket / Sync</th>
                <th className="py-2 px-3">Symbol</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3 text-right">Volume</th>
                <th className="py-2 px-3 text-right">Open</th>
                <th className="py-2 px-3 text-right">SL / TP</th>
                <th className="py-2 px-3 text-right">Price</th>
                <th className="py-2 px-3 text-right">Profit</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {filteredPositions.map((p) => {
                const posPnl = p.profit >= 0;
                return (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2 px-3">
                      <div className="font-mono text-slate-900 dark:text-slate-100">
                        {p.accountLogin}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {p.accountRole === 'master' ? 'Master' : 'Follower'} · {p.accountMode.toUpperCase()}
                        {p.accountTier === 'cent' ? ' · CENT' : ''}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        #{p.ticket}
                      </div>
                      <div
                        className={`text-[11px] ${
                          p.status === 'rejected' || p.errorMessage
                            ? 'text-rose-500 font-medium'
                            : p.status === 'pending_master_confirm' ||
                                p.status === 'queued_mt5' ||
                                Boolean(p.pendingAction)
                              ? 'text-amber-500 font-medium'
                              : 'text-slate-400'
                        }`}
                      >
                        {formatStatusText(p)}
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {p.brokerSymbol}
                      </div>
                      {p.riskWarning && (
                        <div className="text-[10px] text-amber-500 max-w-[200px] truncate" title={p.riskWarning}>
                          {p.riskWarning}
                        </div>
                      )}
                    </td>
                    <td
                      className={`py-2 px-3 font-mono font-semibold ${
                        p.side === 'BUY'
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {p.side}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatLotExact(p.lots)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {p.openPrice}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                      {p.sl ?? '—'} / {p.tp ?? '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {p.currentPrice}
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                        posPnl
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {posPnl ? '+' : ''}
                      {p.profit.toFixed(2)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {p.accountRole === 'master' && (
                          <button
                            type="button"
                            onClick={() => openModify(p)}
                            title="Modify SL/TP across Master & Followers"
                            className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {p.lots >= 0.02 && (
                          <button
                            type="button"
                            onClick={() => openPartialClose(p)}
                            title="Partial Close"
                            className="p-1 text-amber-500 hover:text-amber-400 rounded cursor-pointer"
                          >
                            <Scissors className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onClosePosition(p.id)}
                          title={
                            p.accountRole === 'master'
                              ? 'Close Master & all linked Followers'
                              : 'Close this Follower trade'
                          }
                          className="p-1 text-rose-500 hover:text-rose-400 rounded cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredPositions.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No open positions. Place a Buy or Sell order from Master Execution or your connected MT5 terminal.
                  </td>
                </tr>
              )}
            </tbody>
            {filteredPositions.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-[#0E141F] border-t border-slate-200 dark:border-slate-800 text-xs font-semibold">
                <tr>
                  <td colSpan={8} className="py-2 px-3 text-slate-600 dark:text-slate-300">
                    Aggregate Floating P&amp;L ({filteredPositions.length} positions)
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-mono tabular-nums ${
                      totalFloating >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {totalFloating >= 0 ? '+' : ''}
                    ${totalFloating.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {tab === 'logs' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-2.5 flex items-start justify-between gap-4 text-xs">
                <div className="space-y-0.5">
                  <div className="text-slate-900 dark:text-slate-100 font-medium">
                    {log.message}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString()} · {log.eventType} · Latency {log.avgLatencyMs}ms
                  </div>
                </div>
                <span
                  className={`text-[11px] font-medium shrink-0 ${
                    log.status === 'success'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : log.status === 'warning' || log.status === 'partial'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {log.followersSucceeded}/{log.followersTargeted} Synced
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 dark:bg-[#0E141F] text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2 px-3">Account</th>
                <th className="py-2 px-3">Ticket</th>
                <th className="py-2 px-3">Symbol</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3 text-right">Lots</th>
                <th className="py-2 px-3 text-right">Open</th>
                <th className="py-2 px-3 text-right">Close</th>
                <th className="py-2 px-3 text-right">Realized P&amp;L</th>
                <th className="py-2 px-3 text-right">Closed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
              {history.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-mono text-slate-900 dark:text-slate-100">
                    {h.accountLogin} · {h.accountRole === 'master' ? 'M' : 'F'}
                  </td>
                  <td className="py-2 px-3 font-mono tabular-nums text-slate-500">#{h.ticket}</td>
                  <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">{h.symbol}</td>
                  <td
                    className={`py-2 px-3 font-mono font-semibold ${
                      h.side === 'BUY' ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {h.side}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">{h.lots.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">{h.openPrice}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">{h.closePrice}</td>
                  <td
                    className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                      h.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {h.profit >= 0 ? '+' : ''}
                    {h.profit.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-500">
                    {new Date(h.closedAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Closed Master and Follower trades will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {editingPos && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={saveModify}
            className="w-full max-w-sm bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Modify Position #{editingPos.ticket} ({editingPos.symbol})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Updating Stop Loss or Take Profit on Master automatically syncs to all copied Follower trades.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Stop Loss</label>
                <input
                  type="number"
                  step="any"
                  value={editSl}
                  onChange={(e) => setEditSl(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Take Profit</label>
                <input
                  type="number"
                  step="any"
                  value={editTp}
                  onChange={(e) => setEditTp(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPos(null)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded cursor-pointer"
              >
                Apply &amp; Sync
              </button>
            </div>
          </form>
        </div>
      )}

      {partialPos && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={submitPartialClose}
            className="w-full max-w-sm bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Partial Close #{partialPos.ticket} ({partialPos.symbol})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Current open volume: <span className="font-mono font-semibold">{partialPos.lots.toFixed(2)} lots</span>. Linked Followers close proportionally.
            </p>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Lots to Close</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={partialPos.lots}
                value={partialLots}
                onChange={(e) => setPartialLots(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded"
              />
              <div className="flex items-center gap-2 mt-2">
                {[0.25, 0.5, 0.75].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() =>
                      setPartialLots(
                        Math.max(0.01, Math.round(partialPos.lots * pct * 100) / 100).toFixed(2)
                      )
                    }
                    className="px-2.5 py-1 text-[11px] font-mono bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded cursor-pointer"
                  >
                    {Math.round(pct * 100)}%
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPartialPos(null)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded cursor-pointer"
              >
                Partial Close
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};
