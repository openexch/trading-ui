// SPDX-License-Identifier: Apache-2.0
// Cluster health strip: state-toned left rule, status dot + title/detail,
// operation progress hairline, and the cluster-wide operation buttons.
import { Icons } from '../Icons';
import { STATUS_BAR_BORDER, STATUS_DOT_COLOR } from './status';
import type { ClusterStatus } from './types';

interface ClusterStatusBarProps {
  status: ClusterStatus | null;
  clusterStatus: { status: 'healthy' | 'electing' | 'unstable' | 'updating'; title: string; detail: string };
  isOperationRunning: boolean;
  operationProgress: number;
  onRollingUpdate: () => void;
  onHousekeeping: () => void;
}

export function ClusterStatusBar({
  status,
  clusterStatus,
  isOperationRunning,
  operationProgress,
  onRollingUpdate,
  onHousekeeping,
}: ClusterStatusBarProps) {
  if (!status) {
    return <div className="mb-6 h-[60px] animate-pulse rounded-md border border-hairline bg-surface-2" />;
  }

  return (
    <div className={`relative mb-6 flex items-center overflow-hidden rounded-md border border-l-[3px] border-hairline bg-surface p-4 ${STATUS_BAR_BORDER[clusterStatus.status]}`}>
      <div
        className="absolute left-0 top-0 h-0.5 bg-accent transition-[width] duration-500"
        style={{ width: `${operationProgress}%` }}
      />
      <div className="relative flex w-full items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT_COLOR[clusterStatus.status]} ${clusterStatus.status !== 'healthy' ? 'animate-pulse-soft' : ''}`} />
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-[14px] font-semibold text-text-strong">{clusterStatus.title}</span>
            <span className="text-[12px] text-muted">{clusterStatus.detail}</span>
          </div>
        </div>
        {isOperationRunning ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[14px] font-semibold tabular-nums text-accent">{operationProgress}%</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5"
              onClick={onRollingUpdate}
              disabled={isOperationRunning}
            >
              {Icons.update}
              <span>Rolling Update</span>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5"
              onClick={onHousekeeping}
              disabled={isOperationRunning}
            >
              {Icons.archive}
              <span>Housekeeping</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
