# Trading UI — design decisions and invariants

This records the *intent* behind the 2026-07-06 design overhaul so future
changes extend it instead of accidentally undoing it. The code shows what;
this file is the why. All decisions below were made with and approved by
the product owner.

## Direction

**Precision instrument.** The demo's job is to make an engineer think
"this is a real exchange engine, running live" within seconds. Identity
comes from materials (tokens, type, data presentation), never from
decoration. Decorative effects (header beams, glows, gradients behind the
logo) were explicitly removed at the owner's request — do not reintroduce
ornamental FX on the trading page.

## Layout (desktop)

Kraken-style right rail, chosen over a Binance-style center form:

- 3-column grid: order book | chart + bottom strip | order form + tape.
- The order form is ALWAYS visible (primary action, zero clicks), single
  side with a Buy/Sell toggle. Recent trades sit under it, always visible.
- The bottom strip (Open Orders | History) has a FIXED height. Invariant:
  **the chart must never resize when switching tabs** — the strip is
  fixed-height precisely so the chart's flex remainder is constant.
- Account lives in a header slide-over (username pill), not a tab: balances
  must not compete with trading real estate. The form shows "Avbl" inline.
- Mobile keeps its own branches (tab bar + sheets); not yet redesigned.

## Non-negotiable behaviors (each fixed a reported problem)

1. **Order book shows all 20 levels per side, no scrolling.** Both sides
   are fixed 20-slot CSS grids (`grid-rows-[repeat(20,minmax(0,1fr))]`);
   rows share the side's height at any viewport. Never revert to
   content-height rows + scroll: a `justify-end` flex scroll container
   cannot scroll to its overflow (that was the clipped-asks bug), and the
   owner's goal is 20+20 visible at once. Asks stay bottom-anchored (pad
   slots at the top) so the best ask touches the spread row.
2. **Nothing flickers on market switch.** Stats are nullable and render
   dashes (never $0.00); the chart keeps old candles under a loading veil
   (never blanks); book/tape show pulse skeletons. `candlesMarketRef`
   guards cross-market candle appends.
3. **Tick arrows are persistent.** The rail price and book mid price show
   the direction of the LAST move in a fixed-width slot (invisible
   placeholder before the first tick). Transient-only arrows made the
   price jitter sideways; only the color flash may be transient.
4. **Trade tape rows use stable keys and no per-row mount animation.**
   Index-shifted keys remounted every row per batch and left the tape
   permanently mid-fade (~10% opacity).
5. **Number inputs blur on wheel.** Scrolling the panel over a focused
   input silently stepped its value.
6. **The form snaps prices to the engine tick** (MARKETS carries
   tickSize/minPrice/maxPrice) and out-of-range is a hard inline error;
   async REJECTED events surface as a red notice. An accepted order must
   never vanish silently.
7. **No client-side ownership filtering.** Open Orders comes from the
   user-scoped OMS surfaces (REST seed + /ws/v1 stream). Never filter a
   shared feed by userId in the frontend.

## Type

- Numbers are **Inter with tabular figures** (exchange-style), not
  monospace — the owner rejected the terminal-mono look as hard to read.
  `--font-mono` intentionally points at Inter; body sets `tabular-nums`.
- **Space Grotesk** is the display face: wordmark, panel identity, and the
  one typographic hero — the last price in the rail (26px bold).
- Panel titles are quiet micro caps (11px, uppercase, tracked, text-faint):
  chrome recedes, data is the loudest thing on screen.

## Color

- **Dark = brand ink**: every surface and hairline carries a blue
  undertone derived from the logo (`#0c1017` → `#1e2735`, hairlines
  `rgba(140,170,255,…)`). This IS the identity — keep the undertone if
  surfaces change.
- **Light = instrument gray-blue** (cooled from the website's warm cream)
  so both themes share the undertone.
- Trade colors are deliberately energetic (dark: buy `#35c98a`, sell
  `#f2635a`) and must stay WCAG AA on their surfaces.
- The chart palette in `Chart.tsx` mirrors these tokens by hand — update
  both together.

## Signature element

The **spread row** in the order book: sell pressure bleeds in as a faint
gradient from the ask side above, buy pressure from the bid side below,
and the mid price ticks with the market. It encodes what an exchange is —
the meeting point of two sides. Keep it subtle; it is the page's one
deliberate flourish.

## Where things live

- Tokens/themes/keyframes/scrollbars/focus: `src/index.css`
- Market grid + strip + rail composition: `src/App.tsx`
- Engine price grid + snapping: `src/types/market.ts`, `src/utils/ticks.ts`
- Balances context: `src/hooks/useBalances.tsx`
- Account slide-over: `src/components/Account/AccountDrawer.tsx`
