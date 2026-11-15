// SPDX-License-Identifier: Apache-2.0
/**
 * The panel title as a picker (DESIGN.md: each slot's title is a picker).
 *
 * The menu, "Show in this panel", lists every panel as a radio item with
 * where it lives now (Here, Left top, ..., Far right bottom, Hidden).
 * Picking one that is open elsewhere swaps the two; picking a hidden one
 * replaces this slot's panel, which takes the hidden one's place (in
 * standard mode, the far-right column's slots are the hidden ones).
 * Below them: Layout presets… (opens a second menu at the same place) and
 * Reset layout.
 *
 * Two looks: `title` (the micro-caps title with a chevron) and `icon` (the
 * chevron alone, for a header that carries tabs instead of a title).
 */
import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Menu, MenuGroup, MenuItem, MenuItemRadio, MenuSeparator } from '../../ui';
import { PANELS, PANEL_IDS } from './registry';
import type { PanelId } from './registry';
import { visibleSlots } from './layoutReducer';
import type { LayoutMode, LayoutState, SlotIndex } from './layoutReducer';
import { PRESETS, PRESET_IDS, matchingPreset } from './presets';
import type { PresetId } from './presets';

export const SLOT_NAMES: Readonly<Record<SlotIndex, string>> = {
  0: 'Left top',
  1: 'Left bottom',
  2: 'Right top',
  3: 'Right bottom',
  4: 'Far right top',
  5: 'Far right bottom',
};

/** Where a panel lives, as the picker says it, from one slot's view. A
 *  panel in a slot the mode does not show is Hidden. */
export function whereLabel(layout: LayoutState, here: SlotIndex, panel: PanelId, mode: LayoutMode): string {
  const at = visibleSlots(mode).find(i => layout.slots[i] === panel);
  if (at === here) return 'Here';
  return at === undefined ? 'Hidden' : SLOT_NAMES[at];
}

export interface PanelPickerProps {
  slot: SlotIndex;
  layout: LayoutState;
  mode: LayoutMode;
  onPick: (slot: SlotIndex, panel: PanelId) => void;
  onPreset: (id: PresetId) => void;
  onReset: () => void;
  variant?: 'title' | 'icon';
}

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="flex-none">
    <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export function PanelPicker({ slot, layout, mode, onPick, onPreset, onReset, variant = 'title' }: PanelPickerProps) {
  const [open, setOpen] = useState<'panels' | 'presets' | null>(null);
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(null), []);

  const current = layout.slots[slot];
  const title = PANELS[current].title;
  const preset = matchingPreset(layout, mode);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setInitialFocus(e.key === 'ArrowDown' ? 'first' : 'last');
      setOpen('panels');
    }
  };

  const triggerCls =
    variant === 'title'
      ? 'flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 -ml-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] ' +
        (open ? 'bg-chip text-text-strong' : 'text-muted hover:bg-chip hover:text-text-strong')
      : 'grid h-[22px] w-[22px] flex-none place-items-center rounded-[5px] -ml-1.5 ' +
        (open ? 'bg-chip text-text-strong' : 'text-muted hover:bg-chip hover:text-text-strong');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? menuId : undefined}
        aria-label={`Panel: ${title}. Change`}
        data-panel-picker={current}
        onClick={() => {
          setInitialFocus('first');
          setOpen(o => (o ? null : 'panels'));
        }}
        onKeyDown={onKeyDown}
        className={`${triggerCls} focus-visible:outline-1 focus-visible:outline-accent`}
      >
        {variant === 'title' && <span className="truncate">{title}</span>}
        <Chevron />
      </button>

      <Menu
        id={menuId}
        open={open === 'panels'}
        onClose={close}
        anchor={triggerRef}
        label="Show in this panel"
        initialFocus={initialFocus}
        returnFocusRef={triggerRef}
        ignoreRefs={[triggerRef]}
        className="w-[260px]"
      >
        <MenuGroup label="Show in this panel">
          {PANEL_IDS.map(id => (
            <MenuItemRadio
              key={id}
              checked={id === current}
              hint={whereLabel(layout, slot, id, mode)}
              onSelect={() => onPick(slot, id)}
            >
              {PANELS[id].title}
            </MenuItemRadio>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onSelect={() => setOpen('presets')}>Layout presets…</MenuItem>
        <MenuItem onSelect={onReset}>Reset layout</MenuItem>
      </Menu>

      <Menu
        id={menuId}
        open={open === 'presets'}
        onClose={close}
        anchor={triggerRef}
        label="Layout presets"
        returnFocusRef={triggerRef}
        ignoreRefs={[triggerRef]}
        className="w-[260px]"
      >
        <MenuGroup label="Layout presets">
          {PRESET_IDS.map(id => (
            <MenuItemRadio key={id} checked={preset === id} onSelect={() => onPreset(id)}>
              {PRESETS[id].label}
            </MenuItemRadio>
          ))}
        </MenuGroup>
      </Menu>
    </>
  );
}
