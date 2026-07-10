// SPDX-License-Identifier: Apache-2.0
import { useState, useRef, useEffect, useMemo } from 'react';
import type { ClusterEventMessage } from '../../types/market';
import { Icons } from '../Icons';

interface ClusterActivityLogProps {
  events: ClusterEventMessage[];
  onClear: () => void;
}

// Per-event-kind severity → the same buy/sell/warn/muted tones the rest of the
// header uses. Neutral (leader change) reads as info, not alarm.
function toneFor(event: ClusterEventMessage['event']): string {
  switch (event) {
    case 'NODE_UP':
    case 'ROLLING_UPDATE_COMPLETE':
    case 'CONNECTION_RESTORED':
      return 'bg-buy';
    case 'NODE_DOWN':
    case 'CONNECTION_LOST':
      return 'bg-sell';
    case 'ROLLING_UPDATE_START':
      return 'bg-warn';
    case 'LEADER_CHANGE':
    default:
      return 'bg-accent';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 3);
}

export function ClusterActivityLog({ events, onClear }: ClusterActivityLogProps) {
  const [open, setOpen] = useState(false);
  // "Unread" = events arrived while the panel was closed. Snapshot the count
  // seen at last-open; a higher live count lights the dot.
  const [seenCount, setSeenCount] = useState(events.length);
  const containerRef = useRef<HTMLDivElement>(null);

  const unread = events.length - seenCount;
  const hasUnread = !open && unread > 0;

  // Newest first for display.
  const ordered = useMemo(() => events.slice().reverse(), [events]);

  useEffect(() => {
    if (open) setSeenCount(events.length);
  }, [open, events.length]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Cluster activity"
        aria-label="Cluster activity log"
        className={`relative flex h-8 w-8 items-center justify-center rounded-md border bg-surface-2 text-muted transition-colors hover:border-hairline-strong hover:text-text [&_svg]:h-[17px] [&_svg]:w-[17px] ${
          open ? 'border-hairline-strong text-text' : 'border-hairline'
        }`}
      >
        {Icons.logs}
        {hasUnread && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface-1" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 overflow-hidden rounded-lg border border-hairline bg-surface-1 shadow-xl">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <span className="text-[11px] font-semibold text-text">Cluster Activity</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tabular-nums text-muted">{events.length}</span>
              {events.length > 0 && (
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded border border-hairline px-1.5 py-0.5 text-[10px] font-medium text-muted transition-colors hover:border-hairline-strong hover:text-text"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {ordered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-muted">
                No cluster activity yet.
              </div>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {ordered.map((ev, i) => (
                  <li key={`${ev.timestamp}-${ev.event}-${i}`} className="flex items-start gap-2 px-3 py-2">
                    <span className={`mt-1 h-[7px] w-[7px] shrink-0 rounded-full ${toneFor(ev.event)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-text" title={ev.message}>{ev.message}</div>
                      <div className="mt-0.5 font-mono text-[9px] tabular-nums text-muted">
                        {formatTime(ev.timestamp)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
