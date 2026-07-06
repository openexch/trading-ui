// SPDX-License-Identifier: Apache-2.0
// Cluster node cards: role badge, status dot, replication positions, live
// process stats, and per-node/section-wide actions.
import { Icons } from '../Icons';
import { STATUS_DOT_COLOR, NODE_CARD_BORDER, NODE_ROLE_BADGE } from './status';
import { formatBytes, formatPosition, formatUptime, isSameLogSource } from './format';
import { iconBtnStop, iconBtnRestart, iconBtnStart, iconBtnLogs } from './buttonStyles';
import type { ClusterStatus, LogSource, NodeStatus, ProcessInfo } from './types';

interface NodesSectionProps {
  status: ClusterStatus | null;
  processes: ProcessInfo[];
  isOperationRunning: boolean;
  logSource: LogSource | null;
  onStopNode: (nodeId: number) => void;
  onRestartNode: (nodeId: number) => void;
  onStartNode: (nodeId: number) => void;
  onStopAll: () => void;
  onStartAll: () => void;
  onCleanup: () => void;
  onViewLogs: (source: LogSource) => void;
}

function NodeDetailsTooltip({ node }: { node: NodeStatus }) {
  return (
    <div className="invisible absolute bottom-full right-0 z-50 mb-2 min-w-[220px] rounded-md border border-hairline bg-surface p-3.5 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100">
      <div className="mb-2.5 border-b border-hairline pb-1.5 font-sans text-[12px] font-semibold text-text-strong">Node Details</div>
      <div className="flex justify-between gap-4 py-0.5 text-[11px]">
        <span className="text-muted">Commit Position:</span>
        <span className="font-mono tabular-nums text-text-strong">{node.commitPosition !== undefined ? node.commitPosition.toLocaleString() : '--'}</span>
      </div>
      <div className="flex justify-between gap-4 py-0.5 text-[11px]">
        <span className="text-muted">Snapshot Position:</span>
        <span className="font-mono tabular-nums text-text-strong">{node.snapshotPosition !== undefined ? node.snapshotPosition.toLocaleString() : '--'}</span>
      </div>
      <div className="flex justify-between gap-4 py-0.5 text-[11px]">
        <span className="text-muted">Delta (since snapshot):</span>
        <span className="font-mono tabular-nums text-text-strong">{node.logDelta !== undefined ? node.logDelta.toLocaleString() : '--'}</span>
      </div>
      <div className="flex justify-between gap-4 py-0.5 text-[11px]">
        <span className="text-muted">Snapshot Count:</span>
        <span className="font-mono tabular-nums text-text-strong">{node.snapshotCount !== undefined ? node.snapshotCount : '--'}</span>
      </div>
      <div className="my-2 h-px bg-hairline" />
      <div className="flex justify-between gap-4 py-0.5 text-[11px]">
        <span className="text-muted">Archive Size:</span>
        <span className="font-mono tabular-nums text-text-strong">{node.archiveBytes !== undefined ? formatBytes(node.archiveBytes) : '--'}</span>
      </div>
      <div className="flex justify-between gap-4 py-0.5 text-[11px]">
        <span className="text-muted">Disk Usage:</span>
        <span className="font-mono tabular-nums text-text-strong">{node.archiveDiskBytes !== undefined ? formatBytes(node.archiveDiskBytes) : '--'}</span>
      </div>
    </div>
  );
}

export function NodesSection({
  status,
  processes,
  isOperationRunning,
  logSource,
  onStopNode,
  onRestartNode,
  onStartNode,
  onStopAll,
  onStartAll,
  onCleanup,
  onViewLogs,
}: NodesSectionProps) {
  return (
    <section className="rounded-lg border border-hairline bg-surface p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
        {Icons.server}
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Cluster Nodes</h2>
        <div className="flex flex-wrap gap-1.5">
          <button
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-sell disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
            onClick={onStopAll}
            disabled={isOperationRunning}
            title="Stop All Nodes"
          >
            {Icons.stop}
            <span>Stop All</span>
          </button>
          <button
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-buy disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
            onClick={onStartAll}
            disabled={isOperationRunning}
            title="Start All Nodes"
          >
            {Icons.play}
            <span>Start All</span>
          </button>
          <button
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-warn disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
            onClick={onCleanup}
            disabled={isOperationRunning}
            title="Clean Aeron State"
          >
            {Icons.restart}
            <span>Cleanup</span>
          </button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!status ? (
          <>
            <div className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          </>
        ) : status.nodes.map((node) => {
          const nodeState = node.status || node.role;
          const isTransitioning = ['STOPPING', 'STARTING', 'REJOINING', 'ELECTION'].includes(nodeState);
          const stateClass = nodeState.toLowerCase();
          const logSelected = isSameLogSource(logSource, { type: 'node', id: node.id });
          const nodeProc = processes.find(p => p.name === `node${node.id}`);

          return (
            <div
              key={node.id}
              className={`flex flex-col gap-2.5 rounded-lg border border-l-[3px] border-hairline bg-surface p-4 ${NODE_CARD_BORDER[stateClass] || 'border-l-hairline-strong'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[13px] font-semibold text-text-strong">Node {node.id}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${NODE_ROLE_BADGE[stateClass] || 'bg-surface-2 text-muted'} ${isTransitioning ? 'animate-pulse-soft' : ''}`}>
                  {nodeState}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT_COLOR[stateClass] || 'bg-faint'} ${isTransitioning ? 'animate-pulse-soft' : ''}`} />
                <span>
                  {nodeState === 'OFFLINE' ? 'Stopped' :
                   isTransitioning ? nodeState.charAt(0) + nodeState.slice(1).toLowerCase() + '...' :
                   node.pid ? `PID ${node.pid}` : 'Running'}
                </span>
              </div>
              <div className="border-y border-hairline py-2.5 font-mono text-[11px]">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-medium text-faint">Commit:</span>
                  <span className="min-w-[48px] tabular-nums text-text">{formatPosition(node.commitPosition)}</span>
                  <span className="text-[10px] font-medium text-faint">Snap:</span>
                  <span className="min-w-[48px] tabular-nums text-text">{formatPosition(node.snapshotPosition)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-faint">Delta:</span>
                  <span className="min-w-[48px] tabular-nums text-warn">{formatPosition(node.logDelta)}</span>
                  <span className="text-[10px] font-medium text-faint">Archive:</span>
                  <span className="min-w-[48px] tabular-nums text-text">{node.archiveBytes !== undefined ? formatBytes(node.archiveBytes) : '--'}</span>
                  <span className="group relative ml-auto flex cursor-help items-center text-faint [&_svg]:h-3.5 [&_svg]:w-3.5 hover:text-accent">
                    {Icons.info}
                    <NodeDetailsTooltip node={node} />
                  </span>
                </div>
                {nodeProc && nodeProc.running && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-medium text-faint">Mem:</span>
                    <span className="tabular-nums text-text">{formatBytes(nodeProc.memoryBytes)}</span>
                    <span className="text-[10px] font-medium text-faint">CPU:</span>
                    <span className="tabular-nums text-text">{(nodeProc.cpuPercent ?? 0).toFixed(1)}%</span>
                    <span className="text-[10px] font-medium text-faint">Up:</span>
                    <span className="tabular-nums text-text">{formatUptime(nodeProc.uptimeMs)}</span>
                  </div>
                )}
              </div>
              <div className="mt-auto flex gap-1.5">
                {node.running && !isTransitioning ? (
                  <>
                    <button className={iconBtnStop} onClick={() => onStopNode(node.id)} disabled={isOperationRunning} title="Stop">
                      {Icons.stop}
                    </button>
                    <button className={iconBtnRestart} onClick={() => onRestartNode(node.id)} disabled={isOperationRunning} title="Restart">
                      {Icons.restart}
                    </button>
                  </>
                ) : !node.running && !isTransitioning ? (
                  <button className={iconBtnStart} onClick={() => onStartNode(node.id)} disabled={isOperationRunning} title="Start">
                    {Icons.play}
                  </button>
                ) : null}
                <button
                  className={iconBtnLogs(logSelected)}
                  onClick={() => onViewLogs({ type: 'node', id: node.id })}
                  title="View Logs"
                >
                  {Icons.logs}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
