// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS, globalCommand, ladderCommand } from './keymap';
import type { KeyLike } from './keymap';

const k = (key: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('ladderCommand', () => {
  it('maps the ladder keys', () => {
    expect(ladderCommand(k('ArrowUp'))).toEqual({ kind: 'move', rungs: 1 });
    expect(ladderCommand(k('ArrowDown'))).toEqual({ kind: 'move', rungs: -1 });
    expect(ladderCommand(k('ArrowUp', { shiftKey: true }))).toEqual({ kind: 'move', rungs: 10 });
    expect(ladderCommand(k('ArrowDown', { shiftKey: true }))).toEqual({ kind: 'move', rungs: -10 });
    expect(ladderCommand(k('c'))).toEqual({ kind: 'recentre' });
    expect(ladderCommand(k('b'))).toEqual({ kind: 'stage', side: 'BID' });
    expect(ladderCommand(k('s'))).toEqual({ kind: 'stage', side: 'ASK' });
    expect(ladderCommand(k('B', { shiftKey: true }))).toEqual({ kind: 'stageMarket', side: 'BID' });
    expect(ladderCommand(k('S', { shiftKey: true }))).toEqual({ kind: 'stageMarket', side: 'ASK' });
    expect(ladderCommand(k('1'))).toEqual({ kind: 'preset', index: 0 });
    expect(ladderCommand(k('3'))).toEqual({ kind: 'preset', index: 2 });
    expect(ladderCommand(k('+', { shiftKey: true }))).toEqual({ kind: 'sizeStep', dir: 1 });
    expect(ladderCommand(k('='))).toEqual({ kind: 'sizeStep', dir: 1 });
    expect(ladderCommand(k('-'))).toEqual({ kind: 'sizeStep', dir: -1 });
    expect(ladderCommand(k('t'))).toEqual({ kind: 'nextType' });
    expect(ladderCommand(k('f'))).toEqual({ kind: 'nextTif' });
    expect(ladderCommand(k('o', { ctrlKey: true }))).toEqual({ kind: 'toggleOneClick' });
    expect(ladderCommand(k('['))).toEqual({ kind: 'ownOrder', dir: -1 });
    expect(ladderCommand(k(']'))).toEqual({ kind: 'ownOrder', dir: 1 });
    expect(ladderCommand(k('Delete'))).toEqual({ kind: 'cancelOwn' });
    expect(ladderCommand(k('Backspace'))).toEqual({ kind: 'cancelOwn' });
    expect(ladderCommand(k('ArrowUp', { altKey: true }))).toEqual({ kind: 'moveOwn', dir: 1 });
    expect(ladderCommand(k('ArrowDown', { altKey: true }))).toEqual({ kind: 'moveOwn', dir: -1 });
    expect(ladderCommand(k('X', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'cancelAll' });
  });

  it('Caps Lock letters act like plain ones', () => {
    expect(ladderCommand(k('B'))).toEqual({ kind: 'stage', side: 'BID' });
    expect(ladderCommand(k('C'))).toEqual({ kind: 'recentre' });
  });

  it('leaves Tab, browser and system chords alone', () => {
    expect(ladderCommand(k('Tab'))).toBeNull();
    expect(ladderCommand(k('Tab', { shiftKey: true }))).toBeNull();
    expect(ladderCommand(k('c', { ctrlKey: true }))).toBeNull(); // copy
    expect(ladderCommand(k('x', { ctrlKey: true }))).toBeNull(); // cut: Cancel all needs Shift too
    expect(ladderCommand(k('o', { metaKey: true }))).toBeNull();
    expect(ladderCommand(k('b', { altKey: true }))).toBeNull();
    expect(ladderCommand(k('C', { shiftKey: true }))).toBeNull();
    expect(ladderCommand(k('!', { shiftKey: true }))).toBeNull();
    expect(ladderCommand(k('4'))).toBeNull();
    expect(ladderCommand(k('l'))).toBeNull(); // global, handled by the page
  });
});

describe('globalCommand', () => {
  it('L focuses the ladder and ? opens help; nothing else', () => {
    expect(globalCommand(k('l'))).toBe('focusLadder');
    expect(globalCommand(k('L'))).toBe('focusLadder');
    expect(globalCommand(k('?', { shiftKey: true }))).toBe('help');
    expect(globalCommand(k('L', { shiftKey: true }))).toBeNull();
    expect(globalCommand(k('l', { ctrlKey: true }))).toBeNull();
    expect(globalCommand(k('b'))).toBeNull();
  });
});

describe('SHORTCUT_GROUPS', () => {
  it('shows the four groups of the design, with [ and ] (not Tab) for own orders', () => {
    expect(SHORTCUT_GROUPS.map(g => g.title)).toEqual(['Move', 'Order', 'Size and type', 'Cancel and move']);
    const all = SHORTCUT_GROUPS.flatMap(g => g.rows.flatMap(r => r.keys));
    expect(all).not.toContain('Tab');
    expect(all).toContain('[');
    expect(all).toContain(']');
  });
});
