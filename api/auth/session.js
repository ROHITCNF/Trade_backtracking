// Session tokens (hld § Authentication): base64url(JSON payload) + "." +
// base64url(HMAC-SHA256(SESSION_SECRET, payload)). Stateless, so there is no
// session table; changing SESSION_SECRET logs every browser out.

const crypto = require('crypto');

const SESSION_MS = 7 * 24 * 3600 * 1000; // D4

const mac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function signSession(secret, now = Date.now()) {
  const exp = now + SESSION_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return { token: `${payload}.${mac(payload, secret)}`, expiresAt: exp };
}

// The payload if the token is genuine and unexpired, else null.
function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(data.exp) && data.exp > now ? data : null;
  } catch {
    return null;
  }
}

module.exports = { signSession, verifySession, SESSION_MS };
