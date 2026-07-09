// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * ClusterSection: composes the rail + (assets) money panel + node grid for
 * one cluster. Pins the generic render — a match block yields three node
 * cards and every op; an assets block hides the ops it lacks but keeps its
 * reserved-width slot; the node-grid skeleton follows nodeCount; and the
 * ledger-integrity slot degrades gracefully and escalates on a broken
 * conservation check.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ClusterSection } from './ClusterSection';
import type { ClusterBlock } from './types';

afterEach(cleanup);

const CAPS_ALL = { rollingUpdate: true, snapshot: true, cleanup: true, housekeeping: true, backup: true, separateDriver: true };

const matchBlock = (over: Partial<ClusterBlock> = {}): ClusterBlock => ({
  name: 'match', display: 'Matching Engine', kind: 'match',
  nodeCount: 3, leader: 0, allNodesHealthy: true,
  capabilities: { ...CAPS_ALL },
  nodes: [
    { id: 0, running: true, pid: 100, role: 'LEADER', status: 'LEADER', procName: 'node0', commitPosition: 10, snapshotPosition: 5, logDelta: 5, snapshotCount: 1, archiveBytes: 1024 },
    { id: 1, running: true, pid: 101, role: 'FOLLOWER', status: 'FOLLOWER', procName: 'node1', commitPosition: 10, snapshotPosition: 5, logDelta: 5, snapshotCount: 1, archiveBytes: 1024 },
    { id: 2, running: true, pid: 102, role: 'FOLLOWER', status: 'FOLLOWER', procName: 'node2', commitPosition: 10, snapshotPosition: 5, logDelta: 5, snapshotCount: 1, archiveBytes: 1024 },
  ],
  ...over,
});

const assetsBlock = (over: Partial<ClusterBlock> = {}): ClusterBlock => ({
  name: 'assets', display: 'Assets Engine', kind: 'assets',
  nodeCount: 1, leader: 0, allNodesHealthy: true,
  capabilities: { rollingUpdate: true, snapshot: false, cleanup: true, housekeeping: false, backup: false, separateDriver: true },
  nodes: [{ id: 0, running: true, pid: 300, role: 'LEADER', status: 'LEADER', procName: 'ae0', commitPosition: 5 }],
  ...over,
});

const noop = () => {};
const handlers = {
  onNodeAction: noop, onAllNodes: noop, onCleanup: noop, onTopologyChange: noop,
  onRollingUpdate: noop, onHousekeeping: noop, onSnapshot: noop, onViewLogs: noop,
};

const renderSection = (cluster: ClusterBlock) =>
  render(
    <ClusterSection
      cluster={cluster}
      processes={[]}
      operation={null}
      stackBusy={false}
      snapshotBusy={false}
      logSource={null}
      {...handlers}
    />,
  );

describe('ClusterSection', () => {
  it('renders a match block: three node cards + the full ops rail', () => {
    renderSection(matchBlock());
    const region = within(screen.getByRole('region', { name: 'Matching Engine' }));
    // "Node 0" appears twice: the rail Leader tile + the node card title.
    expect(region.getAllByText('Node 0').length).toBeGreaterThanOrEqual(2);
    expect(region.getByText('Node 1')).toBeTruthy();
    expect(region.getByText('Node 2')).toBeTruthy();
    expect(region.getByRole('button', { name: /Rolling Update/i })).toBeTruthy();
    expect(region.getByRole('button', { name: /Housekeeping/i })).toBeTruthy();
    expect(region.getByRole('button', { name: /Snapshot/i })).toBeTruthy();
    // No money panel on a match cluster
    expect(region.queryByText(/Ledger integrity/i)).toBeNull();
  });

  it('hides ungranted ops on an assets block but keeps a non-empty ops slot', () => {
    renderSection(assetsBlock());
    const region = within(screen.getByRole('region', { name: 'Assets Engine' }));
    expect(region.getByRole('button', { name: /Rolling Update/i })).toBeTruthy();
    expect(region.queryByRole('button', { name: /Housekeeping/i })).toBeNull();
    expect(region.queryByRole('button', { name: /Snapshot/i })).toBeNull();
    // The ledger-integrity slot renders (assets kind) but degrades gracefully
    expect(region.getByText(/not reported by this build/i)).toBeTruthy();
  });

  it('renders nodeCount skeleton cards when a block has no nodes yet', () => {
    const { container } = renderSection(assetsBlock({ nodes: [], nodeCount: 2 }));
    expect(container.querySelectorAll('[data-skeleton]').length).toBe(2);
  });

  it('shows the quiet ledger notice when money is not reported', () => {
    renderSection(assetsBlock());
    expect(screen.getByText('Ledger integrity — not reported by this build.')).toBeTruthy();
  });

  it('escalates the rail hero and sell-tones the panel on a broken conservation check', () => {
    renderSection(assetsBlock({ money: { conservationOk: false, lastAppliedTradeId: 42 } }));
    const region = within(screen.getByRole('region', { name: 'Assets Engine' }));
    // Rail hero escalates even though Raft is healthy
    expect(region.getByText('Ledger Imbalance')).toBeTruthy();
    // Panel reads BROKEN in the sell tone
    const broken = region.getByText('BROKEN');
    expect(broken.className).toContain('text-sell');
  });
});
