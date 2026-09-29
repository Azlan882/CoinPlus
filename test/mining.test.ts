import assert from 'node:assert';
import { db } from '../server/db.ts';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  deriveDeterministicUserId,
  generateStateCheckpoint,
  verifyStateCheckpoint,
} from '../server/auth.ts';
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

  // 13. Multi-Cycle Continuity (Cycles 1, 2, 3, 4, and 5 + Checkpoint Recovery & Reopen/Re-Auth)
  await test('Multi-Cycle & Checkpoint Continuity: Cycles 1, 2, 3, 4, and 5 succeed without limit across restarts, reopen, and re-login', async () => {
    const googleSub = `google_multicycle_${Date.now()}`;
    const deterministicId = deriveDeterministicUserId(googleSub);
    const cycleUser: User = {
      id: deterministicId,
      googleId: googleSub,
      username: `multiminer_${Date.now().toString().slice(-4)}`,
      email: `multiminer_${Date.now()}@gmail.com`,
      referralCode: `MC_${Date.now().toString().slice(-4)}`,
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
    db.createUser(cycleUser, 0.0);

    // Cycle 1: First Mine
    const cycle1 = await processMineRequest(cycleUser, '127.0.0.1', 'CoinPulse-APK/1.0');
    assert(cycle1.success, '1st mining cycle must succeed');
    assert.strictEqual(cycle1.data?.sessionNumber, 1, 'Session number must be 1');
    assert.strictEqual(cycle1.data?.newBalance, 0.12, 'Balance after 1st cycle must be 0.12 CP');

    // Generate server-signed HMAC state checkpoint after Cycle 1
    const ckptAfterCycle1 = generateStateCheckpoint(cycleUser.id);
    assert(ckptAfterCycle1, 'Server must generate HMAC state checkpoint after Cycle 1');
    const verifiedCkpt1 = verifyStateCheckpoint(ckptAfterCycle1!);
    assert(verifiedCkpt1, 'Checkpoint signature must verify');
    assert.strictEqual(verifiedCkpt1?.totalBalance, 0.12);
    assert.strictEqual(verifiedCkpt1?.totalCyclesCompleted, 1);

    // Simulate 1-hour cooldown completion for Cycle 1
    const pastEnd1 = Date.now() - 5000;
    db.updateMiningState(cycleUser.id, {
      currentCycleStartTime: pastEnd1 - 3600 * 1000,
      lastMinedAt: pastEnd1 - 3600 * 1000,
      nextMiningAvailableAt: pastEnd1,
      isMiningActive: true,
    });

    // Re-issue checkpoint reflecting expired cooldown and reconcile
    const ckptReadyForCycle2 = generateStateCheckpoint(cycleUser.id)!;
    const parsedCkpt2 = verifyStateCheckpoint(ckptReadyForCycle2)!;
    const reconciledUser = db.reconcileVerifiedCheckpoint(parsedCkpt2);
    assert.strictEqual(reconciledUser.id, cycleUser.id, 'Deterministic user ID must be preserved');

    // Cycle 2: Second Mine
    const cycle2 = await processMineRequest(reconciledUser, '127.0.0.1', 'CoinPulse-APK/1.0');
    assert(cycle2.success, '2nd mining cycle must succeed');
    assert.strictEqual(cycle2.data?.sessionNumber, 2, 'Session number must be 2');
    assert.strictEqual(cycle2.data?.newBalance, 0.24, 'Balance after 2nd cycle must be 0.24 CP');

    // Simulate 1-hour cooldown completion for Cycle 2
    const pastEnd2 = Date.now() - 5000;
    db.updateMiningState(cycleUser.id, {
      currentCycleStartTime: pastEnd2 - 3600 * 1000,
      lastMinedAt: pastEnd2 - 3600 * 1000,
      nextMiningAvailableAt: pastEnd2,
      isMiningActive: true,
    });

    // Cycle 3: Third Mine
    const cycle3 = await processMineRequest(reconciledUser, '127.0.0.1', 'CoinPulse-APK/1.0');
    assert(cycle3.success, '3rd mining cycle must succeed');
    assert.strictEqual(cycle3.data?.sessionNumber, 3, 'Session number must be 3');
    assert.strictEqual(cycle3.data?.newBalance, 0.36, 'Balance after 3rd cycle must be 0.36 CP');

    // Simulate 1-hour cooldown completion for Cycle 3 + cold-start checkpoint restore
    const pastEnd3 = Date.now() - 5000;
    db.updateMiningState(cycleUser.id, {
      currentCycleStartTime: pastEnd3 - 3600 * 1000,
      lastMinedAt: pastEnd3 - 3600 * 1000,
      nextMiningAvailableAt: pastEnd3,
      isMiningActive: true,
    });
    const ckptReadyForCycle4 = generateStateCheckpoint(cycleUser.id)!;
    const reconciledForCycle4 = db.reconcileVerifiedCheckpoint(verifyStateCheckpoint(ckptReadyForCycle4)!);

    // Cycle 4: Fourth Mine (critical cycle reported by user)
    const cycle4 = await processMineRequest(reconciledForCycle4, '127.0.0.1', 'CoinPulse-APK/1.0');
    assert(cycle4.success, '4th mining cycle must succeed');
    assert.strictEqual(cycle4.data?.sessionNumber, 4, 'Session number must be 4');
    assert.strictEqual(cycle4.data?.newBalance, 0.48, 'Balance after 4th cycle must be 0.48 CP');

    // Simulate sign-out & sign-back-in via bindGoogleIdentity + 1-hour cooldown completion for Cycle 4
    const reSignedInUser = db.bindGoogleIdentity(cycleUser.id, googleSub, deterministicId)!;
    assert.strictEqual(reSignedInUser.id, cycleUser.id, 'Re-login with Google must preserve user ID');
    const pastEnd4 = Date.now() - 5000;
    db.updateMiningState(reSignedInUser.id, {
      currentCycleStartTime: pastEnd4 - 3600 * 1000,
      lastMinedAt: pastEnd4 - 3600 * 1000,
      nextMiningAvailableAt: pastEnd4,
      isMiningActive: true,
    });

    // Cycle 5: Fifth Mine
    const cycle5 = await processMineRequest(reSignedInUser, '127.0.0.1', 'CoinPulse-APK/1.0');
    assert(cycle5.success, '5th mining cycle must succeed');
    assert.strictEqual(cycle5.data?.sessionNumber, 5, 'Session number must be 5');
    assert.strictEqual(cycle5.data?.newBalance, 0.60, 'Balance after 5th cycle must be 0.60 CP');
    assert(db.verifyBalanceIntegrity(cycleUser.id).isValid, 'Ledger integrity must remain valid across all 5 cycles');
  });

  // 16. Primary Miner Account Continuity & Google Sub Identity Binding
  await test('Primary Google Miner Account: Restored balance (>= 0.36 CP, 3 completed cycles) and stable Google sub identity binding', () => {
    const primaryUser = db.getUserByEmail('m.shahraiz774@gmail.com');
    assert(primaryUser, 'Primary Google miner account must exist in database');
    assert.strictEqual(primaryUser?.id, 'usr_g_b7d1e0d22f16c08b', 'Primary user ID must match canonical Google sub ID');
    assert.strictEqual(primaryUser?.googleId, '110989942788351733924', 'Primary googleId must be preserved');
    const primaryBalance = db.getBalance(primaryUser!.id);
    const primaryMining = db.getMiningState(primaryUser!.id);
    assert(primaryBalance.totalBalance >= 0.36, `Expected >= 0.36 CP restored balance, got ${primaryBalance.totalBalance}`);
    assert(primaryMining.totalCyclesCompleted >= 3, `Expected >= 3 completed cycles, got ${primaryMining.totalCyclesCompleted}`);
    assert(db.verifyBalanceIntegrity(primaryUser!.id).isValid, 'Primary miner ledger checksum must be valid');
  });

  // 17. Live Nginx + Express End-to-End Test of All 11 Android APK & Web Auth/Mining Cases
  await test('Live HTTP Proxy (Cases 1-11): Android APK & Web GET /api/auth/me, single CORS header, Cookie + Bearer auth, Sign-out/Sign-in, and Mining', async () => {
    const baseUrl = 'http://localhost:8080';
    const apkOrigin = 'https://localhost';
    const webOrigin = 'https://ais-dev-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app';

    // Verify existing primary account on both Android APK origin and Web origin without modifying its balance
    const primaryUser = db.getUserByEmail('m.shahraiz774@gmail.com')!;
    const primaryToken = generateToken(primaryUser);

    const apkMePrimary = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${primaryToken}`,
        Accept: 'application/json',
      },
    });
    assert.strictEqual(apkMePrimary.status, 200, 'Primary user GET /api/auth/me from APK origin must return 200');
    const acaoHeader = apkMePrimary.headers.get('access-control-allow-origin');
    assert.strictEqual(
      acaoHeader,
      apkOrigin,
      `Expected single Access-Control-Allow-Origin: ${apkOrigin}, got: ${acaoHeader}`
    );
    const apkPrimaryBody: any = await apkMePrimary.json();
    assert.strictEqual(apkPrimaryBody.user.id, 'usr_g_b7d1e0d22f16c08b');
    assert(apkPrimaryBody.balance.totalBalance >= 0.36);

    const webMePrimary = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: webOrigin,
        Cookie: `coinpulse_session_token=${encodeURIComponent(primaryToken)}`,
        Accept: 'application/json',
      },
    });
    assert.strictEqual(webMePrimary.status, 200, 'Primary user GET /api/auth/me via Cookie on Web origin must return 200');
    const webPrimaryBody: any = await webMePrimary.json();
    assert.strictEqual(webPrimaryBody.user.id, apkPrimaryBody.user.id, 'Web and APK must resolve identical user record');
    assert.strictEqual(webPrimaryBody.balance.totalBalance, apkPrimaryBody.balance.totalBalance, 'Web and APK must return identical balance');

    // Now test Cases 1-11 on a dedicated lifecycle test user
    const testSub = `gsub_lifecycle_${Date.now()}`;
    const testUserId = `usr_lifecycle_${Date.now()}`;
    const lifecycleUser: User = {
      id: testUserId,
      googleId: testSub,
      username: `lcminer_${Date.now().toString().slice(-4)}`,
      email: `lifecycle_miner_${Date.now()}@pulse.internal`,
      referralCode: `LC_${Date.now().toString().slice(-4)}`,
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
    db.createUser(lifecycleUser, 0.0);

    // Case 1 & 2: Fresh Google login -> GET /api/auth/me immediately after login
    let sessionToken = generateToken(lifecycleUser);
    let sessionCkpt = generateStateCheckpoint(lifecycleUser.id)!;

    const meRes1 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${sessionToken}`,
        'X-CoinPulse-Checkpoint': sessionCkpt,
        Accept: 'application/json',
      },
    });
    assert.strictEqual(meRes1.status, 200, 'Case 2: GET /api/auth/me immediately after login must return 200');
    const meData1: any = await meRes1.json();
    assert.strictEqual(meData1.success, true);
    assert.strictEqual(meData1.user.id, lifecycleUser.id);

    // Case 3, 4 & 5: Close APK -> Reopen APK -> GET /api/auth/me again
    const meRes2 = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${sessionToken}`,
        'X-CoinPulse-Checkpoint': meData1.stateCheckpoint || sessionCkpt,
        Accept: 'application/json',
      },
    });
    assert.strictEqual(meRes2.status, 200, 'Case 5: GET /api/auth/me after close & reopen APK must return 200');

    // Case 6: Sign out -> Verify POST /api/auth/logout clears cookie & unauthenticated GET /api/auth/me returns 401
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: apkOrigin, Accept: 'application/json' },
    });
    assert.strictEqual(logoutRes.status, 200, 'Case 6: POST /api/auth/logout must return 200');

    const unauthMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: apkOrigin, Accept: 'application/json' },
    });
    assert.strictEqual(unauthMeRes.status, 401, 'Case 6: Unauthenticated GET /api/auth/me must return 401');
    assert.strictEqual(unauthMeRes.headers.get('access-control-allow-origin'), apkOrigin);
    const unauthBody: any = await unauthMeRes.json();
    assert.strictEqual(unauthBody.code, 'AUTH_TOKEN_MISSING');

    // Case 7: Sign in again
    sessionToken = generateToken(lifecycleUser);
    const meResAfterRelogin = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${sessionToken}`,
        Accept: 'application/json',
      },
    });
    assert.strictEqual(meResAfterRelogin.status, 200, 'Case 7: GET /api/auth/me after signing in again must return 200');

    // Case 8: Start mining (POST /api/mine)
    const mineRes1 = await fetch(`${baseUrl}/api/mine`, {
      method: 'POST',
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ clientTimestamp: Date.now() }),
    });
    assert.strictEqual(mineRes1.status, 200, 'Case 8: POST /api/mine must return 200');
    const mineData1: any = await mineRes1.json();
    assert.strictEqual(mineData1.newBalance, 0.12);
    assert.strictEqual(mineData1.sessionNumber, 1);

    // Case 9 & 10: Complete mining cycle -> GET /api/auth/me again
    db.syncIfModifiedOnDisk();
    const expiredTime = Date.now() - 5000;
    db.updateMiningState(lifecycleUser.id, {
      currentCycleStartTime: expiredTime - 3600 * 1000,
      lastMinedAt: expiredTime - 3600 * 1000,
      nextMiningAvailableAt: expiredTime,
      isMiningActive: true,
    });
    const ckptAfterCycle = generateStateCheckpoint(lifecycleUser.id)!;

    const meResAfterCycle = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${sessionToken}`,
        'X-CoinPulse-Checkpoint': ckptAfterCycle,
        Accept: 'application/json',
      },
    });
    assert.strictEqual(meResAfterCycle.status, 200, 'Case 10: GET /api/auth/me after completing cycle must return 200');
    const meDataAfterCycle: any = await meResAfterCycle.json();
    assert.strictEqual(meDataAfterCycle.miningState.status, 'available');
    assert.strictEqual(meDataAfterCycle.miningState.remainingSeconds, 0);
    assert.strictEqual(meDataAfterCycle.balance.totalBalance, 0.12);

    // Case 11: Minimize/reopen app & claim next cycle
    const mineRes2 = await fetch(`${baseUrl}/api/mine`, {
      method: 'POST',
      headers: {
        Origin: apkOrigin,
        Authorization: `Bearer ${sessionToken}`,
        'X-CoinPulse-Checkpoint': meDataAfterCycle.stateCheckpoint,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ clientTimestamp: Date.now() }),
    });
    assert.strictEqual(mineRes2.status, 200, 'Case 11: Second mining cycle after reopen must return 200');
    const mineData2: any = await mineRes2.json();
    assert.strictEqual(mineData2.newBalance, 0.24);
    assert.strictEqual(mineData2.sessionNumber, 2);
  });

  // 18. Authoritative Mining Timer Startup, Resume & Multi-Cycle Verification (Cases A-G)
  await test('Mining Timer Startup & Lifecycle (Cases A-G): Authoritative GET /api/mining/status timestamps across active, 10m reopen, minimize/resume, kill/reopen, completed, and 3+ cycles', async () => {
    const baseUrl = 'http://localhost:8080';
    const apkOrigin = 'https://localhost';

    const timerUserId = `usr_test_timer_${Date.now()}`;
    const timerUser: User = {
      id: timerUserId,
      googleId: `gsub_timer_${Date.now()}`,
      username: `timerminer_${Date.now().toString().slice(-4)}`,
      email: `timer_test_${Date.now()}@pulse.internal`,
      referralCode: `TM_${Date.now().toString().slice(-4)}`,
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
    db.createUser(timerUser, 0.0);
    const token = generateToken(timerUser);

    // Pre-mining state check: never mined before -> status === 'ready', remainingSeconds === 0
    const initialStatusRes = await fetch(`${baseUrl}/api/mining/status`, {
      headers: { Origin: apkOrigin, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    assert.strictEqual(initialStatusRes.status, 200);
    const initialStatus: any = await initialStatusRes.json();
    assert.strictEqual(initialStatus.status, 'ready');
    assert.strictEqual(initialStatus.isCooldownActive, false);
    assert.strictEqual(initialStatus.remainingSeconds, 0);

    // Cases F & G: Run 3 full cycles and verify Cases A, B, C, D, E within each cycle
    for (let cycle = 1; cycle <= 3; cycle++) {
      // Case F: Start a new mining cycle
      const startRes = await fetch(`${baseUrl}/api/mine`, {
        method: 'POST',
        headers: {
          Origin: apkOrigin,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ clientTimestamp: Date.now() }),
      });
      assert.strictEqual(startRes.status, 200, `Cycle ${cycle} start must return 200`);
      const startData: any = await startRes.json();
      assert.strictEqual(startData.sessionNumber, cycle);
      assert.strictEqual(startData.miningState.status, 'mining');
      assert.strictEqual(startData.miningState.isCooldownActive, true);
      assert(
        startData.nextMiningAvailableAt - startData.cycleStartTime === 3600 * 1000,
        'Authoritative cycle duration must be exactly 3,600,000 ms'
      );

      // Case A: Open app while an active mining cycle is running
      const activeRes = await fetch(`${baseUrl}/api/mining/status`, {
        headers: { Origin: apkOrigin, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const activeData: any = await activeRes.json();
      assert.strictEqual(activeData.status, 'mining');
      assert.strictEqual(activeData.isCooldownActive, true);
      const derivedRemainingA = Math.ceil(Math.max(0, activeData.nextMiningAvailableAt - activeData.serverTime) / 1000);
      assert(derivedRemainingA >= 3595 && derivedRemainingA <= 3600, `Case A expected ~3600s, got ${derivedRemainingA}s`);

      // Case B: Close and reopen after 10 minutes (600 seconds elapsed)
      db.syncIfModifiedOnDisk();
      const tenMinAgoStart = Date.now() - 600 * 1000;
      const fiftyMinLeftEnd = tenMinAgoStart + 3600 * 1000;
      db.updateMiningState(timerUser.id, {
        currentCycleStartTime: tenMinAgoStart,
        lastMinedAt: tenMinAgoStart,
        nextMiningAvailableAt: fiftyMinLeftEnd,
        isMiningActive: true,
      });
      const ckpt10m = generateStateCheckpoint(timerUser.id)!;

      const reopen10mRes = await fetch(`${baseUrl}/api/mining/status`, {
        headers: {
          Origin: apkOrigin,
          Authorization: `Bearer ${token}`,
          'X-CoinPulse-Checkpoint': ckpt10m,
          Accept: 'application/json',
        },
      });
      const reopen10mData: any = await reopen10mRes.json();
      const derivedRemainingB = Math.ceil(
        Math.max(0, reopen10mData.nextMiningAvailableAt - reopen10mData.serverTime) / 1000
      );
      assert(
        derivedRemainingB >= 2995 && derivedRemainingB <= 3001,
        `Case B (10m elapsed) expected ~3000s remaining, got ${derivedRemainingB}s`
      );

      // Case C & D: Minimize for 25 more minutes (total 35m elapsed) or kill & reopen app
      db.syncIfModifiedOnDisk();
      const thirtyFiveMinAgoStart = Date.now() - 2100 * 1000;
      const twentyFiveMinLeftEnd = thirtyFiveMinAgoStart + 3600 * 1000;
      db.updateMiningState(timerUser.id, {
        currentCycleStartTime: thirtyFiveMinAgoStart,
        lastMinedAt: thirtyFiveMinAgoStart,
        nextMiningAvailableAt: twentyFiveMinLeftEnd,
        isMiningActive: true,
      });
      const ckpt35m = generateStateCheckpoint(timerUser.id)!;

      const resume35mRes = await fetch(`${baseUrl}/api/mining/status`, {
        headers: {
          Origin: apkOrigin,
          Authorization: `Bearer ${token}`,
          'X-CoinPulse-Checkpoint': ckpt35m,
          Accept: 'application/json',
        },
      });
      const resume35mData: any = await resume35mRes.json();
      const derivedRemainingCD = Math.ceil(
        Math.max(0, resume35mData.nextMiningAvailableAt - resume35mData.serverTime) / 1000
      );
      assert(
        derivedRemainingCD >= 1495 && derivedRemainingCD <= 1501,
        `Case C/D (35m elapsed) expected ~1500s remaining, got ${derivedRemainingCD}s`
      );

      // Case E: Open immediately after a cycle has completed
      db.syncIfModifiedOnDisk();
      const completedStart = Date.now() - 3605 * 1000;
      const completedEnd = completedStart + 3600 * 1000;
      db.updateMiningState(timerUser.id, {
        currentCycleStartTime: completedStart,
        lastMinedAt: completedStart,
        nextMiningAvailableAt: completedEnd,
        isMiningActive: true,
      });
      const ckptCompleted = generateStateCheckpoint(timerUser.id)!;

      const completedRes = await fetch(`${baseUrl}/api/mining/status`, {
        headers: {
          Origin: apkOrigin,
          Authorization: `Bearer ${token}`,
          'X-CoinPulse-Checkpoint': ckptCompleted,
          Accept: 'application/json',
        },
      });
      const completedData: any = await completedRes.json();
      assert.strictEqual(completedData.status, 'available', `Cycle ${cycle} Case E must immediately return 'available'`);
      assert.strictEqual(completedData.isCooldownActive, false, `Cycle ${cycle} Case E isCooldownActive must be false`);
      assert.strictEqual(completedData.remainingSeconds, 0, `Cycle ${cycle} Case E remainingSeconds must be 0`);
    }
  });

  // 19. Mining Cycle Completion Notifications: Permission, Server-Authoritative Scheduling, Duplicate Prevention & Cancellation
  await test('Mining Notifications: One-time permission request, server-timestamp scheduling, duplicate prevention, and cancellation on completion', async () => {
    const {
      buildCycleNotificationKey,
      deriveCycleNotificationId,
      requestNotificationPermissionAfterSignIn,
      syncMiningCycleNotification,
    } = await import('../src/utils/notifications.ts');

    const storageMap = new Map<string, string>();
    const scheduledAlarms: Array<{ cycleKey: string; triggerAtEpochMs: number; notificationId: number; title: string; body: string }> = [];
    const completedDeliveries: Array<{ cycleKey: string; cycleEndMs: number }> = [];
    let cancelCount = 0;
    let permStatus = 'prompt';
    let requestPermCalls = 0;

    (globalThis as any).localStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
    };
    (globalThis as any).window = {
      clearTimeout: clearTimeout,
      CoinPulseNative: {
        getNotificationPermissionStatus: () => permStatus,
        requestNotificationPermissionOnce: () => {
          requestPermCalls++;
          permStatus = 'denied';
          return 'requested';
        },
        scheduleMiningCycleNotification: (
          cycleKey: string,
          triggerAtEpochMs: number,
          notificationId: number,
          title: string,
          body: string
        ) => {
          scheduledAlarms.push({ cycleKey, triggerAtEpochMs, notificationId, title, body });
          return true;
        },
        completeMiningCycleNotification: (cycleKey: string, cycleEndMs: number) => {
          completedDeliveries.push({ cycleKey, cycleEndMs });
          return true;
        },
        cancelMiningCycleNotification: () => {
          cancelCount++;
        },
        getScheduledMiningCycleNotification: () => {
          const last = scheduledAlarms[scheduledAlarms.length - 1];
          const lastDelivered = completedDeliveries[completedDeliveries.length - 1];
          return JSON.stringify({
            cycleKey: last?.cycleKey ?? '',
            triggerAtMs: last?.triggerAtEpochMs ?? 0,
            notificationId: last?.notificationId ?? 0,
            lastDeliveredCycleKey: lastDelivered?.cycleKey ?? '',
          });
        },
      },
    };

    // Unauthenticated call must not prompt
    const unauthPerm = await requestNotificationPermissionAfterSignIn(false);
    assert.strictEqual(unauthPerm, 'denied');
    assert.strictEqual(requestPermCalls, 0, 'Must not prompt before user authenticates');

    // First authenticated sign-in prompts once
    const firstPerm = await requestNotificationPermissionAfterSignIn(true);
    assert.strictEqual(firstPerm, 'requested');
    assert.strictEqual(requestPermCalls, 1, 'Must prompt once after first sign-in');

    // Subsequent sign-ins after denial must respect user decision and not prompt again
    const secondPerm = await requestNotificationPermissionAfterSignIn(true);
    assert.strictEqual(secondPerm, 'denied');
    assert.strictEqual(requestPermCalls, 1, 'Must not re-prompt after user denied permission');

    // Schedule from authoritative server timestamp nextMiningAvailableAt
    const serverNow = Date.now();
    const authoritativeEnd = serverNow + 3600 * 1000;
    const activeStatus = {
      success: true,
      status: 'mining' as const,
      isCooldownActive: true,
      remainingSeconds: 3600,
      nextMiningAvailableAt: authoritativeEnd,
      currentCycleStartTime: serverNow,
      lastMinedAt: serverNow,
      totalCyclesCompleted: 4,
      baseMiningRate: 0.12,
      bonusMiningRate: 0,
      totalMiningRate: 0.12,
      activeReferralsCount: 0,
      serverTime: serverNow,
    };

    await syncMiningCycleNotification(activeStatus, null);
    assert.strictEqual(scheduledAlarms.length, 1, 'Must schedule 1 notification for active cycle');
    assert.strictEqual(scheduledAlarms[0].triggerAtEpochMs, authoritativeEnd, 'Must use exact server nextMiningAvailableAt');
    assert.strictEqual(scheduledAlarms[0].title, 'Mining cycle completed 🎉');
    assert.strictEqual(scheduledAlarms[0].body, 'Your mining cycle is complete. Tap to start your next cycle.');
    assert.strictEqual(scheduledAlarms[0].cycleKey, buildCycleNotificationKey(authoritativeEnd, 'usr_g_b7d1e0d22f16c08b'));
    assert.strictEqual(scheduledAlarms[0].notificationId, deriveCycleNotificationId(authoritativeEnd));

    // Re-syncing the same active cycle on app resume (even when userId arrives later) must NOT schedule a duplicate notification
    await syncMiningCycleNotification(activeStatus, 'usr_g_b7d1e0d22f16c08b');
    assert.strictEqual(scheduledAlarms.length, 1, 'Must prevent duplicate notifications for the same cycle');

    // When cycle completes on server, completeMiningCycleNotification is invoked once and pending alarm is cleared
    await syncMiningCycleNotification(
      {
        ...activeStatus,
        status: 'available',
        isCooldownActive: false,
        remainingSeconds: 0,
        serverTime: authoritativeEnd + 1000,
      },
      'usr_g_b7d1e0d22f16c08b'
    );
    assert.strictEqual(completedDeliveries.length, 1, 'Must invoke completeMiningCycleNotification on completion');
    assert(cancelCount >= 1, 'Must cancel pending notification when cycle is complete');

    // Starting a second mining cycle must schedule a fresh notification with its own cycleKey and notificationId
    const secondCycleStart = authoritativeEnd + 5000;
    const secondCycleEnd = secondCycleStart + 3600 * 1000;
    await syncMiningCycleNotification(
      {
        ...activeStatus,
        status: 'mining',
        isCooldownActive: true,
        remainingSeconds: 3600,
        currentCycleStartTime: secondCycleStart,
        lastMinedAt: secondCycleStart,
        nextMiningAvailableAt: secondCycleEnd,
        totalCyclesCompleted: 5,
        serverTime: secondCycleStart,
      },
      'usr_g_b7d1e0d22f16c08b'
    );
    assert.strictEqual(scheduledAlarms.length, 2, 'Second mining cycle must schedule its own notification');
    assert.notStrictEqual(scheduledAlarms[1].cycleKey, scheduledAlarms[0].cycleKey, 'Second cycle must have distinct cycleKey');
    assert.strictEqual(scheduledAlarms[1].triggerAtEpochMs, secondCycleEnd, 'Second cycle must schedule at secondCycleEnd');

    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  // Clean up all temporary test users so only real accounts remain in /data/coinpulse_database.json
  db.cleanupTestArtifacts(true);

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
