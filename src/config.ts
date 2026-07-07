// SPDX-License-Identifier: Apache-2.0
import { getSession } from './auth/session';

/** OMS REST base ('' in dev; the Vite proxy forwards /api/v1 to :8080). */
export const API_BASE: string = import.meta.env.VITE_ORDER_API_URL || '';

/** The coordinated stack release version (one version across all four
 *  repos; bumped manually at release time, like the website's site.ts). */
export const STACK_VERSION = 'v0.3.0-beta';

/** Grafana for the admin console's header link. The default assumes the
 *  operator sits on the deployment box (Grafana binds loopback :3000);
 *  override at build time if it is ever exposed on a real hostname. */
export const GRAFANA_URL: string = import.meta.env.VITE_GRAFANA_URL || 'http://localhost:3000';

/** Authorization header for OMS calls; empty when signed out (oms#72). The
 *  backend derives the caller's identity from the bearer token; request
 *  bodies and query strings never carry a userId. */
export function getAuthHeaders(): Record<string, string> {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

/** The signed-in user's id (URL paths and display only, never sent in
 *  request payloads) or null when signed out. */
export function getCurrentUserId(): number | null {
  return getSession()?.userId ?? null;
}
