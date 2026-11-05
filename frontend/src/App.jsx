import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckSquare,
  FileHeart,
  Fingerprint,
  Handshake,
  LayoutDashboard,
  Layers,
  Lock,
  LogOut,
  Radio,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import { apiFetch, getCookie, setAuthToken, setCookie } from './api';
import OnboardingWizard from './components/OnboardingWizard';
import LoginScreen from './components/LoginScreen';
import NotificationCenter from './components/NotificationCenter';
import PasskeyLockScreen from './components/PasskeyLockScreen';
import RequestsModule from './modules/RequestsModule';
import FuturePurchasesModule from './modules/FuturePurchasesModule';
import FinanceModule from './modules/FinanceModule';
import {
  AdminDocsSubModule,
  GroceriesSubModule,
  ModuleManagerSubModule,
  TodosSubModule,
} from './modules/CouplesHubModule';

const ICON_MAP = {
  wallet: Wallet,
  handshake: Handshake,
  'calendar-clock': CalendarClock,
  'file-heart': FileHeart,
  'check-square': CheckSquare,
  'shopping-cart': ShoppingCart,
};

export default function App() {
  const [loadingInit, setLoadingInit] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [householdName, setHouseholdName] = useState('GibsonFamily');
  const [partners, setPartners] = useState([]);
  const [activePartner, setActivePartner] = useState(null);
  const [modules, setModules] = useState([]);
  const [overview, setOverview] = useState({
    pending_requests: 0,
    planned_requests: 0,
    open_todos: 0,
    unchecked_groceries: 0,
    active_admin_records: 0,
    future_goals: 0,
    unread_notifications: 0,
  });

  const [activeTab, setActiveTabState] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('oauth_state_id=')) {
      return 'finance';
    }
    const fromCookie = getCookie('gibson_active_tab', '');
    if (fromCookie) return fromCookie;
    try {
      const fromStorage = window.localStorage.getItem('gibson_active_tab');
      if (fromStorage) return fromStorage;
    } catch {
      // ignore
    }
    return 'requests';
  });

  const setActiveTab = (tab) => {
    setActiveTabState(tab);
    setCookie('gibson_active_tab', tab, 365);
    try {
      window.localStorage.setItem('gibson_active_tab', tab);
    } catch {
      // ignore
    }
  };

  const [isLocked, setIsLocked] = useState(false);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [syncVersion, setSyncVersion] = useState(1);
  const [livePartnerPulse, setLivePartnerPulse] = useState(false);
  const lastStateVersionRef = useRef(null);

  const loadCoreState = async () => {
    try {
      const setupData = await apiFetch('/api/auth/setup-status');
      const isOnb = Boolean(setupData.onboarding_completed);
      const isAuth = Boolean(setupData.authenticated);
      const isScreenLocked = Boolean(setupData.is_screen_locked);

      setOnboardingCompleted(isOnb);
      setAuthenticated(isAuth);
      setIsLocked(isScreenLocked);

      if (setupData.household_name) {
        setHouseholdName(setupData.household_name);
      }
      const pList = setupData.partners || [];
      setPartners(pList);

      if (setupData.current_partner) {
        const enrichedCurrent =
          pList.find((p) => p.id === setupData.current_partner.id) || setupData.current_partner;
        setActivePartner(enrichedCurrent);
      } else {
        setActivePartner(null);
      }

      if (isAuth && !isScreenLocked) {
        const [mData, oData] = await Promise.all([
          apiFetch('/api/modules'),
          apiFetch('/api/overview'),
        ]);
        setModules(mData.modules || []);
        setOverview(oData);
        if (oData.state_version) {
          lastStateVersionRef.current = oData.state_version;
        }
      }
    } catch (err) {
      console.error('Failed to load initial state:', err);
    } finally {
      setLoadingInit(false);
    }
  };

  useEffect(() => {
    loadCoreState();
  }, []);

  // Real-time reactivity across both partners & open tabs
  useEffect(() => {
    if (!authenticated || isLocked) return undefined;

    const checkPulse = async () => {
      try {
        const pulse = await apiFetch('/api/sync-pulse');
        setOverview(pulse);
        if (
          pulse.state_version &&
          lastStateVersionRef.current !== null &&
          pulse.state_version !== lastStateVersionRef.current
        ) {
          lastStateVersionRef.current = pulse.state_version;
          setSyncVersion((v) => v + 1);
          setLivePartnerPulse(true);
          setTimeout(() => setLivePartnerPulse(false), 2500);
        } else if (pulse.state_version && lastStateVersionRef.current === null) {
          lastStateVersionRef.current = pulse.state_version;
        }
      } catch {
        // ignore transient network error
      }
    };

    const intervalId = setInterval(checkPulse, 3000);
    const onFocus = () => checkPulse();
    window.addEventListener('focus', onFocus);

    let channel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('gibson_sync');
        channel.onmessage = () => {
          checkPulse();
        };
      }
    } catch {
      // ignore
    }

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      if (channel) channel.close();
    };
  }, [authenticated, isLocked]);

  const handleToggleModule = async (modId) => {
    await apiFetch(`/api/modules/${modId}/toggle`, { method: 'PUT' });
    await loadCoreState();
  };

  const handleLockScreen = async () => {
    try {
      await apiFetch('/api/auth/lock', { method: 'POST' });
    } catch {
      // ignore
    }
    setIsLocked(true);
  };

  const handleSignOut = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setAuthenticated(false);
    setIsLocked(false);
    setActivePartner(null);
    await loadCoreState();
  };

  if (loadingInit) {
    return (
      <div className="onboarding-shell">
        <div className="card">Loading GibsonFamily Hub...</div>
      </div>
    );
  }

  // 1. First-Run Setup & Onboarding Flow
  if (!onboardingCompleted || partners.length === 0) {
    return <OnboardingWizard onComplete={loadCoreState} />;
  }

  // 2. Proper Login Gate (Password or WebAuthn Passkey)
  if (!authenticated || !activePartner) {
    return (
      <LoginScreen
        householdName={householdName}
        partners={partners}
        onLoginSuccess={() => loadCoreState()}
      />
    );
  }

  const enabledModules = modules.filter((m) => m.enabled);

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-logo">GF</div>
          <div>
            <h1>{householdName}</h1>
            <span>Couples Finance & Life OS</span>
          </div>
        </div>

        <div className="sidebar-section-label">FINANCIAL & PLANNING</div>
        <nav className="sidebar-nav">
          {enabledModules
            .filter((m) => m.category === 'Financial')
            .map((mod) => {
              const IconComp = ICON_MAP[mod.icon] || LayoutDashboard;
              const badgeCount =
                mod.id === 'requests'
                  ? overview.pending_requests
                  : mod.id === 'future_plans'
                  ? overview.future_goals
                  : null;
              return (
                <button
                  key={mod.id}
                  type="button"
                  className={`nav-item ${activeTab === mod.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(mod.id)}
                >
                  <IconComp size={18} />
                  <span>{mod.name}</span>
                  {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
                </button>
              );
            })}
        </nav>

        <div className="sidebar-section-label">COUPLES ADMIN & LISTS</div>
        <nav className="sidebar-nav">
          {enabledModules
            .filter((m) => m.category !== 'Financial')
            .map((mod) => {
              const IconComp = ICON_MAP[mod.icon] || Layers;
              const badgeCount =
                mod.id === 'todos'
                  ? overview.open_todos
                  : mod.id === 'groceries'
                  ? overview.unchecked_groceries
                  : mod.id === 'admin_docs'
                  ? overview.active_admin_records
                  : null;
              return (
                <button
                  key={mod.id}
                  type="button"
                  className={`nav-item ${activeTab === mod.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(mod.id)}
                >
                  <IconComp size={18} />
                  <span>{mod.name}</span>
                  {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
                </button>
              );
            })}
        </nav>

        <div className="sidebar-section-label">SETTINGS & MODULES</div>
        <nav className="sidebar-nav">
          <button
            type="button"
            className={`nav-item ${activeTab === 'modules_registry' ? 'active' : ''}`}
            onClick={() => setActiveTab('modules_registry')}
          >
            <Layers size={18} />
            <span>Modules & Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="btn btn-lock-full"
            onClick={handleLockScreen}
          >
            <Lock size={16} />
            Lock Screen (Passkey)
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <span className="partner-Perspective-label">Signed In As:</span>
            <div className="signed-in-badge">
              <span
                className="partner-dot"
                style={{ background: activePartner.avatar_color }}
              />
              <strong>{activePartner.name}</strong>
              <span className="text-muted">({activePartner.email})</span>
            </div>
            <span
              className={`live-sync-pill ${livePartnerPulse ? 'pulsing' : ''}`}
              title="Real-time partner sync is active"
            >
              <Radio size={12} />
              {livePartnerPulse ? 'Synced update!' : 'Live Sync'}
            </span>
          </div>

          <div className="topbar-right">
            <NotificationCenter
              onNavigateTab={(tab) => setActiveTab(tab)}
              syncVersion={syncVersion}
            />

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowPasskeyModal(true)}
            >
              <Fingerprint size={16} />
              Passkeys ({activePartner.passkeys?.length || 0})
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleLockScreen}
            >
              <Lock size={15} />
              Lock
            </button>
            <button
              type="button"
              className="btn btn-danger-outline btn-sm"
              onClick={handleSignOut}
              title="Sign out of your account"
            >
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        </header>

        {!isLocked && (
          <main className="content-scroll">
            {activeTab === 'requests' && (
              <RequestsModule
                activePartner={activePartner}
                partners={partners}
                onDataChanged={loadCoreState}
                syncVersion={syncVersion}
              />
            )}
            {activeTab === 'future_plans' && (
              <FuturePurchasesModule
                onDataChanged={loadCoreState}
                syncVersion={syncVersion}
              />
            )}
            {activeTab === 'finance' && (
              <FinanceModule
                activePartner={activePartner}
                onDataChanged={loadCoreState}
                syncVersion={syncVersion}
              />
            )}
            {activeTab === 'admin_docs' && (
              <AdminDocsSubModule
                activePartner={activePartner}
                partners={partners}
                onDataChanged={loadCoreState}
                syncVersion={syncVersion}
              />
            )}
            {activeTab === 'todos' && (
              <TodosSubModule
                activePartner={activePartner}
                partners={partners}
                onDataChanged={loadCoreState}
                syncVersion={syncVersion}
              />
            )}
            {activeTab === 'groceries' && (
              <GroceriesSubModule
                activePartner={activePartner}
                onDataChanged={loadCoreState}
                syncVersion={syncVersion}
              />
            )}
            {activeTab === 'modules_registry' && (
              <ModuleManagerSubModule
                modules={modules}
                partners={partners}
                onToggleModule={handleToggleModule}
                onRefreshState={loadCoreState}
              />
            )}
          </main>
        )}
      </div>

      {/* WebAuthn Passkey Lock Screen & Enrollment Modal */}
      <PasskeyLockScreen
        isLocked={isLocked}
        onUnlock={() => {
          setIsLocked(false);
          loadCoreState();
        }}
        onSignOut={handleSignOut}
        activePartner={activePartner}
        onRefreshPartners={loadCoreState}
        showManageModal={showPasskeyModal}
        onCloseManageModal={() => setShowPasskeyModal(false)}
      />
    </div>
  );
}
