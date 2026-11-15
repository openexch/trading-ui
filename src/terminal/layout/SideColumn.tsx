// SPDX-License-Identifier: Apache-2.0
/**
 * One side column: two slots and the height handle between them. The left
 * and right columns always render; the far-right one only in wide mode
 * (TerminalDesktop), so a hidden column's panels never mount.
 *
 * The column height comes from a ResizeObserver on the rendered element,
 * held in state (not a ref) so the effect cleanup disconnects the observer
 * it created. Until the first measurement the slots split by the stored
 * ratio in percent; after it, by clamped pixels (split.ts). Nothing but the
 * handle, a preset or Reset changes the stored ratio (DESIGN.md rule 15).
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { COLUMN_SLOTS } from './layoutReducer';
import type { Column, SlotIndex } from './layoutReducer';
import type { LayoutApi } from './useLayout';
import { PANELS } from './registry';
import type { PanelId } from './registry';
import { PanelPicker } from './PanelPicker';
import { SplitHandle } from './SplitHandle';
import { topForRatio } from './split';

/** What a slot hands its panel: the picker, ready to place in the header. */
export interface SlotChrome {
  slot: SlotIndex;
  position: 'top' | 'bottom';
  picker: (variant?: 'title' | 'icon') => ReactNode;
}

export interface SideColumnProps {
  column: Column;
  api: LayoutApi;
  renderPanel: (panel: PanelId, chrome: SlotChrome) => ReactNode;
}

/** The 1px hairline between the two slots. */
const GAP = 1;

export function SideColumn({ column, api, renderPanel }: SideColumnProps) {
  const { layout } = api;
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height ?? 0;
      setHeight(Math.round(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const [topSlot, bottomSlot] = COLUMN_SLOTS[column];
  const topPanel = layout.slots[topSlot];
  const bottomPanel = layout.slots[bottomSlot];
  const ratio = layout.split[column];
  const bounds = {
    total: Math.max(0, height - GAP),
    minTop: PANELS[topPanel].minHeight,
    minBottom: PANELS[bottomPanel].minHeight,
  };
  const measured = bounds.total > 0;
  const top = measured ? topForRatio(ratio, bounds) : 0;

  const chrome = (slot: SlotIndex, position: 'top' | 'bottom'): SlotChrome => ({
    slot,
    position,
    picker: (variant = 'title') => (
      <PanelPicker
        slot={slot}
        layout={layout}
        mode={api.mode}
        onPick={api.pick}
        onPreset={api.applyPreset}
        onReset={api.reset}
        variant={variant}
      />
    ),
  });

  const side = column === 'left' ? 'Left' : column === 'right' ? 'Right' : 'Far right';
  return (
    <aside
      ref={setEl}
      aria-label={`${side} panels`}
      data-side-column={column}
      className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden bg-hairline"
    >
      <div
        data-slot={topSlot}
        className="flex min-h-0 min-w-0 flex-none flex-col overflow-hidden bg-surface"
        style={measured ? { height: top } : { flexBasis: `${ratio * 100}%` }}
      >
        {renderPanel(topPanel, chrome(topSlot, 'top'))}
      </div>
      <div aria-hidden className="h-px flex-none" />
      <SplitHandle
        label={`Resize ${side.toLowerCase()} panels`}
        top={top}
        bounds={bounds}
        topTitle={PANELS[topPanel].title}
        bottomTitle={PANELS[bottomPanel].title}
        onChange={next => {
          if (bounds.total > 0) api.setSplit(column, next / bounds.total);
        }}
      />
      <div data-slot={bottomSlot} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        {renderPanel(bottomPanel, chrome(bottomSlot, 'bottom'))}
      </div>
    </aside>
  );
}
