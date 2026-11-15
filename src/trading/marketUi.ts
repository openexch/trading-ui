// SPDX-License-Identifier: Apache-2.0
// Per-market presentation constants for the ladder: size presets and price
// grouping. These are UI choices, not engine rules. The engine has no lot
// size or minimum quantity in `Market` yet, so an order the engine refuses
// still surfaces through the async reject path.
import type { Market } from '../types/market';
import { tickDecimals } from '../utils/ticks';

/** Price grouping, as multiples of the market's tick. */
export const GROUPING_MULTIPLIERS = [1, 5, 10, 25, 100] as const;
export type GroupingMultiplier = (typeof GROUPING_MULTIPLIERS)[number];

export interface MarketUi {
  /** Quick size buttons, in base units, smallest first. */
  sizePresets: number[];
  /** Index into sizePresets selected when the market first opens; null when
   *  the market has no presets. */
  defaultPresetIndex: number | null;
  /** Decimals used to show sizes for this market. */
  sizeDecimals: number;
  /** Grouping selected when the market first opens: one tick everywhere, so
   *  every row is an engine price level (a user may still pick a coarser
   *  grouping). */
  defaultGrouping: GroupingMultiplier;
}

const BY_SYMBOL: Record<string, MarketUi> = {
  'BTC-USD': { sizePresets: [0.1, 0.25, 1], defaultPresetIndex: 1, sizeDecimals: 4, defaultGrouping: 1 },
  'ETH-USD': { sizePresets: [0.5, 1, 5], defaultPresetIndex: 1, sizeDecimals: 4, defaultGrouping: 1 },
  'SOL-USD': { sizePresets: [5, 10, 50], defaultPresetIndex: 1, sizeDecimals: 2, defaultGrouping: 1 },
  'XRP-USD': { sizePresets: [100, 500, 2000], defaultPresetIndex: 1, sizeDecimals: 1, defaultGrouping: 1 },
  'DOGE-USD': { sizePresets: [1000, 5000, 20000], defaultPresetIndex: 1, sizeDecimals: 0, defaultGrouping: 1 },
};

/** A market without an entry gets no presets (the size input still works)
 *  rather than invented sizes. */
const FALLBACK: MarketUi = { sizePresets: [], defaultPresetIndex: null, sizeDecimals: 8, defaultGrouping: 1 };

export function marketUi(market: Pick<Market, 'symbol'>): MarketUi {
  return BY_SYMBOL[market.symbol] ?? FALLBACK;
}

export interface GroupingOption {
  multiplier: GroupingMultiplier;
  /** Group width in quote units (multiplier x tickSize), float-safe. */
  size: number;
  /** Group width as text, at the tick's precision (ETH x5 -> "2.5"). */
  label: string;
}

/** Group width for a multiplier, computed in integer tick units so DOGE
 *  (0.0001) and XRP (0.001) never pick up float tails. */
export function groupSize(market: Pick<Market, 'tickSize'>, multiplier: number): number {
  const d = tickDecimals(market.tickSize);
  const scale = 10 ** d;
  const unit = Math.round(market.tickSize * scale);
  return Number(((unit * multiplier) / scale).toFixed(d));
}

export function groupingOptions(market: Pick<Market, 'tickSize'>): GroupingOption[] {
  const d = tickDecimals(market.tickSize);
  return GROUPING_MULTIPLIERS.map(multiplier => {
    const size = groupSize(market, multiplier);
    return {
      multiplier,
      size,
      label: size.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d }),
    };
  });
}

export function isGroupingMultiplier(n: number): n is GroupingMultiplier {
  return (GROUPING_MULTIPLIERS as readonly number[]).includes(n);
}

/**
 * The size one step up or down (the + and - keys), as text. A step is the
 * market's smallest preset; going down never goes below one step. Computed
 * in integer units of the market's size precision so no float tail appears.
 * Null when the market has no presets (no step to take).
 */
export function stepSize(market: Pick<Market, 'symbol'>, sizeText: string, dir: 1 | -1): string | null {
  const ui = marketUi(market);
  const step = ui.sizePresets[0];
  if (step === undefined) return null;
  const scale = 10 ** ui.sizeDecimals;
  const t = sizeText.trim();
  const cur = /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : 0;
  const stepU = Math.round(step * scale);
  const curU = cur > 0 && isFinite(cur) ? Math.round(cur * scale) : 0;
  const nextU = Math.max(stepU, curU + dir * stepU);
  return String(Number((nextU / scale).toFixed(ui.sizeDecimals)));
}
