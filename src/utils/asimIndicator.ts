import type { Candle, IndicatorConfig } from '../types/trading.ts';

export const DEFAULT_ASIM_INDICATOR_CONFIG: IndicatorConfig = {
  enabled: true,
  applyTvTheme: true,
  showTL: true,
  tlLen: 14,
  tlMult: 1.0,
  backpaint: true,
  showExt: true,
  showProb: true,
  probStep: 1.0,
  probCount: 5,
  hideZero: true,
  showAlli: true,
  jawLen: 13,
  teethLen: 8,
  lipsLen: 5,
  jawOff: 8,
  teethOff: 5,
  lipsOff: 3,
  alliOpacity: 25,
  showFrac: true,
  fracN: 2,
  showSR: true,
  srLen: 13,
  showBox: true,
};

export interface BreakMarker {
  index: number;
  price: number;
}

export interface FractalMarker {
  index: number;
  price: number;
}

export interface ProbLevel {
  level: number;
  pct: number;
  isUpper: boolean;
}

export interface ExtendedRay {
  x1Index: number;
  y1: number;
  x2Index: number;
  y2: number;
}

export interface AsimIndicatorResult {
  ready: boolean;
  start: number;
  jaw: Array<number | null>;
  teeth: Array<number | null>;
  lips: Array<number | null>;
  tlu: Array<number | null>;
  tll: Array<number | null>;
  tlShift: number;
  extUpper: ExtendedRay | null;
  extLower: ExtendedRay | null;
  upBreaks: BreakMarker[];
  dnBreaks: BreakMarker[];
  srh: Array<number | null>;
  srl: Array<number | null>;
  fracUp: FractalMarker[];
  fracDn: FractalMarker[];
  probLevels: ProbLevel[];
  nextBarUpPct: number;
  nextBarDnPct: number;
  predictedBias: 'BUY' | 'SELL' | 'NEUTRAL';
  wins: number;
  losses: number;
  profitability: number;
}

export function blendHexColor(fgHex: string, bgHex: string, opacityPct: number): string {
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  const parse = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [fr, fg, fb] = parse(fgHex);
  const [br, bg, bb] = parse(bgHex);
  const r = Math.round(fr * a + br * (1 - a));
  const g = Math.round(fg * a + bg * (1 - a));
  const b = Math.round(fb * a + bb * (1 - a));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Exact TypeScript calculation port of Asim_TV_TL_Prob_Alligator.mq5:
 * - Bill Williams Alligator (Wilder RMA on hl2 + Jaw/Teeth/Lips offsets)
 * - ATR (Wilder RMA, length L)
 * - Trendlines with Breaks (LuxAlgo swing lookback L, ATR slope, backpainting, rays & B break labels)
 * - Support / Resistance (SRLen rolling high/low plateau lines)
 * - Fractals (strict N bars each side)
 * - Breakout Probability (Zeiierman completed-bar hit probabilities + live candle levels)
 * - WIN / LOSS / Profitability statistical tracker
 */
export function computeAsimIndicator(
  candles: Candle[],
  cfg: IndicatorConfig,
  maxBars = 2000
): AsimIndicatorResult {
  const n = candles.length;
  const L = Math.max(1, Math.floor(cfg.tlLen));

  const emptyResult: AsimIndicatorResult = {
    ready: false,
    start: 0,
    jaw: [],
    teeth: [],
    lips: [],
    tlu: [],
    tll: [],
    tlShift: cfg.backpaint ? -L : 0,
    extUpper: null,
    extLower: null,
    upBreaks: [],
    dnBreaks: [],
    srh: [],
    srl: [],
    fracUp: [],
    fracDn: [],
    probLevels: [],
    nextBarUpPct: 0,
    nextBarDnPct: 0,
    predictedBias: 'NEUTRAL',
    wins: 0,
    losses: 0,
    profitability: 0,
  };

  if (n < 4 * L + 60) {
    return emptyResult;
  }

  const start = Math.max(0, n - Math.max(300, maxBars));

  const jaw: Array<number | null> = new Array(n).fill(null);
  const teeth: Array<number | null> = new Array(n).fill(null);
  const lips: Array<number | null> = new Array(n).fill(null);
  const tlu: Array<number | null> = new Array(n).fill(null);
  const tll: Array<number | null> = new Array(n).fill(null);
  const srh: Array<number | null> = new Array(n).fill(null);
  const srl: Array<number | null> = new Array(n).fill(null);

  // ---- 1. Alligator: Wilder smoothing (RMA) of hl2
  if (cfg.showAlli) {
    const lens = [
      Math.max(1, Math.floor(cfg.jawLen)),
      Math.max(1, Math.floor(cfg.teethLen)),
      Math.max(1, Math.floor(cfg.lipsLen)),
    ];
    for (let a = 0; a < 3; a++) {
      const len = lens[a];
      let sum = 0;
      let prev = 0;
      for (let i = start; i < n; i++) {
        const src = (candles[i].high + candles[i].low) / 2;
        let v: number | null = null;
        if (i - start < len - 1) {
          sum += src;
        } else if (i - start === len - 1) {
          sum += src;
          v = sum / len;
          prev = v;
        } else {
          v = (prev * (len - 1) + src) / len;
          prev = v;
        }
        if (a === 0) jaw[i] = v;
        else if (a === 1) teeth[i] = v;
        else lips[i] = v;
      }
    }
  }

  // ---- 2. ATR (Wilder, length L) for trendline slope and label offsets
  const atr = new Array<number>(n).fill(0);
  {
    let sum = 0;
    let prev = 0;
    for (let i = start; i < n; i++) {
      let tr = candles[i].high - candles[i].low;
      if (i > start) {
        tr = Math.max(
          tr,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close)
        );
      }
      if (i - start < L - 1) {
        sum += tr;
      } else if (i - start === L - 1) {
        sum += tr;
        prev = sum / L;
        atr[i] = prev;
      } else {
        prev = (prev * (L - 1) + tr) / L;
        atr[i] = prev;
      }
    }
  }

  // ---- 3. Trendlines with Breaks (LuxAlgo)
  const upBreakIdx: number[] = [];
  const dnBreakIdx: number[] = [];
  let lastPhBar = -1;
  let lastPlBar = -1;
  let lastPh = 0;
  let lastPl = 0;
  let lastSlPh = 0;
  let lastSlPl = 0;

  if (cfg.showTL) {
    let upper = 0;
    let lower = 0;
    let slPh = 0;
    let slPl = 0;
    let upS = 0;
    let dnS = 0;
    let haveH = false;
    let haveL = false;

    for (let i = start + 2 * L; i < n; i++) {
      const k = i - L;
      let isPh = true;
      let isPl = true;
      for (let j = k - L; j <= k + L; j++) {
        if (j === k) continue;
        if (candles[j].high > candles[k].high) isPh = false;
        if (candles[j].low < candles[k].low) isPl = false;
      }

      const slope = (atr[i] / L) * cfg.tlMult;
      if (isPh) {
        slPh = slope;
        upper = candles[k].high;
        haveH = true;
        lastPhBar = i;
        lastPh = candles[k].high;
        lastSlPh = slope;
      } else {
        upper -= slPh;
      }

      if (isPl) {
        slPl = slope;
        lower = candles[k].low;
        haveL = true;
        lastPlBar = i;
        lastPl = candles[k].low;
        lastSlPl = slope;
      } else {
        lower += slPl;
      }

      const pU = upS;
      const pD = dnS;
      if (isPh) upS = 0;
      else if (haveH && candles[i].close > upper - slPh * L) upS = 1;

      if (isPl) dnS = 0;
      else if (haveL && candles[i].close < lower + slPl * L) dnS = 1;

      if (upS > pU) upBreakIdx.push(i);
      if (dnS > pD) dnBreakIdx.push(i);

      if (haveH && !isPh) tlu[i] = cfg.backpaint ? upper : upper - slPh * L;
      if (haveL && !isPl) tll[i] = cfg.backpaint ? lower : lower + slPl * L;
    }
  }

  const off = cfg.backpaint ? L : 0;
  let extUpper: ExtendedRay | null = null;
  let extLower: ExtendedRay | null = null;
  if (cfg.showTL && cfg.showExt && lastPhBar >= 0) {
    const x1 = lastPhBar - off;
    const x2 = x1 + 1;
    const y1 = cfg.backpaint ? lastPh : lastPh - lastSlPh * L;
    const y2 = cfg.backpaint ? lastPh - lastSlPh : lastPh - lastSlPh * (L + 1);
    extUpper = { x1Index: x1, y1, x2Index: x2, y2 };
  }
  if (cfg.showTL && cfg.showExt && lastPlBar >= 0) {
    const x1 = lastPlBar - off;
    const x2 = x1 + 1;
    const y1 = cfg.backpaint ? lastPl : lastPl + lastSlPl * L;
    const y2 = cfg.backpaint ? lastPl + lastSlPl : lastPl + lastSlPl * (L + 1);
    extLower = { x1Index: x1, y1, x2Index: x2, y2 };
  }

  const upBreaks: BreakMarker[] = upBreakIdx
    .slice(Math.max(0, upBreakIdx.length - 60))
    .map((idx) => ({
      index: idx,
      price: candles[idx].low - atr[idx] * 0.8,
    }));

  const dnBreaks: BreakMarker[] = dnBreakIdx
    .slice(Math.max(0, dnBreakIdx.length - 60))
    .map((idx) => ({
      index: idx,
      price: candles[idx].high + atr[idx] * 0.8,
    }));

  // ---- 4. Support / Resistance
  if (cfg.showSR) {
    const sl = Math.max(1, Math.floor(cfg.srLen));
    let curH = 0;
    let curL = 0;
    let prevH = 0;
    let prevL = 0;
    let init = false;
    for (let i = start + sl; i < n; i++) {
      let hh = candles[i].high;
      let ll = candles[i].low;
      for (let j = i - sl + 1; j <= i; j++) {
        if (candles[j].high > hh) hh = candles[j].high;
        if (candles[j].low < ll) ll = candles[j].low;
      }
      if (candles[i].high >= hh) curH = candles[i].high;
      if (candles[i].low <= ll) curL = candles[i].low;
      if (!init) {
        prevH = curH;
        prevL = curL;
        init = true;
      }
      if (curH === prevH) srh[i] = curH;
      if (curL === prevL) srl[i] = curL;
      prevH = curH;
      prevL = curL;
    }
  }

  // ---- 5. Fractals (strict N bars each side), plotted on the pivot bar
  const fracUp: FractalMarker[] = [];
  const fracDn: FractalMarker[] = [];
  if (cfg.showFrac) {
    const N = Math.max(2, Math.floor(cfg.fracN));
    for (let k = start + N; k < n - N; k++) {
      let up = true;
      let dn = true;
      for (let j = 1; j <= N; j++) {
        if (!(candles[k].high > candles[k - j].high && candles[k].high > candles[k + j].high)) {
          up = false;
        }
        if (!(candles[k].low < candles[k - j].low && candles[k].low < candles[k + j].low)) {
          dn = false;
        }
      }
      if (up) fracUp.push({ index: k, price: candles[k].high });
      if (dn) fracDn.push({ index: k, price: candles[k].low });
    }
  }

  // ---- 6. Breakout Probability (completed bars only, exact MQL5 logic)
  const probStep = Math.max(0.001, cfg.probStep || 1.0);
  const hits = new Array<number>(20).fill(0);
  let greenCnt = 0;
  let redCnt = 0;
  for (let j = start + 1; j <= n - 2; j++) {
    const prevBar = candles[j - 1];
    const bar = candles[j];
    const pg = prevBar.close > prevBar.open;
    const pr = prevBar.close < prevBar.open;
    if (pg) greenCnt++;
    if (pr) redCnt++;
    for (let s = 0; s < 5; s++) {
      const st = ((prevBar.close * probStep) / 100.0) * (s + 1);
      if (pg && bar.high >= prevBar.high + st) hits[s * 4 + 0]++;
      if (pg && bar.low <= prevBar.low - st) hits[s * 4 + 1]++;
      if (pr && bar.high >= prevBar.high + st) hits[s * 4 + 2]++;
      if (pr && bar.low <= prevBar.low - st) hits[s * 4 + 3]++;
    }
  }

  const probLevels: ProbLevel[] = [];
  if (cfg.showProb) {
    const cur = candles[n - 1];
    const wasGreen = cur.close > cur.open;
    const denom = wasGreen ? greenCnt : redCnt;
    const upIdx = wasGreen ? 0 : 2;
    const dnIdx = wasGreen ? 1 : 3;
    const cnt = Math.max(1, Math.min(5, Math.floor(cfg.probCount)));
    for (let s = 0; s < cnt; s++) {
      const dist = ((cur.close * probStep) / 100.0) * (s + 1);
      for (let side = 0; side < 2; side++) {
        const isUpper = side === 0;
        const level = isUpper ? cur.high + dist : cur.low - dist;
        const pct = denom > 0 ? (100.0 * hits[s * 4 + (isUpper ? upIdx : dnIdx)]) / denom : 0.0;
        if (!cfg.hideZero || pct > 0) {
          probLevels.push({ level, pct, isUpper });
        }
      }
    }
  }

  // ---- 7. WIN / LOSS statistics + current candle UP/DOWN directional probability
  let wins = 0;
  let losses = 0;
  const tot = [0, 0];
  const upc = [0, 0];
  const dnc = [0, 0];
  {
    for (let c = start; c <= n - 3; c++) {
      const col = candles[c].close >= candles[c].open ? 1 : 0;
      const hitUp = candles[c + 1].high > candles[c].high;
      const hitDn = candles[c + 1].low < candles[c].low;
      if (tot[col] >= 20) {
        const pu = upc[col] / tot[col];
        const pd = dnc[col] / tot[col];
        if (pu !== pd) {
          const predUp = pu > pd;
          if ((predUp && hitUp) || (!predUp && hitDn)) wins++;
          else losses++;
        }
      }
      tot[col]++;
      if (hitUp) upc[col]++;
      if (hitDn) dnc[col]++;
    }
  }

  const curBar = candles[n - 1];
  const curCol = curBar.close >= curBar.open ? 1 : 0;
  const curDenom = tot[curCol];
  const nextBarUpPct = curDenom > 0 ? (100.0 * upc[curCol]) / curDenom : 0;
  const nextBarDnPct = curDenom > 0 ? (100.0 * dnc[curCol]) / curDenom : 0;
  const predictedBias: 'BUY' | 'SELL' | 'NEUTRAL' =
    curDenom >= 20 && nextBarUpPct !== nextBarDnPct
      ? nextBarUpPct > nextBarDnPct
        ? 'BUY'
        : 'SELL'
      : 'NEUTRAL';

  const totalWL = wins + losses;
  const profitability = totalWL > 0 ? (100.0 * wins) / totalWL : 0.0;

  return {
    ready: true,
    start,
    jaw,
    teeth,
    lips,
    tlu,
    tll,
    tlShift: cfg.backpaint ? -L : 0,
    extUpper,
    extLower,
    upBreaks,
    dnBreaks,
    srh,
    srl,
    fracUp,
    fracDn,
    probLevels,
    nextBarUpPct,
    nextBarDnPct,
    predictedBias,
    wins,
    losses,
    profitability,
  };
}
