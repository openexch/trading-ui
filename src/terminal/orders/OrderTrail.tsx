// SPDX-License-Identifier: Apache-2.0
/**
 * An own order's trail (DESIGN.md: Identity, order trail): the steps from
 * this browser's submit to the core's settlement, each with its time, its
 * delta and its position (ledger/trail.ts says what each step and number
 * is).
 *
 * - Read on open, and again on every user-stream order frame for this order
 *   (a fill, a cancel), so an open trail follows the order.
 * - A fresh order is not in the history projection yet: the gateway answers
 *   503 with a short Retry-After, and the trail says so and reads again.
 *   A 503 with a long Retry-After is the history service being absent: the
 *   trail says it is not available and stops.
 * - Every value the record does not carry prints a dash.
 */
import { useEffect, useRef, useState } from 'react';
import { readTrail, trailSteps } from '../../ledger/trail';
import type { TrailRead, TrailStep } from '../../ledger/trail';
import { submitTimeOf, subscribeOrderEvents } from '../../ledger/orderEvents';
import { NONE, clockTimeMs, formatDelta, formatSeq, LOG_INK } from '../../ledger/format';

/** How often a not-yet-projected order is read again, at most. */
const MAX_PENDING_RETRIES = 10;
/** Order frames come in bursts (a fill is an order frame and a balance):
 *  one read per burst. */
const EVENT_DEBOUNCE_MS = 250;

export interface TrailState {
  steps: TrailStep[] | null;
  note: string | null;
  loading: boolean;
}

export function useOrderTrail(orderId: string): TrailState {
  const [read, setRead] = useState<TrailRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const retries = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    setLoading(true);
    void readTrail(orderId).then(r => {
      if (!alive) return;
      setRead(r);
      setLoading(false);
      if (!r.ok && r.kind === 'pending' && retries.current < MAX_PENDING_RETRIES) {
        retries.current++;
        timer = window.setTimeout(() => setTick(t => t + 1), r.retryAfterMs ?? 1000);
      } else if (r.ok) {
        retries.current = 0;
      }
    });
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [orderId, tick]);

  useEffect(() => {
    let timer: number | undefined;
    const off = subscribeOrderEvents(id => {
      if (id !== orderId) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        retries.current = 0;
        setTick(t => t + 1);
      }, EVENT_DEBOUNCE_MS);
    });
    return () => {
      off();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [orderId]);

  const submit = submitTimeOf(orderId);
  if (read === null) return { steps: null, note: null, loading };
  if (read.ok) return { steps: trailSteps(read.items, submit), note: null, loading };
  const note =
    read.kind === 'pending'
      ? retries.current >= MAX_PENDING_RETRIES
        ? 'Not in the history yet'
        : 'Not in the history yet, reading again'
      : read.text;
  // A pending order still shows its own gateway step.
  return { steps: read.kind === 'pending' && submit ? trailSteps([], submit) : null, note, loading };
}

const CLOCK_TITLE: Readonly<Record<TrailStep['clock'], string>> = {
  browser: "this browser's clock",
  core: "the core's cluster time",
  me: "the matching engine's time",
};

function Positions({ step }: { step: TrailStep }) {
  if (step.positions.length === 0) {
    return <span className="text-muted" title="The gateway does not journal: no log position">no log position</span>;
  }
  return (
    <span className="flex flex-wrap justify-end gap-x-2">
      {step.positions.map(p => (
        <span key={p.label} data-trail-position={p.label} className="whitespace-nowrap">
          <span className="text-muted">{p.label} </span>
          <span className={p.value === null ? 'text-muted' : LOG_INK}>{formatSeq(p.value)}</span>
        </span>
      ))}
    </span>
  );
}

export function OrderTrailView({ state }: { state: TrailState }) {
  const { steps, note, loading } = state;
  return (
    <div data-order-trail className="border-b border-hairline bg-surface-2 px-4 py-1.5 text-[11px]">
      {steps === null && loading && <div className="py-1 text-muted">Reading the trail…</div>}
      {note && <div className="py-1 text-muted">{note}</div>}
      {steps && (
        <ol aria-label="Order trail" className="m-0 list-none p-0">
          {steps.map(s => (
            <li
              key={s.key}
              data-trail-step={s.kind}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-hairline py-1 last:border-b-0"
            >
              <span className="truncate font-semibold text-text-strong">{s.label}</span>
              <span className="text-right tabular-nums text-text" title={`Time on ${CLOCK_TITLE[s.clock]}`}>
                {clockTimeMs(s.at)}{' '}
                <span
                  className="text-muted"
                  title={s.kind === 'gateway' ? 'POST round trip' : `Since the previous step on ${CLOCK_TITLE[s.clock]}`}
                >
                  {formatDelta(s.deltaMs)}
                </span>
              </span>
              <span className="truncate text-muted">{s.detail ?? NONE}</span>
              <span className="text-right tabular-nums">
                <Positions step={s} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Mount only while the trail is open: it reads on mount. */
export function OrderTrail({ orderId }: { orderId: string }) {
  return <OrderTrailView state={useOrderTrail(orderId)} />;
}
