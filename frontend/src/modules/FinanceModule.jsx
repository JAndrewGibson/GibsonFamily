import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
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
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  Users,
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

const ACCOUNT_COLOR_PALETTE = [
  '#06b6d4',
  '#10b981',
  '#6366f1',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#3b82f6',
  '#14b8a6',
  '#f97316',
  '#ef4444',
];

const STARTING_MONTH = '2026-11';

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
  const rawCalendarMonth = new Date().toISOString().slice(0, 7);
  const currentCalendarMonth =
    rawCalendarMonth < STARTING_MONTH ? STARTING_MONTH : rawCalendarMonth;

  // Persisted Month & Chart Selection (Clamped to November 2026 starting point)
  const [selectedMonth, setSelectedMonthState] = useState(() => {
    const saved = getCookie('gibson_finance_month', currentCalendarMonth) || currentCalendarMonth;
    return saved < STARTING_MONTH ? STARTING_MONTH : saved;
  });
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
    const clamped = ym < STARTING_MONTH ? STARTING_MONTH : ym;
    setSelectedMonthState(clamped);
    setCookie('gibson_finance_month', clamped, 365);
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
  const [unlinkingPlaidItem, setUnlinkingPlaidItem] = useState(null);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [showUserBalancesModal, setShowUserBalancesModal] = useState(false);
  const [selectedUserFilter, setSelectedUserFilter] = useState('all');
  const [updatingAccountId, setUpdatingAccountId] = useState(null);
  const [confirmDeleteAccId, setConfirmDeleteAccId] = useState(null);
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

  // Cancel / Remove Budget Category Confirmation Modal
  const [cancellingBudget, setCancellingBudget] = useState(null);

  // Category Manager Floating Modal State
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [catFilter, setCatFilter] = useState('all');
  const [newCatName, setNewCatName] = useState('');
  const [newCatLimit, setNewCatLimit] = useState('');
  const [renamingCatName, setRenamingCatName] = useState(null);
  const [renameCatTarget, setRenameCatTarget] = useState('');
  const [deletingCatObj, setDeletingCatObj] = useState(null);
  const [reassignCatTarget, setReassignCatTarget] = useState('');

  // Income & Fluctuation Tracker Form & Inflow Entries Modal State
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [showIncomeEntriesModal, setShowIncomeEntriesModal] = useState(false);
  const [incSource, setIncSource] = useState('');
  const [incAmount, setIncAmount] = useState('');
  const [incExpected, setIncExpected] = useState('');
  const [incType, setIncType] = useState('payroll');
  const [incCategory, setIncCategory] = useState('');
  const [incDate, setIncDate] = useState(new Date().toISOString().slice(0, 10));
  const [incNotes, setIncNotes] = useState('');

  // Custom Projected Income Target Modal State
  const [showProjectionModal, setShowProjectionModal] = useState(false);
  const [customProjInput, setCustomProjInput] = useState('');

  // Reclassify Inflow / Deposit Modal State
  const [editingIncomeEntry, setEditingIncomeEntry] = useState(null);
  const [editIncType, setEditIncType] = useState('payroll');
  const [editIncCategory, setEditIncCategory] = useState('');

  // Manual Account Form State (Floating Modal)
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState('depository');
  const [accSubtype, setAccSubtype] = useState('checking');
  const [accBalance, setAccBalance] = useState('');
  const [accInstitution, setAccInstitution] = useState('');
  const [accMask, setAccMask] = useState('');
  const [accOwnerPartnerId, setAccOwnerPartnerId] = useState('');
  const [accColor, setAccColor] = useState('#06b6d4');

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

  // Background server action on page load: if Plaid accounts haven't synced in >= 12 hours, auto-sync
  useEffect(() => {
    apiFetch('/api/finance/plaid/auto-sync', {
      method: 'POST',
      body: JSON.stringify({ background: true }),
    }).catch(() => {});
  }, []);

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

  // Open the Category Manager Floating Modal
  const handleOpenAndScrollToCategoryManager = (filterOverride = null) => {
    setShowOptionsMenu(false);
    if (filterOverride) {
      setCatFilter(filterOverride);
    }
    setShowCategoryManager(true);
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
        owner_partner_id: accOwnerPartnerId ? parseInt(accOwnerPartnerId, 10) : null,
        color: accColor || '#06b6d4',
      }),
    });
    setAccName('');
    setAccBalance('');
    setAccInstitution('');
    setAccMask('');
    setAccOwnerPartnerId('');
    setAccColor('#06b6d4');
    setShowAddAccountForm(false);
    await loadFinanceData();
  };

  const handleUpdateAccountOwner = async (accountId, newOwnerPartnerId) => {
    setUpdatingAccountId(accountId);
    try {
      const parsedPid =
        newOwnerPartnerId && newOwnerPartnerId !== 'shared' && newOwnerPartnerId !== ''
          ? parseInt(newOwnerPartnerId, 10)
          : null;
      await apiFetch(`/api/finance/accounts/${accountId}`, {
        method: 'PUT',
        body: JSON.stringify({
          owner_partner_id: parsedPid,
          owner_scope: parsedPid ? 'individual' : 'shared',
        }),
      });
      await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
      onDataChanged?.();
    } catch (err) {
      console.error('Failed to update account owner:', err);
    } finally {
      setUpdatingAccountId(null);
    }
  };

  const handleUpdateAccountColor = async (accountId, newColor) => {
    if (!newColor) return;
    setUpdatingAccountId(accountId);
    try {
      await apiFetch(`/api/finance/accounts/${accountId}`, {
        method: 'PUT',
        body: JSON.stringify({ color: newColor }),
      });
      await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
      onDataChanged?.();
    } catch (err) {
      console.error('Failed to update account color:', err);
    } finally {
      setUpdatingAccountId(null);
    }
  };

  const handleDeleteAccount = async (acc) => {
    const accId = typeof acc === 'object' ? acc.id : acc;
    await apiFetch(`/api/finance/accounts/${accId}`, { method: 'DELETE' });
    setConfirmDeleteAccId(null);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
  };

  const handleReassignAccount = async (txId, newAccountId) => {
    await apiFetch(`/api/finance/transactions/${txId}`, {
      method: 'PUT',
      body: JSON.stringify({
        account_id: newAccountId ? Number(newAccountId) : null,
      }),
    });
    setOpenMenuTxId(null);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
  };

  const handleUnlinkPlaidItem = async (item) => {
    setPlaidBusy(true);
    try {
      const resp = await apiFetch(`/api/finance/plaid/items/${item.id || item.item_id}`, {
        method: 'DELETE',
      });
      setUnlinkingPlaidItem(null);
      setPlaidBanner({
        type: 'success',
        text: `Successfully unlinked ${item.institution_name || 'Bank'}! Removed ${resp.deleted_accounts || 0} duplicate account(s), ${resp.deleted_transactions || 0} transaction(s), and ${resp.deleted_income_entries || 0} deposit(s).`,
      });
      await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
      onDataChanged?.();
    } catch (err) {
      setPlaidBanner({
        type: 'error',
        text: `Failed to unlink bank: ${err.message}`,
      });
    } finally {
      setPlaidBusy(false);
    }
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
        category: incType === 'return' ? incCategory : '',
        date: incDate,
        budget_month: selectedMonth,
        notes: incNotes.trim(),
      }),
    });
    setIncSource('');
    setIncAmount('');
    setIncExpected('');
    setIncNotes('');
    setIncCategory('');
    setShowAddIncome(false);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, false);
    onDataChanged?.();
  };

  const handleDeleteIncome = async (incomeId) => {
    await apiFetch(`/api/finance/income/${incomeId}`, { method: 'DELETE' });
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
  };

  const handleOpenProjectionModal = () => {
    const initialVal =
      summary?.custom_projected_income != null
        ? Number(summary.custom_projected_income).toFixed(2)
        : summary?.projected_monthly_income != null
        ? Number(summary.projected_monthly_income).toFixed(2)
        : '';
    setCustomProjInput(initialVal);
    setShowProjectionModal(true);
  };

  const handleSaveCustomProjectedIncome = async (e) => {
    e?.preventDefault();
    const cleanStr = String(customProjInput).trim();
    const val = parseFloat(cleanStr);
    if (isNaN(val) || val <= 0) {
      alert('Please enter a valid positive projected income amount.');
      return;
    }
    const rounded = Math.round(val * 100) / 100;
    await apiFetch('/api/finance/projected-income', {
      method: 'POST',
      body: JSON.stringify({
        budget_month: selectedMonth,
        custom_projected_income: rounded,
        projected_income: rounded,
      }),
    });
    setShowProjectionModal(false);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
  };

  const handleClearCustomProjectedIncome = async () => {
    await apiFetch(`/api/finance/projected-income?month=${encodeURIComponent(selectedMonth)}`, {
      method: 'DELETE',
    });
    setShowProjectionModal(false);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
  };

  const handleOpenReclassify = (inc) => {
    setEditingIncomeEntry(inc);
    setEditIncType(inc.income_type || 'payroll');
    setEditIncCategory(inc.category || availableCategories[0] || 'Shopping & Tech');
  };

  const handleSaveReclassify = async (e) => {
    e?.preventDefault();
    if (!editingIncomeEntry) return;
    await apiFetch(`/api/finance/income/${editingIncomeEntry.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        income_type: editIncType,
        category: editIncType === 'return' ? editIncCategory : '',
      }),
    });
    setEditingIncomeEntry(null);
    await loadFinanceData(selectedMonth, showAllMonthsInLedger, true);
    onDataChanged?.();
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

  // Build quick-jump month ribbon starting from November 2026 (STARTING_MONTH) onward
  const ribbonMonths = Array.from(
    new Set(
      [
        STARTING_MONTH,
        currentCalendarMonth,
        shiftMonthString(currentCalendarMonth, 1),
        selectedMonth,
        ...(summary.available_months || []),
      ].filter((ym) => ym && ym >= STARTING_MONTH)
    )
  ).sort();

  // =========================================================================
  // DATA VISUALIZATION, LAYERED BALANCE BAR & OVERLAP WARNING COMPUTATIONS
  // =========================================================================
  const actualIncome = Number(summary.total_monthly_income || 0);
  const projectedIncome = Number(summary.projected_monthly_income || 0);
  const totalBudget = Number(summary.total_monthly_budget || 0);
  const totalSpent = Number(summary.total_monthly_spent || 0);

  // Separate explicit savings budgets (e.g. "Future Purchase Savings") from spending category budgets
  const savingsBudgetLimit = Number(
    summary.savings_budget_limit ??
      (summary.budgets || [])
        .filter((b) => /saving/i.test(b.category || ''))
        .reduce((acc, b) => acc + Number(b.monthly_limit || 0), 0)
  );
  const expenseBudgetLimit = Math.max(0, totalBudget - savingsBudgetLimit);
  const unallocatedProjectedSavings = Math.max(0, projectedIncome - totalBudget);
  // Total Savings shown in grey at the right end of Projected Income
  const totalGreySavings = savingsBudgetLimit + unallocatedProjectedSavings;

  // The maximum of the horizontal layered bar is Projected Income (fallback to max metric if projected is 0)
  const barMaxProjected =
    projectedIncome > 0
      ? projectedIncome
      : Math.max(totalBudget, totalSpent, 1);

  // Dollar threshold where the Grey Savings Zone begins (at the right end of Projected Income)
  const savingsZoneStartDollar = Math.max(0, barMaxProjected - totalGreySavings);

  // Percentages relative to Projected Income (0% to 100% of bar)
  const savingsWidthPct = Math.min(
    100,
    Math.max(0, (totalGreySavings / barMaxProjected) * 100)
  );
  const savingsStartPct = Math.max(0, 100 - savingsWidthPct);
  const expenseBudgetPct = Math.min(
    100,
    Math.max(0, (expenseBudgetLimit / barMaxProjected) * 100)
  );
  const totalBudgetPct = Math.min(
    100,
    Math.max(0, (totalBudget / barMaxProjected) * 100)
  );
  const totalSpentPct = Math.min(
    100,
    Math.max(0, (totalSpent / barMaxProjected) * 100)
  );

  // Overlap regions on the 0..100% Projected Income bar
  const budgetIntoSavingsStartPct = Math.min(savingsStartPct, expenseBudgetPct);
  const budgetIntoSavingsWidthPct =
    expenseBudgetPct > savingsStartPct ? expenseBudgetPct - savingsStartPct : 0;

  const safeSpentWidthPct = Math.min(totalSpentPct, savingsStartPct);
  const spentIntoSavingsWidthPct =
    totalSpentPct > savingsStartPct ? totalSpentPct - savingsStartPct : 0;

  // Explicit Overlap & Unbalanced Budget Flags (Compared strictly against Projected Income & Category Budgets)
  const budgetExceedsProjected =
    projectedIncome > 0 ? totalBudget > projectedIncome : totalBudget > 0;
  const budgetOverProjectedAmt = Math.max(0, totalBudget - projectedIncome);

  const spentExceedsProjected =
    projectedIncome > 0 ? totalSpent > projectedIncome : totalSpent > 0;
  const spentOverProjectedAmt = Math.max(0, totalSpent - projectedIncome);

  const spentDippingIntoSavings =
    projectedIncome > 0 &&
    totalGreySavings > 0 &&
    totalSpent > savingsZoneStartDollar;
  const spentDippingIntoSavingsAmt = spentDippingIntoSavings
    ? Math.max(0, totalSpent - savingsZoneStartDollar)
    : 0;

  const spentExceedsExpenseBudget =
    expenseBudgetLimit > 0 && totalSpent > expenseBudgetLimit;
  const spentOverExpenseBudgetAmt = Math.max(0, totalSpent - expenseBudgetLimit);

  const overlapFlags = [];
  if (budgetExceedsProjected) {
    overlapFlags.push({
      id: 'budget_over_projected',
      severity: 'danger',
      title: `Budget Exceeds Projected Income by +$${budgetOverProjectedAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail:
        projectedIncome > 0
          ? `Total budgeted ($${totalBudget.toLocaleString('en-US', { minimumFractionDigits: 2 })}, incl. $${savingsBudgetLimit.toFixed(0)} savings) is ${Math.round((totalBudget / projectedIncome) * 100)}% of your $${projectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })} projected income. Reduce category budgets to balance your budget.`
          : `You have $${totalBudget.toLocaleString('en-US', { minimumFractionDigits: 2 })} budgeted, but Projected Income is $0.00. Set a Projected Income target to establish your baseline.`,
    });
  }
  if (spentExceedsProjected) {
    overlapFlags.push({
      id: 'spent_over_projected',
      severity: 'danger',
      title: `More Spent Than Projected Income (+$${spentOverProjectedAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
      detail: `Actual spending ($${totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })}) has exceeded 100% of your $${projectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })} projected monthly income.`,
    });
  }
  if (spentDippingIntoSavings) {
    overlapFlags.push({
      id: 'spent_into_savings',
      severity: 'danger',
      title: `Spent Money Dipping Into Savings ($${spentDippingIntoSavingsAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })} dipped)`,
      detail: `Spending ($${totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })}) crossed past your $${savingsZoneStartDollar.toLocaleString('en-US', { minimumFractionDigits: 2 })} spending ceiling and is eating into your grey Savings zone ($${totalGreySavings.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
    });
  }
  if (spentExceedsExpenseBudget && !spentDippingIntoSavings) {
    overlapFlags.push({
      id: 'spent_over_expense_budget',
      severity: 'warning',
      title: `Spending Exceeds Category Budget Limit (+$${spentOverExpenseBudgetAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
      detail: `You have spent $${totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })} against your $${expenseBudgetLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })} non-savings category budget.`,
    });
  }

  const isBalancedBudget =
    projectedIncome > 0 &&
    !budgetExceedsProjected &&
    !spentExceedsProjected &&
    !spentDippingIntoSavings &&
    totalGreySavings > 0;

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

  // Multi-month historical comparison (chronological, starting from November 2026)
  const filteredHistoryList = (historyData?.history || []).filter(
    (m) => m.budget_month >= STARTING_MONTH
  );
  const recentHistoryChrono = [...filteredHistoryList]
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

  // -------------------------------------------------------------------------
  // USER ACCOUNTS & BALANCES BREAKDOWN HELPERS
  // -------------------------------------------------------------------------
  const partnersList = summary?.partners || [];
  const accountsList = summary?.accounts || [];

  const isCheckingAcc = (acc) => {
    const sub = (acc.subtype || '').toLowerCase();
    const typ = (acc.type || '').toLowerCase();
    return (
      sub.includes('checking') ||
      sub.includes('cash') ||
      (typ === 'depository' &&
        !sub.includes('savings') &&
        !sub.includes('money market') &&
        !sub.includes('cd'))
    );
  };

  const isSavingsAcc = (acc) => {
    const sub = (acc.subtype || '').toLowerCase();
    return sub.includes('savings') || sub.includes('money market') || sub.includes('cd');
  };

  const isCreditAcc = (acc) => {
    const typ = (acc.type || '').toLowerCase();
    const sub = (acc.subtype || '').toLowerCase();
    return typ === 'credit' || sub.includes('credit') || sub.includes('loan');
  };

  const isInvestmentAcc = (acc) => {
    return !isCheckingAcc(acc) && !isSavingsAcc(acc) && !isCreditAcc(acc);
  };

  // Aggregate household totals
  const totalHouseholdChecking = accountsList
    .filter(isCheckingAcc)
    .reduce((sum, a) => sum + (Number(a.balance_current) || 0), 0);

  const totalHouseholdSavings = accountsList
    .filter(isSavingsAcc)
    .reduce((sum, a) => sum + (Number(a.balance_current) || 0), 0);

  const totalHouseholdCredit = accountsList
    .filter(isCreditAcc)
    .reduce((sum, a) => sum + (Number(a.balance_current) || 0), 0);

  const totalHouseholdNet = totalHouseholdChecking + totalHouseholdSavings - totalHouseholdCredit;

  // Build user groups: each registered partner + shared/household accounts
  const userGroups = [
    ...partnersList.map((p) => {
      const userAccs = accountsList.filter((a) => a.owner_partner_id === p.id);
      const chk = userAccs.filter(isCheckingAcc);
      const sav = userAccs.filter(isSavingsAcc);
      const crd = userAccs.filter(isCreditAcc);
      const inv = userAccs.filter(isInvestmentAcc);

      const chkTot = chk.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const savTot = sav.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const crdTot = crd.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const invTot = inv.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const netTot = chkTot + savTot + invTot - crdTot;

      return {
        id: `partner-${p.id}`,
        partnerId: p.id,
        name: p.name,
        color: p.avatar_color || '#6366f1',
        isShared: false,
        accounts: userAccs,
        checking: chk,
        savings: sav,
        credit: crd,
        other: inv,
        checkingTotal: chkTot,
        savingsTotal: savTot,
        creditTotal: crdTot,
        otherTotal: invTot,
        netTotal: netTot,
      };
    }),
    (() => {
      const sharedAccs = accountsList.filter((a) => !a.owner_partner_id);
      const chk = sharedAccs.filter(isCheckingAcc);
      const sav = sharedAccs.filter(isSavingsAcc);
      const crd = sharedAccs.filter(isCreditAcc);
      const inv = sharedAccs.filter(isInvestmentAcc);

      const chkTot = chk.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const savTot = sav.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const crdTot = crd.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const invTot = inv.reduce((s, a) => s + (Number(a.balance_current) || 0), 0);
      const netTot = chkTot + savTot + invTot - crdTot;

      return {
        id: 'shared',
        partnerId: null,
        name: 'Shared / Joint Accounts',
        color: '#06b6d4',
        isShared: true,
        accounts: sharedAccs,
        checking: chk,
        savings: sav,
        credit: crd,
        other: inv,
        checkingTotal: chkTot,
        savingsTotal: savTot,
        creditTotal: crdTot,
        otherTotal: invTot,
        netTotal: netTot,
      };
    })(),
  ];

  const renderUserAccountCard = (acc) => {
    const isCredit = isCreditAcc(acc);
    const isSav = isSavingsAcc(acc);
    const isChk = isCheckingAcc(acc);
    const clusterClass = isCredit
      ? 'account-card-credit'
      : isSav
      ? 'account-card-savings'
      : isChk
      ? 'account-card-checking'
      : 'account-card-other';
    const isUpdating = updatingAccountId === acc.id;
    const isConfirmingDelete = confirmDeleteAccId === acc.id;
    const cardColor = acc.color || '#06b6d4';

    return (
      <div
        key={acc.id}
        className={`user-account-item-card ${clusterClass}`}
        style={{ borderLeft: `4px solid ${cardColor}` }}
      >
        <div className="account-card-topbar">
          <div className="account-card-inst-tag">
            <span
              className="account-color-dot"
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: cardColor,
                display: 'inline-block',
                flexShrink: 0,
              }}
              title={`Account Ledger Color: ${cardColor}`}
            />
            <strong>{acc.institution_name || 'Bank Account'}</strong>
            <span className="account-mask-pill">•••• {acc.mask || '0000'}</span>
          </div>
          <div className="account-card-badges">
            {acc.plaid_account_id ? (
              <span className="pill pill-cyan" style={{ fontSize: '0.62rem' }}>
                Plaid
              </span>
            ) : (
              <span className="pill pill-outline" style={{ fontSize: '0.62rem' }}>
                Manual
              </span>
            )}
            <span
              className="pill pill-subtle"
              style={{ fontSize: '0.62rem', textTransform: 'capitalize' }}
            >
              {acc.subtype || acc.type}
            </span>
            <button
              type="button"
              className="btn-icon-danger"
              style={{ padding: '0.18rem', marginLeft: '0.15rem' }}
              onClick={() =>
                setConfirmDeleteAccId(isConfirmingDelete ? null : acc.id)
              }
              title="Permanently remove this account and purge its transactions"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div className="account-card-name-row">
          <div className="account-card-official-name" title={acc.official_name || acc.name}>
            {acc.name}
          </div>
        </div>

        <div className="account-card-balance-block">
          <div className="account-balance-label">
            {isCredit ? 'Current Balance (Debt)' : 'Current Balance'}
          </div>
          <div
            className={`account-balance-figure ${
              isCredit ? 'text-amber' : isSav ? 'text-green' : 'text-cyan'
            }`}
          >
            $
            {Number(acc.balance_current || 0).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          {acc.balance_available != null &&
            Math.abs(acc.balance_available - acc.balance_current) > 0.01 && (
              <small className="account-available-note">
                Available: $
                {Number(acc.balance_available).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                })}
              </small>
            )}
        </div>

        {/* Account Color-Coding Selector (Reflects in Ledger Transactions) */}
        <div className="account-color-picker-row">
          <span className="owner-assign-label">Ledger Color:</span>
          <div className="account-color-swatches">
            {ACCOUNT_COLOR_PALETTE.slice(0, 7).map((hex) => (
              <button
                key={hex}
                type="button"
                className={`account-color-swatch-btn ${
                  cardColor.toLowerCase() === hex.toLowerCase() ? 'active' : ''
                }`}
                style={{ backgroundColor: hex }}
                onClick={() => handleUpdateAccountColor(acc.id, hex)}
                title={`Set ledger color to ${hex}`}
              />
            ))}
            <label className="account-custom-color-input" title="Choose custom account color">
              <input
                type="color"
                value={cardColor}
                onChange={(e) => handleUpdateAccountColor(acc.id, e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="account-card-owner-assigner">
          <label htmlFor={`owner-select-${acc.id}`} className="owner-assign-label">
            <User size={12} /> Owner:
          </label>
          <div className="owner-assign-select-wrapper">
            <select
              id={`owner-select-${acc.id}`}
              className="owner-assign-select"
              value={acc.owner_partner_id || 'shared'}
              disabled={isUpdating}
              onChange={(e) => handleUpdateAccountOwner(acc.id, e.target.value)}
            >
              <option value="shared">👥 Shared / Joint</option>
              {partnersList.map((p) => (
                <option key={p.id} value={p.id}>
                  👤 {p.name}
                </option>
              ))}
            </select>
            {isUpdating && <span className="assign-spinner">Saving...</span>}
          </div>
        </div>

        {isConfirmingDelete && (
          <div className="account-delete-confirm-box">
            <small className="text-danger" style={{ display: 'block', marginBottom: '0.4rem' }}>
              Remove <strong>{acc.name}</strong>? Permanently blocks this account from re-syncing and removes its duplicate transactions.
            </small>
            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setConfirmDeleteAccId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-xs"
                onClick={() => handleDeleteAccount(acc)}
              >
                Confirm Remove
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

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
                      handleOpenProjectionModal();
                    }}
                  >
                    <Target size={16} className="text-cyan" />
                    <div className="finance-option-copy">
                      <div className="request-badges">
                        <strong>Projected Income Target</strong>
                        {summary.is_custom_projection ? (
                          <span className="pill pill-primary" style={{ fontSize: '0.68rem' }}>
                            Custom Override
                          </span>
                        ) : (
                          <span className="pill pill-outline" style={{ fontSize: '0.68rem' }}>
                            Auto-Calculated
                          </span>
                        )}
                      </div>
                      <small>
                        Target: ${projectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })} • Custom or auto baseline
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
                      setShowUserBalancesModal(true);
                    }}
                  >
                    <Users size={16} className="text-cyan" />
                    <div className="finance-option-copy">
                      <div className="request-badges">
                        <strong>All Accounts & Balances by User</strong>
                        <span className="pill pill-cyan" style={{ fontSize: '0.68rem' }}>
                          By Partner
                        </span>
                      </div>
                      <small>
                        See each user's Checking, Savings, Credit & current balances
                      </small>
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
          1. TOP OF PAGE: MONTHLY INCOME, LAYERED BALANCE BAR & FLUCTUATION TRACKER
         ===================================================================== */}
      <div
        className={`card income-fluctuation-card ${
          budgetExceedsProjected || spentExceedsProjected
            ? 'card-overbudget-alert'
            : ''
        }`}
      >
        <div className="plan-card-header" style={{ flexWrap: 'wrap', gap: '0.65rem' }}>
          <div>
            <div className="request-badges">
              <h3>{formatMonthLabel(selectedMonth)} Income & Fluctuation Tracker</h3>
              {isBalancedBudget ? (
                <span className="pill pill-green">
                  <CheckCircle2 size={12} /> Balanced Budget (${totalGreySavings.toFixed(0)} Savings)
                </span>
              ) : budgetExceedsProjected ? (
                <span className="pill pill-red">
                  <AlertTriangle size={12} /> Budget Exceeds Projected Income (+$
                  {budgetOverProjectedAmt.toFixed(0)})
                </span>
              ) : overlapFlags.length > 0 ? (
                <span className="pill pill-amber">
                  <AlertTriangle size={12} /> {overlapFlags.length} Budget Overlap Warning
                  {overlapFlags.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <small className="text-muted">
              Goal: Keep budgeted categories + grey savings within your{' '}
              <strong>Projected Income</strong> ceiling without overlapping.
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
            <div className="income-metric-title-row">
              <span className="text-muted">Projected Income</span>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                style={{ padding: '0.1rem 0.45rem', fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                onClick={handleOpenProjectionModal}
                title="Override automated projection or customize monthly target"
              >
                <Edit3 size={11} /> {summary.is_custom_projection ? 'Custom Target' : 'Override'}
              </button>
            </div>
            <strong className="text-cyan">
              ${projectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </strong>
            <small className="text-muted">
              {summary.is_custom_projection ? (
                <>
                  <span className="pill pill-primary" style={{ fontSize: '0.62rem', padding: '0.05rem 0.35rem', marginRight: '0.3rem' }}>
                    Custom
                  </span>
                  Auto baseline: ${Number(summary.auto_projected_income || 0).toFixed(0)} ({summary.projected_income_months_count} mo avg)
                </>
              ) : summary.projected_income_months_count > 0 ? (
                <>
                  Based on {summary.projected_income_months_count} prior mo(s) • Rec $
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

          <div
            className={`income-metric-box ${
              budgetExceedsProjected ? 'metric-box-danger' : ''
            }`}
          >
            <span className="text-muted">
              {budgetExceedsProjected
                ? '⚠️ Budget Exceeds Projected!'
                : 'Budget vs. Projected Income'}
            </span>
            <strong
              className={
                budgetExceedsProjected
                  ? 'text-danger'
                  : Number(summary.projected_unallocated_income || 0) >= 0
                  ? 'text-green'
                  : 'text-amber'
              }
            >
              {budgetExceedsProjected
                ? `Over by +$${budgetOverProjectedAmt.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}`
                : `+$${totalGreySavings.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })} Savings`}
            </strong>
            <small className="text-muted">
              Budgeted: ${totalBudget.toFixed(0)} / Projected: ${projectedIncome.toFixed(0)}
            </small>
          </div>
        </div>

        {/* ===================================================================
            LAYERED HORIZONTAL BAR: PROJECTED INCOME MAX + GREY SAVINGS AT END
           =================================================================== */}
        <div className="layered-budget-bar-section">
          <div className="layered-bar-header">
            <div>
              <strong>
                Layered Budget & Savings vs. Projected Income (Max: $
                {projectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })})
              </strong>
              <small className="text-muted" style={{ display: 'block' }}>
                Spending Categories: <strong>${expenseBudgetLimit.toFixed(0)}</strong> • Grey Savings at End:{' '}
                <strong>${totalGreySavings.toFixed(0)}</strong> (
                {savingsBudgetLimit > 0
                  ? `$${savingsBudgetLimit.toFixed(0)} budgeted + $${unallocatedProjectedSavings.toFixed(0)} unallocated`
                  : `$${unallocatedProjectedSavings.toFixed(0)} unallocated`}
                ) • Actual Spent: <strong>${totalSpent.toFixed(2)}</strong>
              </small>
            </div>

            {(budgetExceedsProjected || spentExceedsProjected) && (
              <div className="layered-bar-overflow-pill">
                <AlertTriangle size={14} />
                <span>
                  {budgetExceedsProjected && spentExceedsProjected
                    ? `Budget +$${budgetOverProjectedAmt.toFixed(0)} & Spend +$${spentOverProjectedAmt.toFixed(0)} Over Projected Max!`
                    : budgetExceedsProjected
                    ? `Budget Exceeds Projected Max by +$${budgetOverProjectedAmt.toFixed(2)}`
                    : `Spending Exceeds Projected Max by +$${spentOverProjectedAmt.toFixed(2)}`}
                </span>
              </div>
            )}
          </div>

          {/* Horizontal Layered Bar Track (0% to 100% = Projected Income) */}
          <div className="layered-bar-outer">
            <div className="layered-bar-track">
              {/* Layer 1A: Planned Non-Savings Expense Budget Zone (from left 0%) */}
              {expenseBudgetPct > 0 && (
                <div
                  className="layer-segment layer-expense-budget"
                  style={{
                    left: '0%',
                    width: `${Math.min(expenseBudgetPct, savingsStartPct)}%`,
                  }}
                  title={`Planned Spending Categories Budget: $${expenseBudgetLimit.toFixed(2)}`}
                />
              )}

              {/* Layer 1B: Grey Savings Zone Anchored at the Right End of Projected Income */}
              {savingsWidthPct > 0 && (
                <div
                  className="layer-segment layer-grey-savings"
                  style={{
                    left: `${savingsStartPct}%`,
                    width: `${savingsWidthPct}%`,
                  }}
                  title={`Savings Reserve at End of Projected Income: $${totalGreySavings.toFixed(2)}`}
                >
                  {savingsWidthPct >= 11 && (
                    <span className="layer-grey-savings-label">
                      Savings ${totalGreySavings.toFixed(0)}
                    </span>
                  )}
                </div>
              )}

              {/* Layer 2: Overlap Hatching when Expense Budget Encroaches into Grey Savings or Exceeds Projected */}
              {budgetIntoSavingsWidthPct > 0 && (
                <div
                  className="layer-segment layer-overlap-budget-savings"
                  style={{
                    left: `${budgetIntoSavingsStartPct}%`,
                    width: `${budgetIntoSavingsWidthPct}%`,
                  }}
                  title={`Overlap Warning: Category Budgets overlap into Savings / Projected limit!`}
                />
              )}

              {/* Layer 3: Foreground Inner Bar — Actual Spending ($totalSpent) */}
              <div className="layer-actual-spend-rail">
                {/* Safe Spending Portion (Before Grey Savings Zone) */}
                {safeSpentWidthPct > 0 && (
                  <div
                    className={`layer-spend-fill ${
                      spentExceedsExpenseBudget
                        ? 'spend-fill-warn'
                        : 'spend-fill-ok'
                    }`}
                    style={{
                      left: '0%',
                      width: `${safeSpentWidthPct}%`,
                    }}
                    title={`Actual Spending within budget zone: $${Math.min(
                      totalSpent,
                      savingsZoneStartDollar
                    ).toFixed(2)}`}
                  />
                )}

                {/* Overlap Portion: Actual Spending Dipping Into Grey Savings Zone */}
                {spentIntoSavingsWidthPct > 0 && (
                  <div
                    className="layer-spend-fill spend-fill-dipping-savings"
                    style={{
                      left: `${savingsStartPct}%`,
                      width: `${spentIntoSavingsWidthPct}%`,
                    }}
                    title={`WARNING: $${spentDippingIntoSavingsAmt.toFixed(
                      2
                    )} of Actual Spending is dipping into your Grey Savings Zone!`}
                  />
                )}
              </div>

              {/* Layer 4: Vertical Limit Markers for Expense Budget & Projected Max */}
              {expenseBudgetLimit > 0 && (
                <div
                  className="layer-limit-marker marker-expense-budget"
                  style={{ left: `${ Math.min(99.5, expenseBudgetPct) }%` }}
                  title={`Spending Categories Limit: $${expenseBudgetLimit.toFixed(2)}`}
                >
                  <span className="marker-tag tag-top">
                    Cat. Budget ${expenseBudgetLimit.toFixed(0)}
                  </span>
                </div>
              )}

              <div
                className="layer-limit-marker marker-projected-max"
                style={{ left: '100%' }}
                title={`Projected Income Maximum: $${projectedIncome.toFixed(2)}`}
              >
                <span className="marker-tag tag-max">
                  Max (Proj): ${projectedIncome.toFixed(0)}
                </span>
              </div>
            </div>

            {/* Overflow Tail Bar if Budget or Spend Exceeds 100% Projected Income */}
            {(budgetExceedsProjected || spentExceedsProjected) && (
              <div
                className="layered-bar-overflow-tail"
                title={`Exceeds 100% Projected Income by +$${Math.max(
                  budgetOverProjectedAmt,
                  spentOverProjectedAmt
                ).toFixed(2)}`}
              >
                <span>
                  OVERFLOW +$
                  {Math.max(budgetOverProjectedAmt, spentOverProjectedAmt).toFixed(0)}
                </span>
              </div>
            )}
          </div>

          {/* Legend Strip for Layered Horizontal Bar (Streamlined: Projected Income, Categories & Savings) */}
          <div className="layered-bar-legend">
            <span className="layered-legend-item">
              <i className="legend-swatch swatch-spend-ok" />
              Actual Net Spent: <strong>${totalSpent.toFixed(2)}</strong>
              {Number(summary.total_monthly_returns || 0) > 0 && (
                <small className="text-muted" style={{ marginLeft: '0.3rem' }}>
                  (Gross: ${Number(summary.total_gross_spent || totalSpent).toFixed(2)})
                </small>
              )}
            </span>
            {Number(summary.total_monthly_returns || 0) > 0 && (
              <span className="layered-legend-item">
                <RotateCcw size={12} className="text-primary" style={{ marginRight: '0.25rem' }} />
                Returns Credited: <strong className="text-primary">+${Number(summary.total_monthly_returns).toFixed(2)}</strong>
              </span>
            )}
            <span className="layered-legend-item">
              <i className="legend-swatch swatch-expense-budget" />
              Budgeted Categories: <strong>${expenseBudgetLimit.toFixed(0)}</strong> (Total w/ Savings:{' '}
              <strong>${totalBudget.toFixed(0)}</strong>)
            </span>
            <span className="layered-legend-item">
              <i className="legend-swatch swatch-grey-savings" />
              Savings at End (Grey): <strong>${totalGreySavings.toFixed(0)}</strong>
            </span>
            <span className="layered-legend-item">
              <i className="legend-swatch swatch-proj-max" />
              Projected Income Max: <strong>${projectedIncome.toFixed(0)}</strong>
            </span>
          </div>

          {/* Explicit Overlap & Unbalanced Budget Flags */}
          {overlapFlags.length > 0 && (
            <div className="overlap-warnings-grid">
              {overlapFlags.map((flag) => (
                <div
                  key={flag.id}
                  className={`overlap-warning-card ${
                    flag.severity === 'danger' ? 'overlap-danger' : 'overlap-warn'
                  }`}
                >
                  <AlertTriangle size={17} className="overlap-warn-icon" />
                  <div className="overlap-warn-copy">
                    <strong>{flag.title}</strong>
                    <span>{flag.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {(summary.income_entries || []).length > 0 && (
          <div className="income-entries-collapsible">
            <button
              type="button"
              className="income-entries-toggle-btn"
              onClick={() => setShowIncomeEntriesModal(true)}
            >
              <div className="income-entries-toggle-left">
                <SlidersHorizontal size={15} className="text-cyan" />
                <strong>
                  Manage Inflow & Income Entries ({summary.income_entries.length})
                </strong>
                <span className="text-muted">
                  — Tap to open modal (paychecks, returns, CC payments & transfers)
                </span>
              </div>
              <div className="income-summary-badges">
                <span className="pill pill-green" title="Real earned payroll income">
                  Earned: +${actualIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                {Number(summary.total_monthly_returns || 0) > 0 && (
                  <span className="pill pill-primary" title="Returns credited back to category budgets">
                    Returns: +${Number(summary.total_monthly_returns).toFixed(2)}
                  </span>
                )}
                {(Number(summary.total_cc_payments || 0) > 0 || Number(summary.total_transfers || 0) > 0) && (
                  <span className="pill pill-outline" title="Non-income inflows (CC payments / transfers)">
                    Excluded: ${(Number(summary.total_cc_payments || 0) + Number(summary.total_transfers || 0)).toFixed(2)}
                  </span>
                )}
              </div>
            </button>
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
                title="Open Category Manager modal"
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

          {/* Obvious Budgeted vs. Projected Income Status Bar inside Category Budgets Card */}
          <div
            className={`category-budgets-balance-strip ${
              budgetExceedsProjected
                ? 'strip-danger'
                : spentDippingIntoSavings
                ? 'strip-warn'
                : 'strip-balanced'
            }`}
          >
            <div className="balance-strip-left">
              {budgetExceedsProjected ? (
                <AlertTriangle size={16} className="text-danger" />
              ) : spentDippingIntoSavings ? (
                <AlertTriangle size={16} className="text-amber" />
              ) : (
                <CheckCircle2 size={16} className="text-green" />
              )}
              <div>
                <strong>
                  {budgetExceedsProjected
                    ? `Over-Budgeted! Categories Exceed Projected Income by +$${budgetOverProjectedAmt.toFixed(2)}`
                    : spentDippingIntoSavings
                    ? `Spending Dipping $${spentDippingIntoSavingsAmt.toFixed(2)} Into Savings!`
                    : `Balanced Budget — $${totalGreySavings.toFixed(2)} Preserved for Savings`}
                </strong>
                <small className="text-muted" style={{ display: 'block' }}>
                  Total Budgeted: <strong>${totalBudget.toFixed(2)}</strong> ($
                  {expenseBudgetLimit.toFixed(0)} spending + ${savingsBudgetLimit.toFixed(0)}{' '}
                  savings) vs. Projected Income: <strong>${projectedIncome.toFixed(2)}</strong>
                  {Number(summary.total_monthly_returns || 0) > 0 && (
                    <span className="text-cyan" style={{ display: 'block', marginTop: '0.2rem' }}>
                      ⚖️ <strong>Financial Equilibrium</strong>: +$
                      {Number(summary.total_monthly_returns).toFixed(2)} in store returns credited back to category budgets (offsets spend without inflating income).
                    </span>
                  )}
                </small>
              </div>
            </div>
          </div>

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
                          <strong>${b.spent.toFixed(2)}</strong>
                          {b.returns_credited > 0 && (
                            <small className="text-muted" style={{ marginLeft: '0.2rem' }}>
                              (net)
                            </small>
                          )}{' '}
                          / ${b.monthly_limit.toFixed(0)} ({b.utilization_pct}%)
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
                      {b.returns_credited > 0 && (
                        <span className="text-cyan" style={{ marginLeft: '0.45rem', display: 'inline-block' }}>
                          • +${b.returns_credited.toFixed(2)} return credited ($${b.gross_spent.toFixed(2)} gross)
                        </span>
                      )}
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
          FLOATING MODAL: CATEGORY MANAGER (PRE-LOADED & CUSTOM CATEGORIES)
         ===================================================================== */}
      {showCategoryManager && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowCategoryManager(false)}
        >
          <div
            ref={categoryManagerRef}
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Tags size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  Category Manager — Pre-Loaded & Custom Categories
                </h3>
                <p className="text-muted">
                  Clean up unused pre-loaded or custom categories, merge duplicates across all transactions, or flag & track unbudgeted categories.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowCategoryManager(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
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
          </div>
        </div>
      )}

      {/* =====================================================================
          5. TRANSACTIONS LEDGER (COLOR-CODED BY ACCOUNT)
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
              Color-coded by bank/card account. Reassign any purchase category inline, or open the row <strong>☰ Menu</strong> to change account or budget month.
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
                  <th>Description & Account</th>
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
                  const txAccColor = tx.account_color || '#06b6d4';

                  return (
                    <tr
                      key={tx.id}
                      className="tx-row"
                      style={{
                        borderLeft: tx.account_name ? `4px solid ${txAccColor}` : undefined,
                      }}
                    >
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
                        <div className="tx-desc-main-line">
                          <strong>{tx.name}</strong>
                          {tx.account_name && (
                            <span
                              className="tx-account-color-pill"
                              style={{
                                borderColor: txAccColor,
                                backgroundColor: `${txAccColor}1f`,
                                color: txAccColor,
                              }}
                              title={`Paid with ${tx.account_name}${
                                tx.account_mask ? ` (•••• ${tx.account_mask})` : ''
                              }`}
                            >
                              <span
                                className="tx-account-color-dot"
                                style={{ backgroundColor: txAccColor }}
                              />
                              {tx.account_name}
                              {tx.account_mask ? ` ••${tx.account_mask}` : ''}
                            </span>
                          )}
                        </div>
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

                              {summary.accounts?.length > 0 && (
                                <div className="tx-popover-month-picker">
                                  <label>Account / Card Used:</label>
                                  <select
                                    className="input input-sm"
                                    value={tx.account_id || ''}
                                    onChange={(e) =>
                                      handleReassignAccount(tx.id, e.target.value)
                                    }
                                  >
                                    <option value="">No specific account</option>
                                    {summary.accounts.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name} (•••• {a.mask})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {tx.previous_budget_month >= STARTING_MONTH && (
                                <button
                                  type="button"
                                  className="tx-popover-item"
                                  onClick={() => handleAllocateMonth(tx.id, 'prev')}
                                >
                                  <ChevronLeft size={14} />
                                  Allocate to Previous Month ({formatShortMonth(tx.previous_budget_month)})
                                </button>
                              )}

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
                                  min={STARTING_MONTH}
                                  className="input input-sm"
                                  value={tx.budget_month}
                                  onChange={(e) =>
                                    handleAllocateExactMonth(tx.id, e.target.value)
                                  }
                                />
                              </div>

                              {isShifted && tx.original_date_month >= STARTING_MONTH && (
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
                  November 2026 is your starting point. Switch your active budget month or compare monthly income, spending, and subscription changes forward.
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
                        {selectedMonth === STARTING_MONTH && (
                          <span className="pill pill-outline">Starting Point (Nov 2026)</span>
                        )}
                        {selectedMonth > currentCalendarMonth && (
                          <span className="pill pill-amber">Future Month Plan</span>
                        )}
                      </div>
                      <small className="text-muted">
                        Budgets reset cleanly on the 1st of every month starting November 2026.
                      </small>
                    </div>
                  </div>

                  <div className="month-selector-controls">
                    {summary.previous_month >= STARTING_MONTH && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedMonth(summary.previous_month)}
                      >
                        <ChevronLeft size={16} /> {formatShortMonth(summary.previous_month)}
                      </button>
                    )}

                    <input
                      type="month"
                      min={STARTING_MONTH}
                      className="input input-sm month-picker-input"
                      value={selectedMonth}
                      onChange={(e) => {
                        if (e.target.value && e.target.value >= STARTING_MONTH) {
                          setSelectedMonth(e.target.value);
                        }
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
                  Monthly Archive ({filteredHistoryList.length} Month{filteredHistoryList.length === 1 ? '' : 's'})
                </h4>
                {!filteredHistoryList.length ? (
                  <div className="empty-state-box">
                    <p className="text-muted">No monthly history recorded yet.</p>
                  </div>
                ) : (
                  <div className="history-months-grid">
                    {filteredHistoryList.map((mItem) => {
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
                    Linked Institutions ({plaidStatus.linked_items.length})
                  </h4>
                  <div className="accounts-stack">
                    {plaidStatus.linked_items.map((item) => (
                      <div key={item.id || item.item_id} className="account-row-item">
                        <div className="account-meta">
                          <Building2 size={18} className="text-cyan" />
                          <div>
                            <div className="request-badges">
                              <strong>{item.institution_name || 'Linked Bank'}</strong>
                              <span className="pill pill-green" style={{ fontSize: '0.68rem' }}>Connected</span>
                              {item.account_count > 0 && (
                                <span className="pill pill-outline" style={{ fontSize: '0.68rem' }}>
                                  {item.account_count} Account{item.account_count === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            <small className="text-muted" style={{ display: 'block' }}>
                              Linked: {item.created_at ? item.created_at.slice(0, 10) : 'Active'} • ID: <code style={{ fontSize: '0.72rem' }}>{item.item_id ? item.item_id.slice(0, 12) : item.id}...</code>
                            </small>
                          </div>
                        </div>
                        <div className="topbar-right">
                          <button
                            type="button"
                            className="btn btn-danger btn-xs"
                            disabled={plaidBusy}
                            onClick={() => setUnlinkingPlaidItem(item)}
                            title="Unlink and remove this bank connection"
                          >
                            <Trash2 size={13} /> Unlink
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {unlinkingPlaidItem && (
                    <div className="budget-cancel-drawer" style={{ marginTop: '0.85rem' }}>
                      <div className="request-badges">
                        <AlertTriangle size={16} className="text-danger" />
                        <strong>Unlink {unlinkingPlaidItem.institution_name || 'Bank'}?</strong>
                      </div>
                      <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                        This will remove this Plaid connection, delete its accounts, and purge all duplicate transactions and income entries imported from this connection so your budget and balances are no longer overstated.
                      </p>
                      <div className="topbar-right" style={{ marginTop: '0.65rem' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => setUnlinkingPlaidItem(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          disabled={plaidBusy}
                          onClick={() => handleUnlinkPlaidItem(unlinkingPlaidItem)}
                        >
                          {plaidBusy ? 'Unlinking...' : 'Confirm Unlink & Purge Duplicates'}
                        </button>
                      </div>
                    </div>
                  )}
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
                      setShowUserBalancesModal(true);
                    }}
                  >
                    <Users size={14} /> By User Breakdown
                  </button>
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
                    onClick={() => setShowAddAccountForm(true)}
                  >
                    <Plus size={14} /> Add Manual Account
                  </button>
                </div>
              </div>

              {summary.accounts.length === 0 ? (
                <div className="empty-state-box">
                  <p className="text-muted">
                    No bank accounts linked yet. Connect a bank using <strong>Link via Plaid</strong> or click <strong>Add Manual Account</strong>.
                  </p>
                </div>
              ) : (
                <div className="accounts-stack">
                  {summary.accounts.map((acc) => {
                    const acctColor = acc.color || '#06b6d4';
                    const isConfirmingDelete = confirmDeleteAccId === acc.id;
                    return (
                      <div
                        key={acc.id}
                        className="account-row-item"
                        style={{
                          borderLeft: `4px solid ${acctColor}`,
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: '0.55rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div className="account-meta">
                            {acc.type === 'credit' ? (
                              <CreditCard size={20} style={{ color: acctColor }} />
                            ) : (
                              <Wallet size={20} style={{ color: acctColor }} />
                            )}
                            <div>
                              <div className="request-badges">
                                <strong>{acc.name}</strong>
                                {acc.plaid_account_id ? (
                                  <span className="pill pill-cyan" style={{ fontSize: '0.65rem' }}>
                                    Plaid Synced
                                  </span>
                                ) : (
                                  <span className="pill pill-outline" style={{ fontSize: '0.65rem' }}>
                                    Manual
                                  </span>
                                )}
                              </div>
                              <small>
                                {acc.institution_name} •••• {acc.mask} ({acc.subtype})
                                {acc.owner_partner_name ? ` • Assigned to ${acc.owner_partner_name}` : ' • Shared'}
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
                                {acc.owner_partner_name ? acc.owner_partner_name.toUpperCase() : acc.owner_scope.toUpperCase()}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="btn-icon-danger"
                              disabled={deletingAccId === acc.id}
                              onClick={() => setConfirmDeleteAccId(isConfirmingDelete ? null : acc.id)}
                              title="Remove account and delete its synced transactions"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Color Swatches & Owner Controls */}
                        <div className="account-color-picker-row" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.45rem' }}>
                          <span className="owner-assign-label">Ledger Color:</span>
                          <div className="account-color-swatches">
                            {ACCOUNT_COLOR_PALETTE.map((swatch) => (
                              <button
                                key={swatch.hex}
                                type="button"
                                className={`account-color-swatch-btn ${acctColor.toLowerCase() === swatch.hex.toLowerCase() ? 'active' : ''}`}
                                style={{ backgroundColor: swatch.hex }}
                                disabled={updatingAccountColorId === acc.id}
                                onClick={() => handleUpdateAccountColor(acc.id, swatch.hex)}
                                title={`Color code ${acc.name} as ${swatch.label}`}
                              />
                            ))}
                            <label className="account-custom-color-input" title="Pick custom color">
                              <input
                                type="color"
                                value={acctColor}
                                disabled={updatingAccountColorId === acc.id}
                                onChange={(e) => handleUpdateAccountColor(acc.id, e.target.value)}
                              />
                            </label>
                          </div>
                        </div>

                        {isConfirmingDelete && (
                          <div className="account-delete-confirm-box">
                            <p className="text-danger" style={{ fontSize: '0.76rem', margin: '0 0 0.45rem 0' }}>
                              <strong>Remove "{acc.name}"?</strong> Deletes this account, blocks it from re-syncing via Plaid, and purges its transactions.
                            </p>
                            <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-xs"
                                onClick={() => setConfirmDeleteAccId(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-xs"
                                disabled={deletingAccId === acc.id}
                                onClick={() => handleDeleteAccount(acc)}
                              >
                                {deletingAccId === acc.id ? 'Removing...' : 'Confirm Remove'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL: ALL ACCOUNTS & BALANCES BY USER
         ===================================================================== */}
      {showUserBalancesModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowUserBalancesModal(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg user-balances-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Users size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} className="text-cyan" />
                  All Accounts & Balances by User
                </h3>
                <p className="text-muted">
                  Checking, Savings, and Credit balances broken down by user and shared accounts.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowUserBalancesModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
              {/* Household Aggregate KPI Strip */}
              <div className="user-balances-kpi-grid">
                <div className="kpi-card">
                  <span className="kpi-label">Total Checking (Cash)</span>
                  <strong className="kpi-value text-cyan">
                    ${totalHouseholdChecking.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Liquid depository cash</small>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Total Savings (Reserve)</span>
                  <strong className="kpi-value text-green">
                    ${totalHouseholdSavings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Emergency & goal savings</small>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Total Credit Card Debt</span>
                  <strong className="kpi-value text-amber">
                    ${totalHouseholdCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Total credit card liability</small>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Net Liquid Position</span>
                  <strong className={`kpi-value ${totalHouseholdNet >= 0 ? 'text-green' : 'text-danger'}`}>
                    ${totalHouseholdNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                  <small className="kpi-sub">Checking + Savings - Debt</small>
                </div>
              </div>

              {/* Quick Actions & Partner Filter Pills */}
              <div className="user-balances-toolbar">
                <div className="user-balances-filter-tabs">
                  <button
                    type="button"
                    className={`user-filter-tab-pill ${selectedUserFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedUserFilter('all')}
                  >
                    All Household ({accountsList.length})
                  </button>
                  {userGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`user-filter-tab-pill ${selectedUserFilter === g.id ? 'active' : ''}`}
                      onClick={() => setSelectedUserFilter(g.id)}
                    >
                      <span className="user-filter-dot" style={{ backgroundColor: g.color }} />
                      <span>{g.name}</span>
                      <small className="filter-tab-badge">({g.accounts.length})</small>
                    </button>
                  ))}
                </div>

                <div className="topbar-right">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowUserBalancesModal(false);
                      setShowAccountsModal(true);
                      setShowAddAccountForm(true);
                    }}
                  >
                    <Plus size={14} /> Add Manual Account
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setShowUserBalancesModal(false);
                      setShowPlaidModal(true);
                    }}
                  >
                    <Building2 size={14} /> Link via Plaid
                  </button>
                </div>
              </div>

              {/* Empty state if zero accounts */}
              {accountsList.length === 0 ? (
                <div className="empty-state-box" style={{ padding: '2rem 1rem' }}>
                  <Users size={32} className="text-muted" style={{ marginBottom: '0.6rem' }} />
                  <h4>No Accounts Found</h4>
                  <p className="text-muted">
                    No depository or credit accounts are connected yet. Link a bank via Plaid or create a manual account to see balances by user.
                  </p>
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setShowUserBalancesModal(false);
                        setShowPlaidModal(true);
                      }}
                    >
                      <Building2 size={15} /> Connect Bank via Plaid
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowUserBalancesModal(false);
                        setShowAccountsModal(true);
                        setShowAddAccountForm(true);
                      }}
                    >
                      <Plus size={15} /> Add Manual Account
                    </button>
                  </div>
                </div>
              ) : (
                <div className="partner-groups-container">
                  {userGroups
                    .filter((g) => selectedUserFilter === 'all' || g.id === selectedUserFilter)
                    .map((group) => (
                      <div key={group.id} className="partner-balance-group">
                        <div className="partner-balance-group-header">
                          <div className="partner-balance-identity">
                            <div
                              className="partner-avatar-circle"
                              style={{ backgroundColor: group.color }}
                            >
                              {group.isShared ? '👥' : group.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="partner-name-row">
                                <h4>{group.name}</h4>
                                <span className="pill pill-outline">
                                  {group.accounts.length} {group.accounts.length === 1 ? 'Account' : 'Accounts'}
                                </span>
                              </div>
                              <small className="text-muted">
                                {group.isShared
                                  ? 'Joint household funds & shared credit lines'
                                  : `Accounts & cards belonging to ${group.name}`}
                              </small>
                            </div>
                          </div>

                          <div className="partner-group-kpi-chips">
                            <div className="partner-kpi-chip">
                              <span className="kpi-chip-label">Checking</span>
                              <strong className="kpi-chip-val text-cyan">
                                ${group.checkingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </strong>
                            </div>
                            <div className="partner-kpi-chip">
                              <span className="kpi-chip-label">Savings</span>
                              <strong className="kpi-chip-val text-green">
                                ${group.savingsTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </strong>
                            </div>
                            <div className="partner-kpi-chip">
                              <span className="kpi-chip-label">Credit</span>
                              <strong className="kpi-chip-val text-amber">
                                ${group.creditTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </strong>
                            </div>
                            <div className="partner-kpi-chip highlight-chip">
                              <span className="kpi-chip-label">Net Total</span>
                              <strong className={`kpi-chip-val ${group.netTotal >= 0 ? 'text-green' : 'text-danger'}`}>
                                ${group.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </strong>
                            </div>
                          </div>
                        </div>

                        {group.accounts.length === 0 ? (
                          <div className="empty-partner-accounts">
                            <p className="text-muted">
                              No accounts currently assigned to {group.name}.
                              {group.isShared
                                ? ' Any accounts without an assigned partner will show here.'
                                : ` You can assign any account to ${group.name} using the owner selector.`}
                            </p>
                          </div>
                        ) : (
                          <div className="partner-clusters-wrapper">
                            {/* 1. Checking Accounts */}
                            {group.checking.length > 0 && (
                              <div className="account-cluster-block">
                                <div className="account-cluster-title">
                                  <span className="cluster-badge cluster-checking">
                                    <Wallet size={13} /> Checking Accounts ({group.checking.length})
                                  </span>
                                  <span className="cluster-subtotal text-cyan">
                                    ${group.checkingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div className="user-account-cards-grid">
                                  {group.checking.map((acc) => renderUserAccountCard(acc))}
                                </div>
                              </div>
                            )}

                            {/* 2. Savings Accounts */}
                            {group.savings.length > 0 && (
                              <div className="account-cluster-block">
                                <div className="account-cluster-title">
                                  <span className="cluster-badge cluster-savings">
                                    <Building2 size={13} /> Savings Accounts ({group.savings.length})
                                  </span>
                                  <span className="cluster-subtotal text-green">
                                    ${group.savingsTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div className="user-account-cards-grid">
                                  {group.savings.map((acc) => renderUserAccountCard(acc))}
                                </div>
                              </div>
                            )}

                            {/* 3. Credit Cards & Loans */}
                            {group.credit.length > 0 && (
                              <div className="account-cluster-block">
                                <div className="account-cluster-title">
                                  <span className="cluster-badge cluster-credit">
                                    <CreditCard size={13} /> Credit Cards & Debt ({group.credit.length})
                                  </span>
                                  <span className="cluster-subtotal text-amber">
                                    ${group.creditTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div className="user-account-cards-grid">
                                  {group.credit.map((acc) => renderUserAccountCard(acc))}
                                </div>
                              </div>
                            )}

                            {/* 4. Other / Investments */}
                            {group.other.length > 0 && (
                              <div className="account-cluster-block">
                                <div className="account-cluster-title">
                                  <span className="cluster-badge cluster-other">
                                    <BarChart3 size={13} /> Other / Investments ({group.other.length})
                                  </span>
                                  <span className="cluster-subtotal text-primary">
                                    ${group.otherTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                                <div className="user-account-cards-grid">
                                  {group.other.map((acc) => renderUserAccountCard(acc))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="finance-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowUserBalancesModal(false)}
              >
                Close
              </button>
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
          FLOATING MODAL 5: LOG INFLOW / INCOME / RETURN
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
                  Log Inflow or Income for {formatMonthLabel(selectedMonth)}
                </h3>
                <p className="text-muted">
                  Record payroll salary, store returns, credit card payments, or account transfers. Returns restore your category budget; card payments and transfers are excluded from income.
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
                  <label>Inflow Source / Merchant / Employer *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Primary Paycheck, Target Return, Chase Payoff"
                    value={incSource}
                    onChange={(e) => setIncSource(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Amount ($) *</label>
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
                  <label>Inflow Classification *</label>
                  <select
                    className="input"
                    value={incType}
                    onChange={(e) => {
                      setIncType(e.target.value);
                      if (e.target.value === 'return' && !incCategory) {
                        setIncCategory(availableCategories[0] || 'Shopping & Tech');
                      }
                    }}
                  >
                    <optgroup label="Real Earned Income (Counts Toward Monthly Income)">
                      <option value="payroll">Payroll / Salary (Actual Earned Income)</option>
                      <option value="variable">Variable / Commission / Hourly</option>
                      <option value="bonus">Bonus / Commission Payout</option>
                      <option value="side_income">Side Income / Freelance</option>
                      <option value="other">Other Earned Deposit</option>
                    </optgroup>
                    <optgroup label="Store Returns / Refunds (Offsets Category Spend & Restores Budget)">
                      <option value="return">Return / Refund (Offsets Category Spend)</option>
                    </optgroup>
                    <optgroup label="Non-Income Inflows (Excluded from Income)">
                      <option value="cc_payment">Credit Card Payment (Debt Payoff - Excluded)</option>
                      <option value="transfer">Account Transfer (Moving Funds - Excluded)</option>
                    </optgroup>
                  </select>
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
              </div>

              {incType === 'return' && (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label>Category to Credit / Offset *</label>
                  <select
                    className="input"
                    value={incCategory}
                    onChange={(e) => setIncCategory(e.target.value)}
                    required
                  >
                    <option value="">-- Select Category to Credit --</option>
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <small className="text-muted" style={{ display: 'block', marginTop: '0.35rem' }}>
                    ⚖️ <strong>Financial Equilibrium</strong>: This return will NOT inflate your income. Instead, it subtracts from your category's net spend and restores your remaining budget, keeping you protected from overspending.
                  </small>
                </div>
              )}

              {(incType === 'cc_payment' || incType === 'transfer') && (
                <div className="alert alert-info" style={{ marginTop: '0.75rem' }}>
                  <span>
                    ℹ️ Marking this entry as <strong>{incType === 'cc_payment' ? 'Credit Card Payment' : 'Account Transfer'}</strong> ensures it will be completely excluded from your monthly earned income, preventing payments from overstating your budget.
                  </span>
                </div>
              )}

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
                    placeholder="e.g., Target order return, paycheck #1"
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
                  Save Inflow to {formatShortMonth(selectedMonth)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL: CUSTOM PROJECTED INCOME TARGET OVERRIDE
         ===================================================================== */}
      {showProjectionModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowProjectionModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Target size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Projected Income Target for {formatMonthLabel(selectedMonth)}
                </h3>
                <p className="text-muted">
                  Set a custom monthly income target to override the automated historical calculation.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowProjectionModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form className="finance-modal-body" onSubmit={handleSaveCustomProjectedIncome}>
              <div className="projection-status-box">
                <div className="projection-metric-row">
                  <span className="text-muted">Auto-Calculated Projection:</span>
                  <strong>
                    ${Number(summary.auto_projected_income || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
                <small className="text-muted">
                  {summary.projected_income_months_count > 0
                    ? `Calculated from ${summary.projected_income_months_count} prior active month(s) (recurring $${Number(summary.projected_recurring_income || 0).toFixed(0)} + var $${Number(summary.projected_variable_income || 0).toFixed(0)})`
                    : 'No prior months with income found yet; baseline defaults to $0.00'}
                </small>

                {summary.is_custom_projection && (
                  <div className="projection-active-override-badge">
                    <span className="pill pill-primary">
                      Active Custom Override: ${Number(summary.custom_projected_income).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Custom Projected Income Target ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input"
                  placeholder={Number(summary.auto_projected_income || 5000).toFixed(2)}
                  value={customProjInput}
                  onChange={(e) => setCustomProjInput(e.target.value)}
                  required
                  autoFocus
                />
                <small className="text-muted" style={{ display: 'block', marginTop: '0.35rem' }}>
                  This amount serves as the 100% ceiling for your Layered Balance Bar and Budget Overlap checks for {formatShortMonth(selectedMonth)}.
                </small>
              </div>

              <div className="projection-quick-presets">
                {summary.auto_projected_income > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => setCustomProjInput(Number(summary.auto_projected_income).toFixed(2))}
                  >
                    Use Auto (${Number(summary.auto_projected_income).toFixed(2)})
                  </button>
                )}
                {summary.expected_monthly_income > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => setCustomProjInput(Number(summary.expected_monthly_income).toFixed(2))}
                  >
                    Use Expected (${Number(summary.expected_monthly_income).toFixed(2)})
                  </button>
                )}
                {summary.total_monthly_income > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => setCustomProjInput(Number(summary.total_monthly_income).toFixed(2))}
                  >
                    Use Current Actual (${Number(summary.total_monthly_income).toFixed(2)})
                  </button>
                )}
              </div>

              <div className="form-actions" style={{ marginTop: '1.25rem', justifyContent: 'space-between' }}>
                <div>
                  {summary.is_custom_projection && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleClearCustomProjectedIncome}
                      title="Revert back to auto-calculated historical projection"
                    >
                      Revert to Auto Projection
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowProjectionModal(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Target
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL: RECLASSIFY INFLOW / DEPOSIT
         ===================================================================== */}
      {editingIncomeEntry && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setEditingIncomeEntry(null)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <SlidersHorizontal size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Reclassify Inflow / Deposit
                </h3>
                <p className="text-muted">
                  Choose whether this is true earned income, a return offsetting a category, or an excluded card payment/transfer.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setEditingIncomeEntry(null)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form className="finance-modal-body" onSubmit={handleSaveReclassify}>
              <div className="reclassify-source-summary">
                <div>
                  <strong>{editingIncomeEntry.source_name}</strong>
                  <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                    {editingIncomeEntry.date}
                    {editingIncomeEntry.notes ? ` • ${editingIncomeEntry.notes}` : ''}
                  </div>
                </div>
                <strong className="font-mono text-green" style={{ fontSize: '1.1rem' }}>
                  ${Number(editingIncomeEntry.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </strong>
              </div>

              <div className="form-group" style={{ marginTop: '0.9rem' }}>
                <label>Inflow Classification *</label>
                <select
                  className="input"
                  value={editIncType}
                  onChange={(e) => {
                    setEditIncType(e.target.value);
                    if (e.target.value === 'return' && !editIncCategory) {
                      setEditIncCategory(availableCategories[0] || 'Shopping & Tech');
                    }
                  }}
                >
                  <optgroup label="Real Earned Income (Counts Toward Monthly Income)">
                    <option value="payroll">Payroll / Salary (Actual Earned Income)</option>
                    <option value="variable">Variable / Commission / Hourly</option>
                    <option value="bonus">Bonus / Lump Sum Payout</option>
                    <option value="side_income">Side Income / Freelance</option>
                    <option value="other">Other Earned Deposit</option>
                  </optgroup>
                  <optgroup label="Store Returns / Refunds (Offsets Category Spend & Restores Budget)">
                    <option value="return">Return / Refund (Offsets Category Spend)</option>
                  </optgroup>
                  <optgroup label="Non-Income Inflows (Excluded from Income)">
                    <option value="cc_payment">Credit Card Payment (Debt Payoff - Excluded)</option>
                    <option value="transfer">Account Transfer (Moving Funds - Excluded)</option>
                  </optgroup>
                </select>
              </div>

              {editIncType === 'return' && (
                <div className="form-group" style={{ marginTop: '0.85rem' }}>
                  <label>Category to Credit & Offset *</label>
                  <select
                    className="input"
                    value={editIncCategory}
                    onChange={(e) => setEditIncCategory(e.target.value)}
                    required
                  >
                    <option value="">-- Choose Category to Offset --</option>
                    {availableCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <small className="text-muted" style={{ display: 'block', marginTop: '0.35rem' }}>
                    ⚖️ <strong>Financial Equilibrium</strong>: Crediting this category subtracts $
                    {Number(editingIncomeEntry.amount).toFixed(2)} from your category's net spend and restores it to your remaining budget, without inflating your total income ceiling.
                  </small>
                </div>
              )}

              {(editIncType === 'cc_payment' || editIncType === 'transfer') && (
                <div className="alert alert-info" style={{ marginTop: '0.85rem' }}>
                  <span>
                    ℹ️ Marking this entry as <strong>{editIncType === 'cc_payment' ? 'Credit Card Payment' : 'Account Transfer'}</strong> ensures it is completely excluded from your monthly earned income, preventing overstated income.
                  </span>
                </div>
              )}

              <div className="form-actions" style={{ marginTop: '1.2rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingIncomeEntry(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Apply Classification
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
                  <label>Account / Card Used</label>
                  <select
                    className="input"
                    value={txAccountId}
                    onChange={(e) => setTxAccountId(e.target.value)}
                  >
                    <option value="">-- Unlinked / Cash / Manual --</option>
                    {summary.accounts?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.institution_name} •••• {a.mask})
                      </option>
                    ))}
                  </select>
                </div>
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
              </div>

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Notes (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Optional note..."
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                />
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

      {/* =====================================================================
          FLOATING MODAL 7: ADD MANUAL ACCOUNT
         ===================================================================== */}
      {showAddAccountForm && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAddAccountForm(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Wallet size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Add a Manual Bank or Credit Card Account
                </h3>
                <p className="text-muted">
                  Create a checking, savings, or credit card account and choose its ledger color.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAddAccountForm(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <form className="finance-modal-body" onSubmit={handleCreateAccount}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Account Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Joint Checking"
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    required
                    autoFocus
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
              </div>

              <div className="form-grid-3" style={{ marginTop: '0.75rem' }}>
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
              </div>

              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Account Owner</label>
                  <select
                    className="input"
                    value={accOwnerPartnerId}
                    onChange={(e) => setAccOwnerPartnerId(e.target.value)}
                  >
                    <option value="">👥 Shared / Household</option>
                    {summary.partners?.map((p) => (
                      <option key={p.id} value={p.id}>
                        👤 {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Ledger Color</label>
                  <div className="account-color-swatches" style={{ marginTop: '0.35rem' }}>
                    {ACCOUNT_COLOR_PALETTE.map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        className={`account-color-swatch-btn ${accColor.toLowerCase() === swatch.hex.toLowerCase() ? 'active' : ''}`}
                        style={{ backgroundColor: swatch.hex }}
                        onClick={() => setAccColor(swatch.hex)}
                        title={swatch.label}
                      />
                    ))}
                    <label className="account-custom-color-input" title="Pick custom color">
                      <input
                        type="color"
                        value={accColor}
                        onChange={(e) => setAccColor(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddAccountForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 8: CANCEL OR REMOVE CATEGORY BUDGET
         ===================================================================== */}
      {cancellingBudget && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setCancellingBudget(null)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Trash2 size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} className="text-danger" />
                  Cancel "{cancellingBudget.category}" Budget
                </h3>
                <p className="text-muted">
                  Did you cancel a subscription (like Netflix) starting in <strong>{formatMonthLabel(selectedMonth)}</strong>? Past historical months remain intact.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setCancellingBudget(null)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    handleCancelCategoryBudget(cancellingBudget.category, 'this_and_future')
                  }
                >
                  Remove for {formatShortMonth(selectedMonth)} & Future Months
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    handleCancelCategoryBudget(cancellingBudget.category, 'only_this_month')
                  }
                >
                  Remove Only for {formatMonthLabel(selectedMonth)}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCancellingBudget(null)}
                >
                  Keep Category Budget
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING MODAL 9: INFLOW & INCOME ENTRIES FOR SELECTED MONTH
         ===================================================================== */}
      {showIncomeEntriesModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowIncomeEntriesModal(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <DollarSign size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} className="text-green" />
                  Inflow & Income Entries — {formatMonthLabel(selectedMonth)}
                </h3>
                <p className="text-muted">
                  Review payroll deposits, store returns credited to categories, and excluded card payments or transfers.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowIncomeEntriesModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="finance-modal-body">
              <div className="plan-card-header" style={{ marginBottom: '0.75rem' }}>
                <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                  {summary.income_entries?.length || 0} inflow(s) recorded in {formatMonthLabel(selectedMonth)}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    setShowIncomeEntriesModal(false);
                    setShowAddIncome(true);
                  }}
                >
                  <Plus size={13} /> Log Inflow / Income
                </button>
              </div>

              {(!summary.income_entries || summary.income_entries.length === 0) ? (
                <div className="empty-state-box">
                  <p className="text-muted">
                    No inflows or paychecks logged for {formatMonthLabel(selectedMonth)} yet.
                  </p>
                </div>
              ) : (
                <div className="income-entries-list">
                  {summary.income_entries.map((inc) => {
                    const diff = Number(inc.amount) - Number(inc.expected_monthly_amount || inc.amount);
                    const typeInfo = formatIncomeTypeBadge(inc.income_type, inc.category);
                    const isEarned = !['return', 'cc_payment', 'transfer'].includes(inc.income_type);
                    const acctColor = inc.account_color || '#06b6d4';
                    return (
                      <div
                        key={inc.id}
                        className="income-entry-row"
                        style={inc.account_name ? { borderLeft: `4px solid ${acctColor}` } : undefined}
                      >
                        <div className="income-entry-meta">
                          <div className="request-badges">
                            <strong>{inc.source_name}</strong>
                            <span className={`pill ${typeInfo.cls}`} style={{ fontSize: '0.68rem' }}>
                              {typeInfo.label}
                            </span>
                            {inc.account_name && (
                              <span
                                className="tx-account-color-pill"
                                style={{
                                  borderColor: acctColor,
                                  color: acctColor,
                                  backgroundColor: `${acctColor}18`,
                                }}
                              >
                                <span
                                  className="tx-account-color-dot"
                                  style={{ backgroundColor: acctColor }}
                                />
                                {inc.account_name}
                              </span>
                            )}
                          </div>
                          <small className="text-muted">
                            {inc.date}
                            {inc.notes ? ` • ${inc.notes}` : ''}
                            {isEarned && Math.abs(diff) >= 0.01 && (
                              <span className={diff > 0 ? 'text-green' : 'text-amber'}>
                                {' '}
                                ({diff > 0 ? '+' : ''}${diff.toFixed(2)} vs expected $
                                {Number(inc.expected_monthly_amount).toFixed(2)})
                              </span>
                            )}
                            {inc.income_type === 'return' && inc.category && (
                              <span className="text-cyan">
                                {' '}• Credited back to {inc.category} budget
                              </span>
                            )}
                            {(inc.income_type === 'cc_payment' || inc.income_type === 'transfer') && (
                              <span className="text-muted">
                                {' '}• Excluded from monthly income
                              </span>
                            )}
                          </small>
                        </div>
                        <div className="topbar-right">
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => openReclassifyModal(inc)}
                            title="Change classification (Payroll, Return, Credit Card Payment, Transfer)"
                          >
                            <SlidersHorizontal size={12} /> Reclassify
                          </button>
                          <strong
                            className={`font-mono ${
                              inc.income_type === 'return'
                                ? 'text-cyan'
                                : isEarned
                                ? 'text-green'
                                : 'text-muted'
                            }`}
                          >
                            {isEarned ? '+' : ''}$
                            {Number(inc.amount).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                            })}
                          </strong>
                          <button
                            type="button"
                            className="btn-icon-danger"
                            onClick={() => handleDeleteIncome(inc.id)}
                            title="Remove inflow entry"
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

            <div className="finance-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowIncomeEntriesModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
