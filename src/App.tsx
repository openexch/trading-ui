// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useOrderBook } from './hooks/useOrderBook';
import { useTrades } from './hooks/useTrades';
import { useMarketStats } from './hooks/useMarketStats';
import { useClusterState } from './hooks/useClusterState';
import { useApi } from './hooks/useApi';
import { useOrders } from './hooks/useOrders';
import { useTheme } from './hooks/useTheme';
import { OrderBook } from './components/OrderBook/OrderBook';
import { TradeList } from './components/Trades/TradeList';
import { Chart } from './components/Chart/Chart';
import { ConnectionStatus } from './components/ConnectionStatus/ConnectionStatus';
import { MarketSelector } from './components/MarketSelector/MarketSelector';
import { MarketStats } from './components/MarketStats/MarketStats';
import { OrderForm } from './components/OrderForm/OrderForm';
import { OpenOrders } from './components/OpenOrders/OpenOrders';
import { OrderHistory } from './components/OrderHistory/OrderHistory';
import { AccountPanel } from './components/AccountPanel/AccountPanel';
import { ThemeToggle } from './components/ThemeToggle/ThemeToggle';
import { LogoMark } from './components/LogoMark';
import { BackgroundFX } from './components/BackgroundFX';
import { AdminPage } from './pages/AdminPage';
import type { WebSocketMessage, Market, OrderRequest, UserOrder, ClusterStatusMessage, ClusterEventMessage, ExtendedConnectionStatus, BookDeltaMessage, TickerStatsMessage, CandleData, CandleHistoryMessage, CandleUpdateMessage, OrderStatusBatchMessage } from './types/market';
import { MARKETS } from './types/market';

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

// Icons
const Icons = {
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

function MarketPage() {
  const isMobile = useIsMobile();
  const { theme, toggle: toggleTheme } = useTheme();
  const [selectedMarket, setSelectedMarket] = useState<Market>(MARKETS[0]);
  const selectedMarketIdRef = useRef(selectedMarket.id);

  // Mobile-specific state
  const [mobileTab, setMobileTab] = useState<'chart' | 'orderbook' | 'trades'>('chart');
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [mobileOrderSide, setMobileOrderSide] = useState<'BID' | 'ASK' | null>(null);

  // Price click-to-fill state
  const [clickedPrice, setClickedPrice] = useState<number | null>(null);

  // Server-aggregated candle state
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [currentCandle, setCurrentCandle] = useState<CandleData | null>(null);
  const [chartInterval, setChartInterval] = useState<string>('1m');
  const chartIntervalRef = useRef<string>('1m');

  const { orderBook, levelChanges, handleBookSnapshot, handleBookDelta, resetOrderBook } = useOrderBook();
  const { trades, handleTradesBatch, resetTrades } = useTrades();
  const { stats, setStats, handleTrades, handleBookUpdate, resetStats } = useMarketStats();
  const { clusterState, handleClusterStatus, handleClusterEvent } = useClusterState();
  const { submitOrder, cancelOrder, replaceOrder, loading: apiLoading } = useApi();
  const { openOrders, handleOrderStatusBatch, resetOrders, removeOrder } = useOrders();

  const resetAllState = useCallback(() => {
    resetOrderBook();
    resetTrades();
    resetStats();
    resetOrders();
    setCandles([]);
    setCurrentCandle(null);
  }, [resetOrderBook, resetTrades, resetStats, resetOrders]);

  const handleReconnecting = useCallback(() => {
    resetAllState();
  }, [resetAllState]);

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
        case 'ORDER_STATUS':
        case 'ORDER_STATUS_BATCH':
          handleOrderStatusBatch(message as OrderStatusBatchMessage);
          break;
        case 'SUBSCRIPTION_CONFIRMED':
          break;
        case 'PONG':
          break;
        case 'ERROR':
          console.error('Server error:', message.message);
          break;
        case 'TICKER_STATS':
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
            }
          }
          break;
        }
        case 'CANDLE_UPDATE': {
          const candleUpd = message as CandleUpdateMessage;
          if (candleUpd.marketId === selectedMarketIdRef.current && candleUpd.interval === '1m') {
            if (chartIntervalRef.current === '1m') {
              // Update current candle for real-time chart updates
              setCurrentCandle(candleUpd.candle);
              // If this is a new candle (different time from last in history), append to history
              setCandles(prev => {
                if (prev.length === 0) return [candleUpd.candle];
                const last = prev[prev.length - 1];
                if (candleUpd.candle.time > last.time) {
                  // New candle bucket — append, capped so the live array
                  // cannot grow without bound (trading-ui#24)
                  const next = [...prev, candleUpd.candle];
                  return next.length > MAX_LIVE_CANDLES
                    ? next.slice(next.length - MAX_LIVE_CANDLES)
                    : next;
                }
                // Same bucket — history will be updated via currentCandle overlay
                return prev;
              });
            }
          }
          break;
        }
        case 'CLUSTER_STATUS':
          handleClusterStatus(message as ClusterStatusMessage);
          break;
        case 'CLUSTER_EVENT':
          handleClusterEvent(message as ClusterEventMessage);
          break;
      }
    },
    [handleBookSnapshot, handleBookDelta, handleTradesBatch, setStats,
     handleBookUpdate, handleTrades, handleClusterStatus, handleClusterEvent,
     handleOrderStatusBatch]
  );

  const { status, forceReconnect, requestRefresh } = useWebSocket({
    marketId: selectedMarket.id,
    onMessage: handleMessage,
    onReconnecting: handleReconnecting,
    onReconnected: handleReconnected,
  });

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

  // Fetch candles from REST API for non-1m intervals
  const fetchCandles = useCallback(async (marketId: number, interval: string, limit: number = 200) => {
    try {
      const apiBase = import.meta.env.VITE_MARKET_WS_URL
        ? import.meta.env.VITE_MARKET_WS_URL.replace(/^wss?:/, window.location.protocol === 'https:' ? 'https:' : 'http:')
        : '';
      const res = await fetch(`${apiBase}/api/candles?marketId=${marketId}&interval=${interval}&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        if (data.candles && data.marketId === selectedMarketIdRef.current) {
          setCandles(data.candles);
          setCurrentCandle(null);
        }
      }
    } catch (e) {
      console.error('Failed to fetch candles:', e);
    }
  }, []);

  const handleIntervalChange = useCallback((interval: string) => {
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

  const effectiveStatus: ExtendedConnectionStatus = useMemo(() => {
    if (status !== 'connected') return status;
    if (clusterState.isElecting) return 'cluster-electing';
    if (clusterState.isRollingUpdate) return 'cluster-updating';
    return status;
  }, [status, clusterState.isElecting, clusterState.isRollingUpdate]);

  const handleMarketChange = useCallback((market: Market) => {
    selectedMarketIdRef.current = market.id;
    setSelectedMarket(market);
    chartIntervalRef.current = '1m';
    setChartInterval('1m');
    resetAllState();
    setShowMarketSelector(false);
  }, [resetAllState]);

  const handleReconnect = useCallback(() => {
    forceReconnect();
  }, [forceReconnect]);

  const handleSubmitOrder = useCallback(async (order: OrderRequest) => {
    return await submitOrder(order);
  }, [submitOrder]);

  // OMS REST keys on omsOrderId, NOT the engine orderId the WS feed uses (#25)
  const handleCancelOrder = useCallback(async (order: UserOrder) => {
    if (!order.omsOrderId) return; // not OMS-managed; nothing we can cancel
    const result = await cancelOrder(order.omsOrderId);
    if (result.success) {
      removeOrder(order.orderId);
    }
  }, [cancelOrder, removeOrder]);

  const handleReplaceOrder = useCallback(async (order: UserOrder, price?: number, quantity?: number) => {
    if (!order.omsOrderId) {
      return { success: false, message: 'Order is not OMS-managed' };
    }
    return await replaceOrder(order.omsOrderId, price, quantity);
  }, [replaceOrder]);

  // Order book price click → fills order form
  const handlePriceClick = useCallback((price: number) => {
    setClickedPrice(price);
  }, []);

  // Bottom section tab state
  const [bottomTab, setBottomTab] = useState<'order' | 'orders' | 'history' | 'trades' | 'account'>('order');

  const bestBid = orderBook.bids.length > 0 ? orderBook.bids[0] : null;
  const bestAsk = orderBook.asks.length > 0 ? orderBook.asks[0] : null;

  const tabClass = (active: boolean) =>
    `relative px-4 py-2.5 text-[13px] font-medium transition-colors ${
      active ? 'text-text' : 'text-faint hover:text-muted'
    }`;

  return (
    <div className="mx-auto flex h-screen max-w-[1920px] flex-col px-2">
      {/* ── Header ── */}
      <header className="relative isolate flex flex-shrink-0 items-center justify-between overflow-hidden border-b border-hairline py-2.5">
        <BackgroundFX />
        <div className="flex items-center gap-5">
          <div className="flex select-none items-center gap-2.5">
            <LogoMark />
            <span className="font-display text-[17px] font-bold leading-none tracking-tight">
              <span className="text-accent">Open</span>{' '}
              <span className="text-text-strong">Exchange</span>
            </span>
          </div>
          {isMobile ? (
            <button
              className="flex min-h-9 items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 font-mono text-[13px] font-medium text-text-strong"
              onClick={() => setShowMarketSelector(true)}
            >
              <span>{selectedMarket.symbol}</span>
              <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" className="text-faint">
                <path d="M2 4l4 4 4-4" />
              </svg>
            </button>
          ) : (
            <MarketSelector
              markets={MARKETS}
              selectedMarket={selectedMarket}
              onSelectMarket={handleMarketChange}
            />
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          {!isMobile && (
            <Link
              to="/admin"
              title="Cluster Admin"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-surface-2 text-muted transition-colors hover:border-hairline-strong hover:text-text"
            >
              {Icons.settings}
            </Link>
          )}
          <ConnectionStatus status={effectiveStatus} clusterState={clusterState} onReconnect={handleReconnect} />
        </div>
      </header>

      {/* ── Ticker rail (signature) ── */}
      <div className="flex-shrink-0 py-1.5">
        <MarketStats market={selectedMarket} stats={stats} orderBook={orderBook} />
      </div>

      {/* ── Main grid ── */}
      <main className="my-1.5 grid min-h-0 flex-1 grid-cols-1 gap-1.5 overflow-hidden lg:grid-cols-[300px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left — Order Book (desktop) */}
        {!isMobile && (
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-hairline bg-surface">
            <OrderBook orderBook={orderBook} levelChanges={levelChanges} onPriceClick={handlePriceClick} />
          </aside>
        )}

        {/* Center — Chart + bottom tabs */}
        <section className="flex min-w-0 min-h-0 flex-col overflow-hidden rounded-lg border border-hairline bg-surface">
          {/* Desktop chart */}
          {!isMobile && (
            <div className="flex min-h-[200px] flex-1 flex-col border-b border-hairline [&>*]:min-h-0 [&>*]:flex-1">
              <Chart
                candles={candles}
                currentCandle={currentCandle}
                symbol={selectedMarket.symbol}
                theme={theme}
                onIntervalChange={handleIntervalChange}
                activeInterval={chartInterval}
              />
            </div>
          )}

          {/* Mobile tab bar */}
          {isMobile && (
            <div className="flex flex-shrink-0 border-b border-hairline">
              {(['chart', 'orderbook', 'trades'] as const).map((t) => (
                <button
                  key={t}
                  className={`relative min-h-11 flex-1 py-2.5 text-[13px] font-medium transition-colors ${
                    mobileTab === t ? 'text-text-strong after:absolute after:inset-x-[20%] after:bottom-0 after:h-0.5 after:rounded-t after:bg-accent' : 'text-faint'
                  }`}
                  onClick={() => setMobileTab(t)}
                >
                  {t === 'chart' ? 'Chart' : t === 'orderbook' ? 'Order Book' : 'Trades'}
                </button>
              ))}
            </div>
          )}

          {/* Mobile tab content */}
          {isMobile && (
            <div className="min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
              {mobileTab === 'chart' && (
                <Chart candles={candles} currentCandle={currentCandle} symbol={selectedMarket.symbol} theme={theme} onIntervalChange={handleIntervalChange} activeInterval={chartInterval} />
              )}
              {mobileTab === 'orderbook' && (
                <OrderBook orderBook={orderBook} levelChanges={levelChanges} onPriceClick={handlePriceClick} />
              )}
              {mobileTab === 'trades' && <TradeList trades={trades} />}
            </div>
          )}

          {/* Desktop bottom tabbed section */}
          {!isMobile ? (
            <div className="flex max-h-[340px] min-h-[200px] flex-col border-t border-hairline">
              <div className="flex flex-shrink-0 gap-0 border-b border-hairline px-4">
                <button className={tabClass(bottomTab === 'order')} onClick={() => setBottomTab('order')}>
                  Order{bottomTab === 'order' && <Underline />}
                </button>
                <button className={tabClass(bottomTab === 'orders')} onClick={() => setBottomTab('orders')}>
                  Open Orders ({openOrders.length}){bottomTab === 'orders' && <Underline />}
                </button>
                <button className={tabClass(bottomTab === 'history')} onClick={() => setBottomTab('history')}>
                  History{bottomTab === 'history' && <Underline />}
                </button>
                <button className={tabClass(bottomTab === 'trades')} onClick={() => setBottomTab('trades')}>
                  Trades{bottomTab === 'trades' && <Underline />}
                </button>
                <button className={tabClass(bottomTab === 'account')} onClick={() => setBottomTab('account')}>
                  Account{bottomTab === 'account' && <Underline />}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {bottomTab === 'order' && (
                  <OrderForm market={selectedMarket} bestBid={bestBid} bestAsk={bestAsk} onSubmitOrder={handleSubmitOrder} loading={apiLoading} externalPrice={clickedPrice} />
                )}
                {bottomTab === 'orders' && (
                  <OpenOrders orders={openOrders} onCancelOrder={handleCancelOrder} onReplaceOrder={handleReplaceOrder} loading={apiLoading} />
                )}
                {bottomTab === 'history' && <OrderHistory market={selectedMarket} />}
                {bottomTab === 'trades' && <TradeList trades={trades} />}
                {bottomTab === 'account' && <AccountPanel />}
              </div>
            </div>
          ) : (
            <div className="flex flex-shrink-0 gap-2.5 border-t border-hairline bg-surface px-3 py-2">
              <button
                className="min-h-12 flex-1 rounded-md border border-buy/30 bg-buy-soft py-3 text-[15px] font-bold text-buy active:brightness-95"
                onClick={() => setMobileOrderSide('BID')}
              >
                Buy
              </button>
              <button
                className="min-h-12 flex-1 rounded-md border border-sell/30 bg-sell-soft py-3 text-[15px] font-bold text-sell active:brightness-95"
                onClick={() => setMobileOrderSide('ASK')}
              >
                Sell
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Mobile Market Selector overlay */}
      {isMobile && showMarketSelector && (
        <MarketSelector
          markets={MARKETS}
          selectedMarket={selectedMarket}
          onSelectMarket={handleMarketChange}
          isOverlay
          onClose={() => setShowMarketSelector(false)}
        />
      )}

      {/* Mobile Order Form bottom sheet */}
      {isMobile && mobileOrderSide && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 animate-overlay-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileOrderSide(null);
          }}
        >
          <div className="max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface animate-sheet-up [-webkit-overflow-scrolling:touch]">
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl bg-surface px-4 pb-2 pt-4">
              <span className="font-display text-lg font-bold text-text-strong">
                {mobileOrderSide === 'BID' ? 'Buy' : 'Sell'} {selectedMarket.baseAsset}
              </span>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted active:bg-surface-3"
                onClick={() => setMobileOrderSide(null)}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <OrderForm
              market={selectedMarket}
              bestBid={bestBid}
              bestAsk={bestAsk}
              onSubmitOrder={async (order) => {
                const result = await handleSubmitOrder(order);
                if (result.success) setMobileOrderSide(null);
                return result;
              }}
              loading={apiLoading}
              externalPrice={clickedPrice}
              isMobile
              defaultSide={mobileOrderSide}
            />
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {!isMobile && (
        <footer className="flex flex-shrink-0 items-center justify-between border-t border-hairline py-2 text-[11px] font-medium text-faint">
          <div className="flex items-center gap-2">
            <span className="text-accent">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
            <span>Open Exchange Trading Engine</span>
            <span className="text-hairline-strong">|</span>
            <span className="font-mono text-[10px] text-muted">v1.0.0</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-soft" />
            <span className="text-accent">Live updates</span>
          </div>
        </footer>
      )}
    </div>
  );
}

/** Active-tab underline accent. */
function Underline() {
  return <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-accent" />;
}

function App() {
  return (
    <>
      {/* App-wide faint engineering dot-grid; opaque panels cover it, so it only
          shows through the chrome/gutters. Decorative. */}
      <div aria-hidden className="bg-dotgrid pointer-events-none fixed inset-0 -z-10" />
      <Routes>
        <Route path="/" element={<MarketPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </>
  );
}

export default App;
