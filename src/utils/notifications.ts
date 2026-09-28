import { MiningStatusResponse } from '../types.ts';

export const MINING_NOTIFICATION_CHANNEL_ID = 'mining';
export const MINING_NOTIFICATION_CHANNEL_NAME = 'Mining';
export const MINING_NOTIFICATION_TITLE = 'Mining cycle completed \uD83C\uDF89';
export const MINING_NOTIFICATION_BODY =
  'Your mining cycle is complete. Tap to start your next cycle.';

const NOTIF_PROMPTED_STORAGE_KEY = 'coinpulse_notification_permission_prompted_v1';
const SCHEDULED_CYCLE_STORAGE_KEY = 'coinpulse_scheduled_cycle_notif_v1';
const DELIVERED_CYCLE_STORAGE_KEY = 'coinpulse_delivered_cycle_notif_v1';

interface ScheduledCycleRecord {
  cycleKey: string;
  notificationId: number;
  triggerAtEpochMs: number;
  scheduledAtMs: number;
}

let inMemoryScheduledCycleKey: string | null = null;
let inMemoryScheduledTriggerMs = 0;
let webFallbackTimeoutId: number | null = null;

function getLocalNotificationsPlugin(): any | null {
  if (typeof window === 'undefined') return null;
  return (window as any).Capacitor?.Plugins?.LocalNotifications ?? null;
}

function getNativeBridge(): NonNullable<Window['CoinPulseNative']> | null {
  if (typeof window === 'undefined') return null;
  return window.CoinPulseNative ?? null;
}

export function buildCycleNotificationKey(
  nextMiningAvailableAt: number,
  userId?: string | null
): string {
  const normalizedEpochSec = Math.floor(Math.max(0, nextMiningAvailableAt) / 1000);
  const safeUser = (userId || 'miner').trim() || 'miner';
  return `cycle_${safeUser}_${normalizedEpochSec}`;
}

export function deriveCycleNotificationId(nextMiningAvailableAt: number): number {
  const normalizedEpochSec = Math.floor(Math.max(0, nextMiningAvailableAt) / 1000);
  return 100000 + (normalizedEpochSec % 800000);
}

function getStoredScheduledRecord(): ScheduledCycleRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SCHEDULED_CYCLE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.cycleKey === 'string' && typeof parsed.triggerAtEpochMs === 'number') {
      return parsed as ScheduledCycleRecord;
    }
  } catch {}
  return null;
}

function setStoredScheduledRecord(record: ScheduledCycleRecord | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!record) {
      localStorage.removeItem(SCHEDULED_CYCLE_STORAGE_KEY);
    } else {
      localStorage.setItem(SCHEDULED_CYCLE_STORAGE_KEY, JSON.stringify(record));
    }
  } catch {}
}

function getLastDeliveredCycleKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(DELIVERED_CYCLE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function markCycleNotificationDelivered(cycleKey: string): void {
  if (!cycleKey || typeof window === 'undefined') return;
  try {
    localStorage.setItem(DELIVERED_CYCLE_STORAGE_KEY, cycleKey);
  } catch {}
}

/**
 * Ensures the Android "Mining" notification channel exists.
 */
export async function ensureMiningNotificationChannel(): Promise<void> {
  try {
    const plugin = getLocalNotificationsPlugin();
    if (plugin && typeof plugin.createChannel === 'function') {
      await plugin.createChannel({
        id: MINING_NOTIFICATION_CHANNEL_ID,
        name: MINING_NOTIFICATION_CHANNEL_NAME,
        description: 'Notifications when your CoinPulse mining cycle completes',
        importance: 3, // IMPORTANCE_DEFAULT
        visibility: 1,
        vibration: true,
      });
    }
  } catch {}
}

/**
 * Requests Android notification permission (POST_NOTIFICATIONS on Android 13+)
 * after a user successfully signs in with Google for the first time.
 *
 * - Never requests permission before authentication.
 * - If already granted, does nothing.
 * - If previously prompted and denied, respects the user's decision and does not re-prompt.
 * - Never throws or breaks login if permission is denied.
 */
export async function requestNotificationPermissionAfterSignIn(
  isAuthenticated: boolean
): Promise<'granted' | 'denied' | 'prompt' | 'requested'> {
  if (!isAuthenticated || typeof window === 'undefined') {
    return 'denied';
  }

  try {
    await ensureMiningNotificationChannel();

    const nativeBridge = getNativeBridge();
    if (nativeBridge?.getNotificationPermissionStatus) {
      const currentStatus = nativeBridge.getNotificationPermissionStatus();
      if (currentStatus === 'granted') {
        return 'granted';
      }
      if (currentStatus === 'denied') {
        return 'denied';
      }
    }

    // Check if we already prompted on this device
    try {
      if (localStorage.getItem(NOTIF_PROMPTED_STORAGE_KEY) === '1') {
        return 'denied';
      }
    } catch {}

    // 1. Prefer Native Android Bridge (requests POST_NOTIFICATIONS once and records in SharedPreferences)
    if (nativeBridge?.requestNotificationPermissionOnce) {
      try {
        localStorage.setItem(NOTIF_PROMPTED_STORAGE_KEY, '1');
      } catch {}
      const result = nativeBridge.requestNotificationPermissionOnce();
      if (result === 'granted' || result === 'requested' || result === 'denied') {
        return result;
      }
    }

    // 2. Capacitor LocalNotifications plugin API
    const plugin = getLocalNotificationsPlugin();
    if (plugin) {
      if (typeof plugin.checkPermissions === 'function') {
        const checkRes = await plugin.checkPermissions();
        if (checkRes?.display === 'granted') {
          return 'granted';
        }
        if (checkRes?.display === 'denied') {
          try {
            localStorage.setItem(NOTIF_PROMPTED_STORAGE_KEY, '1');
          } catch {}
          return 'denied';
        }
      }

      if (typeof plugin.requestPermissions === 'function') {
        try {
          localStorage.setItem(NOTIF_PROMPTED_STORAGE_KEY, '1');
        } catch {}
        const reqRes = await plugin.requestPermissions();
        return reqRes?.display === 'granted' ? 'granted' : 'denied';
      }
    }

    // 3. Standard Web Notification API fallback (when running in desktop/mobile browser)
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        return 'granted';
      }
      if (Notification.permission === 'denied') {
        try {
          localStorage.setItem(NOTIF_PROMPTED_STORAGE_KEY, '1');
        } catch {}
        return 'denied';
      }
      try {
        localStorage.setItem(NOTIF_PROMPTED_STORAGE_KEY, '1');
      } catch {}
      const webPerm = await Notification.requestPermission();
      return webPerm === 'granted' ? 'granted' : 'denied';
    }
  } catch (err) {
    console.warn('[CoinPulse Notifications] Permission request skipped:', err);
  }

  return 'denied';
}

/**
 * Cancels any pending scheduled mining cycle notification across native Android AlarmManager,
 * Capacitor LocalNotifications, and web fallback timers.
 */
export async function cancelScheduledMiningNotification(): Promise<void> {
  inMemoryScheduledCycleKey = null;
  inMemoryScheduledTriggerMs = 0;

  if (webFallbackTimeoutId !== null && typeof window !== 'undefined') {
    window.clearTimeout(webFallbackTimeoutId);
    webFallbackTimeoutId = null;
  }

  const stored = getStoredScheduledRecord();
  setStoredScheduledRecord(null);

  try {
    const nativeBridge = getNativeBridge();
    if (nativeBridge?.cancelMiningCycleNotification) {
      nativeBridge.cancelMiningCycleNotification();
    }
  } catch {}

  try {
    const plugin = getLocalNotificationsPlugin();
    if (plugin && typeof plugin.cancel === 'function') {
      await plugin.cancel({
        notifications: [{ id: stored?.notificationId || 100101 }],
      });
    }
  } catch {}
}

/**
 * Synchronizes the local OS notification with the server's authoritative mining state.
 *
 * - Uses the server's authoritative `nextMiningAvailableAt` timestamp.
 * - Prevents duplicate notifications for the same cycle using a deterministic `cycleKey` and `notificationId`.
 * - Cancels any pending notification if the cycle has already completed or is inactive.
 */
export async function syncMiningCycleNotification(
  status: MiningStatusResponse | null,
  userId?: string | null
): Promise<void> {
  if (!status || typeof window === 'undefined') {
    return;
  }

  const authoritativeEndMs = status.nextMiningAvailableAt ?? 0;
  const serverNowMs =
    typeof status.serverTime === 'number' && status.serverTime > 0
      ? status.serverTime
      : Date.now();

  const isCycleActive =
    status.status === 'mining' &&
    status.isCooldownActive === true &&
    authoritativeEndMs > serverNowMs;

  if (!isCycleActive) {
    // Cycle is complete ('available' or 'ready') -> mark current cycle key as handled and clear pending alarms
    if (authoritativeEndMs > 0) {
      const completedKey = buildCycleNotificationKey(authoritativeEndMs, userId);
      markCycleNotificationDelivered(completedKey);
    }
    await cancelScheduledMiningNotification();
    return;
  }

  const cycleKey = buildCycleNotificationKey(authoritativeEndMs, userId);
  const notificationId = deriveCycleNotificationId(authoritativeEndMs);

  // 1. Check if this cycle's notification was already delivered
  if (getLastDeliveredCycleKey() === cycleKey) {
    return;
  }

  // 2. Check native Android SharedPreferences to see if this exact cycle is already scheduled
  const nativeBridge = getNativeBridge();
  if (nativeBridge?.getScheduledMiningCycleNotification) {
    try {
      const rawNative = nativeBridge.getScheduledMiningCycleNotification();
      if (rawNative) {
        const parsedNative = JSON.parse(rawNative);
        if (parsedNative?.lastDeliveredCycleKey === cycleKey) {
          markCycleNotificationDelivered(cycleKey);
          return;
        }
        if (
          parsedNative?.cycleKey === cycleKey &&
          Math.abs((parsedNative?.triggerAtMs ?? 0) - authoritativeEndMs) < 2000
        ) {
          inMemoryScheduledCycleKey = cycleKey;
          inMemoryScheduledTriggerMs = authoritativeEndMs;
          setStoredScheduledRecord({
            cycleKey,
            notificationId,
            triggerAtEpochMs: authoritativeEndMs,
            scheduledAtMs: Date.now(),
          });
          return;
        }
      }
    } catch {}
  }

  // 3. Check in-memory and localStorage state to avoid redundant re-scheduling
  const existingStored = getStoredScheduledRecord();
  if (
    inMemoryScheduledCycleKey === cycleKey &&
    Math.abs(inMemoryScheduledTriggerMs - authoritativeEndMs) < 2000
  ) {
    return;
  }
  if (
    existingStored &&
    existingStored.cycleKey === cycleKey &&
    Math.abs(existingStored.triggerAtEpochMs - authoritativeEndMs) < 2000 &&
    !nativeBridge?.scheduleMiningCycleNotification
  ) {
    inMemoryScheduledCycleKey = cycleKey;
    inMemoryScheduledTriggerMs = authoritativeEndMs;
    return;
  }

  await ensureMiningNotificationChannel();

  // 4. Schedule via Native Android AlarmManager bridge (guarantees delivery when app is minimized, locked, or killed)
  let scheduledNatively = false;
  if (nativeBridge?.scheduleMiningCycleNotification) {
    try {
      scheduledNatively = Boolean(
        nativeBridge.scheduleMiningCycleNotification(
          cycleKey,
          authoritativeEndMs,
          notificationId,
          MINING_NOTIFICATION_TITLE,
          MINING_NOTIFICATION_BODY
        )
      );
    } catch {}
  }

  // 5. Fallback to Capacitor LocalNotifications plugin if CoinPulseNative.scheduleMiningCycleNotification wasn't used
  if (!scheduledNatively) {
    const plugin = getLocalNotificationsPlugin();
    if (plugin && typeof plugin.schedule === 'function') {
      try {
        await plugin.schedule({
          notifications: [
            {
              id: notificationId,
              title: MINING_NOTIFICATION_TITLE,
              body: MINING_NOTIFICATION_BODY,
              channelId: MINING_NOTIFICATION_CHANNEL_ID,
              schedule: {
                at: new Date(authoritativeEndMs),
                atEpochMs: authoritativeEndMs,
                allowWhileIdle: true,
              },
              extra: {
                cycleKey,
                nextMiningAvailableAt: authoritativeEndMs,
                targetTab: 'mining',
              },
            },
          ],
        });
        scheduledNatively = true;
      } catch {}
    }
  }

  inMemoryScheduledCycleKey = cycleKey;
  inMemoryScheduledTriggerMs = authoritativeEndMs;
  setStoredScheduledRecord({
    cycleKey,
    notificationId,
    triggerAtEpochMs: authoritativeEndMs,
    scheduledAtMs: Date.now(),
  });
}
