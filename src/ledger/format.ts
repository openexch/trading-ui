// SPDX-License-Identifier: Apache-2.0
/**
 * Formatting for the ledger values. Every function prints a dash for null
 * (DESIGN.md rule 14): a value the backend did not supply is never a zero.
 */

export const NONE = '–';

/** A log position, sequence number or count: "51,234,816". */
export function formatSeq(v: number | null): string {
  return v === null ? NONE : v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Bytes, labelled as bytes: "4,096 B". Negative stays negative (two
 *  processes sampled in one poll round, not at one instant). */
export function formatBytes(v: number | null): string {
  return v === null ? NONE : `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} B`;
}

/** A small id or term as it is: "4". */
export function formatId(v: number | null): string {
  return v === null ? NONE : String(v);
}

/** A step delta: "+3 ms", "+1.25 s", "+2 min". */
export function formatDelta(ms: number | null): string {
  if (ms === null) return NONE;
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms);
  if (a < 1000) return `${sign}${Math.round(a)} ms`;
  if (a < 60_000) return `${sign}${(a / 1000).toFixed(2)} s`;
  return `${sign}${Math.round(a / 60_000)} min`;
}

/** A duration without a sign: "850 ms", "1.2 s". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return NONE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "<1m ago", "12m ago", "3h ago", "2d ago": coarse on purpose, so a few
 *  seconds of clock skew between a server and this browser never show. */
export function formatAgo(atMs: number | null, now: number): string {
  if (atMs === null) return NONE;
  const m = Math.floor(Math.max(0, now - atMs) / 60_000);
  if (m < 1) return '<1m ago';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "14:03:59.120", local time, 24 hour, with milliseconds (trail steps). */
export function clockTimeMs(ms: number | null): string {
  if (ms === null) return NONE;
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** A state hash shortened for a row: the first and last four digits. The
 *  full hash stays in the title. */
export function shortHash(h: string | null): string {
  if (h === null) return NONE;
  return h.length <= 10 ? h : `${h.slice(0, 4)}…${h.slice(-4)}`;
}

/** A build commit shortened to 7 characters. */
export function shortCommit(sha: string | null): string {
  return sha === null ? NONE : sha.slice(0, 7);
}

/** Log numbers are ink: ink blue on paper, the strong text colour on ink
 *  (DESIGN.md: Identity, materials). */
export const LOG_INK = 'text-accent dark:text-text-strong';
