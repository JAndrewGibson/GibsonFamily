import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  PiggyBank,
  RotateCcw,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';

function fmtMoney(val) {
  const num = Number(val || 0);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedMoney(val) {
  const num = Number(val || 0);
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MonthCloseModal({
  isOpen,
  onClose,
  selectedMonth,
  activePartner,
  onMonthClosed,
  onViewRecap,
}) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [transferring, setTransferring] = useState(false);

  // Transfer to savings state
  const [selectedSavingsAccountId, setSelectedSavingsAccountId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [recordTransferChecked, setRecordTransferChecked] = useState(true);
  const [notes, setNotes] = useState('');

  const loadStatus = async () => {
    if (!selectedMonth) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/finance/month-close-status?month=${selectedMonth}`);
      setStatus(res);
      if (res?.savings_accounts?.length > 0) {
        setSelectedSavingsAccountId(String(res.savings_accounts[0].id));
      }
      setTransferAmount(res?.leftover_amount ? String(res.leftover_amount) : '0.00');
    } catch (err) {
      console.error('Failed to load month close status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen, selectedMonth]);

  if (!isOpen) return null;

  const handleCloseMonth = async () => {
    setClosing(true);
    try {
      const res = await apiFetch('/api/finance/close-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          transferred_to_savings: recordTransferChecked && Number(transferAmount) > 0,
          savings_account_id: selectedSavingsAccountId ? Number(selectedSavingsAccountId) : null,
          transfer_amount: Number(transferAmount) || 0,
          notes: notes.trim(),
        }),
      });
      if (res?.closed) {
        if (onMonthClosed) onMonthClosed(res);
        if (onViewRecap) onViewRecap(selectedMonth);
        onClose();
      }
    } catch (err) {
      alert(`Error closing month: ${err.message}`);
    } finally {
      setClosing(false);
    }
  };

  const handleReopenMonth = async () => {
    if (!window.confirm(`Re-open ${status?.month_label || selectedMonth}? This will unlock the month so you can edit transactions and budgets.`)) {
      return;
    }
    setReopening(true);
    try {
      await apiFetch('/api/finance/reopen-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      await loadStatus();
      if (onMonthClosed) onMonthClosed({ reopened: true });
    } catch (err) {
      alert(`Error reopening month: ${err.message}`);
    } finally {
      setReopening(false);
    }
  };

  const handleExecuteTransferOnly = async () => {
    if (!selectedSavingsAccountId) {
      alert('Please select a destination savings account.');
      return;
    }
    setTransferring(true);
    try {
      await apiFetch('/api/finance/month-close/transfer-savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          savings_account_id: Number(selectedSavingsAccountId),
          amount: Number(transferAmount) || 0,
        }),
      });
      await loadStatus();
      if (onMonthClosed) onMonthClosed({ transferred: true });
    } catch (err) {
      alert(`Transfer failed: ${err.message}`);
    } finally {
      setTransferring(false);
    }
  };

  const isClosed = Boolean(status?.is_closed);
  const leftoverAmt = Number(status?.leftover_amount || 0);
  const leftoverCats = (status?.leftover_categories || []).filter((c) => c.leftover > 0);
  const rolloverCats = status?.rollover_categories || [];

  return (
    <div className="finance-modal-backdrop" onClick={onClose} style={{ zIndex: 1050 }}>
      <div
        className="finance-modal-card finance-modal-lg month-close-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '680px' }}
      >
        {/* Header */}
        <div className="finance-modal-header" style={{ padding: '1rem 1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
                {status?.month_label || selectedMonth} Month-End & Closing
              </h3>
              {isClosed ? (
                <span className="badge badge-success" style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}>
                  ✓ Closed
                </span>
              ) : status?.is_eligible ? (
                <span className="badge badge-warning" style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}>
                  Ready to Close
                </span>
              ) : (
                <span className="badge" style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', background: 'rgba(255,255,255,0.08)' }}>
                  In Progress ({status?.days_until_eligible || 0}d until prompt)
                </span>
              )}
            </div>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Review month-end tasks, transfer unspent non-rollover budget into savings, and generate your recap.
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="finance-modal-body" style={{ padding: '1.25rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--text-muted)' }}>
              Loading month-end status...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Closed Status Banner */}
              {isClosed && (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    borderRadius: '12px',
                    padding: '0.9rem 1.1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <CheckCircle2 size={20} color="#10b981" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#10b981' }}>
                        This month was closed on{' '}
                        {status.closed_at ? new Date(status.closed_at).toLocaleDateString() : 'earlier'}
                        {status.closed_by_partner_name ? ` by ${status.closed_by_partner_name}` : ''}.
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {status.transferred_to_savings
                          ? `Leftover surplus of $${fmtMoney(leftoverAmt)} was recorded to savings.`
                          : 'No savings transfer was recorded.'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onViewRecap && onViewRecap(selectedMonth)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Sparkles size={14} color="#f59e0b" />
                      View Recap
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleReopenMonth}
                      disabled={reopening}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}
                    >
                      <RotateCcw size={13} />
                      {reopening ? 'Reopening...' : 'Re-Open'}
                    </button>
                  </div>
                </div>
              )}

              {/* Financial Snapshot Summary */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                <div style={{ background: 'var(--bg-panel)', padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Earned Inflow
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem', color: '#10b981' }}>
                    ${fmtMoney(status.overview?.total_income || status.total_income)}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-panel)', padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Net Spent
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem', color: '#f43f5e' }}>
                    ${fmtMoney(status.overview?.total_spent || status.total_spend)}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-panel)', padding: '0.75rem 0.9rem', borderRadius: '10px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Net Cash Flow
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.2rem', color: '#06b6d4' }}>
                    {fmtSignedMoney(status.overview?.net_cashflow || status.net_cashflow)}
                  </div>
                </div>

                <div
                  style={{
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.35)',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: '#a5b4fc', textTransform: 'uppercase', fontWeight: 600 }}>
                    Non-Rollover Leftover
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, marginTop: '0.2rem', color: '#818cf8' }}>
                    ${fmtMoney(leftoverAmt)}
                  </div>
                </div>
              </div>

              {/* CORE INSTRUCTION: Transfer Leftover to Savings */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(6, 182, 212, 0.1) 100%)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  borderRadius: '14px',
                  padding: '1.1rem 1.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
                  <PiggyBank size={22} color="#818cf8" />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      Transfer Leftover Budget to Savings
                    </h4>
                    <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      You came in under budget across non-rollover categories! Move this specific leftover into savings.
                    </p>
                  </div>
                </div>

                {/* Leftover breakdown by category */}
                {leftoverCats.length > 0 ? (
                  <div style={{ margin: '0.75rem 0', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div
                      style={{
                        padding: '0.55rem 0.85rem',
                        background: 'var(--bg-panel)',
                        borderBottom: '1px solid var(--border)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>CATEGORY</span>
                      <span>UNSPENT LEFTOVER</span>
                    </div>
                    {leftoverCats.map((c) => (
                      <div
                        key={c.category}
                        style={{
                          padding: '0.6rem 0.85rem',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.84rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: c.color || '#6366f1',
                            }}
                          />
                          <span style={{ fontWeight: 500 }}>{c.category}</span>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            (${fmtMoney(c.spent)} of ${fmtMoney(c.monthly_limit)})
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, color: '#10b981' }}>
                          +${fmtMoney(c.leftover)}
                        </div>
                      </div>
                    ))}
                    <div
                      style={{
                        padding: '0.65rem 0.85rem',
                        background: 'var(--bg-panel)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                      }}
                    >
                      <span>Total Non-Rollover Leftover:</span>
                      <span style={{ color: '#818cf8', fontSize: '1.05rem' }}>${fmtMoney(leftoverAmt)}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ margin: '0.75rem 0', padding: '0.75rem', background: 'var(--bg-card)', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    All non-rollover categories were fully utilized this month.
                  </div>
                )}

                {/* Rollover Callout Note */}
                {rolloverCats.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      fontSize: '0.78rem',
                      color: 'var(--text-muted)',
                      margin: '0.5rem 0 0.85rem 0',
                    }}
                  >
                    <Info size={14} style={{ flexShrink: 0, marginTop: '2px', color: '#06b6d4' }} />
                    <div>
                      <strong>Rollover categories excluded:</strong> Unused amounts in{' '}
                      {rolloverCats.map((r) => r.category).join(', ')} carry forward automatically into next month and
                      are not included in this savings transfer.
                    </div>
                  </div>
                )}

                {/* Savings Destination & Transfer Action */}
                {!isClosed && leftoverAmt > 0 && (
                  <div
                    style={{
                      marginTop: '0.85rem',
                      padding: '0.85rem',
                      background: 'var(--bg-card)',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                      <div>
                        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Destination Savings Account
                        </label>
                        <select
                          className="input"
                          style={{ width: '100%', fontSize: '0.85rem' }}
                          value={selectedSavingsAccountId}
                          onChange={(e) => setSelectedSavingsAccountId(e.target.value)}
                        >
                          {status?.savings_accounts?.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} (••••{acc.mask || '0000'}) - ${fmtMoney(acc.balance_current)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Transfer Amount ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          className="input"
                          style={{ width: '100%', fontSize: '0.85rem', fontWeight: 600 }}
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                        />
                      </div>
                    </div>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        color: 'var(--text-main)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={recordTransferChecked}
                        onChange={(e) => setRecordTransferChecked(e.target.checked)}
                      />
                      <span>Record this transfer in GibsonFamily Hub upon closing month</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Month-End Tasks Checklist */}
              <div>
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Month-End Tasks Checklist
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {status?.tasks?.map((task) => {
                    const isDone = task.status === 'completed';
                    return (
                      <div
                        key={task.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.65rem 0.85rem',
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          fontSize: '0.84rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          {isDone ? (
                            <CheckCircle2 size={17} color="#10b981" />
                          ) : (
                            <AlertTriangle size={17} color="#f59e0b" />
                          )}
                          <div>
                            <div style={{ fontWeight: 600, color: isDone ? 'var(--text-main)' : 'var(--text-main)' }}>
                              {task.title}
                            </div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                              {task.details}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`badge ${isDone ? 'badge-success' : 'badge-warning'}`}
                          style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                        >
                          {isDone ? 'Complete' : 'Action Needed'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              {!isClosed && (
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                    Month-End Reflection & Notes (Optional)
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Vacation month, holiday shopping, or new appliance purchase..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    style={{ width: '100%', fontSize: '0.84rem' }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="finance-modal-footer" style={{ padding: '0.9rem 1.25rem' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={closing}>
            Close
          </button>
          {isClosed ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                if (onViewRecap) onViewRecap(selectedMonth);
                onClose();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            >
              <Sparkles size={16} />
              View {status?.month_label || selectedMonth} Recap 🎉
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (onViewRecap) onViewRecap(selectedMonth);
                }}
                title="Preview recap before closing"
              >
                Preview Recap
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCloseMonth}
                disabled={closing}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
              >
                <Sparkles size={16} />
                {closing ? 'Closing Month...' : `Close Month & View Recap 🎉`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

