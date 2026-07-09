// SPDX-License-Identifier: Apache-2.0
// Runtime-profile settings editor (the Profiles tab). Self-contained against
// the profile CRUD surface (GET/POST /api/admin/profiles, DELETE
// /api/admin/profiles/{name}): built-in presets render read-only and
// duplicate via Save-as; customs are editable, deletable (unless active) and
// appliable. Applying reuses the page's requestProfileSwitch confirm flow via
// onApply — the editor never POSTs /api/admin/profile itself. Server-side
// validation (heap-vs-RAM floor, name rules, preset collisions) is the
// authority; save errors surface as sticky toasts, local parse problems stay
// inline next to Save.
import { useCallback, useEffect, useState, type WheelEvent } from 'react';
import { adminUrl } from './api';
import { useToast } from './Toasts';
import { ConfirmModal } from './ConfirmModal';
import type { FullProfile } from './types';

/** Editable payload — every FullProfile field except name/builtin. */
interface ProfilePayload {
  description: string;
  nodeHeapMB: number;
  omsHeapMB: number;
  marketHeapMB: number;
  backupHeapMB: number;
  minMemMB: number;
  preTouch: boolean;
  idleMode: string;
  pinning: string;
  bookCapacity: number;
  logTermLength: string;
  driverMode: string;
  driverProfile: string;
  simGlobalOps: number;
  governor: string;
  thp: string;
}

type FieldKey = Exclude<keyof ProfilePayload, 'description'>;
/** String draft of the form — numbers stay raw text until Save parses them. */
type Draft = Record<FieldKey | 'description', string>;

type FieldDef =
  | { key: FieldKey; label: string; kind: 'number'; suffix?: string }
  | { key: FieldKey; label: string; kind: 'select'; options: string[] };

const num = (key: FieldKey, label: string, suffix?: string): FieldDef => ({ key, label, kind: 'number', suffix });
const sel = (key: FieldKey, label: string, options: string[]): FieldDef => ({ key, label, kind: 'select', options });

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Memory',
    fields: [
      num('nodeHeapMB', 'Node heap', 'MB'),
      num('omsHeapMB', 'OMS heap', 'MB'),
      num('marketHeapMB', 'Market heap', 'MB'),
      num('backupHeapMB', 'Backup heap', 'MB'),
      num('minMemMB', 'Min free memory', 'MB'),
      sel('preTouch', 'Pre-touch heap', ['yes', 'no']),
    ],
  },
  {
    title: 'Engine',
    fields: [
      sel('idleMode', 'Idle mode', ['busy_spin', 'backoff']),
      sel('pinning', 'CPU pinning', ['dedicated', 'none']),
      num('bookCapacity', 'Book capacity'),
      sel('logTermLength', 'Log term length', ['16m', '32m', '64m', '128m']),
    ],
  },
  {
    title: 'Media driver',
    fields: [
      sel('driverMode', 'Driver mode', ['embedded', 'external']),
      sel('driverProfile', 'Driver profile', ['dev', 'prod']),
    ],
  },
  {
    title: 'Simulator',
    fields: [num('simGlobalOps', 'Global ops / sec')],
  },
  {
    title: 'OS',
    fields: [
      sel('governor', 'CPU governor', ['performance', 'schedutil', 'powersave', 'ondemand']),
      sel('thp', 'Transparent hugepages', ['never', 'madvise', 'always']),
    ],
  },
];

const NUMBER_FIELDS = GROUPS.flatMap(g => g.fields).filter(f => f.kind === 'number');

const NAME_RE = /^[a-z0-9-]{1,32}$/;

function toDraft(p: FullProfile): Draft {
  return {
    description: p.description,
    nodeHeapMB: String(p.nodeHeapMB),
    omsHeapMB: String(p.omsHeapMB),
    marketHeapMB: String(p.marketHeapMB),
    backupHeapMB: String(p.backupHeapMB),
    minMemMB: String(p.minMemMB),
    preTouch: p.preTouch ? 'yes' : 'no',
    idleMode: p.idleMode,
    pinning: p.pinning,
    bookCapacity: String(p.bookCapacity),
    logTermLength: p.logTermLength,
    driverMode: p.driverMode,
    driverProfile: p.driverProfile,
    simGlobalOps: String(p.simGlobalOps),
    governor: p.governor,
    thp: p.thp,
  };
}

/** Parse the string draft into the POST payload; number fields must be
 *  non-negative integers (the server validates the rest). */
function toPayload(draft: Draft): { payload: ProfilePayload } | { error: string } {
  const numbers: Partial<Record<FieldKey, number>> = {};
  for (const f of NUMBER_FIELDS) {
    const raw = draft[f.key].trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0) return { error: `Invalid ${f.label}` };
    numbers[f.key] = n;
  }
  return {
    payload: {
      description: draft.description,
      nodeHeapMB: numbers.nodeHeapMB!,
      omsHeapMB: numbers.omsHeapMB!,
      marketHeapMB: numbers.marketHeapMB!,
      backupHeapMB: numbers.backupHeapMB!,
      minMemMB: numbers.minMemMB!,
      bookCapacity: numbers.bookCapacity!,
      simGlobalOps: numbers.simGlobalOps!,
      preTouch: draft.preTouch === 'yes',
      idleMode: draft.idleMode,
      pinning: draft.pinning,
      logTermLength: draft.logTermLength,
      driverMode: draft.driverMode,
      driverProfile: draft.driverProfile,
      governor: draft.governor,
      thp: draft.thp,
    },
  };
}

const inputCls =
  'w-full rounded-md border border-hairline bg-surface-2 px-2 py-1.5 text-[12px] text-text focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

// Number inputs blur on wheel (DESIGN invariant: scrolling the panel over a
// focused input must never silently step its value).
const blurOnWheel = (e: WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

/** Apply-tier chip: how a field lands when the profile is applied. Only the
 *  embedded↔external driver-mode boundary needs a brief full-cluster stop;
 *  every other field rides the quorum-safe live roll. */
function TierChip({ field }: { field: FieldKey }) {
  const disruptive = field === 'driverMode';
  return (
    <span
      className={`flex-shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wide ${
        disruptive ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'
      }`}
    >
      {disruptive ? 'brief cluster stop' : 'live roll'}
    </span>
  );
}

function FieldRow({
  def,
  value,
  disabled,
  onChange,
}: {
  def: FieldDef;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted">{def.label}</span>
        <TierChip field={def.key} />
      </span>
      {def.kind === 'number' ? (
        <span className="relative block">
          <input
            type="number"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onWheel={blurOnWheel}
            min="0"
            step="1"
            aria-label={def.label}
            className={`${inputCls} font-mono tabular-nums ${def.suffix ? 'pr-9' : ''}`}
          />
          {def.suffix && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-faint">
              {def.suffix}
            </span>
          )}
        </span>
      ) : (
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={def.label}
          className={inputCls}
        >
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

/** The right-hand editor for one profile. Keyed by profile name upstream so
 *  the draft resets whenever the selection changes. */
function ProfileForm({
  profile,
  activeName,
  stackBusy,
  busy,
  onSave,
  onRequestDelete,
  onApply,
}: {
  profile: FullProfile;
  activeName: string;
  stackBusy: boolean;
  busy: boolean;
  onSave: (name: string, payload: ProfilePayload) => void;
  onRequestDelete: (name: string) => void;
  onApply: (name: string) => void;
}) {
  const isPreset = profile.builtin;
  const isActive = profile.name === activeName;
  const [draft, setDraftState] = useState<Draft>(() => toDraft(profile));
  const [saveName, setSaveNameState] = useState(() => (isPreset ? `${profile.name}-custom` : profile.name));
  // Local parse/name problems stay inline next to Save (field-proximate
  // errors beat toasts), persistent until the input changes.
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);

  const setDraft = (key: keyof Draft, value: string) => {
    setInvalidMsg(null);
    setDraftState((d) => ({ ...d, [key]: value }));
  };
  const setSaveName = (value: string) => {
    setInvalidMsg(null);
    setSaveNameState(value);
  };

  const baseline = toDraft(profile);
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== baseline[k]);
  const isSaveAs = saveName !== profile.name;

  const save = () => {
    if (!NAME_RE.test(saveName)) {
      setInvalidMsg('Name must be 1-32 chars: a-z, 0-9, -');
      return;
    }
    const result = toPayload(draft);
    if ('error' in result) {
      setInvalidMsg(result.error);
      return;
    }
    onSave(saveName, result.payload);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-display text-[15px] font-semibold text-text-strong">
          <span className="font-mono">{profile.name}</span>
        </h3>
        {isPreset && (
          <span className="rounded border border-hairline px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-faint">
            Built-in
          </span>
        )}
        {isActive && (
          <span className="flex items-center gap-1.5 text-[11px] text-buy">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-buy" />
            active
          </span>
        )}
      </div>

      <p className="mb-4 text-[12px] leading-relaxed text-muted">
        Changes apply via a quorum-safe live roll. The exception is the driver mode, which briefly stops the whole cluster
        (state preserved).
      </p>

      {isPreset && (
        <div className="mb-4 rounded-md border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-muted">
          Built-in preset. Duplicate it below to customize.
        </div>
      )}

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Description</span>
          <input
            type="text"
            value={draft.description}
            disabled={isPreset}
            onChange={(e) => setDraft('description', e.target.value)}
            aria-label="Description"
            className={inputCls}
          />
        </label>

        {GROUPS.map((group) => (
          <div key={group.title}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{group.title}</span>
            <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-3">
              {group.fields.map((f) => (
                <FieldRow
                  key={f.key}
                  def={f}
                  value={draft[f.key]}
                  disabled={isPreset}
                  onChange={(v) => setDraft(f.key, v)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <span>Save as</span>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            aria-label="Profile name"
            spellCheck={false}
            className="w-44 rounded-md border border-hairline bg-surface-2 px-2 py-1.5 font-mono text-[12px] text-text focus:border-accent focus:outline-none"
          />
        </label>
        <button
          onClick={save}
          disabled={busy || saveName.length === 0 || (!isPreset && !dirty && !isSaveAs)}
          className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {isSaveAs ? 'Save as new' : 'Save changes'}
        </button>
        {invalidMsg && <span className="text-[12px] text-sell">{invalidMsg}</span>}
        <div className="ml-auto flex items-center gap-2">
          {!isPreset && (
            <button
              onClick={() => onRequestDelete(profile.name)}
              disabled={isActive || busy}
              title={
                isActive
                  ? `"${profile.name}" is the active profile; switch to another profile before deleting it.`
                  : undefined
              }
              className="rounded-md border border-sell/40 bg-sell-soft px-3 py-1.5 text-[13px] font-medium text-sell hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          )}
          <button
            onClick={() => onApply(profile.name)}
            disabled={isActive || stackBusy || busy}
            title={isActive ? `"${profile.name}" is already the active profile.` : undefined}
            className="rounded-md border border-warn/40 bg-warn-soft px-3 py-1.5 text-[13px] font-medium text-warn hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProfilesEditorProps {
  /** The live active profile name (drives the active marker + guards). */
  activeName: string;
  /** Global operation lock — Apply is disabled while any op runs. */
  stackBusy: boolean;
  /** Apply the selected profile — AdminPage passes requestProfileSwitch, so
   *  the existing confirm flow (incl. the driver-mode outage copy) is reused. */
  onApply: (name: string) => void;
  /** Called after any successful save/delete so the page can refresh the
   *  header profile list. */
  onChanged?: () => void;
}

export function ProfilesEditor({ activeName, stackBusy, onApply, onChanged }: ProfilesEditorProps) {
  const toast = useToast();
  // null = never loaded (skeleton); [] = loaded-and-empty (quiet notice).
  const [profiles, setProfiles] = useState<FullProfile[] | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchProfiles = useCallback(async () => {
    try {
      const response = await fetch(adminUrl('/api/admin/profiles'));
      if (!response.ok) {
        toast({ tone: 'error', text: `Failed to load profiles (HTTP ${response.status})`, sticky: true });
        return;
      }
      const data = await response.json();
      setProfiles(data.profiles ?? []);
    } catch {
      toast({ tone: 'error', text: 'Failed to load profiles', sticky: true });
    }
  }, [toast]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Selection is derived with fallbacks (active profile, then first) so a
  // deleted or missing selection can never leave the editor empty.
  const selected =
    profiles?.find((p) => p.name === selectedName) ??
    profiles?.find((p) => p.name === activeName) ??
    profiles?.[0] ??
    null;

  const save = async (name: string, payload: ProfilePayload) => {
    setBusy(true);
    try {
      const response = await fetch(adminUrl('/api/admin/profiles'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, profile: payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({
          tone: 'error',
          text: data.error || data.message || `Failed to save profile (HTTP ${response.status})`,
          sticky: true,
        });
        return;
      }
      toast({ tone: 'success', text: data.message || `Saved profile "${name}"` });
      setSelectedName(name);
      await fetchProfiles();
      onChanged?.();
    } catch {
      toast({ tone: 'error', text: 'Failed to save profile', sticky: true });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (name: string) => {
    setBusy(true);
    try {
      const response = await fetch(adminUrl(`/api/admin/profiles/${encodeURIComponent(name)}`), {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({
          tone: 'error',
          text: data.error || data.message || `Failed to delete profile (HTTP ${response.status})`,
          sticky: true,
        });
        return;
      }
      toast({ tone: 'success', text: data.message || `Deleted profile "${name}"` });
      if (selectedName === name) setSelectedName(null);
      await fetchProfiles();
      onChanged?.();
    } catch {
      toast({ tone: 'error', text: 'Failed to delete profile', sticky: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Runtime Profiles</h2>

      {profiles === null ? (
        // Never-loaded: pulsing skeleton, same device as the other tabs.
        <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="h-[280px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          <div className="h-[480px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-[13px] text-muted">The gateway reported no profiles.</div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Profile list — stable-keyed by name, server order preserved
              (presets first, customs alphabetically). */}
          <div className="flex flex-col gap-0.5 rounded-lg border border-hairline bg-surface p-2">
            {profiles.map((p) => {
              const isSelected = selected?.name === p.name;
              return (
                <button
                  key={p.name}
                  onClick={() => setSelectedName(p.name)}
                  aria-pressed={isSelected}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
                    isSelected ? 'bg-surface-2 text-text-strong' : 'text-muted hover:bg-surface-2/60 hover:text-text'
                  }`}
                >
                  <span className="truncate font-mono">{p.name}</span>
                  {p.builtin && (
                    <span className="flex-shrink-0 rounded border border-hairline px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-faint">
                      Built-in
                    </span>
                  )}
                  {p.name === activeName && (
                    <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 text-[11px] text-buy">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-buy" />
                      active
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="rounded-lg border border-hairline bg-surface p-4">
              <ProfileForm
                key={selected.name}
                profile={selected}
                activeName={activeName}
                stackBusy={stackBusy}
                busy={busy}
                onSave={save}
                onRequestDelete={setConfirmDelete}
                onApply={onApply}
              />
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete profile "${confirmDelete}"?`}
          tone="danger"
          confirmLabel="Delete Profile"
          busy={busy}
          body={
            <>
              This permanently removes the custom profile{' '}
              <strong className="font-mono text-text">{confirmDelete}</strong>. Built-in presets are unaffected.
            </>
          }
          onConfirm={async () => {
            await doDelete(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}
