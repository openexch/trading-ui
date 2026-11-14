// SPDX-License-Identifier: Apache-2.0
/**
 * The panels a side slot can show. Data only: the title the picker and the
 * slot header print, and the smallest height (px, header included) the
 * panel stays usable at. Rendering lives with the panels themselves, so this
 * file has no component imports and the layout logic stays pure.
 */

export const PANEL_IDS = ['markets', 'trades', 'chart', 'orders', 'fills', 'balances'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelDef {
  id: PanelId;
  title: string;
  /** Smallest usable height in px, header included. */
  minHeight: number;
}

export const PANELS: Readonly<Record<PanelId, PanelDef>> = {
  markets: { id: 'markets', title: 'Markets', minHeight: 140 },
  trades: { id: 'trades', title: 'Trades', minHeight: 140 },
  chart: { id: 'chart', title: 'Chart', minHeight: 220 },
  orders: { id: 'orders', title: 'Open orders', minHeight: 160 },
  fills: { id: 'fills', title: 'Fills', minHeight: 140 },
  balances: { id: 'balances', title: 'Balances', minHeight: 120 },
};

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value);
}
