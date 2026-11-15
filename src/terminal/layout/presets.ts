// SPDX-License-Identifier: Apache-2.0
/**
 * Layout presets, in their six-slot form. Default is also what Reset
 * returns to and what any unreadable stored layout falls back to (DESIGN.md
 * rule 16).
 *
 * Standard mode shows slots 0 to 3 and the left and right splits, so each
 * preset's first four slots and those two splits are exactly the four-slot
 * preset from before wide mode. The far-right column (slots 4 and 5, shown
 * only in wide mode) holds the two panels the standard view hides.
 *
 * - Default: Markets over Trades | Chart over Open orders | Fills over
 *   Balances.
 * - Scalper: the tape and the orders tall, Markets and Chart short; Fills
 *   tall over Balances.
 * - Chart-heavy: Default's panels with the chart taking most of its column.
 */
import { copyLayout, visibleColumns, visibleSlots } from './layoutReducer';
import type { LayoutMode, LayoutState } from './layoutReducer';

export const PRESET_IDS = ['default', 'scalper', 'chart-heavy'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface Preset {
  id: PresetId;
  label: string;
  layout: LayoutState;
}

export const PRESETS: Readonly<Record<PresetId, Preset>> = {
  default: {
    id: 'default',
    label: 'Default',
    layout: {
      slots: ['markets', 'trades', 'chart', 'orders', 'fills', 'balances'],
      split: { left: 0.36, right: 0.58, farRight: 0.6 },
    },
  },
  scalper: {
    id: 'scalper',
    label: 'Scalper',
    layout: {
      slots: ['trades', 'markets', 'orders', 'chart', 'fills', 'balances'],
      split: { left: 0.7, right: 0.66, farRight: 0.7 },
    },
  },
  'chart-heavy': {
    id: 'chart-heavy',
    label: 'Chart-heavy',
    layout: {
      slots: ['markets', 'trades', 'chart', 'orders', 'fills', 'balances'],
      split: { left: 0.36, right: 0.78, farRight: 0.6 },
    },
  },
};

/** A fresh copy of the Default layout. */
export function defaultLayout(): LayoutState {
  return presetLayout('default');
}

export function presetLayout(id: PresetId): LayoutState {
  return copyLayout(PRESETS[id].layout);
}

/** The preset whose visible part the state matches exactly, if any (the
 *  picker marks it). Only what the mode shows counts: in standard mode the
 *  hidden far-right column does not unmark a preset. */
export function matchingPreset(state: LayoutState, mode: LayoutMode = 'wide'): PresetId | null {
  const slots = visibleSlots(mode);
  const columns = visibleColumns(mode);
  for (const id of PRESET_IDS) {
    const p = PRESETS[id].layout;
    if (slots.every(i => p.slots[i] === state.slots[i]) && columns.every(c => p.split[c] === state.split[c])) {
      return id;
    }
  }
  return null;
}
