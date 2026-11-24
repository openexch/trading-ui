// SPDX-License-Identifier: Apache-2.0
/**
 * Fills the user stream could not deliver. After a `resync`, or after a
 * reconnect that could not resume, events between the last one seen and the
 * new orders snapshot were not replayed, and fills among them were missed.
 * The stream announces the gap here with E, the snapshot's asOf.eventSeq;
 * every mounted fills list re-reads GET /api/v2/fills until an answer's
 * asOf.eventSeq is at least E (the gateway's API document, section 5.5).
 */
type Listener = (eventSeq: number) => void;

const listeners = new Set<Listener>();

export function notifyFillsGap(eventSeq: number): void {
  for (const l of [...listeners]) l(eventSeq);
}

export function subscribeFillsGap(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
