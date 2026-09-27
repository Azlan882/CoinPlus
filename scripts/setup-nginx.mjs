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
  ngx.header["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-CoinPulse-Checkpoint, Accept, Cache-Control, Pragma"
  ngx.header["Access-Control-Expose-Headers"] = "X-CoinPulse-Checkpoint, X-CoinPulse-Warmup"
  ngx.header["Access-Control-Max-Age"] = "86400"
  return ngx.exit(204)
end
if string.match(ngx.var.uri, "^/api/") or string.match(ngx.var.uri, "^/auth/callback") then
  local origin = ngx.var.http_origin
  if origin and origin ~= "" then
    ngx.header["Access-Control-Allow-Origin"] = origin
    ngx.header["Access-Control-Allow-Credentials"] = "true"
  else
    ngx.header["Access-Control-Allow-Origin"] = "*"
  end
  ngx.header["Access-Control-Expose-Headers"] = "X-CoinPulse-Checkpoint, X-CoinPulse-Warmup"
  return
end`;

      if (!luaContent.includes('return ngx.exit(204)')) {
        if (luaContent.includes('-- Allow CORS preflight, OAuth callback, and API routes')) {
          luaContent = luaContent.replace(
            /-- Allow CORS preflight, OAuth callback, and API routes[\s\S]*?end(?:\s*if string\.match[\s\S]*?end)?/,
            updatedBypass
          );
          fs.writeFileSync(luaPath, luaContent, 'utf8');
          changed = true;
        } else if (luaContent.includes('-- Allow OAuth callback and API routes')) {
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

    for (const confFile of [nginxConfPath, nginxTemplatePath]) {
      if (fs.existsSync(confFile)) {
        try {
          fs.chmodSync(confFile, 0o644);
        } catch {}
        let confContent = fs.readFileSync(confFile, 'utf8');
        const warmupCorsBlock = `location /warmup.html {
            internal;
            add_header 'Access-Control-Allow-Origin' '$http_origin' always;
            add_header 'Access-Control-Allow-Credentials' 'true' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PATCH, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-CoinPulse-Checkpoint, Accept, Cache-Control, Pragma' always;
            add_header 'Access-Control-Expose-Headers' 'X-CoinPulse-Checkpoint, X-CoinPulse-Warmup' always;
            add_header 'X-CoinPulse-Warmup' '1' always;`;

        if (!confContent.includes('Access-Control-Expose-Headers')) {
          if (confContent.includes("add_header 'X-CoinPulse-Warmup' '1' always;")) {
            confContent = confContent.replace(
              /location \/warmup\.html \{[\s\S]*?add_header 'X-CoinPulse-Warmup' '1' always;/,
              warmupCorsBlock
            );
            fs.writeFileSync(confFile, confContent, 'utf8');
            changed = true;
          } else if (confContent.includes('location /warmup.html {\n            internal;')) {
            confContent = confContent.replace(
              'location /warmup.html {\n            internal;',
              warmupCorsBlock
            );
            fs.writeFileSync(confFile, confContent, 'utf8');
            changed = true;
          }
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
