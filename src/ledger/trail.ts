// SPDX-License-Identifier: Apache-2.0
/**
 * The order trail: GET /api/v2/orders/{orderId}/trail (every record the core
 * journalled for one of the caller's orders, oldest first by eventSeq),
 * turned into the steps the trail shows.
 *
 * Steps, as the gateway's API document defines them:
 * - Gateway: the client's own submit time (no log position: the gateway
 *   does not journal). Only known for orders placed in this page session.
 * - Core accepted, with its hold: the ACCEPTED record, at its core log
 *   position.
 * - ME booked: the ACK_NEW record's matching-engine reference.
 * - ME matched: each FILL record's matching-engine reference.
 * - Core settled: that FILL's core log position.
 * - Any other record (cancel, reject, expiry, amend) is a step named after
 *   its event, at its core log position.
 *
 * Positions are labelled by what they are. Only the core's position is a
 * log position. The matching engine's reference is its journal sequence
 * and its egress sequence (`me.journalSeq`, `me.egressSeq`), never called a
 * log position. Times come from three clocks (this browser, the core, the
 * matching engine), so a step's delta is the time since the previous step
 * on the SAME clock; the gateway step's delta is its own POST round trip.
 * A value the record does not carry is null and prints a dash.
 */
import { apiRequest } from '../api/gateway';
import { isDecimalString } from '../api/decimal';
import { int } from './engine';
import type { SubmitTime } from './orderEvents';

export interface TrailMe {
  epoch: string | null;
  journalSeq: number | null;
  egressSeq: number | null;
  /** Matching-engine time of the record (ms), when the gateway sends it. */
  at: number | null;
}

export interface TrailItem {
  eventSeq: number;
  event: string;
  status: string | null;
  coreLogPosition: number | null;
  me: TrailMe | null;
  liquidity: 'TAKER' | 'MAKER' | null;
  tradeId: string | null;
  lastPrice: string | null;
  lastQty: string | null;
  holdRemaining: string | null;
  /** Core cluster time (ms). */
  at: number | null;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function money(v: unknown): string | null {
  return isDecimalString(v) ? (v as string) : null;
}

function me(raw: unknown): TrailMe | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    epoch: text(o.epoch) ?? (int(o.epoch) !== null ? String(o.epoch) : null),
    journalSeq: int(o.journalSeq),
    // An older gateway named this field logPosition; it is the ME's egress
    // sequence either way, and is never shown as a log position.
    egressSeq: int(o.egressSeq) ?? int(o.logPosition),
    at: int(o.at),
  };
}

/** One trail record; null when it has no eventSeq or event (it could not be
 *  ordered or named). */
export function parseTrailItem(raw: unknown): TrailItem | null {
  const o = obj(raw);
  const eventSeq = o ? int(o.eventSeq) : null;
  const event = o ? text(o.event) : null;
  if (!o || eventSeq === null || event === null) return null;
  const liq = o.liquidity;
  return {
    eventSeq,
    event,
    status: text(o.status),
    coreLogPosition: int(o.coreLogPosition),
    me: me(o.me),
    liquidity: liq === 'TAKER' || liq === 'MAKER' ? liq : null,
    tradeId: text(o.tradeId),
    lastPrice: money(o.lastPrice),
    lastQty: money(o.lastQty),
    holdRemaining: money(o.holdRemaining),
    at: int(o.at),
  };
}

export type Clock = 'browser' | 'core' | 'me';

export interface TrailPosition {
  /** "core log", "journal seq", "egress seq". */
  label: string;
  value: number | null;
}

export interface TrailStep {
  key: string;
  kind: 'gateway' | 'accepted' | 'booked' | 'matched' | 'settled' | 'event';
  label: string;
  clock: Clock;
  at: number | null;
  /** Since the previous step on the same clock; the gateway step's POST
   *  round trip. Null when either time is unknown. */
  deltaMs: number | null;
  positions: TrailPosition[];
  /** "hold 650.005", "0.004 @ 65000.5 · maker". */
  detail: string | null;
}

const EVENT_LABEL: Readonly<Record<string, string>> = {
  DISPATCHED: 'Core forwarded',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  REPLACED: 'Amended',
  TRIGGERED: 'Triggered',
};

function eventLabel(event: string): string {
  const known = EVENT_LABEL[event];
  if (known) return known;
  const words = event.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const corePos = (v: number | null): TrailPosition[] => [{ label: 'core log', value: v }];
const mePos = (m: TrailMe | null): TrailPosition[] => [
  { label: 'journal seq', value: m?.journalSeq ?? null },
  { label: 'egress seq', value: m?.egressSeq ?? null },
];

function fillDetail(i: TrailItem): string | null {
  if (i.lastQty === null && i.lastPrice === null) return null;
  const liq = i.liquidity === 'MAKER' ? ' · maker' : i.liquidity === 'TAKER' ? ' · taker' : '';
  return `${i.lastQty ?? '–'} @ ${i.lastPrice ?? '–'}${liq}`;
}

/** The trail's steps, in order. */
export function trailSteps(items: readonly TrailItem[], submit: SubmitTime | null): TrailStep[] {
  const steps: Omit<TrailStep, 'deltaMs'>[] = [];
  steps.push({
    key: 'gateway',
    kind: 'gateway',
    label: 'Gateway',
    clock: 'browser',
    at: submit?.sentAt ?? null,
    positions: [],
    detail: submit ? 'submitted from this browser' : null,
  });
  const sorted = [...items].sort((a, b) => a.eventSeq - b.eventSeq);
  for (const i of sorted) {
    if (i.event === 'ACCEPTED') {
      steps.push({
        key: `${i.eventSeq}`,
        kind: 'accepted',
        label: 'Core accepted',
        clock: 'core',
        at: i.at,
        positions: corePos(i.coreLogPosition),
        detail: i.holdRemaining !== null ? `hold ${i.holdRemaining}` : null,
      });
    } else if (i.event === 'ACK_NEW') {
      steps.push({
        key: `${i.eventSeq}`,
        kind: 'booked',
        label: 'ME booked',
        clock: 'me',
        at: i.me?.at ?? null,
        positions: mePos(i.me),
        detail: null,
      });
    } else if (i.event === 'FILL') {
      steps.push({
        key: `${i.eventSeq}-me`,
        kind: 'matched',
        label: 'ME matched',
        clock: 'me',
        at: i.me?.at ?? null,
        positions: mePos(i.me),
        detail: fillDetail(i),
      });
      steps.push({
        key: `${i.eventSeq}`,
        kind: 'settled',
        label: 'Core settled',
        clock: 'core',
        at: i.at,
        positions: corePos(i.coreLogPosition),
        detail: i.holdRemaining !== null ? `hold left ${i.holdRemaining}` : null,
      });
    } else {
      steps.push({
        key: `${i.eventSeq}`,
        kind: 'event',
        label: eventLabel(i.event),
        clock: 'core',
        at: i.at,
        positions: corePos(i.coreLogPosition),
        detail: null,
      });
    }
  }
  const lastAt: Partial<Record<Clock, number>> = {};
  return steps.map(s => {
    let deltaMs: number | null = null;
    if (s.kind === 'gateway') {
      deltaMs = submit?.roundTripMs ?? null;
    } else if (s.at !== null) {
      const prev = lastAt[s.clock];
      if (prev !== undefined) deltaMs = s.at - prev;
      lastAt[s.clock] = s.at;
    }
    return { ...s, deltaMs };
  });
}

// ---- reading ------------------------------------------------------------------

export type TrailRead =
  | { ok: true; items: TrailItem[] }
  | {
      ok: false;
      /** pending: not projected yet (a fresh order), retry soon;
       *  unavailable: no history service; gone: unknown order. */
      kind: 'pending' | 'unavailable' | 'gone' | 'error';
      text: string;
      retryAfterMs: number | null;
    };

const MAX_PAGES = 10;
/** A 503 whose Retry-After is at most this is the projection catching up. */
const LAG_RETRY_MAX_MS = 5000;

/** Read every page of an order's trail. */
export async function readTrail(orderId: string): Promise<TrailRead> {
  const items: TrailItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor !== null) q.set('cursor', cursor);
    let res;
    try {
      res = await apiRequest<{ items?: unknown; nextCursor?: unknown }>(
        `/orders/${encodeURIComponent(orderId)}/trail?${q.toString()}`,
      );
    } catch (e) {
      return { ok: false, kind: 'error', text: e instanceof Error ? e.message : 'Network error', retryAfterMs: null };
    }
    if (!res.ok) {
      const retry = res.retryAfterMs ?? null;
      if (res.status === 503) {
        const lag = retry === null || retry <= LAG_RETRY_MAX_MS;
        return lag
          ? { ok: false, kind: 'pending', text: 'Not in the history yet', retryAfterMs: retry ?? 1000 }
          : { ok: false, kind: 'unavailable', text: 'History is not available', retryAfterMs: retry };
      }
      if (res.status === 404) return { ok: false, kind: 'gone', text: 'No trail for this order', retryAfterMs: null };
      return { ok: false, kind: 'error', text: res.error.error ?? `Error ${res.status}`, retryAfterMs: retry };
    }
    const body = res.body;
    if (Array.isArray(body?.items)) {
      for (const raw of body.items) {
        const item = parseTrailItem(raw);
        if (item) items.push(item);
      }
    }
    const next = body?.nextCursor;
    cursor = typeof next === 'string' && next.length > 0 ? next : null;
    if (cursor === null) break;
  }
  return { ok: true, items };
}
