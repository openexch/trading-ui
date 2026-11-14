// SPDX-License-Identifier: Apache-2.0
/**
 * The order defaults bar above the staging strip: what a click on the ladder
 * stages. Size presets for the market, the size field, one Type · TIF picker
 * and, at the far right, the one-click switch (off; arming is not offered
 * here, so it is shown disabled).
 */
import type { FormEvent, WheelEvent } from 'react';
import type { Market, OrderType, TimeInForce } from '../../types/market';
import { marketUi } from '../../trading/marketUi';
import { TIF_CHOICES, TYPE_CHOICES, parseSize, tifChoice, typeLabel } from '../../trading/staging';
import type { OrderDefaults as Defaults } from '../../trading/staging';
import { Menu, MenuGroup, MenuItemRadio, MenuSeparator, Switch, useMenuTrigger } from '../../ui';
import { formatCompactSize } from './format';

export interface OrderDefaultsProps {
  market: Market;
  value: Defaults;
  onSize: (size: string) => void;
  onType: (type: OrderType) => void;
  onTif: (tif: TimeInForce) => void;
}

// Scrolling over a focused number field must never change an order size.
const blurOnWheel = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

export function OrderDefaults({ market, value, onSize, onType, onTif }: OrderDefaultsProps) {
  const ui = marketUi(market);
  const menu = useMenuTrigger();
  const size = parseSize(value.size);
  const tif = tifChoice(value.tif);
  const pickerText = `${typeLabel(value.type)} · ${tif.label}`;

  return (
    <form
      aria-label="Order defaults"
      onSubmit={(e: FormEvent) => e.preventDefault()}
      className="flex h-12 flex-none items-center gap-2 overflow-hidden border-b border-hairline px-5"
    >
      <span className="mr-0.5 text-[12px] text-muted">Size</span>
      {ui.sizePresets.map(p => {
        const on = size !== null && Math.abs(size - p) < 1e-12;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            aria-label={`Size ${formatCompactSize(p, ui.sizeDecimals)} ${market.baseAsset}`}
            onClick={() => onSize(String(p))}
            className={`h-[30px] flex-none rounded-md border px-2.5 text-[12px] ${
              on ? 'border-accent bg-mid text-text-strong' : 'border-ctl text-text hover:bg-chip'
            }`}
          >
            {formatCompactSize(p, ui.sizeDecimals)}
          </button>
        );
      })}
      <label className="flex flex-none items-center gap-1.5 text-[12px] text-muted">
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
          className="h-[30px] w-[84px] rounded-md border border-ctl bg-surface-2 px-2 text-right text-[13px] text-text-strong [appearance:textfield] focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {market.baseAsset}
      </label>
      <span aria-hidden className="mx-2 h-[22px] w-px flex-none bg-hairline" />
      <button
        type="button"
        {...menu.triggerProps}
        aria-label={`Order type and time in force: ${typeLabel(value.type)}, ${tif.long}`}
        className="flex h-[30px] flex-none items-center gap-2 rounded-md border border-ctl bg-surface-2 px-2.5 text-[12px] text-text-strong hover:bg-chip"
      >
        {pickerText}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <Menu {...menu.menuProps} label="Order type and time in force">
        <MenuGroup label="Order type">
          {TYPE_CHOICES.map(c => (
            <MenuItemRadio key={c.type} checked={value.type === c.type} onSelect={() => onType(c.type)}>
              {c.label}
            </MenuItemRadio>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup label="Time in force">
          {TIF_CHOICES.map(c => (
            <MenuItemRadio key={c.tif} checked={value.tif === c.tif} onSelect={() => onTif(c.tif)} hint={c.long}>
              {c.label}
            </MenuItemRadio>
          ))}
        </MenuGroup>
      </Menu>
      <div className="min-w-0 flex-1" />
      <Switch checked={false} onChange={() => {}} label="One-click" disabled className="flex-none" />
    </form>
  );
}
