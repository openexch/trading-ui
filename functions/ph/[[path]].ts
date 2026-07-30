// SPDX-License-Identifier: Apache-2.0
/**
 * Cloudflare Pages Function: first-party proxy for PostHog.
 *
 * The SDK talks to /ph/* on this origin instead of *.i.posthog.com, so a
 * content blocker does not silently remove the analytics of the visitors most
 * likely to be running one. It changes nothing about where the data ends up:
 * PostHog's EU infrastructure, as /privacy on the marketing site states.
 *
 * Two upstreams, not interchangeable:
 *   /ph/static/*  -> eu-assets.i.posthog.com   (SDK bundles, cacheable)
 *   /ph/*         -> eu.i.posthog.com          (ingestion + flags, never cached)
 *
 * Inert without analytics: if VITE_POSTHOG_KEY was never set at build time the
 * SDK is not in the bundle, nothing calls this route, and it costs nothing.
 */

const PH_INGEST = 'https://eu.i.posthog.com';
const PH_ASSETS = 'https://eu-assets.i.posthog.com';

interface Context {
  request: Request;
  params: { path?: string | string[] };
}

export const onRequest = async ({ request, params }: Context): Promise<Response> => {
  const raw = params.path;
  const path = Array.isArray(raw) ? raw.join('/') : (raw ?? '');
  const cacheable = path.startsWith('static/');
  const origin = cacheable ? PH_ASSETS : PH_INGEST;

  const incoming = new URL(request.url);
  const target = new URL(`/${path}${incoming.search}`, origin);

  const headers = new Headers(request.headers);
  // Cookies have no business upstream: this integration is cookieless, and a
  // forwarded Host makes PostHog's routing reject the request.
  headers.delete('cookie');
  headers.delete('host');
  headers.set('host', target.host);
  // Pin the encoding to one this function can undo itself; DecompressionStream
  // handles gzip and deflate but not brotli.
  headers.set('accept-encoding', 'gzip');

  let res: Response;
  try {
    res = await fetch(
      new Request(target.toString(), {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'follow',
      }),
    );
  } catch {
    // A dead analytics upstream must never look like a broken exchange UI.
    return new Response(null, { status: 204 });
  }

  const out = new Headers(res.headers);
  // Never let an upstream Set-Cookie through: it would quietly turn a
  // deliberately cookieless integration into a cookie one.
  out.delete('set-cookie');
  out.set('cache-control', cacheable ? 'public, max-age=3600' : 'no-store');

  // Rebuilding a Response from res.body keeps the body encoded while the header
  // still says gzip, so a client that never advertised gzip would receive
  // compressed bytes it did not ask for. Browsers always advertise it, which is
  // exactly why this is worth handling explicitly.
  let body = res.body;
  const clientAccepts = request.headers.get('accept-encoding') ?? '';
  if (body && res.headers.get('content-encoding') === 'gzip' && !/\bgzip\b/i.test(clientAccepts)) {
    body = body.pipeThrough(new DecompressionStream('gzip'));
    out.delete('content-encoding');
    out.delete('content-length');
  }

  return new Response(body, { status: res.status, statusText: res.statusText, headers: out });
};
