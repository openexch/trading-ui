// SPDX-License-Identifier: Apache-2.0
/**
 * The market list, from the gateway (GET /api/v2/markets): symbols, assets,
 * tick sizes and price ranges are the core's configuration, never a table in
 * the UI. A module-level store (the session.ts pattern) so non-React code
 * (id -> symbol lookups) and React (useMarkets) read the same list.
 */
import { useSyncExternalStore } from 'react';
import { apiRequest } from '../api/gateway';
import { marketIdFromApi } from '../api/marketId';
import { parseDecimal } from '../api/decimal';
import type { Market } from '../types/market';
import { assetDisplayName } from './assetNames';

/** One asset of the core's asset list (deposit and withdraw pick from it). */
export interface Asset {
  /** API form, a decimal string ("2"); sent back unchanged. */
  assetId: string;
  code: string;
  scale: number;
}

export interface MarketList {
  markets: Market[];
  assets: Asset[];
}

interface MarketWire {
  marketId: string;
  symbol: string;
  baseAsset: string | null;
  quoteAsset: string | null;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
}

interface MarketsBodyWire {
  markets: MarketWire[];
  assets: { assetId: string; code: string; scale: number }[];
}

/** Map the gateway's /markets body to UI state. Throws on a malformed body. */
export function mapMarketsBody(raw: unknown): MarketList {
  const body = raw as MarketsBodyWire;
  if (!body || !Array.isArray(body.markets) || !Array.isArray(body.assets)) {
    throw new Error('markets body is not {markets, assets}');
  }
  const markets = body.markets.map((m): Market => {
    if (typeof m.symbol !== 'string') throw new Error('symbol is not a string');
    // The symbol is BASE-QUOTE; a null asset name (not in the asset list)
    // falls back to the symbol's own halves.
    const [symBase = m.symbol, symQuote = ''] = m.symbol.split('-');
    const baseAsset = m.baseAsset ?? symBase;
    return {
      id: marketIdFromApi(m.marketId),
      symbol: m.symbol,
      baseAsset,
      quoteAsset: m.quoteAsset ?? symQuote,
      name: assetDisplayName(baseAsset),
      tickSize: parseDecimal(m.tickSize, 'tickSize'),
      minPrice: parseDecimal(m.minPrice, 'minPrice'),
      maxPrice: parseDecimal(m.maxPrice, 'maxPrice'),
    };
  });
  markets.sort((a, b) => a.id - b.id);
  const assets = body.assets.map((a): Asset => ({ assetId: String(a.assetId), code: String(a.code), scale: a.scale }));
  return { markets, assets };
}

const EMPTY: MarketList = { markets: [], assets: [] };
let current: MarketList = EMPTY;
const listeners = new Set<() => void>();

export function getMarketList(): MarketList {
  return current;
}

export function getMarkets(): Market[] {
  return current.markets;
}

/** The market with this UI id, or undefined when the gateway did not list it. */
export function findMarket(id: number): Market | undefined {
  return current.markets.find(m => m.id === id);
}

export function findMarketBySymbol(symbol: string): Market | undefined {
  return current.markets.find(m => m.symbol === symbol);
}

/** The symbol for an id, `#<id>` for a market the list does not hold. */
export function marketSymbol(id: number): string {
  return findMarket(id)?.symbol ?? `#${id}`;
}

export function setMarketList(next: MarketList): void {
  current = next;
  for (const l of [...listeners]) l();
}

export function subscribeMarkets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fetch the list once. Resolves true when the store holds a list. */
export async function loadMarkets(): Promise<boolean> {
  try {
    const res = await apiRequest<unknown>('/markets', { auth: false });
    if (!res.ok) {
      console.error('[markets] GET /api/v2/markets refused:', res.status, res.error.code, res.error.error);
      return false;
    }
    setMarketList(mapMarketsBody(res.body));
    return true;
  } catch (e) {
    console.error('[markets] GET /api/v2/markets failed:', e);
    return false;
  }
}

/** React view of the list. */
export function useMarketList(): MarketList {
  return useSyncExternalStore(subscribeMarkets, getMarketList);
}
