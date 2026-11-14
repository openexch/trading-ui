// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Popover } from './Popover';

function Harness({ onOuterKey = () => {} }: { onOuterKey?: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div onKeyDown={(e) => onOuterKey(e.key)}>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}>Stop limit</button>
      <button>Outside</button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="Stop limit order" ignoreRefs={[anchor]}>
        <label>Stop price<input /></label>
        <label>Limit price<input /></label>
        <button>Stage</button>
      </Popover>
    </div>
  );
}

const active = () => document.activeElement as HTMLElement;
const opener = () => screen.getByRole('button', { name: 'Stop limit' });

function openIt() {
  opener().focus();
  fireEvent.click(opener());
}

describe('Popover', () => {
  afterEach(cleanup);

  it('is a named dialog and takes focus on open', () => {
    render(<Harness />);
    openIt();
    const pop = screen.getByRole('dialog', { name: 'Stop limit order' });
    expect(pop.contains(active())).toBe(true);
    expect(active()).toBe(screen.getByLabelText('Stop price'));
  });

  it('traps Tab and Shift+Tab inside', () => {
    render(<Harness />);
    openIt();
    const stop = screen.getByLabelText('Stop price');
    const limit = screen.getByLabelText('Limit price');
    const stage = screen.getByRole('button', { name: 'Stage' });

    fireEvent.keyDown(active(), { key: 'Tab' });
    expect(active()).toBe(limit);
    fireEvent.keyDown(active(), { key: 'Tab' });
    expect(active()).toBe(stage);
    fireEvent.keyDown(active(), { key: 'Tab' });
    expect(active()).toBe(stop);
    fireEvent.keyDown(active(), { key: 'Tab', shiftKey: true });
    expect(active()).toBe(stage);
  });

  it('closes on Esc and returns focus to the opener', () => {
    render(<Harness />);
    openIt();
    fireEvent.keyDown(active(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(active()).toBe(opener());
  });

  it('keeps typing inside: no key reaches the page behind it', () => {
    const onOuterKey = vi.fn();
    render(<Harness onOuterKey={onOuterKey} />);
    openIt();
    fireEvent.keyDown(active(), { key: 'b' });
    fireEvent.keyDown(active(), { key: 'Enter' });
    expect(onOuterKey).not.toHaveBeenCalled();
  });

  it('closes on a pointer-down outside but not on its own anchor', () => {
    render(<Harness />);
    openIt();
    fireEvent.pointerDown(screen.getByLabelText('Limit price'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focuses the requested field first', () => {
    function WithInitial() {
      const a = useRef<HTMLButtonElement>(null);
      const f = useRef<HTMLInputElement>(null);
      return (
        <>
          <button ref={a}>x</button>
          <Popover open onClose={() => {}} anchor={a} label="Trailing stop" initialFocusRef={f}>
            <input aria-label="Amount" />
            <input aria-label="Trail" ref={f} />
          </Popover>
        </>
      );
    }
    render(<WithInitial />);
    expect(active()).toBe(screen.getByLabelText('Trail'));
  });
});
