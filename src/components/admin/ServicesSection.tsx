// SPDX-License-Identifier: Apache-2.0
// Process-manager service cards (everything that isn't a cluster node):
// per-service stats and lifecycle actions. Fleet-level counts live in the
// cluster rail, not here.
import { Icons } from '../Icons';
import { STATUS_DOT_COLOR } from './status';
import { formatBytes, formatUptime, isSameLogSource, processToLogName } from './format';
import { iconBtnStop, iconBtnRestart, iconBtnStart, iconBtnAccent, iconBtnLogs } from './buttonStyles';
import type { LogSource, ProcessInfo } from './types';

interface ServicesSectionProps {
  /** null = never loaded (skeletons); [] = loaded-and-empty (quiet notice). */
  processes: ProcessInfo[] | null;
  operatingServices: Set<string>;
  snapshotOp: boolean;
  isOperationRunning: boolean;
  logSource: LogSource | null;
  onProcessAction: (service: string, action: 'start' | 'stop' | 'restart') => void;
  onSnapshot: () => void;
  onSelfUpdate: () => void;
  onViewLogs: (source: LogSource) => void;
}

function getProcessIcon(name: string) {
  switch (name) {
    case 'backup': return Icons.backup;
    case 'market': return Icons.market;
    case 'order': return Icons.order;
    case 'admin': return Icons.admin;
    case 'ui': return Icons.ui;
    default: return Icons.server;
  }
}

export function ServicesSection({
  processes,
  operatingServices,
  snapshotOp,
  isOperationRunning,
  logSource,
  onProcessAction,
  onSnapshot,
  onSelfUpdate,
  onViewLogs,
}: ServicesSectionProps) {
  const serviceProcesses = (processes ?? []).filter(p => p.role !== 'cluster');

  return (
    <section>
      <div className="mb-3.5 flex items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
        {Icons.server}
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Services</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {processes === null ? (
          <>
            <div className="h-[132px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[132px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[132px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[132px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          </>
        ) : serviceProcesses.length === 0 ? (
          <div className="text-[13px] text-muted">No services registered.</div>
        ) : (
          serviceProcesses.map((proc) => {
            const isOperating = operatingServices.has(proc.name);
            const logName = processToLogName(proc.name);
            const logSelected = isSameLogSource(logSource, { type: 'service', name: logName });
            const procDot = isOperating ? 'animate-pulse-soft bg-warn' : (STATUS_DOT_COLOR[proc.status] || 'bg-faint');

            return (
              <div key={proc.name} className={`flex flex-col gap-3.5 rounded-lg border bg-surface p-4 ${isOperating ? 'border-warn/30' : 'border-hairline'}`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted [&_svg]:h-4 [&_svg]:w-4">{getProcessIcon(proc.name)}</div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-text-strong">
                      {proc.display}
                      {' '}
                      <span className={`ml-1 rounded-full px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide ${proc.role === 'infra' ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn'}`}>{proc.role}</span>
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted">
                      {isOperating
                        ? 'Processing...'
                        : `${proc.status}${proc.running && proc.port > 0 ? ` :${proc.port}` : ''}`}
                    </span>
                  </div>
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${procDot}`} />
                </div>
                {/* Always rendered — a stopped service shows dashes, the
                    card never changes height (anti-flicker: reserved rows). */}
                <div className="flex flex-wrap gap-3 font-mono text-[10px] tabular-nums text-faint">
                  <span className="flex items-center gap-1">PID <span className="text-text">{proc.running ? proc.pid : '--'}</span></span>
                  <span className="flex items-center gap-1">Mem <span className="text-text">{proc.running ? formatBytes(proc.memoryBytes) : '--'}</span></span>
                  <span className="flex items-center gap-1">CPU <span className="text-text">{proc.running ? `${(proc.cpuPercent ?? 0).toFixed(1)}%` : '--'}</span></span>
                  <span className="flex items-center gap-1">Up <span className="text-text">{proc.running ? formatUptime(proc.uptimeMs) : '--'}</span></span>
                </div>
                <div className="flex justify-end gap-1.5">
                  {!isOperating && proc.running ? (
                    <>
                      <button className={iconBtnStop} onClick={() => onProcessAction(proc.name, 'stop')} disabled={isOperationRunning || isOperating} title="Stop">{Icons.stop}</button>
                      <button className={iconBtnRestart} onClick={() => onProcessAction(proc.name, 'restart')} disabled={isOperationRunning || isOperating} title="Restart">{Icons.restart}</button>
                      {proc.name === 'backup' && (
                        <button
                          className={iconBtnAccent}
                          onClick={onSnapshot}
                          disabled={snapshotOp || isOperationRunning}
                          title="Take Snapshot"
                        >
                          {Icons.snapshot}
                        </button>
                      )}
                      {proc.name === 'admin' && (
                        <button
                          className={iconBtnAccent}
                          onClick={onSelfUpdate}
                          disabled={isOperationRunning || isOperating}
                          title="Self-Update"
                        >
                          {Icons.update}
                        </button>
                      )}
                    </>
                  ) : !isOperating ? (
                    <button className={iconBtnStart} onClick={() => onProcessAction(proc.name, 'start')} disabled={isOperationRunning || isOperating} title="Start">{Icons.play}</button>
                  ) : null}
                  <button
                    className={iconBtnLogs(logSelected)}
                    onClick={() => onViewLogs({ type: 'service', name: logName })}
                    title="View Logs"
                  >
                    {Icons.logs}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
