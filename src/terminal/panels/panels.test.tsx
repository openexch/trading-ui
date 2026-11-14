// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { MarketStats, TapeTrade, UserOrder } from '../../types/market';
import { MARKETS } from '../../types/market';
import type { SlotChrome } from '../layout/SideColumn';
import type { LadderOrderActions } from '../ladder/TradingLadder';

// ---- hook mocks ------------------------------------------------------------

const exec = {
  executions: [] as unknown[],
  loading: false,
  error: null as string | null,
  refresh: vi.fn(async () => {}),
};
vi.mock('../../hooks/useExecutions', () => ({ useExecutions: () => exec }));

const balances = { assets: [] as unknown[], refresh: vi.fn(async () => {}) };
vi.mock('../../hooks/useBalances', () => ({ useBalances: () => balances }));

vi.mock('../../components/Chart/Chart', () => ({
  Chart: (p: { symbol: string; activeInterval: string }) => <div data-testid="chart-mock">{`${p.symbol} ${p.activeInterval}`}</div>,
}));

import { MarketsPanel } from './MarketsPanel';
import { TradesPanel } from './TradesPanel';
import { ChartPanel } from './ChartPanel';
import { OrdersPanel } from './OrdersPanel';
import { FillsPanel } from './FillsPanel';
import { BalancesPanel } from './BalancesPanel';
import { fillPercent, fillsSignal, panelOrders } from './ordersModel';

// ---- fixtures ----------------------------------------------------------------

const BTC = MARKETS[0];
const ETH = MARKETS[1];

const chrome = (position: 'top' | 'bottom' = 'top'): SlotChrome => ({
  slot: 0,
  position,
  picker: variant => <button type="button">{`picker:${variant ?? 'title'}`}</button>,
});

const stats: MarketStats = {
  lastPrice: 97412,
  priceChange: -120,
  priceChangePercent: -0.12,
  high24h: 98000,
  low24h: 96000,
  volume24h: 1234,
};

let nextId = 1;
function order(over: Partial<UserOrder> = {}): UserOrder {
  const id = nextId++;
  return {
    orderId: id,
    omsOrderId: String(5000 + id),
    marketId: BTC.id,
    market: BTC.symbol,
    userId: 1,
    side: 'BID',
    type: 'LIMIT',
    price: 97405,
    originalQuantity: 0.5,
    remainingQuantity: 0.5,
    filledQuantity: 0,
    status: 'NEW',
    timestamp: id,
    ...over,
  };
}

function actions(over: Partial<LadderOrderActions> = {}): LadderOrderActions {
  return {
    pending: new Map(),
    cancel: vi.fn(),
    askCancelAll: vi.fn(),
    cancelAllCount: 2,
    cancelAllRunning: false,
    ...over,
  };
}

beforeEach(() => {
  exec.executions = [];
  exec.loading = false;
  exec.error = null;
  exec.refresh = vi.fn(async () => {});
  balances.assets = [];
});
afterEach(cleanup);

// ---- Markets -------------------------------------------------------------------

describe('MarketsPanel', () => {
  it('lists every market; only the selected one has a live price, the rest a dash', () => {
    render(<MarketsPanel chrome={chrome()} markets={MARKETS} market={BTC} stats={stats} onSelectMarket={() => {}} />);
    const rows = screen.getAllByRole('button').filter(b => b.hasAttribute('data-market-row'));
    expect(rows.map(r => r.getAttribute('data-market-row'))).toEqual(MARKETS.map(m => m.symbol));
    const btc = rows[0];
    expect(btc.getAttribute('aria-current')).toBe('true');
    expect(btc.textContent).toContain('97,412');
    expect(btc.textContent).toContain('-0.12%');
    for (const r of rows.slice(1)) {
      expect(r.textContent).toContain('–');
      expect(r.textContent).not.toMatch(/\d%/);
    }
  });

  it('no stats yet: the selected market prints dashes too, never 0', () => {
    render(<MarketsPanel chrome={chrome()} markets={MARKETS} market={BTC} stats={null} onSelectMarket={() => {}} />);
    const btc = screen.getAllByRole('button').find(b => b.getAttribute('data-market-row') === 'BTC-USD')!;
    expect(btc.textContent).not.toContain('0.00');
    expect(btc.textContent!.match(/–/g)).toHaveLength(2);
  });

  it('a row click switches the market', () => {
    const onSelect = vi.fn();
    render(<MarketsPanel chrome={chrome()} markets={MARKETS} market={BTC} stats={stats} onSelectMarket={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^eth-usd/i }));
    expect(onSelect).toHaveBeenCalledWith(ETH);
    fireEvent.click(screen.getByRole('button', { name: /^btc-usd/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

// ---- Trades ----------------------------------------------------------------

describe('TradesPanel', () => {
  let seq = 0;
  const t = (over: Partial<TapeTrade>): TapeTrade => ({ price: 100, quantity: 1, tradeCount: 1, timestamp: 0, seq: seq++, ...over });

  it('tags rows B / S by taker side, falling back to the tick test', () => {
    const trades = [t({ price: 97410, side: 'SELL' }), t({ price: 97412 }), t({ price: 97411 })];
    render(<TradesPanel chrome={chrome()} market={BTC} trades={trades} />);
    const rows = document.querySelectorAll('[data-trade-row]');
    expect([...rows].map(r => r.textContent!.slice(0, 1))).toEqual(['S', 'B', 'B']);
    expect(rows[0].textContent).toContain('Sell');
    expect(rows[0].textContent).toContain('97,410');
  });

  it('keeps row nodes across a prepend (stable seq keys)', () => {
    const a = t({ price: 1 });
    const b = t({ price: 2 });
    const { rerender } = render(<TradesPanel chrome={chrome()} market={BTC} trades={[a, b]} />);
    const before = [...document.querySelectorAll('[data-trade-row]')];
    rerender(<TradesPanel chrome={chrome()} market={BTC} trades={[t({ price: 3 }), a, b]} />);
    const after = [...document.querySelectorAll('[data-trade-row]')];
    expect(after).toHaveLength(3);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
  });

  it('shows skeleton rows before the first batch', () => {
    render(<TradesPanel chrome={chrome()} market={BTC} trades={[]} />);
    expect(document.querySelector('[data-trades-skeleton]')).toBeTruthy();
  });
});

// ---- Chart -------------------------------------------------------------------

describe('ChartPanel', () => {
  it('renders the chart with the picker in its header', () => {
    render(
      <ChartPanel
        chrome={chrome()}
        symbol="BTC-USD"
        theme="dark"
        chart={{ candles: [], currentCandle: null, activeInterval: '5m', onIntervalChange: () => {}, loading: false }}
      />,
    );
    expect(screen.getByTestId('chart-mock').textContent).toBe('BTC-USD 5m');
    expect(screen.getByRole('button', { name: 'picker:title' })).toBeTruthy();
  });
});

// ---- Orders model ---------------------------------------------------------------

describe('orders model', () => {
  it('lists working orders and stops awaiting trigger on this market; counts the rest', () => {
    const o = [
      order({ timestamp: 1 }),
      order({ status: 'PARTIALLY_FILLED', timestamp: 3 }),
      order({ type: 'STOP_LIMIT', status: 'PENDING_TRIGGER', timestamp: 2 }),
      order({ status: 'PENDING_NEW' }),
      order({ marketId: ETH.id }),
      order({ marketId: ETH.id, status: 'PENDING_TRIGGER', type: 'STOP_LOSS' }),
      order({ marketId: ETH.id, status: 'PENDING_RISK' }),
    ];
    const r = panelOrders(o, BTC.id);
    expect(r.here.map(x => x.timestamp)).toEqual([3, 2, 1]);
    expect(r.elsewhere).toBe(2);
  });

  it('fill percent is whole and bounded', () => {
    expect(fillPercent({ filledQuantity: 0.3, originalQuantity: 0.5 })).toBe(60);
    expect(fillPercent({ filledQuantity: 1, originalQuantity: 0 })).toBe(0);
    expect(fillPercent({ filledQuantity: 2, originalQuantity: 1 })).toBe(100);
  });

  it('fills go stale when filled quantity moves or an order leaves, not when one arrives', () => {
    const a = order({ omsOrderId: 'a' });
    const b = order({ omsOrderId: 'b' });
    let s = fillsSignal(null, [a]);
    expect(s.stale).toBe(false);
    s = fillsSignal(s.next, [a, b]);
    expect(s.stale).toBe(false);
    s = fillsSignal(s.next, [{ ...a, filledQuantity: 0.1 }, b]);
    expect(s.stale).toBe(true);
    s = fillsSignal(s.next, [{ ...a, filledQuantity: 0.1 }]);
    expect(s.stale).toBe(true);
    s = fillsSignal(s.next, [{ ...a, filledQuantity: 0.1 }]);
    expect(s.stale).toBe(false);
  });
});

// ---- Orders panel ----------------------------------------------------------------

describe('OrdersPanel', () => {
  const render0 = (props: Partial<Parameters<typeof OrdersPanel>[0]> = {}) =>
    render(
      <OrdersPanel
        chrome={chrome('bottom')}
        market={BTC}
        orders={[]}
        signedIn
        onSignIn={() => {}}
        actions={actions()}
        {...props}
      />,
    );

  it('compact rows: side and amount, type, price, fill %, cancel; scope line for other markets', () => {
    const o1 = order({ price: 97405, originalQuantity: 0.5, filledQuantity: 0.3, status: 'PARTIALLY_FILLED', timestamp: 10 });
    const o2 = order({ side: 'ASK', type: 'ICEBERG', price: 97420, originalQuantity: 0.2, timestamp: 9 });
    render0({ orders: [o1, o2, order({ marketId: ETH.id }), order({ marketId: ETH.id })] });
    const rows = [...document.querySelectorAll('[data-order-row]')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe('Buy 0.50Limit97,40560%×');
    expect(rows[1].textContent).toBe('Sell 0.20Iceberg97,4200%×');
    expect(screen.getByRole('tab', { name: 'Open · 2' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-orders-elsewhere]')!.textContent).toBe('+2 on other markets');
    expect(screen.getByRole('button', { name: 'picker:icon' })).toBeTruthy();
  });

  it('a stop awaiting its trigger shows no price and can still be cancelled', () => {
    const stop = order({ side: 'ASK', type: 'STOP_LIMIT', status: 'PENDING_TRIGGER', price: 96800, originalQuantity: 0.4 });
    const a = actions();
    render0({ orders: [stop], actions: a });
    const row = document.querySelector('[data-order-row]')!;
    expect(row.textContent).toContain('Stop, awaiting trigger');
    expect(row.textContent).not.toContain('96,800');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sell 0.40 stop limit, awaiting trigger' }));
    expect(a.cancel).toHaveBeenCalledWith(stop);
  });

  it('× cancels through the ladder actions; a pending row is disabled', () => {
    const o = order({ price: 97390 });
    const p = order({ price: 97380 });
    const a = actions({ pending: new Map([[p.omsOrderId, 'cancel' as const]]) });
    render0({ orders: [o, p], actions: a });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Buy 0.50 at 97,390' }));
    expect(a.cancel).toHaveBeenCalledWith(o);
    const busy = screen.getByRole('button', { name: 'Cancelling Buy 0.50 at 97,380' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
  });

  it('⋯ Cancel all asks (the strip confirms); it never cancels directly', () => {
    const a = actions({ cancelAllCount: 2 });
    render0({ orders: [order(), order()], actions: a });
    fireEvent.click(screen.getByRole('button', { name: 'More order actions' }));
    const item = screen.getByRole('menuitem', { name: /cancel all on btc-usd/i });
    expect(item.textContent).toContain('2');
    fireEvent.click(item);
    expect(a.askCancelAll).toHaveBeenCalledTimes(1);
    expect(a.cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Cancel all is disabled with nothing to cancel or while a run is going', () => {
    const a = actions({ cancelAllCount: 0 });
    render0({ orders: [], actions: a });
    fireEvent.click(screen.getByRole('button', { name: 'More order actions' }));
    const item = screen.getByRole('menuitem', { name: /cancel all/i });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);
    expect(a.askCancelAll).not.toHaveBeenCalled();
    cleanup();
    const b = actions({ cancelAllRunning: true });
    render0({ orders: [order()], actions: b });
    fireEvent.click(screen.getByRole('button', { name: 'More order actions' }));
    expect(screen.getByRole('menuitem', { name: /cancel all/i }).getAttribute('aria-disabled')).toBe('true');
  });

  it('⤢ View all is present but not built yet', () => {
    render0();
    const v = screen.getByRole('button', { name: /view all orders/i });
    expect(v.getAttribute('aria-disabled')).toBe('true');
    expect(v.getAttribute('title')).toBe('View all arrives next');
  });

  it('the Fills tab shows the fills list', () => {
    exec.executions = [
      { tradeId: '1', omsOrderId: 'x', userId: 1, marketId: BTC.id, side: 'BUY', price: 97400, quantity: 0.25, maker: true, executedAtMs: 0 },
    ];
    render0();
    fireEvent.click(screen.getByRole('tab', { name: 'Fills' }));
    expect(screen.getByRole('tab', { name: 'Fills' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel')).getByRole('list', { name: 'Your fills' }).textContent).toContain('Buy 0.2500');
  });

  it('signed out: a sign-in prompt, no rows, no count', () => {
    const onSignIn = vi.fn();
    render0({ signedIn: false, actions: null, orders: [order()], onSignIn });
    expect(document.querySelector('[data-order-row]')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Open · –' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalled();
  });
});

// ---- Fills -----------------------------------------------------------------

describe('FillsPanel', () => {
  it('lists fills newest first as given, with market and maker / taker', () => {
    exec.executions = [
      { tradeId: '2', omsOrderId: 'x', userId: 1, marketId: ETH.id, side: 'SELL', price: 3642.5, quantity: 1, maker: false, executedAtMs: 0 },
      { tradeId: '1', omsOrderId: 'y', userId: 1, marketId: BTC.id, side: 'BUY', price: 97400, quantity: 0.25, maker: true, executedAtMs: 0 },
    ];
    render(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[]} />);
    const rows = [...document.querySelectorAll('[data-fill-row]')].map(r => r.textContent);
    expect(rows[0]).toContain('Sell 1.0000 ETH-USD');
    expect(rows[0]).toContain('3,642.5T');
    expect(rows[1]).toContain('Buy 0.2500 BTC-USD');
    expect(rows[1]).toContain('97,400M');
  });

  it('refreshes when filled quantity changes or an order leaves, and from the button', () => {
    const a = order({ omsOrderId: 'a' });
    const b = order({ omsOrderId: 'b' });
    const { rerender } = render(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[a, b]} />);
    // Mount refresh is the hook's own; the panel adds none.
    expect(exec.refresh).toHaveBeenCalledTimes(0);
    // A new order arriving: no refresh.
    const c = order({ omsOrderId: 'c' });
    rerender(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[a, b, c]} />);
    expect(exec.refresh).toHaveBeenCalledTimes(0);
    // A partial fill.
    rerender(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[{ ...a, filledQuantity: 0.2 }, b, c]} />);
    expect(exec.refresh).toHaveBeenCalledTimes(1);
    // An order leaves (filled or cancelled).
    rerender(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[{ ...a, filledQuantity: 0.2 }, c]} />);
    expect(exec.refresh).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh fills' }));
    expect(exec.refresh).toHaveBeenCalledTimes(3);
  });

  it('shows the error as an alert and an empty list honestly', () => {
    exec.error = 'Trade history unavailable: OMS persistence is disabled';
    const { unmount } = render(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[]} />);
    expect(screen.getByRole('alert').textContent).toContain('unavailable');
    unmount();
    exec.error = null;
    render(<FillsPanel chrome={chrome()} signedIn onSignIn={() => {}} orders={[]} />);
    expect(screen.getByText('No fills yet')).toBeTruthy();
  });

  it('signed out: a sign-in prompt, and the executions hook is not used', () => {
    render(<FillsPanel chrome={chrome()} signedIn={false} onSignIn={() => {}} orders={[]} />);
    expect(screen.getByText('Sign in to see your fills')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh fills' })).toBeNull();
  });
});

// ---- Balances ---------------------------------------------------------------------

describe('BalancesPanel', () => {
  it('shows available and locked per asset, no portfolio total', () => {
    balances.assets = [
      { asset: 'USD', assetId: 1, available: 78214.4, locked: 1200, total: 79414.4 },
      { asset: 'BTC', assetId: 2, available: 1.842, locked: 0.25, total: 2.092 },
    ];
    render(<BalancesPanel chrome={chrome()} signedIn onSignIn={() => {}} />);
    const usd = document.querySelector('[data-balance-row="USD"]')!;
    expect(usd.textContent).toBe('USD78,214.401,200.00');
    const btc = document.querySelector('[data-balance-row="BTC"]')!;
    expect(btc.textContent).toBe('BTC1.8420.25');
    expect(screen.queryByText(/total/i)).toBeNull();
  });

  it('signed out: a sign-in prompt', () => {
    render(<BalancesPanel chrome={chrome()} signedIn={false} onSignIn={() => {}} />);
    expect(screen.getByText('Sign in to see your balances')).toBeTruthy();
  });
});

