// SPDX-License-Identifier: Apache-2.0
/**
 * OMS wire money (oms#39): exact 8-dp decimal strings on the wire, JS
 * numbers in UI state (display only; the server never trusts client math).
 */
export function toWireMoney(value: number): string {
  return value.toFixed(8);
}

export function fromWireMoney(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}
