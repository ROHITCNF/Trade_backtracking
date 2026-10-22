// Web service settings, read from the environment (hld § Configuration). Read
// once at boot, after .env is loaded; nothing else in api/ touches process.env
// for these.

// Vite's dev server, so local development needs no FRONTEND_URL.
const DEV_FRONTEND = 'http://localhost:5173';

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const missing = ['DATABASE_URL', ...(production ? ['FRONTEND_URL'] : [])].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Fill it in .env (see .env.example).`);

  return {
    production,
    port: Number(env.PORT) || 4000,
    // Render routes to 0.0.0.0; locally, stay on loopback.
    host: production ? '0.0.0.0' : '127.0.0.1',
    frontendUrl: (env.FRONTEND_URL || DEV_FRONTEND).replace(/\/$/, ''),
  };
}

module.exports = { loadConfig };
