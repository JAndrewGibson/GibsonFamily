import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Link2,
  PieChart,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../api';

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

export default function FinanceModule({ activePartner, onDataChanged }) {
  const [summary, setSummary] = useState(null);
  const [plaidStatus, setPlaidStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [plaidBanner, setPlaidBanner] = useState(null);
  const [selectedSandboxBank, setSelectedSandboxBank] = useState(SANDBOX_BANKS[0].id);

  // Forms
  const [showAddTx, setShowAddTx] = useState(false);
  const [txName, setTxName] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('Groceries & Dining');
  const [txAccountId, setTxAccountId] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txNotes, setTxNotes] = useState('');

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCat, setBudgetCat] = useState('Groceries & Dining');
  const [budgetLimit, setBudgetLimit] = useState('800');

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState('depository');
  const [accSubtype, setAccSubtype] = useState('checking');
  const [accBalance, setAccBalance] = useState('');
  const [accInstitution, setAccInstitution] = useState('');
  const [accMask, setAccMask] = useState('');

  const loadFinanceData = async () => {
    setLoading(true);
    try {
      const [sumData, pStatus] = await Promise.all([
        apiFetch('/api/finance/summary'),
        apiFetch('/api/finance/plaid/status'),
      ]);
      setSummary(sumData);
      setPlaidStatus(pStatus);
      if (sumData.accounts?.length && !txAccountId) {
        setTxAccountId(String(sumData.accounts[0].id));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFinanceData();
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
        text: `Connected "${res.institution_name}" via Plaid Sandbox! Imported ${res.imported_accounts} accounts and ${res.imported_transactions} transactions.`,
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
    await apiFetch('/api/finance/transactions', {
      method: 'POST',
      body: JSON.stringify({
        account_id: txAccountId ? Number(txAccountId) : null,
        name: txName,
        amount: parseFloat(txAmount),
        category: txCategory,
        date: txDate,
        partner_id: activePartner?.id || null,
        notes: txNotes,
      }),
    });
    setTxName('');
    setTxAmount('');
    setTxNotes('');
    setShowAddTx(false);
    await loadFinanceData();
    onDataChanged?.();
  };

  const handleSaveBudget = async (e) => {
    e.preventDefault();
    if (!budgetCat || !budgetLimit) return;
    await apiFetch('/api/finance/budgets', {
      method: 'POST',
      body: JSON.stringify({
        category: budgetCat,
        monthly_limit: parseFloat(budgetLimit),
      }),
    });
    setShowBudgetModal(false);
    await loadFinanceData();
  };

  const handleDeleteBudget = async (budgetId) => {
    await apiFetch(`/api/finance/budgets/${budgetId}`, { method: 'DELETE' });
    await loadFinanceData();
  };

  const handleDeleteTx = async (txId) => {
    await apiFetch(`/api/finance/transactions/${txId}`, { method: 'DELETE' });
    await loadFinanceData();
  };

  if (loading || !summary) {
    return <div className="card">Loading financial dashboard...</div>;
  }

  const availableCategories = Array.from(
    new Set([
      ...DEFAULT_CATEGORIES,
      ...(summary.budgets || []).map((b) => b.category),
    ])
  );

  return (
    <div className="module-container">
      <div className="section-header-bar">
        <div>
          <h2>Family Finances, Budgets & Plaid Banking</h2>
          <p className="text-muted">
            Link bank accounts via Plaid, manage monthly category budgets, and track shared or individual expenses.
          </p>
        </div>
        <div className="header-actions-group">
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
            onClick={() => setShowBudgetModal(!showBudgetModal)}
          >
            <PieChart size={16} /> Add / Edit Budget
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

      {/* Plaid Status & Connection Bar */}
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
        </div>
      </div>

      {plaidBanner && (
        <div className={`alert ${plaidBanner.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          {plaidBanner.text}
        </div>
      )}

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
          <span className="kpi-label">Credit Card Balances</span>
          <strong className="kpi-value text-amber">
            ${summary.credit_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
          <small className="kpi-sub">Current Credit Utilization</small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Monthly Budget Spent</span>
          <strong className="kpi-value">
            ${summary.total_monthly_spent.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
          <small className="kpi-sub">
            of ${summary.total_monthly_budget.toLocaleString('en-US', { minimumFractionDigits: 0 })} monthly limit
          </small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Net Liquid Position</span>
          <strong className="kpi-value text-cyan">
            ${summary.net_liquid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
          <small className="kpi-sub">Cash minus credit balances</small>
        </div>
      </div>

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
          <h3>Add or Update Monthly Category Budget</h3>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Category Name</label>
              <input
                type="text"
                className="input"
                list="budget-category-suggestions"
                value={budgetCat}
                onChange={(e) => setBudgetCat(e.target.value)}
                placeholder="e.g., Groceries & Dining"
                required
              />
              <datalist id="budget-category-suggestions">
                {DEFAULT_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label>Monthly Limit ($)</label>
              <input
                type="number"
                step="10"
                className="input"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                required
              />
            </div>
            <div className="form-group form-group-end">
              <button type="submit" className="btn btn-primary">
                Save Budget Limit
              </button>
            </div>
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
              <label>Budget Category</label>
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
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                className="input"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
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

      <div className="finance-two-col">
        {/* Monthly Category Budgets */}
        <div className="card">
          <div className="plan-card-header">
            <h3>Monthly Category Budgets</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowBudgetModal(true)}
            >
              <Plus size={14} /> Add Category
            </button>
          </div>
          {summary.budgets.length === 0 ? (
            <div className="empty-state-box">
              <p className="text-muted">
                No monthly budgets set up yet. Click <strong>Add Category</strong> to create your first budget limit.
              </p>
            </div>
          ) : (
            <div className="budgets-stack">
              {summary.budgets.map((b) => {
                const over = b.spent > b.monthly_limit;
                return (
                  <div key={b.id} className="budget-row-item">
                    <div className="budget-row-top">
                      <strong>{b.category}</strong>
                      <div className="topbar-right">
                        <span>
                          <strong>${b.spent.toFixed(2)}</strong> / ${b.monthly_limit.toFixed(0)} (
                          {b.utilization_pct}%)
                        </span>
                        <button
                          type="button"
                          className="btn-icon-danger"
                          onClick={() => handleDeleteBudget(b.id)}
                          title="Remove budget category"
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
                        ? `Over budget by $${Math.abs(b.remaining).toFixed(2)}`
                        : `$${b.remaining.toFixed(2)} remaining this month`}
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
                No bank accounts linked yet. Connect a bank above using <strong>Plaid</strong> or click <strong>Add Account</strong>.
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

      {/* Recent Transactions */}
      <div className="card">
        <div className="plan-card-header">
          <h3>Transactions Ledger</h3>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddTx(true)}
          >
            <Plus size={14} /> Log Expense
          </button>
        </div>
        {summary.transactions.length === 0 ? (
          <div className="empty-state-box">
            <p className="text-muted">
              No transactions recorded yet. Connect a Plaid bank account to import transactions automatically, or click <strong>Log Expense</strong>.
            </p>
          </div>
        ) : (
          <div className="tx-table-wrapper">
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Partner</th>
                  <th className="text-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {summary.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.date}</td>
                    <td>
                      <strong>{tx.name}</strong>
                      {tx.notes && <small className="tx-note"> — {tx.notes}</small>}
                    </td>
                    <td>
                      <span className="pill pill-outline">{tx.category}</span>
                    </td>
                    <td>{tx.partner_name || 'Shared'}</td>
                    <td className="text-right font-mono">${Number(tx.amount).toFixed(2)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-icon-danger"
                        onClick={() => handleDeleteTx(tx.id)}
                        title="Delete transaction"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
