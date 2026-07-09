// SPDX-License-Identifier: Apache-2.0
/**
 * getClusterStatus: the per-cluster status hero, including the money-aware
 * escalation — an assets ledger that fails conservation reads unstable even
 * when its Raft is perfectly healthy.
 */
import { describe, it, expect } from 'vitest';
import { getClusterStatus } from './status';
import type { ClusterBlock } from './types';

const CAPS = { rollingUpdate: true, snapshot: true, cleanup: true, housekeeping: true, backup: true, separateDriver: true };

const block = (over: Partial<ClusterBlock>): ClusterBlock => ({
  name: 'c', display: 'C', kind: 'match',
  nodeCount: 1, leader: 0, allNodesHealthy: true, capabilities: { ...CAPS },
  nodes: [{ id: 0, running: true, role: 'LEADER' }],
  ...over,
});

describe('getClusterStatus', () => {
  it('reports a match cluster healthy when it has a leader', () => {
    const r = getClusterStatus(null, block({}));
    expect(r.status).toBe('healthy');
    expect(r.title).toBe('Cluster Healthy');
    expect(r.detail).toBe('Node 0 is leader');
  });

  it('reports unstable when no leader and no election', () => {
    const r = getClusterStatus(null, block({ nodes: [{ id: 0, running: true, role: 'FOLLOWER' }] }));
    expect(r.status).toBe('unstable');
    expect(r.title).toBe('Cluster Unstable');
  });

  it('reports an election in progress', () => {
    const r = getClusterStatus(null, block({ nodes: [{ id: 0, running: true, role: 'ELECTION' }] }));
    expect(r.status).toBe('electing');
    expect(r.title).toBe('Leader Election');
  });

  it('flags an assets ledger imbalance even when Raft is healthy', () => {
    const r = getClusterStatus(null, block({
      kind: 'assets',
      money: { conservationOk: false, lastAppliedTradeId: 7 },
    }));
    expect(r.status).toBe('unstable');
    expect(r.title).toBe('Ledger Imbalance');
  });

  it('stays healthy when conservation holds', () => {
    const r = getClusterStatus(null, block({
      kind: 'assets',
      money: { conservationOk: true, lastAppliedTradeId: 7 },
    }));
    expect(r.status).toBe('healthy');
  });

  it('surfaces an attributed rolling update on the hero', () => {
    const op = { operation: 'rolling-update', currentStep: 1, totalSteps: 3, complete: false, error: false };
    const r = getClusterStatus(op, block({}));
    expect(r.status).toBe('updating');
    expect(r.title).toBe('Rolling Update');
  });
});
