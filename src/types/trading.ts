export type AccountRole = 'master' | 'follower';
export type AccountMode = 'demo' | 'real';
export type AccountTier = 'standard' | 'cent';
export type ConnectionMethod = 'sandbox' | 'mql5_ea';
export type ConnectionStatus = 'connected' | 'disconnected' | 'syncing' | 'error';
export type LotSizingMode = 'multiplier' | 'fixed' | 'equity_ratio' | 'balance_ratio';
export type TradeSide = 'BUY' | 'SELL';
export type Timeframe = 'M1' | 'M5' | 'M15' | 'H1' | 'H4';

export interface CopierRiskRule {
  lotMode: LotSizingMode;
  lotMultiplier: number;
  fixedLot: number;
  minLot: number;
  maxLot: number;
  copySlTp: boolean;
  reverseCopy: boolean;
  symbolPrefix: string;
  symbolSuffix: string;
  maxDrawdownPct: number;
  maxSlippagePips: number;
  warnOnContractMismatch: boolean;
}

export interface TradingAccount {
  id: string;
  label: string;
  login: string;
  server: string;
  broker: string;
  role: AccountRole;
  mode: AccountMode;
  accountTier: AccountTier;
  connectionMethod: ConnectionMethod;
  status: ConnectionStatus;
  copyEnabled: boolean;
  masterId: string | null;
  currency: string;
  leverage: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  floatingPnl: number;
  dailyStartBalance: number;
  openTradesCount: number;
  lastHeartbeatAt: string;
  lastError?: string | null;
  createdAt: string;
  mt5TerminalPath?: string;
  hasPasswordStored: boolean;
  needsCredentialEntry?: boolean;
  riskRule: CopierRiskRule;
}

export interface SymbolQuote {
  symbol: string;
  description: string;
  digits: number;
  contractSize: number;
  pipSize: number;
  quoteCurrency: 'USD' | 'JPY';
  bid: number;
  ask: number;
  spreadPoints: number;
  changePct: number;
  high: number;
  low: number;
  updatedAt: string;
  feedSource?: 'SIMULATED' | 'LIVE_FEED' | 'MT5_BROKER';
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface IndicatorSignalMarker {
  time: number;
  price: number;
  direction: 'BUY' | 'SELL';
  label?: string;
  color?: string;
}

export interface IndicatorLineSeries {
  id: string;
  name: string;
  color: string;
  width?: number;
  points: IndicatorPoint[];
}

export interface CustomIndicatorOverlay {
  symbol: string;
  timeframe: Timeframe;
  sourceName: string;
  updatedAt: string;
  lines: IndicatorLineSeries[];
  signals: IndicatorSignalMarker[];
}

export interface IndicatorConfig {
  enabled: boolean;
  applyTvTheme: boolean;
  showTL: boolean;
  tlLen: number;
  tlMult: number;
  backpaint: boolean;
  showExt: boolean;
  showProb: boolean;
  probStep: number;
  probCount: number;
  hideZero: boolean;
  showAlli: boolean;
  jawLen: number;
  teethLen: number;
  lipsLen: number;
  jawOff: number;
  teethOff: number;
  lipsOff: number;
  alliOpacity: number;
  showFrac: boolean;
  fracN: number;
  showSR: boolean;
  srLen: number;
  showBox: boolean;
}

export interface Position {
  id: string;
  ticket: number;
  externalTicket?: string;
  accountId: string;
  accountLogin: string;
  accountLabel: string;
  accountRole: AccountRole;
  accountMode: AccountMode;
  accountTier?: AccountTier;
  masterPositionId: string | null;
  symbol: string;
  brokerSymbol: string;
  side: TradeSide;
  lots: number;
  openPrice: number;
  currentPrice: number;
  sl: number | null;
  tp: number | null;
  swap: number;
  commission: number;
  profit: number;
  status: 'open' | 'queued_mt5' | 'pending_master_confirm' | 'rejected';
  pendingAction?: 'OPEN' | 'MODIFY' | 'PARTIAL_CLOSE' | 'CLOSE' | null;
  pendingCloseLots?: number | null;
  pendingSl?: number | null;
  pendingTp?: number | null;
  pendingCommandId?: string | null;
  openedAt: string;
  latencyMs: number;
  errorMessage?: string;
  riskWarning?: string | null;
}

export interface ClosedTrade {
  id: string;
  ticket: number;
  accountId: string;
  accountLogin: string;
  accountLabel: string;
  accountRole: AccountRole;
  accountMode: AccountMode;
  masterPositionId: string | null;
  symbol: string;
  side: TradeSide;
  lots: number;
  openPrice: number;
  closePrice: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  openedAt: string;
  closedAt: string;
}

export interface CopierLogEntry {
  id: string;
  timestamp: string;
  eventType:
    | 'OPEN_COPY'
    | 'MODIFY_COPY'
    | 'CLOSE_COPY'
    | 'PARTIAL_CLOSE'
    | 'BRIDGE_SYNC'
    | 'MASTER_ORDER'
    | 'BROKER_ERROR'
    | 'RISK_GUARD'
    | 'ACCOUNT_AUTH';
  masterLogin: string;
  symbol: string;
  side?: TradeSide;
  masterLots?: number;
  followersTargeted: number;
  followersSucceeded: number;
  followersSkipped: number;
  avgLatencyMs: number;
  message: string;
  status: 'success' | 'partial' | 'warning' | 'error';
}

export interface BridgeCommand {
  commandId: string;
  action: 'OPEN' | 'MODIFY' | 'CLOSE' | 'PARTIAL_CLOSE';
  targetLogin: string;
  positionId: string;
  masterPositionId: string;
  externalTicket?: string;
  symbol: string;
  baseSymbol?: string;
  side: TradeSide;
  lots: number;
  sl: number | null;
  tp: number | null;
  retries: number;
  createdAt: string;
}

export interface MasterBridgeCommand {
  commandId: string;
  action: 'OPEN' | 'MODIFY' | 'CLOSE' | 'PARTIAL_CLOSE';
  masterLogin: string;
  positionId: string;
  externalTicket?: string;
  symbol: string;
  side: TradeSide;
  lots: number;
  sl: number | null;
  tp: number | null;
  createdAt: string;
}

export interface GlobalCopierSettings {
  copierActive: boolean;
  realTradingArmed: boolean;
  defaultSlippagePips: number;
  autoPauseOnDrawdown: boolean;
  syncPartialCloses: boolean;
  setupCompleted: boolean;
  mt5SourcePath: string;
  maxConcurrentStarts: number;
  startupDelayMs: number;
}

export type Mt5ProcessState =
  | 'stopped'
  | 'queued'
  | 'starting'
  | 'running'
  | 'crashed'
  | 'restarting'
  | 'error';

export interface Mt5FollowerRuntime {
  accountId: string;
  login: string;
  server: string;
  label: string;
  accountTier: AccountTier;
  connectionMethod: ConnectionMethod;
  instanceDir: string;
  exePath: string;
  provisioned: boolean;
  eaInstalled: boolean;
  eaCompiled: boolean;
  eaAttachedVerified: boolean;
  compileError: string | null;
  hasVaultCredential: boolean;
  processState: Mt5ProcessState;
  pid: number | null;
  crashCount: number;
  restartCount: number;
  lastExitCode: number | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastMessage: string | null;
  autoRestartEnabled: boolean;
}

export interface SystemHealthSnapshot {
  platform: string;
  isWindows: boolean;
  cpuModel: string;
  cpuCores: number;
  cpuUsagePct: number;
  totalRamMb: number;
  freeRamMb: number;
  usedRamMb: number;
  estimatedMbPerMt5: number;
  recommendedMaxFollowers: number;
  activeRunningProcesses: number;
  queuedStartCount: number;
  vaultMethod: 'windows_dpapi' | 'session_memory_only';
  resourceWarning: string | null;
  detectedMt5Paths: string[];
}

export interface Mt5ManagerSnapshot {
  health: SystemHealthSnapshot;
  followers: Mt5FollowerRuntime[];
}

export interface CopierSnapshot {
  accounts: TradingAccount[];
  quotes: SymbolQuote[];
  positions: Position[];
  history: ClosedTrade[];
  logs: CopierLogEntry[];
  settings: GlobalCopierSettings;
  bridgeTokenConfigured: boolean;
  pendingBridgeCommandsCount: number;
  pendingMasterCommandsCount: number;
  indicatorOverlays: Record<string, CustomIndicatorOverlay>;
}

export interface AuthStatus {
  authenticated: boolean;
  initialized: boolean;
  username: string;
  hostBind: string;
}

export type ServerWsMessage =
  | { type: 'snapshot'; payload: CopierSnapshot }
  | {
      type: 'tick';
      payload: {
        quotes: SymbolQuote[];
        positionUpdates: Array<{ id: string; currentPrice: number; profit: number }>;
        accountUpdates: Array<{
          id: string;
          equity: number;
          floatingPnl: number;
          margin: number;
          freeMargin: number;
        }>;
      };
    }
  | { type: 'state_changed'; payload: CopierSnapshot };
