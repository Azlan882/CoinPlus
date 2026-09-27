import {
  User,
  BalanceState,
  MiningStatusResponse,
  ReferralsResponse,
  TransactionItem,
  AdminStats,
  AdminUserItem,
  SecurityEventItem,
} from './types.ts';

const TOKEN_KEY = 'coinpulse_session_token';
const CHECKPOINT_KEY = 'coinpulse_state_checkpoint';
const CACHED_SESSION_KEY = 'coinpulse_cached_session';

const DEV_BACKEND_URL =
  'https://ais-dev-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app';
const PRE_BACKEND_URL =
  'https://ais-pre-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app';

declare const __COINPULSE_APP_URL__: string | undefined;

export interface ApiError extends Error {
  status?: number;
  data?: any;
}

export interface CachedUserSession {
  user: User;
  balance: BalanceState;
  miningState: MiningStatusResponse | null;
  updatedAt: number;
}

function decodeCheckpointPayload(ckpt: string | null | undefined): any | null {
  if (!ckpt || typeof ckpt !== 'string') return null;
  try {
    const parts = ckpt.split('.');
    if (parts.length !== 2) return null;
    const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const jsonStr = atob(padded);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export function isNativeCapacitorOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname, port } = window.location;
  return (
    protocol === 'capacitor:' ||
    protocol === 'file:' ||
    ((hostname === 'localhost' || hostname === '127.0.0.1') && !port)
  );
}

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (isNativeCapacitorOrigin()) {
    const configuredUrl =
      typeof __COINPULSE_APP_URL__ !== 'undefined' && __COINPULSE_APP_URL__
        ? __COINPULSE_APP_URL__.replace(/\/+$/, '')
        : DEV_BACKEND_URL;
    // Always use the stable DEV_BACKEND_URL when configuredUrl is PRE_BACKEND_URL (which returns 403/404)
    if (configuredUrl === PRE_BACKEND_URL) {
      return DEV_BACKEND_URL;
    }
    return configuredUrl;
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ApiService {
  private token: string | null = null;
  private checkpoint: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.token = localStorage.getItem(TOKEN_KEY);
        this.checkpoint = localStorage.getItem(CHECKPOINT_KEY);
      } catch {}
    }
  }

  getToken(): string | null {
    if (!this.token && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(TOKEN_KEY);
        if (stored) {
          this.token = stored;
        }
      } catch {}
    }
    return this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      try {
        if (token) {
          localStorage.setItem(TOKEN_KEY, token);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      } catch {}
    }
  }

  getCachedSession(): CachedUserSession | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(CACHED_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedUserSession;
      if (parsed && parsed.user && parsed.user.id) {
        return parsed;
      }
    } catch {}
    return null;
  }

  setCachedSession(session: CachedUserSession | null) {
    if (typeof window === 'undefined') return;
    try {
      if (session && session.user) {
        localStorage.setItem(CACHED_SESSION_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(CACHED_SESSION_KEY);
      }
    } catch {}
  }

  getCheckpoint(): string | null {
    if (!this.checkpoint && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(CHECKPOINT_KEY);
        if (stored) {
          this.checkpoint = stored;
        }
      } catch {}
    }
    return this.checkpoint;
  }

  setCheckpoint(checkpoint: string | null) {
    if (!checkpoint) {
      return;
    }

    // Never overwrite an existing checkpoint for the same user that has a higher balance or cycle count
    const existing = this.getCheckpoint();
    if (existing) {
      const existingPayload = decodeCheckpointPayload(existing);
      const nextPayload = decodeCheckpointPayload(checkpoint);
      if (existingPayload && nextPayload) {
        const sameUser =
          existingPayload.userId === nextPayload.userId ||
          (existingPayload.googleId && existingPayload.googleId === nextPayload.googleId) ||
          (existingPayload.email &&
            nextPayload.email &&
            existingPayload.email.toLowerCase() === nextPayload.email.toLowerCase());
        if (
          sameUser &&
          ((existingPayload.totalBalance ?? 0) > (nextPayload.totalBalance ?? 0) + 0.000001 ||
            (existingPayload.totalCyclesCompleted ?? 0) > (nextPayload.totalCyclesCompleted ?? 0))
        ) {
          return;
        }
      }
    }

    this.checkpoint = checkpoint;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(CHECKPOINT_KEY, checkpoint);
        const parsed = decodeCheckpointPayload(checkpoint);
        if (parsed?.userId) {
          localStorage.setItem(`${CHECKPOINT_KEY}_${parsed.userId}`, checkpoint);
        }
      } catch {}
    }
  }

  private captureCheckpointFromResponse(response: Response, data: any) {
    const headerCkpt = response.headers.get('X-CoinPulse-Checkpoint');
    const bodyCkpt =
      (data && typeof data.stateCheckpoint === 'string' && data.stateCheckpoint) ||
      (data?.miningState && typeof data.miningState.stateCheckpoint === 'string' && data.miningState.stateCheckpoint) ||
      (data?.session && typeof data.session.stateCheckpoint === 'string' && data.session.stateCheckpoint);
    const ckpt = headerCkpt || bodyCkpt;
    if (ckpt) {
      this.setCheckpoint(ckpt);
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const currentToken = this.getToken();
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const currentCheckpoint = this.getCheckpoint();
    if (currentCheckpoint) {
      headers['X-CoinPulse-Checkpoint'] = currentCheckpoint;
    }

    const baseUrl = getApiBaseUrl();
    const isAbsolute = endpoint.startsWith('http');
    const primaryUrl = isAbsolute ? endpoint : `${baseUrl}${endpoint}`;

    let response: Response | null = null;
    let rawText = '';
    let lastNetworkError: any = null;

    // Up to 4 attempts to handle stale Android WebView keep-alive sockets after 1h idle or Cloud Run cold-start warmup
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await fetch(primaryUrl, {
          cache: 'no-store',
          mode: 'cors',
          ...options,
          headers,
        });

        rawText = await response.text();
        const trimmed = rawText.trim();
        const isWarmupOrBridgeHtml =
          response.headers.get('X-CoinPulse-Warmup') === '1' ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504 ||
          (response.redirected && response.url.includes('__aistudio_auth_bridge')) ||
          trimmed.includes('__aistudio_auth_bridge') ||
          (trimmed.startsWith('<') && trimmed.includes('Starting Server'));

        if (isWarmupOrBridgeHtml && attempt < maxAttempts) {
          await sleep(650 * attempt);
          continue;
        }

        break;
      } catch (fetchErr: any) {
        lastNetworkError = fetchErr;
        if (attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }
      }
    }

    if (!response) {
      console.error(`[CoinPulse API] Network failure on ${options.method || 'GET'} ${primaryUrl}:`, lastNetworkError);
      throw new Error('Network connection issue. Please check your internet connection.');
    }

    let data: any = null;
    if (rawText && rawText.trim().length > 0) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }

    this.captureCheckpointFromResponse(response, data);

    if (!response.ok) {
      if (
        response.status === 401 &&
        !endpoint.startsWith('/api/auth/google') &&
        data &&
        typeof data === 'object' &&
        data.success === false
      ) {
        // Session token explicitly rejected by CoinPulse server
        this.setToken(null);
        this.setCachedSession(null);
      }
      const serverMessage =
        (data && typeof data.error === 'string' && data.error) ||
        (data && typeof data.message === 'string' && data.message) ||
        `Server returned HTTP ${response.status}`;
      console.warn(
        `[CoinPulse API] HTTP ${response.status} on ${options.method || 'GET'} ${endpoint}:`,
        serverMessage
      );
      const apiErr: ApiError = new Error(serverMessage);
      apiErr.status = response.status;
      apiErr.data = data;
      throw apiErr;
    }

    if (!data || typeof data !== 'object') {
      throw new Error(`Server is warming up or returned non-JSON response (HTTP ${response.status}). Please retry in a moment.`);
    }

    return data as T;
  }

  // --- Auth ---
  async getGoogleConfig() {
    return this.request<{
      success: boolean;
      configured: boolean;
      hasGoogleClientId: boolean;
      clientId: string;
      appUrl: string;
      redirectUri: string;
    }>('/api/auth/google/config', {
      cache: 'no-store',
    });
  }

  async getGoogleAuthUrl(params?: {
    sid?: string;
    redirectUri?: string;
    referralCode?: string;
    origin?: string;
    platform?: string;
    mode?: string;
  }) {
    const search = new URLSearchParams();
    if (params?.sid) search.set('sid', params.sid);
    if (params?.redirectUri) search.set('redirect_uri', params.redirectUri);
    if (params?.referralCode) search.set('ref', params.referralCode);
    if (params?.origin) search.set('origin', params.origin);
    if (params?.platform) search.set('platform', params.platform);
    if (params?.mode) search.set('mode', params.mode);
    const ckpt = this.getCheckpoint();
    if (ckpt) search.set('ckpt', ckpt);
    const qs = search.toString();
    return this.request<{
      success: boolean;
      configured: boolean;
      hasGoogleClientId: boolean;
      redirectUri: string;
      authSessionId: string;
      url: string;
    }>(`/api/auth/google/url${qs ? `?${qs}` : ''}`, {
      cache: 'no-store',
    });
  }

  getGoogleDirectStartUrl(params: {
    sid: string;
    redirectUri?: string;
    referralCode?: string;
    origin?: string;
    platform?: string;
    mode?: string;
  }): string {
    const search = new URLSearchParams();
    search.set('sid', params.sid);
    if (params.redirectUri) search.set('redirect_uri', params.redirectUri);
    if (params.referralCode) search.set('ref', params.referralCode);
    if (params.origin) search.set('origin', params.origin);
    if (params.platform) search.set('platform', params.platform);
    if (params.mode) search.set('mode', params.mode);
    const ckpt = this.getCheckpoint();
    if (ckpt) search.set('ckpt', ckpt);
    return `${getApiBaseUrl()}/api/auth/google/start?${search.toString()}`;
  }

  async getGoogleAuthSession(sid: string) {
    return this.request<{
      success: boolean;
      status: 'pending' | 'authenticated' | 'error';
      session?: {
        success: boolean;
        token: string;
        stateCheckpoint?: string;
        user: User;
        balance: any;
        miningState: any;
        isNewUser: boolean;
        serverTime: number;
        message: string;
      } | null;
      error?: string | null;
    }>(`/api/auth/google/session/${encodeURIComponent(sid)}`, {
      cache: 'no-store',
    });
  }

  async loginWithGoogle(googleToken: string, referralCode?: string) {
    const stateCheckpoint = this.getCheckpoint() || undefined;
    const res = await this.request<{
      success: boolean;
      token: string;
      stateCheckpoint?: string;
      user: User;
      balance: any;
      miningState: any;
      isNewUser: boolean;
      serverTime: number;
      message: string;
    }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        token: googleToken,
        referralCode,
        stateCheckpoint,
      }),
    });
    this.setToken(res.token);
    if (res.stateCheckpoint) {
      this.setCheckpoint(res.stateCheckpoint);
    }
    return res;
  }

  async getMe() {
    return this.request<{
      success: boolean;
      user: User;
      balance: any;
      miningState: any;
      stateCheckpoint?: string;
      referralStats: {
        totalReferrals: number;
        activatedReferrals: number;
        pendingReferrals: number;
      };
      rateHistory: any[];
      serverTime: number;
    }>('/api/auth/me');
  }

  logout() {
    this.setToken(null);
    this.setCachedSession(null);
    // Intentionally preserve coinpulse_state_checkpoint so the user's server-signed balance receipt is never lost
  }

  // --- Mining ---
  async mine() {
    return this.request<{
      success: boolean;
      minedAmount: number;
      newBalance: number;
      totalMined: number;
      nextMiningAvailableAt: number;
      cycleStartTime: number;
      currentMiningRate: number;
      sessionNumber: number;
      referralActivated: boolean;
      message: string;
      miningState?: MiningStatusResponse;
      stateCheckpoint?: string;
      serverTime: number;
    }>('/api/mine', {
      method: 'POST',
      body: JSON.stringify({ clientTimestamp: Date.now() }),
    });
  }

  async getMiningStatus(): Promise<MiningStatusResponse> {
    return this.request<MiningStatusResponse>('/api/mining/status');
  }

  // --- Balance & Ledger ---
  async getBalance(): Promise<BalanceState> {
    return this.request<BalanceState>('/api/balance');
  }

  async verifyBalance() {
    return this.request<{
      success: boolean;
      isTamperFree: boolean;
      recordedBalance: number;
      ledgerReconciledBalance: number;
      transactionCount: number;
      timestamp: string;
    }>('/api/balance/verify');
  }

  async getTransactions(limit = 30) {
    return this.request<{
      success: boolean;
      transactions: TransactionItem[];
    }>(`/api/transactions?limit=${limit}`);
  }

  // --- Referrals ---
  async getReferrals(): Promise<ReferralsResponse> {
    return this.request<ReferralsResponse>('/api/referrals');
  }

  // --- Blockchain ---
  async getBlockchainInfo() {
    return this.request<{
      success: boolean;
      disclaimer: {
        status: string;
        isCryptocurrencyNow: boolean;
        hasMonetaryValue: boolean;
        notice: string;
      };
      migrationBlueprint: any;
    }>('/api/blockchain/info');
  }

  // --- Admin ---
  async getAdminStats(): Promise<{ success: boolean; stats: AdminStats }> {
    return this.request<{ success: boolean; stats: AdminStats }>('/api/admin/stats');
  }

  async getAdminUsers(query = ''): Promise<{ success: boolean; total: number; users: AdminUserItem[] }> {
    return this.request<{ success: boolean; total: number; users: AdminUserItem[] }>(
      `/api/admin/users?q=${encodeURIComponent(query)}`
    );
  }

  async updateUserStatus(id: string, status: 'active' | 'suspended', reason: string) {
    return this.request<{ success: boolean; message: string }>(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  }

  async adjustUserBalance(id: string, amount: number, reason: string) {
    return this.request<{ success: boolean; message: string; balance: any }>(`/api/admin/users/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  }

  async getSecurityEvents(limit = 50): Promise<{ success: boolean; events: SecurityEventItem[] }> {
    return this.request<{ success: boolean; events: SecurityEventItem[] }>(
      `/api/admin/security-events?limit=${limit}`
    );
  }
}

export const api = new ApiService();
