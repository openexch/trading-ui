// SPDX-License-Identifier: Apache-2.0
/**
 * Switch: an on/off button (role=switch, aria-checked). Space and Enter toggle
 * it because it is a real <button>.
 *
 * `tone` colours the "on" track: accent by default, or a trade side when the
 * switch arms something side-specific. `split` carries both side colours,
 * buy to sell, for something armed on both sides at once (one-click trading:
 * a bid click buys, an ask click sells).
 */
import { useId } from 'react';
import type { ReactNode } from 'react';

type Tone = 'accent' | 'buy' | 'sell' | 'split';

const ON_TRACK: Record<Tone, string> = {
  accent: 'border-accent bg-accent',
  buy: 'border-buy bg-buy',
  sell: 'border-sell bg-sell',
  split: 'border-transparent bg-[linear-gradient(90deg,var(--buy),var(--sell))]',
};

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label, placed before the switch. Without it, pass `aria-label`. */
  label?: ReactNode;
  'aria-label'?: string;
  tone?: Tone;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  'aria-label': ariaLabel,
  tone = 'accent',
  disabled,
  className = '',
}: SwitchProps) {
  const labelId = useId();
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {label && (
        <span id={labelId} className="text-[12px] text-muted">
          {label}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-10 flex-none cursor-pointer rounded-full border disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors ${
          checked ? ON_TRACK[tone] : 'border-[color:var(--ctl,var(--muted))] bg-[color:var(--chip,var(--surface-3))]'
        }`}
      >
        <span
          aria-hidden
          className={`absolute left-[3px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full motion-safe:transition-transform ${
            checked ? 'translate-x-[16px] bg-[color:var(--on-accent)]' : 'translate-x-0 bg-muted'
          }`}
        />
      </button>
    </span>
  );
}
