// SPDX-License-Identifier: Apache-2.0
// Cluster node cards for ONE cluster: role badge, status dot, replication
// positions, live process stats, and per-node/section-wide actions. Every
// action callback carries the cluster name so a stacked N-cluster console
// routes each mutation to the right engine.
//
// Generalized from the former single-cluster NodesSection: the skeleton now
// renders `cluster.nodeCount` cards (never a literal 3), the node→process
// join uses `node.procName ?? node<id>`, and the section actions gate on the
// cluster's capabilities.
import { Icons } from '../Icons';
import { STATUS_DOT_COLOR, NODE_CARD_BORDER, NODE_ROLE_BADGE } from './status';
import { formatBytes, formatPosition, formatUptime, isSameLogSource } from './format';
import { iconBtnStop, iconBtnRestart, iconBtnStart, iconBtnLogs } from './buttonStyles';
import type { ClusterBlock, LogSource, NodeStatus, ProcessInfo } from './types';

interface ClusterNodeGridProps {
  cluster: ClusterBlock;
  processes: ProcessInfo[];
  /** ANY op running anywhere → disable mutating buttons. */
  stackBusy: boolean;
  logSource: LogSource | null;
  onNodeAction: (cluster: string, type: 'stop-node' | 'restart-node' | 'start-node', nodeId: number) => void;
  onAllNodes: (cluster: string, type: 'stop-all-nodes' | 'start-all-nodes') => void;
  onCleanup: (cluster: string) => void;
  /** Topology change (node count): a genesis RE-FORM — wipes cluster state
   *  behind a typed confirmation upstream. */
  onTopologyChange: (cluster: string, nodeCount: number) => void;
  onViewLogs: (source: LogSource) => void;
}

/** Raft-sane member counts (odd → a majority always exists). */
const NODE_COUNTS = [1, 3, 5, 7];

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

export function ClusterNodeGrid({
  cluster,
  processes,
  stackBusy,
  logSource,
  onNodeAction,
  onAllNodes,
  onCleanup,
  onTopologyChange,
  onViewLogs,
}: ClusterNodeGridProps) {
  const nodes = cluster.nodes;
  const busyTitle = stackBusy ? 'Another operation is running' : undefined;

  return (
    <section>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
        {Icons.server}
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Cluster Nodes</h2>
        {/* Topology: a select, not a button row — changing it is rare and
            destructive (genesis re-form), confirmed upstream with a typed
            phrase. Controlled by the live count so a cancelled confirm snaps
            straight back. */}
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-faint" title={busyTitle}>
          <span className="select-none uppercase tracking-wide">Nodes</span>
          <select
            aria-label={`${cluster.display} node count`}
            value={cluster.nodeCount}
            disabled={stackBusy}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n !== cluster.nodeCount) onTopologyChange(cluster.name, n);
            }}
            className="rounded-md border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-text transition-colors hover:text-text-strong focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {NODE_COUNTS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-sell disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
            onClick={() => onAllNodes(cluster.name, 'stop-all-nodes')}
            disabled={stackBusy}
            title={busyTitle ?? 'Stop All Nodes'}
          >
            {Icons.stop}
            <span>Stop All</span>
          </button>
          <button
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-buy disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
            onClick={() => onAllNodes(cluster.name, 'start-all-nodes')}
            disabled={stackBusy}
            title={busyTitle ?? 'Start All Nodes'}
          >
            {Icons.play}
            <span>Start All</span>
          </button>
          {cluster.capabilities.cleanup && (
            <button
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-warn disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
              onClick={() => onCleanup(cluster.name)}
              disabled={stackBusy}
              title={busyTitle ?? 'Clean Aeron State'}
            >
              {Icons.restart}
              <span>Cleanup</span>
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.length === 0 ? (
          // Never-populated: pulse a card per known node (nodeCount), never a
          // literal 3 — an assets cluster is a single node.
          Array.from({ length: Math.max(cluster.nodeCount, 1) }).map((_, i) => (
            <div key={i} data-skeleton className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          ))
        ) : nodes.map((node) => {
          const nodeState = node.status || node.role;
          const isTransitioning = ['STOPPING', 'STARTING', 'REJOINING', 'ELECTION'].includes(nodeState);
          const stateClass = nodeState.toLowerCase();
          const logSelected = isSameLogSource(logSource, { type: 'node', cluster: cluster.name, id: node.id });
          const nodeProc = processes.find(p => p.name === (node.procName ?? `node${node.id}`));

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
                {/* Always rendered — a stopped node shows dashes, the card
                    never changes height (anti-flicker: reserved rows). */}
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-medium text-faint">Mem:</span>
                  <span className="tabular-nums text-text">{nodeProc?.running ? formatBytes(nodeProc.memoryBytes) : '--'}</span>
                  <span className="text-[10px] font-medium text-faint">CPU:</span>
                  <span className="tabular-nums text-text">{nodeProc?.running ? `${(nodeProc.cpuPercent ?? 0).toFixed(1)}%` : '--'}</span>
                  <span className="text-[10px] font-medium text-faint">Up:</span>
                  <span className="tabular-nums text-text">{nodeProc?.running ? formatUptime(nodeProc.uptimeMs) : '--'}</span>
                </div>
              </div>
              <div className="mt-auto flex gap-1.5">
                {node.running && !isTransitioning ? (
                  <>
                    <button className={iconBtnStop} onClick={() => onNodeAction(cluster.name, 'stop-node', node.id)} disabled={stackBusy} title="Stop">
                      {Icons.stop}
                    </button>
                    <button className={iconBtnRestart} onClick={() => onNodeAction(cluster.name, 'restart-node', node.id)} disabled={stackBusy} title="Restart">
                      {Icons.restart}
                    </button>
                  </>
                ) : !node.running && !isTransitioning ? (
                  <button className={iconBtnStart} onClick={() => onNodeAction(cluster.name, 'start-node', node.id)} disabled={stackBusy} title="Start">
                    {Icons.play}
                  </button>
                ) : null}
                <button
                  className={iconBtnLogs(logSelected)}
                  onClick={() => onViewLogs({ type: 'node', cluster: cluster.name, id: node.id })}
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
