package com.coinpulse.mining;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME = "CoinPulseAuthPrefs";
    private static final String KEY_TOKEN = "coinpulse_session_token";
    private static final String KEY_CKPT = "coinpulse_state_checkpoint";

    private String pendingToken = "";
    private String pendingSid = "";
    private String pendingCkpt = "";
    private String pendingError = "";

    private SharedPreferences getAuthPrefs() {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebViewCookies();
        registerNativeBridge();
        handleDeepLinkIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLinkIntent(intent);
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

