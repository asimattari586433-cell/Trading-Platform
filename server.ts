import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { LocalAuthManager } from './server/auth.ts';
import { TradeCopierEngine } from './server/engine.ts';
import { Mt5Manager } from './server/mt5Manager.ts';
import { buildZipArchive, collectWorkspaceForZip } from './server/zip.ts';
import type { Timeframe } from './src/types/trading.ts';

async function startServer() {
  const HOST = process.env.HOST || (process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');
  const PORT = Number(process.env.PORT || 3000);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const auth = new LocalAuthManager();
  const engine = new TradeCopierEngine();
  const mt5Manager = new Mt5Manager(engine);

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const broadcast = (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  engine.subscribe((event) => {
    if (event === 'tick') {
      broadcast({ type: 'tick', payload: engine.getTickPayload() });
    } else if (event === 'state_changed') {
      broadcast({ type: 'state_changed', payload: engine.getSnapshot() });
    }
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (reqUrl.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      // Same-Origin enforcement when Origin header is present
      const originHeader = req.headers.origin;
      if (originHeader && req.headers.host) {
        try {
          const originHost = new URL(originHeader).host;
          if (originHost !== req.headers.host) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      const cookieToken = auth.parseCookieToken(req.headers.cookie);
      const validSession = auth.verifySessionToken(cookieToken);
      const wsTicket = reqUrl.searchParams.get('wsTicket');
      const validTicket = !validSession && auth.consumeWsTicket(wsTicket);

      if (!validSession && !validTicket) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'snapshot', payload: engine.getSnapshot() }));
  });

  // --- Operator Authentication Routes ---
  app.get('/api/auth/status', (req, res) => {
    const session = auth.authenticateRequest(req);
    res.json({
      authenticated: Boolean(session),
      initialized: auth.isInitialized(),
      username: auth.getUsername(),
      hostBind: HOST,
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    try {
      const password = String(req.body?.password || '');
      const username = String(req.body?.username || 'operator');
      const result = auth.setupOperatorPassword(password, username);
      auth.setSessionCookie(res, result.token, req);
      res.status(201).json({
        authenticated: true,
        initialized: true,
        username: result.username,
        hostBind: HOST,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Setup failed' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    if (!auth.isInitialized()) {
      return res.status(400).json({ error: 'Operator password is not configured yet. Complete initial setup first.' });
    }
    const password = String(req.body?.password || '');
    const username = req.body?.username ? String(req.body.username) : undefined;
    const verified = auth.verifyLogin(password, username);
    if (!verified) {
      return res.status(401).json({ error: 'Invalid operator credentials.' });
    }
    auth.setSessionCookie(res, verified.token, req);
    res.json({
      authenticated: true,
      initialized: true,
      username: verified.username,
      hostBind: HOST,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = auth.extractRequestToken(req);
    auth.revokeSessionToken(token);
    auth.clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', auth.requireOperator, (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      const result = auth.changePassword(currentPassword, newPassword);
      auth.setSessionCookie(res, result.token, req);
      res.json({ ok: true, username: result.username });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Password change failed' });
    }
  });

  app.get('/api/auth/ws-ticket', auth.requireOperator, (req, res) => {
    const session = auth.authenticateRequest(req);
    const wsTicket = auth.issueWsTicket(session?.sub || auth.getUsername());
    res.json({ wsTicket });
  });

  app.get('/api/auth/bridge-token', auth.requireOperator, (_req, res) => {
    res.json({ bridgeToken: engine.getBridgeToken() });
  });

  app.post('/api/auth/bridge-token/rotate', auth.requireOperator, (_req, res) => {
    const bridgeToken = engine.rotateBridgeToken();
    res.json({ bridgeToken });
  });

  // --- Protected Operator REST API Routes ---
  app.get('/api/state', auth.requireOperator, (_req, res) => {
    res.json(engine.getSnapshot());
  });

  app.get('/api/candles', auth.requireOperator, (req, res) => {
    const symbol = String(req.query.symbol || 'EURUSD').toUpperCase();
    const timeframe = String(req.query.timeframe || 'M15') as Timeframe;
    res.json({ symbol, timeframe, candles: engine.getCandles(symbol, timeframe) });
  });

  app.post('/api/accounts', auth.requireOperator, async (req, res) => {
    try {
      const account = await engine.connectAccount(req.body);
      const launch =
        req.body?.autoLaunchMt5 && account.connectionMethod === 'mql5_ea'
          ? engine.launchMt5Terminal(account.id, {
              password: req.body.password,
              terminalPath: req.body.mt5TerminalPath,
            })
          : undefined;
      res.status(201).json({ account, launch });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to connect account' });
    }
  });

  app.post('/api/accounts/:id/launch-mt5', auth.requireOperator, (req, res) => {
    try {
      const result = engine.launchMt5Terminal(req.params.id, req.body || {});
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Failed to launch MT5 terminal' });
    }
  });

  app.post('/api/accounts/:id/credential', auth.requireOperator, (req, res) => {
    try {
      const account = engine.setAccountCredential(req.params.id, String(req.body?.password || ''));
      res.json({ account });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to store credential' });
    }
  });

  app.get('/api/accounts/:id/mt5-config.ini', auth.requireOperator, (req, res) => {
    try {
      const ini = engine.buildMt5StartupIni(req.params.id, { includeBlankPlaceholderOnly: true });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${ini.filename}"`);
      res.send(ini.content);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Account not found' });
    }
  });

  app.post('/api/accounts/bulk', auth.requireOperator, (req, res) => {
    try {
      const accounts = engine.bulkProvisionFollowers(req.body);
      res.status(201).json({ count: accounts.length, accounts });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bulk import failed' });
    }
  });

  app.post('/api/accounts/bulk-toggle', auth.requireOperator, (req, res) => {
    try {
      engine.bulkToggleFollowers(Boolean(req.body.copyEnabled), req.body.masterId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bulk toggle failed' });
    }
  });

  app.patch('/api/accounts/:id', auth.requireOperator, (req, res) => {
    try {
      const account = engine.updateAccount(req.params.id, req.body);
      res.json({ account });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Account update failed' });
    }
  });

  app.delete('/api/accounts/:id', auth.requireOperator, (req, res) => {
    engine.removeAccount(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/copier/settings', auth.requireOperator, (req, res) => {
    const settings = engine.updateGlobalSettings(req.body);
    res.json({ settings });
  });

  app.post('/api/setup/complete', auth.requireOperator, (_req, res) => {
    const settings = engine.updateGlobalSettings({ setupCompleted: true });
    res.json({ ok: true, settings });
  });

  app.get('/api/config/export', auth.requireOperator, (_req, res) => {
    const bundle = engine.exportMigrationConfig();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tradesync-pc-migration.json"');
    res.send(JSON.stringify(bundle, null, 2));
  });

  app.post('/api/config/import', auth.requireOperator, (req, res) => {
    try {
      const result = engine.importMigrationConfig(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Config import failed' });
    }
  });

  // Automatic Multi-MT5 Follower Manager routes (Operator-protected)
  app.get('/api/mt5-manager/status', auth.requireOperator, (_req, res) => {
    res.json(mt5Manager.getSnapshot());
  });

  app.post('/api/mt5-manager/detect', auth.requireOperator, (_req, res) => {
    res.json(mt5Manager.detectMt5Installations());
  });

  app.post('/api/mt5-manager/install-master-ea', auth.requireOperator, (req, res) => {
    try {
      const result = mt5Manager.installMasterEa(req.body?.sourceDir);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to install Master EA' });
    }
  });

  app.post('/api/mt5-manager/provision-all', auth.requireOperator, (req, res) => {
    try {
      const result = mt5Manager.provisionAllFollowers(req.body?.sourceDir);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Provision all failed' });
    }
  });

  app.post('/api/mt5-manager/followers/start-all', auth.requireOperator, async (_req, res) => {
    try {
      const result = await mt5Manager.startAllFollowers();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Start all failed' });
    }
  });

  app.post('/api/mt5-manager/followers/stop-all', auth.requireOperator, (_req, res) => {
    res.json(mt5Manager.stopAllFollowers());
  });

  app.post('/api/mt5-manager/followers/restart-all', auth.requireOperator, async (_req, res) => {
    try {
      const result = await mt5Manager.restartAllFollowers();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Restart all failed' });
    }
  });

  app.post('/api/mt5-manager/followers/:id/provision', auth.requireOperator, (req, res) => {
    try {
      const result = mt5Manager.provisionFollower(req.params.id, req.body?.sourceDir);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Follower provision failed' });
    }
  });

  app.post('/api/mt5-manager/followers/:id/start', auth.requireOperator, async (req, res) => {
    try {
      const result = await mt5Manager.startFollower(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Follower start failed' });
    }
  });

  app.post('/api/mt5-manager/followers/:id/stop', auth.requireOperator, (req, res) => {
    try {
      const result = mt5Manager.stopFollower(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Follower stop failed' });
    }
  });

  app.post('/api/mt5-manager/followers/:id/restart', auth.requireOperator, async (req, res) => {
    try {
      const result = await mt5Manager.restartFollower(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Follower restart failed' });
    }
  });

  app.post('/api/trades/open', auth.requireOperator, (req, res) => {
    try {
      const result = engine.openMasterTrade(req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Order execution failed' });
    }
  });

  app.post('/api/trades/modify', auth.requireOperator, (req, res) => {
    try {
      const result = engine.modifyPosition(req.body.positionId, req.body.sl ?? null, req.body.tp ?? null);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Modify failed' });
    }
  });

  app.post('/api/trades/close', auth.requireOperator, (req, res) => {
    try {
      const closeLots = req.body?.closeLots ? Number(req.body.closeLots) : undefined;
      const result = engine.closePosition(req.body.positionId, undefined, closeLots);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Close failed' });
    }
  });

  app.post('/api/trades/close-all', auth.requireOperator, (req, res) => {
    const result = engine.closeAllPositions(req.body?.masterAccountId);
    res.json(result);
  });

  app.get('/api/windows-package.zip', auth.requireOperator, (_req, res) => {
    try {
      const entries = collectWorkspaceForZip(process.cwd());
      const zipBuffer = buildZipArchive(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="TradeSync-MT5-Windows-Local.zip"');
      res.send(zipBuffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build ZIP package' });
    }
  });

  app.post('/api/bridge/test', auth.requireOperator, (req, res) => {
    try {
      const snap = engine.getSnapshot();
      const master = snap.accounts.find((a) => a.role === 'master');
      if (!master) {
        return res.status(400).json({ error: 'No Master account available for bridge test' });
      }
      const result = engine.handleBridgeMasterEvent({
        token: engine.getBridgeToken(),
        action: 'OPEN',
        masterLogin: master.login,
        server: master.server,
        externalTicket: `MT5-${Math.floor(100000 + Math.random() * 899999)}`,
        symbol: req.body?.symbol || 'EURUSD',
        side: req.body?.side || 'BUY',
        lots: Number(req.body?.lots) || 0.1,
        sl: null,
        tp: null,
      });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Bridge test failed' });
    }
  });

  // --- MQL5 Bridge Endpoints (Protected via x-bridge-token constant-time check) ---
  app.get('/api/bridge/master/commands', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || '');
      const login = String(req.query.login || '');
      const commands = engine.pollMasterBridgeCommands(token, login);
      res.json({ commands });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized master poll' });
    }
  });

  app.post('/api/bridge/master/ack', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || req.body?.token || '');
      const result = engine.ackMasterBridgeCommand({ ...req.body, token });
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized master ack' });
    }
  });

  app.post('/api/bridge/master/sync', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || req.body?.token || '');
      const result = engine.handleBridgeMasterSync({ ...req.body, token });
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized master sync' });
    }
  });

  app.post('/api/bridge/master/event', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || req.body?.token || '');
      const result = engine.handleBridgeMasterEvent({ ...req.body, token });
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Bridge error' });
    }
  });

  app.post('/api/bridge/master/ticks', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || req.body?.token || '');
      const ticks = Array.isArray(req.body.ticks) ? req.body.ticks : [];
      const result = engine.ingestBrokerTicks(token, ticks);
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid bridge tick payload' });
    }
  });

  app.post('/api/bridge/indicator', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || req.body?.token || '');
      const overlay = engine.ingestCustomIndicator(token, req.body);
      res.json({ overlay });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Indicator upload failed' });
    }
  });

  app.get('/api/bridge/slave/commands', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || '');
      const login = String(req.query.login || '');
      const balance = req.query.balance ? Number(req.query.balance) : undefined;
      const equity = req.query.equity ? Number(req.query.equity) : undefined;
      const openCount = req.query.openCount ? Number(req.query.openCount) : undefined;
      const cent = req.query.cent !== undefined ? String(req.query.cent) === 'true' || String(req.query.cent) === '1' : undefined;
      const accountCurrency =
        req.query.accountCurrency
          ? String(req.query.accountCurrency)
          : req.query.currency
            ? String(req.query.currency)
            : undefined;
      const commands = engine.pollBridgeCommands(token, login, {
        balance,
        equity,
        openCount,
        cent,
        accountCurrency,
      });
      res.json({ commands });
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized bridge poll' });
    }
  });

  app.post('/api/bridge/slave/ack', (req, res) => {
    try {
      const token = String(req.headers['x-bridge-token'] || req.body?.token || '');
      const result = engine.ackBridgeCommand({ ...req.body, token });
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized bridge ack' });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`TradeSync MT5 server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
