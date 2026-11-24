// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * The anonymous engine feed against a fake socket: today's server (the
 * first frame must be auth, so it closes 1008) leaves the signed-out screen
 * exactly as before; a server that offers the engine channel fills it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { ENGINE_CHANNEL, startEngineFeed, useEngineFeed } from './useEngineFeed';
import type { EngineFeedStatus } from './useEngineFeed';
import { createEngineStore, useEngine } from '../ledger/engineStore';
import type { EngineStore } from '../ledger/engineStore';
import { EnginesPanel } from '../terminal/panels/EnginesPanel';
import type { SlotChrome } from '../terminal/layout/SideColumn';
import { engineFrame } from '../test/engine';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  protocols: unknown;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string, protocols?: unknown) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // server side
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(f: object) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code, wasClean: true });
  }
}

const Impl = FakeSocket as unknown as typeof WebSocket;
const last = () => FakeSocket.all[FakeSocket.all.length - 1];

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function feed() {
  const statuses: EngineFeedStatus[] = [];
  const engines: unknown[] = [];
  const elections: unknown[] = [];
  const f = startEngineFeed({
    url: 'ws://test/ws/v2',
    WebSocketImpl: Impl,
    onEngine: s => engines.push(s),
    onElection: e => elections.push(e),
    onStatus: s => statuses.push(s),
  });
  return { f, statuses, engines, elections };
}

describe('startEngineFeed', () => {
  it('opens /ws/v2 with no credential and asks for the engine channel alone', () => {
    const { statuses } = feed();
    const s = last();
    expect(s.url).toBe('ws://test/ws/v2');
    expect(s.protocols).toBeUndefined();
    s.open();
    expect(s.sent).toEqual([{ op: 'subscribe', channels: [ENGINE_CHANNEL] }]);
    expect(statuses).toEqual(['connecting']);
  });

  it("today's server (closes 1008: the first frame must be auth): refused once, no retry, nothing logged", () => {
    const err = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { statuses, engines } = feed();
    last().open();
    last().serverClose(1008);
    expect(statuses).toEqual(['connecting', 'refused']);
    vi.advanceTimersByTime(10 * 60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(engines).toHaveLength(0);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('no stream at all (closed before open): refused, no retry', () => {
    const { statuses } = feed();
    last().serverClose(1006);
    vi.advanceTimersByTime(10 * 60_000);
    expect(statuses).toEqual(['connecting', 'refused']);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a server that knows the op but not the channel answers an error: refused and closed', () => {
    const { statuses } = feed();
    const s = last();
    s.open();
    s.frame({ type: 'error', code: 'VALIDATION', error: 'unknown channel (orders, fills, balances)' });
    expect(statuses).toEqual(['connecting', 'refused']);
    expect(s.closed).toBe(true);
    vi.advanceTimersByTime(10 * 60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('accepted: live, engine and election frames flow, pings keep it open', () => {
    const { statuses, engines, elections } = feed();
    const s = last();
    s.open();
    s.frame({ type: 'subscribed', channels: ['engine'] });
    s.frame(engineFrame());
    s.frame({ type: 'election', cluster: 'core', phase: 'start', atMs: 2_000, previousTerm: 3, previousLeaderId: 0, candidates: [1] });
    expect(statuses).toEqual(['connecting', 'live']);
    expect(engines).toHaveLength(1);
    expect(elections).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(s.sent).toContainEqual({ op: 'ping' });
  });

  it('accepted then dropped: down, reconnects with backoff and subscribes again', () => {
    const { statuses } = feed();
    const s = last();
    s.open();
    s.frame({ type: 'subscribed', channels: ['engine'] });
    s.serverClose(1001);
    expect(statuses).toEqual(['connecting', 'live', 'down']);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
    last().open();
    expect(last().sent).toEqual([{ op: 'subscribe', channels: ['engine'] }]);
    last().frame({ type: 'subscribed', channels: ['engine'] });
    expect(statuses).toEqual(['connecting', 'live', 'down', 'live']);
  });

  it('stop closes the socket and silences every callback', () => {
    const { f, statuses, engines } = feed();
    const s = last();
    s.open();
    f.stop();
    expect(s.closed).toBe(true);
    s.frame({ type: 'subscribed', channels: ['engine'] });
    s.frame(engineFrame());
    expect(statuses).toEqual(['connecting']);
    expect(engines).toHaveLength(0);
  });
});

const chrome: SlotChrome = { slot: 0, position: 'top', picker: () => <span>Panel</span> };

/** The App's wiring signed out: the feed fills a store, live follows the feed. */
function SignedOut({ store }: { store: EngineStore }) {
  const status = useEngineFeed(true, store.engine, store.election);
  useEffect(() => store.setLive(status === 'live'), [status, store]);
  const s = useEngine(store);
  return <EnginesPanel chrome={chrome} signedIn={false} state={s} now={2_000} />;
}

describe('signed-out Engines panel', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', Impl));
  afterEach(() => vi.unstubAllGlobals());

  it("against today's server: the same sign-in note and dashes as before", () => {
    const store = createEngineStore();
    const { container } = render(<SignedOut store={store} />);
    act(() => {
      last().open();
      last().serverClose(1008);
    });
    expect(container.textContent).toContain("Engine status rides your account's stream: sign in to see it live.");
    expect(container.querySelectorAll('[data-engine-node]')).toHaveLength(0);
    expect(container.querySelector('[data-engine-bridge]')!.textContent).not.toMatch(/[0-9]/);
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('against a server with the anonymous engine channel: live values, no sign-in note', () => {
    const store = createEngineStore();
    const { container } = render(<SignedOut store={store} />);
    act(() => {
      last().open();
      last().frame({ type: 'subscribed', channels: ['engine'] });
      last().frame(engineFrame());
    });
    expect(container.textContent).not.toContain('sign in to see it live');
    expect(container.querySelectorAll('[data-engine-node]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-engine-bridge]')!.textContent).toMatch(/880/);
  });
});
