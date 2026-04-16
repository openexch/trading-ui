import { useState, useCallback, useMemo, useEffect } from 'react';
import type { Market, OrderSide, OrderType, OrderRequest, TimeInForce } from '../../types/market';
import { formatPrice } from '../../utils/formatters';
import './OrderForm.css';

interface OrderFormProps {
  market: Market;
  bestBid?: unknown;
  bestAsk?: unknown;
  onSubmitOrder: (order: OrderRequest) => Promise<{ success: boolean; message: string }>;
  loading: boolean;
  externalPrice?: number | null;
  isMobile?: boolean;
  defaultSide?: 'BID' | 'ASK';
}

const USER_ID = '1';

const SYNTHETIC_TYPES: OrderType[] = ['STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP', 'ICEBERG'];
const needsStopPrice = (t: OrderType) => t === 'STOP_LOSS' || t === 'STOP_LIMIT';
const needsTrailingDelta = (t: OrderType) => t === 'TRAILING_STOP';
const needsDisplayQty = (t: OrderType) => t === 'ICEBERG';
const needsPrice = (t: OrderType) => t !== 'MARKET' && t !== 'STOP_LOSS';

function OrderSideForm({
  side,
  market,
  orderType,
  timeInForce,
  onSubmitOrder,
  loading,
  externalPrice,
}: {
  side: OrderSide;
  market: Market;
  orderType: OrderType;
  timeInForce: TimeInForce;
  onSubmitOrder: (order: OrderRequest) => Promise<{ success: boolean; message: string }>;
  loading: boolean;
  externalPrice?: number | null;
}) {
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingDelta, setTrailingDelta] = useState('');
  const [displayQuantity, setDisplayQuantity] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sliderValue, setSliderValue] = useState(0);

  const isBuy = side === 'BID';

  // Sync external price from order book click
  useEffect(() => {
    if (externalPrice !== null && externalPrice !== undefined) {
      setPrice(externalPrice.toString());
    }
  }, [externalPrice]);

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

    const order: OrderRequest = {
      userId: USER_ID,
      market: market.symbol,
      orderType,
      orderSide: side,
      price: !needsPrice(orderType) ? 0 : priceNum,
      quantity: quantityNum,
      totalPrice: orderType === 'MARKET' && isBuy ? total : undefined,
      timeInForce,
      stopPrice: needsStopPrice(orderType) ? parseFloat(stopPrice) || undefined : undefined,
      trailingDelta: needsTrailingDelta(orderType) ? parseFloat(trailingDelta) || undefined : undefined,
      displayQuantity: needsDisplayQty(orderType) ? parseFloat(displayQuantity) || undefined : undefined,
      timestamp: Date.now(),
    };

    const result = await onSubmitOrder(order);

    if (result.success) {
      setNotification({ type: 'success', message: `${isBuy ? 'Buy' : 'Sell'} order placed` });
      setPrice('');
      setQuantity('');
      setSliderValue(0);
    } else {
      setNotification({ type: 'error', message: result.message });
    }

    setTimeout(() => setNotification(null), 3000);
  }, [price, quantity, orderType, side, market.symbol, isBuy, total, onSubmitOrder]);

  return (
    <form onSubmit={handleSubmit} className={`order-side-form ${isBuy ? 'buy-form' : 'sell-form'}`}>
      {/* Price Input — hidden for MARKET and STOP_LOSS */}
      <div className={`form-group ${!needsPrice(orderType) ? 'form-group-hidden' : ''}`}>
        <label>Price</label>
        <div className="input-wrapper">
          <input
            type="number"
            value={!needsPrice(orderType) ? '' : price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={!needsPrice(orderType) ? 'Market' : '0.00'}
            step="0.01"
            min="0"
            disabled={!needsPrice(orderType)}
            tabIndex={!needsPrice(orderType) ? -1 : undefined}
          />
          <span className="input-suffix">{market.quoteAsset}</span>
        </div>
      </div>

      {/* Stop Price — for STOP_LOSS, STOP_LIMIT */}
      {needsStopPrice(orderType) && (
        <div className="form-group">
          <label>Stop Price</label>
          <div className="input-wrapper">
            <input
              type="number"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
            <span className="input-suffix">{market.quoteAsset}</span>
          </div>
        </div>
      )}

      {/* Trailing Delta — for TRAILING_STOP */}
      {needsTrailingDelta(orderType) && (
        <div className="form-group">
          <label>Trailing Delta</label>
          <div className="input-wrapper">
            <input
              type="number"
              value={trailingDelta}
              onChange={(e) => setTrailingDelta(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
            <span className="input-suffix">{market.quoteAsset}</span>
          </div>
        </div>
      )}

      {/* Display Quantity — for ICEBERG */}
      {needsDisplayQty(orderType) && (
        <div className="form-group">
          <label>Visible Qty</label>
          <div className="input-wrapper">
            <input
              type="number"
              value={displayQuantity}
              onChange={(e) => setDisplayQuantity(e.target.value)}
              placeholder="0.00"
              step="0.00000001"
              min="0"
            />
            <span className="input-suffix">{market.baseAsset}</span>
          </div>
        </div>
      )}

      {/* Amount Input */}
      <div className="form-group">
        <label>Amount</label>
        <div className="input-wrapper">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
            step="0.00000001"
            min="0"
          />
          <span className="input-suffix">{market.baseAsset}</span>
        </div>
      </div>

      {/* Slider */}
      <div className="slider-group">
        <input
          type="range"
          min="0"
          max="100"
          value={sliderValue}
          onChange={handleSlider}
          className={`amount-slider ${isBuy ? 'buy-slider' : 'sell-slider'}`}
        />
        <div className="slider-marks">
          {[0, 25, 50, 75, 100].map(pct => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercentage(pct)}
              className={`slider-mark ${sliderValue >= pct ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Total */}
      <div className="form-group">
        <label>Total</label>
        <div className="total-display">
          <span>{formatPrice(total)}</span>
          <span className="input-suffix">{market.quoteAsset}</span>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        className={`submit-btn ${isBuy ? 'buy' : 'sell'}`}
        disabled={loading}
      >
        {loading ? '...' : `${isBuy ? 'Buy' : 'Sell'} ${market.baseAsset}`}
      </button>
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

const TIF_LABELS: Record<TimeInForce, string> = {
  GTC: 'GTC',
  IOC: 'IOC',
  FOK: 'FOK',
  GTD: 'GTD',
};

export function OrderForm({ market, onSubmitOrder, loading, externalPrice, isMobile, defaultSide }: OrderFormProps) {
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('GTC');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobileSide, setMobileSide] = useState<'BID' | 'ASK'>(defaultSide || 'BID');

  // Sync mobileSide when defaultSide changes (e.g. opening from Buy/Sell button)
  useEffect(() => {
    if (defaultSide) setMobileSide(defaultSide);
  }, [defaultSide]);

  const basicTypes: OrderType[] = ['LIMIT', 'MARKET', 'LIMIT_MAKER'];
  const advancedTypes: OrderType[] = ['STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP', 'ICEBERG'];

  return (
    <div className="order-form-container">
      {/* Mobile Buy/Sell side toggle */}
      {isMobile && (
        <div className="mobile-side-toggle">
          <button
            className={`side-toggle-btn buy ${mobileSide === 'BID' ? 'active' : ''}`}
            onClick={() => setMobileSide('BID')}
          >
            Buy
          </button>
          <button
            className={`side-toggle-btn sell ${mobileSide === 'ASK' ? 'active' : ''}`}
            onClick={() => setMobileSide('ASK')}
          >
            Sell
          </button>
        </div>
      )}

      {/* Order Type Tabs */}
      <div className="order-type-tabs">
        {basicTypes.map(t => (
          <button key={t} className={`type-tab ${orderType === t ? 'active' : ''}`} onClick={() => setOrderType(t)}>
            {ORDER_TYPE_LABELS[t]}
          </button>
        ))}
        <button
          className={`type-tab type-tab-more ${showAdvanced || SYNTHETIC_TYPES.includes(orderType) ? 'active' : ''}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          More
        </button>
      </div>

      {/* Advanced order types */}
      {showAdvanced && (
        <div className="order-type-tabs order-type-tabs-advanced">
          {advancedTypes.map(t => (
            <button key={t} className={`type-tab ${orderType === t ? 'active' : ''}`} onClick={() => { setOrderType(t); setShowAdvanced(false); }}>
              {ORDER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {/* Time-in-Force selector */}
      <div className="tif-tabs">
        {(Object.keys(TIF_LABELS) as TimeInForce[]).map(tif => (
          <button
            key={tif}
            className={`tif-tab ${timeInForce === tif ? 'active' : ''}`}
            onClick={() => setTimeInForce(tif)}
          >
            {TIF_LABELS[tif]}
          </button>
        ))}
      </div>

      {/* Side-by-side Buy/Sell Forms (desktop) or single form (mobile) */}
      <div className={`order-forms-row ${isMobile ? `mobile-side-${mobileSide === 'BID' ? 'buy' : 'sell'}` : ''}`}>
        <OrderSideForm
          side="BID"
          market={market}
          orderType={orderType}
          timeInForce={timeInForce}
          onSubmitOrder={onSubmitOrder}
          loading={loading}
          externalPrice={externalPrice}
        />
        <div className="form-divider" />
        <OrderSideForm
          side="ASK"
          market={market}
          orderType={orderType}
          timeInForce={timeInForce}
          onSubmitOrder={onSubmitOrder}
          loading={loading}
          externalPrice={externalPrice}
        />
      </div>
    </div>
  );
}
