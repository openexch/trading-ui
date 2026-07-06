// SPDX-License-Identifier: Apache-2.0
// Square icon-button recipes shared by the node and service cards.
export const iconBtnBase =
  'flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed [&_svg]:h-3.5 [&_svg]:w-3.5';
export const iconBtnStop = `${iconBtnBase} bg-sell-soft text-sell hover:brightness-110`;
export const iconBtnRestart = `${iconBtnBase} bg-warn-soft text-warn hover:brightness-110`;
export const iconBtnStart = `${iconBtnBase} bg-buy-soft text-buy hover:brightness-110`;
export const iconBtnAccent = `${iconBtnBase} bg-accent-soft text-accent hover:brightness-110`;
export const iconBtnLogs = (active: boolean) =>
  `${iconBtnBase} ${active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted hover:text-text'}`;
