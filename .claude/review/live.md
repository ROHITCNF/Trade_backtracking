# Review checklist: area:live

Read `server/architecture.md` and `.claude/skills/engine-rules/SKILL.md` first.

- [ ] Entries and levels still come from `runBacktest` (the engine). Nothing in `server/` re-derives the range, breakout, stop or target.
- [ ] D24: while a position is open, exits are decided on tick prices (first tick at/through stop or target; first tick at `sessionEnd` = EOD) and the engine is not re-asked.
- [ ] Blind periods (warm start, reconnect, EOD refresh) use REST candles with engine rules: stop wins ties, fill at the level.
- [ ] Restart restores open-position levels from `paper_trades` or state, never from the engine.
- [ ] No order placement. `broker/paper.js` only records.
- [ ] Websocket symbol count is ≤ 100 (Standard plan cap, D22).
- [ ] REST use (warm start, refresh, reconcile) goes through `rest()` and is counted.
- [ ] Postgres writes for decision + trade happen in one transaction (`liveStore.logDecision`).
- [ ] Tests: `test/liveSession.test.js`, `test/liveStore.test.js`, `test/reconcile.test.js` cover the change.
