// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * ConfirmModal: the one confirm dialog for all admin actions. Pins the
 * tri-tone soft treatment (danger/warning/primary — never a solid fill),
 * busy locking both buttons + Escape, and backdrop/Escape cancel.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmModal, type ConfirmTone } from './ConfirmModal';

afterEach(cleanup);

const renderModal = (props: Partial<Parameters<typeof ConfirmModal>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmModal
      title="Stop Node 0?"
      body="This will stop the node."
      tone="danger"
      confirmLabel="Stop Node"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel };
};

describe('ConfirmModal', () => {
  it.each<[ConfirmTone, string]>([
    ['danger', 'text-sell'],
    ['warning', 'text-warn'],
    ['primary', 'text-buy'],
  ])('renders the %s tone as a soft tint, not a solid fill', (tone, textClass) => {
    renderModal({ tone });
    const btn = screen.getByRole('button', { name: 'Stop Node' });
    expect(btn.className).toContain(textClass);
    expect(btn.className).toContain('-soft');
    expect(btn.className).not.toContain('text-white');
  });

  it('confirms and cancels', () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Node' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape and on backdrop click', () => {
    const { onCancel } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Backdrop is the fixed overlay; clicking the dialog itself must NOT cancel
    fireEvent.click(screen.getByText('This will stop the node.'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Stop Node 0?').closest('.fixed')!);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('busy disables both buttons and blocks Escape', () => {
    const { onConfirm, onCancel } = renderModal({ busy: true });
    const confirm = screen.getByRole('button', { name: 'Working…' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
