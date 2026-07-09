// SPDX-License-Identifier: Apache-2.0
// The Overview tab: an at-a-glance landing. A stack summary strip (active
// profile, gateway health dots, fleet Services/Memory — these moved OFF the
// per-cluster rail) plus a compact mini-rail per cluster that links into the
// Clusters tab. Same doctrine as the rest of the console: skeletons only for
// never-loaded null, values render dashes rather than flicker.
import { getClusterStatus, STATUS_BAR_BORDER, STATUS_DOT_COLOR } from './status';
import type { AdminStatus, ClusterBlock, GatewayStatus, ProcessSummary } from './types';

interface OverviewDashboardProps {
  clusters: ClusterBlock[] | null;
  status: AdminStatus | null;
  processSummary: ProcessSummary | null;
  onOpenClusters: () => void;
}

/** Pulsing placeholder for a value that hasn't arrived yet. */
function Pending() {
  return <span className="animate-pulse text-faint">—</span>;
}

function SummaryStat({ label, value, tone }: { label: string; value: string | null; tone?: 'sell' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className={`font-mono text-[14px] font-semibold tabular-nums ${tone === 'sell' ? 'text-sell' : 'text-text-strong'}`}>
        {value !== null ? value : <Pending />}
      </span>
    </div>
  );
}

function gatewayDot(g?: GatewayStatus): string {
  if (!g) return 'bg-faint';
  if (!g.running) return 'bg-sell animate-pulse-soft';
  if (g.healthy === false) return 'bg-warn animate-pulse-soft';
  return 'bg-buy';
}

function formatMemory(totalMemoryMB: number): string {
  return totalMemoryMB > 1024 ? `${(totalMemoryMB / 1024).toFixed(1)} GB` : `${Math.round(totalMemoryMB)} MB`;
}

export function OverviewDashboard({ clusters, status, processSummary, onOpenClusters }: OverviewDashboardProps) {
  const gw = status?.gateways;
  const gateways: { key: string; label: string; g?: GatewayStatus }[] = [
    { key: 'market', label: 'Market', g: gw?.market },
    { key: 'oms', label: 'OMS', g: gw?.oms ?? gw?.order },
    { key: 'admin', label: 'Admin', g: gw?.admin },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Stack summary strip */}
      <section className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-hairline bg-surface px-5 py-4">
        <SummaryStat label="Profile" value={status?.activeProfile ?? null} />
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Gateways</span>
          <div className="flex items-center gap-3.5">
            {gateways.map(({ key, label, g }) => (
              <span
                key={key}
                className="flex items-center gap-1.5 text-[12px] font-medium text-muted"
                title={g ? `${label} gateway: ${!g.running ? 'down' : g.healthy === false ? 'degraded' : 'healthy'}` : `${label} gateway: unknown`}
              >
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${gatewayDot(g)}`} />
                {label}
              </span>
            ))}
          </div>
        </div>
        <SummaryStat
          label="Services"
          value={processSummary ? `${processSummary.running}/${processSummary.total}` : null}
          tone={processSummary && processSummary.failed > 0 ? 'sell' : undefined}
        />
        <SummaryStat label="Memory" value={processSummary ? formatMemory(processSummary.totalMemoryMB) : null} />
      </section>

      {/* Per-cluster mini-rails */}
      <section>
        <h2 className="mb-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Clusters</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clusters === null ? (
            <>
              <div className="h-[92px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
              <div className="h-[92px] animate-pulse rounded-lg border border-hairline bg-surface-2" />
            </>
          ) : (
            clusters.map((c) => {
              const cs = getClusterStatus(null, c);
              const running = c.nodes.filter(n => n.running).length;
              const total = c.nodes.length || c.nodeCount;
              const leader = c.nodes.find(n => n.role === 'LEADER');
              return (
                <button
                  key={c.name}
                  onClick={onOpenClusters}
                  title={`${cs.title} — ${cs.detail}`}
                  className={`flex flex-col gap-3 rounded-lg border border-l-2 bg-surface p-4 text-left transition-colors hover:bg-surface-2 ${STATUS_BAR_BORDER[cs.status]}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT_COLOR[cs.status]} ${cs.status !== 'healthy' ? 'animate-pulse-soft' : ''}`} />
                    <span className="flex-1 truncate font-display text-[15px] font-semibold text-text-strong">{c.display}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{c.kind}</span>
                  </div>
                  <div className="flex items-center gap-8 font-mono text-[12px] tabular-nums">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-faint">Nodes</span>
                      <span className="text-text">{running}/{total}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-faint">Leader</span>
                      <span className="text-text">{leader ? `Node ${leader.id}` : '—'}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
