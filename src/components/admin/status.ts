// SPDX-License-Identifier: Apache-2.0
// Theme-aware semantic styling per cluster/node/process state — the single
// source for the admin state→color mapping.
// LEADER / FOLLOWER / running / healthy -> buy (followers quiet: buy dot,
// hairline card rule — a healthy cluster must read all-green at a glance);
// OFFLINE / stopped -> faint; failed / stopping / dead -> sell; updating ->
// accent; warn is reserved for genuinely transitional states (starting /
// rejoining / election).
import type { AdminProgress } from '../../hooks/useAdminEvents';
import type { ClusterBlock } from './types';

export const STATUS_BAR_BORDER: Record<string, string> = {
  healthy: 'border-l-buy',
  electing: 'border-l-warn',
  unstable: 'border-l-sell',
  updating: 'border-l-accent',
};

export const STATUS_DOT_COLOR: Record<string, string> = {
  healthy: 'bg-buy',
  electing: 'bg-warn',
  unstable: 'bg-sell',
  updating: 'bg-accent',
  // node/process states
  leader: 'bg-buy',
  online: 'bg-buy',
  running: 'bg-buy',
  follower: 'bg-buy',
  offline: 'bg-faint',
  stopped: 'bg-faint',
  stopping: 'bg-sell',
  failed: 'bg-sell',
  dead: 'bg-sell',
  starting: 'bg-warn',
  rejoining: 'bg-warn',
  election: 'bg-warn',
};

export const NODE_CARD_BORDER: Record<string, string> = {
  leader: 'border-l-buy',
  follower: 'border-l-hairline-strong',
  offline: 'border-l-faint opacity-70',
  stopping: 'border-l-sell',
  dead: 'border-l-sell',
  starting: 'border-l-warn',
  rejoining: 'border-l-warn',
  election: 'border-l-warn',
};

export const NODE_ROLE_BADGE: Record<string, string> = {
  leader: 'bg-buy-soft text-buy',
  follower: 'bg-buy-soft text-buy',
  offline: 'bg-surface-2 text-muted',
  stopping: 'bg-sell-soft text-sell',
  dead: 'bg-sell-soft text-sell',
  starting: 'bg-warn-soft text-warn',
  rejoining: 'bg-warn-soft text-warn',
  election: 'bg-warn-soft text-warn',
};

type ClusterStatusResult = {
  status: 'healthy' | 'electing' | 'unstable' | 'updating';
  title: string;
  detail: string;
};

/**
 * Per-cluster status hero. `op` is the operation ATTRIBUTED to this cluster
 * (null on clusters that aren't the target of the in-flight op) — the caller
 * derives that attribution client-side, since the backend progress record is
 * a single shared slot with no cluster field.
 *
 * Money-aware: an assets cluster whose conservation check has failed reads
 * `Ledger Imbalance` (sell) even when Raft itself is healthy — a ledger that
 * doesn't reconcile is the loudest thing that can be wrong.
 */
export function getClusterStatus(op: AdminProgress | null, cluster: ClusterBlock): ClusterStatusResult {
  if (cluster.kind === 'assets' && cluster.money && !cluster.money.conservationOk) {
    return {
      status: 'unstable',
      title: 'Ledger Imbalance',
      detail: 'Conservation check failed — holds do not reconcile',
    };
  }

  if (op?.operation === 'rolling-update' && !op.complete) {
    return {
      status: 'updating',
      title: 'Rolling Update',
      detail: op.status || 'Updating cluster...',
    };
  }

  if (op?.operation === 'housekeeping' && !op.complete) {
    return {
      status: 'updating',
      title: 'Archive Housekeeping',
      detail: op.status || 'Purging log segments below latest snapshot...',
    };
  }

  const nodes = cluster.nodes;
  const leader = nodes.find(n => n.role === 'LEADER');
  const isElecting = nodes.some(n => n.role === 'ELECTION');

  if (!leader && !isElecting) {
    return {
      status: 'unstable',
      title: 'Cluster Unstable',
      detail: 'No leader elected',
    };
  }

  if (isElecting) {
    return {
      status: 'electing',
      title: 'Leader Election',
      detail: 'Selecting new leader...',
    };
  }

  return {
    status: 'healthy',
    title: 'Cluster Healthy',
    detail: `Node ${leader?.id} is leader`,
  };
}
