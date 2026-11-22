// SPDX-License-Identifier: Apache-2.0
/**
 * The phone's staging sheet: what the desktop staging strip does, docked
 * above the bottom nav. It is the one live region of the phone screen
 * (DESIGN.md rule 12): results, the staged order and the Cancel all
 * question all land here.
 *
 * - A tap on a rung stages; the sheet shows the order exactly as Place will
 *   send it, with Cancel (clears the stage, sends nothing) and Place.
 * - Market orders always take a second tap: Place turns into "Confirm
 *   market buy" (rule 10). There is no one-click on touch.
 * - "More order types" opens the rung menu at the staged price, for anyone
 *   who cannot long-press.
 * - "% of available" sizes the order from the real balance of the asset the
 *   side spends; it is left out while the balance is unknown (rule 14).
 * - Cancel all, asked from the Orders tab, is answered here, on any tab.
 */
import type { Ref } from 'react';
import { ResultText } from '../ladder/StagingStrip';
import type { CancelAllView, StagedView, StripResult } from '../ladder/StagingStrip';

export interface PhoneSheetProps {
  /** The staged order; shown only while the ladder tab is on screen. */
  staged: StagedView | null;
  placing: boolean;
  signedIn: boolean;
  result: StripResult | null;
  cancelAll: CancelAllView | null;
  onPlace: () => void;
  onClear: () => void;
  /** Opens the rung menu at the staged price; null when there is no price
   *  to open it at (a market order). */
  onMoreTypes: ((el: HTMLElement) => void) | null;
  /** % sizing from the available balance; null while it is unknown. */
  percent: { assetText: string; available: number; onPick: (percent: number) => void } | null;
  sheetRef?: Ref<HTMLDivElement>;
}

const PERCENTS = [25, 50, 75, 100] as const;

const SHEET =
  'pointer-events-auto flex flex-col gap-3 rounded-t-2xl border-t border-ctl bg-surface px-4 pb-4 pt-2.5 shadow-[0_-18px_40px_-18px_rgba(0,0,0,0.55)]';

function Grabber() {
  return <span aria-hidden className="h-1 w-9 flex-none self-center rounded-sm bg-ctl" />;
}

export function PhoneSheet({
  staged,
  placing,
  signedIn,
  result,
  cancelAll,
  onPlace,
  onClear,
  onMoreTypes,
  percent,
  sheetRef,
}: PhoneSheetProps) {
  const buy = staged?.side === 'BID';
  const verb = buy ? 'buy' : 'sell';
  const placeText = !signedIn
    ? 'Sign in to place'
    : placing
      ? 'Placing…'
      : staged?.confirming
        ? `Confirm market ${verb}`
        : `Place ${verb}`;

  return (
    <div
      ref={sheetRef}
      role="status"
      aria-live="polite"
      aria-label="Staged order"
      data-phone-sheet
      className="pointer-events-none flex flex-col"
    >
      {result && (
        <div className="pointer-events-auto mx-3 mb-2 rounded-xl border border-ctl bg-surface px-4 py-2.5 text-[13px] shadow-[var(--shadow-pop)]">
          <ResultText result={result} />
        </div>
      )}

      {cancelAll?.asking ? (
        <div className={SHEET} data-cancel-all-sheet>
          <Grabber />
          <span className="font-display text-[18px] font-bold text-text-strong">
            Cancel all {cancelAll.count} open {cancelAll.scope} order{cancelAll.count === 1 ? '' : 's'}?
          </span>
          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            <button
              type="button"
              onClick={cancelAll.onDismiss}
              className="h-12 rounded-xl border border-ctl bg-transparent text-[15px] text-text"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={cancelAll.onConfirm}
              disabled={cancelAll.running}
              data-cancel-all-confirm
              className="h-12 rounded-xl border-0 bg-sell text-[15px] font-semibold text-bg disabled:opacity-50"
            >
              Cancel {cancelAll.count}
            </button>
          </div>
        </div>
      ) : staged ? (
        <div className={SHEET} data-staged-sheet>
          <Grabber />
          <div className="flex items-baseline justify-between gap-3">
            <span data-staged-text className={`min-w-0 font-display text-[18px] font-bold ${buy ? 'text-buy' : 'text-sell'}`}>
              {staged.text}
            </span>
            <span className="flex-none text-[12px] text-muted">{staged.summary ?? staged.details}</span>
          </div>
          {staged.totalText && (
            <div className="flex justify-between text-[13px]">
              <span className="text-muted">Total</span>
              <span className="text-text-strong">{staged.totalText}</span>
            </div>
          )}
          {staged.problem ? (
            <span className="text-[13px] text-warn">{staged.problem}</span>
          ) : staged.warning ? (
            <span data-crossing className="text-[13px] font-medium text-warn">
              {staged.warning}
            </span>
          ) : null}
          {staged.confirming && (
            <span className="text-[13px] text-text-strong">Market order: tap Confirm to place it at the best price.</span>
          )}
          {percent && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-muted">Size from available {percent.assetText}</span>
              <div className="grid grid-cols-4 gap-2">
                {PERCENTS.map(p => (
                  <button
                    key={p}
                    type="button"
                    disabled={percent.available <= 0}
                    onClick={() => percent.onPick(p)}
                    className="h-11 rounded-[10px] border border-ctl text-[14px] text-text disabled:opacity-50"
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-[1fr_2fr] gap-2.5">
            <button type="button" onClick={onClear} className="h-12 rounded-xl border border-ctl bg-transparent text-[15px] text-text">
              Cancel
            </button>
            <button
              type="button"
              onClick={onPlace}
              disabled={placing || (signedIn && staged.problem !== null)}
              className={`h-12 rounded-xl border-0 text-[15px] font-semibold disabled:opacity-50 ${
                !signedIn ? 'bg-accent text-on-accent' : buy ? 'bg-buy text-bg' : 'bg-sell text-bg'
              }`}
            >
              {placeText}
            </button>
          </div>
          {onMoreTypes && (
            <div className="flex flex-col items-center">
              <button
                type="button"
                aria-haspopup="menu"
                onClick={e => onMoreTypes(e.currentTarget)}
                className="h-11 rounded-xl px-4 text-[14px] font-medium text-accent"
              >
                More order types
              </button>
              <span className="text-[12px] text-muted">Or long-press a price for stop, trailing or iceberg</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
