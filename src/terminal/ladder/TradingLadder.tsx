// SPDX-License-Identifier: Apache-2.0
/**
 * The centre column: order defaults, the staging strip and the ladder, with
 * the staging state that ties them together (DESIGN.md rule 10).
 *
 * - A click on a bid cell stages a buy at that rung's price, an ask cell a
 *   sell. The price is snapped to the tick by orderDraft; a grouped rung
 *   stages at the rung's price.
 * - Enter places through the page's submit handler; Esc clears. Enter counts
 *   only when focus is on the ladder grid or nowhere (the page body), so a
 *   focused button or field keeps its own Enter. Esc counts anywhere in this
 *   column.
 * - Market orders (Buy / Sell market, or the Market type) always take a
 *   second Enter or click.
 * - While an order is staged the ladder window is pinned (DESIGN.md rule 8).
 * - Signed out, staging still works and Place opens the sign-in dialog.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Market, OrderBook, OrderRequest, OrderSide, OrderType, TimeInForce, UserOrder } from '../../types/market';
import type { LevelChange } from '../../hooks/useOrderBook';
import { useBalances } from '../../hooks/useBalances';
import { EV, track } from '../../analytics';
import { marketUi } from '../../trading/marketUi';
import { orderSubmitProps, snapPriceText } from '../../trading/orderDraft';
import {
  buildStaged,
  crossing,
  describeStaged,
  extraField,
  parseSize,
  stagedTotal,
  stagedType,
  tifChoice,
  typeLabel,
} from '../../trading/staging';
import type { OrderDefaults as Defaults, Staged } from '../../trading/staging';
import { Ladder } from './Ladder';
import { OrderDefaults } from './OrderDefaults';
import { StagingStrip } from './StagingStrip';
import type { StagedView, StripResult } from './StagingStrip';

export interface TradingLadderProps {
  market: Market;
  orderBook: OrderBook;
  levelChanges: Map<string, LevelChange>;
  openOrders: UserOrder[];
  lastPrice: number | null;
  signedIn: boolean;
  onSubmitOrder: (order: OrderRequest) => Promise<{ success: boolean; message: string }>;
  onRequestSignIn: () => void;
  /** Async reject of an accepted order, from the user's order stream. */
  rejectNotice: { text: string; code: string | null } | null;
}

/** How long a result stays in the strip. */
const ACCEPTED_MS = 6000;
const REJECTED_MS = 8000;

function defaultSize(market: Market): string {
  const ui = marketUi(market);
  return ui.defaultPresetIndex === null ? '' : String(ui.sizePresets[ui.defaultPresetIndex]);
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
}

export function TradingLadder(props: TradingLadderProps) {
  const { market, orderBook, signedIn, onSubmitOrder, onRequestSignIn, rejectNotice } = props;
  const { refresh: refreshBalances } = useBalances();

  // Size belongs to the market it was typed on; a switch starts from the
  // next market's default preset. Type and TIF carry over.
  const [sizeSel, setSizeSel] = useState<{ marketId: number; size: string } | null>(null);
  const size = sizeSel && sizeSel.marketId === market.id ? sizeSel.size : defaultSize(market);
  const [type, setType] = useState<OrderType>('LIMIT');
  const [tif, setTif] = useState<TimeInForce>('GTC');
  const defaults: Defaults = useMemo(() => ({ size, type, tif }), [size, type, tif]);

  const [stagedRaw, setStaged] = useState<Staged | null>(null);
  // A staged order never survives a market switch.
  const staged = stagedRaw && stagedRaw.marketId === market.id ? stagedRaw : null;
  const [extra, setExtra] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<StripResult | null>(null);
  const resultTimer = useRef<number | null>(null);

  const showResult = useCallback((r: StripResult | null) => {
    if (resultTimer.current) window.clearTimeout(resultTimer.current);
    setResult(r);
    if (r) {
      resultTimer.current = window.setTimeout(() => setResult(null), r.kind === 'accepted' ? ACCEPTED_MS : REJECTED_MS);
    }
  }, []);
  useEffect(() => () => {
    if (resultTimer.current) window.clearTimeout(resultTimer.current);
  }, []);

  // Any change to what Enter would send asks for the confirmation again.
  useEffect(() => {
    setConfirming(false);
  }, [stagedRaw, size, type, tif, extra, market.id]);

  const stage = useCallback(
    (side: OrderSide, price: number | null) => {
      let snapped: number | null = null;
      if (price !== null) {
        const t = snapPriceText(market, String(price));
        if (t === null) return; // out of range: not a stageable rung
        snapped = Number(t);
      }
      setStaged({ marketId: market.id, side, price: snapped });
    },
    [market],
  );

  const clear = useCallback(() => {
    setStaged(null);
    setConfirming(false);
  }, []);

  const bestBid = orderBook.bids[0]?.price ?? null;
  const bestAsk = orderBook.asks[0]?.price ?? null;

  const effType = staged ? stagedType(staged, defaults) : null;
  const built = useMemo(
    () => (staged ? buildStaged(market, staged, defaults, extra, 0) : null),
    [market, staged, defaults, extra],
  );

  const view: StagedView | null = useMemo(() => {
    if (!staged || !effType || !built) return null;
    const total = stagedTotal(effType, staged.price, size);
    const totalText =
      total === null
        ? ''
        : ` · ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${market.quoteAsset}`;
    const cross = crossing(effType, staged.side, staged.price, bestBid, bestAsk);
    const field = extraField(effType);
    return {
      side: staged.side,
      text: describeStaged(market, staged, defaults),
      details: `${typeLabel(effType)} · ${tifChoice(tif).label}${totalText}`,
      problem: built.ok ? null : built.error,
      warning:
        cross === 'executes'
          ? 'Crosses the spread: executes now'
          : cross === 'post-only-rejects'
            ? 'Crosses the spread: post only will be rejected'
            : null,
      extra: field
        ? {
            field,
            value: extra,
            unitText: field.unit === 'quote' ? market.quoteAsset : market.baseAsset,
            onChange: setExtra,
          }
        : null,
      confirming,
      isMarket: effType === 'MARKET',
    };
  }, [staged, effType, built, size, market, defaults, tif, extra, bestBid, bestAsk, confirming]);

  const place = useCallback(async () => {
    if (!staged || placing || !effType) return;
    if (!signedIn) {
      onRequestSignIn();
      return;
    }
    const b = buildStaged(market, staged, defaults, extra, Date.now());
    if (!b.ok) return; // the strip already shows why
    if (effType === 'MARKET' && !confirming) {
      setConfirming(true);
      return;
    }
    const text = describeStaged(market, staged, defaults);
    const submitProps = orderSubmitProps({
      market,
      orderType: effType,
      side: staged.side,
      timeInForce: tif,
      fromBookClick: staged.price !== null,
      usedSlider: false,
    });
    track(EV.order_submit, submitProps);
    const startedAt = Date.now();
    setPlacing(true);
    let res: { success: boolean; message: string };
    try {
      res = await onSubmitOrder(b.order);
    } finally {
      setPlacing(false);
    }
    const roundTripMs = Date.now() - startedAt;
    setConfirming(false);
    if (res.success) {
      track(EV.order_accepted, { ...submitProps, round_trip_ms: roundTripMs });
      showResult({ kind: 'accepted', text: `Accepted: ${text}` });
      setStaged(null);
      refreshBalances();
    } else {
      track(EV.order_rejected, { ...submitProps, round_trip_ms: roundTripMs, reason: res.message.slice(0, 120) });
      // Kept staged so it can be corrected and placed again.
      showResult({ kind: 'rejected', text: `Rejected: ${res.message}` });
    }
  }, [staged, placing, effType, signedIn, onRequestSignIn, market, defaults, extra, confirming, tif, onSubmitOrder, showResult, refreshBalances]);

  // Enter and Esc. Latest handlers through a ref so the listener is stable.
  const rootRef = useRef<HTMLDivElement>(null);
  const keys = useRef({ place, clear, staged: staged !== null });
  useEffect(() => {
    keys.current = { place, clear, staged: staged !== null };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      if (!keys.current.staged) return;
      const root = rootRef.current;
      const t = e.target;
      const onPage = t === document.body || t === document.documentElement || t === document;
      const inRoot = root !== null && t instanceof Node && root.contains(t);
      if (e.key === 'Escape') {
        if (!onPage && !inRoot) return;
        e.preventDefault();
        keys.current.clear();
        return;
      }
      if (isTypingTarget(t)) return;
      const onGrid = inRoot && t instanceof HTMLElement && t.closest('[role="grid"]') !== null;
      if (!onPage && !onGrid) return;
      e.preventDefault();
      void keys.current.place();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The async reject (order stream) wins over a local result: it is the one
  // the user cannot otherwise see.
  const shown: StripResult | null = rejectNotice
    ? { kind: 'rejected', text: rejectNotice.text, code: rejectNotice.code }
    : result;

  const sizeOk = parseSize(size) !== null;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <OrderDefaults
        market={market}
        value={defaults}
        onSize={s => setSizeSel({ marketId: market.id, size: s })}
        onType={setType}
        onTif={setTif}
      />
      <StagingStrip
        staged={view}
        placing={placing}
        signedIn={signedIn}
        result={shown}
        onPlace={() => void place()}
        onClear={clear}
        onMarket={side => stage(side, null)}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Ladder
          market={market}
          orderBook={orderBook}
          levelChanges={props.levelChanges}
          openOrders={props.openOrders}
          lastPrice={props.lastPrice}
          sizeText={sizeOk ? size.trim() : null}
          onStage={stage}
          staged={staged && staged.price !== null && effType !== 'MARKET' ? { side: staged.side, price: staged.price } : null}
          hold={staged !== null}
        />
      </div>
    </div>
  );
}
