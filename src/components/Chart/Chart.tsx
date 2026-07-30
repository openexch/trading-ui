// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  MouseEventParams,
  IPriceLine,
} from 'lightweight-charts';
import type { CandleData } from '../../types/market';

// ── Types ──────────────────────────────────────────────────────
type Theme = 'light' | 'dark';

interface ChartProps {
  candles: CandleData[];
  currentCandle: CandleData | null;
  symbol: string;
  onIntervalChange: (interval: string) => void;
  activeInterval: string;
  theme: Theme;
  /** Market switch / interval fetch in flight: the previous candles stay
   *  mounted (no blank flash) under a dimming overlay until the new data
   *  replaces them. */
  loading?: boolean;
}

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
type ChartType = 'candle' | 'line' | 'area';

interface OhlcvDisplay {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
  isUp: boolean;
}

interface MaValues {
  ma7: number | null;
  ma25: number | null;
  ma99: number | null;
}

// ── Constants ──────────────────────────────────────────────────
const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const MA_COLORS = {
  ma7: '#fbbf24',
  ma25: '#c084fc',
  ma99: '#818cf8',
} as const;

// ── Theme palettes ─────────────────────────────────────────────
// lightweight-charts renders to canvas and cannot read CSS variables,
// so the chart's colors live here as JS values mirroring the app tokens.
interface ChartPalette {
  background: string;
  textColor: string;
  gridLine: string;
  border: string;
  crosshair: string;
  crosshairLabelBg: string;
  up: string;
  down: string;
  upVol: string;
  downVol: string;
  volMa: string;
  accent: string;
  accentArea0: string;
  accentArea1: string;
}

const PALETTES: Record<Theme, ChartPalette> = {
  dark: {
    background: '#10151d',
    textColor: '#8b95a7',
    gridLine: 'rgba(140,170,255,0.05)',
    border: 'rgba(140,170,255,0.09)',
    crosshair: '#8b95a7',
    crosshairLabelBg: '#1e2735',
    up: '#35c98a',
    down: '#f2635a',
    upVol: 'rgba(53,201,138,0.25)',
    downVol: 'rgba(242,99,90,0.25)',
    volMa: '#8b95a7',
    accent: '#5b9bff',
    accentArea0: 'rgba(91,155,255,0.30)',
    accentArea1: 'rgba(91,155,255,0.02)',
  },
  light: {
    background: '#ffffff',
    textColor: '#5c6470',
    gridLine: 'rgba(30,60,120,0.06)',
    border: '#e3e7ee',
    crosshair: '#5c6470',
    crosshairLabelBg: '#e6e9f0',
    up: '#16a36a',
    down: '#e5484d',
    upVol: 'rgba(22,163,106,0.20)',
    downVol: 'rgba(229,72,77,0.20)',
    volMa: '#9b9182',
    accent: '#1f63d6',
    accentArea0: 'rgba(31,99,214,0.28)',
    accentArea1: 'rgba(31,99,214,0.02)',
  },
};

// Throttle chart updates to avoid overwhelming the browser under high load
const UPDATE_THROTTLE_MS = 100;

// ── Helpers ────────────────────────────────────────────────────
function calcMA(data: CandleData[], period: number): (LineData | null)[] {
  const result: (LineData | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j].close;
      }
      result.push({
        time: data[i].time as Time,
        value: sum / period,
      });
    }
  }
  return result;
}

function calcVolumeMA(data: CandleData[], period: number): (LineData | null)[] {
  const result: (LineData | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j].volume;
      }
      result.push({
        time: data[i].time as Time,
        value: sum / period,
      });
    }
  }
  return result;
}

function formatPrice(v: number | undefined | null): string {
  const n = v ?? 0;
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatVolume(v: number | undefined | null): string {
  const n = v ?? 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(2);
}

function getMaValueAtIndex(maData: (LineData | null)[], index: number): number | null {
  if (index < 0 || index >= maData.length) return null;
  return maData[index]?.value ?? null;
}

// lightweight-charts draws UNIX timestamps as UTC, so the axis/crosshair ran
// 3h behind local wall clocks. Shift each candle to the viewer's local time
// at that instant (per-timestamp offset, so DST transitions stay correct).
// Display-only: the shift lives entirely inside this component — candle data
// upstream stays true UTC.
function toLocalChartTime(utcSeconds: number): number {
  return utcSeconds - new Date(utcSeconds * 1000).getTimezoneOffset() * 60;
}

function isValidCandle(c: CandleData | null): c is CandleData {
  if (!c) return false;
  return (
    c.time != null &&
    c.open != null && !isNaN(c.open) && isFinite(c.open) &&
    c.high != null && !isNaN(c.high) && isFinite(c.high) &&
    c.low != null && !isNaN(c.low) && isFinite(c.low) &&
    c.close != null && !isNaN(c.close) && isFinite(c.close) &&
    c.volume != null && !isNaN(c.volume) && isFinite(c.volume)
  );
}

// ── Component ──────────────────────────────────────────────────
export function Chart({ candles: utcCandles, currentCandle: utcCurrentCandle, symbol, onIntervalChange, activeInterval, theme, loading }: ChartProps) {
  // Local-time shadows of the candle props — everything below renders these,
  // so the whole component (axis, crosshair lookups, MAs, updates) stays
  // consistent in one clock.
  const candles = useMemo(
    () => utcCandles.map(c => (c?.time != null ? { ...c, time: toLocalChartTime(c.time) } : c)),
    [utcCandles]
  );
  const currentCandle = useMemo(
    () => (utcCurrentCandle?.time != null
      ? { ...utcCurrentCandle, time: toLocalChartTime(utcCurrentCandle.time) }
      : utcCurrentCandle),
    [utcCurrentCandle]
  );

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // The crosshair handler lives in the mount-once init effect; give it a ref
  // so it reads the current candles, not the mount-time (empty) array.
  const candlesRef = useRef<CandleData[]>(candles);
  candlesRef.current = candles;

  // Live palette ref so data/update effects can color series without
  // re-subscribing to `theme` (keeps the chart from being recreated).
  const palette = PALETTES[theme];
  const paletteRef = useRef<ChartPalette>(palette);
  paletteRef.current = palette;

  // Main series refs
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // MA series refs
  const ma7Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma25Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ma99Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const volMaRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Price line ref
  const priceLineRef = useRef<IPriceLine | null>(null);

  // Throttle ref for real-time updates
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<CandleData | null>(null);
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MA data cache for crosshair lookup
  const maDataRef = useRef<{ ma7: (LineData | null)[]; ma25: (LineData | null)[]; ma99: (LineData | null)[] }>({
    ma7: [], ma25: [], ma99: [],
  });

  const hasInitialFitRef = useRef(false);
  const lastCandleCountRef = useRef(0);

  // State
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [ohlcv, setOhlcv] = useState<OhlcvDisplay | null>(null);
  const [maValues, setMaValues] = useState<MaValues>({ ma7: null, ma25: null, ma99: null });

  // Compute last candle's OHLCV for default display
  const lastOhlcv = useMemo<OhlcvDisplay | null>(() => {
    const src = currentCandle || (candles.length > 0 ? candles[candles.length - 1] : null);
    if (!isValidCandle(src)) return null;
    const change = src.close - src.open;
    const changePct = src.open !== 0 ? (change / src.open) * 100 : 0;
    return {
      open: src.open,
      high: src.high,
      low: src.low,
      close: src.close,
      volume: src.volume,
      change,
      changePct,
      isUp: src.close >= src.open,
    };
  }, [candles, currentCandle]);

  // Compute last MA values for default display
  const lastMaValues = useMemo<MaValues>(() => {
    if (candles.length === 0) return { ma7: null, ma25: null, ma99: null };
    const ma7Data = calcMA(candles, 7);
    const ma25Data = calcMA(candles, 25);
    const ma99Data = calcMA(candles, 99);
    return {
      ma7: getMaValueAtIndex(ma7Data, ma7Data.length - 1),
      ma25: getMaValueAtIndex(ma25Data, ma25Data.length - 1),
      ma99: getMaValueAtIndex(ma99Data, ma99Data.length - 1),
    };
  }, [candles]);

  // Display values: crosshair data or defaults
  const displayOhlcv = ohlcv || lastOhlcv;
  const displayMa = ohlcv ? maValues : lastMaValues;

  // ── Initialize chart (once) ──
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const p = paletteRef.current;
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: p.background },
        textColor: p.textColor,
        fontFamily: "'JetBrains Mono', 'SF Mono', Monaco, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: p.gridLine },
        horzLines: { color: p.gridLine },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: p.crosshair,
          labelBackgroundColor: p.crosshairLabelBg,
        },
        horzLine: {
          color: p.crosshair,
          labelBackgroundColor: p.crosshairLabelBg,
        },
      },
      rightPriceScale: {
        borderColor: p.border,
        scaleMargins: { top: 0.05, bottom: 0.25 },
        autoScale: true,
      },
      timeScale: {
        borderColor: p.border,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
        minBarSpacing: 2,
        rightOffset: 5,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    // Volume series (always present, under everything)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // Volume MA
    const volMa = chart.addSeries(LineSeries, {
      color: p.volMa,
      lineWidth: 1,
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    volMaRef.current = volMa;

    // ── Crosshair handler ──
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param.time || !param.seriesData) {
        setOhlcv(null);
        setMaValues({ ma7: null, ma25: null, ma99: null });
        return;
      }

      // Find candle data from whatever main series is active
      let candleItem: CandlestickData | null = null;
      if (candleSeriesRef.current) {
        const d = param.seriesData.get(candleSeriesRef.current);
        if (d && 'open' in d) candleItem = d as CandlestickData;
      }

      // For line/area mode, look up from source candles array
      if (!candleItem) {
        // Find candle by time
        const t = param.time;
        const found = candlesRef.current.find(c => c.time === t);
        if (found) {
          candleItem = {
            time: found.time as Time,
            open: found.open,
            high: found.high,
            low: found.low,
            close: found.close,
          };
        }
      }

      if (candleItem) {
        const volData = param.seriesData.get(volumeSeriesRef.current!);
        const vol = volData && 'value' in volData ? (volData as { value: number }).value : 0;
        const change = candleItem.close - candleItem.open;
        const changePct = candleItem.open !== 0 ? (change / candleItem.open) * 100 : 0;
        setOhlcv({
          open: candleItem.open,
          high: candleItem.high,
          low: candleItem.low,
          close: candleItem.close,
          volume: vol,
          change,
          changePct,
          isUp: candleItem.close >= candleItem.open,
        });
      }

      // MA values at crosshair position
      const timeVal = param.time;
      const { ma7, ma25, ma99 } = maDataRef.current;
      const findMaVal = (arr: (LineData | null)[]) => {
        const item = arr.find(d => d && d.time === timeVal);
        return item ? item.value : null;
      };
      setMaValues({
        ma7: findMaVal(ma7),
        ma25: findMaVal(ma25),
        ma99: findMaVal(ma99),
      });
    });

    // ResizeObserver
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      areaSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ma7Ref.current = null;
      ma25Ref.current = null;
      ma99Ref.current = null;
      volMaRef.current = null;
      priceLineRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-apply theme colors without recreating the chart ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const p = PALETTES[theme];

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: p.background },
        textColor: p.textColor,
      },
      grid: {
        vertLines: { color: p.gridLine },
        horzLines: { color: p.gridLine },
      },
      crosshair: {
        vertLine: { color: p.crosshair, labelBackgroundColor: p.crosshairLabelBg },
        horzLine: { color: p.crosshair, labelBackgroundColor: p.crosshairLabelBg },
      },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border },
    });

    // Recolor series (candle/volume/price-line) for the new theme.
    if (candleSeriesRef.current) {
      candleSeriesRef.current.applyOptions({
        upColor: p.up,
        downColor: p.down,
        borderUpColor: p.up,
        borderDownColor: p.down,
        wickUpColor: p.up,
        wickDownColor: p.down,
      });
    }
    if (volMaRef.current) {
      volMaRef.current.applyOptions({ color: p.volMa });
    }
    if (volumeSeriesRef.current) {
      // Re-color each volume bar (per-bar color overrides series options).
      const recolored = candles
        .filter(c =>
          c.time != null &&
          c.close != null && !isNaN(c.close) && isFinite(c.close) &&
          c.open != null && !isNaN(c.open) && isFinite(c.open) &&
          c.volume != null && !isNaN(c.volume) && isFinite(c.volume)
        )
        .map(c => ({
          time: c.time as Time,
          value: Number(c.volume) || 0,
          color: c.close >= c.open ? p.upVol : p.downVol,
        }));
      // Dedup + sort to satisfy lightweight-charts ordering invariant.
      const m = new Map<number, HistogramData>();
      for (const d of recolored) m.set(d.time as number, d);
      volumeSeriesRef.current.setData(
        Array.from(m.values()).sort((a, b) => (a.time as number) - (b.time as number))
      );
    }
    if (priceLineRef.current) {
      const last = candles[candles.length - 1];
      if (last) {
        priceLineRef.current.applyOptions({
          color: last.close >= last.open ? p.up : p.down,
        });
      }
    }
  }, [theme, candles]);

  // ── Create/recreate main series when chart type changes ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old main series
    if (candleSeriesRef.current) {
      chart.removeSeries(candleSeriesRef.current);
      candleSeriesRef.current = null;
    }
    if (lineSeriesRef.current) {
      chart.removeSeries(lineSeriesRef.current);
      lineSeriesRef.current = null;
    }
    if (areaSeriesRef.current) {
      chart.removeSeries(areaSeriesRef.current);
      areaSeriesRef.current = null;
    }

    // Remove old MA series
    if (ma7Ref.current) { chart.removeSeries(ma7Ref.current); ma7Ref.current = null; }
    if (ma25Ref.current) { chart.removeSeries(ma25Ref.current); ma25Ref.current = null; }
    if (ma99Ref.current) { chart.removeSeries(ma99Ref.current); ma99Ref.current = null; }

    priceLineRef.current = null;

    // Create new main series
    const p = paletteRef.current;
    if (chartType === 'candle') {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: p.up,
        downColor: p.down,
        borderUpColor: p.up,
        borderDownColor: p.down,
        wickUpColor: p.up,
        wickDownColor: p.down,
        // The current price on the axis is drawn by our own up/down-colored dashed
        // price line (createPriceLine below). Suppress the series' built-in
        // last-value label + line so the axis doesn't show two identical prices.
        lastValueVisible: false,
        priceLineVisible: false,
      });
      candleSeriesRef.current = s;
    } else if (chartType === 'line') {
      const s = chart.addSeries(LineSeries, {
        color: p.accent,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: p.accent,
      });
      lineSeriesRef.current = s;
    } else {
      const s = chart.addSeries(AreaSeries, {
        topColor: p.accentArea0,
        bottomColor: p.accentArea1,
        lineColor: p.accent,
        lineWidth: 2,
        crosshairMarkerVisible: true,
      });
      areaSeriesRef.current = s;
    }

    // Recreate MA series (on top of main series)
    const ma7Series = chart.addSeries(LineSeries, {
      color: MA_COLORS.ma7,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    ma7Ref.current = ma7Series;

    const ma25Series = chart.addSeries(LineSeries, {
      color: MA_COLORS.ma25,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    ma25Ref.current = ma25Series;

    const ma99Series = chart.addSeries(LineSeries, {
      color: MA_COLORS.ma99,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    ma99Ref.current = ma99Series;

    // Force data reload
    hasInitialFitRef.current = false;
    lastCandleCountRef.current = 0;
  }, [chartType]);

  // ── Push candle data to chart ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!volumeSeriesRef.current) return;

    const mainSeries = candleSeriesRef.current || lineSeriesRef.current || areaSeriesRef.current;
    if (!mainSeries) return;

    // Filter out invalid candles (null/NaN/undefined values crash lightweight-charts)
    const validCandlesRaw = candles.filter(c =>
      c.time != null &&
      c.open != null && !isNaN(c.open) && isFinite(c.open) &&
      c.high != null && !isNaN(c.high) && isFinite(c.high) &&
      c.low != null && !isNaN(c.low) && isFinite(c.low) &&
      c.close != null && !isNaN(c.close) && isFinite(c.close) &&
      c.volume != null && !isNaN(c.volume) && isFinite(c.volume)
    );

    // Deduplicate by time (keep last occurrence) and sort ascending
    // lightweight-charts crashes on duplicate timestamps
    const candleMap = new Map<number, CandleData>();
    for (const c of validCandlesRaw) {
      candleMap.set(c.time, c);
    }
    const validCandles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);

    if (validCandles.length === 0) {
      mainSeries.setData([]);
      volumeSeriesRef.current.setData([]);
      if (ma7Ref.current) ma7Ref.current.setData([]);
      if (ma25Ref.current) ma25Ref.current.setData([]);
      if (ma99Ref.current) ma99Ref.current.setData([]);
      if (volMaRef.current) volMaRef.current.setData([]);
      lastCandleCountRef.current = 0;
      hasInitialFitRef.current = false;
      return;
    }

    try {
      // Main series data
      if (chartType === 'candle') {
        const data: CandlestickData[] = validCandles.map(c => ({
          time: c.time as Time,
          open: Number(c.open) || 0,
          high: Number(c.high) || 0,
          low: Number(c.low) || 0,
          close: Number(c.close) || 0,
        }));
        (mainSeries as ISeriesApi<'Candlestick'>).setData(data);
      } else {
        const data: LineData[] = validCandles.map(c => ({
          time: c.time as Time,
          value: Number(c.close) || 0,
        }));
        (mainSeries as ISeriesApi<'Line'>).setData(data);
      }

      // Volume data
      const p = paletteRef.current;
      const volumeData: HistogramData[] = validCandles.map(c => ({
        time: c.time as Time,
        value: Number(c.volume) || 0,
        color: c.close >= c.open ? p.upVol : p.downVol,
      }));
      volumeSeriesRef.current.setData(volumeData);

      // MA data
      const ma7Data = calcMA(validCandles, 7);
      const ma25Data = calcMA(validCandles, 25);
      const ma99Data = calcMA(validCandles, 99);
      maDataRef.current = { ma7: ma7Data, ma25: ma25Data, ma99: ma99Data };

      if (ma7Ref.current) ma7Ref.current.setData(ma7Data.filter(Boolean) as LineData[]);
      if (ma25Ref.current) ma25Ref.current.setData(ma25Data.filter(Boolean) as LineData[]);
      if (ma99Ref.current) ma99Ref.current.setData(ma99Data.filter(Boolean) as LineData[]);

      // Volume MA
      const volMaData = calcVolumeMA(validCandles, 20);
      if (volMaRef.current) volMaRef.current.setData(volMaData.filter(Boolean) as LineData[]);

      // Current price line
      const lastCandle = validCandles[validCandles.length - 1];
      if (lastCandle && chartType === 'candle' && candleSeriesRef.current) {
        if (priceLineRef.current) {
          candleSeriesRef.current.removePriceLine(priceLineRef.current);
        }
        const isUp = lastCandle.close >= lastCandle.open;
        priceLineRef.current = candleSeriesRef.current.createPriceLine({
          price: lastCandle.close,
          color: isUp ? p.up : p.down,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });
      }
    } catch (err) {
      console.warn('Chart setData error:', err);
    }

    lastCandleCountRef.current = validCandles.length;

    if (!hasInitialFitRef.current) {
      chart.timeScale().fitContent();
      hasInitialFitRef.current = true;
    }
  }, [candles, chartType]);

  // ── Update current candle in real-time (throttled) ──
  useEffect(() => {
    if (!currentCandle) return;

    // Validate currentCandle to avoid crashes
    if (!isValidCandle(currentCandle)) {
      return;
    }

    // Store pending update
    pendingUpdateRef.current = currentCandle;

    const applyUpdate = (candle: CandleData) => {
      const p = paletteRef.current;
      try {
        // Update main series
        if (chartType === 'candle' && candleSeriesRef.current) {
          candleSeriesRef.current.update({
            time: candle.time as Time,
            open: Number(candle.open) || 0,
            high: Number(candle.high) || 0,
            low: Number(candle.low) || 0,
            close: Number(candle.close) || 0,
          });
        } else if (chartType === 'line' && lineSeriesRef.current) {
          lineSeriesRef.current.update({
            time: candle.time as Time,
            value: Number(candle.close) || 0,
          });
        } else if (chartType === 'area' && areaSeriesRef.current) {
          areaSeriesRef.current.update({
            time: candle.time as Time,
            value: Number(candle.close) || 0,
          });
        }

        // Update volume
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({
            time: candle.time as Time,
            value: Number(candle.volume) || 0,
            color: candle.close >= candle.open ? p.upVol : p.downVol,
          });
        }

        // Update price line
        if (priceLineRef.current && candleSeriesRef.current) {
          const isUp = candle.close >= candle.open;
          priceLineRef.current.applyOptions({
            price: Number(candle.close) || 0,
            color: isUp ? p.up : p.down,
          });
        }
      } catch (err) {
        console.warn('Chart update error:', err);
      }

      lastUpdateRef.current = Date.now();
    };

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    if (timeSinceLastUpdate >= UPDATE_THROTTLE_MS) {
      // Enough time has passed, update immediately
      applyUpdate(currentCandle);
    } else {
      // Schedule update for later (if not already scheduled)
      if (!updateTimeoutRef.current) {
        updateTimeoutRef.current = setTimeout(() => {
          updateTimeoutRef.current = null;
          if (pendingUpdateRef.current && isValidCandle(pendingUpdateRef.current)) {
            applyUpdate(pendingUpdateRef.current);
          }
        }, UPDATE_THROTTLE_MS - timeSinceLastUpdate);
      }
    }
  }, [currentCandle, chartType]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  // ── Reset fit on interval or market change ──
  // On a market switch the old candles stay mounted (loading overlay dims
  // them); resetting here makes the replacing history get its fitContent.
  useEffect(() => {
    hasInitialFitRef.current = false;
    lastCandleCountRef.current = 0;
  }, [activeInterval, symbol]);

  const handleIntervalChange = useCallback((newInterval: Interval) => {
    onIntervalChange(newInterval);
  }, [onIntervalChange]);

  const handleChartTypeChange = useCallback((type: ChartType) => {
    setChartType(type);
  }, []);

  // ── Render ──
  const upDownClass = (isUp: boolean) =>
    isUp ? 'text-buy font-medium' : 'text-sell font-medium';

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2">
        {/* Empty on mobile (both children hide); dropped outright so its gap
            does not indent the interval row. */}
        <div className="flex items-center gap-3 max-md:hidden">
          {/* The symbol is already in the ticker rail and the header picker on
              mobile; keeping a third copy pushed the interval row 12px past a
              360px screen and clipped "1D". */}
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-text max-md:hidden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px] text-muted">
              <path d="M3 3v18h18"/>
              <path d="M7 14l4-4 4 4 5-5"/>
            </svg>
            <span>{symbol}</span>
          </div>
          <div className="flex gap-px rounded-md border border-hairline bg-surface-2 p-px max-md:hidden">
            <button
              className={`flex h-[22px] w-[26px] items-center justify-center rounded-[5px] transition-colors ${chartType === 'candle' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
              onClick={() => handleChartTypeChange('candle')}
              title="Candlestick"
            >
              {/* Candlestick icon */}
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <rect x="3" y="2" width="2" height="12" rx="0.5" opacity="0.7"/>
                <rect x="7" y="4" width="2" height="8" rx="0.5" opacity="0.7"/>
                <rect x="11" y="1" width="2" height="10" rx="0.5" opacity="0.7"/>
              </svg>
            </button>
            <button
              className={`flex h-[22px] w-[26px] items-center justify-center rounded-[5px] transition-colors ${chartType === 'line' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
              onClick={() => handleChartTypeChange('line')}
              title="Line"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                <path d="M1 12l4-5 4 3 6-8"/>
              </svg>
            </button>
            <button
              className={`flex h-[22px] w-[26px] items-center justify-center rounded-[5px] transition-colors ${chartType === 'area' ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
              onClick={() => handleChartTypeChange('area')}
              title="Area"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" opacity="0.6" className="h-3.5 w-3.5">
                <path d="M1 14V12l4-5 4 3 6-8v12H1z"/>
              </svg>
            </button>
          </div>
        </div>
        {/* On mobile everything else in this row is hidden, so the intervals
            take the full width and share it equally — a short pill group under
            a full-width tab bar and over a full-width chart read as unfinished. */}
        <div className="flex gap-0.5 rounded-md border border-hairline bg-surface-2 p-0.5 max-md:w-full">
          {INTERVALS.map(iv => (
            <button
              key={iv}
              className={`rounded px-2.5 py-[3px] font-mono text-[11px] font-semibold uppercase tracking-wide transition-colors max-md:flex-1 ${activeInterval === iv ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
              onClick={() => handleIntervalChange(iv)}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area wrapper */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* OHLCV Legend Overlay */}
        {displayOhlcv && (
          <div className="pointer-events-none absolute left-2.5 top-1.5 z-10 flex flex-col gap-px font-mono text-[11px] leading-normal">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-normal text-faint">O</span>
              <span className={upDownClass(displayOhlcv.isUp)}>
                {formatPrice(displayOhlcv.open)}
              </span>
              <span className="text-[10px] font-normal text-faint">H</span>
              <span className={upDownClass(displayOhlcv.isUp)}>
                {formatPrice(displayOhlcv.high)}
              </span>
              <span className="text-[10px] font-normal text-faint">L</span>
              <span className={upDownClass(displayOhlcv.isUp)}>
                {formatPrice(displayOhlcv.low)}
              </span>
              <span className="text-[10px] font-normal text-faint">C</span>
              <span className={upDownClass(displayOhlcv.isUp)}>
                {formatPrice(displayOhlcv.close)}
              </span>
              <span className={`ml-0.5 text-[10px] font-medium ${displayOhlcv.isUp ? 'text-buy' : 'text-sell'}`}>
                {displayOhlcv.change >= 0 ? '+' : ''}{formatPrice(displayOhlcv.change)}
                ({(displayOhlcv.changePct ?? 0) >= 0 ? '+' : ''}{(displayOhlcv.changePct ?? 0).toFixed(2)}%)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-normal text-faint">Vol</span>
              <span className="font-medium text-muted">{formatVolume(displayOhlcv.volume)}</span>
            </div>
          </div>
        )}

        {/* MA Legend Overlay */}
        <div className="pointer-events-none absolute left-2.5 top-[38px] z-10 flex flex-wrap gap-3 font-mono text-[10px]">
          {displayMa.ma7 !== null && (
            <span className="whitespace-nowrap font-medium tracking-wide" style={{ color: MA_COLORS.ma7 }}>
              MA(7): {formatPrice(displayMa.ma7)}
            </span>
          )}
          {displayMa.ma25 !== null && (
            <span className="whitespace-nowrap font-medium tracking-wide" style={{ color: MA_COLORS.ma25 }}>
              MA(25): {formatPrice(displayMa.ma25)}
            </span>
          )}
          {displayMa.ma99 !== null && (
            <span className="whitespace-nowrap font-medium tracking-wide" style={{ color: MA_COLORS.ma99 }}>
              MA(99): {formatPrice(displayMa.ma99)}
            </span>
          )}
        </div>

        {/* Chart canvas */}
        <div className="min-h-0 w-full flex-1" ref={chartContainerRef} />

        {/* Empty state */}
        {candles.length === 0 && !currentCandle && !loading && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-12 w-12 opacity-25">
              <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="7" y="8" width="2" height="8" rx="0.5" strokeLinejoin="round"/>
              <rect x="11" y="5" width="2" height="11" rx="0.5" strokeLinejoin="round"/>
              <rect x="15" y="10" width="2" height="6" rx="0.5" strokeLinejoin="round"/>
            </svg>
            <span className="text-xs italic">Waiting for trade data...</span>
          </div>
        )}

        {/* Loading overlay — dims the outgoing candles during a market or
            interval switch instead of blanking the chart */}
        {loading && (
          <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-3 bg-surface/60 text-muted animate-fade-in">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-12 w-12 animate-pulse opacity-25">
              <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="7" y="8" width="2" height="8" rx="0.5" strokeLinejoin="round"/>
              <rect x="11" y="5" width="2" height="11" rx="0.5" strokeLinejoin="round"/>
              <rect x="15" y="10" width="2" height="6" rx="0.5" strokeLinejoin="round"/>
            </svg>
            <span className="text-xs italic">Loading {symbol}…</span>
          </div>
        )}
      </div>
    </div>
  );
}
