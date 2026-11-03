# Review checklists

pr-reviewer reads `general` below plus one file per `area:*` label on the PR.

## general (every PR)
- [ ] The diff does what the linked issue's acceptance criteria say, no more. Scope creep is flagged.
- [ ] Tests cover the change and would fail without it.
- [ ] No dead code, debug logging or commented-out blocks left behind.
- [ ] Comments explain why, in the repo's voice. No narration of the diff.
- [ ] CLAUDE.md, `docs/decisions.md` or `server/architecture.md` are updated if a rule changed.
- [ ] PR body's **Checked** section is true. Each ticked item actually ran.
