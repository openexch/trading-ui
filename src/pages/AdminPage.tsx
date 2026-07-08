// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { ThemeToggle } from '../components/ThemeToggle/ThemeToggle';
import { LogoMark } from '../components/LogoMark';
import { Icons } from '../components/Icons';
import { RiskAdmin } from '../components/admin/RiskAdmin';
import { BackupOps } from '../components/admin/BackupOps';
import { EventFeed } from '../components/admin/EventFeed';
import { ConfirmModal } from '../components/admin/ConfirmModal';
import { ToastProvider, useToast } from '../components/admin/Toasts';
import { ClusterStatusBar } from '../components/admin/ClusterStatusBar';
import { NodesSection } from '../components/admin/NodesSection';
import { ServicesSection } from '../components/admin/ServicesSection';
import { LogViewer } from '../components/admin/LogViewer';
import { ProfileSelector } from '../components/admin/ProfileSelector';
import { getClusterStatus } from '../components/admin/status';
import { GRAFANA_URL } from '../config';
import { useAdminEvents, type AdminProgress } from '../hooks/useAdminEvents';
import type {
  AdminTab,
  ClusterStatus,
  ConfirmAction,
  LogSource,
  ProcessInfo,
  ProcessSummary,
  ProfileInfo,
} from '../components/admin/types';

const ADMIN_BASE = import.meta.env.VITE_ADMIN_API_URL || '';

export function AdminPage() {
  return (
    <ToastProvider>
      <AdminConsole />
    </ToastProvider>
  );
}

/**
 * Gateway connectivity — persistent state in a reserved-width pill, never a
 * banner (connectivity is not an event). live = REST + stream up;
 * degraded = REST up, stream down; down = REST unreachable.
 */
function GatewayIndicator({ gatewayOk, eventsConnected }: { gatewayOk: boolean; eventsConnected: boolean }) {
  const state = !gatewayOk ? 'down' : eventsConnected ? 'live' : 'degraded';
  const DOT: Record<string, string> = {
    live: 'bg-buy',
    degraded: 'bg-warn animate-pulse-soft',
    down: 'bg-sell animate-pulse-soft',
  };
  return (
    <span
      title={`Admin gateway: ${state === 'live' ? 'connected' : state === 'degraded' ? 'connected, event stream down' : 'unreachable'}`}
      className="flex w-[110px] flex-shrink-0 items-center justify-end gap-1.5 text-[11px] font-medium text-muted"
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[state]}`} />
      <span className="tabular-nums">{state === 'live' ? 'Gateway' : state === 'degraded' ? 'Degraded' : 'Offline'}</span>
    </span>
  );
}

function AdminConsole() {
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<AdminTab>('cluster');
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  // REST reachability: connectivity is persistent state (the header pill),
  // never a banner or a per-poll toast.
  const [gatewayOk, setGatewayOk] = useState(true);
  const [progress, setProgress] = useState<AdminProgress | null>(null);
  // null = never loaded (skeletons); [] = loaded-and-empty (quiet notice).
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [logsUnavailable, setLogsUnavailable] = useState(false);
  const [processSummary, setProcessSummary] = useState<ProcessSummary | null>(null);
  const [operatingServices, setOperatingServices] = useState<Set<string>>(new Set());
  const [snapshotOp, setSnapshotOp] = useState(false);
  const [logSource, setLogSource] = useState<LogSource | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  // Runtime profiles (available set is static; the active one rides the status
  // poll, seeded from the initial GET so the header shows it pre-first-status).
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [seedProfile, setSeedProfile] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/status`);
      if (response.ok) {
        const data = await response.json() as ClusterStatus;
        setStatus(data);
        setGatewayOk(true);
      } else {
        setGatewayOk(false);
      }
    } catch {
      // Keep the last-good data on screen; the pill carries the bad news.
      setGatewayOk(false);
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
        } else {
          // The server-side record is gone (reset). If we still hold an
          // incomplete operation, it's stale — clear it or the rail sticks
          // mid-percent and every action stays disabled until a refresh.
          setProgress(prev => (prev && !prev.complete ? null : prev));
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
        setLogsUnavailable(false);
      } else {
        setLogsUnavailable(true);
      }
    } catch {
      setLogsUnavailable(true);
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
        setGatewayOk(true);
      } else {
        setGatewayOk(false);
      }
      if (summaryRes.ok) {
        setProcessSummary(await summaryRes.json());
      }
    } catch {
      setGatewayOk(false);
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
  } = useAdminEvents((ev) => {
    fetchProcesses();
    // A 'started' (or 'crashed') event is the real end of a start/restart —
    // clear the operating flag now instead of waiting out the blind timeout
    // (which stays as fallback). 'stopped' is deliberately NOT cleared here:
    // during a restart it would flash the card back to a stopped state.
    if (ev.type === 'started' || ev.type === 'crashed') {
      setOperatingServices(prev => {
        if (!prev.has(ev.service)) return prev;
        const next = new Set(prev);
        next.delete(ev.service);
        return next;
      });
    }
  });
  const eventsConnectedRef = useRef(eventsConnected);
  eventsConnectedRef.current = eventsConnected;
  const operationActiveRef = useRef(false);
  operationActiveRef.current = !!(progress?.operation && !progress.complete);

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
    } else {
      // Empty frame after a server-side reset: drop a stale incomplete op
      // (seen live: a snapshot frame stuck the rail at 71% until refresh).
      setProgress(prev => (prev && !prev.complete ? null : prev));
    }
  }, [sseProgress]);

  useEffect(() => {
    fetchStatus();
    fetchProgress();
    const interval = setInterval(() => {
      fetchStatus();
      // Progress rides the event stream; poll it as a fallback while the
      // stream is down, and while an operation looks active — the poll is
      // what reconciles a stale op if its completion frame never arrives.
      if (!eventsConnectedRef.current || operationActiveRef.current) {
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

  // Load the runtime-profile set once (available profiles are static; the active
  // one comes live from status).
  useEffect(() => {
    fetch(`${ADMIN_BASE}/api/admin/profile`)
      .then((r) => r.json())
      .then((d) => {
        setProfiles(d.available ?? []);
        setSeedProfile(d.active ?? '');
      })
      .catch(() => {});
  }, []);

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
      const response = await fetch(`${ADMIN_BASE}/api/admin/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to ${action.replace('-', ' ')} (HTTP ${response.status})`, sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: `Failed to ${action.replace('-', ' ')}`, sticky: true });
    }
  };

  // ── Generic process action handler (replaces all per-service handlers) ──

  const requestProcessAction = (service: string, action: 'start' | 'stop' | 'restart') => {
    if (operatingServices.has(service) || (progress?.operation && !progress.complete)) return;

    const displayName = processes?.find(p => p.name === service)?.display || service;
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
    const clearOperating = () => setOperatingServices(prev => {
      const next = new Set(prev);
      next.delete(service);
      return next;
    });
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/processes/${service}/${action}`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to ${action} ${service} (HTTP ${response.status})`, sticky: true });
        clearOperating();
        return;
      }
      const timeout = action === 'restart' ? 8000 : 3000;
      setTimeout(() => {
        clearOperating();
        fetchProcesses();
      }, timeout);
    } catch {
      toast({ tone: 'error', text: `Failed to ${action} ${service}`, sticky: true });
      clearOperating();
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
      const response = await fetch(`${ADMIN_BASE}/api/admin/rebuild-admin`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Self-update refused (HTTP ${response.status})`, sticky: true });
        setOperatingServices(prev => {
          const next = new Set(prev);
          next.delete('admin');
          return next;
        });
        return;
      }
      // Admin will restart automatically — connection will drop
    } catch {
      toast({ tone: 'error', text: 'Failed to trigger self-update', sticky: true });
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
      const response = await fetch(`${ADMIN_BASE}/api/admin/snapshot`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to take snapshot (HTTP ${response.status})`, sticky: true });
        setSnapshotOp(false);
        return;
      }
      setTimeout(() => { setSnapshotOp(false); }, 5000);
    } catch {
      toast({ tone: 'error', text: 'Failed to take snapshot', sticky: true });
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
        toast({ tone: 'error', text: data.error || 'Rolling update failed', sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to trigger rolling update', sticky: true });
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
        toast({ tone: 'error', text: data.error || 'Housekeeping failed', sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to trigger housekeeping', sticky: true });
    }
  };

  const executeStopAllNodes = async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/stop-all-nodes`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to stop all nodes (HTTP ${response.status})`, sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to stop all nodes', sticky: true });
    }
  };

  const executeStartAllNodes = async () => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/start-all-nodes`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to start all nodes (HTTP ${response.status})`, sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to start all nodes', sticky: true });
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
        toast({ tone: 'error', text: data.error || 'Cleanup failed', sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to cleanup state', sticky: true });
    }
  };

  // ── Runtime profile switch ──

  const activeProfileName = status?.activeProfile ?? seedProfile;

  const requestProfileSwitch = (name: string) => {
    if (progress?.operation && !progress.complete) return;
    if (!name || name === activeProfileName) return;
    const target = profiles.find((p) => p.name === name);
    setPendingAction({
      type: 'apply-profile',
      profileName: name,
      title: `Switch to the ${name} profile?`,
      message: `${target?.description ?? ''} Applying rolls every service onto the new profile — cluster nodes one at a time (quorum held), then gateways and the sim. Expect a brief blip; no code is rebuilt.`,
      confirmLabel: 'Apply Profile',
      confirmStyle: 'warning',
    });
  };

  const executeProfileSwitch = async (name: string, force: boolean) => {
    try {
      const response = await fetch(`${ADMIN_BASE}/api/admin/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { name, force: true } : { name }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 409 && !force && data.error && /memory|insufficient/i.test(data.error)) {
          // Switch-up headroom guard refused. Offer an explicit force.
          setPendingAction({
            type: 'apply-profile-force',
            profileName: name,
            title: 'Not enough memory — force the switch?',
            message: `The server refused: ${data.error} Forcing commits the larger heaps anyway; only continue if the box can take it.`,
            confirmLabel: 'Force Switch',
            confirmStyle: 'danger',
          });
          return;
        }
        toast({ tone: 'error', text: data.error || `Profile switch failed (HTTP ${response.status})`, sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to switch profile', sticky: true });
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
      case 'apply-profile':
        if (action.profileName) await executeProfileSwitch(action.profileName, false);
        break;
      case 'apply-profile-force':
        if (action.profileName) await executeProfileSwitch(action.profileName, true);
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
        <div className="flex select-none items-center gap-2.5">
          <LogoMark className="h-[22px] w-[22px]" />
          <h1 className="font-display text-[17px] font-semibold leading-none tracking-tight text-text-strong">
            <span className="text-accent">Open</span> Exchange — Admin
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ProfileSelector
            profiles={profiles}
            active={activeProfileName}
            disabled={isOperationRunning}
            onSelect={requestProfileSwitch}
          />
          <a
            href={GRAFANA_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text [&_svg]:h-3.5 [&_svg]:w-3.5"
          >
            <span>Grafana</span>
            {Icons.external}
          </a>
          <GatewayIndicator gatewayOk={gatewayOk} eventsConnected={eventsConnected} />
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
        {tab === 'risk' && <RiskAdmin />}
        {tab === 'backup' && <BackupOps nodes={status?.nodes} />}

        {tab === 'cluster' && (
          <>
            <ClusterStatusBar
              status={status}
              processSummary={processSummary}
              clusterStatus={clusterStatus}
              isOperationRunning={isOperationRunning}
              operationProgress={operationProgress}
              onRollingUpdate={requestRollingUpdate}
              onHousekeeping={requestHousekeeping}
            />

            <main className="flex flex-col gap-8">
              <NodesSection
                status={status}
                processes={processes ?? []}
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
                unavailable={logsUnavailable}
                onClear={() => setLogSource(null)}
              />
            </main>
          </>
        )}
      </div>

      {/* Confirmation Modal (cluster actions) */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          body={pendingAction.message}
          tone={pendingAction.confirmStyle}
          confirmLabel={pendingAction.confirmLabel}
          onConfirm={confirmAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
