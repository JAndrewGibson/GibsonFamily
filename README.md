# GibsonFamily Hub — Couples Financial, Purchase Request & Modular Life OS

**GibsonFamily Hub** is a full-stack, modular web application built with **Flask** and **React (Vite)** designed for couples to collaboratively manage their household finances, submit and review purchase requests with custom savings timelines, plan future purchases, and organize shared life admin (medical paperwork, shared to-do lists, and grocery lists) behind a **WebAuthn Passkey** screen lock.

---

## ✨ Key Features

### 0. 🚀 Guided First-Time Setup & Onboarding Wizard
- Starts with a **100% clean database** (zero pre-populated test data).
- On first launch, a 4-step **Onboarding Wizard** ([OnboardingWizard.jsx](file:///c:/Users/AGibson/GibsonFamily/frontend/src/components/OnboardingWizard.jsx)) walks you through:
  1. **Household & Couple Profiles**: Create your profile and your partner's profile (name, email/handle, badge color, and optional monthly allowance).
  2. **WebAuthn Passkey Enrollment**: Register your device Passkey (`navigator.credentials.create`) right away for screen lock security.
  3. **Link Bank Accounts (Plaid or Manual)**: Launch the interactive Plaid Link modal, connect a Plaid Sandbox bank (`First Platypus Bank`, `First Gingham Credit Union`, `Tartan Bank`, `Houndstooth Bank`), or add manual accounts.
  4. **Initial Monthly Budgets & Module Selection**: Configure your starting budget categories and choose which workspace modules are enabled.

### 1. 🤝 Partner Financial Requests & Timeline Builder
- **Submit Purchase Requests**: Either partner can submit a financial request to the other (e.g., *"New Game Console — PlayStation 5 Pro"*), complete with price, category, priority, product link, and optional proposed monthly savings rate.
- **Approve, Deny, or Build a Budget Timeline**:
  - **Approve Now**: Green-light the purchase immediately with decision notes.
  - **Set Up a Budget & Timeline**: Configure a monthly savings contribution (`$/month`), target purchase date, and initial saved amount. The app calculates the remaining months and automatically links the request to a tracked **Future Purchase** plan.
  - **Hold Off / Deny**: Pause or decline a request with partner notes.
- **Savings Contributions & Discussion Thread**: Add incremental contributions (`+$50`, `+$100`, or monthly plan amount) and discuss requests in real time.

### 2. 🗓️ Future Purchases & Shared Savings Roadmap
- Plan upcoming big-ticket purchases together (vacations, furniture, appliances, or linked partner requests).
- Real-time calculation of estimated completion dates and required monthly savings pace to hit your target date.

### 3. 💳 Plaid Banking Integration & Monthly Category Budgets
- Reads `plaid_client_id` and `plaid_sandbox_secret` directly from your `.env` file.
- Supports both **1-Click Plaid Sandbox Bank Connection** (automatically creates a Sandbox public token, exchanges it for an access token, and syncs accounts & transactions) and **Plaid Link Modal** (`link_token` creation + public token exchange).
- **Monthly Category Budgets**: Visual progress bars tracking monthly spending against category limits (`Groceries & Dining`, `Entertainment & Gaming`, `Housing & Utilities`, `Health & Medical`, `Shopping & Tech`, `Future Purchase Savings`).

### 4. 🔐 WebAuthn (Passkeys) Screen Lock — Zero 2FA Friction
- Built on the W3C **WebAuthn (`navigator.credentials.create` / `navigator.credentials.get`)** standard.
- Each partner can enroll their device Passkey (Windows Hello, Touch ID, Face ID, or Security Key) and lock/unlock the screen with a single biometric tap—no SMS or TOTP 2FA codes required.

### 5. 🧩 Modular Couples Hub Architecture
Built around a pluggable Flask Blueprint + React Module Registry (`module_registry` table) so new household modules can be added or toggled anytime:
- **Couples Admin & Medical Paperwork** (`/api/hub/admin-records`): Track medical forms, HSA claims, open enrollment deadlines, and insurance renewals.
- **Shared To-Do Lists** (`/api/hub/todos`): Assign household tasks between partners with due dates and categories.
- **Shared Grocery List** (`/api/hub/groceries`): Aisle-organized grocery checklist with live basket cost estimation.

---

## 📁 Project Structure

```text
GibsonFamily/
├── .env                        # Local Plaid credentials (ignored by git)
├── .env.example                # Example environment variables template
├── .gitignore                  # Ignores .env, .venv, node_modules, *.db
├── README.md                   # Documentation
├── backend/
│   ├── app.py                  # Flask app factory & Blueprint registration
│   ├── config.py               # Loads .env (plaid_client_id, plaid_sandbox_secret)
│   ├── database.py             # SQLite schema & initial couple seed data
│   ├── requirements.txt        # Python dependencies
│   ├── modules/
│   │   ├── auth_webauthn.py    # WebAuthn Passkey registration & screen unlock
│   │   ├── finance.py          # Plaid Sandbox API, accounts, budgets & transactions
│   │   ├── requests_and_plans.py # Partner purchase requests, approvals & timelines
│   │   └── couples_hub.py      # Modular registry, medical admin, todos & groceries
│   └── tests/
│       └── test_api.py         # Pytest suite covering Plaid, WebAuthn, Requests & Hub
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js          # Proxies /api to Flask backend on port 5000
    └── src/
        ├── api.js              # Fetch helper & WebAuthn Passkey ceremony helpers
        ├── App.jsx             # Modular shell, partner switcher & navigation
        ├── styles.css          # Responsive dark UI theme
        ├── components/
        │   └── PasskeyLockScreen.jsx
        └── modules/
            ├── RequestsModule.jsx
            ├── FuturePurchasesModule.jsx
            ├── FinanceModule.jsx
            └── CouplesHubModule.jsx
```

---

## 🚀 Deploying to Render (Production)

The repository is configured to run both the compiled React frontend (`frontend/dist`) and the Flask API from a **single Render Web Service** using [render.yaml](file:///c:/Users/AGibson/GibsonFamily/render.yaml). Running on a single HTTPS domain ensures **WebAuthn Passkeys (`rpId`)** and **Plaid Link** work seamlessly without cross-origin issues.

### Step 1: Push Your Code to GitHub
```powershell
git add .
git commit -m "Initial production release for GibsonFamily Hub"
git push origin main
```
*(Your `.env` file is listed in `.gitignore` and will never be committed to Git.)*

### Step 2: Create the Web Service on Render
1. Log into [Render Dashboard](https://dashboard.render.com/) and click **New +** → **Web Service** (or **Blueprint** to auto-detect `render.yaml`).
2. Connect your GitHub repository.
3. Use these settings:
   - **Runtime**: `Python 3`
   - **Build Command**:
     ```bash
     npm install --prefix frontend && npm run build --prefix frontend && pip install -r requirements.txt
     ```
   - **Start Command**:
     ```bash
     gunicorn backend.app:app --bind 0.0.0.0:$PORT
     ```
4. Under **Environment Variables**, add:
   | Key | Value |
   | --- | --- |
   | `PLAID_ENV` | `production` |
   | `plaid_client_id` | *(Your Plaid Client ID)* |
   | `plaid_production_secret` | *(Your Plaid Production Secret)* |
   | `FLASK_SECRET_KEY` | *(Any random secret string)* |
   | `PYTHON_VERSION` | `3.12.8` |
   | `NODE_VERSION` | `22.12.0` |

5. **(Recommended for Persistent SQLite Storage on Render)**:
   - On Render, attach a **Persistent Disk** (under the **Disks** tab of your Web Service) mounted at `/var/data`, and add the environment variable:
     - `DATABASE_PATH` = `/var/data/gibson_family.db`
   - This ensures your database persists across redeployments.

6. **(Important for Plaid Production OAuth Banks)**:
   - Once Render gives you your live URL (e.g., `https://gibsonfamily-hub.onrender.com`), open your [Plaid Dashboard → Team Settings → API → Allowed redirect URIs](https://dashboard.plaid.com/developers/api) and add `https://gibsonfamily-hub.onrender.com/`, then set `PLAID_REDIRECT_URI=https://gibsonfamily-hub.onrender.com/` in Render's Environment tab if required by your bank's OAuth flow.

---

## 💻 Running Locally

### 1. Environment Variables (`.env`)
Ensure your root `.env` file contains your Plaid credentials:

```env
plaid_client_id=your_plaid_client_id
plaid_sandbox_secret=your_plaid_sandbox_secret
```

### 2. Start the Flask Backend
```powershell
# Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# Install dependencies (if not already installed)
pip install -r backend/requirements.txt

# Start the Flask API server on http://127.0.0.1:5000
python -m backend.app
```

### 3. Start the React Frontend
In a second terminal:
```powershell
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** in your browser.

---

## 🧪 Running Tests
```powershell
.\.venv\Scripts\python -m pytest backend/tests/test_api.py -v
```

---

## 🔌 Adding a New Module
1. **Backend**: Create a new Flask Blueprint in `backend/modules/your_module.py`, register it in `backend/app.py`, and add an entry to `module_registry` in `backend/database.py`.
2. **Frontend**: Create your component in `frontend/src/modules/` and map its module `id` in `frontend/src/App.jsx`.

