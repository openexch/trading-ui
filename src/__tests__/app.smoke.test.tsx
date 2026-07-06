// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * App smoke test (trading-ui#20): render the real <App/> with the network
 * mocked (WS never connects, fetch returns canned OMS/gateway shapes),
 * assert it mounts, and drive the order form through a submit — pinning
 * that the OMS request goes out with money as exact decimal strings and
 * no userId in the body (oms#36/#39 wire contract).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// lightweight-charts needs a real canvas; the chart is not what a smoke
// test exercises. Mocking the module also keeps jsdom from loading it.
vi.mock('../components/Chart/Chart', () => ({
  Chart: () => <div data-testid="chart-mock" />,
}));

import App from '../App';
import { AuthProvider } from '../auth/AuthContext';

// ---- jsdom gaps -----------------------------------------------------------

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  protocols?: string | string[];
  readyState = 0; // CONNECTING forever — the app must still render
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

/** fetch mock returning empty-but-valid OMS/gateway shapes per route. */
function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/v1/orders') && init?.method === 'POST') {
      body = { accepted: true, omsOrderId: '331911111111111111', status: 'PENDING_NEW' };
    } else if (url.includes('/api/v1/auth/me')) {
      body = { userId: 1, username: 'dev' };
    } else if (url.includes('/api/v1/orders/history') || url.includes('/api/v1/executions')) {
      body = []; // terminal history / fills
    } else if (url.includes('/api/v1/orders')) {
      body = []; // active (open) orders seed
    } else if (url.includes('/api/v1/accounts')) {
      body = { userId: 1, assets: [] };
    } else if (url.includes('/api/candles')) {
      body = { candles: [] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return { mock, calls };
}

// ---- tests ----------------------------------------------------------------

describe('App smoke', () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    cleanup();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    stubMatchMedia();
    fetchStub = stubFetch();
    // VITE_AUTH_TOKEN is not set under vitest; a stored session stands in for
    // it. Token-safe (non-dev:) so /auth/me validation (stubbed 200) and the
    // bearer-subprotocol path are both exercised (oms#72).
    localStorage.clear();
    localStorage.setItem('oe.session', JSON.stringify({ token: 'smoketoken1', userId: 1, username: 'dev' }));
  });

  it('mounts the trading page and opens market-data + OMS sockets', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    );

    // Order form is up for the default market (BTC-USD)
    expect(await screen.findByRole('button', { name: /buy btc/i })).toBeTruthy();
    // Market-data WS was opened, plus the user-scoped OMS socket (oms#72)
    const urls = MockWebSocket.instances.map((ws) => ws.url);
    expect(urls.some((u) => u.endsWith('/ws'))).toBe(true);
    const oms = MockWebSocket.instances.find((ws) => ws.url.endsWith('/ws/v1'));
    expect(oms, 'expected an OMS /ws/v1 socket').toBeTruthy();
    // Auth rides the subprotocol: ['bearer', <token>]
    expect(oms!.protocols).toEqual(['bearer', 'smoketoken1']);
  });

  it('submits a limit order to the OMS with exact money strings and no userId', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    );

    const buyButton = await screen.findByRole('button', { name: /buy btc/i });
    const form = buyButton.closest('form')!;
    expect(form).toBeTruthy();

    // LIMIT is the default order type: first number input = price, second = quantity
    const inputs = form.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(inputs[0], { target: { value: '100000' } });
    fireEvent.change(inputs[1], { target: { value: '0.5' } });

    fireEvent.click(buyButton);

    await waitFor(() => {
      const post = fetchStub.calls.find(
        (c) => c.url.includes('/api/v1/orders') && c.init?.method === 'POST'
      );
      expect(post, 'expected a POST /api/v1/orders').toBeTruthy();
    });

    const post = fetchStub.calls.find(
      (c) => c.url.includes('/api/v1/orders') && c.init?.method === 'POST'
    )!;
    const body = JSON.parse(String(post.init!.body));
    // The frozen wire contract (oms#39): money = exact decimal strings
    expect(body.price).toBe('100000.00000000');
    expect(body.quantity).toBe('0.50000000');
    expect(body.side).toBe('BUY');
    expect(body.orderType).toBe('LIMIT');
    expect(body.marketId).toBe(1);
    // Identity comes from the auth token, never the body (oms#36)
    expect(body.userId).toBeUndefined();
    // Auth header present on the call
    const headers = post.init!.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);

    // Success notification renders (response accepted:true)
    expect(container.textContent).toContain('Buy order submitted');
  });
});
