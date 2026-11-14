// SPDX-License-Identifier: Apache-2.0
/**
 * The ladder keymap (DESIGN.md rule 11): which key does what, and the groups
 * the shortcut sheet shows. One table, so the sheet never drifts from the
 * keys that work.
 *
 * - Global keys, outside text fields and open menus or dialogs: L focuses
 *   the ladder, ? opens the shortcut sheet.
 * - Every other key works only while the ladder grid has focus, never inside
 *   an input, a select or an open menu.
 * - Tab keeps its normal meaning: own orders cycle with [ and ].
 */

export type LadderKeySide = 'BID' | 'ASK';

export type LadderCommand =
  /** Move the focused rung up (+) or down (-) by this many rungs. */
  | { kind: 'move'; rungs: number }
  /** Back to the last price. */
  | { kind: 'recentre' }
  /** Stage at the focused rung's price. */
  | { kind: 'stage'; side: LadderKeySide }
  /** Stage a market order (always two Enters). */
  | { kind: 'stageMarket'; side: LadderKeySide }
  /** Size preset, 0-based. */
  | { kind: 'preset'; index: number }
  | { kind: 'sizeStep'; dir: 1 | -1 }
  | { kind: 'nextType' }
  | { kind: 'nextTif' }
  | { kind: 'toggleOneClick' }
  /** Previous (-1) or next (+1) own order, in ladder order. */
  | { kind: 'ownOrder'; dir: 1 | -1 }
  | { kind: 'cancelOwn' }
  /** Move the focused own order one rung up (+1) or down (-1). */
  | { kind: 'moveOwn'; dir: 1 | -1 }
  | { kind: 'cancelAll' };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The ladder command for a key press on the focused grid, or null. */
export function ladderCommand(e: KeyLike): LadderCommand | null {
  const { key, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = e;
  if (meta) return null;
  const k = key.length === 1 ? key.toLowerCase() : key;

  if (ctrl) {
    if (alt) return null;
    if (shift && k === 'x') return { kind: 'cancelAll' };
    if (!shift && k === 'o') return { kind: 'toggleOneClick' };
    return null;
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const dir = key === 'ArrowUp' ? 1 : -1;
    if (alt) return shift ? null : { kind: 'moveOwn', dir };
    return { kind: 'move', rungs: dir * (shift ? 10 : 1) };
  }
  if (alt) return null;

  if (key === 'Delete' || key === 'Backspace') return shift ? null : { kind: 'cancelOwn' };
  // + is Shift+= on most layouts; accept = as well so it works without Shift.
  if (key === '+' || key === '=') return { kind: 'sizeStep', dir: 1 };
  if (key === '-') return { kind: 'sizeStep', dir: -1 };
  if (key === '[') return { kind: 'ownOrder', dir: -1 };
  if (key === ']') return { kind: 'ownOrder', dir: 1 };

  if (k === 'b' || k === 's') {
    const side: LadderKeySide = k === 'b' ? 'BID' : 'ASK';
    return shift ? { kind: 'stageMarket', side } : { kind: 'stage', side };
  }
  if (shift) return null;
  if (k === 'c') return { kind: 'recentre' };
  if (k === 't') return { kind: 'nextType' };
  if (k === 'f') return { kind: 'nextTif' };
  if (key === '1' || key === '2' || key === '3') return { kind: 'preset', index: Number(key) - 1 };
  return null;
}

export type GlobalCommand = 'focusLadder' | 'help';

/** The global command for a key press anywhere on the page, or null. The
 *  caller rules out text fields, menus and dialogs. */
export function globalCommand(e: KeyLike): GlobalCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return 'help';
  if (!e.shiftKey && (e.key === 'l' || e.key === 'L')) return 'focusLadder';
  return null;
}

export interface ShortcutRow {
  what: string;
  /** Key caps, drawn in order ("Shift", "↑ ↓"). */
  keys: string[];
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

const g = (title: string, rows: [string, string[]][]): ShortcutGroup => ({
  title,
  rows: rows.map(([what, keys]) => ({ what, keys })),
});

/** What the shortcut sheet shows, grouped as in the design. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  g('Move', [
    ['Focus the ladder', ['L']],
    ['Price up or down one rung', ['↑', '↓']],
    ['Ten rungs', ['Shift', '↑ ↓']],
    ['Back to last price', ['C']],
  ]),
  g('Order', [
    ['Stage buy at the focused price', ['B']],
    ['Stage sell at the focused price', ['S']],
    ['Place the staged order', ['Enter']],
    ['Clear the stage', ['Esc']],
    ['Stage a market buy or sell', ['Shift', 'B / S']],
  ]),
  g('Size and type', [
    ['Size presets', ['1', '2', '3']],
    ['Size up or down one step', ['+', '−']],
    ['Next order type', ['T']],
    ['Next time in force', ['F']],
    ['Toggle one-click', ['Ctrl', 'O']],
  ]),
  g('Cancel and move', [
    ['Previous or next own order', ['[', ']']],
    ['Cancel the focused order', ['Del']],
    ['Move it one rung', ['Alt', '↑ ↓']],
    ['Cancel all, then confirm', ['Ctrl', 'Shift', 'X']],
  ]),
];

/** True for elements where a typed letter belongs to the element. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);
}

/** True inside an open menu, dialog or listbox: their keys stay theirs. */
export function inOverlay(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  return t.closest('[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"]') !== null;
}
