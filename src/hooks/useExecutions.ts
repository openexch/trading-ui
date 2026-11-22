// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import { marketIdFromApi } from '../api/marketId';
import { parseDecimal } from '../api/decimal';
import { readHistoryPage } from './historyPage';
import { subscribeFillsGap } from './fillsGap';

/** One fill of GET /api/v2/fills (the caller's own), money parsed for display. */
export interface ExecutionEntry {
  /** Decimal string on the wire. */
  tradeId: string;
  /** The gateway's order id, a decimal string. */
  omsOrderId: string;
  marketId: number;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  /** True when the caller's order was resting (maker) in this fill. */
  maker: boolean;
  executedAtMs: number;
}

interface FillWire {
  tradeId: string;
  orderId: string;
  marketId: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  maker: boolean | null;
  executedAt: number;
}

/** Map one fill row. Exported for tests. */
export function mapFill(f: FillWire): ExecutionEntry {
  return {
    tradeId: f.tradeId,
    omsOrderId: f.orderId,
    marketId: marketIdFromApi(f.marketId),
    side: f.side,
    price: parseDecimal(f.price, 'price'),
    quantity: parseDecimal(f.quantity, 'quantity'),
    maker: f.maker === true,
    executedAtMs: f.executedAt,
  };
}

interface State {
  executions: ExecutionEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}

const UNAVAILABLE = 'Trade history unavailable: the history service is not answering';

/** Re-reads of page 1 while closing a stream gap, and the wait between them
 *  (the gateway's GATEWAY_HISTORY_LAG_RETRY_AFTER_MS default). */
const GAP_READS = 5;
const GAP_RETRY_MS = 1000;

const fillKey = (e: ExecutionEntry) => `${e.tradeId}|${e.omsOrderId}`;

/** Fold a re-read first page into the held list: duplicates by (tradeId,
 *  orderId) dropped, newest first. Exported for tests. */
export function mergeFills(held: ExecutionEntry[], fresh: ExecutionEntry[]): ExecutionEntry[] {
  const seen = new Set(held.map(fillKey));
  const added = fresh.filter(e => !seen.has(fillKey(e)));
  if (added.length === 0) return held;
  return [...added, ...held].sort((a, b) => b.executedAtMs - a.executedAtMs);
}

/** The caller's fills, newest first. `refresh` reads the first page;
 *  `loadMore` follows the cursor. */
export function useExecutions() {
  const [state, setState] = useState<State>({ executions: [], loading: false, error: null, hasMore: false });
  const cursorRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const page = await readHistoryPage<FillWire>('/fills', null, UNAVAILABLE);
      cursorRef.current = page.nextCursor;
      setState({ executions: page.items.map(mapFill), loading: false, error: null, hasMore: page.nextCursor !== null });
    } catch (err) {
      cursorRef.current = null;
      setState({
        executions: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load trades',
        hasMore: false,
      });
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (cursor === null) return;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const page = await readHistoryPage<FillWire>('/fills', cursor, UNAVAILABLE);
      cursorRef.current = page.nextCursor;
      setState(s => ({
        executions: [...s.executions, ...page.items.map(mapFill)],
        loading: false,
        error: null,
        hasMore: page.nextCursor !== null,
      }));
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Failed to load trades' }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A stream gap (resync, or a reconnect that could not resume): re-read page
  // 1 until the history has every event up to E, then fold it in.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const close = async (eventSeq: number, attempt: number) => {
      try {
        const page = await readHistoryPage<FillWire>('/fills', null, UNAVAILABLE);
        if (cancelled) return;
        setState(s => ({ ...s, executions: mergeFills(s.executions, page.items.map(mapFill)), error: null }));
        if ((page.eventSeq === null || page.eventSeq < eventSeq) && attempt + 1 < GAP_READS) {
          timer = window.setTimeout(() => void close(eventSeq, attempt + 1), GAP_RETRY_MS);
        }
      } catch {
        // History down (503): the gap cannot be closed now; a later refresh
        // still reads it.
        if (!cancelled && attempt + 1 < GAP_READS) {
          timer = window.setTimeout(() => void close(eventSeq, attempt + 1), GAP_RETRY_MS);
        }
      }
    };
    const unsubscribe = subscribeFillsGap(eventSeq => {
      if (timer !== undefined) window.clearTimeout(timer);
      void close(eventSeq, 0);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return { ...state, refresh, loadMore };
}
