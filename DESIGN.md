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

## Admin console (`/admin`)

The 2026-07-06 admin polish pass (PRs #52–#55) applied the same doctrine to
the operator console. Same rules: identity from materials, no ornamental FX,
data loud and chrome quiet.

### Signature element: the cluster rail

The admin mirror of the ticker rail (`ClusterRail.tsx`, one per cluster since
the multi-cluster restructure). Fixed-height (64px) surface; a state-toned
`border-l-2` rule + status dot + display-face hero title ("Cluster Healthy")
on the left; a display-name chip + tabular stat tiles (Nodes, Leader, Commit)
in the middle; cluster operations on the right. The fleet Services/Memory
tiles moved OFF the rail to the Overview tab (they are stack-wide, not
per-cluster). Invariants:

- The thin hairline across the rail's top edge is the **operation progress
  bar** — it is data, not ornament. Keep it.
- The operations slot is **reserved-width** AND **capability-gated**: Rolling
  Update / Housekeeping / Snapshot render only for clusters that support them,
  and swap with the operation percent without the rail ever resizing. A
  cluster with no ops shows a faint dash so the slot never collapses.
- The rail chrome mounts immediately; tiles render pulsing dashes until
  data arrives. The rail itself must **never** swap with a skeleton.

### State → color semantics

`components/admin/status.ts` is the single source. buy = healthy/leader/
running; **followers are quiet-healthy** (buy dot, buy-soft badge, hairline
card rule — the leader keeps the loud buy rule; a healthy cluster must read
all-green at a glance); warn is **reserved for transitional** states
(starting/rejoining/election); sell = failed/stopping; faint =
offline/stopped; accent = operation in progress. Do not map a steady state
to warn again — amber followers made a healthy cluster look half-broken.

### Confirmation

All mutating admin actions confirm through the one `ConfirmModal`
(tri-tone soft treatment: danger=sell, warning=warn, primary=buy — tinted
surface + toned text, never a solid fill). The housekeeping 409 → force
re-prompt is a **safety flow**: the server's refusal is quoted and the
override is a second, explicitly dangerous confirm. Never collapse it into
one step.

### Notifications

- Action results are overlay **toasts** (`Toasts.tsx`, bottom-right,
  stable monotonic keys, sticky for errors). Never a layout-shifting
  banner.
- Connectivity is **persistent state**, not an event: the reserved-width
  gateway pill in the header (live / degraded / down). Poll failures must
  never emit per-tick toasts, and data stays on screen through an outage —
  the pill carries the bad news.
- Field-validation errors stay inline next to the field, persistent until
  the input changes.

### Anti-flicker (the trading-page lessons, applied)

- Event feed rows keep stable `seq` keys, no per-row mount animation.
- Node/service cards always render their stats rows — stopped processes
  show dashes; a card never changes height because a process died.
- Skeletons only for never-loaded (`null`); loaded-and-empty renders a
  quiet notice. Never re-show skeletons over data.
- A stale operation must never wedge the console: empty progress frames
  clear an incomplete op, and `/progress` is re-checked while an operation
  looks active (the 71%-stuck-rail bug).

### Where things live

- Multi-cluster IA (Proposal A): fixed tabs Overview | Clusters | Services |
  Risk | Backup. The Clusters tab stacks one `ClusterSection` per `clusters[]`
  entry (rail + assets-only `MoneyHealthPanel` + node grid).
- Sections: `src/components/admin/{ClusterSection,ClusterRail,ClusterNodeGrid,MoneyHealthPanel,OverviewDashboard,ServicesSection,LogViewer,EventFeed,RiskAdmin,BackupOps}.tsx`
  (`ClusterRail`/`ClusterNodeGrid` were generalized in place from the former
  single-cluster `ClusterStatusBar`/`NodesSection`).
- Primitives: `src/components/admin/{ConfirmModal,Toasts}.tsx`, shared icons in `src/components/Icons.tsx`
- Semantics/shapes/format/URLs: `src/components/admin/{status,types,format,buttonStyles,api}.ts`
  (`api.ts` = `ADMIN_BASE` + `adminUrl` + `normalizeStatus` dual-read)
- Page state + fetch/SSE wiring: `src/pages/AdminPage.tsx` (+ `src/hooks/useAdminEvents.ts`)
