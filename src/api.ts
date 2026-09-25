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

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY);
  }

  getToken(): string | null {
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

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(endpoint, {
        ...options,
        headers,
      });

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
  async register(params: { username: string; email: string; password: string; referralCode?: string }) {
    const res = await this.request<{
      success: boolean;
      token: string;
      user: User;
      balance: any;
      miningState: any;
      message: string;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    this.setToken(res.token);
    return res;
  }

  async login(identifier: string, password: string) {
    const res = await this.request<{
      success: boolean;
      token: string;
      user: User;
      balance: any;
      miningState: any;
      serverTime: number;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
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
