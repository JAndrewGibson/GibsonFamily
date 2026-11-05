import React, { useState } from 'react';
import {
  Fingerprint,
  KeyRound,
  Lock,
  LogOut,
  Smartphone,
  Trash2,
  Unlock,
} from 'lucide-react';
import { apiFetch, authenticateWithPasskey, registerPasskeyForPartner } from '../api';

export default function PasskeyLockScreen({
  isLocked,
  onUnlock,
  onSignOut,
  activePartner,
  onRefreshPartners,
  showManageModal,
  onCloseManageModal,
}) {
  const [deviceName, setDeviceName] = useState('Device Passkey (Biometric / PIN)');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  if (!isLocked && !showManageModal) {
    return null;
  }

  const currentPartner = activePartner || { id: 1, name: 'Partner', passkeys: [] };
  const hasPasskey = currentPartner.passkeys && currentPartner.passkeys.length > 0;

  const handleUnlockWithPasskey = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authenticateWithPasskey(currentPartner.id);
      if (res.unlocked) {
        onUnlock();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockWithPassword = async (e) => {
    e.preventDefault();
    if (!unlockPassword) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/unlock-password', {
        method: 'POST',
        body: JSON.stringify({ password: unlockPassword }),
      });
      if (res.unlocked) {
        setUnlockPassword('');
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
      const res = await registerPasskeyForPartner(Number(currentPartner.id), deviceName);
      setMessage(`Passkey "${res.device_name}" enrolled for ${res.partner.name}!`);
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

  return (
    <div className="lock-overlay">
      <div className="lock-card">
        <div className="lock-badge">
          {isLocked ? <Lock size={28} /> : <Fingerprint size={28} />}
        </div>

        <h2>{isLocked ? 'Screen Locked' : 'WebAuthn Passkey Security'}</h2>
        <p className="lock-subtitle">
          {isLocked
            ? `Session locked for ${currentPartner.name}. Unlock with your Passkey or account password.`
            : `Manage WebAuthn Passkeys for ${currentPartner.name} to sign in and unlock the screen with one biometric tap.`}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {isLocked ? (
          <>
            <div className="partner-lock-tile selected">
              <div
                className="partner-avatar"
                style={{ background: currentPartner.avatar_color || '#6366f1' }}
              >
                {currentPartner.name.charAt(0)}
              </div>
              <div className="partner-lock-info">
                <strong>{currentPartner.name}</strong>
                <span>{currentPartner.email}</span>
              </div>
              {hasPasskey && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={handleUnlockWithPasskey}
                >
                  <Fingerprint size={15} />
                  Unlock with Passkey
                </button>
              )}
            </div>

            <form className="passkey-register-box" onSubmit={handleUnlockWithPassword}>
              <div className="passkey-register-header">
                <KeyRound size={16} />
                <span>Or Unlock with Password</span>
              </div>
              <div className="passkey-register-row">
                <input
                  type="password"
                  className="input"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button type="submit" className="btn btn-secondary" disabled={busy}>
                  <Unlock size={15} /> Unlock
                </button>
              </div>
            </form>

            <div className="lock-footer-actions">
              <button type="button" className="btn btn-ghost" onClick={onSignOut}>
                <LogOut size={15} /> Sign Out / Switch Partner Account
              </button>
            </div>
          </>
        ) : (
          <>
            <form className="passkey-register-box" onSubmit={handleRegisterPasskey}>
              <div className="passkey-register-header">
                <KeyRound size={18} />
                <span>Enroll a New Passkey for {currentPartner.name}</span>
              </div>
              <div className="passkey-register-row">
                <input
                  type="text"
                  className="input"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g., Windows Hello or iPhone Passkey"
                />
                <button type="submit" className="btn btn-accent" disabled={busy}>
                  <Fingerprint size={16} />
                  {busy ? 'Waiting for Device...' : 'Create Passkey'}
                </button>
              </div>
            </form>

            {hasPasskey && (
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
              <button type="button" className="btn btn-secondary" onClick={onCloseManageModal}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
