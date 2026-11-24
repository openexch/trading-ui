// SPDX-License-Identifier: Apache-2.0
/**
 * The engine telemetry the screen shows, held outside React so the header,
 * the engines panel, the tape and order entry read one copy and a frame
 * re-renders only what reads it.
 *
 * - `status`: the latest `engine` frame, or null before the first one. The
 *   frame rides the user stream while signed in and the anonymous engine
 *   feed while signed out (useEngineFeed; null while the server does not
 *   offer it). Null prints dashes everywhere.
 * - `live`: the stream feeding the store is open (the user stream, or the
 *   accepted anonymous feed). While it is not, the last frame is stale: the
 *   screen prints dashes instead of old values.
 * - `elections`: the election frames seen this session, newest first (the
 *   tape's election rows).
 * - `electing`: per cluster, the start of an election with no end yet. An
 *   end frame closes it; so does a later engine frame that names a leader
 *   for that cluster (the end frame of a round the stream missed while it
 *   reconnected), since the gateway derives both from the same poll round.
 */
import { useSyncExternalStore } from 'react';
import type { ClusterKey, ElectionEvent, EngineStatus } from './engine';

export const MAX_ELECTIONS = 20;

export interface EngineState {
  status: EngineStatus | null;
  live: boolean;
  elections: readonly ElectionEvent[];
  electing: Readonly<Record<ClusterKey, ElectionEvent | null>>;
}

export const EMPTY_ENGINE: EngineState = {
  status: null,
  live: false,
  elections: [],
  electing: { core: null, matchingEngine: null },
};

export interface EngineStore {
  get: () => EngineState;
  subscribe: (listener: () => void) => () => void;
  engine: (status: EngineStatus) => void;
  election: (event: ElectionEvent) => void;
  setLive: (live: boolean) => void;
  reset: () => void;
}

export function createEngineStore(): EngineStore {
  let state: EngineState = EMPTY_ENGINE;
  const listeners = new Set<() => void>();
  const set = (next: EngineState) => {
    if (next === state) return;
    state = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    engine: status => {
      let electing = state.electing;
      for (const key of ['core', 'matchingEngine'] as const) {
        if (electing[key] && status[key].leaderId !== null) electing = { ...electing, [key]: null };
      }
      set({ ...state, status, electing });
    },
    election: event => {
      const elections = [event, ...state.elections].slice(0, MAX_ELECTIONS);
      const electing = { ...state.electing, [event.cluster]: event.phase === 'start' ? event : null };
      set({ ...state, elections, electing });
    },
    setLive: live => {
      if (live === state.live) return;
      // A stream that went down cannot see an election end: what was open
      // stays open until the next frames say otherwise.
      set({ ...state, live });
    },
    reset: () => set(EMPTY_ENGINE),
  };
}

/** The app's one store (the user stream or the anonymous feed fills it). */
export const engineStore = createEngineStore();

export function useEngine(store: EngineStore = engineStore): EngineState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** The status to print: null while there is none or it is stale. */
export function shownStatus(s: EngineState): EngineStatus | null {
  return s.live ? s.status : null;
}

/** An election is open on either cluster. */
export function electingClusters(s: EngineState): ClusterKey[] {
  return (['core', 'matchingEngine'] as const).filter(k => s.electing[k] !== null);
}

/** The waiting line order entry shows during an election, or null. */
export function engineWaitText(s: EngineState): string | null {
  if (s.electing.core) return 'Core is electing a leader: order entry is waiting. Nothing is lost';
  if (s.electing.matchingEngine) {
    return 'Matching engine is electing a leader: accepted orders wait in the core. Nothing is lost';
  }
  return null;
}

/** engineWaitText as a hook that re-renders only when the text changes (an
 *  engine frame every second must not re-render the shell around it). */
export function useEngineWait(store: EngineStore = engineStore): string | null {
  const get = () => engineWaitText(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}

/** The session's election rows, re-rendering only when one arrives. */
export function useElections(store: EngineStore = engineStore): readonly ElectionEvent[] {
  const get = () => store.get().elections;
  return useSyncExternalStore(store.subscribe, get, get);
}
