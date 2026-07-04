# Contributing to trading-ui

Thanks for your interest in Open Exchange. `trading-ui` is the web trading
and admin interface: React 19 + Vite + Tailwind v4, talking to the OMS REST
API, the market-data WebSocket, and the admin gateway.

## Before you start

- For anything larger than a small fix, open an issue first.
- UI changes: include a screenshot (light and dark theme) in the PR.

## Development setup

- Node 22.

```bash
npm ci
npm test
npm run build
npm run dev   # dev server with proxies to local OMS (:8080), market WS (:8081), admin (:8082)
```

CI runs tests and the production build, plus Trivy scanning.

## Design constraints

- **Respect the frozen OMS wire.** Money arrives as exact decimal strings
  and ids as JSON strings; never round-trip them through JS floats. Send no
  `userId` in request bodies (identity comes from the bearer token).
- **Keep both themes working.** The design system supports light and dark;
  new components must style both.
- **Performance.** Market-data WebSocket messages are conflated and
  dispatched once per animation frame; do not add per-message React state
  updates.

## Pull requests

- **One logical change per PR**, squash-merged.
- Commit/PR title style: `type: imperative summary` with types
  `feat|fix|docs|test|ci|chore`.
- Note: merges to `main` deploy to production (Cloudflare Pages) on their
  own; a merged PR is live within minutes.

## License

Apache-2.0. By contributing, you agree that your contributions are licensed
under the same terms as the project (inbound = outbound). No CLA.
