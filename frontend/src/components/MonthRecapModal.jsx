import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Award,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Flame,
  Pause,
  PiggyBank,
  Play,
  RotateCcw,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';

function fmtMoney(val) {
  const num = Number(val || 0);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedMoney(val) {
  const num = Number(val || 0);
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MonthRecapModal({
  isOpen,
  onClose,
  selectedMonth,
  onReopenMonth,
}) {
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const timerRef = useRef(null);

  const loadRecap = async () => {
    if (!selectedMonth) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/api/finance/month-recap?month=${selectedMonth}`);
      setRecap(data);
      setSlideIndex(0);
    } catch (err) {
      console.error('Failed to load month recap:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadRecap();
    }
  }, [isOpen, selectedMonth]);

  const slides = recap?.slides || [];
  const totalSlides = slides.length || 7;

  // Auto-advance slides every 6 seconds if playing
  useEffect(() => {
    if (!isOpen || !isPlaying || loading || totalSlides === 0) return;
    timerRef.current = setTimeout(() => {
      setSlideIndex((prev) => (prev + 1) % totalSlides);
    }, 6000);
    return () => clearTimeout(timerRef.current);
  }, [isOpen, isPlaying, slideIndex, loading, totalSlides]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') {
        setSlideIndex((prev) => Math.min(prev + 1, totalSlides - 1));
      } else if (e.key === 'ArrowLeft') {
        setSlideIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ') {
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, totalSlides]);

  if (!isOpen) return null;

  const handleNext = (e) => {
    e?.stopPropagation();
    setSlideIndex((prev) => (prev < totalSlides - 1 ? prev + 1 : 0));
  };

  const handlePrev = (e) => {
    e?.stopPropagation();
    setSlideIndex((prev) => (prev > 0 ? prev - 1 : totalSlides - 1));
  };

  const persona = recap?.persona || {
    title: 'The Budget Champions 🏆',
    badge: 'Month Recap',
    tagline: 'Household Financial Review',
    description: 'Here is your complete monthly wrap-up.',
    theme_gradient: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #8b5cf6 100%)',
  };

  const overview = recap?.overview || {};
  const trends = recap?.trends || {};

  return (
    <div
      className="finance-modal-backdrop"
      onClick={onClose}
      style={{
        zIndex: 1100,
        background: 'rgba(5, 8, 16, 0.88)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        className="month-recap-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(94vw, 540px)',
          minHeight: '620px',
          maxHeight: '92vh',
          borderRadius: '24px',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), 0 0 40px rgba(99, 102, 241, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: 'var(--bg-card)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
        }}
      >
        {/* Story Progress Indicators at Top (Spotify Wrapped Style) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '12px 16px 8px 16px',
            display: 'flex',
            gap: '5px',
            zIndex: 30,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)',
          }}
        >
          {Array.from({ length: totalSlides }).map((_, i) => {
            const isCompleted = i < slideIndex;
            const isActive = i === slideIndex;
            return (
              <div
                key={i}
                onClick={() => setSlideIndex(i)}
                style={{
                  flex: 1,
                  height: '4px',
                  borderRadius: '2px',
                  background: isCompleted
                    ? 'rgba(255, 255, 255, 0.95)'
                    : isActive
                    ? 'rgba(255, 255, 255, 0.95)'
                    : 'rgba(255, 255, 255, 0.25)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'background 0.2s ease',
                }}
              >
                {isActive && isPlaying && (
                  <div
                    style={{
                      height: '100%',
                      background: '#fff',
                      animation: 'recapProgress 6s linear infinite',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Top Controls (Month label, Play/Pause, Close) */}
        <div
          style={{
            position: 'absolute',
            top: '26px',
            left: '16px',
            right: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 30,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: 'rgba(0, 0, 0, 0.45)',
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                backdropFilter: 'blur(4px)',
              }}
            >
              {recap?.month_label || selectedMonth} Recap
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              onClick={() => setIsPlaying((p) => !p)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.45)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
              }}
              title={isPlaying ? 'Pause recap' : 'Play recap'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: '2px' }} />}
            </button>

            <button
              onClick={onClose}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, 0.45)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
              }}
              aria-label="Close recap"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Slide Content Area */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '76px 24px 80px 24px',
            overflowY: 'auto',
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Cooking up your {selectedMonth} Recap...
            </div>
          ) : (
            <>
              {/* SLIDE 0: Cover & Household Persona */}
              {slideIndex === 0 && (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.35rem 0.85rem',
                      borderRadius: '999px',
                      background: 'rgba(255, 255, 255, 0.12)',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#fff',
                    }}
                  >
                    <Sparkles size={14} color="#fbbf24" />
                    Household Financial Wrapped
                  </div>

                  <h1
                    style={{
                      fontSize: '2.4rem',
                      fontWeight: 900,
                      margin: 0,
                      letterSpacing: '-0.03em',
                      lineHeight: 1.1,
                      background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {recap?.month_label}
                  </h1>

                  <div
                    style={{
                      padding: '1.75rem 1.5rem',
                      borderRadius: '20px',
                      background: persona.theme_gradient,
                      boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      width: '100%',
                      maxWidth: '380px',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>
                      YOUR HOUSEHOLD ARCHETYPE
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#fff', marginTop: '0.3rem', letterSpacing: '-0.02em' }}>
                      {persona.title}
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fef08a', marginTop: '0.2rem' }}>
                      {persona.tagline}
                    </div>
                    <p style={{ margin: '0.85rem 0 0 0', fontSize: '0.86rem', color: 'rgba(255,255,255,0.92)', lineHeight: 1.45 }}>
                      {persona.description}
                    </p>
                  </div>

                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Tap anywhere or click Next to explore your recap →
                  </div>
                </div>
              )}

              {/* SLIDE 1: Inflow, Outflow & Trends */}
              {slideIndex === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      THE BOTTOM LINE
                    </span>
                    <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.65rem', fontWeight: 800 }}>
                      Inflow & Outflow
                    </h2>
                  </div>

                  {/* Net Cash Flow Card */}
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%)',
                      border: '1px solid rgba(6, 182, 212, 0.4)',
                      borderRadius: '16px',
                      padding: '1.25rem',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Net Cash Flow
                    </div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 900, color: Number(overview.net_cashflow) >= 0 ? '#10b981' : '#f43f5e', marginTop: '0.2rem' }}>
                      {fmtSignedMoney(overview.net_cashflow)}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Household Savings Rate: <strong style={{ color: '#fff' }}>{overview.savings_rate_pct}%</strong>
                    </div>
                  </div>

                  {/* Income vs Spent Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                    <div style={{ background: 'var(--bg-panel)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                        Earned Inflow
                      </div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', marginTop: '0.2rem' }}>
                        ${fmtMoney(overview.total_income)}
                      </div>
                      {trends.mom_income_trend && (
                        <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.25rem', fontWeight: 600 }}>
                          {trends.mom_income_trend}
                        </div>
                      )}
                    </div>

                    <div style={{ background: 'var(--bg-panel)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                        Total Spent
                      </div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f43f5e', marginTop: '0.2rem' }}>
                        ${fmtMoney(overview.total_spent)}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        of ${fmtMoney(overview.total_budget)} limit
                      </div>
                    </div>
                  </div>

                  {/* Key Trends (MoM and YoY) Highlight Pill Cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                    {trends.mom_spend_trend && (
                      <div
                        style={{
                          background: 'rgba(99, 102, 241, 0.12)',
                          border: '1px solid rgba(99, 102, 241, 0.35)',
                          borderRadius: '10px',
                          padding: '0.65rem 0.95rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: '#c7d2fe',
                        }}
                      >
                        {trends.mom_spend_trend.includes('down') ? (
                          <TrendingDown size={18} color="#10b981" />
                        ) : (
                          <TrendingUp size={18} color="#f43f5e" />
                        )}
                        <span>{trends.mom_spend_trend}</span>
                      </div>
                    )}

                    {trends.yoy_spend_trend && (
                      <div
                        style={{
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          borderRadius: '10px',
                          padding: '0.65rem 0.95rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: '#a7f3d0',
                        }}
                      >
                        <Award size={18} color="#10b981" />
                        <span>{trends.yoy_spend_trend}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SLIDE 2: Top Spending Categories (Spotify Top Tracks Style) */}
              {slideIndex === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      HEAVY HITTERS
                    </span>
                    <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.65rem', fontWeight: 800 }}>
                      Top Categories
                    </h2>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    {recap?.top_categories?.map((cat) => (
                      <div
                        key={cat.category}
                        style={{
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border)',
                          borderRadius: '12px',
                          padding: '0.85rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <span
                              style={{
                                fontSize: '0.9rem',
                                fontWeight: 800,
                                color: cat.rank === 1 ? '#fbbf24' : 'var(--text-muted)',
                                width: '22px',
                              }}
                            >
                              #{cat.rank}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cat.category}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff' }}>
                              ${fmtMoney(cat.spent)}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                              ({cat.pct}%)
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(cat.pct, 100)}%`,
                              height: '100%',
                              background: cat.color || '#6366f1',
                              borderRadius: '3px',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {recap?.top_categories?.[0] && (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: '10px',
                        border: '1px solid var(--border)',
                        fontSize: '0.82rem',
                        color: 'var(--text-muted)',
                        textAlign: 'center',
                      }}
                    >
                      💡 Your #1 spot was <strong>{recap.top_categories[0].category}</strong>, accounting for{' '}
                      <strong>{recap.top_categories[0].pct}%</strong> of all spending.
                    </div>
                  )}
                </div>
              )}

              {/* SLIDE 3: Merchant Spotlight & Biggest Splash */}
              {slideIndex === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      MERCHANT SPOTLIGHT
                    </span>
                    <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.65rem', fontWeight: 800 }}>
                      Favorites & Splashes
                    </h2>
                  </div>

                  {/* Top Merchant */}
                  {recap?.top_merchant ? (
                    <div
                      style={{
                        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(236, 72, 153, 0.15) 100%)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        borderRadius: '16px',
                        padding: '1.25rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                        <Flame size={16} />
                        MOST FREQUENTED SPOT
                      </div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', marginTop: '0.35rem' }}>
                        {recap.top_merchant.name}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: '#fef08a', marginTop: '0.25rem', fontWeight: 600 }}>
                        Visited {recap.top_merchant.count} times this month (${fmtMoney(recap.top_merchant.total_spent)} total)
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)', marginTop: '0.4rem' }}>
                        You are practically on a first-name basis here! 🛒
                      </div>
                    </div>
                  ) : null}

                  {/* Biggest Single Splash */}
                  {recap?.biggest_purchase ? (
                    <div
                      style={{
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border)',
                        borderRadius: '16px',
                        padding: '1.15rem',
                      }}
                    >
                      <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                        BIGGEST SINGLE PURCHASE
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.35rem' }}>
                        <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>
                          {recap.biggest_purchase.name}
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#f43f5e' }}>
                          ${fmtMoney(recap.biggest_purchase.amount)}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Logged on {recap.biggest_purchase.date} in {recap.biggest_purchase.category}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* SLIDE 4: Budget MVPs & Rollover Heroes */}
              {slideIndex === 4 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      WINS & SAVINGS
                    </span>
                    <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.65rem', fontWeight: 800 }}>
                      Budget MVPs & Rollovers
                    </h2>
                  </div>

                  {/* Budget MVP Category */}
                  {recap?.budget_mvp ? (
                    <div
                      style={{
                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%)',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        borderRadius: '16px',
                        padding: '1.25rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                        <Award size={16} />
                        BUDGET MVP OF THE MONTH
                      </div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', marginTop: '0.35rem' }}>
                        {recap.budget_mvp.category}
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#6ee7b7', marginTop: '0.2rem' }}>
                        +${fmtMoney(recap.budget_mvp.saved)} Under Limit!
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)', marginTop: '0.35rem' }}>
                        {recap.budget_mvp.comment}
                      </div>
                    </div>
                  ) : null}

                  {/* Partner Spending Money Rollover Carryovers */}
                  <div>
                    <div style={{ fontSize: '0.76rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.5rem' }}>
                      PARTNER SPENDING MONEY ROLLOVERS
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {recap?.partner_rollovers?.map((p) => {
                        const hasPositive = p.rollover_out > 0;
                        return (
                          <div
                            key={p.partner_name}
                            style={{
                              background: 'var(--bg-panel)',
                              border: '1px solid var(--border)',
                              borderRadius: '12px',
                              padding: '0.85rem 1rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <span
                                style={{
                                  width: '28px',
                                  height: '28px',
                                  borderRadius: '50%',
                                  background: p.avatar_color || '#6366f1',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#fff',
                                  fontSize: '0.8rem',
                                  fontWeight: 700,
                                }}
                              >
                                {p.partner_name[0]}
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{p.partner_name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  Spent ${fmtMoney(p.spent)} of ${fmtMoney(p.monthly_limit)}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 800, fontSize: '0.98rem', color: hasPositive ? '#818cf8' : 'var(--text-muted)' }}>
                                {fmtSignedMoney(p.rollover_out)}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                {hasPositive ? 'rolls forward' : 'carryover'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* SLIDE 5: Leftover to Savings Celebration */}
              {slideIndex === 5 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center' }}>
                  <div>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      SAVINGS MILESTONES
                    </span>
                    <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.65rem', fontWeight: 800 }}>
                      Leftover Stashed into Savings
                    </h2>
                  </div>

                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(16, 185, 129, 0.2) 100%)',
                      border: '1px solid rgba(99, 102, 241, 0.45)',
                      borderRadius: '20px',
                      padding: '1.75rem 1.25rem',
                    }}
                  >
                    <PiggyBank size={40} color="#818cf8" style={{ margin: '0 auto 0.5rem auto' }} />
                    <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff' }}>
                      ${fmtMoney(overview.total_leftover)}
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#c7d2fe', marginTop: '0.35rem' }}>
                      Non-Rollover Leftover Budget Surplus
                    </div>
                    <p style={{ margin: '0.75rem auto 0 auto', maxWidth: '380px', fontSize: '0.84rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.45 }}>
                      This surplus was instructed to transfer directly into your high-yield savings account!
                    </p>
                  </div>

                  {/* Milestone Badges */}
                  <div>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.5rem' }}>
                      BADGES UNLOCKED THIS MONTH
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
                      {recap?.milestones?.map((m) => (
                        <div
                          key={m.id}
                          style={{
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border)',
                            borderRadius: '10px',
                            padding: '0.65rem',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '0.2rem',
                          }}
                        >
                          <span style={{ fontSize: '1.2rem' }}>🏆</span>
                          <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>{m.title}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.subtitle}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* SLIDE 6: Spotify Wrapped Summary Poster */}
              {slideIndex === 6 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '100%',
                      background: persona.theme_gradient,
                      borderRadius: '20px',
                      padding: '1.4rem',
                      boxShadow: '0 20px 48px rgba(0, 0, 0, 0.65)',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      color: '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, fontWeight: 700 }}>
                          GIBSONFAMILY HUB WRAPPED
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.02em', marginTop: '0.15rem' }}>
                          {recap?.month_label} Recap
                        </div>
                      </div>
                      <span
                        style={{
                          background: 'rgba(0, 0, 0, 0.35)',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '999px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                        }}
                      >
                        ✓ Closed
                      </span>
                    </div>

                    <div style={{ margin: '1rem 0 0.85rem 0' }}>
                      <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>HOUSEHOLD ARCHETYPE</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 800 }}>{persona.title}</div>
                    </div>

                    {/* 6 Key Highlights Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem', margin: '0.85rem 0' }}>
                      <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.66rem', opacity: 0.75 }}>INCOME</div>
                        <div style={{ fontSize: '0.98rem', fontWeight: 800 }}>${fmtMoney(overview.total_income)}</div>
                      </div>
                      <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.66rem', opacity: 0.75 }}>SPENT</div>
                        <div style={{ fontSize: '0.98rem', fontWeight: 800 }}>${fmtMoney(overview.total_spent)}</div>
                      </div>
                      <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.66rem', opacity: 0.75 }}>SAVED</div>
                        <div style={{ fontSize: '0.98rem', fontWeight: 800 }}>{fmtSignedMoney(overview.net_cashflow)}</div>
                      </div>
                      <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.66rem', opacity: 0.75 }}>SAVINGS RATE</div>
                        <div style={{ fontSize: '0.98rem', fontWeight: 800 }}>{overview.savings_rate_pct}%</div>
                      </div>
                      <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.66rem', opacity: 0.75 }}>LEFTOVER</div>
                        <div style={{ fontSize: '0.98rem', fontWeight: 800 }}>${fmtMoney(overview.total_leftover)}</div>
                      </div>
                      <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.66rem', opacity: 0.75 }}>TOP SPOT</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {recap?.top_merchant?.name || 'Local'}
                        </div>
                      </div>
                    </div>

                    {/* Trends */}
                    {trends.mom_spend_trend && (
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, background: 'rgba(0,0,0,0.25)', padding: '0.4rem 0.75rem', borderRadius: '6px', textAlign: 'center' }}>
                        {trends.mom_spend_trend}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.6rem', width: '100%', justifyContent: 'center' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setSlideIndex(0)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <RotateCcw size={15} />
                      Replay Recap
                    </button>
                    <button className="btn btn-primary" onClick={onClose}>
                      Done
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Story Navigation (Prev / Next Buttons & Touch zones) */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 30,
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
          }}
        >
          <button
            onClick={handlePrev}
            disabled={slideIndex === 0}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: '999px',
              background: 'rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              color: slideIndex === 0 ? 'rgba(255,255,255,0.3)' : '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: slideIndex === 0 ? 'default' : 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
            {slideIndex + 1} of {totalSlides}
          </span>

          <button
            onClick={handleNext}
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.2)',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            {slideIndex === totalSlides - 1 ? 'Finish' : 'Next'}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

