// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * Toasts: overlay stack for admin action results. Pins auto-dismiss,
 * sticky-until-dismissed, the stack cap, and error toasts announcing as
 * alerts — the invariants that keep action feedback from ever shifting
 * layout or lingering silently.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast, type ToastInput } from './Toasts';

let push: (t: ToastInput) => void;

function Probe() {
  push = useToast();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Probe />
    </ToastProvider>
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toasts', () => {
  it('renders a toast and auto-dismisses it after ~4.5s', () => {
    act(() => push({ tone: 'success', text: 'Snapshot taken' }));
    expect(screen.getByText('Snapshot taken')).toBeTruthy();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Snapshot taken')).toBeNull();
  });

  it('keeps sticky toasts until dismissed by hand', () => {
    act(() => push({ tone: 'error', text: 'Failed to stop node', sticky: true }));
    act(() => vi.advanceTimersByTime(60_000));
    const toast = screen.getByText('Failed to stop node');
    expect(toast).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Failed to stop node')).toBeNull();
  });

  it('announces errors as alerts, the rest as status', () => {
    act(() => {
      push({ tone: 'error', text: 'boom', sticky: true });
      push({ tone: 'info', text: 'fyi' });
    });
    expect(screen.getByRole('alert').textContent).toContain('boom');
    expect(screen.getByRole('status').textContent).toContain('fyi');
  });

  it('caps the stack, dropping the oldest, newest rendered last', () => {
    act(() => {
      for (let i = 1; i <= 6; i++) push({ tone: 'info', text: `toast ${i}`, sticky: true });
    });
    expect(screen.queryByText('toast 1')).toBeNull();
    expect(screen.queryByText('toast 2')).toBeNull();
    const rendered = screen.getAllByRole('status').map(el => el.textContent);
    expect(rendered).toHaveLength(4);
    expect(rendered[0]).toContain('toast 3');
    expect(rendered[3]).toContain('toast 6');
  });
});
