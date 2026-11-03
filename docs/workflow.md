# Workflow

How work gets from an idea to `main` when Claude writes the code. The owner writes the idea and
approves the issue; skills and agents do the rest; CI and branch protection decide the merge.

## The loop

```
/feature "<idea>"  →  issue(s) with acceptance criteria      ← G1: owner approves the issue
/ship #N
  0 preflight   clean main; the issue has acceptance criteria; gated?
  1 branch      m<k>/<N>-<slug>  or  feat|fix|chore|docs/<N>-<slug>
  2 build       code + tests (test-writer for engine/live)
  3 local gate  npm test · web test · web build · lint
  4 e2e         e2e-tester: Playwright on the stub stack, light + dark screenshots
  5 learn       /decision, CLAUDE.md, checklists, committed before the PR opens
  6 open PR     pr-creator: template, labels (no auto-merge yet)
  7 review      pr-reviewer: checklists by label → VERDICT; ≤ 2 fix rounds, then the owner decides
  8 merge       auto-merge on green CI                       ← G2: engine/live/db wait for the owner
  9 report
```

Auto-merge is armed only after `VERDICT: APPROVE`, so CI can't merge ahead of review. The reviewer
posts as the owner's GitHub account, which can't approve its own PR, so it posts a comment
review and ends with a `VERDICT:` line.

## Skills (`.claude/skills/`)

| skill | runs | does |
|---|---|---|
| `/feature <idea>` | owner | idea → issue(s) with Why / Acceptance criteria / Out of scope / Design ref; big ideas → milestone + `docs/plan.md` section |
| `/ship #N` | owner | the loop above |
| `/review <PR>` | owner | pr-reviewer on any PR (Opus for engine/live/db) |
| `/e2e [focus]` | owner | e2e-tester on demand |
| `/decision <text>` | owner or Claude | next D-number in `docs/decisions.md` |
| `engine-rules` | auto-loaded | the four modelling choices, purity, IST, sanity checks |

## Agents (`.claude/agents/`)

| agent | model | may write | never |
|---|---|---|---|
| pr-creator | Haiku | a temp PR-body file | edit code, merge, arm auto-merge |
| e2e-tester | Haiku | `web/e2e/` | touch app code or `.env`, set `DATABASE_URL` |
| pr-reviewer | Sonnet (Opus when gated) | one PR comment | edit, push, approve, merge |
| test-writer | Sonnet | `test/`, `web/test/` | edit `src/`, `api/`, `server/`, `web/src/` |

Agent and skill definitions load when a Claude Code session starts; restart the session after
changing them.

## Guards (don't depend on the model)

- **CI** (`.github/workflows/ci.yml`): `core tests` (with Postgres, so DB tests run), `web tests + build`,
  `lint`, `e2e`. Branch protection on `main` requires them; auto-merge waits for green.
- **Biome** (`biome.json`, `npm run lint`): errors fail CI. Repo rules: `src/engine.js` imports nothing
  impure; `fyers-api-v3` only in `src/fyers.js` and `server/feed.js`. Warnings (a11y, hook deps) are
  reported, not enforced. The formatter is configured but not enforced, because adopting it would reformat ~4k lines.
- **Guard hook** (`.claude/hooks/guard.js`, `test/guard.test.js`): denies commands that would open
  `.env`'s production `DATABASE_URL`, read `.env`, or name the Neon host; asks before scripts that
  spend Fyers REST budget. It reads command text, so PR and issue bodies go through `-F <file>`.

## Conventions

- **Branches**: `m<k>/<issue>-<slug>` for milestone work, otherwise `<feat|fix|chore|docs>/<issue>-<slug>`.
- **PR titles**: Conventional Commits, `type(scope): summary`, scope ∈ engine, live, api, db, web,
  fyers, ci, claude.
- **Labels**: `area:engine|live|api|db|fyers|web|infra`. They pick the review checklists in
  `.claude/review/` and decide G2.
- **Squash-merge only** (the repo disables merge commits and rebase merges); the branch is deleted on merge.
- **Testing never touches production**: unit DB tests use `TEST_DATABASE_URL` on a local server;
  E2E uses `web/e2e/server.cjs` (its own throwaway database, Fyers stubbed).

## Local E2E and UI preview

```
pg_isready                       # local Postgres must be up
npm --prefix web run e2e         # starts the stub API + Vite, runs light and dark projects
node web/e2e/server.cjs & npm run web   # preview the UI on fake data; password e2e-password
```
The stub API listens on :4000, the same port as `npm run api`, so stop it (`kill %1`) before running
the real API. Ctrl-C/SIGTERM drops its throwaway database.
Screenshots: `web/e2e/screenshots/<theme>/`. In CI they're uploaded as the `e2e-screenshots` artifact.
