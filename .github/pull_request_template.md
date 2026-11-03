<!--
Title: Conventional Commits — `feat(live): …`, `fix(engine): …`, `chore(ci): …`, `docs: …`
Branch: `m<N>/<issue>-<slug>` for milestone work, else `<feat|fix|chore|docs>/<issue>-<slug>`.
Labels: one or more `area:*` (engine, live, api, db, fyers, web, infra). pr-reviewer picks its
checklists from them; `area:engine|live|db` wait for the owner before merging.
Squash-merge only. Delete sections that don't apply rather than leaving them empty.
-->

Closes #

## What
-

## Why
<!-- One or two lines; skip if the issue already says it. -->

## Risk areas
- [ ] engine — entry, stops, targets, the four modelling choices
- [ ] live — paper session, tick fills, reconcile
- [ ] db — migration or query shape
- [ ] fyers — REST calls, budget, auth
- [ ] web — UI only
- [ ] infra — CI, tooling, Claude workflow

## Checked
- [ ] `npm test`
- [ ] `npm --prefix web test`
- [ ] `npm --prefix web run build`
- [ ] `npm run lint`
- [ ] E2E / visual, light and dark (web changes)

## Decisions / docs
<!-- D-number added to docs/decisions.md, CLAUDE.md lines changed, or "none". -->

## Not done
<!-- Known gaps and follow-up issues. -->
