export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string; // Permanent unique account ID, e.g. usr_c7f8...
  googleId?: string; // Stable unique Google sub identifier (OpenID Connect sub)
  username: string;
  email: string;
  picture?: string;
  passwordHash?: string;
  salt?: string;
  referralCode: string;
  referredByUserId: string | null;
  role: UserRole;
  status: UserStatus;
  currency?: 'CP' | 'BTC_SIMULATED'; // Currency denomination
  baseMiningRate: number; // default 0.12 CP/hr or 0.00012000 BTC/hr
  bonusMiningRate: number; // 0.01 CP/hr or 0.00001000 BTC/hr per activated referral
  totalMiningRate: number; // base + bonus
  legacyCpBalance?: number; // Preserved original CP balance if migrated
  migratedToSimulatedBtcAt?: string; // Timestamp of protocol conversion
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
  currency?: 'CP' | 'BTC_SIMULATED';
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
  satoshis?: number; // Integer satoshis for simulated BTC
  legacyCpBalance?: number; // Preserved legacy CP balance
  currency?: 'CP' | 'BTC_SIMULATED';
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
  rateBonusApplied: number; // 0.01 CP or 0.00001000 BTC
  createdAt: string;
}

export interface MiningRateHistory {
  id: string;
  userId: string;
  oldRate: number;
  newRate: number;
  currency?: 'CP' | 'BTC_SIMULATED';
  changeReason: 'initial_base' | 'referral_activated' | 'admin_adjustment' | 'protocol_migration';
  triggeredByUserId?: string;
  timestamp: string;
}

export type TransactionType =
  | 'mining_reward'
  | 'referral_bonus'
  | 'admin_adjustment'
  | 'game_reward'
  | 'migration_conversion';

export interface PulseMinerClaimRecord {
  id: string; // idempotent claim ID (e.g. claim_${userId}_lvl${levelId}_${timestamp})
  userId: string;
  levelId: number;
  score: number;
  rewardPoints: number;
  durationSeconds: number;
  currency?: 'CP' | 'BTC_SIMULATED';
  timestamp: string;
}

export interface PulseMinerUserState {
  userId: string;
  highestUnlockedLevel: number;
  completedLevels: number[];
  highScores: Record<number, number>; // levelId -> max score
  claimedLevelRewards: Record<number, { claimedAt: string; rewardPoints: number; claimId: string; currency?: string }>;
  totalGamePointsEarned: number;
  lastPlayedAt: string;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  currency?: 'CP' | 'BTC_SIMULATED';
  satoshis?: number;
  balanceBefore: number;
  balanceAfter: number;
  legacyCpBalance?: number;
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
  pulseMinerStates?: Record<string, PulseMinerUserState>;
  pulseMinerClaims?: PulseMinerClaimRecord[];
}

