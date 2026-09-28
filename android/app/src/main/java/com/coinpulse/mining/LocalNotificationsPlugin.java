package com.coinpulse.mining;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "LocalNotifications",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "display"
        )
    }
)
public class LocalNotificationsPlugin extends Plugin {

    public static final String KEY_NOTIFICATION_PERMISSION_PROMPTED =
        "coinpulse_notif_perm_prompted";

    @Override
    public void load() {
        super.load();
        MiningNotificationReceiver.ensureNotificationChannel(getContext());
    }

    @PluginMethod
    @Override
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("display", getDisplayPermissionState());
        call.resolve(result);
    }

    @PluginMethod
    @Override
    public void requestPermissions(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            JSObject result = new JSObject();
            result.put("display", "denied");
            call.resolve(result);
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject result = new JSObject();
            boolean enabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
            result.put("display", enabled ? "granted" : "denied");
            call.resolve(result);
            return;
        }

        if (getPermissionState("display") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("display", "granted");
            call.resolve(result);
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(
            MiningNotificationReceiver.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        // If already prompted previously and denied, respect user's decision without re-prompting
        if (prefs.getBoolean(KEY_NOTIFICATION_PERMISSION_PROMPTED, false)) {
            JSObject result = new JSObject();
            result.put("display", "denied");
            call.resolve(result);
            return;
        }

        prefs.edit().putBoolean(KEY_NOTIFICATION_PERMISSION_PROMPTED, true).apply();
        requestPermissionForAlias("display", call, "notificationsPermissionCallback");
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("display", getDisplayPermissionState());
        call.resolve(result);
    }

    @PluginMethod
    public void createChannel(PluginCall call) {
        MiningNotificationReceiver.ensureNotificationChannel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray notifications = call.getArray("notifications");
        JSArray scheduledIds = new JSArray();

        if (notifications != null && getContext() != null) {
            for (int i = 0; i < notifications.length(); i++) {
                try {
                    JSONObject item = notifications.getJSONObject(i);
                    int id = item.optInt("id", 100101);
                    String title = item.optString(
                        "title",
                        MiningNotificationReceiver.DEFAULT_TITLE
                    );
                    String body = item.optString(
                        "body",
                        MiningNotificationReceiver.DEFAULT_BODY
                    );

                    long triggerAtMs = 0L;
                    JSONObject scheduleObj = item.optJSONObject("schedule");
                    if (scheduleObj != null) {
                        triggerAtMs = scheduleObj.optLong("atEpochMs", 0L);
                        if (triggerAtMs <= 0L) {
                            triggerAtMs = scheduleObj.optLong("at", 0L);
                        }
                    }

                    JSONObject extraObj = item.optJSONObject("extra");
                    String cycleKey = "";
                    if (extraObj != null) {
                        cycleKey = extraObj.optString("cycleKey", "");
                        if (triggerAtMs <= 0L) {
                            triggerAtMs = extraObj.optLong("nextMiningAvailableAt", 0L);
                        }
                    }
                    if (cycleKey == null || cycleKey.isEmpty()) {
                        cycleKey = "cycle_" + triggerAtMs;
                    }

                    if (triggerAtMs > 0L) {
                        MiningNotificationReceiver.scheduleAlarm(
                            getContext(),
                            cycleKey,
                            triggerAtMs,
                            id,
                            title,
                            body
                        );
                        JSObject entry = new JSObject();
                        entry.put("id", id);
                        scheduledIds.put(entry);
                    }
                } catch (Exception ignored) {
                }
            }
        }

        JSObject res = new JSObject();
        res.put("notifications", scheduledIds);
        call.resolve(res);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        if (getContext() != null) {
            MiningNotificationReceiver.cancelScheduledAlarm(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray pending = new JSArray();
        if (getContext() != null) {
            SharedPreferences prefs = getContext().getSharedPreferences(
                MiningNotificationReceiver.PREFS_NAME,
                Context.MODE_PRIVATE
            );
            String cycleKey = prefs.getString(
                MiningNotificationReceiver.KEY_SCHEDULED_CYCLE_KEY,
                ""
            );
            long triggerAt = prefs.getLong(
                MiningNotificationReceiver.KEY_SCHEDULED_TRIGGER_AT,
                0L
            );
            int notifId = prefs.getInt(
                MiningNotificationReceiver.KEY_SCHEDULED_NOTIF_ID,
                100101
            );
            if (cycleKey != null && !cycleKey.isEmpty() && triggerAt > System.currentTimeMillis()) {
                JSObject item = new JSObject();
                item.put("id", notifId);
                item.put("cycleKey", cycleKey);
                item.put("triggerAtMs", triggerAt);
                pending.put(item);
            }
        }
        JSObject res = new JSObject();
        res.put("notifications", pending);
        call.resolve(res);
    }

    public void notifyNotificationTapped(String cycleKey, long cycleEndMs) {
        JSObject data = new JSObject();
        data.put("actionId", "tap");
        JSObject notification = new JSObject();
        notification.put("id", 100101);
        notification.put("title", MiningNotificationReceiver.DEFAULT_TITLE);
        notification.put("body", MiningNotificationReceiver.DEFAULT_BODY);
        JSObject extra = new JSObject();
        extra.put("cycleKey", cycleKey != null ? cycleKey : "");
        extra.put("cycleEndMs", cycleEndMs);
        extra.put("targetTab", "mining");
        notification.put("extra", extra);
        data.put("notification", notification);
        notifyListeners("localNotificationActionPerformed", data, true);
    }

    private String getDisplayPermissionState() {
        Context context = getContext();
        if (context == null) {
            return "denied";
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            PermissionState state = getPermissionState("display");
            if (state == PermissionState.GRANTED) {
                return NotificationManagerCompat.from(context).areNotificationsEnabled()
                    ? "granted"
                    : "denied";
            }
            SharedPreferences prefs = context.getSharedPreferences(
                MiningNotificationReceiver.PREFS_NAME,
                Context.MODE_PRIVATE
            );
            if (prefs.getBoolean(KEY_NOTIFICATION_PERMISSION_PROMPTED, false)) {
                return "denied";
            }
            return "prompt";
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
            ? "granted"
            : "denied";
    }
}
