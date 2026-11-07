import React, { useEffect, useState } from 'react';
import { CalendarClock, PiggyBank, Plus, Sparkles, Target, Trash2, X } from 'lucide-react';
import { apiFetch } from '../api';

export default function FuturePurchasesModule({ onDataChanged, syncVersion }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Home & Lifestyle');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentSaved, setCurrentSaved] = useState('0');
  const [monthlyContribution, setMonthlyContribution] = useState('200');
  const [targetDate, setTargetDate] = useState('2027-06-01');
  const [priority, setPriority] = useState('medium');
  const [notes, setNotes] = useState('');

  const loadPlans = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch('/api/future-purchases');
      setPlans(data.future_purchases || []);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans(false);
  }, []);

  useEffect(() => {
    if (syncVersion > 1) {
      loadPlans(true);
    }
  }, [syncVersion]);

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    if (!title || !targetAmount) return;
    await apiFetch('/api/future-purchases', {
      method: 'POST',
      body: JSON.stringify({
        title,
        category,
        target_amount: parseFloat(targetAmount),
        current_saved: parseFloat(currentSaved || 0),
        monthly_contribution: parseFloat(monthlyContribution || 100),
        target_date: targetDate || null,
        priority,
        notes,
      }),
    });
    setTitle('');
    setTargetAmount('');
    setCurrentSaved('0');
    setNotes('');
    setShowAdd(false);
    await loadPlans();
    onDataChanged?.();
  };

  const handleContribute = async (planId, amount) => {
    await apiFetch(`/api/future-purchases/${planId}/contribute`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    await loadPlans();
    onDataChanged?.();
  };

  const handleDelete = async (planId) => {
    await apiFetch(`/api/future-purchases/${planId}`, { method: 'DELETE' });
    await loadPlans();
    onDataChanged?.();
  };

  const totalTarget = plans.reduce((acc, p) => acc + Number(p.target_amount || 0), 0);
  const totalSaved = plans.reduce((acc, p) => acc + Number(p.current_saved || 0), 0);
  const totalMonthlyPlanned = plans.reduce(
    (acc, p) => acc + Number(p.monthly_contribution || 0),
    0
  );

  return (
    <div className="module-container">
      <div className="section-header-bar">
        <div>
          <h2>Future Purchases & Shared Savings Roadmap</h2>
          <p className="text-muted">
            Plan upcoming couple purchases, vacations, home upgrades, and approved partner request timelines.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={18} />
          Plan Future Purchase
        </button>
      </div>

      <div className="kpi-grid-3">
        <div className="kpi-card">
          <span className="kpi-label">Total Saved Across Goals</span>
          <strong className="kpi-value text-green">${totalSaved.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          <small className="kpi-sub">of ${totalTarget.toLocaleString('en-US', { minimumFractionDigits: 2 })} total planned</small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Combined Monthly Goal Commitment</span>
          <strong className="kpi-value text-cyan">${totalMonthlyPlanned.toLocaleString('en-US', { minimumFractionDigits: 0 })}/mo</strong>
          <small className="kpi-sub">Across {plans.length} active purchase plans</small>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Overall Roadmap Progress</span>
          <strong className="kpi-value">
            {totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%
          </strong>
          <small className="kpi-sub">Synced with Partner Request timelines</small>
        </div>
      </div>

      {showAdd && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>
                  <Target size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                  Create a Future Purchase Plan
                </h3>
                <p className="text-muted">
                  Set a target cost, monthly contribution, and ideal date for an upcoming purchase.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowAdd(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleCreatePlan}>
              <div className="form-grid-3">
                <div className="form-group">
                  <label>Purchase or Goal Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Patio Dining Set, Japan Trip, New Washer/Dryer"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Target Cost ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    className="input"
                    placeholder="1500"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="Home & Lifestyle">Home & Lifestyle</option>
                    <option value="Travel & Experiences">Travel & Experiences</option>
                    <option value="Shopping & Tech">Shopping & Tech</option>
                    <option value="Entertainment & Gaming">Entertainment & Gaming</option>
                    <option value="Automotive & Mobility">Automotive & Mobility</option>
                  </select>
                </div>
              </div>

              <div className="form-grid-3" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Monthly Savings Contribution ($/mo)</label>
                  <input
                    type="number"
                    step="10"
                    className="input"
                    value={monthlyContribution}
                    onChange={(e) => setMonthlyContribution(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Starting Saved Amount ($)</label>
                  <input
                    type="number"
                    step="10"
                    className="input"
                    value={currentSaved}
                    onChange={(e) => setCurrentSaved(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Target Purchase Date</label>
                  <input
                    type="date"
                    className="input"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>Notes / Milestones</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Wait for Memorial Day sale or use rewards points..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Target size={16} /> Save Future Purchase Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card">Loading future purchase roadmap...</div>
      ) : plans.length === 0 ? (
        <div className="card empty-state-card">
          <h3>No Future Purchase Plans Yet</h3>
          <p className="text-muted">
            Plan upcoming couple purchases, vacations, or household upgrades here—or set up a budget timeline on a Partner Purchase Request to automatically create a linked goal.
          </p>
          <div>
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Create Your First Future Purchase Plan
            </button>
          </div>
        </div>
      ) : (
        <div className="plans-grid">
          {plans.map((plan) => {
            const tl = plan.timeline || {};
            const isReady = Number(plan.current_saved) >= Number(plan.target_amount);
            return (
              <div key={plan.id} className={`card plan-card ${isReady ? 'plan-ready' : ''}`}>
                <div className="plan-card-header">
                  <div>
                    <div className="request-badges">
                      <span className="pill pill-outline">{plan.category}</span>
                      {plan.linked_request_id && (
                        <span className="pill pill-cyan">
                          Linked to Partner Request #{plan.linked_request_id}
                        </span>
                      )}
                      {isReady && <span className="pill pill-green">Ready to Purchase!</span>}
                    </div>
                    <h3>{plan.title}</h3>
                  </div>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => handleDelete(plan.id)}
                    title="Delete plan"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {plan.notes && <p className="text-muted">{plan.notes}</p>}

                <div className="plan-numbers-row">
                  <div>
                    <span className="text-muted">Saved</span>
                    <strong className="plan-saved-val">
                      ${Number(plan.current_saved).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted">Target Cost</span>
                    <strong>
                      ${Number(plan.target_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted">Monthly Pace</span>
                    <strong className="text-cyan">
                      ${Number(plan.monthly_contribution).toFixed(0)}/mo
                    </strong>
                  </div>
                </div>

                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, tl.progress_pct || 0)}%` }}
                  />
                </div>

                <div className="plan-timeline-meta">
                  <span>
                    <CalendarClock size={14} /> Target Date:{' '}
                    <strong>{plan.target_date || 'Flexible'}</strong>
                  </span>
                  {tl.months_to_goal > 0 ? (
                    <span>
                      Est. Ready: <strong>{tl.estimated_ready_date}</strong> ({tl.months_to_goal} mo)
                    </span>
                  ) : (
                    <span className="text-green">Goal 100% funded!</span>
                  )}
                </div>

                {tl.required_monthly_for_target_date && tl.remaining_amount > 0 && (
                  <div className="plan-pace-hint">
                    Need ~<strong>${tl.required_monthly_for_target_date}/mo</strong> to hit{' '}
                    {plan.target_date}
                  </div>
                )}

                <div className="quick-contribute-row">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleContribute(plan.id, 50)}
                  >
                    +$50
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleContribute(plan.id, 100)}
                  >
                    +$100
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-accent"
                    onClick={() => handleContribute(plan.id, Number(plan.monthly_contribution))}
                  >
                    +Monthly (${Number(plan.monthly_contribution).toFixed(0)})
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

