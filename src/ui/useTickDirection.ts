// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';

export type TickDirection = 'up' | 'down';

export interface TickState {
  /** Set for half a second after a move, for the colour flash. */
  tick: TickDirection | null;
  /** Direction of the LAST move. Persistent, so an arrow never appears and
   *  disappears (that made the whole price jitter sideways every tick). */
  dir: TickDirection | null;
}

const FLASH_MS = 500;

/**
 * Tracks the direction of a live value. `null` means "no value yet" (for
 * example a market switch in flight) and resets the baseline, so the first
 * value of the next market never counts as a move.
 */
export function useTickDirection(value: number | null): TickState {
  const prev = useRef(value);
  const [tick, setTick] = useState<TickDirection | null>(null);
  const [dir, setDir] = useState<TickDirection | null>(null);

  useEffect(() => {
    if (value === null) {
      prev.current = null;
      return;
    }
    if (prev.current !== null) {
      if (value > prev.current) { setTick('up'); setDir('up'); }
      else if (value < prev.current) { setTick('down'); setDir('down'); }
    }
    prev.current = value;
    const id = window.setTimeout(() => setTick(null), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [value]);

  return { tick, dir };
}
