import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { db } from './db.ts';
import {
  generateToken,
  sanitizeUser,
  requireAuth,
  requireAdmin,
  AuthenticatedRequest,
} from './auth.ts';
import {
   verifyGoogleIdToken,
  getConfiguredGoogleClientId,
  hasGoogleClientIdConfigured,
} from './googleAuth.ts';
import { processMineRequest } from './miningService.ts';
import { User, ReferralRecord } from './types.ts';

const router = Router();

// In-memory IP rate limiter for auth endpoints
const authRateLimiter = new Map<string, { count: number; resetAt: number }>();
function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = authRateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    authRateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 30) {
    return false; // Max 30 auth attempts per minute per IP
  }
  entry.count++;
  return true;
}

// -------------------------------------------------------------
// 1. AUTHENTICATION ENDPOINTS (GOOGLE ONLY)
// -------------------------------------------------------------

/**
 * Resolves the canonical HTTPS backend callback URI for Google OAuth 2.0.
 * Always maps Capacitor/localhost origins to the hosted APP_URL callback.
 */
function resolveGoogleRedirectUri(req: Request): string {
  const baseAppUrl = (
    process.env.APP_URL ||
    'https://ais-dev-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app'
  ).replace(/\/+$/, '');

  const requested = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri.trim() : '';
  if (requested) {
    try {
      const parsed = new URL(requested);
      if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.run.app')) {
        return `${parsed.origin}/auth/callback`;
      }
    } catch {
      // Fall back to baseAppUrl
    }
  }

  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader) {
    try {
      const parsedOrigin = new URL(originHeader);
      if (parsedOrigin.protocol === 'https:' && parsedOrigin.hostname.endsWith('.run.app')) {
        return `${parsedOrigin.origin}/auth/callback`;
      }
    } catch {
      // Fall back to baseAppUrl
    }
  }

  return `${baseAppUrl}/auth/callback`;
}

/**
 * Safe Google Authentication configuration status for client apps (web + Android Capacitor).
 * Reports whether GOOGLE_CLIENT_ID is configured at runtime without exposing the actual client ID.
 */
router.get('/auth/google/config', (req: Request, res: Response): void => {
  const hasGoogleClientId = hasGoogleClientIdConfigured();
  const redirectUri = resolveGoogleRedirectUri(req);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    success: true,
    configured: hasGoogleClientId,
    hasGoogleClientId,
    appUrl: process.env.APP_URL || '',
    redirectUri,
  });
});

/**
 * Server-side Google OAuth 2.0 / OpenID Connect authorization URL builder.
 * Reads GOOGLE_CLIENT_ID dynamically from the server runtime environment so the client
 * can open Google's authorization screen directly in a popup without exposing raw env vars.
 */
router.get('/auth/google/url', (req: Request, res: Response): void => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const clientId = getConfiguredGoogleClientId();
  if (!clientId) {
    res.status(400).json({
      success: false,
      configured: false,
      hasGoogleClientId: false,
      error: 'Google authentication is not configured on the server (GOOGLE_CLIENT_ID is missing).',
    });
    return;
  }

  const baseAppUrl = (
    process.env.APP_URL ||
    'https://ais-dev-syd2tyn4om2bm3ebxwejob-600047491917.asia-southeast1.run.app'
  ).replace(/\/+$/, '');
  const redirectUri = resolveGoogleRedirectUri(req);

  const referralCode = typeof req.query.ref === 'string' ? req.query.ref.trim().toUpperCase() : '';
  const origin = typeof req.query.origin === 'string' ? req.query.origin.trim() : baseAppUrl;
  const nonce = crypto.randomBytes(12).toString('hex');
  const state = JSON.stringify({
    ref: referralCode,
    origin,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });

  res.json({
    success: true,
    configured: true,
    hasGoogleClientId: true,
    redirectUri,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
});

/**
 * Disabled legacy email/password routes to strictly enforce Google-only policy
 */
router.post('/auth/register', (_req: Request, res: Response): void => {
  res.status(403).json({
    success: false,
    error: 'Email and password registration has been disabled. Please authenticate using your Google account.',
  });
});

router.post('/auth/login', (_req: Request, res: Response): void => {
  res.status(403).json({
    success: false,
    error: 'Email and password login has been disabled. Please authenticate using your Google account.',
  });
});

/**
 * Google Sign-In & Account Creation Endpoint
 * Verifies the Google Identity Token (OIDC) or OAuth access token with Google.
 * Uses Google 'sub' (subject) as the permanent, immutable unique identifier.
 * Automatically links or provisions new CoinPulse miner accounts while preserving referrals.
 */
router.post('/auth/google', async (req: Request, res: Response): Promise<void> => {
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  if (!checkAuthRateLimit(clientIp)) {
    res.status(429).json({ success: false, error: 'Too many authentication attempts. Please wait a minute.' });
    return;
  }

  const { token: googleToken, referralCode } = req.body || {};

  if (!googleToken || typeof googleToken !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Google authentication credential is required.',
    });
    return;
  }

  try {
    // Cryptographically verify Google identity token
    const googleProfile = await verifyGoogleIdToken(googleToken.trim());
    const googleSub = googleProfile.sub;
    const googleEmail = googleProfile.email.toLowerCase().trim();

    // 1. Check if user already exists by persistent Google Subject ID (Preferred stable ID)
    let user = db.getUserByGoogleId(googleSub);

    // 2. If not found by googleId, check by email to gracefully link existing miners
    if (!user) {
      user = db.getUserByEmail(googleEmail);
      if (user) {
        // Link Google ID to existing account
        db.updateUser(user.id, {
          googleId: googleSub,
          picture: googleProfile.picture || user.picture,
          lastLoginAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        });
        user = db.getUserById(user.id)!;
      }
    }

    let isNewUser = false;

    // 3. If still not found, automatically provision a brand new CoinPulse account
    if (!user) {
      isNewUser = true;

      // Handle referral code validation if provided
      let inviterUserId: string | null = null;
      if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
        const codeClean = referralCode.trim().toUpperCase();
        const inviter = db.getUserByReferralCode(codeClean);
        if (inviter) {
          inviterUserId = inviter.id;
        }
      }

      // Generate base username from Google profile or email
      let baseUsername = '';
      if (googleProfile.name) {
        baseUsername = googleProfile.name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14);
      }
      if (!baseUsername || baseUsername.length < 3) {
        baseUsername = googleEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14);
      }
      if (baseUsername.length < 3) {
        baseUsername = `miner_${crypto.randomBytes(3).toString('hex')}`;
      }

      // Ensure uniqueness
      let candidateUsername = baseUsername;
      let counter = 1;
      while (db.getUserByUsername(candidateUsername)) {
        candidateUsername = `${baseUsername.slice(0, 10)}_${Math.floor(100 + Math.random() * 900)}`;
        counter++;
        if (counter > 10) {
          candidateUsername = `miner_${crypto.randomBytes(4).toString('hex')}`;
          break;
        }
      }

      const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
      const generatedReferralCode =
        candidateUsername.toUpperCase().slice(0, 4) + crypto.randomBytes(2).toString('hex').toUpperCase();

      const newUser: User = {
        id: userId,
        googleId: googleSub,
        username: candidateUsername,
        email: googleEmail,
        picture: googleProfile.picture,
        referralCode: generatedReferralCode,
        referredByUserId: inviterUserId,
        role: 'user',
        status: 'active',
        baseMiningRate: 0.12,
        bonusMiningRate: 0.0,
        totalMiningRate: 0.12,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        registrationIp: clientIp,
      };

      const creationResult = db.createUser(newUser, 0.0);
      user = creationResult.user;

      // If referred by another miner, register pending referral record
      if (inviterUserId && inviterUserId !== userId) {
        const referralRecord: ReferralRecord = {
          id: `ref_${Date.now()}_${userId.slice(-6)}`,
          inviterUserId,
          referredUserId: userId,
          referralCodeUsed: referralCode.trim().toUpperCase(),
          status: 'pending',
          firstMiningCompletedAt: null,
          rateBonusApplied: 0.01,
          createdAt: new Date().toISOString(),
        };
        db.createReferral(referralRecord);
      }
    } else {
      // Existing user login
      if (user.status === 'suspended') {
        db.logSecurityEvent('account_suspended_action', clientIp, 'medium', user.id, { action: 'google_login' }, req.headers['user-agent']);
        res.status(403).json({ success: false, error: 'Your account has been suspended by administration.' });
        return;
      }

      db.updateUser(user.id, {
        googleId: googleSub,
        picture: googleProfile.picture || user.picture,
        lastLoginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      });
      user = db.getUserById(user.id)!;
    }

    const token = generateToken(user);
    const balance = db.getBalance(user.id);
    const miningState = db.getMiningState(user.id);

    res.json({
      success: true,
      token,
      user: sanitizeUser(user),
      balance,
      miningState,
      isNewUser,
      serverTime: Date.now(),
      message: isNewUser
        ? 'Account successfully created with Google! Welcome to CoinPulse.'
        : 'Welcome back! Signed in with Google.',
    });
  } catch (err: any) {
    console.error('[GoogleAuth] Verification failed:', err.message);
    db.logSecurityEvent('invalid_credentials', clientIp, 'low', undefined, { error: err.message }, req.headers['user-agent']);
    res.status(401).json({
      success: false,
      error: `Google verification failed: ${err.message || 'Invalid Google credential'}`,
    });
  }
});

router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  const user = req.user!;
  const freshUser = db.getUserById(user.id) || user;
  const balance = db.getBalance(user.id);
  const miningState = db.getMiningState(user.id);
  const referrals = db.getReferralsByInviter(user.id);
  const rateHistory = db.getRateHistory(user.id);

  res.json({
    success: true,
    user: sanitizeUser(freshUser),
    balance,
    miningState,
    referralStats: {
      totalReferrals: referrals.length,
      activatedReferrals: referrals.filter((r) => r.status === 'activated').length,
      pendingReferrals: referrals.filter((r) => r.status === 'pending').length,
    },
    rateHistory,
    serverTime: Date.now(),
  });
});

// -------------------------------------------------------------
// 2. MINING ENGINE ENDPOINTS
// -------------------------------------------------------------

router.post('/mine', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = (req.headers['user-agent'] as string) || '';

  const result = await processMineRequest(user, clientIp, userAgent);

  if (!result.success) {
    res.status(result.status).json({
      success: false,
      error: result.error,
      remainingSeconds: result.remainingSeconds,
    });
    return;
  }

  res.status(200).json({
    success: true,
    ...result.data,
    serverTime: Date.now(),
  });
});

router.get('/mining/status', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  const user = db.getUserById(req.user!.id) || req.user!;
  const miningState = db.getMiningState(user.id);
  const now = Date.now();

  const isCooldownActive = miningState.nextMiningAvailableAt > 0 && now < miningState.nextMiningAvailableAt;
  const remainingMs = isCooldownActive ? Math.max(0, miningState.nextMiningAvailableAt - now) : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  // Status computation:
  // - "ready": No active mining session, user can mine immediately
  // - "mining": Cooldown is active, 1-hour cycle is underway
  // - "available": Cycle has finished, user can trigger the next mining reward
  let cycleStatus: 'ready' | 'mining' | 'available' = 'ready';
  if (miningState.lastMinedAt === null) {
    cycleStatus = 'ready';
  } else if (isCooldownActive) {
    cycleStatus = 'mining';
  } else {
    cycleStatus = 'available';
  }

  const referrals = db.getReferralsByInviter(user.id);
  const activeReferralsCount = referrals.filter((r) => r.status === 'activated').length;

  res.json({
    success: true,
    status: cycleStatus,
    isCooldownActive,
    remainingSeconds,
    nextMiningAvailableAt: miningState.nextMiningAvailableAt,
    currentCycleStartTime: miningState.currentCycleStartTime,
    lastMinedAt: miningState.lastMinedAt,
    totalCyclesCompleted: miningState.totalCyclesCompleted,
    baseMiningRate: user.baseMiningRate,
    bonusMiningRate: user.bonusMiningRate,
    totalMiningRate: user.totalMiningRate,
    activeReferralsCount,
    serverTime: now,
  });
});

// -------------------------------------------------------------
// 3. BALANCE & LEDGER ENDPOINTS
// -------------------------------------------------------------

router.get('/balance', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  const balance = db.getBalance(req.user!.id);
  const integrity = db.verifyBalanceIntegrity(req.user!.id);

  res.json({
    success: true,
    balance: balance.totalBalance,
    totalMined: balance.totalMined,
    totalReferralBonus: balance.totalReferralBonus,
    lastCalculatedAt: balance.lastCalculatedAt,
    integrityVerified: integrity.isValid,
  });
});

router.get('/balance/verify', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  const integrity = db.verifyBalanceIntegrity(req.user!.id);
  const transactions = db.getTransactions(req.user!.id, 100);

  res.json({
    success: true,
    isTamperFree: integrity.isValid,
    recordedBalance: integrity.recorded,
    ledgerReconciledBalance: integrity.expected,
    transactionCount: transactions.length,
    timestamp: new Date().toISOString(),
  });
});

router.get('/transactions', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const txs = db.getTransactions(req.user!.id, limit);

  res.json({
    success: true,
    transactions: txs,
  });
});

// -------------------------------------------------------------
// 4. REFERRAL SYSTEM ENDPOINTS
// -------------------------------------------------------------

router.get('/referrals', requireAuth, (req: AuthenticatedRequest, res: Response): void => {
  const user = req.user!;
  const rawReferrals = db.getReferralsByInviter(user.id);

  // Map to friendly format without exposing sensitive referred user details
  const referrals = rawReferrals.map((r) => {
    const referredUser = db.getUserById(r.referredUserId);
    const miningState = db.getMiningState(r.referredUserId);
    return {
      id: r.id,
      username: referredUser ? referredUser.username : 'Unknown',
      status: r.status, // 'pending' | 'activated'
      joinedAt: r.createdAt,
      firstMiningCompletedAt: r.firstMiningCompletedAt,
      isCurrentlyMining: miningState.isMiningActive && Date.now() < miningState.nextMiningAvailableAt,
      bonusAwarded: r.status === 'activated' ? r.rateBonusApplied : 0,
    };
  });

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const inviteLink = `${appUrl}/?ref=${user.referralCode}`;

  res.json({
    success: true,
    referralCode: user.referralCode,
    inviteLink,
    baseBonusPerReferral: 0.01,
    activeBonusRate: user.bonusMiningRate,
    totalReferrals: referrals.length,
    activatedReferrals: referrals.filter((r) => r.status === 'activated').length,
    pendingReferrals: referrals.filter((r) => r.status === 'pending').length,
    referrals,
  });
});

// -------------------------------------------------------------
// 5. BLOCKCHAIN READINESS & ARCHITECTURE SPECIFICATION
// -------------------------------------------------------------

router.get('/blockchain/info', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    disclaimer: {
      status: 'INTERNAL_MINING_POINTS',
      isCryptocurrencyNow: false,
      hasMonetaryValue: false,
      notice:
        'CoinPulse coins are currently internal computational participation points. They are not a tradable cryptocurrency and cannot be redeemed for fiat currency.',
    },
    migrationBlueprint: {
      targetNetwork: 'Polygon PoS / Base L2 (EVM Compatible)',
      tokenStandard: 'ERC-20 with Capped Supply, Burnable, and Pausable extensions',
      ticker: 'CPULSE',
      decimals: 18,
      distributionModel: {
        method: 'Merkle-Tree Cryptographic Proof or EIP-712 Signed Vouchers',
        reason:
          'Allows users to claim their mined balance directly on-chain without the server paying expensive batch gas fees. Sybil resistance enforced through KYC & device attestation prior to root generation.',
      },
      securityRequirements: [
        'Multi-signature smart contract ownership (Gnosis Safe 3-of-5)',
        'Full CertiK or OpenZeppelin smart contract audit before deployment',
        'Strict Sybil & duplicate account filtering prior to snapshot finalization',
        'Proof-of-Authority KYC verification phase before mainnet claims',
      ],
      roadmapPhases: [
        {
          phase: 1,
          name: 'Phase 1: Proof-of-Engagement Network (Current)',
          description:
            'Internal server-authoritative hourly mining, referral verification, and ecosystem building.',
        },
        {
          phase: 2,
          name: 'Phase 2: Enclosed Testnet & Web3 Wallet Binding',
          description:
            'Integration of non-custodial EVM wallets (MetaMask, WalletConnect) and testnet sandbox distribution.',
        },
        {
          phase: 3,
          name: 'Phase 3: Mainnet Token Generation Event (TGE)',
          description:
            'On-chain contract deployment, snapshot conversion, and decentralized DEX liquidity bootstrapping.',
        },
      ],
    },
  });
});

// -------------------------------------------------------------
// 6. ADMINISTRATOR SYSTEM (RBAC)
// -------------------------------------------------------------

router.get('/admin/stats', requireAdmin, (_req: AuthenticatedRequest, res: Response): void => {
  const stats = db.getSystemStats();
  res.json({
    success: true,
    stats,
  });
});

router.get('/admin/users', requireAdmin, (req: AuthenticatedRequest, res: Response): void => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const allUsers = db.getAllUsers();

  const filtered = allUsers.filter((u) => {
    if (!query) return true;
    return (
      u.username.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query) ||
      u.referralCode.toLowerCase().includes(query) ||
      u.id.toLowerCase().includes(query)
    );
  });

  const detailedUsers = filtered.map((u) => {
    const balance = db.getBalance(u.id);
    const miningState = db.getMiningState(u.id);
    const referrals = db.getReferralsByInviter(u.id);
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      status: u.status,
      totalBalance: balance.totalBalance,
      totalMined: balance.totalMined,
      totalMiningRate: u.totalMiningRate,
      bonusMiningRate: u.bonusMiningRate,
      referralCode: u.referralCode,
      referredByUserId: u.referredByUserId,
      totalReferrals: referrals.length,
      activatedReferrals: referrals.filter((r) => r.status === 'activated').length,
      lastLoginAt: u.lastLoginAt,
      lastActiveAt: u.lastActiveAt,
      createdAt: u.createdAt,
      isCurrentlyMining: miningState.isMiningActive && Date.now() < miningState.nextMiningAvailableAt,
    };
  });

  res.json({
    success: true,
    total: detailedUsers.length,
    users: detailedUsers,
  });
});

router.patch('/admin/users/:id/status', requireAdmin, (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const { status, reason } = req.body || {};

  if (status !== 'active' && status !== 'suspended') {
    res.status(400).json({ success: false, error: 'Status must be active or suspended' });
    return;
  }

  const targetUser = db.getUserById(id);
  if (!targetUser) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  if (targetUser.role === 'admin' && targetUser.id === req.user!.id) {
    res.status(400).json({ success: false, error: 'Cannot change your own administrator status.' });
    return;
  }

  const updated = db.updateUser(id, { status });

  db.logSecurityEvent(
    'account_suspended_action',
    req.ip || '127.0.0.1',
    'high',
    id,
    {
      action: `Status changed to ${status}`,
      adminId: req.user!.id,
      reason: reason || 'Admin action',
    },
    req.headers['user-agent']
  );

  res.json({
    success: true,
    user: updated ? sanitizeUser(updated) : null,
    message: `User account has been ${status === 'active' ? 'reactivated' : 'suspended'}.`,
  });
});

router.post('/admin/users/:id/adjust', requireAdmin, (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const { amount, reason } = req.body || {};

  const delta = parseFloat(amount);
  if (isNaN(delta) || delta === 0) {
    res.status(400).json({ success: false, error: 'A non-zero numeric amount is required' });
    return;
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    res.status(400).json({ success: false, error: 'A mandatory audit reason (minimum 5 chars) is required for manual balance adjustments' });
    return;
  }

  const targetUser = db.getUserById(id);
  if (!targetUser) {
    res.status(404).json({ success: false, error: 'Target user not found' });
    return;
  }

  const { balance, transaction } = db.addBalanceTransaction(
    id,
    delta,
    'admin_adjustment',
    `Manual adjustment by Admin (${req.user!.username}): ${reason.trim()}`,
    `adj_${Date.now()}`
  );

  db.logSecurityEvent(
    'unauthorized_access',
    req.ip || '127.0.0.1',
    'medium',
    id,
    {
      type: 'balance_adjustment',
      delta,
      adminId: req.user!.id,
      reason,
      newBalance: balance.totalBalance,
    },
    req.headers['user-agent']
  );

  res.json({
    success: true,
    balance,
    transaction,
    message: `Account balance adjusted by ${delta > 0 ? '+' : ''}${delta.toFixed(4)} CP.`,
  });
});

router.get('/admin/security-events', requireAdmin, (req: AuthenticatedRequest, res: Response): void => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
  const events = db.getSecurityEvents(limit);

  res.json({
    success: true,
    events,
  });
});

// -------------------------------------------------------------
// 7. API DOCUMENTATION ENDPOINT
// -------------------------------------------------------------

router.get('/docs', (_req: Request, res: Response): void => {
  res.json({
    title: 'CoinPulse Production API Specification',
    version: '1.0.0',
    baseUrl: '/api',
    authScheme: 'Bearer <token> (HMAC-SHA256 stateless cryptographic token)',
    endpoints: [
      {
        path: '/api/auth/register',
        method: 'POST',
        authRequired: false,
        description: 'Registers a new user account. Validates uniqueness, hashes password with scrypt.',
        body: { username: 'string (3-20 chars)', email: 'string (valid email)', password: 'string (min 6 chars)', referralCode: 'string (optional)' },
      },
      {
        path: '/api/auth/login',
        method: 'POST',
        authRequired: false,
        description: 'Authenticates user with username/email and password.',
        body: { identifier: 'string', password: 'string' },
      },
      {
        path: '/api/auth/me',
        method: 'GET',
        authRequired: true,
        description: 'Returns profile, current rate, balance, and referral stats for authenticated user.',
      },
      {
        path: '/api/mine',
        method: 'POST',
        authRequired: true,
        description:
          'Authoritative mining action. Validates 1-hour cooldown server-side, credits hourly rate, locks against concurrent double clicks, and auto-activates referrals upon first successful cycle.',
      },
      {
        path: '/api/mining/status',
        method: 'GET',
        authRequired: true,
        description: 'Returns real-time server timestamp, cooldown remaining seconds, current rate, and cycle status.',
      },
      {
        path: '/api/balance',
        method: 'GET',
        authRequired: true,
        description: 'Fetches verified server-side balance with integrity verification checksum.',
      },
      {
        path: '/api/balance/verify',
        method: 'GET',
        authRequired: true,
        description: 'Cryptographically reconciles all past transaction ledger items against stored balance.',
      },
      {
        path: '/api/referrals',
        method: 'GET',
        authRequired: true,
        description: 'Fetches user referral code, invite link, and breakdown of pending vs activated referees.',
      },
      {
        path: '/api/transactions',
        method: 'GET',
        authRequired: true,
        description: 'Returns paginated immutable transaction ledger records.',
      },
      {
        path: '/api/blockchain/info',
        method: 'GET',
        authRequired: false,
        description: 'Returns tokenomics, disclaimers, and L2 migration roadmap specifications.',
      },
      {
        path: '/api/admin/stats',
        method: 'GET',
        authRequired: true,
        adminOnly: true,
        description: 'Returns global metrics: active users, mined total, referrals, sessions, and security count.',
      },
      {
        path: '/api/admin/users',
        method: 'GET',
        authRequired: true,
        adminOnly: true,
        description: 'Lists all users with mining rates, balances, referral status, and activity dates.',
      },
      {
        path: '/api/admin/users/:id/status',
        method: 'PATCH',
        authRequired: true,
        adminOnly: true,
        description: 'Suspends or reactivates a user account.',
      },
      {
        path: '/api/admin/users/:id/adjust',
        method: 'POST',
        authRequired: true,
        adminOnly: true,
        description: 'Performs an audited balance adjustment with mandatory reason.',
      },
      {
        path: '/api/admin/security-events',
        method: 'GET',
        authRequired: true,
        adminOnly: true,
        description: 'Returns recent security events (tampering attempts, cooldown violations, double clicks).',
      },
    ],
  });
});

export default router;
