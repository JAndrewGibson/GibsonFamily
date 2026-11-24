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

function AnimatedMonthlySpendChart({ dailySpending = [], peakDay = null, totalBudget = 0 }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  if (!Array.isArray(dailySpending) || dailySpending.length === 0) return null;

  const w = 420;
  const h = 135;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const maxCum = Math.max(
    ...dailySpending.map((d) => Number(d.cumulative_spent || 0)),
    Number(totalBudget || 0),
    1
  );
  const maxDaily = Math.max(...dailySpending.map((d) => Number(d.daily_spent || 0)), 1);
  const n = dailySpending.length;

  const pts = dailySpending.map((d, idx) => {
    const x = padL + (n > 1 ? (idx / (n - 1)) * plotW : plotW / 2);
    const y = padT + plotH - (Number(d.cumulative_spent || 0) / maxCum) * plotH;
    return { ...d, x, y };
  });

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const budgetY =
    totalBudget > 0 ? padT + plotH - (Math.min(totalBudget, maxCum) / maxCum) * plotH : null;
  const barWidth = Math.max(3, Math.min(10, plotW / n - 2));
  const activePoint = hoveredDay ? pts.find((p) => p.day === hoveredDay) : pts[pts.length - 1];

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '0.85rem 0.95rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
          Spending Pace Throughout Month
        </div>
        <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#06b6d4' }}>
          {activePoint
            ? `Day ${activePoint.day}: $${fmtMoney(activePoint.cumulative_spent)} total${activePoint.daily_spent > 0 ? ` (+$${fmtMoney(activePoint.daily_spent)} that day)` : ''}`
            : ''}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="recapSpendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.36" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {budgetY !== null && (
          <g>
            <line
              x1={padL}
              y1={budgetY}
              x2={w - padR}
              y2={budgetY}
              stroke="var(--border)"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <text x={w - padR} y={Math.max(10, budgetY - 4)} textAnchor="end" fill="var(--text-muted)" fontSize="8.5">
              Budget ${fmtMoney(totalBudget)}
            </text>
          </g>
        )}

        {pts.map((p, idx) => {
          if (p.daily_spent <= 0) return null;
          const barH = Math.max(3, (p.daily_spent / maxDaily) * (plotH * 0.45));
          return (
            <rect
              key={p.day}
              x={p.x - barWidth / 2}
              y={padT + plotH - barH}
              width={barWidth}
              height={barH}
              rx="1.5"
              fill={peakDay?.day === p.day ? '#f59e0b' : 'rgba(99, 102, 241, 0.55)'}
              className="recap-bar-anim"
              style={{ animationDelay: `${Math.min(idx * 22, 650)}ms`, cursor: 'pointer' }}
              onMouseEnter={() => setHoveredDay(p.day)}
              onClick={() => setHoveredDay(p.day)}
            />
          );
        })}

        <path d={areaPath} fill="url(#recapSpendAreaGrad)" className="recap-area-anim" />
        <path
          d={linePath}
          fill="none"
          stroke="#06b6d4"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="100"
          className="recap-line-anim"
        />

        {pts.map((p) => (
          <circle
            key={`dot-${p.day}`}
            cx={p.x}
            cy={p.y}
            r={hoveredDay === p.day ? 4 : 2}
            fill={hoveredDay === p.day ? 'var(--bg-card)' : '#06b6d4'}
            stroke={hoveredDay === p.day ? '#06b6d4' : 'none'}
            strokeWidth={hoveredDay === p.day ? 2 : 0}
            opacity={hoveredDay === p.day || p.day === pts.length ? 1 : 0}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredDay(p.day)}
            onClick={() => setHoveredDay(p.day)}
          />
        ))}

        <text x={padL} y={h - 4} fill="var(--text-muted)" fontSize="9">
          Day 1
        </text>
        <text x={padL + plotW / 2} y={h - 4} textAnchor="middle" fill="var(--text-muted)" fontSize="9">
          Day {Math.ceil(n / 2)}
        </text>
        <text x={w - padR} y={h - 4} textAnchor="end" fill="var(--text-muted)" fontSize="9">
          Day {n}
        </text>
      </svg>

      {peakDay && peakDay.daily_spent > 0 && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>Peak shopping day: <strong style={{ color: 'var(--amber)' }}>{peakDay.date}</strong> (${fmtMoney(peakDay.daily_spent)})</span>
          <span>Tap/hover bars to inspect days</span>
        </div>
      )}
    </div>
  );
}

const FX_COLORS = ['#fbbf24', '#10b981', '#06b6d4', '#ec4899', '#818cf8', '#f43f5e', '#a855f7', '#ffffff'];
const SHAME_FX_COLORS = ['#ef4444', '#dc2626', '#f97316', '#991b1b', '#fca5a5', '#3b82f6'];
const BALLOON_COLORS = ['#fbbf24', '#10b981', '#06b6d4', '#ec4899', '#818cf8', '#f43f5e', '#a855f7'];
const STREAMER_COLORS = ['#fbbf24', '#10b981', '#ec4899', '#06b6d4', '#a855f7', '#f43f5e'];

function RecapCelebrationFX({ burstKey, mode = 'positive', level = 1 }) {
  const fgCanvasRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const particlesRef = useRef([]);
  const bgParticlesRef = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!burstKey) return;
    const fgCanvas = fgCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    if (!fgCanvas || !fgCanvas.parentElement || !bgCanvas) return;
    const fgCtx = fgCanvas.getContext('2d');
    const bgCtx = bgCanvas.getContext('2d');

    const resize = () => {
      if (!fgCanvas.parentElement) return;
      const rect = fgCanvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      [fgCanvas, bgCanvas].forEach((c) => {
        c.width = rect.width * dpr;
        c.height = rect.height * dpr;
      });
      fgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const isShame = mode === 'shame';
    const palette = isShame ? SHAME_FX_COLORS : FX_COLORS;
    const lvl = Math.max(1, Math.min(5, level));

    const spawnFireworkBurst = (x, y, color, countOverride) => {
      const count = countOverride || (isShame ? 22 + lvl * 4 : 26 + lvl * 8);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.22;
        const speed = 2.1 + Math.random() * (3.2 + lvl * 0.45);
        particlesRef.current.push({
          kind: 'spark',
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: isShame ? 0.085 : 0.06,
          drag: 0.965,
          alpha: 1,
          decay: 0.012 + Math.random() * 0.008,
          size: 2.0 + Math.random() * 2.2,
          color: Math.random() > 0.25 ? color : (isShame ? '#fca5a5' : '#ffffff'),
          trail: [],
        });
      }
    };

    const spawnSparklerFountain = (x, y, count = 24) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.95;
        const speed = 3.2 + Math.random() * 4.5;
        particlesRef.current.push({
          kind: 'spark',
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: 0.14,
          drag: 0.97,
          alpha: 1,
          decay: 0.016 + Math.random() * 0.01,
          size: 1.8 + Math.random() * 1.8,
          color: Math.random() > 0.35 ? '#fde68a' : '#fbbf24',
          trail: [],
        });
      }
    };

    const spawnStreamer = (w) => {
      const count = 4 + lvl * 2;
      for (let i = 0; i < count; i++) {
        particlesRef.current.push({
          kind: 'streamer',
          x: Math.random() * w,
          y: -15 - Math.random() * 40,
          vx: (Math.random() - 0.5) * 1.8,
          vy: 1.8 + Math.random() * 2.2,
          amp: 8 + Math.random() * 10,
          freq: 0.08 + Math.random() * 0.06,
          phase: Math.random() * Math.PI * 2,
          len: 26 + Math.random() * 20,
          color: STREAMER_COLORS[Math.floor(Math.random() * STREAMER_COLORS.length)],
          alpha: 0.95,
          decay: 0.004,
        });
      }
    };

    const spawnBalloon = (w, h) => {
      const count = 2 + lvl;
      for (let i = 0; i < count; i++) {
        const r = 13 + Math.random() * 7;
        bgParticlesRef.current.push({
          kind: 'balloon',
          x: 24 + Math.random() * (w - 48),
          y: h + 30 + Math.random() * 50,
          vx: (Math.random() - 0.5) * 0.7,
          vy: -(1.3 + Math.random() * 1.1),
          sway: Math.random() * Math.PI * 2,
          swaySpeed: 0.04 + Math.random() * 0.03,
          r,
          color: BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)],
        });
      }
    };

    const spawnConfettiShower = (w, h) => {
      const total = isShame ? 20 + lvl * 4 : 30 + lvl * 12;
      for (let i = 0; i < total; i++) {
        const fromCenter = i < total / 2;
        particlesRef.current.push({
          kind: 'confetti',
          x: fromCenter ? w * 0.5 + (Math.random() - 0.5) * 40 : Math.random() * w,
          y: fromCenter ? h * 0.3 : -10 - Math.random() * 40,
          vx: fromCenter ? (Math.random() - 0.5) * (5.5 + lvl * 0.6) : (Math.random() - 0.5) * 1.4,
          vy: fromCenter ? -2.2 - Math.random() * 4.0 : 1.3 + Math.random() * 2.2,
          gravity: isShame ? 0.095 : 0.072,
          drag: 0.985,
          w: 6 + Math.random() * 5,
          h: 4 + Math.random() * 4,
          rot: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.22,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.08 + Math.random() * 0.07,
          alpha: 1,
          decay: 0.005,
          color: palette[i % palette.length],
        });
      }
    };

    const loop = () => {
      if (!fgCanvas.parentElement) return;
      const rect = fgCanvas.parentElement.getBoundingClientRect();
      fgCtx.clearRect(0, 0, rect.width, rect.height);
      bgCtx.clearRect(0, 0, rect.width, rect.height);

      const bgList = bgParticlesRef.current;
      for (let i = bgList.length - 1; i >= 0; i--) {
        const b = bgList[i];
        b.sway += b.swaySpeed;
        b.x += b.vx + Math.sin(b.sway) * 0.55;
        b.y += b.vy;
        if (b.y < -60) {
          bgList.splice(i, 1);
          continue;
        }
        bgCtx.save();
        bgCtx.globalAlpha = 1;
        bgCtx.beginPath();
        bgCtx.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, Math.PI * 2);
        bgCtx.fillStyle = b.color;
        bgCtx.fill();
        bgCtx.beginPath();
        bgCtx.ellipse(b.x - b.r * 0.28, b.y - b.r * 0.35, b.r * 0.18, b.r * 0.28, -0.3, 0, Math.PI * 2);
        bgCtx.fillStyle = 'rgba(255,255,255,0.45)';
        bgCtx.fill();
        bgCtx.beginPath();
        bgCtx.moveTo(b.x, b.y + b.r);
        bgCtx.quadraticCurveTo(b.x + Math.sin(b.sway) * 6, b.y + b.r + 14, b.x, b.y + b.r + 28);
        bgCtx.strokeStyle = 'rgba(255,255,255,0.75)';
        bgCtx.lineWidth = 1.3;
        bgCtx.stroke();
        bgCtx.restore();
      }

      const list = particlesRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        if (p.kind === 'streamer') {
          p.phase += p.freq;
          p.x += p.vx + Math.sin(p.phase) * 0.8;
          p.y += p.vy;
          p.alpha -= p.decay;
          if (p.alpha <= 0 || p.y > rect.height + 40) {
            list.splice(i, 1);
            continue;
          }
          fgCtx.save();
          fgCtx.globalAlpha = Math.max(0, p.alpha);
          fgCtx.strokeStyle = p.color;
          fgCtx.lineWidth = 3.2;
          fgCtx.lineCap = 'round';
          fgCtx.beginPath();
          fgCtx.moveTo(p.x, p.y);
          for (let s = 4; s <= p.len; s += 4) {
            fgCtx.lineTo(p.x + Math.sin(p.phase + s * 0.18) * p.amp * 0.5, p.y - s);
          }
          fgCtx.stroke();
          fgCtx.restore();
          continue;
        }

        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;

        if (p.alpha <= 0 || p.y > rect.height + 35) {
          list.splice(i, 1);
          continue;
        }

        if (p.kind === 'spark') {
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 5) p.trail.shift();

          fgCtx.save();
          fgCtx.globalAlpha = Math.max(0, p.alpha);
          if (p.trail.length > 1) {
            fgCtx.beginPath();
            fgCtx.moveTo(p.trail[0].x, p.trail[0].y);
            for (let t = 1; t < p.trail.length; t++) fgCtx.lineTo(p.trail[t].x, p.trail[t].y);
            fgCtx.strokeStyle = p.color;
            fgCtx.lineWidth = p.size * 0.85;
            fgCtx.lineCap = 'round';
            fgCtx.stroke();
          }
          fgCtx.beginPath();
          fgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          fgCtx.fillStyle = p.color;
          fgCtx.shadowColor = p.color;
          fgCtx.shadowBlur = 10;
          fgCtx.fill();
          fgCtx.restore();
        } else {
          p.rot += p.vRot;
          p.wobble += p.wobbleSpeed;
          const scaleX = Math.cos(p.wobble);

          fgCtx.save();
          fgCtx.translate(p.x, p.y);
          fgCtx.rotate(p.rot);
          fgCtx.scale(scaleX, 1);
          fgCtx.globalAlpha = Math.max(0, p.alpha);
          fgCtx.fillStyle = p.color;
          fgCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          fgCtx.restore();
        }
      }

      if (list.length > 0 || bgList.length > 0) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };

    const ensureLoop = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };

    const rect = fgCanvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const timers = [];
    timers.push(
      setTimeout(() => {
        spawnConfettiShower(w, h);
        spawnFireworkBurst(w * 0.22, h * 0.24, isShame ? '#ef4444' : '#fbbf24');
        spawnFireworkBurst(w * 0.78, h * 0.26, isShame ? '#f97316' : '#ec4899');
        if (!isShame && lvl >= 2) spawnStreamer(w);
        if (!isShame && lvl >= 3) spawnBalloon(w, h);
        if (!isShame && lvl >= 4) {
          spawnSparklerFountain(w * 0.14, h * 0.55, 18 + lvl * 3);
          spawnSparklerFountain(w * 0.86, h * 0.55, 18 + lvl * 3);
        }
        ensureLoop();
      }, 360)
    );

    timers.push(
      setTimeout(() => {
        spawnFireworkBurst(w * 0.5, h * 0.18, isShame ? '#dc2626' : '#06b6d4');
        ensureLoop();
      }, 720)
    );

    timers.push(
      setTimeout(() => {
        spawnFireworkBurst(w * 0.28, h * 0.36, isShame ? '#ef4444' : '#10b981');
        spawnFireworkBurst(w * 0.72, h * 0.36, isShame ? '#3b82f6' : '#a855f7');
        if (!isShame && lvl >= 5) {
          spawnFireworkBurst(w * 0.5, h * 0.28, '#fbbf24', 44);
          spawnBalloon(w, h);
        }
        ensureLoop();
      }, 1050)
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
      window.removeEventListener('resize', resize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [burstKey, mode, level]);

  return (
    <>
      <canvas
        ref={bgCanvasRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />
      <canvas
        ref={fgCanvasRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 42,
        }}
      />
    </>
  );
}

function ShameBackdropOverlay({ level, isFadingOut }) {
  if (level <= 0) return null;
  const clamped = Math.min(5, level);
  const oozeScale = clamped === 3 ? 0.45 : clamped === 4 ? 0.9 : clamped >= 5 ? 1.45 : 0;

  return (
    <div className={`month-recap-overlay-layer ${isFadingOut ? 'is-fading-out' : ''}`} aria-hidden="true">
      <div className="shame-siren-overlay" />

      {clamped >= 3 && (
        <svg className="shame-blood-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="bloodGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#991b1b" />
              <stop offset="70%" stopColor="#7f1d1d" />
              <stop offset="100%" stopColor="#450a0a" />
            </linearGradient>
          </defs>
          <g className="shame-blood-ooze-group" style={{ transform: `scaleY(${oozeScale})` }}>
            <path
              fill="url(#bloodGrad)"
              d="M0 0 H100 V14 C94 14 92 48 88 48 C84 48 82 18 76 18 C70 18 68 62 63 62 C58 62 56 20 50 20 C44 20 42 54 36 54 C31 54 29 17 22 17 C16 17 14 44 9 44 C5 44 3 16 0 16 Z"
            />
          </g>
        </svg>
      )}

      <svg className="shame-crack-overlay" viewBox="0 0 540 660" preserveAspectRatio="none">
        {clamped >= 1 && (
          <g stroke="rgba(254, 202, 202, 0.72)" strokeWidth="2.1" fill="none" strokeLinecap="round">
            <path d="M270 0 L254 62 L280 120 L246 185" />
            <path d="M254 62 L205 92 L175 130" />
          </g>
        )}
        {clamped >= 2 && (
          <g stroke="rgba(254, 202, 202, 0.78)" strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M0 180 L65 210 L118 258 L185 245 L220 295" />
            <path d="M540 160 L470 198 L420 245 L350 232" />
            <path d="M280 120 L335 152 L390 142" />
          </g>
        )}
        {clamped >= 3 && (
          <g stroke="rgba(254, 202, 202, 0.85)" strokeWidth="2.2" fill="none" strokeLinecap="round">
            <path d="M246 185 L270 265 L235 340 L278 415 L252 485" />
            <path d="M270 265 L345 292 L410 355" />
            <path d="M235 340 L165 375 L105 430" />
          </g>
        )}
        {clamped >= 4 && (
          <g stroke="rgba(255, 255, 255, 0.85)" strokeWidth="1.9" fill="none" strokeLinecap="round">
            <path d="M0 440 L85 415 L155 470 L215 445" />
            <path d="M540 420 L455 450 L385 495 L320 470" />
            <path d="M278 415 L335 510 L310 595 L345 660" />
          </g>
        )}
        {clamped >= 5 && (
          <g stroke="rgba(255, 255, 255, 0.92)" strokeWidth="2.3" fill="none" strokeLinecap="round">
            <path d="M120 0 L145 95 L98 165 L140 235" />
            <path d="M420 0 L395 85 L445 155 L402 225" />
            <path d="M252 485 L195 570 L225 660" />
            <path d="M90 660 L145 560 L210 545" />
            <path d="M460 660 L400 575 L345 555" />
          </g>
        )}
      </svg>
    </div>
  );
}

const POSITIVE_SPARKLE_POINTS = [
  { top: '12%', left: '10%', delay: '0s' },
  { top: '18%', right: '12%', delay: '0.4s' },
  { top: '42%', left: '7%', delay: '0.8s' },
  { top: '48%', right: '8%', delay: '0.2s' },
  { top: '72%', left: '12%', delay: '0.6s' },
  { top: '78%', right: '14%', delay: '1.0s' },
  { top: '28%', left: '22%', delay: '0.3s' },
  { top: '64%', right: '22%', delay: '0.9s' },
];

function PositiveBackdropOverlay({ level, isFadingOut }) {
  if (level < 2) return null;
  const clamped = Math.min(5, level);
  const starCount = clamped >= 5 ? 8 : clamped >= 4 ? 5 : clamped >= 3 ? 3 : 0;

  return (
    <div className={`month-recap-overlay-layer ${isFadingOut ? 'is-fading-out' : ''}`} aria-hidden="true">
      <div className={`positive-aura-overlay level-${clamped}`} />
      {POSITIVE_SPARKLE_POINTS.slice(0, starCount).map((pt, idx) => (
        <span
          key={idx}
          className="positive-star-sparkle"
          style={{
            top: pt.top,
            left: pt.left,
            right: pt.right,
            animationDelay: pt.delay,
          }}
        >
          ✦
        </span>
      ))}
    </div>
  );
}

function GetBackOnTrackModal({ isOpen, onClose, onReviewCategories }) {
  if (!isOpen) return null;

  return (
    <div
      className="finance-modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      style={{ zIndex: 1200 }}
    >
      <div
        className="finance-modal-card finance-modal-lg"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '540px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="finance-modal-header">
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', margin: 0 }}>
              <ShieldCheck size={20} color="#10b981" />
              A Rough Month Doesn&apos;t Define You
            </h3>
            <p className="text-muted" style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem' }}>
              One off-track month is feedback, not a character flaw.
            </p>
          </div>
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={onClose}
            aria-label="Close get back on track guide"
          >
            <X size={20} />
          </button>
        </div>

        <div
          className="finance-modal-body"
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.95rem',
            lineHeight: 1.55,
            fontSize: '0.9rem',
          }}
        >
          <div
            style={{
              padding: '0.9rem 1rem',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}
          >
            <p style={{ margin: '0 0 0.55rem 0' }}>
              Seeing red badges can make you want to close the app and avoid looking at your numbers altogether. That&apos;s normal—but{' '}
              <strong>you are not a bad person, and you aren&apos;t &ldquo;bad with money.&rdquo;</strong> You just made a few financial choices this month that didn&apos;t line up with your goals.
            </p>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              There&apos;s a big difference between <em>&ldquo;I messed up&rdquo;</em> and <em>&ldquo;I made a choice I want to handle differently next time.&rdquo;</em> The first one makes you feel stuck. The second one puts you back in the driver&apos;s seat.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>3 Practical Steps to Reset Together</div>

            <div
              style={{
                padding: '0.8rem 0.9rem',
                borderRadius: '12px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                1. Walk through your categories with curiosity, not blame
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Open your Category Budgets and look at the 1–2 categories that went over. Ask a simple question:{' '}
                <em>Was this a one-time surprise, an impulse habit, or a budget limit that&apos;s too tight for real life?</em>{' '}
                If life costs more right now, adjust the limit honestly instead of setting yourself up to fail again.
              </div>
            </div>

            <div
              style={{
                padding: '0.8rem 0.9rem',
                borderRadius: '12px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                2. Make one concrete plan for the future
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                Vague promises (&ldquo;we&apos;ll spend less&rdquo;) rarely stick. Pick <strong>one specific move</strong> for next month:
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.15rem', fontSize: '0.83rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <li>Rebalance a category limit before the 1st of the month</li>
                <li>Set a 24-hour pause rule on non-essential purchases over a set amount</li>
                <li>Use Rollover on uneven categories so one big week doesn&apos;t derail the whole month</li>
              </ul>
            </div>

            <div
              style={{
                padding: '0.8rem 0.9rem',
                borderRadius: '12px',
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                3. Do a quick 5-minute partner check-in
              </div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Silence makes money stress heavier. Talk through what felt hard this month, agree on your one adjustment together, and let the rest go. Every 1st of the month is a clean slate—and your next{' '}
                <strong>Clean Sheet</strong> streak starts with just one intentional month.
              </div>
            </div>
          </div>
        </div>

        <div
          className="finance-modal-footer"
          style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            I&apos;ve Got This
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onReviewCategories}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            Review Category Budgets
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
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
  const [badgeFilter, setBadgeFilter] = useState('all');
  const [showBackOnTrack, setShowBackOnTrack] = useState(false);
  const [ceremonyPhase, setCeremonyPhase] = useState('done'); // 'intro' | 'slam' | 'collapsing' | 'done'
  const [ceremonyMode, setCeremonyMode] = useState('positive'); // 'positive' | 'shame'
  const [chainShameAfter, setChainShameAfter] = useState(false);
  const [slamIndex, setSlamIndex] = useState(0);
  const [fxBurstKey, setFxBurstKey] = useState(0);
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
  const totalSlides = slides.length || 9;

  const ceremonyActive = ceremonyPhase !== 'done';

  // Auto-advance slides every 6 seconds if playing (pause auto-advance during active badge slam ceremony)
  useEffect(() => {
    if (!isOpen || !isPlaying || loading || totalSlides === 0 || ceremonyActive) return;
    timerRef.current = setTimeout(() => {
      setSlideIndex((prev) => (prev + 1) % totalSlides);
    }, 6000);
    return () => clearTimeout(timerRef.current);
  }, [isOpen, isPlaying, slideIndex, loading, totalSlides, ceremonyActive]);

  const badgeShowroom = recap?.badge_showroom || [];
  const unlockedBadgesList = badgeShowroom.filter((b) => b.unlocked);
  const unlockedPositiveList = unlockedBadgesList.filter((b) => !b.is_shame);
  const unlockedShameList = unlockedBadgesList.filter((b) => b.is_shame);
  const ceremonyList = ceremonyMode === 'shame' ? unlockedShameList : unlockedPositiveList;
  const activeLevel = ceremonyPhase === 'done' || ceremonyPhase === 'intro' ? 0 : Math.min(5, slamIndex + 1);
  const isFadingOut = ceremonyPhase === 'collapsing';

  const startCeremony = (mode, chainShame = false) => {
    const targetList = mode === 'shame' ? unlockedShameList : unlockedPositiveList;
    if (targetList.length === 0) return;
    setCeremonyMode(mode);
    setChainShameAfter(chainShame);
    setSlamIndex(0);
    if (targetList.length > 1) {
      setCeremonyPhase('intro');
    } else {
      setCeremonyPhase('slam');
      setFxBurstKey((k) => k + 1);
    }
  };

  // Trigger Gamified Badge Slam Ceremony & Fireworks when entering Slide 7 (or Slide 5)
  useEffect(() => {
    if (!isOpen || loading) return;
    if (slideIndex === 7 && unlockedBadgesList.length > 0) {
      if (unlockedPositiveList.length > 0) {
        startCeremony('positive', unlockedShameList.length > 0);
      } else if (unlockedShameList.length > 0) {
        startCeremony('shame', false);
      }
    } else if (slideIndex === 5 && unlockedPositiveList.length > 0) {
      setCeremonyMode('positive');
      setChainShameAfter(false);
      setFxBurstKey((k) => k + 1);
      setCeremonyPhase('done');
    } else {
      setCeremonyPhase('done');
      setChainShameAfter(false);
    }
  }, [isOpen, loading, slideIndex, unlockedPositiveList.length, unlockedShameList.length]);

  // Step through intro -> unlocked badges crashing down -> smooth 1.5s collapse & fade-out
  useEffect(() => {
    if (ceremonyPhase === 'intro') {
      const introTimer = setTimeout(() => {
        setCeremonyPhase('slam');
        setSlamIndex(0);
        setFxBurstKey((k) => k + 1);
      }, 2200);
      return () => clearTimeout(introTimer);
    }
    if (ceremonyPhase === 'slam' && ceremonyList.length > 0) {
      const stepTimer = setTimeout(() => {
        if (slamIndex < ceremonyList.length - 1) {
          setSlamIndex((prev) => prev + 1);
          setFxBurstKey((k) => k + 1);
        } else {
          setCeremonyPhase('collapsing');
        }
      }, 2800);
      return () => clearTimeout(stepTimer);
    }
    if (ceremonyPhase === 'collapsing') {
      const collapseTimer = setTimeout(() => {
        if (ceremonyMode === 'positive' && chainShameAfter && unlockedShameList.length > 0) {
          startCeremony('shame', false);
        } else {
          setCeremonyPhase('done');
          setChainShameAfter(false);
        }
      }, 1500);
      return () => clearTimeout(collapseTimer);
    }
  }, [ceremonyPhase, slamIndex, ceremonyList.length, ceremonyMode, chainShameAfter, unlockedShameList.length]);

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
  const funFacts = recap?.fun_facts || {};
  const pendingBadgesList = badgeShowroom.filter((b) => !b.unlocked && b.pending_unlock);
  const shameBadgesCount = badgeShowroom.filter((b) => b.is_shame).length;
  const filteredBadges = badgeShowroom.filter((b) => {
    if (badgeFilter === 'unlocked') return Boolean(b.unlocked);
    if (badgeFilter === 'pending') return Boolean(!b.unlocked && b.pending_unlock);
    if (badgeFilter === 'shame') return Boolean(b.is_shame);
    if (badgeFilter === 'locked') return !b.unlocked;
    return true;
  });

  const isShameCeremonyActive =
    slideIndex === 7 &&
    ceremonyMode === 'shame' &&
    (ceremonyPhase === 'intro' || ceremonyPhase === 'slam');
  const isPositiveChampionActive =
    slideIndex === 7 &&
    ceremonyMode === 'positive' &&
    ceremonyPhase === 'slam' &&
    activeLevel >= 3;

  return (
    <div
      className="finance-modal-backdrop month-recap-backdrop"
      onClick={onClose}
      style={{
        zIndex: 1100,
      }}
    >
      <div
        className={`month-recap-container ${
          ceremonyPhase === 'slam'
            ? ceremonyMode === 'shame'
              ? 'recap-slam-shake shame-shake'
              : 'recap-slam-shake'
            : ''
        } ${isShameCeremonyActive ? 'shame-mode-active' : ''} ${
          isPositiveChampionActive ? 'positive-champion-active' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(94vw, 540px)',
          minHeight: '620px',
          maxHeight: '92vh',
          borderRadius: '24px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: 'var(--bg-card)',
        }}
      >
        {(slideIndex === 5 || slideIndex === 7) && unlockedBadgesList.length > 0 && (
          <RecapCelebrationFX
            burstKey={fxBurstKey}
            mode={slideIndex === 7 ? ceremonyMode : 'positive'}
            level={slideIndex === 7 ? Math.max(1, activeLevel) : 2}
          />
        )}
        {slideIndex === 7 && ceremonyMode === 'shame' && activeLevel > 0 && (
          <ShameBackdropOverlay level={activeLevel} isFadingOut={isFadingOut} />
        )}
        {slideIndex === 7 && ceremonyMode === 'positive' && activeLevel >= 2 && (
          <PositiveBackdropOverlay level={activeLevel} isFadingOut={isFadingOut} />
        )}
        {/* Top Header Overlay with Solid-to-Gradient Mask so Scrolled Content Never Collides with Bars/Title */}
        <div
          className="month-recap-top-header"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '12px 16px 28px 16px',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          {/* Story Progress Indicators at Top */}
          <div
            style={{
              display: 'flex',
              gap: '5px',
              marginBottom: '10px',
              pointerEvents: 'auto',
            }}
          >
            {Array.from({ length: totalSlides }).map((_, i) => {
              const isCompleted = i < slideIndex;
              const isActive = i === slideIndex;
              return (
                <div
                  key={i}
                  onClick={() => setSlideIndex(i)}
                  className={`month-recap-progress-seg ${isCompleted || isActive ? 'is-filled' : ''}`}
                >
                  {isActive && isPlaying && (
                    <div className="month-recap-progress-fill" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Top Controls (Month label, Play/Pause, Close) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span className="month-recap-pill">
                {recap?.month_label || selectedMonth} Recap
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                onClick={() => setIsPlaying((p) => !p)}
                className="month-recap-icon-btn"
                title={isPlaying ? 'Pause recap' : 'Play recap'}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: '2px' }} />}
              </button>

              <button
                onClick={onClose}
                className="month-recap-icon-btn"
                aria-label="Close recap"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Slide Content Area */}
        <div
          className="month-recap-scroll-body"
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            padding: '84px 24px 86px 24px',
            overflowY: 'auto',
          }}
        >
          <div style={{ marginTop: 'auto', marginBottom: 'auto', width: '100%' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Cooking up your {selectedMonth} Recap...
            </div>
          ) : (
            <>
              {/* SLIDE 0: Cover & Household Persona */}
              {slideIndex === 0 && (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
                  <div className="recap-cover-pill">
                    <Sparkles size={14} color="var(--amber)" />
                    Household Financial Wrapped
                  </div>

                  <h1 className="recap-cover-title">
                    {recap?.month_label}
                  </h1>

                  <div
                    className="recap-persona-card"
                    style={{
                      padding: '1.75rem 1.5rem',
                      borderRadius: '20px',
                      background: persona.theme_gradient,
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
                      Household Savings Rate: <strong style={{ color: 'var(--text-main)' }}>{overview.savings_rate_pct}%</strong>
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
                      {Number(overview.projected_income || 0) > 0 && (
                        <div style={{ fontSize: '0.72rem', color: overview.exceeded_income_projection ? '#10b981' : 'var(--text-muted)', marginTop: '0.2rem', fontWeight: overview.exceeded_income_projection ? 700 : 400 }}>
                          Projected: ${fmtMoney(overview.projected_income)}
                          {overview.exceeded_income_projection && Number(overview.excess_income || 0) > 0
                            ? ` (+$${fmtMoney(overview.excess_income)} / +${overview.income_vs_projected_pct}%)`
                            : ''}
                        </div>
                      )}
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
                      <div className="recap-trend-pill is-indigo">
                        {trends.mom_spend_trend.includes('down') ? (
                          <TrendingDown size={18} color="#10b981" />
                        ) : (
                          <TrendingUp size={18} color="#f43f5e" />
                        )}
                        <span>{trends.mom_spend_trend}</span>
                      </div>
                    )}

                    {trends.yoy_spend_trend && (
                      <div className="recap-trend-pill is-green">
                        <Award size={18} color="#10b981" />
                        <span>{trends.yoy_spend_trend}</span>
                      </div>
                    )}
                  </div>

                  <AnimatedMonthlySpendChart
                    key={`spend-chart-${recap?.budget_month}-${slideIndex}`}
                    dailySpending={recap?.daily_spending}
                    peakDay={recap?.peak_spending_day}
                    totalBudget={overview.total_budget}
                  />
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
                                color: cat.rank === 1 ? 'var(--amber)' : 'var(--text-muted)',
                                width: '22px',
                              }}
                            >
                              #{cat.rank}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{cat.category}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                              ${fmtMoney(cat.spent)}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                              ({cat.pct}%)
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ height: '5px', background: 'rgba(148, 163, 184, 0.25)', borderRadius: '3px', overflow: 'hidden' }}>
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
                        background: 'var(--bg-panel)',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--amber)', fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                        <Flame size={16} />
                        MOST FREQUENTED SPOT
                      </div>
                      <div className="recap-highlight-title" style={{ fontSize: '1.6rem', fontWeight: 900, marginTop: '0.35rem' }}>
                        {recap.top_merchant.name}
                      </div>
                      <div className="recap-highlight-amber-accent" style={{ fontSize: '0.9rem', marginTop: '0.25rem', fontWeight: 600 }}>
                        Visited {recap.top_merchant.count} times this month (${fmtMoney(recap.top_merchant.total_spent)} total)
                      </div>
                      <div className="recap-highlight-sub" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--green)', fontSize: '0.76rem', textTransform: 'uppercase', fontWeight: 700 }}>
                        <Award size={16} />
                        BUDGET MVP OF THE MONTH
                      </div>
                      <div className="recap-highlight-title" style={{ fontSize: '1.6rem', fontWeight: 900, marginTop: '0.35rem' }}>
                        {recap.budget_mvp.category}
                      </div>
                      <div className="recap-highlight-green-accent" style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.2rem' }}>
                        +${fmtMoney(recap.budget_mvp.saved)} Under Limit!
                      </div>
                      <div className="recap-highlight-sub" style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
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
                    <PiggyBank size={40} color="var(--primary)" style={{ margin: '0 auto 0.5rem auto' }} />
                    <div className="recap-highlight-title" style={{ fontSize: '2.5rem', fontWeight: 900 }}>
                      ${fmtMoney(overview.recommended_savings_transfer ?? overview.total_leftover)}
                    </div>
                    <div className="recap-highlight-indigo-accent" style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.35rem' }}>
                      {overview.exceeded_income_projection && Number(overview.excess_income || 0) > 0
                        ? 'Total Savings Surplus (Leftover + Excess Income)'
                        : 'Non-Rollover Leftover Budget Surplus'}
                    </div>
                    <p className="recap-highlight-sub" style={{ margin: '0.75rem auto 0 auto', maxWidth: '380px', fontSize: '0.84rem', lineHeight: 1.45 }}>
                      {overview.exceeded_income_projection && Number(overview.excess_income || 0) > 0
                        ? `Congratulations! You earned $${fmtMoney(overview.excess_income)} above projected income and exceeded your savings target!`
                        : 'This surplus was instructed to transfer directly into your high-yield savings account!'}
                    </p>
                  </div>

                  {/* Milestone Badges */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                        {recap?.milestones?.length > 0
                          ? `BADGES UNLOCKED THIS MONTH (${recap.milestones.length}/${badgeShowroom.length || 50})`
                          : pendingBadgesList.length > 0
                          ? `READY TO UNLOCK ON MONTH CLOSE (${pendingBadgesList.length} PREVIEW)`
                          : `BADGES UNLOCKED THIS MONTH (0/${badgeShowroom.length || 50})`}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
                        onClick={() => setSlideIndex(7)}
                      >
                        Open Badge Showroom →
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
                      {(recap?.milestones?.length > 0 ? recap.milestones : pendingBadgesList).map((m) => (
                        <div
                          key={m.id}
                          style={{
                            background: m.unlocked ? 'var(--bg-panel)' : 'rgba(245, 158, 11, 0.08)',
                            border: m.unlocked ? '1px solid var(--border)' : '1px dashed rgba(245, 158, 11, 0.45)',
                            borderRadius: '10px',
                            padding: '0.65rem',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '0.2rem',
                          }}
                        >
                          <span style={{ fontSize: '1.2rem' }}>{m.emoji || '🏆'}</span>
                          <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>{m.title}</span>
                          {!m.unlocked && (
                            <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase' }}>
                              ⏳ Unlocks on Close
                            </span>
                          )}
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.subtitle}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* SLIDE 6: Month Fun Facts, Pace, Category Swings & Household Activity */}
              {slideIndex === 6 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
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
                      DEEP DIVE & RHYTHM
                    </span>
                    <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.55rem', fontWeight: 800 }}>
                      Month Fun Facts
                    </h2>
                  </div>

                  {/* Spending Timing & No-Spend Streak Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.8rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Favorite Shopping Day
                      </div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--amber)', marginTop: '0.2rem' }}>
                        {funFacts.favorite_day_of_week?.day_name || 'Saturday'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        ${fmtMoney(funFacts.favorite_day_of_week?.spent)} across {funFacts.favorite_day_of_week?.tx_count || 0} purchases
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.8rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        No-Spend Freeze
                      </div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#06b6d4', marginTop: '0.2rem' }}>
                        {funFacts.no_spend_days_count || 0} $0 Days
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        Longest streak: <strong>{funFacts.longest_no_spend_streak || 0} days</strong> in a row
                      </div>
                    </div>
                  </div>

                  {/* Weekday vs Weekend & First-Half vs Second-Half */}
                  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                      <span>Weekdays: ${fmtMoney(funFacts.weekday_spent)} ({funFacts.weekday_tx_count || 0})</span>
                      <span style={{ color: '#a855f7' }}>Weekends: ${fmtMoney(funFacts.weekend_spent)} ({funFacts.weekend_tx_count || 0})</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      <span>1st Half (Days 1–15): {funFacts.first_half_pct ?? 50}%</span>
                      <span>2nd Half (Days 16+): {funFacts.second_half_pct ?? 50}%</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--primary)', fontWeight: 600, marginTop: '0.25rem' }}>
                      Pacing Verdict: {funFacts.pacing_label || 'Evenly Paced Month'}
                    </div>
                  </div>

                  {/* Biggest Category Swings (MoM) & Essentials vs Discretionary */}
                  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Category Swings & Breakdown
                    </div>
                    {funFacts.biggest_category_drop && (
                      <div style={{ fontSize: '0.78rem', color: '#10b981', fontWeight: 600 }}>
                        ↓ Biggest Drop: <strong>{funFacts.biggest_category_drop.category}</strong> ({fmtSignedMoney(funFacts.biggest_category_drop.delta)} vs last month)
                      </div>
                    )}
                    {funFacts.biggest_category_jump && (
                      <div style={{ fontSize: '0.78rem', color: '#f43f5e', fontWeight: 600 }}>
                        ↑ Biggest Jump: <strong>{funFacts.biggest_category_jump.category}</strong> ({fmtSignedMoney(funFacts.biggest_category_jump.delta)} vs last month)
                      </div>
                    )}
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <span>Essentials/Bills: <strong>${fmtMoney(funFacts.essential_spent)}</strong></span>
                      <span>Discretionary: <strong>${fmtMoney(funFacts.discretionary_spent)}</strong></span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <span>Refunds Credited: <strong style={{ color: '#10b981' }}>${fmtMoney(funFacts.returns_total)}</strong> ({funFacts.returns_count || 0})</span>
                      <span>Receipts Split: <strong>{funFacts.split_tx_count || 0}</strong></span>
                    </div>
                  </div>

                  {/* Savings, Goals & Couples Household Activity */}
                  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                      Vault, Goals & Household Life
                    </div>
                    <div style={{ fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <span>Savings & Brokerage Vault: <strong style={{ color: '#10b981' }}>${fmtMoney(funFacts.total_savings_brokerage_balance)}</strong></span>
                      <span>Transfers In: <strong>+${fmtMoney(funFacts.savings_transfers_month)}</strong></span>
                    </div>
                    {funFacts.future_purchases?.active_count > 0 && (
                      <div style={{ fontSize: '0.76rem', color: '#06b6d4' }}>
                        Big Purchases Roadmap ({funFacts.future_purchases.active_count}): <strong>${fmtMoney(funFacts.future_purchases.total_saved)}</strong> / ${fmtMoney(funFacts.future_purchases.total_target)} ({funFacts.future_purchases.progress_pct}%)
                      </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.15rem' }}>
                      <span>✅ Tasks Done: <strong>{funFacts.household_activity?.recurring_tasks_completed || 0}</strong></span>
                      <span>🛒 Groceries: <strong>{funFacts.household_activity?.groceries_checked || 0}</strong></span>
                      <span>🎁 Gifts Revealed: <strong>{funFacts.gifts_revealed?.count || 0}</strong></span>
                      <span>💎 Splendor Games: <strong>{funFacts.household_activity?.splendor_games_completed || 0}</strong></span>
                    </div>
                  </div>
                </div>
              )}

              {/* SLIDE 7: Household Badge Showroom & Gamified Badge Slam Ceremony */}
              {slideIndex === 7 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--amber)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      🎆 TROPHY CASE ({unlockedBadgesList.length} OF {badgeShowroom.length || 50} UNLOCKED)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                      <h2 style={{ margin: 0, fontSize: '1.55rem', fontWeight: 800 }}>
                        Badge Showroom
                      </h2>
                      {unlockedBadgesList.length > 0 && ceremonyPhase === 'done' && (
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            border: '1px solid rgba(251, 191, 36, 0.45)',
                            color: 'var(--amber)',
                            background: 'rgba(251, 191, 36, 0.1)',
                          }}
                          title="Replay Unlock Ceremony"
                          aria-label="Replay Unlock Ceremony"
                          onClick={() => {
                            setBadgeFilter('all');
                            if (unlockedPositiveList.length > 0) {
                              startCeremony('positive', unlockedShameList.length > 0);
                            } else if (unlockedShameList.length > 0) {
                              startCeremony('shame', false);
                            }
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Pre-Badge Searchlight Intro (only if > 1 badge unlocked in active ceremony) */}
                  {ceremonyPhase === 'intro' && (
                    <div className={`badge-slam-stage badge-ceremony-intro ${ceremonyMode === 'shame' ? 'is-shame' : ''}`}>
                      <div className={`searchlight-beam searchlight-left ${ceremonyMode === 'shame' ? 'is-shame' : ''}`} />
                      <div className={`searchlight-beam searchlight-right ${ceremonyMode === 'shame' ? 'is-shame' : ''}`} />
                      <div className={`ceremony-intro-text ${ceremonyMode === 'shame' ? 'is-shame' : ''}`}>
                        {ceremonyMode === 'shame'
                          ? `🚨 ${unlockedShameList.length} Wall of Shame badges triggered!`
                          : `${unlockedPositiveList.length} badges earned this month!`}
                      </div>
                    </div>
                  )}

                  {/* Gamified Badge Crashing Down & Locking-In Stage */}
                  {(ceremonyPhase === 'slam' || ceremonyPhase === 'collapsing') && ceremonyList[slamIndex] && (
                    <div
                      key={`slam-stage-${ceremonyMode}-${ceremonyList[slamIndex].id}-${slamIndex}`}
                      className={`badge-slam-stage ${ceremonyMode === 'shame' ? 'is-shame' : ''} ${ceremonyPhase === 'collapsing' ? 'is-collapsing' : ''}`}
                    >
                      <div className={`badge-shockwave-ring ${ceremonyMode === 'shame' ? 'is-shame' : ''}`} />
                      <div className={`badge-crash-icon ${ceremonyMode === 'shame' ? 'is-shame' : ''}`}>
                        {ceremonyList[slamIndex].emoji || (ceremonyMode === 'shame' ? '🚨' : '🏆')}
                      </div>
                      <div className="badge-slam-copy">
                        <div
                          style={{
                            fontSize: '1.35rem',
                            fontWeight: 900,
                            color: ceremonyMode === 'shame' ? '#fecaca' : '#fff',
                            marginTop: '0.55rem',
                          }}
                        >
                          {ceremonyList[slamIndex].title}
                          {ceremonyList[slamIndex].is_repeatable && ceremonyList[slamIndex].times_earned > 0
                            ? ` ×${ceremonyList[slamIndex].times_earned}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Filter Pills */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {[
                      { id: 'all', label: `All (${badgeShowroom.length})` },
                      { id: 'unlocked', label: `Unlocked (${badgeShowroom.filter((b) => b.unlocked).length})` },
                      ...(pendingBadgesList.length > 0
                        ? [{ id: 'pending', label: `Ready on Close (${pendingBadgesList.length})` }]
                        : []),
                      ...(shameBadgesCount > 0
                        ? [{ id: 'shame', label: `🚨 Wall of Shame (${shameBadgesCount})` }]
                        : []),
                      { id: 'locked', label: `Locked (${badgeShowroom.filter((b) => !b.unlocked).length})` },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setBadgeFilter(tab.id)}
                        className={`recap-badge-filter-pill ${badgeFilter === tab.id ? 'is-active' : ''} ${tab.id === 'shame' ? 'is-shame' : ''}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {(unlockedShameList.length > 0 || badgeFilter === 'shame') && (
                    <div style={{ textAlign: 'center', marginTop: '-0.15rem' }}>
                      <button
                        type="button"
                        onClick={() => setShowBackOnTrack(true)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '0.3rem 0.5rem',
                          color: 'var(--red)',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          textDecoration: 'underline',
                          textUnderlineOffset: '3px',
                          cursor: 'pointer',
                        }}
                      >
                        What to actually do to get back on track.
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.55rem' }}>
                    {filteredBadges.map((b) => {
                      const isShame = Boolean(b.is_shame);
                      const inCurrentCeremony = ceremonyMode === 'shame' ? isShame : !isShame;
                      const ceremonyIdx = inCurrentCeremony ? ceremonyList.findIndex((u) => u.id === b.id) : -1;
                      const isWaitingToSlam =
                        b.unlocked &&
                        (inCurrentCeremony
                          ? ceremonyPhase === 'intro' ||
                            ((ceremonyPhase === 'slam' || ceremonyPhase === 'collapsing') && ceremonyIdx > slamIndex)
                          : ceremonyMode === 'positive' && chainShameAfter && isShame);
                      const isJustSlammed =
                        ceremonyPhase === 'slam' && b.unlocked && inCurrentCeremony && ceremonyIdx === slamIndex;
                      const isLockedIntoPlace = b.unlocked && !isWaitingToSlam;
                      const pct =
                        !b.is_repeatable && Number(b.progress_target) > 0
                          ? Math.min(100, Math.round((Number(b.progress_current || 0) / Number(b.progress_target)) * 100))
                          : b.unlocked
                          ? 100
                          : 0;
                      return (
                        <div
                          key={b.id}
                          className={
                            isJustSlammed
                              ? isShame
                                ? 'badge-slot-just-slammed-shame'
                                : 'badge-slot-just-slammed'
                              : isLockedIntoPlace
                              ? 'badge-slot-locked-in'
                              : ''
                          }
                          style={{
                            background: isLockedIntoPlace
                              ? isShame
                                ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.22) 0%, rgba(127, 29, 29, 0.28) 100%)'
                                : b.is_repeatable
                                ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(236, 72, 153, 0.14) 100%)'
                                : 'linear-gradient(135deg, rgba(99, 102, 241, 0.16) 0%, rgba(16, 185, 129, 0.14) 100%)'
                              : b.pending_unlock
                              ? isShame
                                ? 'rgba(239, 68, 68, 0.1)'
                                : 'rgba(245, 158, 11, 0.08)'
                              : isShame
                              ? 'rgba(239, 68, 68, 0.04)'
                              : 'var(--bg-panel)',
                            border: isLockedIntoPlace
                              ? isShame
                                ? '1px solid rgba(239, 68, 68, 0.65)'
                                : b.is_repeatable
                                ? '1px solid rgba(245, 158, 11, 0.5)'
                                : '1px solid rgba(16, 185, 129, 0.45)'
                              : b.pending_unlock
                              ? isShame
                                ? '1px dashed rgba(239, 68, 68, 0.5)'
                                : '1px dashed rgba(245, 158, 11, 0.5)'
                              : isShame
                              ? '1px dashed rgba(239, 68, 68, 0.28)'
                              : '1px dashed var(--border)',
                            borderRadius: '12px',
                            padding: '0.7rem 0.65rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.28rem',
                            opacity: isWaitingToSlam ? 0.25 : b.unlocked ? 1 : b.pending_unlock ? 0.9 : 0.68,
                            transform: isWaitingToSlam ? 'scale(0.94)' : 'scale(1)',
                            transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
                            <span style={{ fontSize: '1.35rem', filter: b.unlocked ? 'none' : 'grayscale(100%)' }}>
                              {b.emoji || '🏆'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {b.is_repeatable && b.times_earned > 0 && (
                                <span
                                  style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 900,
                                    padding: '0.1rem 0.42rem',
                                    borderRadius: '999px',
                                    background: isShame ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                    color: isShame ? 'var(--red)' : 'var(--amber)',
                                    border: isShame ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(245, 158, 11, 0.45)',
                                  }}
                                >
                                  ×{b.times_earned}
                                </span>
                              )}
                              <span
                                className={`recap-badge-status ${
                                  b.unlocked
                                    ? isShame
                                      ? 'is-shame'
                                      : 'is-unlocked'
                                    : b.pending_unlock
                                    ? 'is-pending'
                                    : 'is-locked'
                                }`}
                              >
                                {b.unlocked ? (isShame ? 'Shame 🚨' : 'Unlocked') : b.pending_unlock ? 'Pending Close ⏳' : 'Locked 🔒'}
                              </span>
                            </div>
                          </div>
                          {b.tier_label && (
                            <div
                              style={{
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                color: isShame ? 'var(--red)' : b.is_repeatable ? 'var(--amber)' : 'var(--primary)',
                                letterSpacing: '0.04em',
                              }}
                            >
                              {b.tier_label}
                            </div>
                          )}
                          <div
                            className={`recap-badge-title ${isShame && b.unlocked ? 'is-shame-unlocked' : ''}`}
                            style={{ fontWeight: 800, fontSize: '0.82rem' }}
                          >
                            {b.title}
                          </div>
                          <div
                            className={`recap-badge-sub ${
                              b.unlocked ? (isShame ? 'is-shame-unlocked' : 'is-unlocked') : ''
                            }`}
                            style={{ fontSize: '0.69rem', color: b.unlocked ? undefined : 'var(--text-muted)', lineHeight: 1.3 }}
                          >
                            {b.unlocked ? b.subtitle : b.criteria}
                          </div>
                          {!b.is_repeatable && b.progress_text && (
                            <div style={{ marginTop: 'auto', paddingTop: '0.2rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.63rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                <span>Progress</span>
                                <strong>{b.progress_text}</strong>
                              </div>
                              <div style={{ height: '4px', background: 'rgba(148, 163, 184, 0.25)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${pct}%`,
                                    height: '100%',
                                    background: b.unlocked ? '#10b981' : '#6366f1',
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SLIDE 8: Spotify Wrapped Summary Poster */}
              {slideIndex === 8 && (
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
        </div>

        {/* Bottom Story Navigation (Prev / Next Buttons & Touch zones) */}
        <div className="month-recap-bottom-nav">
          <button
            onClick={handlePrev}
            disabled={slideIndex === 0}
            className="month-recap-nav-btn"
          >
            <ChevronLeft size={16} />
            Back
          </button>

          <span className="month-recap-nav-counter">
            {slideIndex + 1} of {totalSlides}
          </span>

          <button
            onClick={handleNext}
            className="month-recap-nav-btn is-next"
          >
            {slideIndex === totalSlides - 1 ? 'Finish' : 'Next'}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <GetBackOnTrackModal
        isOpen={showBackOnTrack}
        onClose={() => setShowBackOnTrack(false)}
        onReviewCategories={() => {
          setShowBackOnTrack(false);
          onClose();
          setTimeout(() => {
            document.querySelector('.category-budgets-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }}
      />
    </div>
  );
}


export function BadgeShowroomModal({ isOpen, onClose, selectedMonth }) {
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState(null);
  const [filter, setFilter] = useState('all');
  const [familyFilter, setFamilyFilter] = useState('all');
  const [showBackOnTrack, setShowBackOnTrack] = useState(false);

  useEffect(() => {
    if (!isOpen || !selectedMonth) return;
    setLoading(true);
    apiFetch(`/api/finance/month-recap?month=${selectedMonth}`)
      .then((res) => setRecap(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, selectedMonth]);

  if (!isOpen) return null;

  const badges = recap?.badge_showroom || [];
  const families = ['all', ...Array.from(new Set(badges.map((b) => b.family).filter(Boolean)))];
  const shameCount = badges.filter((b) => b.is_shame).length;
  const visible = badges.filter((b) => {
    if (filter === 'unlocked' && !b.unlocked) return false;
    if (filter === 'locked' && b.unlocked) return false;
    if (filter === 'records' && (!b.is_repeatable || b.is_shame)) return false;
    if (filter === 'shame' && !b.is_shame) return false;
    if (familyFilter !== 'all' && b.family !== familyFilter) return false;
    return true;
  });

  const unlockedCount = badges.filter((b) => b.unlocked && !b.is_shame).length;

  return (
    <div className="finance-modal-backdrop" onClick={onClose} style={{ zIndex: 1080 }}>
      <div
        className="finance-modal-card finance-modal-lg"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '760px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="finance-modal-header">
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', margin: 0 }}>
              <Award size={20} color="#fbbf24" />
              Household Badge Showroom & Trophy Case
            </h3>
            <p className="text-muted" style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem' }}>
              {unlockedCount} of {badges.length} badges unlocked • Includes multi-month endurance streaks, tiered challenges & repeatable record-breakers
            </p>
          </div>
          <button type="button" className="btn-icon-subtle" onClick={onClose} aria-label="Close badge showroom">
            <X size={20} />
          </button>
        </div>

        <div className="finance-modal-body" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: `All (${badges.length})` },
                { id: 'unlocked', label: `Unlocked (${unlockedCount})` },
                { id: 'locked', label: `Locked (${badges.length - badges.filter((b) => b.unlocked).length})` },
                { id: 'records', label: `Record Breakers (${badges.filter((b) => b.is_repeatable && !b.is_shame).length})` },
                ...(shameCount > 0 ? [{ id: 'shame', label: `🚨 Wall of Shame (${shameCount})` }] : []),
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`btn btn-sm ${filter === t.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={
                    t.id === 'shame'
                      ? {
                          borderColor: 'rgba(239, 68, 68, 0.55)',
                          background: filter === 'shame' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.1)',
                          color: 'var(--red)',
                        }
                      : undefined
                  }
                  onClick={() => setFilter(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <select
              className="input input-sm"
              style={{ width: 'auto', minWidth: '170px' }}
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value)}
            >
              {families.map((f) => (
                <option key={f} value={f}>
                  {f === 'all' ? 'All Badge Categories' : f}
                </option>
              ))}
            </select>
          </div>

          {(filter === 'shame' || badges.some((b) => b.is_shame && b.unlocked)) && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={() => setShowBackOnTrack(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0.2rem 0',
                  color: 'var(--red)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  textUnderlineOffset: '3px',
                  cursor: 'pointer',
                }}
              >
                What to actually do to get back on track.
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading Household Badge Showroom...
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.65rem' }}>
              {visible.map((b) => {
                const isShame = Boolean(b.is_shame);
                const pct =
                  !b.is_repeatable && Number(b.progress_target) > 0
                    ? Math.min(100, Math.round((Number(b.progress_current || 0) / Number(b.progress_target)) * 100))
                    : b.unlocked
                    ? 100
                    : 0;
                return (
                  <div
                    key={b.id}
                    style={{
                      background: b.unlocked
                        ? isShame
                          ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(127, 29, 29, 0.22) 100%)'
                          : b.is_repeatable
                          ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(236, 72, 153, 0.12) 100%)'
                          : 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(16, 185, 129, 0.12) 100%)'
                        : isShame
                        ? 'rgba(239, 68, 68, 0.04)'
                        : 'var(--bg-panel)',
                      border: b.unlocked
                        ? isShame
                          ? '1px solid rgba(239, 68, 68, 0.6)'
                          : b.is_repeatable
                          ? '1px solid rgba(245, 158, 11, 0.5)'
                          : '1px solid rgba(16, 185, 129, 0.45)'
                        : isShame
                        ? '1px dashed rgba(239, 68, 68, 0.35)'
                        : '1px dashed var(--border)',
                      borderRadius: '12px',
                      padding: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.3rem',
                      opacity: b.unlocked ? 1 : 0.72,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.3rem' }}>
                      <span style={{ fontSize: '1.45rem', filter: b.unlocked ? 'none' : 'grayscale(100%)' }}>
                        {b.emoji || '🏆'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        {b.is_repeatable && b.times_earned > 0 && (
                          <span
                            className={`pill ${isShame ? 'pill-red' : 'pill-amber'}`}
                            style={{ fontSize: '0.66rem', fontWeight: 800 }}
                          >
                            {isShame ? `Triggered ×${b.times_earned}` : `Earned ×${b.times_earned}`}
                          </span>
                        )}
                        <span
                          className={`pill ${b.unlocked ? (isShame ? 'pill-red' : 'pill-green') : 'pill-outline'}`}
                          style={{ fontSize: '0.65rem' }}
                        >
                          {b.unlocked ? (isShame ? 'Shame 🚨' : 'Unlocked') : 'Locked 🔒'}
                        </span>
                      </div>
                    </div>
                    {b.tier_label && (
                      <div
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: isShame ? '#ef4444' : b.is_repeatable ? '#f59e0b' : '#818cf8',
                        }}
                      >
                        {b.family} • {b.tier_label}
                      </div>
                    )}
                    <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>{b.title}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                      {b.criteria}
                    </div>
                    {b.unlocked && b.subtitle && (
                      <div style={{ fontSize: '0.72rem', color: isShame ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                        {b.subtitle}
                      </div>
                    )}
                    {!b.is_repeatable && b.progress_text && (
                      <div style={{ marginTop: 'auto', paddingTop: '0.3rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
                          <span>Threshold</span>
                          <strong>{b.progress_text}</strong>
                        </div>
                        <div style={{ height: '5px', background: 'rgba(148, 163, 184, 0.2)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: b.unlocked ? '#10b981' : '#6366f1',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <GetBackOnTrackModal
        isOpen={showBackOnTrack}
        onClose={() => setShowBackOnTrack(false)}
        onReviewCategories={() => {
          setShowBackOnTrack(false);
          onClose();
          setTimeout(() => {
            document.querySelector('.category-budgets-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }}
      />
    </div>
  );
}
