import React, { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  Eye,
  Gamepad2,
  MessageSquare,
  PiggyBank,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../api';

const CATEGORIES = [
  'Entertainment & Gaming',
  'Shopping & Tech',
  'Home & Lifestyle',
  'Travel & Experiences',
  'Health & Wellness',
  'Hobbies & Gear',
];

export default function RequestsModule({ activePartner, partners, onDataChanged, syncVersion }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [showNewForm, setShowNewForm] = useState(false);

  // New request form state
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState('Entertainment & Gaming');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDescription, setNewDescription] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newProposedMonthly, setNewProposedMonthly] = useState('');
  const [newTargetDate, setNewTargetDate] = useState('2027-02-01');
  const [newComment, setNewComment] = useState('');

  // Active decision / timeline planner drawer state
  const [planningReqId, setPlanningReqId] = useState(null);
  const [planMonthly, setPlanMonthly] = useState(200);
  const [planTargetDate, setPlanTargetDate] = useState('2027-02-15');
  const [planSaved, setPlanSaved] = useState(100);
  const [decisionNotes, setDecisionNotes] = useState('');

  // Comment input map
  const [commentInputs, setCommentInputs] = useState({});

  const loadRequests = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch('/api/requests');
      setRequests(data.requests || []);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests(false);
  }, []);

  useEffect(() => {
    if (syncVersion > 1) {
      loadRequests(true);
    }
  }, [syncVersion]);

  const otherPartner =
    partners.find((p) => p.id !== activePartner?.id) || partners[0] || { id: 1, name: 'Partner' };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    if (!newTitle || !newAmount) return;
    await apiFetch('/api/requests', {
      method: 'POST',
      body: JSON.stringify({
        requester_id: activePartner.id,
        reviewer_id: otherPartner.id,
        title: newTitle,
        amount: parseFloat(newAmount),
        category: newCategory,
        priority: newPriority,
        description: newDescription,
        url: newUrl,
        proposed_monthly_contribution: newProposedMonthly ? parseFloat(newProposedMonthly) : null,
        proposed_target_date: newTargetDate || null,
        initial_comment: newComment,
      }),
    });
    setNewTitle('');
    setNewAmount('');
    setNewDescription('');
    setNewUrl('');
    setNewProposedMonthly('');
    setNewComment('');
    setShowNewForm(false);
    await loadRequests();
    onDataChanged?.();
  };

  const openTimelinePlanner = (req) => {
    setPlanningReqId(req.id);
    setPlanMonthly(req.proposed_monthly_contribution || Math.ceil(req.amount / 3));
    setPlanTargetDate(req.proposed_target_date || '2027-02-15');
    setPlanSaved(req.saved_amount || 0);
    setDecisionNotes(
      req.decision_notes ||
      `Let's budget $${req.proposed_monthly_contribution || Math.ceil(req.amount / 3)}/mo so we can buy this comfortably!`
    );
  };

  const submitDecision = async (reqId, status, extra = {}) => {
    await apiFetch(`/api/requests/${reqId}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        partner_id: activePartner.id,
        status,
        ...extra,
      }),
    });
    setPlanningReqId(null);
    await loadRequests();
    onDataChanged?.();
  };

  const handleQuickContribute = async (reqId, amount) => {
    await apiFetch(`/api/requests/${reqId}/contribute`, {
      method: 'POST',
      body: JSON.stringify({
        partner_id: activePartner.id,
        amount,
      }),
    });
    await loadRequests();
    onDataChanged?.();
  };

  const handleAddComment = async (reqId) => {
    const text = (commentInputs[reqId] || '').trim();
    if (!text) return;
    await apiFetch(`/api/requests/${reqId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        partner_id: activePartner.id,
        comment: text,
      }),
    });
    setCommentInputs((prev) => ({ ...prev, [reqId]: '' }));
    await loadRequests();
  };

  const handleDeleteRequest = async (req) => {
    if (!window.confirm(`Remove purchase request "${req.title}"?`)) {
      return;
    }
    await apiFetch(`/api/requests/${req.id}?delete_linked_plan=true`, {
      method: 'DELETE',
    });
    await loadRequests();
    onDataChanged?.();
  };

  const filteredRequests = requests.filter((r) =>
    filterStatus === 'all' ? true : r.status === filterStatus
  );

  const statusBadge = (status) => {
    switch (status) {
      case 'pending':
        return <span className="pill pill-amber">Awaiting Partner Decision</span>;
      case 'under_review':
        return <span className="pill pill-purple">Under Review</span>;
      case 'budget_planned':
        return <span className="pill pill-cyan">Budget & Timeline Active</span>;
      case 'approved':
        return <span className="pill pill-green">Approved to Buy</span>;
      case 'denied':
        return <span className="pill pill-red">On Hold / Denied</span>;
      default:
        return <span className="pill">{status}</span>;
    }
  };

  return (
    <div className="module-container">
      <div className="section-header-bar">
        <div>
          <h2>Partner Purchase Requests & Approvals</h2>
          <p className="text-muted">
            Submit a purchase idea to <strong>{otherPartner.name}</strong> — approve right away, hold off, or set up a custom monthly savings budget & timeline together.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowNewForm(true)}
        >
          <Plus size={18} />
          Request Purchase from {otherPartner.name.split(' ')[0]}
        </button>
      </div>

      {showNewForm && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowNewForm(false)}
        >
          <div
            className="finance-modal-card finance-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <div>
                <h3>Submit a New Financial Request</h3>
                <p className="text-muted">
                  Requesting as <strong>{activePartner.name}</strong> → Sent to{' '}
                  <strong>{otherPartner.name}</strong> for review
                </p>
              </div>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowNewForm(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
            <form className="finance-modal-body" onSubmit={handleCreateRequest}>
              <div className="form-grid-3">
                <div className="form-group">
                  <label>Item or Purchase Title *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., PlayStation 5 Pro, OLED TV, Weekend Ski Pass"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Estimated Cost ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    className="input"
                    placeholder="749.99"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Budget Category</label>
                  <select
                    className="input"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid-3" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    className="input"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                  >
                    <option value="low">Low — Nice to have eventually</option>
                    <option value="medium">Medium — Would love soon</option>
                    <option value="high">High — Time-sensitive / Important</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Suggested Monthly Savings ($/mo)</label>
                  <input
                    type="number"
                    step="1"
                    className="input"
                    placeholder="Optional, e.g., 200"
                    value={newProposedMonthly}
                    onChange={(e) => setNewProposedMonthly(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Ideal Target Purchase Date</label>
                  <input
                    type="date"
                    className="input"
                    value={newTargetDate}
                    onChange={(e) => setNewTargetDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-grid-2" style={{ marginTop: '0.75rem' }}>
                <div className="form-group">
                  <label>Why I'd love this / Details</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Explain why or how we'll enjoy it..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Product Link (Optional)</label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://..."
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowNewForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <Send size={16} />
                  Submit Request to {otherPartner.name}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="filter-pills-row">
        {[
          { id: 'all', label: `All Requests (${requests.length})` },
          {
            id: 'pending',
            label: `Needs Decision (${requests.filter((r) => r.status === 'pending').length})`,
          },
          {
            id: 'under_review',
            label: `Under Review (${requests.filter((r) => r.status === 'under_review').length})`,
          },
          {
            id: 'budget_planned',
            label: `Active Budget Timelines (${requests.filter((r) => r.status === 'budget_planned').length})`,
          },
          {
            id: 'approved',
            label: `Approved (${requests.filter((r) => r.status === 'approved').length})`,
          },
          {
            id: 'denied',
            label: `On Hold / Denied (${requests.filter((r) => r.status === 'denied').length})`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`filter-pill ${filterStatus === tab.id ? 'active' : ''}`}
            onClick={() => setFilterStatus(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card">Loading partner requests...</div>
      ) : filteredRequests.length === 0 ? (
        <div className="card empty-state-card">
          <h3>No Purchase Requests Yet</h3>
          <p className="text-muted">
            Want to buy something—like a new game console, home upgrade, or hobby gear? Submit a purchase request to <strong>{otherPartner.name}</strong> so they can approve it, hold off, or set up a monthly savings budget and timeline with you.
          </p>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowNewForm(true)}
            >
              <Plus size={16} /> Submit Your First Request to {otherPartner.name.split(' ')[0]}
            </button>
          </div>
        </div>
      ) : (
        <div className="requests-list">
          {filteredRequests.map((req) => {
            const isPlanning = planningReqId === req.id;
            const tl = req.timeline || {};
            const liveRemaining = Math.max(0, req.amount - Number(planSaved || 0));
            const liveMonths =
              Number(planMonthly) > 0 ? Math.ceil(liveRemaining / Number(planMonthly)) : null;

            return (
              <div key={req.id} className={`card request-card status-${req.status}`}>
                <div className="request-card-top">
                  <div className="request-title-group">
                    <div className="request-badges">
                      {statusBadge(req.status)}
                      <span className="pill pill-outline">{req.category}</span>
                      <span className={`pill priority-${req.priority}`}>
                        {req.priority.toUpperCase()} PRIORITY
                      </span>
                    </div>
                    <h3>{req.title}</h3>
                    <p className="request-participants">
                      Requested by{' '}
                      <span className="partner-chip" style={{ borderColor: req.requester_color }}>
                        {req.requester_name}
                      </span>{' '}
                      → Reviewed by{' '}
                      <span className="partner-chip" style={{ borderColor: req.reviewer_color }}>
                        {req.reviewer_name}
                      </span>
                    </p>
                  </div>

                  <div className="request-price-box">
                    <span className="price-amount">${Number(req.amount).toFixed(2)}</span>
                    {req.url && (
                      <a
                        href={req.url}
                        target="_blank"
                        rel="noreferrer"
                        className="product-link"
                      >
                        View Item <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>

                {req.description && <p className="request-description">{req.description}</p>}

                {/* Savings & Timeline Progress Bar */}
                {(req.status === 'budget_planned' || req.proposed_monthly_contribution > 0) && (
                  <div className="timeline-progress-box">
                    <div className="timeline-progress-header">
                      <div>
                        <strong>
                          <CalendarClock size={16} /> Budget & Purchase Timeline
                        </strong>
                        <span>
                          Saved: <strong>${Number(req.saved_amount || 0).toFixed(2)}</strong> of $
                          {Number(req.amount).toFixed(2)} ({tl.progress_pct || 0}%)
                        </span>
                      </div>
                      <div className="timeline-Right-meta">
                        {req.proposed_monthly_contribution && (
                          <span className="pill pill-cyan">
                            ${Number(req.proposed_monthly_contribution).toFixed(0)}/mo plan
                          </span>
                        )}
                        {req.proposed_target_date && (
                          <span className="pill pill-outline">
                            Target Date: {req.proposed_target_date}
                          </span>
                        )}
                        {tl.months_to_goal !== null && tl.months_to_goal > 0 && (
                          <span className="pill pill-outline">
                            ~{tl.months_to_goal} mo remaining (Est. {tl.estimated_ready_date})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.min(100, tl.progress_pct || 0)}%` }}
                      />
                    </div>
                    {req.decision_notes && (
                      <p className="decision-note-banner">
                        <strong>Partner Plan Note:</strong> "{req.decision_notes}"
                      </p>
                    )}
                    <div className="quick-contribute-row">
                      <span>Add to this request's savings fund:</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleQuickContribute(req.id, 50)}
                      >
                        +$50
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleQuickContribute(req.id, 100)}
                      >
                        +$100
                      </button>
                      {req.proposed_monthly_contribution && (
                        <button
                          type="button"
                          className="btn btn-sm btn-accent"
                          onClick={() =>
                            handleQuickContribute(req.id, Number(req.proposed_monthly_contribution))
                          }
                        >
                          +Monthly Plan (${Number(req.proposed_monthly_contribution).toFixed(0)})
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {req.status !== 'budget_planned' && req.decision_notes && (
                  <p className="decision-note-banner">
                    <strong>Partner Decision Note:</strong> "{req.decision_notes}"
                  </p>
                )}

                {/* Decision Action Bar */}
                <div className="request-actions-bar">
                  <div className="action-buttons-left">
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      onClick={() =>
                        submitDecision(req.id, 'approved', {
                          decision_notes: `Approved by ${activePartner.name}! Go for it.`,
                        })
                      }
                    >
                      <CheckCircle2 size={16} />
                      Approve Now
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        submitDecision(req.id, 'under_review', {
                          decision_notes: `${activePartner.name} marked this Under Review while we check the monthly budget.`,
                        })
                      }
                    >
                      <Eye size={16} />
                      Under Review
                    </button>

                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      onClick={() =>
                        isPlanning ? setPlanningReqId(null) : openTimelinePlanner(req)
                      }
                    >
                      <CalendarClock size={16} />
                      {req.status === 'budget_planned'
                        ? 'Adjust Budget / Timeline'
                        : 'Set Up Budget & Timeline'}
                    </button>

                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm"
                      onClick={() =>
                        submitDecision(req.id, 'denied', {
                          decision_notes: `Let's hold off on this for now and revisit next quarter.`,
                        })
                      }
                    >
                      <XCircle size={16} />
                      Hold Off / Deny
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-danger"
                    onClick={() => handleDeleteRequest(req)}
                    title="Remove this purchase request"
                  >
                    <Trash2 size={15} />
                    Remove Request
                  </button>
                </div>

                {/* Interactive Budget & Timeline Builder Modal */}
                {isPlanning && (
                  <div
                    className="finance-modal-backdrop"
                    onClick={() => setPlanningReqId(null)}
                  >
                    <div
                      className="finance-modal-card"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="finance-modal-header">
                        <div>
                          <h3>
                            <CalendarClock size={18} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />
                            Configure Budget & Timeline for "{req.title}"
                          </h3>
                          <p className="text-muted">
                            Setting up a timeline automatically creates a linked goal in{' '}
                            <strong>Future Purchases</strong> so you can track monthly savings together.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          onClick={() => setPlanningReqId(null)}
                          aria-label="Close modal"
                        >
                          <X size={20} />
                        </button>
                      </div>
                      <div className="finance-modal-body">
                        <div className="form-grid-3">
                          <div className="form-group">
                            <label>Monthly Budget Allocation ($/month)</label>
                            <input
                              type="number"
                              step="5"
                              min="10"
                              className="input"
                              value={planMonthly}
                              onChange={(e) => setPlanMonthly(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label>Target Purchase Date</label>
                            <input
                              type="date"
                              className="input"
                              value={planTargetDate}
                              onChange={(e) => setPlanTargetDate(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label>Already Saved / Initial Allocation ($)</label>
                            <input
                              type="number"
                              step="10"
                              min="0"
                              className="input"
                              value={planSaved}
                              onChange={(e) => setPlanSaved(e.target.value)}
                            />
                          </div>
                        </div>

                        <div className="timeline-preview-callout" style={{ marginTop: '0.85rem' }}>
                          <span>
                            Remaining to save: <strong>${liveRemaining.toFixed(2)}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            At <strong>${Number(planMonthly || 0).toFixed(0)}/mo</strong>, ready to buy in{' '}
                            <strong>{liveMonths !== null ? `${liveMonths} month(s)` : 'N/A'}</strong>
                          </span>
                        </div>

                        <div className="form-group" style={{ marginTop: '0.85rem' }}>
                          <label>Note to Partner</label>
                          <input
                            type="text"
                            className="input"
                            value={decisionNotes}
                            onChange={(e) => setDecisionNotes(e.target.value)}
                            placeholder="e.g., Let's put $250/mo aside from our shared fun budget and buy it in January!"
                          />
                        </div>

                        <div className="form-actions" style={{ marginTop: '1.1rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setPlanningReqId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() =>
                              submitDecision(req.id, 'budget_planned', {
                                proposed_monthly_contribution: parseFloat(planMonthly),
                                proposed_target_date: planTargetDate,
                                saved_amount: parseFloat(planSaved || 0),
                                decision_notes: decisionNotes,
                              })
                            }
                          >
                            <Sparkles size={15} />
                            Activate Budget & Timeline Plan
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Discussion & Activity Thread */}
                <div className="request-comments-section">
                  <div className="comments-list">
                    {(req.comments || []).map((c) => (
                      <div key={c.id} className="comment-item">
                        <span
                          className="comment-avatar"
                          style={{ background: c.partner_color || '#6366f1' }}
                        >
                          {c.partner_name?.charAt(0)}
                        </span>
                        <div className="comment-body">
                          <strong>{c.partner_name}</strong>
                          <span>{c.comment}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="comment-input-row">
                    <input
                      type="text"
                      className="input input-sm"
                      placeholder={`Add a note or question as ${activePartner.name}...`}
                      value={commentInputs[req.id] || ''}
                      onChange={(e) =>
                        setCommentInputs((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddComment(req.id);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleAddComment(req.id)}
                    >
                      <MessageSquare size={14} /> Reply
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

