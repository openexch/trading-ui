// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';
import { adminUrl } from '../components/admin/api';

export interface AutoSnapshot {
  enabled: boolean;
  intervalMinutes: number;
  lastPosition?: number;
}

export interface BackupInfo {
  backupDir: string;
  hasRecordingLog: boolean;
  hasArchive: boolean;
  recordingCount: number;
  // Freshness (match#36 doctrine): trust `fresh`, never "running" alone —
  // the backup agent once wedged silently for days while looking healthy.
  fresh: boolean;
  freshReason: string;
  recordingLogBytes: number;
}

export interface RecoverResult {
  success: boolean;
  nodeId: number;
  message?: string;
  error?: string;
  recordingsCopied?: number;
  dryRun?: boolean;
  source?: string;
  target?: string;
}

type Result = { success: boolean; message: string };

/**
 * Backup state + recovery for ONE cluster. `backup-info`, `snapshot` and
 * `recover-from-backup` ride the `?cluster=` query so a multi-cluster console
 * backs up the selected engine; auto-snapshot scheduling stays a single
 * (match-default) config.
 */
export function useBackupOps(cluster: string = 'match') {
  const [autoSnapshot, setAutoSnapshot] = useState<AutoSnapshot | null>(null);
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [asRes, biRes] = await Promise.all([
        fetch(adminUrl('/api/admin/auto-snapshot')),
        fetch(adminUrl('/api/admin/backup-info', { cluster })),
      ]);
      if (asRes.ok) setAutoSnapshot(await asRes.json());
      if (biRes.ok) setBackupInfo(await biRes.json());
      if (!asRes.ok && !biRes.ok) throw new Error('Admin gateway unreachable');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backup state');
    } finally {
      setLoading(false);
    }
  }, [cluster]);

  useEffect(() => { refresh(); }, [refresh]);

  const enableAutoSnapshot = useCallback(async (intervalMinutes: number): Promise<Result> => {
    try {
      const res = await fetch(adminUrl('/api/admin/auto-snapshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes }),
      });
      const data = await res.json();
      await refresh();
      return { success: res.ok, message: data.message || (res.ok ? 'Auto-snapshot enabled' : `Error ${res.status}`) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, [refresh]);

  const disableAutoSnapshot = useCallback(async (): Promise<Result> => {
    try {
      const res = await fetch(adminUrl('/api/admin/auto-snapshot'), { method: 'DELETE' });
      const data = await res.json();
      await refresh();
      return { success: res.ok, message: data.message || (res.ok ? 'Auto-snapshot disabled' : `Error ${res.status}`) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, [refresh]);

  const takeSnapshot = useCallback(async (): Promise<Result> => {
    try {
      const res = await fetch(adminUrl('/api/admin/snapshot', { cluster }), { method: 'POST' });
      const data = await res.json();
      return { success: res.ok, message: data.message || (res.ok ? 'Snapshot initiated' : `Error ${res.status}`) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, [cluster]);

  const recover = useCallback(async (nodeId: number, force: boolean, dryRun: boolean): Promise<RecoverResult> => {
    try {
      const res = await fetch(adminUrl('/api/admin/recover-from-backup', { cluster }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, force, dryRun }),
      });
      return (await res.json()) as RecoverResult;
    } catch (err) {
      return { success: false, nodeId, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, [cluster]);

  return { autoSnapshot, backupInfo, loading, error, refresh, enableAutoSnapshot, disableAutoSnapshot, takeSnapshot, recover };
}
