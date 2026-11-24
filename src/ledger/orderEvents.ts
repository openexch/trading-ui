// SPDX-License-Identifier: Apache-2.0
/**
 * Two small session records the order trail reads.
 *
 * - Own submit times: the gateway step of a trail has no log position and
 *   no server time ("accepted by the gateway" is the client's own record):
 *   the browser's clock when the POST went out and how long the answer
 *   took, kept per orderId for the orders placed in this page session.
 * - Order events: the user stream's `order` frames, by orderId, so an open
 *   trail reads its order again when the order changes.
 */

export interface SubmitTime {
  /** Browser clock (ms) when the POST went out. */
  sentAt: number;
  /** POST round trip, browser clock (ms). */
  roundTripMs: number;
}

const MAX_SUBMITS = 500;
const submits = new Map<string, SubmitTime>();

export function recordSubmit(orderId: string, t: SubmitTime): void {
  submits.delete(orderId);
  submits.set(orderId, t);
  while (submits.size > MAX_SUBMITS) {
    const oldest = submits.keys().next().value as string;
    submits.delete(oldest);
  }
}

export function submitTimeOf(orderId: string): SubmitTime | null {
  return submits.get(orderId) ?? null;
}

/** Tests only. */
export function clearSubmits(): void {
  submits.clear();
}

type Listener = (orderId: string) => void;
const listeners = new Set<Listener>();

export function notifyOrderEvent(orderId: string): void {
  for (const l of [...listeners]) l(orderId);
}

export function subscribeOrderEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
