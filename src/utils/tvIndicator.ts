import type { Candle } from '../types/trading.ts';

export interface TVIndicatorConfig {
  showTL: boolean;
  tlLen: number;
  tlMult: number;
  backpaint: boolean;
  showExt: boolean;
  showProb: boolean;
  probStep: number;
  probCount: number;
  hideZero: boolean;
  showAlligator: boolean;
  jawLen: number;
  teethLen: number;
  lipsLen: number;
  jawOff: number;
  teethOff: number;
  lipsOff: number;
  alliOpacity: number;
  showFractals: boolean;
  fracN: number;
  showSR: boolean;
  srLen: number;
  showBox: boolean;
}

export const DEFAULT_TV_INDICATOR_CONFIG: TVIndicatorConfig = {
  showTL: true,
  tlLen: 14,
  tlMult: 1.0,
  backpaint: true,
  showExt: true,
  showProb: true,
  probStep: 1.0,
  probCount: 5,
  hideZero: true,
  showAlligator: true,
  jawLen: 13,
  teethLen: 8,
  lipsLen: 5,
  jawOff: 8,
  teethOff: 5,
  lipsOff: 3,
  alliOpacity: 25,
  showFractals: true,
  fracN: 2,
  showSR: true,
  srLen: 13,
  showBox: true,
};

export interface BreakMarker {
  index: number;
  price: number;
  direction: 'UP' | 'DOWN';
}

export interface ExtendedTrendline {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'UP' | 'DOWN';
}

export interface ProbabilityLevel {
  side: 'UP' | 'DOWN';
  price: number;
  pct: number;
  stepIndex: number;
}

export interface TVIndicatorOutput {
  jaw: Array<number | null>;
  teeth: Array<number | null>;
  lips: Array<number | null>;
  tlu: Array<number | null>;
  tll: Array<number | null>;
  srh: Array<number | null>;
  srl: Array<number | null>;
  fractalUp: Array<number | null>;
  fractalDown: Array<number | null>;
  breakMarkers: BreakMarker[];
  extUpper: ExtendedTrendline | null;
  extLower: ExtendedTrendline | null;
  probLevels: ProbabilityLevel[];
  wins: number;
  losses: number;
  profitability: number;
}

export function computeTVIndicator(
  candles: Candle[],
  cfg: TVIndicatorConfig
): TVIndicatorOutput {
  const n = candles.length;
  const L = Math.max(1, cfg.tlLen);

  const jaw: Array<number | null> = new Array(n).fill(null);
  const teeth: Array<number | null> = new Array(n).fill(null);
  const lips: Array<number | null> = new Array(n).fill(null);
  const tlu: Array<number | null> = new Array(n).fill(null);
  const tll: Array<number | null> = new Array(n).fill(null);
  const srh: Array<number | null> = new Array(n).fill(null);
  const srl: Array<number | null> = new Array(n).fill(null);
  const fractalUp: Array<number | null> = new Array(n).fill(null);
  const fractalDown: Array<number | null> = new Array(n).fill(null);
  const breakMarkers: BreakMarker[] = [];

  if (n < 30) {
    return {
      jaw,
      teeth,
      lips,
      tlu,
      tll,
      srh,
      srl,
      fractalUp,
      fractalDown,
      breakMarkers,
      extUpper: null,
      extLower: null,
      probLevels: [],
      wins: 0,
      losses: 0,
      profitability: 0,
    };
  }

  // 1. Bill Williams Alligator (Wilder RMA of hl2)
  if (cfg.showAlligator) {
    const lens = [
      Math.max(1, cfg.jawLen),
      Math.max(1, cfg.teethLen),
      Math.max(1, cfg.lipsLen),
    ];
    const bufs = [jaw, teeth, lips];
    for (let a = 0; a < 3; a++) {
      const len = lens[a];
      let sum = 0;
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const src = (candles[i].high + candles[i].low) / 2;
        if (i < len - 1) {
          sum += src;
        } else if (i === len - 1) {
          sum += src;
          prev = sum / len;
          bufs[a][i] = prev;
        } else {
          prev = (prev * (len - 1) + src) / len;
          bufs[a][i] = prev;
        }
      }
    }
  }

  // 2. Wilder ATR (length L) for trendline slope & break label offsets
  const atr: number[] = new Array(n).fill(0);
  {
    let sum = 0;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let tr = candles[i].high - candles[i].low;
      if (i > 0) {
        tr = Math.max(
          tr,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close)
        );
      }
      if (i < L - 1) {
        sum += tr;
      } else if (i === L - 1) {
        sum += tr;
        prev = sum / L;
        atr[i] = prev;
      } else {
        prev = (prev * (L - 1) + tr) / L;
        atr[i] = prev;
      }
    }
  }

  // 3. Trendlines with Breaks (LuxAlgo)
  let extUpper: ExtendedTrendline | null = null;
  let extLower: ExtendedTrendline | null = null;

  if (cfg.showTL && n > 2 * L + 2) {
    let upper = 0;
    let lower = 0;
    let slPh = 0;
    let slPl = 0;
    let upS = 0;
    let dnS = 0;
    let haveH = false;
    let haveL = false;
    let lastPhBar = -1;
    let lastPlBar = -1;
    let lastPh = 0;
    let lastPl = 0;
    let lastSlPh = 0;
    let lastSlPl = 0;

    for (let i = 2 * L; i < n; i++) {
      const k = i - L;
      let isPh = true;
      let isPl = true;
      for (let j = k - L; j <= k + L; j++) {
        if (j === k || j < 0 || j >= n) continue;
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

      if (upS > pU) {
        breakMarkers.push({
          index: i,
          price: candles[i].low - atr[i] * 0.8,
          direction: 'UP',
        });
      }
      if (dnS > pD) {
        breakMarkers.push({
          index: i,
          price: candles[i].high + atr[i] * 0.8,
          direction: 'DOWN',
        });
      }

      const targetIdx = cfg.backpaint ? i - L : i;
      if (targetIdx >= 0 && targetIdx < n) {
        if (haveH && !isPh) {
          tlu[targetIdx] = cfg.backpaint ? upper : upper - slPh * L;
        }
        if (haveL && !isPl) {
          tll[targetIdx] = cfg.backpaint ? lower : lower + slPl * L;
        }
      }
    }

    if (cfg.showExt) {
      const off = cfg.backpaint ? L : 0;
      if (lastPhBar >= 0) {
        const x1 = lastPhBar - off;
        const x2 = x1 + 1;
        const y1 = cfg.backpaint ? lastPh : lastPh - lastSlPh * L;
        const y2 = cfg.backpaint ? lastPh - lastSlPh : lastPh - lastSlPh * (L + 1);
        extUpper = { x1, y1, x2, y2, direction: 'UP' };
      }
      if (lastPlBar >= 0) {
        const x1 = lastPlBar - off;
        const x2 = x1 + 1;
        const y1 = cfg.backpaint ? lastPl : lastPl + lastSlPl * L;
        const y2 = cfg.backpaint ? lastPl + lastSlPl : lastPl + lastSlPl * (L + 1);
        extLower = { x1, y1, x2, y2, direction: 'DOWN' };
      }
    }
  }

  // 4. Support / Resistance
  if (cfg.showSR) {
    const sl = Math.max(1, cfg.srLen);
    let curH = 0;
    let curL = 0;
    let prevH = 0;
    let prevL = 0;
    let init = false;
    for (let i = sl; i < n; i++) {
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

  // 5. Fractals (strict N bars each side)
  if (cfg.showFractals) {
    const N = Math.max(2, cfg.fracN);
    for (let k = N; k < n - N; k++) {
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
      if (up) fractalUp[k] = candles[k].high;
      if (dn) fractalDown[k] = candles[k].low;
    }
  }

  // 6. Breakout Probability (Zeiierman)
  const hits = new Array<number>(20).fill(0);
  let greenCnt = 0;
  let redCnt = 0;
  for (let j = 1; j <= n - 2; j++) {
    const prev = candles[j - 1];
    const curr = candles[j];
    const pg = prev.close > prev.open;
    const pr = prev.close < prev.open;
    if (pg) greenCnt++;
    if (pr) redCnt++;
    for (let s = 0; s < 5; s++) {
      const st = ((prev.close * cfg.probStep) / 100) * (s + 1);
      if (pg && curr.high >= prev.high + st) hits[s * 4 + 0]++;
      if (pg && curr.low <= prev.low - st) hits[s * 4 + 1]++;
      if (pr && curr.high >= prev.high + st) hits[s * 4 + 2]++;
      if (pr && curr.low <= prev.low - st) hits[s * 4 + 3]++;
    }
  }

  const probLevels: ProbabilityLevel[] = [];
  if (cfg.showProb && n > 0) {
    const last = candles[n - 1];
    const wasGreen = last.close > last.open;
    const denom = wasGreen ? greenCnt : redCnt;
    const upIdx = wasGreen ? 0 : 2;
    const dnIdx = wasGreen ? 1 : 3;
    const cnt = Math.max(1, Math.min(5, cfg.probCount));
    for (let s = 0; s < cnt; s++) {
      const dist = ((last.close * cfg.probStep) / 100) * (s + 1);
      const pctUp = denom > 0 ? (100 * hits[s * 4 + upIdx]) / denom : 0;
      const pctDn = denom > 0 ? (100 * hits[s * 4 + dnIdx]) / denom : 0;
      if (!cfg.hideZero || pctUp > 0) {
        probLevels.push({
          side: 'UP',
          price: last.high + dist,
          pct: pctUp,
          stepIndex: s,
        });
      }
      if (!cfg.hideZero || pctDn > 0) {
        probLevels.push({
          side: 'DOWN',
          price: last.low - dist,
          pct: pctDn,
          stepIndex: s,
        });
      }
    }
  }

  // 7. WIN / LOSS statistics
  let wins = 0;
  let losses = 0;
  const tot = [0, 0];
  const upc = [0, 0];
  const dnc = [0, 0];
  for (let c = 0; c <= n - 3; c++) {
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
  const totalTrades = wins + losses;
  const profitability = totalTrades > 0 ? (100 * wins) / totalTrades : 0;

  return {
    jaw,
    teeth,
    lips,
    tlu,
    tll,
    srh,
    srl,
    fractalUp,
    fractalDown,
    breakMarkers,
    extUpper,
    extLower,
    probLevels,
    wins,
    losses,
    profitability,
  };
}
