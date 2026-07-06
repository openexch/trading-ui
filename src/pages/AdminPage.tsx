// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { ThemeToggle } from '../components/ThemeToggle/ThemeToggle';
import { Icons } from '../components/Icons';
import { RiskAdmin } from '../components/admin/RiskAdmin';
import { BackupOps } from '../components/admin/BackupOps';
import { EventFeed } from '../components/admin/EventFeed';
import { ClusterStatusBar } from '../components/admin/ClusterStatusBar';
import { NodesSection } from '../components/admin/NodesSection';
import { ServicesSection } from '../components/admin/ServicesSection';
import { LogViewer } from '../components/admin/LogViewer';
import { getClusterStatus } from '../components/admin/status';
import { useAdminEvents, type AdminProgress } from '../hooks/useAdminEvents';
import type {
  AdminTab,
  ClusterStatus,
  ConfirmAction,
  LogSource,
  ProcessInfo,
  ProcessSummary,
} from '../components/admin/types';

const ADMIN_BASE = import.meta.env.VITE_ADMIN_API_URL || '';

export function AdminPage() {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<AdminTab>('cluster');
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AdminProgress | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [processSummary, setProcessSummary] = useState<ProcessSummary | null>(null);
  const [operatingServices, setOperatingServices] = useState<Set<string>>(new Set());
  const [snapshotOp, setSnapshotOp] = useState(false);
  const [logSource, setLogSource] = useState<LogSource | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);

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
        const data = await response.json() as AdminProgress;
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

  // Live event stream: process lifecycle events feed the Activity panel and
  // trigger an immediate process-list refresh; progress arrives pushed on
  // change, replacing the old 50ms HTTP fast-poll during operations.
  const {
    events: feedEntries,
    progress: sseProgress,
    connected: eventsConnected,
    unseen: feedUnseen,
    markSeen: markFeedSeen,
  } = useAdminEvents(() => { fetchProcesses(); });
  const eventsConnectedRef = useRef(eventsConnected);
  eventsConnectedRef.current = eventsConnected;

  // Events arriving while the panel is open are already "seen".
  useEffect(() => {
    if (feedOpen) markFeedSeen();
  }, [feedOpen, feedEntries, markFeedSeen]);

  useEffect(() => {
    if (!sseProgress) return;
    if (sseProgress.operation || sseProgress.currentStep > 0) {
      setProgress(sseProgress);
      if (sseProgress.complete) {
        setTimeout(async () => {
          await fetch(`${ADMIN_BASE}/api/admin/progress?reset=true`);
          setProgress(null);
        }, 3000);
      }
    }
  }, [sseProgress]);

  useEffect(() => {
    fetchStatus();
    fetchProgress();
    const interval = setInterval(() => {
      fetchStatus();
      // Progress rides the event stream; poll it only as a fallback while
      // the stream is down.
      if (!eventsConnectedRef.current) {
        fetchProgress();
      }
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

  const requestHousekeeping = () => {
    if (progress?.operation && !progress.complete) return;
    setPendingAction({
      type: 'housekeeping',
      title: 'Start Archive Housekeeping?',
      message: 'Reclaims archive disk on the live cluster by purging log segments below the latest snapshot. Live-safe; refused if any node is down or lagging.',
      confirmLabel: 'Start Housekeeping',
      confirmStyle: 'warning',
    });
  };

  const executeHousekeeping = async (force: boolean) => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/housekeeping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (!response.ok) {
        const data = await response.json();
        if (response.status === 409 && !force && data.error) {
          // The lag guard refused (a node is down/lagging — purging would
          // strand it). Offer an explicit, clearly-dangerous override.
          setPendingAction({
            type: 'housekeeping-force',
            title: 'Housekeeping Refused — Force?',
            message: `The server refused: ${data.error}. Forcing while a member is down or lagging can strand it permanently. Only continue if you know why.`,
            confirmLabel: 'Force Housekeeping',
            confirmStyle: 'danger',
          });
          return;
        }
        setError(data.error || 'Housekeeping failed');
      }
    } catch {
      setError('Failed to trigger housekeeping');
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
      case 'housekeeping':
        await executeHousekeeping(false);
        break;
      case 'housekeeping-force':
        await executeHousekeeping(true);
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

  // ── Derived state ──

  const clusterStatus = getClusterStatus(progress, status?.nodes || []);
  const isOperationRunning = !!(progress?.operation && !progress.complete);
  const operationProgress = isOperationRunning ? (progress?.progress || 0) : 0;

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
            <ClusterStatusBar
              status={status}
              clusterStatus={clusterStatus}
              isOperationRunning={isOperationRunning}
              operationProgress={operationProgress}
              onRollingUpdate={requestRollingUpdate}
              onHousekeeping={requestHousekeeping}
            />

            <main className="flex flex-col gap-7">
              <NodesSection
                status={status}
                processes={processes}
                isOperationRunning={isOperationRunning}
                logSource={logSource}
                onStopNode={requestStopNode}
                onRestartNode={requestRestartNode}
                onStartNode={requestStartNode}
                onStopAll={requestStopAllNodes}
                onStartAll={requestStartAllNodes}
                onCleanup={requestCleanup}
                onViewLogs={setLogSource}
              />

              <ServicesSection
                processes={processes}
                processSummary={processSummary}
                operatingServices={operatingServices}
                snapshotOp={snapshotOp}
                isOperationRunning={isOperationRunning}
                logSource={logSource}
                onProcessAction={requestProcessAction}
                onSnapshot={takeSnapshot}
                onSelfUpdate={requestSelfUpdate}
                onViewLogs={setLogSource}
              />

              {/* Live activity feed (SSE) */}
              <EventFeed
                entries={feedEntries}
                connected={eventsConnected}
                open={feedOpen}
                unseen={feedUnseen}
                onToggle={() => {
                  setFeedOpen((o) => {
                    if (!o) markFeedSeen();
                    return !o;
                  });
                }}
              />

              <LogViewer
                logSource={logSource}
                logs={logs}
                onClear={() => setLogSource(null)}
              />
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
