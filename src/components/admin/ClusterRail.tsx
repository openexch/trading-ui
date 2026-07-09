// SPDX-License-Identifier: Apache-2.0
// Cluster rail — the admin console's signature element, mirroring the
// trading page's ticker rail: state-toned rule + display-face status hero on
// the left, tabular stat tiles in the middle, cluster operations in a
// reserved-width slot on the right. Fixed 64px height. The thin top hairline
// is the operation progress bar (data, not ornament).
//
// Generalized from the former single-cluster ClusterStatusBar: it now takes
// ONE cluster block, its stat tiles are Nodes/Leader/Commit (the fleet
// Services/Memory tiles moved to the Overview tab), and its ops slot is
// capability-gated while keeping its reserved width so it never collapses.
import { Icons } from '../Icons';
import { STATUS_BAR_BORDER, STATUS_DOT_COLOR } from './status';
import { formatPosition } from './format';
import type { AdminProgress } from '../../hooks/useAdminEvents';
import type { ClusterBlock } from './types';

interface ClusterRailProps {
  cluster: ClusterBlock;
  clusterStatus: { status: 'healthy' | 'electing' | 'unstable' | 'updating'; title: string; detail: string };
  /** This cluster's in-flight op (attributed client-side), else null. */
  operation: AdminProgress | null;
  /** ANY op running anywhere → disable mutating buttons on every rail. */
  stackBusy: boolean;
  /** This cluster's snapshot is in flight. */
  snapshotBusy: boolean;
  onRollingUpdate: () => void;
  onHousekeeping: () => void;
  onSnapshot: () => void;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'sell' }) {
  return (
    <div className="flex flex-shrink-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className={`font-mono text-[13px] tabular-nums ${tone === 'sell' ? 'text-sell' : 'text-text'}`}>
        {value}
      </span>
    </div>
  );
}

const opBtnClass =
  'flex items-center gap-1.5 whitespace-nowrap rounded-md border border-hairline bg-surface px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35 disabled:cursor-not-allowed [&_svg]:h-3.5 [&_svg]:w-3.5';

export function ClusterRail({
  cluster,
  clusterStatus,
  operation,
  stackBusy,
  snapshotBusy,
  onRollingUpdate,
  onHousekeeping,
  onSnapshot,
}: ClusterRailProps) {
  const nodes = cluster.nodes;
  const runningNodes = nodes.filter(n => n.running).length;
  const totalNodes = nodes.length || cluster.nodeCount;
  const leader = nodes.find(n => n.role === 'LEADER');
  const maxCommit = nodes.reduce<number | undefined>(
    (max, n) => (n.commitPosition !== undefined && (max === undefined || n.commitPosition > max) ? n.commitPosition : max),
    undefined,
  );

  const isOperationRunning = !!(operation?.operation && !operation.complete);
  const operationProgress = isOperationRunning ? (operation?.progress || 0) : 0;

  const caps = cluster.capabilities;
  const anyOps = caps.rollingUpdate || caps.housekeeping || caps.snapshot;
  const busyTitle = stackBusy ? 'Another operation is running' : undefined;

  return (
    <div className="relative flex h-[64px] items-stretch overflow-hidden rounded-lg border border-hairline bg-surface">
      {/* Operation progress hairline */}
      <div
        className="absolute left-0 top-0 h-0.5 bg-accent transition-[width] duration-500"
        style={{ width: `${operationProgress}%` }}
      />

      {/* Signature block: state rule + dot + status hero */}
      <div className={`flex w-[250px] flex-shrink-0 items-center gap-3 border-l-2 px-4 ${STATUS_BAR_BORDER[clusterStatus.status]}`}>
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT_COLOR[clusterStatus.status]} ${clusterStatus.status !== 'healthy' ? 'animate-pulse-soft' : ''}`} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-display text-[20px] font-bold leading-tight tracking-tight text-text-strong">
            {clusterStatus.title}
          </span>
          <span className="truncate text-[11px] text-muted">{clusterStatus.detail}</span>
        </div>
      </div>

      {/* Stat tiles — the display-name chip distinguishes stacked rails */}
      <div className="flex flex-1 items-center gap-6 overflow-x-auto border-l border-hairline px-5">
        <span className="flex-shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          {cluster.display}
        </span>
        <Stat label="Nodes" value={`${runningNodes}/${totalNodes}`} />
        <Stat label="Leader" value={leader ? `Node ${leader.id}` : '—'} />
        <Stat label="Commit" value={formatPosition(maxCommit)} />
      </div>

      {/* Operations slot — reserved width so buttons <-> progress swap never
          resizes the rail. Capability-gated: only supported ops render; when
          none apply a faint dash holds the slot open. */}
      <div className="flex w-[400px] flex-shrink-0 items-center justify-end gap-2 px-4">
        {isOperationRunning ? (
          <span className="font-mono text-[14px] font-semibold tabular-nums text-accent">{operationProgress}%</span>
        ) : anyOps ? (
          <>
            {caps.rollingUpdate && (
              <button className={opBtnClass} onClick={onRollingUpdate} disabled={stackBusy} title={busyTitle}>
                {Icons.update}
                <span>Rolling Update</span>
              </button>
            )}
            {caps.housekeeping && (
              <button className={opBtnClass} onClick={onHousekeeping} disabled={stackBusy} title={busyTitle}>
                {Icons.archive}
                <span>Housekeeping</span>
              </button>
            )}
            {caps.snapshot && (
              <button className={opBtnClass} onClick={onSnapshot} disabled={stackBusy || snapshotBusy} title={busyTitle}>
                {Icons.snapshot}
                <span>Snapshot</span>
              </button>
            )}
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </div>
    </div>
  );
}
