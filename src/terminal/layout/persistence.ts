// SPDX-License-Identifier: Apache-2.0
/**
 * Layout persistence (DESIGN.md rule 16): one versioned key, validated on
 * read. Anything unknown, duplicated, out of range or corrupt falls back to
 * Default; storage failures never throw (safeStorage).
 *
 * Version 2 stores six slots and three splits (layoutReducer). A version 1
 * layout (four slots, two splits, under its own key) is read only when no
 * version 2 layout is stored, and migrated: its four slots keep their
 * places, the two panels it hid fill the far-right column in registry
 * order, and the far-right split is Default's (or, when the old layout was
 * a preset, that preset's, so it stays marked in wide mode too). The
 * version 1 key is left as it is (a tab still running the old code keeps
 * working on it).
 */
import { safeStorage } from '../../ui/safeStorage';
import { copyLayout, slotsValid, splitValid, isRatio } from './layoutReducer';
import type { LayoutState, Slots } from './layoutReducer';
import { PANEL_IDS, isPanelId } from './registry';
import type { PanelId } from './registry';
import { defaultLayout, matchingPreset, presetLayout } from './presets';

export const LAYOUT_KEY = 'oe.tui.layout.v2';
export const LAYOUT_VERSION = 2;
/** The version 1 key, read once for migration. */
export const LAYOUT_KEY_V1 = 'oe.tui.layout.v1';

interface StoredLayout {
  v: typeof LAYOUT_VERSION;
  slots: LayoutState['slots'];
  split: LayoutState['split'];
}

interface StoredLayoutV1 {
  v: 1;
  slots: readonly [PanelId, PanelId, PanelId, PanelId];
  split: { left: number; right: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStoredLayout(value: unknown): value is StoredLayout {
  if (!isRecord(value)) return false;
  if (value.v !== LAYOUT_VERSION) return false;
  if (!Array.isArray(value.slots) || !slotsValid(value.slots)) return false;
  return splitValid(value.split);
}

export function isStoredLayoutV1(value: unknown): value is StoredLayoutV1 {
  if (!isRecord(value)) return false;
  if (value.v !== 1) return false;
  const slots = value.slots;
  if (!Array.isArray(slots) || slots.length !== 4 || !slots.every(isPanelId) || new Set(slots).size !== 4) return false;
  if (!isRecord(value.split)) return false;
  return isRatio(value.split.left) && isRatio(value.split.right);
}

/** A version 1 layout in six-slot form (see the header). */
export function migrateV1(v1: StoredLayoutV1): LayoutState {
  const hidden = PANEL_IDS.filter(id => !v1.slots.includes(id));
  const slots = [...v1.slots, ...hidden];
  const fallback = defaultLayout();
  if (!slotsValid(slots)) return fallback;
  const migrated = copyLayout({
    slots: slots as unknown as Slots,
    split: { left: v1.split.left, right: v1.split.right, farRight: fallback.split.farRight },
  });
  const preset = matchingPreset(migrated, 'standard');
  return preset ? presetLayout(preset) : migrated;
}

/** The stored layout, a migrated version 1 layout when only that is
 *  stored, or Default when neither is there or validates. */
export function loadLayout(): LayoutState {
  const fallback = defaultLayout();
  try {
    if (safeStorage.get(LAYOUT_KEY) !== null) {
      const stored = safeStorage.getJSON<StoredLayout | null>(LAYOUT_KEY, isStoredLayout, null);
      return stored ? copyLayout(stored) : fallback;
    }
    const v1 = safeStorage.getJSON<StoredLayoutV1 | null>(LAYOUT_KEY_V1, isStoredLayoutV1, null);
    return v1 ? migrateV1(v1) : fallback;
  } catch {
    return fallback;
  }
}

/** Remember the layout. Returns false when it could not be stored. */
export function saveLayout(state: LayoutState): boolean {
  try {
    const { slots, split } = copyLayout(state);
    const stored: StoredLayout = { v: LAYOUT_VERSION, slots, split };
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
    return copyLayout(parsed);
  } catch {
    return null;
  }
}
