// SPDX-License-Identifier: Apache-2.0
// Assets-engine ledger-integrity readout. Degrades gracefully: the current
// build does not emit `money`, so the panel shows a single quiet line (NOT a
// skeleton — a skeleton would imply data is coming). When present it reads
// conservation, the last applied trade id, settlement lag and the check time;
// a broken conservation check is sell-toned here AND escalates the rail hero
// (see getClusterStatus). Layout is stable whether or not money is present.
import { Icons } from '../Icons';
import type { MoneyHealth } from './types';

interface MoneyHealthPanelProps {
  money?: MoneyHealth;
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'sell' }) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className={`font-mono text-[13px] tabular-nums ${tone === 'sell' ? 'text-sell' : 'text-text'}`}>{value}</span>
    </div>
  );
}

function formatCheckedAt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toTimeString().slice(0, 8);
}

export function MoneyHealthPanel({ money }: MoneyHealthPanelProps) {
  return (
    <section className="rounded-lg border border-hairline bg-surface p-4">
      <div className="mb-3 flex items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
        {Icons.database}
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Ledger Integrity</h2>
      </div>
      {money === undefined ? (
        <p className="text-[12px] text-faint">Ledger integrity — not reported by this build.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex flex-shrink-0 flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Conservation</span>
            <span className={`inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold tabular-nums ${money.conservationOk ? 'text-buy' : 'text-sell'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${money.conservationOk ? 'bg-buy' : 'bg-sell animate-pulse-soft'}`} />
              {money.conservationOk ? 'OK' : 'BROKEN'}
            </span>
          </div>
          <Tile label="Last applied trade" value={money.lastAppliedTradeId.toLocaleString()} />
          {money.imbalanceMinor !== undefined && (
            <Tile label="Imbalance" value={money.imbalanceMinor.toLocaleString()} tone={money.imbalanceMinor !== 0 ? 'sell' : undefined} />
          )}
          {money.settlementLagMs !== undefined && (
            <Tile label="Settlement lag" value={`${money.settlementLagMs.toLocaleString()} ms`} />
          )}
          {money.checkedAt && <Tile label="Checked at" value={formatCheckedAt(money.checkedAt)} />}
        </div>
      )}
    </section>
  );
}
