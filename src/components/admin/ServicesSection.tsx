// SPDX-License-Identifier: Apache-2.0
// Process-manager service cards (everything that isn't a cluster node):
// summary strip, per-service stats, and lifecycle actions.
import { Icons } from '../Icons';
import { STATUS_DOT_COLOR } from './status';
import { formatBytes, formatUptime, isSameLogSource, processToLogName } from './format';
import { iconBtnStop, iconBtnRestart, iconBtnStart, iconBtnAccent, iconBtnLogs } from './buttonStyles';
import type { LogSource, ProcessInfo, ProcessSummary } from './types';

interface ServicesSectionProps {
  processes: ProcessInfo[];
  processSummary: ProcessSummary | null;
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
  processSummary,
  operatingServices,
  snapshotOp,
  isOperationRunning,
  logSource,
  onProcessAction,
  onSnapshot,
  onSelfUpdate,
  onViewLogs,
}: ServicesSectionProps) {
  const serviceProcesses = processes.filter(p => p.role !== 'cluster');

  return (
    <section className="rounded-lg border border-hairline bg-surface p-6">
      <div className="mb-5 flex items-center gap-2.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-faint">
        {Icons.server}
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Services</h2>
      </div>
      {processSummary && (
        <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-hairline bg-surface-2 px-5 py-3">
          <div className="flex min-w-[50px] flex-col items-center gap-0.5">
            <span className="font-mono text-[16px] font-semibold tabular-nums text-buy">{processSummary.running}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Running</span>
          </div>
          <div className="flex min-w-[50px] flex-col items-center gap-0.5">
            <span className="font-mono text-[16px] font-semibold tabular-nums text-muted">{processSummary.stopped}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Stopped</span>
          </div>
          {processSummary.failed > 0 && (
            <div className="flex min-w-[50px] flex-col items-center gap-0.5">
              <span className="font-mono text-[16px] font-semibold tabular-nums text-sell">{processSummary.failed}</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Failed</span>
            </div>
          )}
          <div className="flex min-w-[50px] flex-col items-center gap-0.5">
            <span className="font-mono text-[13px] font-semibold tabular-nums text-accent">
              {processSummary.totalMemoryMB > 1024
                ? `${(processSummary.totalMemoryMB / 1024).toFixed(1)} GB`
                : `${Math.round(processSummary.totalMemoryMB)} MB`}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Total Memory</span>
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {processes.length === 0 ? (
          <>
            <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            <div className="h-[110px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
          </>
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
                {proc.running && (
                  <div className="flex flex-wrap gap-3 font-mono text-[10px] tabular-nums text-faint">
                    <span className="flex items-center gap-1">PID <span className="text-text">{proc.pid}</span></span>
                    <span className="flex items-center gap-1">Mem <span className="text-text">{formatBytes(proc.memoryBytes)}</span></span>
                    <span className="flex items-center gap-1">CPU <span className="text-text">{(proc.cpuPercent ?? 0).toFixed(1)}%</span></span>
                    <span className="flex items-center gap-1">Up <span className="text-text">{formatUptime(proc.uptimeMs)}</span></span>
                  </div>
                )}
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
