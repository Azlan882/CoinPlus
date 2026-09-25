import React from 'react';
import { Zap, Users, FileText, Layers, Shield } from 'lucide-react';
import { TabType, User } from '../types.ts';

interface BottomNavProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  user: User | null;
  activeMinersCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  user,
  activeMinersCount = 0,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#070b14]/95 backdrop-blur-lg border-t border-slate-800/80 px-2 py-2 safe-area-pb">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {/* Mining Tab */}
        <button
          onClick={() => onSelectTab('mining')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
            currentTab === 'mining'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-all ${
              currentTab === 'mining' ? 'bg-cyan-950 border border-cyan-800/70 shadow-md shadow-cyan-500/20' : ''
            }`}
          >
            <Zap className="w-5 h-5 fill-current" />
          </div>
          <span className="text-[10px] font-mono tracking-tight">Mine</span>
        </button>

        {/* Team / Referrals Tab */}
        <button
          onClick={() => onSelectTab('team')}
          className={`relative flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
            currentTab === 'team'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-all ${
              currentTab === 'team' ? 'bg-cyan-950 border border-cyan-800/70 shadow-md shadow-cyan-500/20' : ''
            }`}
          >
            <Users className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-mono tracking-tight">Team</span>
          {activeMinersCount > 0 && (
            <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>

        {/* Ledger Tab */}
        <button
          onClick={() => onSelectTab('ledger')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
            currentTab === 'ledger'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-all ${
              currentTab === 'ledger' ? 'bg-cyan-950 border border-cyan-800/70 shadow-md shadow-cyan-500/20' : ''
            }`}
          >
            <FileText className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-mono tracking-tight">Ledger</span>
        </button>

        {/* Blockchain Blueprint Tab */}
        <button
          onClick={() => onSelectTab('roadmap')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
            currentTab === 'roadmap'
              ? 'text-cyan-400 font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div
            className={`p-1.5 rounded-xl transition-all ${
              currentTab === 'roadmap' ? 'bg-cyan-950 border border-cyan-800/70 shadow-md shadow-cyan-500/20' : ''
            }`}
          >
            <Layers className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-mono tracking-tight">Roadmap</span>
        </button>

        {/* Admin Tab (only if user role is admin) */}
        {user?.role === 'admin' && (
          <button
            onClick={() => onSelectTab('admin')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              currentTab === 'admin'
                ? 'text-red-400 font-bold'
                : 'text-slate-400 hover:text-red-300'
            }`}
          >
            <div
              className={`p-1.5 rounded-xl transition-all ${
                currentTab === 'admin' ? 'bg-red-950 border border-red-800/70 shadow-md shadow-red-500/20' : ''
              }`}
            >
              <Shield className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono tracking-tight">Admin</span>
          </button>
        )}
      </div>
    </nav>
  );
};
