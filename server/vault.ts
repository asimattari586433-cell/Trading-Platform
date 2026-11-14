import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const TEMP_INI_DIR = path.join(DATA_DIR, 'mt5-configs');

const sessionMemoryVault = new Map<string, string>();
const activeShredTimers = new Map<string, NodeJS.Timeout>();

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeId(accountId: string): string {
  return accountId.replace(/[^a-zA-Z0-9_-]/g, '');
}

function dpapiFilePath(accountId: string): string {
  return path.join(VAULT_DIR, `${sanitizeId(accountId)}.dpapi`);
}

export function getVaultMethod(): 'windows_dpapi' | 'session_memory_only' {
  return process.platform === 'win32' ? 'windows_dpapi' : 'session_memory_only';
}

/**
 * Encrypts & persists a credential using native Windows DPAPI (CurrentUser scope).
 * On non-Windows hosts (e.g. Linux dev/preview), keeps the credential strictly in RAM
 * and never writes plaintext passwords to disk, logs, CSVs, or exported backups.
 */
export function storeVaultCredential(accountId: string, secret: string): boolean {
  const cleanSecret = secret.trim();
  if (!cleanSecret) return false;

  sessionMemoryVault.set(accountId, cleanSecret);

  if (process.platform !== 'win32') {
    return true;
  }

  try {
    ensureDir(VAULT_DIR);
    const outFile = dpapiFilePath(accountId);
    const psScript = [
      'Add-Type -AssemblyName System.Security;',
      '$plain = [System.Environment]::GetEnvironmentVariable("TS_VAULT_SECRET");',
      'if (-not $plain) { exit 2 };',
      '$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain);',
      '$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
      '[System.IO.File]::WriteAllText($env:TS_VAULT_PATH, [Convert]::ToBase64String($enc));',
    ].join(' ');

    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      env: {
        ...process.env,
        TS_VAULT_SECRET: cleanSecret,
        TS_VAULT_PATH: outFile,
      },
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch (err) {
    console.error('Windows DPAPI vault store failed:', err);
    return false;
  }
}

export function retrieveVaultCredential(accountId: string): string | null {
  const cached = sessionMemoryVault.get(accountId);
  if (cached) return cached;

  if (process.platform !== 'win32') {
    return null;
  }

  const inFile = dpapiFilePath(accountId);
  if (!fs.existsSync(inFile)) {
    return null;
  }

  try {
    const psScript = [
      'Add-Type -AssemblyName System.Security;',
      '$b64 = [System.IO.File]::ReadAllText($env:TS_VAULT_PATH).Trim();',
      '$enc = [Convert]::FromBase64String($b64);',
      '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
      '[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($dec));',
    ].join(' ');

    const plain = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      {
        env: { ...process.env, TS_VAULT_PATH: inFile },
        encoding: 'utf8',
        timeout: 5000,
      }
    ).trim();

    if (plain) {
      sessionMemoryVault.set(accountId, plain);
      return plain;
    }
    return null;
  } catch {
    return null;
  }
}

export function hasVaultCredential(accountId: string): boolean {
  if (sessionMemoryVault.has(accountId)) return true;
  if (process.platform === 'win32') {
    return fs.existsSync(dpapiFilePath(accountId));
  }
  return false;
}

export function deleteVaultCredential(accountId: string) {
  sessionMemoryVault.delete(accountId);
  try {
    const file = dpapiFilePath(accountId);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // ignore cleanup error
  }
}

export function sweepTemporaryLaunchConfigs() {
  try {
    if (!fs.existsSync(TEMP_INI_DIR)) return;
    for (const entry of fs.readdirSync(TEMP_INI_DIR)) {
      if (entry.startsWith('tmp_') && entry.endsWith('.ini')) {
        try {
          fs.unlinkSync(path.join(TEMP_INI_DIR, entry));
        } catch {
          // ignore locked/in-use error
        }
      }
    }
  } catch {
    // ignore sweep error
  }
}

export function shredFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      if (size > 0) {
        fs.writeFileSync(filePath, '\0'.repeat(Math.min(4096, size)), 'utf8');
      }
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup error
  }
}

/**
 * Writes an ephemeral MT5 /config ini strictly for immediate process spawn and shreds
 * the temporary file automatically once terminal64.exe has read it (~12 seconds).
 */
export function writeEphemeralLaunchIni(login: string, content: string): string {
  ensureDir(TEMP_INI_DIR);
  const safeLogin = login.replace(/[^a-zA-Z0-9_-]/g, '') || 'mt5';
  const filePath = path.join(TEMP_INI_DIR, `tmp_${safeLogin}_${Date.now()}.ini`);
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });

  const prevTimer = activeShredTimers.get(filePath);
  if (prevTimer) clearTimeout(prevTimer);

  const timer = setTimeout(() => {
    shredFile(filePath);
    activeShredTimers.delete(filePath);
  }, 12000);
  timer.unref?.();
  activeShredTimers.set(filePath, timer);

  return filePath;
}
