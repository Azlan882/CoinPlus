import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DatabaseSchema,
  User,
  MiningSession,
  UserMiningState,
  BalanceRecord,
  ReferralRecord,
  MiningRateHistory,
  TransactionRecord,
  SecurityEvent,
  TransactionType,
  SecurityEventType,
  SecuritySeverity,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'coinpulse_database.json');

const INITIAL_DB: DatabaseSchema = {
  version: 1,
  users: {},
  miningSessions: [],
  miningStates: {},
  balances: {},
  referrals: [],
  rateHistory: [],
  transactions: [],
  securityEvents: [],
};

class Database {
  private data: DatabaseSchema;
  private isSaving = false;
  private saveQueued = false;

  constructor() {
    this.data = this.load();
    this.seedAdminIfNeeded();
  }

  private load(): DatabaseSchema {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseSchema;
        // Basic schema integrity check
        if (!parsed.users) parsed.users = {};
        if (!parsed.miningSessions) parsed.miningSessions = [];
        if (!parsed.miningStates) parsed.miningStates = {};
        if (!parsed.balances) parsed.balances = {};
        if (!parsed.referrals) parsed.referrals = [];
        if (!parsed.rateHistory) parsed.rateHistory = [];
        if (!parsed.transactions) parsed.transactions = [];
        if (!parsed.securityEvents) parsed.securityEvents = [];
        return parsed;
      }
    } catch (err) {
      console.error('Failed to load database file, initializing fresh:', err);
    }
    return JSON.parse(JSON.stringify(INITIAL_DB));
  }

  private save(): void {
    if (this.isSaving) {
      this.saveQueued = true;
      return;
    }
    this.isSaving = true;

    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      console.error('Database write error:', err);
    } finally {
      this.isSaving = false;
      if (this.saveQueued) {
        this.saveQueued = false;
        this.save();
      }
    }
  }

  private calculateChecksum(userId: string, balance: number): string {
    return crypto
      .createHash('sha256')
      .update(`${userId}:${balance.toFixed(6)}:${process.env.AUTH_SECRET || 'coinpulse_secret_key'}`)
      .digest('hex');
  }

  private seedAdminIfNeeded(): void {
    const adminUser = Object.values(this.data.users).find(
      (u) => u.username === 'admin' || u.role === 'admin'
    );
    if (!adminUser) {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = crypto.scryptSync('AdminCoinPulse2026!', salt, 64).toString('hex');
      const adminId = 'usr_admin_001';

      const user: User = {
        id: adminId,
        username: 'admin',
        email: 'admin@coinpulse.internal',
        passwordHash,
        salt,
        referralCode: 'ADMINPULSE',
        referredByUserId: null,
        role: 'admin',
        status: 'active',
        baseMiningRate: 0.12,
        bonusMiningRate: 0.0,
        totalMiningRate: 0.12,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };

      this.data.users[adminId] = user;

      this.data.balances[adminId] = {
        userId: adminId,
        totalBalance: 100.0,
        totalMined: 100.0,
        totalReferralBonus: 0.0,
        lastCalculatedAt: new Date().toISOString(),
        integrityChecksum: this.calculateChecksum(adminId, 100.0),
      };

      this.data.miningStates[adminId] = {
        userId: adminId,
        isMiningActive: false,
        currentCycleStartTime: null,
        lastMinedAt: null,
        nextMiningAvailableAt: 0,
        totalCyclesCompleted: 0,
      };

      this.data.transactions.push({
        id: `tx_${Date.now()}_seed`,
        userId: adminId,
        type: 'admin_adjustment',
        amount: 100.0,
        balanceBefore: 0.0,
        balanceAfter: 100.0,
        description: 'System initial genesis reserve',
        timestamp: new Date().toISOString(),
      });

      this.save();
    }
  }

  // --- Users ---
  getUserById(id: string): User | null {
    return this.data.users[id] || null;
  }

  getUserByGoogleId(googleId: string): User | null {
    const cleanId = String(googleId).trim();
    return Object.values(this.data.users).find((u) => u.googleId === cleanId) || null;
  }

  getUserByEmail(email: string): User | null {
    const normalized = email.toLowerCase().trim();
    return Object.values(this.data.users).find((u) => u.email.toLowerCase() === normalized) || null;
  }

  getUserByUsername(username: string): User | null {
    const normalized = username.toLowerCase().trim();
    return Object.values(this.data.users).find((u) => u.username.toLowerCase() === normalized) || null;
  }

  getUserByReferralCode(code: string): User | null {
    const normalized = code.toUpperCase().trim();
    return Object.values(this.data.users).find((u) => u.referralCode.toUpperCase() === normalized) || null;
  }

  getAllUsers(): User[] {
    return Object.values(this.data.users);
  }

  createUser(
    user: User,
    initialBalance: number = 0.0
  ): { user: User; balance: BalanceRecord; miningState: UserMiningState } {
    this.data.users[user.id] = user;

    const balance: BalanceRecord = {
      userId: user.id,
      totalBalance: initialBalance,
      totalMined: 0.0,
      totalReferralBonus: 0.0,
      lastCalculatedAt: new Date().toISOString(),
      integrityChecksum: this.calculateChecksum(user.id, initialBalance),
    };
    this.data.balances[user.id] = balance;

    const miningState: UserMiningState = {
      userId: user.id,
      isMiningActive: false,
      currentCycleStartTime: null,
      lastMinedAt: null,
      nextMiningAvailableAt: 0,
      totalCyclesCompleted: 0,
    };
    this.data.miningStates[user.id] = miningState;

    this.data.rateHistory.push({
      id: `rate_${Date.now()}_${user.id}`,
      userId: user.id,
      oldRate: 0.0,
      newRate: user.baseMiningRate,
      changeReason: 'initial_base',
      timestamp: new Date().toISOString(),
    });

    this.save();
    return { user, balance, miningState };
  }

  updateUser(id: string, updates: Partial<User>): User | null {
    const user = this.data.users[id];
    if (!user) return null;
    const updated = { ...user, ...updates };
    this.data.users[id] = updated;
    this.save();
    return updated;
  }

  // --- Balances & Ledger ---
  getBalance(userId: string): BalanceRecord {
    if (!this.data.balances[userId]) {
      this.data.balances[userId] = {
        userId,
        totalBalance: 0.0,
        totalMined: 0.0,
        totalReferralBonus: 0.0,
        lastCalculatedAt: new Date().toISOString(),
        integrityChecksum: this.calculateChecksum(userId, 0.0),
      };
      this.save();
    }
    return this.data.balances[userId];
  }

  verifyBalanceIntegrity(userId: string): { isValid: boolean; expected: number; recorded: number } {
    const balance = this.getBalance(userId);
    // Sum all transactions from ledger
    const txs = this.data.transactions.filter((tx) => tx.userId === userId);
    const ledgerSum = txs.reduce((acc, tx) => acc + tx.amount, 0);

    const isSumValid = Math.abs(ledgerSum - balance.totalBalance) < 0.000001;
    const checksum = this.calculateChecksum(userId, balance.totalBalance);
    const isChecksumValid = checksum === balance.integrityChecksum;

    return {
      isValid: isSumValid && isChecksumValid,
      expected: Number(ledgerSum.toFixed(6)),
      recorded: Number(balance.totalBalance.toFixed(6)),
    };
  }

  addBalanceTransaction(
    userId: string,
    amount: number,
    type: TransactionType,
    description: string,
    referenceId?: string
  ): { balance: BalanceRecord; transaction: TransactionRecord } {
    const current = this.getBalance(userId);
    const balanceBefore = current.totalBalance;
    const balanceAfter = Number((balanceBefore + amount).toFixed(6));

    let totalMined = current.totalMined;
    let totalReferralBonus = current.totalReferralBonus;

    if (type === 'mining_reward') {
      totalMined = Number((totalMined + amount).toFixed(6));
    } else if (type === 'referral_bonus') {
      totalReferralBonus = Number((totalReferralBonus + amount).toFixed(6));
    }

    const updatedBalance: BalanceRecord = {
      userId,
      totalBalance: balanceAfter,
      totalMined,
      totalReferralBonus,
      lastCalculatedAt: new Date().toISOString(),
      integrityChecksum: this.calculateChecksum(userId, balanceAfter),
    };

    const transaction: TransactionRecord = {
      id: `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      userId,
      type,
      amount: Number(amount.toFixed(6)),
      balanceBefore,
      balanceAfter,
      referenceId,
      description,
      timestamp: new Date().toISOString(),
    };

    this.data.balances[userId] = updatedBalance;
    this.data.transactions.unshift(transaction); // Latest first
    this.save();

    return { balance: updatedBalance, transaction };
  }

  getTransactions(userId: string, limit: number = 50): TransactionRecord[] {
    return this.data.transactions.filter((tx) => tx.userId === userId).slice(0, limit);
  }

  // --- Mining States & Sessions ---
  getMiningState(userId: string): UserMiningState {
    if (!this.data.miningStates[userId]) {
      this.data.miningStates[userId] = {
        userId,
        isMiningActive: false,
        currentCycleStartTime: null,
        lastMinedAt: null,
        nextMiningAvailableAt: 0,
        totalCyclesCompleted: 0,
      };
      this.save();
    }
    return this.data.miningStates[userId];
  }

  updateMiningState(userId: string, updates: Partial<UserMiningState>): UserMiningState {
    const current = this.getMiningState(userId);
    const updated = { ...current, ...updates };
    this.data.miningStates[userId] = updated;
    this.save();
    return updated;
  }

  recordMiningSession(session: MiningSession): void {
    this.data.miningSessions.unshift(session);
    this.save();
  }

  getMiningSessions(userId: string, limit: number = 20): MiningSession[] {
    return this.data.miningSessions.filter((s) => s.userId === userId).slice(0, limit);
  }

  // --- Referrals ---
  createReferral(referral: ReferralRecord): ReferralRecord {
    this.data.referrals.push(referral);
    this.save();
    return referral;
  }

  getReferralByReferredUser(referredUserId: string): ReferralRecord | null {
    return this.data.referrals.find((r) => r.referredUserId === referredUserId) || null;
  }

  getReferralsByInviter(inviterUserId: string): ReferralRecord[] {
    return this.data.referrals.filter((r) => r.inviterUserId === inviterUserId);
  }

  activateReferral(referralId: string): ReferralRecord | null {
    const referral = this.data.referrals.find((r) => r.id === referralId);
    if (!referral) return null;
    if (referral.status === 'activated') return referral;

    referral.status = 'activated';
    referral.firstMiningCompletedAt = new Date().toISOString();

    // Permanently increase inviter's bonus mining rate by 0.01 coins/hour
    const inviter = this.getUserById(referral.inviterUserId);
    if (inviter) {
      const oldRate = inviter.totalMiningRate;
      const newBonus = Number((inviter.bonusMiningRate + 0.01).toFixed(4));
      const newTotal = Number((inviter.baseMiningRate + newBonus).toFixed(4));

      this.updateUser(inviter.id, {
        bonusMiningRate: newBonus,
        totalMiningRate: newTotal,
      });

      this.data.rateHistory.push({
        id: `rate_${Date.now()}_${inviter.id}`,
        userId: inviter.id,
        oldRate,
        newRate: newTotal,
        changeReason: 'referral_activated',
        triggeredByUserId: referral.referredUserId,
        timestamp: new Date().toISOString(),
      });
    }

    this.save();
    return referral;
  }

  // --- Rate History ---
  getRateHistory(userId: string): MiningRateHistory[] {
    return this.data.rateHistory
      .filter((r) => r.userId === userId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // --- Anti-Abuse & Security Events ---
  logSecurityEvent(
    eventType: SecurityEventType,
    ipAddress: string,
    severity: SecuritySeverity,
    userId?: string,
    metadata?: Record<string, any>,
    userAgent?: string
  ): SecurityEvent {
    const event: SecurityEvent = {
      id: `sec_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      userId,
      eventType,
      ipAddress,
      userAgent,
      metadata,
      severity,
      timestamp: new Date().toISOString(),
    };
    this.data.securityEvents.unshift(event);
    if (this.data.securityEvents.length > 500) {
      this.data.securityEvents.length = 500; // Keep latest 500
    }
    this.save();
    return event;
  }

  getSecurityEvents(limit: number = 100): SecurityEvent[] {
    return this.data.securityEvents.slice(0, limit);
  }

  // --- Global Stats ---
  getSystemStats(): {
    totalUsers: number;
    activeUsers24h: number;
    totalCoinsMined: number;
    totalReferrals: number;
    activatedReferrals: number;
    totalMiningSessions: number;
    securityEventsCount: number;
  } {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const totalUsers = Object.keys(this.data.users).length;
    const activeUsers24h = Object.values(this.data.users).filter((u) => {
      const lastActive = new Date(u.lastActiveAt).getTime();
      return lastActive >= oneDayAgo;
    }).length;

    const totalCoinsMined = Object.values(this.data.balances).reduce(
      (sum, b) => sum + (b.totalMined || 0),
      0
    );

    const totalReferrals = this.data.referrals.length;
    const activatedReferrals = this.data.referrals.filter((r) => r.status === 'activated').length;
    const totalMiningSessions = this.data.miningSessions.length;
    const securityEventsCount = this.data.securityEvents.length;

    return {
      totalUsers,
      activeUsers24h,
      totalCoinsMined: Number(totalCoinsMined.toFixed(4)),
      totalReferrals,
      activatedReferrals,
      totalMiningSessions,
      securityEventsCount,
    };
  }
}

export const db = new Database();
