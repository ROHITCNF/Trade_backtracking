# Review checklist: area:infra

- [ ] CI still runs core tests (with Postgres), web tests + build, lint and e2e. Required checks still match the job names.
- [ ] No secret enters the repo, workflow logs or artifacts.
- [ ] `.claude/` changes: the guard hook still denies prod DB access and `.env` reads (`test/guard.test.js`). Agent tool lists stay minimal.
- [ ] `render.yaml` / deploy changes are mirrored in `docs/deploy.md`.
- [ ] New dev dependencies are pinned exactly and justified in the PR.
