// SPDX-License-Identifier: Apache-2.0
/**
 * The balance ledger: GET /api/v2/balances/movements?assetId=&cursor=&limit=
 * (one asset's movements, newest first, keyset paged by `nextCursor`).
 * Each movement carries the core log position of the entry that applied it.
 * The route answers 503 where it is not configured: the panel then says the
 * ledger is not available and shows no rows.
 */
import { apiRequest } from '../api/gateway';
import { int } from './engine';

export interface Movement {
  /** Core log position of the entry that applied it. */
  logPosition: number | null;
  /** The movement's kind as the core names it (DEPOSIT, HOLD, SETTLE, ...). */
  kind: string | null;
  asset: string | null;
  /** Signed decimal string ("-0.004", "650.005"). */
  delta: string | null;
  balanceAfter: string | null;
  /** Core cluster time (ms). */
  at: number | null;
}

const SIGNED = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/;

function signed(v: unknown): string | null {
  return typeof v === 'string' && SIGNED.test(v) ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function parseMovement(raw: unknown): Movement | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    logPosition: int(o.logPosition),
    kind: text(o.kind),
    asset: text(o.asset),
    delta: signed(o.delta),
    balanceAfter: signed(o.balanceAfter),
    at: int(o.at),
  };
}

export const MOVEMENTS_PAGE = 50;

export type MovementsRead =
  | { ok: true; items: Movement[]; nextCursor: string | null }
  | { ok: false; unavailable: boolean; text: string };

export async function readMovements(assetId: string, cursor: string | null): Promise<MovementsRead> {
  const q = new URLSearchParams({ assetId, limit: String(MOVEMENTS_PAGE) });
  if (cursor !== null) q.set('cursor', cursor);
  let res;
  try {
    res = await apiRequest<{ items?: unknown; nextCursor?: unknown }>(`/balances/movements?${q.toString()}`);
  } catch (e) {
    return { ok: false, unavailable: false, text: e instanceof Error ? e.message : 'Network error' };
  }
  if (!res.ok) {
    if (res.status === 503) return { ok: false, unavailable: true, text: 'The balance ledger is not available' };
    return { ok: false, unavailable: false, text: res.error.error ?? `Error ${res.status}` };
  }
  const items = Array.isArray(res.body?.items)
    ? res.body.items.map(parseMovement).filter((m): m is Movement => m !== null)
    : [];
  const next = res.body?.nextCursor;
  return { ok: true, items, nextCursor: typeof next === 'string' && next.length > 0 ? next : null };
}
