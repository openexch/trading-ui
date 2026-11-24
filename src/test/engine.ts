// SPDX-License-Identifier: Apache-2.0
// Test fixtures for the user stream's engine telemetry.

/** An engine frame as the gateway's EngineStatus.cpp writes it. */
export function engineFrame(over: { core?: object; matchingEngine?: object; bridge?: object } = {}) {
  const node = (id: number, role: string, commit: number, extra: object = {}) => ({
    id, role, live: true, recovery: 'ready', term: 4, commitPosition: commit, appliedPosition: commit, behindBytes: 0,
    entriesBehind: null, snapshot: { position: 4096, atMs: 1_000, stateHash: '1234567890123', agreement: 'matched' },
    version: '1.0.0', buildCommit: 'abcdef1234567', error: null, ...extra,
  });
  return {
    type: 'engine',
    core: {
      configured: true, term: 4, leaderId: 0,
      nodes: [node(0, 'leader', 51_234_816), node(1, 'follower', 51_234_816), node(2, 'follower', 51_230_000, { behindBytes: 4816 })],
      lastElection: { atMs: 500, previousLeaderId: 2, leaderId: 0, previousTerm: 3, term: 4, durationMs: null, observedGapMs: 1200 },
      snapshot: { position: 4096, atMs: 1_000, agreement: 'matched', divergedNodes: [] },
      ...over.core,
    },
    matchingEngine: {
      configured: true, term: 2, leaderId: 1,
      nodes: [node(0, 'follower', 9_000), node(1, 'leader', 9_100), node(2, 'unreachable', 0, { live: false, commitPosition: null, error: 'timeout' })],
      lastElection: null,
      snapshot: { position: null, atMs: null, agreement: null, divergedNodes: [] },
      ...over.matchingEngine,
    },
    bridge: { consumedJournalSeq: 880, meJournalSeq: 882, entriesBehind: 2, ...over.bridge },
  };
}
