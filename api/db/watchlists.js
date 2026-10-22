// One-time seed of the app's watchlists from lists/*.txt (D1, D2). Runs on
// every boot but only acts while the table is empty, so after the first deploy
// the app never reads lists/ again; the CLI still does.

const { readTickers } = require('../../src/tickers');
const { withTransaction } = require('./pool');

const SEEDS = [
  { file: 'core.txt', name: () => 'core', readOnly: false },
  { file: 'final.txt', name: () => 'final', readOnly: false },
  { file: 'fno.txt', name: (n) => `F&O – ${n}`, readOnly: true },
];

async function insertSymbols(client, watchlistId, symbols) {
  await client.query(
    `insert into watchlist_symbols (watchlist_id, symbol)
     select $1, s from unnest($2::text[]) as s on conflict do nothing`,
    [watchlistId, symbols]
  );
}

// Returns the names seeded, or [] when watchlists already existed.
function seedWatchlists(pool, { read = readTickers } = {}) {
  return withTransaction(pool, async (client) => {
    // Serialise concurrent boots; the second finds the rows and stops.
    await client.query('lock table watchlists in exclusive mode');
    const { rows } = await client.query('select count(*)::int as n from watchlists');
    if (rows[0].n > 0) return [];
    const names = [];
    for (const seed of SEEDS) {
      const symbols = read(seed.file);
      const name = seed.name(symbols.length);
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
