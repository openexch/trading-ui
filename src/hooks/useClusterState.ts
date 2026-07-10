// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useEffect } from 'react';
import type { ClusterState, ClusterStatusMessage, ClusterEventMessage, ClusterNode } from '../types/market';

const INITIAL_NODES: ClusterNode[] = [
  { id: 0, status: 'OFFLINE', healthy: false },
  { id: 1, status: 'OFFLINE', healthy: false },
  { id: 2, status: 'OFFLINE', healthy: false },
];

// Persisted cluster-activity log: survives reloads so the history is permanent.
const EVENTS_STORAGE_KEY = 'oe.clusterActivity.v1';
const MAX_EVENTS = 200;

function loadPersistedEvents(): ClusterEventMessage[] {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function persistEvents(events: ClusterEventMessage[]): void {
  try {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // storage full / unavailable — the log is best-effort, never block the UI
  }
}

export function useClusterState() {
  const [clusterState, setClusterState] = useState<ClusterState>(() => ({
    leaderId: -1,
    leadershipTermId: -1,
    nodes: INITIAL_NODES,
    gatewayConnected: false,
    isRollingUpdate: false,
    isElecting: false,
    lastEvent: null,
    events: loadPersistedEvents(),
    lastUpdate: 0,
  }));

  // Persist only when the events array identity changes (a new event appended).
  // handleClusterStatus preserves the same events reference, so the frequent
  // ~2s status stream never triggers a write.
  useEffect(() => {
    persistEvents(clusterState.events);
  }, [clusterState.events]);

  const handleClusterStatus = useCallback((message: ClusterStatusMessage) => {
    setClusterState(prev => {
      // Detect election state: no leader or nodes in ELECTION status
      const isElecting = message.leaderId < 0 ||
        message.nodes.some(n => n.status === 'ELECTION');

      return {
        ...prev,
        leaderId: message.leaderId,
        leadershipTermId: message.leadershipTermId,
        nodes: message.nodes,
        gatewayConnected: message.gatewayConnected,
        lastUpdate: message.timestamp,
        isElecting,
      };
    });
  }, []);

  const handleClusterEvent = useCallback((message: ClusterEventMessage) => {
    setClusterState(prev => {
      let isRollingUpdate = prev.isRollingUpdate;
      let isElecting = prev.isElecting;

      // Track rolling update start/complete
      if (message.event === 'ROLLING_UPDATE_START') {
        isRollingUpdate = true;
      } else if (message.event === 'ROLLING_UPDATE_COMPLETE') {
        isRollingUpdate = false;
      }

      // Track election state
      if (message.event === 'LEADER_CHANGE') {
        isElecting = false; // Election completed
      }

      // Append to the rolling log, de-duping an exact repeat of the last entry
      // (the gateway can re-broadcast on reconnect).
      const last = prev.events[prev.events.length - 1];
      const isDup = !!last && last.event === message.event &&
        last.timestamp === message.timestamp && last.message === message.message;
      const events = isDup
        ? prev.events
        : [...prev.events, message].slice(-MAX_EVENTS);

      return {
        ...prev,
        lastEvent: message,
        events,
        isRollingUpdate,
        isElecting,
      };
    });
  }, []);

  const clearClusterEvents = useCallback(() => {
    setClusterState(prev => ({ ...prev, events: [] }));
  }, []);

  const resetClusterState = useCallback(() => {
    // Market-plane reset keeps the activity log (it is cross-session history).
    setClusterState(prev => ({
      leaderId: -1,
      leadershipTermId: -1,
      nodes: INITIAL_NODES,
      gatewayConnected: false,
      isRollingUpdate: false,
      isElecting: false,
      lastEvent: prev.lastEvent,
      events: prev.events,
      lastUpdate: 0,
    }));
  }, []);

  return {
    clusterState,
    handleClusterStatus,
    handleClusterEvent,
    clearClusterEvents,
    resetClusterState,
  };
}
