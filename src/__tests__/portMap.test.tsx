// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * One case per port-map line (api/portMap.ts): each v1 call of the UI and the
 * v2 target it makes now, against mocked HTTP and WebSocket that speak the
 * gateway's documented shapes (docs/api.md of the gateway repository) and the
 * market-data service's golden frames. A line without a case fails the suite
 * with `port map line has no test: <call>`.
 *
 * Controls (each proven by a test that disables the behaviour):
 * - the user stream without resume: `stream resync not handled`;
 * - a book delta with a wrong fromVersion and no refresh sent:
 *   `book chain break not handled`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

type ChartProps = { candles: unknown[]; currentCandle: unknown; onIntervalChange: (i: string) => void; activeInterval: string };
const chart: { props: ChartProps | null } = { props: null };
vi.mock('../components/Chart/Chart', () => ({
  Chart: (p: ChartProps) => {
    chart.props = p;
    return <div data-testid="chart-mock" />;
  },
}));

import App from '../App';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { getSession, setSession } from '../auth/session';
import { AuthModal } from '../components/Auth/AuthModal';
import { BalancesProvider, useBalances } from '../hooks/useBalances';
import { transferFunds, useApi } from '../hooks/useApi';
import { useOrders } from '../hooks/useOrders';
import { useOrderHistory } from '../hooks/useOrderHistory';
import { useExecutions } from '../hooks/useExecutions';
import { useUserStream } from '../hooks/useUserStream';
import { notifyFillsGap } from '../hooks/fillsGap';
import { useMarketTickers } from '../hooks/useMarketTickers';
import { decodeMarketFrame } from '../api/marketFrames';
import { PORT_MAP, linesWithoutTest } from '../api/portMap';
import type { PortMapLineId } from '../api/portMap';
import { setMarketList } from '../markets/marketStore';
import type { ApiOrder, TickersMessage } from '../types/market';
import { GATEWAY_MARKETS_BODY } from '../test/gatewayMarkets';
import { apiError, apiOrder, asResponse, gatewayReply } from '../test/wire';
import type { Reply } from '../test/wire';

// ---- golden market frames (byte-exact copies, see api/marketFrames.test.ts)

const GOLDEN = import.meta.glob('../test/golden/marketdata/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const golden = (name: string) => GOLDEN[`../test/golden/marketdata/${name}.json`];

// ---- mocked WebSocket ----------------------------------------------------------

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  protocols?: string | string[];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  /** Server side: accept the upgrade. */
  open() {
    act(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  /** Server side: send one text frame. */
  receive(data: string | object) {
    act(() => {
      this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    });
  }
  /** Server side: drop the connection. */
  drop(code = 1006) {
    act(() => {
      this.readyState = 3;
      this.onclose?.({ code, reason: '', wasClean: false });
    });
  }
  frames(): Record<string, unknown>[] {
    return this.sent.map(s => JSON.parse(s));
  }
}

const sockets = (suffix: string) => MockWebSocket.instances.filter(w => w.url.endsWith(suffix));

// ---- mocked HTTP -----------------------------------------------------------------

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
/** Per-test answers, first match wins; anything else gets the gateway default. */
let routes: { match: (c: Call) => boolean; reply: Reply }[] = [];

function stubFetch() {
  calls = [];
  routes = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    const hit = routes.find(r => r.match(call));
    return asResponse(hit ? hit.reply : gatewayReply(call.url, call.method));
  }) as unknown as typeof fetch;
}

const callsTo = (method: string, path: string | RegExp) =>
  calls.filter(c => c.method === method && (typeof path === 'string' ? c.url === path : path.test(c.url)));

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const TOKEN = 'q3W0mB8xTokenForTests_abcdefghijklmnopqrstu';

function signIn() {
  localStorage.setItem('oe.session', JSON.stringify({ token: TOKEN, userId: 1007, username: 'alice_01' }));
  setSession({ token: TOKEN, userId: 1007, username: 'alice_01' });
}

function renderApp() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <BalancesProvider>
          <App />
        </BalancesProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** The app on screen, its market socket open and subscribed. */
async function appWithMarketSocket() {
  const view = renderApp();
  await screen.findByRole('button', { name: 'Bitcoin' });
  const ws = sockets('/ws').slice(-1)[0];
  ws.open();
  return { view, ws };
}

/** Switch the desktop app to SOL-USD (market 3, the golden frames' market). */
async function onSolana() {
  const { view, ws } = await appWithMarketSocket();
  fireEvent.click(screen.getByRole('button', { name: 'Solana' }));
  await waitFor(() => expect(ws.frames().slice(-1)[0]).toEqual({ action: 'subscribe', marketId: 3 }));
  return { view, ws };
}

const wrapAuth = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

// ---- control checks (each throws its control text when the behaviour is off) --------

/** Forced reconnect of the user stream: the subscribe resumes from the last
 *  eventSeq; a `resync` then a fresh snapshot replaces the orders. */
async function checkStreamResync(resume: boolean): Promise<void> {
  const snapshots: ApiOrder[][] = [];
  const resyncs: string[] = [];
  const { result, unmount } = renderHook(() =>
    useUserStream({
      token: TOKEN,
      resume,
      onOrderEvent: () => {},
      onSnapshot: rows => snapshots.push(rows),
      onResync: r => resyncs.push(r),
    }),
  );
  try {
    const first = sockets('/ws/v2').slice(-1)[0]!;
    first.open();
    first.receive({ type: 'subscribed', channels: ['orders'] });
    first.receive({ type: 'snapshot', channel: 'orders', asOf: { eventSeq: 88200 }, orders: [] });
    first.receive({ type: 'order', eventSeq: 88212, event: 'FILL', order: apiOrder({ orderId: '1042' }) });
    first.receive({ type: 'heartbeat', eventSeq: 88230 });

    act(() => result.current.forceReconnect());
    const second = sockets('/ws/v2').slice(-1)[0]!;
    second.open();
    const sub = second.frames().find(f => f.op === 'subscribe') as { resume?: { eventSeq: number } } | undefined;
    // The stream answers a resume it cannot serve with resync + snapshot.
    second.receive({ type: 'resync', reason: 'RESUME_TOO_OLD' });
    second.receive({ type: 'snapshot', channel: 'orders', asOf: { eventSeq: 90000 }, orders: [apiOrder({ orderId: '2001' })] });
    const resumed = sub?.resume?.eventSeq === 88230;
    const replaced = snapshots.slice(-1)[0]?.[0]?.orderId === '2001' && resyncs[0] === 'RESUME_TOO_OLD';
    if (!resumed || !replaced) throw new Error('stream resync not handled');
  } finally {
    unmount();
  }
}

/** Fills missed across a stream gap come back: after a `resync` (mode
 *  'resync') or a reconnect that could not resume (mode 'reconnect'), the
 *  fills list re-reads GET /api/v2/fills page 1 until its asOf.eventSeq
 *  reaches the new snapshot's. `wired` false gives the stream a no-op gap
 *  handler (the control). */
async function checkFillsGap(mode: 'resync' | 'reconnect', wired: boolean): Promise<void> {
  const fill = (tradeId: string, executedAt: number) => ({
    tradeId, orderId: '1042', marketId: '1', side: 'BUY', price: '65000.5', quantity: '0.004', maker: true, executedAt,
  });
  // Answers in order: the mount read, then a lagging re-read, then the
  // re-read that has the missed fill (asOf at or above E = 90000).
  const pages = [
    { items: [fill('500230', 1)], nextCursor: null, asOf: { eventSeq: 88200 } },
    { items: [fill('500230', 1)], nextCursor: null, asOf: { eventSeq: 89990 } },
    { items: [fill('500231', 2), fill('500230', 1)], nextCursor: null, asOf: { eventSeq: 90000 } },
  ];
  let reads = 0;
  const route = {
    match: (c: Call) => c.url.startsWith('/api/v2/fills') && ++reads > 0,
    reply: {
      status: 200,
      get body() {
        return pages[Math.min(reads - 1, pages.length - 1)];
      },
    } as Reply,
  };
  routes.unshift(route);

  const fills = renderHook(() => useExecutions());
  const stream = renderHook(() =>
    useUserStream({
      token: TOKEN,
      resume: mode === 'resync',
      onOrderEvent: () => {},
      onFillsGap: wired ? notifyFillsGap : () => {},
    }),
  );
  try {
    await waitFor(() => expect(fills.result.current.executions).toHaveLength(1));
    const first = sockets('/ws/v2').slice(-1)[0];
    first.open();
    first.receive({ type: 'snapshot', channel: 'orders', asOf: { eventSeq: 88200 }, orders: [] });
    first.receive({ type: 'heartbeat', eventSeq: 88230 });
    act(() => stream.result.current.forceReconnect());
    const second = sockets('/ws/v2').slice(-1)[0];
    second.open();
    if (mode === 'resync') second.receive({ type: 'resync', reason: 'RESUME_TOO_OLD' });
    second.receive({ type: 'snapshot', channel: 'orders', asOf: { eventSeq: 90000 }, orders: [] });
    try {
      await waitFor(() => expect(fills.result.current.executions.map(e => e.tradeId)).toEqual(['500231', '500230']), {
        timeout: 2500,
      });
    } catch {
      throw new Error('stream fills gap not closed');
    }
  } finally {
    stream.unmount();
    fills.unmount();
    routes.splice(routes.indexOf(route), 1);
  }
}

/** A delta whose fromVersion is not the held version must make the app ask
 *  for a fresh snapshot on the same socket. `dropRefresh` suppresses the
 *  socket's refresh sends (the control). */
async function checkChainBreakRefresh(dropRefresh: boolean): Promise<void> {
  const { ws, view } = await onSolana();
  try {
    if (dropRefresh) {
      const send = ws.send.bind(ws);
      ws.send = (data: string) => {
        if (!data.includes('"refresh"')) send(data);
      };
    }
    ws.receive(golden('book_snapshot_base')); // bookVersion 2199023255553
    await waitFor(() => expect(view.container.textContent).toContain('$13.99'));
    const before = ws.sent.length;
    const delta = JSON.parse(golden('book_delta_80'));
    delta.fromVersion = 2199023255999; // not the held version
    delta.bookVersion = 2199023256000;
    ws.receive(delta);
    try {
      await waitFor(() =>
        expect(ws.frames().slice(before).some(f => f.action === 'refresh' && f.marketId === 3)).toBe(true),
      );
    } catch {
      throw new Error('book chain break not handled');
    }
  } finally {
    view.unmount();
  }
}

// ---- one case per port-map line ---------------------------------------------------

const CASES: Record<PortMapLineId, () => Promise<void>> = {
  async register() {
    routes.push({
      match: c => c.url === '/api/v2/auth/register',
      reply: { status: 201, body: { userId: '1007', username: 'alice_01', token: 'tok-new', funded: true } },
    });
    const onClose = vi.fn();
    const { container } = render(<AuthProvider><AuthModal onClose={onClose} /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: 'alice_01' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'correct horse' } });
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [call] = callsTo('POST', '/api/v2/auth/register');
    expect(call.body).toEqual({ username: 'alice_01', password: 'correct horse' });
    expect(call.headers.Authorization).toBeUndefined();
    expect(getSession()).toEqual({ token: 'tok-new', userId: 1007, username: 'alice_01' });
  },

  async login() {
    routes.push({
      match: c => c.url === '/api/v2/auth/login',
      reply: { status: 200, body: { userId: '1007', username: 'alice_01', token: 'tok-rotated' } },
    });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapAuth });
    let ok = false;
    await act(async () => {
      ok = (await result.current.login('alice_01', 'correct horse')).ok;
    });
    expect(ok).toBe(true);
    expect(callsTo('POST', '/api/v2/auth/login')).toHaveLength(1);
    expect(getSession()?.token).toBe('tok-rotated');
    // A refused login shows the gateway's text and stores nothing.
    setSession(null);
    routes.unshift({
      match: c => c.url === '/api/v2/auth/login',
      reply: { status: 401, body: apiError('UNAUTHORIZED', 'invalid username or password') },
    });
    let error: string | undefined;
    await act(async () => {
      error = (await result.current.login('alice_01', 'wrong')).error;
    });
    expect(error).toBe('invalid username or password');
    expect(getSession()).toBeNull();
  },

  async 'stored-session'() {
    signIn();
    const first = renderHook(() => useAuth(), { wrapper: wrapAuth });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    const [me] = callsTo('GET', '/api/v2/auth/me');
    expect(me.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(first.result.current.session?.token).toBe(TOKEN);
    first.unmount();
    // A 401 on me clears the stored session.
    routes.push({ match: c => c.url === '/api/v2/auth/me', reply: { status: 401, body: apiError('UNAUTHORIZED', 'unauthorized') } });
    const second = renderHook(() => useAuth(), { wrapper: wrapAuth });
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.session).toBeNull();
    expect(localStorage.getItem('oe.session')).toBeNull();
  },

  async logout() {
    signIn();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapAuth });
    await act(async () => {
      await result.current.logout();
    });
    const [call] = callsTo('POST', '/api/v2/auth/logout');
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.body).toBeUndefined();
    expect(getSession()).toBeNull();
    // A failed revoke still clears locally.
    signIn();
    routes.push({ match: c => c.url === '/api/v2/auth/logout', reply: { status: 503, body: apiError('AUTH_UNAVAILABLE', 'the users store cannot answer') } });
    await act(async () => {
      await result.current.logout();
    });
    expect(getSession()).toBeNull();
  },

  async balances() {
    signIn();
    routes.push({
      match: c => c.url === '/api/v2/balances',
      reply: {
        status: 200,
        body: {
          asOf: { logPosition: 51234816 },
          assets: [
            { assetId: '1', asset: 'BTC', available: '0.5', locked: '0', total: '0.5' },
            { assetId: '0', asset: 'USD', available: '9349.995', locked: '650.005', total: '10000' },
          ],
        },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider><BalancesProvider>{children}</BalancesProvider></AuthProvider>
    );
    const { result } = renderHook(() => useBalances(), { wrapper });
    await waitFor(() => expect(result.current.assets).toHaveLength(2));
    expect(result.current.assets[1]).toEqual({ assetId: '0', asset: 'USD', available: 9349.995, locked: 650.005, total: 10000 });
    expect(calls.some(c => /\/accounts\//.test(c.url))).toBe(false);
  },

  async deposit() {
    signIn();
    const r = await transferFunds('deposit', '0', 1000);
    expect(r).toEqual({ success: true, message: 'Deposit successful' });
    const [call] = callsTo('POST', '/api/v2/balances/deposit');
    expect(call.body).toEqual({ assetId: '0', amount: '1000.00000000' });
    expect(call.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    // The faucet cap is the gateway's refusal, shown with its detail.
    routes.push({
      match: c => c.url === '/api/v2/balances/deposit',
      reply: { status: 422, body: apiError('REJECTED', 'above the faucet cap', null, 'at most 10000 of asset 0 per request') },
    });
    expect((await transferFunds('deposit', '0', 99999)).message).toBe('at most 10000 of asset 0 per request');
    // A new attempt is a new key.
    const keys = callsTo('POST', '/api/v2/balances/deposit').map(c => c.headers['Idempotency-Key']);
    expect(new Set(keys).size).toBe(2);
  },

  async withdraw() {
    signIn();
    expect((await transferFunds('withdraw', '0', 5)).success).toBe(true);
    const [call] = callsTo('POST', '/api/v2/balances/withdraw');
    expect(call.body).toEqual({ assetId: '0', amount: '5.00000000' });
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    // Refused for funds.
    routes.push({
      match: c => c.url === '/api/v2/balances/withdraw',
      reply: { status: 422, body: apiError('REJECTED', 'rejected by the core', 'INSUFFICIENT_FUNDS') },
    });
    const refused = await transferFunds('withdraw', '0', 1e9);
    expect(refused).toEqual({ success: false, message: 'insufficient balance for this order' });
  },

  async place() {
    signIn();
    await import('../test/markets');
    const { result } = renderHook(() => useApi());
    let r = { success: false, message: '' };
    await act(async () => {
      r = await result.current.submitOrder({
        market: 'BTC-USD', orderType: 'LIMIT', orderSide: 'BID', price: 65000.5, quantity: 0.01, timestamp: 0,
      });
    });
    expect(r).toEqual({ success: true, message: 'Order accepted (1042)' });
    const [call] = callsTo('POST', '/api/v2/orders');
    expect(call.body).toEqual({
      marketId: '1', side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', price: '65000.50000000', quantity: '0.01000000',
    });
    expect(call.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // A core reject is a 4xx with the error body; the reason is shown.
    routes.push({
      match: c => c.url === '/api/v2/orders' && c.method === 'POST',
      reply: { status: 422, body: { ...apiError('REJECTED', 'rejected by the core', 'INSUFFICIENT_FUNDS'), keyFinal: true } },
    });
    await act(async () => {
      r = await result.current.submitOrder({
        market: 'BTC-USD', orderType: 'MARKET', orderSide: 'ASK', price: 0, quantity: 1, timestamp: 0,
      });
    });
    expect(r).toEqual({ success: false, message: 'insufficient balance for this order' });
    // A MARKET order carries no price and is IOC.
    expect(callsTo('POST', '/api/v2/orders')[1].body).toEqual({
      marketId: '1', side: 'SELL', type: 'MARKET', timeInForce: 'IOC', quantity: '1.00000000',
    });
    // A time in force the type does not take is refused before sending.
    await act(async () => {
      r = await result.current.submitOrder({
        market: 'BTC-USD', orderType: 'STOP_LOSS', orderSide: 'ASK', price: 0, stopPrice: 60000, quantity: 1,
        timeInForce: 'IOC', timestamp: 0,
      });
    });
    expect(r).toEqual({ success: false, message: 'this time in force is not available for this order type' });
    expect(callsTo('POST', '/api/v2/orders')).toHaveLength(2);
  },

  async amend() {
    signIn();
    const { result } = renderHook(() => useApi());
    let r = { success: false, message: '' };
    await act(async () => {
      r = await result.current.replaceOrder('1042', 64990);
    });
    expect(r.success).toBe(true);
    const [call] = callsTo('PUT', '/api/v2/orders/1042');
    expect(call.body).toEqual({ price: '64990.00000000' });
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    // PENDING_REPLACE is shown as an open order, then the new price.
    const orders = renderHook(() => useOrders());
    act(() => orders.result.current.handleOrderEvent(apiOrder({ orderId: '1042', price: '65000', status: 'PENDING_REPLACE' })));
    expect(orders.result.current.openOrders.map(o => [o.status, o.price])).toEqual([['PENDING_REPLACE', 65000]]);
    act(() => orders.result.current.handleOrderEvent(apiOrder({ orderId: '1042', price: '64990', status: 'NEW' })));
    expect(orders.result.current.openOrders.map(o => [o.status, o.price])).toEqual([['NEW', 64990]]);
  },

  async cancel() {
    signIn();
    const { result } = renderHook(() => useApi());
    const cancel = async (id: string) => {
      let r: Awaited<ReturnType<typeof result.current.cancelOrder>> = { success: false, message: '' };
      await act(async () => {
        r = await result.current.cancelOrder(id);
      });
      return r;
    };
    expect(await cancel('1042')).toEqual({ success: true, message: 'Order cancelled', gone: true });
    const [call] = callsTo('DELETE', '/api/v2/orders/1042');
    expect(call.body).toBeUndefined();
    expect(call.headers['Idempotency-Key']).toBeTruthy();
    routes.push(
      { match: c => c.url.endsWith('/orders/404'), reply: { status: 404, body: apiError('NOT_FOUND', 'not found', 'UNKNOWN_ORDER') } },
      { match: c => c.url.endsWith('/orders/409'), reply: { status: 409, body: apiError('CONFLICT', 'conflict', 'NOT_OPEN') } },
      { match: c => c.url.endsWith('/orders/419'), reply: { status: 409, body: apiError('CONFLICT', 'conflict', 'AMEND_PENDING') } },
    );
    expect(await cancel('404')).toEqual({ success: false, message: 'Order is no longer open', gone: true });
    expect(await cancel('409')).toEqual({ success: false, message: 'Order is no longer open', gone: true });
    expect(await cancel('419')).toEqual({ success: false, message: 'an amend of this order is still on its way', gone: false });
  },

  async 'open-orders-seed'() {
    signIn();
    routes.push({
      match: c => c.url === '/api/v2/orders' && c.method === 'GET',
      reply: { status: 200, body: { asOf: { logPosition: 7 }, orders: [apiOrder({ orderId: '3001', marketId: '2', price: '3500' })] } },
    });
    await appWithMarketSocket();
    const stream = sockets('/ws/v2')[0];
    expect(stream.protocols).toEqual(['bearer', TOKEN]);
    stream.open();
    const seeds = () => callsTo('GET', '/api/v2/orders').length;
    await waitFor(() => expect(seeds()).toBeGreaterThanOrEqual(2)); // session change + connect
    expect(calls.some(c => c.url.includes('marketId=') && c.url.includes('/api/v2/orders'))).toBe(false);
    // A forced reconnect: the open orders come from the GET /orders seed again.
    const before = seeds();
    stream.drop();
    await waitFor(() => expect(sockets('/ws/v2')).toHaveLength(2), { timeout: 3000 });
    sockets('/ws/v2')[1].open();
    await waitFor(() => expect(seeds()).toBe(before + 1));
    await waitFor(() => expect(screen.getByRole('button', { name: /open orders \(1\)/i })).toBeTruthy());
  },

  async history() {
    signIn();
    const page1 = {
      items: [apiOrder({ orderId: '11', status: 'FILLED', updatedAt: 9 }), apiOrder({ orderId: '12', status: 'NEW' })],
      nextCursor: 'b3x9',
      asOf: { ageMs: 120, stale: false, eventSeq: 88230 },
    };
    const page2 = { items: [apiOrder({ orderId: '10', status: 'CANCELLED' })], nextCursor: null, asOf: page1.asOf };
    routes.push(
      { match: c => c.url === '/api/v2/orders/history?limit=100', reply: { status: 200, body: page1 } },
      { match: c => c.url === '/api/v2/orders/history?limit=100&cursor=b3x9', reply: { status: 200, body: page2 } },
    );
    const { result } = renderHook(() => useOrderHistory());
    await waitFor(() => expect(result.current.orders.map(o => o.omsOrderId)).toEqual(['11']));
    expect(result.current.hasMore).toBe(true);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.orders.map(o => o.omsOrderId)).toEqual(['11', '10']);
    expect(result.current.hasMore).toBe(false);
    expect(calls.some(c => c.url.includes('offset'))).toBe(false);
    // No history projection: 503 HISTORY_UNAVAILABLE.
    routes.unshift({ match: c => c.url.startsWith('/api/v2/orders/history'), reply: { status: 503, body: apiError('HISTORY_UNAVAILABLE', 'history is not available') } });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe('Order history unavailable: the history service is not answering');
  },

  async fills() {
    signIn();
    const fill = (tradeId: string, maker: boolean | null) => ({
      tradeId, orderId: '1042', marketId: '1', side: 'BUY', price: '65000.5', quantity: '0.004', maker, executedAt: 1763373601200,
    });
    routes.push(
      { match: c => c.url === '/api/v2/fills?limit=100', reply: { status: 200, body: { items: [fill('500231', true)], nextCursor: 'ZjF8', asOf: {} } } },
      { match: c => c.url === '/api/v2/fills?limit=100&cursor=ZjF8', reply: { status: 200, body: { items: [fill('500230', null)], nextCursor: null, asOf: {} } } },
    );
    const { result } = renderHook(() => useExecutions());
    await waitFor(() => expect(result.current.executions).toHaveLength(1));
    expect(result.current.executions[0]).toEqual({
      tradeId: '500231', omsOrderId: '1042', marketId: 1, side: 'BUY', price: 65000.5, quantity: 0.004, maker: true, executedAtMs: 1763373601200,
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.executions.map(e => [e.tradeId, e.maker])).toEqual([['500231', true], ['500230', false]]);
  },

  async stream() {
    // Typed frames: order events upsert, terminal events remove.
    const events: ApiOrder[] = [];
    const { unmount } = renderHook(() => useUserStream({ token: 'dev:1', onOrderEvent: o => events.push(o) }));
    const ws = sockets('/ws/v2').slice(-1)[0]!;
    expect(ws.url).toBe(`ws://${window.location.host}/ws/v2`);
    expect(ws.protocols).toBeUndefined(); // a dev token is not a subprotocol token
    ws.open();
    expect(ws.frames().slice(0, 2)).toEqual([
      { op: 'auth', token: 'dev:1' },
      { op: 'subscribe', channels: ['orders'] },
    ]);
    ws.receive({ type: 'order', eventSeq: 5, event: 'ACK_NEW', order: apiOrder() });
    ws.receive({ type: 'admission', marketId: '0', gate: 'OPEN', reasons: [], circuitBreaker: false });
    expect(events.map(e => e.orderId)).toEqual(['1042']);
    unmount();
    // Heartbeat, resume and resync.
    await checkStreamResync(true);
    // Fills missed across a resync, and across a reconnect that could not
    // resume, are re-read from GET /api/v2/fills.
    await checkFillsGap('resync', true);
    await checkFillsGap('reconnect', true);
  },

  async 'market-switch'() {
    const { ws } = await appWithMarketSocket();
    expect(ws.frames()[0]).toEqual({ action: 'subscribe', marketId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Ethereum' }));
    await waitFor(() => expect(ws.frames()).toHaveLength(2));
    // One connection; the new subscribe replaces the market.
    expect(sockets('/ws')).toHaveLength(1);
    expect(ws.frames().slice(-1)[0]).toEqual({ action: 'subscribe', marketId: 2 });
    expect(ws.frames().some(f => f.action === 'unsubscribe')).toBe(false);
  },

  async book() {
    const { ws, view } = await onSolana();
    ws.receive(golden('subscription_confirmed'));
    ws.receive(golden('book_snapshot_base'));
    await waitFor(() => expect(view.container.textContent).toContain('$13.99'));
    expect(view.container.textContent).toContain('$15.80');
    view.unmount();
    await checkChainBreakRefresh(false);
  },

  async tape() {
    const { ws, view } = await onSolana();
    ws.receive(golden('trades_batch_initial'));
    ws.receive(golden('trades_batch_flush'));
    await waitFor(() => expect(view.container.textContent).toContain('$15,003.00'));
    for (const p of ['$15,001.00', '$14,999.00', '$15,000.50', '$15,002.00']) expect(view.container.textContent).toContain(p);
  },

  async 'candles-1m'() {
    const { ws } = await onSolana();
    ws.receive(golden('candle_history_1m'));
    await waitFor(() => expect(chart.props?.candles).toHaveLength(2));
    expect(chart.props!.candles[1]).toEqual({ time: 1700000100, open: 14999, high: 15000.5, low: 14999, close: 15000.5, volume: 0.5, tradeCount: 2 });
    ws.receive(golden('candle_update_open'));
    await waitFor(() => expect(chart.props?.currentCandle).toEqual({
      time: 1700000100, open: 14999, high: 15002, low: 14999, close: 15002, volume: 0.55, tradeCount: 3,
    }));
    ws.receive(golden('candle_update_new'));
    await waitFor(() => expect(chart.props?.candles).toHaveLength(3));
  },

  async 'candles-5m'() {
    routes.push({ match: c => c.url.startsWith('/api/candles'), reply: { status: 200, body: JSON.parse(golden('candles_body_5m')) } });
    await onSolana();
    act(() => chart.props!.onIntervalChange('5m'));
    await waitFor(() => expect(chart.props?.candles).toHaveLength(2));
    const [call] = callsTo('GET', /^\/api\/candles\?/);
    expect(call.url).toBe('/api/candles?marketId=3&interval=5m&limit=200');
    // Cross-origin to the market-data service: no credential is sent.
    expect(call.headers.Authorization).toBeUndefined();
    expect(chart.props!.candles[0]).toEqual({ time: 1699999800, open: 15000, high: 15001, low: 15000, close: 15001, volume: 0.75, tradeCount: 2 });
  },

  async tickers() {
    // The header's TICKER_STATS moves after a trade.
    const { ws, view } = await onSolana();
    ws.receive(golden('tickers_handshake'));
    ws.receive(golden('ticker_stats_initial'));
    await waitFor(() => expect(view.container.textContent).toContain('$15,000.50'));
    ws.receive(golden('ticker_stats_flush'));
    await waitFor(() => expect(view.container.textContent).toContain('$15,003.00'));
    // The all-market TICKERS frame moves the market list's map.
    const { result } = renderHook(() => useMarketTickers());
    act(() => result.current.handleTickers(decodeMarketFrame(JSON.parse(golden('tickers_handshake'))) as TickersMessage));
    expect(result.current.tickers.get(3)?.lastPrice).toBe(15000.5);
    act(() => result.current.handleTickers(decodeMarketFrame(JSON.parse(golden('tickers_changed'))) as TickersMessage));
    expect(result.current.tickers.get(3)?.lastPrice).toBe(15003);
  },

  async markets() {
    setMarketList({ markets: [], assets: [] });
    // The first answer is a 503 (core config not loaded): the page waits and retries.
    const withAda = {
      ...GATEWAY_MARKETS_BODY,
      markets: [
        ...GATEWAY_MARKETS_BODY.markets,
        { ...GATEWAY_MARKETS_BODY.markets[0], marketId: '6', symbol: 'ADA-USD', baseAsset: 'ADA', tickSize: '0.0001' },
      ],
    };
    let first = true;
    routes.push({
      match: c => {
        if (c.url !== '/api/v2/markets') return false;
        if (first) {
          first = false;
          return true;
        }
        return false;
      },
      reply: { status: 503, body: apiError('CORE_UNAVAILABLE', 'the core config is not loaded yet') },
    });
    routes.push({ match: c => c.url === '/api/v2/markets', reply: { status: 200, body: withAda } });
    renderApp();
    await screen.findByRole('button', { name: 'Bitcoin' }, { timeout: 5000 });
    expect(callsTo('GET', '/api/v2/markets')).toHaveLength(2);
    expect(callsTo('GET', '/api/v2/markets')[0].headers.Authorization).toBeUndefined();
    // Names, ticks and ranges are the gateway's: a market the UI never knew is listed.
    expect(screen.getByRole('button', { name: 'ADA' })).toBeTruthy();
  },
};

describe('port map: every v1 call has its v2 target', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    setSession(null);
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    stubMatchMedia();
    stubFetch();
    chart.props = null;
    const { TEST_MARKET_LIST } = await import('../test/markets');
    setMarketList(TEST_MARKET_LIST);
  });
  afterEach(() => {
    cleanup();
  });

  for (const line of PORT_MAP) {
    it(`${line.id}: ${line.v1} -> ${line.v2}`, async () => {
      const run = CASES[line.id];
      if (typeof run !== 'function') throw new Error(`port map line has no test: ${line.v1}`);
      await run();
    }, 10000);
  }

  it('every port-map line has a case', () => {
    const missing = linesWithoutTest(PORT_MAP, CASES);
    expect(missing, missing.join('; ')).toEqual([]);
    expect(PORT_MAP).toHaveLength(21);
  });
});

describe('port map: controls', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    setSession(null);
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    stubMatchMedia();
    stubFetch();
    const { TEST_MARKET_LIST } = await import('../test/markets');
    setMarketList(TEST_MARKET_LIST);
  });

  it('a port-map line without a case fails with its call named', () => {
    const { cancel: _dropped, ...partial } = CASES;
    void _dropped;
    expect(linesWithoutTest(PORT_MAP, partial)).toEqual(['port map line has no test: DELETE /api/v1/orders/{id}']);
  });

  it('the user stream with resume disabled is caught', async () => {
    await expect(checkStreamResync(false)).rejects.toThrow('stream resync not handled');
  });

  it('a stream gap whose fills are not re-read is caught (resync)', async () => {
    await expect(checkFillsGap('resync', false)).rejects.toThrow('stream fills gap not closed');
  });

  it('a stream gap whose fills are not re-read is caught (reconnect without resume)', async () => {
    await expect(checkFillsGap('reconnect', false)).rejects.toThrow('stream fills gap not closed');
  });

  it('a chain break without a refresh is caught', async () => {
    await expect(checkChainBreakRefresh(true)).rejects.toThrow('book chain break not handled');
  });
});
