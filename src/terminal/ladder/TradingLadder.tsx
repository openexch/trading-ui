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
 * - Price field (desktop defaults bar): a rung click (or B / S) also writes
 *   the rung's price there. Buy limit / Sell limit place a limit order at
 *   it with the current size and TIF, through the rung click's path (staged
 *   into the strip, or placed at once while one-click is armed and it does
 *   not cross). Off the tick, out of [minPrice, maxPrice] or empty, the
 *   buttons are disabled; the reason (not for empty) shows in the strip's
 *   info line.
 * - While an order is staged the ladder window is pinned (DESIGN.md rule 8).
 * - Signed out, staging still works and Place opens the sign-in dialog.
 * - Right-click (or the Menu key) on a rung opens the rung menu; stop
 *   limit, trailing stop and iceberg go through the order popover, which
 *   stages into the strip. A rung click while the defaults bar is on one of
 *   those types opens the same popover.
 * - One-click (off by default, never persisted): armed, a rung click places
 *   at once, unless it crosses the spread, needs a second value or is a
 *   market order; those still stage. It disarms on Esc, market switch,
 *   sign-out and any connection state other than connected.
 * - Own orders: the Mine chip menu cancels and moves (limit orders only,
 *   price only). Cancel all asks first, then cancels this market's open
 *   orders one by one through the page's cancel handler. Pending state is
 *   kept per omsOrderId here, never in the shared API loading flag.
 *   Cancel selected (the all-orders dialog) cancels a given list the same
 *   way, across markets, after the dialog has asked.
 * - Reveal: an order shown from the all-orders dialog is brought into view
 *   (pinned, as a jump marker does) and its rung takes focus.
 * - Keyboard (DESIGN.md rule 11, keymap.ts): L focuses the ladder and ?
 *   opens the shortcut sheet from anywhere outside text fields, menus and
 *   dialogs. The rest work only while the ladder grid has focus: the grid
 *   handles moving focus and own orders (useLadderKeys) and hands the
 *   order-entry keys here (`onCommand`). Ctrl+Shift+X asks, Enter confirms.
 *   Keyboard feedback is announced through the strip only (rule 12).
 * - Phone (`variant="phone"`): the same staging state, drawn for touch. The
 *   defaults bar becomes a settings row (PhoneOrderBar), the strip becomes
 *   a bottom sheet (PhoneSheet, portalled into the shell's sheet host so a
 *   Cancel all asked from the Orders tab is answered on any tab), rungs are
 *   44px, a long-press opens the rung menu and the sheet's "More order
 *   types" does the same. One-click does not exist on the phone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  ExtendedConnectionStatus,
  Market,
  OrderBook,
  OrderRequest,
  OrderSide,
  OrderType,
  TimeInForce,
  UserOrder,
} from '../../types/market';
import { findMarket } from '../../markets/marketStore';
import type { LevelChange } from '../../hooks/useOrderBook';
import { useBalances } from '../../hooks/useBalances';
import { EV, track } from '../../analytics';
import { marketUi } from '../../trading/marketUi';
import { orderSubmitProps, sizeForPercent, snapPriceText } from '../../trading/orderDraft';
import {
  buildStaged,
  crossing,
  describeStaged,
  effectiveDefaults,
  extraField,
  formatPriceText,
  nextTif,
  nextType,
  parseSize,
  stagedTotal,
  stagedType,
  tifChoice,
  typeLabel,
} from '../../trading/staging';
import { groupingOptions, stepSize } from '../../trading/marketUi';
import { parsePriceField, priceFieldText, stepPriceField } from '../../trading/priceField';
import { cancelAllSummary, menuReference, oneClickPlaces, rungMenuSides } from '../../trading/orderActions';
import type { CancelResult } from '../../trading/orderActions';
import type { Anchor } from '../../ui';
import type { OrderDefaults as Defaults, Staged } from '../../trading/staging';
import { Ladder } from './Ladder';
import { OrderDefaults } from './OrderDefaults';
import { StagingStrip } from './StagingStrip';
import type { CancelAllView, StagedView, StripResult } from './StagingStrip';
import { RungMenu } from './RungMenu';
import type { TicketKind } from './RungMenu';
import { OrderPopover } from './OrderPopover';
import type { OwnOrderActions, PendingKind } from './OwnOrderChip';
import type { LadderHandle, LadderReveal, PassedCommand } from './useLadderKeys';
import { globalCommand, inOverlay, isTypingTarget } from './keymap';
import { ShortcutsDialog } from './ShortcutsDialog';
import { formatCompactSize } from './format';
import { PhoneOrderBar } from '../phone/PhoneOrderBar';
import { PhoneSheet } from '../phone/PhoneSheet';

export interface TradingLadderProps {
  market: Market;
  orderBook: OrderBook;
  levelChanges: Map<string, LevelChange>;
  openOrders: UserOrder[];
  lastPrice: number | null;
  signedIn: boolean;
  onSubmitOrder: (order: OrderRequest) => Promise<OrderAnswer>;
  onRequestSignIn: () => void;
  /** An engine election is open (the user stream's election frames): the
   *  strip says order entry is waiting and nothing is lost, and one-click
   *  disarms. Null when none. */
  engineWait?: string | null;
  /** Async reject of an accepted order, from the user's order stream. */
  rejectNotice: { text: string; code: string | null } | null;
  /** Market-data connection state: one-click is armed only while connected. */
  status?: ExtendedConnectionStatus;
  /** The page's cancel handler (keyed on omsOrderId); resolves with the
   *  OMS answer. */
  onCancelOrder?: (order: UserOrder) => Promise<OrderAnswer>;
  /** The page's replace handler; Move sends the price only. */
  onReplaceOrder?: (order: UserOrder, price?: number, quantity?: number) => Promise<OrderAnswer>;
  /** Hands the own-order actions to the side panels (the Orders panel), so
   *  a cancel there goes through the same pending state, Cancel all
   *  question and strip results as one made on the ladder. Null while there
   *  are none (signed out, no cancel handler). */
  onOrderActions?: (actions: LadderOrderActions | null) => void;
  /** Desktop (defaults bar, strip, 22px rungs) or phone (settings row,
   *  bottom sheet, 44px touch rungs, no one-click). */
  variant?: 'desktop' | 'phone';
  /** Phone: where the bottom sheet renders (above the nav, outside the
   *  tab panels). */
  sheetHost?: HTMLElement | null;
  /** Phone: the ladder tab is on screen. The staged order's sheet shows only
   *  then; results and the Cancel all question show on every tab. */
  active?: boolean;
  /** An own order to bring into view and focus (Show on ladder). Acted on
   *  once per `seq`, when it is on this market and the book has arrived. */
  reveal?: LadderReveal | null;
}

/** The gateway's answer to an order request, as the page's handlers give it
 *  (useApi). A 504 OUTCOME_UNKNOWN may have been applied; a 503
 *  CORE_UNAVAILABLE was not sent. */
export interface OrderAnswer {
  success: boolean;
  message: string;
  outcomeUnknown?: boolean;
  coreUnavailable?: boolean;
}

/** The strip line for an answer that is neither applied nor refused:
 *  never presented as safe to retry (outcome unknown), or as waiting
 *  (nothing was sent). Null for every other answer. */
export function undecidedResult(what: string, res: OrderAnswer): StripResult | null {
  if (res.outcomeUnknown) {
    return {
      kind: 'unknown',
      text: `Outcome unknown: ${what}. The core did not answer in time and it may have been applied: check your orders before trying again`,
      code: 'OUTCOME_UNKNOWN',
    };
  }
  if (res.coreUnavailable) {
    return {
      kind: 'waiting',
      text: `Waiting for the core: ${what} was not sent. Nothing is lost; try again when order entry reopens`,
      code: 'CORE_UNAVAILABLE',
    };
  }
  return null;
}

/** The ladder's own-order actions, as the side panels use them. */
export interface LadderOrderActions {
  /** Orders with a request in flight, by omsOrderId. */
  pending: ReadonlyMap<string, PendingKind>;
  /** Cancel one order; the result lands in the strip and is returned. */
  cancel: (order: UserOrder) => Promise<CancelResult | null>;
  /** Cancel these orders one by one (any market), with the same pending
   *  state; the summary lands in the strip and the results are returned.
   *  The caller asks first. */
  cancelMany: (orders: readonly UserOrder[]) => Promise<CancelResult[]>;
  /** Ask the strip's Cancel all question for this market and move focus
   *  to its confirm button. Nothing is sent until it is confirmed. */
  askCancelAll: () => void;
  /** How many orders Cancel all would cancel on this market. */
  cancelAllCount: number;
  cancelAllRunning: boolean;
}

/** How long a result stays in the strip. */
const ACCEPTED_MS = 6000;
const REJECTED_MS = 8000;
/** An unknown outcome stays long enough to be read and acted on. */
const UNKNOWN_MS = 30000;

function defaultSize(market: Market): string {
  const ui = marketUi(market);
  return ui.defaultPresetIndex === null ? '' : String(ui.sizePresets[ui.defaultPresetIndex]);
}

/** The defaults-bar types whose second value is set in the order popover. */
function isTicketKind(t: OrderType): t is TicketKind {
  return extraField(t) !== null && (t === 'STOP_LIMIT' || t === 'TRAILING_STOP' || t === 'ICEBERG');
}

export function TradingLadder(props: TradingLadderProps) {
  const { market, orderBook, signedIn, onSubmitOrder, onRequestSignIn, rejectNotice } = props;
  const { onCancelOrder, onReplaceOrder } = props;
  const status = props.status ?? 'connected';
  const phone = props.variant === 'phone';
  const active = props.active ?? true;
  const { assets, refresh: refreshBalances } = useBalances();

  // Size belongs to the market it was typed on; a switch starts from the
  // next market's default preset. Type and TIF carry over.
  const [sizeSel, setSizeSel] = useState<{ marketId: number; size: string } | null>(null);
  const size = sizeSel && sizeSel.marketId === market.id ? sizeSel.size : defaultSize(market);
  const [type, setType] = useState<OrderType>('LIMIT');
  const [tif, setTif] = useState<TimeInForce>('GTC');
  const defaults: Defaults = useMemo(() => ({ size, type, tif }), [size, type, tif]);
  // The Price field belongs to the market it was typed on, like the size.
  const [priceSel, setPriceSel] = useState<{ marketId: number; text: string } | null>(null);
  const priceText = priceSel && priceSel.marketId === market.id ? priceSel.text : '';
  const priceField = useMemo(() => parsePriceField(market, priceText), [market, priceText]);

  const [stagedRaw, setStaged] = useState<Staged | null>(null);
  // A staged order never survives a market switch.
  const staged = stagedRaw && stagedRaw.marketId === market.id ? stagedRaw : null;
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<StripResult | null>(null);
  const resultTimer = useRef<number | null>(null);

  // ---- one-click ----------------------------------------------------------
  // Off by default, never persisted. Remembered with the market it was armed
  // on, so it reads as off the moment the market changes; the effect below
  // then clears it for good (switching back does not re-arm).
  const [armedOn, setArmedOn] = useState<number | null>(null);
  // Never on touch: a tap always stages (DESIGN.md rule 10).
  const engineWait = props.engineWait ?? null;
  const oneClickAvailable = !phone && signedIn && status === 'connected' && engineWait === null;
  const armed = armedOn !== null && armedOn === market.id && oneClickAvailable;
  useEffect(() => {
    setArmedOn(null);
  }, [market.id]);
  useEffect(() => {
    if (!oneClickAvailable) setArmedOn(null);
  }, [oneClickAvailable]);

  // ---- overlays: rung menu, order popover, chip menus ----------------------
  const [rungMenu, setRungMenu] = useState<{ marketId: number; price: number; anchor: Anchor } | null>(null);
  const [ticket, setTicket] = useState<{
    marketId: number;
    kind: TicketKind;
    side: OrderSide;
    price: number;
    anchor: Anchor;
  } | null>(null);
  const [chipOverlays, setChipOverlays] = useState(0);
  const onChipOverlay = useCallback((open: boolean) => setChipOverlays(n => Math.max(0, n + (open ? 1 : -1))), []);
  const menuNow = rungMenu && rungMenu.marketId === market.id ? rungMenu : null;
  const ticketNow = ticket && ticket.marketId === market.id ? ticket : null;
  // Where the last pointer went down in this column: a rung click that opens
  // a popover anchors it there.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // ---- own-order actions ----------------------------------------------------
  const [pending, setPending] = useState<ReadonlyMap<string, PendingKind>>(() => new Map());
  const setPendingFor = useCallback((ids: string[], kind: PendingKind | null) => {
    setPending(prev => {
      const next = new Map(prev);
      for (const id of ids) {
        if (kind) next.set(id, kind);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const [cancelAsk, setCancelAsk] = useState<{ marketId: number } | null>(null);
  const [cancelRun, setCancelRun] = useState<{ marketId: number; count: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The phone sheet lives in a portal: Enter and Esc count there too. */
  const sheetRef = useRef<HTMLDivElement>(null);

  const showResult = useCallback((r: StripResult | null) => {
    if (resultTimer.current) window.clearTimeout(resultTimer.current);
    setResult(r);
    if (r) {
      const ms = r.kind === 'accepted' ? ACCEPTED_MS : r.kind === 'unknown' ? UNKNOWN_MS : REJECTED_MS;
      resultTimer.current = window.setTimeout(() => setResult(null), ms);
    }
  }, []);
  useEffect(() => () => {
    if (resultTimer.current) window.clearTimeout(resultTimer.current);
  }, []);

  // Any change to what Enter would send asks for the confirmation again.
  useEffect(() => {
    setConfirming(false);
  }, [stagedRaw, size, type, tif, market.id]);

  const bestBid = orderBook.bids[0]?.price ?? null;
  const bestAsk = orderBook.asks[0]?.price ?? null;

  /** Send one staged order through the page's submit handler and report the
   *  result in the strip. */
  const submit = useCallback(
    async (s: Staged, oneClick: boolean) => {
      const b = buildStaged(market, s, defaults, '', Date.now());
      if (!b.ok) return false;
      const eff = effectiveDefaults(s, defaults);
      const t = stagedType(s, defaults);
      const text = describeStaged(market, s, defaults);
      const submitProps = orderSubmitProps({
        market,
        orderType: t,
        side: s.side,
        timeInForce: eff.tif,
        fromBookClick: s.price !== null,
        usedSlider: false,
      });
      track(EV.order_submit, submitProps);
      const startedAt = Date.now();
      setPlacing(true);
      let res: OrderAnswer;
      try {
        res = await onSubmitOrder(b.order);
      } finally {
        setPlacing(false);
      }
      const roundTripMs = Date.now() - startedAt;
      setConfirming(false);
      const undecided = undecidedResult(text, res);
      if (undecided) {
        track(EV.order_rejected, { ...submitProps, round_trip_ms: roundTripMs, reason: res.message.slice(0, 120) });
        // Outcome unknown: the order may be on the book, so it is not kept
        // staged for another Enter. Nothing sent: it stays staged to place
        // again (a one-click order is staged for the same reason).
        if (res.outcomeUnknown) setStaged(null);
        else if (oneClick) setStaged(s);
        showResult(undecided);
        if (res.outcomeUnknown) refreshBalances();
      } else if (res.success) {
        track(EV.order_accepted, { ...submitProps, round_trip_ms: roundTripMs });
        showResult({ kind: 'accepted', text: `Accepted: ${text}` });
        if (!oneClick) setStaged(null);
        refreshBalances();
      } else {
        track(EV.order_rejected, { ...submitProps, round_trip_ms: roundTripMs, reason: res.message.slice(0, 120) });
        // A staged order is kept so it can be corrected and placed again; a
        // rejected one-click order is staged for the same reason.
        if (oneClick) setStaged(s);
        showResult({ kind: 'rejected', text: `Rejected: ${res.message}` });
      }
      return res.success;
    },
    [market, defaults, onSubmitOrder, showResult, refreshBalances],
  );

  const snap = useCallback(
    (price: number): number | null => {
      const t = snapPriceText(market, String(price));
      return t === null ? null : Number(t);
    },
    [market],
  );

  /** Stage at a rung (or as market with a null price). */
  const stage = useCallback(
    (side: OrderSide, price: number | null, ticketValues?: Staged['ticket']) => {
      let snapped: number | null = null;
      if (price !== null) {
        snapped = snap(price);
        if (snapped === null) return; // out of range: not a stageable rung
      }
      setCancelAsk(null);
      setStaged({ marketId: market.id, side, price: snapped, ...(ticketValues ? { ticket: ticketValues } : {}) });
    },
    [market, snap],
  );

  /** A click on a rung cell, or B / S on the focused rung (`anchorEl` is
   *  the focused cell, where a popover then opens). */
  const onCellClick = useCallback(
    (side: OrderSide, price: number, anchorEl?: HTMLElement) => {
      const snapped = snap(price);
      if (snapped === null) return;
      setPriceSel({ marketId: market.id, text: priceFieldText(market, snapped) });
      // Types with a second value go through their popover.
      if (isTicketKind(type)) {
        const at = lastPointer.current;
        setTicket({
          marketId: market.id,
          kind: type,
          side,
          price: snapped,
          anchor: anchorEl ? { current: anchorEl } : (at ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 }),
        });
        return;
      }
      if (armed && !placing && oneClickPlaces(type, side, snapped, bestBid, bestAsk)) {
        const s: Staged = { marketId: market.id, side, price: snapped };
        if (buildStaged(market, s, defaults, '', 0).ok) {
          setStaged(null);
          void submit(s, true);
          return;
        }
      }
      stage(side, snapped);
    },
    [snap, type, market, armed, placing, bestBid, bestAsk, defaults, submit, stage],
  );

  /** Buy limit / Sell limit at the Price field: a limit order whatever the
   *  defaults bar's type, otherwise the rung click's path. */
  const limitAtField = useCallback(
    (side: OrderSide) => {
      if (!priceField.ok) return;
      const price = priceField.price;
      const s: Staged = { marketId: market.id, side, price, ticket: { type: 'LIMIT' } };
      if (armed && !placing && oneClickPlaces('LIMIT', side, price, bestBid, bestAsk)) {
        if (buildStaged(market, s, defaults, '', 0).ok) {
          setStaged(null);
          void submit(s, true);
          return;
        }
      }
      stage(side, price, { type: 'LIMIT' });
    },
    [priceField, market, armed, placing, bestBid, bestAsk, defaults, submit, stage],
  );

  const clear = useCallback(() => {
    setStaged(null);
    setConfirming(false);
  }, []);

  const effType = staged ? stagedType(staged, defaults) : null;
  const built = useMemo(
    () => (staged ? buildStaged(market, staged, defaults, '', 0) : null),
    [market, staged, defaults],
  );

  const view: StagedView | null = useMemo(() => {
    if (!staged || !effType || !built) return null;
    const eff = effectiveDefaults(staged, defaults);
    const total = stagedTotal(effType, staged.price, eff.size);
    const totalText =
      total === null
        ? ''
        : ` · ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${market.quoteAsset}`;
    const cross = crossing(effType, staged.side, staged.price, bestBid, bestAsk);
    const summary = `${typeLabel(effType)} · ${tifChoice(eff.tif).label}`;
    return {
      side: staged.side,
      text: describeStaged(market, staged, defaults),
      details: `${summary}${totalText}`,
      summary,
      totalText: totalText === '' ? null : totalText.slice(3),
      problem: built.ok ? null : built.error,
      warning:
        cross === 'executes'
          ? 'Crosses the spread: executes now'
          : cross === 'post-only-rejects'
            ? 'Crosses the spread: post only will be rejected'
            : null,
      confirming,
      isMarket: effType === 'MARKET',
    };
  }, [staged, effType, built, market, defaults, bestBid, bestAsk, confirming]);

  const place = useCallback(async () => {
    if (!staged || placing || !effType) return;
    if (!signedIn) {
      onRequestSignIn();
      return;
    }
    if (!buildStaged(market, staged, defaults, '', 0).ok) return; // the strip already shows why
    // Market orders always take a second confirmation, armed or not.
    if (effType === 'MARKET' && !confirming) {
      setConfirming(true);
      return;
    }
    await submit(staged, false);
  }, [staged, placing, effType, signedIn, onRequestSignIn, market, defaults, confirming, submit]);

  // ---- own orders: cancel, move, cancel all --------------------------------
  const marketOrders = useMemo(
    () => props.openOrders.filter(o => o.marketId === market.id && o.omsOrderId !== ''),
    [props.openOrders, market.id],
  );

  const orderText = useCallback(
    (o: UserOrder) => {
      // Orders from the all-orders dialog may be on another market.
      const m = o.marketId === market.id ? market : (findMarket(o.marketId) ?? market);
      // A stop awaiting its trigger has no price the UI can show (the order
      // model carries no trigger price): name it instead of printing one.
      return o.status === 'PENDING_TRIGGER'
        ? `${o.side === 'BID' ? 'Buy' : 'Sell'} ${o.remainingQuantity} ${m.baseAsset} stop, awaiting trigger`
        : `${o.side === 'BID' ? 'Buy' : 'Sell'} ${o.remainingQuantity} ${m.baseAsset} @ ${formatPriceText(m, o.price)}`;
    },
    [market],
  );

  const cancelOne = useCallback(
    async (o: UserOrder): Promise<CancelResult | null> => {
      if (!onCancelOrder || !o.omsOrderId) return null;
      setPendingFor([o.omsOrderId], 'cancel');
      let res: OrderAnswer;
      try {
        res = await onCancelOrder(o);
      } catch (err) {
        res = { success: false, message: err instanceof Error ? err.message : 'Network error' };
      } finally {
        setPendingFor([o.omsOrderId], null);
      }
      showResult(
        undecidedResult(`cancel ${orderText(o)}`, res) ??
          (res.success
            ? { kind: 'accepted', text: `Cancelled: ${orderText(o)}` }
            : { kind: 'rejected', text: `Cancel failed: ${orderText(o)}: ${res.message}` }),
      );
      return { order: o, success: res.success, message: res.message };
    },
    [onCancelOrder, setPendingFor, showResult, orderText],
  );

  const moveOne = useCallback(
    async (o: UserOrder, price: number) => {
      if (!onReplaceOrder || !o.omsOrderId) return;
      setPendingFor([o.omsOrderId], 'move');
      let res: OrderAnswer;
      try {
        // Price only: the quantity stays as it is (DESIGN.md rule 13).
        res = await onReplaceOrder(o, price);
      } catch (err) {
        res = { success: false, message: err instanceof Error ? err.message : 'Network error' };
      } finally {
        setPendingFor([o.omsOrderId], null);
      }
      const to = formatPriceText(market, price);
      showResult(
        undecidedResult(`move ${orderText(o)} to ${to}`, res) ??
          (res.success
            ? { kind: 'accepted', text: `Moved to ${to} (re-queued): ${orderText(o)}` }
            : { kind: 'rejected', text: `Move failed: ${orderText(o)} to ${to}: ${res.message}` }),
      );
    },
    [onReplaceOrder, setPendingFor, showResult, orderText, market],
  );

  /** Cancel `targets` one at a time and report the run in the strip. */
  const runCancels = useCallback(
    async (targets: readonly UserOrder[], label: string): Promise<CancelResult[]> => {
      if (!onCancelOrder || targets.length === 0) return [];
      setPendingFor(targets.map(o => o.omsOrderId), 'cancel');
      const results: CancelResult[] = [];
      // One at a time: there is no bulk endpoint, and a sequential loop keeps
      // the OMS from seeing a burst.
      for (const o of targets) {
        let res: OrderAnswer;
        try {
          res = await onCancelOrder(o);
        } catch (err) {
          res = { success: false, message: err instanceof Error ? err.message : 'Network error' };
        }
        setPendingFor([o.omsOrderId], null);
        // An unknown outcome is a failure to report, never a success.
        const message = res.outcomeUnknown ? `outcome unknown, it may have been cancelled: ${res.message}` : res.message;
        results.push({ order: o, success: res.success, message });
      }
      const sum = cancelAllSummary(results, label);
      const failedDetail = results
        .filter(r => !r.success)
        .map(r => `${orderText(r.order)}: ${r.message}`)
        .join('\n');
      showResult(
        sum.ok
          ? { kind: 'accepted', text: sum.text }
          : { kind: 'rejected', text: sum.text, code: failedDetail || null },
      );
      return results;
    },
    [onCancelOrder, setPendingFor, orderText, showResult],
  );

  const cancelAll = useCallback(async () => {
    if (!onCancelOrder) return;
    const targets = marketOrders.filter(o => !pending.has(o.omsOrderId));
    setCancelAsk(null);
    if (targets.length === 0) return;
    setCancelRun({ marketId: market.id, count: targets.length });
    try {
      await runCancels(targets, 'Cancel all');
    } finally {
      setCancelRun(null);
    }
  }, [onCancelOrder, marketOrders, pending, market.id, runCancels]);

  // Orders already in flight are skipped, as Cancel all does.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const cancelMany = useCallback(
    (orders: readonly UserOrder[]) =>
      runCancels(
        orders.filter(o => o.omsOrderId !== '' && !pendingRef.current.has(o.omsOrderId)),
        'Cancel selected',
      ),
    [runCancels],
  );

  const ownActions: OwnOrderActions | undefined = useMemo(
    () =>
      signedIn && onCancelOrder && onReplaceOrder
        ? {
            market,
            pending,
            onCancel: o => void cancelOne(o),
            onMove: (o, p) => void moveOne(o, p),
            onOverlay: onChipOverlay,
          }
        : undefined,
    [signedIn, onCancelOrder, onReplaceOrder, market, pending, cancelOne, moveOne, onChipOverlay],
  );

  const running = cancelRun !== null && cancelRun.marketId === market.id;
  const asking = cancelAsk !== null && cancelAsk.marketId === market.id;

  // Cancel all asked from a side panel: focus goes to the strip's confirm
  // button once it is on screen, so Enter answers and Esc keeps.
  const focusConfirm = useRef(false);
  const askFromPanel = useCallback(() => {
    focusConfirm.current = true;
    setCancelAsk({ marketId: market.id });
  }, [market.id]);
  useEffect(() => {
    if (!asking || !focusConfirm.current) return;
    focusConfirm.current = false;
    const sel = '[data-cancel-all-confirm]';
    (rootRef.current?.querySelector<HTMLElement>(sel) ?? sheetRef.current?.querySelector<HTMLElement>(sel))?.focus();
  }, [asking]);

  const { onOrderActions } = props;
  const panelActions: LadderOrderActions | null = useMemo(
    () =>
      signedIn && onCancelOrder
        ? {
            pending,
            cancel: cancelOne,
            cancelMany,
            askCancelAll: askFromPanel,
            cancelAllCount: running ? cancelRun!.count : marketOrders.length,
            cancelAllRunning: running,
          }
        : null,
    [signedIn, onCancelOrder, pending, cancelOne, cancelMany, askFromPanel, running, cancelRun, marketOrders.length],
  );
  useEffect(() => {
    onOrderActions?.(panelActions);
  }, [onOrderActions, panelActions]);
  useEffect(() => () => onOrderActions?.(null), [onOrderActions]);
  const cancelAllView: CancelAllView | null =
    signedIn && onCancelOrder && (marketOrders.length > 0 || running)
      ? {
          count: running ? cancelRun!.count : marketOrders.length,
          scope: market.symbol,
          asking: asking && !running,
          running,
          onAsk: () => setCancelAsk({ marketId: market.id }),
          onConfirm: () => void cancelAll(),
          onDismiss: () => setCancelAsk(null),
        }
      : null;

  // ---- keyboard ----------------------------------------------------------
  const announce = useCallback((text: string) => showResult({ kind: 'info', text }), [showResult]);
  const ui = marketUi(market);

  /** The order-entry keys the ladder grid hands over. */
  const onCommand = (cmd: PassedCommand) => {
    switch (cmd.kind) {
      case 'stageMarket':
        stage(cmd.side, null);
        return;
      case 'preset': {
        const p = ui.sizePresets[cmd.index];
        if (p === undefined) {
          announce(`No size preset ${cmd.index + 1} on ${market.symbol}`);
          return;
        }
        setSizeSel({ marketId: market.id, size: String(p) });
        announce(`Size ${formatCompactSize(p, ui.sizeDecimals)} ${market.baseAsset}`);
        return;
      }
      case 'sizeStep': {
        const next = stepSize(market, size, cmd.dir);
        if (next === null) {
          announce(`No size step on ${market.symbol}: type a size`);
          return;
        }
        setSizeSel({ marketId: market.id, size: next });
        announce(`Size ${next} ${market.baseAsset}`);
        return;
      }
      case 'nextType': {
        const t = nextType(type);
        setType(t);
        announce(`Order type: ${typeLabel(t)}`);
        return;
      }
      case 'nextTif': {
        const c = tifChoice(nextTif(tif));
        setTif(c.tif);
        announce(`Time in force: ${c.label}, ${c.long}`);
        return;
      }
      case 'toggleOneClick':
        if (phone) {
          announce('One-click is not available on a phone: a tap stages');
          return;
        }
        if (armed) {
          setArmedOn(null);
          return;
        }
        if (!oneClickAvailable) {
          announce(signedIn ? 'One-click needs a live connection' : 'Sign in to arm one-click');
          return;
        }
        setArmedOn(market.id);
        return;
      case 'cancelAll':
        if (!signedIn || !onCancelOrder) announce('Sign in to cancel orders');
        else if (running) announce('Cancel all is already running');
        else if (marketOrders.length === 0) announce(`No open orders on ${market.symbol}`);
        else setCancelAsk({ marketId: market.id });
        return;
    }
  };

  const ladderHandle = useRef<LadderHandle>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // L and ?, from anywhere outside text fields, menus and dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const cmd = globalCommand(e);
      if (!cmd) return;
      if (isTypingTarget(e.target) || inOverlay(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (cmd === 'help') setShortcutsOpen(true);
      else ladderHandle.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Enter and Esc. Latest handlers through a ref so the listener is stable.
  const confirmAll = cancelAllView?.asking ?? false;
  const keys = useRef({ place, clear, staged: staged !== null, armed, asking, confirmAll, cancelAll });
  useEffect(() => {
    keys.current = { place, clear, staged: staged !== null, armed, asking, confirmAll, cancelAll };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      const k = keys.current;
      const root = rootRef.current;
      const t = e.target;
      const onPage = t === document.body || t === document.documentElement || t === document;
      const sheet = sheetRef.current;
      const inRoot = t instanceof Node && ((root !== null && root.contains(t)) || (sheet !== null && sheet.contains(t)));
      if (e.key === 'Escape') {
        let handled = false;
        // Esc disarms one-click wherever focus is (DESIGN.md rule 10).
        if (k.armed) {
          setArmedOn(null);
          handled = true;
        }
        if ((onPage || inRoot) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          // Esc also ends a scroll pin: back to the last price.
          ladderHandle.current?.recentre();
          if (k.asking) {
            setCancelAsk(null);
            handled = true;
          }
          if (k.staged) {
            k.clear();
            handled = true;
          }
        }
        if (handled) e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (!k.staged && !k.confirmAll) return;
      if (isTypingTarget(t)) return;
      const onGrid = inRoot && t instanceof HTMLElement && t.closest('[role="grid"]') !== null;
      if (!onPage && !onGrid) return;
      e.preventDefault();
      // The Cancel all question is on screen (it replaces the stage there):
      // Enter answers it.
      if (k.confirmAll) void k.cancelAll();
      else void k.place();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The async reject (order stream) wins over a local result: it is the one
  // the user cannot otherwise see.
  const priceProblem = priceField.ok ? null : priceField.error;
  const shown: StripResult | null = rejectNotice
    ? { kind: 'rejected', text: rejectNotice.text, code: rejectNotice.code }
    : (result ??
      (engineWait !== null
        ? { kind: 'waiting', text: engineWait }
        : !phone && priceProblem !== null
          ? { kind: 'info', text: priceProblem }
          : null));

  const sizeOk = parseSize(size) !== null;
  const reference = menuReference(props.lastPrice, bestBid, bestAsk);
  // The ladder pins only while one of these lasts (DESIGN.md rule 8); its
  // end re-centres the window on the last price.
  const hold = armed || staged !== null || menuNow !== null || ticketNow !== null || chipOverlays > 0;

  // ---- phone: grouping in the settings row, % sizing in the sheet ---------
  const [groupSel, setGroupSel] = useState<{ marketId: number; mult: number } | null>(null);
  const groupTicks = groupSel && groupSel.marketId === market.id ? groupSel.mult : ui.defaultGrouping;
  const groupOptions = useMemo(() => groupingOptions(market), [market]);
  const spendAsset = staged ? (staged.side === 'BID' ? market.quoteAsset : market.baseAsset) : null;
  const spendBalance = spendAsset ? assets.find(a => a.asset === spendAsset) : undefined;
  const percent =
    phone && signedIn && staged && !staged.ticket && spendBalance
      ? {
          assetText: spendAsset!,
          available: spendBalance.available,
          onPick: (pct: number) =>
            setSizeSel({
              marketId: market.id,
              size: sizeForPercent({
                side: staged.side,
                available: spendBalance.available,
                percent: pct,
                price: staged.price !== null ? String(staged.price) : '',
                lastPrice: props.lastPrice,
              }),
            }),
        }
      : null;

  const openRungMenu = (price: number, anchor: Anchor) => {
    if (snap(price) === null) return;
    setRungMenu({ marketId: market.id, price, anchor });
  };

  const overlays = (
    <>
      {menuNow && (
        <RungMenu
          anchor={menuNow.anchor}
          priceText={formatPriceText(market, menuNow.price)}
          sizeText={sizeOk ? `${size.trim()} ${market.baseAsset}` : null}
          sides={rungMenuSides(menuNow.price, reference)}
          limitIsClick={type === 'LIMIT'}
          onClose={() => setRungMenu(null)}
          onLimit={side => stage(side, menuNow.price, { type: 'LIMIT' })}
          onStopLoss={side => stage(side, menuNow.price, { type: 'STOP_LOSS' })}
          onTicket={(kind, side) =>
            setTicket({ marketId: market.id, kind, side, price: menuNow.price, anchor: menuNow.anchor })
          }
          touch={phone}
        />
      )}
      {ticketNow && (
        <OrderPopover
          key={`${ticketNow.kind}-${ticketNow.side}-${ticketNow.price}`}
          market={market}
          kind={ticketNow.kind}
          side={ticketNow.side}
          price={ticketNow.price}
          size={size}
          tif={tif}
          anchor={ticketNow.anchor}
          onClose={() => setTicket(null)}
          onStage={s => {
            setTicket(null);
            setCancelAsk(null);
            setStaged(s);
          }}
          touch={phone}
        />
      )}
    </>
  );

  if (phone) {
    const sheet = (
      <PhoneSheet
        sheetRef={sheetRef}
        staged={active ? view : null}
        placing={placing}
        signedIn={signedIn}
        result={shown}
        cancelAll={cancelAllView}
        onPlace={() => void place()}
        onClear={clear}
        onMoreTypes={
          staged && staged.price !== null
            ? el => openRungMenu(staged.price!, { current: el })
            : null
        }
        percent={percent}
      />
    );
    return (
      <div
        ref={rootRef}
        className="flex min-h-0 flex-1 flex-col"
        onPointerDownCapture={e => {
          lastPointer.current = { x: e.clientX, y: e.clientY };
        }}
      >
        <PhoneOrderBar
          market={market}
          value={defaults}
          onSize={s => setSizeSel({ marketId: market.id, size: s })}
          onType={setType}
          onTif={setTif}
          grouping={{
            value: groupTicks,
            options: groupOptions,
            onChange: mult => setGroupSel({ marketId: market.id, mult }),
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col bg-surface">
          <Ladder
            market={market}
            orderBook={orderBook}
            levelChanges={props.levelChanges}
            openOrders={props.openOrders}
            lastPrice={props.lastPrice}
            sizeText={sizeOk ? size.trim() : null}
            onStage={onCellClick}
            staged={staged && staged.price !== null && effType !== 'MARKET' ? { side: staged.side, price: staged.price } : null}
            hold={hold}
            onRungMenu={openRungMenu}
            ownActions={ownActions}
            onCommand={onCommand}
            onAnnounce={announce}
            handleRef={ladderHandle}
            density="phone"
            grouping={{ value: groupTicks, onChange: mult => setGroupSel({ marketId: market.id, mult }) }}
          />
        </div>
        {props.sheetHost ? createPortal(sheet, props.sheetHost) : sheet}
        {overlays}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col"
      onPointerDownCapture={e => {
        lastPointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <OrderDefaults
        market={market}
        value={defaults}
        onSize={s => setSizeSel({ marketId: market.id, size: s })}
        onType={setType}
        onTif={setTif}
        oneClick={{
          armed,
          available: oneClickAvailable,
          onChange: on => setArmedOn(on && oneClickAvailable ? market.id : null),
        }}
        onShowShortcuts={() => setShortcutsOpen(true)}
        price={{
          text: priceText,
          problem: priceProblem,
          onChange: t => setPriceSel({ marketId: market.id, text: t }),
          onStep: dir =>
            setPriceSel({
              marketId: market.id,
              text: stepPriceField(market, priceText, dir, props.lastPrice ?? bestBid ?? bestAsk),
            }),
        }}
      />
      <StagingStrip
        staged={view}
        placing={placing}
        signedIn={signedIn}
        result={shown}
        armed={armed}
        cancelAll={cancelAllView}
        onPlace={() => void place()}
        onClear={clear}
        onMarket={side => stage(side, null)}
        limit={{
          onLimit: limitAtField,
          problem: priceField.ok ? null : (priceField.error ?? 'Enter a price'),
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Ladder
          market={market}
          orderBook={orderBook}
          levelChanges={props.levelChanges}
          openOrders={props.openOrders}
          lastPrice={props.lastPrice}
          sizeText={sizeOk ? size.trim() : null}
          onStage={onCellClick}
          staged={staged && staged.price !== null && effType !== 'MARKET' ? { side: staged.side, price: staged.price } : null}
          hold={hold}
          onRungMenu={openRungMenu}
          ownActions={ownActions}
          onCommand={onCommand}
          onAnnounce={announce}
          handleRef={ladderHandle}
          reveal={props.reveal ?? null}
        />
      </div>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {overlays}
    </div>
  );
}
