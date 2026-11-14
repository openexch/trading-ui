// SPDX-License-Identifier: Apache-2.0
/**
 * The side-slot layout as React state: read once from storage (validated),
 * written back on every change, and kept in step with other tabs through
 * the `storage` event. Writing never throws (persistence.ts).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { layoutReducer } from './layoutReducer';
import type { Column, LayoutState, SlotIndex } from './layoutReducer';
import { LAYOUT_KEY, loadLayout, parseLayout, saveLayout } from './persistence';
import { defaultLayout, presetLayout } from './presets';
import type { PresetId } from './presets';
import type { PanelId } from './registry';

export interface LayoutApi {
  layout: LayoutState;
  pick: (slot: SlotIndex, panel: PanelId) => void;
  setSplit: (column: Column, ratio: number) => void;
  applyPreset: (id: PresetId) => void;
  reset: () => void;
}

export function useLayout(): LayoutApi {
  const [layout, dispatch] = useReducer(layoutReducer, undefined, loadLayout);

  // Skip the first write: the state came from storage (or is Default).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveLayout(layout);
  }, [layout]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LAYOUT_KEY) return;
      const next = parseLayout(e.newValue);
      if (next) dispatch({ type: 'apply', layout: next });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const pick = useCallback((slot: SlotIndex, panel: PanelId) => dispatch({ type: 'pick', slot, panel }), []);
  const setSplit = useCallback((column: Column, ratio: number) => dispatch({ type: 'split', column, ratio }), []);
  const applyPreset = useCallback((id: PresetId) => dispatch({ type: 'apply', layout: presetLayout(id) }), []);
  const reset = useCallback(() => dispatch({ type: 'apply', layout: defaultLayout() }), []);

  return { layout, pick, setSplit, applyPreset, reset };
}
