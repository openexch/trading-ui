// SPDX-License-Identifier: Apache-2.0
/**
 * Engines (the motor panel): the core and the matching engine as their
 * logs see them, from the user stream's `engine` frame (engineStore).
 *
 * - Per cluster: leader and term; each node's role, commit position and how
 *   far it is behind the leader, in BYTES (log positions are bytes; no node
 *   reports a count of entries, so there is no entries column); the last
 *   snapshot with each node's state hash and whether the hashes match (a
 *   diverged hash is shown and names its node); the last election; each
 *   node's version and build commit, linked to the cluster's public
 *   repository.
 * - Bridge: the journal sequence the core has consumed against the
 *   matching engine's journal head (journal sequence numbers, not log
 *   positions).
 * - Signed out there is no engine frame (the stream needs a credential), and
 *   a stream that is down leaves the last frame stale: every value prints a
 *   dash, never an old or invented one (DESIGN.md rule 14).
 */
import { useEffect, useState } from 'react';
import type { ClusterKey, EngineBridge, EngineCluster, EngineNode } from '../../ledger/engine';
import { CLUSTER_NAME, commitUrl, emptyCluster } from '../../ledger/engine';
import { useEngine, shownStatus } from '../../ledger/engineStore';
import type { EngineState } from '../../ledger/engineStore';
import {
  NONE,
  formatAgo,
  formatBytes,
  formatDuration,
  formatId,
  formatSeq,
  shortCommit,
  shortHash,
  LOG_INK,
} from '../../ledger/format';
import { HEADER_RULE } from '../ladder/Rung';
import type { SlotChrome } from '../layout/SideColumn';
import { PanelFrame } from './PanelFrame';

export interface EnginesPanelProps {
  chrome: SlotChrome;
  signedIn: boolean;
  /** Tests: a fixed state instead of the store. */
  state?: EngineState;
  /** Tests: a fixed clock. */
  now?: number;
}

const ROLE_WORD: Readonly<Record<string, string>> = {
  leader: 'Leader',
  follower: 'Follower',
  candidate: 'Candidate',
  unreachable: 'Unreachable',
};

/** A node's role in words, with its error code when it has one. */
export function roleText(n: EngineNode): string {
  const role = n.role ? ROLE_WORD[n.role] : NONE;
  return n.error ? `${role === NONE ? 'Unknown' : role} (${n.error.replace(/_/g, ' ')})` : role;
}

function useNow(fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.06em] text-muted';

function Commit({ cluster, sha }: { cluster: ClusterKey; sha: string | null }) {
  const url = commitUrl(cluster, sha);
  if (url === null) return <span className="text-muted">{shortCommit(sha)}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`Build commit ${sha}`}
      className="text-accent underline decoration-hairline-strong underline-offset-2 hover:decoration-accent"
    >
      {shortCommit(sha)}
    </a>
  );
}

function NodeRow({ cluster, n, diverged }: { cluster: ClusterKey; n: EngineNode; diverged: boolean }) {
  const down = n.role === 'unreachable' || n.live === false;
  return (
    <li
      data-engine-node={`${cluster}-${n.id}`}
      data-role={n.role ?? undefined}
      className="border-b border-hairline px-4 py-1.5 text-[12px]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] items-baseline gap-2">
        <span className="truncate">
          <span className="font-semibold text-text-strong">Node {n.id}</span>{' '}
          <span className={down ? 'text-sell' : n.role === 'candidate' ? 'text-warn' : 'text-muted'}>{roleText(n)}</span>
        </span>
        <span className={`truncate text-right tabular-nums ${LOG_INK}`} title="Commit position (bytes)">
          {formatSeq(n.commitPosition)}
        </span>
        <span className="truncate text-right tabular-nums text-muted" title="Behind the leader's commit position (bytes)">
          {formatBytes(n.behindBytes)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
        <span title={n.snapshot.stateHash ? `State hash ${n.snapshot.stateHash}` : 'No state hash'}>
          hash{' '}
          <span data-state-hash className={diverged ? 'font-semibold text-sell' : 'text-text'}>
            {shortHash(n.snapshot.stateHash)}
          </span>
          {diverged && <span className="text-sell"> diverged</span>}
        </span>
        <span>
          v <span className="text-text">{n.version ?? NONE}</span>
        </span>
        <span>
          build <Commit cluster={cluster} sha={n.buildCommit} />
        </span>
      </div>
    </li>
  );
}

function ClusterBlock({ k, c, now }: { k: ClusterKey; c: EngineCluster; now: number }) {
  const diverged = new Set(c.snapshot.divergedNodes);
  for (const n of c.nodes) if (n.snapshot.agreement === 'diverged') diverged.add(n.id);
  const divergedNames = [...diverged].sort((a, b) => a - b).map(id => `node ${id}`);
  const agreement =
    c.snapshot.agreement === 'diverged' || diverged.size > 0
      ? `diverged: ${divergedNames.join(', ')}`
      : c.snapshot.agreement === 'matched'
        ? 'hashes match'
        : NONE;
  const e = c.lastElection;
  return (
    <section aria-label={CLUSTER_NAME[k]} data-engine-cluster={k}>
      <div className={`flex h-8 items-center justify-between px-4 ${HEADER_RULE}`}>
        <span className={LABEL}>{CLUSTER_NAME[k]}</span>
        <span className="text-[12px] tabular-nums text-muted">
          leader <span className="text-text-strong">{formatId(c.leaderId)}</span> · term{' '}
          <span className="text-text-strong">{formatId(c.term)}</span>
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-2 px-4 pt-1 text-[11px] text-muted">
        <span>Node</span>
        <span className="text-right">Commit</span>
        <span className="text-right">Behind</span>
      </div>
      {c.nodes.length === 0 ? (
        <div className="px-4 py-2 text-[12px] text-muted">{NONE}</div>
      ) : (
        <ul className="m-0 list-none p-0">
          {c.nodes.map(n => (
            <NodeRow key={n.id} cluster={k} n={n} diverged={diverged.has(n.id)} />
          ))}
        </ul>
      )}
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-2 text-[12px]">
        <dt className="text-muted">Snapshot</dt>
        <dd data-snapshot-agreement className={`m-0 truncate tabular-nums ${diverged.size > 0 ? 'font-semibold text-sell' : 'text-text'}`}>
          {formatSeq(c.snapshot.position)} · {formatAgo(c.snapshot.atMs, now)} · {agreement}
        </dd>
        <dt className="text-muted">Last election</dt>
        <dd data-last-election className="m-0 truncate tabular-nums text-text">
          {e === null
            ? NONE
            : `term ${formatId(e.previousTerm)} → ${formatId(e.term)} · leader ${formatId(e.previousLeaderId)} → ${formatId(
                e.leaderId,
              )} · ${formatAgo(e.atMs, now)}${e.observedGapMs !== null ? ` · gap ${formatDuration(e.observedGapMs)}` : ''}`}
        </dd>
      </dl>
    </section>
  );
}

function BridgeBlock({ b }: { b: EngineBridge | null }) {
  return (
    <section aria-label="Bridge" data-engine-bridge>
      <div className={`flex h-8 items-center px-4 ${HEADER_RULE}`}>
        <span className={LABEL}>Bridge</span>
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-2 text-[12px] tabular-nums">
        <dt className="text-muted">Consumed journal seq</dt>
        <dd className="m-0 text-right text-text-strong">{formatSeq(b?.consumedJournalSeq ?? null)}</dd>
        <dt className="text-muted">ME journal seq</dt>
        <dd className="m-0 text-right text-text-strong">{formatSeq(b?.meJournalSeq ?? null)}</dd>
        <dt className="text-muted">Entries behind</dt>
        <dd className="m-0 text-right text-text">{formatSeq(b?.entriesBehind ?? null)}</dd>
      </dl>
    </section>
  );
}

export function EnginesPanel({ chrome, signedIn, state, now: fixedNow }: EnginesPanelProps) {
  const live = useEngine();
  const s = state ?? live;
  const now = useNow(fixedNow);
  const status = shownStatus(s);
  return (
    <PanelFrame label="Engines" position={chrome.position} header={chrome.picker()}>
      {!signedIn && (
        <p className="m-0 border-b border-hairline px-4 py-2 text-[12px] text-muted">
          Engine status rides your account's stream: sign in to see it live.
        </p>
      )}
      {(['core', 'matchingEngine'] as const).map(k => (
        <ClusterBlock key={k} k={k} c={status ? status[k] : emptyCluster()} now={now} />
      ))}
      <BridgeBlock b={status ? status.bridge : null} />
    </PanelFrame>
  );
}
