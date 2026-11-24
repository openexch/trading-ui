// SPDX-License-Identifier: Apache-2.0
/**
 * One page of a v2 history read (GET /api/v2/orders/history, GET
 * /api/v2/fills): `{items, nextCursor, asOf}`, newest first, keyset paging.
 * The next page is the same route with `cursor=<nextCursor>` and the same
 * filters; `nextCursor: null` is the last page. There is no offset.
 */
import { apiRequest } from '../api/gateway';

export const HISTORY_PAGE_LIMIT = 100;

export interface HistoryPage<T> {
  items: T[];
  nextCursor: string | null;
  /** asOf.eventSeq: every event up to it is in the answer (null if absent). */
  eventSeq: number | null;
}

/** Read one page. Throws an Error with the text to show on a refusal. */
export async function readHistoryPage<T>(
  route: '/orders/history' | '/fills',
  cursor: string | null,
  unavailable: string,
): Promise<HistoryPage<T>> {
  const q = new URLSearchParams({ limit: String(HISTORY_PAGE_LIMIT) });
  if (cursor !== null) q.set('cursor', cursor);
  const res = await apiRequest<{ items?: unknown; nextCursor?: unknown; asOf?: { eventSeq?: unknown } }>(
    `${route}?${q.toString()}`,
  );
  if (!res.ok) {
    // 503 HISTORY_UNAVAILABLE / HISTORY_BUSY: the history projection cannot
    // answer (or is not deployed).
    if (res.status === 503) throw new Error(unavailable);
    throw new Error(res.error.error ?? `Error ${res.status}`);
  }
  const items = Array.isArray(res.body?.items) ? (res.body!.items as T[]) : [];
  const next = res.body?.nextCursor;
  const seq = res.body?.asOf?.eventSeq;
  return {
    items,
    nextCursor: typeof next === 'string' && next.length > 0 ? next : null,
    eventSeq: typeof seq === 'number' && Number.isInteger(seq) ? seq : null,
  };
}
