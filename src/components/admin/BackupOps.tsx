// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from 'react';
import { useBackupOps, type RecoverResult } from '../../hooks/useBackupOps';
import { ConfirmModal } from './ConfirmModal';
import { useToast } from './Toasts';
import type { ClusterBlock } from './types';

function Pill({ ok, label, title, alert }: { ok: boolean; label: string; title?: string; alert?: boolean }) {
  // alert renders the not-ok state as a genuine warning (sell tint) instead
  // of the neutral "absent" gray — used for freshness, where stale is a
  // problem rather than a missing feature.
  const off = alert ? 'bg-sell-soft text-sell' : 'bg-surface-2 text-faint';
  const dot = alert ? 'bg-sell' : 'bg-faint';
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-buy-soft text-buy' : off}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-buy' : dot}`} />
      {label}
    </span>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold text-text-strong">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

interface BackupOpsProps {
  /** All clusters — the selector offers backup-capable ones; the recovery
   *  target list derives from the selected cluster's nodes. */
  clusters?: ClusterBlock[];
}

export function BackupOps({ clusters }: BackupOpsProps) {
  const toast = useToast();

  // Only backup-capable clusters can be selected; default to match.
  const backupClusters = useMemo(
    () => (clusters ?? []).filter(c => c.capabilities.backup),
    [clusters],
  );
  const [selectedCluster, setSelectedCluster] = useState('match');
  const cluster = backupClusters.some(c => c.name === selectedCluster)
    ? selectedCluster
    : (backupClusters[0]?.name ?? 'match');
  const nodes = backupClusters.find(c => c.name === cluster)?.nodes;

  const { autoSnapshot, backupInfo, loading, error, refresh, enableAutoSnapshot, disableAutoSnapshot, takeSnapshot, recover } = useBackupOps(cluster);

  const [interval, setIntervalMin] = useState('30');
  const [busy, setBusy] = useState(false);

  // Recovery state
  const [recoverNode, setRecoverNode] = useState(0);
  const [dryRunResult, setDryRunResult] = useState<RecoverResult | null>(null);
  const [confirmRecover, setConfirmRecover] = useState(false);

  const flash = (ok: boolean, text: string) => {
    toast({ tone: ok ? 'success' : 'error', text });
  };

  const run = async (fn: () => Promise<{ success: boolean; message: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    flash(res.success, res.message);
  };

  const doDryRun = async () => {
    setBusy(true);
    const res = await recover(recoverNode, false, true);
    setBusy(false);
    setDryRunResult(res);
    if (res.error) flash(false, res.error);
  };

  const doRecover = async () => {
    setBusy(true);
    const res = await recover(recoverNode, true, false);
    setBusy(false);
    setConfirmRecover(false);
    setDryRunResult(null);
    flash(!!res.success, res.success ? `Recovered node ${res.nodeId} (${res.recordingsCopied ?? 0} recordings)` : (res.error || 'Recovery failed'));
    refresh();
  };

  const labelCls = 'text-[11px] text-muted';
  const valueCls = 'font-mono text-[12px] tabular-nums text-text';

  return (
    <div className="flex flex-col gap-4">
      {backupClusters.length > 1 && (
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-wide">Cluster</span>
          <select
            aria-label="Backup cluster"
            value={cluster}
            onChange={e => { setSelectedCluster(e.target.value); setRecoverNode(0); setDryRunResult(null); }}
            className="rounded-md border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-text focus:border-accent focus:outline-none"
          >
            {backupClusters.map(c => (
              <option key={c.name} value={c.name}>{c.display}</option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="rounded-md bg-sell-soft px-3 py-2 text-[13px] text-sell">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Auto-snapshot */}
        <Card
          title="Auto-snapshot"
          action={autoSnapshot && <Pill ok={autoSnapshot.enabled} label={autoSnapshot.enabled ? 'Enabled' : 'Disabled'} />}
        >
          <div className="flex flex-col gap-3">
            {autoSnapshot && (
              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                <div className="flex flex-col"><span className={labelCls}>Interval</span><span className={valueCls}>{autoSnapshot.intervalMinutes} min</span></div>
                {autoSnapshot.lastPosition !== undefined && (
                  <div className="flex flex-col"><span className={labelCls}>Last position</span><span className={valueCls}>{autoSnapshot.lastPosition.toLocaleString()}</span></div>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className={labelCls}>Interval (minutes)</span>
                <input
                  value={interval}
                  onChange={e => setIntervalMin(e.target.value)}
                  inputMode="numeric"
                  className="w-28 rounded-md border border-hairline bg-surface-2 px-2 py-1.5 font-mono text-[12px] tabular-nums focus:border-accent focus:outline-none"
                />
              </label>
              <button
                onClick={() => { const n = Number(interval); if (n > 0) run(() => enableAutoSnapshot(n)); else flash(false, 'Interval must be > 0'); }}
                disabled={busy}
                className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {autoSnapshot?.enabled ? 'Update' : 'Enable'}
              </button>
              <button
                onClick={() => run(disableAutoSnapshot)}
                disabled={busy || !autoSnapshot?.enabled}
                className="rounded-md border border-hairline px-3 py-1.5 text-[13px] text-muted hover:border-hairline-strong hover:text-text disabled:opacity-40"
              >
                Disable
              </button>
            </div>
          </div>
        </Card>

        {/* Backup info + manual snapshot */}
        <Card
          title="Backup state"
          action={
            <button onClick={refresh} disabled={loading} className="rounded-sm border border-hairline px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-50">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          }
        >
          <div className="flex flex-col gap-3">
            {backupInfo ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className={labelCls}>Backup directory</span>
                  <span className="break-all font-mono text-[11px] text-text">{backupInfo.backupDir || '—'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill
                    ok={backupInfo.fresh}
                    alert
                    label={backupInfo.fresh ? 'Fresh' : 'Stale'}
                    title={backupInfo.freshReason}
                  />
                  <Pill ok={backupInfo.hasRecordingLog} label="Recording log" />
                  <Pill ok={backupInfo.hasArchive} label="Archive" />
                  <span className="flex flex-col"><span className={labelCls}>Recordings</span><span className={valueCls}>{backupInfo.recordingCount}</span></span>
                </div>
              </>
            ) : (
              <span className="text-[12px] text-muted">No backup info.</span>
            )}
            <button
              onClick={() => run(takeSnapshot)}
              disabled={busy}
              className="self-start rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent hover:brightness-105 disabled:opacity-40"
            >
              Take snapshot now
            </button>
          </div>
        </Card>
      </div>

      {/* Recover from backup */}
      <Card title="Recover from backup">
        <p className="mb-3 text-[12px] leading-relaxed text-muted">
          Restores a node's state from the backup recordings. The target node must be <strong className="text-text">stopped</strong>. Run a dry run first to preview source and target paths — nothing is copied until you confirm a real recovery.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Target node</span>
            <select
              value={recoverNode}
              onChange={e => { setRecoverNode(Number(e.target.value)); setDryRunResult(null); }}
              className="rounded-md border border-hairline bg-surface-2 px-2 py-1.5 text-[12px] focus:border-accent focus:outline-none"
            >
              {(nodes && nodes.length > 0 ? nodes.map(n => n.id) : (cluster === 'match' ? [0, 1, 2] : [0])).map(id => {
                const node = nodes?.find(n => n.id === id);
                return (
                  <option key={id} value={id}>
                    Node {id}{node ? ` — ${node.running ? 'running' : 'stopped'}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <button onClick={doDryRun} disabled={busy} className="rounded-md border border-hairline px-3 py-1.5 text-[13px] text-muted hover:border-accent hover:text-accent disabled:opacity-40">
            Dry run
          </button>
          <button onClick={() => setConfirmRecover(true)} disabled={busy} className="rounded-md border border-sell/40 bg-sell-soft px-3 py-1.5 text-[13px] font-medium text-sell hover:brightness-105 disabled:opacity-40">
            Recover node {recoverNode}
          </button>
        </div>

        {nodes?.find(n => n.id === recoverNode)?.running && (
          <p className="mt-2 text-[12px] text-warn">
            Node {recoverNode} is running — stop it first, or recovery will be refused.
          </p>
        )}

        {dryRunResult && dryRunResult.dryRun && (
          <div className="mt-3 rounded-md border border-hairline bg-surface-2 p-3 text-[12px]">
            <div className="mb-1 font-medium text-text">Dry run — node {dryRunResult.nodeId}</div>
            <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted">
              <span>source: {dryRunResult.source || '—'}</span>
              <span>target: {dryRunResult.target || '—'}</span>
              {dryRunResult.message && <span className="text-faint">{dryRunResult.message}</span>}
            </div>
          </div>
        )}
      </Card>

      {confirmRecover && (
        <ConfirmModal
          title={`Recover node ${recoverNode} from backup?`}
          tone="danger"
          confirmLabel={`Recover node ${recoverNode}`}
          busy={busy}
          body={<>This overwrites node {recoverNode}'s local state with the backup recordings. The node must already be stopped, or recovery will fail. This cannot be undone.</>}
          onConfirm={doRecover}
          onCancel={() => setConfirmRecover(false)}
        />
      )}
    </div>
  );
}
