# Open Exchange — Trading UI

Web-based trading interface for the Open Exchange ultra-low-latency matching engine. Built with React, TypeScript, and Vite.

## Features

- Real-time order book with depth visualization
- Live trade feed via WebSocket
- Interactive candlestick charts (lightweight-charts)
- Order entry — limit, market, post-only, stop-loss, stop-limit, trailing stop, iceberg
- Time-in-force options — GTC, IOC, FOK, GTD
- Active orders panel with real-time status updates and cancel
- Account management — balance display, deposit, and withdraw
- Market statistics and ticker
- Cluster administration panel
- Responsive mobile layout

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** — dev server and build tooling
- **lightweight-charts** — financial charting
- **WebSocket** — real-time market data streaming

## Getting Started

### Prerequisites

- Node.js 22+
- Running backend services (matching engine, OMS, market gateway)

### Install & Run

```bash
npm install
npm run dev
```

The dev server starts on port 80 (override with `npm run dev -- --port 5173`
if you cannot bind privileged ports) with proxies configured for:

| Path | Target |
|------|--------|
| `/ws` | `ws://localhost:8081` (market data) |
| `/api/v1` | `http://localhost:8080` (order API) |
| `/api/admin` | `http://localhost:8082` (admin gateway) |
| `/api/candles` | `http://localhost:8081` (candles) |

### Build

```bash
npm run build
npm run preview
```

## Project Structure

```
src/
  components/
    Chart/            — Candlestick chart
    ConnectionStatus/ — WebSocket connection indicator
    MarketSelector/   — Market pair picker
    MarketStats/      — 24h ticker stats
    OrderBook/        — Bid/ask depth display
    OrderForm/        — Order entry form
    OpenOrders/       — Active orders list
    Trades/           — Recent trade feed
  hooks/              — WebSocket, order book, trades, API hooks
  pages/
    AdminPage         — Cluster admin dashboard
  types/              — TypeScript type definitions
```

## Analytics (optional, off by default)

**A clone of this repository sends nothing anywhere.** `posthog-js` is behind a
dynamic import gated on `VITE_POSTHOG_KEY`; with no key it is not in the bundle at
all (verified in a keyless build: zero occurrences of the string `posthog`). We set
a key for the hosted demo at trade.openexchange.dev. If you deploy this UI, you get
analytics only if you configure your own project.

```bash
VITE_POSTHOG_KEY=phc_...   # write-only project key, safe in a public bundle
VITE_POSTHOG_HOST=         # optional; defaults to /ph (see functions/ph/)
```

Three rules the implementation enforces, in `src/analytics.ts`:

| Rule | How |
|---|---|
| **No money values in events** | Events carry the shape of an action, never its amounts: side, order type, market, reject reason, round-trip latency. `scrubMoney()` strips any property whose name looks monetary and runs again in `before_send`, so a forgetful call site cannot leak one. Covered by `src/__tests__/analytics.test.ts`. |
| **Anonymous** | `sessionStorage`, no cookie, and the signed-in user is never identified. The cost is real: "how many people who registered went on to trade" is not answerable from this data. |
| **Never break the app** | This is the front end of an exchange. Every entry point is guarded, failures are swallowed, and the SDK is lazily imported so a blocked CDN cannot delay the order form. |

Session recordings mask every input, and also every element tagged
`data-ph-mask`: balances in the account drawer, and the price/quantity cells in
open orders and order history. `maskAllInputs` does not cover those, because they
are rendered as text rather than typed into a field. Do Not Track and Global
Privacy Control both switch analytics off before any request is made.

`functions/ph/[[path]].ts` is a Cloudflare Pages Function that proxies `/ph/*` to
PostHog's EU endpoints, so a content blocker does not silently skew the numbers.
It changes nothing about where data ends up.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
