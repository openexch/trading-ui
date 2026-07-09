// SPDX-License-Identifier: Apache-2.0
// One cluster, fully composed: its rail, its (assets-only) ledger-integrity
// panel, and its node grid. The Clusters tab stacks one ClusterSection per
// clusters[] entry. All mutating callbacks carry the cluster name so the page
// routes each action to the right engine.
import { ClusterRail } from './ClusterRail';
import { ClusterNodeGrid } from './ClusterNodeGrid';
import { MoneyHealthPanel } from './MoneyHealthPanel';
import { getClusterStatus } from './status';
import type { AdminProgress } from '../../hooks/useAdminEvents';
import type { ClusterBlock, LogSource, ProcessInfo } from './types';

export interface ClusterSectionProps {
  cluster: ClusterBlock;
  processes: ProcessInfo[];
  /** This cluster's in-flight op, else null (client-side attribution). */
  operation: AdminProgress | null;
  /** ANY op running anywhere → disable mutating buttons everywhere. */
  stackBusy: boolean;
  /** This cluster's snapshot is in flight. */
  snapshotBusy: boolean;
  logSource: LogSource | null;
  onNodeAction: (cluster: string, type: 'stop-node' | 'restart-node' | 'start-node', nodeId: number) => void;
  onAllNodes: (cluster: string, type: 'stop-all-nodes' | 'start-all-nodes') => void;
  onCleanup: (cluster: string) => void;
  onTopologyChange: (cluster: string, nodeCount: number) => void;
  onRollingUpdate: (cluster: string) => void;
  onHousekeeping: (cluster: string) => void;
  onSnapshot: (cluster: string) => void;
  onViewLogs: (source: LogSource) => void;
}

export function ClusterSection({
  cluster,
  processes,
  operation,
  stackBusy,
  snapshotBusy,
  logSource,
  onNodeAction,
  onAllNodes,
  onCleanup,
  onTopologyChange,
  onRollingUpdate,
  onHousekeeping,
  onSnapshot,
  onViewLogs,
}: ClusterSectionProps) {
  const clusterStatus = getClusterStatus(operation, cluster);

  return (
    // aria-label names the region so stacked sections are distinguishable
    // (to operators via the rail chip, to tests via getByRole('region')).
    <section aria-label={cluster.display} className="flex flex-col gap-6">
      <ClusterRail
        cluster={cluster}
        clusterStatus={clusterStatus}
        operation={operation}
        stackBusy={stackBusy}
        snapshotBusy={snapshotBusy}
        onRollingUpdate={() => onRollingUpdate(cluster.name)}
        onHousekeeping={() => onHousekeeping(cluster.name)}
        onSnapshot={() => onSnapshot(cluster.name)}
      />
      {cluster.kind === 'assets' && <MoneyHealthPanel money={cluster.money} />}
      <ClusterNodeGrid
        cluster={cluster}
        processes={processes}
        stackBusy={stackBusy}
        logSource={logSource}
        onNodeAction={onNodeAction}
        onAllNodes={onAllNodes}
        onCleanup={onCleanup}
        onTopologyChange={onTopologyChange}
        onViewLogs={onViewLogs}
      />
    </section>
  );
}

/**
 * Never-loaded placeholder for the whole Clusters tab (status === null). A
 * couple of pulsing section shells — deliberately NOT a hardcoded 3-node grid,
 * since we don't yet know how many clusters or nodes the backend will report.
 */
export function ClusterSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {[0, 1].map(i => (
        <div key={i} className="flex flex-col gap-6">
          <div className="h-[64px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[200px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
