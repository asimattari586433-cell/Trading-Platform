import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountMode,
  AccountRole,
  AccountTier,
  BridgeCommand,
  Candle,
  ClosedTrade,
  ConnectionMethod,
  CopierLogEntry,
  CopierRiskRule,
  CopierSnapshot,
  CustomIndicatorOverlay,
  GlobalCopierSettings,
  LotSizingMode,
  MasterBridgeCommand,
  Position,
  SymbolQuote,
  Timeframe,
  TradeSide,
  TradingAccount,
} from '../src/types/trading.ts';
import { verifyBridgeTokenConstantTime } from './auth.ts';
import {
  deleteVaultCredential,
  hasVaultCredential,
  retrieveVaultCredential,
  storeVaultCredential,
  sweepTemporaryLaunchConfigs,
  writeEphemeralLaunchIni,
} from './vault.ts';

interface StoredAccount extends TradingAccount {
  passwordHash: string;
}

interface PersistedState {
  bridgeToken: string;
  nextTicket: number;
  settings: GlobalCopierSettings;
  accounts: StoredAccount[];
  positions: Position[];
  history: ClosedTrade[];
  logs: CopierLogEntry[];
  bridgeCommands: Record<string, BridgeCommand[]>;
  masterBridgeCommands: Record<string, MasterBridgeCommand[]>;
  processedCommandIds: string[];
  indicatorOverlays: Record<string, CustomIndicatorOverlay>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'copier-state.json');

interface SymbolSpec {
  symbol: string;
  description: string;
  digits: number;
  contractSize: number;
  pipSize: number;
  quoteCurrency: 'USD' | 'JPY';
  basePrice: number;
  spreadPoints: number;
  volatility: number;
}

const SYMBOL_SPECS: SymbolSpec[] = [
  {
    symbol: 'EURUSD',
    description: 'Euro vs US Dollar',
    digits: 5,
    contractSize: 100000,
    pipSize: 0.0001,
    quoteCurrency: 'USD',
    basePrice: 1.08425,
    spreadPoints: 8,
    volatility: 0.00018,
  },
  {
    symbol: 'GBPUSD',
    description: 'British Pound vs US Dollar',
    digits: 5,
    contractSize: 100000,
    pipSize: 0.0001,
    quoteCurrency: 'USD',
    basePrice: 1.2684,
    spreadPoints: 11,
    volatility: 0.00022,
  },
  {
    symbol: 'USDJPY',
    description: 'US Dollar vs Japanese Yen',
    digits: 3,
    contractSize: 100000,
    pipSize: 0.01,
    quoteCurrency: 'JPY',
    basePrice: 154.38,
    spreadPoints: 12,
    volatility: 0.025,
  },
  {
    symbol: 'XAUUSD',
    description: 'Gold vs US Dollar',
    digits: 2,
    contractSize: 100,
    pipSize: 0.1,
    quoteCurrency: 'USD',
    basePrice: 2684.5,
    spreadPoints: 22,
    volatility: 0.95,
  },
  {
    symbol: 'BTCUSD',
    description: 'Bitcoin vs US Dollar',
    digits: 2,
    contractSize: 1,
    pipSize: 1.0,
    quoteCurrency: 'USD',
    basePrice: 89420.0,
    spreadPoints: 1800,
    volatility: 48.0,
  },
  {
    symbol: 'US30',
    description: 'Wall Street 30 Index',
    digits: 2,
    contractSize: 1,
    pipSize: 1.0,
    quoteCurrency: 'USD',
    basePrice: 43810.0,
    spreadPoints: 160,
    volatility: 8.5,
  },
  {
    symbol: 'NAS100',
    description: 'US Tech 100 Index',
    digits: 2,
    contractSize: 1,
    pipSize: 1.0,
    quoteCurrency: 'USD',
    basePrice: 20945.0,
    spreadPoints: 110,
    volatility: 6.2,
  },
  {
    symbol: 'GBPJPY',
    description: 'British Pound vs Japanese Yen',
    digits: 3,
    contractSize: 100000,
    pipSize: 0.01,
    quoteCurrency: 'JPY',
    basePrice: 195.82,
    spreadPoints: 18,
    volatility: 0.036,
  },
];

function roundToDigits(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function cleanVolume(lots: number): number {
  if (!Number.isFinite(lots) || lots <= 0) return 0;
  return Math.round(lots * 1e8) / 1e8;
}

function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function defaultRiskRule(overrides?: Partial<CopierRiskRule>): CopierRiskRule {
  return {
    lotMode: 'multiplier',
    lotMultiplier: 1.0,
    fixedLot: 0.1,
    minLot: 0.01,
    maxLot: 50,
    copySlTp: true,
    reverseCopy: false,
    symbolPrefix: '',
    symbolSuffix: '',
    maxDrawdownPct: 15,
    maxSlippagePips: 3,
    warnOnContractMismatch: true,
    ...overrides,
  };
}

function createSeedState(): PersistedState {
  const now = new Date().toISOString();
  const masterId = 'acc-master-1';
  const masterAccount: StoredAccount = {
    id: masterId,
    label: 'Primary Signal Master',
    login: '50108421',
    server: 'Exness-MT5Trial9',
    broker: 'Exness',
    role: 'master',
    mode: 'demo',
    accountTier: 'standard',
    connectionMethod: 'sandbox',
    status: 'connected',
    copyEnabled: true,
    masterId: null,
    currency: 'USD',
    leverage: 500,
    balance: 50000,
    equity: 50000,
    margin: 0,
    freeMargin: 50000,
    floatingPnl: 0,
    dailyStartBalance: 50000,
    openTradesCount: 0,
    lastHeartbeatAt: now,
    createdAt: now,
    hasPasswordStored: true,
    passwordHash: hashSecret('demo-master-pass'),
    riskRule: defaultRiskRule(),
  };

  const followerPresets = [
    { login: '60219001', server: 'Exness-MT5Trial9', broker: 'Exness', label: 'Follower Alpha (Standard 1:1)', tier: 'standard' as AccountTier, currency: 'USD', balance: 50000, lotMode: 'multiplier' as LotSizingMode, mult: 1.0, suffix: '' },
    { login: '60219002', server: 'Exness-MT5TrialCent9', broker: 'Exness', label: 'Follower Beta (Cent 1:1 · XAUUSDc)', tier: 'cent' as AccountTier, currency: 'USC', balance: 25000, lotMode: 'multiplier' as LotSizingMode, mult: 1.0, suffix: 'c' },
    { login: '60219003', server: 'XMGlobal-MT5 3', broker: 'XM Global', label: 'Follower Gamma (Standard 1:1)', tier: 'standard' as AccountTier, currency: 'USD', balance: 15000, lotMode: 'multiplier' as LotSizingMode, mult: 1.0, suffix: '' },
    { login: '60219004', server: 'Exness-MT5Trial7', broker: 'Exness', label: 'Follower Delta (Micro m · 1:1)', tier: 'standard' as AccountTier, currency: 'USD', balance: 10000, lotMode: 'multiplier' as LotSizingMode, mult: 1.0, suffix: 'm' },
    { login: '60219005', server: 'Exness-MT5RealCent4', broker: 'Exness', label: 'Follower Epsilon (Cent 1:1)', tier: 'cent' as AccountTier, currency: 'USC', balance: 100000, lotMode: 'multiplier' as LotSizingMode, mult: 1.0, suffix: 'c' },
  ];

  const followers: StoredAccount[] = followerPresets.map((preset, idx) => ({
    id: `acc-follower-${idx + 1}`,
    label: preset.label,
    login: preset.login,
    server: preset.server,
    broker: preset.broker,
    role: 'follower',
    mode: 'demo',
    accountTier: preset.tier,
    connectionMethod: 'sandbox',
    status: 'connected',
    copyEnabled: true,
    masterId,
    currency: preset.currency,
    leverage: 500,
    balance: preset.balance,
    equity: preset.balance,
    margin: 0,
    freeMargin: preset.balance,
    floatingPnl: 0,
    dailyStartBalance: preset.balance,
    openTradesCount: 0,
    lastHeartbeatAt: now,
    createdAt: now,
    hasPasswordStored: true,
    passwordHash: hashSecret(`demo-follower-${idx + 1}`),
    riskRule: defaultRiskRule({
      lotMode: preset.lotMode,
      lotMultiplier: preset.mult,
      fixedLot: 0.05,
      symbolSuffix: preset.suffix,
    }),
  }));

  return {
    bridgeToken: `tsmt5_${crypto.randomBytes(16).toString('hex')}`,
    nextTicket: 840100,
    settings: {
      copierActive: true,
      realTradingArmed: false,
      defaultSlippagePips: 3,
      autoPauseOnDrawdown: true,
      syncPartialCloses: true,
      setupCompleted: false,
      mt5SourcePath: 'C:\\Program Files\\MetaTrader 5',
      maxConcurrentStarts: 3,
      startupDelayMs: 1800,
    },
    accounts: [masterAccount, ...followers],
    positions: [],
    history: [],
    logs: [
      {
        id: crypto.randomUUID(),
        timestamp: now,
        eventType: 'ACCOUNT_AUTH',
        masterLogin: masterAccount.login,
        symbol: 'SYSTEM',
        followersTargeted: followers.length,
        followersSucceeded: followers.length,
        followersSkipped: 0,
        avgLatencyMs: 4,
        message: `Initialized Demo Master ${masterAccount.login} linked to ${followers.length} Follower accounts. Real-money execution is locked until armed.`,
        status: 'success',
      },
    ],
    bridgeCommands: {},
    masterBridgeCommands: {},
    processedCommandIds: [],
    indicatorOverlays: {},
  };
}

export class TradeCopierEngine {
  private state: PersistedState;
  private quotes: Map<string, SymbolQuote> = new Map();
  private candles: Map<string, Candle[]> = new Map();
  private listeners: Set<(event: 'tick' | 'state_changed') => void> = new Set();
  private tickTimer: NodeJS.Timeout | null = null;
  private livePollTimer: NodeJS.Timeout | null = null;
  private lastExternalTickAt: Map<string, { at: number; source: 'LIVE_FEED' | 'MT5_BROKER' }> = new Map();
  private pendingMasterCommands: Map<string, MasterBridgeCommand> = new Map();
  private pendingFollowerCommands: Map<string, { cmd: BridgeCommand; sentAt: number }> = new Map();
  private reportedContractSizes: Map<string, number> = new Map();
  private persistPending = false;

  constructor() {
    sweepTemporaryLaunchConfigs();
    this.state = this.loadState();
    this.initMarketData();
    this.recomputeFloatingState();
    this.startMarketFeed();
    this.startLiveMarketSync();
  }

  private loadState(): PersistedState {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as PersistedState;
        if (parsed && Array.isArray(parsed.accounts) && parsed.bridgeToken) {
          parsed.settings = {
            copierActive: parsed.settings?.copierActive ?? true,
            realTradingArmed: parsed.settings?.realTradingArmed ?? false,
            defaultSlippagePips: parsed.settings?.defaultSlippagePips ?? 3,
            autoPauseOnDrawdown: parsed.settings?.autoPauseOnDrawdown ?? true,
            syncPartialCloses: parsed.settings?.syncPartialCloses ?? true,
            setupCompleted: parsed.settings?.setupCompleted ?? true,
            mt5SourcePath: parsed.settings?.mt5SourcePath || 'C:\\Program Files\\MetaTrader 5',
            maxConcurrentStarts: parsed.settings?.maxConcurrentStarts ?? 3,
            startupDelayMs: parsed.settings?.startupDelayMs ?? 1800,
          };
          parsed.masterBridgeCommands = parsed.masterBridgeCommands || {};
          parsed.processedCommandIds = parsed.processedCommandIds || [];
          parsed.indicatorOverlays = parsed.indicatorOverlays || {};
          parsed.accounts = parsed.accounts.map((acc) => {
            const legacy = acc as unknown as Record<string, unknown>;
            const { metaApiToken: _mt, metaApiAccountId: _mi, ...rest } = legacy;
            const typed = rest as unknown as StoredAccount;
            const inferredTier = this.inferAccountTier(
              typed.server,
              typed.label,
              typed.accountTier,
              typed.currency
            );
            return {
              ...typed,
              accountTier: inferredTier,
              connectionMethod:
                legacy.connectionMethod === 'sandbox' ? 'sandbox' : 'mql5_ea',
              riskRule: defaultRiskRule(typed.riskRule),
            };
          });
          return parsed;
        }
      }
    } catch (err) {
      console.error('Failed to load persisted copier state, creating fresh seed:', err);
    }
    const seeded = createSeedState();
    this.writeStateSync(seeded);
    return seeded;
  }

  private writeStateSync(target: PersistedState = this.state) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(target, null, 2), 'utf8');
    } catch (err) {
      console.error('Error persisting state:', err);
    }
  }

  private schedulePersist() {
    if (this.persistPending) return;
    this.persistPending = true;
    setTimeout(() => {
      this.persistPending = false;
      this.writeStateSync();
    }, 250);
  }

  private initMarketData() {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const spec of SYMBOL_SPECS) {
      const point = Math.pow(10, -spec.digits);
      const spread = spec.spreadPoints * point;
      const bid = roundToDigits(spec.basePrice, spec.digits);
      const ask = roundToDigits(bid + spread, spec.digits);
      this.quotes.set(spec.symbol, {
        symbol: spec.symbol,
        description: spec.description,
        digits: spec.digits,
        contractSize: spec.contractSize,
        pipSize: spec.pipSize,
        quoteCurrency: spec.quoteCurrency,
        bid,
        ask,
        spreadPoints: spec.spreadPoints,
        changePct: Number(((Math.random() - 0.45) * 1.1).toFixed(2)),
        high: roundToDigits(bid + spec.volatility * 14, spec.digits),
        low: roundToDigits(bid - spec.volatility * 14, spec.digits),
        updatedAt: new Date().toISOString(),
        feedSource: 'SIMULATED',
      });

      const timeframes: Array<{ tf: Timeframe; sec: number }> = [
        { tf: 'M1', sec: 60 },
        { tf: 'M5', sec: 300 },
        { tf: 'M15', sec: 900 },
        { tf: 'H1', sec: 3600 },
        { tf: 'H4', sec: 14400 },
      ];

      for (const { tf, sec } of timeframes) {
        const list: Candle[] = [];
        let cursorPrice = spec.basePrice - spec.volatility * 12;
        const count = 320;
        const alignedNow = Math.floor(nowSec / sec) * sec;
        const scale = Math.sqrt(sec / 60);
        for (let i = count - 1; i >= 0; i--) {
          const time = alignedNow - i * sec;
          const drift = (spec.basePrice - cursorPrice) * 0.04;
          const delta = (Math.random() - 0.49) * spec.volatility * scale * 2.2 + drift;
          const open = roundToDigits(cursorPrice, spec.digits);
          const close = i === 0 ? bid : roundToDigits(open + delta, spec.digits);
          const wickUp = Math.random() * spec.volatility * scale * 1.3;
          const wickDown = Math.random() * spec.volatility * scale * 1.3;
          const high = roundToDigits(Math.max(open, close) + wickUp, spec.digits);
          const low = roundToDigits(Math.min(open, close) - wickDown, spec.digits);
          list.push({
            time,
            open,
            high,
            low,
            close,
            volume: Math.floor(80 + Math.random() * 420),
          });
          cursorPrice = close;
        }
        this.candles.set(`${spec.symbol}:${tf}`, list);
      }
    }
  }

  private applyQuoteUpdate(
    symbol: string,
    nextBid: number,
    nextAsk: number,
    source: 'SIMULATED' | 'LIVE_FEED' | 'MT5_BROKER'
  ) {
    const spec = SYMBOL_SPECS.find((s) => s.symbol === symbol);
    const prev = this.quotes.get(symbol);
    if (!spec || !prev) return;

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const nowIso = new Date(nowMs).toISOString();
    const point = Math.pow(10, -spec.digits);
    const cleanBid = roundToDigits(nextBid, spec.digits);
    const firstLiveRebase = source !== 'SIMULATED' && prev.feedSource === 'SIMULATED';
    if (firstLiveRebase) {
      spec.basePrice = cleanBid;
    }

    const cleanAsk = roundToDigits(Math.max(cleanBid + point, nextAsk), spec.digits);
    const spreadPoints = Math.max(1, Math.round((cleanAsk - cleanBid) / point));
    const pctFromBase = ((cleanBid - spec.basePrice) / spec.basePrice) * 100;

    this.quotes.set(symbol, {
      ...prev,
      bid: cleanBid,
      ask: cleanAsk,
      spreadPoints,
      changePct: Number(pctFromBase.toFixed(2)),
      high: firstLiveRebase ? roundToDigits(cleanBid + spec.volatility * 6, spec.digits) : Math.max(prev.high, cleanBid),
      low: firstLiveRebase ? roundToDigits(cleanBid - spec.volatility * 6, spec.digits) : Math.min(prev.low, cleanBid),
      updatedAt: nowIso,
      feedSource: source,
    });

    const tfs: Array<{ tf: Timeframe; sec: number }> = [
      { tf: 'M1', sec: 60 },
      { tf: 'M5', sec: 300 },
      { tf: 'M15', sec: 900 },
      { tf: 'H1', sec: 3600 },
      { tf: 'H4', sec: 14400 },
    ];

    for (const { tf, sec } of tfs) {
      const key = `${symbol}:${tf}`;
      const arr = this.candles.get(key);
      if (!arr || arr.length === 0) continue;
      if (firstLiveRebase) {
        const shift = cleanBid - arr[arr.length - 1].close;
        for (const bar of arr) {
          bar.open = roundToDigits(bar.open + shift, spec.digits);
          bar.high = roundToDigits(bar.high + shift, spec.digits);
          bar.low = roundToDigits(bar.low + shift, spec.digits);
          bar.close = roundToDigits(bar.close + shift, spec.digits);
        }
      }
      const bucket = Math.floor(nowSec / sec) * sec;
      const last = arr[arr.length - 1];
      if (last.time === bucket) {
        last.close = cleanBid;
        last.high = Math.max(last.high, cleanBid);
        last.low = Math.min(last.low, cleanBid);
        last.volume += Math.floor(Math.random() * 6 + 1);
      } else {
        arr.push({
          time: bucket,
          open: last.close,
          high: Math.max(last.close, cleanBid),
          low: Math.min(last.close, cleanBid),
          close: cleanBid,
          volume: 10,
        });
        if (arr.length > 420) arr.shift();
      }
    }
  }

  private startLiveMarketSync() {
    const syncOnce = async () => {
      const now = Date.now();
      // Fetch real-time crypto & gold reference quotes from Binance public bookTicker
      try {
        const res = await fetch(
          'https://api.binance.com/api/v3/ticker/bookTicker?symbols=%5B%22BTCUSDT%22,%22PAXGUSDT%22%5D',
          { signal: AbortSignal.timeout(2500) }
        );
        if (res.ok) {
          const rows = (await res.json()) as Array<{ symbol: string; bidPrice: string; askPrice: string }>;
          for (const row of rows) {
            const target = row.symbol === 'BTCUSDT' ? 'BTCUSD' : row.symbol === 'PAXGUSDT' ? 'XAUUSD' : null;
            if (!target) continue;
            const ext = this.lastExternalTickAt.get(target);
            if (ext && ext.source === 'MT5_BROKER' && now - ext.at < 10000) continue;
            const bid = Number(row.bidPrice);
            const ask = Number(row.askPrice);
            if (bid > 0 && ask > 0) {
              this.lastExternalTickAt.set(target, { at: now, source: 'LIVE_FEED' });
              this.applyQuoteUpdate(target, bid, ask, 'LIVE_FEED');
            }
          }
        }
      } catch {
        // Offline or rate-limited; keep current quotes smoothly
      }

      // Fetch real-world FX spot rates
      try {
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD', {
          signal: AbortSignal.timeout(2500),
        });
        if (fxRes.ok) {
          const fx = (await fxRes.json()) as { rates?: Record<string, number> };
          const rates = fx.rates;
          if (rates) {
            const pairs: Array<{ symbol: string; mid: number; spreadPts: number; digits: number }> = [];
            if (rates.EUR > 0) pairs.push({ symbol: 'EURUSD', mid: 1 / rates.EUR, spreadPts: 8, digits: 5 });
            if (rates.GBP > 0) pairs.push({ symbol: 'GBPUSD', mid: 1 / rates.GBP, spreadPts: 11, digits: 5 });
            if (rates.JPY > 0) pairs.push({ symbol: 'USDJPY', mid: rates.JPY, spreadPts: 12, digits: 3 });
            if (rates.GBP > 0 && rates.JPY > 0) {
              pairs.push({ symbol: 'GBPJPY', mid: rates.JPY / rates.GBP, spreadPts: 18, digits: 3 });
            }
            for (const p of pairs) {
              const ext = this.lastExternalTickAt.get(p.symbol);
              if (ext && ext.source === 'MT5_BROKER' && now - ext.at < 10000) continue;
              const point = Math.pow(10, -p.digits);
              const halfSpread = (p.spreadPts * point) / 2;
              this.lastExternalTickAt.set(p.symbol, { at: now, source: 'LIVE_FEED' });
              this.applyQuoteUpdate(p.symbol, p.mid - halfSpread, p.mid + halfSpread, 'LIVE_FEED');
            }
          }
        }
      } catch {
        // Offline fallback
      }
    };

    syncOnce();
    if (this.livePollTimer) clearInterval(this.livePollTimer);
    this.livePollTimer = setInterval(syncOnce, 5000);
  }

  private startMarketFeed() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      const nowMs = Date.now();

      for (const spec of SYMBOL_SPECS) {
        const prev = this.quotes.get(spec.symbol);
        if (!prev) continue;
        const ext = this.lastExternalTickAt.get(spec.symbol);
        // If live MT5 broker ticks are streaming (<10s old), do not overwrite with synthetic jitter
        if (ext && ext.source === 'MT5_BROKER' && nowMs - ext.at < 10000) {
          continue;
        }
        // If live public feed updated BTCUSD/XAUUSD within last 6s, skip synthetic drift for it
        if (ext && ext.source === 'LIVE_FEED' && (spec.symbol === 'BTCUSD' || spec.symbol === 'XAUUSD') && nowMs - ext.at < 6000) {
          continue;
        }

        const point = Math.pow(10, -spec.digits);
        const shock = (Math.random() - 0.5) * 2 * spec.volatility * 0.4;
        const nextBid = roundToDigits(Math.max(point * 10, prev.bid + shock), spec.digits);
        const spreadJitter = Math.max(2, spec.spreadPoints + Math.round((Math.random() - 0.5) * 4));
        const nextAsk = roundToDigits(nextBid + spreadJitter * point, spec.digits);
        const keepSource = ext && nowMs - ext.at < 60000 ? ext.source : 'SIMULATED';
        this.applyQuoteUpdate(spec.symbol, nextBid, nextAsk, keepSource);
      }

      this.recomputeFloatingState();
      this.checkSlTpAndDrawdown();
      this.emit('tick');
    }, 850);
  }

  private calculateProfit(symbol: string, side: TradeSide, lots: number, openPrice: number, currentPrice: number): number {
    const spec = SYMBOL_SPECS.find((s) => s.symbol === symbol);
    if (!spec) return 0;
    const direction = side === 'BUY' ? 1 : -1;
    const priceDiff = (currentPrice - openPrice) * direction;
    let raw = priceDiff * lots * spec.contractSize;
    if (spec.quoteCurrency === 'JPY' && currentPrice > 0) {
      raw = raw / currentPrice;
    }
    return Number(raw.toFixed(2));
  }

  private calculateMargin(symbol: string, lots: number, price: number, leverage: number): number {
    const spec = SYMBOL_SPECS.find((s) => s.symbol === symbol);
    if (!spec) return 0;
    const notionalUsd = spec.quoteCurrency === 'JPY' ? lots * spec.contractSize : lots * spec.contractSize * price;
    return Number((notionalUsd / Math.max(1, leverage)).toFixed(2));
  }

  private recomputeFloatingState() {
    const accountStats = new Map<string, { pnl: number; margin: number; count: number }>();
    for (const acc of this.state.accounts) {
      accountStats.set(acc.id, { pnl: 0, margin: 0, count: 0 });
    }

    for (const pos of this.state.positions) {
      const quote = this.quotes.get(pos.symbol);
      if (quote) {
        const mark = pos.side === 'BUY' ? quote.bid : quote.ask;
        pos.currentPrice = mark;
        pos.profit = this.calculateProfit(pos.symbol, pos.side, pos.lots, pos.openPrice, mark);
      }
      const st = accountStats.get(pos.accountId);
      if (st) {
        st.pnl += pos.profit;
        st.count += 1;
        const acc = this.state.accounts.find((a) => a.id === pos.accountId);
        st.margin += this.calculateMargin(pos.symbol, pos.lots, pos.openPrice, acc?.leverage || 500);
      }
    }

    for (const acc of this.state.accounts) {
      const st = accountStats.get(acc.id) || { pnl: 0, margin: 0, count: 0 };
      acc.floatingPnl = Number(st.pnl.toFixed(2));
      acc.equity = Number((acc.balance + acc.floatingPnl).toFixed(2));
      acc.margin = Number(st.margin.toFixed(2));
      acc.freeMargin = Number((acc.equity - acc.margin).toFixed(2));
      acc.openTradesCount = st.count;
    }
  }

  private checkSlTpAndDrawdown() {
    const nowMs = Date.now();
    let statusChanged = false;
    for (const acc of this.state.accounts) {
      if (acc.connectionMethod === 'mql5_ea') {
        const ageMs = nowMs - new Date(acc.lastHeartbeatAt).getTime();
        const nextStatus: TradingAccount['status'] =
          ageMs > 45000 ? 'disconnected' : ageMs > 15000 ? 'syncing' : 'connected';
        if (acc.status !== nextStatus && acc.status !== 'error') {
          acc.status = nextStatus;
          statusChanged = true;
        }
      }
    }
    if (statusChanged) {
      this.emit('state_changed');
    }

    this.requeueTimedOutFollowerCommands(nowMs);

    const toClose: string[] = [];
    for (const pos of this.state.positions) {
      if (pos.accountRole !== 'master' || pos.status !== 'open') continue;
      const masterAcc = this.state.accounts.find((a) => a.id === pos.accountId);
      // Real MT5 EA terminals close SL/TP on broker side and notify via OnTradeTransaction
      if (masterAcc?.connectionMethod === 'mql5_ea') continue;
      if (pos.sl !== null) {
        if ((pos.side === 'BUY' && pos.currentPrice <= pos.sl) || (pos.side === 'SELL' && pos.currentPrice >= pos.sl)) {
          toClose.push(pos.id);
          continue;
        }
      }
      if (pos.tp !== null) {
        if ((pos.side === 'BUY' && pos.currentPrice >= pos.tp) || (pos.side === 'SELL' && pos.currentPrice <= pos.tp)) {
          toClose.push(pos.id);
        }
      }
    }

    for (const id of toClose) {
      this.closePosition(id);
    }

    if (this.state.settings.autoPauseOnDrawdown) {
      let changed = false;
      for (const acc of this.state.accounts) {
        if (acc.role === 'follower' && acc.copyEnabled && acc.dailyStartBalance > 0) {
          const ddPct = ((acc.dailyStartBalance - acc.equity) / acc.dailyStartBalance) * 100;
          if (ddPct >= acc.riskRule.maxDrawdownPct) {
            acc.copyEnabled = false;
            changed = true;
            this.pushLog({
              eventType: 'RISK_GUARD',
              masterLogin: acc.login,
              symbol: 'RISK',
              followersTargeted: 1,
              followersSucceeded: 0,
              followersSkipped: 1,
              avgLatencyMs: 1,
              message: `Auto-paused Follower ${acc.login} after hitting ${ddPct.toFixed(2)}% drawdown limit (cap ${acc.riskRule.maxDrawdownPct}%).`,
              status: 'warning',
            });
          }
        }
      }
      if (changed) {
        this.schedulePersist();
        this.emit('state_changed');
      }
    }
  }

  private pushLog(entry: Omit<CopierLogEntry, 'id' | 'timestamp'>) {
    this.state.logs.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (this.state.logs.length > 250) {
      this.state.logs.length = 250;
    }
  }

  subscribe(fn: (event: 'tick' | 'state_changed') => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: 'tick' | 'state_changed') {
    for (const fn of this.listeners) {
      fn(event);
    }
  }

  private sanitizeAccount(acc: StoredAccount): TradingAccount {
    const legacy = acc as unknown as Record<string, unknown>;
    const { passwordHash: _ph, metaApiToken: _mt, metaApiAccountId: _mi, ...safe } = legacy;
    const typed = safe as unknown as TradingAccount;
    const hasVault = acc.connectionMethod === 'mql5_ea' ? hasVaultCredential(acc.id) : true;
    return {
      ...typed,
      hasPasswordStored: acc.hasPasswordStored || hasVault,
      needsCredentialEntry: Boolean(acc.needsCredentialEntry && !hasVault),
    };
  }

  getSnapshot(): CopierSnapshot {
    let pendingBridgeCommandsCount = 0;
    for (const cmds of Object.values(this.state.bridgeCommands)) {
      pendingBridgeCommandsCount += cmds.length;
    }
    let pendingMasterCommandsCount = 0;
    for (const cmds of Object.values(this.state.masterBridgeCommands)) {
      pendingMasterCommandsCount += cmds.length;
    }
    return {
      accounts: this.state.accounts.map((a) => this.sanitizeAccount(a)),
      quotes: Array.from(this.quotes.values()),
      positions: [...this.state.positions],
      history: this.state.history.slice(0, 150),
      logs: this.state.logs.slice(0, 100),
      settings: { ...this.state.settings },
      bridgeTokenConfigured: Boolean(this.state.bridgeToken),
      pendingBridgeCommandsCount,
      pendingMasterCommandsCount,
      indicatorOverlays: { ...this.state.indicatorOverlays },
    };
  }

  private requeueTimedOutFollowerCommands(nowMs: number) {
    let requeued = false;
    for (const [cmdId, entry] of this.pendingFollowerCommands.entries()) {
      if (nowMs - entry.sentAt < 12000) continue;
      const acc = this.state.accounts.find((a) => a.login === entry.cmd.targetLogin);
      if (!acc || acc.status === 'disconnected') continue;
      if (entry.cmd.retries >= 3) {
        this.pendingFollowerCommands.delete(cmdId);
        const pos = this.state.positions.find((p) => p.id === entry.cmd.positionId);
        if (pos) {
          pos.pendingAction = null;
          pos.pendingCloseLots = null;
          pos.pendingSl = null;
          pos.pendingTp = null;
          pos.pendingCommandId = null;
          pos.errorMessage = `Follower ${acc.login} did not acknowledge ${entry.cmd.action} after 3 attempts.`;
          if (entry.cmd.action === 'OPEN') pos.status = 'rejected';
        }
        acc.lastError = `Command timeout (${entry.cmd.action}) on ${entry.cmd.symbol}`;
        this.pushLog({
          eventType: 'BROKER_ERROR',
          masterLogin: acc.login,
          symbol: entry.cmd.symbol,
          side: entry.cmd.side,
          masterLots: entry.cmd.lots,
          followersTargeted: 1,
          followersSucceeded: 0,
          followersSkipped: 1,
          avgLatencyMs: 12000,
          message: `Follower ${acc.login} timed out acknowledging ${entry.cmd.action} ${entry.cmd.lots} ${entry.cmd.symbol}. Reconcile terminal state.`,
          status: 'error',
        });
        requeued = true;
        continue;
      }

      entry.cmd.retries += 1;
      entry.sentAt = nowMs;
      if (!this.state.bridgeCommands[entry.cmd.targetLogin]) {
        this.state.bridgeCommands[entry.cmd.targetLogin] = [];
      }
      const alreadyQueued = this.state.bridgeCommands[entry.cmd.targetLogin].some(
        (c) => c.commandId === entry.cmd.commandId
      );
      if (!alreadyQueued) {
        this.state.bridgeCommands[entry.cmd.targetLogin].push({ ...entry.cmd });
        requeued = true;
      }
    }
    if (requeued) {
      this.schedulePersist();
      this.emit('state_changed');
    }
  }

  getTickPayload() {
    return {
      quotes: Array.from(this.quotes.values()),
      positionUpdates: this.state.positions.map((p) => ({
        id: p.id,
        currentPrice: p.currentPrice,
        profit: p.profit,
      })),
      accountUpdates: this.state.accounts.map((a) => ({
        id: a.id,
        equity: a.equity,
        floatingPnl: a.floatingPnl,
        margin: a.margin,
        freeMargin: a.freeMargin,
      })),
    };
  }

  getCandles(symbol: string, timeframe: Timeframe): Candle[] {
    return this.candles.get(`${symbol}:${timeframe}`) || [];
  }

  private inferBrokerFromServer(server: string): string {
    const s = (server || '').toLowerCase();
    if (s.includes('exness')) return 'Exness';
    if (s.includes('icmarkets')) return 'IC Markets';
    if (s.includes('xm')) return 'XM Global';
    if (s.includes('pepperstone')) return 'Pepperstone';
    if (s.includes('fbs')) return 'FBS';
    if (s.includes('deriv')) return 'Deriv';
    if (s.includes('octa')) return 'OctaFX';
    return server.split('-')[0] || 'MT5 Broker';
  }

  private inferAccountTier(
    server?: string,
    label?: string,
    explicitTier?: AccountTier,
    currency?: string,
    isCentFlag?: boolean
  ): AccountTier {
    if (explicitTier === 'cent' || explicitTier === 'standard') return explicitTier;
    if (isCentFlag) return 'cent';
    const cur = (currency || '').toUpperCase();
    if (cur.includes('USC') || cur.includes('CENT')) return 'cent';
    const combined = `${server || ''} ${label || ''}`.toLowerCase();
    if (combined.includes('cent') || combined.includes('trialc')) return 'cent';
    return 'standard';
  }

  private normalizeBaseSymbol(rawSymbol: string): string {
    const upper = rawSymbol.toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const noDot = upper.replace(/\.(PRO|RAW|ECN|STD|CENT|MICRO|[A-Z0-9]{1,3})$/i, '');
    const exactSpec = SYMBOL_SPECS.find((s) => noDot === s.symbol);
    if (exactSpec) return exactSpec.symbol;
    const prefixSpec = SYMBOL_SPECS.find((s) => noDot.startsWith(s.symbol));
    if (prefixSpec) return prefixSpec.symbol;
    return noDot.replace(/^([A-Z]{6})[CMI]$/, '$1');
  }

  private resolveFollowerBrokerSymbol(baseSymbol: string, follower: StoredAccount): string {
    const prefix = follower.riskRule.symbolPrefix || '';
    const suffix = follower.riskRule.symbolSuffix || '';
    if (prefix || suffix) {
      return `${prefix}${baseSymbol}${suffix}`;
    }
    if (follower.accountTier === 'cent') {
      return `${baseSymbol}c`;
    }
    return baseSymbol;
  }

  async connectAccount(input: {
    label?: string;
    login: string;
    password: string;
    server: string;
    role: AccountRole;
    mode: AccountMode;
    accountTier?: AccountTier;
    connectionMethod: ConnectionMethod;
    masterId?: string | null;
    initialBalance?: number;
    leverage?: number;
    mt5TerminalPath?: string;
    riskRule?: Partial<CopierRiskRule>;
  }): Promise<TradingAccount> {
    const login = input.login.trim();
    const server = input.server.trim();
    if (!login || !input.password || !server) {
      throw new Error('Login ID, Password, and Broker Server are required.');
    }

    const existing = this.state.accounts.find((a) => a.login === login && a.server.toLowerCase() === server.toLowerCase());
    if (existing) {
      throw new Error(`Account ${login} on ${server} is already connected.`);
    }

    const tier = this.inferAccountTier(server, input.label, input.accountTier);
    const verifiedBalance =
      input.initialBalance && input.initialBalance > 0
        ? input.initialBalance
        : input.mode === 'demo'
          ? 10000
          : 5000;
    let status: TradingAccount['status'] = 'connected';
    let note = '';

    if (input.connectionMethod === 'mql5_ea') {
      status = 'syncing';
      note = `Registered for 100% Free Local MT5 Bridge (${tier.toUpperCase()} · ${login} @ ${server}). Exact 1:1 lot copying enabled.`;
    } else {
      note = `Logged into ${input.mode.toUpperCase()} (${tier.toUpperCase()}) local execution engine (${server}).`;
    }

    const masters = this.state.accounts.filter((a) => a.role === 'master');
    const resolvedMasterId =
      input.role === 'follower' ? input.masterId || masters[0]?.id || null : null;

    const defaultSuffix =
      input.riskRule?.symbolSuffix !== undefined
        ? input.riskRule.symbolSuffix
        : tier === 'cent'
          ? 'c'
          : '';

    const now = new Date().toISOString();
    const accId = `acc-${crypto.randomUUID().slice(0, 8)}`;
    const account: StoredAccount = {
      id: accId,
      label: input.label?.trim() || `${input.role === 'master' ? 'Master' : 'Follower'} ${login}`,
      login,
      server,
      broker: this.inferBrokerFromServer(server),
      role: input.role,
      mode: input.mode,
      accountTier: tier,
      connectionMethod: input.connectionMethod,
      status,
      copyEnabled: true,
      masterId: resolvedMasterId,
      currency: tier === 'cent' ? 'USC' : 'USD',
      leverage: input.leverage || 500,
      balance: verifiedBalance,
      equity: verifiedBalance,
      margin: 0,
      freeMargin: verifiedBalance,
      floatingPnl: 0,
      dailyStartBalance: verifiedBalance,
      openTradesCount: 0,
      lastHeartbeatAt: now,
      createdAt: now,
      mt5TerminalPath:
        input.connectionMethod === 'mql5_ea'
          ? input.mt5TerminalPath?.trim() || 'C:\\Program Files\\MetaTrader 5\\terminal64.exe'
          : undefined,
      hasPasswordStored: true,
      needsCredentialEntry: false,
      passwordHash: hashSecret(input.password),
      riskRule: defaultRiskRule({
        ...input.riskRule,
        symbolSuffix: defaultSuffix,
      }),
    };

    if (input.connectionMethod === 'mql5_ea') {
      storeVaultCredential(account.id, input.password);
    }

    this.state.accounts.push(account);
    this.pushLog({
      eventType: 'ACCOUNT_AUTH',
      masterLogin: login,
      symbol: server,
      followersTargeted: 1,
      followersSucceeded: 1,
      followersSkipped: 0,
      avgLatencyMs: 6,
      message: `${account.label} (${login} @ ${server}, ${tier.toUpperCase()}) connected. ${note}`,
      status: 'success',
    });

    this.schedulePersist();
    this.emit('state_changed');
    return this.sanitizeAccount(account);
  }

  setAccountCredential(accountId: string, password: string): TradingAccount {
    const acc = this.state.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error('Account not found');
    const clean = password.trim();
    if (!clean) throw new Error('Password cannot be empty');
    storeVaultCredential(acc.id, clean);
    acc.passwordHash = hashSecret(clean);
    acc.hasPasswordStored = true;
    acc.needsCredentialEntry = false;
    this.schedulePersist();
    this.emit('state_changed');
    return this.sanitizeAccount(acc);
  }

  getBridgeToken(): string {
    return this.state.bridgeToken;
  }

  rotateBridgeToken(): string {
    this.state.bridgeToken = `tsmt5_${crypto.randomBytes(16).toString('hex')}`;
    this.pushLog({
      eventType: 'ACCOUNT_AUTH',
      masterLogin: 'SYSTEM',
      symbol: 'SECURITY',
      followersTargeted: 0,
      followersSucceeded: 0,
      followersSkipped: 0,
      avgLatencyMs: 1,
      message: 'Rotated local MT5 Bridge Token. Re-provision Followers / update EAs to apply.',
      status: 'warning',
    });
    this.writeStateSync();
    this.emit('state_changed');
    return this.state.bridgeToken;
  }

  getAccountsInternal(): TradingAccount[] {
    return this.state.accounts.map((a) => this.sanitizeAccount(a));
  }

  getSettings(): GlobalCopierSettings {
    return { ...this.state.settings };
  }

  markAccountRuntimeHeartbeat(accountId: string, status: TradingAccount['status'], lastError: string | null = null) {
    const acc = this.state.accounts.find((a) => a.id === accountId);
    if (!acc) return;
    acc.status = status;
    acc.lastError = lastError;
    if (status === 'connected' || status === 'syncing') {
      acc.lastHeartbeatAt = new Date().toISOString();
    }
    this.schedulePersist();
    this.emit('state_changed');
  }

  private sanitizeIniValue(value: string): string {
    return value.replace(/[\r\n]/g, '').trim();
  }

  /**
   * Builds MT5 startup INI. Public downloads NEVER embed plaintext passwords;
   * internal ephemeral spawns pass password explicitly and shred the tmp file in ~12s.
   */
  buildMt5StartupIni(
    accountId: string,
    opts?: { password?: string; includeBlankPlaceholderOnly?: boolean }
  ): {
    filename: string;
    content: string;
    hasPassword: boolean;
  } {
    const acc = this.state.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error('Account not found');

    const rawPass = opts?.includeBlankPlaceholderOnly
      ? ''
      : opts?.password?.trim() || retrieveVaultCredential(acc.id) || '';
    const hasPassword = rawPass.length > 0;
    const expertName = acc.role === 'master' ? 'TradeSync_Master' : 'TradeSync_Follower';
    const defaultSymbol = acc.accountTier === 'cent' ? 'XAUUSDc' : 'XAUUSD';

    const lines = [
      '; TradeSync MT5 Local Auto-Startup Configuration (100% Free Local Bridge)',
      '[Common]',
      `Login=${this.sanitizeIniValue(acc.login)}`,
      `Password=${this.sanitizeIniValue(rawPass || 'ENTER_YOUR_MT5_PASSWORD')}`,
      `Server=${this.sanitizeIniValue(acc.server)}`,
      'AutoConfiguration=true',
      'NewsEnable=false',
      '[Experts]',
      'Enabled=1',
      'AllowLiveTrading=1',
      'AllowDllImport=0',
      '[StartUp]',
      `Expert=${expertName}`,
      `ExpertParameters=${expertName}.set`,
      `Symbol=${defaultSymbol}`,
      'Period=M15',
      '',
    ];

    return {
      filename: `mt5_${this.sanitizeIniValue(acc.login)}.ini`,
      content: lines.join('\r\n'),
      hasPassword,
    };
  }

  launchMt5Terminal(
    accountId: string,
    opts?: { password?: string; terminalPath?: string }
  ): {
    launched: boolean;
    needsPassword?: boolean;
    mode: 'windows_process' | 'exe_not_found' | 'non_windows_host' | 'password_required';
    exePath: string;
    iniPath: string;
    commandLine: string;
    message: string;
  } {
    const acc = this.state.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error('Account not found');

    if (opts?.terminalPath && opts.terminalPath.trim()) {
      acc.mt5TerminalPath = opts.terminalPath.trim();
      this.schedulePersist();
    }

    const exePath = acc.mt5TerminalPath?.trim() || 'C:\\Program Files\\MetaTrader 5\\terminal64.exe';

    if (opts?.password && opts.password.trim()) {
      storeVaultCredential(acc.id, opts.password.trim());
      acc.needsCredentialEntry = false;
    }

    const ini = this.buildMt5StartupIni(accountId, { password: opts?.password });
    const commandLine = `"${exePath}" /minimized /portable`;

    if (!ini.hasPassword) {
      return {
        launched: false,
        needsPassword: true,
        mode: 'password_required',
        exePath,
        iniPath: '(protected — generated only in-memory on Windows launch)',
        commandLine,
        message: 'Enter your MT5 Trader Password once to save into the Windows encrypted vault and start MT5.',
      };
    }

    if (process.platform !== 'win32') {
      return {
        launched: false,
        mode: 'non_windows_host',
        exePath,
        iniPath: '(Windows ephemeral launch config)',
        commandLine,
        message:
          'Cloud preview runs on Linux so Windows terminal64.exe cannot start here. Run TradeSync locally on your Windows PC (http://localhost:3000) to auto-start MT5 in the background.',
      };
    }

    if (!fs.existsSync(exePath)) {
      return {
        launched: false,
        mode: 'exe_not_found',
        exePath,
        iniPath: '',
        commandLine,
        message: `MT5 executable not found at "${exePath}". Update Terminal Path (e.g. C:\\MT5_Master\\terminal64.exe) or run Auto-Provision Followers.`,
      };
    }

    const tmpIniPath = writeEphemeralLaunchIni(acc.login, ini.content);
    const child = spawn(exePath, ['/minimized', '/portable', `/config:${tmpIniPath}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    acc.status = 'syncing';
    acc.lastHeartbeatAt = new Date().toISOString();
    this.pushLog({
      eventType: 'ACCOUNT_AUTH',
      masterLogin: acc.login,
      symbol: acc.server,
      followersTargeted: 1,
      followersSucceeded: 1,
      followersSkipped: 0,
      avgLatencyMs: 5,
      message: `Launched minimized Windows MT5 (${acc.login} @ ${acc.server}); startup config auto-shredded after handshake.`,
      status: 'success',
    });
    this.schedulePersist();
    this.emit('state_changed');

    return {
      launched: true,
      mode: 'windows_process',
      exePath,
      iniPath: tmpIniPath,
      commandLine,
      message: `MT5 terminal started for Login ${acc.login} (${acc.server}). Waiting for bridge heartbeat...`,
    };
  }

  bulkProvisionFollowers(input: {
    count?: number;
    mode?: AccountMode;
    accountTier?: AccountTier;
    server?: string;
    connectionMethod?: ConnectionMethod;
    masterId?: string;
    baseBalance?: number;
    lotMode?: LotSizingMode;
    lotMultiplier?: number;
    csvLines?: string;
  }): TradingAccount[] {
    const masters = this.state.accounts.filter((a) => a.role === 'master');
    const targetMasterId = input.masterId || masters[0]?.id || null;
    const now = new Date().toISOString();
    const created: TradingAccount[] = [];

    if (input.csvLines && input.csvLines.trim().length > 0) {
      const lines = input.csvLines
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (line.startsWith('#') || line.toLowerCase().startsWith('login,')) continue;
        const parts = line.split(',').map((p) => p.trim());
        const [login, password, server, modeRaw, multRaw, tierRaw] = parts;
        if (!login || !password || !server) continue;
        if (this.state.accounts.some((a) => a.login === login && a.server === server)) continue;

        const mode: AccountMode = modeRaw?.toLowerCase() === 'real' ? 'real' : input.mode || 'demo';
        const tier: AccountTier =
          tierRaw?.toLowerCase() === 'cent'
            ? 'cent'
            : tierRaw?.toLowerCase() === 'standard'
              ? 'standard'
              : this.inferAccountTier(server, undefined, input.accountTier);
        const mult = Number(multRaw) > 0 ? Number(multRaw) : input.lotMultiplier || 1.0;
        const bal = input.baseBalance || 10000;
        const connMethod = input.connectionMethod || 'mql5_ea';
        const accId = `acc-${crypto.randomUUID().slice(0, 8)}`;

        const acc: StoredAccount = {
          id: accId,
          label: `Follower ${login} (${tier === 'cent' ? 'Cent' : 'Std'})`,
          login,
          server,
          broker: this.inferBrokerFromServer(server),
          role: 'follower',
          mode,
          accountTier: tier,
          connectionMethod: connMethod,
          status: connMethod === 'mql5_ea' ? 'syncing' : 'connected',
          copyEnabled: true,
          masterId: targetMasterId,
          currency: tier === 'cent' ? 'USC' : 'USD',
          leverage: 500,
          balance: bal,
          equity: bal,
          margin: 0,
          freeMargin: bal,
          floatingPnl: 0,
          dailyStartBalance: bal,
          openTradesCount: 0,
          lastHeartbeatAt: now,
          createdAt: now,
          hasPasswordStored: true,
          needsCredentialEntry: false,
          passwordHash: hashSecret(password),
          riskRule: defaultRiskRule({
            lotMode: input.lotMode || 'multiplier',
            lotMultiplier: mult,
            symbolSuffix: tier === 'cent' ? 'c' : '',
          }),
        };

        if (connMethod === 'mql5_ea') {
          storeVaultCredential(accId, password);
        }

        this.state.accounts.push(acc);
        created.push(this.sanitizeAccount(acc));
      }
    } else {
      const count = Math.min(200, Math.max(1, input.count || 10));
      const baseNum = 7000000 + Math.floor(Math.random() * 800000);
      const servers = [
        input.server || 'Exness-MT5Trial9',
        'ICMarketsSC-Demo',
        'XMGlobal-MT5 3',
        'Pepperstone-Demo01',
      ];
      for (let i = 0; i < count; i++) {
        const login = String(baseNum + i);
        const server = input.server || servers[i % servers.length];
        const mode = input.mode || 'demo';
        const bal = input.baseBalance || (10000 + (i % 5) * 5000);
        const tier = this.inferAccountTier(server, undefined, input.accountTier);
        const acc: StoredAccount = {
          id: `acc-${crypto.randomUUID().slice(0, 8)}`,
          label: `Follower #${this.state.accounts.length + 1}`,
          login,
          server,
          broker: this.inferBrokerFromServer(server),
          role: 'follower',
          mode,
          accountTier: tier,
          connectionMethod: input.connectionMethod || 'sandbox',
          status: 'connected',
          copyEnabled: true,
          masterId: targetMasterId,
          currency: tier === 'cent' ? 'USC' : 'USD',
          leverage: 500,
          balance: bal,
          equity: bal,
          margin: 0,
          freeMargin: bal,
          floatingPnl: 0,
          dailyStartBalance: bal,
          openTradesCount: 0,
          lastHeartbeatAt: now,
          createdAt: now,
          hasPasswordStored: true,
          passwordHash: hashSecret(`batch-${login}`),
          riskRule: defaultRiskRule({
            lotMode: input.lotMode || 'multiplier',
            lotMultiplier: input.lotMultiplier || 1.0,
          }),
        };
        this.state.accounts.push(acc);
        created.push(this.sanitizeAccount(acc));
      }
    }

    if (created.length > 0) {
      this.pushLog({
        eventType: 'ACCOUNT_AUTH',
        masterLogin: 'BATCH',
        symbol: 'MULTI',
        followersTargeted: created.length,
        followersSucceeded: created.length,
        followersSkipped: 0,
        avgLatencyMs: 9,
        message: `Batch connected ${created.length} Follower accounts for automated trade copying.`,
        status: 'success',
      });
      this.schedulePersist();
      this.emit('state_changed');
    }
    return created;
  }

  updateAccount(
    id: string,
    patch: {
      label?: string;
      copyEnabled?: boolean;
      masterId?: string | null;
      status?: TradingAccount['status'];
      accountTier?: AccountTier;
      mt5TerminalPath?: string;
      riskRule?: Partial<CopierRiskRule>;
    }
  ): TradingAccount {
    const acc = this.state.accounts.find((a) => a.id === id);
    if (!acc) throw new Error('Account not found');
    if (patch.label !== undefined) acc.label = patch.label;
    if (patch.copyEnabled !== undefined) acc.copyEnabled = patch.copyEnabled;
    if (patch.masterId !== undefined) acc.masterId = patch.masterId;
    if (patch.status !== undefined) acc.status = patch.status;
    if (patch.accountTier !== undefined) {
      acc.accountTier = patch.accountTier;
      acc.currency = patch.accountTier === 'cent' ? 'USC' : 'USD';
    }
    if (patch.mt5TerminalPath !== undefined) acc.mt5TerminalPath = patch.mt5TerminalPath;
    if (patch.riskRule) {
      acc.riskRule = { ...acc.riskRule, ...patch.riskRule };
    }
    acc.lastHeartbeatAt = new Date().toISOString();
    this.schedulePersist();
    this.emit('state_changed');
    return this.sanitizeAccount(acc);
  }

  bulkToggleFollowers(copyEnabled: boolean, masterId?: string) {
    for (const acc of this.state.accounts) {
      if (acc.role === 'follower' && (!masterId || acc.masterId === masterId)) {
        acc.copyEnabled = copyEnabled;
      }
    }
    this.schedulePersist();
    this.emit('state_changed');
  }

  removeAccount(id: string) {
    deleteVaultCredential(id);
    const target = this.state.accounts.find((a) => a.id === id);
    if (target) {
      delete this.state.bridgeCommands[target.login];
      delete this.state.masterBridgeCommands[target.login];
    }
    this.state.accounts = this.state.accounts.filter((a) => a.id !== id);
    this.state.positions = this.state.positions.filter((p) => p.accountId !== id);
    this.recomputeFloatingState();
    this.schedulePersist();
    this.emit('state_changed');
  }

  /**
   * Exports non-sensitive configuration for moving to another Windows PC.
   * Strictly excludes passwords, password hashes, DPAPI blobs, and bridge tokens.
   */
  exportMigrationConfig() {
    const { realTradingArmed: _rta, ...safeSettings } = this.state.settings;
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      credentialsIncluded: false,
      securityNote:
        'Passwords and credentials are NOT included. Enter account passwords into the DPAPI vault on the destination Windows PC.',
      settings: {
        ...safeSettings,
        realTradingArmed: false,
      },
      accounts: this.state.accounts.map((acc) => ({
        id: acc.id,
        label: acc.label,
        login: acc.login,
        server: acc.server,
        broker: acc.broker,
        role: acc.role,
        mode: acc.mode,
        accountTier: acc.accountTier,
        connectionMethod: acc.connectionMethod,
        copyEnabled: acc.copyEnabled,
        masterId: acc.masterId,
        currency: acc.currency,
        leverage: acc.leverage,
        riskRule: { ...acc.riskRule },
      })),
    };
  }

  importMigrationConfig(payload: {
    settings?: Partial<GlobalCopierSettings>;
    accounts?: Array<{
      id?: string;
      label: string;
      login: string;
      server: string;
      broker?: string;
      role: AccountRole;
      mode: AccountMode;
      accountTier?: AccountTier;
      connectionMethod: ConnectionMethod;
      copyEnabled?: boolean;
      masterId?: string | null;
      currency?: string;
      leverage?: number;
      riskRule?: Partial<CopierRiskRule>;
    }>;
    replaceExisting?: boolean;
  }) {
    if (!payload || !Array.isArray(payload.accounts)) {
      throw new Error('Invalid TradeSync migration bundle.');
    }

    if (payload.replaceExisting) {
      for (const existing of this.state.accounts) {
        deleteVaultCredential(existing.id);
      }
      this.state.accounts = [];
      this.state.positions = [];
    }

    if (payload.settings) {
      this.state.settings = {
        ...this.state.settings,
        ...payload.settings,
        // Always enforce Real-Money safety lock when importing on a new PC
        realTradingArmed: false,
      };
    }

    const idRemap = new Map<string, string>();
    const now = new Date().toISOString();
    const imported: TradingAccount[] = [];

    for (const item of payload.accounts) {
      if (!item.login || !item.server) continue;
      const dup = this.state.accounts.find(
        (a) => a.login === item.login && a.server.toLowerCase() === item.server.toLowerCase()
      );
      if (dup) {
        if (item.id) idRemap.set(item.id, dup.id);
        continue;
      }

      const newId = `acc-${crypto.randomUUID().slice(0, 8)}`;
      if (item.id) idRemap.set(item.id, newId);
      const tier = this.inferAccountTier(item.server, item.label, item.accountTier, item.currency);
      const acc: StoredAccount = {
        id: newId,
        label: item.label || `${item.role === 'master' ? 'Master' : 'Follower'} ${item.login}`,
        login: item.login,
        server: item.server,
        broker: item.broker || this.inferBrokerFromServer(item.server),
        role: item.role,
        mode: item.mode,
        accountTier: tier,
        connectionMethod: item.connectionMethod === 'sandbox' ? 'sandbox' : 'mql5_ea',
        status: item.connectionMethod === 'sandbox' ? 'connected' : 'disconnected',
        copyEnabled: item.copyEnabled ?? true,
        masterId: item.masterId || null,
        currency: item.currency || (tier === 'cent' ? 'USC' : 'USD'),
        leverage: item.leverage || 500,
        balance: 0,
        equity: 0,
        margin: 0,
        freeMargin: 0,
        floatingPnl: 0,
        dailyStartBalance: 0,
        openTradesCount: 0,
        lastHeartbeatAt: now,
        createdAt: now,
        hasPasswordStored: false,
        needsCredentialEntry: item.connectionMethod === 'mql5_ea',
        passwordHash: hashSecret('pending-credential-entry'),
        riskRule: defaultRiskRule(item.riskRule),
      };
      this.state.accounts.push(acc);
      imported.push(this.sanitizeAccount(acc));
    }

    // Remap masterId references cleanly
    for (const acc of this.state.accounts) {
      if (acc.masterId && idRemap.has(acc.masterId)) {
        acc.masterId = idRemap.get(acc.masterId) || null;
      }
    }

    this.pushLog({
      eventType: 'ACCOUNT_AUTH',
      masterLogin: 'MIGRATE',
      symbol: 'CONFIG',
      followersTargeted: imported.length,
      followersSucceeded: imported.length,
      followersSkipped: 0,
      avgLatencyMs: 8,
      message: `Imported ${imported.length} non-sensitive account definitions & rules. Real-money execution locked; enter passwords into Windows DPAPI vault before launching MT5.`,
      status: 'success',
    });
    this.schedulePersist();
    this.emit('state_changed');
    return { importedCount: imported.length, accounts: imported };
  }

  updateGlobalSettings(patch: Partial<GlobalCopierSettings>) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.schedulePersist();
    this.emit('state_changed');
    return this.state.settings;
  }

  private recordCommandProcessed(commandId?: string): boolean {
    if (!commandId) return true;
    if (this.state.processedCommandIds.includes(commandId)) return false;
    this.state.processedCommandIds.unshift(commandId);
    if (this.state.processedCommandIds.length > 500) {
      this.state.processedCommandIds.length = 500;
    }
    return true;
  }

  private assertRealTradingAllowed(account: StoredAccount) {
    if (account.mode === 'real' && !this.state.settings.realTradingArmed) {
      throw new Error(
        `Real-money trading is locked for Master ${account.login}. Enable "Arm Real-Money Execution" after verifying Demo operation.`
      );
    }
  }

  private computeFollowerLots(
    master: StoredAccount,
    follower: StoredAccount,
    masterLots: number
  ): { lots: number; rejectedReason?: string } {
    const rule = follower.riskRule;
    const mult = rule.lotMultiplier || 1;
    let rawLots = masterLots * mult;

    if (rule.lotMode === 'multiplier' && Math.abs(mult - 1) < 1e-8) {
      rawLots = masterLots;
    } else if (rule.lotMode === 'fixed') {
      rawLots = rule.fixedLot;
    } else if (rule.lotMode === 'equity_ratio') {
      const masterEquity = Math.max(1, master.equity || master.balance || 1);
      const followerEquity = Math.max(1, follower.equity || follower.balance || 1);
      rawLots = masterLots * (followerEquity / masterEquity) * mult;
    } else if (rule.lotMode === 'balance_ratio') {
      const masterBal = Math.max(1, master.balance || 1);
      const followerBal = Math.max(1, follower.balance || 1);
      rawLots = masterLots * (followerBal / masterBal) * mult;
    }

    const exactLots = cleanVolume(rawLots);
    if (exactLots <= 0) {
      return {
        lots: exactLots,
        rejectedReason: `Computed volume (${rawLots}) must be > 0; exact volume NOT silently altered.`,
      };
    }
    if (rule.minLot > 0 && exactLots < rule.minLot - 1e-8) {
      return {
        lots: exactLots,
        rejectedReason: `Requested ${exactLots} lots < rule minLot ${rule.minLot} (exact volume NOT silently increased).`,
      };
    }
    if (rule.maxLot > 0 && exactLots > rule.maxLot + 1e-8) {
      return {
        lots: exactLots,
        rejectedReason: `Requested ${exactLots} lots > rule maxLot ${rule.maxLot} (exact volume NOT silently clamped).`,
      };
    }
    return { lots: exactLots };
  }

  private replicateOpenToFollowers(
    master: StoredAccount,
    masterPos: Position,
    quote: SymbolQuote,
    t0: number
  ) {
    const followers = this.state.accounts.filter(
      (a) => a.role === 'follower' && (a.masterId === master.id || a.masterId === null)
    );

    let succeeded = 0;
    let queuedMt5 = 0;
    let skipped = 0;
    let totalLatency = 0;
    const nowIso = new Date().toISOString();

    if (this.state.settings.copierActive && master.copyEnabled) {
      for (const follower of followers) {
        if (!follower.copyEnabled || follower.status === 'disconnected') {
          skipped++;
          continue;
        }
        if (follower.mode === 'real' && !this.state.settings.realTradingArmed) {
          skipped++;
          continue;
        }

        const rule = follower.riskRule;
        const copySide: TradeSide = rule.reverseCopy
          ? masterPos.side === 'BUY'
            ? 'SELL'
            : 'BUY'
          : masterPos.side;
        const lotResult = this.computeFollowerLots(master, follower, masterPos.lots);
        const copyLots = lotResult.lots;
        const baseSymbol = this.normalizeBaseSymbol(masterPos.symbol);
        const brokerSymbol = this.resolveFollowerBrokerSymbol(baseSymbol, follower);

        if (lotResult.rejectedReason) {
          skipped++;
          const rejectedPos: Position = {
            id: `pos-${crypto.randomUUID().slice(0, 8)}`,
            ticket: this.state.nextTicket++,
            accountId: follower.id,
            accountLogin: follower.login,
            accountLabel: follower.label,
            accountRole: 'follower',
            accountMode: follower.mode,
            accountTier: follower.accountTier,
            masterPositionId: masterPos.id,
            symbol: baseSymbol,
            brokerSymbol,
            side: copySide,
            lots: copyLots,
            openPrice: copySide === 'BUY' ? quote.ask : quote.bid,
            currentPrice: copySide === 'BUY' ? quote.bid : quote.ask,
            sl: null,
            tp: null,
            swap: 0,
            commission: 0,
            profit: 0,
            status: 'rejected',
            openedAt: nowIso,
            latencyMs: 1,
            errorMessage: lotResult.rejectedReason,
          };
          this.state.positions.unshift(rejectedPos);
          follower.lastError = lotResult.rejectedReason;
          this.pushLog({
            eventType: 'BROKER_ERROR',
            masterLogin: follower.login,
            symbol: brokerSymbol,
            side: copySide,
            masterLots: copyLots,
            followersTargeted: 1,
            followersSucceeded: 0,
            followersSkipped: 1,
            avgLatencyMs: 1,
            message: `${follower.label}: ${lotResult.rejectedReason}`,
            status: 'error',
          });
          continue;
        }

        let riskWarning: string | undefined;
        if (rule.warnOnContractMismatch) {
          const masterCs = this.reportedContractSizes.get(`${master.id}:${baseSymbol}`);
          const followerCs = this.reportedContractSizes.get(`${follower.id}:${baseSymbol}`);
          if (masterCs && followerCs && Math.abs(masterCs - followerCs) > 0.0001) {
            riskWarning = `Contract size differs (${masterCs} vs ${followerCs}); exact ${copyLots} lot sent without rescaling.`;
          } else if (master.accountTier !== follower.accountTier) {
            riskWarning =
              follower.accountTier === 'cent'
                ? `Standard Master → Cent Follower (${brokerSymbol}): exact ${copyLots} lot copied (USC cent value differs from USD).`
                : `Cent Master → Standard Follower (${brokerSymbol}): exact ${copyLots} lot copied (USD exposure is higher than USC).`;
          }
        }

        let copySl = rule.copySlTp ? masterPos.sl : null;
        let copyTp = rule.copySlTp ? masterPos.tp : null;
        if (rule.reverseCopy && rule.copySlTp) {
          const temp = copySl;
          copySl = copyTp;
          copyTp = temp;
        }

        const copyPrice = copySide === 'BUY' ? quote.ask : quote.bid;
        const latencyMs =
          follower.connectionMethod === 'sandbox'
            ? Math.floor(3 + Math.random() * 9)
            : Math.floor(15 + Math.random() * 20);
        totalLatency += latencyMs;

        const isMt5Ea = follower.connectionMethod === 'mql5_ea';
        const openCmdId = isMt5Ea ? crypto.randomUUID() : null;

        const followerPos: Position = {
          id: `pos-${crypto.randomUUID().slice(0, 8)}`,
          ticket: this.state.nextTicket++,
          accountId: follower.id,
          accountLogin: follower.login,
          accountLabel: follower.label,
          accountRole: 'follower',
          accountMode: follower.mode,
          accountTier: follower.accountTier,
          masterPositionId: masterPos.id,
          symbol: baseSymbol,
          brokerSymbol,
          side: copySide,
          lots: copyLots,
          openPrice: copyPrice,
          currentPrice: copySide === 'BUY' ? quote.bid : quote.ask,
          sl: copySl,
          tp: copyTp,
          swap: 0,
          commission: Number((copyLots * -3.5).toFixed(2)),
          profit: 0,
          status: isMt5Ea ? 'queued_mt5' : 'open',
          pendingAction: isMt5Ea ? 'OPEN' : null,
          pendingCommandId: openCmdId,
          openedAt: nowIso,
          latencyMs,
          riskWarning,
        };

        this.state.positions.unshift(followerPos);

        if (riskWarning) {
          this.pushLog({
            eventType: 'RISK_GUARD',
            masterLogin: follower.login,
            symbol: brokerSymbol,
            side: copySide,
            masterLots: copyLots,
            followersTargeted: 1,
            followersSucceeded: isMt5Ea ? 0 : 1,
            followersSkipped: 0,
            avgLatencyMs: 1,
            message: `${follower.label}: ${riskWarning}`,
            status: 'warning',
          });
        }

        if (isMt5Ea && openCmdId) {
          if (!this.state.bridgeCommands[follower.login]) {
            this.state.bridgeCommands[follower.login] = [];
          }
          this.state.bridgeCommands[follower.login].push({
            commandId: openCmdId,
            action: 'OPEN',
            targetLogin: follower.login,
            positionId: followerPos.id,
            masterPositionId: masterPos.id,
            symbol: brokerSymbol,
            baseSymbol,
            side: copySide,
            lots: copyLots,
            sl: copySl,
            tp: copyTp,
            retries: 0,
            createdAt: nowIso,
          });
          queuedMt5++;
        } else {
          succeeded++;
        }
      }
    } else {
      skipped = followers.length;
    }

    const elapsed = Math.max(1, Math.round(performance.now() - t0));
    const totalHandled = succeeded + queuedMt5;
    const avgLatency = totalHandled > 0 ? Math.round(totalLatency / totalHandled) : elapsed;

    this.pushLog({
      eventType: 'OPEN_COPY',
      masterLogin: master.login,
      symbol: masterPos.symbol,
      side: masterPos.side,
      masterLots: masterPos.lots,
      followersTargeted: followers.length,
      followersSucceeded: succeeded,
      followersSkipped: skipped,
      avgLatencyMs: avgLatency,
      message: `${masterPos.side} ${masterPos.lots} ${masterPos.symbol} @ ${masterPos.openPrice} on Master ${master.login} → ${succeeded} instant, ${queuedMt5} queued awaiting MT5 confirmation (${skipped} skipped).`,
      status: skipped > 0 && totalHandled > 0 ? 'partial' : totalHandled > 0 || followers.length === 0 ? 'success' : 'warning',
    });

    return { copiedCount: succeeded, queuedCount: queuedMt5, skippedCount: skipped };
  }

  openMasterTrade(input: {
    masterAccountId?: string;
    masterLogin?: string;
    symbol: string;
    side: TradeSide;
    lots: number;
    sl?: number | null;
    tp?: number | null;
    openPriceOverride?: number;
    externalTicket?: string;
    fromBridgeEvent?: boolean;
  }) {
    const t0 = performance.now();
    const master =
      this.state.accounts.find((a) => a.id === input.masterAccountId) ||
      this.state.accounts.find((a) => a.login === input.masterLogin && a.role === 'master') ||
      this.state.accounts.find((a) => a.role === 'master');

    if (!master) {
      throw new Error('No Master account connected. Please connect a Master MT5 account first.');
    }

    if (!input.fromBridgeEvent) {
      this.assertRealTradingAllowed(master);
    }

    if (input.externalTicket) {
      const dup = this.state.positions.find(
        (p) => p.accountId === master.id && p.externalTicket === input.externalTicket
      );
      if (dup) {
        return { masterPosition: dup, copiedCount: 0, skippedCount: 0, duplicate: true };
      }
    }

    const normalizedBase = this.normalizeBaseSymbol(input.symbol);
    const matchedSpec =
      SYMBOL_SPECS.find((s) => s.symbol === normalizedBase) || SYMBOL_SPECS[0];
    const symbol = matchedSpec.symbol;
    const rawTrimmed = input.symbol.trim();
    const masterBrokerSymbol = input.fromBridgeEvent
      ? rawTrimmed || symbol
      : this.resolveFollowerBrokerSymbol(symbol, master);
    const quote = this.quotes.get(symbol);
    if (!quote) throw new Error(`Unsupported symbol: ${input.symbol}`);

    const lots = cleanVolume(input.lots);
    if (lots <= 0) {
      throw new Error(`Invalid order volume: ${input.lots}`);
    }
    const fillPrice =
      input.openPriceOverride && input.openPriceOverride > 0
        ? input.openPriceOverride
        : input.side === 'BUY'
          ? quote.ask
          : quote.bid;

    const nowIso = new Date().toISOString();
    const requiresMasterBrokerConfirm =
      master.connectionMethod === 'mql5_ea' && !input.fromBridgeEvent;

    const masterPos: Position = {
      id: `pos-${crypto.randomUUID().slice(0, 8)}`,
      ticket: this.state.nextTicket++,
      externalTicket: input.externalTicket,
      accountId: master.id,
      accountLogin: master.login,
      accountLabel: master.label,
      accountRole: 'master',
      accountMode: master.mode,
      accountTier: master.accountTier,
      masterPositionId: null,
      symbol,
      brokerSymbol: masterBrokerSymbol,
      side: input.side,
      lots,
      openPrice: fillPrice,
      currentPrice: input.side === 'BUY' ? quote.bid : quote.ask,
      sl: input.sl ?? null,
      tp: input.tp ?? null,
      swap: 0,
      commission: Number((lots * -3.5).toFixed(2)),
      profit: 0,
      status: requiresMasterBrokerConfirm ? 'pending_master_confirm' : 'open',
      openedAt: nowIso,
      latencyMs: 2,
    };

    this.state.positions.unshift(masterPos);

    if (requiresMasterBrokerConfirm) {
      if (!this.state.masterBridgeCommands[master.login]) {
        this.state.masterBridgeCommands[master.login] = [];
      }
      const cmd: MasterBridgeCommand = {
        commandId: crypto.randomUUID(),
        action: 'OPEN',
        masterLogin: master.login,
        positionId: masterPos.id,
        symbol: masterBrokerSymbol,
        side: input.side,
        lots,
        sl: input.sl ?? null,
        tp: input.tp ?? null,
        createdAt: nowIso,
      };
      this.pendingMasterCommands.set(cmd.commandId, cmd);
      this.state.masterBridgeCommands[master.login].push(cmd);

      this.pushLog({
        eventType: 'MASTER_ORDER',
        masterLogin: master.login,
        symbol,
        side: input.side,
        masterLots: lots,
        followersTargeted: 0,
        followersSucceeded: 0,
        followersSkipped: 0,
        avgLatencyMs: 0,
        message: `Sent ${input.side} ${lots.toFixed(2)} ${symbol} to Master MT5 (${master.login}). Waiting for actual broker execution before copying to Followers.`,
        status: 'partial',
      });

      this.recomputeFloatingState();
      this.schedulePersist();
      this.emit('state_changed');
      return { masterPosition: masterPos, copiedCount: 0, skippedCount: 0, pendingMasterConfirm: true };
    }

    const rep = this.replicateOpenToFollowers(master, masterPos, quote, t0);
    this.recomputeFloatingState();
    this.schedulePersist();
    this.emit('state_changed');
    return { masterPosition: masterPos, ...rep };
  }

  modifyPosition(positionId: string, sl: number | null, tp: number | null, fromBridgeEvent = false) {
    const pos = this.state.positions.find((p) => p.id === positionId);
    if (!pos) throw new Error('Position not found');

    const masterAcc = this.state.accounts.find((a) => a.id === pos.accountId);
    if (
      pos.accountRole === 'master' &&
      masterAcc?.connectionMethod === 'mql5_ea' &&
      !fromBridgeEvent &&
      pos.externalTicket
    ) {
      this.assertRealTradingAllowed(masterAcc);
      if (!this.state.masterBridgeCommands[masterAcc.login]) {
        this.state.masterBridgeCommands[masterAcc.login] = [];
      }
      const cmd: MasterBridgeCommand = {
        commandId: crypto.randomUUID(),
        action: 'MODIFY',
        masterLogin: masterAcc.login,
        positionId: pos.id,
        externalTicket: pos.externalTicket,
        symbol: pos.brokerSymbol,
        side: pos.side,
        lots: pos.lots,
        sl,
        tp,
        createdAt: new Date().toISOString(),
      };
      this.pendingMasterCommands.set(cmd.commandId, cmd);
      this.state.masterBridgeCommands[masterAcc.login].push(cmd);
      this.schedulePersist();
      this.emit('state_changed');
      return { updated: true, pendingMasterConfirm: true, synced: 0 };
    }

    return this.applyModifyAndReplicate(pos, sl, tp);
  }

  private applyModifyAndReplicate(pos: Position, sl: number | null, tp: number | null) {
    pos.sl = sl;
    pos.tp = tp;

    let synced = 0;
    let queuedMt5 = 0;
    if (pos.accountRole === 'master') {
      const children = this.state.positions.filter((p) => p.masterPositionId === pos.id);
      for (const child of children) {
        const follower = this.state.accounts.find((a) => a.id === child.accountId);
        if (follower && !follower.riskRule.copySlTp) continue;
        const targetSl = follower?.riskRule.reverseCopy ? tp : sl;
        const targetTp = follower?.riskRule.reverseCopy ? sl : tp;

        if (follower?.connectionMethod === 'mql5_ea') {
          const cmdId = crypto.randomUUID();
          child.pendingAction = 'MODIFY';
          child.pendingSl = targetSl;
          child.pendingTp = targetTp;
          child.pendingCommandId = cmdId;
          if (!this.state.bridgeCommands[follower.login]) {
            this.state.bridgeCommands[follower.login] = [];
          }
          this.state.bridgeCommands[follower.login].push({
            commandId: cmdId,
            action: 'MODIFY',
            targetLogin: follower.login,
            positionId: child.id,
            masterPositionId: pos.id,
            externalTicket: child.externalTicket,
            symbol: child.brokerSymbol,
            baseSymbol: child.symbol,
            side: child.side,
            lots: child.lots,
            sl: targetSl,
            tp: targetTp,
            retries: 0,
            createdAt: new Date().toISOString(),
          });
          queuedMt5++;
        } else {
          child.sl = targetSl;
          child.tp = targetTp;
          synced++;
        }
      }

      this.pushLog({
        eventType: 'MODIFY_COPY',
        masterLogin: pos.accountLogin,
        symbol: pos.symbol,
        side: pos.side,
        masterLots: pos.lots,
        followersTargeted: children.length,
        followersSucceeded: synced,
        followersSkipped: children.length - synced - queuedMt5,
        avgLatencyMs: 6,
        message: `Modified SL/TP on Master #${pos.ticket} (${pos.symbol}) → ${synced} instant, ${queuedMt5} queued awaiting MT5 confirmation.`,
        status: queuedMt5 > 0 && synced === 0 ? 'partial' : 'success',
      });
    }

    this.schedulePersist();
    this.emit('state_changed');
    return { updated: true, synced, queuedCount: queuedMt5 };
  }

  closePosition(
    positionId: string,
    closePriceOverride?: number,
    closeLots?: number,
    fromBridgeEvent = false
  ) {
    const pos = this.state.positions.find((p) => p.id === positionId);
    if (!pos) return { closedCount: 0 };

    const masterAcc = this.state.accounts.find((a) => a.id === pos.accountId);
    const isPartial = Boolean(closeLots && closeLots > 0 && closeLots < pos.lots - 0.00001);

    // If this is a real MT5 Master position and user clicked Close/Partial Close in Dashboard, dispatch to MT5 Master first
    if (
      pos.accountRole === 'master' &&
      masterAcc?.connectionMethod === 'mql5_ea' &&
      !fromBridgeEvent &&
      pos.externalTicket
    ) {
      this.assertRealTradingAllowed(masterAcc);
      if (!this.state.masterBridgeCommands[masterAcc.login]) {
        this.state.masterBridgeCommands[masterAcc.login] = [];
      }
      const cmd: MasterBridgeCommand = {
        commandId: crypto.randomUUID(),
        action: isPartial ? 'PARTIAL_CLOSE' : 'CLOSE',
        masterLogin: masterAcc.login,
        positionId: pos.id,
        externalTicket: pos.externalTicket,
        symbol: pos.brokerSymbol,
        side: pos.side,
        lots: isPartial ? cleanVolume(closeLots!) : pos.lots,
        sl: null,
        tp: null,
        createdAt: new Date().toISOString(),
      };
      this.pendingMasterCommands.set(cmd.commandId, cmd);
      this.state.masterBridgeCommands[masterAcc.login].push(cmd);
      this.schedulePersist();
      this.emit('state_changed');
      return { closedCount: 0, pendingMasterConfirm: true };
    }

    return this.applyCloseAndReplicate(pos, closePriceOverride, closeLots);
  }

  private applyCloseAndReplicate(
    pos: Position,
    closePriceOverride?: number,
    closeLots?: number
  ) {
    const ratio =
      closeLots && closeLots > 0 && closeLots < pos.lots - 0.00001
        ? closeLots / pos.lots
        : 1;
    const isPartial = ratio < 1;

    const targets: Position[] = [pos];
    if (pos.accountRole === 'master') {
      const children = this.state.positions.filter(
        (p) => p.masterPositionId === pos.id && p.status !== 'rejected'
      );
      targets.push(...children);
    }

    const nowIso = new Date().toISOString();
    const fullyClosedIds = new Set<string>();
    let confirmedClosedCount = 0;
    let queuedCloseCount = 0;

    for (const target of targets) {
      const acc = this.state.accounts.find((a) => a.id === target.accountId);
      const shouldPartial = isPartial && (target.id === pos.id || this.state.settings.syncPartialCloses);

      let closingLots: number;
      if (!shouldPartial) {
        closingLots = target.lots;
      } else if (
        closeLots &&
        Math.abs(target.lots - pos.lots) < 1e-7 &&
        (!acc || (acc.riskRule.lotMode === 'multiplier' && Math.abs((acc.riskRule.lotMultiplier || 1) - 1) < 1e-7))
      ) {
        closingLots = cleanVolume(closeLots);
      } else {
        closingLots = cleanVolume(Math.min(target.lots, target.lots * ratio));
      }
      const fullAfterPartial = closingLots >= target.lots - 0.00001;

      if (acc?.connectionMethod === 'mql5_ea' && target.accountRole === 'follower') {
        const cmdId = crypto.randomUUID();
        target.pendingAction = fullAfterPartial ? 'CLOSE' : 'PARTIAL_CLOSE';
        target.pendingCloseLots = closingLots;
        target.pendingCommandId = cmdId;
        if (!this.state.bridgeCommands[acc.login]) {
          this.state.bridgeCommands[acc.login] = [];
        }
        this.state.bridgeCommands[acc.login].push({
          commandId: cmdId,
          action: fullAfterPartial ? 'CLOSE' : 'PARTIAL_CLOSE',
          targetLogin: acc.login,
          positionId: target.id,
          masterPositionId: pos.id,
          externalTicket: target.externalTicket,
          symbol: target.brokerSymbol,
          baseSymbol: target.symbol,
          side: target.side,
          lots: closingLots,
          sl: null,
          tp: null,
          retries: 0,
          createdAt: nowIso,
        });
        queuedCloseCount++;
        continue;
      }

      const quote = this.quotes.get(target.symbol);
      const exitPrice =
        closePriceOverride && target.id === pos.id
          ? closePriceOverride
          : quote
            ? target.side === 'BUY'
              ? quote.bid
              : quote.ask
            : target.currentPrice;

      const realized = this.calculateProfit(
        target.symbol,
        target.side,
        closingLots,
        target.openPrice,
        exitPrice
      );

      if (acc && acc.connectionMethod !== 'mql5_ea') {
        acc.balance = Number((acc.balance + realized + target.commission * (closingLots / Math.max(1e-8, target.lots))).toFixed(2));
      }

      this.state.history.unshift({
        id: crypto.randomUUID(),
        ticket: target.ticket,
        accountId: target.accountId,
        accountLogin: target.accountLogin,
        accountLabel: target.accountLabel,
        accountRole: target.accountRole,
        accountMode: target.accountMode,
        masterPositionId: target.masterPositionId,
        symbol: target.symbol,
        side: target.side,
        lots: closingLots,
        openPrice: target.openPrice,
        closePrice: exitPrice,
        sl: target.sl,
        tp: target.tp,
        profit: realized,
        openedAt: target.openedAt,
        closedAt: nowIso,
      });

      if (fullAfterPartial) {
        fullyClosedIds.add(target.id);
      } else {
        target.lots = cleanVolume(target.lots - closingLots);
      }
      confirmedClosedCount++;
    }

    this.state.positions = this.state.positions.filter((p) => !fullyClosedIds.has(p.id));
    if (this.state.history.length > 500) {
      this.state.history.length = 500;
    }

    if (pos.accountRole === 'master') {
      const followerImmediate = Math.max(0, confirmedClosedCount - 1);
      this.pushLog({
        eventType: isPartial ? 'PARTIAL_CLOSE' : 'CLOSE_COPY',
        masterLogin: pos.accountLogin,
        symbol: pos.symbol,
        side: pos.side,
        masterLots: isPartial && closeLots ? closeLots : pos.lots,
        followersTargeted: targets.length - 1,
        followersSucceeded: followerImmediate,
        followersSkipped: 0,
        avgLatencyMs: 7,
        message: `${isPartial ? 'Partial Closed' : 'Closed'} Master #${pos.ticket} (${pos.symbol} ${isPartial && closeLots ? closeLots : pos.lots} lots) → ${followerImmediate} instant, ${queuedCloseCount} queued awaiting MT5 confirmation.`,
        status: queuedCloseCount > 0 ? 'partial' : 'success',
      });
    }

    this.recomputeFloatingState();
    this.schedulePersist();
    this.emit('state_changed');
    return { closedCount: confirmedClosedCount, queuedCloseCount };
  }

  closeAllPositions(masterAccountId?: string) {
    const masters = this.state.positions.filter(
      (p) => p.accountRole === 'master' && (!masterAccountId || p.accountId === masterAccountId)
    );
    let totalClosed = 0;
    for (const m of masters) {
      totalClosed += this.closePosition(m.id).closedCount;
    }
    const orphans = this.state.positions.filter(
      (p) => !masterAccountId || p.accountId === masterAccountId
    );
    for (const o of orphans) {
      totalClosed += this.closePosition(o.id).closedCount;
    }
    return { totalClosed };
  }

  pollMasterBridgeCommands(token: string, login: string): MasterBridgeCommand[] {
    if (!verifyBridgeTokenConstantTime(token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    const acc = this.state.accounts.find((a) => a.login === login && a.role === 'master');
    if (acc) {
      acc.status = 'connected';
      acc.lastHeartbeatAt = new Date().toISOString();
    }
    const list = this.state.masterBridgeCommands[login] || [];
    this.state.masterBridgeCommands[login] = [];
    if (list.length > 0) {
      this.schedulePersist();
      this.emit('state_changed');
    }
    return list;
  }

  ackMasterBridgeCommand(payload: {
    token: string;
    masterLogin?: string;
    login?: string;
    commandId: string;
    positionId: string;
    action?: MasterBridgeCommand['action'];
    success: boolean;
    externalTicket?: string;
    executedPrice?: number;
    closeLots?: number;
    sl?: number | null;
    tp?: number | null;
    retcode?: number;
    errorMessage?: string;
    balance?: number;
    equity?: number;
  }) {
    if (!verifyBridgeTokenConstantTime(payload.token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    if (!this.recordCommandProcessed(payload.commandId)) {
      return { acknowledged: true, duplicate: true };
    }

    const loginKey = payload.masterLogin || payload.login || '';
    const queuedCmd = this.pendingMasterCommands.get(payload.commandId);
    this.pendingMasterCommands.delete(payload.commandId);
    const resolvedAction = payload.action || queuedCmd?.action;

    const master = this.state.accounts.find(
      (a) => a.login === loginKey && a.role === 'master'
    );
    const pos = this.state.positions.find((p) => p.id === payload.positionId);

    if (!payload.success) {
      if (pos && pos.status === 'pending_master_confirm') {
        this.state.positions = this.state.positions.filter((p) => p.id !== pos.id);
      }
      if (master) {
        master.lastError = `Retcode ${payload.retcode ?? 'ERR'}: ${payload.errorMessage || 'Order rejected by broker'}`;
      }
      this.pushLog({
        eventType: 'BROKER_ERROR',
        masterLogin: loginKey,
        symbol: pos?.symbol || 'MT5',
        side: pos?.side,
        masterLots: pos?.lots,
        followersTargeted: 0,
        followersSucceeded: 0,
        followersSkipped: 0,
        avgLatencyMs: 0,
        message: `Master ${resolvedAction || 'ORDER'} rejected by MT5 broker (${payload.retcode ?? 'ERR'}: ${payload.errorMessage || 'Execution failed'}). Zero Follower orders were sent.`,
        status: 'error',
      });
      this.recomputeFloatingState();
      this.schedulePersist();
      this.emit('state_changed');
      return { acknowledged: true, rejected: true };
    }

    if (master) {
      master.status = 'connected';
      master.lastError = null;
      master.lastHeartbeatAt = new Date().toISOString();
      if (typeof payload.balance === 'number' && payload.balance >= 0) {
        master.balance = Number(payload.balance.toFixed(2));
      }
      if (typeof payload.equity === 'number' && payload.equity >= 0) {
        master.equity = Number(payload.equity.toFixed(2));
      }
    }

    let replicated: { copiedCount: number; skippedCount: number } | undefined;
    let modified: { updated: boolean; synced: number } | undefined;
    let closed: { closedCount: number } | undefined;

    if (pos) {
      if (pos.status === 'pending_master_confirm' || resolvedAction === 'OPEN') {
        pos.status = 'open';
        if (payload.externalTicket) pos.externalTicket = payload.externalTicket;
        if (payload.executedPrice && payload.executedPrice > 0) {
          pos.openPrice = payload.executedPrice;
        }
        const quote = this.quotes.get(pos.symbol);
        if (master && quote) {
          replicated = this.replicateOpenToFollowers(master, pos, quote, performance.now());
        }
      } else if (resolvedAction === 'MODIFY') {
        const nextSl = payload.sl !== undefined ? payload.sl : queuedCmd?.sl ?? pos.sl;
        const nextTp = payload.tp !== undefined ? payload.tp : queuedCmd?.tp ?? pos.tp;
        modified = this.applyModifyAndReplicate(pos, nextSl, nextTp);
      } else if (resolvedAction === 'CLOSE') {
        closed = this.applyCloseAndReplicate(pos, payload.executedPrice);
      } else if (resolvedAction === 'PARTIAL_CLOSE') {
        const closeLots = payload.closeLots || queuedCmd?.lots;
        closed = this.applyCloseAndReplicate(pos, payload.executedPrice, closeLots);
      } else if (payload.externalTicket) {
        pos.externalTicket = payload.externalTicket;
      }
    }

    this.recomputeFloatingState();
    this.schedulePersist();
    this.emit('state_changed');
    return { acknowledged: true, replicated, modified, closed };
  }

  handleBridgeMasterSync(payload: {
    token: string;
    masterLogin: string;
    server?: string;
    accountCurrency?: string;
    cent?: boolean;
    balance?: number;
    equity?: number;
    margin?: number;
    freeMargin?: number;
    ticks?: Array<{ symbol: string; bid: number; ask: number }>;
    openPositions?: Array<{
      externalTicket: string;
      symbol: string;
      side: TradeSide;
      lots: number;
      openPrice: number;
      sl?: number;
      tp?: number;
      contractSize?: number;
    }>;
  }) {
    if (!verifyBridgeTokenConstantTime(payload.token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }

    const master = this.state.accounts.find(
      (a) => a.login === payload.masterLogin && a.role === 'master'
    );
    if (master) {
      master.status = 'connected';
      master.lastHeartbeatAt = new Date().toISOString();
      master.lastError = null;
      if (payload.accountCurrency || payload.cent !== undefined) {
        master.accountTier = this.inferAccountTier(
          payload.server || master.server,
          master.label,
          undefined,
          payload.accountCurrency,
          payload.cent
        );
        if (payload.accountCurrency) master.currency = payload.accountCurrency.toUpperCase();
      }
      if (typeof payload.balance === 'number' && payload.balance >= 0) {
        master.balance = Number(payload.balance.toFixed(2));
      }
      if (typeof payload.equity === 'number' && payload.equity >= 0) {
        master.equity = Number(payload.equity.toFixed(2));
      }
      if (typeof payload.margin === 'number' && payload.margin >= 0) {
        master.margin = Number(payload.margin.toFixed(2));
      }
      if (typeof payload.freeMargin === 'number') {
        master.freeMargin = Number(payload.freeMargin.toFixed(2));
      }
    }

    if (Array.isArray(payload.ticks) && payload.ticks.length > 0) {
      this.ingestBrokerTicks(payload.token, payload.ticks);
    }

    let opened = 0;
    let closed = 0;

    // Reconcile open MT5 positions after reconnect/restart without duplicates
    if (master && Array.isArray(payload.openPositions)) {
      const incomingTickets = new Set(payload.openPositions.map((p) => p.externalTicket));
      for (const mp of payload.openPositions) {
        if (typeof mp.contractSize === 'number' && mp.contractSize > 0) {
          this.reportedContractSizes.set(
            `${master.id}:${this.normalizeBaseSymbol(mp.symbol)}`,
            mp.contractSize
          );
        }
        const exists = this.state.positions.find(
          (p) => p.accountId === master.id && p.externalTicket === mp.externalTicket
        );
        if (!exists && mp.externalTicket) {
          this.openMasterTrade({
            masterAccountId: master.id,
            symbol: mp.symbol,
            side: mp.side,
            lots: mp.lots,
            sl: mp.sl && mp.sl > 0 ? mp.sl : null,
            tp: mp.tp && mp.tp > 0 ? mp.tp : null,
            openPriceOverride: mp.openPrice,
            externalTicket: mp.externalTicket,
            fromBridgeEvent: true,
          });
          opened++;
        } else if (exists && exists.status === 'open') {
          if (mp.lots > 0 && mp.lots < exists.lots - 0.0001) {
            this.applyCloseAndReplicate(exists, undefined, Number((exists.lots - mp.lots).toFixed(2)));
          }
          const incomingSl = mp.sl && mp.sl > 0 ? mp.sl : null;
          const incomingTp = mp.tp && mp.tp > 0 ? mp.tp : null;
          if (incomingSl !== exists.sl || incomingTp !== exists.tp) {
            this.applyModifyAndReplicate(exists, incomingSl, incomingTp);
          }
        }
      }

      const trackedMasterPositions = this.state.positions.filter(
        (p) => p.accountId === master.id && p.status === 'open' && p.externalTicket
      );
      for (const localPos of trackedMasterPositions) {
        if (localPos.externalTicket && !incomingTickets.has(localPos.externalTicket)) {
          this.applyCloseAndReplicate(localPos);
          closed++;
        }
      }
    }

    return { synced: true, opened, closed };
  }

  handleBridgeMasterEvent(payload: {
    token: string;
    action: 'OPEN' | 'MODIFY' | 'CLOSE' | 'PARTIAL_CLOSE';
    masterLogin: string;
    server?: string;
    accountCurrency?: string;
    cent?: boolean;
    contractSize?: number;
    externalTicket: string;
    symbol: string;
    side: TradeSide;
    lots: number;
    remainingLots?: number;
    price?: number;
    sl?: number | null;
    tp?: number | null;
    commandId?: string;
  }) {
    if (!verifyBridgeTokenConstantTime(payload.token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    if (payload.commandId && !this.recordCommandProcessed(payload.commandId)) {
      return { ok: true, duplicate: true };
    }

    let master = this.state.accounts.find(
      (a) => a.login === payload.masterLogin && a.role === 'master'
    );

    const detectedTier = this.inferAccountTier(
      payload.server || master?.server,
      master?.label,
      undefined,
      payload.accountCurrency,
      payload.cent
    );

    if (!master) {
      const now = new Date().toISOString();
      master = {
        id: `acc-${crypto.randomUUID().slice(0, 8)}`,
        label: `MT5 Live Master ${payload.masterLogin}`,
        login: payload.masterLogin,
        server: payload.server || 'MT5-External-Bridge',
        broker: this.inferBrokerFromServer(payload.server || 'MT5'),
        role: 'master',
        mode: (payload.server || '').toLowerCase().includes('demo') || (payload.server || '').toLowerCase().includes('trial') ? 'demo' : 'real',
        accountTier: detectedTier,
        connectionMethod: 'mql5_ea',
        status: 'connected',
        copyEnabled: true,
        masterId: null,
        currency: payload.accountCurrency?.toUpperCase() || (detectedTier === 'cent' ? 'USC' : 'USD'),
        leverage: 500,
        balance: 50000,
        equity: 50000,
        margin: 0,
        freeMargin: 50000,
        floatingPnl: 0,
        dailyStartBalance: 50000,
        openTradesCount: 0,
        lastHeartbeatAt: now,
        lastError: null,
        createdAt: now,
        hasPasswordStored: true,
        passwordHash: hashSecret('ea-bridge'),
        riskRule: defaultRiskRule({
          symbolSuffix: detectedTier === 'cent' ? 'c' : '',
        }),
      };
      this.state.accounts.push(master);
    } else {
      master.status = 'connected';
      master.lastError = null;
      master.lastHeartbeatAt = new Date().toISOString();
      if (payload.accountCurrency || payload.cent !== undefined) {
        master.accountTier = detectedTier;
        if (payload.accountCurrency) master.currency = payload.accountCurrency.toUpperCase();
      }
    }

    if (typeof payload.contractSize === 'number' && payload.contractSize > 0) {
      this.reportedContractSizes.set(
        `${master.id}:${this.normalizeBaseSymbol(payload.symbol)}`,
        payload.contractSize
      );
    }

    if (payload.action === 'OPEN') {
      return this.openMasterTrade({
        masterAccountId: master.id,
        symbol: payload.symbol,
        side: payload.side,
        lots: payload.lots,
        sl: payload.sl && payload.sl > 0 ? payload.sl : null,
        tp: payload.tp && payload.tp > 0 ? payload.tp : null,
        openPriceOverride: payload.price,
        externalTicket: payload.externalTicket,
        fromBridgeEvent: true,
      });
    }

    const existing = this.state.positions.find(
      (p) => p.accountId === master.id && p.externalTicket === payload.externalTicket
    );
    if (!existing) {
      return { ok: true, note: 'Referenced ticket not currently open on bridge' };
    }

    if (payload.action === 'MODIFY') {
      return this.applyModifyAndReplicate(
        existing,
        payload.sl && payload.sl > 0 ? payload.sl : null,
        payload.tp && payload.tp > 0 ? payload.tp : null
      );
    }

    if (payload.action === 'PARTIAL_CLOSE') {
      if (
        typeof payload.remainingLots === 'number' &&
        payload.remainingLots > 0 &&
        existing.lots <= payload.remainingLots + 0.0001
      ) {
        return { ok: true, duplicate: true, note: 'Partial close already reconciled by sync' };
      }
      return this.applyCloseAndReplicate(existing, payload.price, payload.lots);
    }

    if (payload.action === 'CLOSE') {
      return this.applyCloseAndReplicate(existing, payload.price);
    }
    return { ok: true };
  }

  pollBridgeCommands(
    token: string,
    login: string,
    telemetry?: {
      balance?: number;
      equity?: number;
      openCount?: number;
      cent?: boolean;
      accountCurrency?: string;
    }
  ): BridgeCommand[] {
    if (!verifyBridgeTokenConstantTime(token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    const acc = this.state.accounts.find((a) => a.login === login);
    if (acc) {
      acc.status = 'connected';
      acc.lastHeartbeatAt = new Date().toISOString();
      if (telemetry?.balance && telemetry.balance > 0) acc.balance = Number(telemetry.balance.toFixed(2));
      if (telemetry?.equity && telemetry.equity > 0) acc.equity = Number(telemetry.equity.toFixed(2));
      if (telemetry?.cent !== undefined || telemetry?.accountCurrency) {
        acc.accountTier = this.inferAccountTier(
          acc.server,
          acc.label,
          undefined,
          telemetry.accountCurrency,
          telemetry.cent
        );
        if (telemetry.accountCurrency) acc.currency = telemetry.accountCurrency.toUpperCase();
      }
    }
    const list = this.state.bridgeCommands[login] || [];
    this.state.bridgeCommands[login] = [];
    if (list.length > 0) {
      const nowMs = Date.now();
      for (const cmd of list) {
        this.pendingFollowerCommands.set(cmd.commandId, { cmd: { ...cmd }, sentAt: nowMs });
      }
      this.schedulePersist();
      this.emit('state_changed');
    }
    return list;
  }

  ackBridgeCommand(payload: {
    token: string;
    login: string;
    commandId?: string;
    positionId: string;
    action?: BridgeCommand['action'];
    requestedLots?: number;
    success?: boolean;
    externalTicket: string;
    executedPrice?: number;
    resolvedSymbol?: string;
    contractSize?: number;
    accountCurrency?: string;
    cent?: boolean;
    retcode?: number;
    errorMessage?: string;
    balance?: number;
    equity?: number;
    margin?: number;
    freeMargin?: number;
  }) {
    if (!verifyBridgeTokenConstantTime(payload.token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    if (payload.commandId && !this.recordCommandProcessed(payload.commandId)) {
      return { acknowledged: true, duplicate: true };
    }

    const pendingEntry = payload.commandId ? this.pendingFollowerCommands.get(payload.commandId) : undefined;
    if (payload.commandId) {
      this.pendingFollowerCommands.delete(payload.commandId);
    }

    const pos = this.state.positions.find((p) => p.id === payload.positionId);
    const acc = this.state.accounts.find((a) => a.login === payload.login);
    if (acc) {
      acc.status = 'connected';
      acc.lastHeartbeatAt = new Date().toISOString();
      if (typeof payload.balance === 'number' && payload.balance > 0) {
        acc.balance = Number(payload.balance.toFixed(2));
      }
      if (typeof payload.equity === 'number' && payload.equity > 0) {
        acc.equity = Number(payload.equity.toFixed(2));
      }
      if (typeof payload.margin === 'number' && payload.margin >= 0) {
        acc.margin = Number(payload.margin.toFixed(2));
      }
      if (typeof payload.freeMargin === 'number') {
        acc.freeMargin = Number(payload.freeMargin.toFixed(2));
      }
      if (payload.accountCurrency || payload.cent !== undefined) {
        acc.accountTier = this.inferAccountTier(
          acc.server,
          acc.label,
          undefined,
          payload.accountCurrency,
          payload.cent
        );
        if (payload.accountCurrency) acc.currency = payload.accountCurrency.toUpperCase();
      }
      if (typeof payload.contractSize === 'number' && payload.contractSize > 0 && pos) {
        this.reportedContractSizes.set(
          `${acc.id}:${this.normalizeBaseSymbol(pos.symbol)}`,
          payload.contractSize
        );
      }
    }

    const resolvedAction = payload.action || pendingEntry?.cmd.action || pos?.pendingAction || 'OPEN';

    if (payload.success === false) {
      const exactErr = `Retcode ${payload.retcode ?? 'ERR'}: ${payload.errorMessage || 'Follower execution failed'}`;
      if (acc) {
        acc.lastError = exactErr;
      }
      if (pos) {
        pos.pendingAction = null;
        pos.pendingCloseLots = null;
        pos.pendingSl = null;
        pos.pendingTp = null;
        pos.pendingCommandId = null;
        if (resolvedAction === 'OPEN') {
          pos.status = 'rejected';
        } else {
          pos.status = 'open';
        }
        pos.errorMessage = `${payload.retcode ?? ''} ${payload.errorMessage || 'Broker rejected'}`.trim();
      }
      this.pushLog({
        eventType: 'BROKER_ERROR',
        masterLogin: payload.login,
        symbol: payload.resolvedSymbol || pos?.brokerSymbol || pos?.symbol || 'MT5',
        side: pos?.side,
        masterLots: payload.requestedLots || pos?.lots,
        followersTargeted: 1,
        followersSucceeded: 0,
        followersSkipped: 1,
        avgLatencyMs: 20,
        message: `Follower ${payload.login} ${resolvedAction} rejected (${exactErr}) — exact requested volume was NOT silently changed.`,
        status: 'error',
      });
      this.recomputeFloatingState();
      this.schedulePersist();
      this.emit('state_changed');
      return { acknowledged: true, rejected: true };
    }

    if (acc) acc.lastError = null;

    if (pos) {
      const nowIso = new Date().toISOString();
      if (resolvedAction === 'CLOSE' || resolvedAction === 'PARTIAL_CLOSE') {
        const confirmedLots = cleanVolume(
          payload.requestedLots || pos.pendingCloseLots || pendingEntry?.cmd.lots || pos.lots
        );
        const quote = this.quotes.get(pos.symbol);
        const exitPrice =
          payload.executedPrice && payload.executedPrice > 0
            ? payload.executedPrice
            : quote
              ? pos.side === 'BUY'
                ? quote.bid
                : quote.ask
              : pos.currentPrice;
        const realized = this.calculateProfit(pos.symbol, pos.side, confirmedLots, pos.openPrice, exitPrice);

        this.state.history.unshift({
          id: crypto.randomUUID(),
          ticket: pos.ticket,
          accountId: pos.accountId,
          accountLogin: pos.accountLogin,
          accountLabel: pos.accountLabel,
          accountRole: pos.accountRole,
          accountMode: pos.accountMode,
          masterPositionId: pos.masterPositionId,
          symbol: pos.symbol,
          side: pos.side,
          lots: confirmedLots,
          openPrice: pos.openPrice,
          closePrice: exitPrice,
          sl: pos.sl,
          tp: pos.tp,
          profit: realized,
          openedAt: pos.openedAt,
          closedAt: nowIso,
        });
        if (this.state.history.length > 500) {
          this.state.history.length = 500;
        }

        const remaining = cleanVolume(pos.lots - confirmedLots);
        if (resolvedAction === 'CLOSE' || remaining <= 1e-7) {
          this.state.positions = this.state.positions.filter((p) => p.id !== pos.id);
        } else {
          pos.lots = remaining;
          pos.status = 'open';
          pos.pendingAction = null;
          pos.pendingCloseLots = null;
          pos.pendingCommandId = null;
          pos.errorMessage = undefined;
        }
      } else if (resolvedAction === 'MODIFY') {
        if (pos.pendingSl !== undefined) pos.sl = pos.pendingSl;
        if (pos.pendingTp !== undefined) pos.tp = pos.pendingTp;
        pos.status = 'open';
        pos.pendingAction = null;
        pos.pendingSl = null;
        pos.pendingTp = null;
        pos.pendingCommandId = null;
        pos.errorMessage = undefined;
      } else {
        pos.status = 'open';
        pos.pendingAction = null;
        pos.pendingCloseLots = null;
        pos.pendingSl = null;
        pos.pendingTp = null;
        pos.pendingCommandId = null;
        pos.errorMessage = undefined;
        if (payload.externalTicket && payload.externalTicket !== '0') {
          pos.externalTicket = payload.externalTicket;
        }
        if (payload.resolvedSymbol && payload.resolvedSymbol.trim()) {
          pos.brokerSymbol = payload.resolvedSymbol.trim();
        }
        if (payload.executedPrice && payload.executedPrice > 0) {
          pos.openPrice = payload.executedPrice;
        }
      }
    }

    this.pushLog({
      eventType: 'BRIDGE_SYNC',
      masterLogin: payload.login,
      symbol: payload.resolvedSymbol || pos?.brokerSymbol || pos?.symbol || 'MT5',
      followersTargeted: 1,
      followersSucceeded: 1,
      followersSkipped: 0,
      avgLatencyMs: 24,
      message: `MT5 Follower ${payload.login} confirmed ${resolvedAction} on ${payload.resolvedSymbol || pos?.brokerSymbol || 'MT5'} (Ticket #${payload.externalTicket}).`,
      status: 'success',
    });
    this.recomputeFloatingState();
    this.schedulePersist();
    this.emit('state_changed');
    return { acknowledged: true, action: resolvedAction };
  }

  ingestCustomIndicator(token: string, overlay: Omit<CustomIndicatorOverlay, 'updatedAt'>) {
    if (!verifyBridgeTokenConstantTime(token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    const key = `${overlay.symbol.toUpperCase()}:${overlay.timeframe}`;
    this.state.indicatorOverlays[key] = {
      ...overlay,
      symbol: overlay.symbol.toUpperCase(),
      updatedAt: new Date().toISOString(),
    };
    this.schedulePersist();
    this.emit('state_changed');
    return this.state.indicatorOverlays[key];
  }

  ingestBrokerTicks(
    token: string,
    ticks: Array<{ symbol: string; bid: number; ask: number }>
  ) {
    if (!verifyBridgeTokenConstantTime(token, this.state.bridgeToken)) {
      throw new Error('Invalid Bridge Token');
    }
    const now = Date.now();
    let updated = 0;
    for (const item of ticks) {
      const normalized = this.normalizeBaseSymbol(item.symbol);
      const spec = SYMBOL_SPECS.find((s) => s.symbol === normalized);
      if (!spec || !(item.bid > 0) || !(item.ask > 0)) continue;
      this.lastExternalTickAt.set(spec.symbol, { at: now, source: 'MT5_BROKER' });
      this.applyQuoteUpdate(spec.symbol, item.bid, item.ask, 'MT5_BROKER');
      updated++;
    }
    if (updated > 0) {
      this.recomputeFloatingState();
      this.emit('tick');
    }
    return { updated };
  }
}
