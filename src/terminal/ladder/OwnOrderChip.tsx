// SPDX-License-Identifier: Apache-2.0
/**
 * The Mine chip: filled / original of the own orders on one side of a rung.
 *
 * With actions it is a button (out of the tab order: the grid is one tab
 * stop) that opens a menu listing every own order in that rung, oldest
 * first, each with Cancel and, for limit orders only, "Move (re-queues)"
 * (DESIGN.md rule 13). Move opens a small price popover; it sends the new
 * price only. Each order's pending state comes from the caller, keyed by
 * omsOrderId, so two cancels in flight never share one flag.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject, WheelEvent } from 'react';
import type { Market, UserOrder } from '../../types/market';
import type { LadderSide, OwnAggregate } from './ladderModel';
import { Menu, MenuGroup, MenuItem, MenuSeparator, Popover, useMenuTrigger } from '../../ui';
import { snapPriceText } from '../../trading/orderDraft';
import { canMove, MOVE_LABEL } from '../../trading/orderActions';
import { formatPriceText, typeLabel } from '../../trading/staging';
import { priceRangeLabel } from '../../utils/ticks';
import { formatCompactSize } from './format';

export type PendingKind = 'cancel' | 'move';

export interface OwnOrderActions {
  market: Market;
  /** Orders with a request in flight, by omsOrderId. */
  pending: ReadonlyMap<string, PendingKind>;
  onCancel: (order: UserOrder) => void;
  /** Move to a new price (price only). The result is shown by the caller. */
  onMove: (order: UserOrder, price: number) => void;
  /** A menu or popover of this chip opened (true) or closed (false); the
   *  ladder stays pinned while any is open (DESIGN.md rule 8). */
  onOverlay: (open: boolean) => void;
}

export interface OwnOrderChipProps {
  side: LadderSide;
  own: OwnAggregate;
  priceText: string;
  sizeDecimals: number;
  baseAsset: string;
  /** Without actions the chip is a static label. */
  actions?: OwnOrderActions;
}

function sideWord(side: LadderSide): string {
  return side === 'BID' ? 'buy' : 'sell';
}

function ownSummary(own: OwnAggregate, sizeDecimals: number): string {
  const f = formatCompactSize(own.filled, sizeDecimals);
  const o = formatCompactSize(own.original, sizeDecimals);
  return own.filled > 0 ? `${f}/${o}` : o;
}

const blurOnWheel = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

export function OwnOrderChip({ side, own, priceText, sizeDecimals, baseAsset, actions }: OwnOrderChipProps) {
  const n = own.orders.length;
  const anyMove = own.orders.some(canMove);
  const summary =
    `Your ${sideWord(side)} order${n > 1 ? `s (${n})` : ''} at ${priceText}: ` +
    `${formatCompactSize(own.filled, sizeDecimals)} of ${formatCompactSize(own.original, sizeDecimals)} ${baseAsset} filled`;
  const cls =
    side === 'BID'
      ? 'border-l-[3px] border-buy bg-buy-soft'
      : 'border-r-[3px] border-sell bg-sell-soft';
  const chipCls = `relative z-[1] inline-flex h-[18px] items-center whitespace-nowrap rounded px-[5px] text-[11px] font-semibold leading-none text-text-strong ${cls}`;

  if (!actions) {
    return (
      <span role="img" aria-label={summary} title={summary} className={chipCls}>
        {ownSummary(own, sizeDecimals)}
      </span>
    );
  }
  return (
    <ActiveChip
      side={side}
      own={own}
      priceText={priceText}
      sizeDecimals={sizeDecimals}
      baseAsset={baseAsset}
      actions={actions}
      label={`${summary}. ${anyMove ? 'Cancel or move' : 'Cancel'}`}
      chipCls={chipCls}
    />
  );
}

function ActiveChip({ side, own, priceText, sizeDecimals, baseAsset, actions, label, chipCls }: Required<OwnOrderChipProps> & {
  label: string;
  chipCls: string;
}) {
  const menu = useMenuTrigger();
  const [moving, setMoving] = useState<UserOrder | null>(null);
  // Only the order's id is kept: the live order (and its price) comes from
  // the rung on every render, so a fill or an update is never shown stale.
  const movingLive = moving ? own.orders.find(o => o.omsOrderId === moving.omsOrderId) ?? null : null;

  const overlayOpen = menu.open || movingLive !== null;
  const onOverlay = useRef(actions.onOverlay);
  onOverlay.current = actions.onOverlay;
  useEffect(() => {
    if (!overlayOpen) return;
    onOverlay.current(true);
    return () => onOverlay.current(false);
  }, [overlayOpen]);

  const verb = side === 'BID' ? 'Buy' : 'Sell';

  return (
    <>
      <button type="button" {...menu.triggerProps} tabIndex={-1} aria-label={label} title={label} className={`${chipCls} cursor-pointer hover:outline hover:outline-1 hover:outline-offset-[-1px] hover:outline-ctl`}>
        {ownSummary(own, sizeDecimals)}
      </button>
      <Menu {...menu.menuProps} label={`Your orders at ${priceText}`} placement={side === 'BID' ? 'bottom-start' : 'bottom-end'}>
        {own.orders.map((o, i) => {
          const pending = o.omsOrderId ? actions.pending.get(o.omsOrderId) : undefined;
          const managed = o.omsOrderId !== '';
          const filled = o.filledQuantity > 0 ? ` · ${formatCompactSize(o.filledQuantity, sizeDecimals)} filled` : '';
          const head = `${verb} ${formatCompactSize(o.originalQuantity, sizeDecimals)} ${baseAsset} · ${typeLabel(o.type)}${filled}`;
          return (
            <div key={o.omsOrderId || `${o.orderId}-${i}`} className="flex flex-col">
              {i > 0 && <MenuSeparator />}
              <MenuGroup label={head}>
                <MenuItem
                  keepOpen
                  tone="sell"
                  disabled={!managed || pending !== undefined}
                  onSelect={() => actions.onCancel(o)}
                  hint={pending === 'cancel' ? 'Cancelling…' : !managed ? 'not cancellable yet' : undefined}
                >
                  Cancel
                </MenuItem>
                {canMove(o) && (
                  <MenuItem
                    disabled={!managed || pending !== undefined}
                    onSelect={() => setMoving(o)}
                    hint={pending === 'move' ? 'Moving…' : undefined}
                  >
                    {MOVE_LABEL}…
                  </MenuItem>
                )}
              </MenuGroup>
            </div>
          );
        })}
      </Menu>
      {movingLive && (
        <MovePopover
          market={actions.market}
          order={movingLive}
          anchor={menu.triggerProps.ref}
          sizeDecimals={sizeDecimals}
          baseAsset={baseAsset}
          priceText={priceText}
          onClose={() => setMoving(null)}
          onMove={price => {
            setMoving(null);
            actions.onMove(movingLive, price);
          }}
        />
      )}
    </>
  );
}

function MovePopover({ market, order, anchor, sizeDecimals, baseAsset, priceText, onClose, onMove }: {
  market: Market;
  order: UserOrder;
  anchor: RefObject<HTMLButtonElement | null>;
  sizeDecimals: number;
  baseAsset: string;
  priceText: string;
  onClose: () => void;
  onMove: (price: number) => void;
}) {
  const [text, setText] = useState(String(order.price));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const verb = order.side === 'BID' ? 'buy' : 'sell';
  const remaining = formatCompactSize(order.remainingQuantity, sizeDecimals);

  const snap = (): number | null => {
    const s = snapPriceText(market, text);
    if (s === null) {
      setError(`Price must be within ${priceRangeLabel(market)}`);
      return null;
    }
    setText(s);
    setError(null);
    return Number(s);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = snap();
    if (p === null) return;
    if (Math.abs(p - order.price) < market.tickSize / 2) {
      setError('Already at this price');
      return;
    }
    onMove(p);
  };

  return (
    <Popover open onClose={onClose} anchor={anchor} label={`Move ${verb} order at ${priceText}`} initialFocusRef={inputRef} className="w-[280px]">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-display text-[16px] font-bold ${order.side === 'BID' ? 'text-buy' : 'text-sell'}`}>
            Move {verb} {remaining} {baseAsset}
          </span>
          <span className="text-[12px] text-muted">now {formatPriceText(market, order.price)}</span>
        </div>
        <label className="flex flex-col gap-1.5 text-[12px] text-muted">
          New price
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => {
              if (text.trim() !== '') snap();
            }}
            onWheel={blurOnWheel}
            aria-invalid={error ? true : undefined}
            className="h-[34px] rounded-lg border border-ctl bg-surface-2 px-2.5 text-right text-[14px] text-text-strong [appearance:textfield] focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        {error && <span role="alert" className="text-[12px] text-warn">{error}</span>}
        <p className="m-0 text-[12px] text-muted">Moving re-queues the order: it goes to the back of the queue at the new price.</p>
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <button type="submit" className={`h-9 rounded-lg border-0 text-[13px] font-semibold ${order.side === 'BID' ? 'bg-buy' : 'bg-sell'} text-bg`}>
            Move
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-ctl bg-transparent text-[13px] text-text hover:bg-chip">
            Cancel
          </button>
        </div>
      </form>
    </Popover>
  );
}
