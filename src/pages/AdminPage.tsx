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
import { ClusterSection, ClusterSkeleton } from '../components/admin/ClusterSection';
import { OverviewDashboard } from '../components/admin/OverviewDashboard';
import { ServicesSection } from '../components/admin/ServicesSection';
import { LogViewer } from '../components/admin/LogViewer';
import { ProfileSelector } from '../components/admin/ProfileSelector';
import { ProfilesEditor } from '../components/admin/ProfilesEditor';
import { adminUrl, normalizeStatus } from '../components/admin/api';
import { GRAFANA_URL } from '../config';
import { useAdminEvents, type AdminProgress } from '../hooks/useAdminEvents';
import type {
  AdminStatus,
  AdminTab,
  ConfirmAction,
  LogSource,
  ProcessInfo,
  ProcessSummary,
  ProfileInfo,
} from '../components/admin/types';

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
  const [tab, setTab] = useState<AdminTab>('overview');
  const [status, setStatus] = useState<AdminStatus | null>(null);
  // REST reachability: connectivity is persistent state (the header pill),
  // never a banner or a per-poll toast.
  const [gatewayOk, setGatewayOk] = useState(true);
  const [progress, setProgress] = useState<AdminProgress | null>(null);
  // Which cluster the (single, shared) backend progress record belongs to.
  // The backend Progress has no cluster field — only one op runs at a time
  // across ALL clusters — so we attribute it client-side.
  const [activeOpCluster, setActiveOpCluster] = useState<string | null>(null);
  // null = never loaded (skeletons); [] = loaded-and-empty (quiet notice).
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [logsUnavailable, setLogsUnavailable] = useState(false);
  const [processSummary, setProcessSummary] = useState<ProcessSummary | null>(null);
  const [operatingServices, setOperatingServices] = useState<Set<string>>(new Set());
  // Per-cluster snapshot-button busy (5s blind window), keyed by cluster name.
  const [snapshotOps, setSnapshotOps] = useState<Set<string>>(new Set());
  const [logSource, setLogSource] = useState<LogSource | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  // Runtime profiles (available set is static; the active one rides the status
  // poll, seeded from the initial GET so the header shows it pre-first-status).
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [seedProfile, setSeedProfile] = useState('');

  // The generic clusters[] the whole console renders. normalizeStatus makes
  // this work against BOTH the new (clusters[]) and legacy (flat) backend and
  // guarantees ≥1 block once status has loaded.
  const clusters = status ? normalizeStatus(status) : null;
  const clusterDisplayOf = useCallback(
    (name: string) => clusters?.find(c => c.name === name)?.display ?? name,
    [clusters],
  );

  // GLOBAL lock: any op running anywhere disables every mutating button and
  // the ProfileSelector. Only ONE backend operation runs at a time.
  const stackBusy = !!(progress?.operation && !progress.complete);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(adminUrl('/api/admin/status'));
      if (response.ok) {
        const data = await response.json() as AdminStatus;
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
      const response = await fetch(adminUrl('/api/admin/progress'));
      if (response.ok) {
        const data = await response.json() as AdminProgress;
        if (data.operation || data.currentStep > 0) {
          setProgress(data);
          if (data.complete) {
            setTimeout(async () => {
              await fetch(adminUrl('/api/admin/progress?reset=true'));
              setProgress(null);
              setActiveOpCluster(null);
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
      let url = adminUrl('/api/admin/logs') + '?lines=200';
      if (logSource.type === 'node') {
        url += `&node=${logSource.id}&cluster=${encodeURIComponent(logSource.cluster)}`;
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
        fetch(adminUrl('/api/admin/processes')),
        fetch(adminUrl('/api/admin/processes/summary')),
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
  operationActiveRef.current = stackBusy;

  // Attribution catch-all: once no op is running, drop the cluster tag so a
  // later auto/unattributed op doesn't inherit a stale target.
  useEffect(() => {
    if (!stackBusy) setActiveOpCluster(null);
  }, [stackBusy]);

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
          await fetch(adminUrl('/api/admin/progress?reset=true'));
          setProgress(null);
          setActiveOpCluster(null);
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

  // Load the runtime-profile set for the header selector. Fetched once on
  // mount and re-fetched by the Profiles editor after a save/delete so new
  // customs show up in the header <select> immediately.
  const fetchProfiles = useCallback(async () => {
    try {
      const r = await fetch(adminUrl('/api/admin/profile'));
      const d = await r.json();
      setProfiles(d.available ?? []);
      setSeedProfile(d.active ?? '');
    } catch {
      // Header select keeps its last-known set; the pill carries connectivity.
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    if (logSource) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [logSource, fetchLogs]);

  // ── Node action handlers (cluster-scoped) ──

  const requestNodeAction = (cluster: string, type: 'stop-node' | 'restart-node' | 'start-node', nodeId: number) => {
    if (stackBusy) return;
    const disp = clusterDisplayOf(cluster);
    const copy: Record<typeof type, { title: string; message: string; confirmLabel: string; confirmStyle: 'danger' | 'warning' | 'primary' }> = {
      'stop-node': {
        title: `Stop Node ${nodeId}?`,
        message: `This will stop node ${nodeId} of the ${disp}. The cluster will continue with remaining nodes.`,
        confirmLabel: 'Stop Node',
        confirmStyle: 'danger',
      },
      'restart-node': {
        title: `Restart Node ${nodeId}?`,
        message: `This will restart node ${nodeId} of the ${disp}. It will temporarily leave the cluster and rejoin.`,
        confirmLabel: 'Restart Node',
        confirmStyle: 'warning',
      },
      'start-node': {
        title: `Start Node ${nodeId}?`,
        message: `This will start node ${nodeId} of the ${disp} and it will attempt to rejoin the cluster.`,
        confirmLabel: 'Start Node',
        confirmStyle: 'primary',
      },
    };
    setPendingAction({ type, cluster, nodeId, ...copy[type] });
  };

  const requestAllNodes = (cluster: string, type: 'stop-all-nodes' | 'start-all-nodes') => {
    if (stackBusy) return;
    const disp = clusterDisplayOf(cluster);
    if (type === 'stop-all-nodes') {
      setPendingAction({
        type, cluster,
        title: 'Stop All Nodes?',
        message: `This will stop all ${disp} nodes. The cluster will become completely unavailable.`,
        confirmLabel: 'Stop All',
        confirmStyle: 'danger',
      });
    } else {
      setPendingAction({
        type, cluster,
        title: 'Start All Nodes?',
        message: `This will start all ${disp} nodes and form a new cluster.`,
        confirmLabel: 'Start All',
        confirmStyle: 'primary',
      });
    }
  };

  const requestCleanup = (cluster: string) => {
    if (stackBusy) return;
    const disp = clusterDisplayOf(cluster);
    setPendingAction({
      type: 'cleanup', cluster,
      title: 'Clean Aeron State?',
      message: `This will remove stale Aeron files (shared memory, locks) for the ${disp}. All its nodes must be stopped first.`,
      confirmLabel: 'Clean State',
      confirmStyle: 'warning',
    });
  };

  const executeNodeAction = async (cluster: string, action: string, nodeId: number) => {
    setActiveOpCluster(cluster);
    try {
      const response = await fetch(adminUrl(`/api/admin/${action}`, { cluster }), {
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

  const executeAllNodes = async (cluster: string, action: 'stop-all-nodes' | 'start-all-nodes') => {
    setActiveOpCluster(cluster);
    try {
      const response = await fetch(adminUrl(`/api/admin/${action}`, { cluster }), { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to ${action.replace(/-/g, ' ')} (HTTP ${response.status})`, sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: `Failed to ${action.replace(/-/g, ' ')}`, sticky: true });
    }
  };

  // ── Topology change (node count): a genesis RE-FORM, data loss by design ──

  const requestTopologyChange = (cluster: string, nodeCount: number) => {
    if (stackBusy) return;
    const disp = clusterDisplayOf(cluster);
    const wipes = cluster === 'match'
      ? 'its cluster + archive state AND all orders, trades and balances in Redis/Postgres/Timescale (users and risk config are preserved; the sim re-funds its bots)'
      : 'its cluster + archive state';
    setPendingAction({
      type: 'cluster-topology',
      cluster,
      nodeCount,
      requireText: 'DELETE-CLUSTER-STATE',
      title: `Re-form the ${disp} with ${nodeCount} node${nodeCount === 1 ? '' : 's'}?`,
      message: `Aeron membership is static, so changing the node count re-forms the cluster FROM GENESIS. This WIPES ${wipes}. The cluster is down until the new member set elects a leader.`,
      confirmLabel: 'Re-form Cluster',
      confirmStyle: 'danger',
    });
  };

  const executeTopologyChange = async (cluster: string, nodeCount: number) => {
    setActiveOpCluster(cluster);
    try {
      const response = await fetch(adminUrl('/api/admin/cluster-topology', { cluster }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeCount, confirm: 'DELETE-CLUSTER-STATE' }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Topology change failed (HTTP ${response.status})`, sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to trigger the topology change', sticky: true });
    }
  };

  const executeCleanup = async (cluster: string) => {
    setActiveOpCluster(cluster);
    try {
      const response = await fetch(adminUrl('/api/admin/cleanup', { cluster }), {
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

  // ── Generic process action handler (shared services) ──

  const requestProcessAction = (service: string, action: 'start' | 'stop' | 'restart') => {
    if (operatingServices.has(service) || stackBusy) return;

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
      const response = await fetch(adminUrl(`/api/admin/processes/${service}/${action}`), { method: 'POST' });
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
    if (operatingServices.has('admin') || stackBusy) return;
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
      const response = await fetch(adminUrl('/api/admin/rebuild-admin'), { method: 'POST' });
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

  // ── Snapshot (per cluster, from the rail) ──

  const requestSnapshot = (cluster: string) => {
    if (stackBusy || snapshotOps.has(cluster)) return;
    const disp = clusterDisplayOf(cluster);
    setPendingAction({
      type: 'snapshot', cluster,
      title: `Take a snapshot of the ${disp}?`,
      message: `Captures a consistent snapshot of the ${disp} cluster state for fast recovery. Safe to run on the live cluster.`,
      confirmLabel: 'Take Snapshot',
      confirmStyle: 'primary',
    });
  };

  const executeSnapshot = async (cluster: string) => {
    setSnapshotOps(prev => new Set(prev).add(cluster));
    setActiveOpCluster(cluster);
    const clear = () => setSnapshotOps(prev => {
      const next = new Set(prev);
      next.delete(cluster);
      return next;
    });
    try {
      const response = await fetch(adminUrl('/api/admin/snapshot', { cluster }), { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({ tone: 'error', text: data.error || `Failed to take snapshot (HTTP ${response.status})`, sticky: true });
        clear();
        return;
      }
      setTimeout(clear, 5000);
    } catch {
      toast({ tone: 'error', text: 'Failed to take snapshot', sticky: true });
      clear();
    }
  };

  // ── Rolling operations (per cluster) ──

  const requestRollingUpdate = (cluster: string) => {
    if (stackBusy) return;
    const disp = clusterDisplayOf(cluster);
    setPendingAction({
      type: 'rolling-update', cluster,
      title: 'Start Rolling Update?',
      message: `This will rebuild the application and restart all ${disp} nodes one by one. The cluster will remain available during the update.`,
      confirmLabel: 'Start Update',
      confirmStyle: 'warning',
    });
  };

  const executeRollingUpdate = async (cluster: string) => {
    setActiveOpCluster(cluster);
    try {
      const response = await fetch(adminUrl('/api/admin/rolling-update', { cluster }), { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        toast({ tone: 'error', text: data.error || 'Rolling update failed', sticky: true });
      }
    } catch {
      toast({ tone: 'error', text: 'Failed to trigger rolling update', sticky: true });
    }
  };

  const requestHousekeeping = (cluster: string) => {
    if (stackBusy) return;
    const disp = clusterDisplayOf(cluster);
    setPendingAction({
      type: 'housekeeping', cluster,
      title: 'Start Archive Housekeeping?',
      message: `Reclaims archive disk on the live ${disp} by purging log segments below the latest snapshot. Live-safe; refused if any node is down or lagging.`,
      confirmLabel: 'Start Housekeeping',
      confirmStyle: 'warning',
    });
  };

  const executeHousekeeping = async (cluster: string, force: boolean) => {
    setActiveOpCluster(cluster);
    try {
      const response = await fetch(adminUrl('/api/admin/housekeeping', { cluster }), {
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
            type: 'housekeeping-force', cluster,
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

  // ── Runtime profile switch ──

  const activeProfileName = status?.activeProfile ?? seedProfile;

  const requestProfileSwitch = (name: string) => {
    if (stackBusy) return;
    if (!name || name === activeProfileName) return;
    const target = profiles.find((p) => p.name === name);
    const active = profiles.find((p) => p.name === activeProfileName);
    // The embedded↔external driver-mode boundary can't be rolled node-by-node:
    // the whole cluster stops briefly and restarts (state preserved). Tell the
    // operator the truth and tone it as the outage it is.
    const driverModeChange = !!(target && active && target.driverMode !== active.driverMode);
    setPendingAction({
      type: 'apply-profile',
      profileName: name,
      title: `Switch to the ${name} profile?`,
      message: driverModeChange
        ? `${target?.description ?? ''} This switch moves the media driver ${
            target?.driverMode === 'embedded'
              ? 'into the node process (embedded)'
              : 'out to dedicated driver processes (external)'
          } — the WHOLE cluster stops briefly and restarts. State is preserved (same membership; nodes recover from snapshot + log). Trading pauses until the cluster is back.`
        : `${target?.description ?? ''} Applying rolls every service onto the new profile — cluster nodes one at a time (quorum held), then gateways and the sim. Expect a brief blip; no code is rebuilt.`,
      confirmLabel: 'Apply Profile',
      confirmStyle: driverModeChange ? 'danger' : 'warning',
    });
  };

  const executeProfileSwitch = async (name: string, force: boolean) => {
    try {
      const response = await fetch(adminUrl('/api/admin/profile'), {
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
        if (action.nodeId !== undefined && action.cluster) {
          await executeNodeAction(action.cluster, action.type, action.nodeId);
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
        if (action.cluster) await executeRollingUpdate(action.cluster);
        break;
      case 'housekeeping':
        if (action.cluster) await executeHousekeeping(action.cluster, false);
        break;
      case 'housekeeping-force':
        if (action.cluster) await executeHousekeeping(action.cluster, true);
        break;
      case 'snapshot':
        if (action.cluster) await executeSnapshot(action.cluster);
        break;
      case 'stop-all-nodes':
        if (action.cluster) await executeAllNodes(action.cluster, 'stop-all-nodes');
        break;
      case 'start-all-nodes':
        if (action.cluster) await executeAllNodes(action.cluster, 'start-all-nodes');
        break;
      case 'cleanup':
        if (action.cluster) await executeCleanup(action.cluster);
        break;
      case 'cluster-topology':
        if (action.cluster && action.nodeCount) await executeTopologyChange(action.cluster, action.nodeCount);
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

  // Every process that is a cluster node (node0-2, ae0, …) is filtered out of
  // the Services tab, whatever its backend role.
  const clusterNodeNames = new Set<string>(
    clusters?.flatMap(c => c.nodes.map(n => n.procName ?? (c.kind === 'match' ? `node${n.id}` : `${c.name}${n.id}`))) ?? [],
  );

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
            disabled={stackBusy}
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
          <button className={tabClass(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
          <button className={tabClass(tab === 'clusters')} onClick={() => setTab('clusters')}>Clusters</button>
          <button className={tabClass(tab === 'services')} onClick={() => setTab('services')}>Services</button>
          <button className={tabClass(tab === 'profiles')} onClick={() => setTab('profiles')}>Profiles</button>
          <button className={tabClass(tab === 'risk')} onClick={() => setTab('risk')}>Risk</button>
          <button className={tabClass(tab === 'backup')} onClick={() => setTab('backup')}>Backup</button>
        </nav>
      </div>

      <div className="mx-auto max-w-[1280px] px-6 pb-12 pt-6">
        {tab === 'overview' && (
          <OverviewDashboard
            clusters={clusters}
            status={status}
            processSummary={processSummary}
            onOpenClusters={() => setTab('clusters')}
          />
        )}

        {tab === 'services' && (
          <ServicesSection
            processes={processes}
            hidden={clusterNodeNames}
            operatingServices={operatingServices}
            stackBusy={stackBusy}
            logSource={logSource}
            onProcessAction={requestProcessAction}
            onSelfUpdate={requestSelfUpdate}
            onViewLogs={setLogSource}
          />
        )}

        {tab === 'profiles' && (
          <ProfilesEditor
            activeName={activeProfileName}
            stackBusy={stackBusy}
            onApply={requestProfileSwitch}
            onChanged={fetchProfiles}
          />
        )}

        {tab === 'risk' && <RiskAdmin />}
        {tab === 'backup' && <BackupOps clusters={clusters ?? undefined} />}

        {tab === 'clusters' && (
          <main className="flex flex-col gap-8">
            {clusters === null ? (
              <ClusterSkeleton />
            ) : (
              clusters.map((c) => {
                // The shared progress record belongs to exactly one cluster;
                // default unattributed/auto ops to 'match'. Only the targeted
                // cluster shows the % hero + swapped slot; others stay locked.
                const operation = stackBusy && (activeOpCluster ?? 'match') === c.name ? progress : null;
                return (
                  <ClusterSection
                    key={c.name}
                    cluster={c}
                    processes={processes ?? []}
                    operation={operation}
                    stackBusy={stackBusy}
                    snapshotBusy={snapshotOps.has(c.name)}
                    logSource={logSource}
                    onNodeAction={requestNodeAction}
                    onAllNodes={requestAllNodes}
                    onCleanup={requestCleanup}
                    onTopologyChange={requestTopologyChange}
                    onRollingUpdate={requestRollingUpdate}
                    onHousekeeping={requestHousekeeping}
                    onSnapshot={requestSnapshot}
                    onViewLogs={setLogSource}
                  />
                );
              })
            )}

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
              resolveClusterDisplay={clusterDisplayOf}
              onClear={() => setLogSource(null)}
            />
          </main>
        )}
      </div>

      {/* Confirmation Modal (cluster + service actions) */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          body={pendingAction.message}
          tone={pendingAction.confirmStyle}
          confirmLabel={pendingAction.confirmLabel}
          requireText={pendingAction.requireText}
          onConfirm={confirmAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
