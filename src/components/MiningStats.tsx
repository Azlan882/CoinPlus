import React from 'react';
import { TrendingUp, Users, Award, ShieldCheck, Flame, Cpu } from 'lucide-react';
import { User, BalanceState, MiningStatusResponse } from '../types.ts';

interface MiningStatsProps {
  user: User;
  balance: BalanceState | null;
  miningStatus: MiningStatusResponse | null;
}

export const MiningStats: React.FC<MiningStatsProps> = ({ user, balance, miningStatus }) => {
  const baseRate = miningStatus?.baseMiningRate ?? user.baseMiningRate ?? 0.12;
  const bonusRate = miningStatus?.bonusMiningRate ?? user.bonusMiningRate ?? 0.0;
  const totalRate = miningStatus?.totalMiningRate ?? user.totalMiningRate ?? 0.12;
  const activeReferrals = miningStatus?.activeReferralsCount ?? 0;
  const cyclesCompleted = miningStatus?.totalCyclesCompleted ?? 0;

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto px-4 mt-6">
      {/* Rate Breakdown Card */}
      <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-4 shadow-xl backdrop-blur-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-800/60 text-cyan-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs uppercase font-mono tracking-wider text-slate-400">Mining Engine Power</h3>
              <p className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                <span>{totalRate.toFixed(4)} CP / hour</span>
                {bonusRate > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    BOOSTED
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-mono text-slate-400">Cycles Run</span>
            <div className="text-sm font-mono font-bold text-cyan-300">#{cyclesCompleted}</div>
          </div>
        </div>

        {/* Breakdown sub-row */}
        <div className="grid grid-cols-2 gap-2 pt-3 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
              <span>Base Protocol Rate</span>
              <Award className="w-3 h-3 text-cyan-400" />
            </div>
            <div className="font-mono font-semibold text-slate-200">
              +{baseRate.toFixed(4)} <span className="text-[10px] text-slate-400">CP/h</span>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
              <span>Referral Boost (+0.01 ea)</span>
              <Users className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="font-mono font-semibold text-emerald-400">
              +{bonusRate.toFixed(4)} <span className="text-[10px] text-emerald-300/70">CP/h ({activeReferrals})</span>
            </div>
          </div>
        </div>

        {/* Protocol rule highlight */}
        <div className="mt-3 p-2.5 rounded-xl bg-cyan-950/20 border border-cyan-900/40 text-[11px] text-cyan-300/80 flex items-start gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Each friend who joins with your link and completes their <strong>first mining session</strong> permanently adds <strong>+0.01 CP/h</strong> to your rate.
          </span>
        </div>
      </div>

      {/* Quick Summary Pill Grid */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/70 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-800/60 text-emerald-400">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-slate-400">Lifetime Mined</div>
            <div className="text-sm font-mono font-bold text-slate-100">
              {balance ? balance.totalMined.toFixed(4) : '0.0000'} CP
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/70 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/60 text-sky-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-slate-400">Ledger Security</div>
            <div className="text-sm font-semibold text-emerald-400 flex items-center gap-1">
              <span>Cryptographic</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
