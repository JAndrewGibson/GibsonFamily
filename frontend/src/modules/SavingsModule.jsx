import React, { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Building2,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Edit3,
  Layers,
  PiggyBank,
  Plus,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, getCookie, setCookie } from '../api';

const ACCOUNT_COLOR_PALETTE = [
  '#10b981',
  '#06b6d4',
  '#6366f1',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#3b82f6',
  '#14b8a6',
  '#f97316',
  '#ef4444',
];

function formatMonthLabel(ym) {
  if (!ym || ym.length < 7) return ym;
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatShortMonth(ym) {
  if (!ym || ym.length < 7) return ym;
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatCurrency(val, showSign = false) {
  const num = Number(val || 0);
  const absFormatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (showSign) {
    if (num > 0) return `+$${absFormatted}`;
    if (num < 0) return `-$${absFormatted}`;
  }
  return num < 0 ? `-$${absFormatted}` : `$${absFormatted}`;
}

export default function SavingsModule({ activePartner, onDataChanged, syncVersion, onNavigateTab }) {
  const rawCalendarMonth = new Date().toISOString().slice(0, 7);
  const defaultMonth = rawCalendarMonth < '2026-11' ? '2026-11' : rawCalendarMonth;

  const [selectedMonth, setSelectedMonthState] = useState(() =>
    getCookie('gibson_savings_month', defaultMonth) || defaultMonth
  );
  const [timeframeMode, setTimeframeModeState] = useState(() =>
    getCookie('gibson_savings_timeframe', 'mom') || 'mom'
  );
  const [activeGraph, setActiveGraphState] = useState(() =>
    getCookie('gibson_savings_graph', 'combined_balance') || 'combined_balance'
  );
  const [combinedFilterMode, setCombinedFilterMode] = useState('all'); // 'all' | 'savings' | 'brokerage' | 'custom'
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [ledgerTab, setLedgerTab] = useState('all'); // 'all' | 'transfers' | 'spends'
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState('all');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showSpendModal, setShowSpendModal] = useState(false);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);

  // Transfer Form State
  const [trAccountId, setTrAccountId] = useState('');
  const [trAmount, setTrAmount] = useState('');
  const [trSourceName, setTrSourceName] = useState('Transfer to Savings');
  const [trDate, setTrDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [trNotes, setTrNotes] = useState('');
  const [trUpdateBalance, setTrUpdateBalance] = useState(true);

  // Spend from Savings Form State
  const [spName, setSpName] = useState('');
  const [spAmount, setSpAmount] = useState('');
  const [spSavingsAccountId, setSpSavingsAccountId] = useState('');
  const [spPaidAccountId, setSpPaidAccountId] = useState('');
  const [spDate, setSpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [spNotes, setSpNotes] = useState('');
  const [spDeductBalance, setSpDeductBalance] = useState(false);

  // Snapshot Form State
  const [snapAccountId, setSnapAccountId] = useState('');
  const [snapMonth, setSnapMonth] = useState(selectedMonth);
  const [snapBalance, setSnapBalance] = useState('');
  const [snapNotes, setSnapNotes] = useState('');

  // New Account Form inside Accounts Modal
  const [showNewAccForm, setShowNewAccForm] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccInstitution, setNewAccInstitution] = useState('');
  const [newAccKind, setNewAccKind] = useState('savings'); // 'savings' | 'brokerage'
  const [newAccBalance, setNewAccBalance] = useState('');
  const [newAccMask, setNewAccMask] = useState('');
  const [newAccOwnerId, setNewAccOwnerId] = useState('');
  const [newAccColor, setNewAccColor] = useState(ACCOUNT_COLOR_PALETTE[0]);

  const setSelectedMonth = (ym) => {
    if (!ym) return;
    setSelectedMonthState(ym);
    setCookie('gibson_savings_month', ym, 365);
  };

  const setTimeframeMode = (mode) => {
    setTimeframeModeState(mode);
    setCookie('gibson_savings_timeframe', mode, 365);
  };

  const setActiveGraph = (graph) => {
    setActiveGraphState(graph);
    setCookie('gibson_savings_graph', graph, 365);
  };

  const loadSavingsData = async (monthOverride = selectedMonth, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`/api/finance/savings?month=${encodeURIComponent(monthOverride)}`);
      setData(res);
      const savAccs = res.savings_accounts || [];
      setSelectedAccountIds((prev) => {
        if (prev.length === 0 && savAccs.length > 0) {
          return savAccs.map((a) => a.id);
        }
        return prev;
      });
      if (!trAccountId && savAccs.length > 0) {
        setTrAccountId(String(savAccs[0].id));
      }
      if (!spSavingsAccountId && savAccs.length > 0) {
        setSpSavingsAccountId(String(savAccs[0].id));
      }
      if (!snapAccountId && savAccs.length > 0) {
        setSnapAccountId(String(savAccs[0].id));
        setSnapBalance(String(savAccs[0].balance_current || 0));
      }
    } catch (err) {
      console.error('Failed to load savings analytics:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadSavingsData(selectedMonth, false);
  }, [selectedMonth]);

  useEffect(() => {
    if (syncVersion > 1) {
      loadSavingsData(selectedMonth, true);
    }
  }, [syncVersion]);

  const savingsAccounts = data?.savings_accounts || [];
  const allAccounts = data?.all_accounts || [];

  // Determine which accounts are active in the Combined View
  const activeCombinedAccounts = savingsAccounts.filter((acc) => {
    if (combinedFilterMode === 'all') return true;
    if (combinedFilterMode === 'savings') return acc.savings_bucket === 'savings';
    if (combinedFilterMode === 'brokerage') return acc.savings_bucket === 'brokerage';
    return selectedAccountIds.includes(acc.id);
  });
  const activeCombinedIds = new Set(activeCombinedAccounts.map((a) => a.id));

  const handleSelectFilterPreset = (mode) => {
    setCombinedFilterMode(mode);
    if (mode === 'all') {
      setSelectedAccountIds(savingsAccounts.map((a) => a.id));
    } else if (mode === 'savings') {
      setSelectedAccountIds(savingsAccounts.filter((a) => a.savings_bucket === 'savings').map((a) => a.id));
    } else if (mode === 'brokerage') {
      setSelectedAccountIds(savingsAccounts.filter((a) => a.savings_bucket === 'brokerage').map((a) => a.id));
    }
  };

  const handleToggleAccountInCombined = (accId) => {
    setCombinedFilterMode('custom');
    setSelectedAccountIds((prev) => {
      if (prev.includes(accId)) {
        if (prev.length === 1) return prev; // Keep at least 1 selected
        return prev.filter((id) => id !== accId);
      }
      return [...prev, accId];
    });
  };

  // Compute dynamic Combined View series based on activeCombinedIds
  const monthlyChron = (data?.monthly_chronological || []).map((row) => {
    let combBal = 0;
    let savBal = 0;
    let brokBal = 0;
    let tin = 0;
    let tout = 0;

    savingsAccounts.forEach((acc) => {
      if (activeCombinedIds.has(acc.id)) {
        const b = Number(row.account_balances?.[String(acc.id)] || 0);
        const ti = Number(row.account_transfers_in?.[String(acc.id)] || 0);
        const to = Number(row.account_savings_spent?.[String(acc.id)] || 0);
        combBal += b;
        if (acc.savings_bucket === 'brokerage') brokBal += b;
        else savBal += b;
        tin += ti;
        tout += to;
      }
    });

    if (combinedFilterMode === 'all') {
      tout += Number(row.unassigned_savings_spent || 0);
    }

    return {
      ...row,
      filtered_combined_balance: Number(combBal.toFixed(2)),
      filtered_savings_balance: Number(savBal.toFixed(2)),
      filtered_brokerage_balance: Number(brokBal.toFixed(2)),
      filtered_transfers_in: Number(tin.toFixed(2)),
      filtered_savings_spent: Number(tout.toFixed(2)),
      filtered_net_flow: Number((tin - tout).toFixed(2)),
    };
  });

  monthlyChron.forEach((row, idx) => {
    const startBal =
      idx > 0
        ? monthlyChron[idx - 1].filtered_combined_balance
        : Math.max(0, Number((row.filtered_combined_balance - row.filtered_net_flow).toFixed(2)));
    const momChg = Number((row.filtered_combined_balance - startBal).toFixed(2));
    const momPct = startBal > 0 ? Number(((momChg / startBal) * 100).toFixed(1)) : 0.0;
    row.filtered_starting_balance = startBal;
    row.filtered_mom_change = momChg;
    row.filtered_mom_change_pct = momPct;
  });

  const yearlyChron = (data?.yearly_chronological || []).map((yrRow) => {
    let combEnd = 0;
    let savEnd = 0;
    let brokEnd = 0;
    let tin = 0;
    let tout = 0;

    savingsAccounts.forEach((acc) => {
      if (activeCombinedIds.has(acc.id)) {
        const b = Number(yrRow.account_ending_balances?.[String(acc.id)] || 0);
        const ti = Number(yrRow.account_transfers_in?.[String(acc.id)] || 0);
        const to = Number(yrRow.account_savings_spent?.[String(acc.id)] || 0);
        combEnd += b;
        if (acc.savings_bucket === 'brokerage') brokEnd += b;
        else savEnd += b;
        tin += ti;
        tout += to;
      }
    });

    if (combinedFilterMode === 'all') {
      tout += Number(yrRow.unassigned_savings_spent || 0);
    }

    return {
      ...yrRow,
      filtered_combined_balance: Number(combEnd.toFixed(2)),
      filtered_savings_balance: Number(savEnd.toFixed(2)),
      filtered_brokerage_balance: Number(brokEnd.toFixed(2)),
      filtered_transfers_in: Number(tin.toFixed(2)),
      filtered_savings_spent: Number(tout.toFixed(2)),
      filtered_net_flow: Number((tin - tout).toFixed(2)),
    };
  });

  yearlyChron.forEach((yrRow, idx) => {
    const firstMonthOfYr = monthlyChron.find((m) => m.year === yrRow.year);
    const startBal =
      idx > 0
        ? yearlyChron[idx - 1].filtered_combined_balance
        : firstMonthOfYr
        ? firstMonthOfYr.filtered_starting_balance
        : Math.max(0, Number((yrRow.filtered_combined_balance - yrRow.filtered_net_flow).toFixed(2)));
    const yoyChg = Number((yrRow.filtered_combined_balance - startBal).toFixed(2));
    const yoyPct = startBal > 0 ? Number(((yoyChg / startBal) * 100).toFixed(1)) : 0.0;
    yrRow.filtered_starting_balance = startBal;
    yrRow.filtered_yoy_change = yoyChg;
    yrRow.filtered_yoy_change_pct = yoyPct;
  });

  const filteredTotalSavings = activeCombinedAccounts
    .filter((a) => a.savings_bucket === 'savings')
    .reduce((acc, a) => acc + Number(a.balance_current || 0), 0);
  const filteredTotalBrokerage = activeCombinedAccounts
    .filter((a) => a.savings_bucket === 'brokerage')
    .reduce((acc, a) => acc + Number(a.balance_current || 0), 0);
  const filteredCombinedBalance = filteredTotalSavings + filteredTotalBrokerage;

  const currentMonthEntry =
    monthlyChron.find((m) => m.month === selectedMonth) || monthlyChron[monthlyChron.length - 1];
  const currentYearEntry = yearlyChron[yearlyChron.length - 1];

  const handleLogTransfer = async (e) => {
    e.preventDefault();
    if (!trAmount || parseFloat(trAmount) <= 0) return;
    await apiFetch('/api/finance/savings/transfer', {
      method: 'POST',
      body: JSON.stringify({
        account_id: trAccountId ? Number(trAccountId) : null,
        amount: parseFloat(trAmount),
        source_name: trSourceName.trim() || 'Transfer to Savings',
        date: trDate,
        budget_month: trDate.slice(0, 7),
        notes: trNotes.trim(),
        update_account_balance: trUpdateBalance,
      }),
    });
    setTrAmount('');
    setTrNotes('');
    setShowTransferModal(false);
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleLogSpendFromSavings = async (e) => {
    e.preventDefault();
    if (!spName.trim() || !spAmount || parseFloat(spAmount) <= 0) return;
    await apiFetch('/api/finance/savings/spend', {
      method: 'POST',
      body: JSON.stringify({
        name: spName.trim(),
        amount: parseFloat(spAmount),
        savings_account_id: spSavingsAccountId ? Number(spSavingsAccountId) : null,
        account_id: spPaidAccountId ? Number(spPaidAccountId) : (spSavingsAccountId ? Number(spSavingsAccountId) : null),
        date: spDate,
        budget_month: spDate.slice(0, 7),
        notes: spNotes.trim(),
        deduct_from_account_balance: spDeductBalance,
      }),
    });
    setSpName('');
    setSpAmount('');
    setSpNotes('');
    setShowSpendModal(false);
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleSaveSnapshot = async (e) => {
    e.preventDefault();
    if (!snapAccountId || snapBalance === '') return;
    await apiFetch('/api/finance/savings/snapshots', {
      method: 'POST',
      body: JSON.stringify({
        account_id: Number(snapAccountId),
        snapshot_month: snapMonth,
        balance: parseFloat(snapBalance),
        notes: snapNotes.trim(),
      }),
    });
    setSnapNotes('');
    setShowSnapshotModal(false);
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleToggleAccountSavingsTracking = async (acc, nextTracked) => {
    await apiFetch(`/api/finance/accounts/${acc.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        is_savings_account: nextTracked,
      }),
    });
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleCreateSavingsAccount = async (e) => {
    e.preventDefault();
    if (!newAccName.trim()) return;
    await apiFetch('/api/finance/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: newAccName.trim(),
        institution_name: newAccInstitution.trim() || 'Savings / Brokerage',
        type: newAccKind === 'brokerage' ? 'investment' : 'depository',
        subtype: newAccKind === 'brokerage' ? 'brokerage' : 'savings',
        balance_current: parseFloat(newAccBalance || '0'),
        balance_available: parseFloat(newAccBalance || '0'),
        mask: newAccMask.trim() || '0000',
        owner_partner_id: newAccOwnerId ? Number(newAccOwnerId) : null,
        color: newAccColor,
        is_savings_account: true,
      }),
    });
    setNewAccName('');
    setNewAccInstitution('');
    setNewAccBalance('');
    setNewAccMask('');
    setShowNewAccForm(false);
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleRestoreSpendToBudget = async (tx) => {
    await apiFetch(`/api/finance/transactions/${tx.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        is_savings_spend: false,
        fallback_category: 'Shopping & Tech',
      }),
    });
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleDeleteTransfer = async (incId) => {
    await apiFetch(`/api/finance/income/${incId}`, { method: 'DELETE' });
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  const handleDeleteSavingsSpend = async (txId) => {
    await apiFetch(`/api/finance/transactions/${txId}`, { method: 'DELETE' });
    await loadSavingsData(selectedMonth, true);
    onDataChanged?.();
  };

  if (loading && !data) {
    return <div className="card">Loading Savings & Long-Term Analytics...</div>;
  }
  if (!data) return null;

  const activeSeriesForChart = timeframeMode === 'yoy' ? yearlyChron : monthlyChron;
  const maxCombinedChartVal = Math.max(
    100,
    ...activeSeriesForChart.map((r) => Math.max(r.filtered_combined_balance || 0, 0))
  );
  const maxFlowChartVal = Math.max(
    100,
    ...activeSeriesForChart.map((r) =>
      Math.max(r.filtered_transfers_in || 0, r.filtered_savings_spent || 0)
    )
  );

  // Filter ledger items
  const transfersList = (data.savings_transfers || []).filter((tr) => {
    if (ledgerAccountFilter !== 'all' && String(tr.account_id) !== String(ledgerAccountFilter)) {
      return false;
    }
    return true;
  });

  const spendsList = (data.savings_spends || []).filter((sp) => {
    if (
      ledgerAccountFilter !== 'all' &&
      String(sp.effective_savings_account_id || sp.account_id) !== String(ledgerAccountFilter)
    ) {
      return false;
    }
    return true;
  });

  const combinedActivity = [
    ...(ledgerTab === 'spends'
      ? []
      : transfersList.map((t) => ({ ...t, _activityType: 'transfer' }))),
    ...(ledgerTab === 'transfers'
      ? []
      : spendsList.map((s) => ({ ...s, _activityType: 'spend' }))),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);

  return (
    <div className="module-container">
      {/* Top Header */}
      <div className="module-header-Clean">
        <div className="module-header-title-group">
          <h2 className="module-clean-title">
            <PiggyBank size={22} style={{ verticalAlign: 'middle', marginRight: '0.45rem', color: 'var(--emerald)' }} />
            Savings & Long-Term Analytics
          </h2>
          <span className="module-clean-subtitle">
            MoM & YoY savings/brokerage balances, transfers into savings, and big purchases funded from savings
          </span>
        </div>

        <div className="finance-clean-toolbar">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowTransferModal(true)}
          >
            <ArrowDownLeft size={15} /> + Transfer to Savings
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSpendModal(true)}
            title="Log a big purchase funded from savings without affecting your monthly budget"
          >
            <ShoppingBag size={15} /> + Spend from Savings
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSnapshotModal(true)}
            title="Record or adjust a monthly account balance snapshot"
          >
            <Calendar size={15} /> Balance Snapshot
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAccountsModal(true)}
          >
            <SlidersHorizontal size={15} /> Accounts ({savingsAccounts.length})
          </button>
        </div>
      </div>

      {/* Combined View Account Filter & Bucket Selector */}
      <div className="card" style={{ marginBottom: '1rem', padding: '0.9rem 1.1rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: savingsAccounts.length > 0 ? '0.75rem' : 0,
          }}
        >
          <div>
            <strong style={{ fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Layers size={15} className="text-cyan" /> Combined View Account Filter
            </strong>
            <small className="text-muted">
              Select which Savings & Brokerage accounts are aggregated in the Combined View and KPIs
            </small>
          </div>

          <div className="chart-selector-tabs" style={{ margin: 0 }}>
            <button
              type="button"
              className={`chart-tab-btn ${combinedFilterMode === 'all' ? 'active' : ''}`}
              onClick={() => handleSelectFilterPreset('all')}
            >
              All Savings & Brokerage ({savingsAccounts.length})
            </button>
            <button
              type="button"
              className={`chart-tab-btn ${combinedFilterMode === 'savings' ? 'active' : ''}`}
              onClick={() => handleSelectFilterPreset('savings')}
            >
              Cash Savings Only ({savingsAccounts.filter((a) => a.savings_bucket === 'savings').length})
            </button>
            <button
              type="button"
              className={`chart-tab-btn ${combinedFilterMode === 'brokerage' ? 'active' : ''}`}
              onClick={() => handleSelectFilterPreset('brokerage')}
            >
              Brokerage / Investments ({savingsAccounts.filter((a) => a.savings_bucket === 'brokerage').length})
            </button>
          </div>
        </div>

        {savingsAccounts.length === 0 ? (
          <div className="empty-state-box" style={{ padding: '1rem' }}>
            <p className="text-muted" style={{ marginBottom: '0.6rem' }}>
              No Savings or Brokerage accounts are currently tracked. Add a savings/brokerage account or mark an existing account as savings.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setShowNewAccForm(true);
                setShowAccountsModal(true);
              }}
            >
              <Plus size={14} /> Add Savings / Brokerage Account
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {savingsAccounts.map((acc) => {
              const isIncluded = activeCombinedIds.has(acc.id);
              const accColor = acc.color || '#10b981';
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => handleToggleAccountInCombined(acc.id)}
                  className="btn btn-xs"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.4rem 0.7rem',
                    borderRadius: '999px',
                    border: `1.5px solid ${isIncluded ? accColor : 'var(--border-subtle)'}`,
                    backgroundColor: isIncluded ? `${accColor}18` : 'transparent',
                    color: isIncluded ? 'var(--text-main)' : 'var(--text-muted)',
                    opacity: isIncluded ? 1 : 0.65,
                    cursor: 'pointer',
                  }}
                  title="Click to toggle this account in the Combined View"
                >
                  <span
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      backgroundColor: accColor,
                      display: 'inline-block',
                    }}
                  />
                  <strong>{acc.name}</strong>
                  <span className="pill pill-outline" style={{ fontSize: '0.64rem', padding: '0.08rem 0.38rem' }}>
                    {acc.savings_bucket === 'brokerage' ? 'Brokerage' : 'Savings'}
                  </span>
                  <span className="font-mono" style={{ fontWeight: 600, color: accColor }}>
                    {formatCurrency(acc.balance_current)}
                  </span>
                  {isIncluded && <Check size={12} style={{ color: accColor }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 4-Card KPI Summary Strip */}
      <div className="kpi-grid" style={{ marginBottom: '1.1rem' }}>
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Combined Balance</span>
            <PiggyBank size={18} className="text-green" />
          </div>
          <div className="kpi-value text-green">{formatCurrency(filteredCombinedBalance)}</div>
          <small className="text-muted">
            Savings: <strong>{formatCurrency(filteredTotalSavings)}</strong> • Brokerage:{' '}
            <strong>{formatCurrency(filteredTotalBrokerage)}</strong>
          </small>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Month-over-Month (MoM)</span>
            {(currentMonthEntry?.filtered_mom_change || 0) >= 0 ? (
              <TrendingUp size={18} className="text-green" />
            ) : (
              <TrendingDown size={18} className="text-amber" />
            )}
          </div>
          <div
            className={`kpi-value ${
              (currentMonthEntry?.filtered_mom_change || 0) >= 0 ? 'text-green' : 'text-amber'
            }`}
          >
            {formatCurrency(currentMonthEntry?.filtered_mom_change || 0, true)} (
            {(currentMonthEntry?.filtered_mom_change_pct || 0) >= 0 ? '+' : ''}
            {currentMonthEntry?.filtered_mom_change_pct || 0}%)
          </div>
          <small className="text-muted">
            In: <span className="text-green">+{formatCurrency(currentMonthEntry?.filtered_transfers_in || 0)}</span> •
            Spent: <span className="text-amber">-{formatCurrency(currentMonthEntry?.filtered_savings_spent || 0)}</span>
          </small>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Year-over-Year (YoY)</span>
            {(currentYearEntry?.filtered_yoy_change || 0) >= 0 ? (
              <TrendingUp size={18} className="text-cyan" />
            ) : (
              <TrendingDown size={18} className="text-amber" />
            )}
          </div>
          <div
            className={`kpi-value ${
              (currentYearEntry?.filtered_yoy_change || 0) >= 0 ? 'text-cyan' : 'text-amber'
            }`}
          >
            {formatCurrency(currentYearEntry?.filtered_yoy_change || 0, true)} (
            {(currentYearEntry?.filtered_yoy_change_pct || 0) >= 0 ? '+' : ''}
            {currentYearEntry?.filtered_yoy_change_pct || 0}%)
          </div>
          <small className="text-muted">
            {currentYearEntry?.year || new Date().getFullYear()} Net Flow:{' '}
            <strong>{formatCurrency(currentYearEntry?.filtered_net_flow || 0, true)}</strong>
          </small>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Spent from Savings (Excl. Budget)</span>
            <ShoppingBag size={18} className="text-purple" />
          </div>
          <div className="kpi-value">{formatCurrency(data.kpis?.all_time_savings_spent || 0)}</div>
          <small className="text-muted">
            {formatShortMonth(selectedMonth)}:{' '}
            <strong>{formatCurrency(currentMonthEntry?.filtered_savings_spent || 0)}</strong> (0% impact on monthly budget)
          </small>
        </div>
      </div>

      {/* Visualizations & Graphs Section */}
      <div className="card" style={{ marginBottom: '1.1rem' }}>
        <div
          className="card-header"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div>
            <h3>
              <BarChart3 size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
              Savings & Brokerage Visualizations ({timeframeMode === 'yoy' ? 'Year-over-Year' : 'Month-over-Month'})
            </h3>
            <small className="text-muted">
              Analyze individual account balances, combined savings/brokerage growth, and long-term savings flow
            </small>
          </div>

          {/* MoM vs YoY Switcher */}
          <div className="chart-selector-tabs" style={{ margin: 0 }}>
            <button
              type="button"
              className={`chart-tab-btn ${timeframeMode === 'mom' ? 'active' : ''}`}
              onClick={() => setTimeframeMode('mom')}
            >
              Month-over-Month (MoM)
            </button>
            <button
              type="button"
              className={`chart-tab-btn ${timeframeMode === 'yoy' ? 'active' : ''}`}
              onClick={() => setTimeframeMode('yoy')}
            >
              Year-over-Year (YoY)
            </button>
          </div>
        </div>

        {/* Graph Type Tabs */}
        <div className="chart-selector-tabs" style={{ marginBottom: '1rem' }}>
          <button
            type="button"
            className={`chart-tab-btn ${activeGraph === 'combined_balance' ? 'active' : ''}`}
            onClick={() => setActiveGraph('combined_balance')}
          >
            Combined Savings & Brokerage Balance
          </button>
          <button
            type="button"
            className={`chart-tab-btn ${activeGraph === 'per_account' ? 'active' : ''}`}
            onClick={() => setActiveGraph('per_account')}
          >
            Each Account's Balance ({savingsAccounts.length})
          </button>
          <button
            type="button"
            className={`chart-tab-btn ${activeGraph === 'savings_flow' ? 'active' : ''}`}
            onClick={() => setActiveGraph('savings_flow')}
          >
            Transfers In vs. Spent from Savings
          </button>
        </div>

        {/* GRAPH 1: Combined Balance Bar Chart (Stacked Savings + Brokerage) */}
        {activeGraph === 'combined_balance' && (
          <div className="chart-stage">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '0.85rem',
                fontSize: '0.78rem',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: '#10b981',
                    display: 'inline-block',
                  }}
                />
                Cash Savings Accounts
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: '#6366f1',
                    display: 'inline-block',
                  }}
                />
                Brokerage & Investment Accounts
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, activeSeriesForChart.length)}, minmax(64px, 1fr))`,
                gap: '0.65rem',
                alignItems: 'end',
                minHeight: '220px',
                padding: '1rem 0.5rem 0.5rem',
                borderBottom: '1px solid var(--border-subtle)',
                overflowX: 'auto',
              }}
            >
              {activeSeriesForChart.map((item) => {
                const label = timeframeMode === 'yoy' ? item.year : formatShortMonth(item.month);
                const totalBal = item.filtered_combined_balance || 0;
                const savPart = item.filtered_savings_balance || 0;
                const brokPart = item.filtered_brokerage_balance || 0;
                const totalHeightPct = Math.min(100, Math.max(6, (totalBal / maxCombinedChartVal) * 100));
                const savRatio = totalBal > 0 ? (savPart / totalBal) * 100 : 100;
                const brokRatio = totalBal > 0 ? (brokPart / totalBal) * 100 : 0;
                const delta =
                  timeframeMode === 'yoy' ? item.filtered_yoy_change : item.filtered_mom_change;

                return (
                  <div
                    key={timeframeMode === 'yoy' ? item.year : item.month}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '200px',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                      {formatCurrency(totalBal)}
                    </span>
                    <span
                      className={`font-mono ${delta >= 0 ? 'text-green' : 'text-amber'}`}
                      style={{ fontSize: '0.66rem', marginBottom: '0.35rem' }}
                    >
                      {formatCurrency(delta, true)}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '52px',
                        height: `${totalHeightPct}%`,
                        borderRadius: '6px 6px 0 0',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                      }}
                      title={`${label}: Combined ${formatCurrency(totalBal)} (Savings: ${formatCurrency(
                        savPart
                      )}, Brokerage: ${formatCurrency(brokPart)})`}
                    >
                      {brokRatio > 0 && (
                        <div
                          style={{
                            height: `${brokRatio}%`,
                            backgroundColor: '#6366f1',
                            width: '100%',
                          }}
                        />
                      )}
                      <div
                        style={{
                          height: `${savRatio}%`,
                          backgroundColor: '#10b981',
                          width: '100%',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        marginTop: '0.45rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* GRAPH 2: Individual Account Balance Graphs */}
        {activeGraph === 'per_account' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 310px), 1fr))',
              gap: '1rem',
            }}
          >
            {savingsAccounts.map((acc) => {
              const accColor = acc.color || '#10b981';
              const rawMonthSeries = data.account_series?.[String(acc.id)] || [];
              const series =
                timeframeMode === 'yoy'
                  ? yearlyChron.map((yr) => ({
                      label: yr.year,
                      balance: Number(yr.account_ending_balances?.[String(acc.id)] || 0),
                      transfers_in: Number(yr.account_transfers_in?.[String(acc.id)] || 0),
                      savings_spent: Number(yr.account_savings_spent?.[String(acc.id)] || 0),
                    }))
                  : rawMonthSeries.map((m) => ({
                      label: formatShortMonth(m.month),
                      balance: Number(m.balance || 0),
                      transfers_in: Number(m.transfers_in || 0),
                      savings_spent: Number(m.savings_spent || 0),
                    }));

              const maxAccBal = Math.max(100, ...series.map((s) => s.balance));

              return (
                <div
                  key={acc.id}
                  className="card"
                  style={{
                    borderLeft: `4px solid ${accColor}`,
                    padding: '0.95rem',
                    margin: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      marginBottom: '0.65rem',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <strong>{acc.name}</strong>
                        <span className="pill pill-outline" style={{ fontSize: '0.65rem' }}>
                          {acc.savings_bucket === 'brokerage' ? 'Brokerage' : 'Savings'}
                        </span>
                      </div>
                      <small className="text-muted">
                        {acc.institution_name} • •••• {acc.mask || '0000'}
                        {acc.owner_partner_name ? ` • ${acc.owner_partner_name}` : ' • Shared'}
                      </small>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="font-mono" style={{ fontWeight: 700, fontSize: '1.05rem', color: accColor }}>
                        {formatCurrency(acc.balance_current)}
                      </div>
                      <small className={acc.mom_change >= 0 ? 'text-green' : 'text-amber'}>
                        MoM: {formatCurrency(acc.mom_change, true)} ({acc.mom_change >= 0 ? '+' : ''}
                        {acc.mom_change_pct}%)
                      </small>
                    </div>
                  </div>

                  {/* Mini Bar Curve for this account */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.max(1, series.length)}, minmax(38px, 1fr))`,
                      gap: '0.4rem',
                      alignItems: 'end',
                      height: '125px',
                      paddingTop: '0.5rem',
                      borderBottom: '1px solid var(--border-subtle)',
                      overflowX: 'auto',
                    }}
                  >
                    {series.map((pt) => {
                      const hPct = Math.min(100, Math.max(8, (pt.balance / maxAccBal) * 100));
                      return (
                        <div
                          key={pt.label}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            height: '110px',
                            justifyContent: 'flex-end',
                          }}
                          title={`${pt.label}: ${formatCurrency(pt.balance)} (In: +${formatCurrency(
                            pt.transfers_in
                          )}, Spent: -${formatCurrency(pt.savings_spent)})`}
                        >
                          <span className="font-mono" style={{ fontSize: '0.62rem', marginBottom: '0.15rem' }}>
                            ${Math.round(pt.balance).toLocaleString()}
                          </span>
                          <div
                            style={{
                              width: '100%',
                              maxWidth: '32px',
                              height: `${hPct}%`,
                              backgroundColor: accColor,
                              borderRadius: '4px 4px 0 0',
                            }}
                          />
                          <span style={{ fontSize: '0.64rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                            {pt.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* GRAPH 3: Transfers Into Savings vs. Spent from Savings */}
        {activeGraph === 'savings_flow' && (
          <div className="chart-stage">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                marginBottom: '0.85rem',
                fontSize: '0.78rem',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: '#10b981',
                    display: 'inline-block',
                  }}
                />
                Transfers Into Savings (+)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: '#f59e0b',
                    display: 'inline-block',
                  }}
                />
                Purchases Funded from Savings (-)
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, activeSeriesForChart.length)}, minmax(80px, 1fr))`,
                gap: '0.75rem',
                alignItems: 'end',
                minHeight: '210px',
                padding: '1rem 0.5rem 0.5rem',
                borderBottom: '1px solid var(--border-subtle)',
                overflowX: 'auto',
              }}
            >
              {activeSeriesForChart.map((item) => {
                const label = timeframeMode === 'yoy' ? item.year : formatShortMonth(item.month);
                const tin = item.filtered_transfers_in || 0;
                const tout = item.filtered_savings_spent || 0;
                const net = item.filtered_net_flow || 0;
                const inPct = Math.min(100, Math.max(4, (tin / maxFlowChartVal) * 100));
                const outPct = Math.min(100, Math.max(4, (tout / maxFlowChartVal) * 100));

                return (
                  <div
                    key={timeframeMode === 'yoy' ? item.year : item.month}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '190px',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <span
                      className={`font-mono ${net >= 0 ? 'text-green' : 'text-amber'}`}
                      style={{ fontSize: '0.68rem', fontWeight: 700, marginBottom: '0.3rem' }}
                    >
                      Net: {formatCurrency(net, true)}
                    </span>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '6px',
                        height: '140px',
                        width: '100%',
                        justifyContent: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: '22px',
                          height: `${inPct}%`,
                          backgroundColor: '#10b981',
                          borderRadius: '4px 4px 0 0',
                        }}
                        title={`Transfers Into Savings: ${formatCurrency(tin)}`}
                      />
                      <div
                        style={{
                          width: '22px',
                          height: `${outPct}%`,
                          backgroundColor: '#f59e0b',
                          borderRadius: '4px 4px 0 0',
                        }}
                        title={`Spent from Savings: ${formatCurrency(tout)}`}
                      />
                    </div>
                    <span style={{ fontSize: '0.73rem', fontWeight: 600, marginTop: '0.45rem' }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Month-over-Month & Year-over-Year Breakdown Table */}
      <div className="card" style={{ marginBottom: '1.1rem' }}>
        <div
          className="card-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}
        >
          <div>
            <h3>
              {timeframeMode === 'yoy'
                ? 'Year-over-Year (YoY) Savings & Brokerage Summary'
                : 'Month-over-Month (MoM) Savings & Brokerage Summary'}
            </h3>
            <small className="text-muted">
              Long-term flow of transfers into savings, purchases funded from savings, and ending balances
            </small>
          </div>
        </div>

        <div className="table-responsive">
          <table className="tx-table">
            <thead>
              <tr>
                <th>{timeframeMode === 'yoy' ? 'Year' : 'Month'}</th>
                <th>Starting Balance</th>
                <th>Transfers Into Savings</th>
                <th>Spent from Savings</th>
                <th>Net Savings Flow</th>
                <th>Ending Balance</th>
                <th>{timeframeMode === 'yoy' ? 'YoY Growth' : 'MoM Change'}</th>
              </tr>
            </thead>
            <tbody>
              {[...activeSeriesForChart].reverse().map((row) => {
                const key = timeframeMode === 'yoy' ? row.year : row.month;
                const label = timeframeMode === 'yoy' ? row.year : formatMonthLabel(row.month);
                const chg = timeframeMode === 'yoy' ? row.filtered_yoy_change : row.filtered_mom_change;
                const chgPct =
                  timeframeMode === 'yoy' ? row.filtered_yoy_change_pct : row.filtered_mom_change_pct;
                return (
                  <tr key={key} className="tx-row">
                    <td>
                      <strong>{label}</strong>
                    </td>
                    <td className="font-mono">{formatCurrency(row.filtered_starting_balance)}</td>
                    <td className="font-mono text-green">+{formatCurrency(row.filtered_transfers_in)}</td>
                    <td className="font-mono text-amber">-{formatCurrency(row.filtered_savings_spent)}</td>
                    <td
                      className={`font-mono ${
                        row.filtered_net_flow >= 0 ? 'text-green' : 'text-amber'
                      }`}
                    >
                      <strong>{formatCurrency(row.filtered_net_flow, true)}</strong>
                    </td>
                    <td className="font-mono">
                      <strong>{formatCurrency(row.filtered_combined_balance)}</strong>
                    </td>
                    <td>
                      <span className={`pill ${chg >= 0 ? 'pill-green' : 'pill-amber'}`}>
                        {formatCurrency(chg, true)} ({chg >= 0 ? '+' : ''}
                        {chgPct}%)
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Savings Transfers & Spent from Savings Activity Ledger */}
      <div className="card">
        <div
          className="card-header"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <div>
            <h3>Long-Term Savings Activity & "Spent from Savings" Category</h3>
            <small className="text-muted">
              Every transfer into a savings/brokerage account and every big purchase marked as funded from savings
            </small>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <select
              className="select-input"
              value={ledgerAccountFilter}
              onChange={(e) => setLedgerAccountFilter(e.target.value)}
              style={{ minWidth: '170px' }}
            >
              <option value="all">All Savings Accounts</option>
              {savingsAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatCurrency(a.balance_current)})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="chart-selector-tabs" style={{ marginBottom: '0.9rem' }}>
          <button
            type="button"
            className={`chart-tab-btn ${ledgerTab === 'all' ? 'active' : ''}`}
            onClick={() => setLedgerTab('all')}
          >
            All Activity ({transfersList.length + spendsList.length})
          </button>
          <button
            type="button"
            className={`chart-tab-btn ${ledgerTab === 'transfers' ? 'active' : ''}`}
            onClick={() => setLedgerTab('transfers')}
          >
            Transfers Into Savings ({transfersList.length})
          </button>
          <button
            type="button"
            className={`chart-tab-btn ${ledgerTab === 'spends' ? 'active' : ''}`}
            onClick={() => setLedgerTab('spends')}
          >
            Spent from Savings Purchases ({spendsList.length})
          </button>
        </div>

        {combinedActivity.length === 0 ? (
          <div className="empty-state-box">
            <p className="text-muted">
              No transfers into savings or savings-funded purchases recorded yet. Use{' '}
              <strong>+ Transfer to Savings</strong> or <strong>+ Spend from Savings</strong> above, or mark any purchase in Finances & Budgeting as "From Savings".
            </p>
          </div>
        ) : (
          <div className="income-entries-list">
            {combinedActivity.map((item) => {
              const isTransfer = item._activityType === 'transfer';
              const accColor = isTransfer
                ? item.account_color || '#10b981'
                : item.effective_savings_account_color || item.account_color || '#f59e0b';
              const accLabel = isTransfer
                ? item.account_name || 'Savings Account'
                : item.effective_savings_account_name || item.account_name || 'Household Savings';

              return (
                <div
                  key={`${item._activityType}-${item.id}`}
                  className="income-entry-row"
                  style={{ borderLeft: `4px solid ${accColor}` }}
                >
                  <div className="income-entry-meta">
                    <div className="request-badges">
                      <strong>{isTransfer ? item.source_name : item.name}</strong>
                      {isTransfer ? (
                        <span className="pill pill-green" style={{ fontSize: '0.68rem' }}>
                          <ArrowDownLeft size={11} /> Transfer Into Savings
                        </span>
                      ) : (
                        <span className="pill pill-amber" style={{ fontSize: '0.68rem' }}>
                          <ShoppingBag size={11} /> Spent from Savings (Excluded from Budget)
                        </span>
                      )}
                      <span
                        className="tx-account-color-pill"
                        style={{
                          borderColor: accColor,
                          color: accColor,
                          backgroundColor: `${accColor}18`,
                        }}
                      >
                        <span className="tx-account-color-dot" style={{ backgroundColor: accColor }} />
                        {accLabel}
                      </span>
                      {!isTransfer && item.account_name && item.account_name !== accLabel && (
                        <span className="pill pill-outline" style={{ fontSize: '0.65rem' }}>
                          Paid via {item.account_name}
                        </span>
                      )}
                    </div>
                    <small className="text-muted">
                      {item.date} • Period: {formatShortMonth(item.budget_month)}
                      {item.partner_name ? ` • ${item.partner_name}` : ''}
                      {item.notes ? ` • ${item.notes}` : ''}
                    </small>
                  </div>

                  <div className="topbar-right">
                    {!isTransfer && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => handleRestoreSpendToBudget(item)}
                        title="Move this purchase back into the monthly budget"
                      >
                        <RotateCcw size={12} /> Restore to Budget
                      </button>
                    )}
                    <strong className={`font-mono ${isTransfer ? 'text-green' : 'text-amber'}`}>
                      {isTransfer ? '+' : '-'}
                      {formatCurrency(item.amount)}
                    </strong>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() =>
                        isTransfer
                          ? handleDeleteTransfer(item.id)
                          : handleDeleteSavingsSpend(item.id)
                      }
                      title="Delete entry"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: Log Transfer Into Savings */}
      {showTransferModal && (
        <div className="finance-modal-backdrop" onClick={() => setShowTransferModal(false)}>
          <div className="finance-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="finance-modal-header">
              <div>
                <h3>Log Transfer Into Savings / Brokerage</h3>
                <small className="text-muted">
                  Records a deposit or transfer into your savings or investment account
                </small>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowTransferModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="finance-modal-body">
              <form onSubmit={handleLogTransfer} className="clean-form">
                <div className="form-group">
                  <label>Destination Savings / Brokerage Account</label>
                  <select
                    value={trAccountId}
                    onChange={(e) => setTrAccountId(e.target.value)}
                    required={savingsAccounts.length > 0}
                  >
                    <option value="">Select Account...</option>
                    {savingsAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.savings_bucket === 'brokerage' ? 'Brokerage' : 'Savings'} —{' '}
                        {formatCurrency(a.balance_current)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Transfer Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="500.00"
                      value={trAmount}
                      onChange={(e) => setTrAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={trDate}
                      onChange={(e) => setTrDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Description / Source</label>
                  <input
                    type="text"
                    placeholder="e.g. Monthly Transfer to High-Yield Savings"
                    value={trSourceName}
                    onChange={(e) => setTrSourceName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Emergency fund / House down payment contribution"
                    value={trNotes}
                    onChange={(e) => setTrNotes(e.target.value)}
                  />
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    fontSize: '0.84rem',
                    marginBottom: '1rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={trUpdateBalance}
                    onChange={(e) => setTrUpdateBalance(e.target.checked)}
                    style={{ width: '18px', height: '18px', minHeight: '18px' }}
                  />
                  <span>Also add this transfer amount to the selected account's live balance</span>
                </label>

                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowTransferModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Transfer
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Log Spend from Savings */}
      {showSpendModal && (
        <div className="finance-modal-backdrop" onClick={() => setShowSpendModal(false)}>
          <div className="finance-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="finance-modal-header">
              <div>
                <h3>Log Purchase Funded from Savings</h3>
                <small className="text-muted">
                  Tracked in the "Spent from Savings" category for long-term analytics without affecting your monthly budget
                </small>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowSpendModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="finance-modal-body">
              <form onSubmit={handleLogSpendFromSavings} className="clean-form">
                <div className="form-group">
                  <label>Purchase Description</label>
                  <input
                    type="text"
                    placeholder="e.g. New Living Room Sofa / Anniversary Flights"
                    value={spName}
                    onChange={(e) => setSpName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="1250.00"
                      value={spAmount}
                      onChange={(e) => setSpAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={spDate}
                      onChange={(e) => setSpDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Funded By Savings Account</label>
                    <select
                      value={spSavingsAccountId}
                      onChange={(e) => setSpSavingsAccountId(e.target.value)}
                    >
                      <option value="">Household Savings (General)</option>
                      {savingsAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({formatCurrency(a.balance_current)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Paid Using Account / Card (Optional)</label>
                    <select
                      value={spPaidAccountId}
                      onChange={(e) => setSpPaidAccountId(e.target.value)}
                    >
                      <option value="">Same as Savings Account</option>
                      {allAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} (•••• {a.mask || '0000'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Notes / Savings Goal</label>
                  <input
                    type="text"
                    placeholder="e.g. Saved over 6 months in Home Upgrade fund"
                    value={spNotes}
                    onChange={(e) => setSpNotes(e.target.value)}
                  />
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    fontSize: '0.84rem',
                    marginBottom: '1rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={spDeductBalance}
                    onChange={(e) => setSpDeductBalance(e.target.checked)}
                    style={{ width: '18px', height: '18px', minHeight: '18px' }}
                  />
                  <span>Also deduct this amount from the selected savings account's live balance</span>
                </label>

                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowSpendModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Record Savings Purchase
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Monthly Balance Snapshot */}
      {showSnapshotModal && (
        <div className="finance-modal-backdrop" onClick={() => setShowSnapshotModal(false)}>
          <div className="finance-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="finance-modal-header">
              <div>
                <h3>Record Monthly Balance Snapshot</h3>
                <small className="text-muted">
                  Log or adjust an account's month-end balance for exact MoM & YoY historical charts
                </small>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowSnapshotModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="finance-modal-body">
              <form onSubmit={handleSaveSnapshot} className="clean-form">
                <div className="form-group">
                  <label>Savings / Brokerage Account</label>
                  <select
                    value={snapAccountId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSnapAccountId(val);
                      const found = savingsAccounts.find((a) => String(a.id) === String(val));
                      if (found) setSnapBalance(String(found.balance_current || 0));
                    }}
                    required
                  >
                    <option value="">Select Account...</option>
                    {savingsAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (Current: {formatCurrency(a.balance_current)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Snapshot Month (YYYY-MM)</label>
                    <input
                      type="month"
                      value={snapMonth}
                      onChange={(e) => setSnapMonth(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Ending Balance ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="15000.00"
                      value={snapBalance}
                      onChange={(e) => setSnapBalance(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Month-end statement balance"
                    value={snapNotes}
                    onChange={(e) => setSnapNotes(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowSnapshotModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Snapshot
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Manage Savings & Brokerage Accounts */}
      {showAccountsModal && (
        <div className="finance-modal-backdrop" onClick={() => setShowAccountsModal(false)}>
          <div className="finance-modal-card finance-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="finance-modal-header">
              <div>
                <h3>Savings & Brokerage Account Configuration</h3>
                <small className="text-muted">
                  Choose which accounts are tracked as Savings/Brokerage or add a manual savings/investment account
                </small>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAccountsModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="finance-modal-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                <strong>Household Accounts ({allAccounts.length})</strong>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => setShowNewAccForm((v) => !v)}
                >
                  <Plus size={14} /> {showNewAccForm ? 'Hide Form' : 'Add Savings / Brokerage Account'}
                </button>
              </div>

              {showNewAccForm && (
                <form
                  onSubmit={handleCreateSavingsAccount}
                  className="clean-form"
                  style={{
                    padding: '0.9rem',
                    marginBottom: '1rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                  }}
                >
                  <h4 style={{ marginTop: 0, marginBottom: '0.65rem' }}>New Savings or Brokerage Account</h4>
                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Account Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Ally High-Yield Savings / Fidelity Brokerage"
                        value={newAccName}
                        onChange={(e) => setNewAccName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Account Type</label>
                      <select value={newAccKind} onChange={(e) => setNewAccKind(e.target.value)}>
                        <option value="savings">Cash Savings / HYSA / Money Market</option>
                        <option value="brokerage">Brokerage / Investment / Retirement</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Institution Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Ally Bank / Vanguard / Fidelity"
                        value={newAccInstitution}
                        onChange={(e) => setNewAccInstitution(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Current Balance ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="10000.00"
                        value={newAccBalance}
                        onChange={(e) => setNewAccBalance(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Owner</label>
                      <select value={newAccOwnerId} onChange={(e) => setNewAccOwnerId(e.target.value)}>
                        <option value="">Shared / Household</option>
                        {data.partners?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Last 4 Digits (Optional)</label>
                      <input
                        type="text"
                        maxLength={4}
                        placeholder="1234"
                        value={newAccMask}
                        onChange={(e) => setNewAccMask(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Account Color</label>
                    <div className="account-color-swatches" style={{ marginTop: '0.3rem' }}>
                      {ACCOUNT_COLOR_PALETTE.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          className={`account-color-swatch-btn ${
                            newAccColor.toLowerCase() === hex.toLowerCase() ? 'active' : ''
                          }`}
                          style={{ backgroundColor: hex }}
                          onClick={() => setNewAccColor(hex)}
                        />
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowNewAccForm(false)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Create Account
                    </button>
                  </div>
                </form>
              )}

              <div className="income-entries-list">
                {allAccounts.map((acc) => {
                  const isTracked = Boolean(acc.is_savings_or_brokerage);
                  return (
                    <div
                      key={acc.id}
                      className="income-entry-row"
                      style={{ borderLeft: `4px solid ${acc.color || '#06b6d4'}` }}
                    >
                      <div className="income-entry-meta">
                        <div className="request-badges">
                          <strong>{acc.name}</strong>
                          <span className="pill pill-outline" style={{ fontSize: '0.66rem' }}>
                            {acc.type} / {acc.subtype}
                          </span>
                          {isTracked && (
                            <span className="pill pill-green" style={{ fontSize: '0.66rem' }}>
                              Tracked as {acc.savings_bucket === 'brokerage' ? 'Brokerage' : 'Savings'}
                            </span>
                          )}
                        </div>
                        <small className="text-muted">
                          {acc.institution_name} • •••• {acc.mask || '0000'} • Balance:{' '}
                          <strong>{formatCurrency(acc.balance_current)}</strong>
                        </small>
                      </div>

                      <div className="topbar-right">
                        <button
                          type="button"
                          className={`btn btn-xs ${isTracked ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => handleToggleAccountSavingsTracking(acc, !isTracked)}
                        >
                          {isTracked ? 'Exclude from Savings View' : 'Include in Savings View'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

