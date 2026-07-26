// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * useClusterState is what a TRADER needs from the cluster: who leads, and
 * whether the exchange is mid-election or mid-update, so the connection pill
 * can say "failing over" instead of "disconnected".
 *
 * The operator-facing activity log that used to live here moved to the admin
 * console: the market socket only ever carried the matching engine, so this
 * copy could never show the money ledger, and a browser's localStorage was the
 * wrong home for an operations record.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClusterState } from './useClusterState';
import type { ClusterEventMessage, ClusterStatusMessage } from '../types/market';

const evt = (event: ClusterEventMessage['event'], timestamp: number): ClusterEventMessage => ({
  type: 'CLUSTER_EVENT', event, message: event, timestamp,
});

const status = (leaderId: number, nodeStatus = 'FOLLOWER'): ClusterStatusMessage => ({
  type: 'CLUSTER_STATUS', leaderId, leadershipTermId: 1,
  nodes: [{ id: 0, status: nodeStatus, healthy: true }],
  gatewayConnected: true, timestamp: 999,
} as ClusterStatusMessage);

describe('useClusterState', () => {
  it('starts with no leader and nothing in flight', () => {
    const { result } = renderHook(() => useClusterState());
    expect(result.current.clusterState.leaderId).toBe(-1);
    expect(result.current.clusterState.isElecting).toBe(false);
    expect(result.current.clusterState.isRollingUpdate).toBe(false);
  });

  it('tracks the leader from the status stream', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterStatus(status(2)));
    expect(result.current.clusterState.leaderId).toBe(2);
    expect(result.current.clusterState.isElecting).toBe(false);
  });

  // A leaderless cluster is failing over, not down. The pill has to say so, or
  // a routine election reads to a trader as an outage.
  it('reports an election while there is no leader, and again on ELECTION status', () => {
    const { result } = renderHook(() => useClusterState());

    act(() => result.current.handleClusterStatus(status(-1)));
    expect(result.current.clusterState.isElecting).toBe(true);

    act(() => result.current.handleClusterStatus(status(0, 'ELECTION')));
    expect(result.current.clusterState.isElecting).toBe(true);

    act(() => result.current.handleClusterStatus(status(0)));
    expect(result.current.clusterState.isElecting).toBe(false);
  });

  it('clears the election flag when the new leader is announced', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterStatus(status(-1)));
    act(() => result.current.handleClusterEvent(evt('LEADER_CHANGE', 5)));
    expect(result.current.clusterState.isElecting).toBe(false);
    expect(result.current.clusterState.lastEvent?.event).toBe('LEADER_CHANGE');
  });

  it('brackets a rolling update between its start and complete events', () => {
    const { result } = renderHook(() => useClusterState());

    act(() => result.current.handleClusterEvent(evt('ROLLING_UPDATE_START', 10)));
    expect(result.current.clusterState.isRollingUpdate).toBe(true);

    act(() => result.current.handleClusterEvent(evt('ROLLING_UPDATE_COMPLETE', 20)));
    expect(result.current.clusterState.isRollingUpdate).toBe(false);
  });

  // A market-plane reset (socket drop) must not claim a leader it can no longer
  // see, but the last event stays as context for the reconnect.
  it('reset drops the leader and keeps the last event', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterStatus(status(2)));
    act(() => result.current.handleClusterEvent(evt('NODE_DOWN', 7)));

    act(() => result.current.resetClusterState());

    expect(result.current.clusterState.leaderId).toBe(-1);
    expect(result.current.clusterState.gatewayConnected).toBe(false);
    expect(result.current.clusterState.lastEvent?.event).toBe('NODE_DOWN');
  });
});
