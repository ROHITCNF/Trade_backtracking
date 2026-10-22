# backtestV2

Opening Range Breakout (ORB) backtester for NSE stocks on 1-minute Fyers data, with a paper
live runner. A deployed web dashboard is being added — see [docs/](docs/).

## Status

| part | state |
|---|---|
| Backtest engine + CLI reports | working |
| Paper live runner (`server/`) | working, places no orders |
| Web app (v1) | designed — [intent](docs/intent.md) · [spec](docs/spec.md) · [hld](docs/hld.md) |

## Strategy in one paragraph

Each trading day, the high and low of 09:15–09:29 IST form the opening range. From 09:30, the
first candle that breaks the high goes long, or the low goes short (`direction`). One trade
per day. The stop is a percentage of entry, the opposite range edge, or the tighter or wider
of the two (`slMode`). The target is a multiple of risk, a percentage, or none
(`targetMode`). Anything still open closes at 15:14. The modelling is pessimistic on
purpose: gaps fill at the open, a candle touching both stop and target counts as a stop,
and a bar breaking both edges is skipped.

## Setup

Requires Node 18+ and a Fyers API app (Standard plan is enough).

```bash
npm install
cp .env.example .env      # fill FYERS_APP_ID, FYERS_SECRET_ID, FYERS_REDIRECT_URI
npm run login             # once per trading day; saves data/token.json
```

## Usage

```bash
npm start                    # backtest config.symbol → out/report.html
npm run report               # same, then open it
npm run sweep                # compare every profit-target rule on the same candles
node runAll.js 5             # first 5 tickers of lists/fno.txt, one page each
npm run final                # every ticker in lists/final.txt
npm run core                 # one summary page over lists/core.txt → out/summary.html
npm run live                 # paper live runner
npm run today                # today's live decision log
```

Every setting is in [`config.js`](config.js). Each run also writes
`data/trades/<SYMBOL>.json` and `.csv`.

**Rate limits:** the Fyers Standard plan allows 50 data calls/min and 5,000/day, and three
per-minute breaches block the account for the day. All calls are spaced ≥1.3 s apart and
capped at 4,800/day. A year of 1-minute data costs about 7 calls per symbol, so the full
`fno.txt` list (207 symbols) takes roughly 30 minutes.

## Layout

```
config.js        every tunable knob
src/             engine (pure), metrics, Fyers fetch + throttle, reports
server/          live paper runner — see server/architecture.md
lists/           watchlists: core (39), final (17), fno (207)
research/        parked strategy research (EMA20/VWAP)
docs/            web app intent, spec, high-level design
```

More detail for contributors is in [CLAUDE.md](CLAUDE.md).
