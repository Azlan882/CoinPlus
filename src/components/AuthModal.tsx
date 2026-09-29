import React, { useState, useEffect, useRef } from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, getApiBaseUrl, isNativeCapacitorOrigin } from '../api.ts';
import { User, BalanceState, MiningStatusResponse } from '../types.ts';

declare global {
  interface Window {
    google?: any;
    handleGoogleCredentialResponse?: (response: any) => void;
    CoinPulseNative?: {
      openExternalUrl?: (url: string) => boolean;
      consumePendingAuth?: () => string;
      getPersistedToken?: () => string;
      setPersistedToken?: (token: string) => void;
      getPersistedCheckpoint?: () => string;
      setPersistedCheckpoint?: (ckpt: string) => void;
      clearPersistedSession?: () => void;
      getNotificationPermissionStatus?: () => string;
      requestNotificationPermissionOnce?: () => string;
      scheduleMiningCycleNotification?: (
        cycleKey: string,
        triggerAtEpochMs: number,
        notificationId: number,
        title: string,
        body: string
      ) => boolean;
      cancelMiningCycleNotification?: () => void;
      getScheduledMiningCycleNotification?: () => string;
      consumeNotificationTap?: () => string;
    };
    __COINPULSE_DEEP_LINK_AUTH__?: {
      token?: string;
      sid?: string;
      ckpt?: string;
      error?: string;
    };
    __COINPULSE_NOTIFICATION_TAP__?: {
      tapped?: boolean;
      targetTab?: string;
      cycleKey?: string;
      cycleEndMs?: number;
      timestamp?: number;
    };
  }
}

function generateClientAuthSessionId(): string {
  const rand = Math.random().toString(36).substring(2, 12);
  return `gsess_${Date.now().toString(36)}_${rand}`;
}

function buildDirectGoogleOAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  sid: string;
  referralCode?: string;
  origin: string;
  platform: string;
  mode: string;
}): string {
  const nonce =
    Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
  const state = JSON.stringify({
    sid: params.sid,
    ref: (params.referralCode || '').trim().toUpperCase(),
    origin: params.origin,
    platform: params.platform,
    mode: params.mode,
  });
  const search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'id_token token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${search.toString()}`;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User, balance: BalanceState, miningState: MiningStatusResponse) => void;
  initialRefCode?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialRefCode,
}) => {
  const [referralCode, setReferralCode] = useState(initialRefCode || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string>(
    '705048511305-64rki2ql9ishnriq7g1o4sbdbsdclgi7.apps.googleusercontent.com'
  );
  const [, setHasGoogleClientId] = useState<boolean | null>(true);
  const [authSessionId, setAuthSessionId] = useState<string>(() => generateClientAuthSessionId());
  const [prefetchedAuthUrl, setPrefetchedAuthUrl] = useState<string>('');

  const completedRef = useRef(false);
  const referralCodeRef = useRef(referralCode);
  referralCodeRef.current = referralCode;

  // Sync initial referral code from URL or invites
  useEffect(() => {
    if (initialRefCode) {
      setReferralCode(initialRefCode);
    }
  }, [initialRefCode]);

  // Fetch Google Auth configuration & pre-build OAuth URL from backend
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    completedRef.current = false;

    const loadConfigAndUrl = async () => {
      try {
        const cfg = await api.getGoogleConfig();
        if (!isMounted) return;
        const isConfigured = Boolean(cfg.hasGoogleClientId || cfg.configured);
        setHasGoogleClientId(isConfigured);
        if (cfg.clientId) {
          setGoogleClientId(cfg.clientId);
        }

        if (isConfigured) {
          const isCap = isNativeCapacitorOrigin();
          const platform = isCap ? 'capacitor' : 'web';
          const effectiveRedirectUri = isCap
            ? `${getApiBaseUrl()}/auth/callback`
            : `${window.location.origin}/auth/callback`;
          const urlRes = await api.getGoogleAuthUrl({
            sid: authSessionId,
            redirectUri: effectiveRedirectUri,
            referralCode: referralCode.trim() || undefined,
            origin: window.location.origin,
            platform,
            mode: isCap ? 'redirect' : 'popup',
          });
          if (isMounted && urlRes.url) {
            setPrefetchedAuthUrl(urlRes.url);
          }
        }
      } catch (err) {
        console.warn('Failed to load Google auth configuration:', err);
      }
    };

    loadConfigAndUrl();

    return () => {
      isMounted = false;
    };
  }, [isOpen, referralCode, authSessionId]);

  if (!isOpen) return null;

  const completeWithVerifiedSession = (sessionData: {
    token: string;
    stateCheckpoint?: string;
    user: User;
    balance: any;
    miningState: MiningStatusResponse;
  }) => {
    if (completedRef.current) return;
    completedRef.current = true;
    try {
      localStorage.removeItem('coinpulse_pending_sid');
    } catch {}
    api.setToken(sessionData.token);
    if (sessionData.stateCheckpoint) {
      api.setCheckpoint(sessionData.stateCheckpoint);
    } else if (sessionData.miningState?.stateCheckpoint) {
      api.setCheckpoint(sessionData.miningState.stateCheckpoint);
    }
    const normalizedBalance: BalanceState = {
      balance:
        typeof sessionData.balance?.totalBalance === 'number'
          ? sessionData.balance.totalBalance
          : sessionData.balance?.balance ?? 0,
      totalMined: sessionData.balance?.totalMined ?? 0,
      totalReferralBonus: sessionData.balance?.totalReferralBonus ?? 0,
      lastCalculatedAt: sessionData.balance?.lastCalculatedAt ?? new Date().toISOString(),
      integrityVerified: true,
    };
    api.setCachedSession({
      user: sessionData.user,
      balance: normalizedBalance,
      miningState: sessionData.miningState,
      updatedAt: Date.now(),
    });
    setIsLoading(false);
    onSuccess(sessionData.user, normalizedBalance, sessionData.miningState);
    onClose();
  };

  const restoreFromSessionToken = async (sessionToken: string, sid?: string) => {
    if (!sessionToken || completedRef.current) return;
    setIsLoading(true);
    setError(null);
    api.setToken(sessionToken);
    try {
      if (sid) {
        try {
          const statusRes = await api.getGoogleAuthSession(sid);
          if (statusRes.status === 'authenticated' && statusRes.session) {
            completeWithVerifiedSession(statusRes.session);
            return;
          }
        } catch {}
      }
      const meRes = await api.getMe();
      const statusRes: MiningStatusResponse =
        meRes.miningState || (await api.getMiningStatus());
      completeWithVerifiedSession({
        token: sessionToken,
        stateCheckpoint: meRes.stateCheckpoint || statusRes?.stateCheckpoint,
        user: meRes.user,
        balance: meRes.balance,
        miningState: statusRes,
      });
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        api.setToken(null);
      }
      setIsLoading(false);
      setError(err.message || 'Failed to restore authenticated session.');
    }
  };

  const handleGoogleTokenSubmit = async (tokenString: string) => {
    if (!tokenString || !tokenString.trim()) {
      setError('Please provide a valid Google credential or token.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const res = await api.loginWithGoogle(
        tokenString.trim(),
        referralCodeRef.current.trim() || undefined
      );
      completeWithVerifiedSession(res);
    } catch (err: any) {
      setError(err.message || 'Google authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * OAuth 2.0 Flow (Standard Web, AI Studio Iframe & Android Capacitor compatible)
   *
   * 1. When Google Identity Services (`window.google.accounts.oauth2.initTokenClient`) is loaded
   *    and the current origin is an Authorized JavaScript Origin (.run.app), uses Google's official
   *    storagerelay:// popup channel so the popup returns the OAuth token directly to this window
   *    without triggering AI Studio's top-level proxy auth bridge redirect on /auth/callback.
   * 2. On Android Capacitor (`isNativeCapacitorOrigin()`), opens Google OAuth in the system browser
   *    (Chrome) via the native intent bridge or external anchor so the WebView stays on CoinPulse,
   *    and receives the authenticated session via `com.coinpulse.mining://auth` deep link + server polling.
   */
  const handleDirectOAuthFlow = async () => {
    setError(null);
    setInfoMessage(null);
    completedRef.current = false;

    const isCap = isNativeCapacitorOrigin();
    if (!isCap && googleClientId && window.google?.accounts?.oauth2?.initTokenClient) {
      try {
        setIsLoading(true);
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'openid email profile',
          prompt: 'select_account',
          callback: (tokenResponse: any) => {
            if (tokenResponse?.error) {
              setIsLoading(false);
              setError(
                tokenResponse.error_description ||
                  (tokenResponse.error === 'access_denied'
                    ? 'Google sign-in was cancelled.'
                    : `Google authentication error: ${tokenResponse.error}`)
              );
              return;
            }
            if (tokenResponse?.access_token) {
              handleGoogleTokenSubmit(tokenResponse.access_token);
            } else {
              setIsLoading(false);
              setError('No Google credential was returned. Please try again.');
            }
          },
          error_callback: (err: any) => {
            setIsLoading(false);
            if (err?.type === 'popup_closed') {
              setError('Google sign-in window was closed before completing authentication.');
            } else if (err?.type === 'popup_failed_to_open') {
              setInfoMessage('Popup was blocked by your browser. Please allow popups for CoinPulse.');
            } else {
              setError(err?.message || 'Google sign-in was cancelled.');
            }
          },
        });
        tokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      } catch (gisErr) {
        console.warn('GIS initTokenClient fallback to direct OAuth popup:', gisErr);
      }
    }

    const platform = isCap ? 'capacitor' : 'web';
    const activeSid = authSessionId;
    const effectiveRedirectUri = isCap
      ? `${getApiBaseUrl()}/auth/callback`
      : `${window.location.origin}/auth/callback`;

    try {
      localStorage.setItem('coinpulse_pending_sid', activeSid);
    } catch {}

    // Always build a direct https://accounts.google.com/o/oauth2/v2/auth URL so opening OAuth never blocks on backend cold-start
    const targetOAuthUrl =
      prefetchedAuthUrl ||
      buildDirectGoogleOAuthUrl({
        clientId: googleClientId,
        redirectUri: effectiveRedirectUri,
        sid: activeSid,
        referralCode: referralCode.trim() || undefined,
        origin: window.location.origin,
        platform,
        mode: isCap ? 'redirect' : 'popup',
      });

    // Register session & checkpoint with backend in background while user selects their Google account
    api
      .getGoogleAuthUrl({
        sid: activeSid,
        redirectUri: effectiveRedirectUri,
        referralCode: referralCode.trim() || undefined,
        origin: window.location.origin,
        platform,
        mode: isCap ? 'redirect' : 'popup',
      })
      .catch(() => {});

    let popup: Window | null = null;

    if (isCap) {
      // On Android Capacitor:
      // 1. Try native JavascriptInterface bridge (CoinPulseNative.openExternalUrl)
      // 2. Fallback to top-level navigation to accounts.google.com, which Capacitor's BridgeWebViewClient.shouldOverrideUrlLoading
      //    intercepts for non-localhost hosts to launch Intent.ACTION_VIEW in Chrome while keeping the WebView on https://localhost
      let launchedNatively = false;
      try {
        if (window.CoinPulseNative?.openExternalUrl) {
          launchedNatively = Boolean(window.CoinPulseNative.openExternalUrl(targetOAuthUrl));
        }
      } catch {}

      if (!launchedNatively) {
        try {
          window.location.assign(targetOAuthUrl);
        } catch (navErr: any) {
          setError(navErr?.message || 'Unable to launch Google sign-in browser.');
          return;
        }
      }
    } else {
      popup = window.open(
        targetOAuthUrl,
        'google_auth_popup',
        'width=500,height=650,left=150,top=100'
      );

      if (!popup) {
        setInfoMessage('Popup was blocked by your browser. Please allow popups for CoinPulse.');
        return;
      }
    }

    setIsLoading(true);

    let pollInterval: number | undefined;
    let resumeResetTimeout: number | undefined;
    let bc: BroadcastChannel | null = null;
    let consecutivePollErrors = 0;

    const cleanupListeners = () => {
      if (pollInterval) window.clearInterval(pollInterval);
      if (resumeResetTimeout) window.clearTimeout(resumeResetTimeout);
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('coinpulse-deep-link-auth', deepLinkHandler as EventListener);
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('focus', visibilityHandler);
      if (bc) {
        try {
          bc.close();
        } catch {}
        bc = null;
      }
      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch {}
    };

    const handlePayload = (payload: any) => {
      if (!payload || completedRef.current) return;
      if (payload.type === 'GOOGLE_AUTH_SUCCESS') {
        cleanupListeners();
        if (payload.session && payload.session.token && payload.session.user) {
          completeWithVerifiedSession(payload.session);
        } else if (payload.token) {
          handleGoogleTokenSubmit(payload.token);
        }
      } else if (payload.type === 'GOOGLE_AUTH_ERROR') {
        cleanupListeners();
        setIsLoading(false);
        setError(payload.error || 'Google authentication was cancelled or failed.');
        setAuthSessionId(generateClientAuthSessionId());
      }
    };

    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS' || event.data?.type === 'GOOGLE_AUTH_ERROR') {
        handlePayload(event.data);
      }
    };

    const storageHandler = (event: StorageEvent) => {
      if (event.key === 'coinpulse_auth_event' && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (parsed?.payload) {
            handlePayload(parsed.payload);
          }
        } catch {}
      }
    };

    const deepLinkHandler = (event: CustomEvent) => {
      if (completedRef.current) return;
      const detail = event.detail || window.__COINPULSE_DEEP_LINK_AUTH__ || {};
      if (detail.ckpt) {
        api.setCheckpoint(detail.ckpt);
      }
      if (detail.token) {
        cleanupListeners();
        restoreFromSessionToken(detail.token, detail.sid || activeSid);
      } else if (detail.error) {
        cleanupListeners();
        setIsLoading(false);
        setError(detail.error);
        setAuthSessionId(generateClientAuthSessionId());
      }
    };

    const checkSessionNow = async () => {
      if (completedRef.current) return;

      // Check native bridge pending auth first if on Android
      if (isCap) {
        try {
          if (window.CoinPulseNative?.consumePendingAuth) {
            const raw = window.CoinPulseNative.consumePendingAuth();
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.ckpt) {
                api.setCheckpoint(parsed.ckpt);
              }
              if (parsed?.token) {
                cleanupListeners();
                await restoreFromSessionToken(parsed.token, parsed.sid || activeSid);
                return;
              }
              if (parsed?.error) {
                cleanupListeners();
                setIsLoading(false);
                setError(parsed.error);
                setAuthSessionId(generateClientAuthSessionId());
                return;
              }
            }
          }
        } catch {}
      }

      try {
        const statusRes = await api.getGoogleAuthSession(activeSid);
        consecutivePollErrors = 0;
        if (statusRes.status === 'authenticated' && statusRes.session) {
          cleanupListeners();
          completeWithVerifiedSession(statusRes.session);
          return;
        }
        if (statusRes.status === 'error') {
          cleanupListeners();
          setIsLoading(false);
          setError(statusRes.error || 'Google sign-in was cancelled.');
          setAuthSessionId(generateClientAuthSessionId());
          return;
        }
      } catch (pollErr: any) {
        consecutivePollErrors++;
        if (consecutivePollErrors >= 6 && !completedRef.current) {
          cleanupListeners();
          setIsLoading(false);
          setError(
            pollErr?.message ||
              'Unable to reach CoinPulse authentication server. Please verify your connection and try again.'
          );
          setAuthSessionId(generateClientAuthSessionId());
        }
      }
    };

    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        checkSessionNow();
        if (isCap) {
          if (resumeResetTimeout) window.clearTimeout(resumeResetTimeout);
          resumeResetTimeout = window.setTimeout(async () => {
            await checkSessionNow();
            if (!completedRef.current) {
              cleanupListeners();
              setIsLoading(false);
              setAuthSessionId(generateClientAuthSessionId());
            }
          }, 2500);
        }
      }
    };

    window.addEventListener('message', messageHandler);
    window.addEventListener('storage', storageHandler);
    window.addEventListener('coinpulse-deep-link-auth', deepLinkHandler as EventListener);
    document.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('focus', visibilityHandler);

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('coinpulse_auth');
        bc.onmessage = (ev) => handlePayload(ev.data);
      } catch {}
    }

    // Server-side session handoff polling (guarantees return even if COOP severs window.opener or in Capacitor)
    let ticks = 0;
    pollInterval = window.setInterval(async () => {
      ticks++;
      if (completedRef.current) {
        cleanupListeners();
        return;
      }

      await checkSessionNow();
      if (completedRef.current) return;

      // On web popup only: if popup was manually closed by user before completing sign-in
      if (!isCap && popup && popup.closed && ticks > 2) {
        await checkSessionNow();
        if (completedRef.current) return;
        cleanupListeners();
        setIsLoading(false);
        setAuthSessionId(generateClientAuthSessionId());
      }

      // Timeout after 90 seconds on mobile Capacitor so it never spins forever
      if (isCap && ticks > 75) {
        cleanupListeners();
        setIsLoading(false);
        setError('Google sign-in timed out or was not completed. Please tap Continue with Google to try again.');
        setAuthSessionId(generateClientAuthSessionId());
      }
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#0e1628] to-[#070b14] border border-slate-800 p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="CoinPulse"
              className="w-10 h-10 rounded-xl object-contain shadow-lg shadow-blue-500/20 shrink-0"
            />
            <div>
              <h2 className="text-base font-bold text-white">Sign In to CoinPulse</h2>
              <p className="text-xs text-slate-400">Sign in securely with your Google account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-xs text-red-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        {infoMessage && (
          <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-800/80 text-xs text-cyan-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="flex-1">{infoMessage}</div>
          </div>
        )}

        {/* Optional Referral Code for New Google Accounts */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] uppercase font-mono text-slate-400">
              Referral Code (Optional)
            </label>
            <span className="text-[10px] text-emerald-400 font-medium">+0.01 CP/h bonus</span>
          </div>
          <input
            type="text"
            placeholder="e.g. ADMINPULSE"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono uppercase text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <p className="text-[10px] text-slate-500">
            If invited by a friend, enter their code before continuing.
          </p>
        </div>

        {/* Primary Google Authentication Button */}
        <div className="space-y-3 pt-2">
          {/* Direct OAuth Continue Button */}
          <button
            type="button"
            onClick={handleDirectOAuthFlow}
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs sm:text-sm shadow-lg shadow-white/10 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-slate-900 border-t-transparent animate-spin" />
                <span>Connecting to Google...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          {isLoading && (
            <button
              type="button"
              onClick={() => {
                setIsLoading(false);
                setAuthSessionId(generateClientAuthSessionId());
              }}
              className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              Cancel / Retry Google Sign-In
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
