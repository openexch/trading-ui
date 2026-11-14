// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Switch } from './Switch';
import { Kbd } from './Kbd';

function Harness() {
  const [on, setOn] = useState(false);
  return <Switch label="One-click" checked={on} onChange={setOn} tone="buy" />;
}

describe('Switch', () => {
  afterEach(cleanup);

  it('is a named switch that toggles aria-checked', () => {
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'One-click' });
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('takes an aria-label when there is no visible label', () => {
    render(<Switch aria-label="Compact rows" checked onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Compact rows' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('Kbd', () => {
  afterEach(cleanup);

  it('renders a kbd element', () => {
    const { container } = render(<Kbd>Enter</Kbd>);
    expect(container.querySelector('kbd')?.textContent).toBe('Enter');
  });
});
