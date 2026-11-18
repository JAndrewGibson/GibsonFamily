import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  BarChart3,
  BellRing,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Crown,
  DollarSign,
  Flag,
  Gem,
  HelpCircle,
  History,
  Layers,
  Menu,
  Play,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import { apiFetch, getCookie, setCookie } from '../api';
import InfoTip from '../components/InfoTip';

const GEM_META = {
  white: {
    key: 'white',
    name: 'Diamond',
    short: 'Diamond',
    code: 'D',
    bg: '#f8fafc',
    text: '#0f172a',
    border: '#cbd5e1',
    accent: '#94a3b8',
  },
  blue: {
    key: 'blue',
    name: 'Sapphire',
    short: 'Sapphire',
    code: 'S',
    bg: '#2563eb',
    text: '#ffffff',
    border: '#60a5fa',
    accent: '#3b82f6',
  },
  green: {
    key: 'green',
    name: 'Emerald',
    short: 'Emerald',
    code: 'E',
    bg: '#059669',
    text: '#ffffff',
    border: '#34d399',
    accent: '#10b981',
  },
  red: {
    key: 'red',
    name: 'Ruby',
    short: 'Ruby',
    code: 'R',
    bg: '#dc2626',
    text: '#ffffff',
    border: '#f87171',
    accent: '#ef4444',
  },
  black: {
    key: 'black',
    name: 'Onyx',
    short: 'Onyx',
    code: 'O',
    bg: '#1e293b',
    text: '#f8fafc',
    border: '#64748b',
    accent: '#475569',
  },
  gold: {
    key: 'gold',
    name: 'Gold',
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

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    targetSection: 'status',
    title: 'Welcome to Splendor!',
    description:
      'Race your partner to 15 Prestige Points! You can even wager part of your monthly Spending Money budget on the match. Whoever wins gets their Spending Money increased by the wager for the current month!',
  },
  {
    id: 'bank',
    targetSection: 'bank',
    title: '1. Collect Gem Tokens',
    description:
      'On your turn, take up to 3 different gems (Diamond, Sapphire, Emerald, Ruby, Onyx) OR 2 of the same gem if at least 4 are in the bank. You can hold up to 10 tokens total.',
  },
  {
    id: 'market',
    targetSection: 'market',
    title: '2. Buy or Reserve Development Cards',
    description:
      'Spend tokens to buy a card from Tier I, II, or III. Every purchased card gives you a permanent +1 gem bonus that discounts future cards! Or tap Reserve to hold up to 3 cards and gain +1 Gold wild token.',
  },
  {
    id: 'nobles',
    targetSection: 'nobles',
    title: '3. Attract Royal Nobles (+3 Pts)',
    description:
      'Nobles automatically visit you at the end of your turn as soon as your permanent Card Bonuses match their numbers—worth an instant +3 Prestige Points!',
  },
  {
    id: 'players',
    targetSection: 'players',
    title: '4. Track Bonuses, Reserved Cards & Bump Turn',
    description:
      'Check both players’ Prestige Points, permanent Card Bonuses, held tokens, and Reserved Cards here. Waiting on your partner? Use the 24-hour Bump button in the top bar!',
  },
];

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
  const [enrichedPartners, setEnrichedPartners] = useState(partners);
  const [currentBudgetMonth, setCurrentBudgetMonth] = useState('');
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
  const [wagerInput, setWagerInput] = useState('');

  // Hamburger menu, New Game Modal, Forfeit Modal, Tutorial & Screen FX
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(() => {
    const seen = getCookie('gibson_splendor_tutorial_seen', '');
    if (seen === '1') return null;
    try {
      if (window.localStorage.getItem('gibson_splendor_tutorial_seen') === '1') {
        return null;
      }
    } catch {
      // ignore
    }
    return 0;
  });
  const [fxAnimation, setFxAnimation] = useState(null); // { type: 'card' | 'noble' | 'win', title, subtitle, accentColor }

  const menuRef = useRef(null);
  const sectionRefs = {
    status: useRef(null),
    players: useRef(null),
    bank: useRef(null),
    nobles: useRef(null),
    market: useRef(null),
  };

  const triggerScreenFx = (fxPayload) => {
    setFxAnimation(fxPayload);
    const duration = fxPayload.type === 'win' ? 4800 : 2400;
    setTimeout(() => {
      setFxAnimation((curr) => (curr === fxPayload ? null : curr));
    }, duration);
  };

  const loadSplendorData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch('/api/splendor/state');
      setActiveGame(data.active_game || null);
      setLatestFinishedGame(data.latest_finished_game || null);
      setAnalytics(data.analytics || null);
      if (data.partners) setEnrichedPartners(data.partners);
      if (data.current_budget_month) setCurrentBudgetMonth(data.current_budget_month);
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

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [menuOpen]);

  // Scroll highlighted tutorial section into view cleanly
  useEffect(() => {
    if (tutorialStepIndex === null) return;
    const step = TUTORIAL_STEPS[tutorialStepIndex];
    if (!step) return;
    const ref = sectionRefs[step.targetSection];
    if (ref && ref.current && typeof ref.current.scrollIntoView === 'function') {
      try {
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        // ignore in jsdom
      }
    }
  }, [tutorialStepIndex]);

  const closeTutorial = () => {
    setTutorialStepIndex(null);
    setCookie('gibson_splendor_tutorial_seen', '1', 365);
    try {
      window.localStorage.setItem('gibson_splendor_tutorial_seen', '1');
    } catch {
      // ignore
    }
  };

  const openTutorial = () => {
    setMenuOpen(false);
    setSubTab('board');
    setTutorialStepIndex(0);
  };

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
      const parsedWager = wagerInput ? Number(wagerInput) : 0;
      const res = await apiFetch('/api/splendor/new', {
        method: 'POST',
        body: JSON.stringify({
          first_turn_partner_id: Number(firstPlayerChoice || activePartner?.id),
          wager_amount: parsedWager > 0 ? parsedWager : 0,
        }),
      });
      setActiveGame(res.game);
      setLatestFinishedGame(null);
      setAnalytics(res.analytics);
      if (res.partners) setEnrichedPartners(res.partners);
      setShowNewGameModal(false);
      setWagerInput('');
      setSubTab('board');
      resetTurnSelections();
      setFeedback(
        parsedWager > 0
          ? `New game started with a $${parsedWager.toFixed(2)} Spending Money wager!`
          : 'New game of Splendor started!'
      );
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
      setMenuOpen(false);
      setFeedback(`Bump sent to ${activeGame.current_turn_name}!`);
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
      if (res.partners) setEnrichedPartners(res.partners);
      setConfirmForfeit(false);
      setMenuOpen(false);
      resetTurnSelections();
      const settlement = res.events?.wager_settlement;
      if (settlement) {
        triggerScreenFx({
          type: 'win',
          title: `${res.game.winner_name} Wins!`,
          subtitle: `+$${Number(settlement.wager_amount).toFixed(2)} Spending Money added for ${settlement.budget_month}!`,
          accentColor: '#eab308',
        });
      }
      setFeedback('Match forfeited.');
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
      if (res.partners) setEnrichedPartners(res.partners);
      resetTurnSelections();

      // Trigger celebratory screen animations for card purchase, noble visit, or winning!
      const ev = res.events || {};
      if (ev.game_won) {
        const wSettlement = ev.wager_settlement;
        triggerScreenFx({
          type: 'win',
          title: `🏆 ${res.game.winner_name} Wins Splendor!`,
          subtitle: wSettlement
            ? `💰 +$${Number(wSettlement.wager_amount).toFixed(2)} Spending Money won for ${wSettlement.budget_month}!`
            : `${res.game.player1_points} – ${res.game.player2_points} Prestige Points`,
          accentColor: '#eab308',
        });
      } else if (ev.awarded_noble) {
        triggerScreenFx({
          type: 'noble',
          title: `👑 Noble Visit! +${ev.awarded_noble.points} PTS`,
          subtitle: ev.awarded_noble.title,
          accentColor: '#a855f7',
        });
      } else if (ev.bought_card) {
        const bMeta = GEM_META[ev.bought_card.bonus] || GEM_META.white;
        triggerScreenFx({
          type: 'card',
          title: `✨ Bought ${ev.bought_card.title}!`,
          subtitle: `+1 ${bMeta.name} Bonus${
            ev.bought_card.points > 0 ? ` · +${ev.bought_card.points} Prestige Pts` : ''
          }`,
          accentColor: bMeta.accent,
        });
      }

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
      setErrorMsg('Max 3 different gems.');
      return;
    }
    const bankCount = Number(activeGame?.state?.bank?.[color] || 0);
    if (bankCount < 1) {
      setErrorMsg(`No ${GEM_META[color].name} gems left in the bank.`);
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
        <div className="card">Loading Splendor...</div>
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

  const maxAllowedWager =
    enrichedPartners.length >= 2
      ? Math.min(
          ...enrichedPartners.slice(0, 2).map((p) => Number(p.current_spending_money_limit || 0))
        )
      : 0;

  const activeTutorialStep =
    tutorialStepIndex !== null ? TUTORIAL_STEPS[tutorialStepIndex] || null : null;

  const isHighlighted = (secKey) => activeTutorialStep?.targetSection === secKey;

  const renderNewGameForm = (inModal = false) => (
    <div className="splendor-wager-setup-box">
      <div className="splendor-setup-row">
        <label className="splendor-setup-field">
          <span>First Turn</span>
          <select
            value={firstPlayerChoice}
            onChange={(e) => setFirstPlayerChoice(Number(e.target.value))}
          >
            {enrichedPartners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="splendor-setup-field">
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <DollarSign size={14} /> Spending Money Wager ({currentBudgetMonth || 'This Month'})
            <InfoTip
              text="Optional: Wager an amount from each player's current-month Spending Money budget. When someone wins, the winner's Spending Money increases by this amount and the loser's decreases for this month only."
              align="right"
            />
          </span>
          <input
            type="number"
            min="0"
            max={maxAllowedWager > 0 ? maxAllowedWager : undefined}
            step="1"
            placeholder="0.00 (Optional)"
            value={wagerInput}
            onChange={(e) => setWagerInput(e.target.value)}
          />
        </label>
      </div>

      {/* Quick Wager Preset Chips & Partner Spending Money Limits */}
      <div className="splendor-wager-presets-row">
        <div className="splendor-wager-chips">
          {[0, 5, 10, 20, 50].map((amt) => (
            <button
              key={amt}
              type="button"
              className={`splendor-wager-chip ${
                Number(wagerInput || 0) === amt ? 'active' : ''
              }`}
              disabled={amt > 0 && amt > maxAllowedWager}
              onClick={() => setWagerInput(amt === 0 ? '' : String(amt))}
            >
              {amt === 0 ? 'No Wager' : `$${amt}`}
            </button>
          ))}
        </div>

        <div className="splendor-partner-allowances-inline">
          {enrichedPartners.slice(0, 2).map((p) => (
            <span key={p.id} className="splendor-allowance-pill">
              <span className="partner-dot" style={{ background: p.avatar_color }} />
              {p.name.split(' ')[0]}: <strong>${Number(p.current_spending_money_limit || 0).toFixed(0)}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="splendor-setup-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleStartNewGame}
          disabled={busy}
        >
          <Play size={16} /> Start Match
          {Number(wagerInput || 0) > 0 ? ` ($${Number(wagerInput).toFixed(2)} Wager)` : ''}
        </button>
        {inModal && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowNewGameModal(false)}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="module-container splendor-module">
      {/* Celebratory Screen Effects Overlay (Card Bought, Noble Visited, Match Won) */}
      {fxAnimation && (
        <div
          className={`splendor-fx-overlay fx-${fxAnimation.type}`}
          onClick={() => setFxAnimation(null)}
          role="status"
          aria-live="polite"
        >
          <div className="splendor-fx-particles" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className={`splendor-particle p-${i % 6}`}
                style={{
                  left: `${5 + ((i * 17) % 90)}%`,
                  animationDelay: `${(i % 5) * 0.08}s`,
                }}
              />
            ))}
          </div>
          <div
            className="splendor-fx-banner"
            style={{ borderColor: fxAnimation.accentColor || 'var(--primary)' }}
          >
            <div className="splendor-fx-icon">
              {fxAnimation.type === 'win' ? (
                <Trophy size={32} />
              ) : fxAnimation.type === 'noble' ? (
                <Crown size={30} />
              ) : (
                <Sparkles size={28} />
              )}
            </div>
            <div className="splendor-fx-copy">
              <strong>{fxAnimation.title}</strong>
              {fxAnimation.subtitle && <span>{fxAnimation.subtitle}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Compact Top Header Bar with Tooltips & Hamburger Menu */}
      <div className="section-header-bar splendor-compact-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Gem size={22} style={{ color: 'var(--primary)' }} />
          <h2>Splendor</h2>
          <InfoTip text="90 development cards across 3 tiers (Diamond, Sapphire, Emerald, Ruby, Onyx) + 10 Nobles. First to 15 Prestige Points triggers the final round!" />
        </div>

        <div className="splendor-header-actions">
          <div className="splendor-tab-switcher">
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'board' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('board')}
            >
              <Layers size={15} /> Board
            </button>
            <button
              type="button"
              className={`btn btn-sm ${subTab === 'analytics' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubTab('analytics')}
            >
              <BarChart3 size={15} /> Stats ({analytics?.total_games || 0})
            </button>
          </div>

          {/* Hamburger Menu for Tutorial, New Game, Bump & Forfeit */}
          <div className="splendor-hamburger-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn btn-secondary btn-sm splendor-hamburger-btn"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="Splendor Options & Tutorial Menu"
              title="Game Menu & Tutorial"
            >
              <Menu size={17} />
            </button>

            {menuOpen && (
              <div className="splendor-hamburger-dropdown">
                <button
                  type="button"
                  className="splendor-menu-item"
                  onClick={openTutorial}
                >
                  <HelpCircle size={16} />
                  <span>Interactive Tutorial</span>
                </button>

                {!activeGame && (
                  <button
                    type="button"
                    className="splendor-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowNewGameModal(true);
                    }}
                  >
                    <Play size={16} />
                    <span>New Game & Wager</span>
                  </button>
                )}

                {activeGame && !isMyTurn && (
                  <button
                    type="button"
                    className="splendor-menu-item"
                    disabled={busy || !activeGame.bump_available}
                    onClick={handleBumpPartner}
                  >
                    <BellRing size={16} />
                    <span>
                      {activeGame.bump_available
                        ? `Bump ${activeGame.current_turn_name}`
                        : `Bump (${formatCooldown(activeGame.bump_cooldown_seconds)})`}
                    </span>
                  </button>
                )}

                {activeGame && (
                  <button
                    type="button"
                    className="splendor-menu-item danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmForfeit(true);
                    }}
                  >
                    <Flag size={16} />
                    <span>Forfeit Active Game</span>
                  </button>
                )}
              </div>
            )}
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
            <X size={15} />
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
            <X size={15} />
          </button>
        </div>
      )}

      {subTab === 'board' && (
        <>
          {/* Compact Turn Status / Wager Pill / New Game Card */}
          <div
            ref={sectionRefs.status}
            className={isHighlighted('status') ? 'splendor-tutorial-highlight' : ''}
          >
            {activeGame ? (
              <div className={`card splendor-turn-banner ${isMyTurn ? 'my-turn' : 'partner-turn'}`}>
                <div className="splendor-turn-indicator">
                  {isMyTurn ? (
                    <span className="splendor-turn-pill my-turn-pill">
                      <Sparkles size={14} /> YOUR TURN
                    </span>
                  ) : (
                    <span className="splendor-turn-pill waiting-pill">
                      <Clock size={14} /> {activeGame.current_turn_name.toUpperCase()}&apos;S TURN
                    </span>
                  )}

                  <span className="splendor-game-meta">
                    Game #{activeGame.id} · Turn {activeGame.turns_count + 1}
                  </span>

                  {activeGame.wager_amount > 0 && (
                    <span
                      className="splendor-wager-badge"
                      title={`Winner gains +$${activeGame.wager_amount.toFixed(2)} Spending Money for ${activeGame.wager_month}; loser decreases by -$${activeGame.wager_amount.toFixed(2)}.`}
                    >
                      <Coins size={13} /> Wager: ${activeGame.wager_amount.toFixed(2)}
                    </span>
                  )}

                  {gState?.final_round_triggered && (
                    <strong className="splendor-final-round-tag">🔥 FINAL ROUND</strong>
                  )}

                  <InfoTip
                    text={
                      isMyTurn
                        ? 'Take 3 different gems, 2 of the same gem (4+ in bank), buy a card, or reserve a card (+1 Gold).'
                        : `Waiting on ${activeGame.current_turn_name}. You can send 1 bump notification every 24 hours.`
                    }
                  />
                </div>

                <div className="splendor-turn-banner-actions">
                  {!isMyTurn && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleBumpPartner}
                      disabled={busy || !activeGame.bump_available}
                    >
                      <BellRing size={14} />
                      {activeGame.bump_available
                        ? `Bump ${activeGame.current_turn_name.split(' ')[0]}`
                        : formatCooldown(activeGame.bump_cooldown_seconds)}
                    </button>
                  )}

                  {!confirmForfeit ? (
                    <button
                      type="button"
                      className="btn btn-danger-outline btn-sm"
                      onClick={() => setConfirmForfeit(true)}
                      disabled={busy}
                    >
                      <Flag size={14} /> Forfeit
                    </button>
                  ) : (
                    <div className="splendor-forfeit-confirm">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={handleForfeitGame}
                        disabled={busy}
                      >
                        Confirm Forfeit
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <h3>
                      {latestFinishedGame
                        ? `🏆 Game #${latestFinishedGame.id} — ${latestFinishedGame.winner_name} Won!`
                        : 'Start a New Game of Splendor'}
                    </h3>
                    {latestFinishedGame?.wager_amount > 0 && (
                      <span className="splendor-wager-badge">
                        <Coins size={13} /> +${latestFinishedGame.wager_amount.toFixed(2)} Spending Money Won ({latestFinishedGame.wager_month})
                      </span>
                    )}
                  </div>
                  {latestFinishedGame && (
                    <p className="text-muted" style={{ fontSize: '0.84rem' }}>
                      {latestFinishedGame.player1_name}: {latestFinishedGame.player1_points} pts (
                      {latestFinishedGame.player1_cards_played} cards) ·{' '}
                      {latestFinishedGame.player2_name}: {latestFinishedGame.player2_points} pts (
                      {latestFinishedGame.player2_cards_played} cards)
                    </p>
                  )}
                </div>

                {renderNewGameForm(false)}
              </div>
            )}
          </div>

          {/* Active or Latest Finished Game Board */}
          {displayGame && gState && (
            <>
              {/* Two Player Dashboards */}
              <div
                ref={sectionRefs.players}
                className={`splendor-players-grid ${
                  isHighlighted('players') ? 'splendor-tutorial-highlight' : ''
                }`}
              >
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
                            style={{ background: plr.color, width: 11, height: 11 }}
                          />
                          <h4>
                            {plr.name} {isCurrentUser && <span className="text-muted">(You)</span>}
                          </h4>
                          {isTurnPlayer && <span className="splendor-mini-turn-badge">Turn</span>}
                          {displayGame.winner_partner_id === plr.id && (
                            <span className="splendor-winner-badge">
                              <Trophy size={12} /> Winner
                            </span>
                          )}
                        </div>

                        <div className="splendor-player-score-box">
                          <div className="splendor-prestige-pill" title="Prestige Points (Goal: 15)">
                            <Crown size={14} />
                            <strong>{pState.points || 0}</strong>
                            <span>/15</span>
                          </div>
                          <div className="splendor-cards-played-pill" title="Development Cards Played">
                            <Layers size={13} />
                            <strong>{(pState.purchased_cards || []).length}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Compact Bonuses & Tokens */}
                      <div className="splendor-player-resources">
                        <div className="splendor-resource-row">
                          <span className="splendor-resource-label">
                            Bonuses
                            <InfoTip text="Permanent gem discounts from purchased cards." />
                          </span>
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
                                    opacity: count > 0 ? 1 : 0.42,
                                  }}
                                  title={`${meta.name} Bonus: +${count}`}
                                >
                                  <span>{meta.name}</span>
                                  <strong>+{count}</strong>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="splendor-resource-row">
                          <span className="splendor-resource-label">
                            Tokens ({totalTokens}/10)
                            <InfoTip text="Held gem tokens (maximum 10 at end of turn). Gold acts as any gem." />
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
                                    opacity: count > 0 ? 1 : 0.38,
                                  }}
                                  title={`${meta.name} Tokens: ${count}`}
                                >
                                  <span>{meta.name}</span>
                                  <strong>{count}</strong>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Visited Nobles */}
                      {(pState.nobles || []).length > 0 && (
                        <div className="splendor-visited-nobles-list">
                          {pState.nobles.map((n) => (
                            <span key={n.id} className="splendor-visited-noble-chip">
                              👑 {n.title} (+{n.points})
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Reserved Cards (Only shown when non-empty or compact header) */}
                      {(pState.reserved_cards || []).length > 0 && (
                        <div className="splendor-player-reserved">
                          <span className="splendor-resource-label">
                            Reserved ({(pState.reserved_cards || []).length}/3)
                          </span>
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
                                    <strong>{rc.points} PT</strong>
                                    <span
                                      className="splendor-card-bonus-pill"
                                      style={{
                                        background: bMeta.bg,
                                        color: bMeta.text,
                                        borderColor: bMeta.border,
                                      }}
                                    >
                                      {bMeta.name}
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
                                          {cMeta.name}: {cVal}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  {isCurrentUser && isMyTurn && (
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      style={{ width: '100%', marginTop: '0.25rem' }}
                                      disabled={busy || !affordInfo.affordable}
                                      onClick={() =>
                                        executeTurnAction({
                                          action: 'buy',
                                          card_id: rc.id,
                                        })
                                      }
                                    >
                                      <ShoppingBag size={12} />{' '}
                                      {affordInfo.affordable
                                        ? affordInfo.goldNeeded > 0
                                          ? `Buy (${affordInfo.goldNeeded}★)`
                                          : 'Buy'
                                        : 'Locked'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Gem Bank & Take Gems Action Panel */}
              <div
                ref={sectionRefs.bank}
                className={`card splendor-bank-card ${
                  isHighlighted('bank') ? 'splendor-tutorial-highlight' : ''
                }`}
              >
                <div className="splendor-bank-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <h3>💎 Gem Bank</h3>
                    <InfoTip text="Tap gems to collect: take 3 different gems, or switch to '2 Same' when a pile has 4+ tokens. Gold is gained when you Reserve a card." />
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
                        3 Different
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
                        2 Same (4+)
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

                {/* Token limit (> 10) return helper */}
                {isMyTurn && addedGemsCount > 0 && currentHeldTokens + addedGemsCount > 10 && (
                  <div className="splendor-discard-box">
                    <strong>
                      10-Token Limit: Return {excessTokensToReturn} token(s)
                    </strong>
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
                            <span>{meta.name}:</span>
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

                {isMyTurn && (selectedDiffGems.length > 0 || selectedSameGem) && (
                  <div className="splendor-bank-submit-bar">
                    {turnMode === 'take_different' ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
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
                        <CheckCircle2 size={15} /> Take {selectedDiffGems.length} Gem(s)
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
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
                        <CheckCircle2 size={15} /> Take 2 {GEM_META[selectedSameGem]?.name}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={resetTurnSelections}
                    >
                      <RotateCcw size={14} /> Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Noble Tiles Row */}
              <div
                ref={sectionRefs.nobles}
                className={`card splendor-nobles-card ${
                  isHighlighted('nobles') ? 'splendor-tutorial-highlight' : ''
                }`}
              >
                <div className="splendor-section-title-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <h3>👑 Nobles</h3>
                    <InfoTip text="Each Noble is worth +3 Prestige Points and visits automatically at the end of your turn when your permanent Card Bonuses reach the numbers shown." />
                  </div>
                </div>

                {(gState.nobles || []).length === 0 ? (
                  <p className="text-muted" style={{ fontSize: '0.82rem' }}>
                    All Nobles visited!
                  </p>
                ) : (
                  <div className="splendor-nobles-grid">
                    {gState.nobles.map((noble) => (
                      <div key={noble.id} className="splendor-noble-tile">
                        <div className="splendor-noble-header">
                          <span className="splendor-noble-pts">+{noble.points} PT</span>
                          <strong className="splendor-noble-title">{noble.title}</strong>
                        </div>
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
                                {cMeta.name}: {cVal}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 90 Development Cards Board (Tier 3, Tier 2, Tier 1) */}
              <div
                ref={sectionRefs.market}
                className={`card splendor-board-card ${
                  isHighlighted('market') ? 'splendor-tutorial-highlight' : ''
                }`}
              >
                <div className="splendor-section-title-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <h3>🃏 Development Cards</h3>
                    <InfoTip text="Top left shows Prestige Points; top right shows the permanent +1 Gem Bonus you earn. Bottom pills show the Gem Cost (reduced by your Card Bonuses)." />
                  </div>
                </div>

                {['3', '2', '1'].map((tierKey) => {
                  const cards = gState.board?.[tierKey] || [];
                  const deckRemaining = Number(gState.deck_counts?.[tierKey] || 0);

                  return (
                    <div key={tierKey} className="splendor-tier-section">
                      <div className="splendor-tier-header">
                        <div className="splendor-tier-title">
                          <span className={`splendor-tier-badge tier-${tierKey}`}>
                            TIER {tierKey}
                          </span>
                          <span className="splendor-deck-count-pill">
                            {deckRemaining} in deck
                          </span>
                        </div>

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
                              title={`Blind-reserve top card of Tier ${tierKey} deck (+1 Gold)`}
                            >
                              <Bookmark size={12} /> Reserve Deck
                            </button>
                          )}
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
                                borderTop: `5px solid ${bMeta.bg}`,
                              }}
                            >
                              <div className="splendor-dev-card-top">
                                <div className="splendor-dev-card-points">
                                  {card.points} PT
                                </div>
                                <div
                                  className="splendor-card-bonus-pill"
                                  style={{
                                    background: bMeta.bg,
                                    color: bMeta.text,
                                    borderColor: bMeta.border,
                                  }}
                                >
                                  +1 {bMeta.name}
                                </div>
                              </div>

                              <div className="splendor-dev-card-body">
                                <div className="splendor-dev-card-title">{card.title}</div>
                              </div>

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
                                      title={`${cMeta.name}: ${cVal} (Net ${netCost} after your +${myDiscount} bonus)`}
                                    >
                                      <span>{cMeta.name}</span>
                                      <strong>{cVal}</strong>
                                    </div>
                                  );
                                })}
                              </div>

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
                                    <ShoppingBag size={12} />{' '}
                                    {affordInfo.affordable && affordInfo.goldNeeded > 0
                                      ? `Buy (${affordInfo.goldNeeded}★)`
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
                                    title="Reserve card & gain +1 Gold"
                                  >
                                    <Bookmark size={12} />
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
            </>
          )}
        </>
      )}

      {/* Fun Stats & Analytics Tab */}
      {subTab === 'analytics' && analytics && (
        <div className="splendor-analytics-section">
          <div className="kpi-grid-4">
            <div className="kpi-card">
              <span className="kpi-label">Total Games</span>
              <strong className="kpi-value">{analytics.total_games}</strong>
              <small className="text-muted">
                {analytics.completed_games_count} finished · {analytics.active_games_count} active
              </small>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Total Cards Played</span>
              <strong className="kpi-value">{analytics.total_cards_played_all_time}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Avg Turns / Match</span>
              <strong className="kpi-value">{analytics.avg_turns_per_completed_game}</strong>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Deck Pool</span>
              <strong className="kpi-value">90 Cards · 10 Nobles</strong>
            </div>
          </div>

          <div className="splendor-players-grid">
            {(analytics.partner_stats || []).map((ps) => (
              <div key={ps.partner_id} className="card splendor-partner-stat-card">
                <div className="splendor-partner-stat-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <span
                      className="partner-dot"
                      style={{ background: ps.avatar_color, width: 13, height: 13 }}
                    />
                    <h3>{ps.name}</h3>
                  </div>
                  <span className="splendor-winrate-badge">
                    <Trophy size={13} /> {ps.wins} Wins ({ps.win_rate}%)
                  </span>
                </div>

                <div className="splendor-stat-metrics-grid">
                  <div className="splendor-stat-box">
                    <span>Won / Played</span>
                    <strong>
                      {ps.wins} / {ps.games_played}
                    </strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Cards Played</span>
                    <strong>{ps.total_cards_played}</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Avg Cards / Game</span>
                    <strong>{ps.avg_cards_per_game}</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Max Cards (1 Game)</span>
                    <strong>{ps.max_cards_in_game}</strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>High Score / Nobles</span>
                    <strong>
                      {ps.high_score} pts · {ps.total_nobles_visited} 👑
                    </strong>
                  </div>
                  <div className="splendor-stat-box">
                    <span>Net Wager Won</span>
                    <strong
                      style={{
                        color:
                          ps.net_wager_won > 0
                            ? 'var(--green)'
                            : ps.net_wager_won < 0
                            ? 'var(--red)'
                            : 'var(--text-main)',
                      }}
                    >
                      {ps.net_wager_won >= 0
                        ? `+$${Number(ps.net_wager_won || 0).toFixed(2)}`
                        : `-$${Math.abs(Number(ps.net_wager_won || 0)).toFixed(2)}`}
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="splendor-section-title-row">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <History size={18} /> Match History
              </h3>
            </div>

            {(analytics.game_history || []).length === 0 ? (
              <p className="text-muted">No games played yet.</p>
            ) : (
              <div className="splendor-history-list">
                {analytics.game_history.map((g) => (
                  <div key={g.id} className="splendor-history-row">
                    <div className="splendor-history-meta">
                      <strong>Game #{g.id}</strong>
                      <span className={`splendor-status-pill status-${g.status}`}>
                        {g.status === 'active'
                          ? 'Active'
                          : g.status === 'forfeited'
                          ? 'Forfeited'
                          : 'Completed'}
                      </span>
                      {g.wager_amount > 0 && (
                        <span className="splendor-wager-badge">
                          <Coins size={12} /> ${Number(g.wager_amount).toFixed(2)}
                        </span>
                      )}
                      <span className="text-muted" style={{ fontSize: '0.76rem' }}>
                        {g.turns_count} turns
                      </span>
                    </div>

                    <div className="splendor-history-players">
                      <div className="splendor-history-player-col">
                        <span className="partner-dot" style={{ background: g.player1_color }} />
                        <strong>{g.player1_name}:</strong>
                        <span>{g.player1_points} pts</span>
                        <span className="splendor-history-cards-tag">
                          {g.player1_cards_played} cards
                        </span>
                      </div>

                      <div className="splendor-history-player-col">
                        <span className="partner-dot" style={{ background: g.player2_color }} />
                        <strong>{g.player2_name}:</strong>
                        <span>{g.player2_points} pts</span>
                        <span className="splendor-history-cards-tag">
                          {g.player2_cards_played} cards
                        </span>
                      </div>
                    </div>

                    <div className="splendor-history-winner">
                      {g.winner_name ? (
                        <span className="splendor-winner-badge">
                          <Award size={13} /> {g.winner_name}
                        </span>
                      ) : (
                        <span className="text-muted">In Progress</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Game Modal (Triggered from Hamburger Menu) */}
      {showNewGameModal && (
        <div
          className="finance-modal-backdrop"
          onClick={() => setShowNewGameModal(false)}
        >
          <div
            className="finance-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="finance-modal-header">
              <h3>Start New Splendor Game</h3>
              <button
                type="button"
                className="btn-icon-subtle"
                onClick={() => setShowNewGameModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="finance-modal-body">{renderNewGameForm(true)}</div>
          </div>
        </div>
      )}

      {/* Interactive Guided Tutorial Bottom Sheet / Coachmark */}
      {activeTutorialStep && (
        <div className="splendor-tutorial-coachmark" role="dialog" aria-label="Splendor Tutorial">
          <div className="splendor-tutorial-card">
            <div className="splendor-tutorial-top">
              <span className="splendor-tutorial-step-pill">
                Tutorial {tutorialStepIndex + 1} / {TUTORIAL_STEPS.length}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeTutorial}
              >
                Skip <X size={14} />
              </button>
            </div>

            <h4>{activeTutorialStep.title}</h4>
            <p>{activeTutorialStep.description}</p>

            <div className="splendor-tutorial-nav">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={tutorialStepIndex === 0}
                onClick={() => setTutorialStepIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft size={15} /> Back
              </button>

              <div className="splendor-tutorial-dots">
                {TUTORIAL_STEPS.map((st, idx) => (
                  <span
                    key={st.id}
                    className={`splendor-tut-dot ${idx === tutorialStepIndex ? 'active' : ''}`}
                    onClick={() => setTutorialStepIndex(idx)}
                  />
                ))}
              </div>

              {tutorialStepIndex < TUTORIAL_STEPS.length - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setTutorialStepIndex((i) => i + 1)}
                >
                  Next <ChevronRight size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={closeTutorial}
                >
                  Let&apos;s Play!
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
