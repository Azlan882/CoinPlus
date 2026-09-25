import React, { useState } from 'react';
import { Copy, Check, Share2, Users, UserCheck, Clock, AlertCircle, ArrowUpRight } from 'lucide-react';
import { ReferralsResponse } from '../types.ts';

interface ReferralsViewProps {
  data: ReferralsResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export const ReferralsView: React.FC<ReferralsViewProps> = ({ data, isLoading, onRefresh }) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleCopyLink = () => {
    if (!data?.inviteLink) return;
    navigator.clipboard.writeText(data.inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    if (!data?.referralCode) return;
    navigator.clipboard.writeText(data.referralCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleNativeShare = async () => {
    if (!data?.inviteLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my CoinPulse Mining Team',
          text: `Join CoinPulse and mine internal rewards hourly with me! Use my code: ${data.referralCode}`,
          url: data.inviteLink,
        });
      } catch (err) {
        // user cancelled or share failed
      }
    } else {
      handleCopyLink();
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-4 space-y-4">
      {/* Banner / Header */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/40 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-cyan-950/80 border border-cyan-800/60 text-cyan-400">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Referral Team Network</h2>
            <p className="text-xs text-slate-400">
              Invite friends to boost your mining rate permanently by <strong className="text-emerald-400">+0.01 CP/h</strong> each.
            </p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-800/80 text-center">
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="text-[10px] font-mono uppercase text-slate-400">Total Invited</div>
            <div className="text-base sm:text-lg font-mono font-bold text-slate-100">
              {data?.totalReferrals ?? 0}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="text-[10px] font-mono uppercase text-emerald-400">Active Miners</div>
            <div className="text-base sm:text-lg font-mono font-bold text-emerald-400">
              {data?.activatedReferrals ?? 0}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
            <div className="text-[10px] font-mono uppercase text-cyan-400">Rate Boost</div>
            <div className="text-base sm:text-lg font-mono font-bold text-cyan-400">
              +{data ? data.activeBonusRate.toFixed(2) : '0.00'} <span className="text-[10px]">/h</span>
            </div>
          </div>
        </div>
      </div>

      {/* Shareable Code & Link Card */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">Your Unique Referral Credentials</h3>

        {/* Referral Code Box */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
          <div>
            <div className="text-[10px] uppercase font-mono text-slate-500">Referral Code</div>
            <div className="text-lg font-mono font-extrabold text-cyan-300 tracking-wider">
              {data?.referralCode || '...'}
            </div>
          </div>
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-all active:scale-95"
          >
            {copiedCode ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-cyan-400" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        {/* Referral Link Box */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 truncate select-all">
            {data?.inviteLink || 'Generating link...'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLink}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-600/20 active:scale-95 transition-all"
            >
              {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedLink ? 'Copied Link' : 'Copy Link'}</span>
            </button>
            <button
              onClick={handleNativeShare}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 active:scale-95 transition-all"
              title="Share via device"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Activation Rule Notice */}
        <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-900/40 text-xs text-amber-200/90 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong className="text-amber-300 font-semibold">Anti-Abuse Rule:</strong> Referral invitations stay in <span className="underline font-semibold">Pending</span> state until the invited person completes their <strong>first full 1-hour mining cycle</strong>. Once verified, your rate bonus permanently increases by +0.01 CP/h!
          </div>
        </div>
      </div>

      {/* Team Member List */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
            Invited Miners ({data?.referrals?.length ?? 0})
          </h3>
          <button
            onClick={onRefresh}
            className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
          >
            <span>Refresh</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-slate-500 text-xs font-mono">Loading team members...</div>
        ) : !data?.referrals || data.referrals.length === 0 ? (
          <div className="py-8 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-slate-800/80 mx-auto flex items-center justify-center text-slate-500 mb-2">
              <Users className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-slate-300">No referrals yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Share your invite link above to start growing your mining power!
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.referrals.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold font-mono text-xs ${
                      item.status === 'activated'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                        : 'bg-amber-950/70 text-amber-400 border border-amber-800/60'
                    }`}
                  >
                    {item.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <span>{item.username}</span>
                      {item.isCurrentlyMining && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Currently Mining" />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Joined {new Date(item.joinedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  {item.status === 'activated' ? (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-800/70 text-[11px] font-mono text-emerald-300 font-medium">
                      <UserCheck className="w-3 h-3 text-emerald-400" />
                      <span>+0.01 CP/h Active</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/70 border border-amber-800/70 text-[11px] font-mono text-amber-300 font-medium">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span>Pending 1st Mine</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
