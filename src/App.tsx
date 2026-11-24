// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useRef, useEffect } from 'react';
import { Routes, Route } from 'react-router';
import { useWebSocket } from './hooks/useWebSocket';
import { useOrderBook } from './hooks/useOrderBook';
import { useTrades } from './hooks/useTrades';
import { useMarketStats } from './hooks/useMarketStats';
import { useMarketTickers } from './hooks/useMarketTickers';
import { useApi } from './hooks/useApi';
import { useOrders } from './hooks/useOrders';
import { useUserStream } from './hooks/useUserStream';
import { useEngineFeed } from './hooks/useEngineFeed';
import { useTheme } from './hooks/useTheme';
import { useAuth } from './auth/AuthContext';
import { AuthModal } from './components/Auth/AuthModal';
import { AccountDrawer } from './components/Account/AccountDrawer';
import { TerminalDesktop } from './terminal/TerminalDesktop';
import { TerminalPhone } from './terminal/TerminalPhone';
import type { WebSocketMessage, Market, OrderRequest, UserOrder, ApiOrder, ExtendedConnectionStatus, BookDeltaMessage, TickerStatsMessage, TickersMessage, CandleData, CandleHistoryMessage, CandleUpdateMessage } from './types/market';
import { loadMarkets, useMarketList } from './markets/marketStore';
import { decodeCandlesBody } from './api/marketFrames';
import { mergeLiveCandle } from './utils/candles';
import { formatRejectReason } from './utils/rejectReasons';
import { EV, track, updateContext } from './analytics';
import { engineStore } from './ledger/engineStore';
import { notifyOrderEvent } from './ledger/orderEvents';

// Mobile detection hook
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

// Cap on the live 1m candle array: 1440 buckets = 24h. Older history for
// wider intervals comes from REST, so the WS-fed array never needs more.
const MAX_LIVE_CANDLES = 1440;

function MarketPage({ markets }: { markets: Market[] }) {
  const isMobile = useIsMobile();
  const { theme, toggle: toggleTheme } = useTheme();
  const { session } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAccountDrawer, setShowAccountDrawer] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Market>(markets[0]);
  const selectedMarketIdRef = useRef(selectedMarket.id);


  // Server-aggregated candle state
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [currentCandle, setCurrentCandle] = useState<CandleData | null>(null);
  const [chartInterval, setChartInterval] = useState<string>('1m');
  const chartIntervalRef = useRef<string>('1m');
  // Market switch keeps the outgoing candles mounted under a dimming overlay
  // (no blank flash); chartLoading drives the overlay, candlesMarketRef says
  // which market the candles array belongs to — CANDLE_UPDATEs are ignored
  // until the new market's CANDLE_HISTORY baseline lands (no cross-market
  // appends).
  const [chartLoading, setChartLoading] = useState(false);
  const candlesMarketRef = useRef(selectedMarket.id);

  // The book requests a fresh snapshot itself when it detects a version gap
  // (v4 chain); the ref indirection breaks the hook-order cycle with
  // useWebSocket, which is created below.
  const requestRefreshRef = useRef<() => void>(() => {});
  const { orderBook, levelChanges, handleBookSnapshot, handleBookDelta, resetOrderBook } =
    useOrderBook(() => requestRefreshRef.current());
  const { trades, handleTradesBatch, resetTrades } = useTrades();
  const { stats, setStats, handleTrades, handleBookUpdate, resetStats } = useMarketStats();
  const { tickers, handleTickers, handleTickerStats, resetTickers } = useMarketTickers();
  const { submitOrder, cancelOrder, replaceOrder } = useApi();

  // Rejections after the core accepted an order (the matching engine's
  // decision) arrive as REJECTED order events on the user stream: surface
  // them, never let an accepted order silently vanish. `reason` is rendered
  // as friendly text; the raw code stays available via the notice's title.
  const [rejectNotice, setRejectNotice] = useState<{ text: string; code: string | null } | null>(null);
  const rejectTimerRef = useRef<number | null>(null);
  const handleOrderRejected = useCallback((order: ApiOrder) => {
    setRejectNotice({
      text: `Order rejected: ${formatRejectReason(order.reason)}`,
      code: order.reason,
    });
    if (rejectTimerRef.current) window.clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = window.setTimeout(() => setRejectNotice(null), 8000);
  }, []);
  const { orders, openOrders, handleOrderEvent, applySnapshot, seedOpenOrders, resetOrders, removeOrder } = useOrders(handleOrderRejected);
  // An order frame also tells an open order trail to read its order again.
  const handleOrderFrame = useCallback((order: ApiOrder) => {
    handleOrderEvent(order);
    notifyOrderEvent(order.orderId);
  }, [handleOrderEvent]);

  // Market-plane reset (reconnect / market switch). User orders live on the
  // user stream and are reset on session change instead. Candles are NOT
  // reset here — they stay mounted under the chart's loading overlay and are
  // replaced wholesale when the next CANDLE_HISTORY arrives.
  const resetAllState = useCallback(() => {
    resetOrderBook();
    resetTrades();
    resetStats();
  }, [resetOrderBook, resetTrades, resetStats]);

  // Other markets' tickers survive a market switch (no flicker) but not a
  // reconnect: the new connection sends a fresh TICKERS frame.
  const handleReconnecting = useCallback(() => {
    resetAllState();
    resetTickers();
  }, [resetAllState, resetTickers]);

  const handleReconnected = useCallback(() => {}, []);

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'BOOK_SNAPSHOT':
          if (message.marketId === selectedMarketIdRef.current) {
            handleBookSnapshot(message);
            handleBookUpdate(message.bids, message.asks);
          }
          break;
        case 'BOOK_DELTA':
          if (message.marketId === selectedMarketIdRef.current) {
            handleBookDelta(message as BookDeltaMessage);
          }
          break;
        case 'TRADES_BATCH':
          if (message.marketId === selectedMarketIdRef.current) {
            handleTradesBatch(message);
            handleTrades(message.trades);
          }
          break;
        case 'SUBSCRIPTION_CONFIRMED':
          break;
        case 'PONG':
          break;
        case 'ERROR':
          // HISTORY_UNAVAILABLE names the parts of the initial state that are
          // missing (tape, candles, ticker); the service never sends an empty
          // series in their place.
          console.error('Server error:', message.code, message.message, message.parts ?? '');
          break;
        case 'TICKERS':
          handleTickers(message as TickersMessage);
          break;
        case 'TICKER_STATS':
          handleTickerStats(message as TickerStatsMessage);
          if ((message as TickerStatsMessage).marketId === selectedMarketIdRef.current) {
            const tickerMsg = message as TickerStatsMessage;
            setStats({
              lastPrice: tickerMsg.lastPrice,
              priceChange: tickerMsg.priceChange,
              priceChangePercent: tickerMsg.priceChangePercent,
              high24h: tickerMsg.high24h,
              low24h: tickerMsg.low24h,
              volume24h: tickerMsg.volume24h,
            });
          }
          break;
        case 'CANDLE_HISTORY': {
          const candleHist = message as CandleHistoryMessage;
          if (candleHist.marketId === selectedMarketIdRef.current) {
            // Only use 1m history from WS; for other intervals we fetch via REST
            if (chartIntervalRef.current === '1m' || candleHist.interval === chartIntervalRef.current) {
              setCandles(candleHist.candles);
              setCurrentCandle(null);
              // The selected market's baseline has landed: live updates may
              // apply again and the chart's loading dim lifts.
              candlesMarketRef.current = candleHist.marketId;
              setChartLoading(false);
            }
          }
          break;
        }
        case 'CANDLE_UPDATE': {
          const candleUpd = message as CandleUpdateMessage;
          // Second guard: after a market switch, drop updates until the new
          // market's history baseline has replaced the candles array.
          if (candleUpd.marketId === selectedMarketIdRef.current &&
              candlesMarketRef.current === selectedMarketIdRef.current &&
              candleUpd.interval === '1m') {
            if (chartIntervalRef.current === '1m') {
              // Update current candle for real-time chart updates
              setCurrentCandle(candleUpd.candle);
              // Keep the history array authoritative for the live bucket (append on
              // a new bucket, update-in-place on the same one) so a settled candle
              // holds its FINAL value, not its first-tick value. See mergeLiveCandle.
              setCandles(prev => mergeLiveCandle(prev, candleUpd.candle, MAX_LIVE_CANDLES));
            }
          }
          break;
        }
      }
    },
    [handleBookSnapshot, handleBookDelta, handleTradesBatch, setStats,
     handleBookUpdate, handleTrades, handleTickers, handleTickerStats]
  );

  const { status, forceReconnect, requestRefresh } = useWebSocket({
    marketId: selectedMarket.id,
    onMessage: handleMessage,
    onReconnecting: handleReconnecting,
    onReconnected: handleReconnected,
  });
  requestRefreshRef.current = requestRefresh;

  // The user stream (/ws/v2): connects only while signed in; each
  // (re)connect re-seeds open orders from REST (the stream then wins), and
  // its orders snapshot replaces the list.
  // The same stream carries the engine telemetry (engine and election
  // frames) into the engine store. Signed out, the anonymous engine feed
  // asks for the engine frames alone (useEngineFeed); a server without that
  // channel refuses it once and the screen prints dashes, as before.
  const sessionToken = session?.token ?? null;
  const { status: streamStatus } = useUserStream({
    token: sessionToken,
    onOrderEvent: handleOrderFrame,
    onSnapshot: applySnapshot,
    onConnected: seedOpenOrders,
    onEngine: engineStore.engine,
    onElection: engineStore.election,
  });
  const engineFeed = useEngineFeed(!sessionToken, engineStore.engine, engineStore.election);
  useEffect(() => {
    engineStore.setLive(sessionToken ? streamStatus === 'connected' : engineFeed === 'live');
  }, [sessionToken, streamStatus, engineFeed]);

  // Session change: drop the previous principal's orders and the engine
  // telemetry of their stream; seed the new one's orders immediately (the
  // socket's onConnected covers later reconnects).
  useEffect(() => {
    resetOrders();
    engineStore.reset();
    if (sessionToken) seedOpenOrders();
  }, [sessionToken, resetOrders, seedOpenOrders]);

  // Self-heal a thin book: with delta-fed state, drops or seams can leave
  // the rendered book short; if either side stays under 18 levels for 5s
  // while connected, pull a fresh snapshot (no-op when the market is
  // genuinely thin — the refresh just confirms it).
  const bidDepth = orderBook.bids.length;
  const askDepth = orderBook.asks.length;
  useEffect(() => {
    if (status !== 'connected') return;
    if (bidDepth === 0 && askDepth === 0) return; // pre-snapshot
    if (bidDepth >= 18 && askDepth >= 18) return;
    const t = window.setTimeout(() => requestRefresh(), 5000);
    return () => window.clearTimeout(t);
  }, [status, bidDepth, askDepth, requestRefresh]);

  // Fetch candles from the market-data service's REST route (cross-origin;
  // marketId, interval and limit are all required). Its base is derived
  // from VITE_MARKET_WS_URL.
  const fetchCandles = useCallback(async (marketId: number, interval: string, limit: number = 200) => {
    setChartLoading(true);
    try {
      const apiBase = import.meta.env.VITE_MARKET_WS_URL
        ? import.meta.env.VITE_MARKET_WS_URL.replace(/^wss?:/, window.location.protocol === 'https:' ? 'https:' : 'http:')
        : '';
      const res = await fetch(`${apiBase}/api/candles?marketId=${marketId}&interval=${interval}&limit=${limit}`);
      if (res.ok) {
        const data = decodeCandlesBody(await res.json());
        if (data.marketId === selectedMarketIdRef.current) {
          setCandles(data.candles);
          setCurrentCandle(null);
          candlesMarketRef.current = data.marketId;
        }
      }
    } catch (e) {
      console.error('Failed to fetch candles:', e);
    } finally {
      setChartLoading(false);
    }
  }, []);

  const handleIntervalChange = useCallback((interval: string) => {
    track(EV.chart_interval_change, { to: interval });
    chartIntervalRef.current = interval;
    setChartInterval(interval);
    setCandles([]);
    setCurrentCandle(null);

    if (interval === '1m') {
      // Re-fetch 1m from REST (WS will keep updating via CANDLE_UPDATE)
      fetchCandles(selectedMarketIdRef.current, '1m');
    } else {
      // Fetch from REST for non-1m intervals
      fetchCandles(selectedMarketIdRef.current, interval);
    }
  }, [fetchCandles]);

  // The market feed carries no cluster state, so the cluster states of the
  // pill never set here.
  const effectiveStatus: ExtendedConnectionStatus = status;

  const handleMarketChange = useCallback((market: Market) => {
    track(EV.market_switch, { to: market.symbol });
    // Every later event in this session is attributed to the market on screen.
    updateContext({ market: market.symbol });
    selectedMarketIdRef.current = market.id;
    setSelectedMarket(market);
    chartIntervalRef.current = '1m';
    setChartInterval('1m');
    // Dim (don't blank) the chart until the new market's history lands
    setChartLoading(true);
    resetAllState();
  }, [resetAllState]);

  const handleReconnect = useCallback(() => {
    forceReconnect();
  }, [forceReconnect]);

  const handleSubmitOrder = useCallback(async (order: OrderRequest) => {
    return await submitOrder(order);
  }, [submitOrder]);

  // REST keys on the gateway's order id (omsOrderId), never the engine's
  const handleCancelOrder = useCallback(async (order: UserOrder) => {
    if (!order.omsOrderId) return { success: false, message: 'Order is not OMS-managed' }; // nothing we can cancel
    track(EV.order_cancel_submit, { market: order.market, side: order.side, order_type: order.type });
    const startedAt = Date.now();
    const result = await cancelOrder(order.omsOrderId);
    track(EV.order_cancel_result, {
      market: order.market,
      ok: result.success,
      round_trip_ms: Date.now() - startedAt,
    });
    // Accepted, or no longer open (404 / 409 NOT_OPEN): the row goes.
    if (result.success || result.gone) {
      removeOrder(order.omsOrderId);
    }
    return result;
  }, [cancelOrder, removeOrder]);

  const handleReplaceOrder = useCallback(async (order: UserOrder, price?: number, quantity?: number) => {
    if (!order.omsOrderId) {
      return { success: false, message: 'Order is not OMS-managed' };
    }
    return await replaceOrder(order.omsOrderId, price, quantity);
  }, [replaceOrder]);


  // The phone shell at 768px and below, the desktop shell above.
  const Shell = isMobile ? TerminalPhone : TerminalDesktop;
  return (
    <>
      <Shell
        market={selectedMarket}
        markets={markets}
        onSelectMarket={handleMarketChange}
        stats={stats}
        tickers={tickers}
        orderBook={orderBook}
        levelChanges={levelChanges}
        openOrders={openOrders}
        orders={orders}
        trades={trades}
        chart={{
          candles,
          currentCandle,
          activeInterval: chartInterval,
          onIntervalChange: handleIntervalChange,
          loading: chartLoading,
        }}
        status={effectiveStatus}
        onReconnect={handleReconnect}
        theme={theme}
        onToggleTheme={toggleTheme}
        username={session?.username ?? null}
        onSignIn={() => setShowAuthModal(true)}
        onOpenAccount={() => {
          track(EV.account_drawer_open);
          setShowAccountDrawer(true);
        }}
        signedIn={!!session}
        onSubmitOrder={handleSubmitOrder}
        rejectNotice={rejectNotice}
        onCancelOrder={handleCancelOrder}
        onReplaceOrder={handleReplaceOrder}
      />
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showAccountDrawer && session && <AccountDrawer onClose={() => setShowAccountDrawer(false)} />}
    </>
  );
}

const MARKETS_RETRY_MS = 3000;

/** The trading page needs the market list (GET /api/v2/markets) before its
 *  first render: every panel is keyed to a market. Until the gateway answers
 *  only the page background shows; a refusal or a network error retries. */
function MarketsGate() {
  const { markets } = useMarketList();
  useEffect(() => {
    if (markets.length > 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = async () => {
      const ok = await loadMarkets();
      if (!cancelled && !ok) timer = window.setTimeout(attempt, MARKETS_RETRY_MS);
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [markets.length]);
  if (markets.length === 0) return null;
  return <MarketPage markets={markets} />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<MarketsGate />} />
    </Routes>
  );
}

export default App;
