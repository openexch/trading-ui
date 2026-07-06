// SPDX-License-Identifier: Apache-2.0
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { Market, OrderSide, OrderType, OrderRequest, TimeInForce } from '../../types/market';
import { formatPrice } from '../../utils/formatters';
import { snapPrice, isInPriceRange, tickLabel, priceRangeLabel } from '../../utils/ticks';

interface OrderFormProps {
  market: Market;
  bestBid?: unknown;
  bestAsk?: unknown;
  onSubmitOrder: (order: OrderRequest) => Promise<{ success: boolean; message: string }>;
  loading: boolean;
  externalPrice?: number | null;
  isMobile?: boolean;
  defaultSide?: 'BID' | 'ASK';
  /** When false the form is disabled and submit becomes "Sign in to trade". */
  signedIn: boolean;
  onRequestSignIn: () => void;
  /** Async rejection of a previously accepted order (from the user's order
   *  stream) — surfaced here so a rejected order never just silently
   *  disappears. */
  rejectNotice?: string | null;
}

const SYNTHETIC_TYPES: OrderType[] = ['STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP', 'ICEBERG'];
const needsStopPrice = (t: OrderType) => t === 'STOP_LOSS' || t === 'STOP_LIMIT';
const needsTrailingDelta = (t: OrderType) => t === 'TRAILING_STOP';
const needsDisplayQty = (t: OrderType) => t === 'ICEBERG';
const needsPrice = (t: OrderType) => t !== 'MARKET' && t !== 'STOP_LOSS';

const inputClass =
  'w-full rounded-md border border-hairline bg-surface-2 px-2.5 py-2 pr-14 font-mono text-[13px] tabular-nums text-text placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</label>
      <div className="relative">{children}</div>
    </div>
  );
}

// A scrolling panel over a focused number input silently changes its value
// (native wheel-to-step) — blur instead so scrolling never edits an order.
const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

function Suffix({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-faint">
      {children}
    </span>
  );
}

function OrderSideForm({
  side,
  market,
  orderType,
  timeInForce,
  onSubmitOrder,
  loading,
  externalPrice,
  signedIn,
  onRequestSignIn,
}: {
  side: OrderSide;
  market: Market;
  orderType: OrderType;
  timeInForce: TimeInForce;
  onSubmitOrder: (order: OrderRequest) => Promise<{ success: boolean; message: string }>;
  loading: boolean;
  externalPrice?: number | null;
  signedIn: boolean;
  onRequestSignIn: () => void;
}) {
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingDelta, setTrailingDelta] = useState('');
  const [displayQuantity, setDisplayQuantity] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sliderValue, setSliderValue] = useState(0);

  const isBuy = side === 'BID';

  // Sync external price from order book click (book prices are on-tick, but
  // snap anyway so a stale/legacy value can never produce an off-tick order)
  useEffect(() => {
    if (externalPrice !== null && externalPrice !== undefined) {
      setPrice(snapPrice(market, externalPrice).toString());
    }
  }, [externalPrice, market]);

  // Snap the typed price onto the engine grid when leaving the field
  const handlePriceBlur = useCallback(() => {
    const p = parseFloat(price);
    if (p > 0 && isInPriceRange(market, p)) {
      setPrice(snapPrice(market, p).toString());
    }
  }, [price, market]);

  const total = useMemo(() => {
    const p = parseFloat(price) || 0;
    const q = parseFloat(quantity) || 0;
    return p * q;
  }, [price, quantity]);

  const handlePercentage = useCallback((percent: number) => {
    setSliderValue(percent);
    const baseQty = 1;
    setQuantity((baseQty * percent / 100).toFixed(8));
  }, []);

  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseInt(e.target.value);
    setSliderValue(pct);
    const baseQty = 1;
    setQuantity((baseQty * pct / 100).toFixed(8));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const priceNum = parseFloat(price);
    const quantityNum = parseFloat(quantity);

    if (orderType !== 'MARKET' && (!priceNum || priceNum <= 0)) {
      setNotification({ type: 'error', message: 'Enter a valid price' });
      return;
    }

    if (!quantityNum || quantityNum <= 0) {
      setNotification({ type: 'error', message: 'Enter a valid amount' });
      return;
    }

    // Engine price grid: out-of-range prices are a hard error; anything else
    // is snapped to the tick so the engine can never reject on PRICE_OFF_TICK.
    let submitPrice = priceNum;
    if (needsPrice(orderType)) {
      if (!isInPriceRange(market, priceNum)) {
        setNotification({
          type: 'error',
          message: `Price must be within ${priceRangeLabel(market)} for ${market.symbol}`,
        });
        return;
      }
      submitPrice = snapPrice(market, priceNum);
      if (submitPrice !== priceNum) setPrice(submitPrice.toString());
    }
    const stopNum = parseFloat(stopPrice);
    const submitStop = needsStopPrice(orderType) && stopNum > 0
      ? snapPrice(market, stopNum)
      : undefined;

    const order: OrderRequest = {
      market: market.symbol,
      orderType,
      orderSide: side,
      price: !needsPrice(orderType) ? 0 : submitPrice,
      quantity: quantityNum,
      totalPrice: orderType === 'MARKET' && isBuy ? total : undefined,
      timeInForce,
      stopPrice: submitStop,
      trailingDelta: needsTrailingDelta(orderType) ? parseFloat(trailingDelta) || undefined : undefined,
      displayQuantity: needsDisplayQty(orderType) ? parseFloat(displayQuantity) || undefined : undefined,
      timestamp: Date.now(),
    };

    const result = await onSubmitOrder(order);

    if (result.success) {
      setNotification({ type: 'success', message: `${isBuy ? 'Buy' : 'Sell'} order submitted` });
      setPrice('');
      setQuantity('');
      setSliderValue(0);
    } else {
      setNotification({ type: 'error', message: result.message });
    }

    setTimeout(() => setNotification(null), 3000);
  }, [price, quantity, orderType, side, market, isBuy, total, onSubmitOrder, stopPrice, trailingDelta, displayQuantity, timeInForce]);

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-3">
      {needsPrice(orderType) && (
        <Field label={`Price · tick ${tickLabel(market)}`}>
          <input
            type="number"
            onWheel={blurOnWheel}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={handlePriceBlur}
            placeholder="0.00"
            step={market.tickSize}
            min={market.minPrice}
            max={market.maxPrice}
            disabled={!signedIn}
            className={inputClass}
          />
          <Suffix>{market.quoteAsset}</Suffix>
        </Field>
      )}

      {needsStopPrice(orderType) && (
        <Field label="Stop Price">
          <input type="number" onWheel={blurOnWheel} value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} placeholder="0.00" step="0.01" min="0" disabled={!signedIn} className={inputClass} />
          <Suffix>{market.quoteAsset}</Suffix>
        </Field>
      )}

      {needsTrailingDelta(orderType) && (
        <Field label="Trailing Delta">
          <input type="number" onWheel={blurOnWheel} value={trailingDelta} onChange={(e) => setTrailingDelta(e.target.value)} placeholder="0.00" step="0.01" min="0" disabled={!signedIn} className={inputClass} />
          <Suffix>{market.quoteAsset}</Suffix>
        </Field>
      )}

      {needsDisplayQty(orderType) && (
        <Field label="Visible Qty">
          <input type="number" onWheel={blurOnWheel} value={displayQuantity} onChange={(e) => setDisplayQuantity(e.target.value)} placeholder="0.00" step="0.00000001" min="0" disabled={!signedIn} className={inputClass} />
          <Suffix>{market.baseAsset}</Suffix>
        </Field>
      )}

      <Field label="Amount">
        <input type="number" onWheel={blurOnWheel} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.00" step="0.00000001" min="0" disabled={!signedIn} className={inputClass} />
        <Suffix>{market.baseAsset}</Suffix>
      </Field>

      {/* Percentage quick-fills */}
      <div className="flex gap-1">
        {[25, 50, 75, 100].map(pct => (
          <button
            key={pct}
            type="button"
            onClick={() => handlePercentage(pct)}
            disabled={!signedIn}
            className={`flex-1 rounded-sm border py-1 font-mono text-[11px] tabular-nums transition-colors disabled:opacity-50 ${
              sliderValue === pct
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-hairline text-muted hover:border-hairline-strong hover:text-text'
            }`}
          >
            {pct}%
          </button>
        ))}
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={sliderValue}
        onChange={handleSlider}
        disabled={!signedIn}
        className={`h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-3 ${isBuy ? 'accent-buy' : 'accent-sell'}`}
        aria-label="Amount percentage"
      />

      <Field label="Total">
        <div className="flex items-center justify-between rounded-md border border-hairline bg-surface-2 px-2.5 py-2">
          <span className="font-mono text-[13px] tabular-nums text-text">{formatPrice(total)}</span>
          <span className="font-mono text-[11px] text-faint">{market.quoteAsset}</span>
        </div>
      </Field>

      {notification && (
        <div
          className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium animate-fade-in ${
            notification.type === 'success' ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'
          }`}
        >
          {notification.message}
        </div>
      )}

      {signedIn ? (
        <button
          type="submit"
          disabled={loading}
          className={`mt-auto rounded-md py-2.5 text-[13px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50 ${
            isBuy ? 'bg-buy' : 'bg-sell'
          }`}
        >
          {loading ? '…' : `${isBuy ? 'Buy' : 'Sell'} ${market.baseAsset}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={onRequestSignIn}
          className="mt-auto rounded-md bg-accent py-2.5 text-[13px] font-bold text-on-accent transition-colors hover:bg-accent-hover"
        >
          Sign in to trade
        </button>
      )}
    </form>
  );
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  LIMIT: 'Limit',
  MARKET: 'Market',
  LIMIT_MAKER: 'Post Only',
  STOP_LOSS: 'Stop Loss',
  STOP_LIMIT: 'Stop Limit',
  TRAILING_STOP: 'Trail',
  ICEBERG: 'Iceberg',
};

const TIF_LABELS: Record<TimeInForce, string> = { GTC: 'GTC', IOC: 'IOC', FOK: 'FOK', GTD: 'GTD' };

const typeTab = (active: boolean) =>
  `rounded-sm px-2.5 py-1 text-[12px] font-medium transition-colors ${
    active ? 'bg-surface-3 text-text-strong' : 'text-muted hover:text-text'
  }`;

export function OrderForm({ market, onSubmitOrder, loading, externalPrice, isMobile, defaultSide, signedIn, onRequestSignIn, rejectNotice }: OrderFormProps) {
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('GTC');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobileSide, setMobileSide] = useState<'BID' | 'ASK'>(defaultSide || 'BID');

  useEffect(() => {
    if (defaultSide) setMobileSide(defaultSide);
  }, [defaultSide]);

  const basicTypes: OrderType[] = ['LIMIT', 'MARKET', 'LIMIT_MAKER'];
  const advancedTypes: OrderType[] = ['STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP', 'ICEBERG'];

  const sideForm = (side: OrderSide) => (
    <OrderSideForm
      side={side}
      market={market}
      orderType={orderType}
      timeInForce={timeInForce}
      onSubmitOrder={onSubmitOrder}
      loading={loading}
      externalPrice={externalPrice}
      signedIn={signedIn}
      onRequestSignIn={onRequestSignIn}
    />
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Async order rejection (user's order stream) — never silent */}
      {rejectNotice && (
        <div className="rounded-md bg-sell-soft px-2.5 py-1.5 text-[11px] font-medium text-sell animate-fade-in">
          {rejectNotice}
        </div>
      )}

      {/* Mobile Buy/Sell toggle */}
      {isMobile && (
        <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
          <button
            className={`rounded-sm py-2 text-[13px] font-bold transition-colors ${mobileSide === 'BID' ? 'bg-buy text-white' : 'text-buy'}`}
            onClick={() => setMobileSide('BID')}
          >
            Buy
          </button>
          <button
            className={`rounded-sm py-2 text-[13px] font-bold transition-colors ${mobileSide === 'ASK' ? 'bg-sell text-white' : 'text-sell'}`}
            onClick={() => setMobileSide('ASK')}
          >
            Sell
          </button>
        </div>
      )}

      {/* Order type tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {basicTypes.map(t => (
          <button key={t} className={typeTab(orderType === t)} onClick={() => setOrderType(t)}>
            {ORDER_TYPE_LABELS[t]}
          </button>
        ))}
        <button
          className={typeTab(showAdvanced || SYNTHETIC_TYPES.includes(orderType))}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          More ▾
        </button>
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-1 rounded-md bg-surface-2 p-1">
          {advancedTypes.map(t => (
            <button key={t} className={typeTab(orderType === t)} onClick={() => { setOrderType(t); setShowAdvanced(false); }}>
              {ORDER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {/* Time-in-force */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-faint">TIF</span>
        {(Object.keys(TIF_LABELS) as TimeInForce[]).map(tif => (
          <button
            key={tif}
            className={`rounded-sm px-2 py-0.5 font-mono text-[11px] transition-colors ${
              timeInForce === tif ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'
            }`}
            onClick={() => setTimeInForce(tif)}
          >
            {TIF_LABELS[tif]}
          </button>
        ))}
      </div>

      {/* Forms */}
      {isMobile ? (
        sideForm(mobileSide)
      ) : (
        <div className="flex gap-4">
          {sideForm('BID')}
          <div className="w-px flex-shrink-0 bg-hairline" />
          {sideForm('ASK')}
        </div>
      )}
    </div>
  );
}
