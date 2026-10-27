import React from 'react';
import { ShieldCheck, Cpu, AlertTriangle, CheckCircle, Info, Sparkles, Terminal } from 'lucide-react';

export const BlockchainRoadmap: React.FC = () => {
  return (
    <div className="w-full max-w-xl mx-auto px-4 py-4 space-y-4">
      {/* Primary Legal & Regulatory Simulation Disclaimer */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-amber-950/30 to-slate-900 border border-amber-600/50 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-950/80 border border-amber-700/60 text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-amber-200">
              Simulation Game Disclaimer &amp; Notice
            </h2>
            <p className="text-xs text-amber-300/90 mt-1.5 leading-relaxed font-medium">
              This is a simulation game for entertainment only. No real cryptocurrency is mined, owned, earned, or paid out. All displayed BTC amounts and balances are fictional, have no monetary value, and cannot be withdrawn, exchanged, or converted into cryptocurrency or cash.
            </p>
          </div>
        </div>
      </div>

      {/* Simulation Engine Architecture */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">Simulated Mining Architecture</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Simulation Unit</div>
            <div className="text-sm font-semibold text-cyan-300 mt-0.5">Simulated BTC (Fictional)</div>
            <p className="text-[11px] text-slate-400 mt-1">Backed internally by integer simulated satoshis (100M sats = 1.00000000 BTC).</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Base Protocol Rate</div>
            <div className="text-sm font-semibold text-emerald-300 mt-0.5">0.00012000 BTC / hour</div>
            <p className="text-[11px] text-slate-400 mt-1">Fictional base mining rate awarded for completing hourly simulation cycles.</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Referral Team Multiplier</div>
            <div className="text-sm font-semibold text-purple-300 mt-0.5">+0.00001000 BTC / hour</div>
            <p className="text-[11px] text-slate-400 mt-1">Earned per valid activated friend who joins and completes their first cycle.</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="text-[10px] uppercase font-mono text-slate-400">Ledger Verification</div>
            <div className="text-sm font-semibold text-amber-300 mt-0.5">Cryptographic Checksum</div>
            <p className="text-[11px] text-slate-400 mt-1">Authoritative server-side ledger reconciling transactions against SHA-256 state hashes.</p>
          </div>
        </div>
      </div>

      {/* Fair Play & Anti-Abuse Standards */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Fair Play &amp; Anti-Abuse Protections</h3>
        </div>

        <ul className="space-y-2 text-xs text-slate-300">
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Authoritative Cooldowns:</strong> Mining timers and claims are strictly enforced on the server to prevent local clock manipulation.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Zero Financial Risk:</strong> No deposit, purchase, transfer, or withdrawal mechanism exists. Gameplay is 100% free and for entertainment.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span><strong>Referral Eligibility:</strong> Self-referrals and duplicate accounts are automatically filtered out to ensure honest leaderboards.</span>
          </li>
        </ul>
      </div>

      {/* Technical FAQ */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-5 h-5 text-sky-400" />
          <h3 className="text-sm font-bold text-white">Simulation FAQ</h3>
        </div>

        <div className="space-y-2.5 text-xs text-slate-300">
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="font-semibold text-slate-200">Can I transfer or withdraw my simulated BTC?</div>
            <p className="text-slate-400 mt-1 leading-relaxed text-[11px]">
              No. Simulated BTC is exclusively an in-game scoring metric for entertainment. It cannot be converted to real Bitcoin, fiat currency, or any external assets.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="font-semibold text-slate-200">Does mining consume phone battery or compute resources?</div>
            <p className="text-slate-400 mt-1 leading-relaxed text-[11px]">
              No. CoinPulse does not run proof-of-work hash calculations on your device. Cycles are simulated on the cloud server, preserving your battery and hardware.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
