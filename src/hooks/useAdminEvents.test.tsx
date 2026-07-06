// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * useAdminEvents: consumes the admin gateway's SSE stream — process frames
 * become a newest-first capped feed with stable monotonic seq keys, progress
 * frames replace polling, disconnects reconnect with backoff, and unseen
 * counting resets via markSeen().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAdminEvents, type AdminProcessEvent } from './useAdminEvents';

/** Minimal scriptable EventSource stub. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const processEvent = (service: string, type = 'started'): AdminProcessEvent =>
  ({ type, service, pid: 1, at: '2026-07-06T12:00:00Z' }) as AdminProcessEvent;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAdminEvents', () => {
  it('collects process events newest-first with stable seqs and counts unseen', () => {
    const { result } = renderHook(() => useAdminEvents());
    const es = FakeEventSource.instances[0];
    act(() => es.open());
    expect(result.current.connected).toBe(true);

    act(() => {
      es.emit('process', processEvent('sim', 'stopped'));
      es.emit('process', processEvent('sim', 'started'));
    });

    expect(result.current.events).toHaveLength(2);
    // Newest first, monotonic seq
    expect(result.current.events[0].ev.type).toBe('started');
    expect(result.current.events[0].seq).toBeGreaterThan(result.current.events[1].seq);
    expect(result.current.unseen).toBe(2);

    act(() => result.current.markSeen());
    expect(result.current.unseen).toBe(0);
  });

  it('caps the buffer at 200 entries', () => {
    const { result } = renderHook(() => useAdminEvents());
    const es = FakeEventSource.instances[0];
    act(() => es.open());
    act(() => {
      for (let i = 0; i < 230; i++) es.emit('process', processEvent(`svc${i}`));
    });
    expect(result.current.events).toHaveLength(200);
    // The newest survives, the oldest fell off
    expect(result.current.events[0].ev.service).toBe('svc229');
  });

  it('exposes progress frames', () => {
    const { result } = renderHook(() => useAdminEvents());
    const es = FakeEventSource.instances[0];
    act(() => es.open());
    act(() =>
      es.emit('progress', { operation: 'housekeeping', currentStep: 1, totalSteps: 3, complete: false, error: false })
    );
    expect(result.current.progress?.operation).toBe('housekeeping');
  });

  it('reconnects with backoff after the stream closes', async () => {
    const { result } = renderHook(() => useAdminEvents());
    const es = FakeEventSource.instances[0];
    act(() => es.open());

    act(() => es.fail());
    expect(result.current.connected).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);

    // First retry after ~1s
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => FakeEventSource.instances[1].open());
    expect(result.current.connected).toBe(true);
  });

  it('invokes the process-event callback (used to refresh the process list)', () => {
    const seen: string[] = [];
    renderHook(() => useAdminEvents((ev) => seen.push(ev.service)));
    const es = FakeEventSource.instances[0];
    act(() => es.open());
    act(() => es.emit('process', processEvent('node1', 'crashed')));
    expect(seen).toEqual(['node1']);
  });
});
