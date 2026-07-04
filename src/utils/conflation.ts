// SPDX-License-Identifier: Apache-2.0
import type {
  BookDeltaMessage,
  CandleHistoryMessage,
  CandleUpdateMessage,
  TickerStatsMessage,
  TradesBatchMessage,
  WebSocketMessage,
} from '../types/market';

/**
 * WS message conflation buffer (trading-ui#24, client half of P3.3).
 *
 * The UI used to dispatch every WS message synchronously: one JSON.parse +
 * one React render per message. Once arrival rate exceeded render rate the
 * main-thread queue grew without bound and the UI replayed the backlog
 * forever (only a reconnect discarded it). This buffer sits between the
 * socket and the App dispatch: messages accumulate here and are drained once
 * per animation frame, so all resulting setStates batch into a single render.
 *
 * Conflation rules by type:
 * - TICKER_STATS (per market), CLUSTER_STATUS: keep-latest, replaced in place.
 * - CANDLE_UPDATE (per market+interval+bucket): keep-latest in place. Distinct
 *   buckets keep distinct slots so the new-bucket append still happens.
 * - CANDLE_HISTORY: supersedes queued candle messages for its market.
 * - BOOK_SNAPSHOT: supersedes ALL queued book messages for its market
 *   (a snapshot replaces the whole book, earlier deltas are moot).
 * - BOOK_DELTA: passed through IN ORDER, never collapsed — the delta handler
 *   is positional (NEW_LEVEL inserts blindly, UPDATE_LEVEL no-ops on missing
 *   levels), so dropping intermediates can corrupt the book. The frame batch
 *   is the win: applying N deltas costs N array ops but ONE render.
 *   Escape hatch: if a market queues more than MAX_PENDING_BOOK_DELTAS in one
 *   flush window, the book backlog is hopeless — drop it and report the
 *   market in drain().refreshMarketIds so the caller requests a fresh
 *   snapshot ({action:'refresh'}), which is exactly "skip to current state".
 * - TRADES_BATCH (per market): merged in place (concat + cap; the UI renders
 *   the newest 50).
 * - Everything else (ORDER_STATUS*, CLUSTER_EVENT, ERROR, ...): passed
 *   through in arrival order.
 */

const MAX_PENDING_BOOK_DELTAS = 3000;
const MAX_MERGED_TRADES = 500;

interface Slot {
  key: string | null;
  msg: WebSocketMessage | null; // null = purged
}

export interface DrainResult {
  messages: WebSocketMessage[];
  /** Markets whose book backlog overflowed and was dropped: send
   *  {action:'refresh', marketId} for each to resync from a snapshot. */
  refreshMarketIds: number[];
}

export interface ConflatorStats {
  enqueued: number;
  delivered: number;
  coalesced: number;
  droppedBookDeltas: number;
  droppedTrades: number;
  bookRefreshes: number;
}

export class MessageConflator {
  private slots: Slot[] = [];
  private keyed = new Map<string, Slot>();
  private pendingDeltas = new Map<number, number>(); // marketId -> queued BOOK_DELTA count
  private awaitingRefresh = new Set<number>(); // markets whose backlog we dropped
  private refreshRequestedAt = new Map<number, number>(); // marketId -> last report time
  readonly stats: ConflatorStats = {
    enqueued: 0,
    delivered: 0,
    coalesced: 0,
    droppedBookDeltas: 0,
    droppedTrades: 0,
    bookRefreshes: 0,
  };

  get size(): number {
    let n = 0;
    for (const s of this.slots) if (s.msg !== null) n++;
    return n;
  }

  push(msg: WebSocketMessage): void {
    this.stats.enqueued++;
    switch (msg.type) {
      case 'TICKER_STATS':
        this.replaceInPlace(`T|${(msg as TickerStatsMessage).marketId}`, msg);
        return;
      case 'CLUSTER_STATUS':
        this.replaceInPlace('CS', msg);
        return;
      case 'CANDLE_UPDATE': {
        const m = msg as CandleUpdateMessage;
        this.replaceInPlace(`CU|${m.marketId}|${m.interval}|${m.candle.time}`, msg);
        return;
      }
      case 'CANDLE_HISTORY': {
        const m = msg as CandleHistoryMessage;
        this.purge(
          (s) =>
            (s.msg?.type === 'CANDLE_UPDATE' || s.msg?.type === 'CANDLE_HISTORY') &&
            (s.msg as CandleUpdateMessage | CandleHistoryMessage).marketId === m.marketId
        );
        this.append(null, msg);
        return;
      }
      case 'BOOK_SNAPSHOT': {
        const marketId = (msg as { marketId: number }).marketId;
        const purged = this.purge(
          (s) =>
            (s.msg?.type === 'BOOK_DELTA' || s.msg?.type === 'BOOK_SNAPSHOT') &&
            (s.msg as { marketId: number }).marketId === marketId
        );
        this.stats.coalesced += purged;
        this.pendingDeltas.delete(marketId);
        this.awaitingRefresh.delete(marketId); // the resync arrived
        this.refreshRequestedAt.delete(marketId);
        this.append(null, msg);
        return;
      }
      case 'BOOK_DELTA': {
        const m = msg as BookDeltaMessage;
        if (this.awaitingRefresh.has(m.marketId)) {
          // Backlog for this market was dropped; deltas are stale until the
          // refresh snapshot rebases the book.
          this.stats.droppedBookDeltas++;
          return;
        }
        const pending = (this.pendingDeltas.get(m.marketId) ?? 0) + 1;
        if (pending > MAX_PENDING_BOOK_DELTAS) {
          const dropped = this.purge(
            (s) =>
              (s.msg?.type === 'BOOK_DELTA' || s.msg?.type === 'BOOK_SNAPSHOT') &&
              (s.msg as { marketId: number }).marketId === m.marketId
          );
          this.stats.droppedBookDeltas += dropped + 1;
          this.pendingDeltas.delete(m.marketId);
          this.awaitingRefresh.add(m.marketId);
          return;
        }
        this.pendingDeltas.set(m.marketId, pending);
        this.append(null, msg);
        return;
      }
      case 'TRADES_BATCH': {
        const m = msg as TradesBatchMessage;
        const key = `TB|${m.marketId}`;
        const slot = this.keyed.get(key);
        if (slot && slot.msg) {
          const merged = slot.msg as TradesBatchMessage;
          const trades = merged.trades.concat(m.trades);
          if (trades.length > MAX_MERGED_TRADES) {
            this.stats.droppedTrades += trades.length - MAX_MERGED_TRADES;
            trades.splice(0, trades.length - MAX_MERGED_TRADES); // keep newest
          }
          slot.msg = { ...m, trades };
          this.stats.coalesced++;
          return;
        }
        // Copy the trades array so merging never mutates the original message.
        this.append(key, { ...m, trades: m.trades.slice() });
        return;
      }
      default:
        this.append(null, msg);
    }
  }

  private replaceInPlace(key: string, msg: WebSocketMessage): void {
    const slot = this.keyed.get(key);
    if (slot && slot.msg) {
      slot.msg = msg;
      this.stats.coalesced++;
      return;
    }
    this.append(key, msg);
  }

  private append(key: string | null, msg: WebSocketMessage): void {
    const slot: Slot = { key, msg };
    this.slots.push(slot);
    if (key) this.keyed.set(key, slot);
  }

  /** Null out slots matching the predicate; returns how many were purged. */
  private purge(predicate: (s: Slot) => boolean): number {
    let purged = 0;
    for (const s of this.slots) {
      if (s.msg !== null && predicate(s)) {
        if (s.key) this.keyed.delete(s.key);
        s.msg = null;
        purged++;
      }
    }
    return purged;
  }

  /** Refresh re-request interval while the resync snapshot has not arrived. */
  private static readonly REFRESH_RETRY_MS = 2000;

  drain(now: number = Date.now()): DrainResult {
    const messages: WebSocketMessage[] = [];
    for (const s of this.slots) {
      if (s.msg !== null) messages.push(s.msg);
    }
    // awaitingRefresh persists across drains (stale deltas keep being
    // swallowed until the snapshot rebases the book), but each market is
    // reported at most once per REFRESH_RETRY_MS so the caller does not spam
    // {action:'refresh'} at frame rate.
    const refreshMarketIds: number[] = [];
    for (const marketId of this.awaitingRefresh) {
      const last = this.refreshRequestedAt.get(marketId) ?? 0;
      if (now - last >= MessageConflator.REFRESH_RETRY_MS || last === 0) {
        refreshMarketIds.push(marketId);
        this.refreshRequestedAt.set(marketId, now);
        this.stats.bookRefreshes++;
      }
    }
    this.stats.delivered += messages.length;
    this.slots = [];
    this.keyed.clear();
    this.pendingDeltas.clear();
    return { messages, refreshMarketIds };
  }

  /** Drop everything (reconnect: the socket's backlog is void). */
  clear(): void {
    this.slots = [];
    this.keyed.clear();
    this.pendingDeltas.clear();
    this.awaitingRefresh.clear();
    this.refreshRequestedAt.clear();
  }
}
