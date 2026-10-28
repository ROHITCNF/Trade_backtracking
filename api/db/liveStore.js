// The Postgres state store for the live session (server/session.js), the same
// { load, save, logDecision } shape as the file store in server/state.js. A web
// host's disk does not survive a restart; these tables do.

function createLiveStore(pool) {
  return {
    async load(date) {
      const { rows } = await pool.query('select symbol, position from live_state where date = $1', [date]);
      return { date, symbols: Object.fromEntries(rows.map((r) => [r.symbol, { position: r.position }])) };
    },

    // Upserts every symbol in the snapshot. Saving the same state twice is a no-op.
    async save({ date, symbols }) {
      const names = Object.keys(symbols);
      if (!names.length) return;
      await pool.query(
        `insert into live_state (date, symbol, position)
         select $1, symbol, position from unnest($2::text[], $3::text[]) as t(symbol, position)
         on conflict (date, symbol) do update set position = excluded.position, updated_at = now()
         where live_state.position is distinct from excluded.position`,
        [date, names, names.map((s) => symbols[s].position)]
      );
    },

    // Logs the event and opens or closes that symbol's paper trade, together.
    // A repeated ENTRY leaves the open trade alone; an EXIT only closes it.
    async logDecision(date, event) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          'insert into live_decisions (date, symbol, kind, payload) values ($1, $2, $3, $4)',
          [date, event.symbol, event.kind, JSON.stringify(event)]
        );
        if (event.kind === 'ENTRY') {
          await client.query(
            `insert into paper_trades (date, symbol, status, side, quantity, entry_time, entry, sl, target)
             values ($1, $2, 'open', $3, $4, $5, $6, $7, $8)
             on conflict (date, symbol) do nothing`,
            [date, event.symbol, event.side, event.quantity, event.time, event.price, event.sl, event.target ?? null]
          );
        } else if (event.kind === 'EXIT') {
          await client.query(
            `update paper_trades set status = 'closed', exit_time = $3, exit = $4, reason = $5, pnl = $6,
               updated_at = now()
             where date = $1 and symbol = $2`,
            [date, event.symbol, event.time, event.price, event.reason, event.pnl]
          );
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = { createLiveStore };
