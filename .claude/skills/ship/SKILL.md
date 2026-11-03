---
name: ship
description: Take an approved GitHub issue from branch to merged PR. Implements it, runs the local gate, then drives the e2e-tester, pr-creator and pr-reviewer agents, fixes review findings (at most two rounds), and arms auto-merge, or stops for the owner on engine, live and db changes.
argument-hint: "#<issue>"
disable-model-invocation: true
---

# /ship: issue → merged PR

Issue: $ARGUMENTS

You are the orchestrator and the implementer. Agents can't call each other, so pass each one
the context it needs in its prompt. Stop and ask the owner whenever the issue is ambiguous
enough that you would be guessing at behaviour.

## 0. Preflight
- `git status --porcelain` is empty and you're on an up-to-date `main` (`git checkout main && git pull`).
- `gh issue view <n> --json title,body,labels,milestone`. It needs **Acceptance criteria**.
  If it has none, stop and suggest `/feature`.
- **Gated** = any label `area:engine`, `area:live` or `area:db`, or the work will touch
  `src/engine.js`, `src/targets.js`, `src/metrics.js`, `server/`, `api/reconcile.js` or
  `api/db/migrations/`. Decide now, and re-check against the final diff in step 7.

## 1. Branch
`m<milestone number>/<issue>-<slug>` if the issue is in a milestone `M<k> · …`, else
`<feat|fix|chore|docs>/<issue>-<slug>`. The slug is 2–4 words, kebab-case.

## 2. Build
- Read the code you'll touch, `CLAUDE.md`'s relevant section, and any D-numbers the issue cites.
- Engine or live work: load the `engine-rules` skill first. Then launch **test-writer** with the
  acceptance criteria (not your implementation) so the tests come from the spec. Write the code
  until its tests and yours pass.
- Other work: write the tests yourself alongside the code.
- Keep to the acceptance criteria. Note anything else worth doing as a follow-up, and don't build it.
- Commit in small logical steps with Conventional Commit messages and the Co-Authored-By trailer.

## 3. Local gate (all must pass before any agent runs)
```
npm test                                   # add TEST_DATABASE_URL=postgres://localhost/postgres when api/ or db changed
npm --prefix web test
npm --prefix web run build
npm run lint
```
Record the pass/skip counts. You'll hand them to pr-creator. Fix failures yourself.

## 4. E2E (when `web/` or `api/` changed)
Launch **e2e-tester** with the issue title, its acceptance criteria and
`git diff --stat origin/main...HEAD`. Tell it which routes changed.
- On `E2E: FAIL` with app bugs: fix them and go back to 3.
- Spec changes it made under `web/e2e/` get committed on this branch.
- Keep its report block for the PR.

## 5. Learn (before the PR opens)
If this work changed a rule (engine behaviour, a limit, a workflow step,
a UI convention):
- record it with `/decision`, and/or
- update `CLAUDE.md`, `server/architecture.md`, `.claude/skills/engine-rules/SKILL.md` or a
  `.claude/review/*.md` checklist

commit it on this branch now, so pr-creator lists it and the reviewer sees it. A lesson that only lives in this conversation is lost.

## 6. Open the PR
Launch **pr-creator** with: the issue number, the step 3 counts, the e2e report (or "not run:
no web/api change"), the D-numbers and docs from step 5, and what's not done.
It returns the PR URL. Don't arm auto-merge yet.

## 7. Review
Run the `/review` skill's procedure: launch **pr-reviewer** with model `opus` if gated, else
`sonnet`. Prompt: `Review PR #<pr>.` plus the e2e report.
- `VERDICT: APPROVE`: go to 7.
- `VERDICT: CHANGES`: fix every **Must fix**, plus any **Should fix** that is cheap and in scope.
  Rerun 3 (and 4 if the fix touched `web/` or `api/`), push, and comment on the PR listing what changed per finding.
  Then rerun the reviewer.
- **At most 2 review rounds.** If round 2 still says CHANGES, stop and hand the open findings
  to the owner.

## 8. Merge
- **Not gated**: `gh pr merge <pr> --auto --squash --delete-branch`. Branch protection merges it
  once `core tests`, `web tests + build`, `lint` and `e2e` are green. Watch it with
  `gh pr checks <pr> --watch`. On a red check, fix it and push (auto-merge stays armed).
  If gh refuses `--auto` because the checks are already green ("clean status"), merge directly
  with `gh pr merge <pr> --squash --delete-branch`.
- **Gated (G2)**: don't arm auto-merge. Tell the owner: PR link, review verdict, the one-line
  risk, and "merge with `gh pr merge <pr> --squash --delete-branch` when you're happy".

## 9. Report
```
#<issue> → PR #<pr> <merged | waiting for you (gated) | blocked>
Checks: core <n> pass · web <n> pass · lint ok · e2e <PASS/not run>
Review: <APPROVE in round k | open findings: …>
Follow-ups: <none | list>
```
If the owner asked for a run of issues (e.g. a milestone), continue with the next one after a
merge without checking in. Stop at a gated PR or a blocker.
