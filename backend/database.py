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
    cursor TEXT,
    status TEXT NOT NULL DEFAULT 'healthy',
    last_error_code TEXT,
    last_error TEXT,
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (linked_by_partner_id) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plaid_account_id TEXT UNIQUE,
    item_id TEXT,
    owner_partner_id INTEGER,
    name TEXT NOT NULL,
    official_name TEXT,
    type TEXT NOT NULL DEFAULT 'depository',
    subtype TEXT NOT NULL DEFAULT 'checking',
    mask TEXT DEFAULT '0000',
    balance_current REAL NOT NULL DEFAULT 0.0,
    balance_available REAL NOT NULL DEFAULT 0.0,
    owner_scope TEXT NOT NULL DEFAULT 'shared',
    institution_name TEXT NOT NULL DEFAULT 'Bank Account',
    color TEXT NOT NULL DEFAULT '#06b6d4',
    is_savings_account INTEGER DEFAULT NULL,
    FOREIGN KEY (owner_partner_id) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS account_balance_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    snapshot_month TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0.0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, snapshot_month),
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS deleted_accounts_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plaid_account_id TEXT,
    item_id TEXT,
    institution_name TEXT,
    name TEXT,
    subtype TEXT,
    mask TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    savings_account_id INTEGER,
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
    is_pending INTEGER NOT NULL DEFAULT 0,
    is_savings_spend INTEGER NOT NULL DEFAULT 0,
    is_cc_payment INTEGER NOT NULL DEFAULT 0,
    is_split INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (savings_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
    FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transaction_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_txid ON transaction_splits(transaction_id);

CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL UNIQUE,
    monthly_limit REAL NOT NULL,
    alert_threshold REAL NOT NULL DEFAULT 0.8,
    is_shared INTEGER NOT NULL DEFAULT 1,
    color TEXT NOT NULL DEFAULT '#6366f1',
    allow_rollover INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS monthly_budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_month TEXT NOT NULL,
    category TEXT NOT NULL,
    monthly_limit REAL NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    is_active INTEGER NOT NULL DEFAULT 1,
    allow_rollover INTEGER NOT NULL DEFAULT 0,
    UNIQUE(budget_month, category)
);

CREATE TABLE IF NOT EXISTS category_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_preloaded INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#6366f1',
    allow_rollover INTEGER NOT NULL DEFAULT 0,
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
    is_pending INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS closed_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_month TEXT NOT NULL UNIQUE,
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_by_partner_id INTEGER,
    leftover_amount REAL NOT NULL DEFAULT 0.0,
    transferred_to_savings INTEGER NOT NULL DEFAULT 0,
    savings_account_id INTEGER,
    tasks_completed TEXT NOT NULL DEFAULT '{}',
    recap_data TEXT,
    notes TEXT,
    FOREIGN KEY (closed_by_partner_id) REFERENCES partners (id) ON DELETE SET NULL,
    FOREIGN KEY (savings_account_id) REFERENCES accounts (id) ON DELETE SET NULL
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
        "dashboard",
        "Home Dashboard",
        "Front dashboard with Layered Budget & Savings graph, your personal Spending Money tracker, and accumulated rollover ledger.",
        "Financial",
        "layout-dashboard",
        1,
        0,
    ),
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
        "savings",
        "Savings & Analytics",
        "Track savings & brokerage accounts, transfers into savings, purchases funded from savings, and MoM/YoY balance analytics.",
        "Financial",
        "piggy-bank",
        1,
        3,
    ),
    (
        "future_plans",
        "Future Purchases & Goals",
        "Plan upcoming big purchases together with target dates, monthly contributions, and progress tracking.",
        "Financial",
        "calendar-clock",
        1,
        4,
    ),
    (
        "admin_docs",
        "Couples Admin & Medical",
        "Track medical paperwork, insurance renewals, tax filings, and household admin tasks.",
        "Household & Admin",
        "file-heart",
        1,
        5,
    ),
    (
        "todos",
        "Shared To-Do Lists",
        "Assign and coordinate household chores, errands, and shared couple tasks.",
        "Household & Admin",
        "check-square",
        1,
        6,
    ),
    (
        "groceries",
        "Grocery List",
        "Shared real-time grocery list organized by aisle with estimated basket cost.",
        "Household & Admin",
        "shopping-cart",
        1,
        7,
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
    if "is_pending" not in tx_cols:
        db.execute("ALTER TABLE transactions ADD COLUMN is_pending INTEGER NOT NULL DEFAULT 0")
    if "is_savings_spend" not in tx_cols:
        db.execute("ALTER TABLE transactions ADD COLUMN is_savings_spend INTEGER NOT NULL DEFAULT 0")
    if "is_cc_payment" not in tx_cols:
        db.execute("ALTER TABLE transactions ADD COLUMN is_cc_payment INTEGER NOT NULL DEFAULT 0")
    if "is_split" not in tx_cols:
        db.execute("ALTER TABLE transactions ADD COLUMN is_split INTEGER NOT NULL DEFAULT 0")
    if "savings_account_id" not in tx_cols:
        db.execute("ALTER TABLE transactions ADD COLUMN savings_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL")
    db.execute(
        "UPDATE transactions SET budget_month = substr(date, 1, 7) WHERE budget_month IS NULL OR budget_month = ''"
    )
    db.execute(
        "UPDATE transactions SET is_savings_spend = 1 WHERE LOWER(TRIM(category)) IN ('spent from savings', 'savings spend', 'from savings')"
    )
    db.execute(
        "UPDATE transactions SET is_cc_payment = 1 WHERE LOWER(TRIM(category)) IN ('credit card payment', 'cc payment', 'card payment')"
    )
    db.execute("UPDATE transactions SET notes = '' WHERE TRIM(notes) = 'Synced from Plaid'")
    db.execute("UPDATE income_entries SET notes = '' WHERE TRIM(notes) = 'Synced from Plaid'")
    db.execute(
        "DELETE FROM category_catalog WHERE LOWER(TRIM(name)) IN ('split', 'spent from savings', 'credit card payment', 'split category', 'split transaction')"
    )
    db.execute(
        "DELETE FROM monthly_budgets WHERE LOWER(TRIM(category)) IN ('split', 'spent from savings', 'credit card payment')"
    )
    db.execute(
        "DELETE FROM budgets WHERE LOWER(TRIM(category)) IN ('split', 'spent from savings', 'credit card payment')"
    )

    budget_cols = [r["name"] for r in db.execute("PRAGMA table_info(budgets)").fetchall()]
    if "allow_rollover" not in budget_cols:
        db.execute("ALTER TABLE budgets ADD COLUMN allow_rollover INTEGER NOT NULL DEFAULT 0")

    mb_cols = [r["name"] for r in db.execute("PRAGMA table_info(monthly_budgets)").fetchall()]
    if "allow_rollover" not in mb_cols:
        db.execute("ALTER TABLE monthly_budgets ADD COLUMN allow_rollover INTEGER NOT NULL DEFAULT 0")

    cat_cols = [r["name"] for r in db.execute("PRAGMA table_info(category_catalog)").fetchall()]
    if "allow_rollover" not in cat_cols:
        db.execute("ALTER TABLE category_catalog ADD COLUMN allow_rollover INTEGER NOT NULL DEFAULT 0")

    # One-time migration: ensure any existing "Spending Money" categories have allow_rollover = 1 by default
    rollover_mig = db.execute(
        "SELECT value FROM app_settings WHERE key = 'spending_money_rollover_default_v1'"
    ).fetchone()
    if not rollover_mig:
        db.execute("UPDATE category_catalog SET allow_rollover = 1 WHERE LOWER(name) LIKE '%spending money%'")
        db.execute("UPDATE budgets SET allow_rollover = 1 WHERE LOWER(category) LIKE '%spending money%'")
        db.execute("UPDATE monthly_budgets SET allow_rollover = 1 WHERE LOWER(category) LIKE '%spending money%'")
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('spending_money_rollover_default_v1', '1')"
        )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS transaction_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
        )
        """
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_transaction_splits_txid ON transaction_splits(transaction_id)")

    inc_cols = [r["name"] for r in db.execute("PRAGMA table_info(income_entries)").fetchall()]
    if "category" not in inc_cols:
        db.execute("ALTER TABLE income_entries ADD COLUMN category TEXT NOT NULL DEFAULT ''")
    if "is_pending" not in inc_cols:
        db.execute("ALTER TABLE income_entries ADD COLUMN is_pending INTEGER NOT NULL DEFAULT 0")

    acc_cols = [r["name"] for r in db.execute("PRAGMA table_info(accounts)").fetchall()]
    if "item_id" not in acc_cols:
        db.execute("ALTER TABLE accounts ADD COLUMN item_id TEXT")
    if "owner_partner_id" not in acc_cols:
        db.execute("ALTER TABLE accounts ADD COLUMN owner_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL")
    if "is_savings_account" not in acc_cols:
        db.execute("ALTER TABLE accounts ADD COLUMN is_savings_account INTEGER DEFAULT NULL")
    if "color" not in acc_cols:
        db.execute("ALTER TABLE accounts ADD COLUMN color TEXT NOT NULL DEFAULT '#06b6d4'")
        palette = ["#06b6d4", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#a855f7", "#3b82f6", "#ef4444"]
        existing_accs = db.execute("SELECT id FROM accounts ORDER BY id").fetchall()
        for idx, row in enumerate(existing_accs):
            db.execute(
                "UPDATE accounts SET color = ? WHERE id = ?",
                (palette[idx % len(palette)], row["id"]),
            )

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS account_balance_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            snapshot_month TEXT NOT NULL,
            balance REAL NOT NULL DEFAULT 0.0,
            notes TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(account_id, snapshot_month),
            FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
        )
        """
    )

    plaid_cols = [r["name"] for r in db.execute("PRAGMA table_info(plaid_items)").fetchall()]
    if "cursor" not in plaid_cols:
        db.execute("ALTER TABLE plaid_items ADD COLUMN cursor TEXT")
    if "status" not in plaid_cols:
        db.execute("ALTER TABLE plaid_items ADD COLUMN status TEXT NOT NULL DEFAULT 'healthy'")
    if "last_error_code" not in plaid_cols:
        db.execute("ALTER TABLE plaid_items ADD COLUMN last_error_code TEXT")
    if "last_error" not in plaid_cols:
        db.execute("ALTER TABLE plaid_items ADD COLUMN last_error TEXT")
    if "last_synced_at" not in plaid_cols:
        db.execute("ALTER TABLE plaid_items ADD COLUMN last_synced_at TEXT")

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS deleted_accounts_blocklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plaid_account_id TEXT,
            item_id TEXT,
            institution_name TEXT,
            name TEXT,
            subtype TEXT,
            mask TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

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

    db.execute(
        """
        CREATE TABLE IF NOT EXISTS closed_months (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_month TEXT NOT NULL UNIQUE,
            closed_at TEXT NOT NULL DEFAULT (datetime('now')),
            closed_by_partner_id INTEGER,
            leftover_amount REAL NOT NULL DEFAULT 0.0,
            transferred_to_savings INTEGER NOT NULL DEFAULT 0,
            savings_account_id INTEGER,
            tasks_completed TEXT NOT NULL DEFAULT '{}',
            recap_data TEXT,
            notes TEXT,
            FOREIGN KEY (closed_by_partner_id) REFERENCES partners (id) ON DELETE SET NULL,
            FOREIGN KEY (savings_account_id) REFERENCES accounts (id) ON DELETE SET NULL
        )
        """
    )

    # One-time migration: enforce November (2026-11) starting point & deduplicate duplicate Plaid accounts
    cleanup_row = db.execute(
        "SELECT value FROM app_settings WHERE key = 'november_start_and_dedup_v1'"
    ).fetchone()
    if not cleanup_row:
        # 1. Remove any pre-November (< '2026-11') historical transactions, income entries & monthly budgets
        db.execute(
            "DELETE FROM transactions WHERE COALESCE(NULLIF(budget_month, ''), substr(date, 1, 7)) < '2026-11'"
        )
        db.execute(
            "DELETE FROM income_entries WHERE COALESCE(NULLIF(budget_month, ''), substr(date, 1, 7)) < '2026-11'"
        )
        db.execute("DELETE FROM monthly_budgets WHERE budget_month < '2026-11'")
        db.execute("DELETE FROM monthly_income_projections WHERE budget_month < '2026-11'")

        # 2. Deduplicate duplicate accounts (same institution + mask + subtype + name)
        all_accs = db.execute("SELECT * FROM accounts ORDER BY id ASC").fetchall()
        seen_signatures = {}
        for acc in all_accs:
            sig = (
                (acc["institution_name"] or "").strip().lower(),
                (acc["mask"] or "").strip(),
                (acc["subtype"] or "").strip().lower(),
                (acc["name"] or "").strip().lower(),
            )
            if sig in seen_signatures and acc["plaid_account_id"]:
                # Duplicate account from linking the same bank twice!
                if acc["plaid_account_id"]:
                    db.execute(
                        """
                        INSERT INTO deleted_accounts_blocklist (plaid_account_id, item_id, institution_name, name, subtype, mask)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            acc["plaid_account_id"],
                            acc["item_id"],
                            acc["institution_name"],
                            acc["name"],
                            acc["subtype"],
                            acc["mask"],
                        ),
                    )
                db.execute("DELETE FROM transactions WHERE account_id = ?", (acc["id"],))
                db.execute("DELETE FROM income_entries WHERE account_id = ?", (acc["id"],))
                db.execute("DELETE FROM accounts WHERE id = ?", (acc["id"],))
            else:
                seen_signatures[sig] = acc["id"]

        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('november_start_and_dedup_v1', '1')"
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
    else:
        for mod in DEFAULT_MODULES:
            existing_mod = db.execute("SELECT id FROM module_registry WHERE id = ?", (mod[0],)).fetchone()
            if not existing_mod:
                db.execute(
                    """
                    INSERT INTO module_registry (id, name, description, category, icon, enabled, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    mod,
                )
            else:
                db.execute(
                    "UPDATE module_registry SET sort_order = ?, icon = ? WHERE id = ?",
                    (mod[6], mod[4], mod[0]),
                )
    defaults = {
        "onboarding_completed": "0",
        "household_name": "Gibson Household",
        "state_version": str(int(time.time() * 1000)),
        "plaid_banner_dismissed": "0",
        "last_plaid_sync_at": "",
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
    db.commit()
