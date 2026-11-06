# AGENTS.md — GibsonFamily Hub Architecture & Agent Guidelines

This document is the authoritative engineering reference for AI coding agents and developers working on **GibsonFamily Hub** (`https://gibsonfamily.onrender.com`). Keep this file updated whenever architectural, database, security, or UI patterns change.

---

## 1. Core Product Vision & Mobile-First Mandate (99% Mobile Usage)

**GibsonFamily Hub** is a collaborative couples financial & modular life OS built for two partners to:
- Submit, review, mark **"Under Review"** (`under_review`), approve/deny, or build monthly savings timelines for partner purchase requests.
- Plan future household purchases together.
- Link live bank accounts via **Plaid Production** and track monthly budgets separated on the **1st of each month**, with **Income & Income Fluctuation Tracking** (paychecks, variable/commission income, bonuses, and Plaid income deposits), per-month budget adjustments/cancellations (e.g., cancelling a subscription like Netflix in a later month without erasing it from earlier historical months), and a **Historical Months View**.
- Receive **Mobile Push Notifications** (backed by a Service Worker `/sw.js`, Web App Manifest `/manifest.json`, and an in-app prompt banner to enable/test alerts on phones).
- Toggle seamlessly between **Dark Mode and Light Mode** (`data-theme="dark" | "light"`, persisted in `gibson_theme` cookie).
- Manage shared couples life admin (medical paperwork, shared to-do lists, and grocery lists with live basket estimates).
- Lock/unlock and sign in using **WebAuthn Passkeys** (Face ID, Touch ID, Windows Hello) or account passwords.

### 📱 Mobile-First Design Rules (CRITICAL)
Because this application is used **99% of the time on mobile phones**, every view, modal, form, and table must adhere to these rules:
1. **No Horizontal Viewport Overflow**:
   - Never use fixed widths or CSS Grid `minmax(330px+, 1fr)` without `min(100%, ...)` or a `@media (max-width: 768px)` single-column override.
   - `html, body` must keep `overflow-x: hidden; max-width: 100vw;`.
2. **Mobile Navigation Pattern**:
   - On viewports `<= 900px`, the desktop left `.sidebar` transforms into a slide-over drawer (`position: fixed`, toggled via `.mobile-menu-trigger`) with a dimmed `.sidebar-backdrop`.
   - Primary navigation is always reachable with one thumb via the fixed bottom bar (`.mobile-bottom-nav`) with `env(safe-area-inset-bottom)` padding, and `.content-scroll` reserves bottom padding so content is never obscured by the bottom bar.
3. **iOS Safari Zoom Prevention**:
   - All `<input>`, `<select>`, and `<textarea>` elements must have `font-size: 16px` (`1rem`) and `min-height: 42px` on `@media (max-width: 768px)` so iOS Safari never auto-zooms the page when a field is tapped.
4. **Tables & Popovers on Mobile**:
   - Multi-column tables (such as `.tx-table` in `FinanceModule.jsx`) must transform into stacked mobile cards (`tr.tx-row` CSS grid) at `@media (max-width: 768px)`.
   - Row action menus (`.tx-hamburger-popover`) and notification dropdowns (`.notif-dropdown-card`) must use fixed positioning (bottom sheet / centered card) on mobile so they are never clipped inside scroll containers.

---

## 2. Repository Structure

```text
GibsonFamily/
├── AGENTS.md                         # Agent guidelines & system architecture (keep updated!)
├── README.md                         # User & deployment documentation
├── render.yaml                       # Render single-service production blueprint
├── requirements.txt                  # Root Python dependencies pointer (-r backend/requirements.txt)
├── .env.example                      # Environment variable template (never commit .env)
├── backend/
│   ├── app.py                        # Flask app factory, auth middleware, security headers & /api/sync-pulse
│   ├── config.py                     # Loads .env (plaid_client_id, plaid_production_secret, PLAID_REDIRECT_URI)
│   ├── database.py                   # SQLite schema, migrations, encryption helpers & bump_state_version()
│   ├── security.py                   # PBKDF2-HMAC-SHA256 password hashing, token encryption at rest & sessions
│   ├── modules/
│   │   ├── auth_webauthn.py          # Partner auth, rate-limited login, WebAuthn Passkeys & notifications API
│   │   ├── finance.py                # Plaid Production/Sandbox API, per-month budgets, history & transactions
│   │   ├── requests_and_plans.py     # Partner purchase requests, approvals, timelines & future purchases
│   │   └── couples_hub.py            # Module registry, medical/admin records, shared todos & groceries
│   └── tests/
│       └── test_api.py               # Automated pytest suite
└── frontend/
    ├── index.html                    # Viewport meta (viewport-fit=cover), manifest link & Plaid Link SDK
    ├── package.json
    ├── vite.config.js                # Dev proxy (/api -> http://127.0.0.1:5000)
    ├── public/
    │   ├── manifest.json             # Web App Manifest for mobile PWA & push notification support
    │   └── sw.js                     # Service Worker for mobile native push notifications
    └── src/
        ├── api.js                    # Fetch wrapper, cookie helpers, SW push helpers & WebAuthn helpers
        ├── App.jsx                   # Responsive shell, Light/Dark theme toggle, mobile drawer + bottom nav
        ├── styles.css                # Dark & Light themes + mobile-first responsive breakpoints
        ├── components/
        │   ├── LoginScreen.jsx       # Password & WebAuthn Passkey login screen
        │   ├── NotificationCenter.jsx# Notification bell + MobilePushPromptBanner (enable & test push)
        │   ├── OnboardingWizard.jsx  # 4-step first-time setup flow
        │   └── PasskeyLockScreen.jsx # Screen lock overlay & Passkey enrollment modal
        └── modules/
            ├── RequestsModule.jsx    # Partner financial requests (Pending, Under Review, Approved, Timeline, Denied)
            ├── FuturePurchasesModule.jsx # Shared future purchase savings roadmap
            ├── FinanceModule.jsx     # Plaid link, income & fluctuation tracker, monthly budgets & ledger
            └── CouplesHubModule.jsx  # Medical/admin docs, shared to-dos, groceries & module manager
```

---

## 3. Key Architectural Subsystems

### 3.1 Real-Time Partner Reactivity (`state_version` & `/api/sync-pulse`)
- Both partners frequently use the app simultaneously on their phones.
- Every successful mutating request (`POST`, `PUT`, `DELETE` under `/api/*`) triggers `bump_state_version(db)` in `backend/app.py`'s `@app.after_request` hook, incrementing `app_settings.state_version`.
- `frontend/src/App.jsx` polls `GET /api/sync-pulse` every 3 seconds (and listens to `window` `focus` and `BroadcastChannel('gibson_sync')`).
- When `state_version` changes, `syncVersion` increments and is passed as a prop to all active modules (`RequestsModule`, `FuturePurchasesModule`, `FinanceModule`, `AdminDocsSubModule`, `TodosSubModule`, `GroceriesSubModule`, `NotificationCenter`), which perform a **silent refresh** (`silent = true`, no loading spinner flash) so open forms and scroll positions are preserved.

### 3.2 Persistent User Preferences & View State (Cookies)
- Managed via `getCookie` and `setCookie` in `frontend/src/api.js`:
  - `gibson_theme`: Persists `'dark'` or `'light'` mode (`html[data-theme="light"]` / `html[data-theme="dark"]`).
  - `gibson_active_tab`: Restores the last active module tab across page refreshes.
  - `gibson_finance_month`: Restores the last selected `YYYY-MM` budget month.
  - `gibson_finance_chart`: Restores the selected Financial Visualizations graph tab (`income_vs_expenses`, `spending_pie`, `budget_bars`, `cashflow_trend`).
  - `gibson_income_entries_open`: Persists whether the collapsible Income & Refund Entries list is expanded or collapsed.
  - `gibson_budget_sort`: Persists the user's preferred Category Budgets sort order (`spent_desc`, `utilization_desc`, `remaining_desc`, `limit_desc`, `alpha_asc`, `spent_asc`).
  - `gibson_push_enabled` & `gibson_push_prompt_dismissed`: Tracks mobile push notification enablement and prompt banner dismissal.

### 3.3 Finances & Budgeting Layout, Modals, Visualizations & Monthly Separation (1st of Month)
- **Top-of-Page Hierarchy & Decluttered Mobile Header (`FinanceModule.jsx`)**:
  - Top header features the active month trigger pill (`Calendar` icon + `{formatMonthLabel(selectedMonth)}`), primary quick buttons (`+ Log Expense`, `+ Log Income`), and a generic **`Options`** button (`SlidersHorizontal` icon, rendered as a bottom sheet on mobile) that houses secondary tools so mobile headers never clutter:
    - **Budget Period & Historical Months** (floating modal)
    - **Add / Adjust Month Budget** (floating modal)
    - **Manage Categories Panel** (in-page panel; clicking opens it and smoothly scrolls the viewport directly to `categoryManagerRef` with a highlight pulse)
    - **Accounts & Balances** (floating modal with connected/manual accounts and "Add Manual Account" form)
    - **Bank Connections / Plaid** (floating modal with Plaid Link, Sandbox Quick Connect, and Re-Sync)
  - Below the header, the primary view immediately surfaces:
    1. **Monthly Income & Fluctuation Tracker** (with collapsible Income & Refund Entries drawer).
    2. **Two-Column Main Grid (`.finance-two-col`)**:
       - **Left Column**: **Category Budgets** (with persistent sort order and per-month scope adjustments).
       - **Right Column**: **Interactive Financial Visualizations & Graphs Panel** (`income_vs_expenses` vertical bar chart + multi-month clustered bars, `spending_pie` SVG donut/pie chart, `budget_bars` horizontal category utilization bars, and `cashflow_trend` multi-month net cash flow & savings rate).
    3. **Untracked Categories Flag Banner**, **Category Manager Panel** (smooth-scrolled when opened), and **Transactions Ledger**.
- **Transaction Budget Month (`transactions.budget_month`)**:
  - Defaults to `substr(date, 1, 7)` (`YYYY-MM`), cleanly separating budgets on the **1st of every month**.
  - Any transaction can be reassigned to a standard or custom category (`PUT /api/finance/transactions/<id>`) or allocated to the previous month (`prev`), next month (`next`), a specific `YYYY-MM`, or reset to its purchase date month (`reset`) via the per-row `☰` hamburger menu.
- **Income, Projected Income & Fluctuation Tracking (`income_entries` table)**:
  - Stores monthly income (`source_name`, `amount`, `expected_monthly_amount`, `income_type` [`paycheck`, `variable`, `bonus`, `side_income`, `other`], `date`, `budget_month`). Plaid inflows (`amount < 0` or `personal_finance_category.primary == "INCOME"`) are also automatically synced into `income_entries`.
  - `GET /api/finance/summary` and `GET /api/finance/history` compute `total_monthly_income`, `projected_monthly_income` (calculated from up to 6 prior active months `< selected_month`, broken down into `projected_recurring_income`, `projected_variable_income`, and historical `projected_income_min`/`projected_income_max`), `income_vs_projected` (`$` and `%`), `expected_monthly_income`, `previous_month_income`, `average_monthly_income`, `income_fluctuation_vs_prev` (`$` and `%`), `income_fluctuation_vs_expected`, `net_monthly_cashflow` (`income - spent`), and `unallocated_income` (`income - budget`).
- **Category Catalog, Category Manager Panel & Untracked Category Flagging (`category_catalog` table)**:
  - Stores both pre-loaded (`is_preloaded = 1`) and custom (`is_preloaded = 0`) categories along with `is_archived` status so unwanted pre-loaded or custom categories can be hidden/removed without re-populating in dropdowns.
  - Managed via `GET /api/finance/categories`, `POST /api/finance/categories` (create/restore), `PUT /api/finance/categories` (rename/merge across all transactions, budgets, requests, and future plans), and `DELETE /api/finance/categories` (hide/delete with optional transaction reassignment).
  - `GET /api/finance/summary` flags `untracked_categories` (categories that have spending in `selected_month` or are active in the catalog but have no active budget in `selected_month`), `untracked_monthly_spent`, and per-transaction `is_category_tracked`.
- **Per-Month Budgets (`monthly_budgets` table)**:
  - Each `YYYY-MM` month materializes its own rows in `monthly_budgets(budget_month, category, monthly_limit, color, is_active)`.
  - Adding, editing, or cancelling a category supports `apply_scope`:
    - `this_and_future`: Updates or deactivates the category for `selected_month` and all future months (`>= selected_month`), while preserving all historical months (`< selected_month`).
    - `only_this_month`: Applies a one-month adjustment to `selected_month` only.
- **Historical Months View (`GET /api/finance/history`)**:
  - Returns month-by-month total income, income fluctuation delta/%, total spend, total budget, net cash flow, net budget variance, utilization %, and per-category breakdown across all historical and active months.

### 3.4 Purchase Request Lifecycle & Mobile Push Notifications
- **Purchase Request Statuses (`purchase_requests.status`)**:
  - Supports `pending` → `under_review` ("Under Review") → `approved` / `budget_planned` / `denied` via `POST /api/requests/<id>/decision`.
- **Mobile Push Notifications (`push_subscriptions` table & `/sw.js`)**:
  - Mobile browsers require `ServiceWorkerRegistration.showNotification()` rather than `new window.Notification()`. `frontend/public/sw.js` and `showMobileNativeNotification()` in `frontend/src/api.js` handle native mobile notification delivery, while `MobilePushPromptBanner` in `NotificationCenter.jsx` prompts users to enable and test push notifications (`GET /api/notifications/push-status`, `POST /api/notifications/push-subscribe`, `POST /api/notifications/push-test`).

### 3.4 Security & Plaid Production Architecture
- **Authentication**: All `/api/*` endpoints (except `/api/health`, `/api/auth/setup-status`, `/api/auth/login`, and WebAuthn assertion endpoints) require a valid `gibson_session` `HttpOnly` cookie or `Bearer` token (`backend/app.py`).
- **Encryption at Rest**: Plaid `access_token` values are encrypted with a key derived from `FLASK_SECRET_KEY` (`encrypt_plaid_token` / `decrypt_plaid_token` in `backend/security.py`, `enc:v1:...`) before being stored in `plaid_items`.
- **Plaid Redirect URI**: Normalized without a trailing slash (`https://gibsonfamily.onrender.com`) in `backend/config.py` and `backend/modules/finance.py` to match the Plaid Dashboard registration. Never log or expose secret values from `.env`.

---

## 4. Development, Build & Verification Commands

Whenever you modify backend or frontend code, always run both verification steps before finishing:

1. **Run Backend Pytest Suite**:
   ```powershell
   .\.venv\Scripts\python -m pytest backend/tests/test_api.py -v
   ```
2. **Build Production Frontend Bundle** (served by Flask in production):
   ```powershell
   npm run build --prefix frontend
   ```

