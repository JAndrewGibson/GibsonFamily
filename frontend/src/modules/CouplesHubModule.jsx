import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  FileHeart,
  Fingerprint,
  Layers,
  Plus,
  RotateCcw,
  ShoppingCart,
  Square,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import InfoTip from '../components/InfoTip';

export function AdminDocsSubModule({ activePartner, partners, onDataChanged, syncVersion }) {
  const [records, setRecords] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [recordType, setRecordType] = useState('medical');
  const [ownerId, setOwnerId] = useState(activePartner?.id || partners[0]?.id || 1);
  const [dueDate, setDueDate] = useState('');
  const [provider, setProvider] = useState('');
  const [notes, setNotes] = useState('');

  const loadRecords = async () => {
    const data = await apiFetch('/api/hub/admin-records');
    setRecords(data.records || []);
  };

  useEffect(() => {
    loadRecords();
  }, [syncVersion]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title) return;
    await apiFetch('/api/hub/admin-records', {
      method: 'POST',
      body: JSON.stringify({
        title,
        record_type: recordType,
        owner_partner_id: Number(ownerId),
        due_or_renewal_date: dueDate || null,
        provider_or_location: provider,
        notes,
      }),
    });
    setTitle('');
    setProvider('');
    setNotes('');
    setShowAddModal(false);
    await loadRecords();
    onDataChanged?.();
  };

  const handleStatusChange = async (id, status) => {
    await apiFetch(`/api/hub/admin-records/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    await loadRecords();
    onDataChanged?.();
  };

  const handleDelete = async (id) => {
    await apiFetch(`/api/hub/admin-records/${id}`, { method: 'DELETE' });
    await loadRecords();
    onDataChanged?.();
  };

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>Admin &amp; Medical</h2>
          <InfoTip text="Keep medical forms, HSA claims, open enrollment deadlines, insurance policies, and household documents organized in one place." />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={18} /> Add Record
        </button>
      </div>

      {showAddModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h3 style={{ margin: 0 }}>Add Record</h3>
                <InfoTip text="Track medical paperwork, insurance renewals, tax filings, or household documents." />
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleAdd}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Document or Admin Item *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Submit Dental Claim / HSA Receipt"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="input"
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value)}
                  >
                    <option value="medical">Medical & Health Paperwork</option>
                    <option value="insurance">Insurance Policy / Claim</option>
                    <option value="tax">Taxes & Financial Docs</option>
                    <option value="legal">Legal / ID / Passport</option>
                    <option value="home">Home Maintenance & Warranties</option>
                  </select>
                </div>
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Assigned Partner</label>
                  <select
                    className="input"
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                  >
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Due / Renewal Date</label>
                  <input
                    type="date"
                    className="input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Provider / Portal / Location</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., BlueShield Portal, Valley Medical, Filing Cabinet"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Policy #, instructions, or next step..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> Add Admin / Medical Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div className="card empty-state-card">
          <h3>No Medical or Admin Records Yet</h3>
          <p className="text-muted">
            Click <strong>Add Admin / Medical Record</strong> above to track medical paperwork, insurance renewals, tax filings, or household documents.
          </p>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={16} /> Add First Admin / Medical Record
            </button>
          </div>
        </div>
      ) : (
        <div className="plans-grid">
          {records.map((rec) => (
            <div key={rec.id} className="card admin-record-card">
              <div className="plan-card-header">
                <div>
                  <div className="request-badges">
                    <span className="pill pill-cyan">{rec.record_type.toUpperCase()}</span>
                    <span className="pill pill-outline">Owner: {rec.owner_name}</span>
                    {rec.due_or_renewal_date && (
                      <span className="pill pill-amber">Due: {rec.due_or_renewal_date}</span>
                    )}
                  </div>
                  <h3>{rec.title}</h3>
                </div>
                <button
                  type="button"
                  className="btn-icon-danger"
                  onClick={() => handleDelete(rec.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {rec.provider_or_location && (
                <p className="text-muted">
                  <strong>Provider / Location:</strong> {rec.provider_or_location}
                </p>
              )}
              {rec.notes && <p className="request-description">{rec.notes}</p>}
              <div className="admin-status-row">
                <label>Status:</label>
                <select
                  className="input input-sm"
                  value={rec.status}
                  onChange={(e) => handleStatusChange(rec.id, e.target.value)}
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="renewal_needed">Renewal Needed</option>
                  <option value="completed">Completed / Filed</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TodosSubModule({ activePartner, partners, onDataChanged, syncVersion }) {
  const [todos, setTodos] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Household');
  const [assignedTo, setAssignedTo] = useState(activePartner?.id || partners[0]?.id || 1);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');

  const loadTodos = async () => {
    const data = await apiFetch('/api/hub/todos');
    setTodos(data.todos || []);
  };

  useEffect(() => {
    loadTodos();
  }, [syncVersion]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!title) return;
    await apiFetch('/api/hub/todos', {
      method: 'POST',
      body: JSON.stringify({
        title,
        category,
        assigned_to: Number(assignedTo),
        due_date: dueDate || null,
        priority,
      }),
    });
    setTitle('');
    setShowAddModal(false);
    await loadTodos();
    onDataChanged?.();
  };

  const handleToggle = async (id) => {
    await apiFetch(`/api/hub/todos/${id}/toggle`, { method: 'PUT' });
    await loadTodos();
    onDataChanged?.();
  };

  const handleDelete = async (id) => {
    await apiFetch(`/api/hub/todos/${id}`, { method: 'DELETE' });
    await loadTodos();
    onDataChanged?.();
  };

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>To-Do List</h2>
          <InfoTip text="Coordinate errands, household chores, financial check-ins, and medical follow-ups together." />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={18} /> Add Task
        </button>
      </div>

      {showAddModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h3 style={{ margin: 0 }}>Add Task</h3>
                <InfoTip text="Assign a household, finance, or medical errand to a partner." />
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleAdd}>
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Schedule furnace tune-up"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="Household">Household</option>
                    <option value="Finance">Finance</option>
                    <option value="Medical Admin">Medical Admin</option>
                    <option value="Errands">Errands</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Assigned Partner</label>
                  <select
                    className="input"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                  >
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Due Date (Optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    className="input"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> Add Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        {todos.length === 0 ? (
          <p className="text-muted">No shared tasks yet. Click "Add Task" above to add your first to-do item!</p>
        ) : (
          <div className="checklist-stack">
            {todos.map((t) => (
              <div key={t.id} className={`checklist-row ${t.completed ? 'completed' : ''}`}>
                <button
                  type="button"
                  className="check-btn"
                  onClick={() => handleToggle(t.id)}
                >
                  {t.completed ? <CheckSquare size={20} /> : <Square size={20} />}
                </button>
                <div className="checklist-main">
                  <strong>{t.title}</strong>
                  <div className="request-badges">
                    <span className="pill pill-outline">{t.category}</span>
                    <span className="pill pill-outline">{t.assigned_name}</span>
                    {t.due_date && <span className="pill pill-outline">Due {t.due_date}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-icon-danger"
                  onClick={() => handleDelete(t.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function GroceriesSubModule({ activePartner, onDataChanged, syncVersion }) {
  const [groceries, setGroceries] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [totals, setTotals] = useState({ estimated_total: 0, unchecked_total: 0 });
  const [name, setName] = useState('');
  const [aisle, setAisle] = useState('Produce');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');

  const loadGroceries = async () => {
    const data = await apiFetch('/api/hub/groceries');
    setGroceries(data.items || []);
    setTotals({
      estimated_total: data.estimated_total || 0,
      unchecked_total: data.unchecked_total || 0,
    });
  };

  useEffect(() => {
    loadGroceries();
  }, [syncVersion]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name) return;
    await apiFetch('/api/hub/groceries', {
      method: 'POST',
      body: JSON.stringify({
        name,
        aisle_category: aisle,
        quantity,
        estimated_price: parseFloat(price || 0),
        added_by: activePartner?.id || 1,
      }),
    });
    setName('');
    setPrice('');
    setShowAddModal(false);
    await loadGroceries();
    onDataChanged?.();
  };

  const handleToggle = async (id) => {
    await apiFetch(`/api/hub/groceries/${id}/toggle`, { method: 'PUT' });
    await loadGroceries();
    onDataChanged?.();
  };

  const handleClearChecked = async () => {
    await apiFetch('/api/hub/groceries/clear-checked', { method: 'POST' });
    await loadGroceries();
    onDataChanged?.();
  };

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>Groceries</h2>
          <InfoTip text="Add groceries from either phone or laptop — automatically estimates your weekly grocery run cost against your Groceries budget." />
        </div>
        <div className="topbar-right">
          {groceries.some((g) => g.checked) && (
            <button type="button" className="btn btn-secondary" onClick={handleClearChecked}>
              Clear Checked
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={18} /> Add Item
          </button>
        </div>
      </div>

      <div className="kpi-grid-2">
        <div className="kpi-card">
          <span className="kpi-label">Remaining Cart</span>
          <strong className="kpi-value text-green">${totals.unchecked_total.toFixed(2)}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total List</span>
          <strong className="kpi-value">${totals.estimated_total.toFixed(2)}</strong>
          <small className="kpi-sub">{groceries.length} items</small>
        </div>
      </div>

      {showAddModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Add Item</h3>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleAdd}>
              <div className="form-group">
                <label>Grocery Item *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Pasture-Raised Eggs"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Aisle / Section</label>
                  <select className="input" value={aisle} onChange={(e) => setAisle(e.target.value)}>
                    <option value="Produce">Produce</option>
                    <option value="Dairy & Refrigerated">Dairy & Refrigerated</option>
                    <option value="Meat & Seafood">Meat & Seafood</option>
                    <option value="Bakery">Bakery</option>
                    <option value="Pantry & Dry Goods">Pantry & Dry Goods</option>
                    <option value="Beverages">Beverages</option>
                    <option value="Household Essentials">Household Essentials</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Quantity</label>
                  <input
                    type="text"
                    className="input"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="1 dozen"
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Est. Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="6.99"
                />
              </div>
              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> Add to List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        {groceries.length === 0 ? (
          <p className="text-muted">Your shared grocery list is empty. Add items above!</p>
        ) : (
          <div className="checklist-stack">
            {groceries.map((g) => (
              <div key={g.id} className={`checklist-row ${g.checked ? 'completed' : ''}`}>
                <button
                  type="button"
                  className="check-btn"
                  onClick={() => handleToggle(g.id)}
                >
                  {g.checked ? <CheckSquare size={20} /> : <Square size={20} />}
                </button>
                <div className="checklist-main">
                  <strong>
                    {g.name} <span className="text-muted">({g.quantity})</span>
                  </strong>
                  <div className="request-badges">
                    <span className="pill pill-outline">{g.aisle_category}</span>
                    {g.added_by_name && (
                      <span className="pill pill-outline">Added by {g.added_by_name}</span>
                    )}
                  </div>
                </div>
                <strong className="font-mono">${Number(g.estimated_price || 0).toFixed(2)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ModuleManagerSubModule({
  modules,
  partners,
  activePartner,
  householdName,
  startingBudgetMonth,
  theme = 'system',
  onChangeTheme,
  onToggleModule,
  onRefreshState,
  onOpenPasskeyModal,
}) {
  const [editingPartner, setEditingPartner] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [editAllowance, setEditAllowance] = useState(0);
  const [familyNameInput, setFamilyNameInput] = useState(householdName || '');
  const [savingHousehold, setSavingHousehold] = useState(false);
  const [householdSavedMsg, setHouseholdSavedMsg] = useState('');
  const [startMonthInput, setStartMonthInput] = useState(
    startingBudgetMonth || new Date().toISOString().slice(0, 7)
  );
  const [savingStartMonth, setSavingStartMonth] = useState(false);
  const [startMonthSavedMsg, setStartMonthSavedMsg] = useState('');

  useEffect(() => {
    setFamilyNameInput(householdName || '');
  }, [householdName]);

  useEffect(() => {
    if (startingBudgetMonth) {
      setStartMonthInput(startingBudgetMonth);
    }
  }, [startingBudgetMonth]);

  const handleSaveHouseholdName = async (e) => {
    e.preventDefault();
    if (!familyNameInput.trim()) return;
    setSavingHousehold(true);
    setHouseholdSavedMsg('');
    try {
      await apiFetch('/api/auth/household', {
        method: 'PUT',
        body: JSON.stringify({ household_name: familyNameInput.trim() }),
      });
      setHouseholdSavedMsg('Saved!');
      await onRefreshState?.();
    } finally {
      setSavingHousehold(false);
    }
  };

  const handleSaveStartMonth = async (e) => {
    e.preventDefault();
    if (!startMonthInput) return;
    setSavingStartMonth(true);
    setStartMonthSavedMsg('');
    try {
      await apiFetch('/api/auth/household', {
        method: 'PUT',
        body: JSON.stringify({ starting_budget_month: startMonthInput }),
      });
      setStartMonthSavedMsg('Saved!');
      await onRefreshState?.();
    } finally {
      setSavingStartMonth(false);
    }
  };

  const startEditPartner = (p) => {
    setEditingPartner(p.id);
    setEditName(p.name);
    setEditEmail(p.email || '');
    setEditColor(p.avatar_color || '#6366f1');
    setEditAllowance(p.monthly_fun_allowance || 0);
  };

  const handleSavePartner = async (e) => {
    e.preventDefault();
    if (!editingPartner || !editName.trim()) return;
    await apiFetch(`/api/auth/partners/${editingPartner}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: editName.trim(),
        email: editEmail.trim(),
        avatar_color: editColor,
        monthly_fun_allowance: parseFloat(editAllowance || 0),
      }),
    });
    setEditingPartner(null);
    await onRefreshState?.();
  };

  const handleResetWorkspace = async () => {
    if (
      !window.confirm(
        'Reset all household data and return to the Step 1 First-Time Setup Wizard?'
      )
    ) {
      return;
    }
    await apiFetch('/api/auth/reset-all', { method: 'POST' });
    await onRefreshState?.();
  };

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>Settings</h2>
          <InfoTip text="Customize appearance, family branding, partner profiles, and active modules." />
        </div>
        <button
          type="button"
          className="btn btn-danger-outline btn-sm"
          onClick={handleResetWorkspace}
          title="Reset & Re-Run First-Time Setup"
        >
          <RotateCcw size={15} /> Reset Setup
        </button>
      </div>

      <div className="card">
        <h3>Appearance &amp; Branding</h3>
        <div className="plans-grid" style={{ marginTop: '0.85rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-theme-select">Color Theme</label>
            <select
              id="settings-theme-select"
              className="input"
              value={theme}
              onChange={(e) => onChangeTheme?.(e.target.value)}
            >
              <option value="system">Follow Device Settings</option>
              <option value="dark">Dark Mode</option>
              <option value="light">Light Mode</option>
            </select>
          </div>
          <form className="form-group" style={{ marginBottom: 0 }} onSubmit={handleSaveHouseholdName}>
            <label htmlFor="settings-family-name">Family / Last Name (used for app branding)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="settings-family-name"
                type="text"
                className="input"
                placeholder="e.g., Smith"
                value={familyNameInput}
                onChange={(e) => setFamilyNameInput(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingHousehold}>
                {savingHousehold ? 'Saving...' : 'Save'}
              </button>
            </div>
            {householdSavedMsg && (
              <small className="text-success" style={{ marginTop: '0.25rem', display: 'block' }}>
                {householdSavedMsg}
              </small>
            )}
          </form>
          <form className="form-group" style={{ marginBottom: 0 }} onSubmit={handleSaveStartMonth}>
            <label htmlFor="settings-start-month">Beginning Budget Month</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="settings-start-month"
                type="month"
                className="input"
                value={startMonthInput}
                onChange={(e) => setStartMonthInput(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingStartMonth}>
                {savingStartMonth ? 'Saving...' : 'Save'}
              </button>
            </div>
            {startMonthSavedMsg && (
              <small className="text-success" style={{ marginTop: '0.25rem', display: 'block' }}>
                {startMonthSavedMsg}
              </small>
            )}
          </form>
          {onOpenPasskeyModal && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>WebAuthn Passkeys &amp; Biometric Lock</label>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onOpenPasskeyModal}
                >
                  <Fingerprint size={15} />
                  Manage Passkeys ({activePartner?.passkeys?.length || 0})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Couple Profiles</h3>
        <div className="plans-grid" style={{ marginTop: '0.85rem' }}>
          {partners.map((p) => (
            <div key={p.id} className="partner-setup-box">
              {editingPartner === p.id ? (
                <form className="module-container" onSubmit={handleSavePartner}>
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      type="text"
                      className="input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Email / Handle</label>
                    <input
                      type="text"
                      className="input"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                    />
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>
                        {editName.trim()
                          ? `${editName.trim().split(' ')[0]}'s Spending Money ($/mo)`
                          : "Spending Money ($/mo)"}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        className="input"
                        value={editAllowance}
                        onChange={(e) => setEditAllowance(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Color</label>
                      <input
                        type="color"
                        className="input color-input"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditingPartner(null)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <div className="plan-card-header">
                  <div className="enrolled-passkey-meta">
                    <div
                      className="partner-avatar"
                      style={{ background: p.avatar_color }}
                    >
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <strong>{p.name}</strong>
                      <small className="text-muted">
                        {p.email || p.role} • {p.name.split(' ')[0]}&apos;s Spending Money: ${Number(p.monthly_fun_allowance || 0).toFixed(0)}/mo
                      </small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEditPartner(p)}
                  >
                    <UserCheck size={14} /> Edit Profile
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <h3>Installed Application Modules</h3>
      <div className="plans-grid">
        {modules
          .filter((mod) => !mod.parent_id)
          .map((mod) => {
            const childModules = modules.filter((c) => c.parent_id === mod.id);
            return (
              <div key={mod.id} className="card">
                <div className="plan-card-header">
                  <div>
                    <span className="pill pill-outline">{mod.category}</span>
                    <h3>{mod.name}</h3>
                  </div>
                  <span className={`pill ${mod.enabled ? 'pill-green' : 'pill-amber'}`}>
                    {mod.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-muted">{mod.description}</p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onToggleModule(mod.id)}
                  >
                    <Layers size={15} />
                    {mod.enabled ? 'Hide from Sidebar' : 'Enable in Sidebar'}
                  </button>
                </div>

                {childModules.length > 0 && (
                  <div
                    style={{
                      marginTop: '1rem',
                      paddingTop: '0.85rem',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.55rem',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Individual {mod.name} Modules
                    </span>
                    {childModules.map((sub) => (
                      <div
                        key={sub.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.65rem',
                          padding: '0.55rem 0.7rem',
                          borderRadius: '8px',
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <strong style={{ fontSize: '0.88rem' }}>{sub.name}</strong>
                            <span
                              className={`pill ${sub.enabled ? 'pill-green' : 'pill-amber'}`}
                              style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem' }}
                            >
                              {sub.enabled ? 'Active' : 'Disabled'}
                            </span>
                          </div>
                          <small className="text-muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                            {sub.description}
                          </small>
                        </div>
                        <button
                          type="button"
                          className={`btn btn-sm ${sub.enabled ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => onToggleModule(sub.id)}
                          style={{ flexShrink: 0 }}
                        >
                          {sub.enabled ? 'Disable' : 'Activate'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
