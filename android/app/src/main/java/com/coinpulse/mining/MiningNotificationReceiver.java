package com.coinpulse.mining;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class MiningNotificationReceiver extends BroadcastReceiver {

    public static final String TAG = "CoinPulseNotif";

    public static final String ACTION_MINING_CYCLE_COMPLETED =
        "com.coinpulse.mining.ACTION_MINING_CYCLE_COMPLETED";
    public static final String CHANNEL_ID = "mining_cycle_complete";
    public static final String LEGACY_CHANNEL_ID = "mining";
    public static final String CHANNEL_NAME = "Mining Cycle Alerts";
    public static final String CHANNEL_DESCRIPTION =
        "Notifications when your CoinPulse mining cycle completes";

    public static final String PREFS_NAME = "CoinPulseAuthPrefs";
    public static final String KEY_SCHEDULED_CYCLE_KEY = "coinpulse_scheduled_cycle_key";
    public static final String KEY_SCHEDULED_TRIGGER_AT = "coinpulse_scheduled_trigger_at";
    public static final String KEY_SCHEDULED_NOTIF_ID = "coinpulse_scheduled_notif_id";
    public static final String KEY_SCHEDULED_TITLE = "coinpulse_scheduled_title";
    public static final String KEY_SCHEDULED_BODY = "coinpulse_scheduled_body";
    public static final String KEY_LAST_DELIVERED_CYCLE_KEY = "coinpulse_last_delivered_cycle_key";

    public static final String DEFAULT_TITLE = "Mining cycle completed \uD83C\uDF89";
    public static final String DEFAULT_BODY =
        "Your mining cycle is complete. Tap to start your next cycle.";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        PowerManager.WakeLock wakeLock = null;
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "com.coinpulse.mining:MiningNotifWakeLock"
                );
                wakeLock.acquire(10_000L);
            }
        } catch (Exception ignored) {
        }

        try {
            final String action = intent.getAction();
            Log.i(TAG, "onReceive action=" + action);

            if (
                Intent.ACTION_BOOT_COMPLETED.equals(action) ||
                Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ||
                "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
                "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)
            ) {
                rescheduleAfterBoot(context);
                return;
            }

            if (!ACTION_MINING_CYCLE_COMPLETED.equals(action)) {
                return;
            }

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String scheduledCycleKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
            long scheduledTriggerAt = prefs.getLong(KEY_SCHEDULED_TRIGGER_AT, 0L);
            String lastDeliveredCycleKey = prefs.getString(KEY_LAST_DELIVERED_CYCLE_KEY, "");

            String intentCycleKey = intent.getStringExtra("cycle_key");
            long intentTriggerAt = intent.getLongExtra("trigger_at_ms", 0L);

            String effectiveCycleKey = (intentCycleKey != null && !intentCycleKey.isEmpty())
                ? intentCycleKey
                : scheduledCycleKey;
            long effectiveTriggerAt = intentTriggerAt > 0L ? intentTriggerAt : scheduledTriggerAt;

            Log.i(
                TAG,
                "Alarm fired: intentCycleKey=" + intentCycleKey +
                " scheduledCycleKey=" + scheduledCycleKey +
                " lastDeliveredCycleKey=" + lastDeliveredCycleKey +
                " effectiveTriggerAt=" + effectiveTriggerAt
            );

            // 1. Prevent duplicate delivery for the exact same cycle
            if (
                effectiveCycleKey != null &&
                !effectiveCycleKey.isEmpty() &&
                effectiveCycleKey.equals(lastDeliveredCycleKey)
            ) {
                Log.i(TAG, "Skipping duplicate notification for already-delivered cycleKey=" + effectiveCycleKey);
                clearScheduledState(prefs);
                return;
            }

            // 2. If a newer cycle was explicitly scheduled over an older cycle, ignore the stale intent
            if (
                scheduledCycleKey != null &&
                !scheduledCycleKey.isEmpty() &&
                intentCycleKey != null &&
                !intentCycleKey.isEmpty() &&
                !intentCycleKey.equals(scheduledCycleKey)
            ) {
                Log.i(
                    TAG,
                    "Ignoring stale alarm for intentCycleKey=" + intentCycleKey +
                    " (current scheduledCycleKey=" + scheduledCycleKey + ")"
                );
                return;
            }

            int notificationId = intent.getIntExtra(
                "notification_id",
                prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 100101)
            );
            String title = intent.getStringExtra("title");
            if (title == null || title.trim().isEmpty()) {
                title = prefs.getString(KEY_SCHEDULED_TITLE, DEFAULT_TITLE);
            }
            String body = intent.getStringExtra("body");
            if (body == null || body.trim().isEmpty()) {
                body = prefs.getString(KEY_SCHEDULED_BODY, DEFAULT_BODY);
            }

            String deliveredKeyToRecord = (effectiveCycleKey != null && !effectiveCycleKey.isEmpty())
                ? effectiveCycleKey
                : ("cycle_" + notificationId);

            synchronized (MiningNotificationReceiver.class) {
                String latestDelivered = prefs.getString(KEY_LAST_DELIVERED_CYCLE_KEY, "");
                if (deliveredKeyToRecord.equals(latestDelivered)) {
                    Log.i(TAG, "Skipping duplicate notification inside lock for cycleKey=" + deliveredKeyToRecord);
                    clearScheduledState(prefs);
                    return;
                }
                // Mark cycle notification as delivered and clear pending alarm state synchronously
                prefs.edit()
                    .putString(KEY_LAST_DELIVERED_CYCLE_KEY, deliveredKeyToRecord)
                    .remove(KEY_SCHEDULED_CYCLE_KEY)
                    .remove(KEY_SCHEDULED_TRIGGER_AT)
                    .remove(KEY_SCHEDULED_NOTIF_ID)
                    .commit();
            }

            showCycleCompletedNotification(
                context,
                notificationId,
                deliveredKeyToRecord,
                effectiveTriggerAt,
                title,
                body
            );
        } finally {
            if (wakeLock != null) {
                try {
                    if (wakeLock.isHeld()) {
                        wakeLock.release();
                    }
                } catch (Exception ignored) {
                }
            }
        }
    }

    public static void ensureNotificationChannel(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        try {
            NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                return;
            }

            NotificationChannel primaryChannel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            primaryChannel.setDescription(CHANNEL_DESCRIPTION);
            primaryChannel.enableVibration(true);
            primaryChannel.enableLights(true);
            primaryChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(primaryChannel);

            NotificationChannel legacyChannel = new NotificationChannel(
                LEGACY_CHANNEL_ID,
                "Mining",
                NotificationManager.IMPORTANCE_HIGH
            );
            legacyChannel.setDescription(CHANNEL_DESCRIPTION);
            legacyChannel.enableVibration(true);
            legacyChannel.enableLights(true);
            legacyChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(legacyChannel);
        } catch (Exception e) {
            Log.e(TAG, "Failed to create notification channel", e);
        }
    }

    public static boolean hasNotificationPermission(Context context) {
        if (context == null) {
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    Log.w(TAG, "POST_NOTIFICATIONS permission not granted");
                    return false;
                }
            }
            boolean enabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
            if (!enabled) {
                Log.w(TAG, "Notifications are disabled in system NotificationManagerCompat");
            }
            return enabled;
        } catch (Exception e) {
            Log.e(TAG, "Error checking notification permission", e);
            return false;
        }
    }

    public static void showCycleCompletedNotification(
        Context context,
        int notificationId,
        String cycleKey,
        long cycleEndMs,
        String title,
        String body
    ) {
        boolean permitted = hasNotificationPermission(context);
        Log.i(
            TAG,
            "showCycleCompletedNotification: id=" + notificationId +
            " cycleKey=" + cycleKey +
            " cycleEndMs=" + cycleEndMs +
            " permitted=" + permitted
        );
        if (!permitted) {
            return;
        }
        try {
            ensureNotificationChannel(context);

            Intent tapIntent = buildTapActivityIntent(context, cycleKey, cycleEndMs);

            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                notificationId > 0 ? notificationId : 100101,
                tapIntent,
                pendingFlags
            );

            int smallIcon = R.drawable.ic_stat_coinpulse;
            if (smallIcon == 0) {
                smallIcon = android.R.drawable.ic_dialog_info;
            }

            String finalTitle = (title != null && !title.isEmpty()) ? title : DEFAULT_TITLE;
            String finalBody = (body != null && !body.isEmpty()) ? body : DEFAULT_BODY;

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle(finalTitle)
                .setContentText(finalBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(finalBody))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setAutoCancel(true)
                .setContentIntent(contentIntent);

            try {
                Bitmap largeIcon = BitmapFactory.decodeResource(
                    context.getResources(),
                    R.mipmap.ic_launcher
                );
                if (largeIcon != null) {
                    builder.setLargeIcon(largeIcon);
                }
            } catch (Exception ignored) {
            }

            NotificationManagerCompat.from(context).notify(
                notificationId > 0 ? notificationId : 100101,
                builder.build()
            );
            Log.i(TAG, "Successfully posted notification id=" + notificationId + " for cycleKey=" + cycleKey);
        } catch (SecurityException | IllegalArgumentException se) {
            Log.e(TAG, "Security/Argument exception posting notification", se);
        } catch (Exception e) {
            Log.e(TAG, "Unexpected exception posting notification", e);
        }
    }

    private static Intent buildTapActivityIntent(Context context, String cycleKey, long cycleEndMs) {
        Intent tapIntent = new Intent(context, MainActivity.class);
        tapIntent.setPackage(context.getPackageName());
        tapIntent.setFlags(
            Intent.FLAG_ACTIVITY_SINGLE_TOP |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_NEW_TASK
        );
        tapIntent.putExtra("from_mining_notification", true);
        tapIntent.putExtra("notification_action", "open_mining_dashboard");
        tapIntent.putExtra("cycle_key", cycleKey != null ? cycleKey : "");
        tapIntent.putExtra("cycle_end_ms", cycleEndMs);
        return tapIntent;
    }

    public static boolean scheduleAlarm(
        Context context,
        String cycleKey,
        long triggerAtEpochMs,
        int notificationId,
        String title,
        String body
    ) {
        if (context == null || cycleKey == null || cycleKey.trim().isEmpty() || triggerAtEpochMs <= 0) {
            Log.w(
                TAG,
                "scheduleAlarm rejected invalid args: cycleKey=" + cycleKey +
                " triggerAtEpochMs=" + triggerAtEpochMs
            );
            return false;
        }

        try {
            ensureNotificationChannel(context);
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            String lastDelivered = prefs.getString(KEY_LAST_DELIVERED_CYCLE_KEY, "");
            if (cycleKey.equals(lastDelivered)) {
                Log.i(TAG, "scheduleAlarm skipped: cycleKey already delivered=" + cycleKey);
                return false;
            }

            int effectiveNotifId = notificationId > 0 ? notificationId : 100101;
            String existingKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
            long existingTriggerAt = prefs.getLong(KEY_SCHEDULED_TRIGGER_AT, 0L);
            int existingNotifId = prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 0);

            // If this exact cycle is already scheduled with essentially the same timestamp, avoid redundant work
            if (
                cycleKey.equals(existingKey) &&
                Math.abs(existingTriggerAt - triggerAtEpochMs) < 3000L &&
                existingNotifId == effectiveNotifId
            ) {
                Log.i(
                    TAG,
                    "scheduleAlarm already active for cycleKey=" + cycleKey +
                    " triggerAt=" + existingTriggerAt +
                    " id=" + effectiveNotifId
                );
                return true;
            }

            // If a DIFFERENT previous cycle alarm was scheduled, cancel the previous cycle's PendingIntent first
            if (existingNotifId > 0 && !cycleKey.equals(existingKey)) {
                cancelAlarmInternal(context, existingNotifId);
            }

            String finalTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : DEFAULT_TITLE;
            String finalBody = (body != null && !body.trim().isEmpty()) ? body.trim() : DEFAULT_BODY;

            long nowMs = System.currentTimeMillis();
            long safeTriggerMs = Math.max(nowMs + 500L, triggerAtEpochMs);

            // Synchronously persist to SharedPreferences so force-closing the app immediately after mining never loses state
            prefs.edit()
                .putString(KEY_SCHEDULED_CYCLE_KEY, cycleKey)
                .putLong(KEY_SCHEDULED_TRIGGER_AT, safeTriggerMs)
                .putInt(KEY_SCHEDULED_NOTIF_ID, effectiveNotifId)
                .putString(KEY_SCHEDULED_TITLE, finalTitle)
                .putString(KEY_SCHEDULED_BODY, finalBody)
                .commit();

            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) {
                Log.e(TAG, "AlarmManager service is null");
                return false;
            }

            PendingIntent alarmIntent = buildAlarmPendingIntent(
                context,
                effectiveNotifId,
                cycleKey,
                safeTriggerMs,
                finalTitle,
                finalBody,
                false
            );
            if (alarmIntent == null) {
                Log.e(TAG, "Failed to build alarm PendingIntent");
                return false;
            }

            boolean canExact = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                canExact = alarmManager.canScheduleExactAlarms();
            }

            String alarmMode = "unknown";
            if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    Intent showActivityIntent = buildTapActivityIntent(context, cycleKey, safeTriggerMs);
                    int showFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        showFlags |= PendingIntent.FLAG_IMMUTABLE;
                    }
                    PendingIntent showPendingIntent = PendingIntent.getActivity(
                        context,
                        effectiveNotifId,
                        showActivityIntent,
                        showFlags
                    );
                    AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(
                        safeTriggerMs,
                        showPendingIntent
                    );
                    alarmManager.setAlarmClock(clockInfo, alarmIntent);
                    alarmMode = "setAlarmClock";
                } catch (SecurityException se) {
                    Log.w(TAG, "setAlarmClock SecurityException, falling back", se);
                }
            }

            if ("unknown".equals(alarmMode)) {
                if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            safeTriggerMs,
                            alarmIntent
                        );
                        alarmMode = "setExactAndAllowWhileIdle";
                    } catch (SecurityException se) {
                        Log.w(TAG, "setExactAndAllowWhileIdle SecurityException, falling back", se);
                    }
                }
            }

            if ("unknown".equals(alarmMode)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        safeTriggerMs,
                        alarmIntent
                    );
                    alarmMode = "setAndAllowWhileIdle";
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, safeTriggerMs, alarmIntent);
                    alarmMode = "setExact";
                }
            }

            Log.i(
                TAG,
                "Scheduled mining notification: cycleKey=" + cycleKey +
                " id=" + effectiveNotifId +
                " nowMs=" + nowMs +
                " triggerAtMs=" + safeTriggerMs +
                " inSec=" + ((safeTriggerMs - nowMs) / 1000L) +
                " mode=" + alarmMode +
                " permission=" + hasNotificationPermission(context)
            );
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Exception in scheduleAlarm", e);
            return false;
        }
    }

    public static void cancelScheduledAlarm(Context context) {
        if (context == null) {
            return;
        }
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            int existingNotifId = prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 100101);
            String existingKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
            Log.i(TAG, "cancelScheduledAlarm called: existingKey=" + existingKey + " id=" + existingNotifId);
            cancelAlarmInternal(context, existingNotifId);
            if (existingNotifId != 100101) {
                cancelAlarmInternal(context, 100101);
            }
            clearScheduledState(prefs);
        } catch (Exception e) {
            Log.e(TAG, "Exception in cancelScheduledAlarm", e);
        }
    }

    public static boolean completeAndDeliverIfPending(
        Context context,
        String completedCycleKey,
        long cycleEndMs
    ) {
        if (context == null) {
            return false;
        }
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String targetKey;
            int notifId;
            long triggerAt;
            String title;
            String body;
            boolean shouldDeliver = false;

            synchronized (MiningNotificationReceiver.class) {
                String scheduledKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
                String lastDelivered = prefs.getString(KEY_LAST_DELIVERED_CYCLE_KEY, "");
                notifId = prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 100101);
                triggerAt = prefs.getLong(KEY_SCHEDULED_TRIGGER_AT, cycleEndMs);
                title = prefs.getString(KEY_SCHEDULED_TITLE, DEFAULT_TITLE);
                body = prefs.getString(KEY_SCHEDULED_BODY, DEFAULT_BODY);

                cancelAlarmInternal(context, notifId);
                if (notifId != 100101) {
                    cancelAlarmInternal(context, 100101);
                }
                clearScheduledState(prefs);

                targetKey = (completedCycleKey != null && !completedCycleKey.isEmpty())
                    ? completedCycleKey
                    : scheduledKey;

                if (targetKey == null || targetKey.isEmpty() || targetKey.equals(lastDelivered)) {
                    return false;
                }

                boolean wasScheduled = scheduledKey != null && !scheduledKey.isEmpty() && scheduledKey.equals(targetKey);
                long now = System.currentTimeMillis();
                boolean withinRecentWindow = triggerAt <= 0L || (now - triggerAt) <= 5 * 60 * 1000L;

                prefs.edit().putString(KEY_LAST_DELIVERED_CYCLE_KEY, targetKey).commit();
                shouldDeliver = wasScheduled && withinRecentWindow;
            }

            if (shouldDeliver) {
                Log.i(TAG, "completeAndDeliverIfPending: delivering notification for cycleKey=" + targetKey);
                showCycleCompletedNotification(
                    context,
                    notifId,
                    targetKey,
                    triggerAt > 0L ? triggerAt : cycleEndMs,
                    title,
                    body
                );
                return true;
            }
            return false;
        } catch (Exception e) {
            Log.e(TAG, "Exception in completeAndDeliverIfPending", e);
            return false;
        }
    }

    private static void cancelAlarmInternal(Context context, int notificationId) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pendingIntent = buildAlarmPendingIntent(
                context,
                notificationId,
                "",
                0L,
                DEFAULT_TITLE,
                DEFAULT_BODY,
                true
            );
            if (alarmManager != null && pendingIntent != null) {
                alarmManager.cancel(pendingIntent);
                pendingIntent.cancel();
            }
        } catch (Exception ignored) {
        }
    }

    private static PendingIntent buildAlarmPendingIntent(
        Context context,
        int notificationId,
        String cycleKey,
        long triggerAtMs,
        String title,
        String body,
        boolean noCreate
    ) {
        Intent intent = new Intent(context, MiningNotificationReceiver.class);
        intent.setPackage(context.getPackageName());
        intent.setAction(ACTION_MINING_CYCLE_COMPLETED);
        intent.addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
        intent.putExtra("cycle_key", cycleKey != null ? cycleKey : "");
        intent.putExtra("trigger_at_ms", triggerAtMs);
        intent.putExtra("notification_id", notificationId);
        intent.putExtra("title", title != null ? title : DEFAULT_TITLE);
        intent.putExtra("body", body != null ? body : DEFAULT_BODY);

        int flags = noCreate ? PendingIntent.FLAG_NO_CREATE : PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        int requestCode = notificationId > 0 ? notificationId : 100101;
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    private static void rescheduleAfterBoot(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String cycleKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
            long triggerAt = prefs.getLong(KEY_SCHEDULED_TRIGGER_AT, 0L);
            int notifId = prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 100101);
            String title = prefs.getString(KEY_SCHEDULED_TITLE, DEFAULT_TITLE);
            String body = prefs.getString(KEY_SCHEDULED_BODY, DEFAULT_BODY);
            String lastDelivered = prefs.getString(KEY_LAST_DELIVERED_CYCLE_KEY, "");

            if (cycleKey == null || cycleKey.isEmpty() || triggerAt <= 0L) {
                return;
            }
            if (cycleKey.equals(lastDelivered)) {
                clearScheduledState(prefs);
                return;
            }

            long now = System.currentTimeMillis();
            if (triggerAt <= now) {
                // Cycle finished while phone was powered off; deliver notification once now
                prefs.edit()
                    .putString(KEY_LAST_DELIVERED_CYCLE_KEY, cycleKey)
                    .remove(KEY_SCHEDULED_CYCLE_KEY)
                    .remove(KEY_SCHEDULED_TRIGGER_AT)
                    .remove(KEY_SCHEDULED_NOTIF_ID)
                    .commit();
                showCycleCompletedNotification(context, notifId, cycleKey, triggerAt, title, body);
            } else {
                // Re-register alarm for remaining time
                prefs.edit().remove(KEY_SCHEDULED_CYCLE_KEY).commit();
                scheduleAlarm(context, cycleKey, triggerAt, notifId, title, body);
            }
        } catch (Exception e) {
            Log.e(TAG, "Exception in rescheduleAfterBoot", e);
        }
    }

    private static void clearScheduledState(SharedPreferences prefs) {
        prefs.edit()
            .remove(KEY_SCHEDULED_CYCLE_KEY)
            .remove(KEY_SCHEDULED_TRIGGER_AT)
            .remove(KEY_SCHEDULED_NOTIF_ID)
            .commit();
    }
}
