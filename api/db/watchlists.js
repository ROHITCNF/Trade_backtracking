// Seeds the app's watchlists from lists/*.txt (D1, D2). Runs on every boot.
// The first boot (empty table) seeds them all; after that the app never reads
// lists/ again, except that a seed marked `ensure` is added if its name is
// missing, so a list introduced later (D22's `live`) reaches databases seeded
// before it existed. Ensured lists are read-only, so they can't be deleted.

const { readTickers } = require('../../src/tickers');
const { withTransaction } = require('./pool');

const SEEDS = [
  { file: 'core.txt', name: () => 'core', readOnly: false },
  { file: 'final.txt', name: () => 'final', readOnly: false },
  { file: 'fno.txt', name: (n) => `F&O – ${n}`, readOnly: true },
  // What the live paper session trades (D22): core + final + F&O filler, under
  // the 100-symbol websocket cap of the Fyers Standard plan.
  { file: 'live.txt', name: () => 'live', readOnly: true, ensure: true },
];

async function insertSymbols(client, watchlistId, symbols) {
  await client.query(
    `insert into watchlist_symbols (watchlist_id, symbol)
     select $1, s from unnest($2::text[]) as s on conflict do nothing`,
    [watchlistId, symbols]
  );
}

// Returns the names seeded, or [] when there was nothing to add.
function seedWatchlists(pool, { read = readTickers } = {}) {
  return withTransaction(pool, async (client) => {
    // Serialise concurrent boots; the second finds the rows and stops.
    await client.query('lock table watchlists in exclusive mode');
    const { rows } = await client.query('select name from watchlists');
    const existing = new Set(rows.map((r) => r.name));
    const names = [];
    for (const seed of SEEDS) {
      if (existing.size > 0 && !seed.ensure) continue;
      const symbols = read(seed.file);
      const name = seed.name(symbols.length);
      if (existing.has(name)) continue;
      const res = await client.query(
        `insert into watchlists (name, source, read_only, source_file) values ($1, 'seed', $2, $3) returning id`,
        [name, seed.readOnly, seed.file]
      );
      await insertSymbols(client, res.rows[0].id, symbols);
      names.push(name);
    }
    return names;
  });
}

module.exports = { seedWatchlists, insertSymbols };
