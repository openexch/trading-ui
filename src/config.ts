// Dev bearer token for the OMS dev auth provider (oms#36). The backend derives
// the caller's identity from it; request bodies and query strings no longer
// carry a userId. Point VITE_AUTH_TOKEN at a real API key / JWT when the OMS
// runs in api-key or jwt mode.
export const AUTH_TOKEN: string = import.meta.env.VITE_AUTH_TOKEN || 'dev:1';

export const AUTH_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

// The user the dev token maps to — used only for URL paths and display,
// never sent in request payloads.
export const DEMO_USER_ID: number = (() => {
  const m = /^dev:(\d+)$/.exec(AUTH_TOKEN);
  return m ? Number(m[1]) : 1;
})();
