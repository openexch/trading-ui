// SPDX-License-Identifier: Apache-2.0
/**
 * Checkbox: a real <input type="checkbox"> at opacity 0 over a token-drawn box.
 *
 * The native input stays the focus target and the click target, so Space,
 * label clicks, form semantics and screen readers all behave as the platform
 * does. The mixed state is set through the input's `indeterminate` property
 * (never `aria-checked` on a native input); assistive technology reads it as
 * "mixed" from there. Clicking a mixed box checks it, as browsers do.
 */
import { useLayoutEffect, useRef } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void;
  /** Mixed state, for a select-all box over a partial selection. */
  indeterminate?: boolean;
  /** Visible label. Without it, pass `aria-label`. */
  label?: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  label,
  'aria-label': ariaLabel,
  disabled,
  id,
  name,
  className = '',
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  // A user click clears the native flag, so re-apply it from props on every
  // render rather than only when the prop changes.
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  });

  const on = checked || indeterminate;

  const control = (
    <span className="relative inline-grid h-7 w-7 flex-none place-items-center">
      <input
        ref={ref}
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => {
          if (disabled) return;
          onChange(e.target.checked, e);
          // Restore the flag the click just cleared; if the parent changes
          // the prop, the layout effect on the next render overrides this.
          e.target.indeterminate = indeterminate;
        }}
        className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        data-state={indeterminate ? 'mixed' : checked ? 'checked' : 'unchecked'}
        className={`pointer-events-none grid h-4 w-4 place-items-center rounded-[4px] border-[1.5px] motion-safe:transition-colors peer-hover:border-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-50 ${
          on
            ? 'border-accent bg-accent text-on-accent'
            : 'border-[color:var(--ctl,var(--muted))] bg-surface-2'
        }`}
      >
        {indeterminate ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : checked ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1.8 5.2l2.2 2.2 4.2-4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
    </span>
  );

  if (!label) return <span className={className}>{control}</span>;
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1 ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className}`}>
      {control}
      <span>{label}</span>
    </label>
  );
}
