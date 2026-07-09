// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * AdminPage smoke test for the multi-cluster console: render the real admin
 * console with the network mocked (fetch returns the generic clusters[]
 * envelope, SSE never connects), and assert the new IA — Overview landing,
 * a stacked ClusterSection per cluster (matching engine + assets engine),
 * shared Services filtered of cluster nodes, cluster-scoped actions carrying
 * ?cluster=, and destructive actions confirming before POSTing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage';

// ---- jsdom gaps -----------------------------------------------------------

/** Scriptable EventSource stub (same shape as useAdminEvents.test.tsx). */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const mkNode = (id: number, role: string) => ({
  id, running: true, pid: 100 + id, role, status: role, procName: `node${id}`,
  commitPosition: 41_200_000, snapshotPosition: 40_000_000, logDelta: 1_200_000, snapshotCount: 3,
  archiveBytes: 1024 * 1024 * 512,
});

const MATCH_NODES = [mkNode(0, 'LEADER'), mkNode(1, 'FOLLOWER'), mkNode(2, 'FOLLOWER')];

const ASSETS_NODE = {
  id: 0, running: true, pid: 301, role: 'LEADER', status: 'LEADER', procName: 'ae0',
  commitPosition: 5_000_000, snapshotCount: 1,
};

const STATUS = {
  clusters: [
    {
      name: 'match', display: 'Matching Engine', kind: 'match',
      nodeCount: 3, leader: 0, allNodesHealthy: true,
      capabilities: { rollingUpdate: true, snapshot: true, cleanup: true, housekeeping: true, backup: true, separateDriver: true },
      nodes: MATCH_NODES,
      backup: { running: true, fresh: true, reason: '' },
    },
    {
      name: 'assets', display: 'Assets Engine', kind: 'assets',
      nodeCount: 1, leader: 0, allNodesHealthy: true,
      // No housekeeping, no snapshot, no backup — the AE rail must hide those.
      capabilities: { rollingUpdate: true, snapshot: false, cleanup: true, housekeeping: false, backup: false, separateDriver: true },
      nodes: [ASSETS_NODE],
    },
  ],
  // Legacy flat aliases (alias of clusters[0]) — kept so a raw response parses.
  nodes: MATCH_NODES,
  leader: 0,
  allNodesHealthy: true,
  gateways: {
    market: { running: true, port: 8081, healthy: true },
    admin: { running: true, port: 8082, healthy: true },
    oms: { running: true, port: 8080, healthy: true },
  },
  activeProfile: 'demo',
  backup: { running: true, fresh: true, reason: '' },
  demoHealthy: true,
};

const proc = (name: string, display: string, role: string, port = 0) => ({
  name, display, role, port,
  running: true, pid: 200, memoryBytes: 1024 * 1024 * 256, cpuPercent: 1.5,
  uptimeMs: 3_600_000, startedAt: '', restartCount: 0, enabled: true, status: 'running',
});

const PROCESSES = [
  proc('node0', 'Cluster Node 0', 'cluster'),
  proc('node1', 'Cluster Node 1', 'cluster'),
  proc('node2', 'Cluster Node 2', 'cluster'),
  // ae0 is a cluster node but the backend labels it 'gateway' — it must STILL
  // be hidden from Services via the cluster-node set, not its role.
  proc('ae0', 'Assets Engine Node', 'gateway'),
  proc('backup', 'Backup Node', 'cluster'),
  proc('oms', 'Order Management', 'gateway', 8080),
  proc('market', 'Market Gateway', 'gateway', 8081),
  proc('admin', 'Admin Gateway', 'gateway', 8082),
];

const SUMMARY = { total: 8, running: 8, stopped: 0, failed: 0, totalMemoryMB: 1792, lastPollMs: 0 };

/** Full profile records for GET /api/admin/profiles (the Profiles tab). */
const fullProfile = (name: string, builtin: boolean) => ({
  name, builtin, description: `${name} profile`,
  nodeHeapMB: 768, omsHeapMB: 512, marketHeapMB: 512, backupHeapMB: 512,
  preTouch: false, idleMode: 'backoff', driverProfile: 'dev', driverMode: 'embedded',
  bookCapacity: 16384, logTermLength: '16m', minMemMB: 1024, simGlobalOps: 60,
  governor: 'schedutil', thp: 'madvise', pinning: 'none',
});

const FULL_PROFILES = [fullProfile('light', true), fullProfile('demo', true), fullProfile('demo-lite', false)];

/** fetch mock returning valid admin-gateway shapes per route. */
function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/admin/status')) {
      body = STATUS;
    } else if (url.includes('/api/admin/progress')) {
      body = { operation: '', status: '', currentStep: 0, totalSteps: 0, progress: 0, complete: false, error: false };
    } else if (url.includes('/api/admin/processes/summary')) {
      body = SUMMARY;
    } else if (url.includes('/api/admin/processes')) {
      body = PROCESSES;
    } else if (url.includes('/api/admin/logs')) {
      body = { logs: ['[INFO] node ready'] };
    } else if (url.includes('/api/admin/profiles')) {
      // Must match BEFORE '/api/admin/profile' — it is a prefix of this path.
      body = { profiles: FULL_PROFILES };
    } else if (url.includes('/api/admin/profile')) {
      body = { active: 'demo', available: [] };
    } else if (url.includes('/api/admin/auto-snapshot')) {
      body = { enabled: true, intervalMinutes: 30 };
    } else if (url.includes('/api/admin/backup-info')) {
      body = { backupDir: '/data/backup', fresh: true, freshReason: '', hasRecordingLog: true, hasArchive: true, recordingCount: 4 };
    } else if (url.includes('/api/v1/admin/risk/config')) {
      body = {}; // no markets configured — Risk tab renders its empty state
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return { mock, calls };
}

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  );
}

const gotoClusters = () => fireEvent.click(screen.getByRole('button', { name: 'Clusters' }));

// ---- tests ----------------------------------------------------------------

describe('AdminPage smoke (multi-cluster)', () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    stubMatchMedia();
    fetchStub = stubFetch();
    localStorage.clear();
  });

  it('lands on Overview with the fleet summary and per-cluster mini-rails', async () => {
    renderAdmin();

    // Stack summary strip: profile, fleet Services/Memory (moved OFF the rail)
    expect(await screen.findByText('demo')).toBeTruthy();
    expect(screen.getByText('8/8')).toBeTruthy();       // Services running/total
    expect(screen.getByText('1.8 GB')).toBeTruthy();     // total memory
    // Gateway health dots labelled
    expect(screen.getByText('Market')).toBeTruthy();
    expect(screen.getByText('OMS')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();

    // A mini-rail per cluster
    expect(screen.getByText('Matching Engine')).toBeTruthy();
    expect(screen.getByText('Assets Engine')).toBeTruthy();
  });

  it('renders overview chrome with dashes before data arrives', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    renderAdmin();
    // Gateway labels + pending dashes render; no crash, no skeleton-over-data
    expect(screen.getByText('Market')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('stacks a ClusterSection per cluster; capability-gates the AE ops slot', async () => {
    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();

    const match = within(await screen.findByRole('region', { name: 'Matching Engine' }));
    const assets = within(screen.getByRole('region', { name: 'Assets Engine' }));

    // Both rails read healthy (each has a leader)
    expect(match.getByText('Cluster Healthy')).toBeTruthy();
    expect(assets.getByText('Cluster Healthy')).toBeTruthy();

    // Matching engine rail: all three ops (it has every capability)
    expect(match.getByRole('button', { name: /Rolling Update/i })).toBeTruthy();
    expect(match.getByRole('button', { name: /Housekeeping/i })).toBeTruthy();
    expect(match.getByRole('button', { name: /Snapshot/i })).toBeTruthy();
    // Three node cards
    expect(match.getByText('Node 1')).toBeTruthy();
    expect(match.getByText('Node 2')).toBeTruthy();

    // Assets rail: Rolling Update only — Housekeeping/Snapshot are gated off
    expect(assets.getByRole('button', { name: /Rolling Update/i })).toBeTruthy();
    expect(assets.queryByRole('button', { name: /Housekeeping/i })).toBeNull();
    expect(assets.queryByRole('button', { name: /Snapshot/i })).toBeNull();
    // Cleanup is a capability the AE has — its node grid keeps it
    expect(assets.getByRole('button', { name: /Cleanup/i })).toBeTruthy();
  });

  it('confirms a node stop and POSTs it to the right cluster (?cluster=match)', async () => {
    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();

    const match = within(await screen.findByRole('region', { name: 'Matching Engine' }));
    fireEvent.click(match.getAllByTitle('Stop')[0]); // Node 0 stop
    expect(await screen.findByText('Stop Node 0?')).toBeTruthy();

    // Cancel closes without a POST
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchStub.calls.some(c => c.url.includes('/api/admin/stop-node'))).toBe(false);

    // Confirm issues the POST with the cluster query + node body
    fireEvent.click(match.getAllByTitle('Stop')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Node' }));
    await waitFor(() => {
      const post = fetchStub.calls.find(c => c.url.includes('/api/admin/stop-node') && c.init?.method === 'POST');
      expect(post, 'expected a POST /api/admin/stop-node').toBeTruthy();
      expect(post!.url).toContain('cluster=match');
      expect(JSON.parse(String(post!.init!.body))).toEqual({ nodeId: 0 });
    });
  });

  it('routes an assets-cluster node action to ?cluster=assets', async () => {
    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();

    const assets = within(await screen.findByRole('region', { name: 'Assets Engine' }));
    fireEvent.click(assets.getAllByTitle('Stop')[0]); // AE Node 0 stop
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Node' }));
    await waitFor(() => {
      const post = fetchStub.calls.find(
        c => c.url.includes('/api/admin/stop-node') && c.url.includes('cluster=assets') && c.init?.method === 'POST',
      );
      expect(post, 'expected a POST /api/admin/stop-node?cluster=assets').toBeTruthy();
    });
  });

  it('shows only shared services — never a cluster node (node0-2 or ae0)', async () => {
    renderAdmin();
    await screen.findByText('demo');
    fireEvent.click(screen.getByRole('button', { name: 'Services' }));

    expect(await screen.findByText('Order Management')).toBeTruthy();
    expect(screen.getByText('Market Gateway')).toBeTruthy();
    expect(screen.getByText('Admin Gateway')).toBeTruthy();
    // Cluster nodes are filtered out regardless of backend role
    expect(screen.queryByText('Cluster Node 0')).toBeNull();
    expect(screen.queryByText('Assets Engine Node')).toBeNull();
  });

  it('renders the Profiles tab with the editor shell', async () => {
    renderAdmin();
    await screen.findByText('demo');
    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }));

    // The editor fetched GET /api/admin/profiles: list rows with BUILT-IN
    // chips, plus the apply-tier legend above the selected profile's form.
    expect(await screen.findByText('light')).toBeTruthy();
    expect(screen.getByText('demo-lite')).toBeTruthy();
    expect(screen.getAllByText('Built-in').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/quorum-safe live roll/)).toBeTruthy();
    await waitFor(() =>
      expect(fetchStub.calls.some(c => c.url.includes('/api/admin/profiles'))).toBe(true),
    );
  });

  it('switches to the Risk and Backup tabs', async () => {
    renderAdmin();
    await screen.findByText('demo');

    fireEvent.click(screen.getByRole('button', { name: 'Risk' }));
    expect(await screen.findByText(/No markets have risk config set/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Backup' }));
    expect(await screen.findByText('Auto-snapshot')).toBeTruthy();
    expect(screen.getByText('Recover from backup')).toBeTruthy();
  });

  it('selects a node log source and labels it with the cluster display', async () => {
    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();

    const match = within(await screen.findByRole('region', { name: 'Matching Engine' }));
    fireEvent.click(match.getAllByTitle('View Logs')[0]);

    expect(await screen.findByText('[INFO] node ready')).toBeTruthy();
    expect(screen.getByText('Matching Engine · Node 0')).toBeTruthy();
    // The tail request carries the cluster
    await waitFor(() =>
      expect(fetchStub.calls.some(c => c.url.includes('/api/admin/logs') && c.url.includes('cluster=match'))).toBe(true),
    );
  });

  it('surfaces a non-ok action response as a sticky error toast with the server text', async () => {
    const base = fetchStub.mock.getMockImplementation()!;
    fetchStub.mock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).includes('/api/admin/stop-node')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: 'node 0 is the leader' }),
          text: async () => '{"error":"node 0 is the leader"}',
        } as Response;
      }
      return base(input, init);
    });

    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();

    const match = within(await screen.findByRole('region', { name: 'Matching Engine' }));
    fireEvent.click(match.getAllByTitle('Stop')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Node' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('node 0 is the leader');
  });

  it('shows the gateway pill as Offline when REST fails, keeping data off-screen quietly', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    renderAdmin();
    await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Failed to fetch/i)).toBeNull();
  });

  it('renders a stopped node card with dashed stats instead of dropping the row', async () => {
    const offline = JSON.parse(JSON.stringify(STATUS));
    offline.clusters[0].nodes[2] = { id: 2, running: false, role: 'OFFLINE', status: 'OFFLINE', procName: 'node2' };
    const base = fetchStub.mock.getMockImplementation()!;
    fetchStub.mock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/admin/status')) {
        return { ok: true, status: 200, json: async () => offline, text: async () => '' } as Response;
      }
      return base(input, init);
    });

    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();
    await screen.findByText('OFFLINE');
    // The Mem/CPU/Up row is reserved: dashes render, the card keeps its shape
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(3);
  });

  it('derives backup recovery targets from the selected cluster nodes', async () => {
    renderAdmin();
    await screen.findByText('demo');

    fireEvent.click(screen.getByRole('button', { name: 'Backup' }));
    await screen.findByText('Recover from backup');

    const options = screen.getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['Node 0 — running', 'Node 1 — running', 'Node 2 — running']);
    expect(screen.getByText(/Node 0 is running — stop it first/i)).toBeTruthy();
  });

  it('clears a stale operation when an empty progress frame arrives (no stuck rail)', async () => {
    renderAdmin();
    await screen.findByText('demo');
    gotoClusters();
    await screen.findByRole('region', { name: 'Matching Engine' });
    const es = FakeEventSource.instances[0];
    act(() => es.open());

    // An unattributed op defaults to the match cluster: its ops slot swaps
    // buttons for the percent; the match rail's Rolling Update goes away.
    act(() => es.emit('progress', {
      operation: 'snapshot', currentStep: 1, totalSteps: 1,
      complete: false, error: false, progress: 71,
    }));
    let match = within(screen.getByRole('region', { name: 'Matching Engine' }));
    expect(await match.findByText('71%')).toBeTruthy();
    expect(match.queryByRole('button', { name: /Rolling Update/i })).toBeNull();

    // The server resets the record without a completion frame (seen live) —
    // the empty frame must clear the stale op and give the buttons back.
    act(() => es.emit('progress', { currentStep: 0, totalSteps: 0, complete: false, error: false }));
    match = within(screen.getByRole('region', { name: 'Matching Engine' }));
    expect(await match.findByRole('button', { name: /Rolling Update/i })).toBeTruthy();
    expect(match.queryByText('71%')).toBeNull();
  });
});
