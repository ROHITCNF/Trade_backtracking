---
name: e2e
description: Run the Playwright end-to-end suite with the e2e-tester agent, optionally focused on a route or feature, and report pass/fail plus light and dark screenshot findings.
argument-hint: "[route or feature, e.g. /live list picker]"
disable-model-invocation: true
---

# /e2e

Focus: $ARGUMENTS (empty means run the whole suite and review every screenshot).

1. `pg_isready`. If Postgres isn't running locally, tell the owner (`brew services start postgresql`) and stop.
2. Launch the `e2e-tester` agent. Prompt: what to verify (the focus above, or the current branch's
   change: `git diff --stat origin/main...HEAD` plus the issue title), and whether it should add a
   spec. Only add one when there is a new or changed flow.
3. Relay its report block as is. If it lists app bugs, offer to fix them. Don't fix them unasked.
