import React, { useState, useEffect } from 'react';
import { Key, UserPlus, LogIn, X, Shield, Sparkles, CheckCircle2 } from 'lucide-react';
import { api } from '../api.ts';
import { User, BalanceState, MiningStatusResponse } from '../types.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User, balance: BalanceState, miningState: MiningStatusResponse) => void;
  initialRefCode?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess, initialRefCode }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(initialRefCode || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialRefCode) {
      setReferralCode(initialRefCode);
      setMode('register');
    }
  }, [initialRefCode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'register') {
        const res = await api.register({
          username,
          email,
          password,
          referralCode: referralCode.trim() || undefined,
        });
        onSuccess(res.user, res.balance, res.miningState);
        onClose();
      } else {
        const res = await api.login(username || email, password);
        onSuccess(res.user, res.balance, res.miningState);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoAdmin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.login('admin', 'AdminCoinPulse2026!');
      onSuccess(res.user, res.balance, res.miningState);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Admin login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoMiner = async () => {
    setIsLoading(true);
    setError(null);
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const demoUser = `miner_${randomSuffix}`;
    try {
      const res = await api.register({
        username: demoUser,
        email: `miner${randomSuffix}@coinpulse.net`,
        password: 'Password123!',
        referralCode: referralCode.trim() || 'ADMINPULSE',
      });
      onSuccess(res.user, res.balance, res.miningState);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Demo miner creation failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#0e1628] to-[#070b14] border border-slate-800 p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800/80 text-cyan-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {mode === 'login' ? 'Welcome Back' : 'Create Miner Account'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {mode === 'login' ? 'Access your mining station & balance' : 'Start your hourly mining journey'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              mode === 'login' ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`flex-1 py-1.5 rounded-lg transition-all ${
              mode === 'register' ? 'bg-cyan-600 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Register
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] uppercase font-mono text-slate-400 block mb-1">
              Username {mode === 'login' && 'or Email'}
            </label>
            <input
              type="text"
              required
              placeholder={mode === 'login' ? 'Username or email' : 'e.g. Satoshi_21'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-[11px] uppercase font-mono text-slate-400 block mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          <div>
            <label className="text-[11px] uppercase font-mono text-slate-400 block mb-1">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-[11px] uppercase font-mono text-slate-400 block mb-1">
                Referral Code (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. ADMINPULSE"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono uppercase text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-600 hover:from-cyan-400 hover:to-sky-500 text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-cyan-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
            ) : mode === 'login' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Sign In to Mining Station</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Create Permanent Account</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Testing Shortcuts */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="text-[10px] uppercase font-mono text-slate-500 text-center mb-2">
            Instant Test Profiles
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              onClick={handleQuickDemoMiner}
              disabled={isLoading}
              className="py-1.5 px-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-300 text-[11px] flex items-center justify-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-cyan-400" />
              <span>+ New Miner</span>
            </button>
            <button
              onClick={handleQuickDemoAdmin}
              disabled={isLoading}
              className="py-1.5 px-2 rounded-xl bg-slate-900 border border-red-900/60 hover:bg-slate-850 text-red-300 text-[11px] flex items-center justify-center gap-1"
            >
              <Shield className="w-3 h-3 text-red-400" />
              <span>Admin Root</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
