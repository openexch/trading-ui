// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * BalancesProvider: fetches GET /api/v1/accounts/{userId} only while a
 * session exists, polls on a 5s cadence, parses the exact decimal strings
 * (oms#39) to numbers, and re-fetches on refresh().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { BalancesProvider, useBalances } from './useBalances';

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/v1/accounts/')) {
      body = {
        userId: 1,
        // Balances cross as exact decimal strings (oms#39)
        assets: [
          { asset: 'USD', assetId: 1, available: '99904.20000000', locked: '95.80000000', total: '100000.00000000' },
        ],
      };
    } else if (url.includes('/api/v1/auth/me')) {
      body = { userId: 1, username: 'dev' };
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return { mock, calls };
}

const accountCalls = (calls: { url: string; init?: RequestInit }[]) =>
  calls.filter((c) => c.url.includes('/api/v1/accounts/'));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <BalancesProvider>{children}</BalancesProvider>
    </AuthProvider>
  );
}

describe('useBalances', () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    fetchStub = stubFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch while signed out', async () => {
    const { result } = renderHook(() => useBalances(), { wrapper });
    // Let any pending effects/microtasks settle
    await act(async () => {});
    expect(accountCalls(fetchStub.calls)).toHaveLength(0);
    expect(result.current.assets).toEqual([]);
  });

  it('fetches on sign-in with the bearer header, parses decimal strings, and polls every 5s', async () => {
    // Dev token: skips the /auth/me round-trip (session.ts)
    localStorage.setItem('oe.session', JSON.stringify({ token: 'dev:1', userId: 1, username: 'dev' }));
    vi.useFakeTimers();

    const { result } = renderHook(() => useBalances(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const initial = accountCalls(fetchStub.calls);
    expect(initial).toHaveLength(1);
    expect(initial[0].url).toContain('/api/v1/accounts/1');
    const headers = initial[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dev:1');

    // Wire strings became numbers
    expect(result.current.assets).toEqual([
      { asset: 'USD', assetId: 1, available: 99904.2, locked: 95.8, total: 100000 },
    ]);

    // 5s poll cadence
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(accountCalls(fetchStub.calls)).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(accountCalls(fetchStub.calls)).toHaveLength(3);
  });

  it('refresh() re-fetches immediately', async () => {
    localStorage.setItem('oe.session', JSON.stringify({ token: 'dev:1', userId: 1, username: 'dev' }));

    const { result } = renderHook(() => useBalances(), { wrapper });
    await waitFor(() => expect(accountCalls(fetchStub.calls)).toHaveLength(1));

    await act(async () => {
      await result.current.refresh();
    });
    expect(accountCalls(fetchStub.calls)).toHaveLength(2);
  });
});
