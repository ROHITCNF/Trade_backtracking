# Review checklist: area:web

- [ ] Matches the reference in `docs/design/reference/v2/` (or the design ref in the issue). Claude Design mockups are the UI source of truth.
- [ ] Colours, spacing and type come from tokens in `web/src/styles/tokens.css`. No raw hex in components or page CSS.
- [ ] shadcn/ui components live in `web/src/components/ui`. Pages use our CSS classes, not Tailwind utilities, so they stay out of Tailwind's scan.
- [ ] Both themes checked: e2e screenshots under `web/e2e/screenshots/light|dark` for the touched routes.
- [ ] Phone width still works where the page has a mobile layout (Live, Journal).
- [ ] Charts: Lightweight Charts **v5** for candles only; ECharts for everything else (D5).
- [ ] Times shown are IST via `web/src/lib/ist.js`.
- [ ] Logic that can be pure lives in `web/src/lib/*.js` with a test in `web/test/`.
- [ ] Buttons are real `<button type="button">` (or submit inside a form). Interactive elements are keyboard reachable.
- [ ] An E2E spec covers any new route or primary flow.
