// SPDX-License-Identifier: Apache-2.0
import type { ProfileInfo } from './types';

interface ProfileSelectorProps {
  profiles: ProfileInfo[];
  active: string;
  disabled: boolean;
  onSelect: (name: string) => void;
}

/**
 * Stack runtime-profile switch in the admin header. Picking a different profile
 * applies it via a quorum-safe roll (confirmed upstream): JVM heaps, idle
 * strategy, CPU pinning, book capacity, sim load and the OS governor all move
 * together. The select is controlled by the live active profile, so a cancelled
 * confirm snaps it straight back; disabled while another operation holds the
 * progress slot.
 */
export function ProfileSelector({ profiles, active, disabled, onSelect }: ProfileSelectorProps) {
  if (profiles.length === 0) return null;
  const activeProfile = profiles.find((p) => p.name === active);
  return (
    <label className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
      <span className="hidden select-none sm:inline">Profile</span>
      <select
        aria-label="Stack runtime profile"
        title={activeProfile ? `${active}: ${activeProfile.description}` : undefined}
        value={active}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-md border border-hairline bg-surface-2 px-2 py-1 font-display text-text transition-colors hover:text-text-strong focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {!active && (
          <option value="" disabled>
            —
          </option>
        )}
        {profiles.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
