// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Ladder shell smoke test: the real <App/> under ?ui=ladder with the network
 * mocked. The flag picks the new shell; without it the default screen is
 * unchanged. A market-data snapshot pushed through the mocked socket reaches
 * the ladder as rungs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** Every observed element reports 264px: ten 22px rungs and the spread row
 *  (five levels each side of it). */
class FixedResizeObserver {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.cb([{ contentRect: { height: 264 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
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

/** DELETE answers by omsOrderId (default: accepted), and optional gates a
 *  test resolves to hold a DELETE in flight. */
let deleteReplies: Record<string, unknown> = {};
let deleteGates: Record<string, Promise<void>> = {};
let putReply: unknown = { accepted: true };

function stubFetch() {
  calls = [];
  deleteReplies = {};
  deleteGates = {};
  putReply = { accepted: true };
  postReply = { accepted: true, omsOrderId: '331911111111111111', status: 'PENDING_NEW' };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/v1/orders/') && init?.method === 'DELETE') {
      const id = url.split('/').pop()!;
      const gate = deleteGates[id];
      if (gate) await gate;
      body = deleteReplies[id] ?? { accepted: true, message: 'Order cancelled' };
    } else if (url.includes('/api/v1/orders/') && init?.method === 'PUT') body = putReply;
    else if (url.includes('/api/v1/orders') && init?.method === 'POST') body = postReply;
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

  it('renders the ladder shell: header, ladder, the slot panels at the sides', async () => {
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
    // The side columns hold the Default layout: Markets / Trades | Chart / Orders.
    expect(screen.getByRole('button', { name: 'Panel: Markets. Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Panel: Trades. Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Panel: Chart. Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Panel: Open orders. Change' })).toBeTruthy();
    expect(screen.getAllByRole('separator', { name: /resize (left|right) panels/i })).toHaveLength(2);
    expect(screen.getByTestId('chart-mock')).toBeTruthy();
    // No footer and no old ticker rail in the new shell.
    expect(screen.queryByText('Open Exchange Trading Engine')).toBeNull();

    // The market selector opens from the header symbol and switches markets.
    fireEvent.click(screen.getByRole('button', { name: /market btc-usd/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^ethereum/i }));
    expect(await screen.findByRole('button', { name: /market eth-usd\. change market/i })).toBeTruthy();
  });

  it('draws rungs from a book snapshot pushed through the market socket', async () => {
    window.history.replaceState({}, '', '/?ui=ladder');
    const { container } = renderApp();
    await screen.findByRole('grid', { name: /price ladder/i });
    // Skeleton rungs until the first snapshot.
    expect(container.querySelectorAll('[data-skeleton-rung]').length).toBe(10);

    const ws = MockWebSocket.instances.find(w => w.url.endsWith('/ws'))!;
    const bids = Array.from({ length: 20 }, (_, i) => ({ price: 97_400 - i * 5, quantity: 1, orderCount: 1 }));
    const asks = Array.from({ length: 20 }, (_, i) => ({ price: 97_405 + i * 5, quantity: 1, orderCount: 1 }));
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({
        data: JSON.stringify({ type: 'BOOK_SNAPSHOT', marketId: 1, market: 'BTC-USD', bids, asks, timestamp: 1 }),
      });
    });
    await waitFor(() => expect(container.querySelectorAll('[data-rung-price]').length).toBe(10));
    expect(container.querySelectorAll('[data-skeleton-rung]').length).toBe(0);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('Markets panel: dashes until TICKERS arrives, then every market priced; a switch keeps the values', async () => {
    window.history.replaceState({}, '', '/?ui=ladder');
    const { container } = renderApp();
    await screen.findByRole('grid', { name: /price ladder/i });
    const row = (sym: string) => container.querySelector(`[data-market-row="${sym}"]`)!;
    const ws = MockWebSocket.instances.find(w => w.url.endsWith('/ws'))!;
    const entry = (marketId: number, market: string, lastPrice: number, timestamp: number) => ({
      marketId, market, lastPrice, priceChange: 1, priceChangePercent: 0.25,
      high24h: lastPrice, low24h: lastPrice, volume24h: 1, timestamp,
    });
    const send = (msg: unknown) => act(() => ws.onmessage?.({ data: JSON.stringify(msg) }));

    act(() => ws.onopen?.());
    send({ type: 'TICKER_STATS', ...entry(1, 'BTC-USD', 97_412, 5) });
    await waitFor(() => expect(row('BTC-USD').textContent).toContain('97,412'));
    // Today's backend: no TICKERS, so the other markets stay dashes.
    expect(row('ETH-USD').textContent!.match(/–/g)).toHaveLength(2);

    send({
      type: 'TICKERS',
      tickers: [entry(1, 'BTC-USD', 90_000, 4), entry(2, 'ETH-USD', 3412.5, 4)],
      timestamp: 4,
    });
    await waitFor(() => expect(row('ETH-USD').textContent).toContain('3,412.5'));
    // The selected market keeps its fresher live ticker.
    expect(row('BTC-USD').textContent).toContain('97,412');
    expect(row('SOL-USD').textContent!.match(/–/g)).toHaveLength(2);

    // Switch to ETH: BTC keeps a value (its live tick refreshed the map), ETH
    // shows its TICKERS entry until its own ticker lands. No dash flicker.
    fireEvent.click(row('ETH-USD'));
    await screen.findByRole('button', { name: /market eth-usd\. change market/i });
    expect(row('BTC-USD').textContent).toContain('97,412');
    expect(row('ETH-USD').textContent).toContain('3,412.5');
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
    // BTC opens at its default preset (0.25) and x1 grouping (engine levels only).
    await screen.findByRole('gridcell', { name: /^buy 0.25 btc at 97,400, 1.0000 on book, 1.0000 cumulative$/i });
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

  // ---- the Price field and Buy / Sell limit ----------------------------------

  const priceInput = () => screen.getByRole('textbox', { name: /^price in usd$/i }) as HTMLInputElement;
  const limitBtn = (side: 'buy' | 'sell') =>
    screen.getByRole('button', { name: new RegExp(`^${side} limit$`, 'i') }) as HTMLButtonElement;

  it('a rung click writes its price into the Price field; Buy limit stages a limit there and Enter places it', async () => {
    await ladderWithBook();
    expect(priceInput().value).toBe('');
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i }));
    expect(priceInput().value).toBe('97400');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    // An ask click writes it too.
    fireEvent.click(screen.getByRole('gridcell', { name: /^sell 0.25 btc at 97,410/i }));
    expect(priceInput().value).toBe('97410');
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.change(priceInput(), { target: { value: '97390' } });
    fireEvent.click(limitBtn('buy'));
    const strip = screen.getByRole('status', { name: /staged order/i });
    expect(strip.textContent).toContain('Buy 0.25 BTC @ 97,390');
    expect(strip.textContent).toContain('Limit · GTC');
    expect(posts()).toHaveLength(0); // staged, not sent
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.orderType).toBe('LIMIT');
    expect(body.side).toBe('BUY');
    expect(body.price).toBe('97390.00000000');
    expect(body.quantity).toBe('0.25000000');
    expect(body.timeInForce).toBe('GTC');
  });

  it('Buy / Sell limit are disabled until the Price field holds a price on the tick and in range', async () => {
    await ladderWithBook();
    const strip = screen.getByRole('status', { name: /staged order/i });
    // Empty: disabled, and nothing to complain about in the strip.
    expect(limitBtn('buy').disabled).toBe(true);
    expect(limitBtn('sell').disabled).toBe(true);
    expect(strip.querySelector('[data-result]')).toBeNull();

    fireEvent.change(priceInput(), { target: { value: '97400.5' } });
    expect(limitBtn('buy').disabled).toBe(true);
    expect(priceInput().getAttribute('aria-invalid')).toBe('true');
    expect(strip.querySelector('[data-result="info"]')!.textContent).toBe('Price must be on the 1 tick');

    fireEvent.change(priceInput(), { target: { value: '49999' } });
    expect(limitBtn('sell').disabled).toBe(true);
    expect(strip.querySelector('[data-result="info"]')!.textContent).toBe('Price must be between 50,000 and 150,000');

    fireEvent.change(priceInput(), { target: { value: 'abc' } });
    expect(limitBtn('buy').disabled).toBe(true);
    expect(strip.querySelector('[data-result="info"]')!.textContent).toBe('Price must be a number');

    fireEvent.change(priceInput(), { target: { value: '97415' } });
    expect(limitBtn('buy').disabled).toBe(false);
    expect(limitBtn('sell').disabled).toBe(false);
    expect(priceInput().getAttribute('aria-invalid')).toBeNull();
    expect(strip.querySelector('[data-result]')).toBeNull();
    fireEvent.click(limitBtn('sell'));
    expect(strip.textContent).toContain('Sell 0.25 BTC @ 97,415');
    expect(posts()).toHaveLength(0);
  });

  it('Up and Down in the Price field step one tick', async () => {
    await ladderWithBook();
    fireEvent.change(priceInput(), { target: { value: '97400' } });
    fireEvent.keyDown(priceInput(), { key: 'ArrowUp' });
    expect(priceInput().value).toBe('97401');
    fireEvent.keyDown(priceInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(priceInput(), { key: 'ArrowDown' });
    expect(priceInput().value).toBe('97399');
    // The ladder does not move focus or stage from the field.
    expect(screen.getByRole('status', { name: /staged order/i }).textContent).not.toContain('Staged');
  });

  it('one-click armed: Sell limit at a price that does not cross places at once', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('switch', { name: /one-click/i }));
    fireEvent.change(priceInput(), { target: { value: '97420' } });
    fireEvent.click(limitBtn('sell'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect([body.side, body.orderType, body.price]).toEqual(['SELL', 'LIMIT', '97420.00000000']);
    // A crossing one still stages first.
    fireEvent.change(priceInput(), { target: { value: '97400' } });
    fireEvent.click(limitBtn('sell'));
    await act(async () => {});
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole('status', { name: /staged order/i }).textContent).toContain('Crosses the spread');
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

  // ---- rung menu, order popovers, own-order actions, one-click ------------

  const strip = () => screen.getByRole('status', { name: /staged order/i });
  const deletes = () => calls.filter(c => c.url.includes('/api/v1/orders/') && c.init?.method === 'DELETE');
  const puts = () => calls.filter(c => c.url.includes('/api/v1/orders/') && c.init?.method === 'PUT');

  /** Push an own order through the OMS socket (the user-scoped feed). */
  function pushOwn(o: {
    id: string;
    side?: 'BUY' | 'SELL';
    type?: string;
    price: number;
    qty?: number;
    status?: string;
    marketId?: number;
  }) {
    const oms = MockWebSocket.instances.find(w => w.url.endsWith('/ws/v1'))!;
    const q = (o.qty ?? 0.5).toFixed(8);
    act(() => {
      oms.onopen?.();
      oms.onmessage?.({
        data: JSON.stringify({
          omsOrderId: o.id,
          clusterOrderId: '7',
          userId: 1,
          marketId: o.marketId ?? 1,
          side: o.side ?? 'BUY',
          orderType: o.type ?? 'LIMIT',
          timeInForce: 'GTC',
          price: o.price.toFixed(8),
          quantity: q,
          filledQty: '0',
          remainingQty: q,
          stopPrice: null,
          status: o.status ?? 'NEW',
          rejectReason: null,
          createdAtMs: Number(o.id),
          updatedAtMs: Number(o.id),
        }),
      });
    });
  }

  function openRungMenu(name: RegExp) {
    fireEvent.contextMenu(screen.getByRole('gridcell', { name }), { clientX: 200, clientY: 200 });
    return screen.getByRole('menu', { name: /^orders at/i });
  }

  const itemNames = (menu: HTMLElement) =>
    Array.from(menu.querySelectorAll('[role="menuitem"]')).map(i => i.firstElementChild!.textContent);

  it('rung menu: the sides flip with the rung against the last price', async () => {
    await ladderWithBook();
    // Below the touch's middle: buy limit, sell stops, buy iceberg.
    let menu = openRungMenu(/^buy 0.25 btc at 97,390/i);
    expect(menu.getAttribute('aria-label')).toBe('Orders at 97,390');
    expect(menu.textContent).toContain('At 97,390 · 0.25 BTC');
    expect(itemNames(menu)).toEqual([
      'Buy limit', 'Sell stop loss', 'Sell stop limit…', 'Sell trailing stop…', 'Buy iceberg…',
    ]);
    expect(screen.getByRole('menuitem', { name: /buy limit/i }).textContent).toContain('click');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    // Above it: everything flips.
    menu = openRungMenu(/^sell 0.25 btc at 97,415/i);
    expect(itemNames(menu)).toEqual([
      'Sell limit', 'Buy stop loss', 'Buy stop limit…', 'Buy trailing stop…', 'Sell iceberg…',
    ]);
    // A plain item stages at once; nothing is sent.
    fireEvent.click(screen.getByRole('menuitem', { name: /buy stop loss/i }));
    expect(strip().textContent).toContain('Buy 0.25 BTC, stop 97,415');
    expect(strip().textContent).toContain('Stop loss · GTC');
    expect(posts()).toHaveLength(0);
  });

  it('stop-limit popover: stop prefilled from the rung, both prices snapped, Stage then Enter', async () => {
    await ladderWithBook();
    openRungMenu(/^buy 0.25 btc at 97,390/i);
    fireEvent.click(screen.getByRole('menuitem', { name: /sell stop limit/i }));
    const pop = screen.getByRole('dialog', { name: /sell stop limit/i });
    const stop = screen.getByLabelText(/stop price \(triggers at or below\)/i) as HTMLInputElement;
    expect(stop.value).toBe('97390');
    expect(document.activeElement).toBe(stop);
    // No GTD: the API has no expiry field.
    expect(pop.querySelector('select')!.textContent).not.toContain('GTD');

    fireEvent.change(stop, { target: { value: '97389.6' } });
    fireEvent.change(screen.getByLabelText(/^limit price/i), { target: { value: '97384.4' } });
    fireEvent.click(screen.getByRole('button', { name: /stage sell stop/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(strip().textContent).toContain('Sell 0.25 BTC, stop 97,390, limit 97,384');
    expect(strip().textContent).toContain('Stop limit · GTC');
    // The strip has no second-value field of its own any more.
    expect(strip().querySelector('input')).toBeNull();
    expect(posts()).toHaveLength(0);

    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.orderType).toBe('STOP_LIMIT');
    expect(body.side).toBe('SELL');
    expect(body.stopPrice).toBe('97390.00000000');
    expect(body.price).toBe('97384.00000000');
    expect(body.quantity).toBe('0.25000000');
    expect(body.userId).toBeUndefined();
  });

  it('stop-limit popover: an out-of-range stop is an inline error and nothing is staged', async () => {
    await ladderWithBook();
    openRungMenu(/^buy 0.25 btc at 97,390/i);
    fireEvent.click(screen.getByRole('menuitem', { name: /sell stop limit/i }));
    fireEvent.change(screen.getByLabelText(/stop price/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /stage sell stop/i }));
    expect(screen.getByRole('dialog').textContent).toMatch(/price must be within/i);
    expect(strip().textContent).not.toContain('Staged');
  });

  it('defaults on Iceberg: a rung click opens the iceberg popover, Stage then Enter', async () => {
    await ladderWithBook();
    fireEvent.click(screen.getByRole('button', { name: /order type and time in force/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /iceberg/i }));
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,395/i }));
    screen.getByRole('dialog', { name: /buy iceberg/i });
    fireEvent.change(screen.getByLabelText(/^show btc/i), { target: { value: '0.05' } });
    fireEvent.click(screen.getByRole('button', { name: /stage buy iceberg/i }));
    expect(strip().textContent).toContain('Buy 0.25 BTC @ 97,395, show 0.05');
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.orderType).toBe('ICEBERG');
    expect(body.price).toBe('97395.00000000');
    expect(body.displayQuantity).toBe('0.05000000');
  });

  it('Move sends a PUT with the new price only, snapped', async () => {
    await ladderWithBook();
    pushOwn({ id: '9001', price: 97_390 });
    fireEvent.click(await screen.findByRole('button', { name: /your buy order at 97,390.*cancel or move/i }));
    screen.getByRole('menu', { name: /your orders at 97,390/i });
    fireEvent.click(screen.getByRole('menuitem', { name: /move \(re-queues\)/i }));
    const input = screen.getByLabelText(/new price/i) as HTMLInputElement;
    expect(input.value).toBe('97390');
    fireEvent.change(input, { target: { value: '97395.4' } });
    fireEvent.click(screen.getByRole('button', { name: /^move$/i }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].url).toMatch(/\/api\/v1\/orders\/9001$/);
    const body = JSON.parse(String(puts()[0].init!.body));
    expect(body).toEqual({ price: '97395.00000000' });
    await waitFor(() => expect(strip().textContent).toContain('Moved to 97,395 (re-queued)'));
    expect(posts()).toHaveLength(0);
  });

  it('Move is absent for stop-limit and iceberg orders: Cancel only', async () => {
    await ladderWithBook();
    pushOwn({ id: '9101', type: 'STOP_LIMIT', price: 97_385 });
    pushOwn({ id: '9102', type: 'ICEBERG', price: 97_380 });
    for (const price of ['97,385', '97,380']) {
      const chip = await screen.findByRole('button', { name: new RegExp(`your buy order at ${price}.*\\. cancel$`, 'i') });
      fireEvent.click(chip);
      const menu = screen.getByRole('menu', { name: new RegExp(`your orders at ${price}`, 'i') });
      expect(itemNames(menu)).toEqual(['Cancel']);
      fireEvent.keyDown(menu, { key: 'Escape' });
    }
  });

  it('cancel from the chip: pending is per order, never a shared flag', async () => {
    await ladderWithBook();
    pushOwn({ id: '9201', price: 97_390 });
    pushOwn({ id: '9202', price: 97_390, qty: 0.3 });
    let release!: () => void;
    deleteGates['9201'] = new Promise<void>(r => {
      release = r;
    });
    fireEvent.click(await screen.findByRole('button', { name: /your buy orders \(2\) at 97,390/i }));
    const menu = screen.getByRole('menu', { name: /your orders at 97,390/i });
    const cancels = () => Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(i => i.textContent!.startsWith('Cancel'));
    // Oldest first: 9201 then 9202.
    fireEvent.click(cancels()[0]);
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(cancels()[0].getAttribute('aria-disabled')).toBe('true');
    expect(cancels()[0].textContent).toContain('Cancelling…');
    expect(cancels()[1].getAttribute('aria-disabled')).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(strip().textContent).toContain('Cancelled: Buy 0.5 BTC @ 97,390'));
  });

  it('Cancel all asks first, then reports one failed DELETE and leaves that order', async () => {
    await ladderWithBook();
    pushOwn({ id: '9301', price: 97_390 });
    pushOwn({ id: '9302', price: 97_380 });
    deleteReplies['9302'] = { accepted: false, message: 'ORDER_NOT_FOUND' };
    fireEvent.click(await screen.findByRole('button', { name: /^cancel all · 2$/i }));
    expect(strip().textContent).toContain('Cancel all 2 open BTC-USD orders?');
    expect(deletes()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^cancel 2$/i }));
    const alert = await screen.findByRole('alert');
    expect(deletes()).toHaveLength(2);
    expect(alert.textContent).toContain('1 cancelled, 1 failed');
    expect(alert.textContent).toContain('ORDER_NOT_FOUND');
    expect(alert.getAttribute('title')).toContain('97,380');
    expect(screen.queryByRole('button', { name: /your buy order at 97,390/i })).toBeNull();
    expect(screen.getByRole('button', { name: /your buy order at 97,380/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^cancel all · 1$/i })).toBeTruthy();
  });

  it('Cancel all: Keep (or Esc) backs out without sending', async () => {
    await ladderWithBook();
    pushOwn({ id: '9401', price: 97_390 });
    fireEvent.click(await screen.findByRole('button', { name: /^cancel all · 1$/i }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(strip().textContent).not.toContain('Cancel all 1 open');
    fireEvent.click(screen.getByRole('button', { name: /^cancel all · 1$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^keep$/i }));
    await act(async () => {});
    expect(deletes()).toHaveLength(0);
  });

  // ---- side panels: Orders panel actions, layout -------------------------

  const ordersPanel = () => screen.getByRole('region', { name: 'Orders and fills' });

  it('Orders panel: ⋯ Cancel all still asks in the strip, Enter on the focused confirm cancels', async () => {
    await ladderWithBook();
    pushOwn({ id: '9501', price: 97_390 });
    pushOwn({ id: '9502', price: 97_380 });
    await waitFor(() => expect(ordersPanel().querySelectorAll('[data-order-row]')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'More order actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /cancel all on btc-usd/i }));
    // Asked, not sent; focus is on the strip's confirm button.
    expect(strip().textContent).toContain('Cancel all 2 open BTC-USD orders?');
    expect(deletes()).toHaveLength(0);
    const confirm = screen.getByRole('button', { name: /^cancel 2$/i });
    expect(document.activeElement).toBe(confirm);
    // Esc keeps.
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(strip().textContent).not.toContain('Cancel all 2 open');
    await act(async () => {});
    expect(deletes()).toHaveLength(0);
    // Ask again and confirm.
    fireEvent.click(screen.getByRole('button', { name: 'More order actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /cancel all on btc-usd/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel 2$/i }));
    await waitFor(() => expect(deletes()).toHaveLength(2));
    await waitFor(() => expect(strip().textContent).toContain('Cancelled 2 orders'));
    await waitFor(() => expect(ordersPanel().querySelectorAll('[data-order-row]')).toHaveLength(0));
  });

  it('Orders panel: × cancels one through the ladder (pending, strip result); stops are listed without a price', async () => {
    await ladderWithBook();
    pushOwn({ id: '9601', price: 97_390 });
    pushOwn({ id: '9602', side: 'SELL', type: 'STOP_LOSS', price: 0, status: 'PENDING_TRIGGER' });
    const stopRow = await waitFor(() => {
      const r = ordersPanel().querySelector('[data-order-row="9602"]');
      expect(r).toBeTruthy();
      return r!;
    });
    expect(stopRow.textContent).toContain('Stop, awaiting trigger');
    // Not a resting order: never on the ladder.
    expect(screen.queryByRole('button', { name: /your sell order/i })).toBeNull();

    let release!: () => void;
    deleteGates['9601'] = new Promise<void>(r => (release = r));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Buy 0.50 at 97,390' }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect((screen.getByRole('button', { name: 'Cancelling Buy 0.50 at 97,390' }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(strip().textContent).toContain('Cancelled: Buy 0.5 BTC @ 97,390'));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sell 0.50 stop loss, awaiting trigger' }));
    await waitFor(() => expect(deletes()).toHaveLength(2));
    expect(deletes()[1].url).toMatch(/\/api\/v1\/orders\/9602$/);
    await waitFor(() => expect(strip().textContent).toContain('Cancelled: Sell 0.5 BTC stop, awaiting trigger'));
  });

  it('a picked layout is remembered across a reload; Reset returns to Default', async () => {
    window.history.replaceState({}, '', '/?ui=ladder');
    const first = renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Panel: Trades. Change' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^balances/i }));
    expect(screen.getByRole('button', { name: 'Panel: Balances. Change' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Panel: Trades. Change' })).toBeNull();
    first.unmount();

    renderApp();
    expect(await screen.findByRole('button', { name: 'Panel: Balances. Change' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Panel: Balances. Change' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset layout' }));
    expect(screen.getByRole('button', { name: 'Panel: Trades. Change' })).toBeTruthy();
  });

  const oneClick = () => screen.getByRole('switch', { name: /one-click/i });

  it('one-click: off by default; armed, a click places at once and a crossing click still stages', async () => {
    await ladderWithBook();
    expect(oneClick().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(oneClick());
    expect(oneClick().getAttribute('aria-checked')).toBe('true');
    expect(strip().getAttribute('data-armed')).toBe('true');
    expect(strip().textContent).toContain('One-click on');

    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,395/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.price).toBe('97395.00000000');
    expect(body.side).toBe('BUY');
    await waitFor(() => expect(strip().textContent).toContain('Accepted: Buy 0.25 BTC @ 97,395'));

    // Crossing the spread: staged with the warning, not sent.
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,410/i }));
    await act(async () => {});
    expect(posts()).toHaveLength(1);
    expect(strip().textContent).toContain('Crosses the spread: executes now');
  });

  it('the ladder pins only for one-click, a staged order or an open menu; each end re-centres', async () => {
    const { container } = await ladderWithBook();
    const region = container.querySelector<HTMLElement>('[data-ladder-region]')!;
    /** The row right below the spread marker (the best bid), null when the
     *  marker is not in view. */
    const middle = () => {
      const next = container.querySelector('[data-spread-row]')?.nextElementSibling as HTMLElement | null | undefined;
      return next?.dataset.rungPrice ? Number(next.dataset.rungPrice) : null;
    };
    const top = () => Number(container.querySelector<HTMLElement>('[data-rung-price]')!.dataset.rungPrice);
    let ts = 10;
    /** The same book moved: best bid at `bid`, best ask 5 above. The spread
     *  marker is the centre, the best bid right below it. */
    const bookAt = (bid: number) => {
      const ws = MockWebSocket.instances.find(w => w.url.endsWith('/ws'))!;
      const bids = Array.from({ length: 20 }, (_, i) => ({ price: bid - i * 5, quantity: 1, orderCount: 1 }));
      const asks = Array.from({ length: 20 }, (_, i) => ({ price: bid + 5 + i * 5, quantity: 1, orderCount: 1 }));
      act(() => {
        ws.onmessage?.({
          data: JSON.stringify({ type: 'BOOK_SNAPSHOT', marketId: 1, market: 'BTC-USD', bids, asks, timestamp: ts++ }),
        });
      });
    };
    expect(middle()).toBe(97_400);
    // Pointer over the ladder: still follows.
    fireEvent.pointerEnter(region);
    bookAt(97_420);
    await waitFor(() => expect(middle()).toBe(97_420));
    const recentreShown = () => screen.findByRole('button', { name: /re-centre/i });

    // A staged order pins; clearing it re-centres.
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,415/i }));
    let held = top();
    bookAt(97_450);
    // The book moved (Re-centre appears) but the window held on its prices.
    expect(await recentreShown()).toBeTruthy();
    expect(top()).toBe(held);
    expect(middle()).toBeNull();
    expect(region.dataset.pinned).toBe('true');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(middle()).toBe(97_450);
    expect(region.dataset.pinned).toBe('false');

    // One-click armed pins; disarming re-centres.
    fireEvent.click(oneClick());
    expect(oneClick().getAttribute('aria-checked')).toBe('true');
    held = top();
    bookAt(97_500);
    expect(await recentreShown()).toBeTruthy();
    expect(top()).toBe(held);
    fireEvent.click(oneClick());
    expect(middle()).toBe(97_500);

    // An open rung menu pins; closing it re-centres.
    const menu = openRungMenu(/^buy 0.25 btc at 97,495/i);
    held = top();
    bookAt(97_550);
    expect(await recentreShown()).toBeTruthy();
    expect(top()).toBe(held);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: /^orders at/i })).toBeNull();
    expect(middle()).toBe(97_550);
  });

  it('one-click: a market order still needs a second Enter', async () => {
    await ladderWithBook();
    fireEvent.click(oneClick());
    fireEvent.click(screen.getByRole('button', { name: /^sell market$/i }));
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await act(async () => {});
    expect(posts()).toHaveLength(0);
    expect(strip().textContent).toContain('press Enter again');
  });

  it('one-click: Esc disarms', async () => {
    await ladderWithBook();
    fireEvent.click(oneClick());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(oneClick().getAttribute('aria-checked')).toBe('false');
    expect(strip().getAttribute('data-armed')).toBeNull();
    // Disarmed: a click only stages again.
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,395/i }));
    await act(async () => {});
    expect(posts()).toHaveLength(0);
    expect(strip().textContent).toContain('Staged');
  });

  it('one-click: a market switch disarms, and switching back does not re-arm', async () => {
    await ladderWithBook();
    fireEvent.click(oneClick());
    fireEvent.click(screen.getByRole('button', { name: /market btc-usd/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^ethereum/i }));
    await screen.findByRole('button', { name: /market eth-usd\. change market/i });
    expect(oneClick().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /market eth-usd/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^bitcoin/i }));
    await screen.findByRole('button', { name: /market btc-usd\. change market/i });
    expect(oneClick().getAttribute('aria-checked')).toBe('false');
  });

  it('one-click: a dropped connection disarms', async () => {
    await ladderWithBook();
    fireEvent.click(oneClick());
    expect(oneClick().getAttribute('aria-checked')).toBe('true');
    const ws = MockWebSocket.instances.find(w => w.url.endsWith('/ws'))!;
    act(() => (ws.onclose as ((e: { code: number; reason: string }) => void) | null)?.({ code: 1006, reason: '' }));
    await waitFor(() => expect(oneClick().getAttribute('aria-checked')).toBe('false'));
  });

  it('one-click cannot be armed signed out', async () => {
    localStorage.removeItem('oe.session');
    window.history.replaceState({}, '', '/?ui=ladder');
    renderApp();
    await screen.findByRole('grid', { name: /price ladder/i });
    pushBook();
    expect((oneClick() as HTMLButtonElement).disabled).toBe(true);
  });

  // ---- keyboard trading ------------------------------------------------------

  /** The focused rung's price, from the element that has focus. */
  const focusedRung = () =>
    (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-rung-price]')?.dataset.rungPrice ?? null;
  const key = (k: string, mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...mods });

  it('L focuses the ladder from anywhere; arrows and Shift move the focused rung', async () => {
    await ladderWithBook();
    expect(document.activeElement).toBe(document.body);
    key('l');
    const grid = screen.getByRole('grid', { name: /price ladder/i });
    expect(grid.contains(document.activeElement)).toBe(true);
    expect(focusedRung()).toBe('97400');
    key('ArrowUp');
    expect(focusedRung()).toBe('97405');
    key('ArrowDown', { shiftKey: true });
    expect(focusedRung()).toBe('97355');
  });

  it('B then Enter places at the focused rung; Esc clears a stage', async () => {
    await ladderWithBook();
    key('l');
    key('ArrowDown');
    key('s');
    expect(strip().textContent).toContain('Sell 0.25 BTC @ 97,395');
    key('Escape');
    expect(strip().textContent).not.toContain('Sell 0.25 BTC');
    key('b');
    expect(strip().textContent).toContain('Buy 0.25 BTC @ 97,395');
    expect(posts()).toHaveLength(0);
    key('Enter');
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String(posts()[0].init!.body));
    expect(body.side).toBe('BUY');
    expect(body.price).toBe('97395.00000000');
    expect(body.quantity).toBe('0.25000000');
    expect(body.orderType).toBe('LIMIT');
    expect(body.userId).toBeUndefined();
    // Focus stayed on the ladder.
    expect(focusedRung()).toBe('97395');
  });

  it('Shift+B stages a market buy that needs a second Enter', async () => {
    await ladderWithBook();
    key('l');
    key('B', { shiftKey: true });
    expect(strip().textContent).toContain('Buy 0.25 BTC at market');
    key('Enter');
    await act(async () => {});
    expect(posts()).toHaveLength(0);
    expect(strip().textContent).toContain('press Enter again');
    key('Enter');
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0].init!.body)).orderType).toBe('MARKET');
  });

  it('size, type, TIF and one-click keys change the defaults and say so in the strip', async () => {
    await ladderWithBook();
    key('l');
    key('3');
    expect(screen.getByRole('button', { name: /^size 1.00 btc$/i }).getAttribute('aria-pressed')).toBe('true');
    expect(strip().textContent).toContain('Size 1.00 BTC');
    key('-');
    expect((screen.getByRole('spinbutton', { name: /order size in btc/i }) as HTMLInputElement).value).toBe('0.9');
    key('+', { shiftKey: true });
    expect((screen.getByRole('spinbutton', { name: /order size in btc/i }) as HTMLInputElement).value).toBe('1');
    key('t');
    expect(screen.getByRole('button', { name: /order type and time in force: post only, good till cancelled/i })).toBeTruthy();
    expect(strip().textContent).toContain('Order type: Post only');
    key('f');
    expect(screen.getByRole('button', { name: /order type and time in force: post only, immediate or cancel/i })).toBeTruthy();
    key('o', { ctrlKey: true });
    expect(oneClick().getAttribute('aria-checked')).toBe('true');
    key('o', { ctrlKey: true });
    expect(oneClick().getAttribute('aria-checked')).toBe('false');
  });

  it('Del on a focused own order sends a DELETE', async () => {
    await ladderWithBook();
    pushOwn({ id: '9501', price: 97_390 });
    await screen.findByRole('button', { name: /your buy order at 97,390/i });
    key('l');
    key('ArrowDown');
    key('ArrowDown');
    expect(focusedRung()).toBe('97390');
    key('Delete');
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url).toMatch(/\/api\/v1\/orders\/9501$/);
    await waitFor(() => expect(strip().textContent).toContain('Cancelled: Buy 0.5 BTC @ 97,390'));
  });

  it('Alt+Up moves a limit order one rung up (one tick at the default grouping, PUT); a stop is refused with a reason', async () => {
    await ladderWithBook();
    pushOwn({ id: '9601', price: 97_390 });
    pushOwn({ id: '9602', type: 'STOP_LIMIT', side: 'SELL', price: 97_420 });
    await screen.findByRole('button', { name: /your buy order at 97,390/i });
    key('l');
    key(']'); // the first own order at or below the focus: the limit at 97,390
    expect(focusedRung()).toBe('97390');
    key('ArrowUp', { altKey: true });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].url).toMatch(/\/api\/v1\/orders\/9601$/);
    expect(JSON.parse(String(puts()[0].init!.body))).toEqual({ price: '97391.00000000' });
    // Focus goes with the order; 97,391 has no level until the book shows the
    // moved order, so the nearest row (97,390) holds the focus meanwhile.
    expect(focusedRung()).toBe('97390');
    await waitFor(() => expect(strip().textContent).toContain('Moved to 97,391 (re-queued)'));

    key('['); // previous in ladder order: the stop at 97,420
    expect(focusedRung()).toBe('97420');
    key('ArrowUp', { altKey: true });
    await act(async () => {});
    expect(puts()).toHaveLength(1);
    expect(strip().textContent).toContain('Stop limit orders cannot be moved: cancel instead');
    expect(screen.queryByRole('alert')).toBeNull(); // a refusal is polite, not an alert
  });

  it('Ctrl+Shift+X asks first; Enter confirms and cancels', async () => {
    await ladderWithBook();
    pushOwn({ id: '9701', price: 97_390 });
    pushOwn({ id: '9702', price: 97_380 });
    await screen.findByRole('button', { name: /^cancel all · 2$/i });
    key('l');
    key('X', { ctrlKey: true, shiftKey: true });
    expect(strip().textContent).toContain('Cancel all 2 open BTC-USD orders?');
    await act(async () => {});
    expect(deletes()).toHaveLength(0);
    key('Escape');
    expect(strip().textContent).not.toContain('Cancel all 2 open');
    key('X', { ctrlKey: true, shiftKey: true });
    key('Enter');
    await waitFor(() => expect(deletes()).toHaveLength(2));
    await waitFor(() => expect(strip().textContent).toContain('Cancelled 2 orders'));
  });

  it('letters typed in the size field never trigger shortcuts', async () => {
    await ladderWithBook();
    const input = screen.getByRole('spinbutton', { name: /order size in btc/i });
    act(() => input.focus());
    for (const k of ['l', 'b', 's', 't', 'f', '1', 'c', '?', 'Delete']) fireEvent.keyDown(input, { key: k });
    fireEvent.keyDown(input, { key: 'B', shiftKey: true });
    fireEvent.keyDown(input, { key: 'X', ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(input);
    expect(strip().textContent).not.toContain('Staged');
    expect(strip().textContent).not.toContain('Order type');
    expect(screen.getByRole('button', { name: /order type and time in force: limit, good till cancelled/i })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('? opens the shortcut sheet; Esc closes it and focus returns', async () => {
    await ladderWithBook();
    key('l');
    key('ArrowUp');
    const cell = document.activeElement as HTMLElement;
    key('?', { shiftKey: true });
    const sheet = screen.getByRole('dialog', { name: /trade from the keyboard/i });
    expect(sheet.contains(document.activeElement)).toBe(true);
    for (const t of ['Move', 'Order', 'Size and type', 'Cancel and move']) {
      expect(screen.getByRole('region', { name: t })).toBeTruthy();
    }
    expect(sheet.textContent).toContain('Previous or next own order');
    expect(sheet.textContent).not.toContain('Tab');
    // Ladder keys do not reach the ladder behind the sheet.
    key('b');
    expect(strip().textContent).not.toContain('Staged');
    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cell);
    // The visible button opens it too.
    fireEvent.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(screen.getByRole('dialog', { name: /trade from the keyboard/i })).toBeTruthy();
  });

  // ---- View all: the all-orders dialog --------------------------------------

  const viewAll = () => fireEvent.click(screen.getByRole('button', { name: 'View all orders' }));
  const allDialog = () => screen.getByRole('dialog', { name: 'Your orders' });

  it('View all: Cancel selected asks inside the dialog, then sends exactly one DELETE per selected order', async () => {
    await ladderWithBook();
    pushOwn({ id: '9801', price: 97_390 });
    pushOwn({ id: '9802', price: 97_380 });
    pushOwn({ id: '9803', price: 97_370 });
    await waitFor(() => expect(ordersPanel().querySelectorAll('[data-order-row]')).toHaveLength(3));
    const opener = screen.getByRole('button', { name: 'View all orders' });
    viewAll();
    const dlg = allDialog();
    expect(dlg.querySelectorAll('[data-all-orders-row]')).toHaveLength(3);
    // Focus starts on the selected tab.
    expect(document.activeElement).toBe(within(dlg).getByRole('tab', { name: /^open · 3$/i }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Buy 0.50 BTC-USD at 97,390' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Buy 0.50 BTC-USD at 97,370' }));
    expect(dlg.textContent).toContain('2 selected');

    // Asked, not sent; the confirm has focus; Esc backs out and keeps the dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected…' }));
    expect(dlg.textContent).toContain('Cancel 2 selected orders?');
    const confirm = screen.getByRole('button', { name: /^cancel 2$/i });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: 'Escape' });
    await act(async () => {});
    expect(deletes()).toHaveLength(0);
    expect(allDialog()).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel selected…' }));

    // Ask again and confirm: one DELETE per selected order, nothing else.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected…' }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel 2$/i }));
    await waitFor(() => expect(deletes()).toHaveLength(2));
    expect(deletes().map(d => d.url.split('/').pop()).sort()).toEqual(['9801', '9803']);
    await waitFor(() => expect(dlg.querySelector('[data-cancel-notice]')?.textContent).toBe('Cancelled 2 orders'));
    expect(document.activeElement).toBe(dlg.querySelector('[data-cancel-notice]'));
    // The same result reached the strip behind the dialog.
    expect(strip().textContent).toContain('Cancelled 2 orders');
    await waitFor(() => expect(dlg.querySelectorAll('[data-all-orders-row]')).toHaveLength(1));
    await act(async () => {});
    expect(deletes()).toHaveLength(2);

    // Esc closes the dialog and focus returns to ⤢.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('View all: × cancels one row through the ladder; a stop awaiting its trigger shows a dash and no ladder button', async () => {
    await ladderWithBook();
    pushOwn({ id: '9811', price: 97_390 });
    pushOwn({ id: '9812', side: 'SELL', type: 'STOP_LOSS', price: 0, status: 'PENDING_TRIGGER' });
    await waitFor(() => expect(ordersPanel().querySelectorAll('[data-order-row]')).toHaveLength(2));
    viewAll();
    const dlg = allDialog();
    const stopRow = dlg.querySelector<HTMLElement>('[data-all-orders-row="9812"]')!;
    expect(stopRow.textContent).toContain('Stop loss, awaiting trigger');
    expect(stopRow.textContent).toContain('–');
    expect(stopRow.textContent).not.toContain('Show on ladder');

    let release!: () => void;
    deleteGates['9811'] = new Promise<void>(r => (release = r));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Buy 0.50 BTC-USD at 97,390' }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect((screen.getByRole('button', { name: 'Cancelling Buy 0.50 BTC-USD at 97,390' }) as HTMLButtonElement).disabled).toBe(true);
    // The Orders panel behind shows the same pending state.
    expect(ordersPanel().querySelector('[data-order-row="9811"]')!.getAttribute('data-pending')).toBe('cancel');
    release();
    await waitFor(() => expect(dlg.querySelector('[data-cancel-notice]')?.textContent).toBe('Cancelled: Buy 0.50 BTC-USD at 97,390'));
    expect(deletes()[0].url).toMatch(/\/api\/v1\/orders\/9811$/);
  });

  it('View all: Show on ladder switches market, closes the dialog and focuses the order rung', async () => {
    await ladderWithBook();
    pushOwn({ id: '9821', marketId: 2, price: 3_590 });
    await waitFor(() => expect(ordersPanel().textContent).toContain('+1 on other markets'));
    viewAll();
    fireEvent.click(screen.getByRole('button', { name: 'Show Buy 0.50 ETH-USD at 3,590.0 on the ladder' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByRole('button', { name: /market eth-usd\. change market/i });
    // The ETH book arrives: the window pins to the order and focuses its rung.
    const market = MockWebSocket.instances.filter(w => w.url.endsWith('/ws'));
    const ws = market[market.length - 1];
    // Deep enough to hold the order's level (own orders rest at book levels).
    const bids = Array.from({ length: 30 }, (_, i) => ({ price: 3_600 - i * 0.5, quantity: 1, orderCount: 1 }));
    const asks = Array.from({ length: 20 }, (_, i) => ({ price: 3_600.5 + i * 0.5, quantity: 1, orderCount: 1 }));
    act(() => {
      ws.onopen?.();
      ws.onmessage?.({
        data: JSON.stringify({ type: 'BOOK_SNAPSHOT', marketId: 2, market: 'ETH-USD', bids, asks, timestamp: 2 }),
      });
    });
    await waitFor(() => expect(focusedRung()).toBe('3590'));
    expect(screen.getByRole('button', { name: /your buy order at 3,590/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /re-centre/i })).toBeTruthy();
  });

  it('View all: History and Fills tabs render; arrow keys move between tabs', async () => {
    await ladderWithBook();
    viewAll();
    const open = within(allDialog()).getByRole('tab', { name: /^open · 0$/i });
    expect(allDialog().textContent).toContain('No open orders');
    fireEvent.keyDown(open, { key: 'ArrowRight' });
    const history = within(allDialog()).getByRole('tab', { name: 'History' });
    expect(history.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(history);
    await waitFor(() => expect(allDialog().textContent).toContain('Your completed orders will appear here'));
    // Orders only: the fills have their own tab.
    expect(screen.queryByRole('button', { name: /^trades$/i })).toBeNull();
    await waitFor(() => expect(calls.some(c => c.url.includes('/api/v1/orders/history'))).toBe(true));
    fireEvent.click(within(allDialog()).getByRole('tab', { name: 'Fills' }));
    await waitFor(() => expect(allDialog().textContent).toContain('No fills yet'));
  });

  it('keeps the default screen without the flag', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: /open orders/i })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /price ladder/i })).toBeNull();
  });
});
