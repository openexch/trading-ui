// SPDX-License-Identifier: Apache-2.0
/**
 * "N above" / "N below": own resting orders outside the visible window. A
 * click pins the window to the nearest one (the window holds there until
 * Re-centre).
 */
import type { OwnOutside } from './ladderModel';
import { formatCompactSize, formatFixed } from './format';

export interface JumpMarkerProps {
  direction: 'above' | 'below';
  outside: OwnOutside;
  priceDecimals: number;
  sizeDecimals: number;
  onJump: (rung: number) => void;
}

export function JumpMarker({ direction, outside, priceDecimals, sizeDecimals, onJump }: JumpMarkerProps) {
  const nearest = outside.nearest;
  if (outside.count === 0 || !nearest) return null;
  const o = nearest.order;
  const isBuy = nearest.side === 'BID';
  const sideText = isBuy ? 'Buy' : 'Sell';
  const size = formatCompactSize(o.originalQuantity, sizeDecimals);
  const price = formatFixed(o.price, priceDecimals);
  const filledPct = o.originalQuantity > 0 ? Math.round((o.filledQuantity / o.originalQuantity) * 100) : 0;
  const above = direction === 'above';
  const countText = `${above ? '▲' : '▼'} ${outside.count} ${direction}`;
  const label =
    `${outside.count} own order${outside.count > 1 ? 's' : ''} ${direction} the ladder, nearest ` +
    `${sideText.toLowerCase()} ${size} at ${price}${filledPct > 0 ? `, ${filledPct} percent filled` : ''}. Jump there`;

  const rule = isBuy ? 'border-buy bg-buy-faint' : 'border-sell bg-sell-faint';
  const countCls = isBuy ? 'text-buy' : 'text-sell';

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onJump(nearest.rung)}
      className={`flex h-7 items-center gap-2 whitespace-nowrap rounded-md text-[12px] text-text-strong ${rule} ${
        above ? 'border-r-[3px] pl-2.5 pr-2' : 'border-l-[3px] pl-2 pr-2.5'
      }`}
    >
      {above ? (
        <>
          <span className="text-muted">jump</span>
          <span>nearest {sideText} {size} @ {price}</span>
          <span className={countCls}>{countText}</span>
        </>
      ) : (
        <>
          <span className={countCls}>{countText}</span>
          <span>nearest {sideText} {size} @ {price}</span>
          <span className="text-muted">{filledPct > 0 ? `${filledPct}% filled · jump` : 'jump'}</span>
        </>
      )}
    </button>
  );
}
