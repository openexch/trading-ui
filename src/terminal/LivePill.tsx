// SPDX-License-Identifier: Apache-2.0
// Connection state as a compact pill: "Live" when the market feed is up, the
// transitional state otherwise, and a Reconnect action when the feed is down. Not a live region: only the staging strip
// announces (DESIGN.md rule 12).
import type { ExtendedConnectionStatus } from '../types/market';

type Tone = 'buy' | 'warn' | 'sell';

const STATE: Record<ExtendedConnectionStatus, { label: string; tone: Tone }> = {
  connected: { label: 'Live', tone: 'buy' },
  connecting: { label: 'Connecting', tone: 'warn' },
  'cluster-electing': { label: 'Electing', tone: 'warn' },
  'cluster-updating': { label: 'Updating', tone: 'warn' },
  'cluster-reconnecting': { label: 'Reconnecting', tone: 'warn' },
  disconnected: { label: 'Offline', tone: 'sell' },
  error: { label: 'Error', tone: 'sell' },
};

const TONE: Record<Tone, { pill: string; dot: string }> = {
  buy: { pill: 'bg-buy-faint text-buy', dot: 'bg-buy' },
  warn: { pill: 'bg-warn-soft text-warn', dot: 'bg-warn animate-pulse-soft' },
  sell: { pill: 'bg-sell-faint text-sell', dot: 'bg-sell' },
};

export interface LivePillProps {
  status: ExtendedConnectionStatus;
  onReconnect: () => void;
}

export function LivePill({ status, onReconnect }: LivePillProps) {
  const { label, tone } = STATE[status];
  const t = TONE[tone];
  const down = status === 'disconnected' || status === 'error';
  return (
    <span className="flex items-center gap-2">
      <span
        data-status={status}
        className={`flex h-[26px] min-w-16 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ${t.pill}`}
      >
        <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${t.dot}`} />
        {label}
      </span>
      {down && (
        <button
          type="button"
          onClick={onReconnect}
          className="h-[26px] rounded-full border border-ctl px-2.5 text-[12px] text-text hover:bg-chip"
        >
          Reconnect
        </button>
      )}
    </span>
  );
}
