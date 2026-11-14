// SPDX-License-Identifier: Apache-2.0
/**
 * The phone's order settings row, under the header: one button that reads
 * what a tap on the ladder stages ("0.25 BTC · Limit · GTC") and opens the
 * settings sheet, and the price grouping select beside it.
 *
 * The sheet holds what the desktop defaults bar holds: the market's size
 * presets, the size field, the order type and the time in force (no GTD:
 * the API has no expiry field, DESIGN.md rule 14). There is no one-click
 * switch: on touch a tap always stages (rule 10). Every control is a 44px
 * target.
 */
import { useId, useRef, useState } from 'react';
import type { ReactNode, WheelEvent } from 'react';
import type { Market, OrderType, TimeInForce } from '../../types/market';
import { marketUi } from '../../trading/marketUi';
import type { GroupingOption } from '../../trading/marketUi';
import { TIF_CHOICES, TYPE_CHOICES, parseSize, tifChoice, typeLabel } from '../../trading/staging';
import type { OrderDefaults } from '../../trading/staging';
import { Dialog } from '../../ui';
import { formatCompactSize } from '../ladder/format';

export interface PhoneOrderBarProps {
  market: Market;
  value: OrderDefaults;
  onSize: (size: string) => void;
  onType: (type: OrderType) => void;
  onTif: (tif: TimeInForce) => void;
  grouping: { value: number; options: GroupingOption[]; onChange: (multiplier: number) => void };
}

// Scrolling over a focused number field must never change an order size.
const blurOnWheel = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="flex-none">
    <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** A choice drawn as a 44px chip over a real radio input. */
function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex h-11 cursor-pointer items-center justify-center rounded-[10px] border border-ctl px-2 text-[14px] text-text has-[:checked]:border-accent has-[:checked]:bg-mid has-[:checked]:font-semibold has-[:checked]:text-text-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

export function PhoneOrderBar({ market, value, onSize, onType, onTif, grouping }: PhoneOrderBarProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const ui = marketUi(market);
  const size = parseSize(value.size);
  const tif = tifChoice(value.tif);
  const sizeText = size !== null ? `${value.size.trim()} ${market.baseAsset}` : 'Set a size';
  const summary = `${sizeText} · ${typeLabel(value.type)} · ${tif.label}`;

  return (
    <div className="flex h-[52px] flex-none items-center gap-2 border-b border-hairline bg-surface px-3">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Order settings: ${size !== null ? `${value.size.trim()} ${market.baseAsset}` : 'no size set'}, ${typeLabel(value.type)}, ${tif.long}`}
        onClick={() => setOpen(true)}
        className={`flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border border-ctl bg-surface-2 px-3 text-[13px] ${
          size === null ? 'text-warn' : 'text-text-strong'
        }`}
      >
        <span className="truncate">{summary}</span>
        {CHEVRON}
      </button>
      <select
        aria-label="Price grouping"
        value={grouping.value}
        onChange={e => grouping.onChange(Number(e.target.value))}
        className="h-11 flex-none rounded-[10px] border border-ctl bg-surface-2 px-2 text-[13px] text-text-strong"
      >
        {grouping.options.map(o => (
          <option key={o.multiplier} value={o.multiplier}>
            {o.label}
          </option>
        ))}
      </select>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Order settings"
        description={`What a tap on the ${market.symbol} ladder stages`}
        returnFocusRef={triggerRef}
        sheet
      >
        <form
          aria-label="Order settings"
          onSubmit={e => {
            e.preventDefault();
            setOpen(false);
          }}
          className="flex flex-col gap-5 px-4 py-4"
        >
          <Section title={`Size · ${market.baseAsset}`}>
            {ui.sizePresets.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {ui.sizePresets.map(p => {
                  const on = size !== null && Math.abs(size - p) < 1e-12;
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      aria-label={`Size ${formatCompactSize(p, ui.sizeDecimals)} ${market.baseAsset}`}
                      onClick={() => onSize(String(p))}
                      className={`h-11 rounded-[10px] border text-[14px] ${
                        on ? 'border-accent bg-mid font-semibold text-text-strong' : 'border-ctl text-text'
                      }`}
                    >
                      {formatCompactSize(p, ui.sizeDecimals)}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={value.size}
                onChange={e => onSize(e.target.value)}
                onWheel={blurOnWheel}
                aria-label={`Order size in ${market.baseAsset}`}
                aria-invalid={value.size.trim() !== '' && size === null ? true : undefined}
                className="h-11 min-w-0 flex-1 rounded-[10px] border border-ctl bg-surface-2 px-3 text-right text-[16px] text-text-strong [appearance:textfield] focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {market.baseAsset}
            </label>
          </Section>

          <Section title="Order type">
            <div className="grid grid-cols-2 gap-2">
              {TYPE_CHOICES.map(c => (
                <Choice key={c.type} name={`${uid}-type`} checked={value.type === c.type} onChange={() => onType(c.type)}>
                  {c.label}
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Time in force">
            <div className="grid grid-cols-3 gap-2">
              {TIF_CHOICES.map(c => (
                <Choice key={c.tif} name={`${uid}-tif`} checked={value.tif === c.tif} onChange={() => onTif(c.tif)}>
                  <span title={c.long}>{c.label}</span>
                </Choice>
              ))}
            </div>
          </Section>

          <button type="submit" className="h-12 rounded-xl bg-accent text-[15px] font-semibold text-on-accent">
            Done
          </button>
        </form>
      </Dialog>
    </div>
  );
}
