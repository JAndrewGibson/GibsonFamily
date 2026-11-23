import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ClipboardPaste,
  ExternalLink,
  Film,
  Heart,
  Play,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../api';
import InfoTip from '../components/InfoTip';

function formatWeekLabel(weekKey) {
  if (!weekKey) return 'This Week';
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return weekKey;
  return `Week ${Number(match[2])}, ${match[1]}`;
}

function formatDayLabel(dayKey) {
  if (!dayKey) return 'Today';
  const parsed = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dayKey;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function PlatformBadge({ platform }) {
  if (platform === 'youtube_short') {
    return (
      <span className="recap-platform-badge recap-badge-yt">
        <Film size={12} /> YouTube Short
      </span>
    );
  }
  if (platform === 'instagram_reel') {
    return (
      <span className="recap-platform-badge recap-badge-ig">
        <Clapperboard size={12} /> Instagram Reel
      </span>
    );
  }
  return (
    <span className="recap-platform-badge recap-badge-other">
      <ExternalLink size={12} /> Video Link
    </span>
  );
}

export default function RecapModule({
  onDataChanged,
  syncVersion,
  pendingShareUrl,
  pendingShareTitle,
  onClearPendingShare,
}) {
  const [period, setPeriod] = useState('week'); // 'week' | 'day' | 'all'
  const [selectedKey, setSelectedKey] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'unwatched' | 'watched' | 'favorites'
  const [clips, setClips] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [days, setDays] = useState([]);
  const [summary, setSummary] = useState({
    total_count: 0,
    unwatched_count: 0,
    watched_count: 0,
    current_week_key: '',
    current_day_key: '',
  });
  const [loading, setLoading] = useState(true);

  // Add clip form
  const [urlInput, setUrlInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Share setup modal
  const [showShareHelp, setShowShareHelp] = useState(false);

  // Full-screen back-to-back player state
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerQueue, setPlayerQueue] = useState([]);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [playerFinished, setPlayerFinished] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const ytIframeRef = useRef(null);

  const loadClips = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ period, status: statusFilter });
        if (selectedKey && period !== 'all') {
          params.set('key', selectedKey);
        }
        const data = await apiFetch(`/api/recap/clips?${params.toString()}`);
        setClips(data.clips || []);
        setWeeks(data.weeks || []);
        setDays(data.days || []);
        if (data.summary) setSummary(data.summary);
      } catch (err) {
        if (!silent) setErrorMsg(err.message || 'Failed to load recap queue');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [period, selectedKey, statusFilter]
  );

  useEffect(() => {
    loadClips({ silent: false });
  }, [loadClips]);

  useEffect(() => {
    if (syncVersion > 1) {
      loadClips({ silent: true });
    }
  }, [syncVersion, loadClips]);

  // Pre-fill from OS Share Sheet / Apple Shortcut URL params
  useEffect(() => {
    if (pendingShareUrl) {
      setUrlInput(pendingShareUrl);
      if (pendingShareTitle && !noteInput) {
        setNoteInput(pendingShareTitle);
      }
      onClearPendingShare?.();
    }
  }, [pendingShareUrl, pendingShareTitle, noteInput, onClearPendingShare]);

  const activePeriodKey = useMemo(() => {
    if (period === 'week') {
      return selectedKey || weeks[0]?.week_key || summary.current_week_key;
    }
    if (period === 'day') {
      return selectedKey || days[0]?.day_key || summary.current_day_key;
    }
    return '';
  }, [period, selectedKey, weeks, days, summary]);

  const handleAddClip = async (e) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await apiFetch('/api/recap/clips', {
        method: 'POST',
        body: JSON.stringify({
          url: trimmed,
          note: noteInput.trim(),
        }),
      });
      setUrlInput('');
      setNoteInput('');
      setSuccessMsg('Added to your Weekly Recap queue!');
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadClips({ silent: true });
      onDataChanged?.();
    } catch (err) {
      setErrorMsg(err.message || 'Could not add clip');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    setErrorMsg('');
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setUrlInput(text.trim());
        } else {
          setErrorMsg('Clipboard is empty. Copy a Reel or Short link first.');
        }
      }
    } catch {
      setErrorMsg('Clipboard access blocked—tap the input box and paste directly.');
    }
  };

  const handleToggleWatched = async (clip) => {
    const nextWatched = !clip.watched;
    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, watched: nextWatched ? 1 : 0 } : c))
    );
    await apiFetch(`/api/recap/clips/${clip.id}`, {
      method: 'PUT',
      body: JSON.stringify({ watched: nextWatched }),
    });
    await loadClips({ silent: true });
    onDataChanged?.();
  };

  const handleToggleFavorite = async (clip) => {
    const nextFav = !clip.favorite;
    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, favorite: nextFav ? 1 : 0 } : c))
    );
    setPlayerQueue((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, favorite: nextFav ? 1 : 0 } : c))
    );
    await apiFetch(`/api/recap/clips/${clip.id}`, {
      method: 'PUT',
      body: JSON.stringify({ favorite: nextFav }),
    });
    await loadClips({ silent: true });
  };

  const handleDeleteClip = async (clipId) => {
    await apiFetch(`/api/recap/clips/${clipId}`, { method: 'DELETE' });
    await loadClips({ silent: true });
    onDataChanged?.();
  };

  const handleMarkPeriodWatched = async () => {
    await apiFetch('/api/recap/clips/mark-period-watched', {
      method: 'POST',
      body: JSON.stringify({
        period,
        key: activePeriodKey,
      }),
    });
    await loadClips({ silent: true });
    onDataChanged?.();
  };

  const startRecapPlayer = (startAtClipId = null) => {
    const queue =
      startAtClipId !== null
        ? clips
        : clips.filter((c) => !c.watched).length > 0
          ? clips.filter((c) => !c.watched)
          : clips;
    if (queue.length === 0) return;

    const startIdx =
      startAtClipId !== null
        ? Math.max(
            0,
            queue.findIndex((c) => c.id === startAtClipId)
          )
        : 0;

    setPlayerQueue(queue);
    setPlayerIndex(startIdx);
    setPlayerFinished(false);
    setPlayerOpen(true);
  };

  const currentClip = playerQueue[playerIndex] || null;

  const advancePlayer = useCallback(
    async ({ markWatched = true } = {}) => {
      if (!currentClip) return;
      if (markWatched && !currentClip.watched) {
        try {
          await apiFetch(`/api/recap/clips/${currentClip.id}`, {
            method: 'PUT',
            body: JSON.stringify({ watched: true }),
          });
          setPlayerQueue((prev) =>
            prev.map((c) => (c.id === currentClip.id ? { ...c, watched: 1 } : c))
          );
          loadClips({ silent: true });
          onDataChanged?.();
        } catch {
          // non-blocking
        }
      }
      if (playerIndex + 1 < playerQueue.length) {
        setPlayerIndex((idx) => idx + 1);
      } else {
        setPlayerFinished(true);
      }
    },
    [currentClip, playerIndex, playerQueue.length, loadClips, onDataChanged]
  );

  // Listen for YouTube IFrame postMessage playerState === 0 (ENDED) for seamless auto-advance
  useEffect(() => {
    if (!playerOpen || playerFinished || !currentClip) return undefined;
    if (currentClip.platform !== 'youtube_short') return undefined;

    const onMessage = (event) => {
      if (!event.origin || !event.origin.includes('youtube')) return;
      let payload = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (
        payload &&
        payload.event === 'onStateChange' &&
        payload.info === 0 &&
        autoAdvance
      ) {
        advancePlayer({ markWatched: true });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [playerOpen, playerFinished, currentClip, autoAdvance, advancePlayer]);

  const registerYouTubeListener = () => {
    try {
      ytIframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: currentClip?.id || 1 }),
        '*'
      );
    } catch {
      // ignore
    }
  };

  const unwatchedInView = clips.filter((c) => !c.watched).length;

  return (
    <div className="module-container">
      <div className="section-header-bar" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <h2>Weekly Recap</h2>
          <InfoTip text="Send Instagram Reels & YouTube Shorts here instead of losing them in texts. Watch them back-to-back in a daily or weekly couples recap!" />
        </div>
        <div className="recap-header-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowShareHelp(true)}
            title="How to share straight from Instagram or YouTube on your phone"
          >
            <Share2 size={15} />
            <span>Phone Share</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={clips.length === 0}
            onClick={() => startRecapPlayer(null)}
          >
            <Play size={15} />
            <span>
              {unwatchedInView > 0
                ? `Watch Recap (${unwatchedInView})`
                : `Replay (${clips.length})`}
            </span>
          </button>
        </div>
      </div>

      {/* Quick Add Card */}
      <form className="card recap-add-card" onSubmit={handleAddClip}>
        <div className="recap-add-row">
          <div className="recap-url-input-wrap">
            <input
              type="url"
              className="input"
              placeholder="Paste Instagram Reel or YouTube Short link..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              required
            />
            {typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
              <button
                type="button"
                className="btn btn-ghost btn-sm recap-paste-btn"
                onClick={handlePasteFromClipboard}
                title="Paste from clipboard"
              >
                <ClipboardPaste size={15} />
                <span className="hide-on-mobile">Paste</span>
              </button>
            )}
          </div>
          <input
            type="text"
            className="input recap-note-input"
            placeholder="Optional note (e.g. 'Watch until the end 😂')"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            maxLength={300}
          />
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <Plus size={17} />
            <span>{submitting ? 'Saving...' : 'Queue'}</span>
          </button>
        </div>
        {errorMsg && <div className="recap-feedback recap-feedback-err">{errorMsg}</div>}
        {successMsg && <div className="recap-feedback recap-feedback-ok">{successMsg}</div>}
      </form>

      {/* Period & Filter Controls */}
      <div className="card recap-controls-card">
        <div className="recap-controls-top">
          <div className="recap-segmented">
            <button
              type="button"
              className={`recap-seg-btn ${period === 'week' ? 'active' : ''}`}
              onClick={() => {
                setPeriod('week');
                setSelectedKey('');
              }}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`recap-seg-btn ${period === 'day' ? 'active' : ''}`}
              onClick={() => {
                setPeriod('day');
                setSelectedKey('');
              }}
            >
              Daily
            </button>
            <button
              type="button"
              className={`recap-seg-btn ${period === 'all' ? 'active' : ''}`}
              onClick={() => {
                setPeriod('all');
                setSelectedKey('');
              }}
            >
              All ({summary.total_count})
            </button>
          </div>

          {period === 'week' && weeks.length > 0 && (
            <div className="recap-period-select-wrap">
              <Calendar size={15} className="text-muted" />
              <select
                className="input"
                value={activePeriodKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {weeks.map((w) => (
                  <option key={w.week_key} value={w.week_key}>
                    {formatWeekLabel(w.week_key)} ({w.unwatched_count} new / {w.total_count})
                  </option>
                ))}
              </select>
            </div>
          )}

          {period === 'day' && days.length > 0 && (
            <div className="recap-period-select-wrap">
              <Calendar size={15} className="text-muted" />
              <select
                className="input"
                value={activePeriodKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {days.map((d) => (
                  <option key={d.day_key} value={d.day_key}>
                    {formatDayLabel(d.day_key)} ({d.unwatched_count} new / {d.total_count})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="recap-controls-bottom">
          <div className="recap-filter-pills">
            {[
              { id: 'all', label: 'All' },
              { id: 'unwatched', label: 'Unwatched' },
              { id: 'watched', label: 'Watched' },
              { id: 'favorites', label: 'Favorites' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`recap-filter-pill ${statusFilter === f.id ? 'active' : ''}`}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {unwatchedInView > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleMarkPeriodWatched}
            >
              <CheckCheck size={15} />
              <span>Mark All Watched</span>
            </button>
          )}
        </div>
      </div>

      {/* Queue List */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="text-muted">Loading your recap queue...</span>
        </div>
      ) : clips.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2.25rem 1.25rem' }}>
          <Clapperboard size={34} style={{ color: 'var(--primary)', marginBottom: '0.6rem' }} />
          <h3>No Clips in This View</h3>
          <p className="text-muted" style={{ marginTop: '0.35rem', maxWidth: '420px', marginInline: 'auto' }}>
            Paste an Instagram Reel or YouTube Short link above to start building your next couples watch party.
          </p>
        </div>
      ) : (
        <div className="recap-grid">
          {clips.map((clip) => (
            <div
              key={clip.id}
              className={`card recap-clip-card ${clip.watched ? 'is-watched' : ''}`}
            >
              <button
                type="button"
                className="recap-thumb-btn"
                onClick={() => startRecapPlayer(clip.id)}
                title="Play in Recap Viewer"
              >
                {clip.thumbnail_url ? (
                  <img
                    src={clip.thumbnail_url}
                    alt={clip.title || 'Video thumbnail'}
                    className="recap-thumb-img"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className={`recap-thumb-placeholder ${
                      clip.platform === 'instagram_reel' ? 'is-ig' : 'is-other'
                    }`}
                  >
                    {clip.platform === 'instagram_reel' ? (
                      <Clapperboard size={28} />
                    ) : (
                      <Film size={28} />
                    )}
                  </div>
                )}
                <span className="recap-play-overlay">
                  <Play size={18} fill="currentColor" />
                </span>
              </button>

              <div className="recap-clip-body">
                <div className="recap-clip-meta-top">
                  <PlatformBadge platform={clip.platform} />
                  <span
                    className="recap-sender-pill"
                    style={{
                      borderColor: clip.submitted_by_color || 'var(--border)',
                    }}
                  >
                    <span
                      className="recap-sender-dot"
                      style={{ background: clip.submitted_by_color || 'var(--primary)' }}
                    />
                    {clip.submitted_by_name || 'Partner'}
                  </span>
                </div>

                <div className="recap-clip-title">
                  {clip.title || 'Shared Video'}
                </div>

                {clip.note && <div className="recap-clip-note">“{clip.note}”</div>}

                <div className="recap-clip-actions">
                  <button
                    type="button"
                    className={`btn btn-sm ${clip.watched ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => startRecapPlayer(clip.id)}
                  >
                    <Play size={14} />
                    <span>{clip.watched ? 'Replay' : 'Watch'}</span>
                  </button>
                  <button
                    type="button"
                    className={`btn-icon-subtle ${clip.watched ? 'is-active-ok' : ''}`}
                    onClick={() => handleToggleWatched(clip)}
                    title={clip.watched ? 'Mark as unwatched' : 'Mark as watched'}
                    aria-label={clip.watched ? 'Mark as unwatched' : 'Mark as watched'}
                  >
                    <CheckCircle2 size={18} />
                  </button>
                  <button
                    type="button"
                    className={`btn-icon-subtle ${clip.favorite ? 'is-active-fav' : ''}`}
                    onClick={() => handleToggleFavorite(clip)}
                    title={clip.favorite ? 'Remove favorite' : 'Favorite'}
                    aria-label={clip.favorite ? 'Remove favorite' : 'Favorite'}
                  >
                    <Heart size={18} fill={clip.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <a
                    href={clip.normalized_url || clip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-icon-subtle"
                    title="Open original link"
                    aria-label="Open original link"
                  >
                    <ExternalLink size={17} />
                  </a>
                  <button
                    type="button"
                    className="btn-icon-subtle"
                    onClick={() => handleDeleteClip(clip.id)}
                    title="Delete clip"
                    aria-label="Delete clip"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-Screen Back-to-Back Recap Player Modal */}
      {playerOpen && currentClip && (
        <div
          className="recap-player-backdrop"
          onClick={() => setPlayerOpen(false)}
        >
          <div
            className="recap-player-shell"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="recap-player-topbar">
              <div className="recap-player-progress">
                <strong>
                  {playerFinished
                    ? 'Recap Complete'
                    : `Clip ${playerIndex + 1} of ${playerQueue.length}`}
                </strong>
                {!playerFinished && (
                  <span className="recap-player-sender">
                    from {currentClip.submitted_by_name || 'Partner'}
                  </span>
                )}
              </div>

              <div className="recap-player-top-actions">
                {!playerFinished && currentClip.platform === 'youtube_short' && (
                  <label className="recap-auto-toggle" title="Auto-advance when YouTube Short ends">
                    <input
                      type="checkbox"
                      checked={autoAdvance}
                      onChange={(e) => setAutoAdvance(e.target.checked)}
                    />
                    <span>Auto-next</span>
                  </label>
                )}
                {!playerFinished && (
                  <button
                    type="button"
                    className={`btn-icon-subtle ${currentClip.favorite ? 'is-active-fav' : ''}`}
                    onClick={() => handleToggleFavorite(currentClip)}
                    aria-label="Toggle favorite"
                  >
                    <Heart size={19} fill={currentClip.favorite ? 'currentColor' : 'none'} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn-icon-subtle"
                  onClick={() => setPlayerOpen(false)}
                  aria-label="Close player"
                >
                  <X size={21} />
                </button>
              </div>
            </div>

            {playerFinished ? (
              <div className="recap-player-finished">
                <Sparkles size={40} style={{ color: 'var(--primary)' }} />
                <h3>All Caught Up!</h3>
                <p className="text-muted">
                  You watched all {playerQueue.length} clip{playerQueue.length === 1 ? '' : 's'} in this recap.
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setPlayerIndex(0);
                      setPlayerFinished(false);
                    }}
                  >
                    Replay Queue
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setPlayerOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                {currentClip.note && (
                  <div className="recap-player-note">“{currentClip.note}”</div>
                )}

                <div className="recap-stage">
                  {currentClip.platform === 'youtube_short' && currentClip.external_id ? (
                    <iframe
                      key={`yt-${currentClip.id}`}
                      ref={ytIframeRef}
                      src={`https://www.youtube.com/embed/${currentClip.external_id}?enablejsapi=1&autoplay=1&playsinline=1&rel=0`}
                      title={currentClip.title || 'YouTube Short'}
                      className="recap-iframe"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      onLoad={registerYouTubeListener}
                    />
                  ) : currentClip.platform === 'instagram_reel' && currentClip.external_id ? (
                    <div className="recap-ig-wrap">
                      <iframe
                        key={`ig-${currentClip.id}`}
                        src={`https://www.instagram.com/reel/${currentClip.external_id}/embed/`}
                        title={currentClip.title || 'Instagram Reel'}
                        className="recap-iframe"
                        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <div className="recap-player-fallback">
                      <ExternalLink size={32} />
                      <h4>{currentClip.title || 'Shared Video Link'}</h4>
                      <a
                        href={currentClip.normalized_url || currentClip.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                      >
                        Open Video in New Tab
                      </a>
                    </div>
                  )}
                </div>

                {currentClip.platform === 'instagram_reel' && (
                  <div className="recap-ig-hint">
                    <span>Instagram embeds don&apos;t auto-advance — tap Next when done.</span>
                    <a
                      href={currentClip.normalized_url || currentClip.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Instagram <ExternalLink size={12} />
                    </a>
                  </div>
                )}

                <div className="recap-player-controls">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={playerIndex === 0}
                    onClick={() => setPlayerIndex((idx) => Math.max(0, idx - 1))}
                  >
                    <ChevronLeft size={18} />
                    <span>Prev</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary recap-next-cta"
                    onClick={() => advancePlayer({ markWatched: true })}
                  >
                    <Check size={17} />
                    <span>
                      {playerIndex + 1 < playerQueue.length
                        ? 'Watched & Next'
                        : 'Finish Recap'}
                    </span>
                    <ChevronRight size={17} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => advancePlayer({ markWatched: false })}
                    title="Skip without marking watched"
                  >
                    <span>Skip</span>
                    <ChevronRight size={17} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile Share Sheet Setup Modal */}
      {showShareHelp && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowShareHelp(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <h3 style={{ margin: 0 }}>Send Straight From Your Phone</h3>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowShareHelp(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>
            <div className="finance-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <strong>Android (Chrome PWA):</strong>
                <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                  Install Family Hub to your home screen (&ldquo;Add to Home Screen&rdquo;). When you tap Share in Instagram or YouTube, Family Hub will appear in your share sheet automatically.
                </p>
              </div>
              <div>
                <strong>iPhone (Apple Shortcut):</strong>
                <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
                  Create a 2-step Shortcut named <em>&ldquo;Send to Recap&rdquo;</em> with <strong>Show in Share Sheet</strong> enabled (URLs):
                </p>
                <ol className="text-muted" style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
                  <li>Action: <strong>URL</strong> → <code>{`${window.location.origin}/?share_url=`}[Shortcut Input]</code></li>
                  <li>Action: <strong>Open URLs</strong></li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
