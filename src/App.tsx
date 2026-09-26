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

  // Remaining seconds derived from authoritative server nextMiningAvailableAt and serverClockOffset
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [serverClockOffset, setServerClockOffset] = useState<number>(0);
  const [resumeSyncTick, setResumeSyncTick] = useState<number>(0);

  const timerRef = useRef<number | null>(null);
  const serverClockOffsetRef = useRef<number>(0);
  const miningStatusRef = useRef<MiningStatusResponse | null>(null);
  const lastSyncAtRef = useRef<number>(0);
  const cooldownCompletionSyncedRef = useRef<boolean>(false);

  const updateServerClockOffset = useCallback((serverTime?: number) => {
    if (typeof serverTime === 'number' && serverTime > 0) {
      const offset = serverTime - Date.now();
      serverClockOffsetRef.current = offset;
      setServerClockOffset(offset);
    }
  }, []);

  const computeRemainingFromStatus = useCallback((statusObj: MiningStatusResponse | null): number => {
    if (!statusObj || !statusObj.nextMiningAvailableAt || statusObj.nextMiningAvailableAt <= 0) {
      return 0;
    }
    const nowServerMs = Date.now() + serverClockOffsetRef.current;
    const remainingMs = statusObj.nextMiningAvailableAt - nowServerMs;
    if (remainingMs <= 0) {
      return 0;
    }
    return Math.ceil(remainingMs / 1000);
  }, []);

  const applyAuthoritativeMiningStatus = useCallback(
    (statusObj: MiningStatusResponse | null) => {
      if (!statusObj) {
        miningStatusRef.current = null;
        setMiningStatus(null);
        setRemainingSeconds(0);
        return;
      }
      if (typeof statusObj.serverTime === 'number' && statusObj.serverTime > 0) {
        updateServerClockOffset(statusObj.serverTime);
      }
      miningStatusRef.current = statusObj;
      setMiningStatus(statusObj);
      const nextRem = computeRemainingFromStatus(statusObj);
      setRemainingSeconds(nextRem);
      if (nextRem > 0) {
        cooldownCompletionSyncedRef.current = false;
      }
    },
    [computeRemainingFromStatus, updateServerClockOffset]
  );

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  };

  // Sync authoritative state from server
  const syncServerData = useCallback(async () => {
    if (!api.getToken()) return;

    try {
      setIsRefreshing(true);
      lastSyncAtRef.current = Date.now();
      const [meRes, statusRes] = await Promise.all([api.getMe(), api.getMiningStatus()]);
      setCurrentUser(meRes.user);
      setBalance({
        balance: meRes.balance.totalBalance,
        totalMined: meRes.balance.totalMined,
        totalReferralBonus: meRes.balance.totalReferralBonus,
        lastCalculatedAt: meRes.balance.lastCalculatedAt,
        integrityVerified: true,
      });
      applyAuthoritativeMiningStatus(statusRes);
      setResumeSyncTick((t) => t + 1);
    } catch (err: any) {
      console.error('Data sync failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [applyAuthoritativeMiningStatus]);

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

  // Initial mount & Android/Web lifecycle listeners
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
    const handleOnline = () => {
      setIsOffline(false);
      if (api.getToken()) {
        syncServerData();
      }
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial auth restore or pending OAuth redirect / deep-link token
    const tokenParam = urlParams.get('token') || urlParams.get('auth_token');
    if (tokenParam) {
      api.setToken(tokenParam);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check if Android MainActivity injected a deep-link token before React mounted
    if (window.__COINPULSE_DEEP_LINK_AUTH__?.token) {
      api.setToken(window.__COINPULSE_DEEP_LINK_AUTH__.token);
      window.__COINPULSE_DEEP_LINK_AUTH__ = undefined;
    } else if (window.CoinPulseNative?.consumePendingAuth) {
      try {
        const raw = window.CoinPulseNative.consumePendingAuth();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.token) {
            api.setToken(parsed.token);
          }
        }
      } catch {}
    }

    const handleDeepLinkAuth = (event: Event) => {
      const customEv = event as CustomEvent;
      const detail = customEv.detail || window.__COINPULSE_DEEP_LINK_AUTH__ || {};
      if (detail.token) {
        api.setToken(detail.token);
        setIsAuthOpen(false);
        syncServerData();
      } else if (detail.error) {
        showNotification(detail.error, 'error');
      }
    };

    const handleAppResume = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      // 1. Immediately recalculate remaining time & visual progress from stored server timestamp
      if (miningStatusRef.current) {
        const recalculated = computeRemainingFromStatus(miningStatusRef.current);
        setRemainingSeconds(recalculated);
        setResumeSyncTick((t) => t + 1);
      }

      // 2. Check for any pending native deep-link auth token
      if (window.__COINPULSE_DEEP_LINK_AUTH__?.token) {
        api.setToken(window.__COINPULSE_DEEP_LINK_AUTH__.token);
        window.__COINPULSE_DEEP_LINK_AUTH__ = undefined;
        setIsAuthOpen(false);
        syncServerData();
        return;
      }

      const pendingSid = localStorage.getItem('coinpulse_pending_sid');
      if (pendingSid && !api.getToken()) {
        try {
          const res = await api.getGoogleAuthSession(pendingSid);
          if (res.status === 'authenticated' && res.session) {
            localStorage.removeItem('coinpulse_pending_sid');
            api.setToken(res.session.token);
            setCurrentUser(res.session.user);
            setBalance({
              balance:
                typeof res.session.balance?.totalBalance === 'number'
                  ? res.session.balance.totalBalance
                  : res.session.balance?.balance ?? 0,
              totalMined: res.session.balance?.totalMined ?? 0,
              totalReferralBonus: res.session.balance?.totalReferralBonus ?? 0,
              lastCalculatedAt: res.session.balance?.lastCalculatedAt ?? new Date().toISOString(),
              integrityVerified: true,
            });
            applyAuthoritativeMiningStatus(res.session.miningState);
            setIsAuthOpen(false);
            showNotification(res.session.message || 'Signed in with Google!', 'success');
            syncServerData();
            return;
          }
        } catch {}
      }

      // 3. For authenticated sessions, immediately fetch fresh authoritative mining state & balance from server
      if (api.getToken()) {
        const now = Date.now();
        if (now - lastSyncAtRef.current >= 400) {
          syncServerData();
        }
      }
    };

    window.addEventListener('coinpulse-deep-link-auth', handleDeepLinkAuth);
    window.addEventListener('coinpulse-app-resume', handleAppResume);
    window.addEventListener('resume', handleAppResume);
    document.addEventListener('resume', handleAppResume);
    document.addEventListener('visibilitychange', handleAppResume);
    window.addEventListener('focus', handleAppResume);
    window.addEventListener('pageshow', handleAppResume);

    // Optional Capacitor App plugin listener if present at runtime
    let capAppListener: any = null;
    const capAppPlugin = (window as any).Capacitor?.Plugins?.App;
    if (capAppPlugin && typeof capAppPlugin.addListener === 'function') {
      try {
        capAppListener = capAppPlugin.addListener('appStateChange', (state: { isActive: boolean }) => {
          if (state?.isActive) {
            handleAppResume();
          }
        });
      } catch {}
    }

    const pendingGoogleToken = sessionStorage.getItem('pending_google_token');
    if (pendingGoogleToken) {
      sessionStorage.removeItem('pending_google_token');
      api
        .loginWithGoogle(pendingGoogleToken, refParam?.toUpperCase() || undefined)
        .then((res) => {
          setCurrentUser(res.user);
          setBalance({
            balance: res.balance.totalBalance,
            totalMined: res.balance.totalMined,
            totalReferralBonus: res.balance.totalReferralBonus,
            lastCalculatedAt: res.balance.lastCalculatedAt,
            integrityVerified: true,
          });
          applyAuthoritativeMiningStatus(res.miningState);
          setIsAuthOpen(false);
          showNotification(res.message, 'success');
          syncServerData();
        })
        .catch((err) => {
          showNotification(err.message || 'Google sign-in failed', 'error');
          setIsAuthOpen(true);
        });
    } else if (api.getToken()) {
      setIsAuthOpen(false);
      syncServerData();
    } else {
      // Auto open Google auth on first visit so user can sign in
      setIsAuthOpen(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('coinpulse-deep-link-auth', handleDeepLinkAuth);
      window.removeEventListener('coinpulse-app-resume', handleAppResume);
      window.removeEventListener('resume', handleAppResume);
      document.removeEventListener('resume', handleAppResume);
      document.removeEventListener('visibilitychange', handleAppResume);
      window.removeEventListener('focus', handleAppResume);
      window.removeEventListener('pageshow', handleAppResume);
      if (capAppListener && typeof capAppListener.remove === 'function') {
        try {
          capAppListener.remove();
        } catch {}
      }
    };
  }, [applyAuthoritativeMiningStatus, computeRemainingFromStatus, syncServerData]);

  // Handle timestamp-driven countdown tick (calculates remaining time from server nextMiningAvailableAt)
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const statusObj = miningStatusRef.current;
      if (!statusObj) {
        setRemainingSeconds(0);
        return;
      }

      const nextRemaining = computeRemainingFromStatus(statusObj);
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0 && statusObj.nextMiningAvailableAt > 0 && !cooldownCompletionSyncedRef.current) {
        cooldownCompletionSyncedRef.current = true;
        // Cooldown finished: re-sync with server to confirm authoritative 'available' status
        syncServerData();
      }
    };

    tick();
    timerRef.current = window.setInterval(tick, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [miningStatus?.nextMiningAvailableAt, computeRemainingFromStatus, syncServerData]);

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

      // Immediately apply authoritative server timestamps and balance from /api/mine response
      updateServerClockOffset(res.serverTime);
      setBalance((prev) => ({
        balance: res.newBalance,
        totalMined: res.totalMined,
        totalReferralBonus: prev?.totalReferralBonus ?? 0,
        lastCalculatedAt: new Date(res.serverTime || Date.now()).toISOString(),
        integrityVerified: true,
      }));

      if (res.miningState) {
        applyAuthoritativeMiningStatus(res.miningState);
      } else {
        const nextStatus: MiningStatusResponse = {
          success: true,
          status: 'mining',
          isCooldownActive: true,
          remainingSeconds: Math.ceil(Math.max(0, res.nextMiningAvailableAt - (res.serverTime || Date.now())) / 1000),
          nextMiningAvailableAt: res.nextMiningAvailableAt,
          currentCycleStartTime: res.cycleStartTime,
          lastMinedAt: res.cycleStartTime,
          totalCyclesCompleted: res.sessionNumber,
          baseMiningRate: miningStatus?.baseMiningRate ?? currentUser.baseMiningRate ?? 0.12,
          bonusMiningRate: miningStatus?.bonusMiningRate ?? currentUser.bonusMiningRate ?? 0.0,
          totalMiningRate: res.currentMiningRate,
          activeReferralsCount: miningStatus?.activeReferralsCount ?? 0,
          serverTime: res.serverTime || Date.now(),
        };
        applyAuthoritativeMiningStatus(nextStatus);
      }
      setResumeSyncTick((t) => t + 1);

      showNotification(
        `Mined +${res.minedAmount.toFixed(4)} CP! ${
          res.referralActivated ? '🎉 Referral activated! Rate permanently boosted!' : ''
        }`,
        'success'
      );

      // Re-sync all states with server
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
    applyAuthoritativeMiningStatus(null);
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
    applyAuthoritativeMiningStatus(state);
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
              nextMiningAvailableAt={miningStatus?.nextMiningAvailableAt ?? 0}
              cycleStartTime={miningStatus?.currentCycleStartTime ?? null}
              serverClockOffsetMs={serverClockOffset}
              resumeSyncTick={resumeSyncTick}
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
