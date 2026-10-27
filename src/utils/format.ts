/**
 * Safe currency and unit formatting utility for CoinPulse.
 * Handles both Simulated BTC (8 decimal places, satoshis) and legacy CP (4 decimal places).
 */

export function isBtcDenominated(currency?: string, amount?: number | null): boolean {
  if (currency === 'BTC_SIMULATED' || currency === 'BTC') return true;
  if (typeof amount === 'number' && amount > 0 && amount < 0.01) return true;
  return false;
}

export function formatBalance(amount?: number | null, currency?: string): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '0.0000';
  if (isBtcDenominated(currency, amount)) {
    return amount.toFixed(8);
  }
  return amount.toFixed(4);
}

export function formatRate(rate?: number | null, currency?: string): string {
  if (rate === undefined || rate === null || isNaN(rate)) {
    return isBtcDenominated(currency) ? '0.00012000' : '0.1200';
  }
  if (isBtcDenominated(currency, rate)) {
    return rate.toFixed(8);
  }
  return rate.toFixed(4);
}

export function getCurrencyUnit(currency?: string, amount?: number | null): string {
  if (isBtcDenominated(currency, amount)) {
    return 'Simulated BTC';
  }
  return 'CP';
}

export function getCurrencyShortUnit(currency?: string, amount?: number | null): string {
  if (isBtcDenominated(currency, amount)) {
    return 'BTC';
  }
  return 'CP';
}

export function getCurrencySymbol(currency?: string, amount?: number | null): string {
  if (isBtcDenominated(currency, amount)) {
    return '₿';
  }
  return '⚡';
}

export function formatSatoshis(amount?: number | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '0';
  const sats = Math.round(amount * 100_000_000);
  return sats.toLocaleString();
}
