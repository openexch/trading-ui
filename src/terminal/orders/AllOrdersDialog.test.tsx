// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { OrderType, UserOrder } from '../../types/market';
import { TEST_MARKETS as MARKETS } from '../../test/markets';
import type { LadderOrderActions } from '../ladder/TradingLadder';
import type { CancelResult } from '../../trading/orderActions';
import { AllOrdersDialog } from './AllOrdersDialog';
import { matchesSearch, selectAllState } from './allOrdersModel';

vi.mock('../../hooks/useOrderHistory', () => ({
  useOrderHistory: () => ({ orders: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../hooks/useExecutions', () => ({
  useExecutions: () => ({ executions: [], loading: false, error: null, refresh: vi.fn() }),
}));

const BTC = MARKETS[0];
const ETH = MARKETS[1];

let seq = 1;
function order(o: {
  market?: typeof BTC;
  side?: 'BID' | 'ASK';
  type?: OrderType;
  price: number;
  qty?: number;
  status?: UserOrder['status'];
  id?: string;
}): UserOrder {
  const n = seq++;
  const m = o.market ?? BTC;
  const qty = o.qty ?? 0.5;
  return {
    orderId: n,
    omsOrderId: o.id ?? String(5000 + n),
    marketId: m.id,
    market: m.symbol,
    side: o.side ?? 'BID',
    type: o.type ?? 'LIMIT',
    price: o.price,
    originalQuantity: qty,
    remainingQuantity: qty,
    filledQuantity: 0,
    status: o.status ?? 'NEW',
    timestamp: 1_700_000_000_000 + n * 1000,
  };
}

function actions(over: Partial<LadderOrderActions> = {}): LadderOrderActions {
  return {
    pending: new Map(),
    cancel: vi.fn(async (o: UserOrder): Promise<CancelResult> => ({ order: o, success: true, message: '' })),
    cancelMany: vi.fn(async (os: readonly UserOrder[]) => os.map(o => ({ order: o, success: true, message: '' }))),
    askCancelAll: vi.fn(),
    cancelAllCount: 0,
    cancelAllRunning: false,
    ...over,
  };
}

const ORDERS: UserOrder[] = [
  order({ price: 97_405, id: '7001' }),
  order({ price: 97_420, side: 'ASK', id: '7002' }),
  order({ price: 97_050, type: 'ICEBERG', id: '7003' }),
  order({ price: 0, side: 'ASK', type: 'STOP_LIMIT', status: 'PENDING_TRIGGER', id: '7004' }),
  order({ market: ETH, price: 3_610, id: '7005' }),
  order({ market: ETH, price: 3_700, side: 'ASK', type: 'STOP_LOSS', id: '7006' }),
  // Not listed: done orders stay in History.
  order({ price: 97_000, status: 'FILLED', id: '7007' }),
];

function setup(acts: LadderOrderActions | null = actions(), orders: UserOrder[] = ORDERS) {
  const onClose = vi.fn();
  const onShow = vi.fn();
  render(
    <AllOrdersDialog open onClose={onClose} market={BTC} orders={orders} actions={acts} onShowOnLadder={onShow} />,
  );
  return { onClose, onShow, dlg: screen.getByRole('dialog', { name: 'Your orders' }) };
}

const ids = (dlg: HTMLElement) =>
  Array.from(dlg.querySelectorAll<HTMLElement>('[data-all-orders-row]')).map(r => r.dataset.allOrdersRow);
const chip = (name: string) => screen.getByRole('button', { name });

afterEach(() => cleanup());

describe('AllOrdersDialog: Open tab', () => {
  it('lists working orders and stops awaiting trigger on every market, newest first; Time reverses', () => {
    const { dlg } = setup();
    expect(ids(dlg)).toEqual(['7006', '7005', '7004', '7003', '7002', '7001']);
    expect(dlg.textContent).toContain('6 orders · 2 markets');
    const stop = dlg.querySelector('[data-all-orders-row="7004"]')!;
    expect(stop.textContent).toContain('Stop limit, awaiting trigger');
    expect(stop.textContent).toContain('–');
    // No time-in-force column: the order model does not carry it.
    expect(within(dlg).queryByRole('columnheader', { name: /tif/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^time, newest first/i }));
    expect(ids(dlg)).toEqual(['7001', '7002', '7003', '7004', '7005', '7006']);
  });

  it('market chips come from the orders; filters combine across groups and alternate within one', () => {
    const { dlg } = setup();
    expect(screen.getAllByRole('button', { pressed: false }).map(b => b.textContent)).toEqual(
      expect.arrayContaining(['BTC-USD', 'ETH-USD', 'Buy', 'Sell', 'Limit', 'Stops', 'Iceberg']),
    );
    expect(screen.queryByRole('button', { name: 'SOL-USD' })).toBeNull();
    expect(chip('All markets').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(chip('ETH-USD'));
    expect(chip('All markets').getAttribute('aria-pressed')).toBe('false');
    expect(ids(dlg)).toEqual(['7006', '7005']);
    fireEvent.click(chip('Sell'));
    expect(ids(dlg)).toEqual(['7006']);
    fireEvent.click(chip('Limit'));
    expect(ids(dlg)).toEqual([]);
    expect(dlg.textContent).toContain('No orders match these filters');
    fireEvent.click(chip('Stops'));
    expect(ids(dlg)).toEqual(['7006']);
    // Two markets: either one (sells, limit or stop).
    fireEvent.click(chip('BTC-USD'));
    expect(ids(dlg)).toEqual(['7006', '7004', '7002']);
    // Buy and Sell both on: either side.
    fireEvent.click(chip('Buy'));
    expect(ids(dlg)).toEqual(['7006', '7005', '7004', '7002', '7001']);
    // All markets clears the market chips only.
    fireEvent.click(chip('All markets'));
    expect(ids(dlg)).toEqual(['7006', '7005', '7004', '7002', '7001']);
    fireEvent.click(chip('Iceberg'));
    expect(ids(dlg)).toEqual(['7006', '7005', '7004', '7003', '7002', '7001']);
  });

  it('search matches the order id or the printed price, separators ignored', () => {
    const { dlg } = setup();
    const box = screen.getByRole('searchbox', { name: /search orders by price or id/i });
    fireEvent.change(box, { target: { value: '7003' } });
    expect(ids(dlg)).toEqual(['7003']);
    fireEvent.change(box, { target: { value: '97,4' } });
    expect(ids(dlg)).toEqual(['7002', '7001']);
    fireEvent.change(box, { target: { value: '3610.0' } });
    expect(ids(dlg)).toEqual(['7005']);
    // With a filter on as well.
    fireEvent.change(box, { target: { value: '974' } });
    fireEvent.click(chip('Sell'));
    expect(ids(dlg)).toEqual(['7002']);
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(ids(dlg)).toEqual([]);
    // A stop awaiting its trigger has no price to match.
    const stop = ORDERS[3];
    expect(matchesSearch({ ...stop, omsOrderId: 'x' }, BTC, '0')).toBe(false);
  });

  it('select-all: unchecked, mixed over a partial selection, checked; it covers the rows on screen', () => {
    setup();
    const all = () => screen.getByRole('checkbox', { name: /^select all/i }) as HTMLInputElement;
    expect(all().checked).toBe(false);
    expect(all().indeterminate).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Buy 0.50 BTC-USD at 97,405' }));
    expect(all().indeterminate).toBe(true);
    expect(all().checked).toBe(false);
    expect(all().getAttribute('aria-label')).toBe('Select all, 1 of 6 selected');

    // A click on the mixed box selects every row.
    fireEvent.click(all());
    expect(all().indeterminate).toBe(false);
    expect(all().checked).toBe(true);
    expect(screen.getByText('6 selected')).toBeTruthy();

    // Filtered: the selection keeps only the rows on screen.
    fireEvent.click(chip('ETH-USD'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(all().checked).toBe(true);
    fireEvent.click(chip('ETH-USD'));
    expect(all().indeterminate).toBe(true);
    fireEvent.click(all());
    fireEvent.click(all());
    expect(all().checked).toBe(false);
    expect(screen.getByText('None selected')).toBeTruthy();

    expect(selectAllState([], new Set())).toBe('none');
    expect(selectAllState(['a', 'b'], new Set(['b']))).toBe('some');
    expect(selectAllState(['a'], new Set(['a', 'x']))).toBe('all');
  });

  it('rows in flight cannot be selected and Cancel selected skips nothing it shows', async () => {
    const acts = actions({ pending: new Map([['7001', 'cancel' as const]]) });
    setup(acts);
    const busy = screen.getByRole('checkbox', { name: 'Select Buy 0.50 BTC-USD at 97,405' }) as HTMLInputElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /^select all/i }));
    expect(screen.getByText('5 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected…' }));
    expect(acts.cancelMany).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cancel 5$/i }));
    });
    expect(acts.cancelMany).toHaveBeenCalledTimes(1);
    const sent = (acts.cancelMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserOrder[];
    expect(sent.map(o => o.omsOrderId).sort()).toEqual(['7002', '7003', '7004', '7005', '7006']);
  });

  it('a failed run keeps the failed rows selected and says why', async () => {
    const acts = actions({
      cancelMany: vi.fn(async (os: readonly UserOrder[]) =>
        os.map(o => ({ order: o, success: o.omsOrderId !== '7005', message: o.omsOrderId === '7005' ? 'ORDER_NOT_FOUND' : '' })),
      ),
    });
    const { dlg } = setup(acts);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Buy 0.50 ETH-USD at 3,610.0' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Buy 0.50 BTC-USD at 97,405' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected…' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cancel 2$/i }));
    });
    const notice = dlg.querySelector<HTMLElement>('[data-cancel-notice]')!;
    expect(notice.textContent).toBe('Cancel selected: 1 cancelled, 1 failed (ORDER_NOT_FOUND)');
    expect(notice.getAttribute('title')).toBe('Buy 0.50 ETH-USD at 3,610.0: ORDER_NOT_FOUND');
    expect(document.activeElement).toBe(notice);
    // The cancelled row is still in this (static) feed, but only the failed
    // one stays selected.
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Select Buy 0.50 ETH-USD at 3,610.0' }) as HTMLInputElement).checked).toBe(true);
  });

  it('× cancels one row; Show on ladder closes and hands the order over; stops get no ladder button', () => {
    const acts = actions();
    const { onClose, onShow } = setup(acts);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Sell 0.50 BTC-USD stop limit, awaiting trigger' }));
    expect(acts.cancel).toHaveBeenCalledWith(ORDERS[3]);
    expect(screen.queryByRole('button', { name: /show sell 0.50 btc-usd stop/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Buy 0.50 ETH-USD at 3,610.0 on the ladder' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith(ORDERS[4]);
  });

  it('Esc closes the dialog unless the cancel question is open', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Buy 0.50 BTC-USD at 97,405' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selected…' }));
    fireEvent.keyDown(screen.getByRole('button', { name: /^cancel 1$/i }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^cancel 1$/i })).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel selected…' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('signed in without actions: nothing can be selected or cancelled', () => {
    setup(null);
    expect((screen.getByRole('checkbox', { name: /^select all/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel Buy 0.50 BTC-USD at 97,405' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AllOrdersDialog: History and Fills', () => {
  it('History shows the order history list only; Fills shows the fills list', () => {
    const { dlg } = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(dlg.textContent).toContain('Your completed orders will appear here');
    expect(within(dlg).queryByRole('button', { name: /^trades$/i })).toBeNull();
    expect(within(dlg).queryByRole('searchbox')).toBeNull();
    expect(dlg.textContent).toContain('Latest 100');
    fireEvent.click(screen.getByRole('tab', { name: 'Fills' }));
    expect(dlg.textContent).toContain('No fills yet');
  });
});
