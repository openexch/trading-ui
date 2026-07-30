// SPDX-License-Identifier: Apache-2.0
/**
 * Product analytics (PostHog). Off unless VITE_POSTHOG_KEY is set at build
 * time, which it is not in this repository: a clone builds and runs with no
 * analytics code in the bundle at all. We set the key for the hosted demo at
 * trade.openexchange.dev; an integrator who deploys this UI sends nothing
 * anywhere unless they configure their own project.
 *
 * Three rules this file exists to enforce:
 *
 *   1. NO MONEY VALUES IN EVENTS. Events carry the shape of an action, never
 *      its amounts: side, order type, market, reject reason, round-trip
 *      latency. Never a price, quantity, balance or notional. The demo runs on
 *      fake money, but this same code is what a real venue would deploy, and
 *      an analytics pipeline is a terrible place to discover you exported
 *      customer position sizes. scrubMoney below is the backstop for when
 *      someone (including a later version of me) forgets.
 *   2. Anonymous. persistence is sessionStorage, no cookie, and the signed-in
 *      user is never identified to PostHog. The trade-off is deliberate and
 *      costly: "how many people who registered went on to place an order"
 *      cannot be answered from this data. Cross-visit identity was not worth
 *      linking a userId to trading behaviour in a third-party system.
 *   3. Never break the app. This is the front end of an exchange. Every entry
 *      point is guarded, every failure is swallowed, and the SDK is a dynamic
 *      import so a blocked or slow CDN cannot delay the order form.
 */

import type { PostHogConfig } from 'posthog-js';

type PostHogClient = Parameters<NonNullable<PostHogConfig['loaded']>>[0];

const KEY: string | undefined = import.meta.env.VITE_POSTHOG_KEY;

/** Same-origin by default: functions/ph/[[path]].ts proxies to PostHog. */
const HOST: string = import.meta.env.VITE_POSTHOG_HOST || '/ph';

const UI_HOST = 'https://eu.posthog.com';

let ph: PostHogClient | null = null;
let starting = false;

const queue: Array<[string, Record<string, unknown>]> = [];
const QUEUE_MAX = 50;

export const analyticsConfigured: boolean = Boolean(KEY);

/* ------------------------------------------------------------------ *
 * Event names. One closed list; add here, never inline at a call site.
 * ------------------------------------------------------------------ */
export const EV = {
  // Session and navigation
  app_open: 'app_open',
  market_switch: 'market_switch',
  mobile_tab_switch: 'mobile_tab_switch',
  theme_change: 'theme_change',
  account_drawer_open: 'account_drawer_open',

  // Auth, outcomes only, never credentials
  auth_modal_open: 'auth_modal_open',
  auth_submit: 'auth_submit',
  auth_success: 'auth_success',
  auth_failure: 'auth_failure',
  sign_out: 'sign_out',

  // Orders. Shape only: side, type, market, outcome, latency.
  order_submit: 'order_submit',
  order_accepted: 'order_accepted',
  order_rejected: 'order_rejected',
  order_cancel_submit: 'order_cancel_submit',
  order_cancel_result: 'order_cancel_result',
  order_filled: 'order_filled',

  // Chart and market data
  chart_interval_change: 'chart_interval_change',

  // Health. The most operationally useful events here: a trader who cannot
  // see the book does not file a ticket, they leave.
  socket_disconnected: 'socket_disconnected',
  socket_reconnected: 'socket_reconnected',
  api_error: 'api_error',
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

/* ------------------------------------------------------------------ *
 * Money scrubbing
 * ------------------------------------------------------------------ */

/**
 * Property names that must never leave the browser. Matched as a
 * case-insensitive SUBSTRING, so `price`, `avgPrice` and `filled_qty` are all
 * caught. Deliberately over-broad: a useful property lost to this list is a
 * missing chart, while a balance that slips through is an exported customer
 * position. Booleans survive, because `filled: true` carries no amount.
 */
const MONEY_KEY =
  /(price|qty|quantity|amount|size|balance|available|locked|total|notional|value|fee|pnl|equity|collateral|filled|remaining)/i;

/**
 * Drop money-shaped properties. Exported for the test, and applied in
 * before_send so it catches call sites that never went through track().
 */
export function scrubMoney(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (MONEY_KEY.test(k) && typeof v !== 'boolean') continue;
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */

function viewportBucket(): string {
  const w = window.innerWidth;
  if (w <= 768) return 'mobile';
  if (w < 1280) return 'tablet';
  return 'desktop';
}

/**
 * Global Privacy Control. posthog-js reads Do Not Track via respect_dnt but
 * not GPC, and both are honoured here.
 */
function privacySignalSet(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true;
}

export function initAnalytics(): void {
  if (typeof window === 'undefined' || !KEY || ph || starting) return;
  if (privacySignalSet()) return;
  starting = true;

  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        ui_host: UI_HOST,

        persistence: 'sessionStorage',
        person_profiles: 'identified_only',
        respect_dnt: true,

        capture_pageview: false,
        capture_pageleave: true,

        autocapture: true,
        rageclick: true,
        capture_dead_clicks: true,
        capture_exceptions: true,
        capture_performance: true,
        enable_heatmaps: true,
        disable_surveys: true,

        session_recording: {
          maskAllInputs: true,
          // maskAllInputs covers the order form's fields, but balances,
          // positions and open orders are rendered as TEXT, which no input
          // mask touches. Everything carrying a number a user would consider
          // theirs is tagged data-ph-mask; see AccountDrawer, OpenOrders and
          // OrderHistory.
          maskTextSelector: '[data-ph-mask]',
          blockSelector: '[data-ph-block]',
          maskInputOptions: { password: true, email: true, textarea: true },
          recordCrossOriginIframes: false,
        },

        before_send: (event) => {
          if (!event) return null;
          if (event.properties) {
            event.properties = scrubMoney(event.properties as Record<string, unknown>);
          }
          return event;
        },

        loaded: (loaded) => {
          ph = loaded;
          loaded.register({
            // Both this app and the marketing site report into the same
            // PostHog project. Without this every breakdown mixes them, and
            // events already recorded cannot be relabelled later.
            app: 'trading-ui',
            stack_version: STACK_VERSION_TAG,
            viewport: viewportBucket(),
            color_scheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          });
          for (const [name, props] of queue.splice(0)) loaded.capture(name, props);
        },
      });
    })
    .catch(() => {
      starting = false;
    });
}

/** Set by main.tsx, so this module does not import config.ts. */
let STACK_VERSION_TAG = 'unknown';
export function setStackVersion(v: string): void {
  STACK_VERSION_TAG = v;
}

/** Record an event. No-op without a key; queued until the SDK loads. */
export function track(event: EventName | string, props: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined' || !KEY) return;
  const safe = scrubMoney(props);
  if (ph) {
    ph.capture(event, safe);
    return;
  }
  if (queue.length < QUEUE_MAX) queue.push([event, safe]);
  initAnalytics();
}

/** Super properties that change mid-session (market, theme, signed-in state). */
export function updateContext(props: Record<string, unknown>): void {
  ph?.register(scrubMoney(props));
}
