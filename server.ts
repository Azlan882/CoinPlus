import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './server/api.ts';
import { hasGoogleClientIdConfigured } from './server/googleAuth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Basic security & CORS headers (supporting Web + Android Capacitor WebView)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const origin = req.headers.origin;
    if (
      origin &&
      (origin.endsWith('.run.app') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('https://localhost') ||
        origin.startsWith('capacitor://localhost'))
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // Mount API router
  app.use('/api', apiRouter);

  // OAuth 2.0 / OpenID Connect callback page for Web, AI Studio iframe popups, and Android Capacitor
  app.get(['/auth/callback', '/auth/callback/'], (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CoinPulse - Google Authentication</title>
    <style>
      * { box-sizing: border-box; }
      body {
        background: radial-gradient(circle at top, #0e172a 0%, #070b14 100%);
        color: #f1f5f9;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        text-align: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 380px;
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 24px;
        padding: 28px 24px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      }
      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(0, 242, 254, 0.2);
        border-top-color: #00f2fe;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin: 0 auto 16px;
      }
      .icon-box {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: none;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
        font-size: 22px;
        font-weight: bold;
      }
      .icon-success {
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid rgba(16, 185, 129, 0.4);
        color: #34d399;
      }
      .icon-error {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.4);
        color: #f87171;
      }
      h3 {
        margin: 0 0 8px;
        font-size: 17px;
        font-weight: 700;
        color: #ffffff;
      }
      p {
        margin: 0 0 18px;
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.5;
      }
      .btn {
        display: none;
        width: 100%;
        padding: 12px 16px;
        border-radius: 12px;
        border: none;
        background: linear-gradient(135deg, #06b6d4, #3b82f6);
        color: #020617;
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        text-decoration: none;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div id="spinner" class="spinner"></div>
      <div id="iconBox" class="icon-box"></div>
      <h3 id="titleText">Verifying Google Authentication...</h3>
      <p id="statusText">Establishing your encrypted CoinPulse miner session.</p>
      <button id="actionBtn" class="btn" type="button">Return to CoinPulse</button>
    </div>
    <script>
      (function() {
        var spinnerEl = document.getElementById('spinner');
        var iconBoxEl = document.getElementById('iconBox');
        var titleEl = document.getElementById('titleText');
        var statusEl = document.getElementById('statusText');
        var actionBtnEl = document.getElementById('actionBtn');

        var hash = window.location.hash ? window.location.hash.substring(1) : '';
        var search = window.location.search ? window.location.search.substring(1) : '';
        var hashParams = new URLSearchParams(hash);
        var queryParams = new URLSearchParams(search);

        function getParam(key) {
          return hashParams.get(key) || queryParams.get(key) || '';
        }

        var idToken = getParam('id_token') || getParam('access_token') || getParam('token');
        var oauthError = getParam('error');
        var oauthErrorDesc = getParam('error_description');
        var rawState = getParam('state');

        var parsedState = { sid: '', ref: '', origin: '', platform: 'web', mode: 'popup' };
        if (rawState) {
          try {
            var decoded = JSON.parse(rawState);
            if (decoded && typeof decoded === 'object') {
              parsedState.sid = decoded.sid || '';
              parsedState.ref = decoded.ref || '';
              parsedState.origin = decoded.origin || '';
              parsedState.platform = decoded.platform || 'web';
              parsedState.mode = decoded.mode || 'popup';
            }
          } catch (e) {}
        }

        function broadcastMessage(payload) {
          try {
            if (typeof BroadcastChannel !== 'undefined') {
              var bc = new BroadcastChannel('coinpulse_auth');
              bc.postMessage(payload);
              setTimeout(function() { bc.close(); }, 500);
            }
          } catch (e) {}

          try {
            localStorage.setItem('coinpulse_auth_event', JSON.stringify({
              ts: Date.now(),
              payload: payload
            }));
          } catch (e) {}

          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage(payload, '*');
            }
          } catch (e) {}
        }

        function showResultUI(isSuccess, title, message, btnLabel, onBtnClick) {
          if (spinnerEl) spinnerEl.style.display = 'none';
          if (iconBoxEl) {
            iconBoxEl.style.display = 'flex';
            iconBoxEl.className = 'icon-box ' + (isSuccess ? 'icon-success' : 'icon-error');
            iconBoxEl.textContent = isSuccess ? '✓' : '!';
          }
          if (titleEl) titleEl.textContent = title;
          if (statusEl) statusEl.textContent = message;
          if (actionBtnEl) {
            actionBtnEl.style.display = 'block';
            actionBtnEl.textContent = btnLabel;
            actionBtnEl.onclick = onBtnClick;
          }
        }

        function closeOrReturn(sessionToken) {
          if (parsedState.platform === 'capacitor' && sessionToken) {
            var deepLink = 'com.coinpulse.mining://auth?token=' + encodeURIComponent(sessionToken);
            window.location.href = deepLink;
            return;
          }
          try {
            window.close();
          } catch (e) {}
        }

        if (oauthError || !idToken) {
          var friendlyError =
            oauthError === 'access_denied'
              ? 'Google sign-in was cancelled.'
              : oauthErrorDesc || oauthError || 'Authentication was cancelled or no Google credential was returned.';

          fetch('/api/auth/google/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              authSessionId: parsedState.sid,
              error: friendlyError
            })
          }).catch(function() {});

          broadcastMessage({
            type: 'GOOGLE_AUTH_ERROR',
            sid: parsedState.sid,
            error: friendlyError
          });

          showResultUI(
            false,
            'Google Sign-In Cancelled',
            friendlyError + ' You may now close this window and return to CoinPulse.',
            'Close Window',
            function() { closeOrReturn(''); }
          );

          setTimeout(function() {
            closeOrReturn('');
          }, 900);
          return;
        }

        // Verify the Google credential directly with the CoinPulse backend to create the authenticated session
        fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: idToken,
            referralCode: parsedState.ref || undefined,
            authSessionId: parsedState.sid || undefined
          })
        })
          .then(function(r) {
            return r.json().then(function(data) {
              return { ok: r.ok, data: data };
            });
          })
          .then(function(result) {
            if (!result.ok || !result.data || !result.data.success) {
              var errMsg = (result.data && result.data.error) || 'Failed to verify Google credential on server.';
              broadcastMessage({
                type: 'GOOGLE_AUTH_ERROR',
                sid: parsedState.sid,
                error: errMsg
              });
              showResultUI(
                false,
                'Authentication Failed',
                errMsg,
                'Close Window',
                function() { closeOrReturn(''); }
              );
              return;
            }

            var sessionData = result.data;

            // Persist session token in localStorage for same-origin tabs
            try {
              localStorage.setItem('coinpulse_session_token', sessionData.token);
            } catch (e) {}

            // Notify main CoinPulse app across all channels
            broadcastMessage({
              type: 'GOOGLE_AUTH_SUCCESS',
              sid: parsedState.sid,
              token: idToken,
              session: sessionData
            });

            var username = (sessionData.user && sessionData.user.username) ? '@' + sessionData.user.username : 'Miner';
            showResultUI(
              true,
              'Signed In as ' + username,
              'Your CoinPulse account is now active. Returning to the app automatically...',
              parsedState.platform === 'capacitor' ? 'Open CoinPulse App' : 'Close Window',
              function() { closeOrReturn(sessionData.token); }
            );

            setTimeout(function() {
              closeOrReturn(sessionData.token);
            }, 350);
          })
          .catch(function(err) {
            var netMsg = (err && err.message) || 'Network error verifying Google sign-in.';
            broadcastMessage({
              type: 'GOOGLE_AUTH_ERROR',
              sid: parsedState.sid,
              error: netMsg
            });
            showResultUI(
              false,
              'Connection Error',
              netMsg,
              'Close Window',
              function() { closeOrReturn(''); }
            );
          });
      })();
    </script>
  </body>
</html>`);
  });

  if (!isProduction) {
    // Vite middleware in development
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    // Static files in production
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `CoinPulse full-stack server running on http://0.0.0.0:${PORT} (hasGoogleClientId=${hasGoogleClientIdConfigured()})`
    );
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
