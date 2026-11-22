// SPDX-License-Identifier: Apache-2.0
/**
 * The engine telemetry of the user stream (/ws/v2): the `engine` frame (both
 * clusters and the bridge, on connect and on change) and the `election`
 * frames (a leader election's start and end), parsed into UI types.
 *
 * Display telemetry, not user data. Every field the stream has no source
 * for is null on the wire, and anything missing or of the wrong type parses
 * to null here too: the UI prints a dash for null (DESIGN.md rule 14), so a
 * field the backend drops or renames degrades to a dash, never to a guess.
 *
 * Units, as the gateway's API document defines them:
 * - commitPosition, appliedPosition, snapshot.position: cluster log
 *   positions, in bytes.
 * - behindBytes: the leader's commit position minus the node's applied
 *   position, in bytes; sampled from two processes, so it can read
 *   negative. There is no count of entries per node (entriesBehind is null).
 * - bridge: matching-engine journal sequence numbers, not log positions.
 */

export type ClusterKey = 'core' | 'matchingEngine';
export const CLUSTER_KEYS: readonly ClusterKey[] = ['core', 'matchingEngine'];

export type NodeRole = 'leader' | 'follower' | 'candidate' | 'unreachable';

export interface NodeSnapshot {
  position: number | null;
  atMs: number | null;
  /** Decimal digits as the engine reported them; null when it cannot name one. */
  stateHash: string | null;
  /** 'matched' or 'diverged' against the cluster's majority; null with
   *  fewer than two hashes at the latest position. */
  agreement: string | null;
}

export interface EngineNode {
  id: number;
  role: NodeRole | null;
  live: boolean | null;
  recovery: string | null;
  term: number | null;
  commitPosition: number | null;
  appliedPosition: number | null;
  behindBytes: number | null;
  snapshot: NodeSnapshot;
  version: string | null;
  buildCommit: string | null;
  /** A short code (timeout, refused, unreachable, bad_answer, wrong_member). */
  error: string | null;
}

export interface LastElection {
  atMs: number | null;
  previousLeaderId: number | null;
  leaderId: number | null;
  previousTerm: number | null;
  term: number | null;
  durationMs: number | null;
  observedGapMs: number | null;
}

export interface ClusterSnapshot {
  position: number | null;
  atMs: number | null;
  agreement: string | null;
  divergedNodes: number[];
}

export interface EngineCluster {
  configured: boolean | null;
  term: number | null;
  leaderId: number | null;
  nodes: EngineNode[];
  lastElection: LastElection | null;
  snapshot: ClusterSnapshot;
}

export interface EngineBridge {
  consumedJournalSeq: number | null;
  meJournalSeq: number | null;
  entriesBehind: number | null;
}

export interface EngineStatus {
  core: EngineCluster;
  matchingEngine: EngineCluster;
  bridge: EngineBridge;
}

export interface ElectionEvent {
  cluster: ClusterKey;
  phase: 'start' | 'end';
  atMs: number;
  previousTerm: number | null;
  previousLeaderId: number | null;
  /** End only. */
  term: number | null;
  leaderId: number | null;
  observedGapMs: number | null;
  durationMs: number | null;
  /** Start only. */
  lastCommitPosition: number | null;
  candidates: number[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

/** An integer (positions, terms, ids, times), else null. */
export function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function ids(v: unknown): number[] {
  return Array.isArray(v) ? v.map(int).filter((x): x is number => x !== null) : [];
}

const ROLES: ReadonlySet<string> = new Set(['leader', 'follower', 'candidate', 'unreachable']);

function role(v: unknown): NodeRole | null {
  const t = text(v)?.toLowerCase();
  return t && ROLES.has(t) ? (t as NodeRole) : null;
}

function node(raw: unknown): EngineNode | null {
  const o = obj(raw);
  const id = o ? int(o.id) : null;
  if (!o || id === null) return null;
  const s = obj(o.snapshot) ?? {};
  return {
    id,
    role: role(o.role),
    live: bool(o.live),
    recovery: text(o.recovery),
    term: int(o.term),
    commitPosition: int(o.commitPosition),
    appliedPosition: int(o.appliedPosition),
    behindBytes: int(o.behindBytes),
    snapshot: {
      position: int(s.position),
      atMs: int(s.atMs),
      stateHash: text(s.stateHash),
      agreement: text(s.agreement),
    },
    version: text(o.version),
    buildCommit: text(o.buildCommit),
    error: text(o.error),
  };
}

function lastElection(raw: unknown): LastElection | null {
  const o = obj(raw);
  if (!o) return null;
  return {
    atMs: int(o.atMs),
    previousLeaderId: int(o.previousLeaderId),
    leaderId: int(o.leaderId),
    previousTerm: int(o.previousTerm),
    term: int(o.term),
    durationMs: int(o.durationMs),
    observedGapMs: int(o.observedGapMs),
  };
}

/** A cluster with nothing known: every value a dash. */
export function emptyCluster(): EngineCluster {
  return {
    configured: null,
    term: null,
    leaderId: null,
    nodes: [],
    lastElection: null,
    snapshot: { position: null, atMs: null, agreement: null, divergedNodes: [] },
  };
}

function cluster(raw: unknown): EngineCluster {
  const o = obj(raw);
  if (!o) return emptyCluster();
  const s = obj(o.snapshot) ?? {};
  const nodes = Array.isArray(o.nodes) ? o.nodes.map(node).filter((n): n is EngineNode => n !== null) : [];
  return {
    configured: bool(o.configured),
    term: int(o.term),
    leaderId: int(o.leaderId),
    nodes,
    lastElection: lastElection(o.lastElection),
    snapshot: {
      position: int(s.position),
      atMs: int(s.atMs),
      agreement: text(s.agreement),
      divergedNodes: ids(s.divergedNodes),
    },
  };
}

/** Parse an `engine` frame; null when it is not one. */
export function parseEngineFrame(raw: unknown): EngineStatus | null {
  const o = obj(raw);
  if (!o || o.type !== 'engine') return null;
  const b = obj(o.bridge) ?? {};
  return {
    core: cluster(o.core),
    matchingEngine: cluster(o.matchingEngine),
    bridge: {
      consumedJournalSeq: int(b.consumedJournalSeq),
      meJournalSeq: int(b.meJournalSeq),
      entriesBehind: int(b.entriesBehind),
    },
  };
}

/** Parse an `election` frame; null when it is not one (or names no cluster,
 *  phase or time: a row without them could not be placed on the tape). */
export function parseElectionFrame(raw: unknown): ElectionEvent | null {
  const o = obj(raw);
  if (!o || o.type !== 'election') return null;
  const c = o.cluster;
  const phase = o.phase;
  const atMs = int(o.atMs);
  if ((c !== 'core' && c !== 'matchingEngine') || (phase !== 'start' && phase !== 'end') || atMs === null) return null;
  return {
    cluster: c,
    phase,
    atMs,
    previousTerm: int(o.previousTerm),
    previousLeaderId: int(o.previousLeaderId),
    term: int(o.term),
    leaderId: int(o.leaderId),
    observedGapMs: int(o.observedGapMs),
    durationMs: int(o.durationMs),
    lastCommitPosition: int(o.lastCommitPosition),
    candidates: ids(o.candidates),
  };
}

/** The cluster's leader row, when the cluster names one and lists it. */
export function leaderOf(c: EngineCluster): EngineNode | null {
  if (c.leaderId === null) return null;
  return c.nodes.find(n => n.id === c.leaderId) ?? null;
}

/** Display names. The core is the OMS and ledger cluster. */
export const CLUSTER_NAME: Readonly<Record<ClusterKey, string>> = {
  core: 'Core',
  matchingEngine: 'Matching engine',
};
export const CLUSTER_SHORT: Readonly<Record<ClusterKey, string>> = {
  core: 'Core',
  matchingEngine: 'ME',
};

/** Public repository of each cluster's code. */
export const CLUSTER_REPO: Readonly<Record<ClusterKey, string>> = {
  core: 'core',
  matchingEngine: 'match',
};

/** A link to a build commit in the cluster's public repository, or null
 *  when the value is not a commit sha (never link to a guess). */
export function commitUrl(cluster: ClusterKey, sha: string | null): string | null {
  if (sha === null || !/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  return `https://github.com/openexch/${CLUSTER_REPO[cluster]}/commit/${sha.toLowerCase()}`;
}
