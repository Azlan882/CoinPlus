import React, { useEffect, useState, useMemo } from 'react';
import { Zap, Clock, TrendingUp, CheckCircle2, ShieldCheck, Flame } from 'lucide-react';
import confetti from 'canvas-confetti';
import { MiningCycleStatus } from '../types.ts';
import { sounds } from '../utils/audio.ts';

interface MiningCircleProps {
  status: MiningCycleStatus;
  currentMiningRate: number;
  baseRate: number;
  bonusRate: number;
  remainingSeconds: number;
  isMiningLoading: boolean;
  onMineClick: () => void;
  serverSyncTime: number;
  nextMiningAvailableAt?: number;
  cycleStartTime?: number | null;
  serverClockOffsetMs?: number;
  resumeSyncTick?: number;
}

export const MiningCircle: React.FC<MiningCircleProps> = ({
  status,
  currentMiningRate,
  baseRate,
  bonusRate,
  remainingSeconds,
  isMiningLoading,
  onMineClick,
  nextMiningAvailableAt = 0,
  cycleStartTime = null,
  serverClockOffsetMs = 0,
  resumeSyncTick = 0,
}) => {
  // Real-time interpolated earnings & cycle progress derived directly from authoritative server timestamps
  const [accumulatedEarned, setAccumulatedEarned] = useState<number>(0);
  const [liveProgressRatio, setLiveProgressRatio] = useState<number>(0);

  // Total cycle duration is 3600 seconds (1 hour)
  const totalCycleSeconds = 3600;
  const totalCycleMs = totalCycleSeconds * 1000;

  // Compute exact progress ratio from authoritative server timestamps (currentTime - cycleStartTime)
  const computeCycleMetrics = () => {
    if (status === 'available') {
      return { ratio: 1, earned: Number(currentMiningRate.toFixed(4)) };
    }
    if (status !== 'mining') {
      return { ratio: 0, earned: 0 };
    }

    const nowServerMs = Date.now() + serverClockOffsetMs;
    if (nextMiningAvailableAt > 0) {
      const effectiveStartMs =
        cycleStartTime && nextMiningAvailableAt > cycleStartTime
          ? cycleStartTime
          : nextMiningAvailableAt - totalCycleMs;
      const durationMs = Math.max(1000, nextMiningAvailableAt - effectiveStartMs);
      const elapsedMs = Math.max(0, Math.min(durationMs, nowServerMs - effectiveStartMs));
      const ratio = Math.min(1, Math.max(0, elapsedMs / durationMs));
      const earned = Number((ratio * currentMiningRate).toFixed(6));
      return { ratio, earned };
    }

    const elapsedSeconds = Math.max(0, Math.min(totalCycleSeconds, totalCycleSeconds - remainingSeconds));
    const ratio = elapsedSeconds / totalCycleSeconds;
    const earned = Number((ratio * currentMiningRate).toFixed(6));
    return { ratio, earned };
  };

  const fallbackElapsedSeconds = Math.max(0, Math.min(totalCycleSeconds, totalCycleSeconds - remainingSeconds));
  const fallbackRatio = status === 'mining' ? fallbackElapsedSeconds / totalCycleSeconds : status === 'available' ? 1 : 0;
  const progressRatio = status === 'mining' ? liveProgressRatio || fallbackRatio : fallbackRatio;
  const progressPercent = Math.min(100, Math.max(0, progressRatio * 100));

  // Circumference for 260px diameter (r = 115)
  const radius = 115;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * progressPercent) / 100;

  // Timestamp-driven synchronization for progress arc & earned counter (never accumulates via prev + delta)
  useEffect(() => {
    const syncFromTimestamps = () => {
      const { ratio, earned } = computeCycleMetrics();
      setLiveProgressRatio(ratio);
      setAccumulatedEarned(earned);
    };

    syncFromTimestamps();

    if (status === 'mining') {
      const interval = window.setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }
        syncFromTimestamps();
      }, 250);

      return () => window.clearInterval(interval);
    }
  }, [
    status,
    remainingSeconds,
    currentMiningRate,
    nextMiningAvailableAt,
    cycleStartTime,
    serverClockOffsetMs,
    resumeSyncTick,
  ]);

  // Format countdown HH:MM:SS
  const formattedCountdown = useMemo(() => {
    if (remainingSeconds <= 0) return '00:00:00';
    const h = Math.floor(remainingSeconds / 3600);
    const m = Math.floor((remainingSeconds % 3600) / 60);
    const s = remainingSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, [remainingSeconds]);

  const handleAction = () => {
    if (isMiningLoading) return;
    if (status === 'mining') {
      sounds.playCooldownBuzz();
      return;
    }

    sounds.playMinePulse();
    onMineClick();

    // Trigger celebratory confetti on legitimate mining start/claim
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.45 },
        colors: ['#00f2fe', '#10b981', '#38bdf8', '#f59e0b'],
      });
    } catch {}
  };

  return (
    <div className="flex flex-col items-center justify-center select-none w-full max-w-sm mx-auto px-4">
      {/* Top Status Pill */}
      <div className="mb-4 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-inner text-xs font-medium">
        {status === 'mining' ? (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-emerald-400 font-semibold tracking-wide">CYCLE IN PROGRESS</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-300 font-mono">{formattedCountdown}</span>
          </>
        ) : status === 'available' ? (
          <>
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-300 font-semibold tracking-wide">CYCLE COMPLETE • CLAIM READY</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-cyan-300 font-semibold tracking-wide">STATION READY TO MINE</span>
          </>
        )}
      </div>

      {/* Main Mining Reactor Visual Element */}
      <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center">
        {/* Ambient Outer Glow Aura */}
        <div
          className={`absolute inset-4 rounded-full transition-all duration-700 blur-2xl opacity-40 pointer-events-none ${
            status === 'mining'
              ? 'bg-emerald-500/30'
              : status === 'available'
              ? 'bg-amber-500/35'
              : 'bg-cyan-500/30'
          }`}
        />

        {/* Decorative Outer Dashed Orbit */}
        <div className="absolute inset-0 rounded-full border border-dashed border-cyan-500/20 animate-orbit-reverse pointer-events-none" />

        {/* Outer Circular Progress Ring (SVG) */}
        <svg className="w-full h-full -rotate-90 transform pointer-events-none" viewBox="0 0 260 260">
          <defs>
            <linearGradient id="miningGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00f2fe" />
              <stop offset="50%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="availableGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>

          {/* Background Track */}
          <circle
            cx="130"
            cy="130"
            r={radius}
            className="stroke-slate-800/80"
            strokeWidth="9"
            fill="transparent"
          />

          {/* Active Animated Progress Arc */}
          <circle
            cx="130"
            cy="130"
            r={radius}
            stroke={status === 'available' ? 'url(#availableGradient)' : 'url(#miningGradient)'}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Interactive Center Core */}
        <button
          onClick={handleAction}
          disabled={status === 'mining' || isMiningLoading}
          aria-label={status === 'mining' ? 'Mining in progress' : 'Mine Coins'}
          className={`relative z-10 w-52 h-52 sm:w-56 sm:h-56 rounded-full flex flex-col items-center justify-center p-3 text-center transition-all duration-300 transform active:scale-95 focus:outline-none ${
            status === 'mining'
              ? 'bg-gradient-to-b from-[#0e172a] via-[#091122] to-[#050b17] border-2 border-emerald-500/40 shadow-lg shadow-emerald-950/40 cursor-default'
              : status === 'available'
              ? 'bg-gradient-to-b from-amber-950/40 via-[#0d1424] to-[#080d19] border-2 border-amber-500/60 shadow-xl shadow-amber-500/20 hover:border-amber-400 cursor-pointer animate-pulse-ring'
              : 'bg-gradient-to-b from-cyan-950/40 via-[#0d1424] to-[#080d19] border-2 border-cyan-500/60 shadow-xl shadow-cyan-500/25 hover:border-cyan-300 hover:glow-cyan cursor-pointer animate-pulse-ring'
          }`}
        >
          {/* Subtle spinning particle halo when mining */}
          {status === 'mining' && (
            <div className="absolute inset-2 rounded-full border border-emerald-400/20 animate-orbit-slow pointer-events-none">
              <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-lg shadow-emerald-400/80" />
            </div>
          )}

          {/* Core Icon */}
          <div className="mb-1.5 transition-transform duration-300">
            {isMiningLoading ? (
              <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
            ) : status === 'mining' ? (
              <div className="relative">
                <Zap className="w-9 h-9 text-emerald-400 fill-emerald-400/30 animate-pulse" />
              </div>
            ) : status === 'available' ? (
              <div className="relative">
                <Flame className="w-10 h-10 text-amber-400 fill-amber-400/40 animate-bounce" />
              </div>
            ) : (
              <div className="relative">
                <Zap className="w-10 h-10 text-cyan-400 fill-cyan-400/20" />
              </div>
            )}
          </div>

          {/* Primary Action Label */}
          <div className="text-center font-bold tracking-wider">
            {isMiningLoading ? (
              <span className="text-sm text-cyan-300">AUTHORIZING...</span>
            ) : status === 'mining' ? (
              <div className="flex flex-col items-center">
                <span className="text-xs text-emerald-400 font-semibold tracking-widest uppercase">MINING ACTIVE</span>
                <span className="text-xl sm:text-2xl font-mono font-bold text-white tracking-wider glow-text-cyan my-0.5">
                  {formattedCountdown}
                </span>
                <span className="text-[11px] text-emerald-300/80 font-mono">
                  +{accumulatedEarned.toFixed(4)} CP
                </span>
              </div>
            ) : status === 'available' ? (
              <div className="flex flex-col items-center">
                <span className="text-xs text-amber-400 font-semibold tracking-widest uppercase">CYCLE READY</span>
                <span className="text-base sm:text-lg font-extrabold text-amber-200 uppercase mt-0.5">
                  CLAIM &amp; MINE
                </span>
                <span className="text-[11px] text-emerald-400 font-medium">+{currentMiningRate.toFixed(4)} CP reward</span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <span className="text-base sm:text-lg font-extrabold text-cyan-200 tracking-wider">MINE</span>
                <span className="text-[11px] text-slate-400 uppercase tracking-widest mt-0.5">1-HOUR CYCLE</span>
              </div>
            )}
          </div>

          {/* Rate sub-badge */}
          <div className="mt-2 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-900/90 border border-slate-800 text-[11px] font-mono text-cyan-300">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            <span>+{currentMiningRate.toFixed(4)} CP/h</span>
          </div>
        </button>
      </div>

      {/* Under-Circle Status Details */}
      <div className="mt-5 w-full flex items-center justify-between text-xs text-slate-400 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span>Interval: <strong className="text-slate-200">1 hour</strong></span>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Server Cooldown: <strong className="text-emerald-300">Enforced</strong></span>
        </div>
      </div>
    </div>
  );
};
