// SPDX-License-Identifier: Apache-2.0
/**
 * Chart in a side slot. The chart's own toolbar answers to its container
 * width (container queries in Chart.tsx), so it fits a 280 or 340 px slot.
 */
import type { CandleData } from '../../types/market';
import type { Theme } from '../../hooks/useTheme';
import { Chart } from '../../components/Chart/Chart';
import type { SlotChrome } from '../layout/SideColumn';
import { PanelFrame } from './PanelFrame';

export interface ChartData {
  candles: CandleData[];
  currentCandle: CandleData | null;
  activeInterval: string;
  onIntervalChange: (interval: string) => void;
  loading: boolean;
}

export interface ChartPanelProps {
  chrome: SlotChrome;
  symbol: string;
  theme: Theme;
  chart: ChartData;
}

export function ChartPanel({ chrome, symbol, theme, chart }: ChartPanelProps) {
  return (
    <PanelFrame label="Chart" position={chrome.position} header={chrome.picker()} scroll={false}>
      <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1">
        <Chart
          candles={chart.candles}
          currentCandle={chart.currentCandle}
          symbol={symbol}
          theme={theme}
          onIntervalChange={chart.onIntervalChange}
          activeInterval={chart.activeInterval}
          loading={chart.loading}
        />
      </div>
    </PanelFrame>
  );
}
