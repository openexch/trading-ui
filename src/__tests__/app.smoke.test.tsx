// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * App smoke test (trading-ui#20): render the real <App/> with the network
 * mocked (WS never connects, fetch returns the v2 gateway's shapes),
 * assert it mounts, and drive the order form through a submit, pinning
 * that the request goes out with money as exact decimal strings, an
 * Idempotency-Key, and no userId in the body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// lightweight-charts needs a real canvas; the chart is not what a smoke
// test exercises. Mocking the module also keeps jsdom from loading it.
vi.mock('../components/Chart/Chart', () => ({
  Chart: () => <div data-testid="chart-mock" />,
}));

import App from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { BalancesProvider } from '../hooks/useBalances';
import { asResponse, gatewayReply } from '../test/wire';

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

/** fetch mock answering every route as the v2 gateway would (empty lists). */
function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return asResponse(gatewayReply(url, init?.method));
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
    // bearer-subprotocol path are both exercised.
    localStorage.clear();
    localStorage.setItem('oe.session', JSON.stringify({ token: 'smoketoken1', userId: 1, username: 'dev' }));
  });

  it('mounts the trading page and opens market-data + user stream sockets', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <BalancesProvider>
            <App />
          </BalancesProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    // Order form is always up in the right rail for the default market (BTC-USD)
    expect(await screen.findByRole('button', { name: /buy btc/i })).toBeTruthy();
    // Bottom strip is reduced to Open Orders | History (Order/Trades/Account
    // tabs are gone — the form lives in the rail, account in the drawer)
    expect(screen.getByRole('button', { name: /open orders/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^history$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^order$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^account$/i })).toBeNull();
    // Markets came from the gateway
    expect(fetchStub.calls.some((c) => c.url.endsWith('/api/v2/markets'))).toBe(true);
    // Market-data WS was opened, plus the user stream
    const urls = MockWebSocket.instances.map((ws) => ws.url);
    expect(urls.some((u) => u.endsWith('/ws'))).toBe(true);
    const oms = MockWebSocket.instances.find((ws) => ws.url.endsWith('/ws/v2'));
    expect(oms, 'expected a /ws/v2 user stream socket').toBeTruthy();
    // Auth rides the subprotocol: ['bearer', <token>]
    expect(oms!.protocols).toEqual(['bearer', 'smoketoken1']);
  });

  it('opens the account drawer from the header username pill', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <BalancesProvider>
            <App />
          </BalancesProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^dev$/i }));
    // Drawer content: balances + transfer + sign out
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /deposit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeTruthy();
  });

  it('submits a limit order to the gateway with exact money strings, a key and no userId', async () => {
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <BalancesProvider>
            <App />
          </BalancesProvider>
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
        (c) => c.url.endsWith('/api/v2/orders') && c.init?.method === 'POST'
      );
      expect(post, 'expected a POST /api/v2/orders').toBeTruthy();
    });

    const post = fetchStub.calls.find(
      (c) => c.url.endsWith('/api/v2/orders') && c.init?.method === 'POST'
    )!;
    const body = JSON.parse(String(post.init!.body));
    // v2 wire contract: money = exact decimal strings, ids = strings
    expect(body.price).toBe('100000.00000000');
    expect(body.quantity).toBe('0.50000000');
    expect(body.side).toBe('BUY');
    expect(body.type).toBe('LIMIT');
    expect(body.timeInForce).toBe('GTC');
    expect(body.marketId).toBe('1');
    // Identity comes from the credential, never the body
    expect(body.userId).toBeUndefined();
    const headers = post.init!.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);

    // Success notification renders (201 from the gateway)
    expect(container.textContent).toContain('Buy order submitted');
  });
});
