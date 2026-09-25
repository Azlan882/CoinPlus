import { db } from './db.ts';
import { User, MiningSession } from './types.ts';

// Standard 1-hour production cooldown
export const MINING_COOLDOWN_MS = process.env.TEST_FAST_COOLDOWN
  ? parseInt(process.env.TEST_FAST_COOLDOWN, 10)
  : 3600 * 1000;

// Mutex lock to prevent concurrent double-clicks or racing requests
const userLocks = new Map<string, boolean>();

export interface MineResult {
  minedAmount: number;
  newBalance: number;
  totalMined: number;
  nextMiningAvailableAt: number;
  cycleStartTime: number;
  currentMiningRate: number;
  sessionNumber: number;
  referralActivated: boolean;
  message: string;
}

export async function processMineRequest(
  user: User,
  ipAddress: string,
  userAgent: string = ''
): Promise<{ success: boolean; status: number; data?: MineResult; error?: string; remainingSeconds?: number }> {
  // Check mutex lock
  if (userLocks.get(user.id)) {
    db.logSecurityEvent('double_mine_attempt', ipAddress, 'medium', user.id, { reason: 'Concurrent request lock' }, userAgent);
    return {
      success: false,
      status: 429,
      error: 'Mining action already being processed. Please wait a moment.',
    };
  }

  userLocks.set(user.id, true);

  try {
    const now = Date.now();
    const miningState = db.getMiningState(user.id);

    // Verify cooldown strictly
    if (miningState.nextMiningAvailableAt > 0 && now < miningState.nextMiningAvailableAt) {
      const remainingMs = miningState.nextMiningAvailableAt - now;
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      db.logSecurityEvent(
        'cooldown_violation',
        ipAddress,
        'low',
        user.id,
        {
          attemptedAt: now,
          nextMiningAvailableAt: miningState.nextMiningAvailableAt,
          remainingSeconds,
        },
        userAgent
      );

      return {
        success: false,
        status: 429,
        error: `Mining cooldown in progress. Please wait ${remainingSeconds}s before starting your next session.`,
        remainingSeconds,
      };
    }

    // Refresh user to get latest rate
    const freshUser = db.getUserById(user.id) || user;
    const currentRate = freshUser.totalMiningRate;
    const sessionNumber = miningState.totalCyclesCompleted + 1;

    // Credit amount = 1 hour's mining rate
    const rewardAmount = Number(currentRate.toFixed(6));
    const sessionId = `ses_${Date.now()}_${user.id.slice(-6)}`;

    // Add balance and audit transaction record
    const { balance } = db.addBalanceTransaction(
      user.id,
      rewardAmount,
      'mining_reward',
      `Hourly mining cycle #${sessionNumber} completed (+${rewardAmount} CP)`,
      sessionId
    );

    // Record mining session
    const session: MiningSession = {
      id: sessionId,
      userId: user.id,
      sessionNumber,
      cycleStartTime: now,
      cycleEndTime: now + MINING_COOLDOWN_MS,
      minedAmount: rewardAmount,
      miningRateAtSession: currentRate,
      ipAddress,
      userAgent,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };
    db.recordMiningSession(session);

    // Check referral activation:
    // If this is the referred user's FIRST legitimate completed mining cycle,
    // activate the referral relationship and permanently increase inviter's rate by 0.01!
    let referralActivated = false;
    if (sessionNumber === 1 && freshUser.referredByUserId) {
      const existingRef = db.getReferralByReferredUser(freshUser.id);
      if (existingRef && existingRef.status === 'pending') {
        const activated = db.activateReferral(existingRef.id);
        if (activated) {
          referralActivated = true;
          // Also reward a first-cycle bonus transaction to inviter
          db.addBalanceTransaction(
            existingRef.inviterUserId,
            0.05,
            'referral_bonus',
            `Referral milestone: ${freshUser.username} completed their 1st mining cycle! (+0.05 CP + 0.01/hr boost)`,
            existingRef.id
          );
        }
      }
    }

    // Update mining state with next available timestamp
    const nextMiningAvailableAt = now + MINING_COOLDOWN_MS;
    db.updateMiningState(user.id, {
      isMiningActive: true,
      currentCycleStartTime: now,
      lastMinedAt: now,
      nextMiningAvailableAt,
      totalCyclesCompleted: sessionNumber,
    });

    return {
      success: true,
      status: 200,
      data: {
        minedAmount: rewardAmount,
        newBalance: balance.totalBalance,
        totalMined: balance.totalMined,
        nextMiningAvailableAt,
        cycleStartTime: now,
        currentMiningRate: currentRate,
        sessionNumber,
        referralActivated,
        message: `Successfully mined +${rewardAmount.toFixed(4)} CP! Next session available in 1 hour.`,
      },
    };
  } finally {
    userLocks.delete(user.id);
  }
}
