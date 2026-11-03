---
name: feature
description: Turn an idea into GitHub issue(s) ready for /ship. Small ideas: at most three questions, then files. Large ideas: brainstorm and an approved plan first, then files an issue with Why, Acceptance criteria, Out of scope, Design ref, area labels and milestone. A large idea becomes a milestone of ordered issues plus a docs/plan.md section.
argument-hint: <idea in a sentence or two, or "as discussed"> [brainstorm]
disable-model-invocation: true
---

# /feature: idea → issue

Idea: $ARGUMENTS

The issue is the spec. `/ship` builds exactly what its acceptance criteria say, and the reviewer
checks against them. Write them so a stranger could verify each one.

## 1. Understand (no questions yet)
- Read what the idea touches: the relevant code, `docs/decisions.md` (does a D-number already
  decide this?), and `docs/design/reference/` if it's UI.
- Find the area(s): engine, live, api, db, fyers, web, infra.
- Size it:
  - **small**: one PR, under ~300 changed lines, one area
  - **large**: several PRs or several areas, a schema change plus UI, or anything that would leave
    `main` half-working between PRs

If the conversation already discussed the idea ("as discussed"), build on what was agreed there.

## 2a. Small: at most 3 questions, in one AskUserQuestion call
Only ask what changes what gets built: scope edges, a behaviour choice, a design reference.
Put your recommendation first. Skip this step if the idea is already unambiguous.

## 2b. Large (or the owner wrote `brainstorm`): brainstorm, then a plan the owner approves
1. **Discuss** in rounds, as many as it takes. Each round asks up to 4 questions, with options and
   your recommendation first. Name the risks and any `docs/decisions.md` entry the idea conflicts with.
   Stop when every open point either changes nothing about what gets built or has an answer.
2. **Draft** a short plan in chat:
   - the goal
   - what's in and out of scope
   - the steps in order, each one shippable on its own
   - the questions still open
3. **G0: file nothing until the owner approves the plan.** If they change it, revise it and show it again.
   Then continue to section 3 (Write) with the approved plan.

## 3. Write
Use this body for each issue, written to a temp file and passed with `-F`, never inline:
```
## Why
<the problem in 1–3 lines, in the owner's terms>

## Acceptance criteria
- [ ] <observable behaviour: "On Live, picking a list refetches trades for it">
- [ ] <edge case that matters>
- [ ] Tests: <what must be pinned>. E2E: <route/flow> (web changes)

## Out of scope
- <what this deliberately does not do>

## Design ref
<docs/design/reference/... path, or "none">

## Notes
<files likely touched, D-numbers that apply, risks>
```
- **small**: `gh issue create -t "<imperative title>" -F <file> -l area:<x> [-m "<open milestone>"]`
- **large**:
  1. `gh api "repos/{owner}/{repo}/milestones" -f title="M<next> · <name>" -f description="<the approved plan, if there was one>"`
     (the next M-number is one above the highest existing).
  2. Split into issues that **each leave `main` working**: data or API before the UI that uses it,
     and interim routes over half-built screens. Order them, file each into the milestone.
  3. Add a `## M<n> · <name>` section to `docs/plan.md` with an issue table, in the same format as
     the existing sections. That edit ships in the first issue's PR.
- If the idea needs a new decision, note it under Notes. `/ship` records it with `/decision`.

## 4. Hand back
List the issue links and titles in order, then say: "Review the acceptance criteria, then run
`/ship #<first>`." Don't start building. Approving the issue is the owner's gate (G1).
