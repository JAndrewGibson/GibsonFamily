import React, { useEffect, useRef, useState } from 'react';
import { apiFetch, getCookie, setCookie } from '../api';
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  History,
  Menu,
  Sparkles,
  X,
} from 'lucide-react';
import MonthCloseModal from '../components/MonthCloseModal';
import MonthRecapModal from '../components/MonthRecapModal';

function getCurrentYearMonth(startingMonth) {
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return startingMonth && ym < startingMonth ? startingMonth : ym;
}

function formatMonthLabel(ym) {
  if (!ym || ym.length < 7) return ym;
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatShortMonthLabel(ym) {
  if (!ym || ym.length < 7) return ym;
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function fmtMoney(val) {
  const num = Number(val || 0);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedMoney(val) {
  const num = Number(val || 0);
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DashboardModule({
  activePartner,
  onDataChanged,
  syncVersion,
  startingMonth,
}) {
  const effectiveStartingMonth = startingMonth || new Date().toISOString().slice(0, 7);
  const currentCalendarMonth = getCurrentYearMonth(effectiveStartingMonth);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const saved = getCookie('gibson_finance_month');
    const initial = saved && /^\d{4}-\d{2}$/.test(saved) ? saved : currentCalendarMonth;
    return initial < effectiveStartingMonth ? effectiveStartingMonth : initial;
  });

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRolloverCategory, setSelectedRolloverCategory] = useState('');
  const [txFilterScope, setTxFilterScope] = useState('all'); // 'month' | 'all'

  // Dismissable Rollover Info Box
  const [dismissRolloverInfo, setDismissRolloverInfo] = useState(() => {
    return getCookie('gibson_dismiss_rollover_info', '0') === '1';
  });

  const handleDismissRolloverInfo = () => {
    setDismissRolloverInfo(true);
    setCookie('gibson_dismiss_rollover_info', '1', 365);
  };

  const [showMonthModal, setShowMonthModal] = useState(false);
  const [showMonthCloseModal, setShowMonthCloseModal] = useState(false);
  const [showMonthRecapModal, setShowMonthRecapModal] = useState(false);
  const [showLedgerMenu, setShowLedgerMenu] = useState(false);
  const ledgerMenuRef = useRef(null);

  useEffect(() => {
    if (!showLedgerMenu) return;
    const handleOutside = (e) => {
      if (ledgerMenuRef.current && !ledgerMenuRef.current.contains(e.target)) {
        setShowLedgerMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showLedgerMenu]);

  const selectBudgetMonth = (ym) => {
    const clamped = ym < effectiveStartingMonth ? effectiveStartingMonth : ym;
    setSelectedMonth(clamped);
    setCookie('gibson_finance_month', clamped);
  };

  const loadDashboardData = async (monthOverride, silent = false) => {
    const targetMonth = monthOverride || selectedMonth;
    if (!silent) setLoading(true);
    try {
      const sumRes = await apiFetch(
        `/api/finance/summary?month=${encodeURIComponent(targetMonth)}`
      );
      setSummary(sumRes);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData(selectedMonth);
  }, [selectedMonth]);

  useEffect(() => {
    if (syncVersion > 0) {
      loadDashboardData(selectedMonth, true);
    }
  }, [syncVersion]);

  // Trigger 12-hour background Plaid auto-sync on load
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/finance/plaid/auto-sync', { method: 'POST' })
      .then((res) => {
        if (!cancelled && res && res.triggered) {
          setTimeout(() => {
            if (!cancelled) loadDashboardData(selectedMonth, true);
          }, 5000);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !summary) {
    return <div className="loading-state">Loading your Home Dashboard...</div>;
  }

  // Find logged-in partner's Spending Money data
  const partnerSpendingList = summary.partner_spending_money || [];
  const mySpendingMoney =
    partnerSpendingList.find((p) => Number(p.partner_id) === Number(activePartner?.id)) ||
    partnerSpendingList.find(
      (p) =>
        activePartner?.name &&
        (p.partner_name || '').toLowerCase() === activePartner.name.toLowerCase()
    ) ||
    partnerSpendingList[0] ||
    null;

  // Rollover-enabled categories for the ledger selector
  const rolloverCategories = (summary.budgets || []).filter((b) => b.allow_rollover);
  const activeLedgerCategory =
    selectedRolloverCategory &&
    summary.rollover_ledgers &&
    summary.rollover_ledgers[selectedRolloverCategory]
      ? selectedRolloverCategory
      : mySpendingMoney?.category || rolloverCategories[0]?.category || '';

  const activeLedgerRows =
    (summary.rollover_ledgers && summary.rollover_ledgers[activeLedgerCategory]) ||
    mySpendingMoney?.rollover_ledger ||
    [];

  // Layered Budget & Savings Bar calculations
  const projectedIncome = Number(summary.projected_monthly_income || 0);
  const totalBudget = Number(summary.total_monthly_budget || 0);
  const savingsBudget = Number(summary.savings_budget_limit || 0);
  const expenseBudget = Number(
    summary.expense_budget_limit ?? Math.max(0, totalBudget - savingsBudget)
  );
  const savingsReserve = Number(summary.projected_savings_reserve || 0);
  const totalSpent = Number(summary.total_monthly_spent || 0);
  const totalRolloverSpent = Number(summary.total_rollover_spent || 0);

  const barMax = Math.max(projectedIncome, totalBudget, totalSpent, 1);
  const projPct = projectedIncome > 0 ? Math.min(100, (projectedIncome / barMax) * 100) : 100;
  const expBudgetPct = Math.min(100, (expenseBudget / barMax) * 100);
  const spentPct = Math.min(100, (totalSpent / barMax) * 100);
  const savingsWidthPct =
    projectedIncome > 0 ? Math.min(projPct, (savingsReserve / barMax) * 100) : 0;
  const savingsStartPct = Math.max(0, projPct - savingsWidthPct);

  const mySpendTxs = mySpendingMoney
    ? txFilterScope === 'month'
      ? mySpendingMoney.month_transactions || []
      : mySpendingMoney.transactions || []
    : [];

  const userName = activePartner?.name ? activePartner.name.split(' ')[0] : 'there';

  return (
    <div className="module-container">
      {/* Top Dashboard Header */}
      <div className="section-header-bar dashboard-header-bar">
        <h1 className="module-title" style={{ margin: 0, fontSize: '1.65rem', fontWeight: 800 }}>
          Hello, {userName}!
        </h1>

        <button
          type="button"
          className="dashboard-month-pill"
          onClick={() => setShowMonthModal(true)}
          title="Switch Budget Month"
        >
          <Calendar size={14} />
          <span>{formatMonthLabel(selectedMonth)}</span>
          {selectedMonth === currentCalendarMonth && (
            <span className="month-now-dot" title="Current Month" />
          )}
          <ChevronDown size={13} />
        </button>
      </div>

      {/* Month Close & Recap Banner */}
      {summary?.month_close?.is_closed ? (
        <div
          className="month-close-callout-banner closed"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(6, 182, 212, 0.1) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '14px',
            padding: '0.85rem 1.15rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <CheckCircle2 size={20} color="#10b981" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>
                {formatMonthLabel(selectedMonth)} is Closed
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {summary.month_close?.leftover_amount > 0
                  ? `$${fmtMoney(summary.month_close.leftover_amount)} non-rollover leftover was transferred to savings.`
                  : 'Month-end wrap-up complete.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowMonthRecapModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Sparkles size={14} color="#fbbf24" />
              View {formatShortMonthLabel(selectedMonth)} Recap 🎉
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowMonthCloseModal(true)}
            >
              Details
            </button>
          </div>
        </div>
      ) : (summary?.month_close?.is_eligible || selectedMonth < currentCalendarMonth) ? (
        <div
          className="month-close-callout-banner open"
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.14) 0%, rgba(245, 158, 11, 0.12) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            borderRadius: '14px',
            padding: '0.9rem 1.15rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Sparkles size={20} color="#fbbf24" />
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-main)' }}>
                Ready to close {formatMonthLabel(selectedMonth)}?
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {summary?.month_close?.leftover_amount > 0 ? (
                  <>
                    Transfer <strong>${fmtMoney(summary.month_close.leftover_amount)}</strong> leftover to savings and unlock your{' '}
                    <strong>{formatShortMonthLabel(selectedMonth)} Recap</strong>!
                  </>
                ) : (
                  <>Complete month-end tasks and unlock your <strong>{formatShortMonthLabel(selectedMonth)} Recap</strong>!</>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowMonthRecapModal(true)}
            >
              Preview Recap
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowMonthCloseModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Sparkles size={14} />
              Review & Close Month
            </button>
          </div>
        </div>
      ) : null}

      {/* SECTION 1: Pure Layered Budget & Savings Graph (No title or clutter) */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div className="layered-budget-track-wrapper" style={{ padding: '0.65rem 0 1rem' }}>
          <div className="layered-budget-track">
            {/* Layer 1: Planned Expense Budgets */}
            {expBudgetPct > 0 && (
              <div
                className="layered-segment seg-planned-budget"
                style={{ left: '0%', width: `${expBudgetPct}%` }}
                title={`Planned Spending Categories: $${fmtMoney(expenseBudget)}`}
              />
            )}

            {/* Layer 2: Grey Savings Reserve at the Right End of Projected Income */}
            {savingsWidthPct > 0 && (
              <div
                className={`layered-segment seg-savings-end ${
                  summary.spent_dipping_into_savings ? 'seg-savings-invaded' : ''
                }`}
                style={{
                  left: `${savingsStartPct}%`,
                  width: `${savingsWidthPct}%`,
                }}
                title={`Projected Savings Reserve: $${fmtMoney(
                  savingsReserve
                )} (Protected at end of Projected Income)`}
              >
                {savingsWidthPct >= 12 && (
                  <span className="seg-inner-label">Savings ${savingsReserve.toFixed(0)}</span>
                )}
              </div>
            )}

            {/* Layer 3: Actual Net Spending Foreground Bar */}
            {spentPct > 0 && (
              <div
                className={`layered-segment seg-actual-spent ${
                  summary.spent_exceeds_projected_income
                    ? 'spent-over-income'
                    : summary.spent_dipping_into_savings ||
                      (totalBudget > 0 && totalSpent > totalBudget)
                    ? 'spent-warning'
                    : 'spent-healthy'
                }`}
                style={{ left: '0%', width: `${spentPct}%` }}
                title={`Actual Net Spending: $${fmtMoney(totalSpent)}`}
              >
                {spentPct >= 10 && (
                  <span className="seg-inner-label">${totalSpent.toFixed(0)} Spent</span>
                )}
              </div>
            )}

            {/* Marker: Expense Budget Limit */}
            {expenseBudget > 0 && (
              <div
                className="layered-marker marker-budget-limit"
                style={{ left: `${expBudgetPct}%` }}
                title={`Spending Budget Limit: $${fmtMoney(expenseBudget)}`}
              >
                <span className="marker-tag tag-top">
                  Budget ${expenseBudget.toFixed(0)}
                </span>
              </div>
            )}

            {/* Marker: Projected Income Ceiling */}
            {projectedIncome > 0 && (
              <div
                className="layered-marker marker-projected-max"
                style={{ left: `${projPct}%` }}
                title={`Projected Monthly Income (Max): $${fmtMoney(projectedIncome)}`}
              >
                <span className="marker-tag tag-max">
                  Projected Max ${projectedIncome.toFixed(0)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Clean Graph Legend */}
        <div className="layered-budget-legend">
          <span className="legend-item">
            <span className="legend-swatch swatch-spent" />
            Actual Net Spend: <strong>${fmtMoney(totalSpent)}</strong>
          </span>
          {totalRolloverSpent > 0 && (
            <span className="legend-item">
              <span className="legend-swatch swatch-rainbow" />
              🌈 Spent from Rollover: <strong>${fmtMoney(totalRolloverSpent)}</strong> (Excl. from
              Month Budget)
            </span>
          )}
          <span className="legend-item">
            <span className="legend-swatch swatch-planned" />
            Planned Categories: <strong>${fmtMoney(expenseBudget)}</strong>
          </span>
          <span className="legend-item">
            <span className="legend-swatch swatch-savings-grey" />
            Savings: <strong>${fmtMoney(savingsReserve)}</strong>
          </span>
          <span className="legend-item">
            <span className="legend-swatch swatch-projected-max" />
            Projected Max: <strong>${fmtMoney(projectedIncome)}</strong>
          </span>
        </div>
      </div>

      {/* SECTION 2: Slimmed-down Spending Money & Accumulated Rollover Ledger */}
      <div className="finance-two-col">
        {/* Left Card: Logged-in Partner's Dedicated Spending Money */}
        {mySpendingMoney && (
          <div className="card spending-money-hero-card" style={{ padding: '16px 18px' }}>
            <div
              className="card-header"
              style={{
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 6,
                borderBottom: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: mySpendingMoney.color || '#ec4899',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {mySpendingMoney.category}
                </h3>
              </div>
            </div>

            {/* 4 Compact Rollover Metrics for Selected Month */}
            <div className="spending-money-metrics-grid" style={{ marginTop: 8 }}>
              <div className="sm-metric-box">
                <div className="sm-metric-label">Rollover</div>
                <div
                  className={`sm-metric-value ${
                    mySpendingMoney.rollover_in > 0
                      ? 'text-success'
                      : mySpendingMoney.rollover_in < 0
                      ? 'text-danger'
                      : ''
                  }`}
                >
                  {fmtSignedMoney(mySpendingMoney.rollover_in)}
                </div>
              </div>

              <div className="sm-metric-box">
                <div className="sm-metric-label">Spending Money</div>
                <div className="sm-metric-value">${fmtMoney(mySpendingMoney.monthly_limit)}</div>
              </div>

              <div className="sm-metric-box">
                <div className="sm-metric-label">Spent in {formatShortMonthLabel(selectedMonth)}</div>
                <div
                  className={`sm-metric-value ${
                    mySpendingMoney.is_in_debt
                      ? 'text-danger'
                      : mySpendingMoney.is_using_rollover
                      ? 'text-rainbow-label'
                      : ''
                  }`}
                >
                  ${fmtMoney(mySpendingMoney.spent)}
                </div>
              </div>

              <div
                className={`sm-metric-box ${
                  mySpendingMoney.is_in_debt
                    ? 'sm-box-debt'
                    : mySpendingMoney.rollover_out > 0
                    ? 'sm-box-surplus'
                    : ''
                }`}
              >
                <div className="sm-metric-label">
                  {mySpendingMoney.rollover_out >= 0 ? 'Ending Rollover' : 'Rollover Debt'}
                </div>
                <div
                  className={`sm-metric-value ${
                    mySpendingMoney.is_in_debt ? 'text-danger' : 'text-success'
                  }`}
                >
                  {mySpendingMoney.rollover_out >= 0
                    ? `$${fmtMoney(mySpendingMoney.rollover_out)}`
                    : fmtSignedMoney(mySpendingMoney.rollover_out)}
                </div>
              </div>
            </div>

            {/* Spending Money Progress Bar */}
            <div className="budget-row-card" style={{ marginTop: 12 }}>
              <div className="budget-row-top" style={{ justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  ${fmtMoney(mySpendingMoney.spent)} / ${fmtMoney(mySpendingMoney.monthly_limit)}
                  {mySpendingMoney.is_using_rollover && (
                    <span className="pill pill-rainbow" style={{ marginLeft: 8, fontSize: 11 }}>
                      🌈 Using Rollover
                    </span>
                  )}
                  {mySpendingMoney.is_in_debt && (
                    <span className="pill pill-red" style={{ marginLeft: 8, fontSize: 11 }}>
                      In Rollover Debt
                    </span>
                  )}
                </span>
              </div>

              <div className="progress-track" style={{ height: 10, marginTop: 8 }}>
                <div
                  className={`progress-fill ${
                    mySpendingMoney.is_using_rollover
                      ? 'fill-rainbow'
                      : mySpendingMoney.is_in_debt
                      ? 'fill-danger'
                      : 'fill-success'
                  }`}
                  style={{
                    width: `${
                      mySpendingMoney.monthly_limit > 0
                        ? Math.min(
                            100,
                            Math.max(
                              0,
                              (mySpendingMoney.spent / mySpendingMoney.monthly_limit) * 100
                            )
                          )
                        : mySpendingMoney.spent > 0
                        ? 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Recent Transactions in Partner's Spending Money */}
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  Purchases ({mySpendTxs.length})
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      txFilterScope === 'month' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={() => setTxFilterScope('month')}
                  >
                    {formatShortMonthLabel(selectedMonth)} Only
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      txFilterScope === 'all' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={() => setTxFilterScope('all')}
                  >
                    All History
                  </button>
                </div>
              </div>

              {mySpendTxs.length === 0 ? (
                <div
                  className="empty-state"
                  style={{ padding: '16px 12px', fontSize: 12, textAlign: 'center' }}
                >
                  No purchases logged under <strong>{mySpendingMoney.category}</strong>{' '}
                  {txFilterScope === 'month' ? `in ${formatMonthLabel(selectedMonth)}` : 'yet'}.
                </div>
              ) : (
                <div className="dashboard-sm-tx-list">
                  {mySpendTxs.slice(0, 10).map((tx) => (
                    <div key={`${tx.id}-${tx.date}`} className="dashboard-sm-tx-row">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {tx.merchant}
                          {tx.is_split && (
                            <span
                              className="pill pill-purple"
                              style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px' }}
                            >
                              Split
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">
                          {tx.date} • {tx.account_name || 'Manual Entry'}
                          {tx.notes ? (
                            <span style={{ fontStyle: 'italic', marginLeft: 6 }}>
                              — {tx.notes}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        ${fmtMoney(tx.category_amount ?? tx.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Card: Cumulative Rollover Savings Ledger */}
        <div className="card" style={{ padding: '16px 18px' }}>
          <div
            className="card-header"
            style={{
              flexWrap: 'wrap',
              gap: 10,
              justifyContent: 'space-between',
              paddingBottom: 6,
              borderBottom: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={18} className="text-accent" />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Rollover Ledger
                </div>
              </div>
            </div>

            {rolloverCategories.length > 1 && (
              <div className="tx-hamburger-cell" ref={ledgerMenuRef}>
                <button
                  type="button"
                  className={`btn btn-secondary btn-xs tx-hamburger-btn ${showLedgerMenu ? 'active' : ''}`}
                  onClick={() => setShowLedgerMenu((prev) => !prev)}
                  title={`Switch rollover category (Current: ${activeLedgerCategory})`}
                  aria-label="Rollover ledger category menu"
                  aria-expanded={showLedgerMenu}
                >
                  <Menu size={15} />
                </button>
                {showLedgerMenu && (
                  <div className="tx-hamburger-popover" style={{ top: 'calc(100% + 4px)', right: 0 }}>
                    <div className="tx-popover-header">
                      <span>Rollover Category</span>
                      <button
                        type="button"
                        className="btn-icon-subtle"
                        onClick={() => setShowLedgerMenu(false)}
                        aria-label="Close menu"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {rolloverCategories.map((rc) => {
                      const isActiveCat = rc.category === activeLedgerCategory;
                      return (
                        <button
                          key={rc.category}
                          type="button"
                          className="tx-popover-item"
                          style={isActiveCat ? { fontWeight: 700, color: 'var(--accent)' } : undefined}
                          onClick={() => {
                            setSelectedRolloverCategory(rc.category);
                            setShowLedgerMenu(false);
                          }}
                        >
                          <span style={{ flex: 1 }}>{rc.category}</span>
                          {isActiveCat && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dismissable Explainer Box with Top Margin */}
          {!dismissRolloverInfo && (
            <div className="dismissable-info-box">
              <div>
                <strong>How Rollover Works:</strong> Unspent money rolls over cumulatively to the next
                month without inflating next month&apos;s budget limit (e.g., <strong>+$5.00</strong> from
                Nov + <strong>+$9.00</strong> from Dec = <strong>+$14.00</strong> entering Jan).
                Overspending beyond available rollover carries forward as negative rollover debt.
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={handleDismissRolloverInfo}
                title="Dismiss this notice"
                aria-label="Dismiss this notice"
                style={{ flexShrink: 0, padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {activeLedgerRows.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              No rollover history yet.
            </div>
          ) : (
            <div className="rollover-ledger-table-wrap">
              <table className="tx-table rollover-ledger-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Prior Rollover In</th>
                    <th>Month Budget</th>
                    <th>Net Spent</th>
                    <th>Month Leftover / Used</th>
                    <th>Ending Rollover</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLedgerRows.map((row) => {
                    const isSelected = row.month === selectedMonth;
                    return (
                      <tr
                        key={row.month}
                        className={`tx-row ${isSelected ? 'rollover-row-active' : ''}`}
                        onClick={() => selectBudgetMonth(row.month)}
                        style={{ cursor: 'pointer' }}
                        title="Click to view this month"
                      >
                        <td data-label="Month" style={{ fontWeight: 700 }}>
                          {formatShortMonthLabel(row.month)}
                          {isSelected && (
                            <span
                              className="pill pill-blue"
                              style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px' }}
                            >
                              Viewing
                            </span>
                          )}
                        </td>
                        <td
                          data-label="Prior Rollover In"
                          className={
                            row.rollover_in > 0
                              ? 'text-success'
                              : row.rollover_in < 0
                              ? 'text-danger'
                              : 'text-muted'
                          }
                          style={{ fontWeight: 600 }}
                        >
                          {fmtSignedMoney(row.rollover_in)}
                        </td>
                        <td data-label="Month Budget">${fmtMoney(row.monthly_limit)}</td>
                        <td data-label="Net Spent">
                          ${fmtMoney(row.net_spent)}
                          {row.spent_from_rollover > 0 && (
                            <div className="text-xs text-rainbow-label">
                              🌈 ${fmtMoney(row.spent_from_rollover)} from rollover
                            </div>
                          )}
                        </td>
                        <td
                          data-label="Month Leftover / Used"
                          className={
                            row.month_delta > 0
                              ? 'text-success'
                              : row.month_delta < 0
                              ? row.is_using_rollover
                                ? 'text-rainbow-label'
                                : 'text-danger'
                              : 'text-muted'
                          }
                          style={{ fontWeight: 600 }}
                        >
                          {fmtSignedMoney(row.month_delta)}
                        </td>
                        <td data-label="Ending Rollover">
                          <span
                            className={`pill ${
                              row.is_in_debt
                                ? 'pill-red'
                                : row.is_using_rollover
                                ? 'pill-rainbow'
                                : row.rollover_out > 0
                                ? 'pill-green'
                                : 'pill-gray'
                            }`}
                            style={{ fontWeight: 700, fontSize: 12 }}
                          >
                            {fmtSignedMoney(row.rollover_out)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Switch Budget Month Modal */}
      {showMonthModal && (
        <div className="finance-modal-backdrop" onClick={() => setShowMonthModal(false)}>
          <div
            className="finance-modal-card"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3 className="finance-modal-title">Select Budget Month</h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowMonthModal(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="finance-modal-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(summary.available_months || [selectedMonth]).map((ym) => (
                  <button
                    key={ym}
                    type="button"
                    className={`btn btn-sm ${
                      ym === selectedMonth ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => {
                      selectBudgetMonth(ym);
                      setShowMonthModal(false);
                    }}
                  >
                    {formatMonthLabel(ym)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Month Close & Tasks Modal */}
      {showMonthCloseModal && (
        <MonthCloseModal
          isOpen={showMonthCloseModal}
          onClose={() => setShowMonthCloseModal(false)}
          selectedMonth={selectedMonth}
          activePartner={activePartner}
          onMonthClosed={() => {
            loadDashboardData(selectedMonth, true);
            if (onDataChanged) onDataChanged();
          }}
          onViewRecap={() => {
            setShowMonthRecapModal(true);
          }}
        />
      )}

      {/* Spotify-Wrapped Style Month Recap Modal */}
      {showMonthRecapModal && (
        <MonthRecapModal
          isOpen={showMonthRecapModal}
          onClose={() => setShowMonthRecapModal(false)}
          selectedMonth={selectedMonth}
          onReopenMonth={() => {
            loadDashboardData(selectedMonth, true);
            if (onDataChanged) onDataChanged();
          }}
        />
      )}
    </div>
  );
}
