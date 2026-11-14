import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth-config.json');
export const SESSION_COOKIE_NAME = 'ts_session';

interface AuthConfigFile {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionSecret: string;
  createdAt: string;
}

interface SessionPayload {
  sub: string;
  role: 'operator';
  iat: number;
  exp: number;
  jti: string;
}

interface WsTicketRecord {
  username: string;
  expiresAt: number;
}

export class LocalAuthManager {
  private config: AuthConfigFile | null = null;
  private runtimeSecret: string;
  private wsTickets: Map<string, WsTicketRecord> = new Map();
  private revokedSessions: Set<string> = new Set();

  constructor() {
    this.runtimeSecret = crypto.randomBytes(32).toString('hex');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as AuthConfigFile;
        if (parsed && parsed.passwordHash && parsed.passwordSalt && parsed.sessionSecret) {
          this.config = parsed;
          return;
        }
      }
    } catch {
      // ignore corrupted file and treat as uninitialized
    }

    const envPass = process.env.TRADESYNC_ADMIN_PASSWORD?.trim();
    if (envPass && envPass.length >= 6) {
      this.setupOperatorPassword(envPass, 'operator');
    }
  }

  private save(cfg: AuthConfigFile) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
    this.config = cfg;
  }

  isInitialized(): boolean {
    return this.config !== null;
  }

  getUsername(): string {
    return this.config?.username || 'operator';
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  setupOperatorPassword(password: string, username = 'operator'): { token: string; username: string } {
    if (this.config !== null) {
      throw new Error('Operator password is already configured. Please sign in.');
    }
    const cleanPwd = password.trim();
    if (cleanPwd.length < 6) {
      throw new Error('Operator password must be at least 6 characters.');
    }
    const cleanUser = username.trim() || 'operator';
    const salt = crypto.randomBytes(16).toString('hex');
    const cfg: AuthConfigFile = {
      username: cleanUser,
      passwordSalt: salt,
      passwordHash: this.hashPassword(cleanPwd, salt),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    this.save(cfg);
    return { token: this.issueSessionToken(cleanUser), username: cleanUser };
  }

  verifyLogin(password: string, username?: string): { token: string; username: string } | null {
    if (!this.config) return null;
    if (username && username.trim() && username.trim() !== this.config.username) {
      return null;
    }
    const cleanPwd = password.trim();
    if (!cleanPwd) return null;

    const candidateHex = this.hashPassword(cleanPwd, this.config.passwordSalt);
    const expectedBuf = Buffer.from(this.config.passwordHash, 'hex');
    const candidateBuf = Buffer.from(candidateHex, 'hex');
    if (expectedBuf.length !== candidateBuf.length) return null;
    if (!crypto.timingSafeEqual(expectedBuf, candidateBuf)) return null;

    return {
      token: this.issueSessionToken(this.config.username),
      username: this.config.username,
    };
  }

  changePassword(currentPassword: string, newPassword: string): { token: string; username: string } {
    if (!this.config) throw new Error('Operator auth is not initialized yet.');
    const verified = this.verifyLogin(currentPassword);
    if (!verified) throw new Error('Current password is incorrect.');
    const cleanNew = newPassword.trim();
    if (cleanNew.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const cfg: AuthConfigFile = {
      username: this.config.username,
      passwordSalt: salt,
      passwordHash: this.hashPassword(cleanNew, salt),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      createdAt: this.config.createdAt,
    };
    this.save(cfg);
    return { token: this.issueSessionToken(cfg.username), username: cfg.username };
  }

  private getSigningSecret(): string {
    return this.config?.sessionSecret || this.runtimeSecret;
  }

  issueSessionToken(username: string, ttlSeconds = 60 * 60 * 24 * 7): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
      sub: username,
      role: 'operator',
      iat: now,
      exp: now + ttlSeconds,
      jti: crypto.randomUUID(),
    };
    const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(bodyB64)
      .digest('base64url');
    return `${bodyB64}.${sig}`;
  }

  verifySessionToken(token: string | undefined | null): SessionPayload | null {
    if (!token || !this.config) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [bodyB64, sigB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.getSigningSecret())
      .update(bodyB64)
      .digest('base64url');

    const a = Buffer.from(sigB64, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as SessionPayload;
      if (parsed.role !== 'operator') return null;
      if (this.revokedSessions.has(parsed.jti)) return null;
      const now = Math.floor(Date.now() / 1000);
      if (!parsed.exp || parsed.exp < now) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  revokeSessionToken(token: string | undefined | null) {
    const parsed = this.verifySessionToken(token);
    if (parsed) {
      this.revokedSessions.add(parsed.jti);
    }
  }

  parseCookieToken(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) return null;
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const key = pair.slice(0, idx).trim();
      if (key === SESSION_COOKIE_NAME) {
        return decodeURIComponent(pair.slice(idx + 1).trim());
      }
    }
    return null;
  }

  extractRequestToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const t = authHeader.slice(7).trim();
      if (t) return t;
    }
    return this.parseCookieToken(req.headers.cookie);
  }

  authenticateRequest(req: Request): SessionPayload | null {
    const token = this.extractRequestToken(req);
    return this.verifySessionToken(token);
  }

  requireOperator = (req: Request, res: Response, next: NextFunction) => {
    const session = this.authenticateRequest(req);
    if (!session) {
      res.status(401).json({
        error: this.isInitialized()
          ? 'Authentication required. Please sign in.'
          : 'First-run operator password setup required.',
      });
      return;
    }
    next();
  };

  issueWsTicket(username: string): string {
    const now = Date.now();
    for (const [k, v] of this.wsTickets.entries()) {
      if (v.expiresAt < now) this.wsTickets.delete(k);
    }
    const ticket = crypto.randomBytes(24).toString('base64url');
    this.wsTickets.set(ticket, { username, expiresAt: now + 30_000 });
    return ticket;
  }

  consumeWsTicket(ticket: string | null | undefined): boolean {
    if (!ticket) return false;
    const rec = this.wsTickets.get(ticket);
    if (!rec) return false;
    this.wsTickets.delete(ticket);
    return rec.expiresAt >= Date.now();
  }

  setSessionCookie(res: Response, token: string, req: Request) {
    const isHttps =
      req.secure ||
      String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    const parts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'HttpOnly',
      'Path=/',
      `Max-Age=${60 * 60 * 24 * 7}`,
      isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
    ];
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  clearSessionCookie(res: Response, req: Request) {
    const isHttps =
      req.secure ||
      String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    const parts = [
      `${SESSION_COOKIE_NAME}=`,
      'HttpOnly',
      'Path=/',
      'Max-Age=0',
      isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
    ];
    res.setHeader('Set-Cookie', parts.join('; '));
  }
}

export function verifyBridgeTokenConstantTime(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
