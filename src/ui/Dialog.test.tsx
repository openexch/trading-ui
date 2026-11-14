// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from './Dialog';

function Harness({ dismissOnBackdrop, onOuterKey = () => {} }: { dismissOnBackdrop?: boolean; onOuterKey?: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div onKeyDown={(e) => onOuterKey(e.key)}>
      <button onClick={() => setOpen(true)}>View all</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Open orders"
        description="12 orders"
        dismissOnBackdrop={dismissOnBackdrop}
      >
        <input aria-label="Search orders" />
        <button>Cancel selected</button>
      </Dialog>
    </div>
  );
}

const active = () => document.activeElement as HTMLElement;
const opener = () => screen.getByRole('button', { name: 'View all' });
function openIt() {
  opener().focus();
  fireEvent.click(opener());
}

describe('Dialog', () => {
  afterEach(cleanup);

  it('is a modal dialog named by its title and described', () => {
    render(<Harness />);
    openIt();
    const dlg = screen.getByRole('dialog', { name: 'Open orders' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)?.textContent).toBe('12 orders');
  });

  it('moves focus in and traps Tab', () => {
    render(<Harness />);
    openIt();
    const search = screen.getByLabelText('Search orders');
    const cancel = screen.getByRole('button', { name: 'Cancel selected' });
    const close = screen.getByRole('button', { name: 'Close' });
    // First focusable in DOM order is the header close button.
    expect(active()).toBe(close);
    fireEvent.keyDown(active(), { key: 'Tab' });
    expect(active()).toBe(search);
    fireEvent.keyDown(active(), { key: 'Tab' });
    expect(active()).toBe(cancel);
    fireEvent.keyDown(active(), { key: 'Tab' });
    expect(active()).toBe(close);
    fireEvent.keyDown(active(), { key: 'Tab', shiftKey: true });
    expect(active()).toBe(cancel);
  });

  it('makes the page behind it inert and restores it on close', () => {
    const { container } = render(<Harness />);
    const pageRoot = container; // the body child RTL rendered into
    openIt();
    expect(pageRoot.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(active(), { key: 'Escape' });
    expect(pageRoot.hasAttribute('inert')).toBe(false);
  });

  it('closes on Esc and returns focus to the opener', () => {
    render(<Harness />);
    openIt();
    fireEvent.keyDown(active(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(active()).toBe(opener());
  });

  it('closes from the close button', () => {
    render(<Harness />);
    openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a backdrop press unless told not to', () => {
    render(<Harness />);
    openIt();
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.pointerDown(screen.getByLabelText('Search orders'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();

    render(<Harness dismissOnBackdrop={false} />);
    openIt();
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does not let keys reach the page behind it', () => {
    const onOuterKey = vi.fn();
    render(<Harness onOuterKey={onOuterKey} />);
    openIt();
    fireEvent.keyDown(active(), { key: 's' });
    fireEvent.keyDown(active(), { key: 'Escape' });
    expect(onOuterKey).not.toHaveBeenCalled();
  });
});
