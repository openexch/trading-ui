// SPDX-License-Identifier: Apache-2.0
/**
 * One ladder rung: Mine | Bids | Price | Asks | Mine (52 / 1fr / 112 / 1fr / 52).
 *
 * - Depth bars are inset 3px and grow out from the price column. Their scale
 *   is the model's maxQuantity over ALL known levels, so bars do not rescale
 *   when the row count changes.
 * - An own order shows three ways: a faint side-coloured row tint, its share
 *   of the level drawn inside the bar (a fill at --own-slice-alpha plus a 1px
 *   side-coloured outline; the quantity stays in --text-strong so it reads on
 *   top), and a Mine chip with filled / original.
 * - Cells beyond the known depth are dimmed and hatched, never shown as empty
 *   liquidity (DESIGN.md rule 9). The deepest known rung, when part of its
 *   group lies beyond the known depth, prints its quantity as a lower bound.
 * - Every in-range rung offers both actions: the bid cell stages a buy at the
 *   rung's price and the ask cell a sell, on either side of the spread (a
 *   buy above the best ask crosses, and the strip warns). The cells are
 *   buttons out of the tab order: the grid is one tab stop (DESIGN.md rule
 *   11), so a click stages and Enter places from the staging strip.
 */
import type { CSSProperties } from 'react';
import type { LadderRow, LadderSide, OwnAggregate, SideCell } from './ladderModel';
import type { TickDirection } from '../../ui/useTickDirection';
import { formatCompactSize, formatFixed } from './format';

export const LADDER_COLUMNS = 'grid-cols-[52px_minmax(0,1fr)_112px_minmax(0,1fr)_52px]';

export type PriceTone = 'buy' | 'sell' | 'muted';

export interface RungProps {
  row: LadderRow;
  priceText: string;
  tone: PriceTone;
  /** Direction of the last trade move, shown on the last-trade rung only. */
  lastDir: TickDirection | null;
  flashBid: boolean;
  flashAsk: boolean;
  sizeDecimals: number;
  baseAsset: string;
  /** The order size text for the cell labels ("0.25"), or null when the
   *  size field holds no valid size. */
  sizeText: string | null;
  /** Which cell of this rung holds the staged order, if any. */
  stagedSide: LadderSide | null;
  onStage?: (side: LadderSide, price: number) => void;
}

const HATCH: CSSProperties = {
  background: 'repeating-linear-gradient(135deg, transparent 0 4px, var(--hairline-strong) 4px 5px)',
};

function pct(f: number): string {
  return `${Math.max(0, Math.min(1, f)) * 100}%`;
}

function sideWord(side: LadderSide): string {
  return side === 'BID' ? 'buy' : 'sell';
}

function ownSummary(own: OwnAggregate, sizeDecimals: number): string {
  const f = formatCompactSize(own.filled, sizeDecimals);
  const o = formatCompactSize(own.original, sizeDecimals);
  return own.filled > 0 ? `${f}/${o}` : o;
}

function MineChip({ side, own, priceText, sizeDecimals, baseAsset }: {
  side: LadderSide;
  own: OwnAggregate;
  priceText: string;
  sizeDecimals: number;
  baseAsset: string;
}) {
  const n = own.orders.length;
  const label =
    `Your ${sideWord(side)} order${n > 1 ? `s (${n})` : ''} at ${priceText}: ` +
    `${formatCompactSize(own.filled, sizeDecimals)} of ${formatCompactSize(own.original, sizeDecimals)} ${baseAsset} filled`;
  const cls =
    side === 'BID'
      ? 'border-l-[3px] border-buy bg-buy-soft'
      : 'border-r-[3px] border-sell bg-sell-soft';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`relative z-[1] inline-flex h-[18px] items-center whitespace-nowrap rounded px-[5px] text-[11px] font-semibold leading-none text-text-strong ${cls}`}
    >
      {ownSummary(own, sizeDecimals)}
    </span>
  );
}

function DepthCell({ side, cell, flash, price, priceText, sizeDecimals, baseAsset, sizeText, staged, onStage }: {
  side: LadderSide;
  cell: SideCell;
  flash: boolean;
  price: number;
  priceText: string;
  sizeDecimals: number;
  baseAsset: string;
  sizeText: string | null;
  staged: boolean;
  onStage?: (side: LadderSide, price: number) => void;
}) {
  const isBid = side === 'BID';
  const edge: CSSProperties = isBid ? { right: 0 } : { left: 0 };
  const sideCls = isBid ? 'pr-3 text-right' : 'pl-3 text-left';
  const flashCls = flash ? (isBid ? 'animate-flash-buy' : 'animate-flash-sell') : '';
  const verb = isBid ? 'Buy' : 'Sell';

  let text = '';
  let depth = '';
  if (cell.state === 'level' && cell.quantity !== null) {
    const q = formatFixed(cell.quantity, sizeDecimals);
    text = cell.partial ? `≥${q}` : q;
    depth = `, ${cell.partial ? 'at least ' : ''}${q} on book`;
  } else if (cell.state === 'unknown') {
    depth = ', depth unknown';
  }
  const what = sizeText !== null ? `${verb} ${sizeText} ${baseAsset}` : `${verb} ${baseAsset}`;
  const label = `${what} at ${priceText}${depth}`;
  const own = cell.own;
  const sliceW = own && own.slice > 0 ? pct(own.sliceFraction) : null;
  // Literal class names: Tailwind only generates what it can read.
  const ring = isBid ? 'outline-buy' : 'outline-sell';
  const hoverRing = isBid ? 'hover:outline-buy' : 'hover:outline-sell';

  return (
    <button
      type="button"
      role="gridcell"
      tabIndex={-1}
      aria-label={label}
      data-staged={staged ? 'true' : undefined}
      title={cell.partial ? 'Part of this group lies beyond the known depth' : undefined}
      onClick={() => onStage?.(side, price)}
      className={`group relative h-full cursor-pointer overflow-hidden rounded border-0 bg-transparent p-0 font-[inherit] text-[13px] leading-[22px] text-text-strong outline-offset-[-1px] hover:bg-chip hover:outline hover:outline-1 ${
        staged ? `outline outline-1 ${ring}` : ''
      } ${hoverRing} ${sideCls} ${flashCls}`}
    >
      {cell.state === 'level' && (
        <span
          aria-hidden
          className={`absolute bottom-[3px] top-[3px] rounded-[3px] ${isBid ? 'bg-buy-soft' : 'bg-sell-soft'}`}
          style={{ ...edge, width: pct(cell.bar) }}
        />
      )}
      {sliceW && (
        <>
          <span
            aria-hidden
            data-own-slice
            className={`absolute bottom-[3px] top-[3px] rounded-[3px] ${isBid ? 'bg-buy' : 'bg-sell'}`}
            style={{ ...edge, width: sliceW, opacity: 'var(--own-slice-alpha)' }}
          />
          <span
            aria-hidden
            className="absolute bottom-[3px] top-[3px] rounded-[3px]"
            style={{ ...edge, width: sliceW, boxShadow: `inset 0 0 0 1px var(${isBid ? '--buy' : '--sell'})` }}
          />
        </>
      )}
      {cell.state === 'unknown' && (
        <span aria-hidden data-unknown className="absolute inset-y-[3px] inset-x-0 rounded-[3px] opacity-60" style={HATCH} />
      )}
      {/* On hover the cell previews what a click stages ("Buy 0.25"). */}
      <span aria-hidden className="relative group-hover:hidden">{text}</span>
      <span aria-hidden className={`relative hidden font-semibold group-hover:inline ${isBid ? 'text-buy' : 'text-sell'}`}>
        {sizeText !== null ? `${verb} ${sizeText}` : verb}
      </span>
    </button>
  );
}

export function Rung({
  row,
  priceText,
  tone,
  lastDir,
  flashBid,
  flashAsk,
  sizeDecimals,
  baseAsset,
  sizeText,
  stagedSide,
  onStage,
}: RungProps) {
  const ownBid = row.bid.own;
  const ownAsk = row.ask.own;
  const tint =
    ownBid && ownAsk
      ? 'linear-gradient(90deg, var(--buy-faint) 50%, var(--sell-faint) 50%)'
      : ownBid
        ? 'var(--buy-faint)'
        : ownAsk
          ? 'var(--sell-faint)'
          : undefined;

  if (!row.inRange) {
    return <div role="row" aria-hidden data-rung-price="" className={`grid h-[22px] ${LADDER_COLUMNS}`} />;
  }

  const toneCls = tone === 'buy' ? 'text-buy' : tone === 'sell' ? 'text-sell' : 'text-muted';

  return (
    <div
      role="row"
      data-rung-price={row.price}
      className={`grid h-[22px] ${LADDER_COLUMNS} items-center rounded`}
      style={tint ? { background: tint } : undefined}
    >
      <span role="gridcell" className="flex items-center">
        {ownBid && (
          <MineChip side="BID" own={ownBid} priceText={priceText} sizeDecimals={sizeDecimals} baseAsset={baseAsset} />
        )}
      </span>
      <DepthCell
        side="BID"
        cell={row.bid}
        flash={flashBid}
        price={row.price}
        priceText={priceText}
        sizeDecimals={sizeDecimals}
        baseAsset={baseAsset}
        sizeText={sizeText}
        staged={stagedSide === 'BID'}
        onStage={onStage}
      />
      <span role="gridcell" className="flex justify-center text-[13px]">
        {row.isLastTrade ? (
          <span
            data-last-trade
            aria-label={`${priceText}, last trade${lastDir ? (lastDir === 'up' ? ', up' : ', down') : ''}`}
            className="inline-flex items-center gap-1 rounded-[5px] bg-mid px-2 py-px font-semibold leading-[18px] text-text-strong outline outline-1 outline-accent"
          >
            {priceText}
            {/* Fixed-width slot: the arrow never appears or disappears and
                shifts the price (DESIGN.md rule 3). */}
            <span
              aria-hidden
              className={`w-[10px] text-center text-[10px] leading-none ${
                lastDir ? (lastDir === 'up' ? 'text-buy' : 'text-sell') : 'opacity-0'
              }`}
            >
              {lastDir === 'down' ? '▼' : '▲'}
            </span>
          </span>
        ) : (
          <span className={`font-medium ${toneCls}`}>{priceText}</span>
        )}
      </span>
      <DepthCell
        side="ASK"
        cell={row.ask}
        flash={flashAsk}
        price={row.price}
        priceText={priceText}
        sizeDecimals={sizeDecimals}
        baseAsset={baseAsset}
        sizeText={sizeText}
        staged={stagedSide === 'ASK'}
        onStage={onStage}
      />
      <span role="gridcell" className="flex items-center justify-end">
        {ownAsk && (
          <MineChip side="ASK" own={ownAsk} priceText={priceText} sizeDecimals={sizeDecimals} baseAsset={baseAsset} />
        )}
      </span>
    </div>
  );
}

// Skeleton widths (%) cycled per row: organic, not a flat block.
const SKELETON_WIDTHS = [55, 70, 45, 65, 50, 75, 60, 40];

/** Placeholder rungs while a market's first snapshot is in flight. */
export function SkeletonRung({ index }: { index: number }) {
  const w = (k: number) => `${SKELETON_WIDTHS[(index + k) % SKELETON_WIDTHS.length]}%`;
  return (
    <div aria-hidden data-skeleton-rung className={`grid h-[22px] ${LADDER_COLUMNS} items-center animate-pulse`}>
      <span />
      <span className="flex justify-end pr-3">
        <span className="h-3 rounded-sm bg-surface-2" style={{ width: w(0) }} />
      </span>
      <span className="flex justify-center">
        <span className="h-3 w-14 rounded-sm bg-surface-2" />
      </span>
      <span className="flex justify-start pl-3">
        <span className="h-3 rounded-sm bg-surface-2" style={{ width: w(3) }} />
      </span>
      <span />
    </div>
  );
}
