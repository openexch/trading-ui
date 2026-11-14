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

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
/** What POST /api/v1/orders answers; tests swap it for a reject. */
let postReply: unknown = { accepted: true, omsOrderId: '331911111111111111', status: 'PENDING_NEW' };

function stubFetch() {
  calls = [];
  postReply = { accepted: true, omsOrderId: '331911111111111111', status: 'PENDING_NEW' };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/v1/orders') && init?.method === 'POST') body = postReply;
    else if (url.includes('/api/v1/auth/me')) body = { userId: 1, username: 'dev' };
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
    // Order entry is the ladder: defaults bar and staging strip, no form.
    expect(screen.getByRole('form', { name: /order defaults/i })).toBeTruthy();
    expect(screen.getByRole('status', { name: /staged order/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buy btc/i })).toBeNull();
    // Existing panels sit in the side columns for now.
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

  // ---- staging and placing ------------------------------------------------

  function pushBook() {
    const ws = MockWebSocket.instances.find(w => w.url.endsWith('/ws'))!;
    const bids = Array.from({ length: 20 }, (_, i) => ({ price: 97_400 - i * 5, quantity: 1, orderCount: 1 }));
    const asks = Array.from({ length: 20 }, (_, i) => ({ price: 97_405 + i * 5, quantity: 1, orderCount: 1 }));
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({
        data: JSON.stringify({ type: 'BOOK_SNAPSHOT', marketId: 1, market: 'BTC-USD', bids, asks, timestamp: 1 }),
      });
    });
  }

  const posts = () => calls.filter(c => c.url.includes('/api/v1/orders') && c.init?.method === 'POST');

  async function ladderWithBook() {
    window.history.replaceState({}, '', '/?ui=ladder');
    const utils = renderApp();
    await screen.findByRole('grid', { name: /price ladder/i });
    // The session is validated before the strip treats the user as signed in.
    await screen.findByRole('button', { name: /^dev$/i });
    pushBook();
    // BTC opens at its default preset (0.25) and x5 grouping.
    await screen.findByRole('gridcell', { name: /^buy 0.25 btc at 97,400, 1.0000 on book$/i });
    return utils;
  }

  it('click a bid rung, Enter: POSTs the order with the frozen wire contract', async () => {
    await ladderWithBook();
    const cell = screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i });
    fireEvent.click(cell);
    const strip = screen.getByRole('status', { name: /staged order/i });
    expect(strip.textContent).toContain('Buy 0.25 BTC @ 97,400');
    expect(strip.textContent).toContain('Limit · GTC · 24,350.00 USD');
    expect(posts()).toHaveLength(0); // a click only stages

    fireEvent.keyDown(cell, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const post = posts()[0];
    const body = JSON.parse(String(post.init!.body));
    // Same contract as the order form (oms#39 / oms#36).
    expect(body.price).toBe('97400.00000000');
    expect(body.quantity).toBe('0.25000000');
    expect(body.side).toBe('BUY');
    expect(body.orderType).toBe('LIMIT');
    expect(body.timeInForce).toBe('GTC');
    expect(body.marketId).toBe(1);
    expect(body.userId).toBeUndefined();
    const headers = post.init!.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);

    // Accepted: polite, in the strip; the stage is cleared.
    await waitFor(() => expect(strip.textContent).toContain('Accepted: Buy 0.25 BTC @ 97,400'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /place/i })).toBeNull();
  });

  it('an ask rung stages a sell; Esc clears without sending', async () => {
    await ladderWithBook();
    const cell = screen.getByRole('gridcell', { name: /^sell 0.25 btc at 97,410/i });
    fireEvent.click(cell);
    expect(screen.getByRole('status', { name: /staged order/i }).textContent).toContain('Sell 0.25 BTC @ 97,410');
    fireEvent.keyDown(cell, { key: 'Escape' });
    expect(screen.getByRole('status', { name: /staged order/i }).textContent).not.toContain('Sell 0.25');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await act(async () => {});
    expect(posts()).toHaveLength(0);
  });

  it('a market order needs two Enters', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('button', { name: /^buy market$/i }));
    const strip = screen.getByRole('status', { name: /staged order/i });
    expect(strip.textContent).toContain('Buy 0.25 BTC at market');

    fireEvent.keyDown(document.body, { key: 'Enter' });
    await act(async () => {});
    expect(posts()).toHaveLength(0);
    expect(strip.textContent).toContain('press Enter again');
    expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.orderType).toBe('MARKET');
    expect(body.side).toBe('BUY');
    expect(body.quantity).toBe('0.25000000');
    expect(body.userId).toBeUndefined();
  });

  it('a market order needs a second click on Place too', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('button', { name: /^sell market$/i }));
    fireEvent.click(screen.getByRole('button', { name: /place/i }));
    await act(async () => {});
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0].init!.body)).side).toBe('SELL');
  });

  it('warns when a staged limit crosses the spread', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,410/i }));
    expect(screen.getByRole('status', { name: /staged order/i }).textContent).toContain(
      'Crosses the spread: executes now',
    );
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,395/i }));
    expect(screen.getByRole('status', { name: /staged order/i }).textContent).not.toContain('Crosses');
  });

  it('a rejected order shows an alert in the strip and stays staged', async () => {
    await ladderWithBook();
    postReply = { accepted: false, rejectReason: 'INSUFFICIENT_BALANCE' };
    const cell = screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i });
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^Rejected: /);
    expect(screen.getByRole('status', { name: /staged order/i }).contains(alert)).toBe(true);
    expect(screen.getByRole('button', { name: /place/i })).toBeTruthy();
  });

  it('an async engine reject surfaces as an alert with the code as its title', async () => {
    await ladderWithBook();
    const oms = MockWebSocket.instances.find(w => w.url.endsWith('/ws/v1'))!;
    act(() => {
      oms.onopen?.();
      oms.onmessage?.({
        data: JSON.stringify({
          omsOrderId: '42',
          clusterOrderId: '0',
          userId: 1,
          marketId: 1,
          side: 'BUY',
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: '97400',
          quantity: '0.25',
          filledQty: '0',
          remainingQty: '0.25',
          stopPrice: null,
          status: 'REJECTED',
          rejectReason: 'PRICE_OUT_OF_RANGE',
          createdAtMs: 1,
          updatedAtMs: 1,
        }),
      });
    });
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('title')).toBe('PRICE_OUT_OF_RANGE');
    expect(alert.textContent).toContain('Order rejected');
  });

  it('signed out: staging works and Place opens sign-in', async () => {
    localStorage.removeItem('oe.session');
    window.history.replaceState({}, '', '/?ui=ladder');
    renderApp();
    await screen.findByRole('grid', { name: /price ladder/i });
    pushBook();
    const cell = await screen.findByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i });
    fireEvent.click(cell);
    fireEvent.click(screen.getByRole('button', { name: /sign in to place/i }));
    expect(await screen.findByRole('button', { name: /^register$/i })).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it('the Type · TIF picker offers no GTD and changes what is staged', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('button', { name: /order type and time in force: limit, good till cancelled/i }));
    const menu = screen.getByRole('menu', { name: /order type and time in force/i });
    expect(menu.textContent).not.toContain('GTD');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /post only/i }));
    fireEvent.click(screen.getByRole('button', { name: /order type and time in force: post only/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^ioc/i }));
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,395/i }));
    const strip = screen.getByRole('status', { name: /staged order/i });
    expect(strip.textContent).toContain('Post only · IOC');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.orderType).toBe('LIMIT_MAKER');
    expect(body.timeInForce).toBe('IOC');
  });

  it('presets and the size field set the staged size', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('button', { name: /^size 1.00 btc$/i }));
    expect(screen.getByRole('button', { name: /^size 1.00 btc$/i }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('spinbutton', { name: /order size in btc/i }), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.5 btc at 97,400/i }));
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0].init!.body)).quantity).toBe('0.50000000');
  });

  it('keeps the default screen without the flag', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: /open orders/i })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /price ladder/i })).toBeNull();
  });
});
