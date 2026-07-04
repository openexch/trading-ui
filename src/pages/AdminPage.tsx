// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { ThemeToggle } from '../components/ThemeToggle/ThemeToggle';
import { RiskAdmin } from '../components/admin/RiskAdmin';
import { BackupOps } from '../components/admin/BackupOps';

const ADMIN_BASE = import.meta.env.VITE_ADMIN_API_URL || '';

type NodeStatusType = 'LEADER' | 'FOLLOWER' | 'OFFLINE' | 'STOPPING' | 'STARTING' | 'REJOINING' | 'ELECTION';

interface NodeStatus {
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

interface GatewayStatus {
  running: boolean;
  port: number;
}

interface ClusterStatus {
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

interface OperationProgress {
  operation: string | null;
  status: string | null;
  progress: number;
  currentStep: number;
  totalSteps: number;
  complete: boolean;
  error: boolean;
  errorMessage: string | null;
  elapsedMs: number;
}

interface ProcessInfo {
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

interface ProcessSummary {
  total: number;
  running: number;
  stopped: number;
  failed: number;
  totalMemoryMB: number;
  lastPollMs: number;
}

type LogSource =
  | { type: 'node'; id: number }
  | { type: 'service'; name: string };

type ConfirmAction = {
  type: 'stop-node' | 'restart-node' | 'start-node' |
        'process-action' | 'self-update' |
        'rolling-update' | 'rolling-cleanup' | 'stop-all-nodes' | 'start-all-nodes' | 'cleanup';
  nodeId?: number;
  service?: string;
  action?: 'start' | 'stop' | 'restart';
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle: 'danger' | 'warning' | 'primary';
};

type AdminTab = 'cluster' | 'risk' | 'backup';

// Icons
const Icons = {
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  ),
  server: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="8" rx="2"/>
      <rect x="2" y="14" width="20" height="8" rx="2"/>
      <circle cx="6" cy="6" r="1" fill="currentColor"/>
      <circle cx="6" cy="18" r="1" fill="currentColor"/>
    </svg>
  ),
  backup: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
  ),
  market: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22,7 13.5,15.5 8.5,10.5 2,17"/>
      <polyline points="16,7 22,7 22,13"/>
    </svg>
  ),
  order: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 9h6M9 13h6M9 17h4"/>
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  database: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1"/>
    </svg>
  ),
  restart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 4v6h6M23 20v-6h-6"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21"/>
    </svg>
  ),
  update: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
    </svg>
  ),
  snapshot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  logs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  archive: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="5" rx="1"/>
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
      <path d="M10 12h4"/>
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
  ui: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
    </svg>
  ),
};

// Theme-aware semantic styling per cluster/node/process state.
// LEADER / running / healthy -> buy; OFFLINE / failed -> sell;
// FOLLOWER / transitional / electing -> warn; updating -> accent.
const STATUS_BAR_BORDER: Record<string, string> = {
  healthy: 'border-l-buy',
  electing: 'border-l-warn',
  unstable: 'border-l-sell',
  updating: 'border-l-accent',
};

const STATUS_DOT_COLOR: Record<string, string> = {
  healthy: 'bg-buy',
  electing: 'bg-warn',
  unstable: 'bg-sell',
  updating: 'bg-accent',
  // node/process states
  leader: 'bg-buy',
  online: 'bg-buy',
  running: 'bg-buy',
  follower: 'bg-warn',
  offline: 'bg-faint',
  stopped: 'bg-faint',
  stopping: 'bg-sell',
  failed: 'bg-sell',
  starting: 'bg-warn',
  rejoining: 'bg-warn',
  election: 'bg-warn',
};

const NODE_CARD_BORDER: Record<string, string> = {
  leader: 'border-l-buy',
  follower: 'border-l-warn',
  offline: 'border-l-faint opacity-70',
  stopping: 'border-l-sell',
  starting: 'border-l-warn',
  rejoining: 'border-l-warn',
  election: 'border-l-warn',
};

const NODE_ROLE_BADGE: Record<string, string> = {
  leader: 'bg-buy-soft text-buy',
  follower: 'bg-warn-soft text-warn',
  offline: 'bg-surface-2 text-muted',
  stopping: 'bg-sell-soft text-sell',
  starting: 'bg-warn-soft text-warn',
  rejoining: 'bg-warn-soft text-warn',
  election: 'bg-warn-soft text-warn',
};

function getClusterStatus(progress: OperationProgress | null, nodes: NodeStatus[]): {
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

  if (progress?.operation === 'rolling-cleanup' && !progress.complete) {
    return {
      status: 'updating',
      title: 'Rolling Cleanup',
      detail: progress.status || 'Cleaning archive...'
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

function getLogSourceLabel(source: LogSource | null): string {
  if (!source) return 'Select a service or node to view logs';
  if (source.type === 'node') return `Node ${source.id}`;
  switch (source.name) {
    case 'backup': return 'Backup Node';
    case 'market-gateway': return 'Market Gateway';
    case 'order-gateway': return 'Order Gateway';
    case 'admin-gateway': return 'Admin Gateway';
    case 'ui': return 'Trading UI';
    default: return source.name;
  }
}

function processToLogName(name: string): string {
  switch (name) {
    case 'market': return 'market-gateway';
    case 'order': return 'order-gateway';
    case 'admin': return 'admin-gateway';
    default: return name;
  }
}

function getProcessIcon(name: string) {
  switch (name) {
    case 'backup': return Icons.backup;
    case 'market': return Icons.market;
    case 'order': return Icons.order;
    case 'admin': return Icons.admin;
    case 'ui': return Icons.ui;
    default: return Icons.server;
  }
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '--';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function AdminPage() {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<AdminTab>('cluster');
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [processSummary, setProcessSummary] = useState<ProcessSummary | null>(null);
  const [operatingServices, setOperatingServices] = useState<Set<string>>(new Set());
  const [snapshotOp, setSnapshotOp] = useState(false);
  const [logSource, setLogSource] = useState<LogSource | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logFilters, setLogFilters] = useState({ error: true, warn: true, info: true, debug: true });
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null);
  const statusPollRef = useRef<number | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/status`);
      if (response.ok) {
        const data = await response.json() as ClusterStatus;
        setStatus(data);
        setError(null);
      }
    } catch {
      setError('Failed to fetch cluster status');
    }
  }, []);

  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/progress`);
      if (response.ok) {
        const data = await response.json() as OperationProgress;
        if (data.operation || data.currentStep > 0) {
          setProgress(data);
          if (data.complete) {
            setTimeout(async () => {
              await fetch(`${ADMIN_BASE}/api/admin/progress?reset=true`);
              setProgress(null);
            }, 3000);
          }
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!logSource) return;
    try {
      let url = `${ADMIN_BASE}/api/admin/logs?lines=200`;
      if (logSource.type === 'node') {
        url += `&node=${logSource.id}`;
      } else {
        url += `&service=${logSource.name}`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs || []);
      }
    } catch {
      // Ignore
    }
  }, [logSource]);

  const fetchProcesses = useCallback(async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        fetch(`${ADMIN_BASE}/api/admin/processes`),
        fetch(`${ADMIN_BASE}/api/admin/processes/summary`),
      ]);
      if (listRes.ok) {
        setProcesses(await listRes.json());
      }
      if (summaryRes.ok) {
        setProcessSummary(await summaryRes.json());
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    if (progress?.operation && !progress.complete) {
      // Fast polling (50ms) during active operations for accurate progress display
      statusPollRef.current = window.setInterval(() => {
        fetchStatus();
        fetchProgress();
      }, 50);
    } else if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, [progress?.operation, progress?.complete, fetchStatus, fetchProgress]);

  useEffect(() => {
    fetchStatus();
    fetchProgress();
    const interval = setInterval(() => {
      fetchStatus();
      fetchProgress();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchProgress]);

  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(fetchProcesses, 5000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  useEffect(() => {
    if (logSource) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [logSource, fetchLogs]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // ── Node action handlers (unchanged — still use /api/admin/status for transitional state) ──

  const requestStopNode = (nodeId: number) => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'stop-node',
      nodeId,
      title: `Stop Node ${nodeId}?`,
      message: 'This will stop the cluster node. The cluster will continue with remaining nodes.',
      confirmLabel: 'Stop Node',
      confirmStyle: 'danger',
    });
  };

  const requestRestartNode = (nodeId: number) => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'restart-node',
      nodeId,
      title: `Restart Node ${nodeId}?`,
      message: 'This will restart the cluster node. It will temporarily leave the cluster and rejoin.',
      confirmLabel: 'Restart Node',
      confirmStyle: 'warning',
    });
  };

  const requestStartNode = (nodeId: number) => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'start-node',
      nodeId,
      title: `Start Node ${nodeId}?`,
      message: 'This will start the cluster node and it will attempt to rejoin the cluster.',
      confirmLabel: 'Start Node',
      confirmStyle: 'primary',
    });
  };

  const requestStopAllNodes = () => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'stop-all-nodes',
      title: 'Stop All Nodes?',
      message: 'This will stop all cluster nodes. The cluster will become completely unavailable.',
      confirmLabel: 'Stop All',
      confirmStyle: 'danger',
    });
  };

  const requestStartAllNodes = () => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'start-all-nodes',
      title: 'Start All Nodes?',
      message: 'This will start all cluster nodes and form a new cluster.',
      confirmLabel: 'Start All',
      confirmStyle: 'primary',
    });
  };

  const requestCleanup = () => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'cleanup',
      title: 'Clean Aeron State?',
      message: 'This will remove stale Aeron files (shared memory, locks). All nodes must be stopped first.',
      confirmLabel: 'Clean State',
      confirmStyle: 'warning',
    });
  };

  const executeNodeAction = async (action: string, nodeId: number) => {
    try {
      await fetch(`${ADMIN_BASE}/api/admin/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      });
    } catch {
      setError(`Failed to ${action.replace('-', ' ')}`);
    }
  };

  // ── Generic process action handler (replaces all per-service handlers) ──

  const requestProcessAction = (service: string, action: 'start' | 'stop' | 'restart') => {
    if (operatingServices.has(service) || (progress?.operation && !progress.complete)) return;

    const displayName = processes.find(p => p.name === service)?.display || service;
    const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);

    const descriptions: Record<string, Record<string, string>> = {
      stop: {
        backup: 'This will stop the backup node. Cluster snapshots will not be available until restarted.',
        market: 'This will stop the market data WebSocket. Clients will lose real-time market updates.',
        order: 'This will stop the order API. Order submission will be unavailable.',
        admin: 'This will stop the admin gateway. You will lose access to this dashboard.',
        ui: 'This will stop the trading UI. Users will not be able to access the web interface.',
      },
      start: {
        backup: 'This will start the backup node to enable cluster state backups.',
        market: 'This will start the market data WebSocket for real-time updates.',
        order: 'This will start the order API for order submission.',
        admin: 'This will start the admin gateway.',
        ui: 'This will start the trading UI web interface.',
      },
      restart: {
        backup: 'This will restart the backup node. Backup service will be temporarily unavailable.',
        market: 'This will restart the market gateway. Clients will be temporarily disconnected.',
        order: 'This will restart the order gateway. Order submission will be temporarily unavailable.',
        admin: 'This will restart the admin gateway. You will temporarily lose access to this dashboard.',
        ui: 'This will restart the trading UI. Users will experience a brief interruption.',
      },
    };

    const styles: Record<string, 'danger' | 'warning' | 'primary'> = {
      stop: 'danger', start: 'primary', restart: 'warning',
    };

    setPendingAction({
      type: 'process-action',
      service,
      action,
      title: `${actionLabel} ${displayName}?`,
      message: descriptions[action]?.[service] || `This will ${action} the ${displayName} service.`,
      confirmLabel: actionLabel,
      confirmStyle: styles[action],
    });
  };

  const executeProcessAction = async (service: string, action: string) => {
    setOperatingServices(prev => new Set(prev).add(service));
    try {
      await fetch(`${ADMIN_BASE}/api/admin/processes/${service}/${action}`, { method: 'POST' });
      const timeout = action === 'restart' ? 8000 : 3000;
      setTimeout(() => {
        setOperatingServices(prev => {
          const next = new Set(prev);
          next.delete(service);
          return next;
        });
        fetchProcesses();
      }, timeout);
    } catch {
      setError(`Failed to ${action} ${service}`);
      setOperatingServices(prev => {
        const next = new Set(prev);
        next.delete(service);
        return next;
      });
    }
  };

  // ── Self-update (admin gateway rebuild) ──

  const requestSelfUpdate = () => {
    if (operatingServices.has('admin') || (progress?.operation && !progress.complete)) return;
    setPendingAction({
      type: 'self-update',
      title: 'Self-Update Admin Gateway?',
      message: 'This will rebuild the admin gateway from source and restart it. You will temporarily lose access to this dashboard.',
      confirmLabel: 'Self-Update',
      confirmStyle: 'warning',
    });
  };

  const executeSelfUpdate = async () => {
    setOperatingServices(prev => new Set(prev).add('admin'));
    try {
      await fetch(`${ADMIN_BASE}/api/admin/rebuild-admin`, { method: 'POST' });
      // Admin will restart automatically — connection will drop
    } catch {
      setError('Failed to trigger self-update');
      setOperatingServices(prev => {
        const next = new Set(prev);
        next.delete('admin');
        return next;
      });
    }
  };

  // ── Snapshot ──

  const takeSnapshot = async () => {
    if (snapshotOp || (progress?.operation && !progress.complete)) return;
    setSnapshotOp(true);
    try {
      await fetch(`${ADMIN_BASE}/api/admin/snapshot`, { method: 'POST' });
      setTimeout(() => { setSnapshotOp(false); }, 5000);
    } catch {
      setError('Failed to take snapshot');
      setSnapshotOp(false);
    }
  };

  // ── Rolling operations ──

  const requestRollingUpdate = () => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'rolling-update',
      title: 'Start Rolling Update?',
      message: 'This will rebuild the application and restart all cluster nodes one by one. The cluster will remain available during the update.',
      confirmLabel: 'Start Update',
      confirmStyle: 'warning',
    });
  };

  const executeRollingUpdate = async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/rolling-update`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Rolling update failed');
      }
    } catch {
      setError('Failed to trigger rolling update');
    }
  };

  const requestRollingCleanup = () => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'rolling-cleanup',
      title: 'Start Rolling Cleanup?',
      message: 'This will clean archive segments on each node one by one to free disk space. The cluster will remain available during the cleanup.',
      confirmLabel: 'Start Cleanup',
      confirmStyle: 'warning',
    });
  };

  const executeRollingCleanup = async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/rolling-cleanup`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Rolling cleanup failed');
      }
    } catch {
      setError('Failed to trigger rolling cleanup');
    }
  };

  const executeStopAllNodes = async () => {
    try {
      await fetch(`${ADMIN_BASE}/api/admin/stop-all-nodes`, { method: 'POST' });
    } catch {
      setError('Failed to stop all nodes');
    }
  };

  const executeStartAllNodes = async () => {
    try {
      await fetch(`${ADMIN_BASE}/api/admin/start-all-nodes`, { method: 'POST' });
    } catch {
      setError('Failed to start all nodes');
    }
  };

  const executeCleanup = async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await response.json();
      if (!data.success) {
        setError(data.error || 'Cleanup failed');
      }
    } catch {
      setError('Failed to cleanup state');
    }
  };

  // ── Confirm action dispatch ──

  const confirmAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    switch (action.type) {
      case 'stop-node':
      case 'restart-node':
      case 'start-node':
        if (action.nodeId !== undefined) {
          await executeNodeAction(action.type, action.nodeId);
        }
        break;
      case 'process-action':
        if (action.service && action.action) {
          await executeProcessAction(action.service, action.action);
        }
        break;
      case 'self-update':
        await executeSelfUpdate();
        break;
      case 'rolling-update':
        await executeRollingUpdate();
        break;
      case 'rolling-cleanup':
        await executeRollingCleanup();
        break;
      case 'stop-all-nodes':
        await executeStopAllNodes();
        break;
      case 'start-all-nodes':
        await executeStartAllNodes();
        break;
      case 'cleanup':
        await executeCleanup();
        break;
    }
  };

  // ── Formatters ──

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Format log/snapshot positions with K, M, G suffixes
  const formatPosition = (pos: number | undefined): string => {
    if (pos === undefined || pos < 0) return '--';
    if (pos < 1000) return pos.toString();
    if (pos < 1000000) return `${(pos / 1000).toFixed(1)}K`;
    if (pos < 1000000000) return `${(pos / 1000000).toFixed(1)}M`;
    return `${(pos / 1000000000).toFixed(2)}G`;
  };

  const isLogSelected = (source: LogSource) => {
    if (!logSource) return false;
    if (source.type === 'node' && logSource.type === 'node') {
      return source.id === logSource.id;
    }
    if (source.type === 'service' && logSource.type === 'service') {
      return source.name === logSource.name;
    }
    return false;
  };

  const getLogLevel = (line: string): 'error' | 'warn' | 'info' | 'debug' => {
    const lower = line.toLowerCase();
    if (lower.includes('[error]') || lower.includes('exception') || lower.includes('severe') || lower.includes('failed')) {
      return 'error';
    }
    if (lower.includes('[warn]') || lower.includes('warning')) {
      return 'warn';
    }
    if (lower.includes('[info]') || lower.includes('[gateway]') || lower.includes('started') || lower.includes('connected')) {
      return 'info';
    }
    return 'debug';
  };

  const filteredLogs = logs.filter(line => {
    const level = getLogLevel(line);
    return logFilters[level];
  });

  const toggleFilter = (filter: 'error' | 'warn' | 'info' | 'debug') => {
    setLogFilters(prev => ({ ...prev, [filter]: !prev[filter] }));
  };

  // ── Derived state ──

  const clusterStatus = getClusterStatus(progress, status?.nodes || []);
  const isOperationRunning = !!(progress?.operation && !progress.complete);
  const operationProgress = isOperationRunning ? (progress?.progress || 0) : 0;
  const serviceProcesses = processes.filter(p => p.role !== 'cluster');

  const tabClass = (active: boolean) =>
    `relative -mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium font-display transition-colors ${
      active
        ? 'border-accent text-accent'
        : 'border-transparent text-muted hover:text-text'
    }`;

  // Per-tone styling for confirm modal buttons + node action buttons.
  const confirmBtnClass = (style: 'danger' | 'warning' | 'primary') => {
    switch (style) {
      case 'danger':
        return 'border border-sell/40 bg-sell-soft text-sell hover:brightness-105';
      case 'warning':
        return 'border border-warn/40 bg-warn-soft text-warn hover:brightness-105';
      case 'primary':
        return 'border border-buy/40 bg-buy-soft text-buy hover:brightness-105';
    }
  };

  const iconBtnBase =
    'flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed [&_svg]:h-3.5 [&_svg]:w-3.5';
  const iconBtnStop = `${iconBtnBase} bg-sell-soft text-sell hover:brightness-110`;
  const iconBtnRestart = `${iconBtnBase} bg-warn-soft text-warn hover:brightness-110`;
  const iconBtnStart = `${iconBtnBase} bg-buy-soft text-buy hover:brightness-110`;
  const iconBtnAccent = `${iconBtnBase} bg-accent-soft text-accent hover:brightness-110`;
  const iconBtnLogs = (active: boolean) =>
    `${iconBtnBase} ${active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted hover:text-text'}`;

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-hairline bg-surface/95 px-6 py-3 backdrop-blur">
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text [&_svg]:h-4 [&_svg]:w-4"
        >
          {Icons.back}
          <span>Trading</span>
        </Link>
        <div className="h-5 w-px bg-hairline" />
        <h1 className="font-display text-[17px] font-semibold tracking-tight text-text-strong">
          <span className="text-accent">Open</span> Exchange — Admin
        </h1>
        <div className="ml-auto">
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
      </header>

      {/* Tab bar */}
      <div className="border-b border-hairline bg-surface px-6">
        <nav className="mx-auto flex max-w-[1280px] gap-1">
          <button className={tabClass(tab === 'cluster')} onClick={() => setTab('cluster')}>Cluster</button>
          <button className={tabClass(tab === 'risk')} onClick={() => setTab('risk')}>Risk</button>
          <button className={tabClass(tab === 'backup')} onClick={() => setTab('backup')}>Backup</button>
        </nav>
      </div>

      <div className="mx-auto max-w-[1280px] px-6 pb-12 pt-6">
        {/* Error Banner (shared) */}
        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-md border border-sell/20 bg-sell-soft px-4 py-2.5 text-sell [&_svg]:h-4 [&_svg]:w-4">
            {Icons.x}
            <span className="flex-1 text-[13px] font-medium">{error}</span>
            <button
              onClick={() => setError(null)}
              className="rounded-md px-2 py-1 text-[12px] font-medium hover:bg-sell/10"
            >
              Dismiss
            </button>
          </div>
        )}

        {tab === 'risk' && <RiskAdmin />}
        {tab === 'backup' && <BackupOps />}

        {tab === 'cluster' && (
          <>
            {/* Cluster Status Bar */}
            {!status ? (
              <div className="mb-6 h-[60px] animate-pulse rounded-md border border-hairline bg-surface-2" />
            ) : (
              <div className={`relative mb-6 flex items-center overflow-hidden rounded-md border border-l-[3px] border-hairline bg-surface p-4 ${STATUS_BAR_BORDER[clusterStatus.status]}`}>
                <div
                  className="absolute left-0 top-0 h-0.5 bg-accent transition-[width] duration-500"
                  style={{ width: `${operationProgress}%` }}
                />
                <div className="relative flex w-full items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT_COLOR[clusterStatus.status]} ${clusterStatus.status !== 'healthy' ? 'animate-pulse-soft' : ''}`} />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-display text-[14px] font-semibold text-text-strong">{clusterStatus.title}</span>
                      <span className="text-[12px] text-muted">{clusterStatus.detail}</span>
                    </div>
                  </div>
                  {isOperationRunning ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[14px] font-semibold tabular-nums text-accent">{operationProgress}%</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5"
                        onClick={requestRollingUpdate}
                        disabled={isOperationRunning}
                      >
                        {Icons.update}
                        <span>Rolling Update</span>
                      </button>
                      <button
                        className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5"
                        onClick={requestRollingCleanup}
                        disabled={isOperationRunning}
                      >
                        {Icons.archive}
                        <span>Rolling Cleanup</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <main className="flex flex-col gap-7">
              {/* Cluster Nodes */}
              <section className="rounded-lg border border-hairline bg-surface p-6">
                <div className="mb-5 flex flex-wrap items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
                  {Icons.server}
                  <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Cluster Nodes</h2>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-sell disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
                      onClick={requestStopAllNodes}
                      disabled={isOperationRunning}
                      title="Stop All Nodes"
                    >
                      {Icons.stop}
                      <span>Stop All</span>
                    </button>
                    <button
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-buy disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
                      onClick={requestStartAllNodes}
                      disabled={isOperationRunning}
                      title="Start All Nodes"
                    >
                      {Icons.play}
                      <span>Start All</span>
                    </button>
                    <button
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-warn disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3"
                      onClick={requestCleanup}
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
                    const logSelected = isLogSelected({ type: 'node', id: node.id });
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
                              <button className={iconBtnStop} onClick={() => requestStopNode(node.id)} disabled={isOperationRunning} title="Stop">
                                {Icons.stop}
                              </button>
                              <button className={iconBtnRestart} onClick={() => requestRestartNode(node.id)} disabled={isOperationRunning} title="Restart">
                                {Icons.restart}
                              </button>
                            </>
                          ) : !node.running && !isTransitioning ? (
                            <button className={iconBtnStart} onClick={() => requestStartNode(node.id)} disabled={isOperationRunning} title="Start">
                              {Icons.play}
                            </button>
                          ) : null}
                          <button
                            className={iconBtnLogs(logSelected)}
                            onClick={() => setLogSource({ type: 'node', id: node.id })}
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

              {/* Services — powered by Process Manager */}
              <section className="rounded-lg border border-hairline bg-surface p-6">
                <div className="mb-5 flex items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
                  {Icons.server}
                  <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Services</h2>
                </div>
                {processSummary && (
                  <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-hairline bg-surface-2 px-5 py-3">
                    <div className="flex min-w-[50px] flex-col items-center gap-0.5">
                      <span className="font-mono text-[16px] font-semibold tabular-nums text-buy">{processSummary.running}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Running</span>
                    </div>
                    <div className="flex min-w-[50px] flex-col items-center gap-0.5">
                      <span className="font-mono text-[16px] font-semibold tabular-nums text-muted">{processSummary.stopped}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Stopped</span>
                    </div>
                    {processSummary.failed > 0 && (
                      <div className="flex min-w-[50px] flex-col items-center gap-0.5">
                        <span className="font-mono text-[16px] font-semibold tabular-nums text-sell">{processSummary.failed}</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Failed</span>
                      </div>
                    )}
                    <div className="flex min-w-[50px] flex-col items-center gap-0.5">
                      <span className="font-mono text-[13px] font-semibold tabular-nums text-accent">
                        {processSummary.totalMemoryMB > 1024
                          ? `${(processSummary.totalMemoryMB / 1024).toFixed(1)} GB`
                          : `${Math.round(processSummary.totalMemoryMB)} MB`}
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Total Memory</span>
                    </div>
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  {processes.length === 0 ? (
                    <>
                      <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
                      <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
                      <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
                      <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
                    </>
                  ) : (
                    serviceProcesses.map((proc) => {
                      const isOperating = operatingServices.has(proc.name);
                      const logName = processToLogName(proc.name);
                      const logSelected = isLogSelected({ type: 'service', name: logName });
                      const procDot = isOperating ? 'animate-pulse-soft bg-warn' : (STATUS_DOT_COLOR[proc.status] || 'bg-faint');

                      return (
                        <div key={proc.name} className={`flex flex-col gap-3.5 rounded-lg border bg-surface p-4 ${isOperating ? 'border-warn/30' : 'border-hairline'}`}>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted [&_svg]:h-4 [&_svg]:w-4">{getProcessIcon(proc.name)}</div>
                            <div className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold text-text-strong">
                                {proc.display}
                                {' '}
                                <span className={`ml-1 rounded-full px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide ${proc.role === 'infra' ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'}`}>{proc.role}</span>
                              </span>
                              <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted">
                                {isOperating
                                  ? 'Processing...'
                                  : `${proc.status}${proc.running && proc.port > 0 ? ` :${proc.port}` : ''}`}
                              </span>
                            </div>
                            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${procDot}`} />
                          </div>
                          {proc.running && (
                            <div className="flex flex-wrap gap-3 font-mono text-[10px] tabular-nums text-faint">
                              <span className="flex items-center gap-1">PID <span className="text-text">{proc.pid}</span></span>
                              <span className="flex items-center gap-1">Mem <span className="text-text">{formatBytes(proc.memoryBytes)}</span></span>
                              <span className="flex items-center gap-1">CPU <span className="text-text">{(proc.cpuPercent ?? 0).toFixed(1)}%</span></span>
                              <span className="flex items-center gap-1">Up <span className="text-text">{formatUptime(proc.uptimeMs)}</span></span>
                            </div>
                          )}
                          <div className="flex justify-end gap-1.5">
                            {!isOperating && proc.running ? (
                              <>
                                <button className={iconBtnStop} onClick={() => requestProcessAction(proc.name, 'stop')} disabled={isOperationRunning || isOperating} title="Stop">{Icons.stop}</button>
                                <button className={iconBtnRestart} onClick={() => requestProcessAction(proc.name, 'restart')} disabled={isOperationRunning || isOperating} title="Restart">{Icons.restart}</button>
                                {proc.name === 'backup' && (
                                  <button
                                    className={iconBtnAccent}
                                    onClick={takeSnapshot}
                                    disabled={snapshotOp || isOperationRunning}
                                    title="Take Snapshot"
                                  >
                                    {Icons.snapshot}
                                  </button>
                                )}
                                {proc.name === 'admin' && (
                                  <button
                                    className={iconBtnAccent}
                                    onClick={requestSelfUpdate}
                                    disabled={isOperationRunning || isOperating}
                                    title="Self-Update"
                                  >
                                    {Icons.update}
                                  </button>
                                )}
                              </>
                            ) : !isOperating ? (
                              <button className={iconBtnStart} onClick={() => requestProcessAction(proc.name, 'start')} disabled={isOperationRunning || isOperating} title="Start">{Icons.play}</button>
                            ) : null}
                            <button
                              className={iconBtnLogs(logSelected)}
                              onClick={() => setLogSource({ type: 'service', name: logName })}
                              title="View Logs"
                            >
                              {Icons.logs}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {/* Log Viewer */}
              <section className="rounded-lg border border-hairline bg-surface p-6">
                <div className="mb-5 flex flex-wrap items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
                  {Icons.logs}
                  <h2 className="flex-1 font-mono text-[12px] font-semibold text-text-strong">{getLogSourceLabel(logSource)}</h2>
                  {logSource && (
                    <>
                      <div className="flex flex-wrap gap-1">
                        <button
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.error ? 'border-sell/30 bg-sell-soft text-sell' : 'border-transparent text-muted hover:text-text'}`}
                          onClick={() => toggleFilter('error')}
                        >
                          Error
                        </button>
                        <button
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.warn ? 'border-warn/30 bg-warn-soft text-warn' : 'border-transparent text-muted hover:text-text'}`}
                          onClick={() => toggleFilter('warn')}
                        >
                          Warn
                        </button>
                        <button
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.info ? 'border-accent/30 bg-accent-soft text-accent' : 'border-transparent text-muted hover:text-text'}`}
                          onClick={() => toggleFilter('info')}
                        >
                          Info
                        </button>
                        <button
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.debug ? 'border-hairline-strong bg-surface-2 text-text' : 'border-transparent text-muted hover:text-text'}`}
                          onClick={() => toggleFilter('debug')}
                        >
                          Debug
                        </button>
                      </div>
                      <button
                        className="rounded-full border border-hairline px-3 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
                        onClick={() => setLogSource(null)}
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
                <div
                  className="h-80 overflow-y-auto rounded-md border border-hairline bg-bg font-mono text-[12px] leading-relaxed"
                  ref={logsRef}
                >
                  {logSource ? (
                    filteredLogs.length > 0 ? (
                      filteredLogs.map((line, i) => {
                        const level = getLogLevel(line);
                        const lineClass =
                          level === 'error' ? 'border-l-sell bg-sell-soft text-text'
                          : level === 'warn' ? 'border-l-warn bg-warn-soft text-text'
                          : level === 'info' ? 'border-l-accent text-text'
                          : 'border-l-transparent text-muted';
                        return (
                          <div key={i} className={`flex items-start whitespace-pre-wrap break-all border-l-2 py-px pr-3 ${lineClass}`}>
                            <span className="w-10 flex-shrink-0 select-none px-3 text-right text-[10px] text-faint">{i + 1}</span>
                            <span className="flex-1">{line}</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="py-6 text-center italic text-muted">No logs match the current filters</div>
                    )
                  ) : (
                    <div className="py-6 text-center italic text-muted">Click a log button on any node or service to view its logs</div>
                  )}
                </div>
              </section>
            </main>
          </>
        )}
      </div>

      {/* Confirmation Modal (cluster actions) */}
      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-overlay-in"
          onClick={() => setPendingAction(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-hairline bg-surface shadow-lg animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-hairline px-5 py-3.5">
              <h3 className="font-display text-[15px] font-semibold text-text-strong">{pendingAction.title}</h3>
            </div>
            <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">{pendingAction.message}</p>
            <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
              <button
                className="rounded-md border border-hairline px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-hairline-strong hover:text-text"
                onClick={() => setPendingAction(null)}
              >
                Cancel
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-[filter] ${confirmBtnClass(pendingAction.confirmStyle)}`}
                onClick={confirmAction}
              >
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
