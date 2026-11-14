// SPDX-License-Identifier: Apache-2.0
/**
 * Layout presets. Default is also what Reset returns to and what any
 * unreadable stored layout falls back to (DESIGN.md rule 16).
 *
 * - Default: Markets over Trades | Chart over Open orders.
 * - Scalper: the tape and the orders tall, Markets and Chart short.
 * - Chart-heavy: Default's panels with the chart taking most of its column.
 */
import type { LayoutState } from './layoutReducer';

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
    layout: { slots: ['markets', 'trades', 'chart', 'orders'], split: { left: 0.36, right: 0.58 } },
  },
  scalper: {
    id: 'scalper',
    label: 'Scalper',
    layout: { slots: ['trades', 'markets', 'orders', 'chart'], split: { left: 0.7, right: 0.66 } },
  },
  'chart-heavy': {
    id: 'chart-heavy',
    label: 'Chart-heavy',
    layout: { slots: ['markets', 'trades', 'chart', 'orders'], split: { left: 0.36, right: 0.78 } },
  },
};

/** A fresh copy of the Default layout. */
export function defaultLayout(): LayoutState {
  return presetLayout('default');
}

export function presetLayout(id: PresetId): LayoutState {
  const { layout } = PRESETS[id];
  return { slots: [...layout.slots] as unknown as LayoutState['slots'], split: { ...layout.split } };
}

/** The preset the state matches exactly, if any (the picker marks it). */
export function matchingPreset(state: LayoutState): PresetId | null {
  for (const id of PRESET_IDS) {
    const p = PRESETS[id].layout;
    if (
      p.slots.every((s, i) => s === state.slots[i]) &&
      p.split.left === state.split.left &&
      p.split.right === state.split.right
    ) {
      return id;
    }
  }
  return null;
}
