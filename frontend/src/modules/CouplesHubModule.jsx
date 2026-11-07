import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  FileHeart,
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
      <div className="section-header-bar">
        <div>
          <h2>Couples Admin & Medical Paperwork</h2>
          <p className="text-muted">
            Keep medical forms, HSA claims, open enrollment deadlines, insurance policies, and household documents organized in one place.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={18} /> Add Admin / Medical Record
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
              <div>
                <h3>Add Medical Paperwork or Couples Admin Task</h3>
                <p className="text-muted">
                  Track medical paperwork, insurance renewals, tax filings, or household documents.
                </p>
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
      <div className="section-header-bar">
        <div>
          <h2>Shared Couples To-Do List</h2>
          <p className="text-muted">
            Coordinate errands, household chores, financial check-ins, and medical follow-ups together.
          </p>
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
              <div>
                <h3>Add Shared Couples Task</h3>
                <p className="text-muted">
                  Assign a household, finance, or medical errand to a partner.
                </p>
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
      <div className="section-header-bar">
        <div>
          <h2>Shared Grocery List & Basket Estimator</h2>
          <p className="text-muted">
            Add groceries from either phone or laptop — automatically estimates your weekly grocery run cost against your Groceries budget.
          </p>
        </div>
        <div className="topbar-right">
          {groceries.some((g) => g.checked) && (
            <button type="button" className="btn btn-secondary" onClick={handleClearChecked}>
              Clear Checked Items
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={18} /> Add Grocery Item
          </button>
        </div>
      </div>

      <div className="kpi-grid-2">
        <div className="kpi-card">
          <span className="kpi-label">Remaining Cart Estimate</span>
          <strong className="kpi-value text-green">${totals.unchecked_total.toFixed(2)}</strong>
          <small className="kpi-sub">Unchecked items left to pick up</small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total List Estimate</span>
          <strong className="kpi-value">${totals.estimated_total.toFixed(2)}</strong>
          <small className="kpi-sub">{groceries.length} items on list</small>
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
                <h3>Add Grocery Item</h3>
                <p className="text-muted">
                  Add an item to your shared household shopping list.
                </p>
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
  onToggleModule,
  onRefreshState,
}) {
  const [editingPartner, setEditingPartner] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [editAllowance, setEditAllowance] = useState(0);

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
      <div className="section-header-bar">
        <div>
          <h2>Modules, Partner Profiles & Workspace Settings</h2>
          <p className="text-muted">
            Enable or disable modules dynamically, update partner profiles, or re-run the initial setup wizard.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-danger-outline btn-sm"
          onClick={handleResetWorkspace}
        >
          <RotateCcw size={15} /> Reset & Re-Run First-Time Setup
        </button>
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
                      <label>Monthly Allowance ($)</label>
                      <input
                        type="number"
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
                        {p.email || p.role} • Allowance: ${Number(p.monthly_fun_allowance || 0).toFixed(0)}/mo
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
        {modules.map((mod) => (
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
          </div>
        ))}
      </div>
    </div>
  );
}
