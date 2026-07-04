// SPDX-License-Identifier: Apache-2.0
import type { Market } from '../../types/market';

interface MarketSelectorProps {
  markets: Market[];
  selectedMarket: Market;
  onSelectMarket: (market: Market) => void;
  isOverlay?: boolean;
  onClose?: () => void;
}

export function MarketSelector({ markets, selectedMarket, onSelectMarket, isOverlay, onClose }: MarketSelectorProps) {
  const handleSelect = (market: Market) => {
    onSelectMarket(market);
    if (onClose) onClose();
  };

  // ── Inline desktop dropdown: horizontal pill tabs ──
  if (!isOverlay) {
    return (
      <div className="flex items-center gap-1">
        {markets.map(market => {
          const active = selectedMarket.id === market.id;
          return (
            <button
              key={market.id}
              className={`whitespace-nowrap rounded-full border px-3 py-1 font-display text-[13px] font-medium transition-colors ${
                active
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-transparent text-muted hover:bg-surface-2 hover:text-text-strong'
              }`}
              onClick={() => handleSelect(market)}
            >
              {market.name}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Mobile full-screen bottom-sheet overlay ──
  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-end bg-black/70"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="animate-sheet-up flex max-h-[70vh] w-full flex-col overflow-y-auto rounded-t-2xl bg-surface">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface px-4 py-3">
          <span className="font-display text-[15px] font-semibold text-text-strong">Markets</span>
          <button
            className="-mr-1 flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text-strong"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Market list */}
        <div className="flex flex-col gap-px px-2 py-2 pb-6">
          {markets.map(market => {
            const active = selectedMarket.id === market.id;
            return (
              <button
                key={market.id}
                className={`flex min-h-[48px] items-baseline gap-2 rounded-md px-3 py-3 text-left transition-colors ${
                  active ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-2'
                }`}
                onClick={() => handleSelect(market)}
              >
                <span className="font-display text-[15px] font-medium">{market.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {market.baseAsset}/{market.quoteAsset}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
