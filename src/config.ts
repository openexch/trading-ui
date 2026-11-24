// SPDX-License-Identifier: Apache-2.0
import { getSession } from './auth/session';

/** Gateway REST base, the origin that serves /api/v2 (VITE_ORDER_API_URL).
 *  Empty means same origin (dev and preview: the Vite proxy forwards /api/v2). */
export const API_BASE: string = import.meta.env.VITE_ORDER_API_URL || '';

/** The user stream URL, the full `/ws/v2` URL of oe-stream
 *  (VITE_STREAM_WS_URL). The stream is another process than the REST
 *  gateway, so it is never derived from API_BASE. Empty means same origin
 *  `/ws/v2` (dev and preview: the Vite proxy forwards it). */
export const STREAM_WS_URL: string = import.meta.env.VITE_STREAM_WS_URL || '';

/** The coordinated stack release version (one version across all four
 *  repos; bumped manually at release time, like the website's site.ts). */
export const STACK_VERSION = 'v0.5.0-beta';

/** Grafana for the admin console's header link. The default assumes the
 *  operator sits on the deployment box (Grafana binds loopback :3000);
 *  override at build time if it is ever exposed on a real hostname. */
export const GRAFANA_URL: string = import.meta.env.VITE_GRAFANA_URL || 'http://localhost:3000';

/** Authorization header for gateway calls; empty when signed out. The
 *  gateway derives the caller's identity from the bearer token; request
 *  bodies and query strings never carry a userId. */
export function getAuthHeaders(): Record<string, string> {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
