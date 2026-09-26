import https from 'node:https';

export interface GoogleTokenPayload {
  sub: string; // The unique and persistent Google User ID
  email: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  aud?: string;
  iss?: string;
}

/**
 * Safely retrieves and normalizes GOOGLE_CLIENT_ID from the server runtime environment
 * without exposing its value in logs. Ignores placeholder values from .env.example.
 */
export function getConfiguredGoogleClientId(): string {
  const raw = (process.env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
  if (
    !raw ||
    raw.includes('your-google-oauth-web-client-id') ||
    raw === 'MY_GOOGLE_CLIENT_ID'
  ) {
    return '';
  }
  return raw;
}

/**
 * Safe boolean diagnostic indicating whether GOOGLE_CLIENT_ID is present and valid.
 */
export function hasGoogleClientIdConfigured(): boolean {
  return Boolean(getConfiguredGoogleClientId());
}

/**
 * Verify Google ID Token / Access Token directly with Google's tokeninfo endpoint.
 * This cryptographically validates the token against Google's public keys.
 */
export async function verifyGoogleIdToken(token: string): Promise<GoogleTokenPayload> {
  if (!token || typeof token !== 'string') {
    throw new Error('Google token must be provided');
  }

  // Google provides official tokeninfo endpoints for ID tokens and access tokens:
  // https://oauth2.googleapis.com/tokeninfo?id_token=...
  // https://www.googleapis.com/oauth2/v3/userinfo (with Bearer token)
  const isIdToken = token.split('.').length === 3;

  if (isIdToken) {
    return new Promise((resolve, reject) => {
      const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
      const req = https.get(url, (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(rawData);
            if (res.statusCode !== 200 || data.error || data.error_description) {
              return reject(new Error(data.error_description || data.error || 'Invalid Google ID token'));
            }

            if (!data.sub || !data.email) {
              return reject(new Error('Google token did not contain valid subject or email claims'));
            }

            // Optional: verify audience if GOOGLE_CLIENT_ID is configured
            const configuredClientId = getConfiguredGoogleClientId();
            if (configuredClientId && data.aud && data.aud !== configuredClientId) {
              console.warn('[GoogleAuth] Audience warning: token aud claim did not match configured GOOGLE_CLIENT_ID');
            }

            resolve({
              sub: data.sub,
              email: data.email.toLowerCase().trim(),
              email_verified: data.email_verified === 'true' || data.email_verified === true,
              name: data.name || data.email.split('@')[0],
              given_name: data.given_name,
              family_name: data.family_name,
              picture: data.picture,
              aud: data.aud,
              iss: data.iss,
            });
          } catch (err: any) {
            reject(new Error(`Failed to parse Google verification response: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Network error contacting Google verification servers: ${err.message}`));
      });
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout contacting Google authentication verification servers'));
      });
    });
  } else {
    // If it's an OAuth access token, fetch from Google UserInfo endpoint
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'www.googleapis.com',
        path: '/oauth2/v3/userinfo',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'CoinPulse-Auth/1.0',
        },
      };

      const req = https.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(rawData);
            if (res.statusCode !== 200 || data.error) {
              return reject(new Error(data.error_description || data.error?.message || 'Invalid Google Access Token'));
            }

            if (!data.sub || !data.email) {
              return reject(new Error('Google profile did not contain valid subject or email'));
            }

            resolve({
              sub: data.sub,
              email: data.email.toLowerCase().trim(),
              email_verified: data.email_verified === true || data.email_verified === 'true',
              name: data.name || data.email.split('@')[0],
              given_name: data.given_name,
              family_name: data.family_name,
              picture: data.picture,
            });
          } catch (err: any) {
            reject(new Error(`Failed to parse Google userinfo response: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Network error contacting Google userinfo servers: ${err.message}`));
      });
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout contacting Google userinfo servers'));
      });
      req.end();
    });
  }
}
