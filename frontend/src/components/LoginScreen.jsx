import React, { useState } from 'react';
import { Fingerprint, KeyRound, Lock, LogIn, ShieldCheck } from 'lucide-react';
import { apiFetch, authenticateWithPasskey, setAuthToken } from '../api';

export default function LoginScreen({ householdName, partners, onLoginSuccess }) {
  const [selectedPartner, setSelectedPartner] = useState(partners[0] || null);
  const [emailInput, setEmailInput] = useState(partners[0]?.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSelectPartner = (p) => {
    setSelectedPartner(p);
    setEmailInput(p.email || p.name);
    setError(null);
  };

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: emailInput.trim(),
          password,
        }),
      });
      if (res.token) {
        setAuthToken(res.token);
      }
      onLoginSuccess(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async (partnerId) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authenticateWithPasskey(partnerId);
      if (res.authenticated) {
        onLoginSuccess(res);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-shell">
      <div className="lock-card" style={{ maxWidth: '480px' }}>
        <div className="lock-badge">
          <Lock size={26} />
        </div>

        <h2>Sign In to {householdName || 'GibsonFamily Hub'}</h2>
        <p className="lock-subtitle">
          Select your account to sign in with your Passkey or password.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        {partners.length > 0 && (
          <div className="partner-lock-grid">
            {partners.map((p) => {
              const isSelected = selectedPartner?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`partner-lock-tile ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectPartner(p)}
                >
                  <div className="partner-avatar" style={{ background: p.avatar_color }}>
                    {p.name.charAt(0)}
                  </div>
                  <div className="partner-lock-info">
                    <strong>{p.name}</strong>
                    <span>{p.email}</span>
                  </div>
                  {p.has_passkey && (
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasskeyLogin(p.id);
                      }}
                    >
                      <Fingerprint size={15} />
                      Passkey Sign In
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <form className="passkey-register-box" onSubmit={handlePasswordLogin}>
          <div className="form-group">
            <label>Email or Name</label>
            <input
              type="text"
              className="input"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '0.35rem' }}
            disabled={busy}
          >
            <LogIn size={16} />
            {busy ? 'Signing In...' : `Sign In${selectedPartner ? ` as ${selectedPartner.name.split(' ')[0]}` : ''}`}
          </button>
        </form>
      </div>
    </div>
  );
}

