import fs from 'node:fs';
import { execSync } from 'node:child_process';

export function setupContainerNginx() {
  const luaPath = '/etc/nginx/user_auth_verification.lua';
  const nginxConfPath = '/etc/nginx/nginx.conf';
  const nginxTemplatePath = '/etc/nginx/nginx.conf.template';
  const nginxAuthIncludePath = '/etc/nginx/nginx_auth.conf.include';
  let changed = false;

  try {
    if (fs.existsSync(luaPath)) {
      try {
        fs.chmodSync(luaPath, 0o644);
      } catch {}
      let luaContent = fs.readFileSync(luaPath, 'utf8');
      const updatedBypass = `-- Allow CORS preflight, OAuth callback, and API routes for mobile APK and external OAuth redirects
if ngx.req.get_method() == "OPTIONS" then
  local origin = ngx.var.http_origin
  if not origin or origin == "" then
    origin = "*"
  end
  ngx.header["Access-Control-Allow-Origin"] = origin
  ngx.header["Access-Control-Allow-Credentials"] = "true"
  ngx.header["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
  ngx.header["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-CoinPulse-Token, X-CoinPulse-Checkpoint, Accept, Cache-Control, Pragma"
  ngx.header["Access-Control-Expose-Headers"] = "X-CoinPulse-Checkpoint, X-CoinPulse-Warmup"
  ngx.header["Access-Control-Max-Age"] = "86400"
  return ngx.exit(204)
end
-- Pass /api/ and /auth/callback to Express (Express sets single authoritative CORS headers)
if string.match(ngx.var.uri, "^/api/") or string.match(ngx.var.uri, "^/auth/callback") then
  return
end`;

      const startAnchor = 'if ngx.var.host == "localhost" then\n  return\nend';
      const endAnchor = '-- Block potentially malicious return_url values.';
      const targetSegment = `${startAnchor}\n\n${updatedBypass}\n\n${endAnchor}`;

      const startIdx = luaContent.indexOf(startAnchor);
      const endIdx = luaContent.indexOf(endAnchor);
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const currentSegment = luaContent.slice(startIdx, endIdx + endAnchor.length);
        if (currentSegment !== targetSegment) {
          luaContent =
            luaContent.slice(0, startIdx) +
            targetSegment +
            luaContent.slice(endIdx + endAnchor.length);
          fs.writeFileSync(luaPath, luaContent, 'utf8');
          changed = true;
        }
      }
    }

    for (const confFile of [nginxConfPath, nginxTemplatePath]) {
      if (fs.existsSync(confFile)) {
        try {
          fs.chmodSync(confFile, 0o644);
        } catch {}
        let confContent = fs.readFileSync(confFile, 'utf8');
        let fileModified = false;

        if (confContent.includes('error_page 403 = /forbidden.html;')) {
          confContent = confContent.replace('error_page 403 = /forbidden.html;', '# error_page 403 disabled for API JSON responses');
          fileModified = true;
        }

        const warmupCorsBlock = `location /warmup.html {
            internal;
            add_header 'Access-Control-Allow-Origin' '$http_origin' always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PATCH, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-CoinPulse-Token, X-CoinPulse-Checkpoint, Accept, Cache-Control, Pragma' always;
            add_header 'Access-Control-Expose-Headers' 'X-CoinPulse-Checkpoint, X-CoinPulse-Warmup' always;
            add_header 'X-CoinPulse-Warmup' '1' always;`;

        if (!confContent.includes('X-CoinPulse-Token')) {
          if (confContent.includes("add_header 'X-CoinPulse-Warmup' '1' always;")) {
            confContent = confContent.replace(
              /location \/warmup\.html \{[\s\S]*?add_header 'X-CoinPulse-Warmup' '1' always;/,
              warmupCorsBlock
            );
            fileModified = true;
          } else if (confContent.includes('location /warmup.html {\n            internal;')) {
            confContent = confContent.replace(
              'location /warmup.html {\n            internal;',
              warmupCorsBlock
            );
            fileModified = true;
          }
        }

        if (fileModified) {
          fs.writeFileSync(confFile, confContent, 'utf8');
          changed = true;
        }
      }
    }

    if (fs.existsSync(nginxAuthIncludePath)) {
      try {
        fs.chmodSync(nginxAuthIncludePath, 0o644);
      } catch {}
      let authInc = fs.readFileSync(nginxAuthIncludePath, 'utf8');
      const cookieAnchor = 'location = /__cookie_check.html {';
      const cookieReplacement = `location = /__cookie_check.html {
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Expose-Headers' 'X-CoinPulse-Checkpoint, X-CoinPulse-Warmup' always;
    add_header 'X-CoinPulse-Warmup' '1' always;`;
      if (authInc.includes(cookieAnchor) && !authInc.includes('X-CoinPulse-Warmup')) {
        authInc = authInc.replace(cookieAnchor, cookieReplacement);
        fs.writeFileSync(nginxAuthIncludePath, authInc, 'utf8');
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
