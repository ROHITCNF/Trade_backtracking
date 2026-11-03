---
name: decision
description: Record a design decision in docs/decisions.md as the next D-number, in the house format (dated section, one-line bold decision, short why). Use when a PR settles a choice that future work must respect, such as a modelling rule, a data source, a UI behaviour that differs from the mockup, or a limit.
argument-hint: <the decision and its reason>
---

# /decision

Decision: $ARGUMENTS

1. Read `docs/decisions.md`. Find the highest `D<n>`. The new one is `D<n+1>`.
2. Check that no existing decision already covers this. If one is being **changed**, say so in
   the new row ("Supersedes D12: …") and don't edit the old row.
3. If the last section's heading is today's date and the same topic, append a row to its table.
   Otherwise add a new section at the end:
   ```
   ## YYYY-MM-DD — <topic in a few words>

   | # | decision | why |
   |---|---|---|
   | D<n+1> | **<the decision in one sentence, bold>** <optional detail sentence> | <the reason: the constraint or evidence, 1–2 sentences> |
   ```
   Use today's date in IST and the repo's plain, specific voice: name files, numbers and limits.
4. If the decision changes a rule stated in `CLAUDE.md`, `server/architecture.md` or
   `.claude/skills/engine-rules/SKILL.md`, update that text too and cite the D-number there.
5. Don't commit on your own. The change ships in the current PR. Report the D-number.
