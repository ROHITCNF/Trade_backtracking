# Review checklist: area:db

- [ ] A new migration is a new numbered file in `api/db/migrations/`. Applied migrations are never edited.
- [ ] Migrations are additive or have a safe backfill. Nothing drops or rewrites data the live session needs mid-day.
- [ ] Queries are parameterised (`$1`). No string-built SQL from request input.
- [ ] Multi-statement writes that must agree use `withTransaction`.
- [ ] New queries on large tables (`trades`, `run_symbols`, `live_decisions`) hit an index, or the PR says why not.
- [ ] Tests run on a throwaway DB via `test/db.js` (`createTestDb`), and pass in CI's Postgres job.
- [ ] Nothing in the diff, PR body or tests contains a real connection string. The production `DATABASE_URL` is never used locally.
