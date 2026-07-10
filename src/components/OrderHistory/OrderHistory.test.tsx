// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * OrderHistory reject-reason display (trading-ui#61): a REJECTED row must
 * surface the friendly reason (title tooltip on the status badge, plus a
 * muted inline reason) without adding a column or changing the row's cell
 * template — every row renders the same fixed set of <td>s.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const baseOrder = {
  omsOrderId: '1',
  clientOrderId: 'c1',
  userId: 1,
  marketId: 1,
  side: 'BUY' as const,
  orderType: 'LIMIT',
  timeInForce: 'GTC',
  price: 100000,
  quantity: 0.5,
  filledQty: 0,
  remainingQty: 0,
  stopPrice: 0,
  createdAtMs: 1000,
  updatedAtMs: 1000,
};

let mockOrders: unknown[] = [];

vi.mock('../../hooks/useOrderHistory', () => ({
  useOrderHistory: () => ({ orders: mockOrders, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../hooks/useExecutions', () => ({
  useExecutions: () => ({ executions: [], loading: false, error: null, refresh: vi.fn() }),
}));

import { OrderHistory } from './OrderHistory';
import { MARKETS } from '../../types/market';

describe('OrderHistory reject reason', () => {
  afterEach(() => {
    cleanup();
    mockOrders = [];
  });

  it('shows a friendly reason via title on the status badge for a REJECTED row', () => {
    mockOrders = [{ ...baseOrder, status: 'REJECTED', rejectReason: 'PRICE_OFF_TICK' }];
    render(<OrderHistory market={MARKETS[0]} />);

    const badge = screen.getByText('REJECTED');
    expect(badge.getAttribute('title')).toBe('price is not a multiple of the market tick');
  });

  it('renders the friendly reason inline next to the badge', () => {
    mockOrders = [{ ...baseOrder, status: 'REJECTED', rejectReason: 'INSUFFICIENT_BALANCE' }];
    render(<OrderHistory market={MARKETS[0]} />);

    screen.getByText('insufficient balance for this order'); // throws if absent
  });

  it('never renders a blank reason for an unmapped code', () => {
    mockOrders = [{ ...baseOrder, status: 'REJECTED', rejectReason: 'SOME_NEW_CODE' }];
    render(<OrderHistory market={MARKETS[0]} />);

    screen.getByText('SOME_NEW_CODE'); // throws if absent
  });

  it('keeps the row template identical (same cell count) whether or not the row is rejected', () => {
    mockOrders = [
      { ...baseOrder, omsOrderId: '1', status: 'FILLED', rejectReason: null },
      { ...baseOrder, omsOrderId: '2', status: 'REJECTED', rejectReason: 'BOOK_FULL' },
    ];
    const { container } = render(<OrderHistory market={MARKETS[0]} />);

    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const cellCounts = Array.from(rows).map(r => within(r as HTMLElement).getAllByRole('cell').length);
    // Both rows expose the same fixed set of columns — no extra <td> for the
    // rejected row's reason (it lives inside the existing Status cell).
    expect(cellCounts[0]).toBe(cellCounts[1]);
  });

  it('does not attach a reason to non-rejected rows', () => {
    mockOrders = [{ ...baseOrder, status: 'FILLED', rejectReason: null }];
    render(<OrderHistory market={MARKETS[0]} />);

    const badge = screen.getByText('FILLED');
    expect(badge.getAttribute('title')).toBeNull();
  });
});
