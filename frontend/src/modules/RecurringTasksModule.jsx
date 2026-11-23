import React, { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  CheckSquare,
  Clock,
  Edit3,
  Plus,
  Repeat,
  Send,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import InfoTip from '../components/InfoTip';

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function formatTime12h(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return hhmm || '8:00 PM';
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

export default function RecurringTasksModule({
  partners,
  onDataChanged,
  syncVersion,
}) {
  const [tasks, setTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState([]);
  const [newStepText, setNewStepText] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState(DAYS.map((d) => d.key));
  const [dayAssignments, setDayAssignments] = useState({});
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [notifyTime, setNotifyTime] = useState('20:00');

  const loadTasks = async () => {
    const data = await apiFetch('/api/hub/recurring-tasks');
    setTasks(data.tasks || []);
  };

  useEffect(() => {
    loadTasks();
  }, [syncVersion]);

  const getPartnerLabel = (val) => {
    if (!val || val === 'unassigned') return 'Unassigned';
    if (String(val).toLowerCase() === 'both') return 'Both Partners';
    const found = partners.find((p) => String(p.id) === String(val));
    return found ? found.name.split(' ')[0] : 'Partner';
  };

  const openCreateModal = () => {
    setEditingTaskId(null);
    setTitle('');
    setDescription('');
    setSteps([]);
    setNewStepText('');
    const allDays = DAYS.map((d) => d.key);
    setDaysOfWeek(allDays);
    const defaultAssign = {};
    allDays.forEach((d) => {
      defaultAssign[d] = 'both';
    });
    setDayAssignments(defaultAssign);
    setNotifyEnabled(true);
    setNotifyTime('20:00');
    setShowModal(true);
  };

  const openEditModal = (task) => {
    setEditingTaskId(task.id);
    setTitle(task.title || '');
    setDescription(task.description || '');
    setSteps(task.checklist_items || []);
    setNewStepText('');
    setDaysOfWeek(task.days_of_week || DAYS.map((d) => d.key));
    setDayAssignments(task.day_assignments || {});
    setNotifyEnabled(Boolean(task.notify_enabled));
    setNotifyTime(task.notify_time || '20:00');
    setShowModal(true);
  };

  const handleAddStep = () => {
    if (!newStepText.trim()) return;
    setSteps((prev) => [...prev, newStepText.trim()]);
    setNewStepText('');
  };

  const toggleDay = (dayKey) => {
    setDaysOfWeek((prev) =>
      prev.includes(dayKey) ? prev.filter((d) => d !== dayKey) : [...prev, dayKey]
    );
  };

  const applyAllDaysSame = (assigneeVal) => {
    const next = { ...dayAssignments };
    daysOfWeek.forEach((d) => {
      next[d] = assigneeVal;
    });
    setDayAssignments(next);
  };

  const applyAlternateDays = () => {
    if (partners.length < 2) return;
    const next = { ...dayAssignments };
    daysOfWeek.forEach((d, idx) => {
      next[d] = String(partners[idx % 2].id);
    });
    setDayAssignments(next);
  };

  const handleSaveTask = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const utcOffsetMinutes = -new Date().getTimezoneOffset();
    const payload = {
      title: title.trim(),
      description: description.trim(),
      checklist_items: steps,
      frequency: daysOfWeek.length === 7 ? 'daily' : 'weekly',
      days_of_week: daysOfWeek.length > 0 ? daysOfWeek : DAYS.map((d) => d.key),
      day_assignments: dayAssignments,
      notify_enabled: notifyEnabled,
      notify_time: notifyTime || '20:00',
      timezone_offset_minutes: utcOffsetMinutes,
    };

    if (editingTaskId) {
      await apiFetch(`/api/hub/recurring-tasks/${editingTaskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch('/api/hub/recurring-tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    setShowModal(false);
    await loadTasks();
    onDataChanged?.();
  };

  const handleDeleteTask = async (taskId) => {
    await apiFetch(`/api/hub/recurring-tasks/${taskId}`, { method: 'DELETE' });
    await loadTasks();
    onDataChanged?.();
  };

  const handleToggleCompleteToday = async (task) => {
    const isDone = Boolean(task.today_completion?.completed);
    await apiFetch(`/api/hub/recurring-tasks/${task.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        occurrence_date: task.today_date,
        completed: !isDone,
        checked_steps: !isDone
          ? (task.checklist_items || []).map((_, idx) => idx)
          : [],
      }),
    });
    await loadTasks();
    onDataChanged?.();
  };

  const handleToggleStep = async (task, stepIdx) => {
    const prevChecked = task.today_completion?.checked_steps || [];
    const nextChecked = prevChecked.includes(stepIdx)
      ? prevChecked.filter((i) => i !== stepIdx)
      : [...prevChecked, stepIdx];
    const allDone =
      task.checklist_items.length > 0 &&
      nextChecked.length === task.checklist_items.length;
    await apiFetch(`/api/hub/recurring-tasks/${task.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        occurrence_date: task.today_date,
        completed: allDone,
        checked_steps: nextChecked,
      }),
    });
    await loadTasks();
    onDataChanged?.();
  };

  const handleNotifyNow = async (task) => {
    const res = await apiFetch(`/api/hub/recurring-tasks/${task.id}/notify-now`, {
      method: 'POST',
    });
    setFeedbackMsg(
      res.count > 0
        ? `Sent reminder for "${task.title}"!`
        : `No partner assigned for today on "${task.title}".`
    );
    setTimeout(() => setFeedbackMsg(''), 3500);
  };

  const todaysTasks = tasks.filter((t) => t.is_active && t.is_scheduled_today);

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>Recurring Tasks</h2>
          <InfoTip text="Set up daily or weekly household routines (like resetting the house every night), assign each day to a specific partner or both, and send automatic push notifications." />
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreateModal}>
          <Plus size={18} /> New Routine
        </button>
      </div>

      {feedbackMsg && (
        <div className="card" style={{ padding: '0.65rem 1rem', borderColor: 'var(--primary)' }}>
          <strong style={{ color: 'var(--primary)', fontSize: '0.88rem' }}>
            {feedbackMsg}
          </strong>
        </div>
      )}

      {/* TODAY'S SCHEDULED ROUTINES */}
      <div className="card">
        <div className="plan-card-header" style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <CheckCircle2 size={18} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0 }}>Today&apos;s Routines</h3>
          </div>
          <span className="pill pill-cyan">
            {todaysTasks.filter((t) => !t.today_completion?.completed).length} remaining
          </span>
        </div>

        {todaysTasks.length === 0 ? (
          <p className="text-muted">
            No recurring routines scheduled for today. Tap <strong>New Routine</strong> to set one up!
          </p>
        ) : (
          <div className="module-container" style={{ gap: '0.75rem' }}>
            {todaysTasks.map((task) => {
              const isDone = Boolean(task.today_completion?.completed);
              const checkedSteps = task.today_completion?.checked_steps || [];
              const todayOwner = getPartnerLabel(task.today_assignment);
              return (
                <div
                  key={task.id}
                  className={`recurring-today-card ${isDone ? 'completed' : ''}`}
                >
                  <div className="plan-card-header">
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                      <button
                        type="button"
                        className="check-btn"
                        onClick={() => handleToggleCompleteToday(task)}
                        title={isDone ? 'Mark incomplete' : 'Mark complete for today'}
                      >
                        {isDone ? <CheckSquare size={22} /> : <Square size={22} />}
                      </button>
                      <div>
                        <strong
                          style={{
                            fontSize: '1rem',
                            textDecoration: isDone ? 'line-through' : 'none',
                          }}
                        >
                          {task.title}
                        </strong>
                        <div className="request-badges" style={{ marginTop: '0.25rem' }}>
                          <span className="pill pill-cyan">Today: {todayOwner}</span>
                          {task.notify_enabled ? (
                            <span className="pill pill-outline">
                              <Bell size={11} /> {formatTime12h(task.notify_time)}
                            </span>
                          ) : (
                            <span className="pill pill-outline">
                              <BellOff size={11} /> Alerts Off
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => handleNotifyNow(task)}
                      title="Send reminder notification now"
                    >
                      <Send size={12} /> Nudge
                    </button>
                  </div>

                  {task.description && (
                    <p className="text-muted" style={{ fontSize: '0.84rem', marginTop: '0.4rem' }}>
                      {task.description}
                    </p>
                  )}

                  {task.checklist_items.length > 0 && (
                    <div className="recurring-steps-list">
                      {task.checklist_items.map((step, idx) => {
                        const stepChecked = checkedSteps.includes(idx) || isDone;
                        return (
                          <button
                            key={idx}
                            type="button"
                            className={`recurring-step-chip ${stepChecked ? 'done' : ''}`}
                            onClick={() => handleToggleStep(task, idx)}
                          >
                            {stepChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                            <span>{step}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ALL RECURRING SCHEDULES */}
      <div className="plans-grid">
        {tasks.map((task) => (
          <div key={task.id} className="card">
            <div className="plan-card-header">
              <div>
                <div className="request-badges">
                  <span className="pill pill-cyan">
                    <Repeat size={11} /> {task.frequency === 'daily' ? 'Daily' : 'Weekly'}
                  </span>
                  <span className="pill pill-outline">
                    <Clock size={11} /> {formatTime12h(task.notify_time)}
                  </span>
                  {task.notify_enabled ? (
                    <span className="pill pill-green">Alerts On</span>
                  ) : (
                    <span className="pill pill-amber">Alerts Off</span>
                  )}
                </div>
                <h3 style={{ marginTop: '0.35rem' }}>{task.title}</h3>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="btn-icon-subtle"
                  onClick={() => openEditModal(task)}
                  title="Edit recurring task"
                >
                  <Edit3 size={15} />
                </button>
                <button
                  type="button"
                  className="btn-icon-danger"
                  onClick={() => handleDeleteTask(task.id)}
                  title="Delete recurring task"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {task.description && (
              <p className="text-muted" style={{ fontSize: '0.84rem', margin: '0.35rem 0 0.65rem' }}>
                {task.description}
              </p>
            )}

            <div className="recurring-day-pills">
              {DAYS.map((d) => {
                const active = task.days_of_week.includes(d.key);
                const assignee = active ? getPartnerLabel(task.day_assignments[d.key]) : '—';
                return (
                  <div
                    key={d.key}
                    className={`recurring-day-badge ${active ? 'active' : 'inactive'}`}
                  >
                    <span className="recurring-day-name">{d.label}</span>
                    <span className="recurring-day-owner">{assignee}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* CREATE / EDIT RECURRING TASK MODAL */}
      {showModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowModal(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <h3 style={{ margin: 0 }}>
                {editingTaskId ? 'Edit Recurring Routine' : 'New Recurring Routine'}
              </h3>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleSaveTask}>
              <div className="form-group">
                <label>Routine Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Reset the House"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Description / Notes (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Nightly reset before bed"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Checklist Steps */}
              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Checklist Steps (Optional)</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Start the dishwasher"
                    value={newStepText}
                    onChange={(e) => setNewStepText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddStep();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleAddStep}
                  >
                    <Plus size={15} /> Add Step
                  </button>
                </div>
                {steps.length > 0 && (
                  <div className="recurring-steps-list" style={{ marginTop: '0.5rem' }}>
                    {steps.map((s, idx) => (
                      <span key={idx} className="pill pill-outline" style={{ gap: '0.35rem' }}>
                        {s}
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          style={{ padding: 0 }}
                          onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Days of Week & Quick Presets */}
              <div className="form-group" style={{ marginTop: '0.85rem' }}>
                <div className="plan-card-header" style={{ marginBottom: '0.4rem' }}>
                  <label style={{ margin: 0 }}>Repeat Days</label>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => setDaysOfWeek(DAYS.map((d) => d.key))}
                    >
                      Every Day
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => setDaysOfWeek(['mon', 'tue', 'wed', 'thu', 'fri'])}
                    >
                      Weekdays
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => setDaysOfWeek(['sat', 'sun'])}
                    >
                      Weekends
                    </button>
                  </div>
                </div>
                <div className="recurring-day-toggle-row">
                  {DAYS.map((d) => {
                    const active = daysOfWeek.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => toggleDay(d.key)}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Day-by-Day Partner Assignment */}
              <div className="form-group" style={{ marginTop: '0.85rem' }}>
                <div className="plan-card-header" style={{ marginBottom: '0.45rem' }}>
                  <label style={{ margin: 0 }}>
                    <Users size={13} /> Who Gets Notified Each Day
                  </label>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => applyAllDaysSame('both')}
                    >
                      All: Both
                    </button>
                    {partners.length >= 2 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={applyAlternateDays}
                      >
                        Alternate Days
                      </button>
                    )}
                  </div>
                </div>
                <div className="recurring-assign-grid">
                  {DAYS.filter((d) => daysOfWeek.includes(d.key)).map((d) => (
                    <div key={d.key} className="recurring-assign-row">
                      <span className="recurring-assign-day">{d.label}</span>
                      <select
                        className="input input-sm"
                        value={dayAssignments[d.key] || 'both'}
                        onChange={(e) =>
                          setDayAssignments((prev) => ({
                            ...prev,
                            [d.key]: e.target.value,
                          }))
                        }
                      >
                        <option value="both">Both Partners</option>
                        {partners.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name}
                          </option>
                        ))}
                        <option value="unassigned">No Notification</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notification Time & Toggle */}
              <div className="form-grid-2" style={{ marginTop: '0.85rem' }}>
                <div className="form-group">
                  <label>Notification Time</label>
                  <input
                    type="time"
                    className="input"
                    value={notifyTime}
                    onChange={(e) => setNotifyTime(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Push Notification</label>
                  <button
                    type="button"
                    className={`btn btn-sm ${notifyEnabled ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ width: '100%', minHeight: '42px' }}
                    onClick={() => setNotifyEnabled((v) => !v)}
                  >
                    {notifyEnabled ? <Bell size={15} /> : <BellOff size={15} />}
                    {notifyEnabled ? 'Notification Enabled' : 'Notification Disabled'}
                  </button>
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Repeat size={16} /> {editingTaskId ? 'Save Changes' : 'Create Routine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
