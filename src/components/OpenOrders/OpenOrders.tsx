// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { UserOrder } from '../../types/market';
import { formatPrice, formatQuantity, formatTime } from '../../utils/formatters';

interface OpenOrdersProps {
  orders: UserOrder[];
  onCancelOrder: (order: UserOrder) => void;
  onReplaceOrder: (order: UserOrder, price?: number, quantity?: number) => Promise<{ success: boolean; message: string }>;
  loading: boolean;
}

const EDITABLE: ReadonlySet<string> = new Set(['NEW', 'PARTIALLY_FILLED']);

const STATUS_STYLES: Record<string, string> = {
  NEW: 'text-accent bg-accent-soft',
  PARTIALLY_FILLED: 'text-warn bg-warn-soft',
  FILLED: 'text-buy bg-buy-soft',
  CANCELLED: 'text-faint bg-surface-2',
  REJECTED: 'text-sell bg-sell-soft',
};

export function OpenOrders({ orders, onCancelOrder, onReplaceOrder, loading }: OpenOrdersProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filledPercent = (order: UserOrder) => {
    const total = order.originalQuantity;
    if (total === 0) return 0;
    return (order.filledQuantity / total) * 100;
  };

  const startEdit = (order: UserOrder) => {
    setEditingId(order.orderId);
    setEditPrice(String(order.price));
    setEditQty(String(order.remainingQuantity || order.originalQuantity));
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (order: UserOrder) => {
    const price = editPrice.trim() ? Number(editPrice) : undefined;
    const quantity = editQty.trim() ? Number(editQty) : undefined;
    if ((price === undefined || price <= 0) && (quantity === undefined || quantity <= 0)) {
      setEditError('Enter a new price or amount');
      return;
    }
    setSaving(true);
    setEditError(null);
    const result = await onReplaceOrder(order, price, quantity);
    setSaving(false);
    if (result.success) {
      setEditingId(null);
    } else {
      setEditError(result.message);
    }
  };

  const th = 'px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-faint';
  const td = 'px-2 py-1.5 align-middle';

  return (
    <div className="flex h-full flex-col font-sans">
      {orders.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-8 text-[12px] text-muted">
          No open orders
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-hairline">
                <th className={th}>Time</th>
                <th className={th}>Market</th>
                <th className={th}>Side</th>
                <th className={`${th} text-right`}>Price</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Filled</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`} />
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const editing = editingId === order.orderId;
                const canEdit = EDITABLE.has(order.status);
                return (
                  <tr key={order.orderId} className="border-b border-hairline/60 hover:bg-surface-2">
                    <td className={`${td} font-mono tabular-nums text-faint`}>{formatTime(order.timestamp)}</td>
                    <td className={`${td} font-mono text-muted`}>{order.market}</td>
                    <td className={`${td} font-medium ${order.side === 'BID' ? 'text-buy' : 'text-sell'}`}>
                      {order.side === 'BID' ? 'Buy' : 'Sell'}
                    </td>

                    {editing ? (
                      <>
                        <td className={`${td} text-right`}>
                          <input
                            value={editPrice}
                            onChange={e => setEditPrice(e.target.value)}
                            inputMode="decimal"
                            className="w-24 rounded-sm border border-hairline bg-surface-2 px-1.5 py-1 text-right font-mono text-[12px] tabular-nums focus:border-accent focus:outline-none"
                            aria-label="New price"
                          />
                        </td>
                        <td className={`${td} text-right`}>
                          <input
                            value={editQty}
                            onChange={e => setEditQty(e.target.value)}
                            inputMode="decimal"
                            className="w-24 rounded-sm border border-hairline bg-surface-2 px-1.5 py-1 text-right font-mono text-[12px] tabular-nums focus:border-accent focus:outline-none"
                            aria-label="New amount"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={`${td} text-right font-mono tabular-nums text-text`}>${formatPrice(order.price)}</td>
                        <td className={`${td} text-right font-mono tabular-nums text-text`}>{formatQuantity(order.originalQuantity)}</td>
                      </>
                    )}

                    <td className={td}>
                      <div className="relative h-3.5 w-16 overflow-hidden rounded-sm bg-surface-2">
                        <div className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${filledPercent(order)}%` }} />
                        <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] tabular-nums text-muted">
                          {filledPercent(order).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className={td}>
                      <span className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[order.status] ?? 'text-muted bg-surface-2'}`}>
                        {order.status === 'PARTIALLY_FILLED' ? 'Partial' : order.status}
                      </span>
                    </td>
                    <td className={`${td} text-right`}>
                      {editing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          {editError && <span className="mr-1 text-[10px] text-sell">{editError}</span>}
                          <button
                            onClick={() => saveEdit(order)}
                            disabled={saving}
                            className="rounded-sm bg-accent px-2 py-1 text-[11px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="rounded-sm border border-hairline px-2 py-1 text-[11px] text-muted hover:border-hairline-strong hover:text-text"
                          >
                            Discard
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {canEdit && (
                            <button
                              onClick={() => startEdit(order)}
                              disabled={loading}
                              title="Edit price / amount (cancel-and-replace)"
                              className="rounded-sm border border-hairline px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => onCancelOrder(order)}
                            disabled={loading}
                            title="Cancel order"
                            className="rounded-sm border border-hairline px-2 py-1 text-[11px] text-muted hover:border-sell hover:text-sell disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
