// SPDX-License-Identifier: Apache-2.0
/** A GET /api/v2/markets body for tests (no side effects; test/markets.ts
 *  maps it and seeds the market store). */
const market = (id: string, base: string, tick: string, min: string, max: string) => ({
  marketId: id,
  symbol: `${base}-USD`,
  baseAsset: base,
  quoteAsset: 'USD',
  baseAssetId: String(Number(id)),
  quoteAssetId: '0',
  tickSize: tick,
  lotSize: '0.00000001',
  minPrice: min,
  maxPrice: max,
  minQuantity: '0.00000001',
  maxQuantity: '1000000',
  minNotional: '0.01',
  maxNotional: '100000000',
});

/** A GET /api/v2/markets body (gateway shape: ids and money as strings). */
export const GATEWAY_MARKETS_BODY = {
  configVersion: 1,
  markets: [
    market('1', 'BTC', '1', '50000', '150000'),
    market('2', 'ETH', '0.5', '1000', '10000'),
    market('3', 'SOL', '0.05', '50', '500'),
    market('4', 'XRP', '0.001', '0.5', '10'),
    market('5', 'DOGE', '0.0001', '0.05', '1'),
  ],
  assets: [
    { assetId: '0', code: 'USD', scale: 8 },
    { assetId: '1', code: 'BTC', scale: 8 },
    { assetId: '2', code: 'ETH', scale: 8 },
    { assetId: '3', code: 'SOL', scale: 8 },
    { assetId: '4', code: 'XRP', scale: 8 },
    { assetId: '5', code: 'DOGE', scale: 8 },
  ],
};
