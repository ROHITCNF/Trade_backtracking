# Review checklist: area:fyers

- [ ] Every REST call goes through `rest()` in `src/fyers.js` (≥1.3 s spacing, 4,800/day stop, 429 latch). Biome blocks importing `fyers-api-v3` elsewhere.
- [ ] Call counts are reported (`onCall`) so runs record `calls_used` (D10).
- [ ] 429 is never retried. Transient errors retry at most twice with 2 s then 5 s backoff (D8).
- [ ] Market-status UI derives from the clock, not a Fyers call (D6).
- [ ] No token, app secret or auth code is logged, committed or put in a PR.
- [ ] Changes that raise call volume state the new estimate (calls per symbol-year) in the PR.
