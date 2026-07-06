// SPDX-License-Identifier: Apache-2.0
import type { AdminEventType, FeedEntry } from '../../hooks/useAdminEvents';

interface EventFeedProps {
  entries: FeedEntry[];
  connected: boolean;
  open: boolean;
  onToggle: () => void;
  unseen: number;
}

// Semantic pill styles per event type, reusing the console's existing
// badge palette (NODE_ROLE_BADGE idiom): green = came up, red = went down
// badly, amber = collateral, accent = adopted after an admin restart.
const EVENT_BADGE: Record<AdminEventType, string> = {
  started: 'bg-buy-soft text-buy',
  stopped: 'bg-surface-2 text-muted',
  crashed: 'bg-sell-soft text-sell',
  'cascade-stop': 'bg-warn-soft text-warn',
  disarmed: 'bg-sell-soft text-sell',
  adopted: 'bg-accent-soft text-accent',
};

const EVENT_DOT: Record<AdminEventType, string> = {
  started: 'bg-buy',
  stopped: 'bg-faint',
  crashed: 'bg-sell',
  'cascade-stop': 'bg-warn',
  disarmed: 'bg-sell',
  adopted: 'bg-accent',
};

function timeOf(at: string): string {
  const d = new Date(at);
  return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 8);
}

/**
 * Live activity feed: agent lifecycle events (crashes, cascades, disarms,
 * starts/stops, adoptions) streamed over /api/admin/events. Collapsible so
 * the Cluster tab stays calm; the unseen badge keeps crashes from hiding.
 * Rows are keyed by a monotonic seq and never animate on mount (stable keys,
 * no flicker — the trade-tape lesson).
 */
export function EventFeed({ entries, connected, open, onToggle, unseen }: EventFeedProps) {
  return (
    <section className="rounded-lg border border-hairline bg-surface p-6">
      <button
        className="flex w-full items-center gap-2.5 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-buy' : 'bg-faint'}`}
          title={connected ? 'Live event stream connected' : 'Event stream disconnected'}
        />
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Activity
        </h2>
        {!open && unseen > 0 && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-accent">
            {unseen > 99 ? '99+' : unseen}
          </span>
        )}
        <span className="text-[11px] text-faint">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="mt-4 max-h-64 overflow-y-auto rounded-md border border-hairline bg-surface-2">
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] italic text-faint">
              No events yet — service starts, stops, crashes and cascades appear here live.
            </div>
          ) : (
            <ul>
              {entries.map(({ seq, ev }) => (
                <li
                  key={seq}
                  className="flex items-baseline gap-2.5 border-b border-hairline px-4 py-1.5 last:border-b-0"
                >
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                    {timeOf(ev.at)}
                  </span>
                  <span className={`mb-0.5 h-1.5 w-1.5 shrink-0 self-center rounded-full ${EVENT_DOT[ev.type] || 'bg-faint'}`} />
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-text">
                    {ev.service}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${EVENT_BADGE[ev.type] || 'bg-surface-2 text-muted'}`}>
                    {ev.type}
                  </span>
                  {ev.pid ? (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                      pid {ev.pid}
                    </span>
                  ) : null}
                  {ev.detail ? (
                    <span className="truncate text-[11px] text-muted" title={ev.detail}>
                      {ev.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
