import React from 'react';
import { LogOut } from 'lucide-react';
import type { Lang } from '../i18n.ts';
import { COPY_TEXT } from '../i18n.ts';

export type NavTab = 'terminal' | 'accounts' | 'manager' | 'rules' | 'bridge';

interface TopBarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenConnectModal: () => void;
  onOpenSetupWizard?: () => void;
  onLogout?: () => void;
  username?: string;
  lang: Lang;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onOpenConnectModal,
  onOpenSetupWizard,
  onLogout,
  username,
  lang,
}) => {
  const t = COPY_TEXT[lang];
  const tabs: Array<{ id: NavTab; label: string }> = [
    { id: 'terminal', label: t.navTerminal },
    { id: 'accounts', label: t.navAccounts },
    { id: 'manager', label: t.navManager },
    { id: 'rules', label: t.navRules },
    { id: 'bridge', label: t.navBridge },
  ];

  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1520] px-6 flex items-center justify-between gap-6 shrink-0">
      {/* Zone 1: Brand wordmark */}
      <a
        href="#terminal"
        onClick={(e) => {
          e.preventDefault();
          onSelectTab('terminal');
        }}
        className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
      >
        {t.brand}
      </a>

      {/* Zone 2: Clean single-line navigation links */}
      <nav className="flex items-center gap-6 overflow-x-auto">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'border-blue-600 text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Primary actions */}
      <div className="flex items-center gap-2 shrink-0">
        {onOpenSetupWizard && (
          <button
            type="button"
            onClick={onOpenSetupWizard}
            className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Setup Wizard
          </button>
        )}
        <button
          type="button"
          onClick={onOpenConnectModal}
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {t.connectAccount}
        </button>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            title={username ? `Sign out (${username})` : 'Sign out'}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:border-rose-500 hover:text-rose-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lock</span>
          </button>
        )}
      </div>
    </header>
  );
};
