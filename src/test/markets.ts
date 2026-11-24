// SPDX-License-Identifier: Apache-2.0
/**
 * Test markets, as the gateway would list them (GET /api/v2/markets), mapped
 * through the same function the app uses. Importing this module also puts
 * them in the market store, so components that look a market up by id see
 * them.
 */
import { mapMarketsBody, setMarketList } from '../markets/marketStore';
import { GATEWAY_MARKETS_BODY } from './gatewayMarkets';

export { GATEWAY_MARKETS_BODY };

export const TEST_MARKET_LIST = mapMarketsBody(GATEWAY_MARKETS_BODY);
export const TEST_MARKETS = TEST_MARKET_LIST.markets;

setMarketList(TEST_MARKET_LIST);
