import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Fingerprint,
  Layers,
  Link2,
  PieChart,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch, registerPasskeyForPartner, setAuthToken } from '../api';

const SANDBOX_BANKS = [
  { id: 'ins_109508', name: 'First Platypus Bank (Plaid Sandbox)' },
  { id: 'ins_109509', name: 'First Gingham Credit Union (Plaid Sandbox)' },
  { id: 'ins_109510', name: 'Tartan Bank (Plaid Sandbox)' },
  { id: 'ins_109511', name: 'Houndstooth Bank (Plaid Sandbox)' },
];

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Step 1: Household & Partners
  const [householdName, setHouseholdName] = useState('');
  const [p1Name, setP1Name] = useState('');
  const [p1Email, setP1Email] = useState('');
  const [p1Password, setP1Password] = useState('');
  const [p1Color, setP1Color] = useState('#6366f1');
  const [p1Allowance, setP1Allowance] = useState('');

  const [p2Name, setP2Name] = useState('');
  const [p2Email, setP2Email] = useState('');
  const [p2Password, setP2Password] = useState('');
  const [p2Color, setP2Color] = useState('#ec4899');
  const [p2Allowance, setP2Allowance] = useState('');

  const [createdPartners, setCreatedPartners] = useState([]);

  // Step 2: WebAuthn Passkeys
  const [selectedPasskeyPartnerId, setSelectedPasskeyPartnerId] = useState(null);
  const [deviceName, setDeviceName] = useState('Primary Device Passkey');

  // Step 3: Plaid & Bank Accounts
  const [plaidStatus, setPlaidStatus] = useState(null);
  const [selectedSandboxBank, setSelectedSandboxBank] = useState(SANDBOX_BANKS[0].id);
  const [linkedAccounts, setLinkedAccounts] = useState([]);
  const [manualAccName, setManualAccName] = useState('');
  const [manualAccType, setManualAccType] = useState('depository');
  const [manualAccBalance, setManualAccBalance] = useState('');
  const [manualAccInstitution, setManualAccInstitution] = useState('');

  // Step 4: Initial Budgets & Modules
  const [budgets, setBudgets] = useState([]);
  const [newBudgetCat, setNewBudgetCat] = useState('');
  const [newBudgetLimit, setNewBudgetLimit] = useState('');
  const [modules, setModules] = useState([]);
  const [enabledModules, setEnabledModules] = useState({});

  useEffect(() => {
    // Load Plaid status and available modules
    Promise.all([
      apiFetch('/api/finance/plaid/status').catch(() => null),
      apiFetch('/api/modules').catch(() => ({ modules: [] })),
    ]).then(([pStat, mData]) => {
      if (pStat) setPlaidStatus(pStat);
      if (mData?.modules) {
        setModules(mData.modules);
        const map = {};
        mData.modules.forEach((m) => {
          map[m.id] = Boolean(m.enabled);
        });
        setEnabledModules(map);
      }
    });
  }, []);

  // Step 1 Handler
  const handleSavePartners = async (e) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    if (!p1Name.trim() || !p2Name.trim()) {
      setError('Please enter both your name and your partner’s name so you can submit requests to each other.');
      return;
    }
    if (!createdPartners[0]?.id && p1Password.length < 8) {
      setError('Your password must be at least 8 characters.');
      return;
    }
    if (!createdPartners[1]?.id && p2Password.length < 8) {
      setError('Your partner’s password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch('/api/auth/partners', {
        method: 'POST',
        body: JSON.stringify({
          household_name: householdName.trim() || 'Our Household',
          partners: [
            {
              id: createdPartners[0]?.id,
              name: p1Name.trim(),
              email: p1Email.trim(),
              password: p1Password,
              role: 'Partner 1',
              avatar_color: p1Color,
              monthly_fun_allowance: parseFloat(p1Allowance || 0),
            },
            {
              id: createdPartners[1]?.id,
              name: p2Name.trim(),
              email: p2Email.trim(),
              password: p2Password,
              role: 'Partner 2',
              avatar_color: p2Color,
              monthly_fun_allowance: parseFloat(p2Allowance || 0),
            },
          ],
        }),
      });
      if (res.token) {
        setAuthToken(res.token);
      }
      setCreatedPartners(res.partners || []);
      if (res.partners?.length) {
        setSelectedPasskeyPartnerId(res.partners[0].id);
      }

      // Now that we are authenticated, load Plaid status & modules
      const [pStat, mData] = await Promise.all([
        apiFetch('/api/finance/plaid/status').catch(() => null),
        apiFetch('/api/modules').catch(() => ({ modules: [] })),
      ]);
      if (pStat) setPlaidStatus(pStat);
      if (mData?.modules) {
        setModules(mData.modules);
        const map = {};
        mData.modules.forEach((m) => {
          map[m.id] = Boolean(m.enabled);
        });
        setEnabledModules(map);
      }

      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 2 Handler: Register WebAuthn Passkey
  const handleRegisterPasskey = async (e) => {
    e.preventDefault();
    if (!selectedPasskeyPartnerId) return;
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await registerPasskeyForPartner(Number(selectedPasskeyPartnerId), deviceName);
      setStatusMsg(`Passkey "${res.device_name}" enrolled for ${res.partner.name}!`);
      const refreshed = await apiFetch('/api/auth/partners');
      setCreatedPartners(refreshed.partners || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 3 Handlers: Plaid Link & Sandbox Quick Connect & Manual Account
  const refreshAccounts = async () => {
    const sum = await apiFetch('/api/finance/summary');
    setLinkedAccounts(sum.accounts || []);
    const pStat = await apiFetch('/api/finance/plaid/status');
    setPlaidStatus(pStat);
  };

  const handlePlaidLinkModal = async () => {
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      const tokenData = await apiFetch('/api/finance/plaid/create_link_token', {
        method: 'POST',
        body: JSON.stringify({ partner_id: createdPartners[0]?.id || 1 }),
      });

      if (window.Plaid && tokenData.link_token) {
        localStorage.setItem('gibson_plaid_link_token', tokenData.link_token);
        const handler = window.Plaid.create({
          token: tokenData.link_token,
          onSuccess: async (public_token, metadata) => {
            localStorage.removeItem('gibson_plaid_link_token');
            const instName = metadata?.institution?.name || 'Plaid Linked Bank';
            const exRes = await apiFetch('/api/finance/plaid/exchange_public_token', {
              method: 'POST',
              body: JSON.stringify({
                public_token,
                institution_name: instName,
                partner_id: createdPartners[0]?.id || 1,
              }),
            });
            setStatusMsg(
              `Linked ${exRes.institution_name}! Imported ${exRes.imported_accounts} accounts and ${exRes.imported_transactions} transactions.`
            );
            await refreshAccounts();
            setBusy(false);
          },
          onExit: () => {
            setBusy(false);
          },
        });
        handler.open();
      } else {
        setError('Plaid Link script is still loading or blocked by browser extension. Use the Plaid Sandbox Connect option below.');
        setBusy(false);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handlePlaidSandboxConnect = async () => {
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      const bankObj =
        SANDBOX_BANKS.find((b) => b.id === selectedSandboxBank) || SANDBOX_BANKS[0];
      const res = await apiFetch('/api/finance/plaid/sandbox_quick_connect', {
        method: 'POST',
        body: JSON.stringify({
          partner_id: createdPartners[0]?.id || 1,
          institution_id: bankObj.id,
          institution_name: bankObj.name,
        }),
      });
      setStatusMsg(
        `Connected ${res.institution_name}! Imported ${res.imported_accounts} accounts and ${res.imported_transactions} transactions.`
      );
      await refreshAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddManualAccount = async (e) => {
    e.preventDefault();
    if (!manualAccName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/finance/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: manualAccName.trim(),
          type: manualAccType,
          subtype: manualAccType === 'credit' ? 'credit card' : 'checking',
          balance_current: parseFloat(manualAccBalance || 0),
          institution_name: manualAccInstitution.trim() || 'Manual Account',
        }),
      });
      setManualAccName('');
      setManualAccBalance('');
      setManualAccInstitution('');
      await refreshAccounts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 4 Handlers: Budgets & Finish
  const handleAddBudgetRow = (e) => {
    e.preventDefault();
    if (!newBudgetCat.trim() || !newBudgetLimit) return;
    setBudgets((prev) => [
      ...prev.filter((b) => b.category.toLowerCase() !== newBudgetCat.trim().toLowerCase()),
      {
        category: newBudgetCat.trim(),
        monthly_limit: parseFloat(newBudgetLimit),
        color: '#6366f1',
      },
    ]);
    setNewBudgetCat('');
    setNewBudgetLimit('');
  };

  const handleRemoveBudgetRow = (cat) => {
    setBudgets((prev) => prev.filter((b) => b.category !== cat));
  };

  const handleFinishOnboarding = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/onboarding/complete', {
        method: 'POST',
        body: JSON.stringify({
          household_name: householdName.trim() || 'Our Household',
          budgets,
          enabled_modules: enabledModules,
        }),
      });
      onComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-shell">
      <div className="onboarding-container">
        <div className="onboarding-header">
          <div className="brand-logo">GF</div>
          <div>
            <h1>Welcome to GibsonFamily Hub</h1>
            <p className="text-muted">
              Let's set up your couple profiles, WebAuthn Passkey lock, Plaid bank accounts, and modules.
            </p>
          </div>
        </div>

        {/* Stepper Progress Indicator */}
        <div className="onboarding-steps-bar">
          {[
            { num: 1, label: '1. Couple Profiles', icon: Users },
            { num: 2, label: '2. Passkey Security', icon: Fingerprint },
            { num: 3, label: '3. Link Bank (Plaid)', icon: Building2 },
            { num: 4, label: '4. Budgets & Modules', icon: Layers },
          ].map((s) => {
            const IconComp = s.icon;
            const active = step === s.num;
            const done = step > s.num;
            return (
              <div
                key={s.num}
                className={`onboarding-step-pill ${active ? 'active' : ''} ${done ? 'done' : ''}`}
              >
                <IconComp size={16} />
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {statusMsg && <div className="alert alert-success">{statusMsg}</div>}

        {/* STEP 1: Couple Profiles */}
        {step === 1 && (
          <form className="card onboarding-card" onSubmit={handleSavePartners}>
            <h2>Step 1: Set Up Your Profiles</h2>
            <p className="text-muted">
              Create profiles for yourself and your partner so you can submit financial requests to each other, approve or build savings timelines, and share tasks.
            </p>

            <div className="form-group">
              <label>Household / Family Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g., The Gibson Family"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
              />
            </div>

            <div className="onboarding-partners-split">
              <div className="partner-setup-box">
                <h3>Your Profile (Partner 1)</h3>
                <div className="form-group">
                  <label>Your Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Alex Gibson"
                    value={p1Name}
                    onChange={(e) => setP1Name(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Login Email *</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="alex@example.com"
                    value={p1Email}
                    onChange={(e) => setP1Email(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Password (min 8 characters) *</label>
                  <input
                    type="password"
                    minLength={8}
                    className="input"
                    placeholder="Create your login password"
                    value={p1Password}
                    onChange={(e) => setP1Password(e.target.value)}
                    required={!createdPartners[0]?.id}
                  />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Monthly Personal Allowance ($)</label>
                    <input
                      type="number"
                      step="10"
                      className="input"
                      placeholder="Optional, e.g., 250"
                      value={p1Allowance}
                      onChange={(e) => setP1Allowance(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Profile Badge Color</label>
                    <input
                      type="color"
                      className="input color-input"
                      value={p1Color}
                      onChange={(e) => setP1Color(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="partner-setup-box">
                <h3>Your Partner's Profile (Partner 2)</h3>
                <div className="form-group">
                  <label>Partner's Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Jordan Gibson"
                    value={p2Name}
                    onChange={(e) => setP2Name(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Partner's Login Email *</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="jordan@example.com"
                    value={p2Email}
                    onChange={(e) => setP2Email(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Partner's Password (min 8 characters) *</label>
                  <input
                    type="password"
                    minLength={8}
                    className="input"
                    placeholder="Create partner login password"
                    value={p2Password}
                    onChange={(e) => setP2Password(e.target.value)}
                    required={!createdPartners[1]?.id}
                  />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Monthly Personal Allowance ($)</label>
                    <input
                      type="number"
                      step="10"
                      className="input"
                      placeholder="Optional, e.g., 250"
                      value={p2Allowance}
                      onChange={(e) => setP2Allowance(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Profile Badge Color</label>
                    <input
                      type="color"
                      className="input color-input"
                      value={p2Color}
                      onChange={(e) => setP2Color(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="onboarding-footer">
              <div />
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving Profiles...' : 'Save Profiles & Continue'}
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: WebAuthn Passkey Setup */}
        {step === 2 && (
          <div className="card onboarding-card">
            <h2>Step 2: Set Up WebAuthn Passkey Screen Lock</h2>
            <p className="text-muted">
              Enroll a Passkey using your device's built-in authenticator (Windows Hello, Touch ID, Face ID, or Security Key) so you and your partner can lock and unlock the screen without 2FA codes.
            </p>

            <div className="partner-lock-grid">
              {createdPartners.map((p) => {
                const enrolledCount = p.passkeys?.length || 0;
                const isSelected = Number(selectedPasskeyPartnerId) === p.id;
                return (
                  <div
                    key={p.id}
                    className={`partner-lock-tile ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedPasskeyPartnerId(p.id)}
                  >
                    <div className="partner-avatar" style={{ background: p.avatar_color }}>
                      {p.name.charAt(0)}
                    </div>
                    <div className="partner-lock-info">
                      <strong>{p.name}</strong>
                      <span>
                        {enrolledCount > 0
                          ? `${enrolledCount} Passkey(s) Registered`
                          : 'Click to select and register a passkey'}
                      </span>
                    </div>
                    {enrolledCount > 0 ? (
                      <span className="pill pill-green">
                        <CheckCircle2 size={13} /> Passkey Ready
                      </span>
                    ) : (
                      <span className="pill pill-amber">Not Enrolled Yet</span>
                    )}
                  </div>
                );
              })}
            </div>

            <form className="passkey-register-box" onSubmit={handleRegisterPasskey}>
              <div className="passkey-register-header">
                <Fingerprint size={18} />
                <span>
                  Register Passkey for{' '}
                  {createdPartners.find((p) => p.id === Number(selectedPasskeyPartnerId))?.name ||
                    'Selected Partner'}
                </span>
              </div>
              <div className="passkey-register-row">
                <input
                  type="text"
                  className="input"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g., Windows Hello / MacBook Touch ID"
                />
                <button type="submit" className="btn btn-accent" disabled={busy}>
                  <Fingerprint size={16} />
                  {busy ? 'Creating Passkey...' : 'Enroll Passkey Now'}
                </button>
              </div>
            </form>

            <div className="onboarding-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setError(null);
                  setStatusMsg(null);
                  setStep(1);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setError(null);
                  setStatusMsg(null);
                  setStep(3);
                }}
              >
                Continue to Bank Setup
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Link Bank Accounts via Plaid */}
        {step === 3 && (
          <div className="card onboarding-card">
            <h2>Step 3: Connect Your Bank Accounts</h2>
            <p className="text-muted">
              Link your real bank accounts securely via Plaid Link ({plaidStatus?.environment || 'production'} mode), or add manual checking/savings accounts.
            </p>

            <div className="card plaid-connect-banner">
              <div className="plaid-info-left">
                <div className="plaid-icon-circle">
                  <Building2 size={22} />
                </div>
                <div>
                  <div className="request-badges">
                    <strong>Plaid API ({plaidStatus?.environment?.toUpperCase() || 'PRODUCTION'})</strong>
                    {plaidStatus?.configured ? (
                      <span className="pill pill-green">
                        <CheckCircle2 size={12} /> Credentials Loaded ({plaidStatus.environment})
                      </span>
                    ) : (
                      <span className="pill pill-amber">Missing Plaid credentials</span>
                    )}
                  </div>
                  <p className="text-muted">
                    Client ID: <code>{plaidStatus?.client_id_preview || 'Not detected'}</code>
                  </p>
                </div>
              </div>
              <div className="plaid-actions-right">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !plaidStatus?.configured}
                  onClick={handlePlaidLinkModal}
                >
                  <Link2 size={16} /> Connect Bank with Plaid Link
                </button>
              </div>
            </div>

            <div className="onboarding-partners-split">
              {plaidStatus?.environment === 'sandbox' ? (
                <div className="partner-setup-box">
                  <h3>Sandbox Quick-Connect</h3>
                  <p className="text-muted">
                    Provision a Plaid Sandbox token for a test institution.
                  </p>
                  <div className="form-group">
                    <label>Select Plaid Sandbox Institution</label>
                    <select
                      className="input"
                      value={selectedSandboxBank}
                      onChange={(e) => setSelectedSandboxBank(e.target.value)}
                    >
                      {SANDBOX_BANKS.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-accent"
                    disabled={busy || !plaidStatus?.configured}
                    onClick={handlePlaidSandboxConnect}
                  >
                    <RefreshCw size={15} className={busy ? 'spin' : ''} />
                    {busy ? 'Connecting to Plaid...' : 'Connect Selected Sandbox Bank'}
                  </button>
                </div>
              ) : (
                <div className="partner-setup-box">
                  <h3>Connect Your Real Bank via Plaid</h3>
                  <p className="text-muted">
                    Your app is configured in <strong>Plaid Production</strong> mode. Click below to open Plaid Link, select your financial institution, and securely sync your checking, savings, and credit card accounts.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !plaidStatus?.configured}
                    onClick={handlePlaidLinkModal}
                  >
                    <Link2 size={16} />
                    {busy ? 'Opening Plaid Link...' : 'Launch Plaid Link'}
                  </button>
                </div>
              )}

              <form className="partner-setup-box" onSubmit={handleAddManualAccount}>
                <h3>Or Add a Manual Account</h3>
                <div className="form-group">
                  <label>Account Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Joint Family Checking"
                    value={manualAccName}
                    onChange={(e) => setManualAccName(e.target.value)}
                  />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Type</label>
                    <select
                      className="input"
                      value={manualAccType}
                      onChange={(e) => setManualAccType(e.target.value)}
                    >
                      <option value="depository">Checking / Savings</option>
                      <option value="credit">Credit Card</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Current Balance ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      placeholder="3500.00"
                      value={manualAccBalance}
                      onChange={(e) => setManualAccBalance(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Bank / Institution Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Chase, Ally, Local Credit Union"
                    value={manualAccInstitution}
                    onChange={(e) => setManualAccInstitution(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-secondary" disabled={busy}>
                  <Plus size={15} /> Add Manual Account
                </button>
              </form>
            </div>

            {linkedAccounts.length > 0 && (
              <div className="enrolled-passkeys-list">
                <h4>Connected Accounts ({linkedAccounts.length})</h4>
                {linkedAccounts.map((acc) => (
                  <div key={acc.id} className="enrolled-passkey-item">
                    <div className="enrolled-passkey-meta">
                      <Wallet size={16} />
                      <div>
                        <strong>{acc.name}</strong>
                        <small>
                          {acc.institution_name} • {acc.subtype}
                        </small>
                      </div>
                    </div>
                    <strong className="text-green">
                      ${Number(acc.balance_current).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                ))}
              </div>
            )}

            <div className="onboarding-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setError(null);
                  setStatusMsg(null);
                  setStep(2);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setError(null);
                  setStatusMsg(null);
                  setStep(4);
                }}
              >
                Continue to Budgets & Modules
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Initial Monthly Budgets & Module Selection */}
        {step === 4 && (
          <div className="card onboarding-card">
            <h2>Step 4: Set Monthly Budgets & Choose Active Modules</h2>
            <p className="text-muted">
              Add any monthly budget categories you want to track right away, and choose which modules appear in your workspace. (You can edit these anytime.)
            </p>

            <div className="onboarding-partners-split">
              <div className="partner-setup-box">
                <h3>Monthly Budget Categories</h3>
                <form className="passkey-register-row" onSubmit={handleAddBudgetRow}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Category (e.g., Groceries & Dining)"
                    value={newBudgetCat}
                    onChange={(e) => setNewBudgetCat(e.target.value)}
                  />
                  <input
                    type="number"
                    step="10"
                    className="input"
                    style={{ maxWidth: '130px' }}
                    placeholder="Limit ($)"
                    value={newBudgetLimit}
                    onChange={(e) => setNewBudgetLimit(e.target.value)}
                  />
                  <button type="submit" className="btn btn-secondary">
                    <Plus size={15} /> Add
                  </button>
                </form>

                <div className="quick-contribute-row">
                  <span>Quick-add suggestions:</span>
                  {[
                    { cat: 'Groceries & Dining', limit: 800 },
                    { cat: 'Housing & Utilities', limit: 2200 },
                    { cat: 'Entertainment & Gaming', limit: 300 },
                    { cat: 'Shopping & Tech', limit: 400 },
                    { cat: 'Health & Medical', limit: 300 },
                  ].map((s) => (
                    <button
                      key={s.cat}
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setBudgets((prev) => [
                          ...prev.filter((b) => b.category !== s.cat),
                          { category: s.cat, monthly_limit: s.limit, color: '#6366f1' },
                        ]);
                      }}
                    >
                      + {s.cat} (${s.limit})
                    </button>
                  ))}
                </div>

                {budgets.length === 0 ? (
                  <p className="text-muted">
                    No budget categories added yet. Add categories above or configure them later in Finances.
                  </p>
                ) : (
                  <div className="enrolled-passkeys-list">
                    {budgets.map((b) => (
                      <div key={b.category} className="enrolled-passkey-item">
                        <strong>{b.category}</strong>
                        <div className="topbar-right">
                          <span className="text-cyan">${b.monthly_limit}/mo</span>
                          <button
                            type="button"
                            className="btn-icon-danger"
                            onClick={() => handleRemoveBudgetRow(b.category)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="partner-setup-box">
                <h3>Active Workspace Modules</h3>
                <div className="enrolled-passkeys-list">
                  {modules.map((mod) => {
                    const checked = enabledModules[mod.id] !== false;
                    return (
                      <label key={mod.id} className="enrolled-passkey-item module-toggle-row">
                        <div>
                          <strong>{mod.name}</strong>
                          <small className="text-muted" style={{ display: 'block' }}>
                            {mod.description}
                          </small>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setEnabledModules((prev) => ({
                              ...prev,
                              [mod.id]: e.target.checked,
                            }))
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="onboarding-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(3)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={handleFinishOnboarding}
              >
                <Sparkles size={16} />
                {busy ? 'Launching Hub...' : 'Complete Setup & Open GibsonFamily Hub'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

