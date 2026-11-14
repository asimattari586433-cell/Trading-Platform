import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, Power, RotateCcw, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import type {
  Candle,
  CustomIndicatorOverlay,
  IndicatorConfig,
  Position,
  SymbolQuote,
  Timeframe,
} from '../types/trading.ts';
import { blendHexColor, computeAsimIndicator } from '../utils/asimIndicator.ts';

interface CandlestickChartProps {
  symbol: string;
  quote: SymbolQuote | undefined;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  candles: Candle[];
  positions: Position[];
  indicatorOverlay: CustomIndicatorOverlay | undefined;
  indicatorConfig: IndicatorConfig;
  onUpdateIndicatorConfig: (patch: Partial<IndicatorConfig>) => void;
  onResetIndicatorConfig: () => void;
}

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'H1', 'H4'];

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  quote,
  timeframe,
  onTimeframeChange,
  candles,
  positions,
  indicatorOverlay,
  indicatorConfig,
  onUpdateIndicatorConfig,
  onResetIndicatorConfig,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ idx: number | null; x: number; y: number } | null>(null);
  const [showIndicatorSettings, setShowIndicatorSettings] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 760, height: 360 });
  const [visibleBarsCount, setVisibleBarsCount] = useState<number>(80);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [priceScaleMult, setPriceScaleMult] = useState<number>(1.0);
  const [priceOffsetRatio, setPriceOffsetRatio] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const dragRef = useRef<{
    active: boolean;
    mode: 'pan' | 'price_scale';
    startX: number;
    startY: number;
    startPan: number;
    startPriceOffset: number;
    startPriceScale: number;
  }>({
    active: false,
    mode: 'pan',
    startX: 0,
    startY: 0,
    startPan: 0,
    startPriceOffset: 0,
    startPriceScale: 1,
  });

  useEffect(() => {
    setPanOffset(0);
    setPriceOffsetRatio(0);
    setPriceScaleMult(1.0);
  }, [symbol, timeframe]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        const h = Math.max(240, Math.floor(entry.contentRect.height));
        setDimensions({ width: w, height: h });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Merge live tick bid onto forming last bar so the indicator and live probability lines react in real time
  const liveCandles = useMemo(() => {
    if (candles.length === 0 || !quote || quote.symbol !== symbol) return candles;
    const copy = candles.slice();
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = {
      ...last,
      close: quote.bid,
      high: Math.max(last.high, quote.bid),
      low: Math.min(last.low, quote.bid),
    };
    return copy;
  }, [candles, quote, symbol]);

  const asimData = useMemo(() => {
    if (!indicatorConfig.enabled) return null;
    return computeAsimIndicator(liveCandles, indicatorConfig);
  }, [liveCandles, indicatorConfig]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = dimensions.width;
    const h = dimensions.height;
    const isDark = document.documentElement.classList.contains('dark');
    const tvDark = isDark && indicatorConfig.enabled && indicatorConfig.applyTvTheme;

    const bgHex = tvDark ? '#131722' : isDark ? '#0B1019' : '#FFFFFF';
    const gridStroke = tvDark
      ? '#2A2E39'
      : isDark
        ? 'rgba(148, 163, 184, 0.09)'
        : 'rgba(15, 23, 42, 0.07)';
    const fgText = tvDark ? '#D1D4DC' : isDark ? '#94A3B8' : '#64748B';
    const bullHex = tvDark ? '#089981' : '#10B981';
    const bearHex = tvDark ? '#F23645' : '#EF4444';

    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, w, h);

    const padRight = 76;
    const padBottom = 24;
    const padTop = 14;
    const padLeft = 10;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    if (liveCandles.length === 0) {
      ctx.fillStyle = fgText;
      ctx.font = '12px "DM Sans", sans-serif';
      ctx.fillText('Loading market bars...', w / 2 - 60, h / 2);
      return;
    }

    const visibleCandles = Math.min(liveCandles.length, Math.max(20, visibleBarsCount));
    const maxPan = Math.max(0, liveCandles.length - visibleCandles);
    const clampedPan = Math.max(0, Math.min(maxPan, Math.round(panOffset)));
    const futureMarginBars = clampedPan === 0 ? 10 : 0;
    const endIdx = Math.max(visibleCandles, liveCandles.length - clampedPan);
    const startIdx = Math.max(0, endIdx - visibleCandles);
    const slice = liveCandles.slice(startIdx, endIdx);
    const totalSlots = slice.length + futureMarginBars;
    const digits = quote?.digits ?? 5;
    const timeToVisIdx = new Map<number, number>();
    slice.forEach((c, idx) => timeToVisIdx.set(c.time, idx));

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const c of slice) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    const expandRange = (val: number | null | undefined) => {
      if (val !== null && val !== undefined && Number.isFinite(val)) {
        if (val < minPrice) minPrice = val;
        if (val > maxPrice) maxPrice = val;
      }
    };

    if (indicatorConfig.enabled && asimData?.ready) {
      if (indicatorConfig.showAlli) {
        for (let i = Math.max(0, startIdx - indicatorConfig.jawOff); i < endIdx; i++) {
          expandRange(asimData.jaw[i]);
          expandRange(asimData.teeth[i]);
          expandRange(asimData.lips[i]);
        }
      }
      if (indicatorConfig.showTL) {
        for (let i = startIdx; i < endIdx; i++) {
          const shifted = i + asimData.tlShift;
          if (shifted >= startIdx && shifted < endIdx) {
            expandRange(asimData.tlu[i]);
            expandRange(asimData.tll[i]);
          }
        }
        for (const b of asimData.upBreaks) {
          if (b.index >= startIdx && b.index < endIdx) expandRange(b.price);
        }
        for (const b of asimData.dnBreaks) {
          if (b.index >= startIdx && b.index < endIdx) expandRange(b.price);
        }
      }
      if (indicatorConfig.showSR) {
        for (let i = startIdx; i < endIdx; i++) {
          expandRange(asimData.srh[i]);
          expandRange(asimData.srl[i]);
        }
      }
      if (indicatorConfig.showProb && clampedPan === 0) {
        const candleSpan = Math.max(1e-6, maxPrice - minPrice);
        for (const pl of asimData.probLevels) {
          if (Math.abs(pl.level - liveCandles[liveCandles.length - 1].close) <= candleSpan * 1.4) {
            expandRange(pl.level);
          }
        }
      }
    }

    if (indicatorConfig.enabled && indicatorOverlay) {
      for (const line of indicatorOverlay.lines) {
        for (const pt of line.points) {
          if (timeToVisIdx.has(pt.time)) expandRange(pt.value);
        }
      }
    }

    const symbolPositions = positions.filter(
      (p) => p.symbol === symbol && p.accountRole === 'master'
    );
    for (const p of symbolPositions) {
      expandRange(p.openPrice);
      if (p.sl !== null) expandRange(p.sl);
      if (p.tp !== null) expandRange(p.tp);
    }

    if (quote && clampedPan === 0) {
      expandRange(quote.bid);
      expandRange(quote.ask);
    }

    const rawSpan = Math.max(1e-6, maxPrice - minPrice);
    const midPrice = (minPrice + maxPrice) / 2 + priceOffsetRatio * rawSpan;
    const scaledHalfSpan = (rawSpan * 0.58) / Math.max(0.35, priceScaleMult);
    minPrice = midPrice - scaledHalfSpan;
    maxPrice = midPrice + scaledHalfSpan;
    const range = maxPrice - minPrice;

    const priceToY = (p: number) => padTop + ((maxPrice - p) / range) * chartH;
    const yToPrice = (y: number) => maxPrice - ((y - padTop) / chartH) * range;
    const step = chartW / totalSlots;
    const idxToX = (visIdx: number) => padLeft + visIdx * step + step / 2;
    const bodyW = Math.max(2, Math.min(14, step * 0.65));

    // Grid lines
    ctx.strokeStyle = gridStroke;
    ctx.lineWidth = 1;
    const gridRows = 5;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = fgText;

    for (let i = 0; i <= gridRows; i++) {
      const y = padTop + (chartH / gridRows) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();

      const priceVal = maxPrice - (range / gridRows) * i;
      ctx.fillText(priceVal.toFixed(digits), w - padRight + 6, y + 4);
    }

    // Candlesticks (clipped cleanly to plot box so vertical pan never overlaps axes)
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, chartW, chartH);
    ctx.clip();

    slice.forEach((c, idx) => {
      const x = idxToX(idx);
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);
      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      const bullish = c.close >= c.open;
      const color = bullish ? bullHex : bearHex;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      ctx.fillStyle = color;
      const top = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
      ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
    });
    ctx.restore();

    const labelEvery = Math.max(4, Math.floor(slice.length / 6));
    slice.forEach((c, idx) => {
      if (idx % labelEvery === 0) {
        const x = idxToX(idx);
        const dt = new Date(c.time * 1000);
        const label = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        ctx.fillStyle = fgText;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(label, x - 14, h - 7);
      }
    });

    // Helper for segmented buffer lines (supports shift + breaks on null)
    const drawSegmentedSeries = (
      values: Array<number | null>,
      shiftBars: number,
      strokeColor: string,
      lineWidth: number
    ) => {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        const visIdx = i + shiftBars - startIdx;
        if (val === null || visIdx < 0 || visIdx >= totalSlots) {
          started = false;
          continue;
        }
        const x = idxToX(visIdx);
        const y = priceToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    // Clip trendlines, rays, Alligator, S/R, fractals, and probability lines to plot bounds
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, chartW, chartH);
    ctx.clip();

    // ---- Asim_TV_TL_Prob_Alligator Rendering ----
    if (indicatorConfig.enabled && asimData?.ready) {
      // 1) Alligator (Jaw, Teeth, Lips with forward offsets & TradingView opacity blending)
      if (indicatorConfig.showAlli) {
        const jawColor = blendHexColor('#2962FF', bgHex, indicatorConfig.alliOpacity);
        const teethColor = blendHexColor('#F23645', bgHex, indicatorConfig.alliOpacity);
        const lipsColor = blendHexColor('#4CAF50', bgHex, indicatorConfig.alliOpacity);
        drawSegmentedSeries(asimData.jaw, indicatorConfig.jawOff, jawColor, 1.8);
        drawSegmentedSeries(asimData.teeth, indicatorConfig.teethOff, teethColor, 1.8);
        drawSegmentedSeries(asimData.lips, indicatorConfig.lipsOff, lipsColor, 1.8);
      }

      // 2) Support / Resistance segmented lines
      if (indicatorConfig.showSR) {
        const resColor = blendHexColor('#808000', bgHex, 75);
        const supColor = blendHexColor('#880E4F', bgHex, 75);
        drawSegmentedSeries(asimData.srh, 0, resColor, 1.5);
        drawSegmentedSeries(asimData.srl, 0, supColor, 1.5);
      }

      // 3) Fractals (Up = arrow above high, Down = arrow below low)
      if (indicatorConfig.showFrac) {
        const fracUpColor = blendHexColor('#808000', bgHex, 75);
        const fracDnColor = blendHexColor('#880E4F', bgHex, 75);

        ctx.save();
        ctx.fillStyle = fracUpColor;
        for (const f of asimData.fracUp) {
          const visIdx = f.index - startIdx;
          if (visIdx < 0 || visIdx >= slice.length) continue;
          const x = idxToX(visIdx);
          const y = priceToY(f.price) - 8;
          ctx.beginPath();
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x - 4, y);
          ctx.lineTo(x + 4, y);
          ctx.closePath();
          ctx.fill();
        }

        ctx.fillStyle = fracDnColor;
        for (const f of asimData.fracDn) {
          const visIdx = f.index - startIdx;
          if (visIdx < 0 || visIdx >= slice.length) continue;
          const x = idxToX(visIdx);
          const y = priceToY(f.price) + 8;
          ctx.beginPath();
          ctx.moveTo(x, y + 6);
          ctx.lineTo(x - 4, y);
          ctx.lineTo(x + 4, y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // 4) Trendlines with Breaks (LuxAlgo)
      if (indicatorConfig.showTL) {
        drawSegmentedSeries(asimData.tlu, asimData.tlShift, '#089981', 1.6);
        drawSegmentedSeries(asimData.tll, asimData.tlShift, '#F23645', 1.6);

        // Extended dashed trendlines
        const drawExtRay = (
          ray: { x1Index: number; y1: number; x2Index: number; y2: number } | null,
          color: string
        ) => {
          if (!ray) return;
          const v1 = ray.x1Index - startIdx;
          const v2 = ray.x2Index - startIdx;
          const dxBars = v2 - v1;
          if (dxBars === 0) return;
          const dyPrice = ray.y2 - ray.y1;
          const endBar = totalSlots - 1;
          const endPrice = ray.y1 + dyPrice * ((endBar - v1) / dxBars);

          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(idxToX(v1), priceToY(ray.y1));
          ctx.lineTo(idxToX(endBar), priceToY(endPrice));
          ctx.stroke();
          ctx.restore();
        };

        if (indicatorConfig.showExt) {
          drawExtRay(asimData.extUpper, '#089981');
          drawExtRay(asimData.extLower, '#F23645');
        }

        // 'B' Break badges
        const drawBreakBadge = (visIdx: number, price: number, color: string) => {
          if (visIdx < 0 || visIdx >= slice.length) return;
          const x = idxToX(visIdx);
          const y = priceToY(price);
          ctx.save();
          ctx.fillStyle = color;
          ctx.fillRect(x - 6, y - 6, 12, 12);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 9px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('B', x, y + 0.5);
          ctx.restore();
        };

        for (const b of asimData.upBreaks) {
          drawBreakBadge(b.index - startIdx, b.price, '#089981');
        }
        for (const b of asimData.dnBreaks) {
          drawBreakBadge(b.index - startIdx, b.price, '#F23645');
        }
      }

      // 5) Breakout Probability: Primary BUY/UP vs SELL/DN at active candle + stepped targets
      const lastBarVis = liveCandles.length - 1 - startIdx;
      if (indicatorConfig.showProb && lastBarVis >= 0 && lastBarVis < totalSlots) {
        const curBar = liveCandles[liveCandles.length - 1];
        const xStart = idxToX(lastBarVis);
        const xEnd = w - padRight - 2;
        const drawnLabelYs: number[] = [];
        const canPlaceLabel = (yPos: number) =>
          drawnLabelYs.every((prevY) => Math.abs(prevY - yPos) >= 14);

        ctx.save();
        // Primary candle High (UP/BUY) & Low (DN/SELL) breakout lines + clear signal badges
        const drawPrimaryCandleProb = (
          price: number,
          isUp: boolean,
          pct: number,
          isWinningBias: boolean
        ) => {
          const y = priceToY(price);
          if (y < padTop + 14 || y > h - padBottom - 4) return;
          const clr = isUp ? '#4CAF50' : '#F23645';
          ctx.strokeStyle = clr;
          ctx.lineWidth = isWinningBias ? 2 : 1.4;
          ctx.beginPath();
          ctx.moveTo(xStart, y);
          ctx.lineTo(xEnd, y);
          ctx.stroke();

          const prefix = isWinningBias ? (isUp ? 'BUY ▲' : 'SELL ▼') : isUp ? '▲ UP' : '▼ DN';
          const text = `${prefix} ${pct.toFixed(1)}%`;
          ctx.font = isWinningBias
            ? 'bold 10px "Trebuchet MS", "JetBrains Mono", sans-serif'
            : '600 10px "Trebuchet MS", "JetBrains Mono", sans-serif';
          const textW = ctx.measureText(text).width;
          const labelX = Math.min(xEnd - textW - 8, idxToX(lastBarVis + 1));
          const labelY = isUp ? y - 16 : y + 3;

          if (isWinningBias) {
            ctx.fillStyle = clr;
            ctx.fillRect(labelX - 4, labelY, textW + 8, 14);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(text, labelX, labelY + 11);
          } else {
            ctx.fillStyle = tvDark ? 'rgba(19, 23, 34, 0.9)' : isDark ? 'rgba(11, 16, 25, 0.9)' : 'rgba(255, 255, 255, 0.92)';
            ctx.fillRect(labelX - 3, labelY, textW + 6, 13);
            ctx.fillStyle = clr;
            ctx.fillText(text, labelX, labelY + 10);
          }
          drawnLabelYs.push(labelY + 7);
        };

        if (asimData.nextBarUpPct > 0 || asimData.nextBarDnPct > 0) {
          drawPrimaryCandleProb(
            curBar.high,
            true,
            asimData.nextBarUpPct,
            asimData.predictedBias === 'BUY'
          );
          drawPrimaryCandleProb(
            curBar.low,
            false,
            asimData.nextBarDnPct,
            asimData.predictedBias === 'SELL'
          );
        }

        // Exact MQL5 Breakout Probability levels (STYLE_SOLID, width 2)
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.font = '600 9.5px "Trebuchet MS", "JetBrains Mono", sans-serif';
        for (const pl of asimData.probLevels) {
          const y = priceToY(pl.level);
          if (y < padTop + 14 || y > h - padBottom - 10) continue;
          if (!canPlaceLabel(y - 6)) continue;
          const clr = pl.isUpper ? '#4CAF50' : '#F23645';
          ctx.strokeStyle = clr;
          ctx.beginPath();
          ctx.moveTo(xStart, y);
          ctx.lineTo(xEnd, y);
          ctx.stroke();

          const labelText = ` ${pl.pct.toFixed(2)}%`;
          const textW = ctx.measureText(labelText).width;
          const labelX = Math.min(xEnd - textW - 4, idxToX(lastBarVis + 1));
          ctx.fillStyle = tvDark ? 'rgba(19, 23, 34, 0.85)' : isDark ? 'rgba(11, 16, 25, 0.85)' : 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(labelX - 2, y - 12, textW + 4, 11);
          ctx.fillStyle = clr;
          ctx.fillText(labelText, labelX, y - 3);
          drawnLabelYs.push(y - 6);
        }
        ctx.restore();
      }
    }

    // Optional external bridge indicator overlay (if any)
    if (indicatorConfig.enabled && indicatorOverlay) {
      for (const line of indicatorOverlay.lines) {
        ctx.save();
        ctx.strokeStyle = line.color || '#F59E0B';
        ctx.lineWidth = line.width || 1.6;
        ctx.beginPath();
        let started = false;
        for (const pt of line.points) {
          const idx = timeToVisIdx.get(pt.time);
          if (idx === undefined) continue;
          const x = idxToX(idx);
          const y = priceToY(pt.value);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();

    // Position entry, SL, and TP horizontal lines
    for (const pos of symbolPositions) {
      const drawOrderLine = (price: number, color: string, label: string) => {
        const y = priceToY(price);
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(w - padRight, y);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = color;
        ctx.fillRect(padLeft + 6, y - 9, 126, 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(label, padLeft + 10, y + 2);
      };

      drawOrderLine(
        pos.openPrice,
        pos.side === 'BUY' ? '#2563EB' : '#D97706',
        `${pos.side} ${pos.lots.toFixed(2)} #${pos.externalTicket || pos.ticket}`
      );
      if (pos.sl !== null) drawOrderLine(pos.sl, '#DC2626', `SL ${pos.sl.toFixed(digits)}`);
      if (pos.tp !== null) drawOrderLine(pos.tp, '#16A34A', `TP ${pos.tp.toFixed(digits)}`);
    }

    // Current Bid line + price tag
    if (quote) {
      const bidY = priceToY(quote.bid);
      ctx.save();
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, bidY);
      ctx.lineTo(w - padRight, bidY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#2563EB';
      ctx.fillRect(w - padRight + 2, bidY - 9, padRight - 4, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillText(quote.bid.toFixed(digits), w - padRight + 6, bidY + 4);
    }

    // 6) Compact WIN / LOSS / Profitability box (top-left inside chart area so live candles stay clear)
    const showStatsBox = Boolean(indicatorConfig.enabled && indicatorConfig.showBox && asimData?.ready);
    const statsBoxW = 168;
    const statsBoxH = 52;
    if (showStatsBox && asimData) {
      const boxX = padLeft + 6;
      const boxY = padTop + 4;

      ctx.save();
      ctx.fillStyle = 'rgba(27, 31, 43, 0.88)';
      ctx.strokeStyle = '#787B86';
      ctx.lineWidth = 1;
      ctx.fillRect(boxX, boxY, statsBoxW, statsBoxH);
      ctx.strokeRect(boxX, boxY, statsBoxW, statsBoxH);

      ctx.font = '600 9.5px "Trebuchet MS", "JetBrains Mono", sans-serif';
      ctx.fillStyle = '#4CAF50';
      ctx.fillText(`WIN: ${asimData.wins}`, boxX + 8, boxY + 14);

      ctx.fillStyle = '#F23645';
      ctx.fillText(`LOSS: ${asimData.losses}`, boxX + 78, boxY + 14);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(
        `Profitability: ${asimData.profitability.toFixed(2)}%`,
        boxX + 8,
        boxY + 29
      );

      const biasColor =
        asimData.predictedBias === 'BUY'
          ? '#4CAF50'
          : asimData.predictedBias === 'SELL'
            ? '#F23645'
            : '#D1D4DC';
      ctx.fillStyle = biasColor;
      ctx.fillText(
        `${asimData.predictedBias} ▲${asimData.nextBarUpPct.toFixed(1)}% / ▼${asimData.nextBarDnPct.toFixed(1)}%`,
        boxX + 8,
        boxY + 44
      );
      ctx.restore();
    }

    // Hover crosshair (vertical + horizontal + axis tags)
    if (hoverInfo && hoverInfo.x >= padLeft && hoverInfo.x <= w - padRight && hoverInfo.y >= padTop && hoverInfo.y <= h - padBottom) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = isDark ? 'rgba(226, 232, 240, 0.35)' : 'rgba(15, 23, 42, 0.3)';
      ctx.lineWidth = 1;
      // Horizontal crosshair
      ctx.beginPath();
      ctx.moveTo(padLeft, hoverInfo.y);
      ctx.lineTo(w - padRight, hoverInfo.y);
      ctx.stroke();

      // Right price axis badge
      const hoverPrice = yToPrice(hoverInfo.y);
      ctx.fillStyle = isDark ? '#334155' : '#0F172A';
      ctx.fillRect(w - padRight + 2, hoverInfo.y - 9, padRight - 4, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(hoverPrice.toFixed(digits), w - padRight + 6, hoverInfo.y + 3.5);

      if (hoverInfo.idx !== null && hoverInfo.idx >= 0 && hoverInfo.idx < slice.length) {
        const c = slice[hoverInfo.idx];
        const x = idxToX(hoverInfo.idx);
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, h - padBottom);
        ctx.stroke();
        ctx.restore();

        const dt = new Date(c.time * 1000);
        const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        ctx.fillStyle = isDark ? '#334155' : '#0F172A';
        ctx.fillRect(Math.max(padLeft, x - 22), h - padBottom + 2, 44, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(timeStr, Math.max(padLeft + 4, x - 16), h - padBottom + 14);

        const ohlcX = showStatsBox ? padLeft + statsBoxW + 14 : padLeft + 6;
        const ohlcW = Math.min(340, Math.max(200, w - padRight - ohlcX - 6));
        if (ohlcW >= 220) {
          ctx.fillStyle = isDark ? 'rgba(19, 23, 34, 0.92)' : 'rgba(241, 245, 249, 0.95)';
          ctx.fillRect(ohlcX, padTop + 4, ohlcW, 20);
          ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
          ctx.font = '10.5px "JetBrains Mono", monospace';
          ctx.fillText(
            `O ${c.open.toFixed(digits)} H ${c.high.toFixed(digits)} L ${c.low.toFixed(digits)} C ${c.close.toFixed(digits)}`,
            ohlcX + 6,
            padTop + 17
          );
        }
      } else {
        ctx.restore();
      }
    }
  }, [
    asimData,
    dimensions,
    hoverInfo,
    indicatorConfig,
    indicatorOverlay,
    liveCandles,
    panOffset,
    positions,
    priceOffsetRatio,
    priceScaleMult,
    quote,
    symbol,
    visibleBarsCount,
  ]);

  // Attach non-passive wheel listener so mouse-wheel zoom never scrolls the outer page
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.88;
      setVisibleBarsCount((prev) =>
        Math.max(20, Math.min(260, Math.round(prev * factor)))
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const resetChartView = () => {
    setVisibleBarsCount(80);
    setPanOffset(0);
    setPriceScaleMult(1.0);
    setPriceOffsetRatio(0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const isPriceAxis = localX > dimensions.width - 76;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = {
      active: true,
      mode: isPriceAxis ? 'price_scale' : 'pan',
      startX: e.clientX,
      startY: e.clientY,
      startPan: panOffset,
      startPriceOffset: priceOffsetRatio,
      startPriceScale: priceScaleMult,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const padLeft = 10;
    const padRight = 76;
    const chartW = dimensions.width - padLeft - padRight;
    const chartH = Math.max(120, dimensions.height - 38);

    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (dragRef.current.mode === 'price_scale') {
        const nextScale = Math.max(0.35, Math.min(3.5, dragRef.current.startPriceScale * (1 - dy / 180)));
        setPriceScaleMult(nextScale);
      } else {
        const visibleCandles = Math.min(liveCandles.length, Math.max(20, visibleBarsCount));
        const futureMarginBars = dragRef.current.startPan === 0 ? 10 : 0;
        const step = chartW / Math.max(1, visibleCandles + futureMarginBars);
        const deltaBars = Math.round(dx / Math.max(3, step));
        const maxPan = Math.max(0, liveCandles.length - visibleCandles);
        setPanOffset(Math.max(0, Math.min(maxPan, dragRef.current.startPan + deltaBars)));
        setPriceOffsetRatio(
          Math.max(-2.5, Math.min(2.5, dragRef.current.startPriceOffset + dy / chartH))
        );
      }
    }

    const visibleCandles = Math.min(liveCandles.length, Math.max(20, visibleBarsCount));
    const maxPan = Math.max(0, liveCandles.length - visibleCandles);
    const clampedPan = Math.max(0, Math.min(maxPan, Math.round(panOffset)));
    const futureMarginBars = clampedPan === 0 ? 10 : 0;
    const totalSlots = visibleCandles + futureMarginBars;
    const x = rawX - padLeft;
    if (x < 0 || x > chartW || visibleCandles === 0) {
      setHoverInfo({ idx: null, x: rawX, y: rawY });
      return;
    }
    const idx = Math.floor((x / chartW) * totalSlots);
    setHoverInfo({
      idx: idx >= 0 && idx < visibleCandles ? idx : null,
      x: rawX,
      y: rawY,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.active) {
      dragRef.current.active = false;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
    }
  };

  return (
    <section className="flex flex-col h-full bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden relative">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-xs">
          <span className="text-sm font-bold text-slate-900 dark:text-white">{symbol}</span>
          <span className="text-slate-400" aria-hidden="true">·</span>
          <span className="text-slate-500 dark:text-slate-400">{quote?.description || 'Market Feed'}</span>
          {quote && (
            <>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                Bid {quote.bid.toFixed(quote.digits)} / Ask {quote.ask.toFixed(quote.digits)}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center bg-slate-100 dark:bg-[#0B0F17] p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setVisibleBarsCount((v) => Math.max(20, Math.round(v * 0.8)))}
              title="Zoom In"
              className="p-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setVisibleBarsCount((v) => Math.min(260, Math.round(v * 1.25)))}
              title="Zoom Out"
              className="p-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={resetChartView}
              title="Reset & Snap to Latest Live Candle"
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded cursor-pointer ${
                panOffset > 0 || Math.abs(priceOffsetRatio) > 0.01 || Math.abs(priceScaleMult - 1) > 0.05
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LocateFixed className="w-3 h-3" />
              Live
            </button>
          </div>

          <button
            type="button"
            onClick={() => onUpdateIndicatorConfig({ enabled: !indicatorConfig.enabled })}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              indicatorConfig.enabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
            }`}
            title="Toggle TL + Prob + Alligator Indicator ON/OFF"
          >
            <Power className="w-3 h-3" />
            TL + Prob + Alligator: {indicatorConfig.enabled ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() => setShowIndicatorSettings((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              showIndicatorSettings
                ? 'border-blue-500/40 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
            title="Indicator Inputs & Visual Settings"
          >
            <SlidersHorizontal className="w-3 h-3" />
            Settings
          </button>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#0B0F17] p-0.5 rounded-md border border-slate-200 dark:border-slate-800">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-1 text-[11px] font-mono font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  timeframe === tf
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showIndicatorSettings && (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E141F] space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              Asim TV TL + Prob + Alligator (Active by Default)
            </div>
            <button
              type="button"
              onClick={onResetIndicatorConfig}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Defaults
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.applyTvTheme}
                onChange={(e) => onUpdateIndicatorConfig({ applyTvTheme: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>TV Dark Theme</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showTL}
                onChange={(e) => onUpdateIndicatorConfig({ showTL: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Trendlines + B</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showExt}
                onChange={(e) => onUpdateIndicatorConfig({ showExt: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Extended Rays</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.backpaint}
                onChange={(e) => onUpdateIndicatorConfig({ backpaint: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Backpainting</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showProb}
                onChange={(e) => onUpdateIndicatorConfig({ showProb: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Breakout Prob</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.hideZero}
                onChange={(e) => onUpdateIndicatorConfig({ hideZero: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Hide 0.00%</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showAlli}
                onChange={(e) => onUpdateIndicatorConfig({ showAlli: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Alligator</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showFrac}
                onChange={(e) => onUpdateIndicatorConfig({ showFrac: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Fractals</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showSR}
                onChange={(e) => onUpdateIndicatorConfig({ showSR: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>Support / Res</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={indicatorConfig.showBox}
                onChange={(e) => onUpdateIndicatorConfig({ showBox: e.target.checked })}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              <span>WIN/LOSS Box</span>
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">TL Lookback (L)</span>
              <input
                type="number"
                min={3}
                max={60}
                value={indicatorConfig.tlLen}
                onChange={(e) =>
                  onUpdateIndicatorConfig({ tlLen: Math.max(3, Number(e.target.value) || 14) })
                }
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">TL Slope Mult</span>
              <input
                type="number"
                step={0.1}
                min={0.1}
                max={10}
                value={indicatorConfig.tlMult}
                onChange={(e) =>
                  onUpdateIndicatorConfig({ tlMult: Math.max(0.1, Number(e.target.value) || 1.0) })
                }
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">Prob Step (%)</span>
              <input
                type="number"
                step={0.1}
                min={0.01}
                max={10}
                value={indicatorConfig.probStep}
                onChange={(e) =>
                  onUpdateIndicatorConfig({
                    probStep: Math.max(0.01, Number(e.target.value) || 1.0),
                  })
                }
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">Prob Lines (1-5)</span>
              <input
                type="number"
                min={1}
                max={5}
                value={indicatorConfig.probCount}
                onChange={(e) =>
                  onUpdateIndicatorConfig({
                    probCount: Math.max(1, Math.min(5, Number(e.target.value) || 5)),
                  })
                }
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">Alligator Opacity %</span>
              <input
                type="number"
                min={5}
                max={100}
                value={indicatorConfig.alliOpacity}
                onChange={(e) =>
                  onUpdateIndicatorConfig({
                    alliOpacity: Math.max(5, Math.min(100, Number(e.target.value) || 25)),
                  })
                }
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-slate-500">S/R Length</span>
              <input
                type="number"
                min={3}
                max={100}
                value={indicatorConfig.srLen}
                onChange={(e) =>
                  onUpdateIndicatorConfig({ srLen: Math.max(3, Number(e.target.value) || 13) })
                }
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] font-mono tabular-nums"
              />
            </label>
          </div>
        </div>
      )}

      <div ref={containerRef} className="flex-1 min-h-[260px] relative select-none">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={resetChartView}
          onMouseLeave={() => setHoverInfo(null)}
          className={`w-full h-full block touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        />
      </div>
    </section>
  );
};
