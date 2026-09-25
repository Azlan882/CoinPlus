export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string; // Permanent unique account ID, e.g. usr_c7f8...
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  referralCode: string;
  referredByUserId: string | null;
  role: UserRole;
  status: UserStatus;
  baseMiningRate: number; // default 0.12 coins/hour
  bonusMiningRate: number; // 0.01 * number of activated referrals
  totalMiningRate: number; // base + bonus
  createdAt: string;
  lastLoginAt: string;
  lastActiveAt: string;
  registrationIp?: string;
}

export type MiningSessionStatus = 'completed' | 'in_progress' | 'failed';

export interface MiningSession {
  id: string;
  userId: string;
  sessionNumber: number;
  cycleStartTime: number; // Unix ms
  cycleEndTime: number; // Unix ms
  minedAmount: number;
  miningRateAtSession: number;
  ipAddress: string;
  userAgent: string;
  status: MiningSessionStatus;
  createdAt: string;
}

export interface UserMiningState {
  userId: string;
  isMiningActive: boolean;
  currentCycleStartTime: number | null; // Unix ms
  lastMinedAt: number | null; // Unix ms
  nextMiningAvailableAt: number; // Unix ms
  totalCyclesCompleted: number;
}

export interface BalanceRecord {
  userId: string;
  totalBalance: number;
  totalMined: number;
  totalReferralBonus: number;
  lastCalculatedAt: string;
  integrityChecksum: string; // SHA-256 checksum of userId + totalBalance
}

export type ReferralStatus = 'pending' | 'activated';

export interface ReferralRecord {
  id: string;
  inviterUserId: string;
  referredUserId: string;
  referralCodeUsed: string;
  status: ReferralStatus;
  firstMiningCompletedAt: string | null;
  rateBonusApplied: number; // 0.01
  createdAt: string;
}

export interface MiningRateHistory {
  id: string;
  userId: string;
  oldRate: number;
  newRate: number;
  changeReason: 'initial_base' | 'referral_activated' | 'admin_adjustment';
  triggeredByUserId?: string;
  timestamp: string;
}

export type TransactionType = 'mining_reward' | 'referral_bonus' | 'admin_adjustment';

export interface TransactionRecord {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  description: string;
  timestamp: string;
}

export type SecuritySeverity = 'low' | 'medium' | 'high';
export type SecurityEventType =
  | 'double_mine_attempt'
  | 'cooldown_violation'
  | 'self_referral_attempt'
  | 'suspicious_rate_limit'
  | 'unauthorized_access'
  | 'account_suspended_action'
  | 'invalid_credentials';

export interface SecurityEvent {
  id: string;
  userId?: string;
  eventType: SecurityEventType;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  severity: SecuritySeverity;
  timestamp: string;
}

export interface DatabaseSchema {
  version: number;
  users: Record<string, User>;
  miningSessions: MiningSession[];
  miningStates: Record<string, UserMiningState>;
  balances: Record<string, BalanceRecord>;
  referrals: ReferralRecord[];
  rateHistory: MiningRateHistory[];
  transactions: TransactionRecord[];
  securityEvents: SecurityEvent[];
}
