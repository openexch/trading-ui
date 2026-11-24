// SPDX-License-Identifier: Apache-2.0
/**
 * Long display names for asset codes. Labels only: which markets exist, their
 * ids, assets, ticks and ranges come from the gateway (GET /api/v2/markets).
 * The gateway sends no long name, so a code not listed here shows as itself.
 */
const ASSET_NAMES: Readonly<Record<string, string>> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  XRP: 'Ripple',
  DOGE: 'Dogecoin',
};

export function assetDisplayName(code: string): string {
  return ASSET_NAMES[code] ?? code;
}
