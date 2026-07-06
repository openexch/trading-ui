// SPDX-License-Identifier: Apache-2.0
// Cluster rail — the admin console's signature element, mirroring the
// trading page's ticker rail: state-toned rule + display-face status hero
// on the left, tabular stat tiles in the middle, cluster operations in a
// reserved-width slot on the right. Fixed height; the rail chrome mounts
// immediately and values render pulsing dashes until data arrives — the
// rail itself never swaps with a skeleton. The thin top hairline is the
// operation progress bar (data, not ornament).
import { Icons } from '../Icons';
import { STATUS_BAR_BORDER, STATUS_DOT_COLOR } from './status';
import { formatPosition } from './format';
import type { ClusterStatus, ProcessSummary } from './types';

interface ClusterStatusBarProps {
  status: ClusterStatus | null;
  processSummary: ProcessSummary | null;
  clusterStatus: { status: 'healthy' | 'electing' | 'unstable' | 'updating'; title: string; detail: string };
  isOperationRunning: boolean;
  operationProgress: number;
  onRollingUpdate: () => void;
  onHousekeeping: () => void;
}

/** Pulsing placeholder for a value that hasn't arrived yet. */
function Pending() {
  return <span className="animate-pulse text-faint">—</span>;
}

function Stat({ label, value, tone }: { label: string; value: string | null; tone?: 'sell' }) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className={`font-mono text-[13px] tabular-nums ${tone === 'sell' ? 'text-sell' : 'text-text'}`}>
        {value !== null ? value : <Pending />}
      </span>
    </div>
  );
}

const opBtnClass =
  'flex items-center gap-1.5 whitespace-nowrap rounded-md border border-hairline bg-surface px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5';

export function ClusterStatusBar({
  status,
  processSummary,
  clusterStatus,
  isOperationRunning,
  operationProgress,
  onRollingUpdate,
  onHousekeeping,
}: ClusterStatusBarProps) {
  const loaded = status !== null;
  const nodes = status?.nodes ?? [];
  const runningNodes = nodes.filter(n => n.running).length;
  const leader = nodes.find(n => n.role === 'LEADER');
  const maxCommit = nodes.reduce<number | undefined>(
    (max, n) => (n.commitPosition !== undefined && (max === undefined || n.commitPosition > max) ? n.commitPosition : max),
    undefined,
  );

  return (
    <div className="relative mb-8 flex h-[64px] items-stretch overflow-hidden rounded-lg border border-hairline bg-surface">
      {/* Operation progress hairline */}
      <div
        className="absolute left-0 top-0 h-0.5 bg-accent transition-[width] duration-500"
        style={{ width: `${operationProgress}%` }}
      />

      {/* Signature block: state rule + dot + status hero */}
      <div className={`flex w-[250px] flex-shrink-0 items-center gap-3 border-l-2 px-4 ${loaded ? STATUS_BAR_BORDER[clusterStatus.status] : 'border-l-hairline-strong'}`}>
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${loaded ? STATUS_DOT_COLOR[clusterStatus.status] : 'bg-faint'} ${!loaded || clusterStatus.status !== 'healthy' ? 'animate-pulse-soft' : ''}`} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-display text-[20px] font-bold leading-tight tracking-tight text-text-strong">
            {loaded ? clusterStatus.title : <Pending />}
          </span>
          <span className="truncate text-[11px] text-muted">
            {loaded ? clusterStatus.detail : 'Connecting to gateway…'}
          </span>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="flex flex-1 items-center gap-6 overflow-x-auto border-l border-hairline px-5">
        <Stat label="Nodes" value={loaded ? `${runningNodes}/${nodes.length}` : null} />
        <Stat label="Leader" value={loaded ? (leader ? `Node ${leader.id}` : '—') : null} />
        <Stat
          label="Services"
          value={processSummary ? `${processSummary.running}/${processSummary.total}` : null}
          tone={processSummary && processSummary.failed > 0 ? 'sell' : undefined}
        />
        <Stat
          label="Memory"
          value={processSummary
            ? processSummary.totalMemoryMB > 1024
              ? `${(processSummary.totalMemoryMB / 1024).toFixed(1)} GB`
              : `${Math.round(processSummary.totalMemoryMB)} MB`
            : null}
        />
        <Stat label="Commit" value={loaded ? formatPosition(maxCommit) : null} />
      </div>

      {/* Operations slot — reserved width so buttons <-> progress swap never
          resizes the rail */}
      <div className="flex w-[292px] flex-shrink-0 items-center justify-end gap-2 px-4">
        {isOperationRunning ? (
          <span className="font-mono text-[14px] font-semibold tabular-nums text-accent">{operationProgress}%</span>
        ) : (
          <>
            <button className={opBtnClass} onClick={onRollingUpdate} disabled={!loaded}>
              {Icons.update}
              <span>Rolling Update</span>
            </button>
            <button className={opBtnClass} onClick={onHousekeeping} disabled={!loaded}>
              {Icons.archive}
              <span>Housekeeping</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
