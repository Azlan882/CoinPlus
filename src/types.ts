export type TabType = 'mining' | 'team' | 'ledger' | 'roadmap' | 'admin';

export interface User {
  id: string;
  username: string;
  email: string;
  referralCode: string;
  referredByUserId: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  baseMiningRate: number;
  bonusMiningRate: number;
  totalMiningRate: number;
  createdAt: string;
  lastLoginAt: string;
  lastActiveAt: string;
}

export interface BalanceState {
  balance: number;
  totalMined: number;
  totalReferralBonus: number;
  lastCalculatedAt: string;
  integrityVerified: boolean;
}

export type MiningCycleStatus = 'ready' | 'mining' | 'available';

export interface MiningStatusResponse {
  success: boolean;
  status: MiningCycleStatus;
  isCooldownActive: boolean;
  remainingSeconds: number;
  nextMiningAvailableAt: number;
  currentCycleStartTime: number | null;
  lastMinedAt: number | null;
  totalCyclesCompleted: number;
  baseMiningRate: number;
  bonusMiningRate: number;
  totalMiningRate: number;
  activeReferralsCount: number;
  serverTime: number;
}

export interface ReferralItem {
  id: string;
  username: string;
  status: 'pending' | 'activated';
  joinedAt: string;
  firstMiningCompletedAt: string | null;
  isCurrentlyMining: boolean;
  bonusAwarded: number;
}

export interface ReferralsResponse {
  success: boolean;
  referralCode: string;
  inviteLink: string;
  baseBonusPerReferral: number;
  activeBonusRate: number;
  totalReferrals: number;
  activatedReferrals: number;
  pendingReferrals: number;
  referrals: ReferralItem[];
}

export interface TransactionItem {
  id: string;
  userId: string;
  type: 'mining_reward' | 'referral_bonus' | 'admin_adjustment';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  description: string;
  timestamp: string;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers24h: number;
  totalCoinsMined: number;
  totalReferrals: number;
  activatedReferrals: number;
  totalMiningSessions: number;
  securityEventsCount: number;
}

export interface AdminUserItem {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  totalBalance: number;
  totalMined: number;
  totalMiningRate: number;
  bonusMiningRate: number;
  referralCode: string;
  referredByUserId: string | null;
  totalReferrals: number;
  activatedReferrals: number;
  lastLoginAt: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrentlyMining: boolean;
}

export interface SecurityEventItem {
  id: string;
  userId?: string;
  eventType: string;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
}
