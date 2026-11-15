// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ClusterEventMessage, ClusterNode, ClusterState } from '../types/market';
import { EngineRail, formatSince, railModel } from './EngineRail';

afterEach(() => cleanup());

const NOW = 1_800_000_000_000;

function cluster(patch: Partial<ClusterState> = {}): ClusterState {
  const nodes: ClusterNode[] = [
    { id: 0, status: 'LEADER', healthy: true },
    { id: 1, status: 'FOLLOWER', healthy: true },
    { id: 2, status: 'FOLLOWER', healthy: true },
  ];
  return {
    leaderId: 0,
    leadershipTermId: 12,
    nodes,
    gatewayConnected: true,
    isRollingUpdate: false,
    isElecting: false,
    lastEvent: null,
    lastUpdate: NOW - 1000,
    ...patch,
  };
}

/** The hook's initial state: placeholder nodes, never data. */
const INITIAL: ClusterState = cluster({
  leaderId: -1,
  leadershipTermId: -1,
  nodes: [0, 1, 2].map(id => ({ id, status: 'OFFLINE' as const, healthy: false })),
  gatewayConnected: false,
  lastUpdate: 0,
});

function rail(state: ClusterState | undefined, status: Parameters<typeof EngineRail>[0]['status'] = 'connected') {
  const { container } = render(<EngineRail clusterState={state} status={status} />);
  return container.querySelector<HTMLElement>('[data-engine-rail]')!;
}

const text = (el: HTMLElement, sel: string) => el.querySelector(sel)!.textContent;
const health = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-rail-node]')).map(n => n.dataset.health);

describe('EngineRail', () => {
  it('names the matching engine cluster and is not a live region', () => {
    const el = rail(cluster());
    expect(screen.getByRole('group', { name: 'Matching engine cluster' })).toBe(el);
    expect(el.getAttribute('aria-live')).toBeNull();
    expect(el.querySelector('[aria-live]')).toBeNull();
    expect(el.getAttribute('aria-description')).toMatch(/as the market gateway reports them/);
  });

  it('no status yet: invisible placeholder, none of the hook placeholder nodes shown as data', () => {
    const el = rail(INITIAL);
    expect(el.dataset.ready).toBe('false');
    expect(el.className).toContain('invisible');
    expect(health(el)).toEqual([]);
    expect(text(el, '[data-rail-leader]')).toBe('–');
    expect(text(el, '[data-rail-term]')).toBe('–');
    cleanup();
    expect(rail(undefined).dataset.ready).toBe('false');
  });

  it('steady: leader, term and every node up, no state', () => {
    const el = rail(cluster());
    expect(el.dataset.ready).toBe('true');
    expect(el.className).not.toContain('invisible');
    expect(text(el, '[data-rail-leader]')).toBe('0');
    expect(text(el, '[data-rail-term]')).toBe('12');
    expect(health(el)).toEqual(['up', 'up', 'up']);
    expect(text(el, '[data-rail-state]')).toBe('');
    expect(el.title).toBe('');
  });

  it('electing: the state slot says so; no leader prints a dash', () => {
    const el = rail(
      cluster({
        leaderId: -1,
        isElecting: true,
        nodes: [
          { id: 0, status: 'CANDIDATE', healthy: true },
          { id: 1, status: 'ELECTION', healthy: true },
          { id: 2, status: 'FOLLOWER', healthy: true },
        ],
      }),
      'cluster-electing',
    );
    expect(text(el, '[data-rail-state]')).toBe('Electing');
    expect(text(el, '[data-rail-leader]')).toBe('–');
    expect(health(el)).toEqual(['transition', 'transition', 'up']);
  });

  it('rolling update: the state slot says so', () => {
    const el = rail(cluster({ isRollingUpdate: true }), 'cluster-updating');
    expect(text(el, '[data-rail-state]')).toBe('Updating');
    expect(text(el, '[data-rail-leader]')).toBe('0');
  });

  it('node down: a distinct shape and words, not colour alone', () => {
    const el = rail(
      cluster({
        nodes: [
          { id: 0, status: 'LEADER', healthy: true },
          { id: 1, status: 'OFFLINE', healthy: false },
          { id: 2, status: 'FOLLOWER', healthy: true },
        ],
      }),
    );
    expect(health(el)).toEqual(['up', 'down', 'up']);
    const down = el.querySelector<HTMLElement>('[data-rail-node="1"]')!;
    expect(down.title).toBe('Node 1 offline');
    expect(within(down).getByText('node 1 offline')).toBeTruthy();
    // The down shape carries a bar the up shape does not.
    expect(down.querySelector('path')).not.toBeNull();
    expect(el.querySelector('[data-rail-node="0"] path')).toBeNull();
  });

  it('a lost cluster link or a down feed makes the last values stale: dashes and unknown nodes', () => {
    let el = rail(cluster({ gatewayConnected: false }));
    expect(text(el, '[data-rail-state]')).toBe('No link');
    expect(text(el, '[data-rail-leader]')).toBe('–');
    expect(text(el, '[data-rail-term]')).toBe('–');
    expect(health(el)).toEqual(['unknown', 'unknown', 'unknown']);
    cleanup();
    el = rail(cluster(), 'disconnected');
    expect(text(el, '[data-rail-leader]')).toBe('–');
    expect(text(el, '[data-rail-state]')).toBe('');
    expect(health(el)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('every value sits in a fixed-width slot', () => {
    const el = rail(cluster());
    expect(el.querySelector('[data-rail-leader]')!.className).toMatch(/w-\[2ch\]/);
    expect(el.querySelector('[data-rail-term]')!.className).toMatch(/min-w-\[4ch\]/);
    expect(el.querySelector('[data-rail-state]')!.className).toMatch(/w-\[\d+px\]/);
  });
});

describe('railModel: time since the last cluster event', () => {
  const ev = (ago: number): ClusterEventMessage => ({
    type: 'CLUSTER_EVENT',
    event: 'LEADER_CHANGE',
    newLeaderId: 0,
    message: 'Leader changed from Node 1 to Node 0',
    timestamp: NOW - ago,
  });

  it('ages the last event coarsely and keeps its message for the title', () => {
    const m = railModel(cluster({ lastEvent: ev(4 * 60_000) }), 'connected', NOW);
    expect(m.sinceEvent).toBe('4m ago');
    expect(m.eventMessage).toBe('Leader changed from Node 1 to Node 0');
    const el = rail(cluster({ lastEvent: ev(0) }));
    expect(el.title).toMatch(/^Last cluster event: Leader changed from Node 1 to Node 0, /);
  });

  it('formats the age without showing clock skew', () => {
    expect(formatSince(-5000)).toBe('<1m ago');
    expect(formatSince(59_000)).toBe('<1m ago');
    expect(formatSince(61_000)).toBe('1m ago');
    expect(formatSince(3 * 3_600_000)).toBe('3h ago');
    expect(formatSince(3 * 86_400_000)).toBe('3d ago');
  });
});
