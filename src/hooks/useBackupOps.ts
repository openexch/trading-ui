// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';

const ADMIN_BASE = import.meta.env.VITE_ADMIN_API_URL || '';

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

export function useBackupOps() {
  const [autoSnapshot, setAutoSnapshot] = useState<AutoSnapshot | null>(null);
  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [asRes, biRes] = await Promise.all([
        fetch(`${ADMIN_BASE}/api/admin/auto-snapshot`),
        fetch(`${ADMIN_BASE}/api/admin/backup-info`),
      ]);
      if (asRes.ok) setAutoSnapshot(await asRes.json());
      if (biRes.ok) setBackupInfo(await biRes.json());
      if (!asRes.ok && !biRes.ok) throw new Error('Admin gateway unreachable');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backup state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enableAutoSnapshot = useCallback(async (intervalMinutes: number): Promise<Result> => {
    try {
      const res = await fetch(`${ADMIN_BASE}/api/admin/auto-snapshot`, {
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
      const res = await fetch(`${ADMIN_BASE}/api/admin/auto-snapshot`, { method: 'DELETE' });
      const data = await res.json();
      await refresh();
      return { success: res.ok, message: data.message || (res.ok ? 'Auto-snapshot disabled' : `Error ${res.status}`) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, [refresh]);

  const takeSnapshot = useCallback(async (): Promise<Result> => {
    try {
      const res = await fetch(`${ADMIN_BASE}/api/admin/snapshot`, { method: 'POST' });
      const data = await res.json();
      return { success: res.ok, message: data.message || (res.ok ? 'Snapshot initiated' : `Error ${res.status}`) };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }, []);

  const recover = useCallback(async (nodeId: number, force: boolean, dryRun: boolean): Promise<RecoverResult> => {
    try {
      const res = await fetch(`${ADMIN_BASE}/api/admin/recover-from-backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, force, dryRun }),
      });
      return (await res.json()) as RecoverResult;
    } catch (err) {
      return { success: false, nodeId, error: err instanceof Error ? err.message : 'Network error' };
    }
  }, []);

  return { autoSnapshot, backupInfo, loading, error, refresh, enableAutoSnapshot, disableAutoSnapshot, takeSnapshot, recover };
}
