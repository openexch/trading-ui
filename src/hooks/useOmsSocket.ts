// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionStatus, OmsOrderEvent } from '../types/market';

interface UseOmsSocketOptions {
  /** Bearer token; null = signed out, the socket stays closed. */
  token: string | null;
  onOrderEvent: (event: OmsOrderEvent) => void;
  /** Fires after each (re)connect + subscribe; used to (re)seed via REST. */
  onConnected?: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 30000;

function getOmsSocketUrl(): string {
  // /ws/v1 lives on the same host/port as the OMS REST base
  if (import.meta.env.VITE_ORDER_API_URL) {
    return `${import.meta.env.VITE_ORDER_API_URL.replace(/^http/, 'ws')}/ws/v1`;
  }
  // Dev/preview: the Vite proxy forwards /ws/v1 to the OMS (:8080)
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws/v1`;
}

/** RFC 6455 subprotocol values must be RFC 2616 tokens. Real oms#72 session
 *  tokens are token-safe; dev 'dev:N' tokens are NOT (':' is a separator) and
 *  would make the WebSocket constructor throw. For those, connect without
 *  subprotocols — the OMS dev auth mode accepts an unauthenticated /ws/v1 and
 *  scopes it to the dev principal. Exported for tests. */
export function wsAuthProtocols(token: string): string[] | undefined {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(token) ? ['bearer', token] : undefined;
}

/**
 * User-scoped OMS WebSocket at /ws/v1 (oms#72): auth via the 'bearer'
 * subprotocol, one {"op":"subscribe","channels":["orders"]} subscription
 * (userId omitted: scoped to the token's principal), and bare OrderResponse
 * events with NO type field — anything WITH `type` is an ack/pong.
 *
 * Reconnect/backoff/ping/visibility handling mirrors useWebSocket, minus the
 * conflation buffer: per-user order events are low-rate. The server sends no
 * heartbeats, so the 30s {"op":"ping"} doubles as the silent-drop detector.
 */
export function useOmsSocket({ token, onOrderEvent, onConnected }: UseOmsSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const tokenRef = useRef(token);

  // Refs so handler changes never force a reconnect
  const onOrderEventRef = useRef(onOrderEvent);
  onOrderEventRef.current = onOrderEvent;
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

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

  const connect = useCallback(() => {
    const tok = tokenRef.current;
    if (!tok) return; // no session — stay closed
    const state = wsRef.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    clearTimers();
    setStatus('connecting');

    try {
      // Browser WS auth: token via subprotocol; the server selects 'bearer'
      const ws = new WebSocket(getOmsSocketUrl(), wsAuthProtocols(tok));
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[OMS WS] Connected');
        setStatus('connected');
        reconnectAttemptRef.current = 0;
        ws.send(JSON.stringify({ op: 'subscribe', channels: ['orders'] }));
        onConnectedRef.current?.();
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>;
          // Has `type` → ack/pong (SUBSCRIBED/PONG); has omsOrderId → order event
          if (message && typeof message === 'object' && !('type' in message) && 'omsOrderId' in message) {
            onOrderEventRef.current(message as unknown as OmsOrderEvent);
          }
        } catch (e) {
          console.error('[OMS WS] Failed to parse message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[OMS WS] Connection closed:', event.code, event.reason || '(no reason)');
        setStatus('disconnected');
        clearTimers();
        if (wsRef.current !== ws) return; // superseded by a newer socket
        wsRef.current = null;
        if (!tokenRef.current) return; // logged out — stay closed
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptRef.current),
            MAX_RECONNECT_DELAY
          );
          reconnectAttemptRef.current++;
          console.log(`[OMS WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
          reconnectTimeoutRef.current = window.setTimeout(connect, delay);
        } else {
          console.error('[OMS WS] Max reconnection attempts reached');
          setStatus('error');
        }
      };

      ws.onerror = () => {
        setStatus('error');
      };
    } catch (e) {
      console.error('[OMS WS] Failed to create WebSocket:', e);
      setStatus('error');
    }
  }, [clearTimers]);

  // Connect while a session exists; reconnect on token change (login rotates
  // the token, oms#72); close on logout.
  useEffect(() => {
    tokenRef.current = token;
    disconnect();
    if (token) {
      reconnectAttemptRef.current = 0;
      connect();
    }
    return () => {
      disconnect();
    };
  }, [token, connect, disconnect]);

  // Returning to a hidden tab: the OMS sends no heartbeats, so a silently
  // dropped socket still looks OPEN. If open, ping (forces the drop to
  // surface) and reseed via onConnected; if it died while hidden, reconnect
  // immediately with the backoff reset.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!tokenRef.current) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
        onConnectedRef.current?.();
      } else if (!ws) {
        console.log('[OMS WS] Tab visible with dead socket - reconnecting now');
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

  return { status };
}
