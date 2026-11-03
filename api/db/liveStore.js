// The Postgres state store for the live session (server/session.js), the same
// { load, save, logDecision } shape as the file store in server/state.js. A web
// host's disk does not survive a restart; these tables do.

function createLiveStore(pool) {
  return {
    // An open position comes back with its levels from paper_trades, so a
    // restart keeps managing it on ticks (D24). The fixed flow's levels sit on
    // the symbol itself, as before; an open trail trade comes back under
    // `trail`, with the stop it had stepped to and its best price.
    async load(date) {
      const { rows } = await pool.query('select symbol, position from live_state where date = $1', [date]);
      const open = await pool.query(
        `select symbol, flow, side, entry, sl, target, quantity, entry_time as "entryTime", initial_sl as "initialSl", best, sl_time as "slTime"
         from paper_trades where date = $1 and status = 'open'`,
        [date]
      );
      const levels = new Map();
      for (const { symbol, flow, initialSl, best, slTime, ...p } of open.rows) {
        levels.set(`${symbol}|${flow}`, flow === 'trail' ? { ...p, initialSl, best, slTime } : p);
      }
      return {
        date,
        symbols: Object.fromEntries(
          rows.map(({ symbol, position }) => {
            if (position !== 'OPEN') return [symbol, { position }];
            const fixed = levels.get(`${symbol}|fixed`);
            const trail = levels.get(`${symbol}|trail`);
            return [symbol, { position, ...fixed, ...(trail && { trail }) }];
          })
        ),
      };
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

    // Logs the event and opens or closes that symbol's paper trade for the
    // event's flow (no flow = 'fixed'), together. A repeated ENTRY leaves the
    // open trade alone; an EXIT only closes it; a TRAIL moves an open trail
    // trade's stop and best price.
    async logDecision(date, event) {
      const flow = event.flow || 'fixed';
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          'insert into live_decisions (date, symbol, kind, payload) values ($1, $2, $3, $4)',
          [date, event.symbol, event.kind, JSON.stringify(event)]
        );
        if (event.kind === 'ENTRY') {
          await client.query(
            `insert into paper_trades (date, symbol, flow, status, side, quantity, entry_time, entry, sl, target, initial_sl, best)
             values ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11)
             on conflict (date, symbol, flow) do nothing`,
            [date, event.symbol, flow, event.side, event.quantity, event.time, event.price, event.sl, event.target ?? null,
              flow === 'trail' ? event.sl : null, flow === 'trail' ? (event.best ?? event.price) : null]
          );
        } else if (event.kind === 'EXIT') {
          await client.query(
            `update paper_trades set status = 'closed', exit_time = $4, exit = $5, reason = $6, pnl = $7,
               updated_at = now()
             where date = $1 and symbol = $2 and flow = $3`,
            [date, event.symbol, flow, event.time, event.price, event.reason, event.pnl]
          );
        } else if (event.kind === 'TRAIL') {
          await client.query(
            `update paper_trades set sl = $4, best = $5, sl_time = $6, updated_at = now()
             where date = $1 and symbol = $2 and flow = 'trail' and $3 = 'trail' and status = 'open'`,
            [date, event.symbol, flow, event.sl, event.best, event.time]
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
