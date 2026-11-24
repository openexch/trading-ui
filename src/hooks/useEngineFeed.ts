// SPDX-License-Identifier: Apache-2.0
/**
 * The anonymous engine feed: engine telemetry for a signed-out visitor.
 *
 * Signed in, the `engine` and `election` frames ride the user stream
 * (useUserStream). Signed out there is no user stream, so this feed asks
 * oe-stream for the engine frames alone, with no credential:
 *
 *   client -> {"op":"subscribe","channels":["engine"]}   (the first frame)
 *   server -> {"type":"subscribed","channels":["engine"]}
 *   server -> {"type":"engine",...} now and on every change, {"type":"election",...}
 *   client -> {"op":"ping"} every 30 s (the stream closes an idle socket)
 *
 * The connection opens on /ws/v2 with no subprotocol and no header; an
 * anonymous connection may only ever hold the `engine` channel.
 *
 * A server without the anonymous channel refuses it: today oe-stream closes
 * a header-less connection whose first frame is not `auth` (1008), and a
 * server that knows the op but not the channel answers an `error` frame.
 * Either way, before the subscription was accepted, the feed stops for good
 * (status `refused`): no retry, nothing logged, and the screen stays as it
 * is signed out (dashes and the sign-in note). Only a feed that was accepted
 * and then dropped reconnects, with backoff.
 */
import { useEffect, useState } from 'react';
import { parseElectionFrame, parseEngineFrame } from '../ledger/engine';
import type { ElectionEvent, EngineStatus } from '../ledger/engine';
import { userStreamUrl } from './useUserStream';

export const ENGINE_CHANNEL = 'engine';

/** off: not enabled. connecting: the socket or the subscription is pending.
 *  live: accepted and open. down: accepted before, now reconnecting.
 *  refused: the server does not offer the anonymous channel (final). */
export type EngineFeedStatus = 'off' | 'connecting' | 'live' | 'down' | 'refused';

export interface EngineFeedOptions {
  onEngine: (status: EngineStatus) => void;
  onElection: (event: ElectionEvent) => void;
  onStatus: (status: EngineFeedStatus) => void;
  /** Default: the user stream's URL (same origin /ws/v2 or VITE_STREAM_WS_URL). */
  url?: string;
  /** Default: the global WebSocket (tests pass a fake). */
  WebSocketImpl?: typeof WebSocket;
}

export interface EngineFeed {
  stop: () => void;
}

const PING_INTERVAL = 30_000;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Starts the feed at once; `stop` closes it and silences every callback. */
export function startEngineFeed(opts: EngineFeedOptions): EngineFeed {
  const Impl = opts.WebSocketImpl ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
  let stopped = false;
  let accepted = false; // the server accepted the subscription at least once
  let ws: WebSocket | null = null;
  let attempts = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let status: EngineFeedStatus = 'off';

  const setStatus = (next: EngineFeedStatus) => {
    if (stopped || next === status) return;
    status = next;
    opts.onStatus(next);
  };

  const clearTimers = () => {
    if (pingTimer !== null) clearInterval(pingTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    pingTimer = null;
    retryTimer = null;
  };

  const refuse = () => {
    clearTimers();
    const s = ws;
    ws = null;
    if (s) {
      s.onclose = null;
      s.onmessage = null;
      s.onerror = null;
      try {
        s.close();
      } catch {
        // already closing
      }
    }
    setStatus('refused');
  };

  const handle = (frame: Record<string, unknown>) => {
    switch (frame.type) {
      case 'subscribed': {
        const channels = Array.isArray(frame.channels) ? frame.channels : [];
        if (!channels.includes(ENGINE_CHANNEL)) {
          if (!accepted) refuse();
          return;
        }
        accepted = true;
        attempts = 0;
        setStatus('live');
        return;
      }
      case 'engine': {
        const s = parseEngineFrame(frame);
        if (s) opts.onEngine(s);
        return;
      }
      case 'election': {
        const e = parseElectionFrame(frame);
        if (e) opts.onElection(e);
        return;
      }
      case 'error':
        // Before acceptance an error is the server saying no (it knows the
        // op but not the anonymous channel); after it, nothing to do here.
        if (status !== 'live') refuse();
        return;
      default:
        return; // heartbeat, pong, admission: not used by this feed
    }
  };

  const connect = () => {
    if (stopped || !Impl) {
      if (!Impl) setStatus('refused');
      return;
    }
    clearTimers();
    setStatus(accepted ? 'down' : 'connecting');
    let socket: WebSocket;
    try {
      socket = new Impl(opts.url ?? userStreamUrl());
    } catch {
      setStatus('refused');
      return;
    }
    ws = socket;
    socket.onopen = () => {
      if (ws !== socket) return;
      socket.send(JSON.stringify({ op: 'subscribe', channels: [ENGINE_CHANNEL] }));
      pingTimer = setInterval(() => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ op: 'ping' }));
      }, PING_INTERVAL);
    };
    socket.onmessage = event => {
      if (ws !== socket) return;
      let frame: unknown;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isRecord(frame)) handle(frame);
    };
    // A refused or dropped socket is answered in onclose; an error event
    // carries no detail worth printing.
    socket.onerror = () => {};
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      clearTimers();
      if (stopped) return;
      if (!accepted) {
        // Closed before the subscription was accepted: today's server
        // (first frame must be auth), or no stream at all. Final.
        setStatus('refused');
        return;
      }
      setStatus('down');
      if (attempts >= MAX_RECONNECT_ATTEMPTS) return;
      const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(1.5, attempts), MAX_RECONNECT_DELAY);
      attempts++;
      retryTimer = setTimeout(connect, delay);
    };
  };

  connect();

  return {
    stop: () => {
      if (stopped) return;
      clearTimers();
      const s = ws;
      ws = null;
      stopped = true;
      if (s) {
        s.onclose = null;
        s.onmessage = null;
        s.onerror = null;
        try {
          s.close();
        } catch {
          // already closing
        }
      }
    },
  };
}

/**
 * The feed as a hook: runs while `enabled` (the App enables it while signed
 * out), feeding the given callbacks. Returns the feed's status; anything but
 * `live` means the engine values are not current.
 */
export function useEngineFeed(
  enabled: boolean,
  onEngine: (status: EngineStatus) => void,
  onElection: (event: ElectionEvent) => void,
): EngineFeedStatus {
  const [status, setStatus] = useState<EngineFeedStatus>('off');
  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    const feed = startEngineFeed({ onEngine, onElection, onStatus: setStatus });
    return () => {
      feed.stop();
      setStatus('off');
    };
  }, [enabled, onEngine, onElection]);
  return status;
}
