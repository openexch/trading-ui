// SPDX-License-Identifier: Apache-2.0
import type { ExtendedConnectionStatus, ClusterState } from '../../types/market';

interface ConnectionStatusProps {
  status: ExtendedConnectionStatus;
  clusterState?: ClusterState;
  onReconnect: () => void;
}

export function ConnectionStatus({ status, clusterState, onReconnect }: ConnectionStatusProps) {
  const statusText: Record<ExtendedConnectionStatus, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: 'Connection Error',
    'cluster-updating': 'Updating...',
    'cluster-electing': 'Election...',
    'cluster-reconnecting': 'Reconnecting...',
  };

  // Determine semantic styling based on status
  const isTransition =
    status === 'cluster-updating' || status === 'cluster-electing' || status === 'cluster-reconnecting';
  const isConnected = status === 'connected';
  const isError = status === 'disconnected' || status === 'error';
  const isConnecting = status === 'connecting';

  // Status dot color per state
  const dotClass = isConnected
    ? 'bg-buy'
    : isError
      ? 'bg-sell'
      : 'bg-warn'; // connecting + transitional states
  const dotPulse = isConnecting || isTransition;

  // Pill border tint per state
  const pillBorder = isConnected
    ? 'border-buy/20'
    : isError
      ? 'border-sell/20'
      : isTransition
        ? 'border-warn/20'
        : 'border-hairline';

  // Show reconnect button for disconnected/error states
  const showReconnect = status === 'disconnected' || status === 'error';

  // Show leader info when connected and cluster state is available
  const showLeader = status === 'connected' && clusterState && clusterState.leaderId >= 0;

  return (
    <div
      className={`inline-flex h-8 items-center gap-2 rounded-full border bg-transparent px-3 font-sans text-[11px] font-medium transition-colors ${pillBorder}`}
    >
      <span
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${dotClass} ${dotPulse ? 'animate-pulse-soft' : ''}`}
      />
      <span className={`text-[11px] ${isTransition ? 'text-warn' : 'text-muted'}`}>
        {statusText[status]}
      </span>
      {showLeader && (
        <span
          title="Current cluster leader"
          className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-medium tabular-nums text-muted"
        >
          L{clusterState.leaderId}
        </span>
      )}
      {showReconnect && (
        <button
          onClick={onReconnect}
          className="ml-1 rounded-full border border-hairline px-2.5 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
