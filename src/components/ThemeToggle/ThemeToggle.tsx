// SPDX-License-Identifier: Apache-2.0
import type { Theme } from '../../hooks/useTheme';

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

/** Sun/moon theme switch. Shared by the trading header and admin top bar. */
export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isDark ? 'Switch to light' : 'Switch to dark'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-surface-2 text-muted transition-colors hover:border-hairline-strong hover:text-text"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
