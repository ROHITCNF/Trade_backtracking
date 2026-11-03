---
name: review
description: Review a pull request with the pr-reviewer agent, on Opus when it touches engine, live or db. Posts one review comment on the PR and returns the verdict.
argument-hint: <PR number>
disable-model-invocation: true
---

# /review

PR: $ARGUMENTS (if empty, use `gh pr view --json number` for the current branch).

1. `gh pr view <n> --json labels,files,title` to get the labels.
2. Pick the model:
   - `opus` if a label is `area:engine`, `area:live` or `area:db`, **or** any changed path is under
     `src/engine.js`, `src/targets.js`, `src/metrics.js`, `server/`, `api/reconcile.js` or
     `api/db/migrations/` (labels can be missing).
   - Otherwise `sonnet`.
3. Launch the `pr-reviewer` agent with that model. Prompt: `Review PR #<n>.` plus the e2e-tester
   report if one is in this conversation.
4. Relay the result: the verdict, then the **Must fix** items in one line each with `path:line`.
   Link the PR. Don't repeat the whole review. It's on GitHub.
