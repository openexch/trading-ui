// SPDX-License-Identifier: Apache-2.0
// Shared shapes for the admin console: cluster status from
// /api/admin/status, process-manager records, and the confirm-dialog
// dispatch payload.

export type NodeStatusType = 'LEADER' | 'FOLLOWER' | 'OFFLINE' | 'STOPPING' | 'STARTING' | 'REJOINING' | 'ELECTION';

export interface NodeStatus {
  id: number;
  running: boolean;
  pid?: number;
  role: NodeStatusType;
  status?: NodeStatusType;
  healthy?: boolean;
  // Per-node data
  logPosition?: number;      // From recording-log (stale, term boundaries only)
  commitPosition?: number;   // Real-time from Aeron counters
  snapshotPosition?: number;
  logDelta?: number;         // commitPosition - snapshotPosition
  snapshotCount?: number;
  archiveBytes?: number;
  archiveDiskBytes?: number;
}

export interface GatewayStatus {
  running: boolean;
  port: number;
}

export interface ClusterStatus {
  nodes: NodeStatus[];
  leader: number;
  backup: { running: boolean; pid?: number };
  gateway: { running: boolean; port: number };
  gateways: {
    market: GatewayStatus;
    order: GatewayStatus;
    admin: GatewayStatus;
  };
  // Archive is now per-node (in NodeStatus), these are deprecated
  archiveBytes?: number;
  archiveDiskBytes?: number;
}

export interface ProcessInfo {
  name: string;
  display: string;
  role: 'cluster' | 'gateway' | 'infra';
  port: number;
  running: boolean;
  pid: number;
  memoryBytes: number;
  cpuPercent: number;
  uptimeMs: number;
  startedAt: string;
  restartCount: number;
  enabled: boolean;
  status: string;
}

export interface ProcessSummary {
  total: number;
  running: number;
  stopped: number;
  failed: number;
  totalMemoryMB: number;
  lastPollMs: number;
}

export type LogSource =
  | { type: 'node'; id: number }
  | { type: 'service'; name: string };

export type ConfirmAction = {
  type: 'stop-node' | 'restart-node' | 'start-node' |
        'process-action' | 'self-update' |
        'rolling-update' | 'housekeeping' | 'housekeeping-force' |
        'stop-all-nodes' | 'start-all-nodes' | 'cleanup';
  nodeId?: number;
  service?: string;
  action?: 'start' | 'stop' | 'restart';
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle: 'danger' | 'warning' | 'primary';
};

export type AdminTab = 'cluster' | 'risk' | 'backup';
