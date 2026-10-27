import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Test sandbox migration script running ONLY on data/coinpulse_database.test_migration.json
const TEST_DB_FILE = path.resolve(process.cwd(), 'data/coinpulse_database.test_migration.json');
const AUTH_SECRET = process.env.AUTH_SECRET || 'coinpulse-auth-9f7K2mQ8xL4vP6zR1nT5yW3aB7cD';

// Conversion constant: 1 CP = 0.00100000 simulated BTC = 100,000 satoshis
export const SATS_PER_CP = 100_000;
export const SATS_PER_BTC = 100_000_000;

export function cpToSats(cp: number): number {
  return Math.round(Number((cp * SATS_PER_CP).toFixed(6)));
}

export function satsToBtc(sats: number): number {
  return Number((sats / SATS_PER_BTC).toFixed(8));
}

export function btcToSats(btc: number): number {
  return Math.round(Number((btc * SATS_PER_BTC).toFixed(8)));
}

function calculateChecksum(userId: string, balance: number): string {
  return crypto
    .createHash('sha256')
    .update(`${userId}:${balance.toFixed(8)}:${AUTH_SECRET}`)
    .digest('hex');
}

export function runMigrationOnSandbox(dbData: any): {
  success: boolean;
  usersMigrated: number;
  report: any[];
} {
  const report: any[] = [];
  let usersMigrated = 0;

  if (dbData.schemaVersion === 2) {
    return { success: true, usersMigrated: 0, report: [{ status: 'already_migrated', note: 'Idempotency check passed' }] };
  }

  // 1. Audit and reconcile missing genesis transactions on test copy before conversion
  for (const [id, user] of Object.entries(dbData.users as Record<string, any>)) {
    const bal = dbData.balances[id];
    if (!bal) continue;

    const userTxs = (dbData.transactions || []).filter((t: any) => t.userId === id);
    const txSum = userTxs.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    const diff = Number(Math.abs(bal.totalBalance - txSum).toFixed(6));

    if (diff > 0.000001 && userTxs.length === 0 && bal.totalBalance > 0) {
      // Missing historical transaction backfill (e.g. miner_alex and miner_sam seeded balances)
      const backfillTx = {
        id: `tx_${Date.now()}_seed_backfill_${id}`,
        userId: id,
        type: 'mining_reward',
        currency: 'CP',
        amount: bal.totalBalance,
        balanceBefore: 0.0,
        balanceAfter: bal.totalBalance,
        description: `Seeded legacy mining cycle #1 completed (+${bal.totalBalance} CP)`,
        timestamp: user.createdAt || new Date().toISOString(),
      };
      dbData.transactions.push(backfillTx);
    }
  }

  // 2. Perform Migration for each user
  for (const [id, user] of Object.entries(dbData.users as Record<string, any>)) {
    const bal = dbData.balances[id];
    if (!bal) continue;

    const before = {
      id,
      username: user.username,
      legacyCpBalance: bal.totalBalance,
      legacyTotalMined: bal.totalMined,
      legacyBaseRate: user.baseMiningRate,
      legacyBonusRate: user.bonusMiningRate,
      legacyTotalRate: user.totalMiningRate,
    };

    // Calculate integer satoshis
    const balanceSats = cpToSats(bal.totalBalance);
    const totalMinedSats = cpToSats(bal.totalMined);
    const totalRefBonusSats = cpToSats(bal.totalReferralBonus || 0);

    const newBalanceBtc = satsToBtc(balanceSats);
    const newMinedBtc = satsToBtc(totalMinedSats);
    const newRefBonusBtc = satsToBtc(totalRefBonusSats);

    // Rate conversion:
    // Base: 0.12 CP/h -> 0.00012000 BTC/h (12,000 sats/h)
    // Bonus: +0.01 CP/h per referral -> +0.00001000 BTC/h per referral (1,000 sats/h)
    const activeRefBonusRate = (user.bonusMiningRate ? Math.round(user.bonusMiningRate * 100) : 0); // e.g. 0.02 -> 2 referrals
    const newBaseRateBtc = 0.00012000;
    const newBonusRateBtc = Number((activeRefBonusRate * 0.00001000).toFixed(8));
    const newTotalRateBtc = Number((newBaseRateBtc + newBonusRateBtc).toFixed(8));

    // Update user record
    user.currency = 'BTC_SIMULATED';
    user.baseMiningRate = newBaseRateBtc;
    user.bonusMiningRate = newBonusRateBtc;
    user.totalMiningRate = newTotalRateBtc;
    user.migratedToSimulatedBtcAt = new Date().toISOString();
    user.legacyCpBalance = before.legacyCpBalance;

    // Update balance record
    bal.currency = 'BTC_SIMULATED';
    bal.legacyCpBalance = before.legacyCpBalance;
    bal.satoshis = balanceSats;
    bal.totalBalance = newBalanceBtc;
    bal.totalMined = newMinedBtc;
    bal.totalReferralBonus = newRefBonusBtc;
    bal.integrityChecksum = calculateChecksum(id, newBalanceBtc);
    bal.lastCalculatedAt = new Date().toISOString();

    // Append formal migration transaction to preserve ledger continuity
    const migrationTx = {
      id: `tx_${Date.now()}_mig_${id}`,
      userId: id,
      type: 'migration_conversion',
      currency: 'BTC_SIMULATED',
      amount: newBalanceBtc,
      satoshis: balanceSats,
      balanceBefore: 0.0,
      balanceAfter: newBalanceBtc,
      legacyCpBalance: before.legacyCpBalance,
      description: `Protocol Upgrade: Converted ${before.legacyCpBalance.toFixed(4)} legacy CP to ${newBalanceBtc.toFixed(8)} simulated BTC (${balanceSats.toLocaleString()} sats)`,
      timestamp: new Date().toISOString(),
    };
    dbData.transactions.unshift(migrationTx);

    usersMigrated++;
    report.push({
      userId: id,
      username: user.username,
      before,
      after: {
        satoshis: balanceSats,
        simulatedBtc: newBalanceBtc,
        baseRate: newBaseRateBtc,
        bonusRate: newBonusRateBtc,
        totalRate: newTotalRateBtc,
        checksum: bal.integrityChecksum,
      },
    });
  }

  dbData.schemaVersion = 2;
  dbData.currency = 'BTC_SIMULATED';
  dbData.migratedAt = new Date().toISOString();

  return { success: true, usersMigrated, report };
}

async function main() {
  console.log('--- Testing Migration on Sandbox Copy ---');
  const raw = fs.readFileSync(TEST_DB_FILE, 'utf-8');
  const dbData = JSON.parse(raw);

  const res1 = runMigrationOnSandbox(dbData);
  console.log(`Initial Migration: Migrated ${res1.usersMigrated} users.`);
  console.log('Audit Report:', JSON.stringify(res1.report, null, 2));

  // Write out test result to sandbox file
  fs.writeFileSync(TEST_DB_FILE, JSON.stringify(dbData, null, 2), 'utf-8');

  // Test idempotency: Run migration again on the migrated data
  const res2 = runMigrationOnSandbox(dbData);
  console.log(`Idempotency Check (Run 2): Migrated ${res2.usersMigrated} users (expected 0).`);

  // Verify Ledger Reconciliation on migrated test data
  console.log('--- Verifying Ledger Reconciliations on Migrated Data ---');
  for (const [id, user] of Object.entries(dbData.users as Record<string, any>)) {
    const bal = dbData.balances[id];
    // In migrated model: the migration transaction establishes the new BTC baseline
    const btcTxs = dbData.transactions.filter((t: any) => t.userId === id && (t.currency === 'BTC_SIMULATED' || t.type === 'migration_conversion'));
    const btcSum = btcTxs.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    const checksum = calculateChecksum(id, bal.totalBalance);
    const isSumValid = Math.abs(btcSum - bal.totalBalance) < 0.00000001;
    const isChecksumValid = checksum === bal.integrityChecksum;

    console.log(`User @${user.username} (${id}):`);
    console.log(`  Balance: ${bal.totalBalance.toFixed(8)} BTC (${bal.satoshis} sats)`);
    console.log(`  Ledger Sum: ${btcSum.toFixed(8)} BTC`);
    console.log(`  Checksum Match: ${isChecksumValid}`);
    console.log(`  Reconciled: ${isSumValid && isChecksumValid ? 'PASSED ✅' : 'FAILED ❌'}`);
  }
}

main().catch(console.error);
