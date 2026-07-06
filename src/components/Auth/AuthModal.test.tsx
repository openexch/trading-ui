// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * AuthModal against the OMS demo auth endpoints (oms#72): a successful login
 * stores the session (localStorage 'oe.session') and closes the modal; a
 * register validation error is rendered inline and keeps the modal open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AuthProvider } from '../../auth/AuthContext';
import { setSession } from '../../auth/session';
import { AuthModal } from './AuthModal';

interface StubRoute {
  status: number;
  body: unknown;
}

function stubFetch(routes: Record<string, StubRoute>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const match = Object.entries(routes).find(([path]) => url.includes(path));
    const route = match ? match[1] : { status: 200, body: {} };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return { mock, calls };
}

function renderModal(onClose: () => void) {
  return render(
    <AuthProvider>
      <AuthModal onClose={onClose} />
    </AuthProvider>
  );
}

function fillAndSubmit(container: HTMLElement, username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('username'), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } });
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  fireEvent.click(submit);
}

describe('AuthModal', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    setSession(null); // reset the module-level store between tests
  });

  it('logs in, stores the session, and closes', async () => {
    const { calls } = stubFetch({
      '/api/v1/auth/login': {
        status: 200,
        body: { userId: 7, username: 'alice', token: 'tok-rotated-abc' },
      },
    });
    const onClose = vi.fn();
    const { container } = renderModal(onClose);

    fillAndSubmit(container, 'alice', 'hunter22');

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Session persisted for the next visit
    const stored = JSON.parse(localStorage.getItem('oe.session')!);
    expect(stored).toEqual({ token: 'tok-rotated-abc', userId: 7, username: 'alice' });

    // Credentials went to the login endpoint as JSON
    const login = calls.find((c) => c.url.includes('/api/v1/auth/login'))!;
    expect(login).toBeTruthy();
    expect(JSON.parse(String(login.init!.body))).toEqual({ username: 'alice', password: 'hunter22' });
  });

  it('shows the server error inline on a register validation failure', async () => {
    stubFetch({
      '/api/v1/auth/register': {
        status: 400,
        body: { error: 'Password must be at least 8 characters', code: 'ERR_VALIDATION' },
      },
    });
    const onClose = vi.fn();
    const { container } = renderModal(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    fillAndSubmit(container, 'bob', 'short');

    expect(await screen.findByText('Password must be at least 8 characters')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem('oe.session')).toBeNull();
  });

  it('surfaces a 409 username-taken error from register', async () => {
    stubFetch({
      '/api/v1/auth/register': {
        status: 409,
        body: { error: 'Username is already taken', code: 'ERR_CONFLICT' },
      },
    });
    const onClose = vi.fn();
    const { container } = renderModal(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    fillAndSubmit(container, 'alice', 'longenough1');

    expect(await screen.findByText('Username is already taken')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
