// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { MARKETS } from '../../types/market';
import { useRiskConfig, FP_SCALE, FP_FIELDS, type RiskConfig } from '../../hooks/useRiskConfig';
import { ConfirmModal } from './ConfirmModal';
import { useToast } from './Toasts';

function symbolFor(marketId: number): string {
  return MARKETS.find(m => m.id === marketId)?.symbol ?? `Market #${marketId}`;
}

const FP_SET = new Set<keyof RiskConfig>(FP_FIELDS);

interface FieldDef {
  key: keyof RiskConfig;
  label: string;
  hint?: string;
}

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Order size',
    fields: [
      { key: 'minQuantity', label: 'Min quantity' },
      { key: 'maxQuantity', label: 'Max quantity' },
      { key: 'minNotional', label: 'Min notional' },
      { key: 'maxNotional', label: 'Max notional' },
    ],
  },
  {
    title: 'Risk limits',
    fields: [
      { key: 'priceCollarPercent', label: 'Price collar', hint: '%' },
      { key: 'circuitBreakerPercent', label: 'Circuit breaker', hint: '%' },
      { key: 'circuitBreakerWindowMs', label: 'CB window', hint: 'ms' },
      { key: 'maxPositionPerMarket', label: 'Max position' },
    ],
  },
  {
    title: 'Rate limits',
    fields: [
      { key: 'maxOrdersPerSec', label: 'Orders / sec' },
      { key: 'maxOrdersPerMin', label: 'Orders / min' },
      { key: 'maxOpenOrders', label: 'Max open orders' },
    ],
  },
];

const toDisplay = (key: keyof RiskConfig, raw: number) =>
  FP_SET.has(key) ? String(raw / FP_SCALE) : String(raw);

const toRaw = (key: keyof RiskConfig, display: string) => {
  const n = Number(display);
  if (!Number.isFinite(n)) return null;
  return FP_SET.has(key) ? Math.round(n * FP_SCALE) : Math.round(n);
};

function RiskMarketCard({
  config,
  onSave,
  onBreaker,
}: {
  config: RiskConfig;
  onSave: (marketId: number, patch: Partial<RiskConfig>) => Promise<{ success: boolean; message: string }>;
  onBreaker: (marketId: number, action: 'trip' | 'reset') => void;
}) {
  const toast = useToast();
  const [draft, setDraftState] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    GROUPS.forEach(g => g.fields.forEach(f => { d[f.key] = toDisplay(f.key, config[f.key] as number); }));
    return d;
  });
  const [saving, setSaving] = useState(false);
  // Field-validation message: inline next to Save (field-proximate errors
  // beat toasts), persistent until the draft changes.
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);

  const setDraft = (updater: (d: Record<string, string>) => Record<string, string>) => {
    setInvalidMsg(null);
    setDraftState(updater);
  };

  const dirty = GROUPS.some(g => g.fields.some(f => draft[f.key] !== toDisplay(f.key, config[f.key] as number)));

  const save = async () => {
    const patch: Partial<RiskConfig> = {};
    for (const g of GROUPS) {
      for (const f of g.fields) {
        const raw = toRaw(f.key, draft[f.key]);
        if (raw === null) { setInvalidMsg(`Invalid ${f.label}`); return; }
        patch[f.key] = raw as never;
      }
    }
    setSaving(true);
    const res = await onSave(config.marketId, patch);
    setSaving(false);
    toast({ tone: res.success ? 'success' : 'error', text: res.message });
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-text-strong">{symbolFor(config.marketId)}</h3>
        <div className="flex gap-1.5">
          <button
            onClick={() => onBreaker(config.marketId, 'trip')}
            className="rounded-md border border-sell/40 bg-sell-soft px-2.5 py-1 text-[12px] font-medium text-sell hover:brightness-105"
          >
            Trip breaker
          </button>
          <button
            onClick={() => onBreaker(config.marketId, 'reset')}
            className="rounded-md border border-buy/40 bg-buy-soft px-2.5 py-1 text-[12px] font-medium text-buy hover:brightness-105"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {GROUPS.map(group => (
          <div key={group.title} className="flex flex-col gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{group.title}</span>
            {group.fields.map(f => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">
                  {f.label}{f.hint ? <span className="text-faint"> ({f.hint})</span> : null}
                </span>
                <input
                  value={draft[f.key]}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  inputMode="decimal"
                  className="w-full rounded-md border border-hairline bg-surface-2 px-2 py-1.5 font-mono text-[12px] tabular-nums text-text focus:border-accent focus:outline-none"
                />
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {invalidMsg && <span className="text-[12px] text-sell">{invalidMsg}</span>}
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

export function RiskAdmin() {
  const { configs, loading, error, updateConfig, circuitBreaker } = useRiskConfig();
  const toast = useToast();
  const [pending, setPending] = useState<{ marketId: number; action: 'trip' | 'reset' } | null>(null);
  const [busy, setBusy] = useState(false);

  const entries = Object.values(configs).sort((a, b) => a.marketId - b.marketId);

  const confirmBreaker = async () => {
    if (!pending) return;
    setBusy(true);
    const res = await circuitBreaker(pending.marketId, pending.action);
    setBusy(false);
    setPending(null);
    toast({ tone: res.success ? 'success' : 'error', text: res.message });
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Risk Controls</h2>
      {loading && entries.length === 0 && <div className="text-[13px] text-muted">Loading risk config…</div>}
      {error && <div className="rounded-md bg-sell-soft px-3 py-2 text-[13px] text-sell">{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <div className="text-[13px] text-muted">No markets have risk config set.</div>
      )}

      {entries.map(cfg => (
        <RiskMarketCard
          key={cfg.marketId}
          config={cfg}
          onSave={updateConfig}
          onBreaker={(marketId, action) => setPending({ marketId, action })}
        />
      ))}

      {pending && (
        <ConfirmModal
          title={pending.action === 'trip' ? 'Trip circuit breaker?' : 'Reset circuit breaker?'}
          tone={pending.action === 'trip' ? 'danger' : 'primary'}
          confirmLabel={pending.action === 'trip' ? 'Trip breaker' : 'Reset breaker'}
          busy={busy}
          body={
            pending.action === 'trip'
              ? <>This halts new-order acceptance for <strong className="text-text">{symbolFor(pending.marketId)}</strong> until the breaker is reset.</>
              : <>This resumes normal trading for <strong className="text-text">{symbolFor(pending.marketId)}</strong>.</>
          }
          onConfirm={confirmBreaker}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
