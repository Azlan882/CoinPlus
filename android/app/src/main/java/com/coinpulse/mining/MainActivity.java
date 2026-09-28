package com.coinpulse.mining;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME = "CoinPulseAuthPrefs";
    private static final String KEY_TOKEN = "coinpulse_session_token";
    private static final String KEY_CKPT = "coinpulse_state_checkpoint";
    private static final int REQ_CODE_POST_NOTIFICATIONS = 5021;

    private String pendingToken = "";
    private String pendingSid = "";
    private String pendingCkpt = "";
    private String pendingError = "";

    private boolean pendingNotificationTap = false;
    private String pendingNotificationCycleKey = "";
    private long pendingNotificationCycleEndMs = 0L;

    private SharedPreferences getAuthPrefs() {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        MiningNotificationReceiver.ensureNotificationChannel(this);
        configureWebViewCookies();
        registerNativeBridge();
        handleDeepLinkIntent(getIntent());
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    public void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebViewCookies();
        registerNativeBridge();
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }
        final WebView webView = this.bridge.getWebView();
        try {
            webView.onResume();
            webView.resumeTimers();
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }

        final String savedToken = getAuthPrefs().getString(KEY_TOKEN, "");
        final String savedCkpt = getAuthPrefs().getString(KEY_CKPT, "");

        int[] delays = new int[] { 0, 150, 600 };
        for (int delay : delays) {
            webView.postDelayed(() -> {
                try {
                    StringBuilder js = new StringBuilder();
                    js.append("(function(){");
                    if (savedToken != null && !savedToken.isEmpty()) {
                        js.append("try { if (!localStorage.getItem('coinpulse_session_token')) { localStorage.setItem('coinpulse_session_token', ")
                          .append(JSONObject.quote(savedToken))
                          .append("); } } catch(e){}");
                    }
                    if (savedCkpt != null && !savedCkpt.isEmpty()) {
                        js.append("try { if (!localStorage.getItem('coinpulse_state_checkpoint')) { localStorage.setItem('coinpulse_state_checkpoint', ")
                          .append(JSONObject.quote(savedCkpt))
                          .append("); } } catch(e){}");
                    }
                    js.append("window.dispatchEvent(new CustomEvent('coinpulse-app-resume', { detail: { timestamp: Date.now() } }));");
                    js.append("document.dispatchEvent(new Event('resume'));");
                    js.append("})();");
                    webView.evaluateJavascript(js.toString(), null);
                } catch (Exception ignored) {
                }
            }, delay);
        }
    }

    private void configureWebViewCookies() {
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            if (this.bridge != null && this.bridge.getWebView() != null) {
                cookieManager.setAcceptThirdPartyCookies(this.bridge.getWebView(), true);
            }
            cookieManager.flush();
        } catch (Exception ignored) {
        }
    }

    private void registerNativeBridge() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }
        try {
            this.bridge.getWebView().addJavascriptInterface(new CoinPulseJsBridge(), "CoinPulseNative");
        } catch (Exception ignored) {
        }
    }

    public class CoinPulseJsBridge {
        @JavascriptInterface
        public boolean openExternalUrl(final String url) {
            if (url == null || url.trim().isEmpty()) {
                return false;
            }
            try {
                final Uri parsedUri = Uri.parse(url.trim());
                runOnUiThread(() -> {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, parsedUri);
                        browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(browserIntent);
                    } catch (Exception ignored) {
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String getPersistedToken() {
            try {
                return getAuthPrefs().getString(KEY_TOKEN, "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void setPersistedToken(final String token) {
            try {
                SharedPreferences.Editor editor = getAuthPrefs().edit();
                if (token == null || token.trim().isEmpty()) {
                    editor.remove(KEY_TOKEN);
                } else {
                    editor.putString(KEY_TOKEN, token.trim());
                }
                editor.apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getPersistedCheckpoint() {
            try {
                return getAuthPrefs().getString(KEY_CKPT, "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void setPersistedCheckpoint(final String ckpt) {
            try {
                if (ckpt != null && !ckpt.trim().isEmpty()) {
                    getAuthPrefs().edit().putString(KEY_CKPT, ckpt.trim()).apply();
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void clearPersistedSession() {
            try {
                getAuthPrefs().edit().remove(KEY_TOKEN).apply();
                pendingToken = "";
                pendingSid = "";
                pendingError = "";
                CookieManager.getInstance().flush();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String consumePendingAuth() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("token", pendingToken != null ? pendingToken : "");
                obj.put("sid", pendingSid != null ? pendingSid : "");
                obj.put("ckpt", pendingCkpt != null ? pendingCkpt : "");
                obj.put("error", pendingError != null ? pendingError : "");
                pendingToken = "";
                pendingSid = "";
                pendingCkpt = "";
                pendingError = "";
                return obj.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String getNotificationPermissionStatus() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    int perm = ContextCompat.checkSelfPermission(
                        MainActivity.this,
                        Manifest.permission.POST_NOTIFICATIONS
                    );
                    if (perm == PackageManager.PERMISSION_GRANTED) {
                        return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled()
                            ? "granted"
                            : "denied";
                    }
                    boolean alreadyPrompted = getAuthPrefs().getBoolean(
                        LocalNotificationsPlugin.KEY_NOTIFICATION_PERMISSION_PROMPTED,
                        false
                    );
                    return alreadyPrompted ? "denied" : "prompt";
                }
                return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled()
                    ? "granted"
                    : "denied";
            } catch (Exception e) {
                return "denied";
            }
        }

        @JavascriptInterface
        public String requestNotificationPermissionOnce() {
            try {
                MiningNotificationReceiver.ensureNotificationChannel(MainActivity.this);
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled()
                        ? "granted"
                        : "denied";
                }

                int perm = ContextCompat.checkSelfPermission(
                    MainActivity.this,
                    Manifest.permission.POST_NOTIFICATIONS
                );
                if (perm == PackageManager.PERMISSION_GRANTED) {
                    return "granted";
                }

                SharedPreferences prefs = getAuthPrefs();
                if (prefs.getBoolean(LocalNotificationsPlugin.KEY_NOTIFICATION_PERMISSION_PROMPTED, false)) {
                    return "denied";
                }

                prefs.edit()
                    .putBoolean(LocalNotificationsPlugin.KEY_NOTIFICATION_PERMISSION_PROMPTED, true)
                    .apply();

                runOnUiThread(() -> {
                    try {
                        ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[] { Manifest.permission.POST_NOTIFICATIONS },
                            REQ_CODE_POST_NOTIFICATIONS
                        );
                    } catch (Exception ignored) {
                    }
                });
                return "requested";
            } catch (Exception e) {
                return "denied";
            }
        }

        @JavascriptInterface
        public boolean scheduleMiningCycleNotification(
            final String cycleKey,
            final long triggerAtEpochMs,
            final int notificationId,
            final String title,
            final String body
        ) {
            try {
                return MiningNotificationReceiver.scheduleAlarm(
                    MainActivity.this,
                    cycleKey,
                    triggerAtEpochMs,
                    notificationId > 0 ? notificationId : 100101,
                    title,
                    body
                );
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void cancelMiningCycleNotification() {
            try {
                MiningNotificationReceiver.cancelScheduledAlarm(MainActivity.this);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getScheduledMiningCycleNotification() {
            try {
                SharedPreferences prefs = getAuthPrefs();
                JSONObject obj = new JSONObject();
                obj.put(
                    "cycleKey",
                    prefs.getString(MiningNotificationReceiver.KEY_SCHEDULED_CYCLE_KEY, "")
                );
                obj.put(
                    "triggerAtMs",
                    prefs.getLong(MiningNotificationReceiver.KEY_SCHEDULED_TRIGGER_AT, 0L)
                );
                obj.put(
                    "notificationId",
                    prefs.getInt(MiningNotificationReceiver.KEY_SCHEDULED_NOTIF_ID, 0)
                );
                obj.put(
                    "lastDeliveredCycleKey",
                    prefs.getString(MiningNotificationReceiver.KEY_LAST_DELIVERED_CYCLE_KEY, "")
                );
                return obj.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String consumeNotificationTap() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("tapped", pendingNotificationTap);
                obj.put("cycleKey", pendingNotificationCycleKey != null ? pendingNotificationCycleKey : "");
                obj.put("cycleEndMs", pendingNotificationCycleEndMs);
                obj.put("targetTab", "mining");
                pendingNotificationTap = false;
                pendingNotificationCycleKey = "";
                pendingNotificationCycleEndMs = 0L;
                return obj.toString();
            } catch (Exception e) {
                return "{\"tapped\":false}";
            }
        }
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        boolean fromMiningNotification = false;
        try {
            fromMiningNotification = intent.getBooleanExtra("from_mining_notification", false);
        } catch (Exception ignored) {
        }
        if (!fromMiningNotification) {
            return;
        }

        final String cycleKey = intent.getStringExtra("cycle_key") != null
            ? intent.getStringExtra("cycle_key")
            : "";
        final long cycleEndMs = intent.getLongExtra("cycle_end_ms", 0L);

        // Clear extra so reopening from Recents does not replay the notification tap
        try {
            intent.removeExtra("from_mining_notification");
            setIntent(intent);
        } catch (Exception ignored) {
        }

        this.pendingNotificationTap = true;
        this.pendingNotificationCycleKey = cycleKey;
        this.pendingNotificationCycleEndMs = cycleEndMs;

        if (this.bridge != null) {
            try {
                PluginHandle handle = this.bridge.getPlugin("LocalNotifications");
                if (handle != null && handle.getInstance() instanceof LocalNotificationsPlugin) {
                    ((LocalNotificationsPlugin) handle.getInstance())
                        .notifyNotificationTapped(cycleKey, cycleEndMs);
                }
            } catch (Exception ignored) {
            }
        }

        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        final WebView webView = this.bridge.getWebView();
        int[] delays = new int[] { 100, 500, 1200 };
        for (int delay : delays) {
            webView.postDelayed(() -> {
                try {
                    JSONObject detail = new JSONObject();
                    detail.put("tapped", true);
                    detail.put("targetTab", "mining");
                    detail.put("cycleKey", cycleKey);
                    detail.put("cycleEndMs", cycleEndMs);
                    detail.put("timestamp", System.currentTimeMillis());

                    StringBuilder js = new StringBuilder();
                    js.append("(function(){");
                    js.append("window.__COINPULSE_NOTIFICATION_TAP__ = ")
                      .append(detail.toString())
                      .append(";");
                    js.append("window.dispatchEvent(new CustomEvent('coinpulse-notification-tap', { detail: ")
                      .append(detail.toString())
                      .append(" }));");
                    js.append("})();");

                    webView.evaluateJavascript(js.toString(), null);
                } catch (Exception ignored) {
                }
            }, delay);
        }
    }

    private void handleDeepLinkIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        Uri data = intent.getData();
        if (data == null || data.getScheme() == null) {
            return;
        }
        if (!"com.coinpulse.mining".equalsIgnoreCase(data.getScheme())) {
            return;
        }

        final String token = data.getQueryParameter("token") != null ? data.getQueryParameter("token") : "";
        final String sid = data.getQueryParameter("sid") != null ? data.getQueryParameter("sid") : "";
        final String ckpt = data.getQueryParameter("ckpt") != null ? data.getQueryParameter("ckpt") : "";
        final String error = data.getQueryParameter("error") != null ? data.getQueryParameter("error") : "";

        // Clear intent data after consuming so reopening the app from Recents does not replay an old deep link
        try {
            intent.setData(null);
            setIntent(intent);
        } catch (Exception ignored) {
        }

        try {
            SharedPreferences.Editor editor = getAuthPrefs().edit();
            if (!token.isEmpty()) {
                editor.putString(KEY_TOKEN, token);
            }
            if (!ckpt.isEmpty()) {
                editor.putString(KEY_CKPT, ckpt);
            }
            editor.apply();
        } catch (Exception ignored) {
        }

        this.pendingToken = token;
        this.pendingSid = sid;
        this.pendingCkpt = ckpt;
        this.pendingError = error;

        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        final WebView webView = this.bridge.getWebView();
        int[] delays = new int[] { 100, 500, 1200 };
        for (int delay : delays) {
            webView.postDelayed(() -> {
                try {
                    JSONObject detail = new JSONObject();
                    detail.put("token", token);
                    detail.put("sid", sid);
                    detail.put("ckpt", ckpt);
                    detail.put("error", error);

                    StringBuilder js = new StringBuilder();
                    js.append("(function(){");
                    if (!token.isEmpty()) {
                        js.append("try { localStorage.setItem('coinpulse_session_token', ")
                          .append(JSONObject.quote(token))
                          .append("); } catch(e){}");
                    }
                    if (!ckpt.isEmpty()) {
                        js.append("try { localStorage.setItem('coinpulse_state_checkpoint', ")
                          .append(JSONObject.quote(ckpt))
                          .append("); } catch(e){}");
                    }
                    js.append("window.__COINPULSE_DEEP_LINK_AUTH__ = ")
                      .append(detail.toString())
                      .append(";");
                    js.append("window.dispatchEvent(new CustomEvent('coinpulse-deep-link-auth', { detail: ")
                      .append(detail.toString())
                      .append(" }));");
                    js.append("})();");

                    webView.evaluateJavascript(js.toString(), null);
                } catch (Exception ignored) {
                }
            }, delay);
        }
    }
}
