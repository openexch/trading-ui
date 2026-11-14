// SPDX-License-Identifier: Apache-2.0
/**
 * localStorage that never throws.
 *
 * Private windows, blocked site data and full quotas all make the Storage API
 * throw (or make the `localStorage` getter itself throw). UI preferences are
 * conveniences: a failed read means "use the default", a failed write means
 * "not remembered", and neither may take a panel down.
 *
 * Reads that feed layout go through `getJSON` with a validator, so a corrupt,
 * outdated or hand-edited value falls back to the default instead of reaching
 * render code.
 */

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(key: string): string | null {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  /** Returns false when the value could not be stored. */
  set(key: string, value: string): boolean {
    const s = store();
    if (!s) return false;
    try {
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  remove(key: string): void {
    try {
      store()?.removeItem(key);
    } catch {
      /* nothing to undo */
    }
  },

  /**
   * Parse a JSON value and accept it only if `validate` says it has the right
   * shape. Missing, unparsable or invalid values all return `fallback`.
   */
  getJSON<T>(key: string, validate: (value: unknown) => value is T, fallback: T): T {
    const raw = safeStorage.get(key);
    if (raw === null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      return validate(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  },

  /** Returns false when the value could not be serialised or stored. */
  setJSON(key: string, value: unknown): boolean {
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch {
      return false;
    }
    return safeStorage.set(key, raw);
  },
};
