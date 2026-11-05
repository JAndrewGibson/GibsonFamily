import React, { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckSquare,
  FileHeart,
  Fingerprint,
  Handshake,
  LayoutDashboard,
  Layers,
  Lock,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import { apiFetch } from './api';
import OnboardingWizard from './components/OnboardingWizard';
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
  });

  const [activeTab, setActiveTab] = useState('requests');
  const [isLocked, setIsLocked] = useState(false);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);

  const loadCoreState = async () => {
    try {
      const [setupData, mData, oData] = await Promise.all([
        apiFetch('/api/auth/setup-status'),
        apiFetch('/api/modules'),
        apiFetch('/api/overview'),
      ]);
      setOnboardingCompleted(Boolean(setupData.onboarding_completed));
      if (setupData.household_name) {
        setHouseholdName(setupData.household_name);
      }
      const pList = setupData.partners || [];
      setPartners(pList);
      if (pList.length > 0) {
        setActivePartner((prev) => pList.find((p) => p.id === prev?.id) || pList[0]);
      } else {
        setActivePartner(null);
      }
      setModules(mData.modules || []);
      setOverview(oData);
    } catch (err) {
      console.error('Failed to load initial state:', err);
    } finally {
      setLoadingInit(false);
    }
  };

  useEffect(() => {
    loadCoreState();
  }, []);

  const handleToggleModule = async (modId) => {
    await apiFetch(`/api/modules/${modId}/toggle`, { method: 'PUT' });
    await loadCoreState();
  };

  if (loadingInit) {
    return (
      <div className="onboarding-shell">
        <div className="card">Loading GibsonFamily Hub...</div>
      </div>
    );
  }

  // First-Run Setup & Onboarding Flow
  if (!onboardingCompleted || partners.length === 0) {
    return <OnboardingWizard onComplete={loadCoreState} />;
  }

  const currentPartner = activePartner || partners[0];
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
            onClick={() => setIsLocked(true)}
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
            <span className="partner-Perspective-label">Logged In As:</span>
            <div className="partner-switcher">
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`partner-switch-btn ${currentPartner.id === p.id ? 'active' : ''}`}
                  onClick={() => setActivePartner(p)}
                >
                  <span
                    className="partner-dot"
                    style={{ background: p.avatar_color }}
                  />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-right">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowPasskeyModal(true)}
            >
              <Fingerprint size={16} />
              Passkeys ({partners.reduce((acc, p) => acc + (p.passkeys?.length || 0), 0)})
            </button>
            <button
              type="button"
              className="btn btn-danger-outline btn-sm"
              onClick={() => setIsLocked(true)}
            >
              <Lock size={15} />
              Lock Screen
            </button>
          </div>
        </header>

        <main className="content-scroll">
          {activeTab === 'requests' && (
            <RequestsModule
              activePartner={currentPartner}
              partners={partners}
              onDataChanged={loadCoreState}
            />
          )}
          {activeTab === 'future_plans' && (
            <FuturePurchasesModule onDataChanged={loadCoreState} />
          )}
          {activeTab === 'finance' && (
            <FinanceModule
              activePartner={currentPartner}
              onDataChanged={loadCoreState}
            />
          )}
          {activeTab === 'admin_docs' && (
            <AdminDocsSubModule
              activePartner={currentPartner}
              partners={partners}
              onDataChanged={loadCoreState}
            />
          )}
          {activeTab === 'todos' && (
            <TodosSubModule
              activePartner={currentPartner}
              partners={partners}
              onDataChanged={loadCoreState}
            />
          )}
          {activeTab === 'groceries' && (
            <GroceriesSubModule
              activePartner={currentPartner}
              onDataChanged={loadCoreState}
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
      </div>

      {/* WebAuthn Passkey Lock Screen & Enrollment Modal */}
      <PasskeyLockScreen
        isLocked={isLocked}
        onUnlock={() => setIsLocked(false)}
        partners={partners}
        activePartner={currentPartner}
        onSelectPartner={(p) => setActivePartner(p)}
        onRefreshPartners={loadCoreState}
        showManageModal={showPasskeyModal}
        onCloseManageModal={() => setShowPasskeyModal(false)}
      />
    </div>
  );
}
