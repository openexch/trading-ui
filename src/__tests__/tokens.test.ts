// SPDX-License-Identifier: Apache-2.0
// Guards the design tokens in index.css: the hand-mirrored chart palette must
// match them, and the colour pairs DESIGN.md promises stay readable (WCAG AA
// 4.5:1 for text, 3:1 for interactive borders) in both themes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHART_PALETTES, CHART_FONT_FAMILY, type ChartTheme } from '../components/Chart/palette';

type Rgba = [number, number, number, number];

// Read from disk: vitest replaces CSS imports (even ?raw) with an empty module.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = src.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`));
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  const open = src.indexOf('{', start);
  const close = src.indexOf('}', open);
  const vars: Record<string, string> = {};
  for (const m of src.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

const THEMES: Record<ChartTheme, Record<string, string>> = {
  light: block(':root'),
  dark: block('.dark'),
};

function parseColor(value: string): Rgba {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const [r, g, b, a = '1'] = fn[1].split(',').map((s) => s.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`unparseable colour: ${value}`);
}

function token(theme: ChartTheme, name: string): Rgba {
  const value = THEMES[theme][name];
  if (value === undefined) throw new Error(`token ${name} missing in ${theme}`);
  return parseColor(value);
}

/** Composite `fg` (with its own alpha, times `alpha`) over an opaque `bg`. */
function over(fg: Rgba, bg: Rgba, alpha = 1): Rgba {
  const a = fg[3] * alpha;
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes: ChartTheme[] = ['light', 'dark'];
const sides = ['buy', 'sell'] as const;

describe('design tokens', () => {
  it.each(themes)('%s defines every token the UI maps', (theme) => {
    const names = [
      '--bg', '--surface', '--surface-2', '--surface-3', '--hairline', '--hairline-strong',
      '--text', '--text-strong', '--muted', '--faint', '--accent', '--on-accent',
      '--buy', '--sell', '--buy-soft', '--sell-soft',
      '--ctl', '--chip', '--mid', '--buy-faint', '--sell-faint', '--shadow-pop',
    ];
    for (const n of names) expect(THEMES[theme][n], `${n} in ${theme}`).toBeDefined();
  });

  it('maps the new tokens into Tailwind', () => {
    for (const n of ['ctl', 'chip', 'mid', 'buy-faint', 'sell-faint']) {
      expect(css).toContain(`--color-${n}: var(--${n});`);
    }
    expect(css).toContain('--shadow-popover: var(--shadow-pop);');
  });

  it('uses Instrument Sans for interface and numbers, Bricolage Grotesque for display', () => {
    expect(css).toMatch(/--font-sans:\s*"Instrument Sans"/);
    expect(css).toMatch(/--font-mono:\s*"Instrument Sans"/);
    expect(css).toMatch(/--font-display:\s*"Bricolage Grotesque"/);
    expect(CHART_FONT_FAMILY).toMatch(/^'Instrument Sans'/);
  });
});

describe('chart palette mirrors the tokens', () => {
  const rgb = (c: Rgba) => c.slice(0, 3);

  it.each(themes)('%s', (theme) => {
    const p = CHART_PALETTES[theme];
    const exact: [keyof typeof p, string][] = [
      ['background', '--surface'],
      ['textColor', '--muted'],
      ['crosshair', '--muted'],
      ['volMa', '--muted'],
      ['border', '--hairline'],
      ['crosshairLabelBg', '--chip'],
      ['up', '--buy'],
      ['down', '--sell'],
      ['accent', '--accent'],
    ];
    for (const [key, name] of exact) {
      expect(parseColor(p[key]), `${theme}.${key} vs ${name}`).toEqual(token(theme, name));
    }
    // Translucent fills keep the token's hue; only the alpha is chart-specific.
    const hue: [keyof typeof p, string][] = [
      ['upVol', '--buy'],
      ['downVol', '--sell'],
      ['accentArea0', '--accent'],
      ['accentArea1', '--accent'],
    ];
    for (const [key, name] of hue) {
      expect(rgb(parseColor(p[key])), `${theme}.${key} hue vs ${name}`).toEqual(rgb(token(theme, name)));
    }
  });
});

describe('contrast', () => {
  const AA = 4.5;

  it.each(themes)('%s: text and trade colours are AA on every surface', (theme) => {
    for (const surface of ['--surface', '--bg', '--surface-2']) {
      const bg = token(theme, surface);
      for (const fg of ['--text', '--text-strong', '--muted', '--faint', '--buy', '--sell', '--accent']) {
        expect(contrast(token(theme, fg), bg), `${fg} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it.each(themes)('%s: text on a solid accent fill is AA', (theme) => {
    expect(contrast(token(theme, '--on-accent'), token(theme, '--accent'))).toBeGreaterThanOrEqual(AA);
  });

  it.each(themes)('%s: interactive borders reach 3:1 on the surface', (theme) => {
    const surface = token(theme, '--surface');
    expect(contrast(over(token(theme, '--ctl'), surface), surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(themes)('%s: side-coloured text on its faint tint (badges, notices, row tint) is AA', (theme) => {
    const surface = token(theme, '--surface');
    for (const side of sides) {
      const tint = over(token(theme, `--${side}-faint`), surface);
      expect(contrast(token(theme, `--${side}`), tint), side).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(themes)('%s: quantities in --text-strong on a depth bar are AA', (theme) => {
    const surface = token(theme, '--surface');
    const strong = token(theme, '--text-strong');
    for (const side of sides) {
      const bar = over(token(theme, `--${side}-soft`), surface);
      const tintedBar = over(token(theme, `--${side}-soft`), over(token(theme, `--${side}-faint`), surface));
      expect(contrast(strong, bar), `${side} bar`).toBeGreaterThanOrEqual(AA);
      expect(contrast(strong, tintedBar), `${side} bar on own-order row tint`).toBeGreaterThanOrEqual(AA);
    }
  });

  // The own-order slice sits on top of the depth bar, on a row that carries
  // the own-order tint: surface, then -faint, then -soft, then the side colour
  // at --own-slice-alpha. Quantities on it are --text-strong. The design
  // canvas drew the slice at 0.55, which measures about 3.7:1 for dark buys;
  // 0.35 plus a 1px side-coloured outline keeps it AA.
  it.each(themes)('%s: quantities on the own-order slice are AA', (theme) => {
    const alpha = Number(THEMES.light['--own-slice-alpha']);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThanOrEqual(1);
    const surface = token(theme, '--surface');
    const strong = token(theme, '--text-strong');
    for (const side of sides) {
      const row = over(token(theme, `--${side}-faint`), surface);
      const bar = over(token(theme, `--${side}-soft`), row);
      const slice = over(token(theme, `--${side}`), bar, alpha);
      expect(contrast(strong, slice), `${side} slice`).toBeGreaterThanOrEqual(AA);
    }
  });
});
