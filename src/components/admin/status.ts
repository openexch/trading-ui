// SPDX-License-Identifier: Apache-2.0
// Theme-aware semantic styling per cluster/node/process state — the single
// source for the admin state→color mapping.
// LEADER / FOLLOWER / running / healthy -> buy (followers quiet: buy dot,
// hairline card rule — a healthy cluster must read all-green at a glance);
// OFFLINE / stopped -> faint; failed / stopping -> sell; updating -> accent;
// warn is reserved for genuinely transitional states (starting / rejoining /
// election).
import type { AdminProgress } from '../../hooks/useAdminEvents';
import type { NodeStatus } from './types';

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
  starting: 'bg-warn',
  rejoining: 'bg-warn',
  election: 'bg-warn',
};

export const NODE_CARD_BORDER: Record<string, string> = {
  leader: 'border-l-buy',
  follower: 'border-l-hairline-strong',
  offline: 'border-l-faint opacity-70',
  stopping: 'border-l-sell',
  starting: 'border-l-warn',
  rejoining: 'border-l-warn',
  election: 'border-l-warn',
};

export const NODE_ROLE_BADGE: Record<string, string> = {
  leader: 'bg-buy-soft text-buy',
  follower: 'bg-buy-soft text-buy',
  offline: 'bg-surface-2 text-muted',
  stopping: 'bg-sell-soft text-sell',
  starting: 'bg-warn-soft text-warn',
  rejoining: 'bg-warn-soft text-warn',
  election: 'bg-warn-soft text-warn',
};

export function getClusterStatus(progress: AdminProgress | null, nodes: NodeStatus[]): {
  status: 'healthy' | 'electing' | 'unstable' | 'updating';
  title: string;
  detail: string;
} {
  if (progress?.operation === 'rolling-update' && !progress.complete) {
    return {
      status: 'updating',
      title: 'Rolling Update',
      detail: progress.status || 'Updating cluster...'
    };
  }

  if (progress?.operation === 'housekeeping' && !progress.complete) {
    return {
      status: 'updating',
      title: 'Archive Housekeeping',
      detail: progress.status || 'Purging log segments below latest snapshot...'
    };
  }

  const leader = nodes.find(n => n.role === 'LEADER');
  const electingNodes = nodes.filter(n => n.role === 'ELECTION');
  const isElecting = electingNodes.length > 0;

  if (!leader && !isElecting) {
    return {
      status: 'unstable',
      title: 'Cluster Unstable',
      detail: 'No leader elected'
    };
  }

  if (isElecting) {
    return {
      status: 'electing',
      title: 'Leader Election',
      detail: 'Selecting new leader...'
    };
  }

  return {
    status: 'healthy',
    title: 'Cluster Healthy',
    detail: `Node ${leader?.id} is leader`
  };
}
