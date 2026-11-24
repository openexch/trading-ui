// SPDX-License-Identifier: Apache-2.0
/**
 * The v2 gateway REST client: base URL, credential header, Idempotency-Key
 * and the error body every refusal carries.
 *
 * Error body (every 4xx and 5xx):
 *   {"error": text, "code": machine code, "reason": core reason or null,
 *    "detail": more text or null, "keyFinal": bool}
 */
import { API_BASE, getAuthHeaders } from '../config';
import { formatRejectReason } from '../utils/rejectReasons';

/** The v2 REST prefix. */
export const API_V2 = '/api/v2';

export interface ApiErrorBody {
  error: string | null;
  code: string | null;
  reason: string | null;
  detail: string | null;
  keyFinal: boolean;
}

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: ApiErrorBody; retryAfterMs?: number | null };

/** A fresh Idempotency-Key: one per user action, never reused for another
 *  request (a reuse with other fields is 409 REQUEST_ID_PAYLOAD_MISMATCH). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function toApiError(raw: unknown): ApiErrorBody {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    error: str(o.error),
    code: str(o.code),
    reason: str(o.reason),
    detail: str(o.detail),
    keyFinal: o.keyFinal === true,
  };
}

/** One line for a refusal: the core's reason in words when the core decided,
 *  else the gateway's detail, else its error text, else the status. */
export function apiErrorText(err: ApiErrorBody, status: number): string {
  if (err.reason) return formatRejectReason(err.reason);
  return err.detail ?? err.error ?? `Error ${status}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON body; omitted means no body and no Content-Type. */
  body?: unknown;
  /** Sent as the Idempotency-Key header. */
  idempotencyKey?: string;
  /** Send the session's bearer credential (default true). */
  auth?: boolean;
  /** An explicit bearer token instead of the stored session's. */
  token?: string;
}

/** Call a v2 route. Network failures throw; HTTP refusals return ok:false. */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
  else if (opts.auth !== false) Object.assign(headers, getAuthHeaders());
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey !== undefined) headers['Idempotency-Key'] = opts.idempotencyKey;

  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(`${API_BASE}${API_V2}${path}`, init);
  // 204 (logout) and some refusals have no body.
  const text = res.status === 204 ? '' : await readText(res);
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (res.ok) return { ok: true, status: res.status, body: parsed as T };
  return { ok: false, status: res.status, error: toApiError(parsed), retryAfterMs: retryAfterMs(res) };
}

/** Retry-After (whole seconds, as the gateway sends it on every 429 and
 *  503) in ms; null when absent or unreadable. */
function retryAfterMs(res: Response): number | null {
  const raw = typeof res.headers?.get === 'function' ? res.headers.get('Retry-After') : null;
  if (raw === null || !/^[0-9]+$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1000;
}

async function readText(res: Response): Promise<string> {
  if (typeof res.text === 'function') return res.text();
  // Minimal Response stand-ins (tests) may only implement json().
  return JSON.stringify(await res.json());
}
