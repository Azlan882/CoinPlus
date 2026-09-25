import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Zap, Users, Sliders, RefreshCw, FileText } from 'lucide-react';
import { TransactionItem } from '../types.ts';
import { api } from '../api.ts';

interface TransactionsLedgerProps {
  onRefreshBalance: () => void;
}

export const TransactionsLedger: React.FC<TransactionsLedgerProps> = ({ onRefreshBalance }) => {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    isTamperFree: boolean;
    recordedBalance: number;
    ledgerReconciledBalance: number;
    transactionCount: number;
    timestamp: string;
  } | null>(null);

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const res = await api.getTransactions(40);
      setTransactions(res.transactions);
    } catch (e) {
      console.error('Failed to load transactions:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyLedger = async () => {
    setIsVerifying(true);
    try {
      const res = await api.verifyBalance();
      setAuditResult(res);
      onRefreshBalance();
    } catch (e) {
      console.error('Verification failed:', e);
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
    handleVerifyLedger();
  }, []);

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-4 space-y-4">
      {/* Cryptographic Audit Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 border border-slate-800 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-3 rounded-xl border ${
                auditResult?.isTamperFree
                  ? 'bg-emerald-950/80 border-emerald-800/60 text-emerald-400'
                  : 'bg-amber-950/80 border-amber-800/60 text-amber-400'
              }`}
            >
              {auditResult?.isTamperFree ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-1.5">
                <span>Immutable Activity Ledger</span>
                {auditResult?.isTamperFree && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    VERIFIED
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Every balance mutation is cryptographically logged &amp; auditable.
              </p>
            </div>
          </div>

          <button
            onClick={handleVerifyLedger}
            disabled={isVerifying}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 active:scale-95 transition-all"
            title="Reconcile Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${isVerifying ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>

        {/* Verification Summary Card */}
        {auditResult && (
          <div className="mt-4 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs font-mono space-y-1.5">
            <div className="flex justify-between text-slate-400">
              <span>Ledger Reconciled Balance:</span>
              <span className="text-slate-200 font-bold">+{auditResult.ledgerReconciledBalance.toFixed(6)} CP</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Account Recorded Balance:</span>
              <span className="text-emerald-400 font-bold">+{auditResult.recordedBalance.toFixed(6)} CP</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>SHA-256 Checksum Status:</span>
              <span className={auditResult.isTamperFree ? 'text-emerald-400' : 'text-red-400'}>
                {auditResult.isTamperFree ? 'INTEGRITY VERIFIED ✓' : 'TAMPER DETECTED ✗'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Transactions List */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
            Transaction History ({transactions.length})
          </h3>
          <span className="text-[10px] font-mono text-slate-500">Sorted by newest</span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-slate-500 text-xs font-mono">Loading transaction records...</div>
        ) : transactions.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            No transactions yet. Start your first mining cycle above!
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs gap-3"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      tx.type === 'mining_reward'
                        ? 'bg-cyan-950/80 text-cyan-400 border border-cyan-800/50'
                        : tx.type === 'referral_bonus'
                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                        : 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                    }`}
                  >
                    {tx.type === 'mining_reward' && <Zap className="w-4 h-4" />}
                    {tx.type === 'referral_bonus' && <Users className="w-4 h-4" />}
                    {tx.type === 'admin_adjustment' && <Sliders className="w-4 h-4" />}
                  </div>

                  <div>
                    <div className="font-semibold text-slate-200">{tx.description}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {new Date(tx.timestamp).toLocaleString()} • Before: {tx.balanceBefore.toFixed(4)} CP
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`font-mono font-bold text-sm ${
                      tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {tx.amount >= 0 ? `+${tx.amount.toFixed(4)}` : tx.amount.toFixed(4)}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    CP
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
