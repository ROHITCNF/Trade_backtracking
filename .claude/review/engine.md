# Review checklist: area:engine

Read `.claude/skills/engine-rules/SKILL.md` first. For each item, cite the line or say "n/a".

- [ ] `src/engine.js` still imports only `./time`, `./util` and other pure modules. No clock, env or randomness.
- [ ] Gap fills: entry uses `max(orbHigh, open)` / `min(orbLow, open)`.
- [ ] Stop wins ties when one candle spans stop and target.
- [ ] The entry candle is checked for exits.
- [ ] Ambiguous both-edge candles are skipped, not assigned a side.
- [ ] One trade per day, no re-entry. EOD exit at `sessionEnd`.
- [ ] `computeStop` long/short asymmetry is intact (`Math.max` longs, `Math.min` shorts for "closer").
- [ ] New or changed behaviour has a test in `test/engine.test.js` that pins exact numbers.
- [ ] Rounding goes through `round()` from `src/util.js`. No float equality in comparisons that decide exits.
- [ ] Config knobs come from `config.js`. No new hard-coded thresholds.
- [ ] Any change to results for existing configs is called out in the PR and has a D-number.
