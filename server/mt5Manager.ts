import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  Mt5FollowerRuntime,
  Mt5ManagerSnapshot,
  Mt5ProcessState,
  SystemHealthSnapshot,
  TradingAccount,
} from '../src/types/trading.ts';
import type { TradeCopierEngine } from './engine.ts';
import {
  getVaultMethod,
  hasVaultCredential,
  retrieveVaultCredential,
  writeEphemeralLaunchIni,
} from './vault.ts';

const INSTANCES_ROOT = path.resolve(process.cwd(), 'data', 'mt5-instances');
const FARM_STATE_PATH = path.resolve(process.cwd(), 'data', 'mt5-farm-state.json');
const MQL5_DIR = path.resolve(process.cwd(), 'mql5');

const COMMON_MT5_CANDIDATES = [
  'C:\\Program Files\\MetaTrader 5',
  'C:\\Program Files\\MetaTrader 5 EXNESS',
  'C:\\Program Files\\Exness MetaTrader 5',
  'C:\\Program Files (x86)\\MetaTrader 5',
  'C:\\MT5_Master',
];

interface CpuSample {
  idle: number;
  total: number;
}

function copyDirRecursive(srcDir: string, dstDir: string) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function decodeCompileLog(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  // Heuristic check for UTF-16LE without BOM (common in MetaEditor64 logs)
  let zeroCount = 0;
  const probe = Math.min(buf.length, 64);
  for (let i = 1; i < probe; i += 2) {
    if (buf[i] === 0) zeroCount++;
  }
  if (probe >= 8 && zeroCount >= probe / 4) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}

export class Mt5Manager {
  private engine: TradeCopierEngine;
  private runtimes: Map<string, Mt5FollowerRuntime> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private shouldBeRunning: Set<string> = new Set();
  private startupQueue: string[] = [];
  private activeStarts = 0;
  private batchRunning = false;
  private prevCpuSample: CpuSample | null = null;
  private lastCpuUsagePct = 0;
  private monitorTimer: NodeJS.Timeout | null = null;

  constructor(engine: TradeCopierEngine) {
    this.engine = engine;
    this.sampleCpuUsage();
    this.syncRuntimeMap();
    this.startMonitorLoop();

    if (process.platform === 'win32' && this.loadDesiredFarmActive()) {
      const bootTimer = setTimeout(() => {
        void this.startAllFollowers();
      }, 2500);
      bootTimer.unref?.();
    }
  }

  private loadDesiredFarmActive(): boolean {
    try {
      if (!fs.existsSync(FARM_STATE_PATH)) return false;
      const parsed = JSON.parse(fs.readFileSync(FARM_STATE_PATH, 'utf8')) as {
        desiredFarmActive?: boolean;
      };
      return Boolean(parsed.desiredFarmActive);
    } catch {
      return false;
    }
  }

  private saveDesiredFarmActive(active: boolean) {
    try {
      fs.mkdirSync(path.dirname(FARM_STATE_PATH), { recursive: true });
      fs.writeFileSync(
        FARM_STATE_PATH,
        JSON.stringify({ desiredFarmActive: active, updatedAt: new Date().toISOString() }, null, 2),
        'utf8'
      );
    } catch {
      // ignore persistence warning
    }
  }

  private sampleCpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total +=
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.irq +
        cpu.times.idle;
    }

    if (this.prevCpuSample) {
      const idleDelta = idle - this.prevCpuSample.idle;
      const totalDelta = total - this.prevCpuSample.total;
      if (totalDelta > 0) {
        const busyPct = ((totalDelta - idleDelta) / totalDelta) * 100;
        this.lastCpuUsagePct = Math.max(0, Math.min(100, Number(busyPct.toFixed(1))));
      }
    }
    this.prevCpuSample = { idle, total };
    return this.lastCpuUsagePct;
  }

  private getFollowerAccounts(): TradingAccount[] {
    return this.engine
      .getAccountsInternal()
      .filter((a) => a.role === 'follower' && a.connectionMethod === 'mql5_ea');
  }

  private getInstanceDir(acc: TradingAccount): string {
    const safeLogin = acc.login.replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(INSTANCES_ROOT, `follower_${safeLogin}`);
  }

  private syncRuntimeMap() {
    const followers = this.getFollowerAccounts();
    const activeIds = new Set(followers.map((f) => f.id));

    for (const existingId of this.runtimes.keys()) {
      if (!activeIds.has(existingId)) {
        this.runtimes.delete(existingId);
        this.shouldBeRunning.delete(existingId);
      }
    }

    for (const acc of followers) {
      const instanceDir = this.getInstanceDir(acc);
      const exePath = acc.mt5TerminalPath || path.join(instanceDir, 'terminal64.exe');
      const eaSourcePath = path.join(instanceDir, 'MQL5', 'Experts', 'TradeSync_Follower.mq5');
      const eaCompiledPath = path.join(instanceDir, 'MQL5', 'Experts', 'TradeSync_Follower.ex5');
      const chartProfilePath = path.join(
        instanceDir,
        'MQL5',
        'Profiles',
        'Charts',
        'Default',
        'chart01.chr'
      );
      const presetPath = path.join(instanceDir, 'MQL5', 'Presets', 'TradeSync_Follower.set');
      const commonIniPath = path.join(instanceDir, 'config', 'common.ini');

      const eaInstalled = fs.existsSync(eaSourcePath);
      const eaCompiled = fs.existsSync(eaCompiledPath);
      const hasConfigs =
        fs.existsSync(chartProfilePath) &&
        fs.existsSync(presetPath) &&
        fs.existsSync(commonIniPath);

      const provisioned =
        process.platform === 'win32'
          ? fs.existsSync(exePath) && eaInstalled && eaCompiled && hasConfigs
          : eaInstalled && hasConfigs;

      const prev = this.runtimes.get(acc.id);
      const pid = prev?.pid ?? null;
      let processState: Mt5ProcessState = prev?.processState || 'stopped';
      if (!this.processes.has(acc.id)) {
        if (processState === 'running' || processState === 'starting') {
          processState = acc.status === 'connected' ? 'running' : 'stopped';
        }
      }

      const eaAttachedVerified = acc.status === 'connected' && Boolean(acc.lastHeartbeatAt);

      this.runtimes.set(acc.id, {
        accountId: acc.id,
        login: acc.login,
        server: acc.server,
        label: acc.label,
        accountTier: acc.accountTier,
        connectionMethod: acc.connectionMethod,
        instanceDir,
        exePath,
        provisioned,
        eaInstalled,
        eaCompiled,
        eaAttachedVerified,
        compileError: prev?.compileError ?? null,
        hasVaultCredential: hasVaultCredential(acc.id),
        processState,
        pid,
        crashCount: prev?.crashCount ?? 0,
        restartCount: prev?.restartCount ?? 0,
        lastExitCode: prev?.lastExitCode ?? null,
        startedAt: prev?.startedAt ?? null,
        lastHeartbeatAt: acc.lastHeartbeatAt ?? null,
        lastMessage: prev?.lastMessage ?? acc.lastError ?? null,
        autoRestartEnabled: prev?.autoRestartEnabled ?? true,
      });
    }
  }

  private startMonitorLoop() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(() => {
      this.sampleCpuUsage();
      this.syncRuntimeMap();

      if (process.platform === 'win32') {
        for (const accountId of this.shouldBeRunning) {
          const rt = this.runtimes.get(accountId);
          if (!rt || !rt.autoRestartEnabled) continue;
          if (rt.processState === 'crashed' && rt.crashCount <= 3) {
            rt.processState = 'restarting';
            rt.restartCount += 1;
            void this.startFollower(accountId);
          }
        }
      }
    }, 8000);
  }

  detectMt5Installations(updateSetting = true): {
    isWindows: boolean;
    detectedPaths: Array<{ path: string; hasTerminal: boolean; hasMetaEditor: boolean }>;
    recommendedSourcePath: string;
    message: string;
  } {
    const settings = this.engine.getSettings();
    const candidates = Array.from(
      new Set([settings.mt5SourcePath, ...COMMON_MT5_CANDIDATES].filter(Boolean))
    );

    if (process.platform !== 'win32') {
      return {
        isWindows: false,
        detectedPaths: [],
        recommendedSourcePath: settings.mt5SourcePath || 'C:\\Program Files\\MetaTrader 5',
        message:
          'Preview host runs on Linux. On your Windows PC, TradeSync scans C:\\Program Files\\MetaTrader 5 and Exness MT5 folders automatically.',
      };
    }

    const detectedPaths: Array<{ path: string; hasTerminal: boolean; hasMetaEditor: boolean }> = [];
    for (const dir of candidates) {
      const term = path.join(dir, 'terminal64.exe');
      const editor = path.join(dir, 'metaeditor64.exe');
      if (fs.existsSync(dir)) {
        detectedPaths.push({
          path: dir,
          hasTerminal: fs.existsSync(term),
          hasMetaEditor: fs.existsSync(editor),
        });
      }
    }

    const best = detectedPaths.find((d) => d.hasTerminal) || detectedPaths[0];
    if (updateSetting && best && best.path !== settings.mt5SourcePath) {
      this.engine.updateGlobalSettings({ mt5SourcePath: best.path });
    }

    return {
      isWindows: true,
      detectedPaths,
      recommendedSourcePath: best?.path || settings.mt5SourcePath,
      message: best
        ? `Detected MetaTrader 5 installation at ${best.path}.`
        : 'MetaTrader 5 was not found in default Program Files folders. Browse or enter your MT5 installation folder.',
    };
  }

  getSystemHealth(detectedMt5Paths: string[] = []): SystemHealthSnapshot {
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model?.trim() || 'CPU';
    const cpuCores = cpus.length || 1;
    const cpuUsagePct = this.sampleCpuUsage();
    const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeRamMb = Math.round(os.freemem() / (1024 * 1024));
    const usedRamMb = Math.max(0, totalRamMb - freeRamMb);
    const ramUsedPct = totalRamMb > 0 ? Number(((usedRamMb / totalRamMb) * 100).toFixed(1)) : 0;

    const estimatedMbPerMt5 = 165;
    const osAndMasterReserveMb = Math.max(2048, Math.round(totalRamMb * 0.25));
    const usableForFollowersMb = Math.max(0, totalRamMb - osAndMasterReserveMb);
    const recommendedMaxFollowers = Math.max(
      1,
      Math.floor(usableForFollowersMb / estimatedMbPerMt5)
    );

    const followers = this.getFollowerAccounts();
    const activeRunningProcesses = Array.from(this.runtimes.values()).filter(
      (r) =>
        r.processState === 'running' ||
        r.processState === 'starting' ||
        r.processState === 'restarting'
    ).length;

    const queuedStartCount = this.startupQueue.length + this.activeStarts;

    let resourceWarning: string | null = null;
    if (followers.length > recommendedMaxFollowers) {
      resourceWarning = `System has ${Math.round(totalRamMb / 1024)} GB RAM (~${recommendedMaxFollowers} safe concurrent MT5 Follower instances at ~${estimatedMbPerMt5} MB each). You configured ${followers.length} Followers; keep batch startup conservative or expand RAM.`;
    } else if (ramUsedPct >= 86) {
      resourceWarning = `High host RAM utilization (${ramUsedPct}%). Pause unused terminals or increase startup delay before launching additional Followers.`;
    } else if (cpuUsagePct >= 88) {
      resourceWarning = `High CPU load (${cpuUsagePct}%). Reduce concurrent MT5 startup batch size in settings.`;
    }

    return {
      platform: process.platform,
      isWindows: process.platform === 'win32',
      cpuModel,
      cpuCores,
      cpuUsagePct,
      totalRamMb,
      freeRamMb,
      usedRamMb,
      estimatedMbPerMt5,
      recommendedMaxFollowers,
      activeRunningProcesses,
      queuedStartCount,
      vaultMethod: getVaultMethod(),
      resourceWarning,
      detectedMt5Paths,
    };
  }

  getSnapshot(): Mt5ManagerSnapshot {
    this.syncRuntimeMap();
    const detection = this.detectMt5Installations(false);
    const paths = detection.detectedPaths.map((d) => d.path);
    return {
      health: this.getSystemHealth(paths),
      followers: Array.from(this.runtimes.values()),
    };
  }

  private renderFollowerEaSource(): string {
    const raw = fs.readFileSync(path.join(MQL5_DIR, 'TradeSync_Follower.mq5'), 'utf8');
    return raw.replace('PASTE_YOUR_BRIDGE_TOKEN_HERE', this.engine.getBridgeToken());
  }

  private renderMasterEaSource(): string {
    const raw = fs.readFileSync(path.join(MQL5_DIR, 'TradeSync_Master.mq5'), 'utf8');
    return raw.replace('PASTE_YOUR_BRIDGE_TOKEN_HERE', this.engine.getBridgeToken());
  }

  private writeLightweightMt5Configs(instanceDir: string, acc: TradingAccount) {
    const cfgDir = path.join(instanceDir, 'config');
    const presetsDir = path.join(instanceDir, 'MQL5', 'Presets');
    const profileDir = path.join(instanceDir, 'MQL5', 'Profiles', 'Charts', 'Default');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.mkdirSync(presetsDir, { recursive: true });
    fs.mkdirSync(profileDir, { recursive: true });

    const token = this.engine.getBridgeToken();
    const chartSymbol = acc.accountTier === 'cent' ? 'XAUUSDc' : 'XAUUSD';

    const commonIni = [
      '; TradeSync Lightweight Background Follower Profile (No plaintext credentials)',
      '[Common]',
      'NewsEnable=false',
      '[Charts]',
      'MaxBars=5000',
      'ProfileLast=Default',
      '[Experts]',
      'Enabled=1',
      'AllowLiveTrading=1',
      'AllowDllImport=0',
      'WebRequest=1',
      'WebRequestUrl=http://127.0.0.1:3000;http://localhost:3000',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(cfgDir, 'common.ini'), commonIni, 'utf8');

    const presetSet = [
      `InpServerBaseUrl=http://127.0.0.1:3000`,
      `InpBridgeToken=${token}`,
      `InpPollMs=250`,
      `InpMaxSlippage=30`,
      `InpMagicNumber=66001`,
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(presetsDir, 'TradeSync_Follower.set'), presetSet, 'utf8');

    // Default chart profile pre-attaching TradeSync_Follower so restarting MT5 always attaches the EA
    fs.writeFileSync(path.join(profileDir, 'order.wnd'), 'chart01.chr\r\n', 'utf8');
    const chartChr = [
      '<chart>',
      `symbol=${chartSymbol}`,
      'period=15',
      'leftpos=0',
      'digits=2',
      'scale=8',
      'graph=1',
      'fore=0',
      'grid=1',
      'volume=0',
      'scroll=1',
      'shift=0',
      'ohlc=1',
      '<expert>',
      'name=TradeSync_Follower',
      'flags=343',
      'window_num=0',
      '<inputs>',
      'InpServerBaseUrl=http://127.0.0.1:3000',
      `InpBridgeToken=${token}`,
      'InpPollMs=250',
      'InpMaxSlippage=30',
      'InpMagicNumber=66001',
      '</inputs>',
      '</expert>',
      '</chart>',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(profileDir, 'chart01.chr'), chartChr, 'utf8');
  }

  private tryCompileMql5(
    sourceDir: string,
    mq5FilePath: string,
    includeRoot?: string
  ): { compiled: boolean; logText: string; compileError: string | null } {
    if (process.platform !== 'win32') {
      return {
        compiled: false,
        logText: 'Compilation runs on Windows via metaeditor64.exe.',
        compileError: null,
      };
    }
    const metaEditor = path.join(sourceDir, 'metaeditor64.exe');
    if (!fs.existsSync(metaEditor)) {
      return {
        compiled: false,
        logText: `metaeditor64.exe not found in ${sourceDir}.`,
        compileError: `metaeditor64.exe not found in ${sourceDir}`,
      };
    }
    const logPath = `${mq5FilePath}.compile.log`;
    const mqlInclude = includeRoot || path.join(sourceDir, 'MQL5');
    try {
      execFileSync(
        metaEditor,
        [`/compile:${mq5FilePath}`, `/inc:${mqlInclude}`, `/log:${logPath}`],
        {
          timeout: 30000,
          windowsHide: true,
        }
      );
    } catch {
      // metaeditor64 often exits non-zero even on clean compile; inspect .ex5 + compile log below
    }

    const ex5Path = mq5FilePath.replace(/\.mq5$/i, '.ex5');
    const logText = fs.existsSync(logPath)
      ? decodeCompileLog(fs.readFileSync(logPath)).slice(0, 1600)
      : '';
    const compiled = fs.existsSync(ex5Path);
    let compileError: string | null = null;

    if (!compiled) {
      const errorLines = logText
        .split(/\r?\n/)
        .filter((l) => /\berror\b/i.test(l) && !/\b0 errors\b/i.test(l))
        .slice(0, 5);
      compileError =
        errorLines.join(' | ') ||
        logText.trim().slice(0, 260) ||
        `Failed to produce ${path.basename(ex5Path)}`;
    }

    return { compiled, logText, compileError };
  }

  private copyMt5PortableFiles(sourceDir: string, instanceDir: string): string {
    const srcExe = path.join(sourceDir, 'terminal64.exe');
    const dstExe = path.join(instanceDir, 'terminal64.exe');
    if (!fs.existsSync(srcExe)) {
      throw new Error(`terminal64.exe not found at "${srcExe}"`);
    }

    // Copy required root executables & runtime DLLs from source MT5 directory
    const rootItems = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const item of rootItems) {
      if (!item.isFile()) continue;
      if (/\.(exe|dll|ico|dat|lng)$/i.test(item.name)) {
        const s = path.join(sourceDir, item.name);
        const d = path.join(instanceDir, item.name);
        try {
          if (!fs.existsSync(d) || item.name.toLowerCase() === 'terminal64.exe') {
            fs.copyFileSync(s, d);
          }
        } catch {
          // Ignore locked optional auxiliary file if already in use
        }
      }
    }

    // Copy MQL5/Include so <Trade/Trade.mqh> & standard library headers resolve locally
    const srcInclude = path.join(sourceDir, 'MQL5', 'Include');
    const dstInclude = path.join(instanceDir, 'MQL5', 'Include');
    if (fs.existsSync(srcInclude)) {
      copyDirRecursive(srcInclude, dstInclude);
    }

    // Copy broker server definitions (*.srv, servers.dat) from MT5 install and %APPDATA%\MetaQuotes\Terminal\*
    const serverConfigSources: string[] = [
      path.join(sourceDir, 'Config'),
      path.join(sourceDir, 'config'),
    ];
    const appDataDir = process.env.APPDATA;
    if (appDataDir) {
      const mqTerminals = path.join(appDataDir, 'MetaQuotes', 'Terminal');
      if (fs.existsSync(mqTerminals)) {
        for (const sub of fs.readdirSync(mqTerminals, { withFileTypes: true })) {
          if (sub.isDirectory()) {
            serverConfigSources.push(path.join(mqTerminals, sub.name, 'config'));
          }
        }
      }
    }

    const dstCfgUpper = path.join(instanceDir, 'Config');
    const dstCfgLower = path.join(instanceDir, 'config');
    fs.mkdirSync(dstCfgUpper, { recursive: true });
    fs.mkdirSync(dstCfgLower, { recursive: true });

    for (const srcCfg of serverConfigSources) {
      if (!fs.existsSync(srcCfg)) continue;
      for (const item of fs.readdirSync(srcCfg, { withFileTypes: true })) {
        if (!item.isFile()) continue;
        if (/\.(srv|dat)$/i.test(item.name)) {
          try {
            fs.copyFileSync(path.join(srcCfg, item.name), path.join(dstCfgUpper, item.name));
            fs.copyFileSync(path.join(srcCfg, item.name), path.join(dstCfgLower, item.name));
          } catch {
            // Skip unreadable config file
          }
        }
      }
    }

    return dstExe;
  }

  installMasterEa(sourceDirInput?: string): {
    ok: boolean;
    eaPath: string;
    compiled: boolean;
    compileError: string | null;
    message: string;
  } {
    const settings = this.engine.getSettings();
    const sourceDir = (sourceDirInput || settings.mt5SourcePath || '').trim();
    if (sourceDir && sourceDir !== settings.mt5SourcePath) {
      this.engine.updateGlobalSettings({ mt5SourcePath: sourceDir });
    }

    const targetExpertsDir =
      process.platform === 'win32' && sourceDir && fs.existsSync(sourceDir)
        ? path.join(sourceDir, 'MQL5', 'Experts')
        : path.join(INSTANCES_ROOT, 'master_template', 'MQL5', 'Experts');

    fs.mkdirSync(targetExpertsDir, { recursive: true });
    const eaPath = path.join(targetExpertsDir, 'TradeSync_Master.mq5');
    fs.writeFileSync(eaPath, this.renderMasterEaSource(), 'utf8');

    if (process.platform !== 'win32') {
      return {
        ok: true,
        eaPath,
        compiled: false,
        compileError: null,
        message:
          'Generated token-configured TradeSync_Master.mq5 (v2.30) in workspace staging folder. Run on your Windows PC to install and compile directly into MT5 Experts.',
      };
    }

    if (!fs.existsSync(path.join(sourceDir, 'terminal64.exe'))) {
      return {
        ok: false,
        eaPath,
        compiled: false,
        compileError: `MT5 Master terminal64.exe not found in "${sourceDir}"`,
        message: `MT5 Master terminal64.exe was not found in "${sourceDir}". Select your installed MetaTrader 5 folder first.`,
      };
    }

    const compile = this.tryCompileMql5(sourceDir, eaPath, path.join(sourceDir, 'MQL5'));
    return {
      ok: true,
      eaPath,
      compiled: compile.compiled,
      compileError: compile.compileError,
      message: compile.compiled
        ? `TradeSync_Master.mq5 installed & compiled cleanly (.ex5 verified) in ${targetExpertsDir}.`
        : `TradeSync_Master.mq5 copied to ${targetExpertsDir}, but compile failed (${compile.compileError || 'check MetaEditor F7'}).`,
    };
  }

  provisionFollower(accountId: string, sourceDirInput?: string): {
    accountId: string;
    provisioned: boolean;
    eaCompiled: boolean;
    compileError: string | null;
    instanceDir: string;
    message: string;
  } {
    const acc = this.engine.getAccountsInternal().find((a) => a.id === accountId);
    if (!acc) throw new Error('Follower account not found');

    const settings = this.engine.getSettings();
    const sourceDir = (sourceDirInput || settings.mt5SourcePath || '').trim();
    if (sourceDir && sourceDir !== settings.mt5SourcePath) {
      this.engine.updateGlobalSettings({ mt5SourcePath: sourceDir });
    }

    const instanceDir = this.getInstanceDir(acc);
    const expertsDir = path.join(instanceDir, 'MQL5', 'Experts');
    fs.mkdirSync(expertsDir, { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'MQL5', 'Files'), { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'MQL5', 'Logs'), { recursive: true });

    this.writeLightweightMt5Configs(instanceDir, acc);
    const eaPath = path.join(expertsDir, 'TradeSync_Follower.mq5');
    fs.writeFileSync(eaPath, this.renderFollowerEaSource(), 'utf8');

    let eaCompiled = false;
    let compileError: string | null = null;
    let exePath = path.join(instanceDir, 'terminal64.exe');

    if (process.platform === 'win32') {
      exePath = this.copyMt5PortableFiles(sourceDir, instanceDir);
      const localMqlInclude = fs.existsSync(path.join(instanceDir, 'MQL5', 'Include'))
        ? path.join(instanceDir, 'MQL5')
        : path.join(sourceDir, 'MQL5');
      const compile = this.tryCompileMql5(sourceDir, eaPath, localMqlInclude);
      eaCompiled = compile.compiled;
      compileError = compile.compileError;
      this.engine.updateAccount(acc.id, { mt5TerminalPath: exePath });
    }

    this.syncRuntimeMap();
    const rt = this.runtimes.get(acc.id);
    if (rt) {
      rt.eaInstalled = fs.existsSync(eaPath);
      rt.eaCompiled = eaCompiled;
      rt.compileError = compileError;
      rt.provisioned =
        process.platform === 'win32'
          ? fs.existsSync(exePath) && rt.eaInstalled && eaCompiled
          : rt.eaInstalled;
      rt.lastMessage =
        process.platform === 'win32'
          ? eaCompiled
            ? 'Provisioned portable MT5 (.ex5 compiled, chart profile & broker configs ready)'
            : `Provisioned files, compile error: ${compileError || 'unknown'}`
          : 'Staged isolated profile, chart01.chr, preset .set & TradeSync_Follower.mq5 (ready for Windows binaries & compile)';
    }

    return {
      accountId: acc.id,
      provisioned: rt?.provisioned ?? true,
      eaCompiled,
      compileError,
      instanceDir,
      message:
        process.platform === 'win32'
          ? eaCompiled
            ? `Provisioned isolated portable MT5 for ${acc.login} at ${instanceDir} (DLLs, MQL5/Include, .srv configs, chart profile & .ex5 verified).`
            : `Provisioned files for ${acc.login}, but .ex5 compilation failed: ${compileError}`
          : `Staged isolated Follower profile, chart01.chr, preset & TradeSync_Follower.mq5 (v2.30) for ${acc.login}. Windows binaries & .ex5 compile run when executed on Windows.`,
    };
  }

  provisionAllFollowers(sourceDirInput?: string) {
    const followers = this.getFollowerAccounts();
    const results = followers.map((f) => {
      try {
        return this.provisionFollower(f.id, sourceDirInput);
      } catch (err) {
        return {
          accountId: f.id,
          provisioned: false,
          eaCompiled: false,
          compileError: err instanceof Error ? err.message : 'Provision failed',
          instanceDir: this.getInstanceDir(f),
          message: err instanceof Error ? err.message : 'Provision failed',
        };
      }
    });
    this.syncRuntimeMap();
    return {
      total: followers.length,
      provisionedCount: results.filter((r) => r.provisioned).length,
      compiledCount: results.filter((r) => r.eaCompiled).length,
      results,
      snapshot: this.getSnapshot(),
    };
  }

  async startFollower(accountId: string): Promise<{
    started: boolean;
    mode: string;
    message: string;
  }> {
    this.syncRuntimeMap();
    const acc = this.engine.getAccountsInternal().find((a) => a.id === accountId);
    if (!acc) throw new Error('Follower account not found');
    const rt = this.runtimes.get(accountId);

    if (this.processes.has(accountId)) {
      return {
        started: true,
        mode: 'already_running',
        message: `Follower ${acc.login} MT5 process is already active (PID ${rt?.pid}).`,
      };
    }

    const pwd = retrieveVaultCredential(acc.id);
    if (!pwd) {
      const msg = `Missing MT5 Trader Password for ${acc.login} in Windows DPAPI vault.`;
      if (rt) {
        rt.processState = 'error';
        rt.lastMessage = msg;
      }
      this.engine.markAccountRuntimeHeartbeat(acc.id, 'error', msg);
      return { started: false, mode: 'password_required', message: msg };
    }

    if (process.platform !== 'win32') {
      const msg = `Non-Windows preview host (${process.platform}): cannot spawn Windows terminal64.exe here. Profile & DPAPI vault check passed; click Start All on your local Windows PC to launch minimized MT5 processes.`;
      if (rt) {
        rt.processState = 'stopped';
        rt.lastMessage = msg;
      }
      return { started: false, mode: 'non_windows_host', message: msg };
    }

    const instanceDir = this.getInstanceDir(acc);
    const exePath = acc.mt5TerminalPath || path.join(instanceDir, 'terminal64.exe');
    const ex5Path = path.join(instanceDir, 'MQL5', 'Experts', 'TradeSync_Follower.ex5');
    if (!fs.existsSync(exePath) || !fs.existsSync(ex5Path)) {
      this.provisionFollower(accountId);
    }

    if (!fs.existsSync(exePath) || !fs.existsSync(ex5Path)) {
      const msg = `Provisioned MT5 executable or TradeSync_Follower.ex5 missing in "${instanceDir}". Run Provision All and verify compilation.`;
      if (rt) {
        rt.processState = 'error';
        rt.lastMessage = msg;
      }
      this.engine.markAccountRuntimeHeartbeat(acc.id, 'error', msg);
      return { started: false, mode: 'exe_or_ex5_not_found', message: msg };
    }

    const ini = this.engine.buildMt5StartupIni(acc.id, { password: pwd });
    const ephemeralIniPath = writeEphemeralLaunchIni(acc.login, ini.content);

    this.shouldBeRunning.add(acc.id);
    if (rt) {
      rt.processState = 'starting';
      rt.startedAt = new Date().toISOString();
      rt.lastMessage = 'Launching minimized portable MT5 (awaiting first EA heartbeat)...';
    }

    const child = spawn(exePath, ['/minimized', '/portable', `/config:${ephemeralIniPath}`], {
      cwd: instanceDir,
      detached: false,
      windowsHide: true,
      stdio: 'ignore',
    });

    this.processes.set(acc.id, child);
    if (rt) {
      rt.pid = child.pid ?? null;
      rt.processState = 'running';
      rt.lastMessage = `Running minimized (PID ${child.pid ?? 'active'}) — awaiting EA heartbeat`;
    }
    this.engine.markAccountRuntimeHeartbeat(acc.id, 'syncing', null);

    child.on('exit', (code) => {
      this.processes.delete(acc.id);
      const currentRt = this.runtimes.get(acc.id);
      if (currentRt) {
        currentRt.pid = null;
        currentRt.lastExitCode = typeof code === 'number' ? code : null;
        if (this.shouldBeRunning.has(acc.id)) {
          currentRt.crashCount += 1;
          currentRt.processState = 'crashed';
          currentRt.lastMessage = `Terminal exited unexpectedly (code ${code ?? 'unknown'}). Auto-restart scheduled.`;
          this.engine.markAccountRuntimeHeartbeat(acc.id, 'error', currentRt.lastMessage);
        } else {
          currentRt.processState = 'stopped';
          currentRt.lastMessage = 'Stopped cleanly';
        }
      }
    });

    return {
      started: true,
      mode: 'windows_process',
      message: `Started minimized portable MT5 for ${acc.login} (PID ${child.pid ?? 'active'}). Waiting for TradeSync_Follower EA heartbeat.`,
    };
  }

  stopFollower(accountId: string): { stopped: boolean; message: string } {
    this.shouldBeRunning.delete(accountId);
    this.startupQueue = this.startupQueue.filter((id) => id !== accountId);

    const child = this.processes.get(accountId);
    const rt = this.runtimes.get(accountId);
    if (child && child.pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 5000,
          });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited
        }
      }
      this.processes.delete(accountId);
    }

    if (rt) {
      rt.pid = null;
      rt.processState = 'stopped';
      rt.lastMessage = 'Stopped by user';
    }
    this.engine.markAccountRuntimeHeartbeat(accountId, 'disconnected', null);
    return { stopped: true, message: `Stopped Follower ${rt?.login || accountId}.` };
  }

  async restartFollower(accountId: string) {
    this.stopFollower(accountId);
    const rt = this.runtimes.get(accountId);
    if (rt) {
      rt.restartCount += 1;
      rt.processState = 'restarting';
    }
    await new Promise((r) => setTimeout(r, 600));
    return this.startFollower(accountId);
  }

  private async drainStartupQueue() {
    if (this.batchRunning) return;
    this.batchRunning = true;
    try {
      while (this.startupQueue.length > 0) {
        const settings = this.engine.getSettings();
        const maxConcurrent = Math.max(1, Math.min(10, settings.maxConcurrentStarts || 3));
        const delayMs = Math.max(400, settings.startupDelayMs || 1800);

        const batchIds = this.startupQueue.splice(0, maxConcurrent);
        await Promise.all(
          batchIds.map(async (id) => {
            this.activeStarts += 1;
            try {
              await this.startFollower(id);
            } finally {
              this.activeStarts = Math.max(0, this.activeStarts - 1);
            }
          })
        );

        if (this.startupQueue.length > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    } finally {
      this.batchRunning = false;
    }
  }

  async startAllFollowers() {
    this.syncRuntimeMap();
    const followers = this.getFollowerAccounts().filter((f) => f.copyEnabled);
    this.saveDesiredFarmActive(followers.length > 0);

    if (process.platform !== 'win32') {
      const results = await Promise.all(followers.map((f) => this.startFollower(f.id)));
      return {
        started: false,
        queued: 0,
        mode: 'non_windows_host',
        message:
          'Cloud preview runs on Linux so Windows MT5 terminal64.exe processes cannot spawn here. All configs are ready; click Start All Followers on your Windows PC.',
        results,
        snapshot: this.getSnapshot(),
      };
    }

    for (const f of followers) {
      const rt = this.runtimes.get(f.id);
      if (!this.processes.has(f.id) && !this.startupQueue.includes(f.id)) {
        if (rt) rt.processState = 'queued';
        this.startupQueue.push(f.id);
      }
    }

    void this.drainStartupQueue();
    return {
      started: true,
      queued: this.startupQueue.length,
      mode: 'windows_batch_queue',
      message: `Queued ${this.startupQueue.length} enabled Followers in controlled batches.`,
      snapshot: this.getSnapshot(),
    };
  }

  stopAllFollowers() {
    this.saveDesiredFarmActive(false);
    this.startupQueue = [];
    this.shouldBeRunning.clear();
    const followers = this.getFollowerAccounts();
    for (const f of followers) {
      this.stopFollower(f.id);
    }
    return {
      stoppedCount: followers.length,
      snapshot: this.getSnapshot(),
    };
  }

  async restartAllFollowers() {
    this.stopAllFollowers();
    await new Promise((r) => setTimeout(r, 800));
    return this.startAllFollowers();
  }
}
