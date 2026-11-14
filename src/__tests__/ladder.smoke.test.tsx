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

  // ---- rung menu, order popovers, own-order actions, one-click ------------

  const strip = () => screen.getByRole('status', { name: /staged order/i });
  const deletes = () => calls.filter(c => c.url.includes('/api/v1/orders/') && c.init?.method === 'DELETE');
  const puts = () => calls.filter(c => c.url.includes('/api/v1/orders/') && c.init?.method === 'PUT');

  /** Push an own order through the OMS socket (the user-scoped feed). */
  function pushOwn(o: { id: string; side?: 'BUY' | 'SELL'; type?: string; price: number; qty?: number; status?: string }) {
    const oms = MockWebSocket.instances.find(w => w.url.endsWith('/ws/v1'))!;
    const q = (o.qty ?? 0.5).toFixed(8);
    act(() => {
      oms.onopen?.();
      oms.onmessage?.({
        data: JSON.stringify({
          omsOrderId: o.id,
          clusterOrderId: '7',
          userId: 1,
          marketId: 1,
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
    fireEvent.click(await screen.findByRole('button', { name: /ethereum/i }));
    await screen.findByRole('button', { name: /market eth-usd\. change market/i });
    expect(oneClick().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /market eth-usd/i }));
    fireEvent.click(await screen.findByRole('button', { name: /bitcoin/i }));
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

  it('keeps the default screen without the flag', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: /open orders/i })).toBeTruthy();
    expect(screen.queryByRole('grid', { name: /price ladder/i })).toBeNull();
  });
});
