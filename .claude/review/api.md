# Review checklist: area:api

- [ ] Every new route requires a session, except `/api/health` and `/api/login`.
- [ ] Inputs are validated. Errors use `api/errors.js` shapes and the right status (400/404/409, never 500 for bad input).
- [ ] Config is read once in `api/config.js`. No `process.env` elsewhere in `api/`.
- [ ] Long work goes to the worker, not the request.
- [ ] Route tests use `buildApp(...).inject` (see `test/runsApi.test.js`) on a throwaway DB.
- [ ] Response shape changes are matched in `web/src/lib/api.js` callers.
