// SPDX-License-Identifier: Apache-2.0
// Decorative background system for the terminal's chrome (NOT behind live data).
// Faint dot-grid + soft accent glow + high-velocity light tracers that streak
// across, then rest — the still-then-zip cadence reads as speed. Purely
// decorative (aria-hidden), token-driven and theme-aware, GPU-friendly
// (transform/opacity only). All motion is governed by the global
// prefers-reduced-motion guard in index.css.

const glow = { background: 'radial-gradient(closest-side, var(--glow), transparent)' } as const;

// A light tracer. cyan ones echo the logo's blue→cyan gradient.
type Beam = { top: string; len: string; dur: string; delay: string; max: number; cyan?: boolean };

const HEADER_BEAMS: Beam[] = [
  { top: '30%', len: '16rem', dur: '6.5s', delay: '0s', max: 0.5 },
  { top: '60%', len: '22rem', dur: '7.5s', delay: '2.6s', max: 0.4, cyan: true },
  { top: '45%', len: '13rem', dur: '6s', delay: '4.4s', max: 0.45 },
];

/**
 * Header-band backdrop: dot-grid + glow + streaking tracers. Mount as the first
 * child of a `relative isolate overflow-hidden` header; content sits above it.
 */
export function BackgroundFX() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="bg-dotgrid absolute inset-0" />
      <div
        className="absolute -left-16 -top-24 h-[18rem] w-[18rem] rounded-full animate-drift"
        style={glow}
      />
      {HEADER_BEAMS.map((b, i) => (
        <span
          key={i}
          className="beam"
          style={{
            top: b.top,
            ['--len' as string]: b.len,
            ['--dur' as string]: b.dur,
            ['--delay' as string]: b.delay,
            ['--max' as string]: b.max,
            ['--beam' as string]: b.cyan ? '#22c3ee' : 'var(--accent)',
          }}
        />
      ))}
    </div>
  );
}
