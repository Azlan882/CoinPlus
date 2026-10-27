import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  cpToSats,
  satsToBtc,
  btcToSats,
  SATS_PER_CP,
  SATS_PER_BTC,
} from './test_migration_sandbox.ts';
import { User } from '../server/types.ts';

// Configure isolated sandbox environment for Database testing
const TEST_SANDBOX_FILE = 'coinpulse_db_test_isolated.json';
process.env.COINPULSE_DB_FILE = TEST_SANDBOX_FILE;

const testDbPath = path.resolve(process.cwd(), 'data', TEST_SANDBOX_FILE);
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

// Dynamically import db with isolated test database file
const { db } = await import('../server/db.ts');

async function runBtcSimulationTests() {
  console.log('🧪 Starting CoinPulse BTC Simulation Hardening & Unit Tests...\n');
  let passed = 0;
  let failed = 0;

  let userSeq = 1;
  function makeTestUser(
    username: string,
    email: string,
    currency?: 'CP' | 'BTC_SIMULATED',
    referralCode?: string
  ): User {
    const isBtc = currency === 'BTC_SIMULATED';
    const id = `usr_test_${Date.now()}_${userSeq++}`;
    let referredByUserId: string | null = null;
    if (referralCode) {
      const inviter = db.getUserByReferralCode(referralCode);
      if (inviter) {
        referredByUserId = inviter.id;
      }
    }

    const user: User = {
      id,
      username,
      email,
      passwordHash: 'dummy_hash',
      salt: 'dummy_salt',
      referralCode: `REF_${username.toUpperCase().slice(0, 4)}_${userSeq}`,
      referredByUserId,
      role: 'user',
      status: 'active',
      currency: currency || 'CP',
      baseMiningRate: isBtc ? 0.00012000 : 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: isBtc ? 0.00012000 : 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    db.createUser(user, 0.0);

    if (referredByUserId) {
      db.createReferral({
        id: `ref_${Date.now()}_${userSeq}`,
        inviterUserId: referredByUserId,
        referredUserId: id,
        referralCodeUsed: referralCode || '',
        status: 'pending',
        rateBonusApplied: 0,
        createdAt: new Date().toISOString(),
        firstMiningCompletedAt: null,
      });
    }

    return user;
  }

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Rate Model Calculations
  await test('Rate Model: Base rate is exactly 0.00012000 simulated BTC/h (12,000 sats)', () => {
    const baseRateBtc = 0.00012000;
    const baseRateSats = btcToSats(baseRateBtc);
    assert.strictEqual(baseRateSats, 12000, 'Base rate must be exactly 12,000 satoshis');
    assert.strictEqual(satsToBtc(baseRateSats), 0.00012000, 'Must format to exactly 0.00012000 BTC');
  });

  await test('Rate Model: Referral bonus adds exactly +0.00001000 BTC/h (1,000 sats) per referral', () => {
    const referralBoostSats = 1000;
    const oneRefTotalSats = 12000 + (1 * referralBoostSats);
    const twoRefTotalSats = 12000 + (2 * referralBoostSats);

    assert.strictEqual(satsToBtc(oneRefTotalSats), 0.00013000, '1 referral must equal 0.00013000 BTC/h');
    assert.strictEqual(satsToBtc(twoRefTotalSats), 0.00014000, '2 referrals must equal 0.00014000 BTC/h');
  });

  await test('Precision: Satoshi integer arithmetic prevents floating-point accumulation errors', () => {
    const floatSum = 0.00012 + 0.00001;
    assert.notStrictEqual(floatSum.toString(), '0.00013', 'JS floats produce precision drift');

    // Integer satoshi arithmetic is 100% exact:
    const satsSum = 12000 + 1000;
    assert.strictEqual(satsSum, 13000, 'Integer satoshis never drift');
    assert.strictEqual(satsToBtc(satsSum), 0.00013000, 'Formatted BTC output is perfectly exact');
  });

  await test('Conversion Ratio: 1 legacy CP converts to 100,000 sats (0.00100000 BTC)', () => {
    assert.strictEqual(cpToSats(1.0), 100000);
    assert.strictEqual(satsToBtc(cpToSats(1.0)), 0.00100000);

    // Primary account (1.8 CP)
    assert.strictEqual(cpToSats(1.8), 180000);
    assert.strictEqual(satsToBtc(cpToSats(1.8)), 0.00180000);

    // Single cycle (0.12 CP)
    assert.strictEqual(cpToSats(0.12), 12000);
    assert.strictEqual(satsToBtc(cpToSats(0.12)), 0.00012000);

    // Referral bonus rate (0.01 CP)
    assert.strictEqual(cpToSats(0.01), 1000);
    assert.strictEqual(satsToBtc(cpToSats(0.01)), 0.00001000);
  });

  // 2. Dual-Mode Rate Calculation in Database Engine
  await test('Engine Dual-Mode: Legacy CP user receives 0.12 CP/h base and +0.01 CP/h per referral', () => {
    const legacyUser = makeTestUser('legacy_miner', 'legacy@test.com', 'CP');
    assert.strictEqual(legacyUser.currency ?? 'CP', 'CP');

    const rates = db.reconcileUserMiningRate(legacyUser.id);
    assert.strictEqual(rates.baseRate, 0.12, 'Legacy CP base rate must be 0.12');
    assert.strictEqual(rates.bonusRate, 0.0, 'Initial bonus must be 0');
    assert.strictEqual(rates.totalRate, 0.12, 'Total rate must be 0.12 CP/h');
  });

  await test('Engine Dual-Mode: Migrated BTC user receives 0.00012000 BTC/h base and +0.00001000 BTC/h per referral', () => {
    const btcUser = makeTestUser('btc_miner_test', 'btcminer@test.com', 'BTC_SIMULATED');

    const rates0 = db.reconcileUserMiningRate(btcUser.id);
    assert.strictEqual(rates0.baseRate, 0.00012000, 'BTC base rate must be 0.00012000');
    assert.strictEqual(rates0.bonusRate, 0.0, 'No referral bonus initially');
    assert.strictEqual(rates0.totalRate, 0.00012000, 'Total rate must be 0.00012000');

    // Create 2 referees and activate them
    const ref1 = makeTestUser('ref_one', 'ref1@test.com', 'BTC_SIMULATED', btcUser.referralCode);
    const ref2 = makeTestUser('ref_two', 'ref2@test.com', 'BTC_SIMULATED', btcUser.referralCode);

    const ref1Record = db.getReferralByReferredUser(ref1.id);
    const ref2Record = db.getReferralByReferredUser(ref2.id);
    assert(ref1Record, 'ref1 record must exist');
    assert(ref2Record, 'ref2 record must exist');
    db.activateReferral(ref1Record.id);
    db.activateReferral(ref2Record.id);

    const rates2 = db.reconcileUserMiningRate(btcUser.id);
    assert.strictEqual(rates2.activeReferralCount, 2, 'Must have 2 active referrals');
    assert.strictEqual(rates2.bonusRate, 0.00002000, 'Two referrals must add 0.00002000 BTC/h (2,000 sats)');
    assert.strictEqual(rates2.totalRate, 0.00014000, 'Base + 2 referrals must equal exactly 0.00014000 BTC/h (14,000 sats)');
  });

  // 3. Denomination-Aware Ledger Reconciliation & Checksum Integrity
  await test('Ledger Integrity: Denomination-aware reconciliation passes for BTC account without CP corruption', () => {
    const user = makeTestUser('ledger_btc_user', 'ledgerbtc@test.com', 'BTC_SIMULATED');

    // Initial state
    const integrity0 = db.verifyBalanceIntegrity(user.id);
    assert.strictEqual(integrity0.isValid, true, 'Clean initial state must be valid');
    assert.strictEqual(integrity0.currency, 'BTC_SIMULATED');

    // Add mining transaction in BTC
    db.addBalanceTransaction(user.id, 0.00012000, 'mining_reward', 'Simulated Hourly Cycle #1', undefined, 'BTC_SIMULATED');
    const integrity1 = db.verifyBalanceIntegrity(user.id);
    assert.strictEqual(integrity1.isValid, true, 'Integrity check must pass after BTC mining cycle');
    assert.strictEqual(integrity1.recorded, 0.00012000);
    assert.strictEqual(integrity1.expected, 0.00012000);

    // Add referral bonus in BTC
    db.addBalanceTransaction(user.id, 0.00005000, 'referral_bonus', 'Referral Milestone Reward', undefined, 'BTC_SIMULATED');
    const integrity2 = db.verifyBalanceIntegrity(user.id);
    assert.strictEqual(integrity2.isValid, true, 'Integrity check must pass after referral bonus');
    assert.strictEqual(integrity2.recorded, 0.00017000);
    assert.strictEqual(integrity2.expected, 0.00017000);
  });

  // 4. Pulse Miner Rewards in BTC Mode
  await test('Pulse Miner: Awards exact proportional satoshis (1,000 to 10,000 sats) for BTC users', () => {
    const gamer = makeTestUser('pulse_miner_gamer', 'gamer@test.com', 'BTC_SIMULATED');

    // Claim level 1: 0.00001000 BTC (1,000 sats)
    const claimRes1 = db.claimPulseMinerReward(gamer.id, 1, 'claim_lvl1_unique', 150, 15);
    assert.strictEqual(claimRes1.rewardPoints, 0.00001000, 'Level 1 reward must be 0.00001000 BTC (1,000 sats)');
    assert.strictEqual(claimRes1.balance.currency, 'BTC_SIMULATED');
    assert.strictEqual(claimRes1.balance.totalBalance, 0.00001000);

    // Exact duplicate claim with same claimId is rejected without double credit
    const claimRes1Dup = db.claimPulseMinerReward(gamer.id, 1, 'claim_lvl1_unique', 180, 12);
    assert.strictEqual(claimRes1Dup.isDuplicateClaim, true, 'Must detect duplicate claimId');
    assert.strictEqual(claimRes1Dup.balance.totalBalance, 0.00001000, 'Balance must not change');

    // Replay with new claimId awards 0 additional points
    const claimRes1Replay = db.claimPulseMinerReward(gamer.id, 1, 'claim_lvl1_replay', 180, 12);
    assert.strictEqual(claimRes1Replay.rewardPoints, 0, 'Must award 0 points for repeat play of cleared sector');
    assert.strictEqual(claimRes1Replay.balance.totalBalance, 0.00001000, 'Balance must not change on replay');

    // Claim level 10: 0.00010000 BTC (10,000 sats)
    const claimRes10 = db.claimPulseMinerReward(gamer.id, 10, 'claim_lvl10_unique', 950, 35);
    assert.strictEqual(claimRes10.rewardPoints, 0.00010000, 'Level 10 reward must be 0.00010000 BTC (10,000 sats)');
    assert.strictEqual(claimRes10.balance.totalBalance, 0.00011000, 'Balance must equal 0.00001000 + 0.00010000 = 0.00011000 BTC');

    // Verify ledger integrity
    const audit = db.verifyBalanceIntegrity(gamer.id);
    assert.strictEqual(audit.isValid, true, 'Ledger must reconcile after Pulse Miner awards');
  });

  // 5. Admin Seed Protection Test
  await test('Admin Seeding: seedAdminIfNeeded never resets or inflates a migrated BTC balance', () => {
    const adminUser = db.getUserByUsername('admin');
    assert(adminUser, 'Admin user must exist');

    // Simulate migrating admin to BTC
    db.updateUser(adminUser.id, { currency: 'BTC_SIMULATED' });
    const btcBal = db.getBalance(adminUser.id);
    btcBal.currency = 'BTC_SIMULATED';
    btcBal.totalBalance = 0.00180000;
    btcBal.integrityChecksum = db.calculateChecksum(adminUser.id, 0.00180000, 'BTC_SIMULATED');

    // Run seedAdminIfNeeded
    db.seedAdminIfNeeded();

    // Verify balance was NOT clobbered to 0.36 CP
    const postBal = db.getBalance(adminUser.id);
    assert.strictEqual(postBal.currency, 'BTC_SIMULATED');
    assert.strictEqual(postBal.totalBalance, 0.00180000, 'Balance must remain 0.00180000 BTC and never reset to 0.36');
  });

  // Cleanup test database file
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  console.log(`\n========================================`);
  console.log(`BTC Simulation Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runBtcSimulationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
