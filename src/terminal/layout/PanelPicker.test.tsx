// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PanelPicker, whereLabel } from './PanelPicker';
import { useLayout } from './useLayout';
import type { LayoutApi } from './useLayout';
import type { SlotIndex } from './layoutReducer';
import { LAYOUT_KEY } from './persistence';
import { defaultLayout, presetLayout } from './presets';

let api: LayoutApi;

/** Four pickers over one layout, like the four slots. */
function Slots() {
  api = useLayout();
  return (
    <div>
      {([0, 1, 2, 3] as SlotIndex[]).map(slot => (
        <div key={slot} data-testid={`slot-${slot}`}>
          <PanelPicker
            slot={slot}
            layout={api.layout}
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
    expect(whereLabel(l, 1, 'trades')).toBe('Here');
    expect(whereLabel(l, 1, 'markets')).toBe('Left top');
    expect(whereLabel(l, 1, 'orders')).toBe('Right bottom');
    expect(whereLabel(l, 1, 'fills')).toBe('Hidden');
  });

  it('the title is the trigger; the icon variant keeps the accessible name', () => {
    render(<Slots />);
    expect(trigger(0).getAttribute('aria-label')).toBe('Panel: Markets. Change');
    expect(trigger(0).textContent).toContain('Markets');
    expect(trigger(3).getAttribute('aria-label')).toBe('Panel: Open orders. Change');
    expect(trigger(3).textContent).toBe('');
  });

  it('lists the panels as radio items with their place, then presets and reset', () => {
    render(<Slots />);
    fireEvent.click(trigger(1));
    const menu = screen.getByRole('menu', { name: 'Show in this panel' });
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map(r => r.textContent)).toEqual([
      'MarketsLeft top',
      'TradesHere',
      'ChartRight top',
      'Open ordersRight bottom',
      'FillsHidden',
      'BalancesHidden',
    ]);
    expect(radios.filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.textContent)).toEqual(['TradesHere']);
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Layout presets…', 'Reset layout']);
    expect(document.activeElement).toBe(radios[0]);
  });

  it('picking a panel open elsewhere swaps; a hidden one replaces', () => {
    render(<Slots />);
    fireEvent.click(trigger(1));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^chart/i }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(api.layout.slots).toEqual(['markets', 'chart', 'trades', 'orders']);
    expect(document.activeElement).toBe(trigger(1));

    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^balances/i }));
    expect(api.layout.slots).toEqual(['balances', 'chart', 'trades', 'orders']);
    // Remembered.
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).slots).toEqual(['balances', 'chart', 'trades', 'orders']);
  });

  it('Layout presets… opens the preset menu; a preset applies; Reset returns to Default', () => {
    render(<Slots />);
    fireEvent.click(trigger(0));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Layout presets…' }));
    const presets = screen.getByRole('menu', { name: 'Layout presets' });
    const items = within(presets).getAllByRole('menuitemradio');
    expect(items.map(i => i.textContent)).toEqual(['Default', 'Scalper', 'Chart-heavy']);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(items[1]);
    expect(api.layout).toEqual(presetLayout('scalper'));

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
      window.dispatchEvent(new StorageEvent('storage', { key: LAYOUT_KEY, newValue: JSON.stringify({ v: 1, ...next }) }));
    });
    expect(api.layout).toEqual(next);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LAYOUT_KEY, newValue: '{"v":1,"slots":["x"]}' }));
    });
    expect(api.layout).toEqual(next);
  });
});
