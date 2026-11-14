// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';

/** A key cap, as drawn in the shortcuts sheet and the menu hints. */
export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-block min-w-[18px] rounded-[5px] border border-b-2 border-[color:var(--ctl,var(--hairline-strong))] bg-surface-2 px-[7px] py-px text-center font-sans text-[12px] leading-[18px] text-text-strong ${className}`}
    >
      {children}
    </kbd>
  );
}
