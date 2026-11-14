// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from './Checkbox';

/** Select-all over three rows: the usual home of the mixed state. */
function SelectAll() {
  const [rows, setRows] = useState([false, false, false]);
  const all = rows.every(Boolean);
  const some = rows.some(Boolean);
  return (
    <>
      <Checkbox
        aria-label="Select all"
        checked={all}
        indeterminate={some && !all}
        onChange={(c) => setRows(rows.map(() => c))}
      />
      {rows.map((r, i) => (
        <Checkbox
          key={i}
          label={`Row ${i + 1}`}
          checked={r}
          onChange={(c) => setRows(rows.map((v, j) => (j === i ? c : v)))}
        />
      ))}
    </>
  );
}

const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
const row = (n: number) => screen.getByRole('checkbox', { name: `Row ${n}` }) as HTMLInputElement;

describe('Checkbox', () => {
  afterEach(cleanup);

  it('is a native checkbox input, named by its label', () => {
    render(<SelectAll />);
    expect(selectAll().tagName).toBe('INPUT');
    expect(selectAll().type).toBe('checkbox');
    expect(row(1)).toBeTruthy();
  });

  it('sets the mixed state through the input property, not aria-checked', () => {
    render(<SelectAll />);
    expect(selectAll().indeterminate).toBe(false);
    fireEvent.click(row(2));
    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);
    expect(selectAll().hasAttribute('aria-checked')).toBe(false);
  });

  it('checks everything from the mixed state, then clears it', () => {
    render(<SelectAll />);
    fireEvent.click(row(2));
    fireEvent.click(selectAll());
    expect(selectAll().indeterminate).toBe(false);
    expect(selectAll().checked).toBe(true);
    expect([1, 2, 3].every((n) => row(n).checked)).toBe(true);
    fireEvent.click(selectAll());
    expect([1, 2, 3].some((n) => row(n).checked)).toBe(false);
  });

  it('re-applies the mixed state after a click the parent does not accept', () => {
    // A parent that ignores the change keeps the box mixed.
    render(<Checkbox aria-label="Locked" checked={false} indeterminate onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Locked' }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
  });

  it('is reachable and operable from the keyboard', () => {
    // The visible box is decoration; the focus target is the native input,
    // which browsers toggle on Space by dispatching a click.
    const onChange = vi.fn();
    render(<Checkbox aria-label="Show cancelled" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Show cancelled' }) as HTMLInputElement;
    expect(box.tabIndex).toBe(0);
    expect(box.disabled).toBe(false);
    box.focus();
    expect(document.activeElement).toBe(box);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('does not fire when disabled', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Off" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Off' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
