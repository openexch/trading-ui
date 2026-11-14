// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Ladder shell smoke test: the real <App/> under ?ui=ladder with the network
 * mocked. The flag picks the new shell; without it the default screen is
 * unchanged. A market-data snapshot pushed through the mocked socket reaches
 * the ladder as rungs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../components/Chart/Chart', () => ({
  Chart: () => <div data-testid="chart-mock" />,
}));

import App from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { BalancesProvider } from '../hooks/useBalances';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  protocols?: string | string[];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {}
}

/** Every observed element reports 220px: nine 22px rungs. */
class FixedResizeObserver {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.cb([{ contentRect: { height: 220 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    void el;
  }
  unobserve() {}
  disconnect() {}
}

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function stubFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes('/api/v1/auth/me')) body = { userId: 1, username: 'dev' };
    else if (url.includes('/api/v1/orders') || url.includes('/api/v1/executions')) body = [];
    else if (url.includes('/api/v1/accounts')) body = { userId: 1, assets: [] };
    else if (url.includes('/api/candles')) body = { candles: [] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }) as unknown as typeof fetch;
}

function renderApp() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <BalancesProvider>
          <App />
        </BalancesProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Ladder shell (?ui=ladder)', () => {
  beforeEach(() => {
    cleanup();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = FixedResizeObserver as unknown as typeof ResizeObserver;
    stubMatchMedia();
    stubFetch();
    localStorage.clear();
    localStorage.setItem('oe.session', JSON.stringify({ token: 'smoketoken1', userId: 1, username: 'dev' }));
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders the ladder shell: header, ladder, the existing panels at the sides', async () => {
    window.history.replaceState({}, '', '/?ui=ladder');
    const { container } = renderApp();

    expect(await screen.findByRole('button', { name: /market btc-usd\. change market/i })).toBeTruthy();
    expect(screen.getByRole('grid', { name: /price ladder/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /depth ladder/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^dev$/i })).toBeTruthy();
    expect(screen.getByText('Connecting')).toBeTruthy();
    // Stats not in yet: dashes, never $0.00.
    expect(container.querySelector('[data-ticker-price]')!.textContent).toContain('–');
    // Existing panels sit in the side columns for now.
    expect(screen.getByRole('button', { name: /buy btc/i })).toBeTruthy();
    expect(screen.getByTestId('chart-mock')).toBeTruthy();
    // No footer and no old ticker rail in the new shell.
    expect(screen.queryByText('Open Exchange Trading Engine')).toBeNull();

    // The market selector opens from the header symbol and switches markets.
    fireEvent.click(screen.getByRole('button', { name: /market btc-usd/i }));
    fireEvent.click(await screen.findByRole('button', { name: /ethereum/i }));
    expect(await screen.findByRole('button', { name: /market eth-usd\. change market/i })).toBeTruthy();
  });

  it('draws rungs from a book snapshot pushed through the market socket', async () => {
    window.history.replaceState({}, '', '/?ui=ladder');
    const { container } = renderApp();
    await screen.findByRole('grid', { name: /price ladder/i });
    // Skeleton rungs until the first snapshot.
    expect(container.querySelectorAll('[data-skeleton-rung]').length).toBe(9);

    const ws = MockWebSocket.instances.find(w => w.url.endsWith('/ws'))!;
    const bids = Array.from({ length: 20 }, (_, i) => ({ price: 97_400 - i * 5, quantity: 1, orderCount: 1 }));
    const asks = Array.from({ length: 20 }, (_, i) => ({ price: 97_405 + i * 5, quantity: 1, orderCount: 1 }));
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({
        data: JSON.stringify({ type: 'BOOK_SNAPSHOT', marketId: 1, market: 'BTC-USD', bids, asks, timestamp: 1 }),
      });
    });
    await waitFor(() => expect(container.querySelectorAll('[data-rung-price]').length).toBe(9));
    expect(container.querySelectorAll('[data-skeleton-rung]').length).toBe(0);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('keeps the default screen without the flag', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: /open orders/i })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /price ladder/i })).toBeNull();
  });
});
