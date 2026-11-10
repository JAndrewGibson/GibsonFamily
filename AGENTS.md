<!--  --># AGENTS.md — GibsonFamily Hub Architecture & Agent Guidelines

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
   - All `<input>`, `<select>`, and `<textarea>` elements must have `font-size: 16px !important` and `min-height: 42px !important` on `@media (max-width: 768px)` so iOS Safari never auto-zooms the page when a field is tapped.
4. **Tables, Modals & Popovers on Mobile**:
   - Multi-column tables (such as `.tx-table` in `FinanceModule.jsx`) must transform into stacked mobile cards (`tr.tx-row` CSS grid) at `@media (max-width: 768px)`.
   - Modals (`.finance-modal-backdrop`, `.finance-modal-card`) transform into mobile-first bottom sheets with safe-area padding (`env(safe-area-inset-bottom)`), compact headers/bodies, and full-width buttons.
   - Row action menus (`.tx-hamburger-popover`), options menus (`.finance-options-dropdown`), and notification dropdowns (`.notif-dropdown-card`) must use fixed positioning (bottom sheet / centered card) on mobile so they are never clipped inside scroll containers.
   - Limit tags on layered horizontal bars (`.marker-tag.tag-top` on top, `.marker-tag.tag-max` on bottom) are vertically separated so markers never collide or overlap when budget limits approach 100%.

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
        │   ├── ErrorBoundary.jsx     # Crash-resilient error boundary around modules & shell
        │   ├── LoginScreen.jsx       # Password & WebAuthn Passkey login screen
        │   ├── NotificationCenter.jsx# Notification bell + MobilePushPromptBanner (enable & test push)
        │   ├── OnboardingWizard.jsx  # 4-step first-time setup flow
        │   └── PasskeyLockScreen.jsx # Screen lock overlay & Passkey enrollment modal
        └── modules/
            ├── RequestsModule.jsx    # Partner financial requests (Pending, Under Review, Approved, Timeline, Denied)
            ├── FuturePurchasesModule.jsx # Shared future purchase savings roadmap
            ├── FinanceModule.jsx     # Plaid link, income & fluctuation tracker, monthly budgets & ledger
            ├── SavingsModule.jsx     # Long-term Savings & Brokerage analytics (MoM, YoY, per-account & combined graphs, savings spend & transfers)
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
    - **Manage Categories** (floating modal)
    - **All Accounts & Balances by User** (floating modal with partner checking, savings, and credit breakdown, color-coding swatches, and account removal)
    - **Accounts & Balances** (floating modal with connected/manual accounts, color swatches, and "Add Manual Account" modal trigger)
    - **Bank Connections / Plaid** (floating modal with Plaid Link, Sandbox Quick Connect, Re-Sync, and Unlink)
  - Below the header, the primary view immediately surfaces:
    1. **Monthly Income, Layered Budget Balance Bar & Fluctuation Tracker**:
       - Features a **Layered Horizontal Bar Graph** where the 100% maximum ceiling is **Projected Income** (`projected_monthly_income`), **Savings** (`savings_budget_limit + unallocated_projected_savings`) is shown in **grey at the right end**, and **Actual Spending** and **Budgeted Categories Limit** are layered with a vertical limit marker. (Actual Income is intentionally excluded from the bar and overlap warnings so bi-weekly pay schedules do not trigger false overspending alerts mid-month).
       - Automatically surfaces high-visibility flags and warnings whenever parts overlap (`budget_exceeds_projected_income`, `spent_exceeds_projected_income`, `spent_dipping_into_savings`, or spending exceeding category limits), plus a status strip inside the **Category Budgets** card.
       - Includes a button to open the **Inflow & Income Entries** floating modal.
    2. **Two-Column Main Grid (`.finance-two-col`)**:
       - **Left Column**: **Category Budgets** (with persistent sort order and per-month scope adjustments).
       - **Right Column**: **Interactive Financial Visualizations & Graphs Panel** (`income_vs_expenses` vertical bar chart + multi-month clustered bars, `spending_pie` SVG donut/pie chart, `budget_bars` horizontal category utilization bars, and `cashflow_trend` multi-month net cash flow & savings rate).
    3. **Untracked Categories Flag Banner** and **Transactions Ledger** (with user-set account color-coding reflected on every transaction row and account pill).
- **Starting Budget Month (`2026-11`) & 12-Hour Auto-Sync on Page Load**:
  - `STARTING_BUDGET_MONTH = "2026-11"`: November 2026 is the household starting point; pre-November historical noise is excluded from period selectors and auto-seeding.
  - On page load, `FinanceModule.jsx` calls `POST /api/finance/plaid/auto-sync`. If connected Plaid accounts have not been synced in `>= 12` hours (`app_settings.last_plaid_sync_at`), the backend spawns a background sync thread and bumps `state_version` upon completion.
- **Transaction Budget Month (`transactions.budget_month`) & Pending Transactions (`is_pending`)**:
  - Defaults to `substr(date, 1, 7)` (`YYYY-MM`), cleanly separating budgets on the **1st of every month**.
  - Any transaction can be reassigned to a standard or custom category (`PUT /api/finance/transactions/<id>`) or allocated to the previous month (`prev`), next month (`next`), a specific `YYYY-MM`, or reset to its purchase date month (`reset`) via the per-row `☰` hamburger menu.
  - **Pending Transactions (`transactions.is_pending`, `income_entries.is_pending`)**:
    - Plaid pending transactions (`pending: true`) are actively ingested and count towards all monthly budget totals, gross spend, and net cashflow immediately.
    - Rendered in the ledger and inflow entries with an amber **"Pending"** pill (`.tx-pending-pill`) placed immediately after the colored account pill.
    - Users can categorize pending transactions immediately.
    - When a transaction settles with the bank, Plaid delivers the posted transaction (via `pending_transaction_id` or `modified` sync). The existing row upgrades in-place to `is_pending = 0`, preserving the category assigned by the user while pending.
- **Income, Projected Income & Fluctuation Tracking (`income_entries` & `monthly_income_projections` tables)**:
  - Stores monthly inflows in `income_entries(source_name, amount, expected_monthly_amount, income_type, category, date, budget_month, notes)`.
  - **Inflow Classification & Strict Financial Equilibrium**:
    - **`payroll` / earned income** (`payroll`, `paycheck`, `salary`, `variable`, `commission`, `bonus`, `side_income`, `other`): The **only** inflows that count toward `total_monthly_income`.
    - **`cc_payment` (Credit Card Payment)** & **`transfer` (Account Transfer)**: Non-income debt payoffs or fund movements; completely excluded from `total_monthly_income` so credit card payments never overstate earned income.
    - **`return` (Store Returns / Refunds)**: Excluded from income. Instead, credited directly to its designated category (`gross_spent`, `returns_credited`, `spent` net).
      - *Equilibrium Law*: `Net Spent = Gross Spent - Returns Credited`. `Remaining Budget = Limit - Net Spent = (Limit + Returns Credited) - Gross Spent`. This ensures refunds restore budget room exactly as if the returned item was never purchased, without generating phantom income or encouraging overspending.
  - **Custom Projected Income Override (`monthly_income_projections` table)**:
    - Stores per-month overrides `(budget_month, custom_projected_income, updated_at)`.
    - Managed via `POST /api/finance/projected-income` and `DELETE /api/finance/projected-income`.
    - When set, overrides the auto-calculated historical projection (calculated from up to 6 prior active months `< selected_month`) across `finance_summary`, `finance_history`, and the Layered Budget Balance Bar ceiling.
  - `GET /api/finance/summary` computes `total_monthly_income`, `total_monthly_returns`, `total_cc_payments`, `total_transfers`, `total_gross_spent`, `total_monthly_spent` (net), `projected_monthly_income`, `is_custom_projection`, `auto_projected_income`, `custom_projected_income`, `income_vs_projected` (`$` and `%`), `net_monthly_cashflow`, and `unallocated_income`.
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
- **Credit Card Payment Marking (`transactions.is_cc_payment`)**:
  - Outgoing payments from checking or depository accounts paying off credit cards can be marked as **Credit Card Payment** (via the transaction row `☰` menu or category selector, `is_cc_payment = 1` / `category = "Credit Card Payment"`).
  - Completely excludes the debt payoff transaction from monthly budget spending (`total_monthly_spent`, `total_gross_spent`, category limits, and the Layered Budget Balance Bar) so credit card payoffs never double-count expenses already recorded on the card.
  - Can be unmarked / restored to the budget at any time.
- **Split Category Transactions (`transactions.is_split`, `transaction_splits` table, `POST/DELETE /api/finance/transactions/<id>/split`)**:
  - Allows any transaction (e.g. Target, Costco, Amazon) to be allocated across multiple spending categories with per-category amounts and optional notes.
  - Includes interactive Split Modal with total amount validation, remaining allocation helper, and exact match calculation.
  - Each split amount accurately increments its respective category budget and spending charts, while preserving total gross spend and net cashflow.
  - Displays interactive split pills and chips in the ledger, with full ability to re-edit the split or revert to a single-category transaction at any time.
- **Savings & Brokerage Long-Term Analytics & Spending from Savings (`SavingsModule.jsx`, `transactions.is_savings_spend`, `account_balance_snapshots`)**:
  - **Spend from Savings (`is_savings_spend = 1` / `category = "Spent from Savings"`)**:
    - Big purchases that were saved for can be marked as **Spent from Savings** (via the transaction row `☰` menu, category selector, `+ Log Expense`, or the **Savings & Analytics** module).
    - Purchases marked as coming from savings are **completely excluded** from monthly budget spending (`total_monthly_spent`, `total_gross_spent`, `budgeted_categories_spent`, `untracked_categories`, and the Layered Budget Balance Bar), while tracked in `total_savings_spent` and analyzed in the dedicated **Savings & Analytics** module (`savings`).
  - **Savings & Brokerage Account Classification (`accounts.is_savings_account`, `classify_savings_account`)**:
    - Automatically classifies `savings`, `hysa`, `money market`, `cd` as Cash Savings (`savings`) and `investment`, `brokerage`, `ira`, `roth`, `401k`, `529`, `hsa` as Brokerage (`brokerage`), with manual user override via `PUT /api/finance/accounts/<id>` (`is_savings_account: true | false`).
  - **Transfers In & Balance History (`GET /api/finance/savings`, `POST /api/finance/savings/transfer`, `POST /api/finance/savings/spend`, `POST /api/finance/savings/snapshots`)**:
    - Tracks transfers into savings/brokerage accounts (`income_entries` on savings accounts or `income_type = 'transfer'`), purchases funded from savings, and monthly account balance snapshots (`account_balance_snapshots`).
    - Renders **Month-over-Month (MoM)** and **Year-over-Year (YoY)** analytics, individual account balance graphs (`account_series`), a filterable **Combined View** (All Savings & Brokerage, Cash Savings Only, Brokerage Only, or custom account toggles), and a long-term savings flow ledger.

### 3.4 Purchase Request Lifecycle & Mobile Push Notifications
- **Purchase Request Statuses (`purchase_requests.status`)**:
  - Supports `pending` → `under_review` ("Under Review") → `approved` / `budget_planned` / `denied` via `POST /api/requests/<id>/decision`.
- **Mobile Push Notifications (`push_subscriptions` table & `/sw.js`)**:
  - Mobile browsers require `ServiceWorkerRegistration.showNotification()` rather than `new window.Notification()`. `frontend/public/sw.js` and `showMobileNativeNotification()` in `frontend/src/api.js` handle native mobile notification delivery, while `MobilePushPromptBanner` in `NotificationCenter.jsx` prompts users to enable and test push notifications (`GET /api/notifications/push-status`, `POST /api/notifications/push-subscribe`, `POST /api/notifications/push-test`).

### 3.5 Security & Plaid Production Architecture
- **Authentication**: All `/api/*` endpoints (except `/api/health`, `/api/auth/setup-status`, `/api/auth/login`, and WebAuthn assertion endpoints) require a valid `gibson_session` `HttpOnly` cookie or `Bearer` token (`backend/app.py`).
- **Encryption at Rest**: Plaid `access_token` values are encrypted with a key derived from `FLASK_SECRET_KEY` (`encrypt_plaid_token` / `decrypt_plaid_token` in `backend/security.py`, `enc:v1:...`) before being stored in `plaid_items`.
- **Plaid Redirect URI**: Normalized without a trailing slash (`https://gibsonfamily.onrender.com`) in `backend/config.py` and `backend/modules/finance.py` to match the Plaid Dashboard registration. Never log or expose secret values from `.env`.
- **Plaid Bank Unlinking & Deduplication (`DELETE /api/finance/plaid/items/<item_identifier>`)**:
  - Allows partners to unlink any connected bank or remove accidentally duplicated connections.
  - De-registers the item via Plaid's `/item/remove` API, deletes the entry from `plaid_items`, removes its synced `accounts`, and purges all imported `transactions` and `income_entries` tied to that connection.
  - Automatically restores true non-overstated balances, cashflow, and spending without leaving orphaned records.
- **Account Deletion & Permanent Blocklist (`DELETE /api/finance/accounts/<id>`, `deleted_accounts_blocklist` table)**:
  - Deletes the account (plus any duplicate Plaid account rows sharing the same `(institution_name, mask, subtype, name)` signature) and cascades deletion to all associated transactions and income entries.
  - Records deleted accounts in `deleted_accounts_blocklist` so future Plaid syncs never re-create removed accounts, and cleans up `plaid_items` when no accounts remain for an item or institution.
- **Account Color-Coding (`accounts.color`) & Ownership (`accounts.owner_partner_id`, `PUT /api/finance/accounts/<id>`)**:
  - Every account has a user-customizable `color` (preset swatches + custom color picker in **All Accounts & Balances by User** and **Accounts & Balances** modals) that is reflected on transactions and inflows in the ledger (left border accent + colored account badge pill).
  - Accounts track relational ownership via `owner_partner_id REFERENCES partners(id) ON DELETE SET NULL` (in addition to `owner_scope`).
  - Plaid accounts default their initial owner to the linking partner (`linked_by_partner_id`), and manual accounts can be created with an assigned partner or shared.
  - Any account's owner or color can be updated via `PUT /api/finance/accounts/<id>` directly from the UI.
  - Accessible via the **"All Accounts & Balances by User"** modal in the top **Options** dropdown in `FinanceModule.jsx`.
  - Groups accounts by user (e.g., Alex, Jordan) and Shared/Household, subdividing each into **Checking Accounts**, **Savings Accounts**, **Credit Cards & Debt**, and **Other/Investments** with live balances, available balances, partner subtotals, and household aggregate KPIs.
- **Plaid Re-Authentication (Update Mode), Force Full Re-Sync & Webhook Delivery**:
  - **Item Error & Re-Authentication (`plaid_items.status`, `last_error_code`, Update Mode)**: When bank credentials expire or MFA is requested (`ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `ITEM_LOCKED`), Plaid pauses syncing transactions. The app detects these errors, flags `requires_reauth`, and allows partners to launch Plaid Link in **Update Mode** (`POST /api/finance/plaid/create_link_token` with `item_id`) to re-authenticate with 1 click without losing existing accounts or transaction histories.
  - **Force Full Re-Sync (Cursor Reset, `reset_cursor: true`)**: If transactions get stuck in Plaid's cache or the incremental sync cursor becomes desynchronized, partners can trigger **"Force Full Re-Sync (Reset Cursor)"** via `POST /api/finance/plaid/sync` with `reset_cursor: true` to stream all transactions from November 2026 onwards from scratch.
  - **Deduplication Account Mapping**: When duplicate Plaid accounts sharing `(institution_name, mask, subtype, name)` are linked, their Plaid account IDs map directly to `account_id_map` so transactions are never dropped.
  - **Transaction Date Prioritization**: Uses `authorized_date` falling back to `date` so pending swipes and settled charges reflect the actual purchase date.
  - **Public Webhook Receiver (`POST /api/finance/plaid/webhook`)**: Receives Plaid's asynchronous `TRANSACTIONS` updates (`SYNC_UPDATES_AVAILABLE`) and `ITEM` errors, triggering background syncs and real-time partner notification via `/api/sync-pulse`.

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

