# Open Exchange — Trading UI

Web-based trading interface for the Open Exchange ultra-low-latency matching engine. Built with React, TypeScript, and Vite.

## Features

- Real-time order book with depth visualization
- Live trade feed via WebSocket
- Interactive candlestick charts (lightweight-charts)
- Order entry (limit & market orders)
- Market statistics and ticker
- Cluster administration panel
- Responsive mobile layout

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** — dev server and build tooling
- **lightweight-charts** — financial charting
- **WebSocket** — real-time market data streaming

## Getting Started

### Prerequisites

- Node.js 18+
- Running backend services (matching engine, OMS, market gateway)

### Install & Run

```bash
npm install
npm run dev
```

The dev server starts on port 80 with proxies configured for:

| Path | Target |
|------|--------|
| `/ws` | `ws://localhost:8081` (market data) |
| `/order` | `http://localhost:8080` (order API) |
| `/api/admin` | `http://localhost:8082` (admin gateway) |

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

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
