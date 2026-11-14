// SPDX-License-Identifier: Apache-2.0
/**
 * The staging strip: the one live region of the trading screen (DESIGN.md
 * rule 12). It shows the staged order exactly as Enter will send it, a
 * warning when a limit would execute immediately, Place and Clear, and the
 * Buy market / Sell market buttons. Results land here too: Accepted is
 * polite, Rejected is an alert with the engine code as its title.
 */
import type { OrderSide } from '../../types/market';
import type { ExtraField } from '../../trading/staging';

export interface StripResult {
  kind: 'accepted' | 'rejected';
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
  /** The second value the type needs, typed here. */
  extra: { field: ExtraField; value: string; unitText: string; onChange: (v: string) => void } | null;
  /** A market order waiting for its second confirmation. */
  confirming: boolean;
  isMarket: boolean;
}

export interface StagingStripProps {
  staged: StagedView | null;
  placing: boolean;
  signedIn: boolean;
  result: StripResult | null;
  onPlace: () => void;
  onClear: () => void;
  onMarket: (side: OrderSide) => void;
}

const BTN = 'h-[26px] flex-none rounded-md px-2.5 text-[12px] font-[inherit] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export function StagingStrip({ staged, placing, signedIn, result, onPlace, onClear, onMarket }: StagingStripProps) {
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
      className="flex h-10 flex-none items-center gap-3 overflow-hidden border-b border-hairline bg-surface-2 px-5 text-[12px]"
    >
      {staged ? (
        <>
          <span className="flex-none text-muted">{staged.confirming ? 'Confirm' : 'Staged'}</span>
          <span data-staged-text className={`flex-none font-semibold ${sideText}`}>
            {staged.text}
          </span>
          {staged.extra && (
            <label className="flex flex-none items-center gap-1.5 text-muted">
              {staged.extra.field.label}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={staged.extra.value}
                onChange={e => staged.extra!.onChange(e.target.value)}
                onWheel={e => e.currentTarget.blur()}
                className="h-[26px] w-[84px] rounded-md border border-ctl bg-surface px-2 text-right text-[12px] text-text-strong [appearance:textfield] focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {staged.extra.unitText}
            </label>
          )}
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
      ) : (
        <span className="flex-none text-muted">Click a bid to buy, an ask to sell</span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {result &&
          (result.kind === 'rejected' ? (
            <span role="alert" data-result="rejected" title={result.code ?? undefined} className="font-medium text-sell">
              {result.text}
            </span>
          ) : (
            <span data-result="accepted" className="font-medium text-buy">
              {result.text}
            </span>
          ))}
      </span>
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
