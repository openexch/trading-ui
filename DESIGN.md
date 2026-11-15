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

## Identity: the ledger (approved 2026-11-16, being built)

The engines' logs are the identity: the screen shows the system running, not
only a market. Approved by the owner on 2026-11-16; it is built as the
backend supplies each value, and until then rule 14 applies (a dash, never an
invented number). It replaces the planned header engine rail.

- **Log positions are visible.** The header carries the core and ME log
  positions, the term and the node count. Each tape row carries the log
  position of its trade.
- **Motor panel** (a side-slot panel): for each cluster (core, ME), each
  node's role, commit position and entries behind the leader; the last
  snapshot with each node's state hash and whether they match; the last
  election; the bridge's position; each component's version and build
  commit, linked to its public repository. A diverged hash is shown and
  names the node.
- **Order trail**: an own order opens its path (gateway, core accept and
  hold, forward, ME booked, ME matched, core settled), each step with its
  time, delta and log position.
- **Elections are ledger rows.** A leader change is written into the tape
  (start and end rows) and the header counter switches to a warning state;
  order entry says it is waiting and that nothing is lost.
- **Balance ledger**: a balance opens its movements, each with its core log
  position, above a per-asset conservation line.
- **Materials**: the light theme becomes paper (a warm off-white ground,
  ink-blue wordmark and log numbers); ledger rules (a row hairline, a double
  rule either side of the price column, a heavy rule under headers and
  around the spread row) are structure, not ornament. Dark keeps the brand
  ink. Trade colours keep their AA pairs on the new ground.

## Layout (desktop)

- A **centre ladder**: the price column with bids on the left and asks on
  the right. The ladder IS order entry; there is no separate order form. It
  fills the centre column up to a 1200 px frame, centred, so the depth
  columns never become absurdly wide. From 2140 px the screen switches to
  wide mode: the ladder column is exactly a 960 px frame and three side
  columns share the rest, so no gutter opens beside the ladder at any width
  (2140 is where the 1200 px frame would stop filling a standard centre,
  1202 / 0.56). The defaults bar and the staging
  strip share that frame: their content lines up with the ladder's edges,
  their background and hairline span the column. At 1440 the side columns
  stay 340 px and the ladder fills the 758 px between them.
- An always-visible **staging strip** above the ladder: a click (or B / S)
  stages an order there; Enter places it, Esc clears it. Results (accepted,
  rejected with the code) land in the same strip.
- An **order defaults bar** above the strip: size presets and size input, one
  Type · Time-in-force picker, and the one-click switch at the far right.
- **Side slots** around the ladder, two per column: four below 2140 px (340
  px wide at 1440), six in wide mode, where a far-right column shows all six
  panels at once. Six slots are always stored; below 2140 the far-right
  pair is hidden and keeps its panels, so crossing the breakpoint changes
  nothing stored.
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
   placeholder before the first tick). Only a colour flash and the depth
   bar's width change (150 ms ease-out, off under reduced motion) may be
   transient.
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
   is committing to a price.** The centre row sits between the best ask and
   the best bid and carries the last trade price (with its tick direction)
   and the spread; before the first trade it carries the spread only. The
   ladder re-centres on every change, also while the pointer is over it and
   while it has focus. It pins only while one-click is armed, while an order
   is staged and while a menu or popover is open; when that ends it
   re-centres. An explicit scroll (wheel, finger drag, PageUp / PageDown, a
   jump marker) also moves away from the centre and holds until Re-centre,
   C, Esc, or the end of the pin above; a pinned window holds its prices
   while levels come and go. Re-centre shows whenever the ladder is not
   centred. Keyboard focus follows a price, not a row: when the ladder
   re-centres under a focused row, focus stays on that price while it is
   visible, otherwise on the nearest visible price. Because a click only
   stages (rule 10), a row that moved between aim and click shows its real
   price in the strip before anything is placed; one-click, the one path
   without that check, pins.
9. **Only engine prices.** A row is a price at which the engine's book has
   a level, on either side; there are no rows for empty prices, prices
   beyond the published depth or prices outside the market's range. Every
   market groups by one tick by default, so a row's price is the level's
   price; a coarser grouping is the user's choice and shows only groups
   that hold a level. A price with no level is entered in the Price field
   of the order bar (Buy limit / Sell limit); clicking a row also writes
   its price there.
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
    (portfolio total, live fills, GTD expiry),
    the UI shows a dash or leaves the control out; it never fabricates one.
    Other markets' prices come only from the gateway's all-market TICKERS
    frame; a market with no entry there shows a dash.
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
is not AA on a bar). The deepest known rung, when part of its
price group lies beyond the known depth, prints both numbers as lower
bounds (≥). In the price column the leading digits every visible rung
shares (the big figure) print in `--muted` (AA on the column and on the
own-order row tints) and the differing tail keeps the side colour, as FX
ladders do; across a decade boundary nothing is quieted, the cell is read
as one number, and the spread row's last price is never split. The hover preview of a click ("Buy 0.25") sits on the bar, so it
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

The **spread row**: a row of its own between the best ask row and the best
bid row (24 px desktop, 32 px phone), a thin rule fading from buy to sell,
with the last trade price (and its tick direction) and the spread in the
price column. It never overlaps a row: its height is set aside before the
row count is taken (rule 1), and it is always the vertical middle (rule 8).
A one-sided book says "No bids" or "No asks"; a locked or crossed book says
so. It encodes the meeting point of the two sides and the price they last
met at. The last price shows only here, never as a marked row.

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
