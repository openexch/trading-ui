// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClusterState } from './useClusterState';
import type { ClusterEventMessage } from '../types/market';

const KEY = 'oe.clusterActivity.v1';

const evt = (event: ClusterEventMessage['event'], timestamp: number, message: string = event): ClusterEventMessage => ({
  type: 'CLUSTER_EVENT', event, message, timestamp,
});

describe('useClusterState — persistent activity log', () => {
  beforeEach(() => localStorage.clear());

  it('accumulates events into a rolling log (not just the last)', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterEvent(evt('LEADER_CHANGE', 1)));
    act(() => result.current.handleClusterEvent(evt('NODE_DOWN', 2)));
    act(() => result.current.handleClusterEvent(evt('NODE_UP', 3)));
    expect(result.current.clusterState.events.map(e => e.event))
      .toEqual(['LEADER_CHANGE', 'NODE_DOWN', 'NODE_UP']);
    expect(result.current.clusterState.lastEvent?.event).toBe('NODE_UP');
  });

  it('persists to localStorage and hydrates a fresh hook from it (survives reload)', () => {
    const { result, unmount } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterEvent(evt('ROLLING_UPDATE_START', 10)));
    act(() => result.current.handleClusterEvent(evt('ROLLING_UPDATE_COMPLETE', 20)));
    unmount();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(2);

    // A brand-new hook instance (simulating a page reload) hydrates the log.
    const { result: reloaded } = renderHook(() => useClusterState());
    expect(reloaded.current.clusterState.events.map(e => e.event))
      .toEqual(['ROLLING_UPDATE_START', 'ROLLING_UPDATE_COMPLETE']);
  });

  it('de-dupes an exact repeat of the last event (reconnect re-broadcast)', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterEvent(evt('LEADER_CHANGE', 5, 'same')));
    act(() => result.current.handleClusterEvent(evt('LEADER_CHANGE', 5, 'same')));
    expect(result.current.clusterState.events).toHaveLength(1);
    // A different timestamp is a genuine new event.
    act(() => result.current.handleClusterEvent(evt('LEADER_CHANGE', 6, 'same')));
    expect(result.current.clusterState.events).toHaveLength(2);
  });

  it('clear empties the log', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterEvent(evt('NODE_DOWN', 1)));
    act(() => result.current.clearClusterEvents());
    expect(result.current.clusterState.events).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(0);
  });

  it('the frequent status stream never mutates the log (same array reference)', () => {
    const { result } = renderHook(() => useClusterState());
    act(() => result.current.handleClusterEvent(evt('NODE_UP', 1)));
    const before = result.current.clusterState.events;
    act(() => result.current.handleClusterStatus({
      type: 'CLUSTER_STATUS', leaderId: 2, leadershipTermId: 1,
      nodes: [{ id: 0, status: 'FOLLOWER', healthy: true }],
      gatewayConnected: true, timestamp: 999,
    } as never));
    // status updates leader/nodes but leaves the events array identity intact,
    // so the persist effect does not fire on every 2s tick.
    expect(result.current.clusterState.events).toBe(before);
    expect(result.current.clusterState.leaderId).toBe(2);
  });
});
