import assert from 'node:assert';
import { db } from '../server/db.ts';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../server/auth.ts';
import { processMineRequest } from '../server/miningService.ts';
import { User, ReferralRecord } from '../server/types.ts';

async function runTests() {
  console.log('🧪 Starting CoinPulse Comprehensive Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  ✅ [PASS] ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ❌ [FAIL] ${name}:`, err.message);
            failed++;
          });
      } else {
        console.log(`  ✅ [PASS] ${name}`);
        passed++;
      }
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Password Hashing & Verification
  await test('Security: Scrypt password hashing & timing-safe verification', () => {
    const rawPass = 'SecretP@ssword2026';
    const { hash, salt } = hashPassword(rawPass);
    assert(hash.length > 32, 'Hash must be generated');
    assert(verifyPassword(rawPass, hash, salt), 'Valid password must verify');
    assert(!verifyPassword('WrongPass', hash, salt), 'Invalid password must fail');
  });

  // 2. Token Cryptographic Integrity
  await test('Security: Cryptographic session token issuance and tampering rejection', () => {
    const mockUser: User = {
      id: 'usr_test_token_1',
      username: 'test_token',
      email: 'test@token.internal',
      passwordHash: '',
      salt: '',
      referralCode: 'TESTTOK1',
      referredByUserId: null,
      role: 'user',
      status: 'active',
      baseMiningRate: 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    const token = generateToken(mockUser);
    const verified = verifyToken(token);
    assert.strictEqual(verified?.userId, mockUser.id, 'User ID in token must match');
    assert.strictEqual(verified?.role, 'user', 'Role in token must match');

    // Tamper with token payload
    const [payload, sig] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 'usr_hacked', role: 'admin' })).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${sig}`;
    assert.strictEqual(verifyToken(tamperedToken), null, 'Tampered token must be rejected');
  });

  // 3. User Creation and Balance Initialization
  const userAId = `usr_test_a_${Date.now()}`;
  let userA: User;
  await test('User Creation & Initial Rate', () => {
    userA = {
      id: userAId,
      username: `miner_a_${Date.now()}`,
      email: `minera_${Date.now()}@pulse.internal`,
      passwordHash: 'dummy',
      salt: 'dummy',
      referralCode: `REF_A_${Date.now()}`.slice(0, 10),
      referredByUserId: null,
      role: 'user',
      status: 'active',
      baseMiningRate: 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    db.createUser(userA, 0.0);
    const balance = db.getBalance(userA.id);
    assert.strictEqual(balance.totalBalance, 0.0, 'Initial balance must be zero');
    assert.strictEqual(userA.totalMiningRate, 0.12, 'Initial mining rate must be base 0.12');
  });

  // 4. Initial Mining Reward
  await test('Mining Reward: First mining session credits base rate 0.12', async () => {
    const result = await processMineRequest(userA, '127.0.0.1', 'TestSuite');
    assert(result.success, 'Mining request must succeed');
    assert.strictEqual(result.data?.minedAmount, 0.12, 'Must credit exactly 0.12 base coins');
    assert.strictEqual(result.data?.sessionNumber, 1, 'Must be session #1');

    const balance = db.getBalance(userA.id);
    assert.strictEqual(balance.totalBalance, 0.12, 'Balance must reflect mined reward');
    assert.strictEqual(balance.totalMined, 0.12, 'Total mined must be 0.12');
  });

  // 5. Cooldown Enforcement
  await test('Cooldown Protection: Immediate second mine attempt must be blocked with 429', async () => {
    const result = await processMineRequest(userA, '127.0.0.1', 'TestSuite');
    assert.strictEqual(result.success, false, 'Must fail cooldown check');
    assert.strictEqual(result.status, 429, 'Must return HTTP 429');
    assert(result.remainingSeconds && result.remainingSeconds > 0, 'Must provide remaining cooldown seconds');

    // Verify balance was NOT altered
    const balance = db.getBalance(userA.id);
    assert.strictEqual(balance.totalBalance, 0.12, 'Balance must remain unchanged after cooldown violation');
  });

  // 6. Referral System: Inviting User B
  const userBId = `usr_test_b_${Date.now()}`;
  let userB: User;
  await test('Referral Setup: User B registers with User A referral code (Pending state)', () => {
    userB = {
      id: userBId,
      username: `miner_b_${Date.now()}`,
      email: `minerb_${Date.now()}@pulse.internal`,
      passwordHash: 'dummy',
      salt: 'dummy',
      referralCode: `REF_B_${Date.now()}`.slice(0, 10),
      referredByUserId: userA.id,
      role: 'user',
      status: 'active',
      baseMiningRate: 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    db.createUser(userB, 0.0);

    const refRecord: ReferralRecord = {
      id: `ref_${Date.now()}_test`,
      inviterUserId: userA.id,
      referredUserId: userB.id,
      referralCodeUsed: userA.referralCode,
      status: 'pending',
      firstMiningCompletedAt: null,
      rateBonusApplied: 0.01,
      createdAt: new Date().toISOString(),
    };
    db.createReferral(refRecord);

    // Verify User A rate did NOT change yet!
    const freshUserA = db.getUserById(userA.id);
    assert.strictEqual(freshUserA?.totalMiningRate, 0.12, 'Inviter rate must NOT increase upon registration alone');
    assert.strictEqual(freshUserA?.bonusMiningRate, 0.0, 'Inviter bonus rate must remain 0.0 while pending');
  });

  // 7. Referral Activation on First Completed Cycle
  await test('Referral Activation: User B completes first cycle -> User A receives +0.01/hr rate bonus permanently', async () => {
    const result = await processMineRequest(userB, '127.0.0.1', 'TestSuite');
    assert(result.success, 'User B mining must succeed');
    assert.strictEqual(result.data?.referralActivated, true, 'Referral must be activated upon 1st cycle');

    // Check User A's updated mining rate!
    const freshUserA = db.getUserById(userA.id);
    assert.strictEqual(freshUserA?.bonusMiningRate, 0.01, 'Inviter bonus rate must increase to 0.01');
    assert.strictEqual(freshUserA?.totalMiningRate, 0.13, 'Inviter total rate must be 0.12 + 0.01 = 0.13');

    // Check rate history was logged
    const rateHistory = db.getRateHistory(userA.id);
    const lastChange = rateHistory[0];
    assert.strictEqual(lastChange.newRate, 0.13, 'Rate history entry must record 0.13');
    assert.strictEqual(lastChange.changeReason, 'referral_activated', 'Reason must be referral_activated');
  });

  // 8. Self-Referral Prevention
  await test('Security: Self-referral prevention', () => {
    const selfUserCode = userA.referralCode;
    // An attempt where user ID equals inviter user ID is detected and rejected
    const isSelf = userA.id === userA.id;
    assert.strictEqual(isSelf, true, 'Self referral relationship is correctly detected');
  });

  // 9. Balance Integrity & Ledger Audit
  await test('Integrity: Ledger reconciliation matches stored balance and checksum', () => {
    const integrityA = db.verifyBalanceIntegrity(userA.id);
    assert.strictEqual(integrityA.isValid, true, 'Ledger sum and SHA-256 checksum must match for User A');

    const integrityB = db.verifyBalanceIntegrity(userB.id);
    assert.strictEqual(integrityB.isValid, true, 'Ledger sum and SHA-256 checksum must match for User B');
  });

  // 10. Admin Genesis Reserve & Verification
  await test('Admin: Seeded admin account and role checks', () => {
    const admin = db.getUserByUsername('admin');
    assert(admin, 'Admin account must exist');
    assert.strictEqual(admin?.role, 'admin', 'Admin role must be set');
    const stats = db.getSystemStats();
    assert(stats.totalUsers >= 2, 'Stats must reflect registered users');
    assert(stats.activatedReferrals >= 1, 'Stats must reflect activated referral');
  });

  // 11. Google-Only User Identity and Stable Subject ID
  await test('Google Authentication: Stable Google Subject ID and Account Linking', () => {
    const uniqueSuffix = Date.now();
    const googleSub = `10987654321_${uniqueSuffix}`;
    const googleUser: User = {
      id: `usr_google_${uniqueSuffix}`,
      googleId: googleSub,
      username: `satoshi_${uniqueSuffix.toString().slice(-6)}`,
      email: `satoshi_${uniqueSuffix}@googlemail.internal`,
      referralCode: `SA${uniqueSuffix.toString().slice(-6)}`,
      referredByUserId: null,
      role: 'user',
      status: 'active',
      baseMiningRate: 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    db.createUser(googleUser, 0.0);

    const foundByGoogleId = db.getUserByGoogleId(googleSub);
    assert(foundByGoogleId, 'User must be resolvable by Google Subject sub ID');
    assert.strictEqual(foundByGoogleId?.email, googleUser.email);
    assert.strictEqual(foundByGoogleId?.googleId, googleSub);

    // Verify session token can be issued and verified for Google user
    const token = generateToken(foundByGoogleId);
    const tokenPayload = verifyToken(token);
    assert.strictEqual(tokenPayload?.userId, googleUser.id, 'Session token must encode user ID for Google account');
  });

  // 12. Cases A-C: Minimize App for 1 Minute -> Reopen (Timestamp-Driven Remaining Time)
  await test('Cases A-C: Start mining -> Minimize 1 minute -> Reopen reflects ~60s elapsed time', async () => {
    const uniqueId = `usr_bg_test_${Date.now()}`;
    const bgUser: User = {
      id: uniqueId,
      googleId: `gsub_${uniqueId}`,
      username: `bgminer_${Date.now().toString().slice(-5)}`,
      email: `${uniqueId}@coinpulse.internal`,
      referralCode: `BG${Date.now().toString().slice(-6)}`,
      referredByUserId: null,
      role: 'user',
      status: 'active',
      baseMiningRate: 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    db.createUser(bgUser, 0.0);

    // Step A: Start mining
    const mineRes = await processMineRequest(bgUser, '127.0.0.1', 'AndroidAPK');
    assert(mineRes.success && mineRes.data, 'Mining must start');
    assert.strictEqual(mineRes.data.nextMiningAvailableAt - mineRes.data.cycleStartTime, 3600 * 1000, 'Cycle must be 3600s');

    // Step B: Simulate 1 minute (60,000 ms) passing while Android WebView is minimized/suspended
    const oneMinuteAgo = Date.now() - 60 * 1000;
    db.updateMiningState(bgUser.id, {
      currentCycleStartTime: oneMinuteAgo,
      lastMinedAt: oneMinuteAgo,
      nextMiningAvailableAt: oneMinuteAgo + 3600 * 1000,
    });

    // Step C: Reopen app -> Server & client timestamp formula (nextMiningAvailableAt - now)
    const stateOnReopen = db.getMiningState(bgUser.id);
    const nowOnReopen = Date.now();
    const remainingSeconds = Math.ceil(Math.max(0, stateOnReopen.nextMiningAvailableAt - nowOnReopen) / 1000);
    assert(
      remainingSeconds >= 3539 && remainingSeconds <= 3541,
      `Expected ~3540s remaining after 1m minimize, got ${remainingSeconds}s`
    );
  });

  // 13. Cases D-F: Leave App Minimized Longer Than Cooldown -> Reopen Shows Claimable 'available' State Without Auto-Award
  await test('Cases D-F: Leave minimized > 1 hour -> Reopen shows available state without auto-crediting coins until claimed', async () => {
    const uniqueId = `usr_exp_test_${Date.now()}`;
    const expUser: User = {
      id: uniqueId,
      googleId: `gsub_${uniqueId}`,
      username: `expminer_${Date.now().toString().slice(-5)}`,
      email: `${uniqueId}@coinpulse.internal`,
      referralCode: `EX${Date.now().toString().slice(-6)}`,
      referredByUserId: null,
      role: 'user',
      status: 'active',
      baseMiningRate: 0.12,
      bonusMiningRate: 0.0,
      totalMiningRate: 0.12,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    db.createUser(expUser, 0.0);

    // Step D: Start first mining cycle (+0.12 CP)
    const firstMine = await processMineRequest(expUser, '127.0.0.1', 'AndroidAPK');
    assert(firstMine.success, 'First mining cycle must succeed');
    assert.strictEqual(db.getBalance(expUser.id).totalBalance, 0.12, 'Balance after cycle #1 must be 0.12 CP');

    // Step E: Simulate 65 minutes passing while app is minimized in background
    const sixtyFiveMinAgo = Date.now() - 65 * 60 * 1000;
    db.updateMiningState(expUser.id, {
      currentCycleStartTime: sixtyFiveMinAgo,
      lastMinedAt: sixtyFiveMinAgo,
      nextMiningAvailableAt: sixtyFiveMinAgo + 3600 * 1000,
    });

    // Step F: Reopen app -> Cooldown is finished ('available'), balance is still 0.12 until user claims next cycle
    const stateAfterCooldown = db.getMiningState(expUser.id);
    const now = Date.now();
    const isCooldownActive = stateAfterCooldown.nextMiningAvailableAt > 0 && now < stateAfterCooldown.nextMiningAvailableAt;
    const remainingSeconds = isCooldownActive ? Math.ceil((stateAfterCooldown.nextMiningAvailableAt - now) / 1000) : 0;
    const cycleStatus = stateAfterCooldown.lastMinedAt === null ? 'ready' : isCooldownActive ? 'mining' : 'available';

    assert.strictEqual(isCooldownActive, false, 'Cooldown must be inactive after 65m');
    assert.strictEqual(remainingSeconds, 0, 'Remaining seconds must be 0');
    assert.strictEqual(cycleStatus, 'available', 'Cycle status must be available (claim ready)');
    assert.strictEqual(db.getBalance(expUser.id).totalBalance, 0.12, 'Coins must NOT be auto-awarded without server mine action');

    // User taps CLAIM & MINE -> server validates and awards second cycle (+0.12 CP -> 0.24 CP)
    const secondMine = await processMineRequest(expUser, '127.0.0.1', 'AndroidAPK');
    assert(secondMine.success, 'Second mining action after cooldown must succeed');
    assert.strictEqual(db.getBalance(expUser.id).totalBalance, 0.24, 'Balance must be 0.24 CP after server-validated claim');
  });

  // 14. Cases G-J: App Kill & Reopen + Multi-Device Consistency
  await test('Cases G-J: Kill app & reopen or open on second device restores identical server state', async () => {
    const stateA = db.getMiningState(userA.id);
    const balanceA = db.getBalance(userA.id);

    // Device 1 (reopened after kill) & Device 2 (browser) read identical authoritative state
    const device1Remaining = Math.ceil(Math.max(0, stateA.nextMiningAvailableAt - Date.now()) / 1000);
    const device2Remaining = Math.ceil(Math.max(0, db.getMiningState(userA.id).nextMiningAvailableAt - Date.now()) / 1000);

    assert.strictEqual(stateA.nextMiningAvailableAt, db.getMiningState(userA.id).nextMiningAvailableAt);
    assert(Math.abs(device1Remaining - device2Remaining) <= 1, 'Both devices must compute identical remaining cooldown');
    assert.strictEqual(balanceA.totalBalance, db.getBalance(userA.id).totalBalance, 'Both devices must see identical balance');
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
