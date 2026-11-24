// SPDX-License-Identifier: Apache-2.0
/**
 * The one place a market id changes form.
 *
 * The v2 gateway API carries `marketId` as a decimal string ("3"); the
 * market-data frames and `/api/candles` carry it as a JSON number (3). UI
 * state holds the number. Every crossing between the two goes through these
 * two functions; nothing else converts a market id.
 */

const CANONICAL = /^[1-9][0-9]{0,9}$/;
const MAX_MARKET_ID = 2147483647;

/** API string -> UI number. Refuses anything that is not a canonical
 *  positive decimal integer inside the gateway's range (1 to 2^31-1). */
export function marketIdFromApi(value: unknown): number {
  if (typeof value !== 'string' || !CANONICAL.test(value)) {
    throw new Error(`marketId is not a decimal id string: ${JSON.stringify(value)}`);
  }
  const id = Number(value);
  if (id > MAX_MARKET_ID) throw new Error(`marketId is out of range: ${value}`);
  return id;
}

/** UI number -> API string. */
export function marketIdToApi(id: number): string {
  if (!Number.isInteger(id) || id < 1 || id > MAX_MARKET_ID) {
    throw new Error(`marketId is not a market id: ${id}`);
  }
  return String(id);
}
