# Changelog

All notable changes to `trading-ui` (the Open Exchange trading and admin web
interface) are documented here. The stack (`match`, `oms`, `admin-gateway`,
`trading-ui`) is versioned together; one version spans all four repos.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0-beta] - 2026-07-05

The beta hardening release: authenticated requests, a precision-safe wire,
and the first app-level test suite.

### Added
- Bearer-token authentication; `userId` is no longer sent in request bodies
  (identity comes from the token) (#26).
- App smoke test suite: renders the real `<App/>` under jsdom and asserts
  mount, market WebSocket connection, and exact order-submit wire format
  (#31).
- Trivy dependency and secret scanning in CI (#31).

### Changed
- Adopted the openexch.io design system: blue AA-contrast palette, OS-level
  theme detection, chrome FX (#23).
- Market-data WebSocket messages are conflated and dispatched once per
  animation frame (#29).
- Consumes the frozen OMS wire: money as exact decimal strings, ids as JSON
  strings end to end (#30).

### Fixed
- Open Orders cancel/edit uses `omsOrderId` with precision-safe big-id
  handling (#28).

## [0.2.0-alpha] - 2026-06-28

- First tagged release, aligned with the Open Exchange v0.2.0-alpha stack.
- Modernized trading and admin UI: Tailwind v4, dual light/dark theme (#16);
  React 19 plus Vite 8 major upgrade (#15).

[0.3.0-beta]: https://github.com/openexch/trading-ui/compare/v0.2.0-alpha...v0.3.0-beta
[0.2.0-alpha]: https://github.com/openexch/trading-ui/releases/tag/v0.2.0-alpha
