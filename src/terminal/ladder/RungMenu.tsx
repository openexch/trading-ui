// SPDX-License-Identifier: Apache-2.0
/**
 * The rung menu (right-click or the Menu key on a rung cell): the order
 * types at that price. Sides follow where the rung sits against the last
 * trade: below it, Buy limit, Sell stop loss, Sell stop limit…, Sell
 * trailing stop…, Buy iceberg…; above it the sides flip. Items ending in
 * "…" open their order popover; the others stage at once. Nothing here
 * places an order: Enter in the staging strip does (DESIGN.md rule 10).
 * On the phone (`touch`) every item is a 44px target; the phone opens it by
 * long-press or the "More order types" button.
 */
import type { OrderSide } from '../../types/market';
import { Menu, MenuGroup, MenuItem } from '../../ui';
import type { Anchor } from '../../ui';
import type { RungMenuSides } from '../../trading/orderActions';

export type TicketKind = 'STOP_LIMIT' | 'TRAILING_STOP' | 'ICEBERG';

export interface RungMenuProps {
  anchor: Anchor;
  /** "97,380". */
  priceText: string;
  /** "0.25 BTC", or null when the size field holds no valid size. */
  sizeText: string | null;
  sides: RungMenuSides;
  /** A plain click on the limit side stages the same limit (the defaults
   *  bar is on Limit), so the item carries a "click" hint. */
  limitIsClick: boolean;
  onClose: () => void;
  onLimit: (side: OrderSide) => void;
  onStopLoss: (side: OrderSide) => void;
  onTicket: (kind: TicketKind, side: OrderSide) => void;
  /** 44px items for touch. */
  touch?: boolean;
}

const verb = (s: OrderSide) => (s === 'BID' ? 'Buy' : 'Sell');
const tone = (s: OrderSide) => (s === 'BID' ? 'buy' : 'sell');

export function RungMenu({ anchor, priceText, sizeText, sides, limitIsClick, onClose, onLimit, onStopLoss, onTicket, touch = false }: RungMenuProps) {
  const { limit, stop } = sides;
  return (
    <Menu
      open
      onClose={onClose}
      anchor={anchor}
      label={`Orders at ${priceText}`}
      className={touch ? 'w-[260px] [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:text-[14px]' : 'w-[236px]'}
    >
      <MenuGroup label={`At ${priceText}${sizeText ? ` · ${sizeText}` : ''}`}>
        <MenuItem tone={tone(limit)} onSelect={() => onLimit(limit)} hint={limitIsClick ? (touch ? 'tap' : 'click') : undefined}>
          {verb(limit)} limit
        </MenuItem>
        <MenuItem tone={tone(stop)} onSelect={() => onStopLoss(stop)}>
          {verb(stop)} stop loss
        </MenuItem>
        <MenuItem tone={tone(stop)} onSelect={() => onTicket('STOP_LIMIT', stop)}>
          {verb(stop)} stop limit…
        </MenuItem>
        <MenuItem tone={tone(stop)} onSelect={() => onTicket('TRAILING_STOP', stop)}>
          {verb(stop)} trailing stop…
        </MenuItem>
        <MenuItem tone={tone(limit)} onSelect={() => onTicket('ICEBERG', limit)}>
          {verb(limit)} iceberg…
        </MenuItem>
      </MenuGroup>
    </Menu>
  );
}
