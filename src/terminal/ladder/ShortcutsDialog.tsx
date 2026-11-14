// SPDX-License-Identifier: Apache-2.0
/**
 * The shortcut sheet (?): every ladder key, grouped as in the design, drawn
 * from the same table the keys are read from (keymap.ts). A Dialog, so focus
 * moves in, Esc closes it and focus returns to where it was.
 */
import { Dialog, Kbd } from '../../ui';
import { SHORTCUT_GROUPS } from './keymap';

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Trade from the keyboard"
      description="Press ? anywhere to open this. L focuses the ladder; the other keys work while it has focus."
      widthClass="max-w-[760px]"
    >
      <div className="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map(group => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{group.title}</h3>
            <dl className="m-0 flex flex-col">
              {group.rows.map(row => (
                <div key={row.what} className="flex min-h-[30px] items-center justify-between gap-3 border-b border-hairline py-1 last:border-b-0">
                  <dt className="text-[13px] text-text">{row.what}</dt>
                  <dd className="m-0 flex flex-none items-center gap-1">
                    {row.keys.map(k => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="m-0 border-t border-hairline px-5 py-3 text-[12px] text-muted">
        Safety: with one-click off, B and S only stage; Enter places. Market orders and Cancel all always ask for a
        second Enter, even with one-click on. Esc clears the stage and disarms one-click.
      </p>
    </Dialog>
  );
}
