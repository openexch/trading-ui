// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * ProfilesEditor: render the profile CRUD editor with fetch mocked and assert
 * the list (BUILT-IN chips, active marker), read-only presets with the
 * duplicate notice, Save posting {name, profile} with edited values, the
 * active-profile delete guard, Apply delegating to onApply, and server
 * validation errors surfacing as sticky toasts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ToastProvider } from './Toasts';
import { ProfilesEditor } from './ProfilesEditor';
import type { FullProfile } from './types';

const fp = (name: string, builtin: boolean, over: Partial<FullProfile> = {}): FullProfile => ({
  name,
  builtin,
  description: `${name} profile`,
  nodeHeapMB: 768,
  omsHeapMB: 512,
  marketHeapMB: 512,
  backupHeapMB: 512,
  preTouch: false,
  idleMode: 'backoff',
  driverProfile: 'dev',
  driverMode: 'embedded',
  bookCapacity: 16384,
  logTermLength: '16m',
  minMemMB: 1024,
  simGlobalOps: 60,
  governor: 'schedutil',
  thp: 'madvise',
  pinning: 'none',
  ...over,
});

// Server order: presets first, customs after.
const PROFILES: FullProfile[] = [
  fp('light', true),
  fp('demo', true, { nodeHeapMB: 1536 }),
  fp('demo-lite', false, { nodeHeapMB: 1024 }),
];

/** fetch mock for the profiles CRUD; everything else answers empty-200. */
function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let failSave: { status: number; error: string } | null = null;
  const respond = (status: number, body: unknown) =>
    ({
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response;

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/api/admin/profiles')) {
      if (init?.method === 'POST') {
        if (failSave) return respond(failSave.status, { error: failSave.error });
        return respond(200, { message: 'profile saved', profile: {} });
      }
      if (init?.method === 'DELETE') return respond(200, { message: 'profile deleted' });
      return respond(200, { profiles: PROFILES });
    }
    return respond(200, {});
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return {
    calls,
    setFailSave: (f: { status: number; error: string } | null) => {
      failSave = f;
    },
  };
}

function renderEditor(props: Partial<Parameters<typeof ProfilesEditor>[0]> = {}) {
  return render(
    <ToastProvider>
      <ProfilesEditor activeName="demo" stackBusy={false} onApply={vi.fn()} {...props} />
    </ToastProvider>,
  );
}

describe('ProfilesEditor', () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    cleanup();
    fetchStub = stubFetch();
  });

  it('renders the fetched list with BUILT-IN chips and the active marker', async () => {
    renderEditor();

    // All three rows, server order preserved.
    expect(await screen.findByText('light')).toBeTruthy();
    expect(screen.getByText('demo-lite')).toBeTruthy();
    // BUILT-IN chips: two list rows + the selected (demo) form header.
    expect(screen.getAllByText('Built-in').length).toBe(3);
    // Active marker on the active profile (list row + form header).
    expect(screen.getAllByText('active').length).toBe(2);
  });

  it('renders a preset read-only with the duplicate notice and a prefilled save-as name', async () => {
    renderEditor();
    fireEvent.click(await screen.findByText('light'));

    expect(await screen.findByText('Built-in preset. Duplicate it below to customize.')).toBeTruthy();

    const nodeHeap = screen.getByLabelText('Node heap') as HTMLInputElement;
    expect(nodeHeap.disabled).toBe(true);
    expect(nodeHeap.value).toBe('768');
    expect((screen.getByLabelText('Driver mode') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Description') as HTMLInputElement).disabled).toBe(true);

    // Name input prefilled <preset>-custom; the button reads Save as new.
    expect((screen.getByLabelText('Profile name') as HTMLInputElement).value).toBe('light-custom');
    expect(screen.getByRole('button', { name: 'Save as new' })).toBeTruthy();
  });

  it('annotates every field with its apply tier — driver mode is the one cluster-stop', async () => {
    renderEditor();
    await screen.findByText('light');

    // 15 grouped fields for the selected profile: 1 warn chip, 14 live-roll.
    expect(screen.getAllByText('brief cluster stop').length).toBe(1);
    expect(screen.getAllByText('live roll').length).toBe(14);
    expect(screen.getByText(/quorum-safe live roll/)).toBeTruthy();
  });

  it('Save As from a preset posts {name, profile} without name/builtin in the payload', async () => {
    renderEditor();
    fireEvent.click(await screen.findByText('light'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save as new' }));

    await waitFor(() => {
      const post = fetchStub.calls.find(
        (c) => c.url.includes('/api/admin/profiles') && c.init?.method === 'POST',
      );
      expect(post, 'expected a POST /api/admin/profiles').toBeTruthy();
      const body = JSON.parse(String(post!.init!.body));
      expect(body.name).toBe('light-custom');
      expect(body.profile.nodeHeapMB).toBe(768);
      expect(body.profile.name).toBeUndefined();
      expect(body.profile.builtin).toBeUndefined();
    });
  });

  it('saving an edited custom posts the edited field values and refreshes the header', async () => {
    const onChanged = vi.fn();
    renderEditor({ onChanged });

    fireEvent.click(await screen.findByText('demo-lite'));
    fireEvent.change(await screen.findByLabelText('Node heap'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Pre-touch heap'), { target: { value: 'yes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const post = fetchStub.calls.find(
        (c) => c.url.includes('/api/admin/profiles') && c.init?.method === 'POST',
      );
      expect(post, 'expected a POST /api/admin/profiles').toBeTruthy();
      expect(JSON.parse(String(post!.init!.body))).toEqual({
        name: 'demo-lite',
        profile: {
          description: 'demo-lite profile',
          nodeHeapMB: 900,
          omsHeapMB: 512,
          marketHeapMB: 512,
          backupHeapMB: 512,
          minMemMB: 1024,
          preTouch: true,
          idleMode: 'backoff',
          pinning: 'none',
          bookCapacity: 16384,
          logTermLength: '16m',
          driverMode: 'embedded',
          driverProfile: 'dev',
          simGlobalOps: 60,
          governor: 'schedutil',
          thp: 'madvise',
        },
      });
    });
    // The list re-fetches and the page-level header refresh fires.
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const gets = fetchStub.calls.filter(
      (c) => c.url.includes('/api/admin/profiles') && (!c.init || !c.init.method || c.init.method === 'GET'),
    );
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it('disables Delete on the active custom profile with an explanatory title', async () => {
    renderEditor({ activeName: 'demo-lite' });

    const del = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.getAttribute('title')).toMatch(/active profile/);
  });

  it('deletes a non-active custom through the danger confirm and refreshes', async () => {
    const onChanged = vi.fn();
    renderEditor({ onChanged });

    fireEvent.click(await screen.findByText('demo-lite'));
    const del = (await screen.findByRole('button', { name: 'Delete' })) as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    fireEvent.click(del);

    expect(await screen.findByText('Delete profile "demo-lite"?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Profile' }));

    await waitFor(() => {
      const call = fetchStub.calls.find(
        (c) => c.url.includes('/api/admin/profiles/demo-lite') && c.init?.method === 'DELETE',
      );
      expect(call, 'expected a DELETE /api/admin/profiles/demo-lite').toBeTruthy();
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('Apply delegates to onApply and is disabled for the active profile', async () => {
    const onApply = vi.fn();
    renderEditor({ onApply });

    // demo is active — its Apply is disabled.
    const applyActive = (await screen.findByRole('button', { name: 'Apply' })) as HTMLButtonElement;
    expect(applyActive.disabled).toBe(true);

    fireEvent.click(screen.getByText('light'));
    const apply = (await screen.findByRole('button', { name: 'Apply' })) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith('light');
    // No direct POST /api/admin/profile from the editor — AdminPage owns it.
    expect(fetchStub.calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('surfaces a 400 from save as a sticky error toast with the server text', async () => {
    fetchStub.setFailSave({
      status: 400,
      error: "total JVM heap 4096MB + minMemMB floor 1024MB exceeds the box's 3902MB RAM",
    });
    renderEditor();

    fireEvent.click(await screen.findByText('demo-lite'));
    fireEvent.change(await screen.findByLabelText('Node heap'), { target: { value: '4096' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("exceeds the box's 3902MB RAM");
  });
});
