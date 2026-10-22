// Fyers OAuth (FR-5–FR-8, hld § Fyers OAuth) and the header's status call.
// Connect hands the browser a Fyers login URL carrying a one-time state; Fyers
// redirects the browser to the callback, which checks that state, exchanges
// the auth code for a token and sends the browser back to the frontend.

const crypto = require('crypto');
const fyers = require('../../src/fyers');
const { setClientName, readClientName } = require('../db/fyersStore');

const STATE_TTL = "interval '10 minutes'";

async function fyersRoutes(app, { config, newClient = fyers.newClient }) {
  const back = (reply, outcome) => reply.redirect(`${config.frontendUrl}/?fyers=${outcome}`);

  app.get('/api/fyers/connect', async () => {
    const state = crypto.randomBytes(32).toString('base64url');
    await app.db.query(`delete from oauth_state where created_at < now() - ${STATE_TTL}`);
    await app.db.query('insert into oauth_state (state) values ($1)', [state]);
    return { url: newClient().generateAuthCode({ state }) };
  });

  // Public: a browser redirect from Fyers carries no session. The state, used
  // once and only within 10 minutes, ties it to a Connect click (NFR-9).
  app.get('/auth/fyers/callback', async (request, reply) => {
    const { auth_code, state } = request.query;
    if (typeof state !== 'string' || typeof auth_code !== 'string' || !auth_code) {
      request.log.warn('fyers callback: missing auth_code or state');
      return back(reply, 'error');
    }
    const { rowCount } = await app.db.query(
      `delete from oauth_state where state = $1 and created_at > now() - ${STATE_TTL}`,
      [state]
    );
    if (!rowCount) {
      request.log.warn('fyers callback: unknown or expired state');
      return back(reply, 'error');
    }

    const client = newClient();
    let res;
    try {
      res = await client.generate_access_token({ client_id: process.env.FYERS_APP_ID, secret_key: process.env.FYERS_SECRET_ID, auth_code });
    } catch (err) {
      res = err;
    }
    if (!res || res.s !== 'ok' || !res.access_token) {
      // Log Fyers' code and message only; the response can echo credentials.
      request.log.warn({ code: res?.code, message: res?.message }, 'fyers callback: token exchange failed');
      return back(reply, 'error');
    }
    await fyers.saveToken(res.access_token);

    // Profile spends the user-info budget, not the data budget, so it skips
    // rest(). A failure here only costs the header its name.
    try {
      client.setAccessToken(res.access_token);
      const profile = await client.get_profile();
      await setClientName(app.db, profile?.data?.name ?? null);
    } catch (err) {
      request.log.warn({ code: err?.code }, 'fyers callback: profile lookup failed');
    }
    return back(reply, 'connected');
  });

  // Header state (FR-7, FR-8). Database reads only; never calls Fyers (NFR-6).
  app.get('/api/me', async (request) => {
    const [status, usage] = await Promise.all([fyers.tokenStatus(), fyers.usageToday()]);
    return {
      session: { expiresAt: request.session.exp },
      fyers: { ...status, clientName: status.connected ? await readClientName(app.db) : null },
      budget: { date: usage.date, used: usage.count, cap: usage.cap, paused: usage.limited },
    };
  });
}

module.exports = { fyersRoutes };
