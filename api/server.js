// The web app's HTTP API (hld § API surface). One process runs the API and the
// run worker: `npm run api`. Boot applies migrations, moves the Fyers token and
// REST throttle onto Postgres, resumes any unfinished run (FR-17) and starts the
// live paper scheduler when LIVE_ENABLED=true (api/live.js).

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { loadConfig } = require('./config');
const { errorHandler, notFoundHandler } = require('./errors');
const { authRoutes } = require('./routes/auth');
const { fyersRoutes } = require('./routes/fyers');
const { symbolRoutes } = require('./routes/symbols');
const { runRoutes } = require('./routes/runs');
const { analysisRoutes } = require('./routes/analysis');
const { watchlistRoutes } = require('./routes/watchlists');
const { liveRoutes } = require('./routes/live');

// Builds the app without listening, so tests can drive it with app.inject().
function buildApp({ pool, config, worker = null, symbols = null, live = null, logger = false, loginLimiter, newFyersClient, getCandles, tokenStatus }) {
  const app = Fastify({ logger, trustProxy: config.production });
  app.decorate('db', pool);
  app.decorate('worker', worker);
  app.decorate('symbols', symbols);
  app.decorate('live', live);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Only the frontend may call the API from a browser (NFR-9).
  app.register(cors, { origin: config.frontendUrl, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.register(authRoutes, { config, limiter: loginLimiter });
  app.register(fyersRoutes, { config, newClient: newFyersClient });
  if (symbols) app.register(symbolRoutes, { symbols });
  app.register(runRoutes, { symbols });
  app.register(analysisRoutes, { getCandles });
  app.register(watchlistRoutes);
  app.register(liveRoutes, { tokenStatus });

  // Liveness for Render: up, and the database answers.
  app.get('/api/health', async (request, reply) => {
    try {
      await pool.query('select 1');
      return { ok: true };
    } catch (err) {
      request.log.error({ err }, 'health check: database unreachable');
      return reply.code(503).send({ ok: false });
    }
  });

  return app;
}

async function start() {
  require('../src/env').loadEnv();
  const config = loadConfig();
  const { getPool } = require('./db/pool');
  const { migrate } = require('./db/migrate');
  const { createPgStore } = require('./db/fyersStore');
  const { setStore } = require('../src/fyers');
  const { createWorker } = require('./worker');
  const { createSymbolMaster } = require('./symbols');
  const { seedWatchlists } = require('./db/watchlists');
  const { createLiveScheduler } = require('./live');

  const pool = getPool();
  await migrate(pool);
  const seeded = await seedWatchlists(pool);
  if (seeded.length) console.log(`seeded watchlists: ${seeded.join(', ')}`);
  setStore(createPgStore(pool));

  const worker = createWorker({ pool });
  const symbols = createSymbolMaster();
  symbols.start(); // not awaited: boot does not wait on Fyers' file server
  const live = createLiveScheduler({ pool, ...config.live });
  const app = buildApp({ pool, config, worker, symbols, live, logger: true });
  await app.listen({ port: config.port, host: config.host });
  worker.wake();
  live.start();

  // Render sends SIGTERM before a deploy or restart: close the feed and flush
  // pending live-state writes so the next instance resumes cleanly.
  const shutdown = async () => {
    await live.stop().catch((err) => console.error(`live stop failed: ${err.message}`));
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return app;
}

module.exports = { buildApp };

if (require.main === module) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
