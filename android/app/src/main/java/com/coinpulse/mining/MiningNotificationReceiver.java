package com.coinpulse.mining;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class MiningNotificationReceiver extends BroadcastReceiver {

    public static final String ACTION_MINING_CYCLE_COMPLETED =
        "com.coinpulse.mining.ACTION_MINING_CYCLE_COMPLETED";
    public static final String CHANNEL_ID = "mining";
    public static final String CHANNEL_NAME = "Mining";
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

        final String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
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
        if (intentCycleKey == null || intentCycleKey.isEmpty()) {
            intentCycleKey = scheduledCycleKey;
        }

        // Prevent duplicate delivery for the same cycle
        if (intentCycleKey != null && !intentCycleKey.isEmpty() && intentCycleKey.equals(lastDeliveredCycleKey)) {
            clearScheduledState(prefs);
            return;
        }

        // If the scheduled cycle was cancelled or replaced by a different cycle, ignore stale alarm
        if (scheduledCycleKey == null || scheduledCycleKey.isEmpty()) {
            return;
        }
        if (intentCycleKey != null && !intentCycleKey.isEmpty() && !intentCycleKey.equals(scheduledCycleKey)) {
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

        // Mark cycle notification as delivered and clear pending alarm state before displaying
        prefs.edit()
            .putString(KEY_LAST_DELIVERED_CYCLE_KEY, scheduledCycleKey)
            .remove(KEY_SCHEDULED_CYCLE_KEY)
            .remove(KEY_SCHEDULED_TRIGGER_AT)
            .remove(KEY_SCHEDULED_NOTIF_ID)
            .apply();

        showCycleCompletedNotification(context, notificationId, scheduledCycleKey, scheduledTriggerAt, title, body);
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
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription(CHANNEL_DESCRIPTION);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        } catch (Exception ignored) {
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
                    return false;
                }
            }
            return NotificationManagerCompat.from(context).areNotificationsEnabled();
        } catch (Exception e) {
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
        if (!hasNotificationPermission(context)) {
            return;
        }
        try {
            ensureNotificationChannel(context);

            Intent tapIntent = new Intent(context, MainActivity.class);
            tapIntent.setFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                Intent.FLAG_ACTIVITY_CLEAR_TOP |
                Intent.FLAG_ACTIVITY_NEW_TASK
            );
            tapIntent.putExtra("from_mining_notification", true);
            tapIntent.putExtra("notification_action", "open_mining_dashboard");
            tapIntent.putExtra("cycle_key", cycleKey != null ? cycleKey : "");
            tapIntent.putExtra("cycle_end_ms", cycleEndMs);

            int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                notificationId,
                tapIntent,
                pendingFlags
            );

            int smallIcon = context.getApplicationInfo().icon;
            if (smallIcon == 0) {
                smallIcon = android.R.drawable.ic_dialog_info;
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle(title != null && !title.isEmpty() ? title : DEFAULT_TITLE)
                .setContentText(body != null && !body.isEmpty() ? body : DEFAULT_BODY)
                .setStyle(
                    new NotificationCompat.BigTextStyle().bigText(
                        body != null && !body.isEmpty() ? body : DEFAULT_BODY
                    )
                )
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(contentIntent);

            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (SecurityException | IllegalArgumentException ignored) {
        } catch (Exception ignored) {
        }
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
            return false;
        }

        try {
            ensureNotificationChannel(context);
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            String lastDelivered = prefs.getString(KEY_LAST_DELIVERED_CYCLE_KEY, "");
            if (cycleKey.equals(lastDelivered)) {
                return false;
            }

            String existingKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
            long existingTriggerAt = prefs.getLong(KEY_SCHEDULED_TRIGGER_AT, 0L);
            int existingNotifId = prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 0);

            // If this exact cycle is already scheduled with the same timestamp, avoid duplicate scheduling
            if (
                cycleKey.equals(existingKey) &&
                Math.abs(existingTriggerAt - triggerAtEpochMs) < 2000L &&
                existingNotifId == notificationId
            ) {
                return true;
            }

            // Cancel any previous cycle alarm before scheduling the new one
            cancelAlarmInternal(context, existingNotifId > 0 ? existingNotifId : notificationId);

            String finalTitle = (title != null && !title.trim().isEmpty()) ? title.trim() : DEFAULT_TITLE;
            String finalBody = (body != null && !body.trim().isEmpty()) ? body.trim() : DEFAULT_BODY;

            prefs.edit()
                .putString(KEY_SCHEDULED_CYCLE_KEY, cycleKey)
                .putLong(KEY_SCHEDULED_TRIGGER_AT, triggerAtEpochMs)
                .putInt(KEY_SCHEDULED_NOTIF_ID, notificationId)
                .putString(KEY_SCHEDULED_TITLE, finalTitle)
                .putString(KEY_SCHEDULED_BODY, finalBody)
                .apply();

            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) {
                return false;
            }

            PendingIntent alarmIntent = buildAlarmPendingIntent(
                context,
                notificationId,
                cycleKey,
                finalTitle,
                finalBody,
                false
            );
            if (alarmIntent == null) {
                return false;
            }

            long safeTriggerMs = Math.max(System.currentTimeMillis() + 500L, triggerAtEpochMs);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (alarmManager.canScheduleExactAlarms()) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            safeTriggerMs,
                            alarmIntent
                        );
                        return true;
                    } catch (SecurityException ignored) {
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        safeTriggerMs,
                        alarmIntent
                    );
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, safeTriggerMs, alarmIntent);
                }
                return true;
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        safeTriggerMs,
                        alarmIntent
                    );
                } catch (SecurityException se) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        safeTriggerMs,
                        alarmIntent
                    );
                }
                return true;
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, safeTriggerMs, alarmIntent);
                return true;
            }
        } catch (Exception e) {
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
            cancelAlarmInternal(context, existingNotifId);
            clearScheduledState(prefs);
        } catch (Exception ignored) {
        }
    }

    private static void cancelAlarmInternal(Context context, int notificationId) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pendingIntent = buildAlarmPendingIntent(
                context,
                notificationId,
                "",
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
        String title,
        String body,
        boolean noCreate
    ) {
        Intent intent = new Intent(context, MiningNotificationReceiver.class);
        intent.setAction(ACTION_MINING_CYCLE_COMPLETED);
        intent.putExtra("cycle_key", cycleKey != null ? cycleKey : "");
        intent.putExtra("notification_id", notificationId);
        intent.putExtra("title", title != null ? title : DEFAULT_TITLE);
        intent.putExtra("body", body != null ? body : DEFAULT_BODY);

        int flags = noCreate ? PendingIntent.FLAG_NO_CREATE : PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, 100101, intent, flags);
    }

    private static void rescheduleAfterBoot(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String cycleKey = prefs.getString(KEY_SCHEDULED_CYCLE_KEY, "");
            long triggerAt = prefs.getLong(KEY_SCHEDULED_TRIGGER_AT, 0L);
            int notifId = prefs.getInt(KEY_SCHEDULED_NOTIF_ID, 100101);
            String title = prefs.getString(KEY_SCHEDULED_TITLE, DEFAULT_TITLE);
            String body = prefs.getString(KEY_SCHEDULED_BODY, DEFAULT_BODY);

            if (cycleKey == null || cycleKey.isEmpty() || triggerAt <= 0L) {
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
                    .apply();
                showCycleCompletedNotification(context, notifId, cycleKey, triggerAt, title, body);
            } else {
                // Clear and re-register alarm for remaining time
                prefs.edit().remove(KEY_SCHEDULED_CYCLE_KEY).apply();
                scheduleAlarm(context, cycleKey, triggerAt, notifId, title, body);
            }
        } catch (Exception ignored) {
        }
    }

    private static void clearScheduledState(SharedPreferences prefs) {
        prefs.edit()
            .remove(KEY_SCHEDULED_CYCLE_KEY)
            .remove(KEY_SCHEDULED_TRIGGER_AT)
            .remove(KEY_SCHEDULED_NOTIF_ID)
            .apply();
    }
}
