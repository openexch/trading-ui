# Trading UI: design decisions and invariants

This records the intent behind the trading screen so future changes extend it
instead of undoing it. The code shows what; this file is the why. Every
decision here was made with and approved by the product owner. The current
direction is the depth ladder (approved 2026-11-14); it replaces the
2026-07-06 right-rail layout, whose behaviour rules carry over below.

## Direction

**Precision instrument.** The screen's job is to make an engineer or a trader
think "this is a real exchange engine, running live" within seconds. Identity
comes from materials (tokens, type, data presentation), never from decoration.
No ornamental effects on the trading screen.

## Layout (desktop)

- A **centre ladder**: the price column with bids on the left and asks on
  the right. The ladder IS order entry; there is no separate order form. It
  fills the centre column up to a 1200 px frame, centred, so the depth
  columns never become absurdly wide on large screens (a 2522 px window gets
  a 1200 px frame in its 1560 px centre). The defaults bar and the staging
  strip share that frame: their content lines up with the ladder's edges,
  their background and hairline span the column. At 1440 the side columns
  stay 340 px and the ladder fills the 758 px between them.
- An always-visible **staging strip** above the ladder: a click (or B / S)
  stages an order there; Enter places it, Esc clears it. Results (accepted,
  rejected with the code) land in the same strip.
- An **order defaults bar** above the strip: size presets and size input, one
  Type · Time-in-force picker, and the one-click switch at the far right.
- **Four side slots** around the ladder (two per column, 340 px wide at 1440).
  Each slot's title is a picker: Markets, Trades, Chart, Open orders, Fills,
  Balances. A panel appears at most once; picking one that is open elsewhere
  swaps the two, so no slot is ever empty or doubled. Each column has a
  height handle between its two slots. Presets (Default, Scalper,
  Chart-heavy) and Reset are always available.
- The **header** carries the market symbol (a button that opens the market
  selector, so switching markets never depends on the panel layout), the
  ticker hero, the connection pill and the account.

## Phone

A separate branch at 768 px and below: the ladder is the main tab (44 px
rungs), tap stages into a bottom sheet with Place / Cancel, long-press opens
the order-type menu (a visible "More order types" button covers people who
cannot long-press), a floating Re-centre button, and a bottom nav (Ladder,
Chart, Orders, Trades). No one-click on touch.

## Non-negotiable behaviours

Each fixed a reported problem or protects money; keep them.

1. **A row is never shorter than its text, and the ladder never scrolls as a
   container.** Rungs have a fixed height (22 px desktop, 44 px phone). The
   rung count comes from a `ResizeObserver` on the rendered element, held in
   state (not a ref) so the effect cleanup disconnects the observer it
   created, after the spread row's height is set aside. Moving through prices shifts a virtual offset; it is never a
   `justify-end` overflow container (that was the clipped-asks bug).
2. **Nothing flickers on market switch.** Stats are nullable and render
   dashes (never $0.00); the chart keeps old candles under a loading veil;
   ladder rungs and lists show skeletons; never re-show skeletons over data.
3. **Tick arrows are persistent.** The header price and the last-trade rung
   show the direction of the last move in a fixed-width slot (an invisible
   placeholder before the first tick). Only a colour flash may be transient.
4. **Lists use stable keys and no per-row mount animation** (the tape, the
   orders list).
5. **Number inputs blur on wheel.**
6. **Prices snap to the engine tick** (`MARKETS` carries tickSize, minPrice,
   maxPrice); out of range is a hard inline error; an async REJECTED surfaces
   in the strip as an alert with its code. An accepted order never vanishes
   silently.
7. **No client-side ownership filtering.** Own orders come from the
   user-scoped OMS surfaces. Filtering that user-scoped feed by market is
   fine; filtering a shared feed by user is not.
8. **The last price is always centred; the ladder pins only while the user
   is committing to a price.** The last-trade rung is the middle row and the
   ladder re-centres on every change, also while the pointer is over it and
   while it has focus (before the first trade it centres on the middle of
   the best bid and best ask). It pins only while one-click is armed, while
   an order is staged and while a menu or popover is open; when that ends it
   re-centres. An explicit scroll (wheel, finger drag, PageUp / PageDown, a
   jump marker) also moves away from the centre and holds until Re-centre,
   C, Esc, or the end of the pin above. Re-centre shows whenever the ladder
   is not centred. Keyboard focus follows a price, not a row: when the
   ladder re-centres under a focused rung, focus stays on that price while
   it is visible, otherwise on the nearest visible price. Because a click
   only stages (rule 10), a rung that moved between aim and click shows its
   real price in the strip before anything is placed; one-click, the one
   path without that check, pins.
9. **Rungs beyond known depth render as unknown** (dimmed, no quantity, no
   cumulative, no depth bar), never as empty liquidity.
10. **Click stages, Enter places.** One-click is off by default, never
    persisted, and disarms on Esc, market switch, sign-out and any connection
    state other than connected. Market orders and Cancel all always need a
    second confirmation, even with one-click on.
11. **Keyboard.** The ladder grid is one tab stop (roving tabindex).
    Single-letter shortcuts fire only while the ladder has focus and never
    inside inputs; Tab keeps its normal meaning. Own orders are cycled with
    `[` and `]`. `?` opens the shortcut sheet.
12. **Only the staging strip is a live region.** Ladder data is never
    announced.
13. **Move is offered only where the backend can amend** (limit orders; it
    re-queues the order, and the label says so). Stops and icebergs offer
    Cancel only.
14. **No invented values.** Where the backend does not yet supply a value
    (other markets' live prices, portfolio total, live fills, GTD expiry),
    the UI shows a dash or leaves the control out; it never fabricates one.
15. **A panel changes size only through its handle, a preset or Reset**,
    never because data arrived or a tab changed.
16. **Layout persistence is versioned and validated on read**; anything
    unknown, duplicated or corrupt falls back to Default. Storage failures
    never throw.

## Depth on the ladder

Depth is **cumulative**: each side's bar is the volume from its best price
outward (best ask upwards, best bid downwards) to that rung, drawn solid from
the price edge outward, 3 px clear of the rung's top and bottom. Both sides
use one scale, the largest cumulative visible in the window, so their volumes
compare and the deepest visible rung on the heavier side fills its cell. A
cell shows the level quantity next to the price (`--text-strong`) and the
cumulative total, smaller and quieter, on the outer side (`--text`: `--muted`
is not AA on a bar). A known price with no level (a gap) carries the bar and
the cumulative but no quantity. The deepest known rung, when part of its
price group lies beyond the known depth, prints both numbers as lower
bounds (≥). The hover preview of a click ("Buy 0.25") sits on the bar, so it
is `--text-strong`; the side-coloured outline carries the side.

## Own orders on the ladder

An own order is visible three ways at its rung: a faint side-coloured row
tint, an outlined slice anchored at the price edge with width own quantity /
the bar scale (so the numbers stay readable on it; a cell with a slice prints
its cumulative in `--text-strong`), and a Mine chip showing filled /
original.
Own orders outside the visible window are summarised by "N above" and "N
below" markers that jump to the nearest one. Stop orders awaiting their
trigger are not in the book, so they appear in the orders panel, not on the
ladder.

## Type

- **Instrument Sans** for the interface and for numbers, with tabular figures
  (the owner rejected monospace numbers as hard to read).
- **Bricolage Grotesque** for display: the wordmark and the one typographic
  hero, the header ticker price.
- Panel titles are quiet micro caps (11 px, uppercase, tracked, muted): chrome
  recedes, data is the loudest thing on screen.

## Colour

- **Dark = brand ink**: surfaces and hairlines carry a blue undertone derived
  from the logo. Light is an instrument grey-blue with the same undertone,
  designed rather than inverted.
- Trade colours stay WCAG AA on their surfaces; every number on a depth bar
  or own-order slice (level, cumulative, hover preview) is AA, side-coloured
  marks on a bar reach 3:1, and interactive borders reach 3:1. A test
  asserts the pairs that matter.
- The chart palette mirrors the tokens by hand; a test guards the mirror.
- Scrollbars are thin and token-coloured, with a stable gutter on scrolling
  panels. Checkboxes and switches are drawn from the tokens over real inputs.

## Signature element

The **spread row**: a row of its own between the best ask rung and the best
bid rung (12 px desktop, 20 px phone), a thin rule fading from buy to sell,
labelled with the spread in the price column, plus the marked last-trade
rung. It never overlaps a rung: its height is set aside before the rung
count is taken (rule 1). With rungs inside the spread it sits in their
middle; a locked or crossed book says so. It encodes the meeting point of
the two sides. It carries no price: the header ticker is the only price
hero.

## Where things live

- Tokens, themes, fonts, scrollbars, focus: `src/index.css`
- Data (unchanged by the redesign): `src/hooks`, `src/types`, `src/config.ts`,
  `src/auth`
- Screen shells, ladder, panels, layout: `src/terminal`
- Primitives (menu, popover, dialog, checkbox, switch): `src/ui`
- Pure order-draft and market presentation logic: `src/trading`
- Engine price grid and snapping: `src/types/market.ts`, `src/utils/ticks.ts`

The design canvas with the approved screens: the "Trading UI yeni tasarım"
artifact (direction C and its detail boards).
