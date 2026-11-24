// SPDX-License-Identifier: Apache-2.0
/**
 * The ledger line in the header: for the core and the matching engine, the
 * cluster's log position (the leader's commit position), its term and its
 * node count (live / configured).
 *
 * - Source: the user stream's `engine` and `election` frames (engineStore).
 *   Signed out there is no stream, so every value is a dash; while the
 *   stream is down the last values are stale and print dashes too
 *   (DESIGN.md rule 14).
 * - An open election turns that cluster's counter into the warning state:
 *   its values in --warn and "Electing" in place of the node count, until
 *   the election's end frame.
 * - Degrades by the room the header's centre cell leaves (container queries
 *   on that cell): full (labels, positions, terms, nodes), then compact
 *   (positions and terms), hidden below. Every value sits in a fixed-width
 *   slot, so nothing shifts when values change.
 * - Not a live region (rule 12): updates are never announced. Each value's
 *   meaning is in its title.
 */
import type { ClusterKey, EngineCluster } from '../ledger/engine';
import { CLUSTER_SHORT, leaderOf } from '../ledger/engine';
import { useEngine, shownStatus } from '../ledger/engineStore';
import type { EngineState } from '../ledger/engineStore';
import { LOG_INK, NONE, formatId, formatSeq } from '../ledger/format';

export interface LineCluster {
  key: ClusterKey;
  /** The leader's commit position, formatted. */
  position: string;
  term: string;
  /** "3/3": live nodes of the configured ones. */
  nodes: string;
  electing: boolean;
}

function lineCluster(key: ClusterKey, c: EngineCluster | null, electing: boolean): LineCluster {
  if (c === null) return { key, position: NONE, term: NONE, nodes: NONE, electing };
  const lead = leaderOf(c);
  const live = c.nodes.filter(n => n.live === true).length;
  return {
    key,
    position: formatSeq(lead?.commitPosition ?? null),
    term: formatId(c.term),
    nodes: c.nodes.length > 0 ? `${live}/${c.nodes.length}` : NONE,
    electing,
  };
}

export function lineModel(s: EngineState): LineCluster[] {
  const status = shownStatus(s);
  return (['core', 'matchingEngine'] as const).map(k => lineCluster(k, status ? status[k] : null, s.electing[k] !== null));
}

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.06em]';

function Segment({ c }: { c: LineCluster }) {
  const tone = c.electing ? 'text-warn' : 'text-text-strong';
  const ink = c.electing ? 'text-warn' : LOG_INK;
  const label = c.electing ? 'text-warn' : 'text-muted';
  const name = CLUSTER_SHORT[c.key];
  return (
    <span
      data-engine-line={c.key}
      data-electing={c.electing ? 'true' : undefined}
      className="flex items-baseline gap-1.5"
    >
      <span className={`${LABEL} ${label}`}>{name}</span>
      <span className={`${LABEL} ${label} hidden @min-[700px]:inline`}>log</span>
      <span
        data-engine-position
        title={`${name} log position: the leader's commit position (bytes)`}
        className={`inline-block min-w-[11ch] text-right text-[12px] font-medium tabular-nums ${ink}`}
      >
        {c.position}
      </span>
      <span className={`${LABEL} ${label}`}>T</span>
      <span
        data-engine-term
        title={`${name} leadership term`}
        className={`inline-block min-w-[3ch] text-[12px] font-medium tabular-nums ${tone}`}
      >
        {c.term}
      </span>
      <span
        data-engine-nodes
        title={c.electing ? `${name}: electing a leader` : `${name} nodes: live of configured`}
        className={`hidden min-w-[8ch] text-[12px] tabular-nums @min-[700px]:inline-block ${
          c.electing ? 'font-semibold text-warn' : 'text-muted'
        }`}
      >
        {c.electing ? 'Electing' : `${c.nodes} nodes`}
      </span>
    </span>
  );
}

export function EngineLine({ state }: { state?: EngineState }) {
  const live = useEngine();
  const model = lineModel(state ?? live);
  return (
    <div
      role="group"
      aria-label="Engine log positions"
      data-engine-line-root
      className="hidden items-center gap-3 whitespace-nowrap @min-[520px]:flex"
    >
      {model.map((c, i) => (
        <span key={c.key} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden className="h-3 w-px flex-none bg-hairline-strong" />}
          <Segment c={c} />
        </span>
      ))}
    </div>
  );
}
