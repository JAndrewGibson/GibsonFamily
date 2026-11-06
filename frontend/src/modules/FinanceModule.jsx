import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
  SlidersHorizontal,
  Tags,
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

const CHART_VIEWS = [
  { id: 'income_vs_expenses', label: 'Income vs. Expenses' },
  { id: 'spending_pie', label: 'Spending Pie' },
  { id: 'budget_bars', label: 'Budget Utilization' },
  { id: 'cashflow_trend', label: 'Cash Flow Trend' },
];

const PIE_PALETTE = [
  '#6366f1',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#a855f7',
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

  // Persisted Month & Chart Selection
  const [selectedMonth, setSelectedMonthState] = useState(() =>
    getCookie('gibson_finance_month', currentCalendarMonth) || currentCalendarMonth
  );
  const [showAllMonthsInLedger, setShowAllMonthsInLedger] = useState(false);

  // Persisted Category Budget Sort Order (Cookie)
  const [budgetSortOrder, setBudgetSortOrderState] = useState(() =>
    getCookie('gibson_budget_sort', 'spent_desc') || 'spent_desc'
  );

  // Persisted Graph Visualization Choice (Cookie)
  const [activeChart, setActiveChartState] = useState(() =>
    getCookie('gibson_finance_chart', 'income_vs_expenses') || 'income_vs_expenses'
  );

  const setSelectedMonth = (ym) => {
    if (!ym) return;
    setSelectedMonthState(ym);
    setCookie('gibson_finance_month', ym, 365);
  };

  const handleSortOrderChange = (order) => {
    setBudgetSortOrderState(order);
    setCookie('gibson_budget_sort', order, 365);
  };

  const handleSelectChart = (chartId) => {
    setActiveChartState(chartId);
    setCookie('gibson_finance_chart', chartId, 365);
  };

  const [summary, setSummary] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [plaidStatus, setPlaidStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [plaidBanner, setPlaidBanner] = useState(null);
  const [selectedSandboxBank, setSelectedSandboxBank] = useState(SANDBOX_BANKS[0].id);

  // Top "Options" Menu & Spawnable Floating Modals
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [showPlaidModal, setShowPlaidModal] = useState(false);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);

  const optionsMenuRef = useRef(null);
  const categoryManagerRef = useRef(null);
  const [highlightCatManager, setHighlightCatManager] = useState(false);

  // Inline custom category editing on transaction rows
  const [customCatTxId, setCustomCatTxId] = useState(null);
  const [customCatInput, setCustomCatInput] = useState('');

  // Per-row Hamburger Menu state for Transaction Ledger
  const [openMenuTxId, setOpenMenuTxId] = useState(null);
  const menuContainerRef = useRef(null);

  // Log Expense Floating Modal State
  const [showAddTx, setShowAddTx] = useState(false);
  const [txName, setTxName] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('Groceries & Dining');
  const [txCustomCategory, setTxCustomCategory] = useState('');
  const [txAccountId, setTxAccountId] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txMonthOffset, setTxMonthOffset] = useState('0');
  const [txNotes, setTxNotes] = useState('');

  // Add / Adjust Month Budget Floating Modal State
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCat, setBudgetCat] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('800');
  const [budgetScope, setBudgetScope] = useState('this_and_future');

  // Cancel / Remove Budget Category Confirmation Drawer
  const [cancellingBudget, setCancellingBudget] = useState(null);

  // Category Manager In-Page Panel State (scrolls into view when clicked)
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [catFilter, setCatFilter] = useState('all');
  const [newCatName, setNewCatName] = useState('');
  const [newCatLimit, setNewCatLimit] = useState('');
  const [renamingCatName, setRenamingCatName] = useState(null);
  const [renameCatTarget, setRenameCatTarget] = useState('');
  const [deletingCatObj, setDeletingCatObj] = useState(null);
  const [reassignCatTarget, setReassignCatTarget] = useState('');

  // Income & Fluctuation Tracker Form & Collapsible Entries State
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [incomeEntriesExpanded, setIncomeEntriesExpanded] = useState(
    () => getCookie('gibson_income_entries_open', '0') === '1'
  );
  const toggleIncomeEntriesExpanded = () => {
    const next = !incomeEntriesExpanded;
    setIncomeEntriesExpanded(next);
    setCookie('gibson_income_entries_open', next ? '1' : '0', 365);
  };
  const [incSource, setIncSource] = useState('');
  const [incAmount, setIncAmount] = useState('');
  const [incExpected, setIncExpected] = useState('');
  const [incType, setIncType] = useState('paycheck');
  const [incDate, setIncDate] = useState(new Date().toISOString().slice(0, 10));
  const [incNotes, setIncNotes] = useState('');

  // Manual Account Form State (inside Accounts & Balances Modal)
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

  // Close row hamburger menu & top options menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target)) {
        setOpenMenuTxId(null);
      }
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target)) {
        setShowOptionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Helper to open the Category Manager panel and smoothly scroll right to it
  const handleOpenAndScrollToCategoryManager = (filterOverride = null) => {
    setShowOptionsMenu(false);
    if (filterOverride) {
      setCatFilter(filterOverride);
    }
    setShowCategoryManager(true);
    setHighlightCatManager(true);
    setTimeout(() => {
      categoryManagerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 80);
    setTimeout(() => {
      setHighlightCatManager(false);
    }, 1800);
  };

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
        setShowPlaidModal(true);
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
    setShowAddAccountForm(false);
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

  const handleQuickTrackCategory = (catName) => {
    setBudgetCat(catName);
    setBudgetLimit('300');
    setBudgetScope('this_and_future');
    setShowBudgetModal(true);
  };

  const handleCreateManagedCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    await apiFetch('/api/finance/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: newCatName.trim(),
        monthly_limit: newCatLimit ? parseFloat(newCatLimit) : 0,
        budget_month: selectedMonth,
        apply_scope: 'this_and_future',
      }),
    });
    setNewCatName('');
    setNewCatLimit('');
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleRenameOrMergeCategory = async (oldName) => {
    const cleanTarget = renameCatTarget.trim();
    if (!cleanTarget || cleanTarget === oldName) {
      setRenamingCatName(null);
      return;
    }
    await apiFetch('/api/finance/categories', {
      method: 'PUT',
      body: JSON.stringify({
        old_name: oldName,
        new_name: cleanTarget,
      }),
    });
    setRenamingCatName(null);
    setRenameCatTarget('');
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
  };

  const handleDeleteOrArchiveCategory = async (catObj) => {
    await apiFetch('/api/finance/categories', {
      method: 'DELETE',
      body: JSON.stringify({
        name: catObj.name,
        reassign_to: reassignCatTarget || '',
        month: selectedMonth,
      }),
    });
    setDeletingCatObj(null);
    setReassignCatTarget('');
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
  };

  const handleRestoreCategory = async (catName) => {
    await apiFetch('/api/finance/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: catName,
        budget_month: selectedMonth,
      }),
    });
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  if (loading && !summary) {
    return <div className="card">Loading financial dashboard...</div>;
  }

  if (!summary) return null;

  const availableCategories = Array.from(
    new Set(
      summary.all_categories && summary.all_categories.length > 0
        ? [
            ...summary.all_categories,
            ...(summary.budgets || []).map((b) => b.category),
          ]
        : [
            ...(summary.budgets || []).map((b) => b.category),
            ...DEFAULT_CATEGORIES,
          ]
    )
  );

  const catalogList = summary.categories_catalog || [];
  const untrackedCategories = summary.untracked_categories || [];
  const untrackedWithSpend = untrackedCategories.filter((c) => c.month_spent > 0);
  const filteredCatalog = catalogList.filter((c) => {
    if (catFilter === 'untracked') return !c.is_tracked && !c.is_archived;
    if (catFilter === 'preloaded') return c.is_preloaded && !c.is_archived;
    if (catFilter === 'custom') return c.is_custom && !c.is_archived;
    if (catFilter === 'archived') return c.is_archived;
    return !c.is_archived;
  });

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

  // =========================================================================
  // DATA VISUALIZATION & GRAPH COMPUTATIONS
  // =========================================================================
  const actualIncome = Number(summary.total_monthly_income || 0);
  const projectedIncome = Number(summary.projected_monthly_income || 0);
  const totalBudget = Number(summary.total_monthly_budget || 0);
  const totalSpent = Number(summary.total_monthly_spent || 0);

  // 1. Selected Month Bar Comparison (Projected Income, Actual Income, Monthly Budget, Actual Spend)
  const currentMonthBars = [
    {
      key: 'proj_inc',
      label: 'Projected Income',
      value: projectedIncome,
      color: '#06b6d4',
      sub:
        summary.projected_income_months_count > 0
          ? `${summary.projected_income_months_count} prior mo avg`
          : 'Est. baseline',
    },
    {
      key: 'act_inc',
      label: 'Actual Income',
      value: actualIncome,
      color: '#10b981',
      sub: `${(summary.income_entries || []).length} deposit(s)`,
    },
    {
      key: 'budget',
      label: 'Monthly Budget',
      value: totalBudget,
      color: '#6366f1',
      sub: `${sortedBudgets.length} categories`,
    },
    {
      key: 'spent',
      label: 'Actual Expenses',
      value: totalSpent,
      color: totalSpent > totalBudget && totalBudget > 0 ? '#ef4444' : '#f59e0b',
      sub: `${summary.month_transaction_count || 0} purchase(s)`,
    },
  ];
  const maxCurrentBarVal = Math.max(
    1,
    ...currentMonthBars.map((b) => b.value)
  );

  // Multi-month historical comparison (chronological, up to 6 months)
  const recentHistoryChrono = [...(historyData?.history || [])]
    .slice(0, 6)
    .reverse();
  const maxHistoryVal = Math.max(
    1,
    ...recentHistoryChrono.flatMap((m) => [
      Number(m.total_income || 0),
      Number(m.projected_income || 0),
      Number(m.total_spent || 0),
      Number(m.total_budget || 0),
    ])
  );

  // 2. Spending Breakdown Pie / Donut Chart Slices
  const categorySpendMap = new Map();
  (summary.budgets || []).forEach((b) => {
    if (b.spent > 0) {
      categorySpendMap.set(b.category, {
        category: b.category,
        spent: Number(b.spent),
        color: b.color,
      });
    }
  });
  untrackedWithSpend.forEach((u) => {
    if (u.month_spent > 0 && !categorySpendMap.has(u.name)) {
      categorySpendMap.set(u.name, {
        category: `${u.name} (Untracked)`,
        spent: Number(u.month_spent),
        color: '#f59e0b',
      });
    }
  });

  const pieSlicesRaw = Array.from(categorySpendMap.values()).sort(
    (a, b) => b.spent - a.spent
  );
  const totalPieSpend = pieSlicesRaw.reduce((acc, item) => acc + item.spent, 0);
  let cumulativePercent = 0;
  const pieSlices = pieSlicesRaw.map((item, idx) => {
    const pct = totalPieSpend > 0 ? (item.spent / totalPieSpend) * 100 : 0;
    const startPct = cumulativePercent;
    cumulativePercent += pct;
    return {
      ...item,
      color: item.color || PIE_PALETTE[idx % PIE_PALETTE.length],
      pct,
      startPct,
    };
  });

  return (
    <div className="module-container">
      {/* Compact Header with Active Month Trigger, Primary Actions & Options Menu */}
      <div className="section-header-bar finance-header-bar">
        <div className="finance-header-title-area">
          <div className="finance-title-row">
            <h2>Finances & Budgeting</h2>
            <button
              type="button"
              className="active-period-trigger-pill"
              onClick={() => setShowPeriodModal(true)}
              title="Click to switch budget period or compare historical months"
            >
              <Calendar size={14} />
              <span>{formatMonthLabel(selectedMonth)}</span>
              {selectedMonth === currentCalendarMonth && (
                <span className="month-now-dot" title="Current Month" />
              )}
              <ChevronDown size={13} />
            </button>
          </div>
          <p className="text-muted finance-header-subtitle">
            Net Cash:{' '}
            <strong className="text-green">
              ${summary.net_cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </strong>{' '}
            • {formatShortMonth(selectedMonth)} Spend:{' '}
            <strong>
              ${totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </strong>{' '}
            of ${totalBudget.toLocaleString('en-US', { minimumFractionDigits: 0 })}
          </p>
        </div>

        <div className="finance-top-actions" ref={optionsMenuRef}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setShowOptionsMenu(false);
              setShowAddTx(true);
            }}
          >
            <Plus size={16} /> Log Expense
          </button>

          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              setShowOptionsMenu(false);
              setShowAddIncome(true);
            }}
          >
            <DollarSign size={16} /> Log Income
          </button>

          {/* Desktop Quick Period Button */}
          <button
            type="button"
            className="btn btn-secondary hide-on-mobile"
            onClick={() => {
              setShowOptionsMenu(false);
              setShowPeriodModal(true);
            }}
          >
            <History size={16} /> Budget Period & History
          </button>

          {/* Generic Options Button (Houses Modals & Tools Cleanly on Mobile & Desktop) */}
          <div className="finance-options-wrapper">
            <button
              type="button"
              className={`btn btn-secondary finance-options-trigger ${
                showOptionsMenu ? 'active' : ''
              }`}
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              aria-expanded={showOptionsMenu}
            >
              <SlidersHorizontal size={16} />
              <span>Options</span>
              {untrackedCategories.length > 0 && (
                <span className="options-badge-dot" title="Untracked categories need attention" />
              )}
              <ChevronDown size={14} />
            </button>

            {showOptionsMenu && (
              <>
                <div
                  className="finance-options-backdrop"
                  onClick={() => setShowOptionsMenu(false)}
                />
                <div className="finance-options-dropdown">
                  <div className="finance-options-header">
                    <strong>Finance Tools & Modals</strong>
                    <button
                      type="button"
                      className="btn-icon-subtle"
                      onClick={() => setShowOptionsMenu(false)}
                      aria-label="Close options menu"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <button
                    type="button"
                    className="finance-option-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowPeriodModal(true);
                    }}
                  >
                    <Calendar size={16} className="text-cyan" />
                    <div className="finance-option-copy">
                      <strong>Budget Period & Historical Months</strong>
                      <small>
                        Active: {formatMonthLabel(selectedMonth)} • Compare past months
                      </small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="finance-option-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setBudgetCat('');
                      setBudgetLimit('500');
                      setBudgetScope('this_and_future');
                      setShowBudgetModal(true);
                    }}
                  >
                    <PieChart size={16} className="text-primary" />
                    <div className="finance-option-copy">
                      <strong>Add / Adjust Month Budget</strong>
                      <small>Set or change a category limit for {formatShortMonth(selectedMonth)}</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="finance-option-item"
                    onClick={() => handleOpenAndScrollToCategoryManager()}
                  >
                    <Tags size={16} className="text-amber" />
                    <div className="finance-option-copy">
                      <div className="request-badges">
                        <strong>Manage Categories Panel</strong>
                        {untrackedCategories.length > 0 && (
                          <span className="pill pill-amber" style={{ fontSize: '0.68rem' }}>
                            {untrackedCategories.length} Untracked
                          </span>
                        )}
                      </div>
                      <small>Open & scroll to category manager to merge or hide categories</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="finance-option-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowAccountsModal(true);
                    }}
                  >
                    <Wallet size={16} className="text-green" />
                    <div className="finance-option-copy">
                      <div className="request-badges">
                        <strong>Accounts & Balances</strong>
                        <span className="pill pill-outline" style={{ fontSize: '0.68rem' }}>
                          {summary.accounts?.length || 0} Accounts
                        </span>
                      </div>
                      <small>
                        Cash: ${summary.net_cash.toLocaleString('en-US', { minimumFractionDigits: 2 })} • View or add manual accounts
                      </small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="finance-option-item"
                    onClick={() => {
                      setShowOptionsMenu(false);
                      setShowPlaidModal(true);
                    }}
                  >
                    <Building2 size={16} className="text-cyan" />
                    <div className="finance-option-copy">
                      <div className="request-badges">
                        <strong>Bank Connections (Plaid)</strong>
                        <span className="pill pill-green" style={{ fontSize: '0.68rem' }}>
                          {plaidStatus?.linked_items?.length || 0} Linked
                        </span>
                      </div>
                      <small>Connect live banks via Plaid Link or re-sync transactions</small>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {plaidBanner && (
        <div className={`alert ${plaidBanner.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          <span>{plaidBanner.text}</span>
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={() => setPlaidBanner(null)}
            style={{ marginLeft: 'auto' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* =====================================================================
          1. TOP OF PAGE: MONTHLY INCOME & FLUCTUATION TRACKER
         ===================================================================== */}
      <div className="card income-fluctuation-card">
        <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
          <div>
            <h3>{formatMonthLabel(selectedMonth)} Income & Fluctuation Tracker</h3>
            <small className="text-muted">
              Track paychecks, variable income, and projected income alongside your {formatShortMonth(selectedMonth)} budget.
            </small>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowPeriodModal(true)}
            >
              <Calendar size={14} /> {formatShortMonth(selectedMonth)} Period
            </button>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => setShowAddIncome(true)}
            >
              <Plus size={14} /> Log Income / Paycheck
            </button>
          </div>
        </div>

        <div className="income-metrics-strip">
          <div className="income-metric-box">
            <span className="text-muted">Actual {formatShortMonth(selectedMonth)} Income</span>
            <strong className="text-green">
              ${actualIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </strong>
            <small className="text-muted">
              Expected baseline: $
              {Number(summary.expected_monthly_income || 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}
            </small>
          </div>

          <div className="income-metric-box">
            <span className="text-muted">Projected Income (Prior Months)</span>
            <strong className="text-cyan">
              ${projectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </strong>
            <small className="text-muted">
              {summary.projected_income_months_count > 0 ? (
                <>
                  Based on {summary.projected_income_months_count} prior mo(s) • Recurring $
                  {Number(summary.projected_recurring_income || 0).toFixed(0)} + Var $
                  {Number(summary.projected_variable_income || 0).toFixed(0)}
                </>
              ) : (
                'Log prior month income to build historical projection'
              )}
            </small>
          </div>

          <div className="income-metric-box">
            <span className="text-muted">Actual vs. Projected Income</span>
            <strong
              className={
                Number(summary.income_vs_projected || 0) >= 0 ? 'text-green' : 'text-amber'
              }
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            >
              {Number(summary.income_vs_projected || 0) >= 0 ? (
                <TrendingUp size={16} />
              ) : (
                <TrendingDown size={16} />
              )}
              {Number(summary.income_vs_projected || 0) >= 0 ? '+' : '-'}$
              {Math.abs(Number(summary.income_vs_projected || 0)).toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}
              {summary.income_vs_projected_pct !== undefined && (
                <small>
                  ({summary.income_vs_projected_pct >= 0 ? '+' : ''}
                  {summary.income_vs_projected_pct}%)
                </small>
              )}
            </strong>
            <small className="text-muted">
              Vs. {formatShortMonth(summary.previous_month)}:{' '}
              {Number(summary.income_fluctuation_vs_prev || 0) >= 0 ? '+' : '-'}$
              {Math.abs(Number(summary.income_fluctuation_vs_prev || 0)).toFixed(0)} (Range $
              {Number(summary.projected_income_min || 0).toFixed(0)}–$
              {Number(summary.projected_income_max || 0).toFixed(0)})
            </small>
          </div>

          <div className="income-metric-box">
            <span className="text-muted">Net Cash Flow & Unallocated</span>
            <strong
              className={
                Number(summary.net_monthly_cashflow || 0) >= 0 ? 'text-green' : 'text-amber'
              }
            >
              {Number(summary.net_monthly_cashflow || 0) >= 0 ? '+' : '-'}$
              {Math.abs(Number(summary.net_monthly_cashflow || 0)).toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}
            </strong>
            <small className="text-muted">
              After ${totalBudget.toFixed(0)} budget:{' '}
              {Number(summary.unallocated_income || 0) >= 0 ? '+' : '-'}$
              {Math.abs(Number(summary.unallocated_income || 0)).toFixed(0)} unallocated
            </small>
          </div>
        </div>

        {(summary.income_entries || []).length > 0 && (
          <div className="income-entries-collapsible">
            <button
              type="button"
              className="income-entries-toggle-btn"
              onClick={toggleIncomeEntriesExpanded}
              aria-expanded={incomeEntriesExpanded}
            >
              <div className="income-entries-toggle-left">
                {incomeEntriesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <strong>
                  {incomeEntriesExpanded ? 'Hide' : 'Show'} Income & Refund Entries (
                  {summary.income_entries.length})
                </strong>
                <span className="text-muted">
                  — Paychecks, deposits & returns in {formatShortMonth(selectedMonth)}
                </span>
              </div>
              <span className="pill pill-outline">
                +${actualIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </button>

            {incomeEntriesExpanded && (
              <div className="income-entries-list">
                {summary.income_entries.map((inc) => {
                  const diff =
                    Number(inc.amount || 0) -
                    Number(inc.expected_monthly_amount || inc.amount || 0);
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
                            +$
                            {Number(inc.amount).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                            })}
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
        )}
      </div>

      {/* =====================================================================
          2. MAIN TWO-COLUMN SECTION: CATEGORY BUDGETS + INTERACTIVE GRAPHS
         ===================================================================== */}
      <div className="finance-two-col">
        {/* LEFT COLUMN: Monthly Category Budgets with Persistent Sort Order */}
        <div className="card">
          <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
            <div>
              <h3>{formatMonthLabel(selectedMonth)} Category Budgets</h3>
              <small className="text-muted">
                Adjust or cancel categories for {formatShortMonth(selectedMonth)} without altering prior months
              </small>
            </div>
            <div className="topbar-right" style={{ flexWrap: 'wrap' }}>
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
                onClick={() => handleOpenAndScrollToCategoryManager()}
                title="Open Category Manager panel below"
              >
                <Tags size={14} /> Categories
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setBudgetCat('');
                  setBudgetLimit('500');
                  setBudgetScope('this_and_future');
                  setShowBudgetModal(true);
                }}
              >
                <Plus size={14} /> Add / Adjust
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
                No monthly budgets active for <strong>{formatMonthLabel(selectedMonth)}</strong>. Click <strong>Add / Adjust</strong> to set a budget limit.
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

        {/* RIGHT COLUMN: Interactive Financial Graphs & Data Visualizations Panel */}
        <div className="card finance-graphs-card">
          <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
            <div>
              <h3>
                <BarChart3 size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                Financial Visualizations
              </h3>
              <small className="text-muted">
                Interactive graphs for {formatMonthLabel(selectedMonth)} & recent months
              </small>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => setShowAccountsModal(true)}
              title="Open Accounts & Balances Modal"
            >
              <Wallet size={13} /> Accounts ({summary.accounts?.length || 0})
            </button>
          </div>

          {/* Graph Selector Tabs */}
          <div className="chart-selector-tabs">
            {CHART_VIEWS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`chart-tab-btn ${activeChart === tab.id ? 'active' : ''}`}
                onClick={() => handleSelectChart(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* CHART 1: BAR GRAPH — PROJECTED & ACTUAL INCOME VS. EXPENSES */}
          {activeChart === 'income_vs_expenses' && (
            <div className="chart-panel-body">
              <div className="chart-section-title">
                <strong>{formatMonthLabel(selectedMonth)}: Projected Income vs. Expenses</strong>
                <span className="text-muted">
                  Savings rate:{' '}
                  {actualIncome > 0
                    ? `${Math.round(((actualIncome - totalSpent) / actualIncome) * 100)}%`
                    : '0%'}
                </span>
              </div>

              <div className="vertical-bars-stage">
                {currentMonthBars.map((bar) => {
                  const heightPct =
                    bar.value > 0 ? Math.max(8, (bar.value / maxCurrentBarVal) * 100) : 3;
                  return (
                    <div key={bar.key} className="vbar-column">
                      <span className="vbar-top-val font-mono">
                        ${bar.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                      <div className="vbar-track">
                        <div
                          className="vbar-fill"
                          style={{
                            height: `${heightPct}%`,
                            background: bar.color,
                          }}
                          title={`${bar.label}: $${bar.value.toFixed(2)}`}
                        />
                      </div>
                      <strong className="vbar-label">{bar.label}</strong>
                      <small className="vbar-sub text-muted">{bar.sub}</small>
                    </div>
                  );
                })}
              </div>

              {recentHistoryChrono.length > 1 && (
                <div className="multi-month-chart-box">
                  <div className="chart-section-title">
                    <strong>Multi-Month Income vs. Spending Comparison</strong>
                    <div className="chart-legend-inline">
                      <span>
                        <i className="legend-dot" style={{ background: '#06b6d4' }} /> Projected
                      </span>
                      <span>
                        <i className="legend-dot" style={{ background: '#10b981' }} /> Income
                      </span>
                      <span>
                        <i className="legend-dot" style={{ background: '#f59e0b' }} /> Spent
                      </span>
                    </div>
                  </div>
                  <div className="multi-month-bars-grid">
                    {recentHistoryChrono.map((m) => {
                      const pPct =
                        m.projected_income > 0
                          ? Math.max(6, (m.projected_income / maxHistoryVal) * 100)
                          : 2;
                      const iPct =
                        m.total_income > 0
                          ? Math.max(6, (m.total_income / maxHistoryVal) * 100)
                          : 2;
                      const sPct =
                        m.total_spent > 0
                          ? Math.max(6, (m.total_spent / maxHistoryVal) * 100)
                          : 2;
                      return (
                        <button
                          key={m.budget_month}
                          type="button"
                          className={`multi-month-col ${
                            m.budget_month === selectedMonth ? 'selected' : ''
                          }`}
                          onClick={() => setSelectedMonth(m.budget_month)}
                          title={`${formatMonthLabel(m.budget_month)}: Projected $${Number(
                            m.projected_income || 0
                          ).toFixed(0)} | Actual Income $${Number(m.total_income || 0).toFixed(
                            0
                          )} | Spent $${Number(m.total_spent || 0).toFixed(0)}`}
                        >
                          <div className="multi-month-Cluster">
                            <div
                              className="mm-bar"
                              style={{ height: `${pPct}%`, background: '#06b6d4' }}
                            />
                            <div
                              className="mm-bar"
                              style={{ height: `${iPct}%`, background: '#10b981' }}
                            />
                            <div
                              className="mm-bar"
                              style={{ height: `${sPct}%`, background: '#f59e0b' }}
                            />
                          </div>
                          <span className="mm-label">{formatShortMonth(m.budget_month)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CHART 2: SPENDING PIE / DONUT CHART */}
          {activeChart === 'spending_pie' && (
            <div className="chart-panel-body">
              <div className="chart-section-title">
                <strong>{formatMonthLabel(selectedMonth)} Spending Breakdown</strong>
                <span className="text-muted">{pieSlices.length} active spend categories</span>
              </div>

              {pieSlices.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">
                    No expenses recorded in <strong>{formatMonthLabel(selectedMonth)}</strong> yet. Log an expense to see your category pie chart.
                  </p>
                </div>
              ) : (
                <div className="pie-chart-container">
                  <div className="donut-svg-wrap">
                    <svg viewBox="0 0 42 42" className="donut-svg">
                      <circle
                        cx="21"
                        cy="21"
                        r="15.91549430918954"
                        fill="transparent"
                        stroke="rgba(148, 163, 184, 0.15)"
                        strokeWidth="5.5"
                      />
                      {pieSlices.map((slice) => (
                        <circle
                          key={slice.category}
                          cx="21"
                          cy="21"
                          r="15.91549430918954"
                          fill="transparent"
                          stroke={slice.color}
                          strokeWidth="5.5"
                          strokeDasharray={`${slice.pct} ${100 - slice.pct}`}
                          strokeDashoffset={25 - slice.startPct}
                        >
                          <title>
                            {slice.category}: ${slice.spent.toFixed(2)} ({slice.pct.toFixed(1)}%)
                          </title>
                        </circle>
                      ))}
                    </svg>
                    <div className="donut-center-label">
                      <small className="text-muted">Total Spent</small>
                      <strong>
                        ${totalPieSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </strong>
                    </div>
                  </div>

                  <div className="pie-legend-list">
                    {pieSlices.map((slice) => (
                      <div key={slice.category} className="pie-legend-row">
                        <div className="pie-legend-left">
                          <span
                            className="pie-color-swatch"
                            style={{ background: slice.color }}
                          />
                          <span className="pie-cat-name">{slice.category}</span>
                        </div>
                        <div className="pie-legend-right font-mono">
                          <strong>${slice.spent.toFixed(2)}</strong>
                          <span className="pill pill-outline" style={{ fontSize: '0.68rem' }}>
                            {slice.pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CHART 3: CATEGORY BUDGET UTILIZATION HORIZONTAL BARS */}
          {activeChart === 'budget_bars' && (
            <div className="chart-panel-body">
              <div className="chart-section-title">
                <strong>Category Spend vs. Monthly Budget Limit</strong>
                <span className="text-muted">
                  Overall:{' '}
                  {totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}% used
                </span>
              </div>

              {sortedBudgets.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">No category budgets configured for this month.</p>
                </div>
              ) : (
                <div className="hbar-utilization-list">
                  {sortedBudgets.map((b) => {
                    const pct = b.monthly_limit > 0 ? (b.spent / b.monthly_limit) * 100 : 0;
                    const isOver = b.spent > b.monthly_limit && b.monthly_limit > 0;
                    return (
                      <div key={b.category} className="hbar-item">
                        <div className="hbar-top">
                          <strong>{b.category}</strong>
                          <span className="font-mono">
                            <span className={isOver ? 'text-danger' : ''}>
                              ${b.spent.toFixed(0)}
                            </span>{' '}
                            / ${b.monthly_limit.toFixed(0)}{' '}
                            <small className={isOver ? 'text-danger' : 'text-muted'}>
                              ({Math.round(pct)}%)
                            </small>
                          </span>
                        </div>
                        <div className="hbar-dual-track">
                          <div
                            className="hbar-fill"
                            style={{
                              width: `${Math.min(100, pct)}%`,
                              background: isOver ? '#ef4444' : b.color || '#6366f1',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* CHART 4: MULTI-MONTH NET CASH FLOW & SAVINGS TREND */}
          {activeChart === 'cashflow_trend' && (
            <div className="chart-panel-body">
              <div className="chart-section-title">
                <strong>Monthly Net Cash Flow & Savings Rate</strong>
                <span className="text-muted">Income minus Expenses per month</span>
              </div>

              {recentHistoryChrono.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">No monthly history available yet.</p>
                </div>
              ) : (
                <div className="cashflow-trend-list">
                  {recentHistoryChrono.map((m) => {
                    const net = Number(m.net_cashflow || 0);
                    const inc = Number(m.total_income || 0);
                    const sp = Number(m.total_spent || 0);
                    const savingsRate = inc > 0 ? Math.round(((inc - sp) / inc) * 100) : 0;
                    const barWidth = Math.min(
                      100,
                      Math.max(8, (Math.abs(net) / maxHistoryVal) * 100)
                    );
                    return (
                      <div
                        key={m.budget_month}
                        className={`cashflow-trend-row ${
                          m.budget_month === selectedMonth ? 'active' : ''
                        }`}
                        onClick={() => setSelectedMonth(m.budget_month)}
                      >
                        <div className="cashflow-trend-meta">
                          <div>
                            <strong>{formatShortMonth(m.budget_month)}</strong>
                            <small className="text-muted" style={{ marginLeft: '0.45rem' }}>
                              In: ${inc.toFixed(0)} • Out: ${sp.toFixed(0)}
                            </small>
                          </div>
                          <div className="topbar-right">
                            <span
                              className={`font-mono ${
                                net >= 0 ? 'text-green' : 'text-danger'
                              }`}
                            >
                              <strong>
                                {net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}
                              </strong>
                            </span>
                            {inc > 0 && (
                              <span
                                className={`pill ${
                                  savingsRate >= 0 ? 'pill-green' : 'pill-red'
                                }`}
                                style={{ fontSize: '0.68rem' }}
                              >
                                {savingsRate}% saved
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${barWidth}%`,
                              background: net >= 0 ? '#10b981' : '#ef4444',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* =====================================================================
          3. UNTRACKED CATEGORIES WARNING BANNER
         ===================================================================== */}
      {untrackedCategories.length > 0 && (
        <div className="card untracked-flag-banner">
          <div className="untracked-flag-header">
            <div className="untracked-flag-title">
              <AlertTriangle size={20} className="text-amber" />
              <div>
                <strong>
                  {untrackedWithSpend.length > 0
                    ? `${untrackedWithSpend.length} Categor${
                        untrackedWithSpend.length === 1 ? 'y has' : 'ies have'
                      } $${Number(summary.untracked_monthly_spent || 0).toFixed(
                        2
                      )} in Untracked Spending for ${formatShortMonth(selectedMonth)}`
                    : `${untrackedCategories.length} Categor${
                        untrackedCategories.length === 1 ? 'y is' : 'ies are'
                      } Not Tracked in ${formatShortMonth(selectedMonth)}'s Budget`}
                </strong>
                <p className="text-muted" style={{ fontSize: '0.82rem' }}>
                  These pre-loaded or custom categories do not have a monthly budget limit set for{' '}
                  <strong>{formatMonthLabel(selectedMonth)}</strong>. Set a budget to track them, or open{' '}
                  <strong>Manage Categories</strong> to merge or remove unused ones.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                showCategoryManager
                  ? setShowCategoryManager(false)
                  : handleOpenAndScrollToCategoryManager()
              }
            >
              <Tags size={14} />{' '}
              {showCategoryManager ? 'Hide Category Manager' : 'Manage Categories'}
            </button>
          </div>

          <div className="untracked-chips-list">
            {untrackedCategories.map((uc) => (
              <div
                key={uc.name}
                className={`untracked-cat-chip ${uc.month_spent > 0 ? 'has-spend' : ''}`}
              >
                <div>
                  <strong>{uc.name}</strong>
                  <small className="text-muted" style={{ display: 'block' }}>
                    {uc.is_preloaded ? 'Pre-Loaded' : 'Custom'} •{' '}
                    {uc.month_spent > 0 ? (
                      <span className="text-amber">
                        ${uc.month_spent.toFixed(2)} spent ({uc.month_tx_count} tx)
                      </span>
                    ) : (
                      'No budget set'
                    )}
                  </small>
                </div>
                <div className="topbar-right">
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    onClick={() => handleQuickTrackCategory(uc.name)}
                    title={`Set a monthly budget for ${uc.name}`}
                  >
                    + Track
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setDeletingCatObj(uc);
                      setReassignCatTarget(
                        availableCategories.find((c) => c !== uc.name) || ''
                      );
                      handleOpenAndScrollToCategoryManager();
                    }}
                    title={`Remove or merge ${uc.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          4. CATEGORY MANAGER IN-PAGE PANEL (SMOOTH-SCROLLED INTO VIEW)
         ===================================================================== */}
      {showCategoryManager && (
        <div
          ref={categoryManagerRef}
          className={`card category-manager-panel ${
            highlightCatManager ? 'panel-scroll-highlight' : ''
          }`}
        >
          <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
            <div>
              <h3>
                <Tags size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                Category Manager — Pre-Loaded & Custom Categories
              </h3>
              <small className="text-muted">
                Clean up unused pre-loaded or custom categories, merge duplicates across all transactions, or flag & track unbudgeted categories.
              </small>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowCategoryManager(false)}
            >
              <X size={15} /> Close Panel
            </button>
          </div>

          <form className="category-create-bar" onSubmit={handleCreateManagedCategory}>
            <input
              type="text"
              className="input input-sm"
              placeholder="New category name (e.g., Pet Care, Subscriptions)..."
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              required
            />
            <input
              type="number"
              step="5"
              min="0"
              className="input input-sm"
              placeholder="Optional monthly budget ($)"
              value={newCatLimit}
              onChange={(e) => setNewCatLimit(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={14} /> Add Category
            </button>
          </form>

          <div className="filter-pills-row">
            {[
              {
                id: 'all',
                label: `All Active (${catalogList.filter((c) => !c.is_archived).length})`,
              },
              {
                id: 'untracked',
                label: `⚠️ Not Tracked (${
                  catalogList.filter((c) => !c.is_tracked && !c.is_archived).length
                })`,
              },
              {
                id: 'preloaded',
                label: `Pre-Loaded (${
                  catalogList.filter((c) => c.is_preloaded && !c.is_archived).length
                })`,
              },
              {
                id: 'custom',
                label: `Custom (${
                  catalogList.filter((c) => c.is_custom && !c.is_archived).length
                })`,
              },
              {
                id: 'archived',
                label: `Hidden / Archived (${catalogList.filter((c) => c.is_archived).length})`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`filter-pill ${catFilter === tab.id ? 'active' : ''}`}
                onClick={() => setCatFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="category-manager-list">
            {filteredCatalog.length === 0 ? (
              <div className="empty-state-box">
                <p className="text-muted">No categories match this filter.</p>
              </div>
            ) : (
              filteredCatalog.map((cat) => {
                const isRenaming = renamingCatName === cat.name;
                const isDeleting = deletingCatObj?.name === cat.name;
                return (
                  <div
                    key={cat.name}
                    className={`category-manager-item ${
                      !cat.is_tracked && !cat.is_archived ? 'untracked-item' : ''
                    }`}
                  >
                    <div className="category-manager-main">
                      <div className="category-manager-info">
                        <div className="request-badges">
                          <strong>{cat.name}</strong>
                          <span className="pill pill-outline">
                            {cat.is_preloaded ? 'Pre-Loaded' : 'Custom'}
                          </span>
                          {cat.is_archived ? (
                            <span className="pill pill-outline">Archived / Hidden</span>
                          ) : cat.is_tracked ? (
                            <span className="pill pill-green">
                              ✓ Tracked (${cat.monthly_limit.toFixed(0)}/mo)
                            </span>
                          ) : (
                            <span className="pill pill-amber">
                              ⚠️ Not Tracked in {formatShortMonth(selectedMonth)} Budget
                            </span>
                          )}
                        </div>
                        <small className="text-muted">
                          {formatShortMonth(selectedMonth)}: ${cat.month_spent.toFixed(2)} (
                          {cat.month_tx_count} tx) • All-time: $
                          {cat.total_spent_all_time.toFixed(2)} ({cat.total_tx_count} tx)
                        </small>
                      </div>

                      <div className="category-manager-actions">
                        {cat.is_archived ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            onClick={() => handleRestoreCategory(cat.name)}
                          >
                            <RotateCcw size={13} /> Restore Category
                          </button>
                        ) : (
                          <>
                            {!cat.is_tracked && (
                              <button
                                type="button"
                                className="btn btn-primary btn-xs"
                                onClick={() => handleQuickTrackCategory(cat.name)}
                              >
                                <Plus size={13} /> Track in Budget
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => {
                                setRenamingCatName(isRenaming ? null : cat.name);
                                setRenameCatTarget(cat.name);
                                setDeletingCatObj(null);
                              }}
                            >
                              <Edit3 size={13} /> Rename / Merge
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger-outline btn-xs"
                              onClick={() => {
                                setDeletingCatObj(isDeleting ? null : cat);
                                setReassignCatTarget(
                                  availableCategories.find((c) => c !== cat.name) || ''
                                );
                                setRenamingCatName(null);
                              }}
                            >
                              <Trash2 size={13} /> Remove / Hide
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isRenaming && (
                      <div className="category-inline-drawer">
                        <label>
                          Rename <strong>"{cat.name}"</strong> or type/select an existing category name to merge all transactions & budgets into it:
                        </label>
                        <div className="category-inline-controls">
                          <input
                            type="text"
                            className="input input-sm"
                            list="merge-category-suggestions"
                            value={renameCatTarget}
                            onChange={(e) => setRenameCatTarget(e.target.value)}
                            placeholder="New or target category name..."
                          />
                          <datalist id="merge-category-suggestions">
                            {availableCategories
                              .filter((c) => c !== cat.name)
                              .map((c) => (
                                <option key={c} value={c} />
                              ))}
                          </datalist>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleRenameOrMergeCategory(cat.name)}
                          >
                            Save / Merge
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setRenamingCatName(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {isDeleting && (
                      <div className="category-inline-drawer danger">
                        <label>
                          Remove / hide <strong>"{cat.name}"</strong> from dropdowns and active budgets?
                          {cat.total_tx_count > 0 &&
                            ` (${cat.total_tx_count} existing transaction(s) can be reassigned below):`}
                        </label>
                        <div className="category-inline-controls">
                          {cat.total_tx_count > 0 && (
                            <select
                              className="input input-sm"
                              value={reassignCatTarget}
                              onChange={(e) => setReassignCatTarget(e.target.value)}
                            >
                              <option value="">Keep original category label on past transactions</option>
                              {availableCategories
                                .filter((c) => c !== cat.name)
                                .map((c) => (
                                  <option key={c} value={c}>
                                    Reassign all {cat.total_tx_count} tx to: {c}
                                  </option>
                                ))}
                            </select>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleDeleteOrArchiveCategory(cat)}
                          >
                            Confirm Remove
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setDeletingCatObj(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          5. TRANSACTIONS LEDGER
         ===================================================================== */}
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
              No transactions allocated to <strong>{formatMonthLabel(selectedMonth)}</strong>. Switch months via <strong>Budget Period</strong>, click <strong>Show All Months</strong>, or log a new expense.
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
                          <div className="tx-cat-select-stack">
                            <select
                              className="input input-sm tx-cat-select"
                              value={tx.category}
                              onChange={(e) => handleReassignCategory(tx.id, e.target.value)}
                            >
                              {Array.from(new Set([...availableCategories, tx.category])).map(
                                (cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                )
                              )}
                              <option value="__custom__">+ Custom Category...</option>
                            </select>
                            {tx.is_category_tracked === false && (
                              <button
                                type="button"
                                className="pill pill-amber tx-untracked-pill"
                                onClick={() => handleQuickTrackCategory(tx.category)}
                                title={`"${tx.category}" is not tracked in your monthly budget. Tap to set a budget limit.`}
                              >
                                <AlertTriangle size={11} /> Untracked — Set Budget
                              </button>
                            )}
                          </div>
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

      {/* =====================================================================
          FLOATING MODAL 1: BUDGET PERIOD & HISTORICAL MONTH COMPARISON
         ===================================================================== */}
      {showPeriodModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowPeriodModal(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Calendar size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  Budget Period & Historical Month Comparison
                </h3>
                <p className="text-muted">
                  Switch your active budget month or compare historical income, spending, and subscription changes across months.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowPeriodModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
              <div className="period-modal-selector-box">
                <div className="month-selector-bar">
                  <div className="month-selector-left">
                    <div>
                      <div className="request-badges">
                        <strong style={{ fontSize: '1.02rem' }}>
                          Active Period: {formatMonthLabel(selectedMonth)}
                        </strong>
                        {selectedMonth === currentCalendarMonth && (
                          <span className="pill pill-cyan">Current Month</span>
                        )}
                        {selectedMonth < currentCalendarMonth && (
                          <span className="pill pill-outline">Historical Month Snapshot</span>
                        )}
                        {selectedMonth > currentCalendarMonth && (
                          <span className="pill pill-amber">Future Month Plan</span>
                        )}
                      </div>
                      <small className="text-muted">
                        Budgets reset cleanly on the 1st of every month.
                      </small>
                    </div>
                  </div>

                  <div className="month-selector-controls">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSelectedMonth(summary.previous_month)}
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
                    >
                      {formatShortMonth(summary.next_month)} <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                {/* Clickable Month Pills Ribbon */}
                <div className="month-ribbon-pills" style={{ marginTop: '0.75rem' }}>
                  {ribbonMonths.map((ym) => {
                    const isSelected = ym === selectedMonth;
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
                          setShowPeriodModal(false);
                        }}
                      >
                        <span>{formatShortMonth(ym)}</span>
                        {isCurrent && <small className="month-now-dot" title="Current Month" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: '1.1rem' }}>
                <h4 style={{ marginBottom: '0.65rem' }}>
                  Historical Months Archive ({historyData?.history?.length || 0} Months)
                </h4>
                {!historyData?.history?.length ? (
                  <div className="empty-state-box">
                    <p className="text-muted">No monthly history recorded yet.</p>
                  </div>
                ) : (
                  <div className="history-months-grid">
                    {historyData.history.map((mItem) => {
                      const isOver =
                        mItem.total_spent > mItem.total_budget && mItem.total_budget > 0;
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
                                  {mItem.transaction_count} tx
                                </span>
                              </div>
                              <h3 style={{ marginTop: '0.25rem' }}>
                                {formatMonthLabel(mItem.budget_month)}
                              </h3>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              onClick={() => {
                                setSelectedMonth(mItem.budget_month);
                                setShowPeriodModal(false);
                              }}
                            >
                              Switch to Month
                            </button>
                          </div>

                          <div className="plan-numbers-row">
                            <div>
                              <span className="text-muted">Income</span>
                              <strong className="text-green">
                                $
                                {Number(mItem.total_income || 0).toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                })}
                              </strong>
                              <small
                                style={{ display: 'block', fontSize: '0.7rem' }}
                                className="text-muted"
                              >
                                Proj: $
                                {Number(mItem.projected_income || 0).toLocaleString('en-US', {
                                  maximumFractionDigits: 0,
                                })}
                              </small>
                            </div>
                            <div>
                              <span className="text-muted">Spent</span>
                              <strong className={isOver ? 'text-danger' : 'text-green'}>
                                $
                                {Number(mItem.total_spent).toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                })}
                              </strong>
                            </div>
                            <div>
                              <span className="text-muted">Budget</span>
                              <strong>
                                $
                                {Number(mItem.total_budget).toLocaleString('en-US', {
                                  minimumFractionDigits: 0,
                                })}
                              </strong>
                            </div>
                            <div>
                              <span className="text-muted">Net Cash Flow</span>
                              <strong
                                className={
                                  (mItem.net_cashflow || 0) >= 0 ? 'text-cyan' : 'text-danger'
                                }
                              >
                                {(mItem.net_cashflow || 0) >= 0 ? '+' : '-'}$
                                {Math.abs(Number(mItem.net_cashflow || 0)).toLocaleString(
                                  'en-US',
                                  {
                                    minimumFractionDigits: 2,
                                  }
                                )}
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
                            {(mItem.categories || []).slice(0, 5).map((c) => (
                              <div key={c.category} className="history-cat-row">
                                <span>
                                  {c.category}
                                  {!c.is_active && (
                                    <small className="text-muted"> (Inactive)</small>
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
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 2: BANK CONNECTIONS (PLAID)
         ===================================================================== */}
      {showPlaidModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowPlaidModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Building2 size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  Bank Connections (Plaid Integration)
                </h3>
                <p className="text-muted">
                  Connect live bank and credit card accounts via Plaid or sync your latest transactions.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowPlaidModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
              <div className="plaid-modal-status-box">
                <div className="request-badges">
                  <strong>Plaid Connection Status</strong>
                  {plaidStatus?.configured ? (
                    <span className="pill pill-green">
                      <CheckCircle2 size={12} /> .env Credentials Loaded ({plaidStatus.environment})
                    </span>
                  ) : (
                    <span className="pill pill-amber">Missing .env keys</span>
                  )}
                </div>
                <p className="text-muted" style={{ fontSize: '0.84rem', marginTop: '0.35rem' }}>
                  Client ID: <code>{plaidStatus?.client_id_preview || 'Not set'}</code> •{' '}
                  <strong>{plaidStatus?.linked_items?.length || 0}</strong> Institution(s) Linked
                </p>
              </div>

              {plaidBanner && (
                <div
                  className={`alert ${
                    plaidBanner.type === 'error' ? 'alert-error' : 'alert-success'
                  }`}
                >
                  {plaidBanner.text}
                </div>
              )}

              <div className="plaid-modal-actions-stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={plaidBusy || !plaidStatus?.configured}
                  onClick={handleOpenPlaidLinkUI}
                >
                  <Link2 size={16} /> Connect Bank via Plaid Link
                </button>

                {plaidStatus?.linked_items?.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={plaidBusy}
                    onClick={handleSyncPlaid}
                  >
                    <RefreshCw size={15} className={plaidBusy ? 'spin' : ''} /> Re-Sync Linked Accounts & Transactions
                  </button>
                )}

                {plaidStatus?.environment === 'sandbox' && (
                  <div className="sandbox-connect-box">
                    <label className="text-muted" style={{ fontSize: '0.8rem' }}>
                      Plaid Sandbox Instant Test Bank:
                    </label>
                    <div className="sandbox-controls-row">
                      <select
                        className="input input-sm"
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
                        <RefreshCw size={14} className={plaidBusy ? 'spin' : ''} />
                        {plaidBusy ? 'Connecting...' : 'Quick Connect Sandbox'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {(plaidStatus?.linked_items || []).length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                    Linked Institutions
                  </h4>
                  <div className="accounts-stack">
                    {plaidStatus.linked_items.map((item) => (
                      <div key={item.id || item.item_id} className="account-row-item">
                        <div className="account-meta">
                          <Building2 size={18} className="text-cyan" />
                          <div>
                            <strong>{item.institution_name || 'Linked Bank'}</strong>
                            <small className="text-muted" style={{ display: 'block' }}>
                              Status: {item.status || 'active'}
                            </small>
                          </div>
                        </div>
                        <span className="pill pill-green">Connected</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 3: ACCOUNTS & BALANCES (+ ADD MANUAL ACCOUNT)
         ===================================================================== */}
      {showAccountsModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAccountsModal(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Wallet size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  Accounts & Balances
                </h3>
                <p className="text-muted">
                  View connected depository and credit accounts or add a manual account.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAccountsModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
              <div className="kpi-grid-3" style={{ marginBottom: '1rem' }}>
                <div className="kpi-card">
                  <span className="kpi-label">Total Cash & Savings</span>
                  <strong className="kpi-value text-green">
                    ${summary.net_cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Checking + Savings</small>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Credit Card Balances</span>
                  <strong className="kpi-value text-amber">
                    ${Number(summary.credit_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Current Credit Liability</small>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Net Liquid Position</span>
                  <strong className="kpi-value text-cyan">
                    ${Number(summary.net_liquid || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Cash minus Credit</small>
                </div>
              </div>

              <div className="plan-card-header" style={{ marginBottom: '0.65rem' }}>
                <h4>Connected & Manual Accounts ({summary.accounts.length})</h4>
                <div className="topbar-right">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowAccountsModal(false);
                      setShowPlaidModal(true);
                    }}
                  >
                    <Building2 size={14} /> Link via Plaid
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setShowAddAccountForm(!showAddAccountForm)}
                  >
                    <Plus size={14} /> {showAddAccountForm ? 'Hide Form' : 'Add Manual Account'}
                  </button>
                </div>
              </div>

              {showAddAccountForm && (
                <form
                  className="card form-card"
                  style={{ marginBottom: '1rem' }}
                  onSubmit={handleCreateAccount}
                >
                  <h4>Add a Manual Bank or Credit Card Account</h4>
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
                          setAccSubtype(
                            e.target.value === 'credit' ? 'credit card' : 'checking'
                          );
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

              {summary.accounts.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">
                    No bank accounts linked yet. Connect a bank using <strong>Link via Plaid</strong> or click <strong>Add Manual Account</strong>.
                  </p>
                </div>
              ) : (
                <div className="accounts-stack">
                  {summary.accounts.map((acc) => (
                    <div key={acc.id} className="account-row-item">
                      <div className="account-meta">
                        {acc.type === 'credit' ? (
                          <CreditCard size={20} />
                        ) : (
                          <Wallet size={20} />
                        )}
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
                            $
                            {Number(acc.balance_current).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                            })}
                          </strong>
                          <small className="text-muted">
                            {acc.owner_scope.toUpperCase()}
                          </small>
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
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 4: ADD / ADJUST MONTH BUDGET
         ===================================================================== */}
      {showBudgetModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowBudgetModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <PieChart size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  Add or Adjust Budget for {formatMonthLabel(selectedMonth)}
                </h3>
                <p className="text-muted">
                  Choose whether this budget change applies only to <strong>{formatMonthLabel(selectedMonth)}</strong> or from <strong>{formatShortMonth(selectedMonth)} forward</strong>. Previous historical months are never overwritten.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowBudgetModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form className="finance-modal-body" onSubmit={handleSaveBudget}>
              <div className="form-grid-1" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
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
                    autoFocus
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

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
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
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 5: LOG INCOME / PAYCHECK
         ===================================================================== */}
      {showAddIncome && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAddIncome(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <DollarSign size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Log Income or Paycheck for {formatMonthLabel(selectedMonth)}
                </h3>
                <p className="text-muted">
                  Track fixed paychecks, variable/commission income, bonuses, or side income.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAddIncome(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form className="finance-modal-body" onSubmit={handleAddIncome}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Income Source / Employer *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Primary Paycheck, Freelance"
                    value={incSource}
                    onChange={(e) => setIncSource(e.target.value)}
                    required
                    autoFocus
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
              </div>

              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
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

              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
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
                    placeholder="e.g., Includes overtime"
                    value={incNotes}
                    onChange={(e) => setIncNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddIncome(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Income to {formatShortMonth(selectedMonth)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 6: LOG EXPENSE
         ===================================================================== */}
      {showAddTx && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAddTx(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Plus size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Log a Shared or Individual Expense
                </h3>
                <p className="text-muted">
                  Add a transaction and assign it to a category and budget month.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAddTx(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form className="finance-modal-body" onSubmit={handleAddTransaction}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Description / Merchant *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Whole Foods Market"
                    value={txName}
                    onChange={(e) => setTxName(e.target.value)}
                    required
                    autoFocus
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
              </div>

              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
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

              {txCategory === '__custom__' && (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
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

              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
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

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddTx(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
