// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useRef, useEffect } from 'react';
import type { OrderBook, BookSnapshotMessage, BookDeltaMessage, BookLevel } from '../types/market';

export type ChangeType = 'new' | 'update';

export interface LevelChange {
  type: ChangeType;
  side: 'bid' | 'ask';
  timestamp: number;
}

// Convert price to string key for consistent Map lookups (avoids floating-point precision issues)
export const priceKey = (price: number): string => (price ?? 0).toFixed(8);

const INITIAL_ORDER_BOOK: OrderBook = {
  bids: [],
  asks: [],
  lastUpdate: 0,
};

const ANIMATION_DURATION = 500; // ms

// Bound on deltas buffered while awaiting the stitching snapshot.
const MAX_PENDING_DELTAS = 256;

/**
 * Order book state with version-chained synchronization (v4 protocol):
 * every delta advances the book fromVersion -> bookVersion and snapshots
 * carry their bookVersion, so a client can subscribe to deltas FIRST,
 * buffer them, fetch a snapshot, drop the buffered deltas the snapshot
 * already contains, and replay the rest — all clients converge on the
 * identical book. A delta whose fromVersion does not match our current
 * version means we missed an update: onResync is invoked to request a
 * fresh snapshot while new deltas buffer for stitching.
 */
export function useOrderBook(onResync?: () => void) {
  const [orderBook, setOrderBook] = useState<OrderBook>(INITIAL_ORDER_BOOK);
  const [levelChanges, setLevelChanges] = useState<Map<string, LevelChange>>(new Map());
  const pendingClearsRef = useRef<Set<string>>(new Set());
  // Current applied book version (0 = legacy/no versioning upstream).
  const bookVersionRef = useRef(0);
  // True while we buffer deltas waiting for a snapshot to stitch against.
  const awaitingSnapshotRef = useRef(true);
  const pendingDeltasRef = useRef<BookDeltaMessage[]>([]);
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;

  // Clear changes after animation duration
  useEffect(() => {
    if (levelChanges.size === 0) return;

    const now = Date.now();
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    levelChanges.forEach((change, key) => {
      if (pendingClearsRef.current.has(key)) return;
      pendingClearsRef.current.add(key);

      const elapsed = now - change.timestamp;
      const remaining = Math.max(0, ANIMATION_DURATION - elapsed);

      const timeout = setTimeout(() => {
        setLevelChanges(prev => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        pendingClearsRef.current.delete(key);
      }, remaining);

      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach(t => clearTimeout(t));
    };
  }, [levelChanges]);

  const adoptSnapshot = useCallback((message: BookSnapshotMessage) => {
    setOrderBook({
      bids: message.bids,
      asks: message.asks,
      lastUpdate: message.timestamp,
    });
    bookVersionRef.current = message.bookVersion ?? 0;
    // Clear changes on full snapshot
    setLevelChanges(new Map());
    pendingClearsRef.current.clear();
  }, []);

  const handleBookSnapshot = useCallback((message: BookSnapshotMessage) => {
    const snapV = message.bookVersion ?? 0;

    if (!awaitingSnapshotRef.current && snapV > 0 && bookVersionRef.current > 0
        && snapV < bookVersionRef.current) {
      // Stale pushed snapshot (e.g. re-broadcast for another client's
      // resync) — our delta-chained state is already newer.
      return;
    }

    adoptSnapshot(message);
    awaitingSnapshotRef.current = false;

    // Stitch: replay buffered deltas the snapshot does not contain yet.
    const pending = pendingDeltasRef.current;
    pendingDeltasRef.current = [];
    for (const delta of pending) {
      const to = delta.bookVersion ?? 0;
      if (snapV > 0 && to > 0 && to <= snapV) {
        continue; // already contained in the snapshot
      }
      // Route through the chain gate so a gap inside the buffer also
      // triggers a clean resync instead of applying past it.
      deltaGateRef.current?.(delta);
    }
  }, [adoptSnapshot]);

  // applyDelta performs the raw level mutations (no chain logic); reached
  // through a ref from handleBookSnapshot's stitching to avoid definition-
  // order coupling inside the hook.
  const applyDelta = useCallback((message: BookDeltaMessage) => {
    const newChanges = new Map<string, LevelChange>();
    const now = Date.now();

    setOrderBook((prev) => {
      const newBids = [...prev.bids];
      const newAsks = [...prev.asks];

      for (const change of message.changes) {
        const levels = change.side === 'BID' ? newBids : newAsks;
        const isBid = change.side === 'BID';
        const key = priceKey(change.price);

        if (change.updateType === 'DELETE_LEVEL') {
          // Remove the level
          const idx = levels.findIndex(l => Math.abs(l.price - change.price) < 0.0000001);
          if (idx >= 0) {
            levels.splice(idx, 1);
          }
        } else if (change.updateType === 'UPDATE_LEVEL') {
          // Update existing level
          const idx = levels.findIndex(l => Math.abs(l.price - change.price) < 0.0000001);
          if (idx >= 0) {
            levels[idx] = {
              price: change.price,
              quantity: change.quantity,
              orderCount: change.orderCount,
            };
            // Track update
            newChanges.set(key, {
              type: 'update',
              side: isBid ? 'bid' : 'ask',
              timestamp: now,
            });
          }
        } else {
          // NEW_LEVEL - insert at correct position
          const newLevel: BookLevel = {
            price: change.price,
            quantity: change.quantity,
            orderCount: change.orderCount,
          };

          // Find insertion point
          // Bids: descending (higher prices first)
          // Asks: ascending (lower prices first)
          let insertIdx = levels.length;
          for (let i = 0; i < levels.length; i++) {
            const shouldInsertBefore = isBid
              ? change.price > levels[i].price
              : change.price < levels[i].price;
            if (shouldInsertBefore) {
              insertIdx = i;
              break;
            }
          }
          levels.splice(insertIdx, 0, newLevel);

          // Track new level
          newChanges.set(key, {
            type: 'new',
            side: isBid ? 'bid' : 'ask',
            timestamp: now,
          });

          // Retention cap. Must be DEEPER than the rendered depth (20):
          // the server diffs top-of-book windows, so after a DELETE the
          // backfill level arrives as NEW_LEVEL — with a cap equal to the
          // render depth, that entrant sorted last and was popped right
          // back off, so the rendered book decayed below 20 until the next
          // full snapshot (trading-ui#34).
          if (levels.length > 64) {
            levels.pop();
          }
        }
      }

      return {
        bids: newBids,
        asks: newAsks,
        lastUpdate: message.timestamp,
      };
    });

    // Merge new changes
    if (newChanges.size > 0) {
      setLevelChanges(prev => {
        const merged = new Map(prev);
        newChanges.forEach((change, key) => {
          merged.set(key, change);
          pendingClearsRef.current.delete(key); // Reset clear timer
        });
        return merged;
      });
    }

    bookVersionRef.current = message.bookVersion ?? 0;
  }, []);



  // handleBookDelta is the chain gate in front of applyDelta.
  const handleBookDelta = useCallback((message: BookDeltaMessage) => {
    const from = message.fromVersion ?? 0;
    const to = message.bookVersion ?? 0;

    // Awaiting a snapshot (fresh subscribe, reconnect, or resync after a
    // gap): buffer deltas for stitching once it arrives.
    if (awaitingSnapshotRef.current) {
      pendingDeltasRef.current.push(message);
      if (pendingDeltasRef.current.length > MAX_PENDING_DELTAS) {
        pendingDeltasRef.current.shift();
      }
      return;
    }

    // Legacy path (no versions from the server): apply blindly, as before.
    if (to === 0 || bookVersionRef.current === 0) {
      applyDelta(message);
      return;
    }

    if (to <= bookVersionRef.current) {
      return; // stale/duplicate delta (e.g. re-broadcast at a seam)
    }
    if (from !== bookVersionRef.current) {
      // Gap: we missed at least one delta. Buffer from here and pull a
      // fresh snapshot to stitch against.
      console.warn('[book] version gap: have', bookVersionRef.current,
        'delta', from, '->', to, '- requesting snapshot');
      awaitingSnapshotRef.current = true;
      pendingDeltasRef.current = [message];
      onResyncRef.current?.();
      return;
    }
    applyDelta(message);
  }, [applyDelta]);

  const deltaGateRef = useRef<typeof handleBookDelta | null>(null);
  deltaGateRef.current = handleBookDelta;

  const resetOrderBook = useCallback(() => {
    setOrderBook(INITIAL_ORDER_BOOK);
    setLevelChanges(new Map());
    pendingClearsRef.current.clear();
    bookVersionRef.current = 0;
    awaitingSnapshotRef.current = true;
    pendingDeltasRef.current = [];
  }, []);

  return { orderBook, levelChanges, handleBookSnapshot, handleBookDelta, resetOrderBook };
}
