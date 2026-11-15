// SPDX-License-Identifier: Apache-2.0
/**
 * Terminal header, 52px, on the same grid as the body (SIDE_COLUMNS:
 * 340 | 1fr | 340 at 1440; left | 960 | right | far right in wide mode).
 *
 * - Left: logo and wordmark (Bricolage).
 * - Centre: the market symbol as a button that opens the market selector, so
 *   switching markets never depends on the panel layout; then the ticker
 *   hero, the only typographic hero on screen, with a persistent arrow.
 * - Right: connection pill, account (username, or Sign in), theme toggle,
 *   in one cell over every column after the centre (AFTER_CENTRE), so the
 *   centre cell stays exactly the ladder's column in both modes.
 *
 * Stats are nullable: during a market switch every value prints a dash,
 * never $0.00 (DESIGN.md rule 2).
 */
import type { ClusterState, ExtendedConnectionStatus, Market, MarketStats } from '../types/market';
import type { Theme } from '../hooks/useTheme';
import { STACK_VERSION } from '../config';
import { LogoMark } from '../components/LogoMark';
import { ThemeToggle } from '../components/ThemeToggle/ThemeToggle';
import { useTickDirection } from '../ui/useTickDirection';
import { tickDecimals } from '../utils/ticks';
import { LivePill } from './LivePill';
import { formatFixed } from './ladder/format';
import { AFTER_CENTRE, SIDE_COLUMNS } from './layoutColumns';

export { SIDE_COLUMNS };

/** Placeholder for a value that has not arrived (en dash, not a zero). */
const NONE = '–';

export interface HeaderProps {
  market: Market;
  onOpenMarkets: () => void;
  marketsOpen: boolean;
  stats: MarketStats | null;
  /** Best bid, used for the hero when the ticker has no last price yet. */
  bestBid: number | null;
  status: ExtendedConnectionStatus;
  clusterState?: ClusterState;
  onReconnect: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  username: string | null;
  onSignIn: () => void;
  onOpenAccount: () => void;
}

function formatVolume(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 });
}

export function Header(props: HeaderProps) {
  const { market, stats } = props;
  const d = tickDecimals(market.tickSize);
  const raw = stats ? stats.lastPrice || props.bestBid || 0 : null;
  const price = raw !== null && raw > 0 ? raw : null;
  const { tick, dir } = useTickDirection(price);

  const pct = stats?.priceChangePercent ?? null;
  const up = (stats?.priceChange ?? 0) >= 0;

  return (
    <header className={`grid h-[52px] flex-none ${SIDE_COLUMNS} items-center border-b border-hairline bg-surface`}>
      <div className="flex min-w-0 items-center gap-2.5 px-[18px]">
        <LogoMark width={22} height={22} />
        <span
          title={STACK_VERSION}
          className="whitespace-nowrap font-display text-[16px] font-bold leading-none text-text-strong"
        >
          Open Exchange
        </span>
      </div>

      <div className="flex min-w-0 items-baseline justify-center gap-3.5 overflow-hidden whitespace-nowrap">
        <button
          type="button"
          onClick={props.onOpenMarkets}
          aria-haspopup="dialog"
          aria-expanded={props.marketsOpen}
          aria-label={`Market ${market.symbol}. Change market`}
          className="flex items-center gap-1.5 self-center rounded-md px-1.5 py-1 font-semibold text-text-strong hover:bg-chip"
        >
          {market.symbol}
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="text-muted">
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <span
          data-ticker-price
          className={`flex items-baseline gap-1 font-display text-[22px] font-bold tabular-nums leading-none transition-colors ${
            price === null
              ? 'text-muted'
              : tick === 'up'
                ? 'text-buy'
                : tick === 'down'
                  ? 'text-sell'
                  : dir === 'down'
                    ? 'text-sell'
                    : dir === 'up'
                      ? 'text-buy'
                      : 'text-text-strong'
          }`}
        >
          {price !== null ? formatFixed(price, d) : NONE}
          {/* Fixed-width slot, invisible before the first move (DESIGN.md rule 3). */}
          <span
            aria-label={dir ? `last move ${dir}` : undefined}
            className={`w-[14px] text-center text-[13px] ${dir ? '' : 'opacity-0'}`}
          >
            {dir === 'down' ? '▼' : '▲'}
          </span>
        </span>
        <span className={`text-[13px] tabular-nums ${pct === null ? 'text-muted' : up ? 'text-buy' : 'text-sell'}`}>
          {pct === null ? NONE : `${up ? '+' : ''}${pct.toFixed(2)}%`}
        </span>
        <span className="truncate text-[12px] tabular-nums text-muted">
          H {stats ? formatFixed(stats.high24h, d) : NONE} · L {stats ? formatFixed(stats.low24h, d) : NONE} · Vol{' '}
          {stats ? `${formatVolume(stats.volume24h)} ${market.quoteAsset}` : NONE}
        </span>
      </div>

      <div className={`flex ${AFTER_CENTRE} items-center justify-end gap-2.5 px-[18px]`}>
        <LivePill status={props.status} clusterState={props.clusterState} onReconnect={props.onReconnect} />
        {props.username ? (
          <button
            type="button"
            onClick={props.onOpenAccount}
            title="Account & balances"
            className="h-[34px] max-w-[160px] truncate rounded-full border border-ctl px-3 text-[13px] text-text-strong hover:bg-chip"
          >
            {props.username}
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onSignIn}
            className="h-[34px] whitespace-nowrap rounded-full border border-ctl px-3 text-[13px] text-text-strong hover:bg-chip"
          >
            Sign in
          </button>
        )}
        <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />
      </div>
    </header>
  );
}
