import { useEffect, useRef, useState, useCallback } from 'react';
import type { ConnectionStatus, WebSocketMessage } from '../types/market';
import { parseJsonSafeIds } from '../utils/safeJson';
import { MessageConflator } from '../utils/conflation';

interface UseWebSocketOptions {
  marketId: number;
  onMessage: (message: WebSocketMessage) => void;
  onReconnecting?: () => void;  // Called when starting reconnect - use to reset state
  onReconnected?: () => void;   // Called after successful reconnect
}

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 30000;
// Fallback flush cadence for when requestAnimationFrame is suspended
// (hidden tab). Browsers clamp background timers to >=1s, which still bounds
// the buffer to about a second of (conflated) messages.
const HIDDEN_FLUSH_INTERVAL = 250;

// Message counter for diagnostics
let messageCount = 0;
let lastMessageLogTime = 0;

export function useWebSocket({ marketId, onMessage, onReconnecting, onReconnected }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const isReconnectRef = useRef(false);  // Track if this is a reconnection

  // Use ref for onMessage to avoid reconnecting when handler changes
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Use refs for reconnection callbacks
  const onReconnectingRef = useRef(onReconnecting);
  const onReconnectedRef = useRef(onReconnected);
  onReconnectingRef.current = onReconnecting;
  onReconnectedRef.current = onReconnected;

  // Use ref for marketId to send subscribe without reconnecting
  const marketIdRef = useRef(marketId);

  // Conflation buffer (trading-ui#24): messages accumulate here and are
  // dispatched once per animation frame so all setStates batch into one
  // render. See utils/conflation.ts for the per-type collapse rules.
  const conflatorRef = useRef<MessageConflator | null>(null);
  if (conflatorRef.current === null) {
    conflatorRef.current = new MessageConflator();
  }
  const flushRafRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const cancelFlush = useCallback(() => {
    if (flushRafRef.current !== null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushMessages = useCallback(() => {
    cancelFlush();
    const { messages, refreshMarketIds } = conflatorRef.current!.drain();
    for (const message of messages) {
      onMessageRef.current(message);
    }
    // A market's book backlog overflowed and was dropped: skip to current
    // state by requesting a fresh snapshot instead of replaying history.
    for (const refreshMarketId of refreshMarketIds) {
      console.warn('[WS] Book backlog dropped for market', refreshMarketId, '- requesting refresh');
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'refresh', marketId: refreshMarketId }));
      }
    }
  }, [cancelFlush]);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current !== null || flushTimerRef.current !== null) {
      return; // a flush is already scheduled
    }
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null;
      flushMessages();
    });
    // rAF does not fire in hidden tabs; the timer keeps the buffer bounded
    // there. Whichever fires first flushes and cancels the other.
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushMessages();
    }, HIDDEN_FLUSH_INTERVAL);
  }, [flushMessages]);

  const getWebSocketUrl = useCallback(() => {
    // Use environment variable if set (for cloudflared deployment)
    if (import.meta.env.VITE_MARKET_WS_URL) {
      return `${import.meta.env.VITE_MARKET_WS_URL}/ws`;
    }
    // Fallback to localhost for development
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    return `${protocol}//${host}:8081/ws`;
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Notify that reconnection is starting (if this is a reconnect)
    if (isReconnectRef.current && onReconnectingRef.current) {
      console.log('[WS] Reconnecting - resetting state');
      onReconnectingRef.current();
    }

    clearTimers();
    // Discard any buffered backlog from the previous socket: after a
    // reconnect the server replays fresh state via {action:'refresh'}.
    cancelFlush();
    conflatorRef.current!.clear();
    setStatus('connecting');

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to', getWebSocketUrl());
        setStatus('connected');
        reconnectAttemptRef.current = 0;

        // Subscribe to market (use ref for current marketId)
        console.log('[WS] Subscribing to market', marketIdRef.current);
        ws.send(JSON.stringify({ action: 'subscribe', marketId: marketIdRef.current }));

        // Request state refresh after reconnect
        if (isReconnectRef.current) {
          console.log('[WS] Requesting state refresh after reconnect for market', marketIdRef.current);
          ws.send(JSON.stringify({ action: 'refresh', marketId: marketIdRef.current }));
          if (onReconnectedRef.current) {
            onReconnectedRef.current();
          }
        }

        // Mark future connects as reconnects
        isReconnectRef.current = true;

        // Start ping interval
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'ping' }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          messageCount++;
          const now = Date.now();
          // Log message + conflation rate every 5 seconds
          if (now - lastMessageLogTime >= 5000) {
            const s = conflatorRef.current!.stats;
            console.log(
              `[WS] +${messageCount} msgs in last 5s | conflation totals:`,
              `delivered ${s.delivered}, coalesced ${s.coalesced},`,
              `droppedDeltas ${s.droppedBookDeltas}, refreshes ${s.bookRefreshes}`
            );
            lastMessageLogTime = now;
            messageCount = 0;
          }
          const message = parseJsonSafeIds(event.data) as WebSocketMessage;
          // Buffer + flush once per frame instead of dispatching synchronously
          conflatorRef.current!.push(message);
          scheduleFlush();
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[WS] Connection closed:', event.code, event.reason || '(no reason)');
        setStatus('disconnected');
        clearTimers();

        // Attempt reconnect with exponential backoff
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptRef.current),
            MAX_RECONNECT_DELAY
          );
          reconnectAttemptRef.current++;
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
          reconnectTimeoutRef.current = window.setTimeout(connect, delay);
        } else {
          console.error('[WS] Max reconnection attempts reached');
          setStatus('error');
        }
      };

      ws.onerror = (event) => {
        console.error('[WS] WebSocket error:', event);
        setStatus('error');
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      setStatus('error');
    }
  }, [getWebSocketUrl, clearTimers, cancelFlush, scheduleFlush]);

  const disconnect = useCallback(() => {
    clearTimers();
    cancelFlush();
    conflatorRef.current!.clear();
    reconnectAttemptRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, [clearTimers, cancelFlush]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Handle market changes by re-subscribing (without reconnecting)
  useEffect(() => {
    marketIdRef.current = marketId;
    // If already connected, send new subscription
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WS] Re-subscribing to market', marketId);
      wsRef.current.send(JSON.stringify({ action: 'subscribe', marketId }));
    }
  }, [marketId]);

  // Force reconnect - explicitly triggers onReconnecting callback
  const forceReconnect = useCallback(() => {
    isReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // connect() will be called by onclose handler, but we can also call directly for immediate effect
    connect();
  }, [connect]);

  return { status, reconnect: connect, disconnect, forceReconnect };
}
