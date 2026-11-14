// SPDX-License-Identifier: Apache-2.0
/**
 * The order popover for the types that need a second value: stop limit,
 * trailing stop and iceberg. Opened from the rung menu, or by a rung click
 * while the defaults bar is on one of these types.
 *
 * The rung prefills the first price (the trigger for a stop limit). Prices
 * snap to the engine tick through orderDraft, on blur and again on Stage;
 * out of range is an inline error (DESIGN.md rule 6). Time in force offers
 * no GTD: the API has no expiry field (rule 14). Stage pushes the order
 * into the staging strip; Enter there places it.
 */
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode, WheelEvent } from 'react';
import type { Market, OrderSide, TimeInForce } from '../../types/market';
import { Popover } from '../../ui';
import type { Anchor } from '../../ui';
import { snapDeltaText, snapPriceText } from '../../trading/orderDraft';
import { TIF_CHOICES, buildStaged, parseSize } from '../../trading/staging';
import type { Staged } from '../../trading/staging';
import { priceRangeLabel, tickDecimals } from '../../utils/ticks';
import type { TicketKind } from './RungMenu';

export interface OrderPopoverProps {
  market: Market;
  kind: TicketKind;
  side: OrderSide;
  /** The rung's price. */
  price: number;
  /** The defaults bar's size and TIF, as the starting values. */
  size: string;
  tif: TimeInForce;
  anchor: Anchor;
  onStage: (staged: Staged) => void;
  onClose: () => void;
  /** 44px fields and buttons for touch (the phone). */
  touch?: boolean;
}

const TITLE: Record<TicketKind, string> = {
  STOP_LIMIT: 'stop limit',
  TRAILING_STOP: 'trailing stop',
  ICEBERG: 'iceberg',
};

const STAGE_TEXT: Record<TicketKind, string> = {
  STOP_LIMIT: 'stop',
  TRAILING_STOP: 'trailing stop',
  ICEBERG: 'iceberg',
};

const blurOnWheel = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

const INPUT =
  'h-[34px] w-full rounded-lg border border-ctl bg-surface-2 px-2.5 text-right text-[14px] text-text-strong [appearance:textfield] focus:border-accent focus:outline-none aria-[invalid=true]:border-warn [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-muted">{label}{children}</label>;
}

export function OrderPopover({ market, kind, side, price, size: initialSize, tif: initialTif, anchor, onStage, onClose, touch = false }: OrderPopoverProps) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [first, setFirst] = useState(String(price));
  const [second, setSecond] = useState(kind === 'STOP_LIMIT' ? String(price) : '');
  const [size, setSize] = useState(initialSize);
  const [tif, setTif] = useState<TimeInForce>(initialTif);
  const [error, setError] = useState<string | null>(null);

  const buy = side === 'BID';
  const verb = buy ? 'Buy' : 'Sell';
  const tick = market.tickSize.toFixed(tickDecimals(market.tickSize));

  const firstLabel =
    kind === 'STOP_LIMIT' ? `Stop price (triggers at or ${buy ? 'above' : 'below'})` : `Price ${market.quoteAsset}`;
  const secondLabel =
    kind === 'STOP_LIMIT'
      ? 'Limit price'
      : kind === 'TRAILING_STOP'
        ? `Trail by ${market.quoteAsset}`
        : `Show ${market.baseAsset}`;

  const range = `Price must be within ${priceRangeLabel(market)}`;

  /** Snap both values; returns the snapped texts or an error. */
  const snapped = (): { first: string; second: string } | { error: string } => {
    const f = snapPriceText(market, first);
    if (f === null) return { error: range };
    let s: string | null;
    if (kind === 'STOP_LIMIT') {
      s = snapPriceText(market, second);
      if (s === null) return { error: second.trim() === '' ? 'Enter limit price' : `Limit price must be within ${priceRangeLabel(market)}` };
    } else if (kind === 'TRAILING_STOP') {
      s = snapDeltaText(market, second);
      if (s === null) return { error: 'Enter trail by' };
    } else {
      s = parseSize(second) !== null ? second.trim() : null;
      if (s === null) return { error: 'Enter show' };
    }
    return { first: f, second: s };
  };

  const snapField = (text: string, set: (v: string) => void, delta = false) => {
    if (text.trim() === '') return;
    const s = delta ? snapDeltaText(market, text) : snapPriceText(market, text);
    if (s !== null) set(s);
  };

  const stage = (e: FormEvent) => {
    e.preventDefault();
    const r = snapped();
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setFirst(r.first);
    setSecond(r.second);
    const staged: Staged = {
      marketId: market.id,
      side,
      price: Number(r.first),
      ticket: { type: kind, tif, size: size.trim(), extra: r.second },
    };
    const built = buildStaged(market, staged, { size, type: kind, tif }, '', 0);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    onStage(staged);
  };

  return (
    <Popover
      open
      onClose={onClose}
      anchor={anchor}
      labelledBy={titleId}
      initialFocusRef={firstRef}
      className={touch ? 'w-[320px] [&_button]:min-h-11 [&_input]:h-11 [&_select]:h-11' : 'w-[300px]'}
    >
      <form aria-labelledby={titleId} onSubmit={stage} noValidate className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <span id={titleId} className={`font-display text-[18px] font-bold ${buy ? 'text-buy' : 'text-sell'}`}>
            {verb} {TITLE[kind]}
          </span>
          <span className="text-[12px] text-muted">
            {market.symbol} · tick {tick}
          </span>
        </div>
        <Field label={firstLabel}>
          <input
            ref={firstRef}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={first}
            onChange={e => setFirst(e.target.value)}
            onBlur={() => snapField(first, setFirst)}
            onWheel={blurOnWheel}
            className={INPUT}
          />
        </Field>
        <Field label={secondLabel}>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={second}
            onChange={e => setSecond(e.target.value)}
            onBlur={() => {
              if (kind === 'STOP_LIMIT') snapField(second, setSecond);
              else if (kind === 'TRAILING_STOP') snapField(second, setSecond, true);
            }}
            onWheel={blurOnWheel}
            className={INPUT}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={`Amount ${market.baseAsset}`}>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={size}
              onChange={e => setSize(e.target.value)}
              onWheel={blurOnWheel}
              className={INPUT}
            />
          </Field>
          <Field label="Time in force">
            <select
              value={tif}
              onChange={e => setTif(e.target.value as TimeInForce)}
              className="h-[34px] w-full rounded-lg border border-ctl bg-surface-2 px-2 text-[13px] text-text-strong focus:border-accent focus:outline-none"
            >
              {TIF_CHOICES.map(c => (
                <option key={c.tif} value={c.tif}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error && (
          <span role="alert" className="text-[12px] text-warn">
            {error}
          </span>
        )}
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <button
            type="submit"
            className={`h-10 rounded-[9px] border-0 text-[13px] font-semibold text-bg ${buy ? 'bg-buy' : 'bg-sell'}`}
          >
            Stage {verb.toLowerCase()} {STAGE_TEXT[kind]}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-[9px] border border-ctl bg-transparent text-[13px] text-text hover:bg-chip"
          >
            Cancel
          </button>
        </div>
        <p className="m-0 text-[12px] text-muted">
          Prices snap to the engine tick. Staged orders appear in the strip above the ladder; Enter places.
        </p>
      </form>
    </Popover>
  );
}
