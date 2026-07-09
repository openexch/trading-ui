// SPDX-License-Identifier: Apache-2.0
// 200-line log tail for the selected node/service: level filter chips,
// per-line level tinting, auto-scroll to the newest line.
import { useEffect, useRef, useState } from 'react';
import { Icons } from '../Icons';
import { getLogLevel, getLogSourceLabel } from './format';
import type { LogSource } from './types';

interface LogViewerProps {
  logSource: LogSource | null;
  logs: string[];
  /** The 2s tail poll is failing — shown inline, never as a toast. */
  unavailable?: boolean;
  /** Maps a cluster name to its display so node labels read "Matching Engine · Node 0". */
  resolveClusterDisplay?: (name: string) => string;
  onClear: () => void;
}

export function LogViewer({ logSource, logs, unavailable = false, resolveClusterDisplay, onClear }: LogViewerProps) {
  const [logFilters, setLogFilters] = useState({ error: true, warn: true, info: true, debug: true });
  const logsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredLogs = logs.filter(line => {
    const level = getLogLevel(line);
    return logFilters[level];
  });

  const toggleFilter = (filter: 'error' | 'warn' | 'info' | 'debug') => {
    setLogFilters(prev => ({ ...prev, [filter]: !prev[filter] }));
  };

  return (
    <section className="rounded-lg border border-hairline bg-surface p-6">
      <div className="mb-5 flex flex-wrap items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
        {Icons.logs}
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Logs</h2>
        <span className="flex-1">
          {logSource ? (
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-[11px] font-medium text-text">
              {getLogSourceLabel(logSource, resolveClusterDisplay)}
            </span>
          ) : (
            <span className="text-[11px] text-faint">{getLogSourceLabel(null)}</span>
          )}
        </span>
        {logSource && (
          <>
            <div className="flex flex-wrap gap-1">
              <button
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.error ? 'border-sell/30 bg-sell-soft text-sell' : 'border-transparent text-muted hover:text-text'}`}
                onClick={() => toggleFilter('error')}
              >
                Error
              </button>
              <button
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.warn ? 'border-warn/30 bg-warn-soft text-warn' : 'border-transparent text-muted hover:text-text'}`}
                onClick={() => toggleFilter('warn')}
              >
                Warn
              </button>
              <button
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.info ? 'border-accent/30 bg-accent-soft text-accent' : 'border-transparent text-muted hover:text-text'}`}
                onClick={() => toggleFilter('info')}
              >
                Info
              </button>
              <button
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${logFilters.debug ? 'border-hairline-strong bg-surface-2 text-text' : 'border-transparent text-muted hover:text-text'}`}
                onClick={() => toggleFilter('debug')}
              >
                Debug
              </button>
            </div>
            <button
              className="rounded-full border border-hairline px-3 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
              onClick={onClear}
            >
              Clear
            </button>
          </>
        )}
      </div>
      <div
        className="h-80 overflow-y-auto rounded-md border border-hairline bg-bg font-mono text-[12px] leading-relaxed"
        ref={logsRef}
      >
        {logSource && unavailable ? (
          <div className="py-6 text-center italic text-muted">Log source unavailable</div>
        ) : logSource ? (
          filteredLogs.length > 0 ? (
            filteredLogs.map((line, i) => {
              const level = getLogLevel(line);
              const lineClass =
                level === 'error' ? 'border-l-sell bg-sell-soft text-text'
                : level === 'warn' ? 'border-l-warn bg-warn-soft text-text'
                : level === 'info' ? 'border-l-accent text-text'
                : 'border-l-transparent text-muted';
              return (
                <div key={i} className={`flex items-start whitespace-pre-wrap break-all border-l-2 py-px pr-3 ${lineClass}`}>
                  <span className="w-10 flex-shrink-0 select-none px-3 text-right text-[10px] text-faint">{i + 1}</span>
                  <span className="flex-1">{line}</span>
                </div>
              );
            })
          ) : (
            <div className="py-6 text-center italic text-muted">No logs match the current filters</div>
          )
        ) : (
          <div className="py-6 text-center italic text-muted">Click a log button on any node or service to view its logs</div>
        )}
      </div>
    </section>
  );
}
