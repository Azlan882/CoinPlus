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

  // OAuth 2.0 / OpenID Connect callback page for popup flows
  app.get(['/auth/callback', '/auth/callback/'], (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>CoinPulse - Google Authentication</title>
    <style>
      body {
        background-color: #070b14;
        color: #f1f5f9;
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        text-align: center;
        padding: 20px;
      }
      .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid rgba(0, 242, 254, 0.2);
        border-top-color: #00f2fe;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 16px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div class="spinner"></div>
    <h3>Verifying Google Authentication...</h3>
    <p style="color: #94a3b8; font-size: 13px;">Please wait while we complete your sign-in.</p>
    <script>
      (function() {
        // Extract id_token or access_token from URL fragment hash or query params
        var hash = window.location.hash.substring(1);
        var params = new URLSearchParams(hash || window.location.search);
        var idToken = params.get('id_token') || params.get('access_token') || params.get('token');

        if (idToken) {
          if (window.opener) {
            window.opener.postMessage({
              type: 'GOOGLE_AUTH_SUCCESS',
              token: idToken
            }, '*');
            setTimeout(function() { window.close(); }, 300);
          } else {
            // Direct window: save to sessionStorage and redirect
            sessionStorage.setItem('pending_google_token', idToken);
            window.location.href = '/';
          }
        } else {
          var error = params.get('error') || 'Authentication was cancelled or failed.';
          if (window.opener) {
            window.opener.postMessage({
              type: 'GOOGLE_AUTH_ERROR',
              error: error
            }, '*');
            setTimeout(function() { window.close(); }, 1200);
          } else {
            alert(error);
            window.location.href = '/';
          }
        }
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
