// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Menu, MenuItem, MenuItemRadio, MenuSeparator, useMenuTrigger } from './Menu';

function Harness({ onSelect = () => {}, onOuterKey = () => {} }: { onSelect?: (v: string) => void; onOuterKey?: (k: string) => void }) {
  const m = useMenuTrigger();
  return (
    <div onKeyDown={(e) => onOuterKey(e.key)}>
      <button {...m.triggerProps}>Actions</button>
      <button>Elsewhere</button>
      <Menu {...m.menuProps} label="Order actions">
        <MenuItem onSelect={() => onSelect('buy')} tone="buy">Buy limit</MenuItem>
        <MenuItem onSelect={() => onSelect('stop')} disabled>Sell stop loss</MenuItem>
        <MenuItem onSelect={() => onSelect('trail')}>Trailing stop</MenuItem>
        <MenuSeparator />
        <MenuItemRadio checked onSelect={() => onSelect('cancel')}>Cancel</MenuItemRadio>
      </Menu>
    </div>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Actions' });
const active = () => document.activeElement as HTMLElement;
const key = (k: string, opts: object = {}) => fireEvent.keyDown(active(), { key: k, ...opts });

describe('Menu', () => {
  afterEach(cleanup);

  it('opens from the trigger with the first item focused and the trigger wired', () => {
    render(<Harness />);
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu', { name: 'Order actions' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(menu.id);
    expect(active().textContent).toBe('Buy limit');
  });

  it('moves with the arrow keys, skips disabled items and wraps', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    key('ArrowDown');
    expect(active().textContent).toBe('Trailing stop');
    key('ArrowDown');
    expect(active().textContent).toBe('Cancel');
    key('ArrowDown');
    expect(active().textContent).toBe('Buy limit');
    key('ArrowUp');
    expect(active().textContent).toBe('Cancel');
    key('Home');
    expect(active().textContent).toBe('Buy limit');
    key('End');
    expect(active().textContent).toBe('Cancel');
  });

  it('keeps exactly one item in the tab order (roving tabindex)', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    key('ArrowDown');
    const items = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const stops = items.filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(active());
  });

  it('jumps to the next item starting with a typed letter', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    key('c');
    expect(active().textContent).toBe('Cancel');
  });

  it('closes on Esc and returns focus to the trigger', () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.click(trigger());
    key('ArrowDown');
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(active()).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens at the last item from ArrowUp on the trigger', () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(active().textContent).toBe('Cancel');
  });

  it('runs the action, closes, and returns focus on select', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trailing stop' }));
    expect(onSelect).toHaveBeenCalledWith('trail');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(active()).toBe(trigger());
  });

  it('ignores a disabled item', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(trigger());
    const stop = screen.getByRole('menuitem', { name: 'Sell stop loss' });
    expect(stop.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(stop);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('does not let keys reach the page behind it', () => {
    const onOuterKey = vi.fn();
    render(<Harness onOuterKey={onOuterKey} />);
    fireEvent.click(trigger());
    key('ArrowDown');
    key('b');
    key('Escape');
    expect(onOuterKey).not.toHaveBeenCalled();
  });

  it('closes on a pointer-down outside, and the trigger toggles it shut', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger());
    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks the checked radio item', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitemradio', { name: 'Cancel' }).getAttribute('aria-checked')).toBe('true');
  });

  it('opens at a pointer position for a context menu', () => {
    const onClose = vi.fn();
    render(
      <Menu open onClose={onClose} anchor={{ x: 120, y: 80 }} label="Price 97,380">
        <MenuItem onSelect={() => {}}>Buy limit</MenuItem>
      </Menu>,
    );
    const menu = screen.getByRole('menu', { name: 'Price 97,380' });
    expect(menu.style.position).toBe('fixed');
    expect(active().textContent).toBe('Buy limit');
  });
});
