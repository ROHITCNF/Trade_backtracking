// App login (FR-1–FR-4) and the session check every other route sits behind.
// One user, defined by APP_PASSWORD_HASH; logging out is the browser dropping
// its token.

const bcrypt = require('bcryptjs');
const { signSession, verifySession } = require('../auth/session');
const { createLoginLimiter } = require('../auth/loginLimiter');
const { httpError } = require('../errors');

// Reachable without a session (FR-2). The Fyers callback is a browser redirect
// from Fyers; its one-time state is what authenticates it (#24).
const PUBLIC = new Set(['/api/login', '/api/health', '/auth/fyers/callback']);

const bearer = (header) => (header && header.startsWith('Bearer ') ? header.slice(7) : null);

async function authRoutes(app, { config, limiter = createLoginLimiter() }) {
  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS' || PUBLIC.has(request.url.split('?')[0])) return;
    const session = verifySession(bearer(request.headers.authorization), config.sessionSecret);
    if (!session) throw httpError(401, 'Not logged in');
    request.session = session;
  });

  app.post(
    '/api/login',
    { schema: { body: { type: 'object', required: ['password'], properties: { password: { type: 'string', maxLength: 200 } } } } },
    async (request, reply) => {
      const wait = limiter.retryAfter(request.ip);
      if (wait > 0) {
        reply.header('retry-after', Math.ceil(wait / 1000));
        throw httpError(429, 'Too many attempts. Try again later.');
      }
      if (!(await bcrypt.compare(request.body.password, config.passwordHash))) {
        limiter.fail(request.ip);
        throw httpError(401, 'Wrong password');
      }
      limiter.succeed(request.ip);
      return signSession(config.sessionSecret);
    }
  );
}

// Registered unencapsulated (what fastify-plugin does) so the hook covers every
// route, and after @fastify/cors so 401s still carry CORS headers.
authRoutes[Symbol.for('skip-override')] = true;

module.exports = { authRoutes };
