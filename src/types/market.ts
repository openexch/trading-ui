// SPDX-License-Identifier: Apache-2.0
// Market definitions. The list comes from the gateway (GET /api/v2/markets,
// see markets/marketStore.ts); there is no static market table.
export interface Market {
  /** UI form of the market id (a number); the API form is a decimal string,
   *  converted only by api/marketId.ts. */
  id: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  /** Display name: the base asset's long name (markets/assetNames.ts), or
   *  its code when no long name is known. */
  name: string;
  /** Engine price grid (match MarketConfig): orders must land on a tick
   *  inside [minPrice, maxPrice] or the engine rejects them (PRICE_OFF_TICK /
   *  PRICE_OUT_OF_RANGE). The order form snaps and validates against these. */
  tickSize: number;
  minPrice: number;
  maxPrice: number;
}

export interface BookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

// One trade of a TRADES_BATCH (one entry per trade; tradeCount is always 1).
export interface AggregatedTrade {
  /** Trade id, a decimal string on the wire. */
  tradeId?: string;
  price: number;
  quantity: number;
  tradeCount: number;
  /** Taker side. The tape keeps a tick-test fallback for a missing side. */
  side?: 'BUY' | 'SELL' | null;
  timestamp: number;
  /** The matching engine's journal sequence of the trade (not a log
   *  position); null or absent when the service does not send it. */
  journalSeq?: number | null;
}

export interface TradesBatchMessage {
  type: 'TRADES_BATCH';
  marketId: number;
  trades: AggregatedTrade[];
  timestamp: number;
}

/** A trade-tape row tagged at ingest with a client-side monotonic `seq`, the
 *  stable React key that survives batch prepends (DESIGN.md: stable seq keys). */
export interface TapeTrade extends AggregatedTrade {
  seq: number;
}

export interface BookSnapshotMessage {
  type: 'BOOK_SNAPSHOT';
  marketId: number;
  bids: BookLevel[];
  asks: BookLevel[];
  /** The book version this snapshot represents (chains with deltas). */
  bookVersion: number;
  timestamp: number;
  /** Present (true) when the service cannot prove the book is current. */
  stale?: true;
}

export interface BookDeltaChange {
  price: number;
  quantity: number;
  orderCount: number;
  side: 'BID' | 'ASK';
  updateType: 'NEW_LEVEL' | 'UPDATE_LEVEL' | 'DELETE_LEVEL';
}

export interface BookDeltaMessage {
  type: 'BOOK_DELTA';
  marketId: number;
  changes: BookDeltaChange[];
  bidVersion: number;
  askVersion: number;
  /** This delta advances the book fromVersion -> bookVersion. */
  bookVersion: number;
  fromVersion: number;
  timestamp: number;
}

export interface SubscriptionConfirmMessage {
  type: 'SUBSCRIPTION_CONFIRMED';
  status: string;
  marketId: number;
}

export interface PongMessage {
  type: 'PONG';
  timestamp: number;
}

export interface ErrorMessage {
  type: 'ERROR';
  code: string;
  message: string;
  /** HISTORY_UNAVAILABLE: the parts of the initial state that are missing
   *  (`tape`, `candles`, `ticker`). */
  parts?: string[];
}

export interface TickerStatsMessage {
  type: 'TICKER_STATS';
  marketId: number;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

/** One market's entry in the all-market TICKERS frame: the TICKER_STATS
 *  fields without `type`. */
export type TickersEntry = Omit<TickerStatsMessage, 'type'>;

/** Every market's ticker in one frame, sent to every market-data client
 *  whatever market it subscribes to (at the handshake and on change). No
 *  top-level marketId. Markets without a price are absent. */
export interface TickersMessage {
  type: 'TICKERS';
  tickers: TickersEntry[];
  timestamp: number;
}

// Connection status as the header shows it. The cluster states have no
// source since the market feed stopped carrying cluster frames; they stay in
// the vocabulary of the status pill.
export type ExtendedConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'cluster-updating'
  | 'cluster-electing'
  | 'cluster-reconnecting';

// Candle types (server-aggregated)
export interface CandleData {
  /** Bucket start, epoch seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

export interface CandleHistoryMessage {
  type: 'CANDLE_HISTORY';
  marketId: number;
  interval: string;
  candles: CandleData[];
}

export interface CandleUpdateMessage {
  type: 'CANDLE_UPDATE';
  marketId: number;
  interval: string;
  candle: CandleData;
}

export type WebSocketMessage =
  | TradesBatchMessage
  | BookSnapshotMessage
  | BookDeltaMessage
  | SubscriptionConfirmMessage
  | PongMessage
  | ErrorMessage
  | TickerStatsMessage
  | TickersMessage
  | CandleHistoryMessage
  | CandleUpdateMessage;

export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
  lastUpdate: number;
  spread?: number;
  spreadPercent?: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Order types
export type OrderSide = 'BID' | 'ASK';
export type OrderType = 'LIMIT' | 'MARKET' | 'LIMIT_MAKER' | 'STOP_LOSS' | 'STOP_LIMIT' | 'TRAILING_STOP' | 'ICEBERG';
export type TimeInForce = 'GTC' | 'GTD' | 'IOC' | 'FOK';
// The core's ten order statuses. FILLED, CANCELLED, REJECTED and EXPIRED are
// terminal.
export type OrderStatus =
  | 'PENDING_NEW'
  | 'PENDING_TRIGGER'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'PENDING_CANCEL'
  | 'PENDING_REPLACE'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

/** The v2 Order object (REST reads, stream `order` frames and snapshots).
 *  Ids are decimal strings, money is decimal strings, times are epoch ms. */
export interface ApiOrder {
  orderId: string;
  clientOrderId: string | null;
  marketId: string;
  side: 'BUY' | 'SELL';
  type: string;
  timeInForce: string;
  price: string | null;
  stopPrice: string | null;
  quantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  status: string;
  /** The core reject reason name, or null. */
  reason: string | null;
  meReason: number | null;
  meOrderId: string | null;
  hold?: { assetId: string; amount: string; remaining?: string } | null;
  createdAt: number;
  updatedAt: number;
  displayQuantity?: string | null;
  expiresAt?: number | null;
  budget?: string | null;
}

export interface UserOrder {
  /** The matching engine's id (display only; 0 before dispatch). */
  orderId: number;
  /** The gateway's order id (v2 `orderId`) as a STRING: ids are decimal
   *  strings on the wire, and REST cancel/amend key on THIS id. */
  omsOrderId: string;
  marketId: number;
  market: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  originalQuantity: number;
  remainingQuantity: number;
  filledQuantity: number;
  status: OrderStatus;
  timestamp: number;
}

// No userId: identity comes from the credential; the gateway derives it.
export interface OrderRequest {
  market: string;
  orderType: OrderType;
  orderSide: OrderSide;
  price: number;
  quantity: number;
  totalPrice?: number;
  timeInForce?: TimeInForce;
  stopPrice?: number;
  trailingDelta?: number;
  displayQuantity?: number;
  timestamp: number;
}

// Ticker/Stats
export interface MarketStats {
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}
