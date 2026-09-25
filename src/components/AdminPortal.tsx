import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Users,
  Search,
  UserX,
  UserCheck,
  Sliders,
  AlertTriangle,
  RefreshCw,
  Activity,
  ArrowLeft,
} from 'lucide-react';
import { AdminStats, AdminUserItem, SecurityEventItem } from '../types.ts';
import { api } from '../api.ts';

interface AdminPortalProps {
  onClose: () => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'security' | 'stats'>('users');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Modal for adjustment
  const [adjustingUser, setAdjustingUser] = useState<AdminUserItem | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  const fetchAdminData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, usersRes, secRes] = await Promise.all([
        api.getAdminStats(),
        api.getAdminUsers(searchQuery),
        api.getSecurityEvents(50),
      ]);
      setStats(statsRes.stats);
      setUsers(usersRes.users);
      setSecurityEvents(secRes.events);
    } catch (e: any) {
      console.error('Failed to load admin data:', e);
      setActionMessage(`Error: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [searchQuery]);

  const handleToggleStatus = async (user: AdminUserItem) => {
    const nextStatus = user.status === 'active' ? 'suspended' : 'active';
    const reason = prompt(`Enter reason for ${nextStatus === 'suspended' ? 'suspending' : 'reactivating'} @${user.username}:`);
    if (!reason) return;

    try {
      const res = await api.updateUserStatus(user.id, nextStatus, reason);
      setActionMessage(res.message);
      fetchAdminData();
    } catch (err: any) {
      setActionMessage(`Failed: ${err.message}`);
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingUser) return;
    const amountNum = parseFloat(adjustAmount);
    if (isNaN(amountNum) || amountNum === 0) {
      alert('Please enter a valid non-zero amount');
      return;
    }
    if (!adjustReason || adjustReason.trim().length < 5) {
      alert('Audit reason must be at least 5 characters');
      return;
    }

    setIsSubmittingAdjust(true);
    try {
      const res = await api.adjustUserBalance(adjustingUser.id, amountNum, adjustReason);
      setActionMessage(res.message);
      setAdjustingUser(null);
      setAdjustAmount('');
      setAdjustReason('');
      fetchAdminData();
    } catch (err: any) {
      alert(`Adjustment error: ${err.message}`);
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-900 border border-red-900/60 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-950 text-red-400 border border-red-800">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-white">Administrator Control Core</h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800 font-mono font-bold">
                ROOT
              </span>
            </div>
            <p className="text-xs text-slate-400">Audited management of network users, balances &amp; anti-abuse</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-all active:scale-95"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Exit Admin</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 rounded-xl bg-slate-850 border border-slate-700 text-xs text-cyan-300 flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Admin Tab Switcher */}
      <div className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'users' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Accounts ({users.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'security' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Security Logs ({securityEvents.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'stats' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>System Metrics</span>
        </button>
      </div>

      {/* Tab 1: User Accounts */}
      {activeTab === 'users' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-md space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search username, email, code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <button
              onClick={fetchAdminData}
              disabled={isLoading}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {users.map((u) => (
              <div
                key={u.id}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200">@{u.username}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold ${
                        u.status === 'active'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-red-950 text-red-400 border border-red-800'
                      }`}
                    >
                      {u.status}
                    </span>
                    {u.role === 'admin' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono font-bold">
                        ADMIN
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {u.email} • Code: <span className="text-cyan-400">{u.referralCode}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Rate: {u.totalMiningRate.toFixed(4)} CP/h • Ref: {u.activatedReferrals}/{u.totalReferrals}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <div className="text-right mr-2">
                    <div className="font-mono font-bold text-slate-200">{u.totalBalance.toFixed(4)} CP</div>
                    <div className="text-[10px] text-slate-500 font-mono">Mined: {u.totalMined.toFixed(4)}</div>
                  </div>

                  <button
                    onClick={() => {
                      setAdjustingUser(u);
                      setAdjustAmount('');
                      setAdjustReason('');
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Audited Balance Adjustment"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleToggleStatus(u)}
                    className={`p-1.5 rounded-lg border ${
                      u.status === 'active'
                        ? 'bg-red-950/60 border-red-800/80 text-red-400 hover:bg-red-900/60'
                        : 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400 hover:bg-emerald-900/60'
                    }`}
                    title={u.status === 'active' ? 'Suspend User' : 'Reactivate User'}
                  >
                    {u.status === 'active' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Security Events */}
      {activeTab === 'security' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Anti-Abuse &amp; Suspicious Activity Ledger
            </h3>
            <span className="text-[10px] font-mono text-slate-500">Live stream</span>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {securityEvents.map((evt) => (
              <div
                key={evt.id}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono font-bold text-slate-200">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        evt.severity === 'high'
                          ? 'bg-red-400'
                          : evt.severity === 'medium'
                          ? 'bg-amber-400'
                          : 'bg-slate-400'
                      }`}
                    />
                    <span>{evt.eventType}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 font-mono">
                  IP: {evt.ipAddress} {evt.userId ? `• User: ${evt.userId}` : ''}
                </div>

                {evt.metadata && (
                  <pre className="text-[10px] text-slate-500 bg-slate-900/60 p-1.5 rounded overflow-x-auto">
                    {JSON.stringify(evt.metadata)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: System Metrics */}
      {activeTab === 'stats' && stats && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-md space-y-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">Protocol Global Metrics</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Total Registered Users</div>
              <div className="text-base font-bold text-slate-100 font-mono mt-0.5">{stats.totalUsers}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Active Miners (24h)</div>
              <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">{stats.activeUsers24h}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Total Coins Mined</div>
              <div className="text-base font-bold text-cyan-400 font-mono mt-0.5">{stats.totalCoinsMined.toFixed(4)} CP</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Total Referral Invites</div>
              <div className="text-base font-bold text-slate-200 font-mono mt-0.5">{stats.totalReferrals}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Activated Referrals</div>
              <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">{stats.activatedReferrals}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="text-[10px] uppercase font-mono text-slate-400">Total Mining Sessions</div>
              <div className="text-base font-bold text-sky-400 font-mono mt-0.5">{stats.totalMiningSessions}</div>
            </div>
          </div>
        </div>
      )}

      {/* Balance Adjustment Modal */}
      {adjustingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white">
              Audited Balance Adjustment: @{adjustingUser.username}
            </h3>
            <p className="text-xs text-slate-400">
              Current balance: <strong className="text-slate-200 font-mono">{adjustingUser.totalBalance.toFixed(4)} CP</strong>
            </p>

            <form onSubmit={handleAdjustBalance} className="space-y-3">
              <div>
                <label className="text-[11px] uppercase font-mono text-slate-400 block mb-1">
                  Delta Amount (e.g. +1.5 or -0.5)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  required
                  placeholder="0.0000"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-[11px] uppercase font-mono text-slate-400 block mb-1">
                  Mandatory Audit Reason (min 5 chars)
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Reason for balance correction..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustingUser(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdjust}
                  className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-slate-950 shadow-md"
                >
                  {isSubmittingAdjust ? 'Applying...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
