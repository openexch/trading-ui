// SPDX-License-Identifier: Apache-2.0
/**
 * Keyboard focus and keys for the ladder grid (DESIGN.md rule 11).
 *
 * - Roving tabindex: the grid is one tab stop. The focused rung's price cell
 *   holds tabindex 0; every other cell is -1. Before any rung was focused,
 *   the tab stop is the row next to the spread marker (the best bid, else
 *   the best ask); once the focused rung has left the window, the nearest
 *   visible price. With no rows yet (skeletons) the grid itself is the stop.
 * - The focused rung is kept as its price, so focus follows the price, not
 *   the row, across live updates and re-centring (rows are keyed by price).
 *   Focus does not pin the ladder: when it re-centres under a focused rung,
 *   focus stays on that price while it is visible, else it lands on the
 *   nearest visible price.
 * - Rows are book levels only, so keys move between levels, not ticks.
 *   Arrow keys move focus one level (Shift: ten). Past the window's edge the
 *   window shifts with it and holds there until Re-centre or C.
 * - PageUp / PageDown scroll the window a page (slots - 1 levels) and move
 *   focus by the same amount; the window holds there until Re-centre, C or
 *   Esc.
 * - [ and ] step through own orders in ladder order (highest price first),
 *   wrapping; the window pins to the order's rung when it is outside.
 * - Del cancels and Alt+Up / Alt+Down move the selected own order (the one
 *   [ or ] picked, else the only own order on the focused rung). Move is for
 *   limit orders only; anything refused is announced through the staging
 *   strip, the one live region (rule 12).
 * - The other ladder keys (market stage, sizes, type, TIF, one-click,
 *   Cancel all) are handed to the caller through `onCommand`.
 * - Keys are read only when the event comes from the grid itself, never
 *   from an input or an open menu or popover that React bubbles through it.
 * - `reveal` (Show on ladder) brings an own order's rung into view the way
 *   [ and ] do, and focuses it, once the window has rows on that market.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, FocusEvent as ReactFocusEvent, Ref } from 'react';
import type { Market, UserOrder } from '../../types/market';
import { canMove, stepPrice } from '../../trading/orderActions';
import { formatPriceText, typeLabel } from '../../trading/staging';
import { marketUi } from '../../trading/marketUi';
import { formatCompactSize } from './format';
import { levelIndex, rungOf, rungPrice, toTicks } from './ladderModel';
import type { LadderModel, LadderSide, LadderWindow, OwnPlacement } from './ladderModel';
import type { OwnOrderActions } from './OwnOrderChip';
import { inOverlay, isTypingTarget, ladderCommand } from './keymap';
import type { LadderCommand } from './keymap';

/** Commands the ladder leaves to its caller. */
export type PassedCommand = Extract<
  LadderCommand,
  { kind: 'stageMarket' | 'preset' | 'sizeStep' | 'nextType' | 'nextTif' | 'toggleOneClick' | 'cancelAll' }
>;

/** An own order to bring into view and focus, acted on once per `seq`. */
export interface LadderReveal {
  seq: number;
  order: UserOrder;
}

export interface LadderHandle {
  /** Move keyboard focus to the ladder (the L key). */
  focus: () => void;
  /** Drop a scroll pin and centre on the last price (Esc). */
  recentre: () => void;
}

export interface LadderKeysOptions {
  market: Market;
  model: LadderModel;
  view: LadderWindow | null;
  pinTo: (rung: number) => void;
  /** Move the window by levels (positive: lower prices) and hold it. */
  scrollBy: (levels: number) => void;
  recentre: () => void;
  ownActions?: OwnOrderActions;
  onStage?: (side: LadderSide, price: number, anchor?: HTMLElement) => void;
  onCommand?: (cmd: PassedCommand) => void;
  onAnnounce?: (text: string) => void;
  handleRef?: Ref<LadderHandle>;
  reveal?: LadderReveal | null;
}

interface FocusState {
  marketId: number;
  /** The focused rung, as its price. */
  price: number;
  /** The own order [ or ] picked (or Alt+arrows moved), by key. */
  orderKey: string | null;
}

export function ownKey(o: UserOrder): string {
  return o.omsOrderId !== '' ? o.omsOrderId : `id:${o.orderId}`;
}

/** Own orders in ladder order: highest price first, then oldest first. */
export function ownInLadderOrder(model: LadderModel): OwnPlacement[] {
  return [...model.own].sort((a, b) => b.order.price - a.order.price || a.order.timestamp - b.order.timestamp);
}

const FOCUS_CELL = '[data-focus-cell]';

export function useLadderKeys(opts: LadderKeysOptions) {
  const { market, model, view, pinTo, scrollBy, recentre, ownActions, onStage, onCommand, onAnnounce } = opts;
  const [focusRaw, setFocus] = useState<FocusState | null>(null);
  const focus = focusRaw && focusRaw.marketId === market.id ? focusRaw : null;
  const [gridEl, setGridEl] = useState<HTMLElement | null>(null);
  /** Set when a key moved focus to the focus state it set. Only the commit
   *  that renders that state may act on it: an earlier commit (an unrelated
   *  render whose effects run after the key) still has the old tab stop and
   *  must leave the request for the commit that carries the new one. */
  const wantFocus = useRef<FocusState | null>(null);
  /** The element inside the grid that last had focus (see the effect). */
  const lastFocused = useRef<HTMLElement | null>(null);

  const { grid, groupTicks } = model;
  const rungOfPrice = useCallback(
    (price: number) => Math.floor(toTicks(grid, price) / groupTicks),
    [grid, groupTicks],
  );
  const priceOf = useCallback((rung: number) => rungPrice(grid, groupTicks, rung), [grid, groupTicks]);

  const rows = view?.rows ?? [];
  const visible = (rung: number) => rows.some(r => r.rung === rung);
  const focusRung = focus ? rungOfPrice(focus.price) : null;
  let tabStopRung: number | null = null;
  if (focusRung !== null && visible(focusRung)) tabStopRung = focusRung;
  else if (rows.length > 0) {
    if (focusRung !== null) {
      // The focused price left the window (a re-centre) or its level went:
      // the nearest visible price takes the focus.
      let best = rows[0].rung;
      for (const r of rows) if (Math.abs(r.rung - focusRung) < Math.abs(best - focusRung)) best = r.rung;
      tabStopRung = best;
    } else {
      // The row next to the spread marker: the best bid, else the best ask.
      const at = view!.spreadAt;
      const i = at === null ? (rows.length - 1) >> 1 : at < rows.length ? at : rows.length - 1;
      tabStopRung = rows[i].rung;
    }
  }

  // Focus follows keys: after a key moved the focused rung, focus its cell.
  // Also keep focus in the grid when the focused element was removed (a
  // resize dropped its row), and hand it from the grid to a cell once rows
  // arrive (L pressed before the first snapshot).
  useEffect(() => {
    if (!gridEl) return;
    const cell = gridEl.querySelector<HTMLElement>(`${FOCUS_CELL}[tabindex="0"]`);
    const active = document.activeElement;
    const lost =
      lastFocused.current !== null &&
      !lastFocused.current.isConnected &&
      (active === null || active === document.body);
    const wanted = wantFocus.current !== null && wantFocus.current === focusRaw;
    if (wanted || lost || (active === gridEl && cell)) {
      if (wanted) wantFocus.current = null;
      if (cell) {
        if (active !== cell) cell.focus();
      } else if (active !== gridEl) {
        gridEl.focus();
      }
    }
  });

  useImperativeHandle(
    opts.handleRef,
    () => ({
      focus: () => {
        if (!gridEl) return;
        const cell = gridEl.querySelector<HTMLElement>(`${FOCUS_CELL}[tabindex="0"]`);
        (cell ?? gridEl).focus();
      },
      recentre,
    }),
    [gridEl, recentre],
  );

  const announce = (text: string) => onAnnounce?.(text);

  const focusRungAt = (rung: number, orderKey: string | null) => {
    const next: FocusState = { marketId: market.id, price: priceOf(rung), orderKey };
    setFocus(next);
    wantFocus.current = next;
  };

  // Show on ladder: once per request, when the window has rows on the
  // order's market. The rung is the one the order's chip is drawn on.
  const revealed = useRef<number | null>(null);
  const reveal = opts.reveal ?? null;
  useEffect(() => {
    if (!reveal || revealed.current === reveal.seq) return;
    if (reveal.order.marketId !== market.id || !view || view.rows.length === 0) return;
    revealed.current = reveal.seq;
    const key = ownKey(reveal.order);
    const side: LadderSide = reveal.order.side === 'BID' ? 'BID' : 'ASK';
    const rung = model.own.find(p => ownKey(p.order) === key)?.rung ?? rungOf(grid, groupTicks, reveal.order.price, side);
    if (!visible(rung)) pinTo(rung);
    focusRungAt(rung, key);
  });

  /** The own order Del and Alt+arrows act on, or null (and why, announced). */
  const selectedOrder = (rung: number): UserOrder | null => {
    if (focus?.orderKey) {
      const picked = model.own.find(p => ownKey(p.order) === focus.orderKey);
      if (picked) return picked.order;
    }
    const here = model.own.filter(p => p.rung === rung);
    const at = formatPriceText(market, priceOf(rung));
    if (here.length === 1) return here[0].order;
    if (here.length === 0) announce(`No order of yours at ${at}`);
    else announce(`${here.length} orders of yours at ${at}: press [ or ] to pick one`);
    return null;
  };

  const orderText = (o: UserOrder) =>
    `${o.side === 'BID' ? 'Buy' : 'Sell'} ${formatCompactSize(o.remainingQuantity, marketUi(market).sizeDecimals)} ${
      market.baseAsset
    } @ ${formatPriceText(market, o.price)}`;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as Node;
    // React bubbles events from portals (chip menus, popovers) through the
    // grid; their keys are theirs.
    if (!(target instanceof Node) || !e.currentTarget.contains(target)) return;
    if (isTypingTarget(e.target) || inOverlay(e.target)) return;
    const cmd = ladderCommand(e);
    if (!cmd) return;

    const cur = focusRung !== null && visible(focusRung) ? focusRung : tabStopRung;

    switch (cmd.kind) {
      case 'move': {
        if (cur === null || !view || model.levels.length === 0) return;
        e.preventDefault();
        // Levels run highest first: up (a positive count) is a lower index.
        const L = model.levels.length;
        const next = Math.min(L - 1, Math.max(0, levelIndex(model, cur) - cmd.rungs));
        const last = view.start + view.count - 1;
        if (next < view.start) scrollBy(next - view.start);
        else if (next > last) scrollBy(next - last);
        focusRungAt(model.levels[next], null);
        return;
      }
      case 'page': {
        if (!view) return;
        e.preventDefault();
        // PageUp (dir 1) shows higher prices: the window moves up the list.
        const step = Math.max(1, view.count - 1) * cmd.dir;
        scrollBy(-step);
        if (cur !== null && model.levels.length > 0) {
          const L = model.levels.length;
          focusRungAt(model.levels[Math.min(L - 1, Math.max(0, levelIndex(model, cur) - step))], null);
        }
        return;
      }
      case 'recentre': {
        e.preventDefault();
        recentre();
        // Focus the row next to the marker: the last trade when it is a
        // level, else the best bid, else the best ask.
        const last = model.lastTradeRung;
        const anchor =
          last !== null && model.levels.includes(last) ? last : (model.bestBidRung ?? model.bestAskRung ?? cur);
        if (anchor !== null) focusRungAt(anchor, null);
        return;
      }
      case 'stage': {
        if (cur === null || !onStage) return;
        e.preventDefault();
        const cell = gridEl?.querySelector<HTMLElement>(`${FOCUS_CELL}[tabindex="0"]`) ?? undefined;
        onStage(cmd.side, priceOf(cur), cell);
        return;
      }
      case 'ownOrder': {
        e.preventDefault();
        const list = ownInLadderOrder(model);
        if (list.length === 0) {
          announce(`No open orders of yours on ${market.symbol}`);
          return;
        }
        let i = focus?.orderKey ? list.findIndex(p => ownKey(p.order) === focus.orderKey) : -1;
        if (i >= 0) {
          i = (i + cmd.dir + list.length) % list.length;
        } else if (cur !== null && cmd.dir > 0) {
          // From the focused rung downwards (an order on it counts).
          i = list.findIndex(p => p.rung <= cur);
          if (i < 0) i = 0;
        } else if (cur !== null) {
          // From the focused rung upwards.
          i = -1;
          for (let k = list.length - 1; k >= 0; k--) {
            if (list[k].rung >= cur) {
              i = k;
              break;
            }
          }
          if (i < 0) i = list.length - 1;
        } else {
          i = cmd.dir > 0 ? 0 : list.length - 1;
        }
        const p = list[i];
        if (!visible(p.rung)) pinTo(p.rung);
        focusRungAt(p.rung, ownKey(p.order));
        announce(`Order ${i + 1} of ${list.length}: ${orderText(p.order)}`);
        return;
      }
      case 'cancelOwn':
      case 'moveOwn': {
        if (cur === null) return;
        e.preventDefault();
        if (!ownActions) {
          announce('Sign in to manage your orders');
          return;
        }
        const o = selectedOrder(cur);
        if (!o) return;
        if (o.omsOrderId === '') {
          announce(`${orderText(o)} cannot be changed yet`);
          return;
        }
        if (ownActions.pending.has(o.omsOrderId)) {
          announce(`${orderText(o)} already has a request in flight`);
          return;
        }
        if (cmd.kind === 'cancelOwn') {
          ownActions.onCancel(o);
          return;
        }
        if (!canMove(o)) {
          announce(`${typeLabel(o.type)} orders cannot be moved: cancel instead`);
          return;
        }
        const to = stepPrice(market, o.price, groupTicks, cmd.dir);
        if (to === null) {
          announce(`No rung ${cmd.dir > 0 ? 'above' : 'below'} ${formatPriceText(market, o.price)}`);
          return;
        }
        ownActions.onMove(o, to);
        // Focus goes with the order, so the next Alt+arrow continues.
        const side: LadderSide = o.side === 'BID' ? 'BID' : 'ASK';
        const rung = rungOf(grid, groupTicks, to, side);
        if (!visible(rung)) pinTo(rung);
        focusRungAt(rung, ownKey(o));
        return;
      }
      default:
        e.preventDefault();
        onCommand?.(cmd);
    }
  };

  // Focus that lands on a rung by pointer (a click on a cell or chip) moves
  // the focused rung there, so keys continue from where the user clicked.
  const onFocus = (e: ReactFocusEvent<HTMLElement>) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !e.currentTarget.contains(t)) return;
    lastFocused.current = t;
    const row = t.closest<HTMLElement>('[data-rung-price]');
    const raw = row?.dataset.rungPrice;
    if (!raw) return;
    const price = Number(raw);
    if (focus && Math.abs(rungOfPrice(focus.price) - rungOfPrice(price)) === 0) return;
    setFocus({ marketId: market.id, price, orderKey: null });
  };

  const onBlur = (e: ReactFocusEvent<HTMLElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    // Focus left on purpose (elsewhere, or a click on the page): forget it,
    // so the effect above never pulls focus back. A row removed while
    // focused fires no blur while still connected, so that case is kept.
    if (e.target.isConnected && lastFocused.current === e.target) lastFocused.current = null;
  };

  return {
    gridRef: setGridEl,
    tabStopRung,
    /** The grid is the tab stop only while it has no rows. */
    gridTabIndex: tabStopRung === null ? 0 : -1,
    onKeyDown,
    onFocus,
    onBlur,
  };
}
