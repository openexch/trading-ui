// SPDX-License-Identifier: Apache-2.0
/**
 * Market-data frames of `oe-marketdata` (`/ws` and `GET /api/candles`): the
 * wire types, the field schema of every frame, and the one decoder that turns
 * a parsed frame into UI state types (decimal strings become numbers here and
 * nowhere else).
 *
 * "dec" is a decimal string with at most 8 fraction digits, "sdec" the same
 * with an optional leading '-' (the 24 h change fields), "num" a JSON number.
 * A frame that breaks its schema is refused with the field named, for
 * example `price is not a decimal string`; the socket drops it and logs.
 */
import { isDecimalString } from './decimal';
import type {
  BookDeltaMessage,
  BookSnapshotMessage,
  CandleData,
  CandleHistoryMessage,
  CandleUpdateMessage,
  ErrorMessage,
  PongMessage,
  SubscriptionConfirmMessage,
  TickerStatsMessage,
  TickersMessage,
  TradesBatchMessage,
  WebSocketMessage,
} from '../types/market';

// ---- wire types (exactly what the service sends) ---------------------------

export interface BookLevelWire {
  price: string;
  quantity: string;
  orderCount: number;
}

export interface BookSnapshotWire {
  type: 'BOOK_SNAPSHOT';
  marketId: number;
  bids: BookLevelWire[];
  asks: BookLevelWire[];
  bookVersion: number;
  timestamp: number;
  stale?: true;
}

export interface BookChangeWire {
  price: string;
  quantity: string;
  orderCount: number;
  side: 'BID' | 'ASK';
  updateType: 'NEW_LEVEL' | 'UPDATE_LEVEL' | 'DELETE_LEVEL';
}

export interface BookDeltaWire {
  type: 'BOOK_DELTA';
  marketId: number;
  changes: BookChangeWire[];
  bidVersion: number;
  askVersion: number;
  bookVersion: number;
  fromVersion: number;
  timestamp: number;
}

export interface TradeWire {
  tradeId: string;
  price: string;
  quantity: string;
  tradeCount: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
  /** The matching engine's journal sequence of the trade (optional: a
   *  service that does not send it yet leaves the tape's column a dash). */
  journalSeq?: number;
}

export interface TradesBatchWire {
  type: 'TRADES_BATCH';
  marketId: number;
  trades: TradeWire[];
  timestamp: number;
}

export interface TickerStatsWire {
  type: 'TICKER_STATS';
  marketId: number;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  timestamp: number;
}

export type TickerEntryWire = Omit<TickerStatsWire, 'type'>;

export interface TickersWire {
  type: 'TICKERS';
  tickers: TickerEntryWire[];
  timestamp: number;
}

export interface CandleWire {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  tradeCount: number;
}

export interface CandleHistoryWire {
  type: 'CANDLE_HISTORY';
  marketId: number;
  interval: string;
  candles: CandleWire[];
}

export interface CandleUpdateWire {
  type: 'CANDLE_UPDATE';
  marketId: number;
  interval: string;
  candle: CandleWire;
}

export interface CandlesBodyWire {
  marketId: number;
  interval: string;
  candles: CandleWire[];
}

export interface SubscriptionConfirmedWire {
  type: 'SUBSCRIPTION_CONFIRMED';
  status: string;
  marketId: number;
}

export interface PongWire {
  type: 'PONG';
  timestamp: number;
}

export interface ErrorWire {
  type: 'ERROR';
  code: string;
  message: string;
  parts?: string[];
}

// ---- schema ------------------------------------------------------------------

type Kind =
  | 'dec'
  | 'sdec'
  | 'num'
  | 'str'
  | 'true'
  | { enum: readonly string[] }
  | { arrayOf: Schema }
  | { object: Schema }
  | 'strings';

/** Field name -> kind; a `?` suffix marks an optional field. */
type Schema = Readonly<Record<string, Kind>>;

/** A schema whose keys are exactly the keys of T (optional keys of T carry a
 *  `?` suffix). Excess or missing keys fail to compile, which ties the schema
 *  below to the wire types above. */
type SchemaOf<T> = {
  readonly [K in keyof T as undefined extends T[K] ? `${K & string}?` : K]-?: Kind;
};

const LEVEL = { price: 'dec', quantity: 'dec', orderCount: 'num' } as const satisfies SchemaOf<BookLevelWire>;
const CHANGE = {
  price: 'dec',
  quantity: 'dec',
  orderCount: 'num',
  side: { enum: ['BID', 'ASK'] },
  updateType: { enum: ['NEW_LEVEL', 'UPDATE_LEVEL', 'DELETE_LEVEL'] },
} as const satisfies SchemaOf<BookChangeWire>;
const TRADE = {
  tradeId: 'dec',
  price: 'dec',
  quantity: 'dec',
  tradeCount: 'num',
  side: { enum: ['BUY', 'SELL'] },
  timestamp: 'num',
  'journalSeq?': 'num',
} as const satisfies SchemaOf<TradeWire>;
const TICKER_ENTRY = {
  marketId: 'num',
  lastPrice: 'dec',
  priceChange: 'sdec',
  priceChangePercent: 'sdec',
  high24h: 'dec',
  low24h: 'dec',
  volume24h: 'dec',
  timestamp: 'num',
} as const satisfies SchemaOf<TickerEntryWire>;
const CANDLE = {
  time: 'num',
  open: 'dec',
  high: 'dec',
  low: 'dec',
  close: 'dec',
  volume: 'dec',
  tradeCount: 'num',
} as const satisfies SchemaOf<CandleWire>;

/** Every frame of the public surface, by `type`. */
export const FRAME_SCHEMA = {
  BOOK_SNAPSHOT: {
    type: 'str',
    marketId: 'num',
    bids: { arrayOf: LEVEL },
    asks: { arrayOf: LEVEL },
    bookVersion: 'num',
    timestamp: 'num',
    'stale?': 'true',
  } satisfies SchemaOf<BookSnapshotWire>,
  BOOK_DELTA: {
    type: 'str',
    marketId: 'num',
    changes: { arrayOf: CHANGE },
    bidVersion: 'num',
    askVersion: 'num',
    bookVersion: 'num',
    fromVersion: 'num',
    timestamp: 'num',
  } satisfies SchemaOf<BookDeltaWire>,
  TRADES_BATCH: {
    type: 'str',
    marketId: 'num',
    trades: { arrayOf: TRADE },
    timestamp: 'num',
  } satisfies SchemaOf<TradesBatchWire>,
  TICKER_STATS: { type: 'str', ...TICKER_ENTRY } satisfies SchemaOf<TickerStatsWire>,
  TICKERS: {
    type: 'str',
    tickers: { arrayOf: TICKER_ENTRY },
    timestamp: 'num',
  } satisfies SchemaOf<TickersWire>,
  CANDLE_HISTORY: {
    type: 'str',
    marketId: 'num',
    interval: 'str',
    candles: { arrayOf: CANDLE },
  } satisfies SchemaOf<CandleHistoryWire>,
  CANDLE_UPDATE: {
    type: 'str',
    marketId: 'num',
    interval: 'str',
    candle: { object: CANDLE },
  } satisfies SchemaOf<CandleUpdateWire>,
  SUBSCRIPTION_CONFIRMED: { type: 'str', status: 'str', marketId: 'num' } satisfies SchemaOf<SubscriptionConfirmedWire>,
  PONG: { type: 'str', timestamp: 'num' } satisfies SchemaOf<PongWire>,
  ERROR: { type: 'str', code: 'str', message: 'str', 'parts?': 'strings' } satisfies SchemaOf<ErrorWire>,
} as const;

/** The body of `GET /api/candles`. */
export const CANDLES_BODY_SCHEMA = {
  marketId: 'num',
  interval: 'str',
  candles: { arrayOf: CANDLE },
} as const satisfies SchemaOf<CandlesBodyWire>;

export type FrameType = keyof typeof FRAME_SCHEMA;

// ---- validation ----------------------------------------------------------------

const SIGNED_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/;

function check(value: unknown, kind: Kind, field: string): void {
  if (kind === 'dec') {
    if (!isDecimalString(value)) throw new Error(`${field} is not a decimal string`);
  } else if (kind === 'sdec') {
    if (typeof value !== 'string' || !SIGNED_DECIMAL.test(value)) {
      throw new Error(`${field} is not a decimal string`);
    }
  } else if (kind === 'num') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} is not a JSON number`);
  } else if (kind === 'str') {
    if (typeof value !== 'string') throw new Error(`${field} is not a string`);
  } else if (kind === 'true') {
    if (value !== true) throw new Error(`${field} is not true`);
  } else if (kind === 'strings') {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
      throw new Error(`${field} is not a list of strings`);
    }
  } else if ('enum' in kind) {
    if (typeof value !== 'string' || !kind.enum.includes(value)) {
      throw new Error(`${field} is not one of ${kind.enum.join(', ')}`);
    }
  } else if ('arrayOf' in kind) {
    if (!Array.isArray(value)) throw new Error(`${field} is not a list`);
    for (const item of value) checkObject(item, kind.arrayOf, field);
  } else {
    checkObject(value, kind.object, field);
  }
}

function checkObject(raw: unknown, schema: Schema, where: string): void {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where} is not an object`);
  }
  const o = raw as Record<string, unknown>;
  const known = new Set<string>();
  for (const [key, kind] of Object.entries(schema)) {
    const optional = key.endsWith('?');
    const name = optional ? key.slice(0, -1) : key;
    known.add(name);
    if (!(name in o)) {
      if (optional) continue;
      throw new Error(`${name} is missing`);
    }
    check(o[name], kind, name);
  }
  for (const key of Object.keys(o)) {
    if (!known.has(key)) throw new Error(`${key} is not a field of ${where}`);
  }
}

/** Validate a parsed frame against its schema. Returns the frame type. */
export function validateFrame(raw: unknown): FrameType {
  if (raw === null || typeof raw !== 'object') throw new Error('frame is not an object');
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !(type in FRAME_SCHEMA)) {
    throw new Error(`unknown frame type ${JSON.stringify(type)}`);
  }
  checkObject(raw, FRAME_SCHEMA[type as FrameType], type);
  return type as FrameType;
}

// ---- decoding into UI state types ----------------------------------------------

const n = Number;

function candle(c: CandleWire): CandleData {
  return {
    time: c.time,
    open: n(c.open),
    high: n(c.high),
    low: n(c.low),
    close: n(c.close),
    volume: n(c.volume),
    tradeCount: c.tradeCount,
  };
}

function ticker(t: TickerEntryWire) {
  return {
    marketId: t.marketId,
    lastPrice: n(t.lastPrice),
    priceChange: n(t.priceChange),
    priceChangePercent: n(t.priceChangePercent),
    high24h: n(t.high24h),
    low24h: n(t.low24h),
    volume24h: n(t.volume24h),
    timestamp: t.timestamp,
  };
}

/** Validate and decode one market frame. Throws on a schema break. */
export function decodeMarketFrame(raw: unknown): WebSocketMessage {
  const type = validateFrame(raw);
  switch (type) {
    case 'BOOK_SNAPSHOT': {
      const f = raw as BookSnapshotWire;
      const level = (l: BookLevelWire) => ({ price: n(l.price), quantity: n(l.quantity), orderCount: l.orderCount });
      const out: BookSnapshotMessage = {
        type: 'BOOK_SNAPSHOT',
        marketId: f.marketId,
        bids: f.bids.map(level),
        asks: f.asks.map(level),
        bookVersion: f.bookVersion,
        timestamp: f.timestamp,
      };
      if (f.stale) out.stale = true;
      return out;
    }
    case 'BOOK_DELTA': {
      const f = raw as BookDeltaWire;
      const out: BookDeltaMessage = {
        type: 'BOOK_DELTA',
        marketId: f.marketId,
        changes: f.changes.map(c => ({
          price: n(c.price),
          quantity: n(c.quantity),
          orderCount: c.orderCount,
          side: c.side,
          updateType: c.updateType,
        })),
        bidVersion: f.bidVersion,
        askVersion: f.askVersion,
        bookVersion: f.bookVersion,
        fromVersion: f.fromVersion,
        timestamp: f.timestamp,
      };
      return out;
    }
    case 'TRADES_BATCH': {
      const f = raw as TradesBatchWire;
      const out: TradesBatchMessage = {
        type: 'TRADES_BATCH',
        marketId: f.marketId,
        trades: f.trades.map(t => ({
          tradeId: t.tradeId,
          price: n(t.price),
          quantity: n(t.quantity),
          tradeCount: t.tradeCount,
          side: t.side,
          timestamp: t.timestamp,
          journalSeq: Number.isInteger(t.journalSeq) ? t.journalSeq! : null,
        })),
        timestamp: f.timestamp,
      };
      return out;
    }
    case 'TICKER_STATS': {
      const out: TickerStatsMessage = { type: 'TICKER_STATS', ...ticker(raw as TickerStatsWire) };
      return out;
    }
    case 'TICKERS': {
      const f = raw as TickersWire;
      const out: TickersMessage = { type: 'TICKERS', tickers: f.tickers.map(ticker), timestamp: f.timestamp };
      return out;
    }
    case 'CANDLE_HISTORY': {
      const f = raw as CandleHistoryWire;
      const out: CandleHistoryMessage = {
        type: 'CANDLE_HISTORY',
        marketId: f.marketId,
        interval: f.interval,
        candles: f.candles.map(candle),
      };
      return out;
    }
    case 'CANDLE_UPDATE': {
      const f = raw as CandleUpdateWire;
      const out: CandleUpdateMessage = {
        type: 'CANDLE_UPDATE',
        marketId: f.marketId,
        interval: f.interval,
        candle: candle(f.candle),
      };
      return out;
    }
    case 'SUBSCRIPTION_CONFIRMED': {
      const f = raw as SubscriptionConfirmedWire;
      const out: SubscriptionConfirmMessage = { type: 'SUBSCRIPTION_CONFIRMED', status: f.status, marketId: f.marketId };
      return out;
    }
    case 'PONG': {
      const out: PongMessage = { type: 'PONG', timestamp: (raw as PongWire).timestamp };
      return out;
    }
    case 'ERROR': {
      const f = raw as ErrorWire;
      const out: ErrorMessage = { type: 'ERROR', code: f.code, message: f.message };
      if (f.parts) out.parts = [...f.parts];
      return out;
    }
  }
}

/** Validate and decode a `GET /api/candles` body. Throws on a schema break. */
export function decodeCandlesBody(raw: unknown): { marketId: number; interval: string; candles: CandleData[] } {
  checkObject(raw, CANDLES_BODY_SCHEMA, 'candles body');
  const f = raw as CandlesBodyWire;
  return { marketId: f.marketId, interval: f.interval, candles: f.candles.map(candle) };
}
