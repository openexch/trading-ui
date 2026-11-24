// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback } from 'react';
import { EV, track } from '../analytics';
import type { OrderRequest, OrderType, TimeInForce } from '../types/market';
import { apiErrorText, apiRequest, newIdempotencyKey } from '../api/gateway';
import type { ApiErrorBody } from '../api/gateway';
import { marketIdToApi } from '../api/marketId';
import { findMarketBySymbol } from '../markets/marketStore';
import { toWireMoney } from '../utils/money';
import { formatRejectReason } from '../utils/rejectReasons';
import { recordSubmit } from '../ledger/orderEvents';

interface ApiState {
  loading: boolean;
  error: string | null;
}

export interface ApiResponse {
  success: boolean;
  message: string;
  /** Cancel only: the order is no longer open (404, or 409 NOT_OPEN, or a
   *  re-offered NOT_OPEN), so the row can go. */
  gone?: boolean;
  /** HTTP status of a refusal (absent on success and on a network error). */
  status?: number;
  /** The gateway's machine code of a refusal (CORE_UNAVAILABLE, ...). */
  code?: string | null;
  /** 504 OUTCOME_UNKNOWN: the command reached the core and no answer came.
   *  It may have been applied: never present this as safe to retry. */
  outcomeUnknown?: boolean;
  /** 503 CORE_UNAVAILABLE: no core session, nothing was sent. */
  coreUnavailable?: boolean;
  /** Submit only: the gateway's orderId of an accepted order. */
  orderId?: string;
}

/** The answer fields every refusal carries. Exported for tests. */
export function refusalFields(status: number, error: ApiErrorBody): Pick<ApiResponse, 'status' | 'code' | 'outcomeUnknown' | 'coreUnavailable'> {
  return {
    status,
    code: error.code,
    outcomeUnknown: status === 504 || error.code === 'OUTCOME_UNKNOWN',
    coreUnavailable: status === 503 && error.code === 'CORE_UNAVAILABLE',
  };
}

const SIDE_MAP: Record<string, string> = { BID: 'BUY', ASK: 'SELL' };

/** Types that carry a limit price; the gateway refuses a price on the others. */
const PRICED: ReadonlySet<OrderType> = new Set(['LIMIT', 'LIMIT_MAKER', 'STOP_LIMIT', 'ICEBERG']);
const STOPPED: ReadonlySet<OrderType> = new Set(['STOP_LOSS', 'STOP_LIMIT']);

/** An order the core would refuse for its shape, refused before sending. */
export class OrderShapeError extends Error {}

/**
 * The time in force sent for an order type. The gateway requires one and has
 * no default per type; the core admits (behaviour v3, its admission table):
 * - LIMIT: GTC, IOC, FOK, GTD (FOK is native on LIMIT only);
 * - MARKET: IOC (a market order never rests; IOC is its native time in force);
 * - LIMIT_MAKER, STOP_LOSS, STOP_LIMIT, TRAILING_STOP, ICEBERG: GTC, GTD.
 * Every other cell is 400 UNSUPPORTED_TIF. The forms offer every time in
 * force for every type: on MARKET the default GTC (and IOC) becomes IOC; any
 * other refused cell is refused here, never silently changed.
 * Exported for tests.
 */
export function timeInForceFor(type: OrderType, chosen: TimeInForce | undefined): TimeInForce {
  const tif = chosen ?? 'GTC';
  if (type === 'MARKET') {
    if (tif === 'GTC' || tif === 'IOC') return 'IOC';
  } else if (type === 'LIMIT') {
    return tif;
  } else if (tif === 'GTC' || tif === 'GTD') {
    return tif;
  }
  throw new OrderShapeError(formatRejectReason('UNSUPPORTED_TIF'));
}

/** The POST /api/v2/orders body for a form order. Exported for tests.
 *  Throws when the market is not in the gateway's list, and an
 *  OrderShapeError for a time in force the order type does not take. */
export function toOrderBody(order: OrderRequest): Record<string, unknown> {
  const market = findMarketBySymbol(order.market);
  if (!market) throw new Error(`unknown market ${order.market}`);
  // No userId: the gateway takes the user from the credential.
  const body: Record<string, unknown> = {
    marketId: marketIdToApi(market.id),
    side: SIDE_MAP[order.orderSide] ?? order.orderSide,
    type: order.orderType,
    // Required in v2: there is no default per type.
    timeInForce: timeInForceFor(order.orderType, order.timeInForce),
    // Money as exact decimal strings
    quantity: toWireMoney(order.quantity),
  };
  if (PRICED.has(order.orderType)) body.price = toWireMoney(order.price);
  if (STOPPED.has(order.orderType) && order.stopPrice) body.stopPrice = toWireMoney(order.stopPrice);
  if (order.orderType === 'TRAILING_STOP' && order.trailingDelta) body.trailingDelta = toWireMoney(order.trailingDelta);
  if (order.orderType === 'ICEBERG' && order.displayQuantity) body.displayQuantity = toWireMoney(order.displayQuantity);
  return body;
}

function refusal(status: number, error: ApiErrorBody): string {
  return apiErrorText(error, status);
}

/** POST /api/v2/balances/{deposit,withdraw} for the caller's own balance.
 *  One Idempotency-Key per attempt. The route is the demo faucet; with the
 *  treasury lane off the gateway answers 404 FEATURE_DISABLED. */
export async function transferFunds(kind: 'deposit' | 'withdraw', assetId: string, amount: number): Promise<ApiResponse> {
  try {
    const res = await apiRequest<{ available?: string }>(`/balances/${kind}`, {
      method: 'POST',
      idempotencyKey: newIdempotencyKey(),
      body: { assetId, amount: toWireMoney(amount) },
    });
    if (res.ok) return { success: true, message: kind === 'deposit' ? 'Deposit successful' : 'Withdrawal successful' };
    return { success: false, message: refusal(res.status, res.error) };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}

export function useApi() {
  const [state, setState] = useState<ApiState>({ loading: false, error: null });

  const submitOrder = useCallback(async (order: OrderRequest): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    try {
      // 201 = the core accepted the order with its hold (PENDING_NEW); the
      // matching engine's decision arrives later on the user stream.
      const body = toOrderBody(order);
      const sentAt = Date.now();
      const res = await apiRequest<{ orderId?: string }>('/orders', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body,
      });
      if (res.ok) {
        setState({ loading: false, error: null });
        const orderId = typeof res.body?.orderId === 'string' ? res.body.orderId : undefined;
        // The trail's gateway step: this browser's own record of the submit.
        if (orderId) recordSubmit(orderId, { sentAt, roundTripMs: Date.now() - sentAt });
        return { success: true, message: `Order accepted (${orderId ?? ''})`, orderId };
      }
      const error = refusal(res.status, res.error);
      setState({ loading: false, error });
      return { success: false, message: error, ...refusalFields(res.status, res.error) };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      // A thrown fetch is the gateway being unreachable, which is different
      // from the core refusing an order and is the one worth paging about.
      // A shape refused before sending is neither.
      if (!(err instanceof OrderShapeError)) {
        track(EV.api_error, { operation: 'submit_order', reason: error.slice(0, 120) });
      }
      setState({ loading: false, error });
      return { success: false, message: error };
    }
  }, []);

  const replaceOrder = useCallback(async (omsOrderId: string, price?: number, quantity?: number): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    const body: Record<string, string> = {};
    if (price !== undefined && price > 0) body.price = toWireMoney(price);
    if (quantity !== undefined && quantity > 0) body.quantity = toWireMoney(quantity);

    try {
      // 200 {status: PENDING_REPLACE}; the new price arrives as an order event.
      const res = await apiRequest(`/orders/${encodeURIComponent(omsOrderId)}`, {
        method: 'PUT',
        idempotencyKey: newIdempotencyKey(),
        body,
      });
      if (res.ok) {
        setState({ loading: false, error: null });
        return { success: true, message: 'Order updated' };
      }
      const error = refusal(res.status, res.error);
      setState({ loading: false, error });
      return { success: false, message: error, ...refusalFields(res.status, res.error) };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      track(EV.api_error, { operation: 'replace_order', reason: error.slice(0, 120) });
      setState({ loading: false, error });
      return { success: false, message: error };
    }
  }, []);

  const cancelOrder = useCallback(async (omsOrderId: string): Promise<ApiResponse> => {
    setState({ loading: true, error: null });

    try {
      // Keyed, so the answer is exact (no re-offer ambiguity).
      const res = await apiRequest<{ status?: string }>(`/orders/${encodeURIComponent(omsOrderId)}`, {
        method: 'DELETE',
        idempotencyKey: newIdempotencyKey(),
      });
      if (res.ok) {
        setState({ loading: false, error: null });
        const notOpen = res.body?.status === 'NOT_OPEN';
        return { success: true, message: notOpen ? 'Order is no longer open' : 'Order cancelled', gone: true };
      }
      // 404: unknown (the core keeps no terminal order). 409 NOT_OPEN: closed
      // already. Both mean the row is stale. 409 AMEND_PENDING is still open.
      const gone = res.status === 404 || (res.status === 409 && res.error.reason === 'NOT_OPEN');
      const error = gone ? 'Order is no longer open' : refusal(res.status, res.error);
      setState({ loading: false, error });
      return { success: false, message: error, gone, ...refusalFields(res.status, res.error) };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Network error';
      track(EV.api_error, { operation: 'cancel_order', reason: error.slice(0, 120) });
      setState({ loading: false, error });
      return { success: false, message: error };
    }
  }, []);

  return {
    ...state,
    submitOrder,
    replaceOrder,
    cancelOrder,
  };
}
