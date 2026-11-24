// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * The ledger identity's screen parts with fixed data: the header line, the
 * engines panel, the tape's journal sequence and election rows, the order
 * trail, the balance ledger and the strip's undecided answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseElectionFrame, parseEngineFrame } from '../ledger/engine';
import type { ElectionEvent } from '../ledger/engine';
import { EMPTY_ENGINE } from '../ledger/engineStore';
import type { EngineState } from '../ledger/engineStore';
import { notifyOrderEvent } from '../ledger/orderEvents';
import { engineFrame } from '../test/engine';
import { apiError, asResponse } from '../test/wire';
import type { Reply } from '../test/wire';
import { TEST_MARKETS } from '../test/markets';
import { EngineLine, lineModel } from './EngineLine';
import { EnginesPanel } from './panels/EnginesPanel';
import { TradesPanel, tapeRows } from './panels/TradesPanel';
import { BalanceLedger } from './panels/BalanceLedger';
import { OrderTrail } from './orders/OrderTrail';
import { undecidedResult } from './ladder/TradingLadder';
import type { SlotChrome } from './layout/SideColumn';
import type { TapeTrade } from '../types/market';

const chrome: SlotChrome = { slot: 0, position: 'top', picker: () => <span>Panel</span> };

function state(over: Partial<EngineState> = {}, frame: object = engineFrame()): EngineState {
  return { ...EMPTY_ENGINE, status: parseEngineFrame(frame), live: true, ...over };
}

const coreStart = parseElectionFrame({
  type: 'election', cluster: 'core', phase: 'start', atMs: 2_000, previousTerm: 3, previousLeaderId: 0, candidates: [1],
})!;
const coreEnd = parseElectionFrame({
  type: 'election', cluster: 'core', phase: 'end', atMs: 3_000, previousTerm: 3, previousLeaderId: 0, term: 4, leaderId: 1, observedGapMs: 1200,
})!;

afterEach(() => cleanup());

describe('header ledger line', () => {
  it('core and ME: leader commit position, term, live of configured nodes', () => {
    const [core, me] = lineModel(state());
    expect(core).toEqual({ key: 'core', position: '51,234,816', term: '4', nodes: '3/3', electing: false });
    expect(me).toEqual({ key: 'matchingEngine', position: '9,100', term: '2', nodes: '2/3', electing: false });
  });

  it('signed out, before a frame, or with the stream down: dashes', () => {
    for (const s of [EMPTY_ENGINE, state({ live: false })]) {
      for (const c of lineModel(s)) expect(c).toMatchObject({ position: '–', term: '–', nodes: '–' });
    }
  });

  it('an open election is the warning state: Electing in place of the nodes', () => {
    const s = state({ electing: { core: coreStart, matchingEngine: null } });
    const { container } = render(<EngineLine state={s} />);
    const seg = container.querySelector('[data-engine-line="core"]')!;
    expect(seg.getAttribute('data-electing')).toBe('true');
    expect(seg.querySelector('[data-engine-nodes]')!.textContent).toBe('Electing');
    expect(container.querySelector('[data-engine-line="matchingEngine"]')!.getAttribute('data-electing')).toBeNull();
  });
});

describe('engines panel', () => {
  it('per node: role, commit, behind in bytes, hash, version and a linked build commit', () => {
    const { container } = render(<EnginesPanel chrome={chrome} signedIn state={state()} now={61_000} />);
    const lead = container.querySelector('[data-engine-node="core-0"]')!;
    expect(lead.textContent).toContain('Leader');
    expect(lead.textContent).toContain('51,234,816');
    expect(container.querySelector('[data-engine-node="core-2"]')!.textContent).toContain('4,816 B');
    const link = lead.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://github.com/openexch/core/commit/abcdef1234567');
    expect(container.querySelector('[data-engine-node="matchingEngine-1"] a')!.getAttribute('href')).toBe(
      'https://github.com/openexch/match/commit/abcdef1234567',
    );
    // A node that did not answer: its role and its error code, never values.
    const down = container.querySelector('[data-engine-node="matchingEngine-2"]')!;
    expect(down.textContent).toContain('Unreachable (timeout)');
    expect(container.querySelector('[data-engine-cluster="core"] [data-snapshot-agreement]')!.textContent).toContain('hashes match');
    expect(container.querySelector('[data-engine-cluster="core"] [data-last-election]')!.textContent).toContain('term 3 → 4');
    // No entries-behind column: only bytes are reported.
    expect(container.textContent).not.toMatch(/entries behind the leader/i);
    const bridge = container.querySelector('[data-engine-bridge]')!;
    expect(bridge.textContent).toContain('Consumed journal seq880');
    expect(bridge.textContent).toContain('ME journal seq882');
  });

  it('a diverged hash is shown and names its node', () => {
    const frame = engineFrame({
      core: {
        snapshot: { position: 4096, atMs: 1_000, agreement: 'diverged', divergedNodes: [2] },
      },
    });
    (frame.core.nodes[2] as { snapshot: object }).snapshot = {
      position: 4096, atMs: 1_000, stateHash: '999', agreement: 'diverged',
    };
    const { container } = render(<EnginesPanel chrome={chrome} signedIn state={state({}, frame)} now={2_000} />);
    expect(container.querySelector('[data-engine-cluster="core"] [data-snapshot-agreement]')!.textContent).toContain(
      'diverged: node 2',
    );
    expect(container.querySelector('[data-engine-node="core-2"]')!.textContent).toContain('diverged');
    expect(container.querySelector('[data-engine-node="core-1"]')!.textContent).not.toContain('diverged');
  });

  it('signed out: dashes and a note, never old or invented values', () => {
    const { container } = render(<EnginesPanel chrome={chrome} signedIn={false} state={EMPTY_ENGINE} now={0} />);
    expect(container.textContent).toContain('sign in to see it live');
    expect(container.querySelectorAll('[data-engine-node]')).toHaveLength(0);
    expect(container.querySelector('[data-engine-bridge]')!.textContent).not.toMatch(/[0-9]/);
  });
});

describe('tape', () => {
  const market = TEST_MARKETS[0];
  const trade = (seq: number, ts: number, journalSeq: number | null): TapeTrade => ({
    seq, tradeId: String(seq), price: 97_000 + seq, quantity: 0.1, tradeCount: 1, side: 'BUY', timestamp: ts, journalSeq,
  });

  it('each row carries its ME journal seq, labelled as one; a missing one is a dash', () => {
    const { container } = render(
      <TradesPanel chrome={chrome} market={market} trades={[trade(2, 2_000, 88_123), trade(1, 1_000, null)]} elections={[]} />,
    );
    expect(container.textContent).toContain('Journal seq');
    const cells = [...container.querySelectorAll('[data-journal-seq]')];
    expect(cells[0].textContent).toBe('journal seq 88,123');
    expect(cells[0].getAttribute('title')).toBe('ME journal seq 88123');
    expect(cells[1].textContent).toBe('journal seq –');
  });

  it('elections are rows in time order between the trades', () => {
    const trades = [trade(3, 4_000, 3), trade(2, 2_500, 2), trade(1, 1_000, 1)];
    const rows = tapeRows(trades, [coreStart, coreEnd] as ElectionEvent[]);
    expect(rows.map(r => (r.kind === 'trade' ? `t${r.t.seq}` : r.e.phase))).toEqual(['t3', 'end', 't2', 'start', 't1']);
    const { container } = render(<TradesPanel chrome={chrome} market={market} trades={trades} elections={[coreEnd, coreStart]} />);
    const start = container.querySelector('[data-election-row="start"]')!;
    expect(start.textContent).toContain('Core election started · leader 0 lost · term 3');
    expect(container.querySelector('[data-election-row="end"]')!.textContent).toContain('Core election ended · leader 1 · term 4 · 1.2 s');
  });
});

describe('order trail and balance ledger (fetch mocked)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });
  function route(fn: (url: string) => Reply) {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return asResponse(fn(String(input)));
    }) as unknown as typeof fetch;
    return urls;
  }
  const trailBody = (events: string[]) => ({
    orderId: '7',
    items: events.map((event, i) => ({
      eventSeq: i + 1, event, status: 'NEW', coreLogPosition: 1000 + i, liquidity: null, tradeId: null, lastPrice: null,
      lastQty: null, holdRemaining: '1', at: 10 + i, me: event === 'ACCEPTED' ? null : { epoch: '1', egressSeq: 5, journalSeq: 77, at: 11 },
    })),
    nextCursor: null,
  });

  it('a fresh order: 503 says it is not in the history yet, then reads again; an order frame reads again', async () => {
    let n = 0;
    const urls = route(() => {
      n++;
      if (n === 1) return { status: 503, body: apiError('HISTORY_UNAVAILABLE', 'history is not available'), headers: { 'Retry-After': '1' } };
      return { status: 200, body: trailBody(n === 2 ? ['ACCEPTED'] : ['ACCEPTED', 'ACK_NEW']) };
    });
    const { container } = render(<OrderTrail orderId="7" />);
    await screen.findByText(/not in the history yet, reading again/i);
    await waitFor(() => expect(container.querySelectorAll('[data-trail-step]')).toHaveLength(2), { timeout: 3000 });
    expect(container.querySelector('[data-trail-step="accepted"]')!.textContent).toContain('core log 1,000');
    act(() => notifyOrderEvent('7'));
    await waitFor(() => expect(container.querySelector('[data-trail-step="booked"]')).toBeTruthy());
    const booked = container.querySelector('[data-trail-step="booked"]')!;
    expect(booked.textContent).toContain('journal seq 77');
    expect(booked.textContent).toContain('egress seq 5');
    expect(booked.textContent).not.toContain('core log');
    expect(urls.every(u => u.includes('/api/v2/orders/7/trail'))).toBe(true);
    // Another order's frame does not read this one again.
    const before = urls.length;
    act(() => notifyOrderEvent('8'));
    await new Promise(r => setTimeout(r, 300));
    expect(urls.length).toBe(before);
  });

  it('the balance ledger lists movements with their core log position and pages with Older', async () => {
    const urls = route(url =>
      url.includes('cursor=')
        ? { status: 200, body: { items: [{ logPosition: 10, kind: 'DEPOSIT', asset: 'USD', delta: '10000', balanceAfter: '10000', at: 1 }], nextCursor: null } }
        : {
            status: 200,
            body: {
              items: [{ logPosition: 51234816, kind: 'SETTLE_DEBIT', asset: 'USD', delta: '-260.002', balanceAfter: '9739.998', at: 9 }],
              nextCursor: 'c1',
            },
          },
    );
    const { container } = render(<BalanceLedger assetId="2" />);
    await waitFor(() => expect(container.querySelectorAll('[data-movement]')).toHaveLength(1));
    const row = container.querySelector('[data-movement]')!;
    expect(row.textContent).toContain('Settle debit');
    expect(row.textContent).toContain('−260.002');
    expect(row.textContent).toContain('51,234,816');
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(container.querySelectorAll('[data-movement]')).toHaveLength(2));
    expect(urls[1]).toContain('cursor=c1');
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
  });

  it('the balance ledger where the route is not configured: says so, no rows', async () => {
    route(() => ({ status: 503, body: apiError('HISTORY_UNAVAILABLE', 'x') }));
    const { container } = render(<BalanceLedger assetId="2" />);
    await screen.findByText('The balance ledger is not available');
    expect(container.querySelectorAll('[data-movement]')).toHaveLength(0);
  });
});

describe('undecided answers in the strip', () => {
  it('504 OUTCOME_UNKNOWN is an alert that it may have been applied, never safe; 503 CORE_UNAVAILABLE waits', () => {
    const unknown = undecidedResult('Buy 0.25 BTC @ 97,400', { success: false, message: 'x', outcomeUnknown: true })!;
    expect(unknown.kind).toBe('unknown');
    expect(unknown.text).toMatch(/may have been applied: check your orders before trying again/);
    const waiting = undecidedResult('Buy 0.25 BTC @ 97,400', { success: false, message: 'x', coreUnavailable: true })!;
    expect(waiting.kind).toBe('waiting');
    expect(waiting.text).toMatch(/was not sent\. Nothing is lost/);
    expect(undecidedResult('x', { success: false, message: 'rejected' })).toBeNull();
  });
});
