// SPDX-License-Identifier: Apache-2.0
/**
 * One asset's balance ledger (DESIGN.md: Identity, balance ledger): its
 * movements, newest first, each with its kind, the signed amount, the
 * balance after it and the core log position of the entry that applied it
 * (its core time in the title). Paged by the route's cursor ("Older").
 * Where the route is not configured (503) it says the ledger is not
 * available and shows no rows; values the route does not carry are dashes.
 */
import { useCallback, useEffect, useState } from 'react';
import { readMovements } from '../../ledger/movements';
import type { Movement } from '../../ledger/movements';
import { NONE, clockTimeMs, formatSeq, LOG_INK } from '../../ledger/format';

interface State {
  items: Movement[];
  next: string | null;
  loading: boolean;
  note: string | null;
}

/** "SETTLE" -> "Settle", "HOLD_RELEASE" -> "Hold release". */
export function kindText(kind: string | null): string {
  if (kind === null) return NONE;
  const w = kind.toLowerCase().replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const ROW = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-4';

export function BalanceLedger({ assetId }: { assetId: string }) {
  const [s, setS] = useState<State>({ items: [], next: null, loading: true, note: null });

  const load = useCallback(
    async (cursor: string | null, alive: () => boolean = () => true) => {
      setS(prev => ({ ...prev, loading: true }));
      const r = await readMovements(assetId, cursor);
      if (!alive()) return;
      setS(prev =>
        r.ok
          ? { items: cursor === null ? r.items : [...prev.items, ...r.items], next: r.nextCursor, loading: false, note: null }
          : { ...prev, loading: false, note: r.text },
      );
    },
    [assetId],
  );

  useEffect(() => {
    let alive = true;
    void load(null, () => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  return (
    <div data-balance-ledger={assetId} className="border-b border-hairline bg-surface-2 py-1 text-[11px]">
      <div className={`${ROW} h-6 text-muted`}>
        <span>Movement</span>
        <span className="text-right">Amount</span>
        <span className="text-right">After</span>
        <span className="text-right">Core log</span>
      </div>
      {s.note && (
        <div className="px-4 py-1.5 text-muted" role="status">
          {s.note}
        </div>
      )}
      {!s.note && !s.loading && s.items.length === 0 && <div className="px-4 py-1.5 text-muted">No movements</div>}
      <ol aria-label="Balance movements" className="m-0 list-none p-0">
        {s.items.map((m, i) => (
          <li
            key={`${m.logPosition ?? 'x'}-${i}`}
            data-movement
            title={m.at !== null ? `Core time ${clockTimeMs(m.at)}` : undefined}
            className={`${ROW} h-6 border-t border-hairline tabular-nums`}
          >
            <span className="truncate text-text">{kindText(m.kind)}</span>
            <span className={`truncate text-right ${m.delta === null ? 'text-muted' : 'text-text-strong'}`}>
              {m.delta === null ? NONE : m.delta.startsWith('-') ? `−${m.delta.slice(1)}` : `+${m.delta}`}
            </span>
            <span className="truncate text-right text-text">{m.balanceAfter ?? NONE}</span>
            <span className={`truncate text-right ${m.logPosition === null ? 'text-muted' : LOG_INK}`}>
              {formatSeq(m.logPosition)}
            </span>
          </li>
        ))}
      </ol>
      {s.next !== null && (
        <div className="px-4 pt-1">
          <button
            type="button"
            disabled={s.loading}
            onClick={() => void load(s.next)}
            className="h-6 rounded-md border border-ctl px-2.5 text-[11px] text-text hover:bg-chip disabled:opacity-50"
          >
            {s.loading ? 'Loading…' : 'Older'}
          </button>
        </div>
      )}
    </div>
  );
}
