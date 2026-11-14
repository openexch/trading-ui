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
 * - Keyboard (DESIGN.md rule 11, keymap.ts): L focuses the ladder and ?
 *   opens the shortcut sheet from anywhere outside text fields, menus and
 *   dialogs. The rest work only while the ladder grid has focus: the grid
 *   handles moving focus and own orders (useLadderKeys) and hands the
 *   order-entry keys here (`onCommand`). Ctrl+Shift+X asks, Enter confirms.
 *   Keyboard feedback is announced through the strip only (rule 12).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { LevelChange } from '../../hooks/useOrderBook';
import { useBalances } from '../../hooks/useBalances';
import { EV, track } from '../../analytics';
import { marketUi } from '../../trading/marketUi';
import { orderSubmitProps, snapPriceText } from '../../trading/orderDraft';
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
import { stepSize } from '../../trading/marketUi';
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
import type { LadderHandle, PassedCommand } from './useLadderKeys';
import { globalCommand, inOverlay, isTypingTarget } from './keymap';
import { ShortcutsDialog } from './ShortcutsDialog';
import { formatCompactSize } from './format';

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
  /** Market-data connection state: one-click is armed only while connected. */
  status?: ExtendedConnectionStatus;
  /** The page's cancel handler (keyed on omsOrderId); resolves with the
   *  OMS answer. */
  onCancelOrder?: (order: UserOrder) => Promise<{ success: boolean; message: string }>;
  /** The page's replace handler; Move sends the price only. */
  onReplaceOrder?: (order: UserOrder, price?: number, quantity?: number) => Promise<{ success: boolean; message: string }>;
}

/** How long a result stays in the strip. */
const ACCEPTED_MS = 6000;
const REJECTED_MS = 8000;

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
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<StripResult | null>(null);
  const resultTimer = useRef<number | null>(null);

  // ---- one-click ----------------------------------------------------------
  // Off by default, never persisted. Remembered with the market it was armed
  // on, so it reads as off the moment the market changes; the effect below
  // then clears it for good (switching back does not re-arm).
  const [armedOn, setArmedOn] = useState<number | null>(null);
  const oneClickAvailable = signedIn && status === 'connected';
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
    return {
      side: staged.side,
      text: describeStaged(market, staged, defaults),
      details: `${typeLabel(effType)} · ${tifChoice(eff.tif).label}${totalText}`,
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
    (o: UserOrder) =>
      `${o.side === 'BID' ? 'Buy' : 'Sell'} ${o.remainingQuantity} ${market.baseAsset} @ ${formatPriceText(market, o.price)}`,
    [market],
  );

  const cancelOne = useCallback(
    async (o: UserOrder) => {
      if (!onCancelOrder || !o.omsOrderId) return;
      setPendingFor([o.omsOrderId], 'cancel');
      let res: { success: boolean; message: string };
      try {
        res = await onCancelOrder(o);
      } catch (err) {
        res = { success: false, message: err instanceof Error ? err.message : 'Network error' };
      } finally {
        setPendingFor([o.omsOrderId], null);
      }
      showResult(
        res.success
          ? { kind: 'accepted', text: `Cancelled: ${orderText(o)}` }
          : { kind: 'rejected', text: `Cancel failed: ${orderText(o)}: ${res.message}` },
      );
    },
    [onCancelOrder, setPendingFor, showResult, orderText],
  );

  const moveOne = useCallback(
    async (o: UserOrder, price: number) => {
      if (!onReplaceOrder || !o.omsOrderId) return;
      setPendingFor([o.omsOrderId], 'move');
      let res: { success: boolean; message: string };
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
        res.success
          ? { kind: 'accepted', text: `Moved to ${to} (re-queued): ${orderText(o)}` }
          : { kind: 'rejected', text: `Move failed: ${orderText(o)} to ${to}: ${res.message}` },
      );
    },
    [onReplaceOrder, setPendingFor, showResult, orderText, market],
  );

  const cancelAll = useCallback(async () => {
    if (!onCancelOrder) return;
    const targets = marketOrders.filter(o => !pending.has(o.omsOrderId));
    setCancelAsk(null);
    if (targets.length === 0) return;
    setCancelRun({ marketId: market.id, count: targets.length });
    setPendingFor(targets.map(o => o.omsOrderId), 'cancel');
    const results: CancelResult[] = [];
    // One at a time: there is no bulk endpoint, and a sequential loop keeps
    // the OMS from seeing a burst.
    for (const o of targets) {
      let res: { success: boolean; message: string };
      try {
        res = await onCancelOrder(o);
      } catch (err) {
        res = { success: false, message: err instanceof Error ? err.message : 'Network error' };
      }
      setPendingFor([o.omsOrderId], null);
      results.push({ order: o, success: res.success, message: res.message });
    }
    setCancelRun(null);
    const sum = cancelAllSummary(results);
    const failedDetail = results
      .filter(r => !r.success)
      .map(r => `${orderText(r.order)}: ${r.message}`)
      .join('\n');
    showResult(
      sum.ok
        ? { kind: 'accepted', text: sum.text }
        : { kind: 'rejected', text: sum.text, code: failedDetail || null },
    );
  }, [onCancelOrder, marketOrders, pending, market.id, setPendingFor, orderText, showResult]);

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
  const rootRef = useRef<HTMLDivElement>(null);
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
      const inRoot = root !== null && t instanceof Node && root.contains(t);
      if (e.key === 'Escape') {
        let handled = false;
        // Esc disarms one-click wherever focus is (DESIGN.md rule 10).
        if (k.armed) {
          setArmedOn(null);
          handled = true;
        }
        if ((onPage || inRoot) && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
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
  const shown: StripResult | null = rejectNotice
    ? { kind: 'rejected', text: rejectNotice.text, code: rejectNotice.code }
    : result;

  const sizeOk = parseSize(size) !== null;
  const reference = menuReference(props.lastPrice, bestBid, bestAsk);
  const hold = staged !== null || menuNow !== null || ticketNow !== null || chipOverlays > 0;

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
          onRungMenu={(price, anchor) => {
            if (snap(price) === null) return;
            setRungMenu({ marketId: market.id, price, anchor });
          }}
          ownActions={ownActions}
          onCommand={onCommand}
          onAnnounce={announce}
          handleRef={ladderHandle}
        />
      </div>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

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
        />
      )}
    </div>
  );
}
