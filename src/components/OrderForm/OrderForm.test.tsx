// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Order form % sizing against real balances: buy sizes pct% of the QUOTE
 * balance divided by the price (form price first, last trade price as the
 * fallback); sell sizes pct% of the BASE balance. The Avbl line is a 100%
 * quick-fill. Amounts are rounded to 8 dp and floor at 0 with no balance.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Balances context is mocked — the form only reads { assets, refresh }
vi.mock('../../hooks/useBalances', () => ({
  useBalances: () => ({
    assets: [
      { asset: 'USD', assetId: 1, available: 10000, locked: 0, total: 10000 },
      { asset: 'BTC', assetId: 2, available: 2, locked: 0, total: 2 },
    ],
    refresh: vi.fn(async () => {}),
  }),
}));

import { OrderForm } from './OrderForm';
import { MARKETS } from '../../types/market';

const noop = async () => ({ success: true, message: '' });

function renderForm(over: Partial<React.ComponentProps<typeof OrderForm>> = {}) {
  return render(
    <OrderForm
      market={MARKETS[0]} // BTC-USD
      onSubmitOrder={noop}
      loading={false}
      lastPrice={100000}
      signedIn
      onRequestSignIn={() => {}}
      {...over}
    />
  );
}

/** LIMIT is the default type: number inputs are [price, amount]. */
function getInputs(container: HTMLElement) {
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
  return { price: inputs[0], amount: inputs[1] };
}

describe('OrderForm % sizing', () => {
  beforeEach(() => {
    cleanup();
  });

  it('buy sizes pct% of the quote balance at the last trade price when the price field is empty', () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    // 50% × 10,000 USD / 100,000 = 0.05 BTC
    expect(getInputs(container).amount.value).toBe('0.05000000');
  });

  it('buy prefers the typed form price over the last trade price', () => {
    const { container } = renderForm();
    const { price, amount } = getInputs(container);
    fireEvent.change(price, { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: '25%' }));
    // 25% × 10,000 USD / 50,000 = 0.05 BTC
    expect(amount.value).toBe('0.05000000');
  });

  it('sell sizes pct% of the base balance (no price involved)', () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    // 50% × 2 BTC = 1 BTC
    expect(getInputs(container).amount.value).toBe('1.00000000');
  });

  it('clicking the Avbl line fills 100%', () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: /avbl/i }));
    // 100% × 10,000 USD / 100,000 = 0.1 BTC
    expect(getInputs(container).amount.value).toBe('0.10000000');
    expect(screen.getByRole('button', { name: /avbl/i }).textContent).toContain('USD');
  });

  it('floors at 0 when there is no balance for the market', () => {
    // ETH-USD: neither ETH nor... ETH missing from the mocked assets
    const { container } = renderForm({ market: MARKETS[1], lastPrice: 2000 });
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    fireEvent.click(screen.getByRole('button', { name: '75%' }));
    expect(getInputs(container).amount.value).toBe('0.00000000');
  });

  it('floors at 0 on buy when no price is available at all', () => {
    const { container } = renderForm({ lastPrice: null });
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(getInputs(container).amount.value).toBe('0.00000000');
  });
});
