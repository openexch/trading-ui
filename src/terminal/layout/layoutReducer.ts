// SPDX-License-Identifier: Apache-2.0
/**
 * Side-slot layout state (DESIGN.md: four side slots, rules 15 and 16).
 *
 * - Four slots: 0 and 1 are the left column (top, bottom), 2 and 3 the
 *   right column.
 * - `split` is each column's top-slot share of the column height (0..1).
 *   The rendered heights are clamped to the panels' minimum heights at
 *   render time; the stored ratio is what the user chose.
 * - Picking a panel that is open in another slot swaps the two. Picking a
 *   hidden panel replaces the current one, which becomes hidden.
 * - Invariant: every panel appears at most once and no slot is ever empty.
 *   Any action that would break it leaves the state unchanged.
 * - Sizes change only through the handle (`split`), a preset or Reset.
 */
import { PANEL_IDS, isPanelId } from './registry';
import type { PanelId } from './registry';

export type Slots = readonly [PanelId, PanelId, PanelId, PanelId];
export type SlotIndex = 0 | 1 | 2 | 3;
export type Column = 'left' | 'right';

export interface LayoutState {
  slots: Slots;
  split: { left: number; right: number };
}

/** A split ratio is kept inside these bounds whatever the column height. */
export const SPLIT_MIN = 0.05;
export const SPLIT_MAX = 0.95;

export const SLOT_COUNT = 4;
export const COLUMN_SLOTS: Readonly<Record<Column, readonly [SlotIndex, SlotIndex]>> = {
  left: [0, 1],
  right: [2, 3],
};

export function columnOf(slot: SlotIndex): Column {
  return slot < 2 ? 'left' : 'right';
}

export type LayoutAction =
  | { type: 'pick'; slot: SlotIndex; panel: PanelId }
  | { type: 'split'; column: Column; ratio: number }
  | { type: 'apply'; layout: LayoutState };

export function clampRatio(ratio: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

/** Every slot holds a known panel and no panel appears twice. */
export function slotsValid(slots: readonly unknown[]): slots is Slots {
  if (slots.length !== SLOT_COUNT) return false;
  if (!slots.every(isPanelId)) return false;
  return new Set(slots).size === SLOT_COUNT;
}

export function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SPLIT_MIN && value <= SPLIT_MAX;
}

/** The panels in no slot, in registry order. */
export function hiddenPanels(slots: Slots): PanelId[] {
  return PANEL_IDS.filter(id => !slots.includes(id));
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'pick': {
      const { slot, panel } = action;
      if (!isPanelId(panel) || slot < 0 || slot >= SLOT_COUNT) return state;
      const current = state.slots[slot];
      if (current === panel) return state;
      const next = [...state.slots] as PanelId[];
      const elsewhere = next.indexOf(panel);
      if (elsewhere >= 0) {
        // Open in another slot: the two swap places.
        next[elsewhere] = current;
      }
      next[slot] = panel;
      return slotsValid(next) ? { ...state, slots: next as unknown as Slots } : state;
    }
    case 'split': {
      if (!Number.isFinite(action.ratio)) return state;
      const ratio = clampRatio(action.ratio);
      if (state.split[action.column] === ratio) return state;
      return { ...state, split: { ...state.split, [action.column]: ratio } };
    }
    case 'apply': {
      const { layout } = action;
      if (!slotsValid(layout.slots) || !isRatio(layout.split.left) || !isRatio(layout.split.right)) return state;
      return { slots: [...layout.slots] as unknown as Slots, split: { ...layout.split } };
    }
  }
}
