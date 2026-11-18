import React, { useEffect, useState } from 'react';
import {
  Award,
  BarChart3,
  BellRing,
  Bookmark,
  CheckCircle2,
  Clock,
  Crown,
  Flag,
  Gem,
  History,
  Layers,
  Play,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { apiFetch } from '../api';

const GEM_META = {
  white: {
    key: 'white',
    name: 'White / Diamond',
    short: 'Diamond',
    code: 'W',
    bg: '#f8fafc',
    text: '#0f172a',
    border: '#cbd5e1',
    accent: '#94a3b8',
  },
  blue: {
    key: 'blue',
    name: 'Blue / Sapphire',
    short: 'Sapphire',
    code: 'U',
    bg: '#2563eb',
    text: '#ffffff',
    border: '#60a5fa',
    accent: '#3b82f6',
  },
  green: {
    key: 'green',
    name: 'Green / Emerald',
    short: 'Emerald',
    code: 'G',
    bg: '#059669',
    text: '#ffffff',
    border: '#34d399',
    accent: '#10b981',
  },
  red: {
    key: 'red',
    name: 'Red / Ruby',
    short: 'Ruby',
    code: 'R',
    bg: '#dc2626',
    text: '#ffffff',
    border: '#f87171',
    accent: '#ef4444',
  },
  black: {
    key: 'black',
    name: 'Black / Onyx',
    short: 'Onyx',
    code: 'K',
    bg: '#1e293b',
    text: '#f8fafc',
    border: '#64748b',
    accent: '#475569',
  },
  gold: {
    key: 'gold',
    name: 'Gold / Wild Joker',
    short: 'Gold',
    code: '★',
    bg: '#eab308',
    text: '#0f172a',
    border: '#fde047',
    accent: '#f59e0b',
  },
};

const GEM_COLORS = ['white', 'blue', 'green', 'red', 'black'];
const ALL_TOKEN_TYPES = ['white', 'blue', 'green', 'red', 'black', 'gold'];

function canPlayerAffordCard(playerState, card) {
  if (!playerState || !card) return { affordable: false, goldNeeded: 0 };
  const tokens = playerState.tokens || {};
  const bonuses = playerState.bonuses || {};
  const cost = card.cost || {};
  let goldNeeded = 0;

  for (const color of GEM_COLORS) {
    const req = Number(cost[color] || 0);
    const disc = Number(bonuses[color] || 0);
    const eff = Math.max(0, req - disc);
    const have = Number(tokens[color] || 0);
    if (have < eff) {
      goldNeeded += eff - have;
    }
  }
  const goldHave = Number(tokens.gold || 0);
  return {
    affordable: goldNeeded <= goldHave,
    goldNeeded,
  };
}

function formatCooldown(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export default function SplendorModule({
  activePartner,
  partners = [],
  onDataChanged,
  syncVersion,
}) {
  const [loading, setLoading] = useState(true);
  const [activeGame, setActiveGame] = useState(null);
  const [latestFinishedGame, setLatestFinishedGame] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [subTab, setSubTab] = useState('board'); // 'board' | 'analytics'
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Turn builder state
  const [turnMode, setTurnMode] = useState('take_different'); // 'take_different' | 'take_same'
  const [selectedDiffGems, setSelectedDiffGems] = useState([]);
  const [selectedSameGem, setSelectedSameGem] = useState('');
  const [returnTokens, setReturnTokens] = useState({});
  const [firstPlayerChoice, setFirstPlayerChoice] = useState(activePartner?.id || '');
  const [confirmForfeit, setConfirmForfeit] = useState(false);

  const loadSplendorData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch('/api/splendor/state');
      setActiveGame(data.active_game || null);
      setLatestFinishedGame(data.latest_finished_game || null);
      setAnalytics(data.analytics || null);
    } catch (err) {
      if (!silent) setErrorMsg(err.message || 'Failed to load Splendor game state.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadSplendorData(false);
  }, []);

  useEffect(() => {
    if (syncVersion > 1) {
      loadSplendorData(true);
    }
  }, [syncVersion]);

  const resetTurnSelections = () => {
    setSelectedDiffGems([]);
    setSelectedSameGem('');
    setReturnTokens({});
  };

  const handleStartNewGame = async () => {
    setBusy(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/splendor/new', {
        method: 'POST',
        body: JSON.stringify({
          first_turn_partner_id: Number(firstPlayerChoice || activePartner?.id),
        }),
      });
      setActiveGame(res.game);
      setLatestFinishedGame(null);
      setAnalytics(res.analytics);
      setSubTab('board');
      resetTurnSelections();
      setFeedback('New game of Splendor started! 90 development cards shuffled & 3 Nobles revealed.');
      onDataChanged?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleBumpPartner = async () => {
    if (!activeGame) return;
    setBusy(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/splendor/${activeGame.id}/bump`, {
        method: 'POST',
      });
      setActiveGame(res.game);
      setFeedback(`Bump notification sent to ${activeGame.current_turn_name}! (1 allowed every 24h)`);
      onDataChanged?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleForfeitGame = async () => {
    if (!activeGame) return;
    setBusy(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/splendor/${activeGame.id}/forfeit`, {
        method: 'POST',
      });
      setActiveGame(null);
      setLatestFinishedGame(res.game);
      setAnalytics(res.analytics);
      setConfirmForfeit(false);
      resetTurnSelections();
      setFeedback('Game forfeited. Final card counts and match winner have been saved to analytics.');
      onDataChanged?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const executeTurnAction = async (payload) => {
    if (!activeGame) return;
    setBusy(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/splendor/${activeGame.id}/turn`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.game.status === 'active') {
        setActiveGame(res.game);
      } else {
        setActiveGame(null);
        setLatestFinishedGame(res.game);
      }
      setAnalytics(res.analytics);
      resetTurnSelections();
      const latestLog = res.game.state?.move_log?.slice(-1)[0]?.text;
      setFeedback(latestLog || 'Turn completed!');
      onDataChanged?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDiffGem = (color) => {
    setErrorMsg(null);
    if (selectedDiffGems.includes(color)) {
      setSelectedDiffGems(selectedDiffGems.filter((c) => c !== color));
      return;
    }
    if (selectedDiffGems.length >= 3) {
      setErrorMsg('You can take at most 3 different gem colors.');
      return;
    }
    const bankCount = Number(activeGame?.state?.bank?.[color] || 0);
    if (bankCount < 1) {
      setErrorMsg(`No ${GEM_META[color].short} gems left in the bank.`);
      return;
    }
    setSelectedDiffGems([...selectedDiffGems, color]);
  };

  const adjustReturnToken = (color, delta, maxAvailable) => {
    const current = Number(returnTokens[color] || 0);
    const next = Math.max(0, Math.min(maxAvailable, current + delta));
    setReturnTokens({
      ...returnTokens,
      [color]: next,
    });
  };

  if (loading) {
    return (
      <div className="module-container">
        <div className="card">Loading Splendor Board & Match Analytics...</div>
      </div>
    );
  }

  const displayGame = activeGame || latestFinishedGame;
  const gState = displayGame?.state || null;
  const isMyTurn =
    Boolean(activeGame) && Number(activeGame.current_turn_partner_id) === Number(activePartner?.id);

  const myPlayerState =
    gState && activePartner ? gState.players?.[String(activePartner.id)] : null;
  const currentHeldTokens = myPlayerState
    ? Object.values(myPlayerState.tokens || {}).reduce((acc, v) => acc + Number(v || 0), 0)
    : 0;

  const addedGemsCount =
    turnMode === 'take_different'
      ? selectedDiffGems.length
      : turnMode === 'take_same' && selectedSameGem
      ? 2
      : 0;

  const totalReturnedCount = Object.values(returnTokens).reduce(
    (acc, v) => acc + Number(v || 0),
    0
  );
  const projectedTokensAfterGemTake = currentHeldTokens + addedGemsCount - totalReturnedCount;
  const excessTokensToReturn = Math.max(0, currentHeldTokens + addedGemsCount - 10);

  return (
    <div className="module-container splendor-module">
      {/* Header & View Switcher */}
      <div className="section-header-bar">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Gem size={24} style={{ color: 'var(--primary)' }} />
            <span>Splendor — Couples Edition</span>
          </h2>
          <p className="text-muted">
            90 development cards across 3 tiers & 5 gem colors + 10 noble tiles. Race to 15 Prestige Points!
          </p>
        </div>

        <div className="splendor-header-actions">
          <div className="splendor-tab-switcher">
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'board' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('board')}
            >
              <Layers size={15} /> Game Board
            </button>
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'analytics' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('analytics')}
            >
              <BarChart3 size={15} /> Stats & Analytics ({analytics?.total_games || 0})
            </button>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="splendor-alert splendor-alert-error">
          <span>{errorMsg}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setErrorMsg(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {feedback && (
        <div className="splendor-alert splendor-alert-success">
          <span>{feedback}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFeedback(null)}
          >
            OK
          </button>
        </div>
      )}

      {subTab === 'board' && (
        <>
          {/* Turn Status & Bump / Forfeit / New Game Banner */}
          {activeGame ? (
            <div className={`card splendor-turn-banner ${isMyTurn ? 'my-turn' : 'partner-turn'}`}>
              <div className="splendor-turn-banner-main">
                <div className="splendor-turn-indicator">
                  {isMyTurn ? (
                    <span className="splendor-turn-pill my-turn-pill">
                      <Sparkles size={15} /> YOUR TURN
                    </span>
                  ) : (
                    <span className="splendor-turn-pill waiting-pill">
                      <Clock size={15} /> WAITING FOR {activeGame.current_turn_name.toUpperCase()}
                    </span>
                  )}
                  <span className="splendor-game-meta">
                    Game #{activeGame.id} · Turn {activeGame.turns_count + 1}
                    {gState?.final_round_triggered && (
                      <strong className="splendor-final-round-tag">
                        🔥 FINAL ROUND (15+ PTS REACHED!)
                      </strong>
                    )}
                  </span>
                </div>

                <p className="text-muted" style={{ fontSize: '0.86rem', marginTop: '0.25rem' }}>
                  {isMyTurn
                    ? 'Take gems from the bank, buy a development card below, or reserve a card for +1 Gold token.'
                    : `It is ${activeGame.current_turn_name}'s turn. You can send a bump notification once every 24 hours to remind them.`}
                </p>
              </div>

              <div className="splendor-turn-banner-actions">
                {!isMyTurn && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleBumpPartner}
                    disabled={busy || !activeGame.bump_available}
                    title={
                      activeGame.bump_available
                        ? `Send a push/in-app bump notification to ${activeGame.current_turn_name}`
                        : `Next bump available in ${formatCooldown(activeGame.bump_cooldown_seconds)}`
                    }
                  >
                    <BellRing size={15} />
                    {activeGame.bump_available
                      ? `Bump ${activeGame.current_turn_name}`
                      : `Bump Cooldown (${formatCooldown(activeGame.bump_cooldown_seconds)})`}
                  </button>
                )}

                {!confirmForfeit ? (
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    onClick={() => setConfirmForfeit(true)}
                    disabled={busy}
                  >
                    <Flag size={14} /> Forfeit Game
                  </button>
                ) : (
                  <div className="splendor-forfeit-confirm">
                    <span>Forfeit match?</span>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={handleForfeitGame}
                      disabled={busy}
                    >
                      Yes, Forfeit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmForfeit(false)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card splendor-new-game-card">
              <div className="splendor-new-game-info">
                <h3>
                  {latestFinishedGame ? (
                    <>
                      🏆 Game #{latestFinishedGame.id}{' '}
                      {latestFinishedGame.status === 'forfeited' ? 'Ended by Forfeit' : 'Completed'} —{' '}
                      {latestFinishedGame.winner_name} Won!
                    </>
                  ) : (
                    'Ready to Start a New Game of Splendor'
                  )}
                </h3>
                <p className="text-muted">
                  {latestFinishedGame ? (
                    <>
                      Final Score: <strong>{latestFinishedGame.player1_name}</strong>{' '}
                      {latestFinishedGame.player1_points} pts ({latestFinishedGame.player1_cards_played}{' '}
                      cards played) vs. <strong>{latestFinishedGame.player2_name}</strong>{' '}
                      {latestFinishedGame.player2_points} pts ({latestFinishedGame.player2_cards_played}{' '}
                      cards played).
                      {latestFinishedGame.forfeited_by_name
                        ? ` (${latestFinishedGame.forfeited_by_name} forfeited).`
                        : ''}
                    </>
                  ) : (
                    'Play head-to-head with all 90 official development cards (40 Tier I, 30 Tier II, 20 Tier III) and 10 Noble tiles.'
                  )}
                </p>
              </div>

              <div className="splendor-new-game-controls">
                <label className="splendor-first-turn-select">
                  <span>First Turn:</span>
                  <select
                    value={firstPlayerChoice}
                    onChange={(e) => setFirstPlayerChoice(Number(e.target.value))}
                  >
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleStartNewGame}
                  disabled={busy}
                >
                  <Play size={16} /> Start New Game
                </button>
              </div>
            </div>
          )}

          {/* Render Active or Latest Finished Game Board */}
          {displayGame && gState && (
            <>
              {/* Two Player Dashboards (Points, Cards Played, Gem Bonuses, Held Tokens & Reserved Cards) */}
              <div className="splendor-players-grid">
                {[
                  {
                    id: displayGame.player1_id,
                    name: displayGame.player1_name,
                    color: displayGame.player1_color,
                  },
                  {
                    id: displayGame.player2_id,
                    name: displayGame.player2_name,
                    color: displayGame.player2_color,
                  },
                ].map((plr) => {
                  const pState = gState.players?.[String(plr.id)] || {
                    tokens: {},
                    bonuses: {},
                    points: 0,
                    purchased_cards: [],
                    reserved_cards: [],
                    nobles: [],
                  };
                  const isTurnPlayer =
                    displayGame.status === 'active' &&
                    Number(displayGame.current_turn_partner_id) === Number(plr.id);
                  const isCurrentUser = Number(activePartner?.id) === Number(plr.id);
                  const totalTokens = Object.values(pState.tokens || {}).reduce(
                    (acc, v) => acc + Number(v || 0),
                    0
                  );

                  return (
                    <div
                      key={plr.id}
                      className={`card splendor-player-card ${isTurnPlayer ? 'active-turn-player' : ''}`}
                    >
                      <div className="splendor-player-header">
                        <div className="splendor-player-identity">
                          <span
                            className="partner-dot"
                            style={{ background: plr.color, width: 12, height: 12 }}
                          />
                          <h4>
                            {plr.name} {isCurrentUser && <span className="text-muted">(You)</span>}
                          </h4>
                          {isTurnPlayer && <span className="splendor-mini-turn-badge">Active Turn</span>}
                          {displayGame.winner_partner_id === plr.id && (
                            <span className="splendor-winner-badge">
                              <Trophy size={13} /> Winner
                            </span>
                          )}
                        </div>

                        <div className="splendor-player-score-box">
                          <div className="splendor-prestige-pill" title="Prestige Points (Goal: 15)">
                            <Crown size={15} />
                            <strong>{pState.points || 0}</strong>
                            <span>/ 15 pts</span>
                          </div>
                          <div className="splendor-cards-played-pill" title="Development Cards Played">
                            <Layers size={14} />
                            <strong>{(pState.purchased_cards || []).length}</strong>
                            <span>cards</span>
                          </div>
                        </div>
                      </div>

                      {/* Gem Bonuses (Permanent Discounts from Purchased Cards) & Tokens Held */}
                      <div className="splendor-player-resources">
                        <div className="splendor-resource-row">
                          <span className="splendor-resource-label">Card Bonuses (Permanent):</span>
                          <div className="splendor-gem-chips-row">
                            {GEM_COLORS.map((color) => {
                              const meta = GEM_META[color];
                              const count = Number(pState.bonuses?.[color] || 0);
                              return (
                                <div
                                  key={color}
                                  className="splendor-gem-badge bonus-badge"
                                  style={{
                                    background: meta.bg,
                                    color: meta.text,
                                    borderColor: meta.border,
                                    opacity: count > 0 ? 1 : 0.45,
                                  }}
                                  title={`${meta.name} Card Bonus: -${count} cost`}
                                >
                                  <span>{meta.short}</span>
                                  <strong>+{count}</strong>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="splendor-resource-row">
                          <span className="splendor-resource-label">
                            Gem Tokens ({totalTokens} / 10):
                          </span>
                          <div className="splendor-gem-chips-row">
                            {ALL_TOKEN_TYPES.map((color) => {
                              const meta = GEM_META[color];
                              const count = Number(pState.tokens?.[color] || 0);
                              return (
                                <div
                                  key={color}
                                  className="splendor-gem-badge token-badge"
                                  style={{
                                    background: meta.bg,
                                    color: meta.text,
                                    borderColor: meta.border,
                                    opacity: count > 0 ? 1 : 0.4,
                                  }}
                                  title={`${meta.name} Tokens: ${count}`}
                                >
                                  <span>{meta.short}</span>
                                  <strong>{count}</strong>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Visited Nobles */}
                      {(pState.nobles || []).length > 0 && (
                        <div className="splendor-player-nobles">
                          <span className="splendor-resource-label">Visited Nobles:</span>
                          <div className="splendor-visited-nobles-list">
                            {pState.nobles.map((n) => (
                              <span key={n.id} className="splendor-visited-noble-chip">
                                👑 {n.title} (+{n.points} pts)
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Reserved Cards (Up to 3) */}
                      <div className="splendor-player-reserved">
                        <span className="splendor-resource-label">
                          Reserved Cards ({(pState.reserved_cards || []).length} / 3):
                        </span>
                        {(pState.reserved_cards || []).length === 0 ? (
                          <p className="text-muted" style={{ fontSize: '0.78rem' }}>
                            No reserved cards. Reserve any card on the board to hold it & gain +1 Gold token.
                          </p>
                        ) : (
                          <div className="splendor-reserved-cards-grid">
                            {pState.reserved_cards.map((rc) => {
                              const bMeta = GEM_META[rc.bonus];
                              const affordInfo = canPlayerAffordCard(pState, rc);
                              return (
                                <div
                                  key={rc.id}
                                  className="splendor-mini-reserved-card"
                                  style={{ borderTop: `4px solid ${bMeta.bg}` }}
                                >
                                  <div className="splendor-mini-reserved-top">
                                    <strong>{rc.points} pt</strong>
                                    <span
                                      className="splendor-card-bonus-pill"
                                      style={{
                                        background: bMeta.bg,
                                        color: bMeta.text,
                                        borderColor: bMeta.border,
                                      }}
                                    >
                                      {bMeta.short}
                                    </span>
                                  </div>
                                  <div className="splendor-mini-reserved-title">{rc.title}</div>
                                  <div className="splendor-card-cost-list">
                                    {Object.entries(rc.cost || {}).map(([cColor, cVal]) => {
                                      const cMeta = GEM_META[cColor];
                                      return (
                                        <span
                                          key={cColor}
                                          className="splendor-cost-number"
                                          style={{
                                            background: cMeta.bg,
                                            color: cMeta.text,
                                            borderColor: cMeta.border,
                                          }}
                                        >
                                          {cMeta.short[0]}:{cVal}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  {isCurrentUser && isMyTurn && (
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      style={{ width: '100%', marginTop: '0.35rem' }}
                                      disabled={busy || !affordInfo.affordable}
                                      onClick={() =>
                                        executeTurnAction({
                                          action: 'buy',
                                          card_id: rc.id,
                                        })
                                      }
                                    >
                                      <ShoppingBag size={13} />{' '}
                                      {affordInfo.affordable
                                        ? affordInfo.goldNeeded > 0
                                          ? `Buy (Uses ${affordInfo.goldNeeded} Gold)`
                                          : 'Buy Reserved'
                                        : 'Cannot Afford'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Gem Bank & Take Gems Action Panel */}
              <div className="card splendor-bank-card">
                <div className="splendor-bank-header">
                  <div>
                    <h3>💎 Gem Bank & Token Actions</h3>
                    <p className="text-muted" style={{ fontSize: '0.84rem' }}>
                      On your turn: take <strong>3 different gem colors</strong>, take{' '}
                      <strong>2 gems of the same color</strong> (requires 4+ in bank), or buy/reserve a card below.
                    </p>
                  </div>

                  {isMyTurn && (
                    <div className="splendor-take-mode-tabs">
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          turnMode === 'take_different' ? 'btn-primary' : 'btn-secondary'
                        }`}
                        onClick={() => {
                          setTurnMode('take_different');
                          resetTurnSelections();
                        }}
                      >
                        Take 3 Different
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          turnMode === 'take_same' ? 'btn-primary' : 'btn-secondary'
                        }`}
                        onClick={() => {
                          setTurnMode('take_same');
                          resetTurnSelections();
                        }}
                      >
                        Take 2 Same (4+ in Bank)
                      </button>
                    </div>
                  )}
                </div>

                {/* Bank Gem Buttons */}
                <div className="splendor-bank-gems-grid">
                  {ALL_TOKEN_TYPES.map((color) => {
                    const meta = GEM_META[color];
                    const available = Number(gState.bank?.[color] || 0);
                    const isGold = color === 'gold';
                    const isSelectedDiff =
                      turnMode === 'take_different' && selectedDiffGems.includes(color);
                    const isSelectedSame = turnMode === 'take_same' && selectedSameGem === color;
                    const isSelected = isSelectedDiff || isSelectedSame;

                    const canClick =
                      isMyTurn &&
                      !isGold &&
                      ((turnMode === 'take_different' && available > 0) ||
                        (turnMode === 'take_same' && available >= 4));

                    return (
                      <button
                        key={color}
                        type="button"
                        className={`splendor-bank-gem-tile ${isSelected ? 'selected' : ''}`}
                        style={{
                          borderColor: isSelected ? 'var(--primary)' : meta.border,
                        }}
                        disabled={!canClick && !isSelected}
                        onClick={() => {
                          if (!isMyTurn || isGold) return;
                          if (turnMode === 'take_different') {
                            toggleDiffGem(color);
                          } else {
                            setSelectedSameGem(selectedSameGem === color ? '' : color);
                          }
                        }}
                      >
                        <div
                          className="splendor-gem-circle"
                          style={{
                            background: meta.bg,
                            color: meta.text,
                            borderColor: meta.border,
                          }}
                        >
                          {available}
                        </div>
                        <div className="splendor-bank-gem-meta">
                          <strong>{meta.name}</strong>
                          <span>
                            {isGold
                              ? `${available} left (Reserve card)`
                              : turnMode === 'take_same'
                              ? available >= 4
                                ? `${available} in bank (Eligible for 2)`
                                : `${available} in bank (Need 4 for 2x)`
                              : `${available} in bank`}
                          </span>
                        </div>
                        {isSelected && (
                          <span className="splendor-selected-gem-tag">
                            {isSelectedSame ? '+2' : '+1'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Token limit (> 10) return helper if taking gems exceeds 10 tokens */}
                {isMyTurn && addedGemsCount > 0 && currentHeldTokens + addedGemsCount > 10 && (
                  <div className="splendor-discard-box">
                    <strong>
                      Token Limit Reached ({currentHeldTokens} held + {addedGemsCount} new ={' '}
                      {currentHeldTokens + addedGemsCount} / 10 max)
                    </strong>
                    <p className="text-muted" style={{ fontSize: '0.82rem' }}>
                      Select {excessTokensToReturn} token(s) to return to the bank so you end your turn with 10:
                    </p>
                    <div className="splendor-discard-controls">
                      {ALL_TOKEN_TYPES.map((color) => {
                        const held = Number(myPlayerState?.tokens?.[color] || 0);
                        const added =
                          turnMode === 'take_different'
                            ? selectedDiffGems.includes(color)
                              ? 1
                              : 0
                            : selectedSameGem === color
                            ? 2
                            : 0;
                        const maxRet = held + added;
                        if (maxRet <= 0) return null;
                        const retCnt = Number(returnTokens[color] || 0);
                        const meta = GEM_META[color];
                        return (
                          <div key={color} className="splendor-discard-stepper">
                            <span>
                              {meta.short} (Have {maxRet}):
                            </span>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => adjustReturnToken(color, -1, maxRet)}
                            >
                              -
                            </button>
                            <strong>{retCnt}</strong>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => adjustReturnToken(color, 1, maxRet)}
                            >
                              +
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isMyTurn && (
                  <div className="splendor-bank-submit-bar">
                    {turnMode === 'take_different' ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          busy ||
                          selectedDiffGems.length === 0 ||
                          projectedTokensAfterGemTake > 10
                        }
                        onClick={() =>
                          executeTurnAction({
                            action: 'take_different',
                            gems: selectedDiffGems,
                            return_tokens: returnTokens,
                          })
                        }
                      >
                        <CheckCircle2 size={16} /> Confirm Take {selectedDiffGems.length} Different Gem(s)
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          busy ||
                          !selectedSameGem ||
                          projectedTokensAfterGemTake > 10
                        }
                        onClick={() =>
                          executeTurnAction({
                            action: 'take_same',
                            gem: selectedSameGem,
                            return_tokens: returnTokens,
                          })
                        }
                      >
                        <CheckCircle2 size={16} /> Confirm Take 2{' '}
                        {selectedSameGem ? GEM_META[selectedSameGem].short : ''} Gems
                      </button>
                    )}

                    {(selectedDiffGems.length > 0 || selectedSameGem) && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={resetTurnSelections}
                      >
                        <RotateCcw size={14} /> Clear Selection
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Noble Tiles Row (3 Active Nobles from the 10-Noble Pool) */}
              <div className="card splendor-nobles-card">
                <div className="splendor-section-title-row">
                  <h3>👑 Noble Tiles (3 Prestige Points Each)</h3>
                  <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                    Automatically visits you at the end of your turn when your permanent card bonuses meet requirements.
                  </span>
                </div>

                {(gState.nobles || []).length === 0 ? (
                  <p className="text-muted">All Nobles in this match have visited players!</p>
                ) : (
                  <div className="splendor-nobles-grid">
                    {gState.nobles.map((noble) => (
                      <div key={noble.id} className="splendor-noble-tile">
                        <div className="splendor-noble-header">
                          <span className="splendor-noble-pts">+{noble.points} PTS</span>
                          <strong className="splendor-noble-title">{noble.title}</strong>
                        </div>
                        <div className="splendor-noble-reqs">
                          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                            Requires Card Bonuses:
                          </span>
                          <div className="splendor-card-cost-list">
                            {Object.entries(noble.requirements || {}).map(([cColor, cVal]) => {
                              const cMeta = GEM_META[cColor];
                              const myBonus = Number(myPlayerState?.bonuses?.[cColor] || 0);
                              const met = myBonus >= Number(cVal);
                              return (
                                <span
                                  key={cColor}
                                  className={`splendor-cost-number ${met ? 'req-met' : ''}`}
                                  style={{
                                    background: cMeta.bg,
                                    color: cMeta.text,
                                    borderColor: cMeta.border,
                                  }}
                                >
                                  {cMeta.short}: {cVal}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 90 Development Cards Board (Tier 3, Tier 2, Tier 1) */}
              <div className="card splendor-board-card">
                <div className="splendor-section-title-row">
                  <h3>🃏 Development Cards Market (Tier III, Tier II, Tier I)</h3>
                  <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                    Each card displays its Prestige Points, Card Title / Type, Gem Bonus color, and Gem Cost numbers.
                  </span>
                </div>

                {['3', '2', '1'].map((tierKey) => {
                  const cards = gState.board?.[tierKey] || [];
                  const deckRemaining = Number(gState.deck_counts?.[tierKey] || 0);
                  const tierLabel =
                    tierKey === '3'
                      ? 'Tier III — Imperial Estates (3–5 pts)'
                      : tierKey === '2'
                      ? 'Tier II — Master Artisans (1–3 pts)'
                      : 'Tier I — Gem Mines & Quarries (0–1 pt)';

                  return (
                    <div key={tierKey} className="splendor-tier-section">
                      <div className="splendor-tier-header">
                        <div className="splendor-tier-title">
                          <span className={`splendor-tier-badge tier-${tierKey}`}>
                            TIER {tierKey}
                          </span>
                          <strong>{tierLabel}</strong>
                        </div>

                        <div className="splendor-deck-status">
                          <span className="splendor-deck-count-pill">
                            Deck: {deckRemaining} card{deckRemaining === 1 ? '' : 's'} left
                          </span>
                          {isMyTurn &&
                            deckRemaining > 0 &&
                            (myPlayerState?.reserved_cards || []).length < 3 && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={busy}
                                onClick={() =>
                                  executeTurnAction({
                                    action: 'reserve',
                                    tier: tierKey,
                                  })
                                }
                                title={`Blind-reserve the top card of Tier ${tierKey} deck`}
                              >
                                <Bookmark size={13} /> Blind Reserve Deck
                              </button>
                            )}
                        </div>
                      </div>

                      <div className="splendor-cards-row">
                        {cards.map((card) => {
                          const bMeta = GEM_META[card.bonus];
                          const affordInfo = canPlayerAffordCard(myPlayerState, card);
                          const canReserve =
                            (myPlayerState?.reserved_cards || []).length < 3;

                          return (
                            <div
                              key={card.id}
                              className={`splendor-dev-card ${
                                isMyTurn && affordInfo.affordable ? 'card-affordable' : ''
                              }`}
                              style={{
                                borderTop: `6px solid ${bMeta.bg}`,
                              }}
                            >
                              {/* Top bar: Prestige Points & Bonus Color */}
                              <div className="splendor-dev-card-top">
                                <div className="splendor-dev-card-points">
                                  {card.points > 0 ? `${card.points} PT` : '0 PT'}
                                </div>
                                <div
                                  className="splendor-card-bonus-pill"
                                  style={{
                                    background: bMeta.bg,
                                    color: bMeta.text,
                                    borderColor: bMeta.border,
                                  }}
                                >
                                  +1 {bMeta.short}
                                </div>
                              </div>

                              {/* Title / Type of Card */}
                              <div className="splendor-dev-card-body">
                                <div className="splendor-dev-card-title">{card.title}</div>
                                <div className="splendor-dev-card-subtitle">
                                  Tier {card.tier} · {bMeta.name} Bonus
                                </div>
                              </div>

                              {/* Numbers / Gem Cost Breakdown */}
                              <div className="splendor-dev-card-costs">
                                <span className="splendor-cost-header">Gem Cost:</span>
                                <div className="splendor-card-cost-list">
                                  {Object.entries(card.cost || {}).map(([cColor, cVal]) => {
                                    const cMeta = GEM_META[cColor];
                                    const myDiscount = Number(
                                      myPlayerState?.bonuses?.[cColor] || 0
                                    );
                                    const netCost = Math.max(0, Number(cVal) - myDiscount);
                                    return (
                                      <div
                                        key={cColor}
                                        className="splendor-cost-chip"
                                        style={{
                                          background: cMeta.bg,
                                          color: cMeta.text,
                                          borderColor: cMeta.border,
                                        }}
                                        title={`${cMeta.name}: Cost ${cVal} (Net ${netCost} after your +${myDiscount} bonus)`}
                                      >
                                        <span className="cost-gem-name">{cMeta.short}</span>
                                        <strong className="cost-gem-num">{cVal}</strong>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Card Action Buttons on User's Turn */}
                              {isMyTurn && (
                                <div className="splendor-dev-card-actions">
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={busy || !affordInfo.affordable}
                                    onClick={() =>
                                      executeTurnAction({
                                        action: 'buy',
                                        card_id: card.id,
                                      })
                                    }
                                  >
                                    <ShoppingBag size={13} />{' '}
                                    {affordInfo.affordable
                                      ? affordInfo.goldNeeded > 0
                                        ? `Buy (${affordInfo.goldNeeded}★)`
                                        : 'Buy'
                                      : 'Buy'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={busy || !canReserve}
                                    onClick={() =>
                                      executeTurnAction({
                                        action: 'reserve',
                                        card_id: card.id,
                                      })
                                    }
                                    title="Reserve card into your hand and take 1 Gold joker token"
                                  >
                                    <Bookmark size={13} /> Reserve
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Match Activity Log */}
              <div className="card splendor-log-card">
                <h4>📜 Recent Turn Log</h4>
                <div className="splendor-log-list">
                  {(gState.move_log || [])
                    .slice()
                    .reverse()
                    .map((entry, idx) => (
                      <div key={idx} className="splendor-log-item">
                        <span className="splendor-log-turn">
                          {entry.turn > 0 ? `Turn ${entry.turn}` : 'Start'}
                        </span>
                        <span className="splendor-log-text">{entry.text}</span>
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Fun Stats & Analytics Tab */}
      {subTab === 'analytics' && analytics && (
        <div className="splendor-analytics-section">
          {/* Top KPI Summary Cards */}
          <div className="kpi-grid-4">
            <div className="kpi-card">
              <span className="kpi-label">Total Games Recorded</span>
              <strong className="kpi-value">{analytics.total_games}</strong>
              <small className="text-muted">
                {analytics.completed_games_count} finished · {analytics.active_games_count} active
              </small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Total Development Cards Played</span>
              <strong className="kpi-value">{analytics.total_cards_played_all_time}</strong>
              <small className="text-muted">Combined cards bought across all games</small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Average Turns per Match</span>
              <strong className="kpi-value">{analytics.avg_turns_per_completed_game}</strong>
              <small className="text-muted">Across completed & forfeited games</small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Card Pool Size</span>
              <strong className="kpi-value">90 Cards · 10 Nobles</strong>
              <small className="text-muted">40 Tier I · 30 Tier II · 20 Tier III</small>
            </div>
          </div>

          {/* Head-to-Head Partner Comparison */}
          <div className="splendor-players-grid">
            {(analytics.partner_stats || []).map((ps) => (
              <div key={ps.partner_id} className="card splendor-partner-stat-card">
                <div className="splendor-partner-stat-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span
                      className="partner-dot"
                      style={{ background: ps.avatar_color, width: 14, height: 14 }}
                    />
                    <h3>{ps.name}</h3>
                  </div>
                  <span className="splendor-winrate-badge">
                    <Trophy size={14} /> {ps.wins} Wins ({ps.win_rate}%)
                  </span>
                </div>

                <div className="splendor-stat-metrics-grid">
                  <div className="splendor-stat-box">
                    <span>Games Won / Played</span>
                    <strong>
                      {ps.wins} / {ps.games_played}
                    </strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Total Cards Played</span>
                    <strong>{ps.total_cards_played} cards</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Avg Cards / Game</span>
                    <strong>{ps.avg_cards_per_game}</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Most Cards in 1 Game</span>
                    <strong>{ps.max_cards_in_game}</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Total Prestige Points</span>
                    <strong>{ps.total_points_scored} pts</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>High Score / Nobles</span>
                    <strong>
                      {ps.high_score} pts · {ps.total_nobles_visited} 👑
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Historical Games Database Ledger */}
          <div className="card">
            <div className="splendor-section-title-row" style={{ marginBottom: '0.85rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={19} /> Match History & Per-Game Card Counts
              </h3>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                Saved database log of every game, cards played by each partner, and match winners
              </span>
            </div>

            {(analytics.game_history || []).length === 0 ? (
              <p className="text-muted">No games played yet. Start a match on the Game Board tab!</p>
            ) : (
              <div className="splendor-history-list">
                {analytics.game_history.map((g) => (
                  <div key={g.id} className="splendor-history-row">
                    <div className="splendor-history-meta">
                      <strong>Game #{g.id}</strong>
                      <span className={`splendor-status-pill status-${g.status}`}>
                        {g.status === 'active'
                          ? 'In Progress'
                          : g.status === 'forfeited'
                          ? 'Forfeited'
                          : 'Completed'}
                      </span>
                      <span className="text-muted" style={{ fontSize: '0.78rem' }}>
                        {g.turns_count} turns
                      </span>
                    </div>

                    <div className="splendor-history-players">
                      <div className="splendor-history-player-col">
                        <span
                          className="partner-dot"
                          style={{ background: g.player1_color }}
                        />
                        <strong>{g.player1_name}:</strong>
                        <span>{g.player1_points} pts</span>
                        <span className="splendor-history-cards-tag">
                          {g.player1_cards_played} cards played
                        </span>
                      </div>

                      <div className="splendor-history-player-col">
                        <span
                          className="partner-dot"
                          style={{ background: g.player2_color }}
                        />
                        <strong>{g.player2_name}:</strong>
                        <span>{g.player2_points} pts</span>
                        <span className="splendor-history-cards-tag">
                          {g.player2_cards_played} cards played
                        </span>
                      </div>
                    </div>

                    <div className="splendor-history-winner">
                      {g.winner_name ? (
                        <span className="splendor-winner-badge">
                          <Award size={14} /> Winner: {g.winner_name}
                          {g.forfeited_by_name ? ` (${g.forfeited_by_name} forfeited)` : ''}
                        </span>
                      ) : (
                        <span className="text-muted">Active Match</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
