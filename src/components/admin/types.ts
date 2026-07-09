// SPDX-License-Identifier: Apache-2.0
// Shared shapes for the admin console: cluster status from
// /api/admin/status (the generic multi-cluster envelope), process-manager
// records, and the confirm-dialog dispatch payload.

export type NodeStatusType =
  | 'LEADER' | 'FOLLOWER' | 'OFFLINE' | 'DEAD'
  | 'STOPPING' | 'STARTING' | 'REJOINING' | 'ELECTION';

export interface NodeStatus {
  id: number;
  running: boolean;
  pid?: number;
  role: NodeStatusType;
  status?: NodeStatusType;
  healthy?: boolean;
  /** Process-manager key for this node (join to /api/admin/processes for
   *  mem/cpu/uptime). Falls back to `node<id>` when absent. */
  procName?: string;
  // Per-node data (matching engine fills all; assets fills only the CnC
  // subset — the rich replication fields are absent and render as `--`).
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
  healthy?: boolean;
}

/** The kind of engine a cluster runs. Open for future kinds without a
 *  breaking change (`string & {}` keeps literal autocomplete while allowing
 *  unknown backend values). */
export type ClusterKind = 'match' | 'assets' | (string & {});

/** What operations a cluster supports — the rail/grid gate their buttons on
 *  these so a cluster never offers an action its backend would 400. */
export interface ClusterCapabilities {
  rollingUpdate: boolean;
  snapshot: boolean;
  cleanup: boolean;
  housekeeping: boolean;
  backup: boolean;
  separateDriver: boolean;
}

/** Assets-engine ledger-integrity readout. Not emitted by the current build;
 *  the panel and rail degrade gracefully when it is absent. */
export interface MoneyHealth {
  conservationOk: boolean;
  lastAppliedTradeId: number;
  settlementLagMs?: number;
  imbalanceMinor?: number;
  checkedAt?: string;
}

/** One cluster block from GET /api/admin/status `clusters[]`. */
export interface ClusterBlock {
  name: string;
  display: string;
  kind: ClusterKind;
  nodeCount: number;
  leader: number;
  allNodesHealthy: boolean;
  capabilities: ClusterCapabilities;
  nodes: NodeStatus[];
  backup?: { running: boolean; fresh?: boolean; reason?: string };
  money?: MoneyHealth;
}

/** The full GET /api/admin/status envelope. `clusters[]` is the generic
 *  array the console renders; the flat legacy keys are back-compat aliases of
 *  clusters[0] and are kept optional so a raw response still type-checks. */
export interface AdminStatus {
  clusters: ClusterBlock[];
  gateways: {
    market: GatewayStatus;
    order?: GatewayStatus;
    admin: GatewayStatus;
    oms?: GatewayStatus;
  };
  activeProfile?: string;
  backup?: { running: boolean; fresh?: boolean; reason?: string };
  demoHealthy?: boolean;
  demo?: { running: boolean; healthy: boolean; port: number };
  // Legacy flat shape (alias of clusters[0]) — kept so the pre-multi-cluster
  // backend still parses and normalizeStatus() can synthesize a match block.
  nodes?: NodeStatus[];
  leader?: number;
  allNodesHealthy?: boolean;
}

// One runtime profile as reported by GET /api/admin/profile's `available` set.
export interface ProfileInfo {
  name: string;
  description: string;
  nodeHeapMB: number;
  idleMode: string;
  driverMode: string;
  pinning: string;
  bookCapacity: number;
  minMemMB: number;
  simGlobalOps: number;
  governor: string;
}

/** The complete profile record from GET /api/admin/profiles (the CRUD
 *  surface). `available` on GET /api/admin/profile now carries the same full
 *  field set — a strict superset of ProfileInfo, so the header selector keeps
 *  parsing unchanged. Everything except `name`/`builtin` is editable and
 *  rides the POST /api/admin/profiles `profile` body. */
export interface FullProfile extends ProfileInfo {
  builtin: boolean;
  omsHeapMB: number;
  marketHeapMB: number;
  backupHeapMB: number;
  preTouch: boolean;
  driverProfile: string;
  logTermLength: string;
  thp: string;
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

/** A log tail target. Node sources are cluster-qualified so stacked clusters
 *  with the same node ids never collide. */
export type LogSource =
  | { type: 'node'; cluster: string; id: number }
  | { type: 'service'; name: string };

export type ConfirmAction = {
  type: 'stop-node' | 'restart-node' | 'start-node' |
        'process-action' | 'self-update' |
        'rolling-update' | 'housekeeping' | 'housekeeping-force' | 'snapshot' |
        'stop-all-nodes' | 'start-all-nodes' | 'cleanup' |
        'apply-profile' | 'apply-profile-force' | 'cluster-topology';
  /** Cluster the action targets (rides the `?cluster=` query). */
  cluster?: string;
  nodeId?: number;
  service?: string;
  action?: 'start' | 'stop' | 'restart';
  profileName?: string;
  /** Target node count for a cluster-topology change (genesis re-form). */
  nodeCount?: number;
  /** Typed confirmation phrase the modal demands before enabling confirm. */
  requireText?: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle: 'danger' | 'warning' | 'primary';
};

export type AdminTab = 'overview' | 'clusters' | 'services' | 'profiles' | 'risk' | 'backup';
