// SPDX-License-Identifier: Apache-2.0
/**
 * The order defaults bar above the staging strip: what a click on the ladder
 * stages. Size presets for the market, the size field, the Price field (what
 * Buy limit / Sell limit place at; a rung click writes its price there; Up
 * and Down step it one tick), one Type · TIF picker
 * and, at the far right, the one-click switch. One-click is off by default
 * and never persisted; it can be armed only while signed in and connected,
 * and armed it takes both side colours (DESIGN.md rule 10).
 */
import type { FormEvent, KeyboardEvent, WheelEvent } from 'react';
import type { Market, OrderType, TimeInForce } from '../../types/market';
import { marketUi } from '../../trading/marketUi';
import { TIF_CHOICES, TYPE_CHOICES, parseSize, tifChoice, typeLabel } from '../../trading/staging';
import type { OrderDefaults as Defaults } from '../../trading/staging';
import { Menu, MenuGroup, MenuItemRadio, MenuSeparator, Switch, useMenuTrigger } from '../../ui';
import { formatCompactSize } from './format';
import { LADDER_FRAME } from '../layoutColumns';

export interface OrderDefaultsProps {
  market: Market;
  value: Defaults;
  onSize: (size: string) => void;
  onType: (type: OrderType) => void;
  onTif: (tif: TimeInForce) => void;
  /** One-click state. Without it the switch shows off and disabled. */
  oneClick?: { armed: boolean; available: boolean; onChange: (armed: boolean) => void };
  /** Opens the shortcut sheet; without it there is no button. */
  onShowShortcuts?: () => void;
  /** The Price field (quote currency). Without it there is no field. */
  price?: {
    text: string;
    /** Why the text is not a placeable price, or null (valid or empty). */
    problem: string | null;
    onChange: (text: string) => void;
    /** Up / Down arrow: one tick up (1) or down (-1). */
    onStep: (dir: 1 | -1) => void;
  };
}

// Scrolling over a focused number field must never change an order size.
const blurOnWheel = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

export function OrderDefaults({ market, value, onSize, onType, onTif, oneClick, onShowShortcuts, price }: OrderDefaultsProps) {
  const ui = marketUi(market);
  const menu = useMenuTrigger();
  const size = parseSize(value.size);
  const tif = tifChoice(value.tif);
  const pickerText = `${typeLabel(value.type)} · ${tif.label}`;

  return (
    <form
      aria-label="Order defaults"
      onSubmit={(e: FormEvent) => e.preventDefault()}
      className={`flex h-12 flex-none items-center gap-2 overflow-hidden border-b border-hairline ${LADDER_FRAME}`}
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
      {price && (
        <label className="ml-1 flex flex-none items-center gap-1.5 text-[12px] text-muted">
          Price
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={price.text}
            onChange={e => price.onChange(e.target.value)}
            onWheel={blurOnWheel}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              price.onStep(e.key === 'ArrowUp' ? 1 : -1);
            }}
            aria-label={`Price in ${market.quoteAsset}`}
            aria-invalid={price.problem !== null ? true : undefined}
            title={price.problem ?? `Price in ${market.quoteAsset} for Buy limit / Sell limit: Up and Down step one tick`}
            className="h-[30px] w-[96px] rounded-md border border-ctl bg-surface-2 px-2 text-right text-[13px] text-text-strong focus:border-accent focus:outline-none"
          />
          {market.quoteAsset}
        </label>
      )}
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
      {onShowShortcuts && (
        <button
          type="button"
          onClick={onShowShortcuts}
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="?"
          title="Keyboard shortcuts (?)"
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-md border border-ctl text-[12px] text-muted hover:bg-chip hover:text-text"
        >
          ?
        </button>
      )}
      <span
        className="flex-none"
        title={
          oneClick && !oneClick.available
            ? 'Sign in and connect to arm one-click'
            : oneClick?.armed
              ? 'One-click on: a click places at once. Esc turns it off'
              : 'One-click: a click places at once instead of staging'
        }
      >
        <Switch
          checked={oneClick?.armed ?? false}
          onChange={on => oneClick?.onChange(on)}
          label="One-click"
          tone="split"
          disabled={!oneClick || (!oneClick.available && !oneClick.armed)}
        />
      </span>
    </form>
  );
}
