# Parked: EMA20 / VWAP pullback strategy

Status: **researched, not built.** Nothing in `src/` or `server/` was changed for this.
The ORB strategy and the live runner are untouched.

Picked up later? Read this first, then re-run `research/emavwap.js` to reproduce every
number below before trusting any of it.

---

## The strategy as described

From a veteran trader, relayed second-hand:

- Timeframe **5 minutes**
- 20 EMA crosses **above** VWAP → long bias; crosses **below** → short bias
- All entries taken **on a pullback to the 20 EMA**, not at the cross

Rules we pinned down in conversation:

| question | answer |
|---|---|
| What counts as touching the EMA? | undecided — test `low <= ema <= high` and "close within X%" |
| Must price extend away first? | undecided — test |
| How late can a trade start? | no new entry after **13:00**; open trades exit at `config.sessionEnd` |
| Where is the stop? | undecided — test 1:1 and 1:2 against various stop widths |
| Trades per day | **one maximum** |

---

## What the data said

8 symbols (LAURUSLABS, PAYTM, CDSL, ITC, INFY, LODHA, VEDL, NBCC), 5-minute candles,
2026-01-01 → 2026-09-23, 180 trading days.

### The structure is real

- Crossings before 13:00: **0.5–0.9 per day per symbol.** Infrequent enough to be a
  regime signal rather than noise — this was the first thing worth checking and it passed.
- A pullback to the EMA follows a cross **~60% of the time** (44–74% by symbol).
- Typical wait: **5 bars (25 min)**, p75 9 bars.
- Price extends a median **0.39%** from the EMA before pulling back.

### But the naive rule has no edge

"Edge" below = median MFE − median MAE after entry, held to session end. It needs to be
clearly positive; for reference the ORB work showed roughly +0.4 on comparable measures.

```
setup                                  n    MFEp50  MAEp50   edge   EODmean
CROSSOVER entry, no gap filter        573    0.56    0.55   +0.01   +0.083
PULLBACK  entry, no gap filter        352    0.51    0.48   +0.03   +0.102
```

Every stop/target combination on the unfiltered set lost money or scratched:

```
stop 0.5%  1:1 -> 137W/172L  net -17.5%
stop 0.75% 1:1 -> 116W/121L  net  -3.8%
stop 1%    1:1 ->  83W/ 80L  net  +3.0%   (51% hit rate — noise)
any        1:2 -> net -17% to -28%
```

1:2 was strictly worse than 1:1 everywhere: 2R targets sit near 1.0–1.5%, which only the
p75 setup ever reaches, so you convert winners into EOD exits and keep every loss.

### Filters that did NOT help

Tried and rejected — do not spend time here again:

| filter | effect on edge |
|---|---|
| First crossing of the day only | +0.04 (no change) |
| VWAP slope ≥ 0.05% over 5 bars | **−0.05** (worse) |
| VWAP slope ≥ 0.10% | **−0.05** (worse) |
| Pullback bar volume < 0.8× average | **−0.05** (worse) |
| All three combined | **−0.23** (much worse, 36 setups) |

Tightening toward "cleaner" setups made it worse, which is the signature of filtering
noise rather than finding quality.

### CORRECTION — the finding below was an artifact

**Read this before the section that follows.** Everything above and below was computed with
the 20 EMA **reset daily**. TradingView does not reset it — the screenshot reads
`VWAP hlc3 Session` (resets) but `EMA 20 close` (continuous across sessions). So the
indicator tested was not the indicator the trader is looking at.

Re-run with a continuous EMA and the conclusions invert:

```
                         daily-reset EMA     continuous EMA (correct)
CROSS, no gap                  +0.01                +0.10
CROSS, gap>=0.10%              +0.21                -0.01
CROSS, gap>=0.20%              +0.20                -0.19
PULLBACK, no gap               +0.03                +0.13
PULLBACK, gap>=0.20%           +0.07                +0.06
STATE at 10:00, gap>=0.10%       n/a                -0.09
```

With the correct indicator:

- **The gap filter does not work.** Filtering harder makes it worse (-0.01, -0.19, -0.15).
  The +0.21 was measuring how far price had run since the open, not regime strength,
  because a daily-reset EMA is meaningless for its first ~20 bars.
- **The pullback does add value** — +0.13 versus +0.10 for entering at the cross. Small,
  but it is the direction the trader claimed, and the opposite of what the broken version
  said.
- **Trading the state rather than the crossing tests negative** at every decision time
  from 09:30 to 11:00. Being above VWAP at a given hour does not predict the rest of the day.
- Best case overall is **edge +0.13, EOD mean +0.112%** — against roughly +0.4 for the ORB
  strategy already running. Nothing here is competitive with what exists.

A 20-period EMA on 5-minute candles needs 100 minutes of bars. Any future work must carry
the EMA across sessions or the indicator is not valid before ~10:55.

### The finding that changes things (SUPERSEDED — see correction above)

Prompted by a TradingView screenshot where EMA read 1,256.92 and VWAP 1,256.86 — a 0.005%
gap. **Most "crossovers" are two lines hugging, not a regime change.** Requiring the EMA to
actually separate from VWAP after crossing:

```
setup                                  n    MFEp50  MAEp50   edge   EODmean
CROSSOVER entry, no gap filter        573    0.56    0.55   +0.01   +0.083
CROSSOVER entry, gap>=0.10% (3 bars)  186    0.82    0.61   +0.21   +0.163
CROSSOVER entry, gap>=0.20% (5 bars)  109    0.90    0.70   +0.20   +0.273
CROSSOVER entry, gap>=0.30% (8 bars)   90    0.83    0.70   +0.13   +0.258

PULLBACK  entry, gap>=0.10% (3 bars)   84    0.62    0.52   +0.10   +0.188
PULLBACK  entry, gap>=0.30% (8 bars)   41    0.89    0.50   +0.39   +0.303
```

Two conclusions:

1. **The crossover was the broken link, not the pullback.** Pullback alone adds ~nothing
   (+0.03 vs +0.01). The separation filter takes the same entry from +0.01 to +0.21.
2. The edge holds across gap 0.10 → 0.30 (+0.21, +0.20, +0.13). A plateau is more
   convincing than a peak. **Ignore the +0.39 row — 41 setups is the noise floor.**

### Caveats attached to all of the above

- **EOD win rate is ~51% everywhere.** The edge is in magnitude, not hit rate.
- **+0.21 is modest.** Median winner 0.82% against a median adverse move of 0.61%. A
  0.10% round trip in costs eats a meaningful slice.
- Costs were **not** modelled in any of these numbers.
- 8 symbols, one regime, nine months.

---

## What to do next, in order

The honest position after the correction: **best measured edge is +0.13, versus ~+0.4 for
the ORB strategy already live.** There is no strong reason to build this. Only continue if
the trader supplies a missing rule.

1. **Ask the trader what makes him skip a cross** — and whether his EMA is session-reset or
   continuous. Every number here says the edge lives in whatever that answer is. This is
   the single highest-value action and it costs nothing.
2. If he adds a rule, re-run `research/emavwap.js` with it. Keep the EMA continuous.
3. **Only if edge clears ~+0.3** on 39 symbols, test stop/target with `costBps: 5` and
   slippage on market exits.
4. **Then, and only then, refactor** (see below).

Do not spend time on: the gap/separation filter, VWAP slope, quiet-volume, first-cross-only,
or trading the state at a fixed time. All measured neutral-to-negative with the correct
indicator.

**Ask the trader one question:** *what makes him skip a cross?* Every number above says his
edge lives in whatever that answer is. The separation filter is probably part of it, but
almost certainly not all of it.

---

## Code architecture, if it gets built

The trade record is the contract. `metrics.js`, `report.js`, `tradeLog.js`, `runAll.js`,
`summary.js` and the entire live runner consume `trades[]` and nothing else. Any strategy
emitting the same shape inherits all of it — **including live trading, with no changes to
`server/`.**

Proposed split:

```
src/
  engine.js          thin dispatcher — group by day, call the strategy, sort
  strategies/
    orb.js           today's logic, moved verbatim, not rewritten
    emaVwap.js       new
  tradeUtils.js      shared: buildTrade, checkExit, resolveQuantity
  indicators.js      ema(), vwap() — pure, unit-testable
```

Each strategy exports `simulateDay(date, candles, config) -> trade | null`.
`config.strategy` picks one; `config.resolution` becomes `'5'` for this strategy.

**Regression gate:** run all 39 symbols before the refactor, save the trades, run after,
diff. Zero differences, or the refactor is wrong. Same technique that caught the live-path
bugs.

### One code change needed regardless

`src/engine.js` `groupByDay()` destructures `[t, o, h, l, c]` and drops volume. VWAP needs
it. `src/fetch.js` already stores the API response verbatim, so **volume is in the cache** —
it's only discarded at this one line.

---

## Reproducing this

```bash
node research/emavwap.js
```

Needs 5-minute candles cached. Fetch with `resolution: '5'` — note the cache filename
carries the resolution, so 1-minute and 5-minute data coexist without collision.
