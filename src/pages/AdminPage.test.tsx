// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * AdminPage smoke test: render the real admin console with the network
 * mocked (fetch returns canned admin-gateway shapes, SSE never connects),
 * assert the cluster tab renders nodes/services from /api/admin/status and
 * /api/admin/processes, tabs switch, and destructive actions confirm before
 * POSTing. Pins the AdminPage decomposition — sections are separate
 * components but must render the same console.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage';

// ---- jsdom gaps -----------------------------------------------------------

/** Minimal EventSource stub — the admin console must render without SSE. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
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

const CLUSTER_STATUS = {
  nodes: [
    { id: 0, running: true, pid: 101, role: 'LEADER', status: 'LEADER', commitPosition: 41_200_000, snapshotPosition: 40_000_000, logDelta: 1_200_000, snapshotCount: 3, archiveBytes: 1024 * 1024 * 512 },
    { id: 1, running: true, pid: 102, role: 'FOLLOWER', status: 'FOLLOWER', commitPosition: 41_200_000, snapshotPosition: 40_000_000, logDelta: 1_200_000, snapshotCount: 3, archiveBytes: 1024 * 1024 * 512 },
    { id: 2, running: true, pid: 103, role: 'FOLLOWER', status: 'FOLLOWER', commitPosition: 41_200_000, snapshotPosition: 40_000_000, logDelta: 1_200_000, snapshotCount: 3, archiveBytes: 1024 * 1024 * 512 },
  ],
  leader: 0,
  backup: { running: true, pid: 104 },
  gateway: { running: true, port: 8080 },
  gateways: {
    market: { running: true, port: 8081 },
    order: { running: true, port: 8080 },
    admin: { running: true, port: 8082 },
  },
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
  proc('backup', 'Backup Node', 'cluster'),
  proc('oms', 'Order Management', 'gateway', 8080),
  proc('market', 'Market Gateway', 'gateway', 8081),
  proc('admin', 'Admin Gateway', 'gateway', 8082),
];

const SUMMARY = { total: 7, running: 7, stopped: 0, failed: 0, totalMemoryMB: 1792, lastPollMs: 0 };

/** fetch mock returning valid admin-gateway shapes per route. */
function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown = {};
    if (url.includes('/api/admin/status')) {
      body = CLUSTER_STATUS;
    } else if (url.includes('/api/admin/progress')) {
      body = { operation: '', status: '', currentStep: 0, totalSteps: 0, progress: 0, complete: false, error: false };
    } else if (url.includes('/api/admin/processes/summary')) {
      body = SUMMARY;
    } else if (url.includes('/api/admin/processes')) {
      body = PROCESSES;
    } else if (url.includes('/api/admin/logs')) {
      body = { logs: ['[INFO] node ready'] };
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

// ---- tests ----------------------------------------------------------------

describe('AdminPage smoke', () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    stubMatchMedia();
    fetchStub = stubFetch();
    localStorage.clear();
  });

  it('renders the cluster tab: rail, node cards with roles, services', async () => {
    renderAdmin();

    // Cluster rail reflects the canned healthy cluster
    expect(await screen.findByText('Cluster Healthy')).toBeTruthy();
    expect(screen.getByText('Node 0 is leader')).toBeTruthy();

    // Rail stat tiles: nodes, leader, services, memory, commit
    expect(screen.getByText('3/3')).toBeTruthy();
    expect(screen.getByText('7/7')).toBeTruthy();
    expect(screen.getByText('1.8 GB')).toBeTruthy();
    // Rail commit tile + the three node cards' commit fields
    expect(screen.getAllByText('41.2M')).toHaveLength(4);

    // Node cards with role badges — followers read healthy, never warn.
    // "Node 0" appears twice: the rail's Leader tile + the card title.
    expect(screen.getAllByText('Node 0')).toHaveLength(2);
    expect(screen.getByText('Node 1')).toBeTruthy();
    expect(screen.getByText('Node 2')).toBeTruthy();
    expect(screen.getByText('LEADER')).toBeTruthy();
    const followers = screen.getAllByText('FOLLOWER');
    expect(followers).toHaveLength(2);
    for (const badge of followers) {
      expect(badge.className).toContain('text-buy');
      expect(badge.className).not.toContain('warn');
    }

    // Services (non-cluster processes only — node0-2/backup are cluster-role)
    expect(await screen.findByText('Order Management')).toBeTruthy();
    expect(screen.getByText('Market Gateway')).toBeTruthy();
    expect(screen.getByText('Admin Gateway')).toBeTruthy();
    expect(screen.queryByText('Cluster Node 0')).toBeNull();

    // Log viewer placeholder before any source is selected
    expect(screen.getByText(/Select a service or node/i)).toBeTruthy();
    expect(screen.getByText(/Click a log button/i)).toBeTruthy();
  });

  it('renders pending dashes in the rail before data arrives', () => {
    // fetch never resolves — the rail chrome must still mount with dashes
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    renderAdmin();
    expect(screen.getByText('Connecting to gateway…')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('Cluster Healthy')).toBeNull();
  });

  it('switches to the Risk and Backup tabs', async () => {
    renderAdmin();
    await screen.findByText('Cluster Healthy');

    fireEvent.click(screen.getByRole('button', { name: 'Risk' }));
    expect(await screen.findByText(/No markets have risk config set/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Backup' }));
    expect(await screen.findByText('Auto-snapshot')).toBeTruthy();
    expect(screen.getByText('Recover from backup')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(await screen.findByText('Cluster Healthy')).toBeTruthy();
  });

  it('confirms before stopping a node, then POSTs the action', async () => {
    renderAdmin();
    await screen.findByText('Cluster Healthy');

    // First Stop icon button belongs to Node 0
    fireEvent.click(screen.getAllByTitle('Stop')[0]);
    expect(await screen.findByText('Stop Node 0?')).toBeTruthy();

    // Cancel closes without a POST
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Stop Node 0?')).toBeNull();
    expect(fetchStub.calls.some(c => c.url.includes('/api/admin/stop-node'))).toBe(false);

    // Confirm issues the POST
    fireEvent.click(screen.getAllByTitle('Stop')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Node' }));
    await waitFor(() => {
      const post = fetchStub.calls.find(c => c.url.includes('/api/admin/stop-node') && c.init?.method === 'POST');
      expect(post, 'expected a POST /api/admin/stop-node').toBeTruthy();
      expect(JSON.parse(String(post!.init!.body))).toEqual({ nodeId: 0 });
    });
  });

  it('selects a log source and renders the tail', async () => {
    renderAdmin();
    await screen.findByText('Cluster Healthy');

    fireEvent.click(screen.getAllByTitle('View Logs')[0]);
    expect(await screen.findByText('[INFO] node ready')).toBeTruthy();
    // Heading is micro-caps "Logs"; the selected source renders as a chip
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeTruthy();
    expect(screen.getAllByText('Node 0').length).toBeGreaterThanOrEqual(2);
  });
});
