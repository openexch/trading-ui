// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PanelPicker, whereLabel } from './PanelPicker';
import { useLayout } from './useLayout';
import type { LayoutApi } from './useLayout';
import type { LayoutMode, SlotIndex } from './layoutReducer';
import { LAYOUT_KEY } from './persistence';
import { defaultLayout, presetLayout } from './presets';

let api: LayoutApi;

/** Four pickers over one layout, like the four standard slots (six in
 *  wide mode). */
function Slots({ mode }: { mode?: LayoutMode }) {
  api = useLayout();
  const m = mode ?? api.mode;
  const slots = (m === 'wide' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3]) as SlotIndex[];
  return (
    <div>
      {slots.map(slot => (
        <div key={slot} data-testid={`slot-${slot}`}>
          <PanelPicker
            slot={slot}
            layout={api.layout}
            mode={m}
            onPick={api.pick}
            onPreset={api.applyPreset}
            onReset={api.reset}
            variant={slot === 3 ? 'icon' : 'title'}
          />
        </div>
      ))}
    </div>
  );
}

const trigger = (slot: SlotIndex) => within(screen.getByTestId(`slot-${slot}`)).getByRole('button');

describe('PanelPicker', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('says where every panel lives', () => {
    const l = defaultLayout();
    expect(whereLabel(l, 1, 'markets', 'standard')).toBe('Here');
    expect(whereLabel(l, 1, 'engines', 'standard')).toBe('Left top');
    expect(whereLabel(l, 1, 'trades', 'standard')).toBe('Right top');
    expect(whereLabel(l, 1, 'orders', 'standard')).toBe('Right bottom');
    expect(whereLabel(l, 1, 'chart', 'standard')).toBe('Hidden');
    expect(whereLabel(l, 1, 'fills', 'standard')).toBe('Hidden');
    expect(whereLabel(l, 1, 'balances', 'standard')).toBe('Closed');
    expect(whereLabel(l, 1, 'chart', 'wide')).toBe('Far right top');
    expect(whereLabel(l, 1, 'fills', 'wide')).toBe('Far right bottom');
    expect(whereLabel(l, 5, 'fills', 'wide')).toBe('Here');
  });

  it('the title is the trigger; the icon variant keeps the accessible name', () => {
    render(<Slots />);
    expect(trigger(0).getAttribute('aria-label')).toBe('Panel: Engines. Change');
    expect(trigger(0).textContent).toContain('Engines');
    expect(trigger(3).getAttribute('aria-label')).toBe('Panel: Open orders. Change');
    expect(trigger(3).textContent).toBe('');
  });

  it('lists the panels as radio items with their place, then presets and reset', () => {
    render(<Slots />);
    fireEvent.click(trigger(1));
    const menu = screen.getByRole('menu', { name: 'Show in this panel' });
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map(r => r.textContent)).toEqual([
      'MarketsHere',
      'TradesRight top',
      'ChartHidden',
      'Open ordersRight bottom',
      'FillsHidden',
      'BalancesClosed',
      'EnginesLeft top',
    ]);
    expect(radios.filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.textContent)).toEqual(['MarketsHere']);
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Layout presets…', 'Reset layout']);
    expect(document.activeElement).toBe(radios[0]);
  });

  it('picking a panel open elsewhere swaps; a hidden one swaps into the hidden place; a closed one replaces', () => {
    render(<Slots />);
    fireEvent.click(trigger(1));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^trades/i }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(api.layout.slots).toEqual(['engines', 'trades', 'markets', 'orders', 'chart', 'fills']);
    expect(document.activeElement).toBe(trigger(1));

    fireEvent.click(trigger(1));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^chart/i }));
    // Chart was hidden: Trades takes its hidden place.
    expect(api.layout.slots).toEqual(['engines', 'chart', 'markets', 'orders', 'trades', 'fills']);

    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^balances/i }));
    // Balances was closed: it replaces Engines, which closes.
    expect(api.layout.slots).toEqual(['balances', 'chart', 'markets', 'orders', 'trades', 'fills']);
    // Remembered.
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).slots).toEqual([
      'balances',
      'chart',
      'markets',
      'orders',
      'trades',
      'fills',
    ]);
  });

  it('Layout presets… opens the preset menu; a preset applies; Reset returns to Default', () => {
    render(<Slots />);
    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout presets…' }));
    const presets = screen.getByRole('menu', { name: 'Layout presets' });
    const items = within(presets).getAllByRole('menuitemradio');
    expect(items.map(i => i.textContent)).toEqual(['Default', 'Chart', 'Scalper', 'Chart-heavy']);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(items[2]);
    expect(api.layout).toEqual(presetLayout('scalper'));

    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout presets…' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Layout presets' })).getAllByRole('menuitemradio')[1]);
    expect(api.layout).toEqual(presetLayout('chart'));

    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset layout' }));
    expect(api.layout).toEqual(defaultLayout());
  });

  it('ArrowDown on the trigger opens at the first item; Esc closes back to it', () => {
    render(<Slots />);
    fireEvent.keyDown(trigger(2), { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'Show in this panel' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger(2));
  });

  it('another tab writing a valid layout is followed; an invalid one is ignored', () => {
    render(<Slots />);
    const next = presetLayout('scalper');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LAYOUT_KEY, newValue: JSON.stringify({ v: 2, ...next }) }));
    });
    expect(api.layout).toEqual(next);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LAYOUT_KEY, newValue: '{"v":2,"slots":["x"]}' }));
    });
    expect(api.layout).toEqual(next);
  });

  it('wide mode: six pickers, the far-right slots are named, picks swap across all six', () => {
    render(<Slots mode="wide" />);
    fireEvent.click(trigger(1));
    const radios = within(screen.getByRole('menu', { name: 'Show in this panel' })).getAllByRole('menuitemradio');
    expect(radios.map(r => r.textContent)).toEqual([
      'MarketsHere',
      'TradesRight top',
      'ChartFar right top',
      'Open ordersRight bottom',
      'FillsFar right bottom',
      'BalancesClosed',
      'EnginesLeft top',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^fills/i }));
    expect(api.layout.slots).toEqual(['engines', 'fills', 'trades', 'orders', 'chart', 'markets']);
    expect(trigger(5).getAttribute('aria-label')).toBe('Panel: Markets. Change');
  });

  it('the preset menu marks a preset by what the mode shows', () => {
    // Default with the hidden pair swapped: standard still shows Default.
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ v: 2, ...defaultLayout(), slots: ['engines', 'markets', 'trades', 'orders', 'fills', 'chart'] }),
    );
    render(<Slots mode="standard" />);
    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout presets…' }));
    const items = within(screen.getByRole('menu', { name: 'Layout presets' })).getAllByRole('menuitemradio');
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    cleanup();
    render(<Slots mode="wide" />);
    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout presets…' }));
    const wide = within(screen.getByRole('menu', { name: 'Layout presets' })).getAllByRole('menuitemradio');
    expect(wide.map(i => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false']);
  });
});
