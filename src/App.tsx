/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.ts';
import {
  User,
  BalanceState,
  MiningStatusResponse,
  ReferralsResponse,
  TabType,
} from './types.ts';
import { Header } from './components/Header.tsx';
import { MiningCircle } from './components/MiningCircle.tsx';
import { MiningStats } from './components/MiningStats.tsx';
import { ReferralsView } from './components/ReferralsView.tsx';
import { TransactionsLedger } from './components/TransactionsLedger.tsx';
import { BlockchainRoadmap } from './components/BlockchainRoadmap.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { ApkDownloadModal } from './components/ApkDownloadModal.tsx';
import { BottomNav } from './components/BottomNav.tsx';
import { AlertCircle, WifiOff } from 'lucide-react';
import { sounds } from './utils/audio.ts';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<BalanceState | null>(null);
  const [miningStatus, setMiningStatus] = useState<MiningStatusResponse | null>(null);
  const [referralsData, setReferralsData] = useState<ReferralsResponse | null>(null);

  const [currentTab, setCurrentTab] = useState<TabType>('mining');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isApkModalOpen, setIsApkModalOpen] = useState(false);
  const [initialRefCode, setInitialRefCode] = useState<string>('');
  const [isMiningLoading, setIsMiningLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Remaining seconds tick on client, synced to server nextMiningAvailableAt
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  const timerRef = useRef<number | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  // Sync state from server
  const syncServerData = useCallback(async () => {
    if (!api.getToken()) return;

    try {
      setIsRefreshing(true);
      const [meRes, statusRes] = await Promise.all([api.getMe(), api.getMiningStatus()]);
      setCurrentUser(meRes.user);
      setBalance({
        balance: meRes.balance.totalBalance,
        totalMined: meRes.balance.totalMined,
        totalReferralBonus: meRes.balance.totalReferralBonus,
        lastCalculatedAt: meRes.balance.lastCalculatedAt,
        integrityVerified: true,
      });
      setMiningStatus(statusRes);

      // Calculate remaining seconds directly from server's nextMiningAvailableAt
      const now = Date.now();
      if (statusRes.nextMiningAvailableAt > 0 && now < statusRes.nextMiningAvailableAt) {
        setRemainingSeconds(Math.ceil((statusRes.nextMiningAvailableAt - now) / 1000));
      } else {
        setRemainingSeconds(0);
      }
    } catch (err: any) {
      console.error('Data sync failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Fetch referrals data when switching to team tab
  const fetchReferrals = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.getReferrals();
      setReferralsData(res);
    } catch (err) {
      console.error('Failed to fetch referrals:', err);
    }
  }, [currentUser]);

  // Initial mount
  useEffect(() => {
    // Check URL parameters for referral code, e.g. ?ref=ABC123
    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref');
    if (refParam) {
      setInitialRefCode(refParam.toUpperCase());
      if (!api.getToken()) {
        setIsAuthOpen(true);
      }
    }

    // Network listeners
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial auth restore
    if (api.getToken()) {
      syncServerData();
    } else {
      // Auto open auth on first visit so user can sign in or demo
      setIsAuthOpen(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncServerData]);

  // Handle countdown interval
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          // Cooldown finished: re-sync with server to flip status to 'available'
          if (miningStatus?.isCooldownActive) {
            syncServerData();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [miningStatus?.isCooldownActive, syncServerData]);

  // When tab changes to team, fetch fresh referrals
  useEffect(() => {
    if (currentTab === 'team') {
      fetchReferrals();
    }
  }, [currentTab, fetchReferrals]);

  // Handle Mine button
  const handleMine = async () => {
    if (!currentUser) {
      setIsAuthOpen(true);
      return;
    }

    setIsMiningLoading(true);
    try {
      const res = await api.mine();
      sounds.playCoinClink();

      showNotification(
        `Mined +${res.minedAmount.toFixed(4)} CP! ${
          res.referralActivated ? '🎉 Referral activated! Rate permanently boosted!' : ''
        }`,
        'success'
      );

      // Re-sync all states
      await syncServerData();
      if (currentTab === 'team') {
        fetchReferrals();
      }
    } catch (err: any) {
      sounds.playCooldownBuzz();
      showNotification(err.message || 'Mining cycle could not be processed', 'error');
      // If error due to cooldown, re-sync to get correct server timer
      syncServerData();
    } finally {
      setIsMiningLoading(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setBalance(null);
    setMiningStatus(null);
    setReferralsData(null);
    setCurrentTab('mining');
    setIsAuthOpen(true);
  };

  const handleAuthSuccess = (
    user: User,
    initBalance: BalanceState,
    state: MiningStatusResponse
  ) => {
    setCurrentUser(user);
    setBalance(initBalance);
    setMiningStatus(state);
    showNotification(`Welcome, ${user.username}! Mining station online.`, 'success');
    syncServerData();
  };

  // Determine current cycle status: 'ready' | 'mining' | 'available'
  const calculatedStatus = () => {
    if (!currentUser || !miningStatus) return 'ready';
    if (remainingSeconds > 0) return 'mining';
    if (miningStatus.lastMinedAt === null) return 'ready';
    return 'available';
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30">
      {/* Offline Banner */}
      {isOffline && (
        <div className="bg-amber-600/90 text-slate-950 font-bold px-4 py-1.5 text-xs text-center flex items-center justify-center gap-2">
          <WifiOff className="w-4 h-4" />
          <span>You are currently offline. Changes will resume once connection is restored.</span>
        </div>
      )}

      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-lg flex items-center gap-2.5 text-xs font-semibold animate-bounce border transition-all max-w-[90vw]">
          <div
            className={`w-2 h-2 rounded-full ${
              notification.type === 'success'
                ? 'bg-emerald-400'
                : notification.type === 'error'
                ? 'bg-red-400'
                : 'bg-cyan-400'
            }`}
          />
          <span
            className={
              notification.type === 'success'
                ? 'text-emerald-300'
                : notification.type === 'error'
                ? 'text-red-300'
                : 'text-cyan-300'
            }
          >
            {notification.message}
          </span>
        </div>
      )}

      {/* App Header */}
      <Header
        user={currentUser}
        balance={balance}
        onLogout={handleLogout}
        onOpenAuth={() => setIsAuthOpen(true)}
        onRefresh={syncServerData}
        isRefreshing={isRefreshing}
        onOpenAdmin={() => setCurrentTab('admin')}
        onOpenApkModal={() => setIsApkModalOpen(true)}
      />

      {/* Main View Area */}
      <main className="flex-1 pb-24 pt-4 overflow-y-auto no-scrollbar">
        {currentTab === 'mining' && (
          <div className="space-y-4">
            {/* Mining Circle Reactor */}
            <MiningCircle
              status={calculatedStatus()}
              currentMiningRate={miningStatus?.totalMiningRate ?? currentUser?.totalMiningRate ?? 0.12}
              baseRate={miningStatus?.baseMiningRate ?? 0.12}
              bonusRate={miningStatus?.bonusMiningRate ?? 0.0}
              remainingSeconds={remainingSeconds}
              isMiningLoading={isMiningLoading}
              onMineClick={handleMine}
              serverSyncTime={miningStatus?.serverTime ?? Date.now()}
            />

            {/* Mining Stats & Power Breakdown */}
            {currentUser && (
              <MiningStats
                user={currentUser}
                balance={balance}
                miningStatus={miningStatus}
              />
            )}
          </div>
        )}

        {currentTab === 'team' && (
          <ReferralsView
            data={referralsData}
            isLoading={isRefreshing}
            onRefresh={fetchReferrals}
          />
        )}

        {currentTab === 'ledger' && (
          <TransactionsLedger onRefreshBalance={syncServerData} />
        )}

        {currentTab === 'roadmap' && <BlockchainRoadmap />}

        {currentTab === 'admin' && currentUser?.role === 'admin' && (
          <AdminPortal onClose={() => setCurrentTab('mining')} />
        )}
      </main>

      {/* Mobile-Friendly Bottom Navigation */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        user={currentUser}
        activeMinersCount={referralsData?.activatedReferrals ?? 0}
      />

      {/* Login & Registration Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={handleAuthSuccess}
        initialRefCode={initialRefCode}
      />

      {/* Android APK GitHub Actions Modal */}
      <ApkDownloadModal
        isOpen={isApkModalOpen}
        onClose={() => setIsApkModalOpen(false)}
      />
    </div>
  );
}
