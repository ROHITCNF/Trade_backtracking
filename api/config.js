// Web service settings, read from the environment (hld § Configuration). Read
// once at boot, after .env is loaded; nothing else in api/ touches process.env
// for these.

// Vite's dev server, so local development needs no FRONTEND_URL.
const DEV_FRONTEND = 'http://localhost:5173';

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const required = ['DATABASE_URL', 'APP_PASSWORD_HASH', 'SESSION_SECRET', ...(production ? ['FRONTEND_URL'] : [])];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Fill it in .env (see .env.example).`);

  if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');

  return {
    production,
    port: Number(env.PORT) || 4000,
    // Render routes to 0.0.0.0; locally, stay on loopback.
    host: production ? '0.0.0.0' : '127.0.0.1',
    frontendUrl: (env.FRONTEND_URL || DEV_FRONTEND).replace(/\/$/, ''),
    passwordHash: env.APP_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET,
    // Live paper trading (api/live.js). Off unless explicitly enabled.
    live: {
      enabled: env.LIVE_ENABLED === 'true',
      watchlist: env.LIVE_WATCHLIST || 'core',
    },
  };
}

module.exports = { loadConfig };
