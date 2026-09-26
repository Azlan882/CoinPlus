import fs from 'node:fs';
import { execSync } from 'node:child_process';

export function setupContainerNginx() {
  const luaPath = '/etc/nginx/user_auth_verification.lua';
  const nginxConfPath = '/etc/nginx/nginx.conf';
  let changed = false;

  try {
    if (fs.existsSync(luaPath)) {
      try {
        fs.chmodSync(luaPath, 0o644);
      } catch {}
      let luaContent = fs.readFileSync(luaPath, 'utf8');
      const updatedBypass =
        '-- Allow CORS preflight, OAuth callback, and API routes for mobile APK and external OAuth redirects\nif ngx.req.get_method() == "OPTIONS" or string.match(ngx.var.uri, "^/api/") or string.match(ngx.var.uri, "^/auth/callback") then\n  return\nend';

      if (!luaContent.includes('ngx.req.get_method() == "OPTIONS"')) {
        if (luaContent.includes('-- Allow OAuth callback and API routes')) {
          luaContent = luaContent.replace(
            /-- Allow OAuth callback and API routes[\s\S]*?end/,
            updatedBypass
          );
          fs.writeFileSync(luaPath, luaContent, 'utf8');
          changed = true;
        } else {
          const anchor = 'if ngx.var.host == "localhost" then\n  return\nend';
          if (luaContent.includes(anchor)) {
            luaContent = luaContent.replace(anchor, `${anchor}\n\n${updatedBypass}`);
            fs.writeFileSync(luaPath, luaContent, 'utf8');
            changed = true;
          }
        }
      }
    }

    if (fs.existsSync(nginxConfPath)) {
      try {
        fs.chmodSync(nginxConfPath, 0o644);
      } catch {}
      let confContent = fs.readFileSync(nginxConfPath, 'utf8');
      // Ensure /warmup.html and /forbidden.html include CORS headers so Android WebView never fails with opaque CORS TypeError during cold-start
      const warmupAnchor = 'location /warmup.html {\n            internal;';
      const warmupCorsBlock = `location /warmup.html {
            internal;
            add_header 'Access-Control-Allow-Origin' '$http_origin' always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PATCH, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-CoinPulse-Checkpoint' always;
            add_header 'X-CoinPulse-Warmup' '1' always;`;

      if (confContent.includes(warmupAnchor) && !confContent.includes('X-CoinPulse-Warmup')) {
        confContent = confContent.replace(warmupAnchor, warmupCorsBlock);
        fs.writeFileSync(nginxConfPath, confContent, 'utf8');
        changed = true;
      }
    }

    if (changed) {
      execSync('nginx -s reload', { stdio: 'ignore' });
    }
  } catch {
    // Ignore when not running inside the Nginx container environment
  }
}

setupContainerNginx();
