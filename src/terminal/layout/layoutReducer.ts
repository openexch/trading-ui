// SPDX-License-Identifier: Apache-2.0
/**
 * Side-slot layout state (DESIGN.md: side slots, rules 15 and 16).
 *
 * - Six slots, always all stored: 0 and 1 are the left column (top,
 *   bottom), 2 and 3 the right column, 4 and 5 the far-right column. Every
 *   panel sits in exactly one slot, so the slots are a permutation of the
 *   six panels.
 * - The mode decides which slots show (`visibleSlots`): wide mode shows all
 *   six; standard mode shows 0 to 3 (left and right columns) and the
 *   far-right column's two panels are hidden, keeping their places. Crossing
 *   the breakpoint in either direction changes nothing stored, so a wide
 *   layout comes back exactly when the window widens again.
 * - `split` is each column's top-slot share of the column height (0..1).
 *   The rendered heights are clamped to the panels' minimum heights at
 *   render time; the stored ratio is what the user chose.
 * - Picking a panel swaps it with the slot's current panel, wherever it is:
 *   open in another visible slot (the two swap places) or in a hidden slot
 *   (the current panel takes its hidden place, so in standard mode it
 *   "becomes hidden"). The reducer needs no mode for this.
 * - Invariant: every panel appears exactly once and no slot is ever empty.
 *   Any action that would break it leaves the state unchanged.
 * - Sizes change only through the handle (`split`), a preset or Reset.
 */
import type { LayoutMode } from '../layoutColumns';
import { isPanelId } from './registry';
import type { PanelId } from './registry';

export type { LayoutMode };
export type Slots = readonly [PanelId, PanelId, PanelId, PanelId, PanelId, PanelId];
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type Column = 'left' | 'right' | 'farRight';

export interface LayoutState {
  slots: Slots;
  split: Record<Column, number>;
}

/** A split ratio is kept inside these bounds whatever the column height. */
export const SPLIT_MIN = 0.05;
export const SPLIT_MAX = 0.95;

export const SLOT_COUNT = 6;
export const COLUMNS: readonly Column[] = ['left', 'right', 'farRight'];
export const COLUMN_SLOTS: Readonly<Record<Column, readonly [SlotIndex, SlotIndex]>> = {
  left: [0, 1],
  right: [2, 3],
  farRight: [4, 5],
};

const VISIBLE: Readonly<Record<LayoutMode, readonly SlotIndex[]>> = {
  standard: [0, 1, 2, 3],
  wide: [0, 1, 2, 3, 4, 5],
};
const VISIBLE_COLUMNS: Readonly<Record<LayoutMode, readonly Column[]>> = {
  standard: ['left', 'right'],
  wide: ['left', 'right', 'farRight'],
};

/** The slots a mode renders, in order. */
export function visibleSlots(mode: LayoutMode): readonly SlotIndex[] {
  return VISIBLE[mode];
}

/** The columns a mode renders, left to right after the ladder's left one. */
export function visibleColumns(mode: LayoutMode): readonly Column[] {
  return VISIBLE_COLUMNS[mode];
}

export function isSlotIndex(value: unknown): value is SlotIndex {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < SLOT_COUNT;
}

export function columnOf(slot: SlotIndex): Column {
  return slot < 2 ? 'left' : slot < 4 ? 'right' : 'farRight';
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

/** A split with a valid ratio for every column. */
export function splitValid(split: unknown): split is LayoutState['split'] {
  if (typeof split !== 'object' || split === null || Array.isArray(split)) return false;
  const s = split as Record<string, unknown>;
  return COLUMNS.every(c => isRatio(s[c]));
}

/** The panels a mode does not show, in slot order. */
export function hiddenPanels(slots: Slots, mode: LayoutMode): PanelId[] {
  const shown = visibleSlots(mode);
  return slots.filter((_, i) => !shown.includes(i as SlotIndex));
}

/** A copy with exactly the known fields (nothing extra survives). */
export function copyLayout(layout: LayoutState): LayoutState {
  return {
    slots: [...layout.slots] as unknown as Slots,
    split: { left: layout.split.left, right: layout.split.right, farRight: layout.split.farRight },
  };
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'pick': {
      const { slot, panel } = action;
      if (!isPanelId(panel) || !isSlotIndex(slot)) return state;
      const current = state.slots[slot];
      if (current === panel) return state;
      const next = [...state.slots] as PanelId[];
      const elsewhere = next.indexOf(panel);
      if (elsewhere < 0) return state;
      // The two swap places (a hidden slot included).
      next[elsewhere] = current;
      next[slot] = panel;
      return slotsValid(next) ? { ...state, slots: next as unknown as Slots } : state;
    }
    case 'split': {
      if (!Number.isFinite(action.ratio) || !COLUMNS.includes(action.column)) return state;
      const ratio = clampRatio(action.ratio);
      if (state.split[action.column] === ratio) return state;
      return { ...state, split: { ...state.split, [action.column]: ratio } };
    }
    case 'apply': {
      const { layout } = action;
      if (!layout || !Array.isArray(layout.slots) || !slotsValid(layout.slots) || !splitValid(layout.split)) return state;
      return copyLayout(layout);
    }
  }
}
