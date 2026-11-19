import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckSquare,
  FileHeart,
  Fingerprint,
  Gamepad2,
  Gem,
  Handshake,
  Home,
  LayoutDashboard,
  Layers,
  Lock,
  LogOut,
  Menu,
  PiggyBank,
  Radio,
  RefreshCw,
  Settings,
  ShoppingCart,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, getCookie, setAuthToken, setCookie } from './api';
import ErrorBoundary from './components/ErrorBoundary';
import OnboardingWizard from './components/OnboardingWizard';
import LoginScreen from './components/LoginScreen';
import NotificationCenter, { MobilePushPromptBanner } from './components/NotificationCenter';
import PasskeyLockScreen from './components/PasskeyLockScreen';
import RequestsModule from './modules/RequestsModule';
import FuturePurchasesModule from './modules/FuturePurchasesModule';
import FinanceModule from './modules/FinanceModule';
import SavingsModule from './modules/SavingsModule';
import DashboardModule from './modules/DashboardModule';
import SplendorModule from './modules/SplendorModule';
import {
  AdminDocsSubModule,
  GroceriesSubModule,
  ModuleManagerSubModule,
  TodosSubModule,
} from './modules/CouplesHubModule';

const ICON_MAP = {
  'layout-dashboard': LayoutDashboard,
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  handshake: Handshake,
  'calendar-clock': CalendarClock,
  'file-heart': FileHeart,
  'check-square': CheckSquare,
  'shopping-cart': ShoppingCart,
  'gamepad-2': Gamepad2,
  gem: Gem,
};

function formatFamilyBrand(rawName) {
  const clean = (rawName || '').trim();
  if (!clean || clean.toLowerCase() === 'our household') return 'Our Family';
  if (/(family|household)$/i.test(clean)) return clean;
  return `${clean} Family`;
}

export default function App() {
  const [loadingInit, setLoadingInit] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [householdName, setHouseholdName] = useState('Our Household');
  const [startingBudgetMonth, setStartingBudgetMonth] = useState(() =>
    new Date().toISOString().slice(0, 7)
  );
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
    if (typeof window !== 'undefined') {
      if (window.location.search.includes('oauth_state_id=')) {
        return 'finance';
      }
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam) {
        const normalized = tabParam === 'splendor' ? 'games' : tabParam;
        urlParams.delete('tab');
        const nextSearch = urlParams.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', nextUrl);
        return normalized;
      }
    }
    const fromCookie = getCookie('gibson_active_tab', '');
    if (fromCookie) return fromCookie === 'splendor' ? 'games' : fromCookie;
    try {
      const fromStorage = window.localStorage.getItem('gibson_active_tab');
      if (fromStorage) return fromStorage === 'splendor' ? 'games' : fromStorage;
    } catch {
      // ignore
    }
    return 'dashboard';
  });

  const setActiveTab = (tab) => {
    const normalized = tab === 'splendor' ? 'games' : tab;
    setActiveTabState(normalized);
    setCookie('gibson_active_tab', normalized, 365);
    try {
      window.localStorage.setItem('gibson_active_tab', normalized);
    } catch {
      // ignore
    }
  };

  const [isLocked, setIsLocked] = useState(false);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [syncVersion, setSyncVersion] = useState(1);
  const [topbarSyncing, setTopbarSyncing] = useState(false);
  const [topbarSyncNote, setTopbarSyncNote] = useState(null);

  const [theme, setThemeState] = useState(() => {
    const saved = getCookie('gibson_theme', '');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    try {
      const local = window.localStorage.getItem('gibson_theme');
      if (local === 'light' || local === 'dark' || local === 'system') return local;
    } catch {
      // ignore
    }
    return 'system';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const mediaQuery =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const applyResolvedTheme = () => {
      const resolved =
        theme === 'system'
          ? mediaQuery && mediaQuery.matches
            ? 'dark'
            : 'light'
          : theme;
      document.documentElement.setAttribute('data-theme', resolved);
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute('content', resolved === 'light' ? '#f8fafc' : '#0b0f19');
      }
    };

    applyResolvedTheme();
    if (theme === 'system' && mediaQuery) {
      mediaQuery.addEventListener('change', applyResolvedTheme);
      return () => mediaQuery.removeEventListener('change', applyResolvedTheme);
    }
    return undefined;
  }, [theme]);

  const changeTheme = (nextTheme) => {
    const next =
      nextTheme === 'light' || nextTheme === 'dark' || nextTheme === 'system'
        ? nextTheme
        : 'system';
    setThemeState(next);
    setCookie('gibson_theme', next, 365);
    try {
      window.localStorage.setItem('gibson_theme', next);
    } catch {
      // ignore
    }
  };

  const selectTab = (tab) => {
    setActiveTab(tab);
    setMobileDrawerOpen(false);
  };
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
        if (typeof document !== 'undefined') {
          document.title = `${formatFamilyBrand(setupData.household_name)} Hub — Couples Finance, Requests & Life OS`;
        }
      }
      if (setupData.starting_budget_month) {
        setStartingBudgetMonth(setupData.starting_budget_month);
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

  const handleTopBarResync = () => {
    if (topbarSyncing) return;
    setTopbarSyncing(true);
    setTopbarSyncNote(null);

    // Run asynchronously so the user can continue navigating and working uninterrupted
    (async () => {
      try {
        let res = null;
        let firstFailed = false;
        try {
          res = await apiFetch('/api/finance/plaid/sync', {
            method: 'POST',
            body: JSON.stringify({ reset_cursor: false, force: true }),
          });
          if (res?.item_errors?.length > 0) {
            firstFailed = true;
          }
        } catch {
          firstFailed = true;
        }

        if (firstFailed) {
          res = await apiFetch('/api/finance/plaid/sync', {
            method: 'POST',
            body: JSON.stringify({ reset_cursor: true, force: true }),
          });
        }

        setSyncVersion((v) => v + 1);
        await loadCoreState();
        if (res?.item_errors?.length > 0) {
          setTopbarSyncNote('Sync warning');
        } else {
          setTopbarSyncNote(
            res?.imported_transactions > 0
              ? `+${res.imported_transactions} synced`
              : 'Synced'
          );
        }
      } catch {
        setTopbarSyncNote('Sync failed');
      } finally {
        setTopbarSyncing(false);
        setTimeout(() => setTopbarSyncNote(null), 4000);
      }
    })();
  };

  if (loadingInit) {
    return (
      <div className="onboarding-shell">
        <div className="card">Loading Family Hub...</div>
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
        onLoginSuccess={() => {
          selectTab('dashboard');
          loadCoreState();
        }}
      />
    );
  }

  const enabledModules = modules.filter((m) => m.enabled && !m.parent_id);
  const childGameModules = modules.filter((m) => m.parent_id === 'games');
  const activeGameModules = childGameModules.filter((m) => m.enabled);

  const getBadgeForModule = (modId) => {
    switch (modId) {
      case 'requests':
        return overview.pending_requests;
      case 'future_plans':
        return overview.future_goals;
      case 'todos':
        return overview.open_todos;
      case 'groceries':
        return overview.unchecked_groceries;
      case 'admin_docs':
        return overview.active_admin_records;
      case 'games':
      case 'splendor':
        return activeGameModules.some((g) => g.id === 'splendor')
          ? overview.splendor_my_turn || 0
          : 0;
      default:
        return 0;
    }
  };

  const SHORT_TAB_LABELS = {
    dashboard: 'Home',
    finance: 'Budget',
    requests: 'Requests',
    savings: 'Savings',
    future_plans: 'Big Buys',
    groceries: 'Groceries',
    admin_docs: 'Medical',
    todos: 'To Do',
    games: 'Games',
    splendor: 'Games',
  };

  const dashboardModule = enabledModules.find((m) => m.id === 'dashboard');
  const financeModules = enabledModules.filter(
    (m) => m.category === 'Financial' && m.id !== 'dashboard'
  );
  const adminModules = enabledModules.filter(
    (m) => m.category !== 'Financial' && m.category !== 'Home' && m.id !== 'dashboard'
  );

  const bottomNavModules = enabledModules.slice(0, 4);

  return (
    <div className="app-shell">
      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation (Slide-over Drawer on Mobile, Fixed Left on Desktop) */}
      <aside className={`sidebar ${mobileDrawerOpen ? 'open' : ''}`}>
        <div className="brand-box">
          <div className="brand-logo brand-logo-house">
            <Home size={18} />
          </div>
          <div className="brand-title-col">
            <h1>{formatFamilyBrand(householdName)}</h1>
          </div>
          <button
            type="button"
            className="btn-icon-subtle mobile-drawer-close"
            onClick={() => setMobileDrawerOpen(false)}
            aria-label="Close navigation menu"
          >
            <X size={20} />
          </button>
        </div>

        {dashboardModule && (
          <nav className="sidebar-nav" style={{ marginBottom: '0.25rem' }}>
            <button
              type="button"
              className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => selectTab('dashboard')}
            >
              <Home size={18} />
              <span>{dashboardModule.name}</span>
            </button>
          </nav>
        )}

        <div className="sidebar-section-label">FINANCES</div>
        <nav className="sidebar-nav">
          {financeModules.map((mod) => {
            const IconComp = ICON_MAP[mod.icon] || LayoutDashboard;
            const badgeCount = getBadgeForModule(mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                className={`nav-item ${activeTab === mod.id ? 'active' : ''}`}
                onClick={() => selectTab(mod.id)}
              >
                <IconComp size={18} />
                <span>{mod.name}</span>
                {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-section-label">ADMIN</div>
        <nav className="sidebar-nav">
          {adminModules.map((mod) => {
            const IconComp = ICON_MAP[mod.icon] || Layers;
            const badgeCount = getBadgeForModule(mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                className={`nav-item ${activeTab === mod.id ? 'active' : ''}`}
                onClick={() => selectTab(mod.id)}
              >
                <IconComp size={18} />
                <span>{mod.name}</span>
                {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
              </button>
            );
          })}
        </nav>

        <nav className="sidebar-nav" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className={`nav-item ${activeTab === 'modules_registry' ? 'active' : ''}`}
            onClick={() => selectTab('modules_registry')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="nav-item mobile-only-nav-item"
            onClick={() => {
              setMobileDrawerOpen(false);
              setShowPasskeyModal(true);
            }}
          >
            <Fingerprint size={18} />
            <span>Manage Passkeys ({activePartner.passkeys?.length || 0})</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="btn btn-lock-full"
            onClick={() => {
              setMobileDrawerOpen(false);
              handleLockScreen();
            }}
          >
            <Lock size={16} />
            Lock Screen (Passkey)
          </button>
          <button
            type="button"
            className="btn btn-danger-outline mobile-drawer-signout"
            onClick={handleSignOut}
          >
            <LogOut size={16} />
            Sign Out ({activePartner.name.split(' ')[0]})
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="btn btn-secondary btn-sm mobile-menu-trigger"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={18} />
            </button>
            <span className="partner-Perspective-label hide-on-mobile">Signed In As:</span>
            <div className="signed-in-badge">
              <span
                className="partner-dot"
                style={{ background: activePartner.avatar_color }}
              />
              <strong className="signed-in-name">{activePartner.name}</strong>
              <span className="text-muted hide-on-mobile">({activePartner.email})</span>
            </div>
            <span
              className={`live-sync-pill ${livePartnerPulse ? 'pulsing' : ''}`}
              title="Real-time partner sync is active"
            >
              <Radio size={12} />
              <span className="sync-pill-text">
                {livePartnerPulse ? 'Synced!' : 'Live'}
              </span>
            </span>
          </div>

          <div className="topbar-right">
            <NotificationCenter
              onNavigateTab={(tab) => selectTab(tab)}
              syncVersion={syncVersion}
            />

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleTopBarResync}
              disabled={topbarSyncing}
              title="Re-sync bank transactions in the background (falls back to full cursor reset if needed)"
            >
              <RefreshCw size={15} className={topbarSyncing ? 'spin' : ''} />
              <span className="hide-on-mobile">
                {topbarSyncing ? 'Syncing...' : topbarSyncNote || 'Resync'}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleLockScreen}
              title="Lock screen"
            >
              <Lock size={15} />
              <span className="hide-on-mobile">Lock</span>
            </button>
            <button
              type="button"
              className="btn btn-danger-outline btn-sm hide-on-mobile"
              onClick={handleSignOut}
              title="Sign out of your account"
            >
              <LogOut size={15} />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {!isLocked && (
          <main className="content-scroll">
            <MobilePushPromptBanner currentPartner={activePartner} />
            <ErrorBoundary onReset={loadCoreState}>
              {activeTab === 'dashboard' && (
                <DashboardModule
                  activePartner={activePartner}
                  partners={partners}
                  onDataChanged={loadCoreState}
                  syncVersion={syncVersion}
                  onNavigateTab={selectTab}
                  startingMonth={startingBudgetMonth}
                />
              )}
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
                  onNavigateTab={selectTab}
                  startingMonth={startingBudgetMonth}
                />
              )}
              {activeTab === 'savings' && (
                <SavingsModule
                  activePartner={activePartner}
                  onDataChanged={loadCoreState}
                  syncVersion={syncVersion}
                  onNavigateTab={selectTab}
                  startingMonth={startingBudgetMonth}
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
              {(activeTab === 'games' || activeTab === 'splendor') && (
                activeGameModules.some((g) => g.id === 'splendor') ? (
                  <SplendorModule
                    activePartner={activePartner}
                    partners={partners}
                    onDataChanged={loadCoreState}
                    syncVersion={syncVersion}
                  />
                ) : (
                  <div className="module-container">
                    <div className="card" style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
                      <Gamepad2 size={32} style={{ color: 'var(--primary)', marginBottom: '0.5rem' }} />
                      <h3>No Individual Games Activated</h3>
                      <p className="text-muted" style={{ marginTop: '0.35rem', marginBottom: '1rem' }}>
                        Enable Splendor under the Games module in Settings to play!
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => selectTab('modules_registry')}
                      >
                        <Settings size={15} /> Open Settings
                      </button>
                    </div>
                  </div>
                )
              )}
              {activeTab === 'modules_registry' && (
                <ModuleManagerSubModule
                  modules={modules}
                  partners={partners}
                  activePartner={activePartner}
                  householdName={householdName}
                  startingBudgetMonth={startingBudgetMonth}
                  theme={theme}
                  onChangeTheme={changeTheme}
                  onToggleModule={handleToggleModule}
                  onRefreshState={loadCoreState}
                  onOpenPasskeyModal={() => setShowPasskeyModal(true)}
                />
              )}
            </ErrorBoundary>
          </main>
        )}

        {/* Mobile Bottom Navigation Bar (1-Thumb Navigation for 99% Mobile Usage) */}
        {!isLocked && (
          <nav className="mobile-bottom-nav" aria-label="Mobile Primary Navigation">
            {bottomNavModules.map((mod) => {
              const IconComp = ICON_MAP[mod.icon] || LayoutDashboard;
              const badgeCount = getBadgeForModule(mod.id);
              const isActive = activeTab === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  className={`mobile-bottom-nav-btn ${isActive ? 'active' : ''}`}
                  onClick={() => selectTab(mod.id)}
                >
                  <div className="mobile-nav-icon-wrap">
                    <IconComp size={20} />
                    {badgeCount > 0 && (
                      <span className="mobile-nav-badge">{badgeCount}</span>
                    )}
                  </div>
                  <span>{SHORT_TAB_LABELS[mod.id] || mod.name.split(' ')[0]}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={`mobile-bottom-nav-btn ${!bottomNavModules.some((m) => m.id === activeTab) ? 'active' : ''
                }`}
              onClick={() => setMobileDrawerOpen(true)}
            >
              <div className="mobile-nav-icon-wrap">
                <Menu size={20} />
              </div>
              <span>More</span>
            </button>
          </nav>
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
