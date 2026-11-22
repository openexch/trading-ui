// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * App smoke test: render the real <App/> with the network mocked (WS
 * never connects, fetch returns the v2 gateway's shapes), assert the ladder
 * shell mounts with both sockets, and place an order through the Price
 * field, pinning that the request goes out with money as exact decimal
 * strings, an Idempotency-Key, and no userId in the body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
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

    // The ladder is the trading screen: header symbol, the price ladder,
    // the defaults bar and the staging strip; no order form, no old book.
    expect(await screen.findByRole('button', { name: /market btc-usd\. change market/i })).toBeTruthy();
    expect(screen.getByRole('grid', { name: /price ladder/i })).toBeTruthy();
    expect(screen.getByRole('form', { name: /order defaults/i })).toBeTruthy();
    expect(screen.getByRole('status', { name: /staged order/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buy btc/i })).toBeNull();
    // The ledger line is in the header, all dashes before an engine frame.
    const line = document.querySelector('[data-engine-line-root]')!;
    expect(line).toBeTruthy();
    expect(line.querySelector('[data-engine-line="core"] [data-engine-position]')!.textContent).toBe('–');
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

    await screen.findByRole('grid', { name: /price ladder/i });
    // The session is validated before the strip treats the user as signed in.
    await screen.findByRole('button', { name: /^dev$/i });
    // A price that is on the tick, typed into the defaults bar's Price
    // field; size 0.5; Buy limit stages it, Enter (the Place button) sends it.
    const bar = screen.getByRole('form', { name: /order defaults/i });
    fireEvent.change(within(bar).getByRole('textbox', { name: /^price in/i }), { target: { value: '100000' } });
    fireEvent.change(within(bar).getByLabelText(/^order size in/i), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: /^buy limit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^place/i }));

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

    // The strip reports the accepted order (201 from the gateway).
    await waitFor(() => expect(container.querySelector('[data-result="accepted"]')).toBeTruthy());
  });
});
