// SPDX-License-Identifier: Apache-2.0
/**
 * Balances: available and locked per asset, from the 5 s balances poll
 * (useBalances). No portfolio total: there is no valuation source yet
 * (DESIGN.md rule 14). An asset opens its balance ledger (BalanceLedger:
 * its movements, each with its core log position); one at a time.
 */
import { Fragment, useState } from 'react';
import { useBalances } from '../../hooks/useBalances';
import { BalanceLedger } from './BalanceLedger';
import type { SlotChrome } from '../layout/SideColumn';
import { PanelFrame, PanelNote, PanelSignIn } from './PanelFrame';

export interface BalancesPanelProps {
  chrome: SlotChrome;
  signedIn: boolean;
  onSignIn: () => void;
}

export function formatAmount(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

const ROW = 'grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-2 px-4';

export function BalancesPanel({ chrome, signedIn, onSignIn }: BalancesPanelProps) {
  const { assets } = useBalances();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <PanelFrame label="Balances" position={chrome.position} header={chrome.picker()}>
      {!signedIn ? (
        <PanelSignIn what="your balances" onSignIn={onSignIn} />
      ) : assets.length === 0 ? (
        <PanelNote>No balances to show</PanelNote>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className={`${ROW} h-8 border-b border-hairline text-[11px] text-muted`}>
              <th scope="col" className="text-left font-normal">Asset</th>
              <th scope="col" className="text-right font-normal">Available</th>
              <th scope="col" className="text-right font-normal">Locked</th>
            </tr>
          </thead>
          <tbody>
            {assets.map(a => (
              <Fragment key={a.assetId}>
                <tr data-balance-row={a.asset} className={`${ROW} h-[30px] border-b border-hairline`}>
                  <th scope="row" className="truncate text-left font-semibold text-text-strong">
                    <button
                      type="button"
                      aria-expanded={open === a.assetId}
                      aria-label={`${open === a.assetId ? 'Hide' : 'Show'} ${a.asset} movements`}
                      onClick={() => setOpen(o => (o === a.assetId ? null : a.assetId))}
                      className="font-semibold underline decoration-transparent underline-offset-2 hover:decoration-current"
                    >
                      {a.asset}
                    </button>
                  </th>
                  <td className="truncate text-right text-text-strong">{formatAmount(a.available)}</td>
                  <td className="truncate text-right text-muted">{formatAmount(a.locked)}</td>
                </tr>
                {open === a.assetId && (
                  <tr className="block">
                    <td className="block p-0">
                      <BalanceLedger assetId={a.assetId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </PanelFrame>
  );
}
