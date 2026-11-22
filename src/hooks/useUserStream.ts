// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import { EV, track } from '../analytics';
import { STREAM_WS_URL } from '../config';
import type { ApiOrder, ConnectionStatus } from '../types/market';
import { notifyFillsGap } from './fillsGap';

interface UseUserStreamOptions {
  /** Bearer token; null = signed out, the socket stays closed. */
  token: string | null;
  /** One `order` frame: the order's full state after an event. */
  onOrderEvent: (order: ApiOrder) => void;
  /** An orders `snapshot`: the full open set; replaces what is held. */
  onSnapshot?: (orders: ApiOrder[]) => void;
  /** After each (re)connect and subscribe; used to (re)seed via REST. */
  onConnected?: () => void;
  /** A `resync` frame: the stream could not continue the sequence. A fresh
   *  orders snapshot follows; fills of the gap must be re-read from REST. */
  onResync?: (reason: string) => void;
  /** Send `resume` with the last eventSeq on a reconnect (default true). */
  resume?: boolean;
  /** Fills may have been missed up to this eventSeq (the snapshot after a
   *  resync, or after a reconnect that could not resume). Default: tell the
   *  mounted fills lists to re-read GET /api/v2/fills (fillsGap.ts). */
  onFillsGap?: (eventSeq: number) => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 30000;
/** Close code of oe-stream when a slow client hits its queue bound. */
const CLOSE_RESYNC = 4001;

/** The user stream URL: VITE_STREAM_WS_URL as given (the full /ws/v2 URL),
 *  else same origin /ws/v2. Exported for tests. */
export function userStreamUrl(): string {
  if (STREAM_WS_URL) return STREAM_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/v2`;
}

/** RFC 6455 subprotocol values must be RFC 2616 tokens. Demo tokens (base64url)
 *  and JWTs are; a dev token `dev:N` is not (':' is a separator) and would
 *  make the WebSocket constructor throw. For those the stream's first-frame
 *  auth is used instead. Exported for tests. */
export function wsAuthProtocols(token: string): string[] | undefined {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(token) ? ['bearer', token] : undefined;
}

function seqOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * The user stream (`/ws/v2` on oe-stream). Auth by the `bearer` subprotocol
 * (first-frame `{"op":"auth"}` for a token that is not a subprotocol token),
 * one `{"op":"subscribe","channels":["orders"]}`, typed frames with an
 * exchange-wide `eventSeq`. The last eventSeq seen (order, heartbeat, pong,
 * snapshot asOf) is kept per session; a reconnect subscribes with
 * `resume:{eventSeq}` so the stream replays the gap, or answers `resync`
 * and a fresh snapshot.
 */
export function useUserStream({
  token,
  onOrderEvent,
  onSnapshot,
  onConnected,
  onResync,
  resume = true,
  onFillsGap = notifyFillsGap,
}: UseUserStreamOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const tokenRef = useRef(token);
  const lastSeqRef = useRef<number | null>(null);
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const onFillsGapRef = useRef(onFillsGap);
  onFillsGapRef.current = onFillsGap;
  // Whether a socket of this session was open before (a later open is a
  // reconnect), and whether the next orders snapshot closes a gap.
  const connectedBeforeRef = useRef(false);
  const gapPendingRef = useRef(false);

  // Refs so handler changes never force a reconnect
  const onOrderEventRef = useRef(onOrderEvent);
  onOrderEventRef.current = onOrderEvent;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;

  const seen = useCallback((seq: number | null) => {
    if (seq !== null && (lastSeqRef.current === null || seq > lastSeqRef.current)) lastSeqRef.current = seq;
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimers();
    reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      ws.onclose = null; // intentional close: silence the reconnect path
      ws.close();
    }
    setStatus('disconnected');
  }, [clearTimers]);

  const handleFrame = useCallback((frame: Record<string, unknown>) => {
    switch (frame.type) {
      case 'order': {
        seen(seqOf(frame.eventSeq));
        const order = frame.order as ApiOrder | undefined;
        if (order && typeof order.orderId === 'string') onOrderEventRef.current(order);
        return;
      }
      case 'snapshot': {
        if (frame.channel !== 'orders') return;
        const asOf = seqOf((frame.asOf as { eventSeq?: unknown } | undefined)?.eventSeq);
        seen(asOf);
        if (Array.isArray(frame.orders)) onSnapshotRef.current?.(frame.orders as ApiOrder[]);
        if (gapPendingRef.current && asOf !== null) {
          gapPendingRef.current = false;
          onFillsGapRef.current(asOf);
        }
        return;
      }
      case 'heartbeat':
      case 'pong':
        seen(seqOf(frame.eventSeq));
        return;
      case 'resync': {
        // The sequence broke. The resume position is no longer useful; the
        // snapshot that follows carries the new position.
        lastSeqRef.current = null;
        gapPendingRef.current = true;
        const reason = typeof frame.reason === 'string' ? frame.reason : 'UNKNOWN';
        console.warn('[stream] resync:', reason);
        onResyncRef.current?.(reason);
        return;
      }
      case 'error':
        console.error('[stream] refused a frame:', frame.code, frame.error);
        return;
      // subscribed, fill, balance, admission, engine, election: not used
      // by this UI (fills are read through REST, balances are polled, the
      // engine rail is not wired).
      default:
        return;
    }
  }, [seen]);

  const connect = useCallback(() => {
    const tok = tokenRef.current;
    if (!tok) return; // no session: stay closed
    const state = wsRef.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    clearTimers();
    setStatus('connecting');

    try {
      const protocols = wsAuthProtocols(tok);
      const ws = new WebSocket(userStreamUrl(), protocols);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        // The user's own order events arrive here. Losing it means fills
        // stop appearing on screen while the orders are real.
        if (reconnectAttemptRef.current > 0) {
          track(EV.socket_reconnected, { socket: 'oms', attempts: reconnectAttemptRef.current });
        }
        reconnectAttemptRef.current = 0;
        if (!protocols) ws.send(JSON.stringify({ op: 'auth', token: tok }));
        const sub: Record<string, unknown> = { op: 'subscribe', channels: ['orders'] };
        if (resumeRef.current && lastSeqRef.current !== null) sub.resume = { eventSeq: lastSeqRef.current };
        // A reconnect without resume gets a fresh snapshot and no replay:
        // fills between the two connections were missed.
        else if (connectedBeforeRef.current) gapPendingRef.current = true;
        connectedBeforeRef.current = true;
        ws.send(JSON.stringify(sub));
        onConnectedRef.current?.();
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as unknown;
          if (frame && typeof frame === 'object' && !Array.isArray(frame)) handleFrame(frame as Record<string, unknown>);
        } catch (e) {
          console.error('[stream] Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        setStatus('disconnected');
        track(EV.socket_disconnected, {
          socket: 'oms',
          code: event.code,
          clean: event.wasClean,
          attempts: reconnectAttemptRef.current,
        });
        clearTimers();
        if (wsRef.current !== ws) return; // superseded by a newer socket
        wsRef.current = null;
        if (!tokenRef.current) return; // logged out: stay closed
        if (event.code === CLOSE_RESYNC) {
          // Queue bound reached: reconnect now and resume from the last seq.
          reconnectAttemptRef.current = 0;
          connect();
          return;
        }
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptRef.current),
            MAX_RECONNECT_DELAY
          );
          reconnectAttemptRef.current++;
          reconnectTimeoutRef.current = window.setTimeout(connect, delay);
        } else {
          console.error('[stream] Max reconnection attempts reached');
          setStatus('error');
        }
      };

      ws.onerror = () => {
        setStatus('error');
      };
    } catch (e) {
      console.error('[stream] Failed to create WebSocket:', e);
      setStatus('error');
    }
  }, [clearTimers, handleFrame]);

  // Connect while a session exists; a new token (login rotates it) starts a
  // new sequence; close on logout.
  useEffect(() => {
    tokenRef.current = token;
    lastSeqRef.current = null;
    connectedBeforeRef.current = false;
    gapPendingRef.current = false;
    disconnect();
    if (token) {
      reconnectAttemptRef.current = 0;
      connect();
    }
    return () => {
      disconnect();
    };
  }, [token, connect, disconnect]);

  // Returning to a hidden tab: if the socket is open, ping (a silently dead
  // socket surfaces) and reseed; if it died while hidden, reconnect now.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!tokenRef.current) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
        onConnectedRef.current?.();
      } else if (!ws) {
        reconnectAttemptRef.current = 0;
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connect]);

  // Drop the socket and reconnect at once (resuming from the last eventSeq).
  const forceReconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      ws.onclose = null;
      ws.close();
    }
    clearTimers();
    reconnectAttemptRef.current = 0;
    connect();
  }, [clearTimers, connect]);

  return { status, forceReconnect };
}
