import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Edit3,
  History,
  Link2,
  Menu,
  PieChart,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, getCookie, setCookie } from '../api';

const DEFAULT_CATEGORIES = [
  'Groceries & Dining',
  'Housing & Utilities',
  'Entertainment & Gaming',
  'Shopping & Tech',
  'Health & Medical',
  'Travel & Experiences',
  'Future Purchase Savings',
];

const SANDBOX_BANKS = [
  { id: 'ins_109508', name: 'First Platypus Bank (Plaid Sandbox)' },
  { id: 'ins_109509', name: 'First Gingham Credit Union (Plaid Sandbox)' },
  { id: 'ins_109510', name: 'Tartan Bank (Plaid Sandbox)' },
  { id: 'ins_109511', name: 'Houndstooth Bank (Plaid Sandbox)' },
];

const BUDGET_SORT_OPTIONS = [
  { id: 'spent_desc', label: 'Highest Spent ($)' },
  { id: 'utilization_desc', label: 'Highest % Used' },
  { id: 'remaining_desc', label: 'Most Remaining ($)' },
  { id: 'limit_desc', label: 'Highest Monthly Limit ($)' },
  { id: 'alpha_asc', label: 'Category Name (A–Z)' },
  { id: 'spent_asc', label: 'Lowest Spent ($)' },
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

function shiftMonthString(ym, delta) {
  if (!ym || ym.length < 7) return ym;
  const [y, m] = ym.split('-').map(Number);
  let total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

export default function FinanceModule({ activePartner, onDataChanged, syncVersion }) {
  const currentCalendarMonth = new Date().toISOString().slice(0, 7);

  // Persisted Month & Sub-View (Monthly vs Historical)
  const [selectedMonth, setSelectedMonthState] = useState(() =>
    getCookie('gibson_finance_month', currentCalendarMonth) || currentCalendarMonth
  );
  const [financeView, setFinanceViewState] = useState(() =>
    getCookie('gibson_finance_view', 'monthly') || 'monthly'
  );
  const [showAllMonthsInLedger, setShowAllMonthsInLedger] = useState(false);

  // Persisted Category Budget Sort Order (Cookie)
  const [budgetSortOrder, setBudgetSortOrderState] = useState(() =>
    getCookie('gibson_budget_sort', 'spent_desc') || 'spent_desc'
  );

  // Persisted Plaid Banking Panel Dismissal
  const [plaidPanelDismissed, setPlaidPanelDismissed] = useState(() =>
    getCookie('gibson_plaid_banner_dismissed', '0') === '1'
  );

  const setSelectedMonth = (ym) => {
    if (!ym) return;
    setSelectedMonthState(ym);
    setCookie('gibson_finance_month', ym, 365);
  };

  const setFinanceView = (view) => {
    setFinanceViewState(view);
    setCookie('gibson_finance_view', view, 365);
  };

  const handleSortOrderChange = (order) => {
    setBudgetSortOrderState(order);
    setCookie('gibson_budget_sort', order, 365);
  };

  const [summary, setSummary] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [plaidStatus, setPlaidStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [plaidBanner, setPlaidBanner] = useState(null);
  const [selectedSandboxBank, setSelectedSandboxBank] = useState(SANDBOX_BANKS[0].id);

  // Inline custom category editing on transaction rows
  const [customCatTxId, setCustomCatTxId] = useState(null);
  const [customCatInput, setCustomCatInput] = useState('');

  // Per-row Hamburger Menu state for Transaction Ledger
  const [openMenuTxId, setOpenMenuTxId] = useState(null);
  const menuContainerRef = useRef(null);

  // Forms
  const [showAddTx, setShowAddTx] = useState(false);
  const [txName, setTxName] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('Groceries & Dining');
  const [txCustomCategory, setTxCustomCategory] = useState('');
  const [txAccountId, setTxAccountId] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txMonthOffset, setTxMonthOffset] = useState('0');
  const [txNotes, setTxNotes] = useState('');

  // Per-Month Budget Modal / Editor
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCat, setBudgetCat] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('800');
  const [budgetScope, setBudgetScope] = useState('this_and_future');

  // Cancel / Remove Budget Category Confirmation Drawer
  const [cancellingBudget, setCancellingBudget] = useState(null);

  // Income & Fluctuation Tracker Form State
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [incSource, setIncSource] = useState('');
  const [incAmount, setIncAmount] = useState('');
  const [incExpected, setIncExpected] = useState('');
  const [incType, setIncType] = useState('paycheck');
  const [incDate, setIncDate] = useState(new Date().toISOString().slice(0, 10));
  const [incNotes, setIncNotes] = useState('');

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState('depository');
  const [accSubtype, setAccSubtype] = useState('checking');
  const [accBalance, setAccBalance] = useState('');
  const [accInstitution, setAccInstitution] = useState('');
  const [accMask, setAccMask] = useState('');

  const loadFinanceData = async (
    monthOverride = selectedMonth,
    allMonthsOverride = showAllMonthsInLedger,
    silent = false
  ) => {
    if (!silent) setLoading(true);
    try {
      const query = `?month=${encodeURIComponent(monthOverride)}${
        allMonthsOverride ? '&include_all_months=true' : ''
      }`;
      const [sumData, pStatus, hist] = await Promise.all([
        apiFetch(`/api/finance/summary${query}`),
        apiFetch('/api/finance/plaid/status'),
        apiFetch('/api/finance/history'),
      ]);
      setSummary(sumData);
      setPlaidStatus(pStatus);
      setHistoryData(hist);

      if (pStatus?.banner_dismissed && getCookie('gibson_plaid_banner_dismissed', '') === '') {
        setPlaidPanelDismissed(true);
        setCookie('gibson_plaid_banner_dismissed', '1', 365);
      }

      if (sumData.accounts?.length && !txAccountId) {
        setTxAccountId(String(sumData.accounts[0].id));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadFinanceData(selectedMonth, showAllMonthsInLedger, false);
  }, [selectedMonth, showAllMonthsInLedger]);

  // Real-time partner reactivity
  useEffect(() => {
    if (syncVersion > 1) {
      loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    }
  }, [syncVersion]);

  // Close row hamburger menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target)) {
        setOpenMenuTxId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Automatically resume Plaid OAuth redirect when returning from bank with ?oauth_state_id=
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.location.search.includes('oauth_state_id=') &&
      window.Plaid
    ) {
      const savedToken = localStorage.getItem('gibson_plaid_link_token');
      if (savedToken) {
        setPlaidBusy(true);
        const handler = window.Plaid.create({
          token: savedToken,
          receivedRedirectUri: window.location.href,
          onSuccess: async (public_token, metadata) => {
            localStorage.removeItem('gibson_plaid_link_token');
            window.history.replaceState({}, document.title, window.location.pathname);
            const instName = metadata?.institution?.name || 'Plaid Linked Bank';
            const exRes = await apiFetch('/api/finance/plaid/exchange_public_token', {
              method: 'POST',
              body: JSON.stringify({
                public_token,
                institution_name: instName,
                partner_id: activePartner?.id || 1,
              }),
            });
            setPlaidBanner({
              type: 'success',
              text: `Linked ${exRes.institution_name}! Synced ${exRes.imported_accounts} accounts and ${exRes.imported_transactions} transactions.`,
            });
            await loadFinanceData();
            onDataChanged?.();
            setPlaidBusy(false);
          },
          onExit: () => {
            window.history.replaceState({}, document.title, window.location.pathname);
            setPlaidBusy(false);
          },
        });
        handler.open();
      }
    }
  }, []);

  const handleToggleDismissPlaidPanel = async (dismiss) => {
    setPlaidPanelDismissed(dismiss);
    setCookie('gibson_plaid_banner_dismissed', dismiss ? '1' : '0', 365);
    try {
      await apiFetch('/api/finance/plaid/dismiss-banner', {
        method: 'POST',
        body: JSON.stringify({ dismissed: dismiss }),
      });
    } catch {
      // ignore
    }
  };

  const handleSandboxQuickConnect = async () => {
    setPlaidBusy(true);
    setPlaidBanner(null);
    try {
      const bank = SANDBOX_BANKS.find((b) => b.id === selectedSandboxBank) || SANDBOX_BANKS[0];
      const res = await apiFetch('/api/finance/plaid/sandbox_quick_connect', {
        method: 'POST',
        body: JSON.stringify({
          partner_id: activePartner?.id || 1,
          institution_id: bank.id,
          institution_name: bank.name,
        }),
      });
      setPlaidBanner({
        type: 'success',
        text: `Connected "${res.institution_name}" via Plaid! Imported ${res.imported_accounts} accounts and ${res.imported_transactions} transactions.`,
      });
      await loadFinanceData();
      onDataChanged?.();
    } catch (err) {
      setPlaidBanner({ type: 'error', text: err.message });
    } finally {
      setPlaidBusy(false);
    }
  };

  const handleOpenPlaidLinkUI = async () => {
    setPlaidBusy(true);
    setPlaidBanner(null);
    try {
      const tokenData = await apiFetch('/api/finance/plaid/create_link_token', {
        method: 'POST',
        body: JSON.stringify({ partner_id: activePartner?.id || 1 }),
      });

      if (window.Plaid && tokenData.link_token) {
        localStorage.setItem('gibson_plaid_link_token', tokenData.link_token);
        const handler = window.Plaid.create({
          token: tokenData.link_token,
          onSuccess: async (public_token, metadata) => {
            localStorage.removeItem('gibson_plaid_link_token');
            const instName = metadata?.institution?.name || 'Plaid Linked Bank';
            const exRes = await apiFetch('/api/finance/plaid/exchange_public_token', {
              method: 'POST',
              body: JSON.stringify({
                public_token,
                institution_name: instName,
                partner_id: activePartner?.id || 1,
              }),
            });
            setPlaidBanner({
              type: 'success',
              text: `Linked ${exRes.institution_name}! Synced ${exRes.imported_accounts} accounts and ${exRes.imported_transactions} transactions.`,
            });
            await loadFinanceData();
            onDataChanged?.();
            setPlaidBusy(false);
          },
          onExit: () => {
            setPlaidBusy(false);
          },
        });
        handler.open();
      } else {
        await handleSandboxQuickConnect();
      }
    } catch (err) {
      setPlaidBanner({ type: 'error', text: err.message });
      setPlaidBusy(false);
    }
  };

  const handleSyncPlaid = async () => {
    setPlaidBusy(true);
    setPlaidBanner(null);
    try {
      const res = await apiFetch('/api/finance/plaid/sync', { method: 'POST' });
      setPlaidBanner({
        type: 'success',
        text: `Synced ${res.updated_accounts} accounts and ${res.imported_transactions} transactions from Plaid.`,
      });
      await loadFinanceData();
    } catch (err) {
      setPlaidBanner({ type: 'error', text: err.message });
    } finally {
      setPlaidBusy(false);
    }
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!accName.trim()) return;
    await apiFetch('/api/finance/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: accName.trim(),
        type: accType,
        subtype: accSubtype,
        balance_current: parseFloat(accBalance || 0),
        institution_name: accInstitution.trim() || 'Manual Account',
        mask: accMask.trim() || '0000',
      }),
    });
    setAccName('');
    setAccBalance('');
    setAccInstitution('');
    setAccMask('');
    setShowAccountModal(false);
    await loadFinanceData();
  };

  const handleDeleteAccount = async (accId) => {
    await apiFetch(`/api/finance/accounts/${accId}`, { method: 'DELETE' });
    await loadFinanceData();
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    if (!txName || !txAmount) return;
    const chosenCategory =
      txCategory === '__custom__' ? txCustomCategory.trim() : txCategory;
    if (!chosenCategory) return;

    await apiFetch('/api/finance/transactions', {
      method: 'POST',
      body: JSON.stringify({
        account_id: txAccountId ? Number(txAccountId) : null,
        name: txName,
        amount: parseFloat(txAmount),
        category: chosenCategory,
        date: txDate,
        month_offset: parseInt(txMonthOffset, 10) || 0,
        partner_id: activePartner?.id || null,
        notes: txNotes,
      }),
    });
    setTxName('');
    setTxAmount('');
    setTxCustomCategory('');
    setTxMonthOffset('0');
    setTxNotes('');
    setShowAddTx(false);
    await loadFinanceData();
    onDataChanged?.();
  };

  const handleReassignCategory = async (txId, newCategory) => {
    if (newCategory === '__custom__') {
      setCustomCatTxId(txId);
      setCustomCatInput('');
      return;
    }
    await apiFetch(`/api/finance/transactions/${txId}`, {
      method: 'PUT',
      body: JSON.stringify({ category: newCategory }),
    });
    setCustomCatTxId(null);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleSaveCustomCategoryOnTx = async (txId) => {
    const trimmed = customCatInput.trim();
    if (!trimmed) return;
    await apiFetch(`/api/finance/transactions/${txId}`, {
      method: 'PUT',
      body: JSON.stringify({ category: trimmed }),
    });
    setCustomCatTxId(null);
    setCustomCatInput('');
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleAllocateMonth = async (txId, direction) => {
    await apiFetch(`/api/finance/transactions/${txId}`, {
      method: 'PUT',
      body: JSON.stringify({ allocate_direction: direction }),
    });
    setOpenMenuTxId(null);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleAllocateExactMonth = async (txId, targetYm) => {
    if (!targetYm) return;
    await apiFetch(`/api/finance/transactions/${txId}`, {
      method: 'PUT',
      body: JSON.stringify({ budget_month: targetYm }),
    });
    setOpenMenuTxId(null);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleOpenEditBudget = (b) => {
    setBudgetCat(b.category);
    setBudgetLimit(String(b.monthly_limit || 0));
    setBudgetScope('this_and_future');
    setShowBudgetModal(true);
  };

  const handleSaveBudget = async (e) => {
    e.preventDefault();
    if (!budgetCat.trim() || !budgetLimit) return;
    await apiFetch('/api/finance/budgets', {
      method: 'POST',
      body: JSON.stringify({
        category: budgetCat.trim(),
        monthly_limit: parseFloat(budgetLimit),
        budget_month: selectedMonth,
        apply_scope: budgetScope,
      }),
    });
    setBudgetCat('');
    setShowBudgetModal(false);
    await loadFinanceData();
  };

  const handleConfirmCancelBudget = async (budgetObj, scope) => {
    await apiFetch(
      `/api/finance/budgets/${budgetObj.id}?month=${encodeURIComponent(
        selectedMonth
      )}&category=${encodeURIComponent(budgetObj.category)}&apply_scope=${encodeURIComponent(scope)}`,
      { method: 'DELETE' }
    );
    setCancellingBudget(null);
    await loadFinanceData();
  };

  const handleDeleteTx = async (txId) => {
    setOpenMenuTxId(null);
    await apiFetch(`/api/finance/transactions/${txId}`, { method: 'DELETE' });
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleAddIncome = async (e) => {
    e.preventDefault();
    if (!incSource.trim() || !incAmount) return;
    const actualVal = parseFloat(incAmount);
    const expectedVal = incExpected !== '' ? parseFloat(incExpected) : actualVal;
    await apiFetch('/api/finance/income', {
      method: 'POST',
      body: JSON.stringify({
        partner_id: activePartner?.id || null,
        source_name: incSource.trim(),
        amount: actualVal,
        expected_monthly_amount: expectedVal,
        income_type: incType,
        date: incDate,
        budget_month: selectedMonth,
        notes: incNotes.trim(),
      }),
    });
    setIncSource('');
    setIncAmount('');
    setIncExpected('');
    setIncNotes('');
    setShowAddIncome(false);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, false);
    onDataChanged?.();
  };

  const handleDeleteIncome = async (incomeId) => {
    await apiFetch(`/api/finance/income/${incomeId}`, { method: 'DELETE' });
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  if (loading && !summary) {
    return <div className="card">Loading financial dashboard...</div>;
  }

  if (!summary) return null;

  const availableCategories = Array.from(
    new Set([
      ...(summary.all_categories || []),
      ...(summary.budgets || []).map((b) => b.category),
      ...DEFAULT_CATEGORIES,
    ])
  );

  // Sort Category Budgets according to user's persistent cookie setting
  const sortedBudgets = [...(summary.budgets || [])].sort((a, b) => {
    switch (budgetSortOrder) {
      case 'spent_desc':
        return b.spent - a.spent || b.monthly_limit - a.monthly_limit;
      case 'spent_asc':
        return a.spent - b.spent || a.category.localeCompare(b.category);
      case 'utilization_desc':
        return b.utilization_pct - a.utilization_pct || b.spent - a.spent;
      case 'remaining_desc':
        return b.remaining - a.remaining;
      case 'limit_desc':
        return b.monthly_limit - a.monthly_limit;
      case 'alpha_asc':
        return a.category.localeCompare(b.category);
      default:
        return 0;
    }
  });

  // Build quick-jump month ribbon (past 4 months + current + next month, merged with available_months)
  const ribbonMonths = Array.from(
    new Set([
      shiftMonthString(currentCalendarMonth, -3),
      shiftMonthString(currentCalendarMonth, -2),
      shiftMonthString(currentCalendarMonth, -1),
      currentCalendarMonth,
      shiftMonthString(currentCalendarMonth, 1),
      selectedMonth,
      ...(summary.available_months || []),
    ])
  ).sort();

  return (
    <div className="module-container">
      <div className="section-header-bar">
        <div>
          <h2>Family Finances, Monthly Budgets & Plaid Banking</h2>
          <p className="text-muted">
            Budgets are tracked per month starting on the <strong>1st of every month</strong>. Adjust or cancel subscriptions for specific months while keeping historical months intact.
          </p>
        </div>
        <div className="header-actions-group">
          {plaidPanelDismissed && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleToggleDismissPlaidPanel(false)}
              title="Show Plaid Banking Integration panel"
            >
              <Building2 size={15} /> Bank Connections ({plaidStatus?.linked_items?.length || 0})
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowAccountModal(!showAccountModal)}
          >
            <Wallet size={16} /> Add Account
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setBudgetCat('');
              setBudgetLimit('500');
              setBudgetScope('this_and_future');
              setShowBudgetModal(!showBudgetModal);
            }}
          >
            <PieChart size={16} /> Add / Adjust Month Budget
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => setShowAddIncome(!showAddIncome)}
          >
            <DollarSign size={16} /> Log Income
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddTx(!showAddTx)}
          >
            <Plus size={16} /> Log Expense
          </button>
        </div>
      </div>

      {/* Persistently Dismissible Plaid Banking Panel */}
      {!plaidPanelDismissed && (
        <div className="card plaid-connect-banner">
          <div className="plaid-info-left">
            <div className="plaid-icon-circle">
              <Building2 size={22} />
            </div>
            <div>
              <div className="request-badges">
                <strong>Plaid Banking Integration</strong>
                {plaidStatus?.configured ? (
                  <span className="pill pill-green">
                    <CheckCircle2 size={12} /> .env Credentials Loaded ({plaidStatus.environment})
                  </span>
                ) : (
                  <span className="pill pill-amber">Missing .env keys</span>
                )}
              </div>
              <p className="text-muted">
                Client ID: <code>{plaidStatus?.client_id_preview || 'Not set'}</code> •{' '}
                {plaidStatus?.linked_items?.length || 0} Plaid Institution(s) Linked
              </p>
            </div>
          </div>
          <div className="plaid-actions-right">
            {plaidStatus?.environment === 'sandbox' && (
              <>
                <select
                  className="input input-sm"
                  style={{ width: 'auto' }}
                  value={selectedSandboxBank}
                  onChange={(e) => setSelectedSandboxBank(e.target.value)}
                >
                  {SANDBOX_BANKS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  disabled={plaidBusy || !plaidStatus?.configured}
                  onClick={handleSandboxQuickConnect}
                >
                  <RefreshCw size={15} className={plaidBusy ? 'spin' : ''} />
                  {plaidBusy ? 'Connecting...' : 'Connect Sandbox Bank'}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={plaidBusy || !plaidStatus?.configured}
              onClick={handleOpenPlaidLinkUI}
            >
              <Link2 size={15} /> Connect Bank via Plaid Link
            </button>
            {plaidStatus?.linked_items?.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={plaidBusy}
                onClick={handleSyncPlaid}
              >
                <RefreshCw size={14} /> Re-Sync Accounts
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => handleToggleDismissPlaidPanel(true)}
              title="Dismiss banking panel (remains dismissed across refreshes)"
            >
              <X size={15} /> Dismiss
            </button>
          </div>
        </div>
      )}

      {plaidBanner && (
        <div className={`alert ${plaidBanner.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          {plaidBanner.text}
        </div>
      )}

      {/* Clear Month Navigation Ribbon & View Switcher (Monthly Budget vs Historical Overview) */}
      <div className="card month-navigation-card">
        <div className="month-selector-bar">
          <div className="month-selector-left">
            <Calendar size={22} className="text-cyan" />
            <div>
              <div className="request-badges">
                <strong style={{ fontSize: '1.05rem' }}>
                  {financeView === 'history'
                    ? 'Historical Months Comparison'
                    : `Budget Period: ${formatMonthLabel(selectedMonth)}`}
                </strong>
                {selectedMonth === currentCalendarMonth && financeView === 'monthly' && (
                  <span className="pill pill-cyan">Current Month</span>
                )}
                {selectedMonth < currentCalendarMonth && financeView === 'monthly' && (
                  <span className="pill pill-outline">Historical Month Snapshot</span>
                )}
                {selectedMonth > currentCalendarMonth && financeView === 'monthly' && (
                  <span className="pill pill-amber">Future Month Plan</span>
                )}
              </div>
              <span className="text-muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                {financeView === 'history'
                  ? 'Compare month-over-month spending, budget changes, and cancelled subscriptions across your history.'
                  : `Showing budgets configured for ${formatShortMonth(selectedMonth)} and purchases from ${selectedMonth}-01 to end of month.`}
              </span>
            </div>
          </div>

          <div className="month-selector-controls">
            <div className="view-mode-segmented">
              <button
                type="button"
                className={`segmented-btn ${financeView === 'monthly' ? 'active' : ''}`}
                onClick={() => setFinanceView('monthly')}
              >
                <Calendar size={14} /> Monthly Budget & Ledger
              </button>
              <button
                type="button"
                className={`segmented-btn ${financeView === 'history' ? 'active' : ''}`}
                onClick={() => setFinanceView('history')}
              >
                <History size={14} /> Historical Months View
              </button>
            </div>

            {financeView === 'monthly' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSelectedMonth(summary.previous_month)}
                  title={`Go to ${formatMonthLabel(summary.previous_month)}`}
                >
                  <ChevronLeft size={16} /> {formatShortMonth(summary.previous_month)}
                </button>

                <input
                  type="month"
                  className="input input-sm month-picker-input"
                  value={selectedMonth}
                  onChange={(e) => {
                    if (e.target.value) setSelectedMonth(e.target.value);
                  }}
                />

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSelectedMonth(summary.next_month)}
                  title={`Go to ${formatMonthLabel(summary.next_month)}`}
                >
                  {formatShortMonth(summary.next_month)} <ChevronRight size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Clickable Month Pills Ribbon */}
        <div className="month-ribbon-pills">
          {ribbonMonths.map((ym) => {
            const isSelected = ym === selectedMonth && financeView === 'monthly';
            const isCurrent = ym === currentCalendarMonth;
            return (
              <button
                key={ym}
                type="button"
                className={`month-ribbon-pill ${isSelected ? 'active' : ''} ${
                  isCurrent ? 'current-calendar' : ''
                }`}
                onClick={() => {
                  setSelectedMonth(ym);
                  setFinanceView('monthly');
                }}
              >
                <span>{formatShortMonth(ym)}</span>
                {isCurrent && <small className="month-now-dot" title="Current Month" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Financial KPI Cards */}
      <div className="kpi-grid-4">
        <div className="kpi-card">
          <span className="kpi-label">Total Cash & Savings</span>
          <strong className="kpi-value text-green">
            ${summary.net_cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
          <small className="kpi-sub">Checking + Savings Accounts</small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">{formatShortMonth(selectedMonth)} Income</span>
          <strong className="kpi-value text-green">
            ${Number(summary.total_monthly_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
          <small className="kpi-sub">
            {summary.income_fluctuation_vs_prev !== 0 ? (
              <span className={summary.income_fluctuation_vs_prev >= 0 ? 'text-green' : 'text-amber'}>
                {summary.income_fluctuation_vs_prev >= 0 ? '+' : '-'}$
                {Math.abs(Number(summary.income_fluctuation_vs_prev || 0)).toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                })}{' '}
                vs {formatShortMonth(summary.previous_month)}
              </span>
            ) : (
              `Expected: $${Number(summary.expected_monthly_income || 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
            )}
          </small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">{formatShortMonth(selectedMonth)} Spending</span>
          <strong className="kpi-value">
            ${summary.total_monthly_spent.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
          <small className="kpi-sub">
            of ${summary.total_monthly_budget.toLocaleString('en-US', { minimumFractionDigits: 0 })} budget ({summary.month_transaction_count} tx)
          </small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">{formatShortMonth(selectedMonth)} Net Cash Flow</span>
          <strong
            className={`kpi-value ${
              Number(summary.net_monthly_cashflow || 0) >= 0 ? 'text-cyan' : 'text-amber'
            }`}
          >
            {Number(summary.net_monthly_cashflow || 0) >= 0 ? '+' : '-'}$
            {Math.abs(Number(summary.net_monthly_cashflow || 0)).toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}
          </strong>
          <small className="kpi-sub">
            Income minus {formatShortMonth(selectedMonth)} spending
          </small>
        </div>
      </div>

      {showAddIncome && (
        <form className="card form-card" onSubmit={handleAddIncome}>
          <h3>Log Income or Paycheck for {formatMonthLabel(selectedMonth)}</h3>
          <p className="text-muted">
            Track fixed paychecks, variable/commission income, bonuses, or side income to monitor month-over-month income fluctuations.
          </p>
          <div className="form-grid-4">
            <div className="form-group">
              <label>Income Source / Employer *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Primary Paycheck, Freelance, Bonus"
                value={incSource}
                onChange={(e) => setIncSource(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Actual Amount Received ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                placeholder="3250.00"
                value={incAmount}
                onChange={(e) => setIncAmount(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Expected / Baseline Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                placeholder="Defaults to actual if blank"
                value={incExpected}
                onChange={(e) => setIncExpected(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Income Type</label>
              <select
                className="input"
                value={incType}
                onChange={(e) => setIncType(e.target.value)}
              >
                <option value="paycheck">Regular Paycheck / Salary</option>
                <option value="variable">Variable / Commission / Hourly</option>
                <option value="bonus">Bonus / Commission Payout</option>
                <option value="side_income">Side Income / Freelance</option>
                <option value="other">Other Deposit / Reimbursement</option>
              </select>
            </div>
          </div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Deposit Date</label>
              <input
                type="date"
                className="input"
                value={incDate}
                onChange={(e) => setIncDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Notes (Optional)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Includes overtime / Q4 commission"
                value={incNotes}
                onChange={(e) => setIncNotes(e.target.value)}
              />
            </div>
            <div className="form-group form-group-end">
              <button type="submit" className="btn btn-primary">
                Save Income to {formatShortMonth(selectedMonth)}
              </button>
            </div>
          </div>
        </form>
      )}

      {showAccountModal && (
        <form className="card form-card" onSubmit={handleCreateAccount}>
          <h3>Add a Manual Bank or Credit Card Account</h3>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Account Name *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Joint Checking"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Account Type</label>
              <select
                className="input"
                value={accType}
                onChange={(e) => {
                  setAccType(e.target.value);
                  setAccSubtype(e.target.value === 'credit' ? 'credit card' : 'checking');
                }}
              >
                <option value="depository">Depository (Checking / Savings)</option>
                <option value="credit">Credit Card</option>
              </select>
            </div>
            <div className="form-group">
              <label>Current Balance ($) *</label>
              <input
                type="number"
                step="0.01"
                className="input"
                placeholder="2500.00"
                value={accBalance}
                onChange={(e) => setAccBalance(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Institution Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Chase, Ally"
                value={accInstitution}
                onChange={(e) => setAccInstitution(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Last 4 Digits (Mask)</label>
              <input
                type="text"
                maxLength={4}
                className="input"
                placeholder="1234"
                value={accMask}
                onChange={(e) => setAccMask(e.target.value)}
              />
            </div>
            <div className="form-group form-group-end">
              <button type="submit" className="btn btn-primary">
                Save Account
              </button>
            </div>
          </div>
        </form>
      )}

      {showBudgetModal && (
        <form className="card form-card" onSubmit={handleSaveBudget}>
          <h3>
            Add or Adjust Category Budget for {formatMonthLabel(selectedMonth)}
          </h3>
          <p className="text-muted">
            Choose whether this budget change applies only to <strong>{formatMonthLabel(selectedMonth)}</strong> or from <strong>{formatShortMonth(selectedMonth)} forward</strong>. Previous historical months are never overwritten.
          </p>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Category Name (Custom or Standard) *</label>
              <input
                type="text"
                className="input"
                list="budget-category-suggestions"
                value={budgetCat}
                onChange={(e) => setBudgetCat(e.target.value)}
                placeholder="e.g., Netflix, Pet Care, Groceries & Dining"
                required
              />
              <datalist id="budget-category-suggestions">
                {availableCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label>Monthly Limit ($) *</label>
              <input
                type="number"
                step="5"
                min="0"
                className="input"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Apply Budget Change To</label>
              <select
                className="input"
                value={budgetScope}
                onChange={(e) => setBudgetScope(e.target.value)}
              >
                <option value="this_and_future">
                  {formatShortMonth(selectedMonth)} & Future Months (Keep Prior History)
                </option>
                <option value="only_this_month">
                  Only {formatMonthLabel(selectedMonth)} (One-Month Adjustment)
                </option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowBudgetModal(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Budget for {formatShortMonth(selectedMonth)}
            </button>
          </div>
        </form>
      )}

      {showAddTx && (
        <form className="card form-card" onSubmit={handleAddTransaction}>
          <h3>Log a Shared or Individual Expense</h3>
          <div className="form-grid-4">
            <div className="form-group">
              <label>Description / Merchant *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., Whole Foods Market"
                value={txName}
                onChange={(e) => setTxName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Amount ($) *</label>
              <input
                type="number"
                step="0.01"
                className="input"
                placeholder="84.50"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select
                className="input"
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
              >
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="__custom__">+ Enter Custom Category...</option>
              </select>
            </div>
            <div className="form-group">
              <label>Purchase Date</label>
              <input
                type="date"
                className="input"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
              />
            </div>
          </div>

          <div className="form-grid-3">
            {txCategory === '__custom__' && (
              <div className="form-group">
                <label>Custom Category Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Pet Care, Home Decor"
                  value={txCustomCategory}
                  onChange={(e) => setTxCustomCategory(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="form-group">
              <label>Allocate to Budget Month</label>
              <select
                className="input"
                value={txMonthOffset}
                onChange={(e) => setTxMonthOffset(e.target.value)}
              >
                <option value="0">Purchase Date's Month ({txDate.slice(0, 7)})</option>
                <option value="-1">Allocate to Previous Month</option>
                <option value="1">Allocate to Next Month</option>
              </select>
            </div>
            <div className="form-group">
              <label>Notes (Optional)</label>
              <input
                type="text"
                className="input"
                placeholder="Optional note..."
                value={txNotes}
                onChange={(e) => setTxNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Add Transaction
            </button>
          </div>
        </form>
      )}

      {/* HISTORICAL MONTHS VIEW */}
      {financeView === 'history' ? (
        <div className="card">
          <div className="plan-card-header" style={{ marginBottom: '1rem' }}>
            <div>
              <h3>Historical Months Budget & Spending Archive</h3>
              <p className="text-muted">
                Review how your household performed each month. Categories that were later adjusted or cancelled (such as seasonal subscriptions) remain preserved in their historical months.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setFinanceView('monthly')}
            >
              <Calendar size={14} /> Return to {formatShortMonth(selectedMonth)} Detail View
            </button>
          </div>

          {!historyData?.history?.length ? (
            <div className="empty-state-box">
              <p className="text-muted">No monthly history recorded yet.</p>
            </div>
          ) : (
            <div className="history-months-grid">
              {historyData.history.map((mItem) => {
                const isOver = mItem.total_spent > mItem.total_budget && mItem.total_budget > 0;
                const isCurrent = mItem.budget_month === currentCalendarMonth;
                return (
                  <div
                    key={mItem.budget_month}
                    className={`card history-month-card ${
                      mItem.budget_month === selectedMonth ? 'selected-month-card' : ''
                    }`}
                  >
                    <div className="plan-card-header">
                      <div>
                        <div className="request-badges">
                          {isCurrent && <span className="pill pill-cyan">Current Month</span>}
                          {mItem.budget_month < currentCalendarMonth && (
                            <span className="pill pill-outline">Past Month</span>
                          )}
                          {mItem.budget_month > currentCalendarMonth && (
                            <span className="pill pill-amber">Planned Month</span>
                          )}
                          <span className="pill pill-outline">
                            {mItem.transaction_count} transactions
                          </span>
                        </div>
                        <h3 style={{ marginTop: '0.25rem' }}>
                          {formatMonthLabel(mItem.budget_month)}
                        </h3>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setSelectedMonth(mItem.budget_month);
                          setFinanceView('monthly');
                        }}
                      >
                        Open Month
                      </button>
                    </div>

                    <div className="plan-numbers-row">
                      <div>
                        <span className="text-muted">Month Income</span>
                        <strong className="text-green">
                          ${Number(mItem.total_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </strong>
                        {mItem.income_fluctuation_delta !== 0 && (
                          <small
                            style={{ display: 'block', fontSize: '0.72rem' }}
                            className={mItem.income_fluctuation_delta >= 0 ? 'text-green' : 'text-amber'}
                          >
                            {mItem.income_fluctuation_delta >= 0 ? '+' : '-'}$
                            {Math.abs(Number(mItem.income_fluctuation_delta || 0)).toFixed(0)} vs prior mo
                          </small>
                        )}
                      </div>
                      <div>
                        <span className="text-muted">Total Spent</span>
                        <strong className={isOver ? 'text-danger' : 'text-green'}>
                          ${Number(mItem.total_spent).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div>
                        <span className="text-muted">Month Budget</span>
                        <strong>
                          ${Number(mItem.total_budget).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                        </strong>
                      </div>
                      <div>
                        <span className="text-muted">Net Cash Flow</span>
                        <strong className={(mItem.net_cashflow || 0) >= 0 ? 'text-cyan' : 'text-danger'}>
                          {(mItem.net_cashflow || 0) >= 0 ? '+' : '-'}$
                          {Math.abs(Number(mItem.net_cashflow || 0)).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                          })}
                        </strong>
                      </div>
                    </div>

                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, mItem.utilization_pct || 0)}%`,
                          background: isOver ? '#ef4444' : undefined,
                        }}
                      />
                    </div>

                    <div className="history-cat-breakdown">
                      {(mItem.categories || []).slice(0, 6).map((c) => (
                        <div key={c.category} className="history-cat-row">
                          <span>
                            {c.category}
                            {!c.is_active && (
                              <small className="text-muted"> (Cancelled/Inactive)</small>
                            )}
                          </span>
                          <span className="font-mono">
                            <strong>${Number(c.spent).toFixed(0)}</strong> / $
                            {Number(c.monthly_limit).toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Monthly Income & Fluctuations Tracker Card */}
          <div className="card income-fluctuation-card">
            <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
              <div>
                <h3>{formatMonthLabel(selectedMonth)} Income & Fluctuation Tracker</h3>
                <small className="text-muted">
                  Track paychecks, variable income, and month-over-month income fluctuations alongside your {formatShortMonth(selectedMonth)} budget.
                </small>
              </div>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={() => setShowAddIncome(!showAddIncome)}
              >
                <Plus size={14} /> {showAddIncome ? 'Close Income Form' : 'Log Income / Paycheck'}
              </button>
            </div>

            <div className="income-metrics-strip">
              <div className="income-metric-box">
                <span className="text-muted">Actual {formatShortMonth(selectedMonth)} Income</span>
                <strong className="text-green">
                  ${Number(summary.total_monthly_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </strong>
                <small className="text-muted">
                  Expected baseline: ${Number(summary.expected_monthly_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </small>
              </div>

              <div className="income-metric-box">
                <span className="text-muted">Fluctuation vs. {formatShortMonth(summary.previous_month)}</span>
                <strong
                  className={
                    Number(summary.income_fluctuation_vs_prev || 0) >= 0 ? 'text-green' : 'text-amber'
                  }
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  {Number(summary.income_fluctuation_vs_prev || 0) >= 0 ? (
                    <TrendingUp size={16} />
                  ) : (
                    <TrendingDown size={16} />
                  )}
                  {Number(summary.income_fluctuation_vs_prev || 0) >= 0 ? '+' : '-'}$
                  {Math.abs(Number(summary.income_fluctuation_vs_prev || 0)).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                  {summary.income_fluctuation_vs_prev_pct !== null &&
                    summary.income_fluctuation_vs_prev_pct !== undefined && (
                      <small>
                        ({summary.income_fluctuation_vs_prev_pct >= 0 ? '+' : ''}
                        {summary.income_fluctuation_vs_prev_pct}%)
                      </small>
                    )}
                </strong>
                <small className="text-muted">
                  Prior month: ${Number(summary.previous_month_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </small>
              </div>

              <div className="income-metric-box">
                <span className="text-muted">Actual vs. Expected Baseline</span>
                <strong
                  className={
                    Number(summary.income_fluctuation_vs_expected || 0) >= 0 ? 'text-cyan' : 'text-amber'
                  }
                >
                  {Number(summary.income_fluctuation_vs_expected || 0) >= 0 ? '+' : '-'}$
                  {Math.abs(Number(summary.income_fluctuation_vs_expected || 0)).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </strong>
                <small className="text-muted">
                  Multi-month avg: ${Number(summary.average_monthly_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </small>
              </div>

              <div className="income-metric-box">
                <span className="text-muted">Unallocated Income (After Budget)</span>
                <strong
                  className={
                    Number(summary.unallocated_income || 0) >= 0 ? 'text-green' : 'text-amber'
                  }
                >
                  {Number(summary.unallocated_income || 0) >= 0 ? '+' : '-'}$
                  {Math.abs(Number(summary.unallocated_income || 0)).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </strong>
                <small className="text-muted">
                  Income minus ${Number(summary.total_monthly_budget || 0).toFixed(0)} budgeted
                </small>
              </div>
            </div>

            {(summary.income_entries || []).length > 0 && (
              <div className="income-entries-list">
                {summary.income_entries.map((inc) => {
                  const diff = Number(inc.amount || 0) - Number(inc.expected_monthly_amount || inc.amount || 0);
                  return (
                    <div key={inc.id} className="income-entry-row">
                      <div className="income-entry-left">
                        <div className="request-badges">
                          <strong>{inc.source_name}</strong>
                          <span className="pill pill-outline">{inc.income_type}</span>
                          {inc.partner_name && (
                            <span className="pill pill-cyan">{inc.partner_name}</span>
                          )}
                        </div>
                        <small className="text-muted">
                          {inc.date}
                          {inc.notes ? ` • ${inc.notes}` : ''}
                        </small>
                      </div>
                      <div className="income-entry-right">
                        <div style={{ textAlign: 'right' }}>
                          <strong className="text-green font-mono">
                            +${Number(inc.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </strong>
                          {Math.abs(diff) >= 0.01 && (
                            <small
                              style={{ display: 'block', fontSize: '0.72rem' }}
                              className={diff >= 0 ? 'text-cyan' : 'text-amber'}
                            >
                              {diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(2)} vs expected ($
                              {Number(inc.expected_monthly_amount).toFixed(0)})
                            </small>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn-icon-danger"
                          onClick={() => handleDeleteIncome(inc.id)}
                          title="Delete income entry"
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

          <div className="finance-two-col">
            {/* Monthly Category Budgets with Persistent Sort Order & Per-Month Scope */}
            <div className="card">
              <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
                <div>
                  <h3>{formatMonthLabel(selectedMonth)} Category Budgets</h3>
                  <small className="text-muted">
                    Adjust or cancel categories for {formatShortMonth(selectedMonth)} without altering prior months
                  </small>
                </div>
                <div className="topbar-right">
                  <div className="budget-sort-box" title="Sort order is saved in your browser cookie">
                    <ArrowUpDown size={13} className="text-muted" />
                    <select
                      className="input input-sm budget-sort-select"
                      value={budgetSortOrder}
                      onChange={(e) => handleSortOrderChange(e.target.value)}
                      aria-label="Sort Category Budgets"
                    >
                      {BUDGET_SORT_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          Sort: {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setBudgetCat('');
                      setBudgetLimit('500');
                      setBudgetScope('this_and_future');
                      setShowBudgetModal(true);
                    }}
                  >
                    <Plus size={14} /> Add Category
                  </button>
                </div>
              </div>

              {cancellingBudget && (
                <div className="budget-cancel-drawer">
                  <strong>
                    Cancel / Remove "{cancellingBudget.category}" from Budgets?
                  </strong>
                  <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                    For example, if you cancelled a subscription like Netflix starting in{' '}
                    <strong>{formatMonthLabel(selectedMonth)}</strong>, removing it for this & future months keeps it in all earlier months.
                  </p>
                  <div className="topbar-right">
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={() =>
                        handleConfirmCancelBudget(cancellingBudget, 'this_and_future')
                      }
                    >
                      Remove for {formatShortMonth(selectedMonth)} & Future Months
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() =>
                        handleConfirmCancelBudget(cancellingBudget, 'only_this_month')
                      }
                    >
                      Remove Only for {formatShortMonth(selectedMonth)}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setCancellingBudget(null)}
                    >
                      Keep Category
                    </button>
                  </div>
                </div>
              )}

              {sortedBudgets.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">
                    No monthly budgets active for <strong>{formatMonthLabel(selectedMonth)}</strong>. Click <strong>Add Category</strong> to set a budget limit.
                  </p>
                </div>
              ) : (
                <div className="budgets-stack">
                  {sortedBudgets.map((b) => {
                    const over = b.spent > b.monthly_limit && b.monthly_limit > 0;
                    return (
                      <div key={b.id || b.category} className="budget-row-item">
                        <div className="budget-row-top">
                          <div>
                            <strong>{b.category}</strong>
                            {!b.is_active && (
                              <span
                                className="pill pill-outline"
                                style={{ marginLeft: '0.4rem', fontSize: '0.68rem' }}
                              >
                                Cancelled / Activity Only
                              </span>
                            )}
                          </div>
                          <div className="topbar-right">
                            <span>
                              <strong>${b.spent.toFixed(2)}</strong> / ${b.monthly_limit.toFixed(0)} (
                              {b.utilization_pct}%)
                            </span>
                            <button
                              type="button"
                              className="btn-icon-subtle"
                              onClick={() => handleOpenEditBudget(b)}
                              title={`Adjust ${b.category} limit for ${formatShortMonth(selectedMonth)}`}
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon-danger"
                              onClick={() => setCancellingBudget(b)}
                              title={`Cancel or remove ${b.category} for ${formatShortMonth(selectedMonth)}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="progress-track">
                          <div
                            className={`progress-fill ${over ? 'fill-danger' : ''}`}
                            style={{
                              width: `${Math.min(100, b.utilization_pct)}%`,
                              background: over ? '#ef4444' : b.color,
                            }}
                          />
                        </div>
                        <small className="text-muted">
                          {over
                            ? `Over budget by $${Math.abs(b.remaining).toFixed(2)} in ${formatShortMonth(selectedMonth)}`
                            : `$${b.remaining.toFixed(2)} remaining for ${formatShortMonth(selectedMonth)}`}
                        </small>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Connected Bank Accounts */}
            <div className="card">
              <div className="plan-card-header">
                <h3>Accounts & Balances</h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAccountModal(true)}
                >
                  <Plus size={14} /> Add Account
                </button>
              </div>
              {summary.accounts.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">
                    No bank accounts linked yet. Connect a bank using <strong>Plaid</strong> or click <strong>Add Account</strong>.
                  </p>
                </div>
              ) : (
                <div className="accounts-stack">
                  {summary.accounts.map((acc) => (
                    <div key={acc.id} className="account-row-item">
                      <div className="account-meta">
                        {acc.type === 'credit' ? <CreditCard size={20} /> : <Wallet size={20} />}
                        <div>
                          <strong>{acc.name}</strong>
                          <small>
                            {acc.institution_name} •••• {acc.mask} ({acc.subtype})
                          </small>
                        </div>
                      </div>
                      <div className="topbar-right">
                        <div className="account-bal">
                          <strong>
                            ${Number(acc.balance_current).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </strong>
                          <small className="text-muted">{acc.owner_scope.toUpperCase()}</small>
                        </div>
                        <button
                          type="button"
                          className="btn-icon-danger"
                          onClick={() => handleDeleteAccount(acc.id)}
                          title="Remove account"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Transactions Ledger with Clean Hamburger Menu for Month Allocation */}
          <div className="card">
            <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3>
                  Transactions Ledger —{' '}
                  {showAllMonthsInLedger
                    ? `All Months (${summary.total_transaction_count})`
                    : `${formatMonthLabel(selectedMonth)} (${summary.month_transaction_count})`}
                </h3>
                <small className="text-muted">
                  Reassign any purchase category inline, or open the row <strong>☰ Menu</strong> to allocate a purchase to a different budget month.
                </small>
              </div>
              <div className="topbar-right">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAllMonthsInLedger(!showAllMonthsInLedger)}
                >
                  {showAllMonthsInLedger
                    ? `Filter by ${formatShortMonth(selectedMonth)} Only`
                    : `Show All Months (${summary.total_transaction_count})`}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowAddTx(true)}
                >
                  <Plus size={14} /> Log Expense
                </button>
              </div>
            </div>

            {summary.transactions.length === 0 ? (
              <div className="empty-state-box">
                <p className="text-muted">
                  No transactions allocated to <strong>{formatMonthLabel(selectedMonth)}</strong>. Switch months above, click <strong>Show All Months</strong>, or log a new expense.
                </p>
              </div>
            ) : (
              <div className="tx-table-wrapper" ref={menuContainerRef}>
                <table className="tx-table">
                  <thead>
                    <tr>
                      <th>Purchase Date</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right" style={{ width: '56px' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.transactions.map((tx) => {
                      const isShifted =
                        tx.budget_month &&
                        tx.original_date_month &&
                        tx.budget_month !== tx.original_date_month;
                      const isEditingCustomCat = customCatTxId === tx.id;
                      const isMenuOpen = openMenuTxId === tx.id;

                      return (
                        <tr key={tx.id} className="tx-row">
                          <td className="tx-cell-date">
                            <span className="tx-date-text">{tx.date}</span>
                            {(isShifted || showAllMonthsInLedger) && (
                              <span
                                className={`pill ${isShifted ? 'pill-cyan' : 'pill-outline'}`}
                                style={{ fontSize: '0.68rem', marginTop: '0.2rem' }}
                                title={
                                  isShifted
                                    ? `Allocated to ${formatMonthLabel(tx.budget_month)} (purchased ${tx.date})`
                                    : `Budget month: ${formatMonthLabel(tx.budget_month)}`
                                }
                              >
                                Budget: {formatShortMonth(tx.budget_month)}
                              </span>
                            )}
                          </td>
                          <td className="tx-cell-desc">
                            <strong>{tx.name}</strong>
                            {tx.notes && <small className="tx-note"> — {tx.notes}</small>}
                          </td>

                          {/* Reassignable Category Column */}
                          <td className="tx-cell-cat">
                            {isEditingCustomCat ? (
                              <div className="inline-custom-cat-box">
                                <input
                                  type="text"
                                  className="input input-sm"
                                  placeholder="Type custom category..."
                                  value={customCatInput}
                                  onChange={(e) => setCustomCatInput(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveCustomCategoryOnTx(tx.id);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleSaveCustomCategoryOnTx(tx.id)}
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setCustomCatTxId(null)}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <select
                                className="input input-sm tx-cat-select"
                                value={tx.category}
                                onChange={(e) => handleReassignCategory(tx.id, e.target.value)}
                              >
                                {availableCategories.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                                <option value="__custom__">+ Custom Category...</option>
                              </select>
                            )}
                          </td>

                          <td className="text-right font-mono tx-cell-amount">
                            ${Number(tx.amount).toFixed(2)}
                          </td>

                          {/* Hamburger Menu for Budget Month Allocation & Row Actions */}
                          <td className="text-right tx-hamburger-cell">
                            <button
                              type="button"
                              className={`btn btn-secondary btn-xs tx-hamburger-btn ${
                                isMenuOpen ? 'active' : ''
                              }`}
                              onClick={() =>
                                setOpenMenuTxId(isMenuOpen ? null : tx.id)
                              }
                              title="Budget month allocation & transaction options"
                              aria-label="Transaction options menu"
                            >
                              <Menu size={15} />
                            </button>

                            {isMenuOpen && (
                              <>
                                <div
                                  className="tx-popover-backdrop"
                                  onClick={() => setOpenMenuTxId(null)}
                                />
                                <div className="tx-hamburger-popover">
                                  <div className="tx-popover-header">
                                    <div>
                                      <span style={{ display: 'block' }}>{tx.name}</span>
                                      <small>
                                        Allocated to:{' '}
                                        <strong className="text-cyan">
                                          {formatMonthLabel(tx.budget_month)}
                                        </strong>
                                      </small>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn-icon-subtle"
                                      onClick={() => setOpenMenuTxId(null)}
                                      aria-label="Close menu"
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>

                                  <button
                                    type="button"
                                    className="tx-popover-item"
                                    onClick={() => handleAllocateMonth(tx.id, 'prev')}
                                  >
                                    <ChevronLeft size={14} />
                                    Allocate to Previous Month ({formatShortMonth(tx.previous_budget_month)})
                                  </button>

                                  <button
                                    type="button"
                                    className="tx-popover-item"
                                    onClick={() => handleAllocateMonth(tx.id, 'next')}
                                  >
                                    <ChevronRight size={14} />
                                    Allocate to Next Month ({formatShortMonth(tx.next_budget_month)})
                                  </button>

                                  <div className="tx-popover-month-picker">
                                    <label>Reassign to Specific Month:</label>
                                    <input
                                      type="month"
                                      className="input input-sm"
                                      value={tx.budget_month}
                                      onChange={(e) =>
                                        handleAllocateExactMonth(tx.id, e.target.value)
                                      }
                                    />
                                  </div>

                                  {isShifted && (
                                    <button
                                      type="button"
                                      className="tx-popover-item"
                                      onClick={() => handleAllocateMonth(tx.id, 'reset')}
                                    >
                                      <RotateCcw size={13} />
                                      Reset to Original Month ({formatShortMonth(tx.original_date_month)})
                                    </button>
                                  )}

                                  <div className="tx-popover-divider" />

                                  <button
                                    type="button"
                                    className="tx-popover-item tx-popover-danger"
                                    onClick={() => handleDeleteTx(tx.id)}
                                  >
                                    <Trash2 size={14} />
                                    Delete Transaction
                                  </button>
                                </div>
                              </>
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
        </>
      )}
    </div>
  );
}
