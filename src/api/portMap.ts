// SPDX-License-Identifier: Apache-2.0
/**
 * The port map: every call the UI made on the v1 OMS and the market gateway,
 * and the v2 target it makes now. Data only (the tests walk it line by line;
 * a line without a test fails the suite). Nothing in the app imports it.
 */

export type PortMapLineId =
  | 'register'
  | 'login'
  | 'stored-session'
  | 'logout'
  | 'balances'
  | 'deposit'
  | 'withdraw'
  | 'place'
  | 'amend'
  | 'cancel'
  | 'open-orders-seed'
  | 'history'
  | 'fills'
  | 'stream'
  | 'market-switch'
  | 'book'
  | 'tape'
  | 'candles-1m'
  | 'candles-5m'
  | 'tickers'
  | 'markets';

export interface PortMapLine {
  id: PortMapLineId;
  /** The v1 call the UI made. */
  v1: string;
  /** What it calls now. */
  v2: string;
  /** Where the v2 call lives. */
  where: string;
}

export const PORT_MAP: readonly PortMapLine[] = [
  { id: 'register', v1: 'POST /api/v1/auth/register', v2: 'POST /api/v2/auth/register', where: 'auth/AuthContext.tsx' },
  { id: 'login', v1: 'POST /api/v1/auth/login', v2: 'POST /api/v2/auth/login', where: 'auth/AuthContext.tsx' },
  { id: 'stored-session', v1: 'GET /api/v1/auth/me', v2: 'GET /api/v2/auth/me (a 401 clears the session)', where: 'auth/AuthContext.tsx' },
  { id: 'logout', v1: 'logout, local only', v2: 'POST /api/v2/auth/logout, then the local clear', where: 'auth/AuthContext.tsx' },
  { id: 'balances', v1: 'GET /api/v1/accounts/{userId}', v2: 'GET /api/v2/balances', where: 'hooks/useBalances.tsx' },
  { id: 'deposit', v1: 'POST /api/v1/accounts/{userId}/deposit', v2: 'POST /api/v2/balances/deposit (Idempotency-Key)', where: 'hooks/useApi.ts' },
  { id: 'withdraw', v1: 'POST /api/v1/accounts/{userId}/withdraw', v2: 'POST /api/v2/balances/withdraw (Idempotency-Key)', where: 'hooks/useApi.ts' },
  { id: 'place', v1: 'POST /api/v1/orders', v2: 'POST /api/v2/orders (Idempotency-Key)', where: 'hooks/useApi.ts' },
  { id: 'amend', v1: 'PUT /api/v1/orders/{id}', v2: 'PUT /api/v2/orders/{orderId} (Idempotency-Key, PENDING_REPLACE)', where: 'hooks/useApi.ts' },
  { id: 'cancel', v1: 'DELETE /api/v1/orders/{id}', v2: 'DELETE /api/v2/orders/{orderId} (404 and 409 handled)', where: 'hooks/useApi.ts' },
  { id: 'open-orders-seed', v1: 'GET /api/v1/orders', v2: 'GET /api/v2/orders', where: 'hooks/useOrders.ts' },
  { id: 'history', v1: 'GET /api/v1/orders/history?limit&offset', v2: 'GET /api/v2/orders/history (cursor)', where: 'hooks/useOrderHistory.ts' },
  { id: 'fills', v1: 'GET /api/v1/executions?limit&offset', v2: 'GET /api/v2/fills (cursor)', where: 'hooks/useExecutions.ts' },
  { id: 'stream', v1: '/ws/v1, bearer subprotocol, subscribe orders', v2: '/ws/v2 on oe-stream, bearer subprotocol, heartbeat, resume, resync', where: 'hooks/useUserStream.ts' },
  { id: 'market-switch', v1: 'market /ws, a new subscribe on a market switch', v2: 'oe-marketdata /ws, one connection, subscribe replaces', where: 'hooks/useWebSocket.ts' },
  { id: 'book', v1: 'BOOK_SNAPSHOT, BOOK_DELTA (numbers)', v2: 'oe-marketdata BOOK_SNAPSHOT, BOOK_DELTA (decimal strings, refresh on a chain break)', where: 'api/marketFrames.ts, hooks/useOrderBook.ts' },
  { id: 'tape', v1: 'TRADES_BATCH (aggregated)', v2: 'oe-marketdata TRADES_BATCH (one entry per trade, decimal strings)', where: 'api/marketFrames.ts, hooks/useTrades.ts' },
  { id: 'candles-1m', v1: 'CANDLE_HISTORY, CANDLE_UPDATE 1m on the market /ws', v2: 'oe-marketdata CANDLE_HISTORY, CANDLE_UPDATE 1m', where: 'api/marketFrames.ts, App.tsx' },
  { id: 'candles-5m', v1: 'GET /api/candles (intervals other than 1m)', v2: 'oe-marketdata GET /api/candles (marketId, interval, limit required)', where: 'App.tsx' },
  { id: 'tickers', v1: 'TICKER_STATS, TICKERS', v2: 'oe-marketdata TICKER_STATS, TICKERS (decimal strings)', where: 'api/marketFrames.ts, hooks/useMarketTickers.ts' },
  { id: 'markets', v1: 'the static market table (types/market.ts)', v2: 'GET /api/v2/markets', where: 'markets/marketStore.ts' },
];

/** The lines of `map` that have no case in `cases`, as failure texts. */
export function linesWithoutTest(map: readonly PortMapLine[], cases: Partial<Record<PortMapLineId, unknown>>): string[] {
  return map.filter(line => typeof cases[line.id] !== 'function').map(line => `port map line has no test: ${line.v1}`);
}
