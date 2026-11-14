// SPDX-License-Identifier: Apache-2.0
/**
 * The staging strip: the one live region of the trading screen (DESIGN.md
 * rule 12). It shows the staged order exactly as Enter will send it, a
 * warning when a limit would execute immediately, Place and Clear, and the
 * Buy market / Sell market buttons. Results land here too: Accepted is
 * polite, Rejected is an alert with the engine code as its title.
 *
 * - The type's second value (stop limit's limit price, a trail, an
 *   iceberg's shown size) is set in the order popover, never here.
 * - Armed one-click: the strip carries both side colours along its top edge
 *   and says so; the change is announced because this is the live region.
 * - Cancel all asks here first (a second click or Enter), then reports how
 *   many were cancelled and how many failed (DESIGN.md rule 10).
 * - Keyboard feedback (a new size, type or TIF, a refused move) lands here
 *   as a polite info line: the ladder itself is never announced (rule 12).
 */
import type { OrderSide } from '../../types/market';

export interface StripResult {
  /** info: keyboard feedback, polite and neutral. */
  kind: 'accepted' | 'rejected' | 'info';
  text: string;
  /** Engine reject code, kept inspectable as the title. */
  code?: string | null;
}

export interface StagedView {
  side: OrderSide;
  /** "Buy 0.25 BTC @ 97,395". */
  text: string;
  /** "Limit · GTC · 24,348.75 USD". */
  details: string;
  /** Why it cannot be placed yet ("Enter a size"), or null. */
  problem: string | null;
  /** Crossing note, or null. */
  warning: string | null;
  /** A market order waiting for its second confirmation. */
  confirming: boolean;
  isMarket: boolean;
}

export interface CancelAllView {
  /** Open orders it would cancel. */
  count: number;
  /** "BTC-USD". */
  scope: string;
  /** Waiting for the second click. */
  asking: boolean;
  running: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
}

export interface StagingStripProps {
  staged: StagedView | null;
  placing: boolean;
  signedIn: boolean;
  result: StripResult | null;
  /** One-click is armed: a click on a rung places at once. */
  armed?: boolean;
  /** Cancel all on this market; null when there is nothing to cancel. */
  cancelAll?: CancelAllView | null;
  onPlace: () => void;
  onClear: () => void;
  onMarket: (side: OrderSide) => void;
}

const BTN = 'h-[26px] flex-none rounded-md px-2.5 text-[12px] font-[inherit] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export function StagingStrip({
  staged,
  placing,
  signedIn,
  result,
  armed = false,
  cancelAll = null,
  onPlace,
  onClear,
  onMarket,
}: StagingStripProps) {
  const buy = staged?.side === 'BID';
  const sideText = buy ? 'text-buy' : 'text-sell';
  const sideBg = buy ? 'bg-buy' : 'bg-sell';
  const placeText = !signedIn
    ? 'Sign in to place'
    : staged?.confirming
      ? 'Confirm ⏎'
      : 'Place ⏎';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Staged order"
      data-staging-strip
      data-armed={armed ? 'true' : undefined}
      className="relative flex h-10 flex-none items-center gap-3 overflow-hidden border-b border-hairline bg-surface-2 px-5 text-[12px]"
    >
      {armed && (
        <span
          aria-hidden
          data-armed-edge
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, var(--buy), var(--sell))' }}
        />
      )}
      {cancelAll?.asking ? (
        <>
          <span className="flex-none font-semibold text-text-strong">
            Cancel all {cancelAll.count} open {cancelAll.scope} order{cancelAll.count === 1 ? '' : 's'}?
          </span>
          <button
            type="button"
            onClick={cancelAll.onConfirm}
            disabled={cancelAll.running}
            aria-keyshortcuts="Enter"
            data-cancel-all-confirm
            className={`${BTN} border-0 bg-sell px-3 font-semibold text-bg`}
          >
            Cancel {cancelAll.count}
          </button>
          <button
            type="button"
            onClick={cancelAll.onDismiss}
            aria-keyshortcuts="Escape"
            className={`${BTN} border border-ctl bg-transparent text-text hover:bg-chip`}
          >
            Keep
          </button>
          <span className="flex-none text-muted">Enter confirms · Esc keeps</span>
        </>
      ) : staged ? (
        <>
          {armed && <span className="flex-none font-semibold text-text-strong">One-click</span>}
          <span className="flex-none text-muted">{staged.confirming ? 'Confirm' : 'Staged'}</span>
          <span data-staged-text className={`flex-none font-semibold ${sideText}`}>
            {staged.text}
          </span>
          <span className="min-w-0 truncate text-muted" title={staged.details}>
            {staged.confirming ? `Market order: press Enter again to place` : staged.details}
          </span>
          {staged.problem && <span className="flex-none text-warn">{staged.problem}</span>}
          {!staged.problem && staged.warning && (
            <span data-crossing className="flex-none font-medium text-warn" title={staged.warning}>
              {staged.warning}
            </span>
          )}
          <button
            type="button"
            onClick={onPlace}
            disabled={placing || (signedIn && staged.problem !== null)}
            aria-keyshortcuts="Enter"
            className={`${BTN} border-0 px-3 font-semibold ${signedIn ? `${sideBg} text-bg` : 'bg-accent text-on-accent'}`}
          >
            {placing ? 'Placing…' : placeText}
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-keyshortcuts="Escape"
            className={`${BTN} border border-ctl bg-transparent text-text hover:bg-chip`}
          >
            Clear Esc
          </button>
        </>
      ) : armed ? (
        <span data-armed-text className="min-w-0 flex-none truncate">
          <span className="font-semibold text-text-strong">One-click on:</span>{' '}
          <span className="font-medium text-buy">a bid click buys</span>,{' '}
          <span className="font-medium text-sell">an ask click sells</span>
          <span className="text-muted"> at once · Esc turns it off</span>
        </span>
      ) : (
        <span className="flex-none text-muted">Click a bid to buy, an ask to sell</span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {result &&
          (result.kind === 'rejected' ? (
            <span role="alert" data-result="rejected" title={result.code ?? undefined} className="font-medium text-sell">
              {result.text}
            </span>
          ) : result.kind === 'info' ? (
            <span data-result="info" className="text-text">
              {result.text}
            </span>
          ) : (
            <span data-result="accepted" className="font-medium text-buy">
              {result.text}
            </span>
          ))}
      </span>
      {cancelAll && !cancelAll.asking && (
        <button
          type="button"
          onClick={cancelAll.onAsk}
          disabled={cancelAll.running}
          className={`${BTN} border border-ctl bg-transparent text-text hover:bg-chip`}
        >
          {cancelAll.running ? 'Cancelling…' : `Cancel all · ${cancelAll.count}`}
        </button>
      )}
      <button
        type="button"
        onClick={() => onMarket('BID')}
        className={`${BTN} border border-buy bg-transparent font-semibold text-buy hover:bg-buy-faint`}
      >
        Buy market
      </button>
      <button
        type="button"
        onClick={() => onMarket('ASK')}
        className={`${BTN} border border-sell bg-transparent font-semibold text-sell hover:bg-sell-faint`}
      >
        Sell market
      </button>
    </div>
  );
}
