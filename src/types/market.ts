// SPDX-License-Identifier: Apache-2.0
// Market definitions
export interface Market {
  id: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  /** Engine price grid (match MarketConfig): orders must land on a tick
   *  inside [minPrice, maxPrice] or the engine rejects them (PRICE_OFF_TICK /
   *  PRICE_OUT_OF_RANGE). The order form snaps and validates against these. */
  tickSize: number;
  minPrice: number;
  maxPrice: number;
}

export const MARKETS: Market[] = [
  { id: 1, symbol: 'BTC-USD', baseAsset: 'BTC', quoteAsset: 'USD', name: 'Bitcoin', tickSize: 1, minPrice: 50_000, maxPrice: 150_000 },
  { id: 2, symbol: 'ETH-USD', baseAsset: 'ETH', quoteAsset: 'USD', name: 'Ethereum', tickSize: 0.5, minPrice: 1_000, maxPrice: 10_000 },
  { id: 3, symbol: 'SOL-USD', baseAsset: 'SOL', quoteAsset: 'USD', name: 'Solana', tickSize: 0.05, minPrice: 50, maxPrice: 500 },
  { id: 4, symbol: 'XRP-USD', baseAsset: 'XRP', quoteAsset: 'USD', name: 'Ripple', tickSize: 0.001, minPrice: 0.5, maxPrice: 10 },
  { id: 5, symbol: 'DOGE-USD', baseAsset: 'DOGE', quoteAsset: 'USD', name: 'Dogecoin', tickSize: 0.0001, minPrice: 0.05, maxPrice: 1 },
];

export interface BookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

// Aggregated trade from batch message
export interface AggregatedTrade {
  price: number;
  quantity: number;
  tradeCount: number;
  /** Taker side (market WS v5+). Absent/null on older gateway data — the UI
   *  falls back to a tick test against the previous trade. */
  side?: 'BUY' | 'SELL' | null;
  timestamp: number;
}

export interface TradesBatchMessage {
  type: 'TRADES_BATCH';
  marketId: number;
  market: string;
  trades: AggregatedTrade[];
  timestamp: number;
}

export interface BookSnapshotMessage {
  type: 'BOOK_SNAPSHOT';
  marketId: number;
  market: string;
  bids: BookLevel[];
  asks: BookLevel[];
  timestamp: number;
  version?: number;
  /** v4: single monotonic book version this snapshot represents (chains with deltas). */
  bookVersion?: number;
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
  market: string;
  changes: BookDeltaChange[];
  bidVersion: number;
  askVersion: number;
  timestamp: number;
  /** v4 chain: this delta advances the book fromVersion -> bookVersion. */
  bookVersion?: number;
  fromVersion?: number;
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
  message: string;
}

export interface TickerStatsMessage {
  type: 'TICKER_STATS';
  marketId: number;
  market: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

// Cluster status types - includes transitional states during rolling updates
export type NodeStatus = 'LEADER' | 'FOLLOWER' | 'CANDIDATE' | 'OFFLINE' | 'STOPPING' | 'STARTING' | 'REJOINING' | 'ELECTION';

export interface ClusterNode {
  id: number;
  status: NodeStatus;
  healthy: boolean;
}

export interface ClusterStatusMessage {
  type: 'CLUSTER_STATUS';
  leaderId: number;
  leadershipTermId: number;
  nodes: ClusterNode[];
  gatewayConnected: boolean;
  timestamp: number;
}

export interface ClusterEventMessage {
  type: 'CLUSTER_EVENT';
  event: 'LEADER_CHANGE' | 'NODE_UP' | 'NODE_DOWN' | 'ROLLING_UPDATE_START' | 'ROLLING_UPDATE_COMPLETE' | 'CONNECTION_LOST' | 'CONNECTION_RESTORED';
  nodeId?: number;
  newLeaderId?: number;
  message: string;
  timestamp: number;
}

// UI cluster state - aggregated from CLUSTER_STATUS and CLUSTER_EVENT messages
export interface ClusterState {
  leaderId: number;
  leadershipTermId: number;
  nodes: ClusterNode[];
  gatewayConnected: boolean;
  isRollingUpdate: boolean;
  isElecting: boolean;
  lastEvent: ClusterEventMessage | null;
  lastUpdate: number;
}

// Extended connection status that includes cluster-aware states
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
  market: string;
  interval: string;
  candles: CandleData[];
}

export interface CandleUpdateMessage {
  type: 'CANDLE_UPDATE';
  marketId: number;
  market: string;
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
  | ClusterStatusMessage
  | ClusterEventMessage
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
// PENDING_* are the OMS's pre-engine states (oms#72); FILLED/CANCELLED/REJECTED are terminal.
export type OrderStatus =
  | 'PENDING_RISK'
  | 'PENDING_HOLD'
  | 'PENDING_NEW'
  | 'PENDING_TRIGGER'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED';

/** Bare OrderResponse from the user-scoped OMS WS (/ws/v1) and the scoped
 *  REST reads (oms#72). NO `type` field on the wire — the presence of
 *  omsOrderId is what distinguishes an order event from acks/pongs. Money
 *  crosses as exact decimal strings, ids as strings (Snowflake ids overflow
 *  JS numbers, oms#39). */
export interface OmsOrderEvent {
  omsOrderId: string;
  /** Engine order id; '0' until the engine acks. */
  clusterOrderId: string;
  userId: number;
  marketId: number;
  side: 'BUY' | 'SELL';
  orderType: string;
  timeInForce: string;
  price: string;
  quantity: string;
  filledQty: string;
  remainingQty: string;
  stopPrice: string | null;
  status: string;
  rejectReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface UserOrder {
  orderId: number;
  /** OMS order id as a STRING ('' when unknown) — Snowflake ids overflow JS
   *  numbers, and REST cancel/replace must use THIS id, never orderId (#25). */
  omsOrderId: string;
  marketId: number;
  market: string;
  userId: number;
  side: OrderSide;
  type: OrderType;
  price: number;
  originalQuantity: number;
  remainingQuantity: number;
  filledQuantity: number;
  status: OrderStatus;
  timestamp: number;
}

// No userId: identity comes from the auth token; the OMS derives it (oms#36).
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
