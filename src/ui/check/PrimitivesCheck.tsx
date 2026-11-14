// SPDX-License-Identifier: Apache-2.0
/**
 * Browser check page for the UI primitives: every primitive in its real
 * states, in whichever theme is active. Reachable only at
 * `?ui=ladder&check=primitives` and loaded as its own chunk, so it costs the
 * trading page nothing. No market data, no account calls.
 */
import { useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { ThemeToggle } from '../../components/ThemeToggle/ThemeToggle';
import {
  Checkbox,
  Dialog,
  Kbd,
  Menu,
  MenuGroup,
  MenuItem,
  MenuItemRadio,
  MenuSeparator,
  Popover,
  Switch,
  useMenuTrigger,
  useTickDirection,
} from '..';

const ORDERS = [
  { id: 'o1', label: 'Buy 0.25 at 97,380' },
  { id: 'o2', label: 'Sell 0.10 at 97,450' },
  { id: 'o3', label: 'Buy 1.00 at 97,200' },
];

const PANELS = ['Chart', 'Trades', 'Orders', 'Balances'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-hairline bg-surface p-5">
      <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

const BUTTON =
  'h-9 cursor-pointer rounded-lg border border-[color:var(--ctl,var(--hairline-strong))] bg-surface-2 px-3 text-[13px] text-text hover:border-accent';

export function PrimitivesCheck() {
  const { theme, toggle } = useTheme();

  const actions = useMenuTrigger();
  const picker = useMenuTrigger();
  const [panel, setPanel] = useState('Chart');
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [last, setLast] = useState('none yet');

  const popAnchor = useRef<HTMLButtonElement>(null);
  const [popOpen, setPopOpen] = useState(false);

  const [dlgOpen, setDlgOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const count = ORDERS.filter((o) => selected[o.id]).length;

  const [oneClick, setOneClick] = useState(false);
  const [compact, setCompact] = useState(true);

  const [price, setPrice] = useState<number | null>(97412);
  const { tick, dir } = useTickDirection(price);

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="min-h-full bg-bg p-4 text-text sm:p-8">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <h1 className="m-0 font-display text-[22px] font-bold text-text-strong">UI primitives</h1>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </header>
        <p className="m-0 text-muted" aria-live="polite">Last action: {last}</p>

        <Section title="Menu">
          <button type="button" className={BUTTON} {...actions.triggerProps}>
            Order actions
          </button>
          <Menu {...actions.menuProps} label="Orders at 97,380">
            <MenuItem tone="buy" hint="click" onSelect={() => setLast('Buy limit')}>Buy limit</MenuItem>
            <MenuItem tone="sell" onSelect={() => setLast('Sell stop loss')}>Sell stop loss</MenuItem>
            <MenuItem tone="sell" onSelect={() => setPopOpen(true)}>Sell stop limit…</MenuItem>
            <MenuItem tone="buy" disabled onSelect={() => setLast('Buy iceberg')}>Buy iceberg… (disabled)</MenuItem>
            <MenuSeparator />
            <MenuItem hint={<Kbd>Alt ↑↓</Kbd>} onSelect={() => setLast('Move')}>Move (re-queues)</MenuItem>
            <MenuItem hint={<Kbd>Del</Kbd>} onSelect={() => setLast('Cancel')}>Cancel</MenuItem>
          </Menu>

          <button type="button" className={BUTTON} {...picker.triggerProps}>
            Panel: {panel}
          </button>
          <Menu {...picker.menuProps} label="Show in this panel" className="w-[260px]">
            <MenuGroup label="Show in this panel">
              {PANELS.map((p) => (
                <MenuItemRadio key={p} checked={p === panel} hint={p === panel ? 'here' : 'right'} onSelect={() => setPanel(p)}>
                  {p}
                </MenuItemRadio>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onSelect={() => setLast('Reset layout')}>Reset layout</MenuItem>
          </Menu>

          <div
            onContextMenu={onContext}
            className="grid h-16 min-w-[200px] flex-1 place-items-center rounded-lg border border-dashed border-hairline-strong text-muted"
          >
            Right-click here for a context menu
          </div>
          <Menu open={ctx !== null} onClose={() => setCtx(null)} anchor={ctx ?? { x: 0, y: 0 }} label="Price 97,380">
            <MenuItem tone="buy" onSelect={() => setLast('Context: buy limit')}>Buy limit</MenuItem>
            <MenuItem tone="sell" onSelect={() => setLast('Context: sell stop')}>Sell stop loss</MenuItem>
          </Menu>
        </Section>

        <Section title="Popover">
          <button ref={popAnchor} type="button" className={BUTTON} onClick={() => setPopOpen((o) => !o)} aria-expanded={popOpen}>
            Sell stop limit…
          </button>
          <Popover
            open={popOpen}
            onClose={() => setPopOpen(false)}
            anchor={popAnchor}
            returnFocusRef={popAnchor}
            ignoreRefs={[popAnchor]}
            label="Stop limit order"
            className="w-[300px]"
          >
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setLast('Staged sell stop');
                setPopOpen(false);
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[18px] font-bold text-sell">Sell stop limit</span>
                <span className="text-[12px] text-muted">BTC-USD</span>
              </div>
              <label className="flex flex-col gap-1.5 text-[12px] text-muted">
                Stop price
                <input defaultValue="97,380" className="h-[38px] rounded-lg border border-[color:var(--ctl,var(--hairline-strong))] bg-surface-2 px-2.5 text-right text-[15px] text-text-strong" />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] text-muted">
                Limit price
                <input defaultValue="97,375" className="h-[38px] rounded-lg border border-[color:var(--ctl,var(--hairline-strong))] bg-surface-2 px-2.5 text-right text-[15px] text-text-strong" />
              </label>
              <div className="grid grid-cols-[2fr_1fr] gap-2">
                <button type="submit" className="h-[42px] cursor-pointer rounded-[9px] border-0 bg-sell font-semibold text-white">
                  Stage sell stop
                </button>
                <button type="button" className={BUTTON + ' h-[42px]'} onClick={() => setPopOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </Popover>
        </Section>

        <Section title="Dialog and checkbox">
          <button type="button" className={BUTTON} onClick={() => setDlgOpen(true)}>
            View all orders
          </button>
          <Dialog
            open={dlgOpen}
            onClose={() => setDlgOpen(false)}
            title="Open orders"
            description={`${ORDERS.length} orders · ${count} selected`}
            widthClass="max-w-[520px]"
          >
            <div className="flex flex-col p-3">
              <Checkbox
                label="Select all"
                checked={count === ORDERS.length}
                indeterminate={count > 0 && count < ORDERS.length}
                onChange={(c) => setSelected(Object.fromEntries(ORDERS.map((o) => [o.id, c])))}
              />
              {ORDERS.map((o) => (
                <Checkbox
                  key={o.id}
                  label={o.label}
                  checked={!!selected[o.id]}
                  onChange={(c) => setSelected((s) => ({ ...s, [o.id]: c }))}
                />
              ))}
              <Checkbox label="Disabled" checked={false} disabled onChange={() => {}} />
            </div>
          </Dialog>
        </Section>

        <Section title="Switch">
          <Switch label="One-click" checked={oneClick} onChange={setOneClick} tone="buy" />
          <Switch label="Compact rows" checked={compact} onChange={setCompact} />
          <Switch label="Disabled" checked={false} disabled onChange={() => {}} />
        </Section>

        <Section title="Kbd">
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>X</Kbd>
          </span>
          <span className="flex items-center gap-1">
            <Kbd>[</Kbd>
            <Kbd>]</Kbd>
            <span className="text-muted">previous or next own order</span>
          </span>
        </Section>

        <Section title="Tick direction">
          <span
            className={`flex items-baseline gap-1.5 font-display text-[22px] font-bold tabular-nums ${
              tick === 'up' ? 'text-buy' : tick === 'down' ? 'text-sell' : 'text-text-strong'
            }`}
          >
            <span aria-hidden className={`w-[13px] text-[13px] ${dir ? (dir === 'up' ? 'text-buy' : 'text-sell') : 'opacity-0'}`}>
              {dir === 'down' ? '▼' : '▲'}
            </span>
            {price === null ? '-' : price.toLocaleString('en-US')}
          </span>
          <button type="button" className={BUTTON} onClick={() => setPrice((p) => (p ?? 97412) + 5)}>Up</button>
          <button type="button" className={BUTTON} onClick={() => setPrice((p) => (p ?? 97412) - 5)}>Down</button>
          <button type="button" className={BUTTON} onClick={() => setPrice((p) => (p === null ? 97412 : null))}>
            {price === null ? 'Data back' : 'Market switch (null)'}
          </button>
        </Section>
      </div>
    </div>
  );
}
