# Workflow

You write the idea and approve the issue. Claude does the rest. CI decides the merge.

```
/feature "<idea>"  →  issue            ← you approve it (G1)
                      big idea: plan first ← you approve the plan (G0)
/ship #N           →  branch → code → tests → e2e → PR → review → merge
                                                    engine/live/db: you merge (G2)
```

## A walkthrough: "Show Avg R on the Journal list cards"

**1. Start with the idea.** In a fresh Claude Code session:

```
/feature "show Avg R on each Journal list card, next to win % and PF"
```

Claude opens issue #150 (`area:web`) with Why, Acceptance criteria ("each card shows `Avg R`, 2 decimals,
`—` with no trades"), Out of scope and Design ref. You approve or edit it. **This is gate G1.**

**2. Ship it** with `/ship #150`. From here the loop runs on its own:

| step | what happens for #150 |
|---|---|
| 0 preflight | `main` is clean, the issue has acceptance criteria, and `area:web` is not gated |
| 1 branch | `feat/150-journal-avg-r` |
| 2 build | edits `ListCard` in `web/src/components/JournalDay.jsx` and adds a web unit test |
| 3 local gate | `npm test` · `npm --prefix web test` · web build · `npm run lint`, all green |
| 4 e2e | **e2e-tester** (Haiku) runs Playwright on the stub API in light and dark, then looks at the Journal screenshots |
| 5 learn | no rule changed, so nothing to record (otherwise `/decision` or CLAUDE.md, committed now) |
| 6 open PR | **pr-creator** (Haiku) fills the PR template, adds the labels and links "Closes #150" |
| 7 review | **pr-reviewer** (Sonnet) checks the diff against `.claude/review/web.md` and the acceptance criteria, then posts `VERDICT: APPROVE` (on `VERDICT: CHANGES`, up to 2 fix rounds, then you decide) |
| 8 merge | auto-merge is armed, CI passes, and GitHub squash-merges and deletes the branch |
| 9 report | Claude tells you the PR number, what changed and the screenshots |

**3. Done.** You did two things: wrote one line and approved one issue.

**A big feature**: brainstorm in chat, or let `/feature` detect it (or add `brainstorm`). It asks in
rounds, shows a plan, and files issues only once you approve the plan (G0).

**An engine feature** (`area:engine`, e.g. a trailing stop) differs in three ways: **test-writer** writes tests
from the acceptance criteria without seeing the code, the reviewer runs on Opus, and step 8 stops for
**you to merge (gate G2)**.

## Pieces

| | name | job |
|---|---|---|
| skill | `/feature`, `/ship` | the two commands above |
| skill | `/review <PR>`, `/e2e`, `/decision` | run one step on its own |
| skill | `engine-rules` | loaded automatically before engine or live work |
| agent | pr-creator (Haiku), e2e-tester (Haiku) | open the PR; run Playwright |
| agent | pr-reviewer (Sonnet, Opus for engine/live/db), test-writer (Sonnet) | review; write tests |

The reviewer posts as your account, and GitHub won't let you approve your own PR, so it posts a
comment with a `VERDICT:` line instead. Agents and skills load at session start.

## Guards (they work even if the model slips)

- **CI**: `core tests`, `web tests + build`, `lint` and `e2e` must pass before anything merges to `main`.
- **Biome** (`npm run lint`): `src/engine.js` imports nothing impure; only `src/fyers.js` and `server/feed.js` import `fyers-api-v3`.
- **Guard hook** (`.claude/hooks/guard.js`): blocks production `DATABASE_URL`, reading `.env` and the Neon host;
  asks before spending Fyers budget. It reads command text, so PR and issue bodies go in via `-F <file>`.

## Conventions

- Branch `<feat|fix|chore|docs>/<issue>-<slug>` (milestone: `m<k>/…`); PR title `type(scope): summary`;
  labels `area:engine|live|api|db|fyers|web|infra`; squash-merge only.
- Tests never touch production. DB tests use `TEST_DATABASE_URL`, and E2E makes its own throwaway database.

## Run E2E or preview the UI locally

```
npm --prefix web run e2e                 # needs local Postgres; screenshots in web/e2e/screenshots/
node web/e2e/server.cjs & npm run web    # fake-data preview, password e2e-password
```

The stub API uses port 4000, the same as `npm run api`, so stop it (`kill %1`) first.
