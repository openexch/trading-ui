// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Phone shell smoke test: the real <App/> under ?ui=ladder with matchMedia
 * reporting a phone (max-width 768px) and the network mocked. A tap stages
 * into the bottom sheet and Place sends the same wire request as the
 * desktop; the rung menu opens by long-press and by the visible "More order
 * types" button; a market order takes a second tap; there is no one-click;
 * the bottom nav switches tabs.
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
import { LONG_PRESS_MS } from '../terminal/ladder/Rung';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {}
}

/** Every observed element reports 484px: eleven 44px rungs. */
class FixedResizeObserver {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    this.cb([{ contentRect: { height: 484 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

/** A phone: every max-width query up to 768px matches. */
function stubPhoneMatchMedia() {
  window.matchMedia = ((query: string) => {
    const m = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: m ? Number(m[1]) >= 390 : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
}

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let accounts: unknown = { userId: 1, assets: [] };

function stubFetch() {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/v1/orders') && init?.method === 'POST')
      body = { accepted: true, omsOrderId: '331911111111111111', status: 'PENDING_NEW' };
    else if (url.includes('/api/v1/auth/me')) body = { userId: 1, username: 'dev' };
    else if (url.includes('/api/v1/orders') || url.includes('/api/v1/executions')) body = [];
    else if (url.includes('/api/v1/accounts')) body = accounts;
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
const sheet = () => screen.getByRole('status', { name: /staged order/i });
const bodyOf = (c: Call) => JSON.parse(String(c.init!.body));

async function phoneWithBook() {
  window.history.replaceState({}, '', '/?ui=ladder');
  const utils = renderApp();
  await screen.findByRole('grid', { name: /price ladder/i });
  await screen.findByRole('button', { name: /menu, signed in as dev/i });
  pushBook();
  await screen.findByRole('gridcell', { name: /^buy 0.25 btc at 97,400, 1.0000 on book, 1.0000 cumulative$/i });
  return utils;
}

describe('Phone shell (?ui=ladder at 768px and below)', () => {
  beforeEach(() => {
    cleanup();
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = FixedResizeObserver as unknown as typeof ResizeObserver;
    stubPhoneMatchMedia();
    accounts = { userId: 1, assets: [] };
    stubFetch();
    localStorage.clear();
    localStorage.setItem('oe.session', JSON.stringify({ token: 'smoketoken1', userId: 1, username: 'dev' }));
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders the phone shell: header, 44px rungs, settings row, bottom nav, no desktop chrome', async () => {
    const { container } = await phoneWithBook();
    expect(container.querySelector('[data-terminal="phone"]')).toBeTruthy();
    expect(container.querySelector('[data-terminal="desktop"]')).toBeNull();
    expect(screen.getByRole('button', { name: /market btc-usd\. change market/i })).toBeTruthy();
    // Nine 44px rungs from a 484px rung area once the 20px spread row is set
    // aside (464 / 44 = 10, odd: 9), Bids | Price | Asks.
    const rows = container.querySelectorAll('[data-rung-price]');
    expect(rows.length).toBe(9);
    expect(container.querySelectorAll('[data-spread-row]')).toHaveLength(1);
    for (const r of Array.from(rows)) expect(r.className).toContain('h-[44px]');
    expect(screen.getByRole('button', { name: /^order settings: 0.25 btc, limit, good till cancelled$/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /price grouping/i })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: /sections/i });
    expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['Ladder', 'Chart', 'Orders 0', 'Trades']);
    // The desktop defaults bar and strip are not here.
    expect(screen.queryByRole('form', { name: /order defaults/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /keyboard shortcuts/i })).toBeNull();
  });

  it('has no one-click control anywhere, not even in the order settings', async () => {
    await phoneWithBook();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/one-click/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^order settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /order settings/i });
    expect(within(dialog).queryByRole('switch')).toBeNull();
    expect(within(dialog).queryByText(/one-click/i)).toBeNull();
    // The one-click key does nothing but explain.
    const grid = screen.getByRole('grid', { name: /price ladder/i });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    act(() => grid.focus());
    fireEvent.keyDown(grid, { key: 'o', code: 'KeyO', ctrlKey: true });
    expect(sheet().textContent).toContain('One-click is not available on a phone');
    expect(screen.queryByText(/one-click on/i)).toBeNull();
  });

  it('tap a bid rung: the sheet opens; Place POSTs the same wire contract as the desktop', async () => {
    await phoneWithBook();
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i }));
    expect(sheet().textContent).toContain('Buy 0.25 BTC @ 97,400');
    expect(sheet().textContent).toContain('Limit · GTC');
    expect(sheet().textContent).toContain('24,350.00 USD');
    expect(posts()).toHaveLength(0); // a tap only stages

    fireEvent.click(within(sheet()).getByRole('button', { name: /^place buy$/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const post = posts()[0];
    const body = bodyOf(post);
    expect(body.price).toBe('97400.00000000');
    expect(body.quantity).toBe('0.25000000');
    expect(body.side).toBe('BUY');
    expect(body.orderType).toBe('LIMIT');
    expect(body.timeInForce).toBe('GTC');
    expect(body.marketId).toBe(1);
    expect(body.userId).toBeUndefined();
    expect((post.init!.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    // Accepted: the result shows, the sheet closes.
    await waitFor(() => expect(sheet().textContent).toContain('Accepted: Buy 0.25 BTC @ 97,400'));
    expect(screen.queryByRole('button', { name: /^place/i })).toBeNull();
  });

  it('Cancel on the sheet clears the stage and sends nothing', async () => {
    await phoneWithBook();
    fireEvent.click(screen.getByRole('gridcell', { name: /^sell 0.25 btc at 97,410/i }));
    expect(sheet().textContent).toContain('Sell 0.25 BTC @ 97,410');
    fireEvent.click(within(sheet()).getByRole('button', { name: /^cancel$/i }));
    expect(sheet().textContent).not.toContain('Sell 0.25');
    await act(async () => {});
    expect(posts()).toHaveLength(0);
  });

  it('"More order types" opens the order-type menu without a long-press', async () => {
    await phoneWithBook();
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,390/i }));
    fireEvent.click(within(sheet()).getByRole('button', { name: /more order types/i }));
    const menu = screen.getByRole('menu', { name: 'Orders at 97,390' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map(i => i.firstElementChild!.textContent)).toEqual([
      'Buy limit', 'Sell stop loss', 'Sell stop limit…', 'Sell trailing stop…', 'Buy iceberg…',
    ]);
    // 44px items on the phone.
    expect(menu.className).toContain('[&_[role=menuitem]]:min-h-11');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /sell stop loss/i }));
    expect(sheet().textContent).toContain('Sell 0.25 BTC, stop 97,390');
    expect(sheet().textContent).toContain('Stop loss · GTC');

    fireEvent.click(within(sheet()).getByRole('button', { name: /^place sell$/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = bodyOf(posts()[0]);
    expect(body.orderType).toBe('STOP_LOSS');
    expect(body.side).toBe('SELL');
    expect(body.stopPrice).toBe('97390.00000000');
    expect(body.quantity).toBe('0.25000000');
    expect(body.userId).toBeUndefined();
  });

  it('a long-press on a rung opens the same menu and does not stage', async () => {
    await phoneWithBook();
    const cell = screen.getByRole('gridcell', { name: /^sell 0.25 btc at 97,415/i });
    fireEvent.pointerDown(cell, { pointerType: 'touch', pointerId: 1, clientX: 300, clientY: 200 });
    await act(async () => {
      await new Promise(r => setTimeout(r, LONG_PRESS_MS + 50));
    });
    const menu = screen.getByRole('menu', { name: 'Orders at 97,415' });
    expect(within(menu).getAllByRole('menuitem')[0].firstElementChild!.textContent).toBe('Sell limit');
    // The click that ends the press does not stage.
    fireEvent.pointerUp(cell, { pointerType: 'touch', pointerId: 1 });
    fireEvent.click(cell);
    expect(sheet().textContent).not.toContain('Sell 0.25 BTC @');
    // A short tap still stages.
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.pointerDown(cell, { pointerType: 'touch', pointerId: 2, clientX: 300, clientY: 200 });
    fireEvent.pointerUp(cell, { pointerType: 'touch', pointerId: 2 });
    fireEvent.click(cell);
    expect(sheet().textContent).toContain('Sell 0.25 BTC @ 97,415');
  });

  it('a market order asks for a second tap before it is sent', async () => {
    await phoneWithBook();
    fireEvent.click(screen.getByRole('button', { name: /^order settings/i }));
    const dialog = await screen.findByRole('dialog', { name: /order settings/i });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Market' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^done$/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^order settings: 0.25 btc, market, good till cancelled$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('gridcell', { name: /^sell 0.25 btc at 97,410/i }));
    expect(sheet().textContent).toContain('Sell 0.25 BTC at market');
    fireEvent.click(within(sheet()).getByRole('button', { name: /^place sell$/i }));
    await act(async () => {});
    expect(posts()).toHaveLength(0);
    expect(sheet().textContent).toContain('tap Confirm');

    fireEvent.click(within(sheet()).getByRole('button', { name: /^confirm market sell$/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = bodyOf(posts()[0]);
    expect(body.orderType).toBe('MARKET');
    expect(body.side).toBe('SELL');
    expect(body.quantity).toBe('0.25000000');
    expect(body.userId).toBeUndefined();
  });

  it('% of available sizes from the real balance, and is left out while it is unknown', async () => {
    await phoneWithBook();
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i }));
    // No balance for USD yet: no % buttons, never an invented size.
    expect(within(sheet()).queryByRole('button', { name: '50%' })).toBeNull();
  });

  it('% of available sets the size from the spent asset\'s balance', async () => {
    accounts = { userId: 1, assets: [{ asset: 'USD', assetId: 2, available: '10000', locked: '0', total: '10000' }] };
    await phoneWithBook();
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i }));
    fireEvent.click(await within(sheet()).findByRole('button', { name: '50%' }));
    // 50% of 10,000 USD at 97,400.
    expect(sheet().textContent).toContain('Buy 0.05133470 BTC @ 97,400');
    fireEvent.click(within(sheet()).getByRole('button', { name: /^place buy$/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(bodyOf(posts()[0]).quantity).toBe('0.05133470');
  });

  it('the bottom nav switches tabs; the staged order survives a round trip', async () => {
    const { container } = await phoneWithBook();
    const nav = screen.getByRole('navigation', { name: /sections/i });
    const ladder = screen.getByRole('region', { name: /depth ladder/i, hidden: true });
    expect(within(nav).getByRole('button', { name: 'Ladder' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('gridcell', { name: /^buy 0.25 btc at 97,400/i }));

    fireEvent.click(within(nav).getByRole('button', { name: 'Chart' }));
    expect(within(nav).getByRole('button', { name: 'Chart' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('chart-mock')).toBeTruthy();
    expect(ladder.hidden).toBe(true);
    // The staged order's sheet belongs to the ladder tab.
    expect(within(sheet()).queryByRole('button', { name: /^place/i })).toBeNull();

    fireEvent.click(within(nav).getByRole('button', { name: /^orders/i }));
    expect(screen.getByRole('region', { name: /orders and fills/i })).toBeTruthy();
    expect(screen.getByText(/no open orders on btc-usd/i)).toBeTruthy();
    expect(screen.queryByTestId('chart-mock')).toBeNull();

    fireEvent.click(within(nav).getByRole('button', { name: 'Trades' }));
    expect(screen.getByRole('region', { name: 'Trades' })).toBeTruthy();

    fireEvent.click(within(nav).getByRole('button', { name: 'Ladder' }));
    expect(ladder.hidden).toBe(false);
    expect(within(sheet()).getByRole('button', { name: /^place buy$/i })).toBeTruthy();
    expect(container.querySelector('[data-staged="true"]')).toBeTruthy();
  });

  it('opts into viewport-fit=cover while mounted and restores the meta on unmount', async () => {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0';
    document.head.appendChild(meta);
    try {
      const { unmount } = await phoneWithBook();
      expect(meta.content).toContain('viewport-fit=cover');
      unmount();
      expect(meta.content).toBe('width=device-width, initial-scale=1.0');
    } finally {
      meta.remove();
    }
  });
});
