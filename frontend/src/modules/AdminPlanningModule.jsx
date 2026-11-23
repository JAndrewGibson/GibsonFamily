import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckSquare,
  ClipboardList,
  Edit3,
  FileText,
  FolderPlus,
  Plus,
  ShoppingBag,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import InfoTip from '../components/InfoTip';

const PROJECT_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#a855f7',
  '#ef4444',
];

export default function AdminPlanningModule({
  activePartner,
  partners,
  onDataChanged,
  syncVersion,
}) {
  const [subTab, setSubTab] = useState('projects'); // 'projects' | 'todos'
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [standaloneTodos, setStandaloneTodos] = useState([]);
  const [todoScope, setTodoScope] = useState('standalone'); // 'standalone' | 'all'

  // Create Project modal
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projTitle, setProjTitle] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projTargetDate, setProjTargetDate] = useState('');
  const [projColor, setProjColor] = useState('#6366f1');

  // Project Detail quick-add states
  const [shopName, setShopName] = useState('');
  const [shopQty, setShopQty] = useState('1');
  const [shopPrice, setShopPrice] = useState('');
  const [shopNotes, setShopNotes] = useState('');

  const [projTodoTitle, setProjTodoTitle] = useState('');
  const [projTodoAssigned, setProjTodoAssigned] = useState(
    activePartner?.id || partners[0]?.id || 1
  );
  const [projTodoDue, setProjTodoDue] = useState('');

  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editNoteTitle, setEditNoteTitle] = useState('');
  const [editNoteContent, setEditNoteContent] = useState('');

  // Standalone To-Do modal
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoCategory, setTodoCategory] = useState('Household');
  const [todoAssigned, setTodoAssigned] = useState(
    activePartner?.id || partners[0]?.id || 1
  );
  const [todoDue, setTodoDue] = useState('');
  const [todoPriority, setTodoPriority] = useState('medium');

  const loadData = async () => {
    const [pData, tData] = await Promise.all([
      apiFetch('/api/hub/projects'),
      apiFetch(`/api/hub/todos?scope=${todoScope}`),
    ]);
    setProjects(pData.projects || []);
    setStandaloneTodos(tData.todos || []);
  };

  useEffect(() => {
    loadData();
  }, [syncVersion, todoScope]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!projTitle.trim()) return;
    const created = await apiFetch('/api/hub/projects', {
      method: 'POST',
      body: JSON.stringify({
        title: projTitle.trim(),
        description: projDesc.trim(),
        target_date: projTargetDate || null,
        color: projColor,
      }),
    });
    setProjTitle('');
    setProjDesc('');
    setProjTargetDate('');
    setShowProjectModal(false);
    await loadData();
    setSelectedProjectId(created.id);
    onDataChanged?.();
  };

  const handleUpdateProjectStatus = async (projectId, status) => {
    await apiFetch(`/api/hub/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    await loadData();
    onDataChanged?.();
  };

  const handleDeleteProject = async (projectId) => {
    await apiFetch(`/api/hub/projects/${projectId}`, { method: 'DELETE' });
    if (selectedProjectId === projectId) setSelectedProjectId(null);
    await loadData();
    onDataChanged?.();
  };

  // Shopping items
  const handleAddShoppingItem = async (e) => {
    e.preventDefault();
    if (!selectedProject || !shopName.trim()) return;
    await apiFetch(`/api/hub/projects/${selectedProject.id}/shopping`, {
      method: 'POST',
      body: JSON.stringify({
        name: shopName.trim(),
        quantity: shopQty.trim() || '1',
        estimated_price: parseFloat(shopPrice || 0),
        notes: shopNotes.trim(),
      }),
    });
    setShopName('');
    setShopQty('1');
    setShopPrice('');
    setShopNotes('');
    await loadData();
    onDataChanged?.();
  };

  const handleToggleShoppingItem = async (itemId) => {
    await apiFetch(`/api/hub/projects/shopping/${itemId}/toggle`, { method: 'PUT' });
    await loadData();
    onDataChanged?.();
  };

  const handleDeleteShoppingItem = async (itemId) => {
    await apiFetch(`/api/hub/projects/shopping/${itemId}`, { method: 'DELETE' });
    await loadData();
    onDataChanged?.();
  };

  // Project To-Dos
  const handleAddProjectTodo = async (e) => {
    e.preventDefault();
    if (!selectedProject || !projTodoTitle.trim()) return;
    await apiFetch('/api/hub/todos', {
      method: 'POST',
      body: JSON.stringify({
        project_id: selectedProject.id,
        title: projTodoTitle.trim(),
        category: 'Project',
        assigned_to: Number(projTodoAssigned),
        due_date: projTodoDue || null,
      }),
    });
    setProjTodoTitle('');
    setProjTodoDue('');
    await loadData();
    onDataChanged?.();
  };

  // Notes
  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!selectedProject || !noteContent.trim()) return;
    await apiFetch(`/api/hub/projects/${selectedProject.id}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        title: noteTitle.trim() || 'Project Note',
        content: noteContent.trim(),
      }),
    });
    setNoteTitle('');
    setNoteContent('');
    await loadData();
    onDataChanged?.();
  };

  const handleSaveEditNote = async (noteId) => {
    if (!editNoteContent.trim()) return;
    await apiFetch(`/api/hub/projects/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: editNoteTitle.trim() || 'Project Note',
        content: editNoteContent.trim(),
      }),
    });
    setEditingNoteId(null);
    await loadData();
    onDataChanged?.();
  };

  const handleDeleteNote = async (noteId) => {
    await apiFetch(`/api/hub/projects/notes/${noteId}`, { method: 'DELETE' });
    await loadData();
    onDataChanged?.();
  };

  // Standalone To-Dos
  const handleAddStandaloneTodo = async (e) => {
    e.preventDefault();
    if (!todoTitle.trim()) return;
    await apiFetch('/api/hub/todos', {
      method: 'POST',
      body: JSON.stringify({
        project_id: null,
        title: todoTitle.trim(),
        category: todoCategory,
        assigned_to: Number(todoAssigned),
        due_date: todoDue || null,
        priority: todoPriority,
      }),
    });
    setTodoTitle('');
    setTodoDue('');
    setShowTodoModal(false);
    await loadData();
    onDataChanged?.();
  };

  const handleToggleTodo = async (todoId) => {
    await apiFetch(`/api/hub/todos/${todoId}/toggle`, { method: 'PUT' });
    await loadData();
    onDataChanged?.();
  };

  const handleDeleteTodo = async (todoId) => {
    await apiFetch(`/api/hub/todos/${todoId}`, { method: 'DELETE' });
    await loadData();
    onDataChanged?.();
  };

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>Admin Planning</h2>
          <InfoTip text="Plan household projects (like Christmas or trips) with attached shopping lists, to-do lists, and freeform notes, or manage standalone to-dos outside of projects." />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {subTab === 'projects' && !selectedProject && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowProjectModal(true)}
            >
              <FolderPlus size={17} /> New Project
            </button>
          )}
          {subTab === 'todos' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowTodoModal(true)}
            >
              <Plus size={17} /> Add To-Do
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation: Projects vs Standalone To-Dos */}
      <div className="admin-subtabs-bar">
        <button
          type="button"
          className={`btn btn-sm ${subTab === 'projects' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setSubTab('projects');
          }}
        >
          <ClipboardList size={15} /> Projects ({projects.filter((p) => p.status === 'active').length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${subTab === 'todos' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            setSubTab('todos');
            setSelectedProjectId(null);
          }}
        >
          <CheckSquare size={15} /> To-Dos ({standaloneTodos.filter((t) => !t.completed).length})
        </button>
      </div>

      {/* PROJECTS VIEW */}
      {subTab === 'projects' && !selectedProject && (
        <>
          {projects.length === 0 ? (
            <div className="card empty-state-card">
              <h3>No Admin Projects Yet</h3>
              <p className="text-muted">
                Create a project like <strong>Christmas Project</strong> or{' '}
                <strong>Home Reset</strong> and attach a shopping list, to-do list, or freeform notes.
              </p>
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowProjectModal(true)}
                >
                  <FolderPlus size={16} /> Create First Project
                </button>
              </div>
            </div>
          ) : (
            <div className="plans-grid">
              {projects.map((proj) => (
                <div
                  key={proj.id}
                  className="card admin-project-card"
                  style={{ borderTop: `3px solid ${proj.color || '#6366f1'}` }}
                  onClick={() => setSelectedProjectId(proj.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedProjectId(proj.id);
                  }}
                >
                  <div className="plan-card-header">
                    <div>
                      <div className="request-badges">
                        <span
                          className={`pill ${
                            proj.status === 'completed'
                              ? 'pill-green'
                              : proj.status === 'archived'
                                ? 'pill-outline'
                                : 'pill-cyan'
                          }`}
                        >
                          {proj.status.toUpperCase()}
                        </span>
                        {proj.target_date && (
                          <span className="pill pill-amber">
                            <Calendar size={11} /> {proj.target_date}
                          </span>
                        )}
                      </div>
                      <h3 style={{ marginTop: '0.35rem' }}>{proj.title}</h3>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(proj.id);
                      }}
                      title="Delete project"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {proj.description && (
                    <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.65rem' }}>
                      {proj.description}
                    </p>
                  )}
                  <div className="admin-project-stats-row">
                    <span className="pill pill-outline">
                      <ShoppingBag size={12} /> {proj.shopping_items.length} to buy
                      {proj.shopping_remaining > 0 ? ` (${proj.shopping_remaining} left)` : ''}
                    </span>
                    <span className="pill pill-outline">
                      <CheckSquare size={12} /> {proj.todos.length} to-dos
                      {proj.todos_remaining > 0 ? ` (${proj.todos_remaining} open)` : ''}
                    </span>
                    <span className="pill pill-outline">
                      <FileText size={12} /> {proj.notes.length} notes
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* PROJECT DETAIL WORKSPACE */}
      {subTab === 'projects' && selectedProject && (
        <div className="module-container">
          <div className="card" style={{ borderTop: `3px solid ${selectedProject.color || '#6366f1'}` }}>
            <div className="plan-card-header" style={{ alignItems: 'flex-start' }}>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => setSelectedProjectId(null)}
                  style={{ marginBottom: '0.6rem' }}
                >
                  <ArrowLeft size={14} /> All Projects
                </button>
                <h3 style={{ fontSize: '1.25rem' }}>{selectedProject.title}</h3>
                {selectedProject.description && (
                  <p className="text-muted" style={{ marginTop: '0.25rem' }}>
                    {selectedProject.description}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  className="input input-sm"
                  value={selectedProject.status}
                  onChange={(e) => handleUpdateProjectStatus(selectedProject.id, e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
                <button
                  type="button"
                  className="btn-icon-danger"
                  onClick={() => handleDeleteProject(selectedProject.id)}
                  title="Delete project"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>

          {/* 1. Shopping / Things to Purchase */}
          <div className="card">
            <div className="plan-card-header" style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <ShoppingBag size={18} style={{ color: 'var(--primary)' }} />
                <h3>Things to Purchase</h3>
              </div>
              {selectedProject.shopping_total > 0 && (
                <span className="pill pill-cyan">
                  Est. ${Number(selectedProject.shopping_total).toFixed(2)}
                </span>
              )}
            </div>

            <form className="admin-inline-form" onSubmit={handleAddShoppingItem}>
              <input
                type="text"
                className="input"
                placeholder="Item to purchase (e.g., Wrapping paper)"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                required
              />
              <input
                type="text"
                className="input admin-qty-input"
                placeholder="Qty"
                value={shopQty}
                onChange={(e) => setShopQty(e.target.value)}
              />
              <input
                type="number"
                step="0.01"
                className="input admin-price-input"
                placeholder="$ Est."
                value={shopPrice}
                onChange={(e) => setShopPrice(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                <Plus size={15} /> Add
              </button>
            </form>

            {selectedProject.shopping_items.length === 0 ? (
              <p className="text-muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                No shopping items attached to this project yet.
              </p>
            ) : (
              <div className="checklist-stack" style={{ marginTop: '0.75rem' }}>
                {selectedProject.shopping_items.map((item) => (
                  <div
                    key={item.id}
                    className={`checklist-row ${item.purchased ? 'completed' : ''}`}
                  >
                    <button
                      type="button"
                      className="check-btn"
                      onClick={() => handleToggleShoppingItem(item.id)}
                    >
                      {item.purchased ? <CheckSquare size={19} /> : <Square size={19} />}
                    </button>
                    <div className="checklist-main">
                      <strong>{item.name}</strong>
                      <div className="request-badges">
                        <span className="pill pill-outline">Qty: {item.quantity}</span>
                        {Number(item.estimated_price) > 0 && (
                          <span className="pill pill-cyan">
                            ${Number(item.estimated_price).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleDeleteShoppingItem(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Project To-Do List */}
          <div className="card">
            <div className="plan-card-header" style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <CheckSquare size={18} style={{ color: 'var(--success)' }} />
                <h3>Project To-Do List</h3>
              </div>
              <span className="pill pill-outline">
                {selectedProject.todos_remaining} open
              </span>
            </div>

            <form className="admin-inline-form" onSubmit={handleAddProjectTodo}>
              <input
                type="text"
                className="input"
                placeholder="Task (e.g., Put up decorations)"
                value={projTodoTitle}
                onChange={(e) => setProjTodoTitle(e.target.value)}
                required
              />
              <select
                className="input admin-partner-select"
                value={projTodoAssigned}
                onChange={(e) => setProjTodoAssigned(e.target.value)}
              >
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="input admin-date-input"
                value={projTodoDue}
                onChange={(e) => setProjTodoDue(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                <Plus size={15} /> Add
              </button>
            </form>

            {selectedProject.todos.length === 0 ? (
              <p className="text-muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                No to-do tasks attached to this project yet.
              </p>
            ) : (
              <div className="checklist-stack" style={{ marginTop: '0.75rem' }}>
                {selectedProject.todos.map((t) => (
                  <div
                    key={t.id}
                    className={`checklist-row ${t.completed ? 'completed' : ''}`}
                  >
                    <button
                      type="button"
                      className="check-btn"
                      onClick={() => handleToggleTodo(t.id)}
                    >
                      {t.completed ? <CheckSquare size={19} /> : <Square size={19} />}
                    </button>
                    <div className="checklist-main">
                      <strong>{t.title}</strong>
                      <div className="request-badges">
                        {t.assigned_name && (
                          <span className="pill pill-outline">{t.assigned_name}</span>
                        )}
                        {t.due_date && (
                          <span className="pill pill-amber">Due {t.due_date}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleDeleteTodo(t.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Freeform Notes */}
          <div className="card">
            <div className="plan-card-header" style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <FileText size={18} style={{ color: 'var(--amber)' }} />
                <h3>Freeform Notes</h3>
              </div>
            </div>

            <form className="module-container" style={{ gap: '0.55rem' }} onSubmit={handleAddNote}>
              <input
                type="text"
                className="input"
                placeholder="Note title (e.g., Gift Ideas & Dinner Menu)"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
              />
              <textarea
                className="input"
                rows={3}
                placeholder="Write any freeform notes, links, gift lists, or ideas..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary btn-sm">
                  <Plus size={15} /> Attach Note
                </button>
              </div>
            </form>

            {selectedProject.notes.length > 0 && (
              <div className="admin-notes-stack" style={{ marginTop: '0.9rem' }}>
                {selectedProject.notes.map((n) => (
                  <div key={n.id} className="admin-note-item">
                    {editingNoteId === n.id ? (
                      <div className="module-container" style={{ gap: '0.5rem' }}>
                        <input
                          type="text"
                          className="input"
                          value={editNoteTitle}
                          onChange={(e) => setEditNoteTitle(e.target.value)}
                        />
                        <textarea
                          className="input"
                          rows={3}
                          value={editNoteContent}
                          onChange={(e) => setEditNoteContent(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => setEditingNoteId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            onClick={() => handleSaveEditNote(n.id)}
                          >
                            Save Note
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="plan-card-header">
                          <strong>{n.title}</strong>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="btn-icon-subtle"
                              onClick={() => {
                                setEditingNoteId(n.id);
                                setEditNoteTitle(n.title);
                                setEditNoteContent(n.content);
                              }}
                              title="Edit note"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon-danger"
                              onClick={() => handleDeleteNote(n.id)}
                              title="Delete note"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <p className="admin-note-content">{n.content}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STANDALONE TO-DOS SUBCATEGORY */}
      {subTab === 'todos' && (
        <div className="card">
          <div className="plan-card-header" style={{ marginBottom: '0.75rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                {todoScope === 'standalone' ? 'General To-Dos (Outside Projects)' : 'All To-Dos'}
              </h3>
              <small className="text-muted">
                Quick tasks &amp; errands that don&apos;t belong to a specific project.
              </small>
            </div>
            <select
              className="input input-sm"
              style={{ width: 'auto' }}
              value={todoScope}
              onChange={(e) => setTodoScope(e.target.value)}
            >
              <option value="standalone">Outside Projects Only</option>
              <option value="all">Include Project To-Dos</option>
            </select>
          </div>

          {standaloneTodos.length === 0 ? (
            <p className="text-muted">
              No tasks here yet. Tap <strong>Add To-Do</strong> above to create one!
            </p>
          ) : (
            <div className="checklist-stack">
              {standaloneTodos.map((t) => (
                <div key={t.id} className={`checklist-row ${t.completed ? 'completed' : ''}`}>
                  <button
                    type="button"
                    className="check-btn"
                    onClick={() => handleToggleTodo(t.id)}
                  >
                    {t.completed ? <CheckSquare size={20} /> : <Square size={20} />}
                  </button>
                  <div className="checklist-main">
                    <strong>{t.title}</strong>
                    <div className="request-badges">
                      {t.project_title ? (
                        <span className="pill pill-cyan">{t.project_title}</span>
                      ) : (
                        <span className="pill pill-outline">{t.category}</span>
                      )}
                      {t.assigned_name && (
                        <span className="pill pill-outline">{t.assigned_name}</span>
                      )}
                      {t.due_date && <span className="pill pill-amber">Due {t.due_date}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => handleDeleteTodo(t.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* NEW PROJECT MODAL */}
      {showProjectModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowProjectModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <h3 style={{ margin: 0 }}>New Admin Project</h3>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowProjectModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleCreateProject}>
              <div className="form-group">
                <label>Project Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Christmas Project"
                  value={projTitle}
                  onChange={(e) => setProjTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Description (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Gifts, decorations, and dinner prep"
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                />
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Target Date (Optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={projTargetDate}
                    onChange={(e) => setProjTargetDate(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Accent Color</label>
                  <div className="account-color-swatches" style={{ paddingTop: '0.35rem' }}>
                    {PROJECT_COLORS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className={`account-color-swatch-btn ${
                          projColor === hex ? 'active' : ''
                        }`}
                        style={{ backgroundColor: hex }}
                        onClick={() => setProjColor(hex)}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowProjectModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <FolderPlus size={16} /> Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW STANDALONE TO-DO MODAL */}
      {showTodoModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowTodoModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <h3 style={{ margin: 0 }}>Add General To-Do</h3>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowTodoModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleAddStandaloneTodo}>
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Schedule furnace tune-up"
                  value={todoTitle}
                  onChange={(e) => setTodoTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="input"
                    value={todoCategory}
                    onChange={(e) => setTodoCategory(e.target.value)}
                  >
                    <option value="Household">Household</option>
                    <option value="Finance">Finance</option>
                    <option value="Errands">Errands</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Assigned Partner</label>
                  <select
                    className="input"
                    value={todoAssigned}
                    onChange={(e) => setTodoAssigned(e.target.value)}
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
                    value={todoDue}
                    onChange={(e) => setTodoDue(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    className="input"
                    value={todoPriority}
                    onChange={(e) => setTodoPriority(e.target.value)}
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
                  onClick={() => setShowTodoModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} /> Add To-Do
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
