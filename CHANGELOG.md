# Changelog

All notable changes to `trading-ui` (the Open Exchange trading and admin web
interface) are documented here. The stack (`match`, `oms`, `admin-gateway`,
`trading-ui`, `assets`) is versioned together; one version spans all five repos.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0-beta] - 2026-07-22

Trader-first UI on a version-chained order book; the admin console moves out
to admin-gateway.

### Added
- Trader-first desktop layout: always-visible order rail, stable chart,
  smooth market switching (#39); full 20+20 order book always on screen
  (#40); brand-ink dark theme visual identity — hero price, spread-row
  signature (#41).
- Version-chained order book synchronization (v4 protocol) (#35).
- Tick-aware order form + visible order rejections (#37); friendly text for
  engine/OMS reject reasons (#72); sign-in with backend-scoped orders,
  working history, taker-side tape colors (#36).
- Persistent cluster activity log in the topbar (#71).

### Fixed
- Order book depth and staleness after tab switches (#34).
- Chart: candle times rendered in the local timezone — was 3h behind (#57);
  settled candle keeps its final value on rollover (#69); single
  current-price label on the axis (#70).
- Tick arrows no longer flicker — persistent direction, reserved width (#42);
  scrolling over a focused number input no longer changes its value (#38);
  stable seq key for the trade tape (#63).
- Footer shows the real stack version, not a hardcoded v1.0.0 (#59).

### Changed
- The admin console (built up here through #43-#45, #52-#56, #64-#68) was
  extracted into a standalone subproject under admin-gateway
  (openexch/admin-gateway#91); this repo is now the trading UI proper.
- tsc emit artifacts dropped from the repo and ignored (#46).
- Contact email is info@openexch.io (#58).

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
