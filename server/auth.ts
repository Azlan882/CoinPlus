import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import { User } from './types.ts';

const AUTH_SECRET = process.env.AUTH_SECRET || 'coinpulse-super-secure-production-hmac-key-2026';
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface TokenPayload {
  userId: string;
  googleId?: string;
  email?: string;
  username: string;
  picture?: string;
  referralCode?: string;
  role: 'user' | 'admin';
  baseMiningRate?: number;
  bonusMiningRate?: number;
  totalMiningRate?: number;
  iat: number;
  exp: number;
}

export interface StateCheckpointPayload {
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
  iat: number;
}

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function deriveDeterministicUserId(googleSub: string): string {
  const cleanSub = String(googleSub).trim();
  const digest = crypto.createHash('sha256').update(`coinpulse_google:${cleanSub}`).digest('hex').slice(0, 16);
  return `usr_g_${digest}`;
}

export function generateStateCheckpoint(userId: string): string | null {
  const user = db.getUserById(userId);
  if (!user) return null;
  const balance = db.getBalance(userId);
  const miningState = db.getMiningState(userId);

  const payload: StateCheckpointPayload = {
    userId: user.id,
    googleId: user.googleId,
    email: user.email,
    username: user.username,
    picture: user.picture,
    referralCode: user.referralCode,
    role: user.role,
    baseMiningRate: user.baseMiningRate,
    bonusMiningRate: user.bonusMiningRate,
    totalMiningRate: user.totalMiningRate,
    totalBalance: balance.totalBalance,
    totalMined: balance.totalMined,
    totalReferralBonus: balance.totalReferralBonus,
    lastMinedAt: miningState.lastMinedAt,
    currentCycleStartTime: miningState.currentCycleStartTime,
    nextMiningAvailableAt: miningState.nextMiningAvailableAt,
    totalCyclesCompleted: miningState.totalCyclesCompleted,
    iat: Date.now(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`ckpt:${payloadB64}`)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

export function verifyStateCheckpoint(checkpointToken: string): StateCheckpointPayload | null {
  try {
    const parts = checkpointToken.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;

    const expectedSig = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(`ckpt:${payloadB64}`)
      .digest('base64url');

    const expectedBuffer = Buffer.from(expectedSig);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length) return null;
    if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;

    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as StateCheckpointPayload;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const key = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(key);
    const hashBuffer = Buffer.from(hash, 'hex');
    if (keyBuffer.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, hashBuffer);
  } catch {
    return false;
  }
}

export function generateToken(user: User): string {
  const payload: TokenPayload = {
    userId: user.id,
    googleId: user.googleId,
    email: user.email,
    username: user.username,
    picture: user.picture,
    referralCode: user.referralCode,
    role: user.role,
    baseMiningRate: user.baseMiningRate,
    bonusMiningRate: user.bonusMiningRate,
    totalMiningRate: user.totalMiningRate,
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;

    const expectedSig = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(payloadB64)
      .digest('base64url');

    const expectedBuffer = Buffer.from(expectedSig);
    const actualBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== actualBuffer.length) return null;
    if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;

    const payload: TokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function sanitizeUser(user: User): Omit<User, 'passwordHash' | 'salt'> {
  const { passwordHash, salt, ...safeUser } = user;
  return safeUser;
}

export function extractVerifiedCheckpointFromRequest(req: Request): StateCheckpointPayload | null {
  const rawHeader = req.headers['x-coinpulse-checkpoint'];
  const headerStr = typeof rawHeader === 'string' ? rawHeader.trim() : '';
  if (headerStr) {
    const verified = verifyStateCheckpoint(headerStr);
    if (verified) return verified;
  }

  const bodyCkpt =
    req.body && typeof req.body === 'object' && typeof req.body.stateCheckpoint === 'string'
      ? req.body.stateCheckpoint.trim()
      : '';
  if (bodyCkpt) {
    const verified = verifyStateCheckpoint(bodyCkpt);
    if (verified) return verified;
  }

  const queryCkpt = typeof req.query?.ckpt === 'string' ? req.query.ckpt.trim() : '';
  if (queryCkpt) {
    const verified = verifyStateCheckpoint(queryCkpt);
    if (verified) return verified;
  }

  return null;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized: Missing bearer token' });
    return;
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired session token' });
    return;
  }

  // Check if client supplied a server-signed HMAC state checkpoint header/body/query
  const verifiedCheckpoint = extractVerifiedCheckpointFromRequest(req);

  let user = db.getUserById(payload.userId);
  if (!user && payload.googleId) {
    user = db.getUserByGoogleId(payload.googleId);
  }
  if (!user && payload.email) {
    user = db.getUserByEmail(payload.email);
  }

  if (user && payload.googleId && (user.id !== payload.userId || user.googleId !== payload.googleId)) {
    user = db.bindGoogleIdentity(user.id, payload.googleId, payload.userId, payload.picture) || user;
  } else if (user && payload.email && payload.googleId) {
    const emailRecord = db.getUserByEmail(payload.email);
    if (emailRecord && emailRecord.id !== user.id) {
      user = db.bindGoogleIdentity(emailRecord.id, payload.googleId, payload.userId, payload.picture) || user;
    }
  }

  // Reconcile from verified server-signed checkpoint if present and matches user
  if (
    verifiedCheckpoint &&
    (verifiedCheckpoint.userId === payload.userId ||
      (payload.googleId && verifiedCheckpoint.googleId === payload.googleId) ||
      (payload.email && verifiedCheckpoint.email === payload.email))
  ) {
    user = db.reconcileVerifiedCheckpoint(verifiedCheckpoint);
  } else if (!user) {
    // Self-heal user account from HMAC-verified session token if container restarted during 1h mining cooldown
    const nowIso = new Date().toISOString();
    const fallbackReferral =
      payload.referralCode ||
      payload.username.toUpperCase().slice(0, 4) +
        crypto.createHash('sha256').update(payload.userId).digest('hex').slice(0, 4).toUpperCase();
    const restoredUser: User = {
      id: payload.userId,
      googleId: payload.googleId,
      username: payload.username,
      email: payload.email || `${payload.username}@google.coinpulse.user`,
      picture: payload.picture,
      referralCode: fallbackReferral,
      referredByUserId: null,
      role: payload.role || 'user',
      status: 'active',
      baseMiningRate: payload.baseMiningRate ?? 0.12,
      bonusMiningRate: payload.bonusMiningRate ?? 0.0,
      totalMiningRate: payload.totalMiningRate ?? 0.12,
      createdAt: nowIso,
      lastLoginAt: nowIso,
      lastActiveAt: nowIso,
    };
    const created = db.createUser(restoredUser, 0.0);
    user = created.user;
  }

  if (user.status === 'suspended') {
    db.logSecurityEvent(
      'account_suspended_action',
      req.ip || 'unknown',
      'medium',
      user.id,
      { action: req.path },
      req.headers['user-agent']
    );
    res.status(403).json({ success: false, error: 'Account suspended. Contact administration.' });
    return;
  }

  // Update last active
  db.updateUser(user.id, { lastActiveAt: new Date().toISOString() });

  req.user = user;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      db.logSecurityEvent(
        'unauthorized_access',
        req.ip || 'unknown',
        'high',
        req.user?.id,
        { action: req.path, attemptedRole: 'admin' },
        req.headers['user-agent']
      );
      res.status(403).json({ success: false, error: 'Forbidden: Administrator privileges required' });
      return;
    }
    next();
  });
}
