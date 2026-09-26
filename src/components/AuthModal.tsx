import React, { useState, useEffect, useRef } from 'react';
import { X, Shield, Sparkles, AlertCircle, CheckCircle2, HelpCircle } from 'lucide-react';
import { api, getApiBaseUrl, isNativeCapacitorOrigin } from '../api.ts';
import { User, BalanceState, MiningStatusResponse } from '../types.ts';

declare global {
  interface Window {
    google?: any;
    handleGoogleCredentialResponse?: (response: any) => void;
    CoinPulseNative?: {
      openExternalUrl?: (url: string) => boolean;
      consumePendingAuth?: () => string;
    };
    __COINPULSE_DEEP_LINK_AUTH__?: {
      token?: string;
      sid?: string;
      error?: string;
    };
  }
}

function generateClientAuthSessionId(): string {
  const rand = Math.random().toString(36).substring(2, 12);
  return `gsess_${Date.now().toString(36)}_${rand}`;
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
  const [hasGoogleClientId, setHasGoogleClientId] = useState<boolean | null>(true);
  const [authSessionId, setAuthSessionId] = useState<string>(() => generateClientAuthSessionId());
  const [prefetchedAuthUrl, setPrefetchedAuthUrl] = useState<string>('');
  const [showConfigHelp, setShowConfigHelp] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

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
    setIsLoading(false);
    onSuccess(sessionData.user, normalizedBalance, sessionData.miningState);
    onClose();
  };

  const restoreFromSessionToken = async (sessionToken: string, sid?: string) => {
    if (!sessionToken || completedRef.current) return;
    setIsLoading(true);
    setError(null);
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
      api.setToken(sessionToken);
      const [meRes, statusRes] = await Promise.all([api.getMe(), api.getMiningStatus()]);
      completeWithVerifiedSession({
        token: sessionToken,
        user: meRes.user,
        balance: meRes.balance,
        miningState: statusRes,
      });
    } catch (err: any) {
      api.setToken(null);
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

    // Always open a real OAuth URL immediately (never about:blank)
    const targetOAuthUrl =
      prefetchedAuthUrl ||
      api.getGoogleDirectStartUrl({
        sid: activeSid,
        redirectUri: effectiveRedirectUri,
        referralCode: referralCode.trim() || undefined,
        origin: window.location.origin,
        platform,
        mode: isCap ? 'redirect' : 'popup',
      });

    let popup: Window | null = null;

    if (isCap) {
      // On Android Capacitor, launch Chrome / system browser via Intent so the WebView stays on CoinPulse
      let launchedNatively = false;
      try {
        if (window.CoinPulseNative?.openExternalUrl) {
          launchedNatively = Boolean(window.CoinPulseNative.openExternalUrl(targetOAuthUrl));
        }
      } catch {}

      if (!launchedNatively) {
        const link = document.createElement('a');
        link.href = targetOAuthUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          try {
            document.body.removeChild(link);
          } catch {}
        }, 200);
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
    let bc: BroadcastChannel | null = null;

    const cleanupListeners = () => {
      if (pollInterval) window.clearInterval(pollInterval);
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
      } catch {
        // Ignore transient polling errors while user is on Google sign-in screen
      }
    };

    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        checkSessionNow();
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

      // Timeout after 5 minutes on mobile Capacitor
      if (isCap && ticks > 250) {
        cleanupListeners();
        setIsLoading(false);
        setAuthSessionId(generateClientAuthSessionId());
      }
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#0e1628] to-[#070b14] border border-slate-800 p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2.5 rounded-xl bg-cyan-950 border border-cyan-800/80 text-cyan-400">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
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
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Sign In to CoinPulse</h2>
              <p className="text-[11px] text-slate-400">Authentication powered exclusively by Google</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Security Assurance Badge */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>OAuth 2.0 / OpenID Connect verified on server with persistent Google Subject ID.</span>
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
              <div className="w-4 h-4 rounded-full border-2 border-slate-900 border-t-transparent animate-spin" />
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
        </div>

        {/* Informational Notes */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>First time? Your miner account is created automatically.</span>
            {hasGoogleClientId !== null && (
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[9px] uppercase ${
                  hasGoogleClientId
                    ? 'bg-emerald-950/70 border border-emerald-800/60 text-emerald-300'
                    : 'bg-amber-950/70 border border-amber-800/60 text-amber-300'
                }`}
              >
                {hasGoogleClientId ? 'OAuth Ready' : 'Config Missing'}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => setShowConfigHelp(!showConfigHelp)}
              className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[11px]"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Google OAuth Setup Info</span>
            </button>

            <button
              type="button"
              onClick={() => setShowManualInput(!showManualInput)}
              className="text-slate-400 hover:text-slate-200 text-[10px] underline"
            >
              Manual token input
            </button>
          </div>

          {showManualInput && (
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
              <label className="text-[10px] uppercase font-mono text-slate-400 block">
                Google ID Token or Access Token
              </label>
              <textarea
                rows={2}
                placeholder="Paste Google JWT id_token (e.g. eyJhbGci...)"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => handleGoogleTokenSubmit(manualToken)}
                disabled={isLoading || !manualToken.trim()}
                className="w-full py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs"
              >
                Verify &amp; Sign In with Token
              </button>
            </div>
          )}

          {showConfigHelp && (
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 space-y-1.5">
              <div className="font-semibold text-white flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Google Cloud OAuth 2.0 Credentials:</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed break-all">
                1. Set <code className="text-cyan-300 font-mono">GOOGLE_CLIENT_ID</code> to your <strong>Web application</strong> OAuth Client ID (not the Android Client ID).
                <br />
                2. Add these exact <strong>Authorized redirect URIs</strong> to your Web Client in Google Cloud Console:
                <br />
                <code className="text-cyan-300 font-mono">https://ais-dev-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app/auth/callback</code>
                <br />
                <code className="text-cyan-300 font-mono">https://ais-pre-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app/auth/callback</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
