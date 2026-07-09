// SPDX-License-Identifier: Apache-2.0
// Pure formatting/labeling helpers for the admin console.
import type { LogSource } from './types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Format log/snapshot positions with K, M, G suffixes
export function formatPosition(pos: number | undefined): string {
  if (pos === undefined || pos < 0) return '--';
  if (pos < 1000) return pos.toString();
  if (pos < 1000000) return `${(pos / 1000).toFixed(1)}K`;
  if (pos < 1000000000) return `${(pos / 1000000).toFixed(1)}M`;
  return `${(pos / 1000000000).toFixed(2)}G`;
}

export function formatUptime(ms: number): string {
  if (ms <= 0) return '--';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function getLogSourceLabel(
  source: LogSource | null,
  resolveClusterDisplay?: (name: string) => string,
): string {
  if (!source) return 'Select a service or node to view logs';
  if (source.type === 'node') {
    const display = resolveClusterDisplay?.(source.cluster) ?? source.cluster;
    return `${display} · Node ${source.id}`;
  }
  switch (source.name) {
    case 'backup': return 'Backup Node';
    case 'market-gateway': return 'Market Gateway';
    case 'order-gateway': return 'Order Gateway';
    case 'admin-gateway': return 'Admin Gateway';
    case 'ui': return 'Trading UI';
    default: return source.name;
  }
}

export function processToLogName(name: string): string {
  switch (name) {
    case 'market': return 'market-gateway';
    case 'order': return 'order-gateway';
    case 'admin': return 'admin-gateway';
    default: return name;
  }
}

export function isSameLogSource(selected: LogSource | null, source: LogSource): boolean {
  if (!selected) return false;
  if (source.type === 'node' && selected.type === 'node') {
    return source.cluster === selected.cluster && source.id === selected.id;
  }
  if (source.type === 'service' && selected.type === 'service') {
    return source.name === selected.name;
  }
  return false;
}

export function getLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' {
  const lower = line.toLowerCase();
  // Word boundaries on the bare keywords so e.g. "unfailed" or a hex blob
  // containing "severe" doesn't tint the line; bracketed tags stay exact.
  if (lower.includes('[error]') || /\bexception\b/.test(lower) || /\bsevere\b/.test(lower) || /\bfailed\b/.test(lower)) {
    return 'error';
  }
  if (lower.includes('[warn]') || /\bwarning\b/.test(lower)) {
    return 'warn';
  }
  if (lower.includes('[info]') || lower.includes('[gateway]') || /\bstarted\b/.test(lower) || /\bconnected\b/.test(lower)) {
    return 'info';
  }
  return 'debug';
}
