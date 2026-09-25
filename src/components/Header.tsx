import React from 'react';
import { Zap, Shield, LogOut, User as UserIcon, RefreshCw, Key, Smartphone } from 'lucide-react';
import { User, BalanceState } from '../types.ts';

interface HeaderProps {
  user: User | null;
  balance: BalanceState | null;
  onLogout: () => void;
  onOpenAuth: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenAdmin?: () => void;
  onOpenApkModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  balance,
  onLogout,
  onOpenAuth,
  onRefresh,
  isRefreshing,
  onOpenAdmin,
  onOpenApkModal,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full bg-[#070b14]/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-emerald-400 p-[1px] shadow-lg shadow-cyan-500/20">
            <div className="w-full h-full bg-[#080d1a] rounded-[11px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-cyan-400 fill-cyan-400/30" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-tight text-white text-base sm:text-lg">
                Coin<span className="text-cyan-400">Pulse</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 font-mono font-semibold">
                CORE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">Production Mining Network</p>
          </div>
        </div>

        {/* Balance & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* APK Button */}
          {onOpenApkModal && (
            <button
              onClick={onOpenApkModal}
              title="Download Android APK"
              className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/70 text-emerald-300 hover:bg-emerald-900/60 text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Get APK</span>
            </button>
          )}

          {user ? (
            <>
              {/* Balance Card */}
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
                  Total Balance
                </span>
                <div className="flex items-center gap-1 font-mono font-bold text-white text-sm sm:text-base">
                  <span className="text-cyan-400">⚡</span>
                  <span>{balance ? balance.balance.toFixed(4) : '0.0000'}</span>
                  <span className="text-xs font-semibold text-slate-400">CP</span>
                </div>
              </div>

              {/* Refresh Button */}
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                title="Sync server state"
                aria-label="Sync server state"
                className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-cyan-300 hover:bg-slate-850 active:scale-95 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
              </button>

              {/* User / Role Badge */}
              <div className="flex items-center gap-1.5">
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                  <UserIcon className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-200 font-medium truncate max-w-[90px]">
                    {user.username}
                  </span>
                  {user.role === 'admin' && (
                    <span className="px-1 py-0.5 rounded bg-red-950/80 border border-red-800/60 text-[9px] font-mono text-red-300 font-bold uppercase">
                      Admin
                    </span>
                  )}
                </div>

                {user.role === 'admin' && onOpenAdmin && (
                  <button
                    onClick={onOpenAdmin}
                    title="Open Administrator Portal"
                    className="p-2 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 hover:bg-red-900/50 transition-all text-xs font-semibold flex items-center gap-1"
                  >
                    <Shield className="w-4 h-4 text-red-400" />
                    <span className="hidden md:inline">Admin</span>
                  </button>
                )}

                {/* Sign Out */}
                <button
                  onClick={onLogout}
                  title="Sign Out"
                  aria-label="Sign Out"
                  className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-900/60 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={onOpenAuth}
              className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-sky-600 hover:from-cyan-400 hover:to-sky-500 text-slate-950 font-bold text-xs sm:text-sm shadow-md shadow-cyan-500/20 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Sign In / Join</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

