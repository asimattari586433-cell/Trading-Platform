import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import type { AuthStatus } from '../types/trading.ts';

interface AuthGateModalProps {
  authStatus: AuthStatus;
  onAuthenticated: (next: AuthStatus) => void;
}

export const AuthGateModal: React.FC<AuthGateModalProps> = ({
  authStatus,
  onAuthenticated,
}) => {
  const isSetup = !authStatus.initialized;
  const [username, setUsername] = useState(authStatus.username || 'operator');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.trim().length < 6) {
        setError('Operator password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      const endpoint = isSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as AuthStatus & { error?: string };
      if (!res.ok) {
        setError(data.error || 'Authentication failed.');
        return;
      }
      onAuthenticated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error connecting to TradeSync engine.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F17] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-blue-600/10 border border-blue-500/20 text-blue-500 shrink-0">
            {isSetup ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white">
              {isSetup ? 'Secure Your TradeSync MT5 Workstation' : 'TradeSync MT5 Operator Sign In'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {isSetup
                ? 'First-run setup: create a local operator password to protect live trading, follower accounts, MT5 Farm controls, and bridge tokens.'
                : 'Enter your local operator password to unlock live trading, accounts, and MT5 Farm telemetry.'}
            </p>
          </div>
        </div>

        <div className="px-3 py-2 rounded-md bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-300 flex items-center justify-between">
          <span>Server Bind Address</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            {authStatus.hostBind || '127.0.0.1'}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Operator Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              {isSetup ? 'Create Password (min 6 chars)' : 'Operator Password'}
            </label>
            <input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {isSetup && (
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Confirm Operator Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
          >
            {busy
              ? 'Verifying...'
              : isSetup
                ? 'Save Password & Enter Terminal'
                : 'Unlock TradeSync Terminal'}
          </button>
        </form>
      </div>
    </div>
  );
};
