// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_BASE } from '../components/admin/api';

const MAX_EVENTS = 200;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export type AdminEventType =
  | 'started' | 'stopped' | 'crashed' | 'cascade-stop' | 'disarmed' | 'adopted';

export interface AdminProcessEvent {
  type: AdminEventType;
  service: string;
  pid?: number;
  detail?: string;
  at: string;
}

export interface AdminProgress {
  operation?: string;
  opId?: string;
  currentStep: number;
  totalSteps: number;
  status?: string;
  complete: boolean;
  error: boolean;
  progress?: number;
  elapsedMs?: number;
}

/** One feed row; seq is a monotonic client counter so rows keep stable keys
 *  (DESIGN.md non-negotiable: stable keys, no per-row remounts). */
export interface FeedEntry {
  seq: number;
  ev: AdminProcessEvent;
}

/**
 * Live admin events over SSE (GET /api/admin/events): agent lifecycle events
 * plus operation progress pushed on change — replaces HTTP fast-polling of
 * /api/admin/progress while connected. The stream is live-only and
 * best-effort by design; /api/admin/status stays the source of truth and
 * callers keep their slow status poll.
 *
 * Reconnect/backoff/visibility handling mirrors useOmsSocket (manual, so the
 * backoff is bounded and a hidden-tab death reconnects immediately on
 * return). Auth rides the same-origin request (vite proxy in dev, reverse
 * proxy in prod) — never tokens in URLs.
 */
export function useAdminEvents(onProcessEvent?: (ev: AdminProcessEvent) => void): {
  events: FeedEntry[];
  progress: AdminProgress | null;
  connected: boolean;
  unseen: number;
  markSeen: () => void;
} {
  const [events, setEvents] = useState<FeedEntry[]>([]);
  const [progress, setProgress] = useState<AdminProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const onProcessEventRef = useRef(onProcessEvent);
  onProcessEventRef.current = onProcessEvent;

  const connect = useCallback(() => {
    if (esRef.current) return;
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const es = new EventSource(`${ADMIN_BASE}/api/admin/events`);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;
    };

    es.addEventListener('process', (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent).data) as AdminProcessEvent;
        const entry: FeedEntry = { seq: ++seqRef.current, ev };
        setEvents((prev) => [entry, ...prev].slice(0, MAX_EVENTS));
        setUnseen((n) => n + 1);
        onProcessEventRef.current?.(ev);
      } catch {
        // Ignore unparseable frames
      }
    });

    es.addEventListener('progress', (msg) => {
      try {
        setProgress(JSON.parse((msg as MessageEvent).data) as AdminProgress);
      } catch {
        // Ignore
      }
    });

    es.onerror = () => {
      // EventSource retries CONNECTING itself; only take over once CLOSED.
      if (es.readyState !== EventSource.CLOSED) return;
      if (esRef.current !== es) return; // superseded
      esRef.current = null;
      setConnected(false);
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptRef.current),
          MAX_RECONNECT_DELAY
        );
        reconnectAttemptRef.current++;
        reconnectTimeoutRef.current = window.setTimeout(connect, delay);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      const es = esRef.current;
      esRef.current = null;
      es?.close();
      setConnected(false);
    };
  }, [connect]);

  // Returning to a hidden tab with a dead stream: reconnect immediately with
  // the backoff reset (same trick as useOmsSocket).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (esRef.current) return;
      reconnectAttemptRef.current = 0;
      connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connect]);

  const markSeen = useCallback(() => setUnseen(0), []);

  return { events, progress, connected, unseen, markSeen };
}
