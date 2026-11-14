// SPDX-License-Identifier: Apache-2.0
/**
 * Layout persistence (DESIGN.md rule 16): one versioned key, validated on
 * read. Anything unknown, duplicated, out of range or corrupt falls back to
 * Default; storage failures never throw (safeStorage).
 */
import { safeStorage } from '../../ui/safeStorage';
import { isRatio, slotsValid } from './layoutReducer';
import type { LayoutState } from './layoutReducer';
import { defaultLayout } from './presets';

export const LAYOUT_KEY = 'oe.tui.layout.v1';
export const LAYOUT_VERSION = 1;

interface StoredLayout {
  v: typeof LAYOUT_VERSION;
  slots: LayoutState['slots'];
  split: LayoutState['split'];
}

export function isStoredLayout(value: unknown): value is StoredLayout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== LAYOUT_VERSION) return false;
  if (!Array.isArray(v.slots) || !slotsValid(v.slots)) return false;
  const split = v.split;
  if (typeof split !== 'object' || split === null) return false;
  const s = split as Record<string, unknown>;
  return isRatio(s.left) && isRatio(s.right);
}

/** The stored layout, or Default when there is none or it does not validate. */
export function loadLayout(): LayoutState {
  const fallback = defaultLayout();
  try {
    const stored = safeStorage.getJSON<StoredLayout | null>(LAYOUT_KEY, isStoredLayout, null);
    if (!stored) return fallback;
    return { slots: [...stored.slots] as unknown as LayoutState['slots'], split: { left: stored.split.left, right: stored.split.right } };
  } catch {
    return fallback;
  }
}

/** Remember the layout. Returns false when it could not be stored. */
export function saveLayout(state: LayoutState): boolean {
  try {
    const stored: StoredLayout = { v: LAYOUT_VERSION, slots: state.slots, split: state.split };
    return safeStorage.setJSON(LAYOUT_KEY, stored);
  } catch {
    return false;
  }
}

/** Parse a raw stored value (another tab's write); null when invalid. */
export function parseLayout(raw: string | null): LayoutState | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredLayout(parsed)) return null;
    return { slots: [...parsed.slots] as unknown as LayoutState['slots'], split: { ...parsed.split } };
  } catch {
    return null;
  }
}
