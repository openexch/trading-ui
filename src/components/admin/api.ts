// SPDX-License-Identifier: Apache-2.0
// Single source for the admin-gateway base URL, cluster-qualified URL
// building, and the status envelope → clusters[] normalization. Dedupes the
// three ADMIN_BASE copies that used to live in AdminPage/useAdminEvents/
// useBackupOps.
import type { AdminStatus, ClusterBlock } from './types';

/** Admin gateway origin ('' in dev — the Vite proxy forwards /api/admin to
 *  :8082; a reverse proxy does the same in prod). */
export const ADMIN_BASE = import.meta.env.VITE_ADMIN_API_URL || '';

/**
 * Build an admin-gateway URL, appending `?cluster=<name>` (or `&cluster=`
 * when the path already carries a query) when a cluster is given. Omitting
 * the cluster defaults to `match` server-side, but the console always passes
 * it now for correctness across N clusters.
 */
export function adminUrl(path: string, opts?: { cluster?: string }): string {
  const url = `${ADMIN_BASE}${path}`;
  if (!opts?.cluster) return url;
  const sep = path.includes('?') ? '&' : '?';
  return `${url}${sep}cluster=${encodeURIComponent(opts.cluster)}`;
}

const MATCH_CAPABILITIES: ClusterBlock['capabilities'] = {
  rollingUpdate: true,
  snapshot: true,
  cleanup: true,
  housekeeping: true,
  backup: true,
  separateDriver: true,
};

/**
 * Reduce the status envelope to the generic `clusters[]` the console renders.
 * Returns `raw.clusters` when the (live) backend emits it; otherwise
 * synthesizes a single `match` block from the legacy flat shape so the
 * console works against BOTH the old and new backend and always has ≥1 block.
 */
export function normalizeStatus(raw: AdminStatus): ClusterBlock[] {
  if (raw.clusters && raw.clusters.length > 0) return raw.clusters;
  return [
    {
      name: 'match',
      display: 'Matching Engine',
      kind: 'match',
      nodeCount: raw.nodes?.length ?? 3,
      leader: raw.leader ?? 0,
      allNodesHealthy: raw.allNodesHealthy ?? false,
      capabilities: { ...MATCH_CAPABILITIES },
      nodes: raw.nodes ?? [],
      backup: raw.backup,
    },
  ];
}
