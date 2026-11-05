import React, { useState } from 'react';
import {
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import { apiFetch, authenticateWithPasskey, registerPasskeyForPartner } from '../api';

export default function PasskeyLockScreen({
  isLocked,
  onUnlock,
  partners,
  activePartner,
  onSelectPartner,
  onRefreshPartners,
  showManageModal,
  onCloseManageModal,
}) {
  const [selectedPartnerId, setSelectedPartnerId] = useState(activePartner?.id || 1);
  const [deviceName, setDeviceName] = useState('Windows Hello / Biometric Passkey');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const currentPartner =
    partners.find((p) => p.id === Number(selectedPartnerId)) || partners[0] || { id: 1, name: 'Partner' };

  const handleUnlockWithPasskey = async (partnerId) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authenticateWithPasskey(partnerId);
      if (res.unlocked) {
        onSelectPartner(res.partner);
        onUnlock();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterPasskey = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await registerPasskeyForPartner(Number(selectedPartnerId), deviceName);
      setMessage(`Passkey "${res.device_name}" registered for ${res.partner.name}!`);
      await onRefreshPartners();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCredential = async (credId) => {
    setBusy(true);
    try {
      await apiFetch(`/api/auth/webauthn/credentials/${credId}`, { method: 'DELETE' });
      await onRefreshPartners();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isLocked && !showManageModal) {
    return null;
  }

  return (
    <div className="lock-overlay">
      <div className="lock-card">
        <div className="lock-badge">
          <Fingerprint size={28} />
        </div>

        <h2>{isLocked ? 'GibsonFamily Screen Lock' : 'WebAuthn Passkey Security'}</h2>
        <p className="lock-subtitle">
          {isLocked
            ? 'Unlock instantly with your device Passkey (Windows Hello, Touch ID, Face ID, or Security Key) — no 2FA codes required.'
            : 'Manage passwordless WebAuthn Passkeys for each partner so either of you can lock and unlock the app in one tap.'}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <div className="partner-lock-grid">
          {partners.map((p) => {
            const hasPasskey = p.passkeys && p.passkeys.length > 0;
            const isSelected = Number(selectedPartnerId) === p.id;
            return (
              <div
                key={p.id}
                className={`partner-lock-tile ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedPartnerId(p.id);
                  setError(null);
                }}
              >
                <div className="partner-avatar" style={{ background: p.avatar_color }}>
                  {p.name.charAt(0)}
                </div>
                <div className="partner-lock-info">
                  <strong>{p.name}</strong>
                  <span>
                    {hasPasskey
                      ? `${p.passkeys.length} Passkey${p.passkeys.length > 1 ? 's' : ''} Active`
                      : 'No Passkey enrolled yet'}
                  </span>
                </div>
                {hasPasskey ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnlockWithPasskey(p.id);
                    }}
                  >
                    <Unlock size={15} />
                    {isLocked ? 'Unlock with Passkey' : 'Test Passkey'}
                  </button>
                ) : (
                  <span className="pill pill-amber">Setup below</span>
                )}
              </div>
            );
          })}
        </div>

        <form className="passkey-register-box" onSubmit={handleRegisterPasskey}>
          <div className="passkey-register-header">
            <KeyRound size={18} />
            <span>Register a New Passkey for {currentPartner.name}</span>
          </div>
          <div className="passkey-register-row">
            <input
              type="text"
              className="input"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g., Alex Laptop Windows Hello or Jordan iPhone"
            />
            <button type="submit" className="btn btn-accent" disabled={busy}>
              <Fingerprint size={16} />
              {busy ? 'Waiting for Passkey...' : 'Create Passkey'}
            </button>
          </div>
        </form>

        {currentPartner.passkeys && currentPartner.passkeys.length > 0 && (
          <div className="enrolled-passkeys-list">
            <h4>Enrolled Passkeys for {currentPartner.name}</h4>
            {currentPartner.passkeys.map((cred) => (
              <div key={cred.id} className="enrolled-passkey-item">
                <div className="enrolled-passkey-meta">
                  <Smartphone size={16} />
                  <div>
                    <strong>{cred.device_name}</strong>
                    <small>
                      ID: {cred.credential_id.slice(0, 14)}... • Last used:{' '}
                      {cred.last_used_at ? cred.last_used_at.slice(0, 16) : 'Just enrolled'}
                    </small>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-icon-danger"
                  onClick={() => handleDeleteCredential(cred.id)}
                  title="Remove Passkey"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="lock-footer-actions">
          {!isLocked && (
            <button type="button" className="btn btn-secondary" onClick={onCloseManageModal}>
              Done
            </button>
          )}
          {isLocked && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                onUnlock();
              }}
              title="Quick unlock when setting up for the first time"
            >
              <ShieldCheck size={15} />
              Continue as {currentPartner.name} (Dev / Initial Setup Bypass)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

