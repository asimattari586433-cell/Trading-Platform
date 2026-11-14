import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { SymbolQuote } from '../types/trading.ts';

interface MarketWatchProps {
  quotes: SymbolQuote[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  title: string;
}

export const MarketWatch: React.FC<MarketWatchProps> = ({
  quotes,
  selectedSymbol,
  onSelectSymbol,
  title,
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter(
      (item) =>
        item.symbol.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }, [quotes, query]);

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 tracking-wide">
          {title}
        </h2>
        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {quotes.length} Pairs
        </span>
      </div>

      <div className="px-2.5 py-2 border-b border-slate-200 dark:border-slate-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter symbol..."
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-12 px-3 py-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0E141F]">
        <div className="col-span-4">Symbol</div>
        <div className="col-span-3 text-right">Bid</div>
        <div className="col-span-3 text-right">Ask</div>
        <div className="col-span-2 text-right">Spr</div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
        {filtered.map((q) => {
          const isSelected = q.symbol === selectedSymbol;
          const up = q.changePct >= 0;
          return (
            <button
              key={q.symbol}
              type="button"
              onClick={() => onSelectSymbol(q.symbol)}
              className={`w-full grid grid-cols-12 items-center px-3 py-2 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-blue-600/10 dark:bg-blue-600/15'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="col-span-4 min-w-0 pr-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {q.symbol}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                  <span
                    className={
                      up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }
                  >
                    {up ? '+' : ''}
                    {q.changePct.toFixed(2)}%
                  </span>
                  <span className="text-slate-400" aria-hidden="true">·</span>
                  <span className="text-slate-400 dark:text-slate-500">
                    {q.feedSource === 'MT5_BROKER'
                      ? 'MT5'
                      : q.feedSource === 'LIVE_FEED'
                        ? 'Live'
                        : 'Sim'}
                  </span>
                </div>
              </div>
              <div className="col-span-3 text-right font-mono tabular-nums text-xs text-slate-800 dark:text-slate-200">
                {q.bid.toFixed(q.digits)}
              </div>
              <div className="col-span-3 text-right font-mono tabular-nums text-xs text-slate-800 dark:text-slate-200">
                {q.ask.toFixed(q.digits)}
              </div>
              <div className="col-span-2 text-right font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                {q.spreadPoints}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching symbols
          </div>
        )}
      </div>
    </aside>
  );
};
