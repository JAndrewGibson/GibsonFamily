import sqlite3
import time
from pathlib import Path
from flask import current_app, g


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'Partner',
    avatar_color TEXT NOT NULL DEFAULT '#6366f1',
    monthly_fun_allowance REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    partner_id INTEGER NOT NULL,
    is_screen_locked INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_partner_id INTEGER NOT NULL,
    actor_partner_id INTEGER,
    notif_type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link_tab TEXT NOT NULL DEFAULT 'requests',
    reference_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (recipient_partner_id) REFERENCES partners (id) ON DELETE CASCADE,
    FOREIGN KEY (actor_partner_id) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    device_name TEXT NOT NULL DEFAULT 'Passkey Device',
    transports TEXT NOT NULL DEFAULT 'internal,hybrid',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER,
    challenge TEXT NOT NULL,
    challenge_type TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plaid_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    institution_name TEXT NOT NULL DEFAULT 'Plaid Bank',
    linked_by_partner_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linked_by_partner_id) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plaid_account_id TEXT UNIQUE,
    name TEXT NOT NULL,
    official_name TEXT,
    type TEXT NOT NULL DEFAULT 'depository',
    subtype TEXT NOT NULL DEFAULT 'checking',
    mask TEXT DEFAULT '0000',
    balance_current REAL NOT NULL DEFAULT 0.0,
    balance_available REAL NOT NULL DEFAULT 0.0,
    owner_scope TEXT NOT NULL DEFAULT 'shared',
    institution_name TEXT NOT NULL DEFAULT 'Bank Account'
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    plaid_transaction_id TEXT UNIQUE,
    date TEXT NOT NULL,
    budget_month TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    merchant_name TEXT,
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    partner_id INTEGER,
    is_shared INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL UNIQUE,
    monthly_limit REAL NOT NULL,
    alert_threshold REAL NOT NULL DEFAULT 0.8,
    is_shared INTEGER NOT NULL DEFAULT 1,
    color TEXT NOT NULL DEFAULT '#6366f1'
);

CREATE TABLE IF NOT EXISTS monthly_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_month TEXT NOT NULL,
    category TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(budget_month, category)
);

CREATE TABLE IF NOT EXISTS category_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_preloaded INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER,
    account_id INTEGER,
    plaid_transaction_id TEXT UNIQUE,
    date TEXT NOT NULL,
    budget_month TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL,
    amount REAL NOT NULL,
    expected_monthly_amount REAL,
    income_type TEXT NOT NULL DEFAULT 'payroll',
    category TEXT NOT NULL DEFAULT '',
    is_recurring INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL,
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS monthly_income_projections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_month TEXT NOT NULL UNIQUE,
    custom_projected_income REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL DEFAULT '',
    auth TEXT NOT NULL DEFAULT '',
    device_label TEXT NOT NULL DEFAULT 'Mobile Browser',
    user_agent TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'General',
    amount REAL NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decision_notes TEXT,
    proposed_monthly_contribution REAL,
    proposed_target_date TEXT,
    saved_amount REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (requester_id) REFERENCES partners (id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES partners (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    partner_id INTEGER NOT NULL,
    comment TEXT NOT NULL,
    action_type TEXT NOT NULL DEFAULT 'comment',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (request_id) REFERENCES purchase_requests (id) ON DELETE CASCADE,
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS future_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Home & Lifestyle',
    target_amount REAL NOT NULL,
    current_saved REAL NOT NULL DEFAULT 0.0,
    monthly_contribution REAL NOT NULL DEFAULT 100.0,
    target_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'saving',
    linked_request_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linked_request_id) REFERENCES purchase_requests (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS module_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    icon TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    assigned_to INTEGER,
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'medium',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (assigned_to) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS grocery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    aisle_category TEXT NOT NULL DEFAULT 'Produce',
    quantity TEXT NOT NULL DEFAULT '1',
    estimated_price REAL NOT NULL DEFAULT 0.0,
    added_by INTEGER,
    checked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (added_by) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    record_type TEXT NOT NULL DEFAULT 'medical',
    owner_partner_id INTEGER,
    status TEXT NOT NULL DEFAULT 'todo',
    due_or_renewal_date TEXT,
    provider_or_location TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_partner_id) REFERENCES partners (id) ON DELETE SET NULL
);
"""


DEFAULT_MODULES = [
    (
        "requests",
        "Partner Purchase Requests",
        "Submit purchase requests to your partner to approve, deny, or set up a savings budget & timeline.",
        "Financial",
        "handshake",
        1,
        1,
    ),
    (
        "finance",
        "Finances & Budgeting",
        "Plaid bank accounts, shared & individual transactions, and monthly category budgets.",
        "Financial",
        "wallet",
        1,
        2,
    ),
    (
        "future_plans",
        "Future Purchases & Goals",
        "Plan upcoming big purchases together with target dates, monthly contributions, and progress tracking.",
        "Financial",
        "calendar-clock",
        1,
        3,
    ),
    (
        "admin_docs",
        "Couples Admin & Medical",
        "Track medical paperwork, insurance renewals, tax filings, and household admin tasks.",
        "Household & Admin",
        "file-heart",
        1,
        4,
    ),
    (
        "todos",
        "Shared To-Do Lists",
        "Assign and coordinate household chores, errands, and shared couple tasks.",
        "Household & Admin",
        "check-square",
        1,
        5,
    ),
    (
        "groceries",
        "Grocery List",
        "Shared real-time grocery list organized by aisle with estimated basket cost.",
        "Household & Admin",
        "shopping-cart",
        1,
        6,
    ),
]


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        db_path = Path(current_app.config["DATABASE_PATH"])
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def close_db(e=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        db = get_db()
        db.executescript(SCHEMA_SQL)
        _ensure_schema_migrations(db)
        _ensure_module_definitions(db)
        db.commit()


def _ensure_schema_migrations(db: sqlite3.Connection) -> None:
    """Safely adds new columns if upgrading an existing SQLite file."""
    cols = [r["name"] for r in db.execute("PRAGMA table_info(partners)").fetchall()]
    if "password_hash" not in cols:
        db.execute("ALTER TABLE partners ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")

    tx_cols = [r["name"] for r in db.execute("PRAGMA table_info(transactions)").fetchall()]
    if "budget_month" not in tx_cols:
        db.execute("ALTER TABLE transactions ADD COLUMN budget_month TEXT NOT NULL DEFAULT ''")
    db.execute(
        "UPDATE transactions SET budget_month = substr(date, 1, 7) WHERE budget_month IS NULL OR budget_month = ''"
    )

    inc_cols = [r["name"] for r in db.execute("PRAGMA table_info(income_entries)").fetchall()]
    if "category" not in inc_cols:
        db.execute("ALTER TABLE income_entries ADD COLUMN category TEXT NOT NULL DEFAULT ''")

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS monthly_income_projections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_month TEXT NOT NULL UNIQUE,
            custom_projected_income REAL NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )


def _ensure_module_definitions(db: sqlite3.Connection) -> None:
    """Only registers the available application modules; no fake user/financial data is seeded."""
    module_count = db.execute("SELECT COUNT(*) AS cnt FROM module_registry").fetchone()["cnt"]
    if module_count == 0:
        db.executemany(
            """
            INSERT INTO module_registry (id, name, description, category, icon, enabled, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            DEFAULT_MODULES,
        )
    defaults = {
        "onboarding_completed": "0",
        "household_name": "Gibson Household",
        "state_version": str(int(time.time() * 1000)),
        "plaid_banner_dismissed": "0",
    }
    for k, v in defaults.items():
        row = db.execute("SELECT value FROM app_settings WHERE key = ?", (k,)).fetchone()
        if not row:
            db.execute("INSERT INTO app_settings (key, value) VALUES (?, ?)", (k, v))


def bump_state_version(db: sqlite3.Connection) -> str:
    new_ver = str(int(time.time() * 1000))
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('state_version', ?)",
        (new_ver,),
    )
    return new_ver


def create_notification(
    db: sqlite3.Connection,
    recipient_partner_id: int,
    actor_partner_id: int | None,
    notif_type: str,
    title: str,
    message: str,
    link_tab: str = "requests",
    reference_id: int | None = None,
) -> None:
    if not recipient_partner_id:
        return
    db.execute(
        """
        INSERT INTO notifications
        (recipient_partner_id, actor_partner_id, notif_type, title, message, link_tab, reference_id, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (recipient_partner_id, actor_partner_id, notif_type, title, message, link_tab, reference_id),
    )
    bump_state_version(db)
