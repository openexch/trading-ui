// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitUrl, leaderOf, parseElectionFrame, parseEngineFrame } from './engine';
import { createEngineStore, electingClusters, engineWaitText, shownStatus } from './engineStore';
import { clockTimeMs, formatAgo, formatBytes, formatDelta, formatSeq, shortHash } from './format';
import { parseMovement, readMovements } from './movements';
import { clearSubmits, recordSubmit, submitTimeOf } from './orderEvents';
import { parseTrailItem, readTrail, trailSteps } from './trail';
import type { TrailItem } from './trail';
import { apiError, asResponse } from '../test/wire';
import type { Reply } from '../test/wire';
import { engineFrame } from '../test/engine';

describe('engine frame', () => {
  it('parses both clusters, the bridge and the last election', () => {
    const s = parseEngineFrame(engineFrame())!;
    expect(s.core.term).toBe(4);
    expect(leaderOf(s.core)?.commitPosition).toBe(51_234_816);
    expect(s.core.nodes[2].behindBytes).toBe(4816);
    expect(s.core.lastElection).toMatchObject({ previousTerm: 3, term: 4, observedGapMs: 1200, durationMs: null });
    expect(s.matchingEngine.nodes[2]).toMatchObject({ role: 'unreachable', live: false, error: 'timeout', commitPosition: null });
    expect(s.bridge).toEqual({ consumedJournalSeq: 880, meJournalSeq: 882, entriesBehind: 2 });
  });

  it('a missing or mistyped field is null, never a guess', () => {
    const raw = engineFrame({ core: { term: '4', leaderId: undefined, snapshot: 7 }, bridge: { entriesBehind: 1.5 } });
    const s = parseEngineFrame(raw)!;
    expect(s.core.term).toBeNull();
    expect(s.core.leaderId).toBeNull();
    expect(leaderOf(s.core)).toBeNull();
    expect(s.core.snapshot).toEqual({ position: null, atMs: null, agreement: null, divergedNodes: [] });
    expect(s.bridge.entriesBehind).toBeNull();
    // A node row without an id is dropped (it could be anyone's).
    const t = parseEngineFrame(engineFrame({ core: { nodes: [{ role: 'leader' }] } }))!;
    expect(t.core.nodes).toEqual([]);
    expect(parseEngineFrame({ type: 'heartbeat' })).toBeNull();
    // A cluster that is missing altogether is all dashes.
    const u = parseEngineFrame({ type: 'engine' })!;
    expect(u.matchingEngine.nodes).toEqual([]);
    expect(u.bridge.meJournalSeq).toBeNull();
  });

  it('an unknown role is null; roles are read case-insensitively', () => {
    const s = parseEngineFrame(engineFrame({ core: { nodes: [{ id: 0, role: 'LEADER' }, { id: 1, role: 'observer' }] } }))!;
    expect(s.core.nodes.map(n => n.role)).toEqual(['leader', null]);
  });

  it('election frames: start and end; anything without a cluster, phase or time is dropped', () => {
    expect(parseElectionFrame({
      type: 'election', cluster: 'core', phase: 'start', atMs: 10, previousTerm: 3, previousLeaderId: 0, lastCommitPosition: 99, candidates: [1, 2],
    })).toMatchObject({ cluster: 'core', phase: 'start', candidates: [1, 2], lastCommitPosition: 99, term: null });
    expect(parseElectionFrame({
      type: 'election', cluster: 'matchingEngine', phase: 'end', atMs: 20, previousTerm: 3, previousLeaderId: 0, term: 4, leaderId: 1,
      firstEntryPosition: null, durationMs: null, observedGapMs: 900, orderEntryReopened: null,
    })).toMatchObject({ cluster: 'matchingEngine', phase: 'end', term: 4, leaderId: 1, observedGapMs: 900 });
    expect(parseElectionFrame({ type: 'election', cluster: 'bridge', phase: 'start', atMs: 1 })).toBeNull();
    expect(parseElectionFrame({ type: 'election', cluster: 'core', phase: 'start' })).toBeNull();
  });

  it('build commits link to the public repositories, and only real shas link', () => {
    expect(commitUrl('core', 'ABCDEF1')).toBe('https://github.com/openexch/core/commit/abcdef1');
    expect(commitUrl('matchingEngine', 'abcdef1234')).toBe('https://github.com/openexch/match/commit/abcdef1234');
    expect(commitUrl('core', null)).toBeNull();
    expect(commitUrl('core', 'v1.0.0')).toBeNull();
    expect(commitUrl('core', 'abc')).toBeNull();
  });
});

describe('engine store', () => {
  const start = parseElectionFrame({ type: 'election', cluster: 'core', phase: 'start', atMs: 10, previousTerm: 3, previousLeaderId: 0 })!;
  const end = parseElectionFrame({ type: 'election', cluster: 'core', phase: 'end', atMs: 20, previousTerm: 3, previousLeaderId: 0, term: 4, leaderId: 1 })!;

  it('nothing is shown before a frame, or while the stream is down', () => {
    const st = createEngineStore();
    expect(shownStatus(st.get())).toBeNull();
    st.engine(parseEngineFrame(engineFrame())!);
    expect(shownStatus(st.get())).toBeNull(); // not live yet
    st.setLive(true);
    expect(shownStatus(st.get())?.core.term).toBe(4);
    st.setLive(false);
    expect(shownStatus(st.get())).toBeNull();
    st.reset();
    expect(st.get().status).toBeNull();
  });

  it('an election opens on start and closes on its end; rows are kept newest first', () => {
    const st = createEngineStore();
    st.election(start);
    expect(electingClusters(st.get())).toEqual(['core']);
    expect(engineWaitText(st.get())).toMatch(/order entry is waiting\. nothing is lost/i);
    st.election(end);
    expect(electingClusters(st.get())).toEqual([]);
    expect(engineWaitText(st.get())).toBeNull();
    expect(st.get().elections.map(e => e.phase)).toEqual(['end', 'start']);
  });

  it('a later engine frame naming a leader closes an election whose end was missed', () => {
    const st = createEngineStore();
    st.election(start);
    st.engine(parseEngineFrame(engineFrame({ core: { leaderId: null, term: null } }))!);
    expect(electingClusters(st.get())).toEqual(['core']);
    st.engine(parseEngineFrame(engineFrame())!);
    expect(electingClusters(st.get())).toEqual([]);
  });

  it('a matching-engine election says accepted orders wait in the core', () => {
    const st = createEngineStore();
    st.election({ ...start, cluster: 'matchingEngine' });
    expect(engineWaitText(st.get())).toMatch(/accepted orders wait in the core/);
  });
});

describe('format', () => {
  it('prints a dash for null, never a zero', () => {
    for (const f of [formatSeq, formatBytes, formatDelta]) expect(f(null)).toBe('–');
    expect(shortHash(null)).toBe('–');
    expect(clockTimeMs(null)).toBe('–');
    expect(formatAgo(null, 0)).toBe('–');
  });
  it('bytes are labelled as bytes; deltas carry a sign and a unit', () => {
    expect(formatBytes(4816)).toBe('4,816 B');
    expect(formatBytes(-12)).toBe('-12 B');
    expect(formatSeq(51_234_816)).toBe('51,234,816');
    expect(formatDelta(3)).toBe('+3 ms');
    expect(formatDelta(1250)).toBe('+1.25 s');
    expect(formatDelta(-4)).toBe('−4 ms');
    expect(shortHash('1234567890123')).toBe('1234…0123');
  });
});

// ---- the order trail -----------------------------------------------------------

const item = (over: Partial<Record<keyof TrailItem, unknown>> & { eventSeq: number; event: string }) => ({
  status: 'NEW', coreLogPosition: null, me: null, liquidity: null, tradeId: null, lastPrice: null, lastQty: null,
  holdRemaining: null, at: null, ...over,
});

describe('order trail', () => {
  const items = [
    item({ eventSeq: 10, event: 'ACCEPTED', status: 'PENDING_NEW', coreLogPosition: 5000, holdRemaining: '650.005', at: 1_000 }),
    item({ eventSeq: 11, event: 'ACK_NEW', coreLogPosition: 5100, me: { epoch: '7', egressSeq: 40, journalSeq: 900, at: 1_002 }, at: 1_004 }),
    item({
      eventSeq: 12, event: 'FILL', status: 'FILLED', coreLogPosition: 5200, liquidity: 'MAKER', tradeId: '500231',
      lastPrice: '65000.5', lastQty: '0.004', holdRemaining: '0', at: 1_010,
      me: { epoch: '7', egressSeq: 41, journalSeq: 905, at: 1_006 },
    }),
  ].map(i => parseTrailItem(i)!);

  it('steps: gateway, core accepted, ME booked, ME matched, core settled', () => {
    const steps = trailSteps(items, { sentAt: 990, roundTripMs: 4 });
    expect(steps.map(s => s.label)).toEqual(['Gateway', 'Core accepted', 'ME booked', 'ME matched', 'Core settled']);
    expect(steps[0]).toMatchObject({ at: 990, deltaMs: 4, positions: [] });
    expect(steps[1]).toMatchObject({ at: 1_000, detail: 'hold 650.005', positions: [{ label: 'core log', value: 5000 }] });
    // The ME's numbers are labelled journal seq and egress seq: never a log position.
    expect(steps[2].positions).toEqual([{ label: 'journal seq', value: 900 }, { label: 'egress seq', value: 40 }]);
    expect(steps[3]).toMatchObject({ at: 1_006, detail: '0.004 @ 65000.5 · maker' });
    expect(steps[4]).toMatchObject({ at: 1_010, positions: [{ label: 'core log', value: 5200 }] });
    for (const s of steps.slice(2, 4)) expect(s.positions.map(p => p.label)).not.toContain('core log');
  });

  it('deltas compare only times of one clock', () => {
    const steps = trailSteps(items, null);
    // Core accepted is the first core time: no delta (the gateway is this browser's clock).
    expect(steps[1].deltaMs).toBeNull();
    expect(steps[2].deltaMs).toBeNull(); // first ME time
    expect(steps[3].deltaMs).toBe(4); // ME 1002 -> 1006
    expect(steps[4].deltaMs).toBe(10); // core 1000 -> 1010
  });

  it('without a submit record the gateway step is dashes; a record without me.at has no ME time', () => {
    const noAt = parseTrailItem(item({ eventSeq: 11, event: 'ACK_NEW', me: { epoch: '7', logPosition: 40, journalSeq: 900 } }))!;
    const steps = trailSteps([noAt], null);
    expect(steps[0]).toMatchObject({ at: null, deltaMs: null, detail: null });
    // An older gateway's me.logPosition is read as the egress sequence.
    expect(steps[1]).toMatchObject({ at: null, positions: [{ label: 'journal seq', value: 900 }, { label: 'egress seq', value: 40 }] });
  });

  it('other events are named steps at their core log position; records out of order are sorted', () => {
    const cancel = parseTrailItem(item({ eventSeq: 13, event: 'CANCELLED', coreLogPosition: 5300, at: 1_020 }))!;
    const steps = trailSteps([cancel, ...items], null);
    expect(steps[steps.length - 1].label).toBe('Cancelled');
    expect(steps[steps.length - 1].positions).toEqual([{ label: 'core log', value: 5300 }]);
    expect(parseTrailItem({ event: 'FILL' })).toBeNull();
  });

  it('submit times are this session’s own record', () => {
    clearSubmits();
    expect(submitTimeOf('1')).toBeNull();
    recordSubmit('1', { sentAt: 5, roundTripMs: 2 });
    expect(submitTimeOf('1')).toEqual({ sentAt: 5, roundTripMs: 2 });
  });
});

describe('reading the trail and the movements', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  function replies(...rs: Reply[]) {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return asResponse(rs.shift() ?? { status: 500 });
    }) as unknown as typeof fetch;
    return urls;
  }

  it('reads every page of the trail', async () => {
    const urls = replies(
      { status: 200, body: { orderId: '7', items: [item({ eventSeq: 1, event: 'ACCEPTED' })], nextCursor: 'c2' } },
      { status: 200, body: { orderId: '7', items: [item({ eventSeq: 2, event: 'ACK_NEW' })], nextCursor: null } },
    );
    const r = await readTrail('7');
    expect(r.ok && r.items.map(i => i.event)).toEqual(['ACCEPTED', 'ACK_NEW']);
    expect(urls[0]).toContain('/api/v2/orders/7/trail?limit=100');
    expect(urls[1]).toContain('cursor=c2');
  });

  it('a 503 with a short Retry-After is a fresh order not projected yet; a long one is no history service', async () => {
    replies({ status: 503, body: apiError('HISTORY_UNAVAILABLE', 'history is not available'), headers: { 'Retry-After': '1' } });
    expect(await readTrail('7')).toMatchObject({ ok: false, kind: 'pending', retryAfterMs: 1000 });
    replies({ status: 503, body: apiError('HISTORY_UNAVAILABLE', 'history is not available'), headers: { 'Retry-After': '60' } });
    expect(await readTrail('7')).toMatchObject({ ok: false, kind: 'unavailable' });
    replies({ status: 404, body: apiError('NOT_FOUND', 'not found') });
    expect(await readTrail('7')).toMatchObject({ ok: false, kind: 'gone' });
  });

  it('movements: newest first with a cursor; 503 is "not available"', async () => {
    const urls = replies({
      status: 200,
      body: {
        items: [{ logPosition: 51234816, kind: 'SETTLE', asset: 'USD', delta: '-260.002', balanceAfter: '9739.998', at: 9 }],
        nextCursor: 'n1',
      },
    });
    const r = await readMovements('2', null);
    expect(r).toEqual({
      ok: true,
      items: [{ logPosition: 51234816, kind: 'SETTLE', asset: 'USD', delta: '-260.002', balanceAfter: '9739.998', at: 9 }],
      nextCursor: 'n1',
    });
    expect(urls[0]).toContain('/api/v2/balances/movements?assetId=2&limit=50');
    replies({ status: 503, body: apiError('HISTORY_UNAVAILABLE', 'x') });
    expect(await readMovements('2', 'n1')).toEqual({ ok: false, unavailable: true, text: 'The balance ledger is not available' });
  });

  it('a movement field of the wrong form is null', () => {
    expect(parseMovement({ logPosition: '5', kind: '', delta: 12, balanceAfter: '1e3', at: 1.5 })).toEqual({
      logPosition: null, kind: null, asset: null, delta: null, balanceAfter: null, at: null,
    });
  });
});
