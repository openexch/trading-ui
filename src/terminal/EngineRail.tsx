// SPDX-License-Identifier: Apache-2.0
/**
 * The engine telemetry rail: the matching engine cluster as data, one quiet
 * line in the header's centre cell, next to the connection pill.
 *
 * - Source: CLUSTER_STATUS and CLUSTER_EVENT on the market socket. The
 *   market gateway's Aeron client of the MATCHING ENGINE cluster sends them
 *   (match-gateway ClusterStatus.java), so the rail says "Matching engine";
 *   it never describes the assets/ledger cluster.
 * - Shows only what those messages carry (DESIGN.md rule 14): leader node,
 *   leadership term, each node's reported status, and an election or
 *   rolling update while one is active. The last cluster event (its own
 *   message and how long ago) is the rail's tooltip: it is rare, and a
 *   visible slot for it did not fit at 2560. No latency: none is supplied.
 * - Before the first CLUSTER_STATUS (the hook's placeholder nodes are not
 *   data) the rail keeps its width but is invisible. While the market feed
 *   or the gateway's cluster link is down, the last values are stale: the
 *   rail prints dashes and marks every node unknown.
 * - Degrades by the room the header leaves it (a container query on its
 *   slot, `@container` in Header.tsx), measured with the BTC ticker:
 *   - full from a 510 px slot (502 px): label, state, leader, term, nodes;
 *   - labelled from 380 px (372 px): label, leader, term and node
 *     marks; the state is left to the connection pill, which says it too;
 *   - compact from 248 px (243 px): leader, term and node marks;
 *   - hidden below.
 *   The forms have fixed widths (fixed number slots), so the thresholds
 *   are constants. Every
 *   value sits in a fixed-width slot, so nothing shifts when values change,
 *   and nothing is ever cut mid-value.
 * - Not a live region (rule 12): a named group with a static description;
 *   updates are never announced.
 * - Node state never relies on colour alone: a filled dot is up, a hollow
 *   ring with a bar is down, a half-filled dot is in transition, a dashed
 *   ring is unknown, and each node's words are in its title and in
 *   screen-reader text.
 */
import { useEffect, useState } from 'react';
import type { ClusterNode, ClusterState, ExtendedConnectionStatus, NodeStatus } from '../types/market';

/** Placeholder for a value that is not known (en dash, not a zero). */
const NONE = '–';

export type NodeHealth = 'up' | 'transition' | 'down' | 'unknown';

export interface RailNode {
  id: number;
  health: NodeHealth;
  /** The node's words: "node 1 follower" / "node 2 offline". */
  words: string;
}

export interface RailModel {
  /** False before the first CLUSTER_STATUS: render invisibly. */
  ready: boolean;
  leader: string;
  term: string;
  nodes: RailNode[];
  /** "Electing", "Updating" (a rolling update) or "No link" (the gateway
   *  lost the cluster); null when none. The pill's words. */
  state: string | null;
  /** "4m ago", or null with no cluster event this session. */
  sinceEvent: string | null;
  /** The last event's own message, for the title. */
  eventMessage: string | null;
}

const TRANSITION: ReadonlySet<NodeStatus> = new Set(['CANDIDATE', 'STOPPING', 'STARTING', 'REJOINING', 'ELECTION']);

function nodeHealth(n: ClusterNode): NodeHealth {
  if (TRANSITION.has(n.status)) return 'transition';
  if (n.healthy && (n.status === 'LEADER' || n.status === 'FOLLOWER')) return 'up';
  return 'down';
}

/** "<1m", "12m", "3h", "2d": coarse on purpose, so a few seconds of clock
 *  skew between the gateway and the browser never show. */
export function formatSince(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return '<1m ago';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const feedUp = (s: ExtendedConnectionStatus) =>
  s === 'connected' || s === 'cluster-electing' || s === 'cluster-updating';

export function railModel(cluster: ClusterState | undefined, status: ExtendedConnectionStatus, now: number): RailModel {
  const ready = !!cluster && cluster.lastUpdate > 0;
  if (!cluster || !ready) {
    return { ready: false, leader: NONE, term: NONE, nodes: [], state: null, sinceEvent: null, eventMessage: null };
  }
  const live = feedUp(status) && cluster.gatewayConnected;
  const nodes: RailNode[] = cluster.nodes.map(n =>
    live
      ? { id: n.id, health: nodeHealth(n), words: `node ${n.id} ${n.status.toLowerCase()}` }
      : { id: n.id, health: 'unknown', words: `node ${n.id} unknown` },
  );
  let state: string | null = null;
  if (feedUp(status) && !cluster.gatewayConnected) state = 'No link';
  else if (live && cluster.isElecting) state = 'Electing';
  else if (live && cluster.isRollingUpdate) state = 'Updating';
  const ev = cluster.lastEvent;
  return {
    ready: true,
    leader: live && cluster.leaderId >= 0 ? String(cluster.leaderId) : NONE,
    term: live && cluster.leadershipTermId >= 0 ? String(cluster.leadershipTermId) : NONE,
    nodes,
    state,
    sinceEvent: ev && ev.timestamp > 0 ? formatSince(now - ev.timestamp) : null,
    eventMessage: ev ? ev.message : null,
  };
}

/** Re-render every 15 s while there is an event to age. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.06em] text-muted';
const VALUE = 'text-[12px] font-medium tabular-nums text-text-strong';

function Divider() {
  return <span aria-hidden className="h-3 w-px flex-none bg-hairline-strong" />;
}

const NODE_COLOUR: Record<NodeHealth, string> = {
  up: 'text-buy',
  transition: 'text-muted',
  down: 'text-sell',
  unknown: 'text-muted',
};

/** The node's shape: the state reads without colour. */
function NodeShape({ health }: { health: NodeHealth }) {
  return (
    <svg aria-hidden width="9" height="9" viewBox="0 0 10 10" className="flex-none">
      {health === 'up' && <circle cx="5" cy="5" r="4.25" fill="currentColor" />}
      {health === 'transition' && (
        <>
          <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1.25a3.75 3.75 0 0 1 0 7.5z" fill="currentColor" />
        </>
      )}
      {health === 'down' && (
        <>
          <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.4 7.6 7.6 2.4" stroke="currentColor" strokeWidth="1.5" />
        </>
      )}
      {health === 'unknown' && (
        <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.6" />
      )}
    </svg>
  );
}

export interface EngineRailProps {
  clusterState?: ClusterState;
  status: ExtendedConnectionStatus;
}

export function EngineRail({ clusterState, status }: EngineRailProps) {
  const hasEvent = !!clusterState?.lastEvent;
  const now = useNow(hasEvent);
  const m = railModel(clusterState, status, now);
  // The last cluster event costs no width: it is the rail's tooltip.
  const title =
    m.ready && m.eventMessage !== null
      ? `Last cluster event: ${m.eventMessage}${m.sinceEvent !== null ? `, ${m.sinceEvent}` : ''}`
      : undefined;

  return (
    <div
      role="group"
      aria-label="Matching engine cluster"
      aria-description="Leader node, leadership term and node status as the market gateway reports them"
      title={title}
      data-engine-rail
      data-ready={m.ready ? 'true' : 'false'}
      className={`hidden items-center gap-2 whitespace-nowrap @min-[248px]:flex ${m.ready ? '' : 'invisible'}`}
    >
      <span data-rail-label className="hidden items-center gap-2 @min-[380px]:flex">
        <span className={LABEL}>Matching engine</span>
        {/* Fixed-width state slot: an election never shifts the line. */}
        <span
          data-rail-state
          className="hidden w-[72px] text-[11px] font-medium uppercase tracking-[0.06em] text-text-strong @min-[510px]:inline-block"
        >
          {m.state ?? ''}
        </span>
        <Divider />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={LABEL}>Leader</span>
        <span data-rail-leader className={`${VALUE} inline-block w-[2ch]`}>
          {m.leader}
        </span>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={LABEL}>Term</span>
        <span data-rail-term className={`${VALUE} inline-block min-w-[4ch]`}>
          {m.term}
        </span>
      </span>
      <Divider />
      <span className="flex items-center gap-2">
        <span className={`${LABEL} hidden @min-[510px]:inline`}>Nodes</span>
        <span role="list" aria-label="Nodes" className="flex items-center gap-2">
          {m.nodes.map(n => (
            <span
              key={n.id}
              role="listitem"
              data-rail-node={n.id}
              data-health={n.health}
              title={n.words.charAt(0).toUpperCase() + n.words.slice(1)}
              className={`flex items-center gap-1 ${NODE_COLOUR[n.health]}`}
            >
              <NodeShape health={n.health} />
              <span aria-hidden className={VALUE}>
                {n.id}
              </span>
              <span className="sr-only">{n.words}</span>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
