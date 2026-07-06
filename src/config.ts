// SPDX-License-Identifier: Apache-2.0
import { getSession } from './auth/session';

/** OMS REST base ('' in dev; the Vite proxy forwards /api/v1 to :8080). */
export const API_BASE: string = import.meta.env.VITE_ORDER_API_URL || '';

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
