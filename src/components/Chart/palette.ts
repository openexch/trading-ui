// SPDX-License-Identifier: Apache-2.0
// lightweight-charts renders to canvas and cannot read CSS variables, so the
// chart's colours live here as JS values mirroring the tokens in index.css.
// src/__tests__/tokens.test.ts fails when this mirror drifts from the tokens.

export type ChartTheme = 'light' | 'dark';

export interface ChartPalette {
  background: string;
  textColor: string;
  gridLine: string;
  border: string;
  crosshair: string;
  crosshairLabelBg: string;
  up: string;
  down: string;
  upVol: string;
  downVol: string;
  volMa: string;
  accent: string;
  accentArea0: string;
  accentArea1: string;
}

export const CHART_PALETTES: Record<ChartTheme, ChartPalette> = {
  dark: {
    background: '#10161f', // --surface
    textColor: '#8a96aa', // --muted
    gridLine: 'rgba(140,170,255,0.05)',
    border: 'rgba(140,170,255,0.09)', // --hairline
    crosshair: '#8a96aa', // --muted
    crosshairLabelBg: '#1b2533', // --chip
    up: '#2fc489', // --buy
    down: '#f4675d', // --sell
    upVol: 'rgba(47,196,137,0.25)',
    downVol: 'rgba(244,103,93,0.25)',
    volMa: '#8a96aa', // --muted
    accent: '#5b8cff', // --accent
    accentArea0: 'rgba(91,140,255,0.30)',
    accentArea1: 'rgba(91,140,255,0.02)',
  },
  light: {
    background: '#fbfaf6', // --surface
    textColor: '#5d6577', // --muted
    gridLine: 'rgba(74,62,36,0.07)',
    border: '#e6e1d3', // --hairline
    crosshair: '#5d6577', // --muted
    crosshairLabelBg: '#ebe7dc', // --chip
    up: '#17774f', // --buy
    down: '#b03a26', // --sell
    upVol: 'rgba(23,119,79,0.20)',
    downVol: 'rgba(176,58,38,0.20)',
    volMa: '#5d6577', // --muted
    accent: '#1d3f9e', // --accent
    accentArea0: 'rgba(29,63,158,0.28)',
    accentArea1: 'rgba(29,63,158,0.02)',
  },
};

// Canvas text cannot use CSS variables either; this mirrors --font-sans.
export const CHART_FONT_FAMILY = "'Instrument Sans', ui-sans-serif, system-ui, sans-serif";
