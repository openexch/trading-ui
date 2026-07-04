// SPDX-License-Identifier: Apache-2.0
// Brand mark — the three-chevron motif from the logo, blue→cyan gradient.
// Uses its own gradient stroke (not currentColor) so it stays on-brand in any theme.
import type { SVGProps } from 'react';

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={26} height={26} viewBox="0 0 40 40" fill="none" aria-hidden {...props}>
      <defs>
        <linearGradient id="oe-mark" x1="5" y1="34" x2="35" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1f6fe0" />
          <stop offset="1" stopColor="#2ec5ee" />
        </linearGradient>
      </defs>
      <g stroke="url(#oe-mark)" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 6 17 20 5 34" />
        <path d="M14 6 26 20 14 34" />
        <path d="M23 6 35 20 23 34" />
      </g>
    </svg>
  );
}
