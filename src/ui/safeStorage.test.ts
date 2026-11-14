// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './safeStorage';

const isLayout = (v: unknown): v is { version: 1; slots: string[] } =>
  typeof v === 'object' && v !== null && (v as { version?: unknown }).version === 1 &&
  Array.isArray((v as { slots?: unknown }).slots);

const fallback = { version: 1 as const, slots: ['book', 'chart'] };

describe('safeStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips strings and JSON', () => {
    expect(safeStorage.set('k', 'v')).toBe(true);
    expect(safeStorage.get('k')).toBe('v');
    safeStorage.remove('k');
    expect(safeStorage.get('k')).toBeNull();

    expect(safeStorage.setJSON('layout', { version: 1, slots: ['tape'] })).toBe(true);
    expect(safeStorage.getJSON('layout', isLayout, fallback)).toEqual({ version: 1, slots: ['tape'] });
  });

  it('falls back on missing, corrupt or invalid JSON', () => {
    expect(safeStorage.getJSON('nope', isLayout, fallback)).toBe(fallback);
    localStorage.setItem('layout', '{not json');
    expect(safeStorage.getJSON('layout', isLayout, fallback)).toBe(fallback);
    localStorage.setItem('layout', JSON.stringify({ version: 0, slots: [] }));
    expect(safeStorage.getJSON('layout', isLayout, fallback)).toBe(fallback);
  });

  it('never throws when the Storage methods throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(safeStorage.get('k')).toBeNull();
    expect(safeStorage.set('k', 'v')).toBe(false);
    expect(() => safeStorage.remove('k')).not.toThrow();
    expect(safeStorage.getJSON('k', isLayout, fallback)).toBe(fallback);
    expect(safeStorage.setJSON('k', { a: 1 })).toBe(false);
  });

  it('never throws when the localStorage getter itself throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
    expect(safeStorage.get('k')).toBeNull();
    expect(safeStorage.set('k', 'v')).toBe(false);
    expect(() => safeStorage.remove('k')).not.toThrow();
  });

  it('reports values JSON cannot serialise', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(safeStorage.setJSON('k', cyclic)).toBe(false);
  });
});
