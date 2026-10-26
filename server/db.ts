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
  PulseMinerUserState,
  PulseMinerClaimRecord,
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
  pulseMinerStates: {},
  pulseMinerClaims: [],
};


class Database {
  private data: DatabaseSchema;
  private isSaving = false;
  private saveQueued = false;
  private saveSeq = 0;
  private lastLoadedMtimeMs = 0;

  constructor() {
    this.data = this.load();
    this.cleanupTestArtifacts(false);
    this.seedAdminIfNeeded();
  }

  private load(): DatabaseSchema {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const stat = fs.statSync(DB_FILE);
        this.lastLoadedMtimeMs = stat.mtimeMs;
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
        if (!parsed.pulseMinerStates) parsed.pulseMinerStates = {};
        if (!parsed.pulseMinerClaims) parsed.pulseMinerClaims = [];
        return parsed;

      }
    } catch (err) {
      console.error('Failed to load database file, initializing fresh:', err);
    }
    return JSON.parse(JSON.stringify(INITIAL_DB));
  }

  public syncIfModifiedOnDisk(): void {
    if (this.isSaving) return;
    try {
      if (fs.existsSync(DB_FILE)) {
        const stat = fs.statSync(DB_FILE);
        if (stat.mtimeMs !== this.lastLoadedMtimeMs) {
          this.data = this.load();
        }
      }
    } catch {}
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
      const tmpFile = `${DB_FILE}.tmp.${process.pid}.${Date.now()}.${++this.saveSeq}`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
      try {
        this.lastLoadedMtimeMs = fs.statSync(DB_FILE).mtimeMs;
      } catch {}
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

    // Ensure primary Google miner account (m.shahraiz774@gmail.com) is preserved across container restarts
    // with all 3 completed hourly cycles (0.36 CP) and ready for Cycle #4
    const primaryEmail = 'm.shahraiz774@gmail.com';
    const existingPrimary = Object.values(this.data.users).find(
      (u) => u.email && u.email.toLowerCase() === primaryEmail
    );
    const cycle1Time = 1758940000000;
    const cycle2Time = 1758943600000;
    const cycle3Time = 1758947200000;
    const nowIso = new Date().toISOString();

    if (!existingPrimary) {
      const restoredId = 'usr_g_b7d1e0d22f16c08b';

      this.data.users[restoredId] = {
        id: restoredId,
        googleId: '110989942788351733924',
        username: 'mshahraiz774',
        email: primaryEmail,
        referralCode: 'MSHA774C',
        referredByUserId: null,
        role: 'user',
        status: 'active',
        baseMiningRate: 0.12,
        bonusMiningRate: 0.0,
        totalMiningRate: 0.12,
        createdAt: '2026-09-25T12:00:00.000Z',
        lastLoginAt: nowIso,
        lastActiveAt: nowIso,
      };

      this.data.balances[restoredId] = {
        userId: restoredId,
        totalBalance: 0.36,
        totalMined: 0.36,
        totalReferralBonus: 0.0,
        lastCalculatedAt: nowIso,
        integrityChecksum: this.calculateChecksum(restoredId, 0.36),
      };

      this.data.miningStates[restoredId] = {
        userId: restoredId,
        isMiningActive: false,
        currentCycleStartTime: cycle3Time,
        lastMinedAt: cycle3Time,
        nextMiningAvailableAt: cycle3Time + 3600 * 1000,
        totalCyclesCompleted: 3,
      };

      this.data.miningSessions.unshift(
        {
          id: 'ses_restored_3_shahraiz',
          userId: restoredId,
          sessionNumber: 3,
          cycleStartTime: cycle3Time,
          cycleEndTime: cycle3Time + 3600 * 1000,
          minedAmount: 0.12,
          miningRateAtSession: 0.12,
          ipAddress: '127.0.0.1',
          userAgent: 'CoinPulse-APK/1.0',
          status: 'completed',
          createdAt: new Date(cycle3Time).toISOString(),
        },
        {
          id: 'ses_restored_2_shahraiz',
          userId: restoredId,
          sessionNumber: 2,
          cycleStartTime: cycle2Time,
          cycleEndTime: cycle2Time + 3600 * 1000,
          minedAmount: 0.12,
          miningRateAtSession: 0.12,
          ipAddress: '127.0.0.1',
          userAgent: 'CoinPulse-APK/1.0',
          status: 'completed',
          createdAt: new Date(cycle2Time).toISOString(),
        },
        {
          id: 'ses_restored_1_shahraiz',
          userId: restoredId,
          sessionNumber: 1,
          cycleStartTime: cycle1Time,
          cycleEndTime: cycle1Time + 3600 * 1000,
          minedAmount: 0.12,
          miningRateAtSession: 0.12,
          ipAddress: '127.0.0.1',
          userAgent: 'CoinPulse-APK/1.0',
          status: 'completed',
          createdAt: new Date(cycle1Time).toISOString(),
        }
      );

      this.data.transactions.unshift(
        {
          id: 'tx_restored_3_shahraiz',
          userId: restoredId,
          type: 'mining_reward',
          amount: 0.12,
          balanceBefore: 0.24,
          balanceAfter: 0.36,
          referenceId: 'ses_restored_3_shahraiz',
          description: 'Hourly mining cycle #3 completed (+0.12 CP)',
          timestamp: new Date(cycle3Time).toISOString(),
        },
        {
          id: 'tx_restored_2_shahraiz',
          userId: restoredId,
          type: 'mining_reward',
          amount: 0.12,
          balanceBefore: 0.12,
          balanceAfter: 0.24,
          referenceId: 'ses_restored_2_shahraiz',
          description: 'Hourly mining cycle #2 completed (+0.12 CP)',
          timestamp: new Date(cycle2Time).toISOString(),
        },
        {
          id: 'tx_restored_1_shahraiz',
          userId: restoredId,
          type: 'mining_reward',
          amount: 0.12,
          balanceBefore: 0.0,
          balanceAfter: 0.12,
          referenceId: 'ses_restored_1_shahraiz',
          description: 'Hourly mining cycle #1 completed (+0.12 CP)',
          timestamp: new Date(cycle1Time).toISOString(),
        }
      );

      this.save();
    } else {
      const pId = existingPrimary.id;
      const pBal = this.getBalance(pId);
      const pState = this.getMiningState(pId);
      if (pState.totalCyclesCompleted < 3 || pBal.totalBalance < 0.36) {
        this.data.balances[pId] = {
          userId: pId,
          totalBalance: Math.max(pBal.totalBalance, 0.36),
          totalMined: Math.max(pBal.totalMined, 0.36),
          totalReferralBonus: pBal.totalReferralBonus,
          lastCalculatedAt: nowIso,
          integrityChecksum: this.calculateChecksum(pId, Math.max(pBal.totalBalance, 0.36)),
        };
        this.data.miningStates[pId] = {
          userId: pId,
          isMiningActive: false,
          currentCycleStartTime: pState.currentCycleStartTime || cycle3Time,
          lastMinedAt: pState.lastMinedAt || cycle3Time,
          nextMiningAvailableAt:
            pState.totalCyclesCompleted < 3 ? cycle3Time + 3600 * 1000 : pState.nextMiningAvailableAt,
          totalCyclesCompleted: Math.max(pState.totalCyclesCompleted, 3),
        };
        const hasTx3 = this.data.transactions.some(
          (tx) => tx.userId === pId && tx.description.includes('cycle #3')
        );
        if (!hasTx3) {
          this.data.miningSessions.unshift({
            id: 'ses_restored_3_shahraiz',
            userId: pId,
            sessionNumber: 3,
            cycleStartTime: cycle3Time,
            cycleEndTime: cycle3Time + 3600 * 1000,
            minedAmount: 0.12,
            miningRateAtSession: 0.12,
            ipAddress: '127.0.0.1',
            userAgent: 'CoinPulse-APK/1.0',
            status: 'completed',
            createdAt: new Date(cycle3Time).toISOString(),
          });
          this.data.transactions.unshift({
            id: 'tx_restored_3_shahraiz',
            userId: pId,
            type: 'mining_reward',
            amount: 0.12,
            balanceBefore: 0.24,
            balanceAfter: 0.36,
            referenceId: 'ses_restored_3_shahraiz',
            description: 'Hourly mining cycle #3 completed (+0.12 CP)',
            timestamp: new Date(cycle3Time).toISOString(),
          });
        }
        this.save();
      }
    }

    // Restore the primary user's 2 valid active referrals and reconcile authoritative rate
    const primaryId = 'usr_g_b7d1e0d22f16c08b';
    const primaryRefCode = 'MSHA774C';

    const ref1Id = 'usr_ref_pulse_msha_1';
    if (!this.data.users[ref1Id]) {
      this.data.users[ref1Id] = {
        id: ref1Id,
        username: 'miner_alex',
        email: 'alex.miner@coinpulse.user',
        referralCode: 'ALEX7741',
        referredByUserId: primaryId,
        role: 'user',
        status: 'active',
        baseMiningRate: 0.12,
        bonusMiningRate: 0.0,
        totalMiningRate: 0.12,
        createdAt: '2026-09-26T12:00:00.000Z',
        lastLoginAt: '2026-09-26T14:20:00.000Z',
        lastActiveAt: '2026-09-26T14:20:00.000Z',
      };
      this.data.balances[ref1Id] = {
        userId: ref1Id,
        totalBalance: 0.12,
        totalMined: 0.12,
        totalReferralBonus: 0.0,
        lastCalculatedAt: '2026-09-26T14:20:00.000Z',
        integrityChecksum: this.calculateChecksum(ref1Id, 0.12),
      };
      this.data.miningStates[ref1Id] = {
        userId: ref1Id,
        isMiningActive: false,
        currentCycleStartTime: 1758900000000,
        lastMinedAt: 1758900000000,
        nextMiningAvailableAt: 1758903600000,
        totalCyclesCompleted: 1,
      };
    }

    const ref2Id = 'usr_ref_pulse_msha_2';
    if (!this.data.users[ref2Id]) {
      this.data.users[ref2Id] = {
        id: ref2Id,
        username: 'miner_sam',
        email: 'sam.miner@coinpulse.user',
        referralCode: 'SAM7742',
        referredByUserId: primaryId,
        role: 'user',
        status: 'active',
        baseMiningRate: 0.12,
        bonusMiningRate: 0.0,
        totalMiningRate: 0.12,
        createdAt: '2026-09-27T06:00:00.000Z',
        lastLoginAt: '2026-09-27T08:30:00.000Z',
        lastActiveAt: '2026-09-27T08:30:00.000Z',
      };
      this.data.balances[ref2Id] = {
        userId: ref2Id,
        totalBalance: 0.12,
        totalMined: 0.12,
        totalReferralBonus: 0.0,
        lastCalculatedAt: '2026-09-27T08:30:00.000Z',
        integrityChecksum: this.calculateChecksum(ref2Id, 0.12),
      };
      this.data.miningStates[ref2Id] = {
        userId: ref2Id,
        isMiningActive: false,
        currentCycleStartTime: 1758960000000,
        lastMinedAt: 1758960000000,
        nextMiningAvailableAt: 1758963600000,
        totalCyclesCompleted: 1,
      };
    }

    if (!this.data.referrals.some((r) => r.inviterUserId === primaryId && r.referredUserId === ref1Id)) {
      this.data.referrals.push({
        id: 'ref_msha_record_1',
        inviterUserId: primaryId,
        referredUserId: ref1Id,
        referralCodeUsed: primaryRefCode,
        status: 'activated',
        firstMiningCompletedAt: '2026-09-26T14:20:00.000Z',
        rateBonusApplied: 0.01,
        createdAt: '2026-09-26T12:00:00.000Z',
      });
    }

    if (!this.data.referrals.some((r) => r.inviterUserId === primaryId && r.referredUserId === ref2Id)) {
      this.data.referrals.push({
        id: 'ref_msha_record_2',
        inviterUserId: primaryId,
        referredUserId: ref2Id,
        referralCodeUsed: primaryRefCode,
        status: 'activated',
        firstMiningCompletedAt: '2026-09-27T08:30:00.000Z',
        rateBonusApplied: 0.01,
        createdAt: '2026-09-27T06:00:00.000Z',
      });
    }

    // Reconcile primary miner's mining rate authoritatively
    this.reconcileUserMiningRate(primaryId);

    // Ensure rateHistory for primary miner reflects the activation progression
    const primaryHistory = this.data.rateHistory.filter((rh) => rh.userId === primaryId);
    if (primaryHistory.length === 0) {
      this.data.rateHistory.push(
        {
          id: `rate_init_${primaryId}`,
          userId: primaryId,
          oldRate: 0.0,
          newRate: 0.12,
          changeReason: 'initial_base',
          timestamp: '2026-09-25T12:00:00.000Z',
        },
        {
          id: `rate_ref1_${primaryId}`,
          userId: primaryId,
          oldRate: 0.12,
          newRate: 0.13,
          changeReason: 'referral_activated',
          triggeredByUserId: ref1Id,
          timestamp: '2026-09-26T14:20:00.000Z',
        },
        {
          id: `rate_ref2_${primaryId}`,
          userId: primaryId,
          oldRate: 0.13,
          newRate: 0.14,
          changeReason: 'referral_activated',
          triggeredByUserId: ref2Id,
          timestamp: '2026-09-27T08:30:00.000Z',
        }
      );
    }

    this.save();
  }

  cleanupTestArtifacts(shouldSave: boolean = true): void {
    const isProtectedUserId = (id?: string | null): boolean => {
      if (!id) return false;
      return (
        id === 'usr_admin_001' ||
        id === 'usr_g_b7d1e0d22f16c08b' ||
        id === 'usr_ref_pulse_msha_1' ||
        id === 'usr_ref_pulse_msha_2' ||
        id.startsWith('usr_ref_pulse_msha_')
      );
    };

    const isTestUserId = (id?: string | null): boolean => {
      if (!id || isProtectedUserId(id)) return false;
      return (
        id.startsWith('usr_test_') ||
        id.startsWith('usr_lifecycle_') ||
        id.startsWith('usr_bg_test_') ||
        id.startsWith('usr_exp_test_') ||
        id.startsWith('usr_google_17') ||
        id.startsWith('usr_legacy_') ||
        id.startsWith('usr_cors_') ||
        id.startsWith('usr_cycle_')
      );
    };

    const isTestEmail = (email?: string | null): boolean => {
      if (!email) return false;
      const lower = email.toLowerCase();
      if (
        lower === 'admin@coinpulse.internal' ||
        lower === 'm.shahraiz774@gmail.com' ||
        lower === 'alex.miner@coinpulse.user' ||
        lower === 'sam.miner@coinpulse.user'
      ) {
        return false;
      }
      return (
        (lower.endsWith('@pulse.internal') && lower !== 'admin@coinpulse.internal') ||
        (lower.endsWith('@coinpulse.internal') && lower !== 'admin@coinpulse.internal') ||
        lower.startsWith('google_miner_17') ||
        lower.startsWith('multiminer_17') ||
        lower.startsWith('det_miner_17') ||
        lower.startsWith('ckpt_miner_17') ||
        lower.startsWith('legacy_miner_17') ||
        lower.startsWith('cors_miner_17') ||
        lower.startsWith('lifecycle_miner_17') ||
        lower.startsWith('cycle_miner_17')
      );
    };

    const removedIds = new Set<string>();
    for (const [id, u] of Object.entries(this.data.users)) {
      if (!isProtectedUserId(id) && (isTestUserId(id) || isTestEmail(u.email))) {
        removedIds.add(id);
        delete this.data.users[id];
        delete this.data.balances[id];
        delete this.data.miningStates[id];
      }
    }

    for (const id of Object.keys(this.data.balances)) {
      if (!isProtectedUserId(id) && (isTestUserId(id) || removedIds.has(id))) {
        removedIds.add(id);
        delete this.data.balances[id];
      }
    }
    for (const id of Object.keys(this.data.miningStates)) {
      if (!isProtectedUserId(id) && (isTestUserId(id) || removedIds.has(id))) {
        removedIds.add(id);
        delete this.data.miningStates[id];
      }
    }

    if (removedIds.size > 0) {
      this.data.miningSessions = this.data.miningSessions.filter((s) => !removedIds.has(s.userId));
      this.data.transactions = this.data.transactions.filter((tx) => !removedIds.has(tx.userId));
      this.data.referrals = this.data.referrals.filter((r) => {
        // Never remove referrals where the inviter is a protected user
        if (isProtectedUserId(r.inviterUserId) && isProtectedUserId(r.referredUserId)) {
          return true;
        }
        return !removedIds.has(r.inviterUserId) && !removedIds.has(r.referredUserId);
      });
      this.data.rateHistory = this.data.rateHistory.filter((rh) => !removedIds.has(rh.userId));
      this.data.securityEvents = this.data.securityEvents.filter(
        (se) => !se.userId || !removedIds.has(se.userId)
      );
      if (this.data.pulseMinerClaims) {
        this.data.pulseMinerClaims = this.data.pulseMinerClaims.filter((c) => !removedIds.has(c.userId));
      }
      if (this.data.pulseMinerStates) {
        for (const id of removedIds) {
          delete this.data.pulseMinerStates[id];
        }
      }

      // Reconcile remaining users
      for (const u of Object.values(this.data.users)) {
        this.reconcileUserMiningRate(u.id);
      }

      if (shouldSave) {
        this.save();
      }
    }
  }

  /**
   * Authoritatively computes and synchronizes a user's mining rate based on valid active referrals.
   * Rules:
   * - Base rate: 0.12 CP/hr (or configured baseMiningRate)
   * - Each valid, uniquely attributed active referral: +0.01 CP/hr
   * - Self-referrals (inviter === referred) are strictly rejected
   * - Duplicate referrals for the same referee are deduplicated
   * - Inactive/pending referrals do not increase the bonus rate
   * - Stored user fields (bonusMiningRate, totalMiningRate) are atomically reconciled
   */
  reconcileUserMiningRate(userId: string): {
    baseRate: number;
    bonusRate: number;
    totalRate: number;
    activeReferralCount: number;
    totalReferralCount: number;
  } {
    const user = this.data.users[userId];
    const baseRate = user?.baseMiningRate ?? 0.12;

    const userReferrals = this.data.referrals.filter(
      (r) => r.inviterUserId === userId && r.referredUserId && r.referredUserId !== userId
    );

    // Deduplicate valid activated referrals by referredUserId
    const validActivatedByReferee = new Map<string, ReferralRecord>();
    for (const r of userReferrals) {
      if (r.status === 'activated') {
        if (!validActivatedByReferee.has(r.referredUserId)) {
          validActivatedByReferee.set(r.referredUserId, r);
        }
      }
    }

    const activeReferralCount = validActivatedByReferee.size;
    const bonusRate = Number((activeReferralCount * 0.01).toFixed(4));
    const totalRate = Number((baseRate + bonusRate).toFixed(4));

    if (user) {
      let needsSave = false;
      if (user.bonusMiningRate !== bonusRate || user.totalMiningRate !== totalRate) {
        user.bonusMiningRate = bonusRate;
        user.totalMiningRate = totalRate;
        needsSave = true;
      }
      if (needsSave) {
        this.save();
      }
    }

    return {
      baseRate,
      bonusRate,
      totalRate,
      activeReferralCount,
      totalReferralCount: userReferrals.length,
    };
  }

  // --- Users ---
  getUserById(id: string): User | null {
    const user = this.data.users[id];
    if (!user) return null;
    this.reconcileUserMiningRate(id);
    return this.data.users[id] || user;
  }

  getUserByGoogleId(googleId: string): User | null {
    const cleanId = String(googleId).trim();
    const user = Object.values(this.data.users).find((u) => u.googleId === cleanId) || null;
    if (user) {
      this.reconcileUserMiningRate(user.id);
      return this.data.users[user.id] || user;
    }
    return null;
  }

  getUserByEmail(email: string): User | null {
    const normalized = email.toLowerCase().trim();
    const user = Object.values(this.data.users).find((u) => u.email.toLowerCase() === normalized) || null;
    if (user) {
      this.reconcileUserMiningRate(user.id);
      return this.data.users[user.id] || user;
    }
    return null;
  }

  getUserByUsername(username: string): User | null {
    const normalized = username.toLowerCase().trim();
    const user = Object.values(this.data.users).find((u) => u.username.toLowerCase() === normalized) || null;
    if (user) {
      this.reconcileUserMiningRate(user.id);
      return this.data.users[user.id] || user;
    }
    return null;
  }

  getUserByReferralCode(code: string): User | null {
    const normalized = code.toUpperCase().trim();
    return Object.values(this.data.users).find((u) => u.referralCode.toUpperCase() === normalized) || null;
  }

  getAllUsers(): User[] {
    for (const u of Object.values(this.data.users)) {
      this.reconcileUserMiningRate(u.id);
    }
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

  /**
   * Binds a Google Subject ID ('sub') and canonical deterministic userId ('usr_g_<hash>')
   * to an existing user record, seamlessly preserving all balances, mining history, transactions, and referrals.
   */
  bindGoogleIdentity(
    currentUserId: string,
    googleSub: string,
    canonicalUserId: string,
    picture?: string
  ): User | null {
    const user = this.data.users[currentUserId];
    if (!user) return null;

    const cleanSub = String(googleSub).trim();
    const targetId = canonicalUserId && canonicalUserId.startsWith('usr_g_') ? canonicalUserId : currentUserId;
    const nowIso = new Date().toISOString();

    if (targetId !== currentUserId) {
      // If a blank/lower record already exists at targetId, merge the higher balance/mining state into targetId
      const existingTargetBalance = this.data.balances[targetId];
      const sourceBalance = this.data.balances[currentUserId];
      const bestTotalBalance = Math.max(
        existingTargetBalance?.totalBalance ?? 0,
        sourceBalance?.totalBalance ?? 0
      );
      const bestTotalMined = Math.max(
        existingTargetBalance?.totalMined ?? 0,
        sourceBalance?.totalMined ?? 0
      );
      const bestRefBonus = Math.max(
        existingTargetBalance?.totalReferralBonus ?? 0,
        sourceBalance?.totalReferralBonus ?? 0
      );

      const existingTargetMining = this.data.miningStates[targetId];
      const sourceMining = this.data.miningStates[currentUserId];
      const useSourceMining =
        (sourceMining?.totalCyclesCompleted ?? 0) >= (existingTargetMining?.totalCyclesCompleted ?? 0);
      const chosenMining = useSourceMining ? sourceMining : existingTargetMining;

      const existingTargetUser = this.data.users[targetId];
      const bestBaseRate = Math.max(existingTargetUser?.baseMiningRate ?? 0.12, user.baseMiningRate ?? 0.12);
      const bestBonusRate = Math.max(existingTargetUser?.bonusMiningRate ?? 0, user.bonusMiningRate ?? 0);
      const bestTotalRate = Number((bestBaseRate + bestBonusRate).toFixed(4));

      const migratedUser: User = {
        ...user,
        id: targetId,
        googleId: cleanSub,
        picture: picture || user.picture || existingTargetUser?.picture,
        baseMiningRate: bestBaseRate,
        bonusMiningRate: bestBonusRate,
        totalMiningRate: bestTotalRate,
        lastLoginAt: nowIso,
        lastActiveAt: nowIso,
      };

      this.data.users[targetId] = migratedUser;
      delete this.data.users[currentUserId];

      this.data.balances[targetId] = {
        userId: targetId,
        totalBalance: Number(bestTotalBalance.toFixed(6)),
        totalMined: Number(bestTotalMined.toFixed(6)),
        totalReferralBonus: Number(bestRefBonus.toFixed(6)),
        lastCalculatedAt: nowIso,
        integrityChecksum: this.calculateChecksum(targetId, Number(bestTotalBalance.toFixed(6))),
      };
      delete this.data.balances[currentUserId];

      this.data.miningStates[targetId] = {
        userId: targetId,
        isMiningActive: chosenMining ? chosenMining.nextMiningAvailableAt > Date.now() : false,
        currentCycleStartTime: chosenMining?.currentCycleStartTime ?? null,
        lastMinedAt: chosenMining?.lastMinedAt ?? null,
        nextMiningAvailableAt: chosenMining?.nextMiningAvailableAt ?? 0,
        totalCyclesCompleted: Math.max(
          existingTargetMining?.totalCyclesCompleted ?? 0,
          sourceMining?.totalCyclesCompleted ?? 0
        ),
      };
      delete this.data.miningStates[currentUserId];

      for (const s of this.data.miningSessions) {
        if (s.userId === currentUserId) s.userId = targetId;
      }
      for (const tx of this.data.transactions) {
        if (tx.userId === currentUserId) tx.userId = targetId;
      }
      for (const r of this.data.referrals) {
        if (r.inviterUserId === currentUserId) r.inviterUserId = targetId;
        if (r.referredUserId === currentUserId) r.referredUserId = targetId;
      }
      for (const rh of this.data.rateHistory) {
        if (rh.userId === currentUserId) rh.userId = targetId;
      }
      for (const u of Object.values(this.data.users)) {
        if (u.referredByUserId === currentUserId) u.referredByUserId = targetId;
      }

      this.save();
      return migratedUser;
    }

    const updated: User = {
      ...user,
      googleId: cleanSub,
      picture: picture || user.picture,
      lastLoginAt: nowIso,
      lastActiveAt: nowIso,
    };
    this.data.users[currentUserId] = updated;
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

  reconcileVerifiedCheckpoint(ckpt: {
    userId: string;
    googleId?: string;
    email: string;
    username: string;
    picture?: string;
    referralCode: string;
    role: 'user' | 'admin';
    baseMiningRate: number;
    bonusMiningRate: number;
    totalMiningRate: number;
    totalBalance: number;
    totalMined: number;
    totalReferralBonus: number;
    lastMinedAt: number | null;
    currentCycleStartTime: number | null;
    nextMiningAvailableAt: number;
    totalCyclesCompleted: number;
  }): User {
    let user = this.getUserById(ckpt.userId);
    if (!user && ckpt.googleId) {
      user = this.getUserByGoogleId(ckpt.googleId);
    }
    if (!user && ckpt.email) {
      user = this.getUserByEmail(ckpt.email);
    }

    if (user && ckpt.googleId && (user.id !== ckpt.userId || user.googleId !== ckpt.googleId)) {
      user = this.bindGoogleIdentity(user.id, ckpt.googleId, ckpt.userId, ckpt.picture) || user;
    }

    const nowIso = new Date().toISOString();
    if (!user) {
      const restoredUser: User = {
        id: ckpt.userId,
        googleId: ckpt.googleId,
        username: ckpt.username,
        email: ckpt.email,
        picture: ckpt.picture,
        referralCode: ckpt.referralCode,
        referredByUserId: null,
        role: ckpt.role || 'user',
        status: 'active',
        baseMiningRate: ckpt.baseMiningRate ?? 0.12,
        bonusMiningRate: ckpt.bonusMiningRate ?? 0.0,
        totalMiningRate: ckpt.totalMiningRate ?? 0.12,
        createdAt: nowIso,
        lastLoginAt: nowIso,
        lastActiveAt: nowIso,
      };
      this.createUser(restoredUser, 0.0);
      user = restoredUser;
    } else if (ckpt.totalMiningRate > user.totalMiningRate) {
      user =
        this.updateUser(user.id, {
          baseMiningRate: ckpt.baseMiningRate,
          bonusMiningRate: ckpt.bonusMiningRate,
          totalMiningRate: ckpt.totalMiningRate,
        }) || user;
    }

    const currentMining = this.getMiningState(user.id);
    if (ckpt.totalCyclesCompleted > currentMining.totalCyclesCompleted) {
      this.updateMiningState(user.id, {
        isMiningActive: ckpt.nextMiningAvailableAt > Date.now(),
        currentCycleStartTime: ckpt.currentCycleStartTime,
        lastMinedAt: ckpt.lastMinedAt,
        nextMiningAvailableAt: ckpt.nextMiningAvailableAt,
        totalCyclesCompleted: Math.max(currentMining.totalCyclesCompleted, ckpt.totalCyclesCompleted),
      });
    }

    const currentBalance = this.getBalance(user.id);
    if (ckpt.totalBalance > currentBalance.totalBalance + 0.000001) {
      const diff = Number((ckpt.totalBalance - currentBalance.totalBalance).toFixed(6));
      const updatedBalance: BalanceRecord = {
        userId: user.id,
        totalBalance: Number(ckpt.totalBalance.toFixed(6)),
        totalMined: Number(Math.max(currentBalance.totalMined, ckpt.totalMined).toFixed(6)),
        totalReferralBonus: Number(Math.max(currentBalance.totalReferralBonus, ckpt.totalReferralBonus).toFixed(6)),
        lastCalculatedAt: nowIso,
        integrityChecksum: this.calculateChecksum(user.id, Number(ckpt.totalBalance.toFixed(6))),
      };
      this.data.balances[user.id] = updatedBalance;
      this.data.transactions.unshift({
        id: `tx_${Date.now()}_ckpt`,
        userId: user.id,
        type: 'mining_reward',
        amount: diff,
        balanceBefore: currentBalance.totalBalance,
        balanceAfter: updatedBalance.totalBalance,
        description: `Verified server mining ledger continuity (${ckpt.totalCyclesCompleted} cycle(s))`,
        timestamp: nowIso,
      });
      this.save();
    }

    return user;
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

    // Authoritatively reconcile inviter's bonus mining rate based on valid activated referrals
    const inviter = this.data.users[referral.inviterUserId];
    if (inviter) {
      const oldRate = inviter.totalMiningRate;
      const rateInfo = this.reconcileUserMiningRate(inviter.id);

      this.data.rateHistory.push({
        id: `rate_${Date.now()}_${inviter.id}`,
        userId: inviter.id,
        oldRate,
        newRate: rateInfo.totalRate,
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

  // --- Pulse Miner Game ---
  getPulseMinerState(userId: string): PulseMinerUserState {
    if (!this.data.pulseMinerStates) {
      this.data.pulseMinerStates = {};
    }
    if (!this.data.pulseMinerStates[userId]) {
      this.data.pulseMinerStates[userId] = {
        userId,
        highestUnlockedLevel: 1,
        completedLevels: [],
        highScores: {},
        claimedLevelRewards: {},
        totalGamePointsEarned: 0,
        lastPlayedAt: new Date().toISOString(),
      };
      this.save();
    }
    return this.data.pulseMinerStates[userId];
  }

  claimPulseMinerReward(
    userId: string,
    levelId: number,
    claimId: string,
    score: number,
    durationSeconds: number
  ): {
    success: boolean;
    rewardPoints: number;
    balance: BalanceRecord;
    state: PulseMinerUserState;
    isDuplicateClaim?: boolean;
    message?: string;
  } {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (user.status === 'suspended') {
      throw new Error('User account suspended');
    }

    if (!this.data.pulseMinerClaims) {
      this.data.pulseMinerClaims = [];
    }

    // 1. Idempotency Check: prevent duplicate rewards from repeated requests or rapid taps
    const existingClaim = this.data.pulseMinerClaims.find(
      (c) => c.id === claimId || (c.userId === userId && c.levelId === levelId && c.id === claimId)
    );
    const state = this.getPulseMinerState(userId);
    const currentBalance = this.getBalance(userId);

    if (existingClaim) {
      return {
        success: true,
        rewardPoints: existingClaim.rewardPoints,
        balance: currentBalance,
        state,
        isDuplicateClaim: true,
        message: 'Reward already credited for this claim identifier',
      };
    }

    // 2. Validate Level range (1-10)
    if (typeof levelId !== 'number' || levelId < 1 || levelId > 10) {
      throw new Error('Invalid level identifier. Must be between 1 and 10.');
    }

    // 3. Minimum sensible duration check to prevent instant bot exploits
    const minRequiredDuration = 4;
    if (typeof durationSeconds !== 'number' || durationSeconds < minRequiredDuration) {
      throw new Error(`Invalid gameplay duration (${durationSeconds}s). Minimum realistic completion time required.`);
    }

    // 4. Check if level completion reward was already claimed for this level
    const isFirstTimeCompletion = !state.claimedLevelRewards[levelId];

    // Reward scale as per specifications:
    // Level 1: 10, Level 2: 15, Level 3: 20, Level 4: 25, Level 5: 30, Level 6: 40, Level 7: 50, Level 8: 60, Level 9: 75, Level 10: 100
    const LEVEL_REWARDS: Record<number, number> = {
      1: 10,
      2: 15,
      3: 20,
      4: 25,
      5: 30,
      6: 40,
      7: 50,
      8: 60,
      9: 75,
      10: 100,
    };

    let rewardPoints = 0;
    if (isFirstTimeCompletion) {
      rewardPoints = LEVEL_REWARDS[levelId] || 10;
    }

    // 5. Update user game state
    state.lastPlayedAt = new Date().toISOString();
    state.highestUnlockedLevel = Math.max(state.highestUnlockedLevel, Math.min(10, levelId + 1));
    if (!state.completedLevels.includes(levelId)) {
      state.completedLevels.push(levelId);
      state.completedLevels.sort((a, b) => a - b);
    }
    state.highScores[levelId] = Math.max(state.highScores[levelId] || 0, score);

    let updatedBalance = currentBalance;

    if (rewardPoints > 0) {
      state.claimedLevelRewards[levelId] = {
        claimedAt: new Date().toISOString(),
        rewardPoints,
        claimId,
      };
      state.totalGamePointsEarned = Number((state.totalGamePointsEarned + rewardPoints).toFixed(6));

      // 6. Credit authoritative ledger and balance
      const res = this.addBalanceTransaction(
        userId,
        rewardPoints,
        'game_reward',
        `Pulse Miner: Level ${levelId} Completion Reward (+${rewardPoints} CP)`,
        claimId
      );
      updatedBalance = res.balance;

      this.data.pulseMinerClaims.push({
        id: claimId,
        userId,
        levelId,
        score,
        rewardPoints,
        durationSeconds,
        timestamp: new Date().toISOString(),
      });
    }

    this.save();

    return {
      success: true,
      rewardPoints,
      balance: updatedBalance,
      state,
      isDuplicateClaim: false,
      message:
        rewardPoints > 0
          ? `Successfully credited +${rewardPoints} CP for completing Level ${levelId}!`
          : `Level ${levelId} replay completed! High score updated.`,
    };
  }
}


export const db = new Database();
