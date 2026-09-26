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

const DEV_BACKEND_URL =
  'https://ais-dev-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app';
const PRE_BACKEND_URL =
  'https://ais-pre-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app';

declare const __COINPULSE_APP_URL__: string | undefined;

let resolvedNativeBackendUrl: string | null = null;

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
    if (resolvedNativeBackendUrl) {
      return resolvedNativeBackendUrl;
    }
    const configuredUrl =
      typeof __COINPULSE_APP_URL__ !== 'undefined' && __COINPULSE_APP_URL__
        ? __COINPULSE_APP_URL__.replace(/\/+$/, '')
        : DEV_BACKEND_URL;
    // Prefer DEV_BACKEND_URL as primary since ais-pre returns 404 unless explicitly deployed
    if (configuredUrl === PRE_BACKEND_URL) {
      return DEV_BACKEND_URL;
    }
    return configuredUrl;
  }
  return '';
}

function getFallbackBackendUrl(currentBase: string): string {
  return currentBase === DEV_BACKEND_URL ? PRE_BACKEND_URL : DEV_BACKEND_URL;
}

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY);
  }

  getToken(): string | null {
    if (!this.token && typeof window !== 'undefined') {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        this.token = stored;
      }
    }
    return this.token;
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const currentToken = this.getToken();
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const baseUrl = getApiBaseUrl();
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

    try {
      let response = await fetch(url, {
        ...options,
        headers,
      });

      // Automatic failover between ais-dev and ais-pre when running inside Android Capacitor APK
      if (
        !endpoint.startsWith('http') &&
        isNativeCapacitorOrigin() &&
        (response.status === 404 || response.status === 502 || response.status === 503)
      ) {
        const altBase = getFallbackBackendUrl(baseUrl);
        try {
          const altRes = await fetch(`${altBase}${endpoint}`, {
            ...options,
            headers,
          });
          if (altRes.ok || altRes.status !== 404) {
            resolvedNativeBackendUrl = altBase;
            response = altRes;
          }
        } catch {
          // Keep original response if fallback fails
        }
      }

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid
          this.setToken(null);
        }
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }

      return data as T;
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('Network connection issue. Please check your internet connection.');
      }
      throw err;
    }
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
    return `${getApiBaseUrl()}/api/auth/google/start?${search.toString()}`;
  }

  async getGoogleAuthSession(sid: string) {
    return this.request<{
      success: boolean;
      status: 'pending' | 'authenticated' | 'error';
      session?: {
        success: boolean;
        token: string;
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
    const res = await this.request<{
      success: boolean;
      token: string;
      user: User;
      balance: any;
      miningState: any;
      isNewUser: boolean;
      serverTime: number;
      message: string;
    }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ token: googleToken, referralCode }),
    });
    this.setToken(res.token);
    return res;
  }

  async getMe() {
    return this.request<{
      success: boolean;
      user: User;
      balance: any;
      miningState: any;
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
      serverTime: number;
    }>('/api/mine', {
      method: 'POST',
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
