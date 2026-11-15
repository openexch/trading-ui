// SPDX-License-Identifier: Apache-2.0
/**
 * Standard or wide (layoutColumns): the same breakpoint the CSS grid uses,
 * read through matchMedia so the slots rendered and the grid's columns
 * always agree. Where matchMedia is missing (tests, old engines) the mode
 * is standard.
 */
import { useSyncExternalStore } from 'react';
import { WIDE_QUERY } from '../layoutColumns';
import type { LayoutMode } from '../layoutColumns';

function query(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const mql = query();
  if (!mql || typeof mql.addEventListener !== 'function') return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function snapshot(): LayoutMode {
  return query()?.matches ? 'wide' : 'standard';
}

const serverSnapshot = (): LayoutMode => 'standard';

export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
