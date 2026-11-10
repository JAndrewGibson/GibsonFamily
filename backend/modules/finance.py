from datetime import date, datetime, timezone
import threading
import requests
from flask import Blueprint, current_app, g, jsonify, request
from backend.database import bump_state_version, get_db
from backend.security import decrypt_plaid_token, encrypt_plaid_token

finance_bp = Blueprint("finance", __name__, url_prefix="/api/finance")

STARTING_BUDGET_MONTH = "2026-11"

ACCOUNT_COLOR_PALETTE = [
    "#06b6d4",
    "#6366f1",
    "#10b981",
    "#f59e0b",
    "#ec4899",
    "#a855f7",
    "#3b82f6",
    "#ef4444",
    "#14b8a6",
    "#f97316",
]

DEFAULT_CATEGORIES = [
    "Groceries & Dining",
    "Housing & Utilities",
    "Entertainment & Gaming",
    "Shopping & Tech",
    "Health & Medical",
    "Travel & Experiences",
    "Future Purchase Savings",
]

# Classification of Inflows:
# Only REAL_INCOME_TYPES (Payroll / Paycheck / Commission / Bonus / Earned Income) count as Actual Monthly Income.
# Returns/Refunds are excluded from income and credited back to category budgets to maintain equilibrium.
# Credit Card Payments and Account Transfers are non-income transfers excluded from income.
REAL_INCOME_TYPES = {
    "payroll",
    "paycheck",
    "salary",
    "variable",
    "commission",
    "bonus",
    "side_income",
    "other",
    "other_income",
}
RETURN_TYPES = {"return", "refund"}
NON_INCOME_TYPES = {"cc_payment", "credit_card_payment", "transfer", "account_transfer", "savings_transfer", "transfer_to_savings"}

SAVINGS_SPEND_CATEGORY = "Spent from Savings"
SAVINGS_SPEND_ALIASES = {"spent from savings", "savings spend", "from savings", "savings withdrawal"}

CC_PAYMENT_CATEGORY = "Credit Card Payment"
CC_PAYMENT_ALIASES = {"credit card payment", "cc payment", "card payment"}

SAVINGS_SUBTYPES = {
    "savings",
    "hysa",
    "high yield savings",
    "money market",
    "cd",
    "certificate of deposit",
    "cash management",
    "isa",
    "christmas club",
}

BROKERAGE_SUBTYPES = {
    "brokerage",
    "investment",
    "ira",
    "roth",
    "roth ira",
    "401k",
    "403b",
    "529",
    "hsa",
    "health savings",
    "pension",
    "retirement",
    "ugma",
    "utma",
    "trust",
    "mutual fund",
    "stock",
    "etf",
    "crypto",
}


def is_tx_savings_spend(tx: dict) -> bool:
    if bool(tx.get("is_savings_spend")):
        return True
    cat = (tx.get("category") or "").strip().lower()
    return cat in SAVINGS_SPEND_ALIASES


def is_tx_cc_payment(tx: dict) -> bool:
    if bool(tx.get("is_cc_payment")):
        return True
    cat = (tx.get("category") or "").strip().lower()
    return cat in CC_PAYMENT_ALIASES


def classify_savings_account(acc: dict) -> dict:
    acc_type = (acc.get("type") or "").strip().lower()
    acc_subtype = (acc.get("subtype") or "").strip().lower()
    combined_name = f"{acc.get('name') or ''} {acc.get('official_name') or ''} {acc_subtype}".lower()

    is_brokerage_like = (
        acc_type in ("investment", "brokerage")
        or acc_subtype in BROKERAGE_SUBTYPES
        or any(
            k in combined_name
            for k in (
                "brokerage",
                "invest",
                "401k",
                "403b",
                "ira",
                "roth",
                "529",
                "fidelity",
                "vanguard",
                "schwab",
                "wealthfront",
                "betterment",
                "robinhood",
            )
        )
    )
    is_savings_like = (
        acc_subtype in SAVINGS_SUBTYPES
        or any(
            k in combined_name
            for k in ("saving", "hysa", "money market", "emergency fund", "reserve", "vault", "high yield")
        )
    )

    explicit_flag = acc.get("is_savings_account")
    if explicit_flag is not None and str(explicit_flag).strip() != "":
        is_tracked = bool(int(explicit_flag))
    else:
        if acc_type in ("credit", "loan"):
            is_tracked = False
        elif is_brokerage_like or (is_savings_like and acc_subtype != "checking"):
            is_tracked = True
        else:
            is_tracked = False

    if is_brokerage_like:
        bucket = "brokerage"
    elif is_tracked or is_savings_like:
        bucket = "savings"
    else:
        bucket = "other"

    return {
        "is_savings_or_brokerage": is_tracked,
        "savings_bucket": bucket,
    }


def _upsert_account_balance_snapshot(
    db, account_id: int | None, balance: float, ym: str | None = None, notes: str | None = None
) -> None:
    if not account_id:
        return
    target_ym = (ym or max(date.today().strftime("%Y-%m"), STARTING_BUDGET_MONTH)).strip()[:7]
    if len(target_ym) != 7:
        return
    db.execute(
        """
        INSERT INTO account_balance_snapshots (account_id, snapshot_month, balance, notes, updated_at)
        VALUES (?, ?, ?, COALESCE(?, 'Auto-recorded balance'), datetime('now'))
        ON CONFLICT(account_id, snapshot_month) DO UPDATE SET
            balance = excluded.balance,
            notes = COALESCE(?, account_balance_snapshots.notes),
            updated_at = datetime('now')
        """,
        (int(account_id), target_ym, round(float(balance or 0.0), 2), notes, notes),
    )


def is_real_earned_income(itype: str) -> bool:
    return (itype or "").strip().lower() in REAL_INCOME_TYPES


def is_return_refund(itype: str) -> bool:
    return (itype or "").strip().lower() in RETURN_TYPES


def is_transfer_or_cc_payment(itype: str) -> bool:
    return (itype or "").strip().lower() in NON_INCOME_TYPES


def _shift_year_month(ym: str, delta_months: int) -> str:
    """Shifts a YYYY-MM string by delta_months (e.g., -1 for previous month, +1 for next month)."""
    try:
        year, month = int(ym[:4]), int(ym[5:7])
        total_months = (year * 12 + (month - 1)) + delta_months
        new_year = total_months // 12
        new_month = (total_months % 12) + 1
        return f"{new_year:04d}-{new_month:02d}"
    except Exception:
        return date.today().strftime("%Y-%m")


def _ensure_category_in_catalog(db, name: str, is_preloaded: int = 0, unarchive: bool = True) -> None:
    clean = (name or "").strip()
    if not clean:
        return
    db.execute(
        """
        INSERT INTO category_catalog (name, is_preloaded, is_archived, color)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(name) DO UPDATE SET
            is_archived = CASE WHEN ? THEN 0 ELSE category_catalog.is_archived END
        """,
        (clean, 1 if is_preloaded else 0, "#6366f1" if is_preloaded else "#06b6d4", 1 if unarchive else 0),
    )


def _sync_category_catalog(db) -> list[dict]:
    """
    Ensures pre-loaded DEFAULT_CATEGORIES and any custom categories from budgets/transactions
    are registered in `category_catalog` without resurrecting categories the user archived/removed.
    """
    for def_cat in DEFAULT_CATEGORIES:
        db.execute(
            """
            INSERT OR IGNORE INTO category_catalog (name, is_preloaded, is_archived, color)
            VALUES (?, 1, 0, '#6366f1')
            """,
            (def_cat,),
        )

    discovered = db.execute(
        """
        SELECT DISTINCT category FROM budgets
        UNION
        SELECT DISTINCT category FROM monthly_budgets WHERE is_active = 1
        UNION
        SELECT DISTINCT category FROM transactions
        """
    ).fetchall()
    for r in discovered:
        cat_name = (r["category"] or "").strip()
        if cat_name:
            db.execute(
                """
                INSERT OR IGNORE INTO category_catalog (name, is_preloaded, is_archived, color)
                VALUES (?, ?, 0, '#06b6d4')
                """,
                (cat_name, 1 if cat_name in DEFAULT_CATEGORIES else 0),
            )
    db.commit()
    return [
        dict(r)
        for r in db.execute(
            "SELECT * FROM category_catalog ORDER BY is_archived ASC, is_preloaded DESC, name ASC"
        ).fetchall()
    ]


def _build_category_management_payload(
    db,
    selected_month: str,
    month_budgets: list[dict],
    month_transactions: list[dict],
    all_transactions: list[dict],
) -> dict:
    catalog_rows = _sync_category_catalog(db)
    tracked_map = {
        b["category"]: b
        for b in month_budgets
        if b.get("is_active", 1) and float(b.get("monthly_limit") or 0) > 0
    }

    month_spend_map = {}
    month_cnt_map = {}
    for tx in month_transactions:
        if is_tx_savings_spend(tx) or is_tx_cc_payment(tx):
            continue
        if tx.get("is_split") and tx.get("splits"):
            for sp in tx["splits"]:
                sp_cat = (sp.get("category") or "").strip()
                if sp_cat:
                    month_spend_map[sp_cat] = month_spend_map.get(sp_cat, 0.0) + float(sp.get("amount") or 0.0)
                    month_cnt_map[sp_cat] = month_cnt_map.get(sp_cat, 0) + 1
        else:
            cat = (tx.get("category") or "").strip()
            if cat:
                month_spend_map[cat] = month_spend_map.get(cat, 0.0) + float(tx.get("amount") or 0.0)
                month_cnt_map[cat] = month_cnt_map.get(cat, 0) + 1

    all_spend_map = {}
    all_cnt_map = {}
    for tx in all_transactions:
        if is_tx_savings_spend(tx) or is_tx_cc_payment(tx):
            continue
        if tx.get("is_split") and tx.get("splits"):
            for sp in tx["splits"]:
                sp_cat = (sp.get("category") or "").strip()
                if sp_cat:
                    all_spend_map[sp_cat] = all_spend_map.get(sp_cat, 0.0) + float(sp.get("amount") or 0.0)
                    all_cnt_map[sp_cat] = all_cnt_map.get(sp_cat, 0) + 1
        else:
            cat = (tx.get("category") or "").strip()
            if cat:
                all_spend_map[cat] = all_spend_map.get(cat, 0.0) + float(tx.get("amount") or 0.0)
                all_cnt_map[cat] = all_cnt_map.get(cat, 0) + 1

    enriched_catalog = []
    for row in catalog_rows:
        cat_name = row["name"]
        if cat_name.strip().lower() in SAVINGS_SPEND_ALIASES or cat_name.strip().lower() in CC_PAYMENT_ALIASES:
            continue
        is_tracked = cat_name in tracked_map
        b_row = tracked_map.get(cat_name)
        m_spent = round(month_spend_map.get(cat_name, 0.0), 2)
        m_cnt = month_cnt_map.get(cat_name, 0)
        tot_spent = round(all_spend_map.get(cat_name, 0.0), 2)
        tot_cnt = all_cnt_map.get(cat_name, 0)
        enriched_catalog.append({
            "id": row["id"],
            "name": cat_name,
            "is_preloaded": bool(row["is_preloaded"]),
            "is_custom": not bool(row["is_preloaded"]),
            "is_archived": bool(row["is_archived"]),
            "color": b_row["color"] if b_row else row["color"],
            "is_tracked": is_tracked,
            "monthly_limit": round(float(b_row["monthly_limit"]), 2) if b_row else 0.0,
            "budget_id": b_row["id"] if b_row else None,
            "month_spent": m_spent,
            "month_tx_count": m_cnt,
            "total_spent_all_time": tot_spent,
            "total_tx_count": tot_cnt,
        })

    # Active categories for dropdowns: non-archived catalog categories + any category actively budgeted this month
    active_categories = [
        c["name"]
        for c in enriched_catalog
        if not c["is_archived"] or c["is_tracked"]
    ]

    # Untracked categories: active (or having spend in selected_month) but NO active budget in selected_month
    untracked_categories = [
        c
        for c in enriched_catalog
        if not c["is_tracked"]
        and c["name"].strip().lower() not in SAVINGS_SPEND_ALIASES
        and (not c["is_archived"] or c["month_tx_count"] > 0)
    ]
    untracked_categories.sort(
        key=lambda c: (-c["month_spent"], -c["month_tx_count"], -c["total_tx_count"], c["name"])
    )
    untracked_monthly_spent = round(sum(c["month_spent"] for c in untracked_categories), 2)

    return {
        "active_categories": active_categories,
        "categories_catalog": enriched_catalog,
        "untracked_categories": untracked_categories,
        "untracked_count": len(untracked_categories),
        "untracked_with_spend_count": sum(1 for c in untracked_categories if c["month_spent"] > 0),
        "untracked_monthly_spent": untracked_monthly_spent,
    }


def _ensure_monthly_budgets_for_month(db, ym: str) -> list[dict]:
    """
    Ensures `monthly_budgets` has entries for `ym` (copying from the closest prior month or base `budgets` table if uninitialized)
    and returns active budget rows for `ym`.
    """
    existing = db.execute(
        "SELECT * FROM monthly_budgets WHERE budget_month = ? ORDER BY id",
        (ym,),
    ).fetchall()

    if not existing:
        # Check if there is a prior month in monthly_budgets to inherit from
        prior_month_row = db.execute(
            "SELECT DISTINCT budget_month FROM monthly_budgets WHERE budget_month < ? ORDER BY budget_month DESC LIMIT 1",
            (ym,),
        ).fetchone()

        if prior_month_row:
            source_rows = db.execute(
                "SELECT category, monthly_limit, color FROM monthly_budgets WHERE budget_month = ? AND is_active = 1",
                (prior_month_row["budget_month"],),
            ).fetchall()
        else:
            source_rows = db.execute(
                "SELECT category, monthly_limit, color FROM budgets ORDER BY id"
            ).fetchall()

        if source_rows:
            for r in source_rows:
                db.execute(
                    """
                    INSERT OR IGNORE INTO monthly_budgets (budget_month, category, monthly_limit, color, is_active)
                    VALUES (?, ?, ?, ?, 1)
                    """,
                    (ym, r["category"], r["monthly_limit"], r["color"]),
                )
            db.commit()

    active_rows = db.execute(
        "SELECT * FROM monthly_budgets WHERE budget_month = ? AND is_active = 1 ORDER BY id",
        (ym,),
    ).fetchall()
    return [dict(r) for r in active_rows]


def _plaid_headers_and_auth():
    client_id = current_app.config.get("PLAID_CLIENT_ID", "")
    secret = current_app.config.get("PLAID_SECRET", "")
    base_url = current_app.config.get("PLAID_BASE_URL", "https://production.plaid.com")
    return base_url, client_id, secret


def _get_plaid_sync_freshness(db) -> tuple[str, float | None, bool]:
    row = db.execute("SELECT value FROM app_settings WHERE key = 'last_plaid_sync_at'").fetchone()
    last_sync_str = (row["value"] or "").strip() if row else ""
    if not last_sync_str:
        return "", None, True
    try:
        dt = datetime.fromisoformat(last_sync_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        elapsed_hours = max(0.0, (now_utc - dt).total_seconds() / 3600.0)
        return last_sync_str, round(elapsed_hours, 2), elapsed_hours >= 12.0
    except Exception:
        return last_sync_str, None, True


@finance_bp.route("/plaid/status", methods=["GET"])
def plaid_status():
    base_url, client_id, secret = _plaid_headers_and_auth()
    env_name = current_app.config.get("PLAID_ENV", "production")
    db = get_db()
    items = []
    for r in db.execute(
        "SELECT id, item_id, institution_name, linked_by_partner_id, cursor, status, last_error_code, last_error, last_synced_at, created_at FROM plaid_items ORDER BY id DESC"
    ).fetchall():
        item_dict = dict(r)
        acc_cnt = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE item_id = ? OR (item_id IS NULL AND institution_name = ?)",
            (item_dict["item_id"], item_dict["institution_name"]),
        ).fetchone()["cnt"]
        item_dict["account_count"] = acc_cnt
        item_dict["has_cursor"] = bool(item_dict.get("cursor"))
        item_dict["requires_reauth"] = bool(
            item_dict.get("status") == "error"
            and item_dict.get("last_error_code") in [
                "ITEM_LOGIN_REQUIRED",
                "PENDING_EXPIRATION",
                "ITEM_LOCKED",
                "USER_PERMISSION_REVOKED",
                "INVALID_CREDENTIALS",
                "MFA_NOT_SUPPORTED",
            ]
        )
        items.append(item_dict)

    dismissed_row = db.execute(
        "SELECT value FROM app_settings WHERE key = 'plaid_banner_dismissed'"
    ).fetchone()
    banner_dismissed = bool(dismissed_row and dismissed_row["value"] == "1")
    last_sync_str, elapsed_hours, is_stale = _get_plaid_sync_freshness(db)

    return jsonify({
        "configured": bool(client_id and secret),
        "environment": env_name,
        "is_production": env_name == "production",
        "base_url": base_url,
        "client_id_preview": f"{client_id[:6]}...{client_id[-4:]}" if len(client_id) >= 10 else ("configured" if client_id else ""),
        "linked_items": items,
        "has_items_requiring_reauth": any(it.get("requires_reauth") for it in items),
        "banner_dismissed": banner_dismissed,
        "last_plaid_sync_at": last_sync_str,
        "hours_since_last_sync": elapsed_hours,
        "needs_auto_sync": bool(len(items) > 0 and is_stale),
    })


@finance_bp.route("/plaid/dismiss-banner", methods=["POST"])
def dismiss_plaid_banner():
    data = request.get_json(silent=True) or {}
    dismissed = "1" if data.get("dismissed", True) else "0"
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('plaid_banner_dismissed', ?)",
        (dismissed,),
    )
    db.commit()
    return jsonify({"banner_dismissed": dismissed == "1"})


@finance_bp.route("/plaid/create_link_token", methods=["POST"])
def create_link_token():
    base_url, client_id, secret = _plaid_headers_and_auth()
    if not client_id or not secret:
        return jsonify({"error": "Plaid credentials (plaid_client_id / plaid_production_secret) are missing in environment"}), 400

    data = request.get_json(silent=True) or {}
    actor = getattr(g, "current_partner", None)
    partner_id = str(actor["id"] if actor else data.get("partner_id", "1"))
    target_item_id = data.get("item_id")

    base_payload = {
        "client_id": client_id,
        "secret": secret,
        "client_name": "GibsonFamily Financial Hub",
        "user": {"client_user_id": f"gibson-partner-{partner_id}"},
        "country_codes": ["US"],
        "language": "en",
    }

    db = get_db()
    # If targeting an existing item, initialize Plaid Link in UPDATE MODE
    if target_item_id:
        item_row = db.execute("SELECT access_token FROM plaid_items WHERE item_id = ?", (target_item_id,)).fetchone()
        if not item_row or not item_row["access_token"]:
            return jsonify({"error": f"Plaid item '{target_item_id}' not found"}), 404
        raw_access_token = decrypt_plaid_token(item_row["access_token"])
        base_payload["access_token"] = raw_access_token
        # In Plaid Update Mode, products array must NOT be included
    else:
        # Standard initial link mode
        base_payload["products"] = ["transactions"]

    configured_uri = (current_app.config.get("PLAID_REDIRECT_URI") or "https://gibsonfamily.onrender.com").strip()
    if configured_uri.startswith("https://"):
        base_payload["webhook"] = f"{configured_uri.rstrip('/')}/api/finance/plaid/webhook"

    uri_candidates = []
    if configured_uri.startswith("https://"):
        no_slash = configured_uri.rstrip("/")
        with_slash = no_slash + "/"
        uri_candidates = [no_slash, with_slash, None]
    else:
        uri_candidates = [None]

    try:
        last_resp = None
        last_data = {}
        for candidate_uri in uri_candidates:
            payload = dict(base_payload)
            if candidate_uri:
                payload["redirect_uri"] = candidate_uri
            resp = requests.post(f"{base_url}/link/token/create", json=payload, timeout=15)
            resp_data = resp.json()
            if resp.status_code == 200:
                resp_data["used_redirect_uri"] = candidate_uri
                return jsonify(resp_data)
            last_resp = resp
            last_data = resp_data
            err_msg = (resp_data.get("error_message") or "").lower()
            if "redirect" not in err_msg and "uri" not in err_msg:
                break

        return jsonify({
            "error": last_data.get("error_message", "Plaid link token error"),
            "details": last_data,
        }), (last_resp.status_code if last_resp is not None else 400)
    except requests.RequestException as exc:
        return jsonify({"error": f"Unable to reach Plaid API: {exc}"}), 502


def _sync_plaid_accounts_and_transactions(
    access_token: str,
    institution_name: str,
    partner_id: int | None,
    item_id: str | None = None,
    reset_cursor: bool = False,
) -> tuple[int, int, str | None]:
    base_url, client_id, secret = _plaid_headers_and_auth()
    db = get_db()

    acc_resp = requests.post(
        f"{base_url}/accounts/get",
        json={"client_id": client_id, "secret": secret, "access_token": access_token},
        timeout=15,
    )
    acc_data = acc_resp.json()
    if acc_resp.status_code != 200:
        err_code = acc_data.get("error_code", "ACCOUNTS_GET_ERROR")
        err_msg = acc_data.get("error_message", "Failed to retrieve accounts from Plaid")
        if item_id:
            db.execute(
                "UPDATE plaid_items SET status = 'error', last_error_code = ?, last_error = ? WHERE item_id = ?",
                (err_code, err_msg, item_id),
            )
            db.commit()
        return 0, 0, f"{err_code}: {err_msg}"

    if not item_id and "item" in acc_data and "item_id" in acc_data["item"]:
        item_id = acc_data["item"]["item_id"]

    imported_accounts = 0
    account_id_map = {}

    # Load permanently deleted accounts blocklist so deleted Plaid accounts never reappear
    blocked_rows = db.execute(
        "SELECT plaid_account_id, institution_name, name, subtype, mask FROM deleted_accounts_blocklist"
    ).fetchall()
    blocked_plaid_ids = {r["plaid_account_id"] for r in blocked_rows if r["plaid_account_id"]}
    blocked_sigs = {
        (
            (r["institution_name"] or "").strip().lower(),
            (r["mask"] or "").strip(),
            (r["subtype"] or "").strip().lower(),
            (r["name"] or "").strip().lower(),
        )
        for r in blocked_rows
    }

    existing_count = db.execute("SELECT COUNT(*) AS cnt FROM accounts").fetchone()["cnt"]

    for acc in acc_data.get("accounts", []):
        plaid_acc_id = acc.get("account_id")
        acc_name = acc.get("name", "Plaid Account")
        acc_subtype = acc.get("subtype", "checking")
        acc_mask = acc.get("mask") or "0000"
        sig = (
            (institution_name or "").strip().lower(),
            acc_mask.strip(),
            (acc_subtype or "").strip().lower(),
            (acc_name or "").strip().lower(),
        )

        # 1. Skip if this account or its signature was explicitly deleted by a user
        if (plaid_acc_id and plaid_acc_id in blocked_plaid_ids) or sig in blocked_sigs:
            continue

        # 2. Prevent duplicate accounts when the same bank was accidentally linked twice
        dup_existing = db.execute(
            """
            SELECT id, plaid_account_id FROM accounts
            WHERE LOWER(COALESCE(institution_name, '')) = ?
              AND COALESCE(mask, '') = ?
              AND LOWER(COALESCE(subtype, '')) = ?
              AND LOWER(COALESCE(name, '')) = ?
            ORDER BY id ASC
            LIMIT 1
            """,
            sig,
        ).fetchone()
        if dup_existing and dup_existing["plaid_account_id"] and dup_existing["plaid_account_id"] != plaid_acc_id:
            # Map transactions to the existing primary account so we don't double-count accounts or drop transactions
            account_id_map[plaid_acc_id] = dup_existing["id"]
            continue

        balances = acc.get("balances") or {}
        current_bal = float(balances.get("current") or 0.0)
        avail_bal = float(balances.get("available") if balances.get("available") is not None else current_bal)
        default_color = ACCOUNT_COLOR_PALETTE[(existing_count + imported_accounts) % len(ACCOUNT_COLOR_PALETTE)]

        db.execute(
            """
            INSERT INTO accounts (plaid_account_id, item_id, owner_partner_id, name, official_name, type, subtype, mask, balance_current, balance_available, owner_scope, institution_name, color)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shared', ?, ?)
            ON CONFLICT(plaid_account_id) DO UPDATE SET
                item_id = COALESCE(excluded.item_id, accounts.item_id),
                owner_partner_id = COALESCE(accounts.owner_partner_id, excluded.owner_partner_id),
                balance_current = excluded.balance_current,
                balance_available = excluded.balance_available
            """,
            (
                plaid_acc_id,
                item_id,
                partner_id,
                acc_name,
                acc.get("official_name") or acc_name,
                acc.get("type", "depository"),
                acc_subtype,
                acc_mask,
                current_bal,
                avail_bal,
                institution_name,
                default_color,
            ),
        )
        row = db.execute("SELECT id FROM accounts WHERE plaid_account_id = ?", (plaid_acc_id,)).fetchone()
        if row:
            account_id_map[plaid_acc_id] = row["id"]
            _upsert_account_balance_snapshot(db, row["id"], current_bal)
        imported_accounts += 1

    # Ensure account_id_map includes all known local accounts for mapping
    for r in db.execute("SELECT id, plaid_account_id FROM accounts WHERE plaid_account_id IS NOT NULL").fetchall():
        if r["plaid_account_id"] and r["plaid_account_id"] not in account_id_map:
            account_id_map[r["plaid_account_id"]] = r["id"]

    # 1. Ask Plaid for an on-demand transaction refresh from the financial institution
    try:
        requests.post(
            f"{base_url}/transactions/refresh",
            json={"client_id": client_id, "secret": secret, "access_token": access_token},
            timeout=8,
        )
    except Exception:
        pass

    # 2. Retrieve last stored cursor for incremental sync (or None for initial pull / forced reset)
    cursor = None
    if reset_cursor and item_id:
        db.execute("UPDATE plaid_items SET cursor = NULL WHERE item_id = ?", (item_id,))
    elif item_id:
        item_row = db.execute("SELECT cursor FROM plaid_items WHERE item_id = ?", (item_id,)).fetchone()
        if item_row and item_row["cursor"]:
            cursor = item_row["cursor"]

    # 3. Paginate through all pages until has_more is False to reach the latest pending transactions
    imported_txs = 0
    has_more = True
    pages = 0
    max_pages = 25  # up to 25 * 500 = 12,500 transactions

    while has_more and pages < max_pages:
        pages += 1
        sync_payload = {
            "client_id": client_id,
            "secret": secret,
            "access_token": access_token,
            "count": 500,
            "options": {
                "include_personal_finance_category": True,
            },
        }
        if cursor:
            sync_payload["cursor"] = cursor

        tx_resp = requests.post(f"{base_url}/transactions/sync", json=sync_payload, timeout=20)
        tx_data = tx_resp.json()
        if tx_resp.status_code != 200:
            err_code = tx_data.get("error_code", "SYNC_ERROR")
            err_msg = tx_data.get("error_message", "Transactions sync failed")
            # If cursor is invalid or pagination was mutated at the bank, reset cursor and retry from beginning
            if cursor and err_code in ["TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "INVALID_CURSOR"]:
                cursor = None
                continue
            if item_id:
                db.execute(
                    "UPDATE plaid_items SET status = 'error', last_error_code = ?, last_error = ? WHERE item_id = ?",
                    (err_code, err_msg, item_id),
                )
                db.commit()
            return imported_accounts, imported_txs, f"{err_code}: {err_msg}"

        has_more = bool(tx_data.get("has_more", False))
        cursor = tx_data.get("next_cursor") or cursor

        for tx in tx_data.get("added", []):
            local_acc_id = account_id_map.get(tx.get("account_id"))
            if not local_acc_id:
                # Skip transactions belonging to deleted or deduplicated accounts
                continue

            amount = float(tx.get("amount") or 0.0)
            pfc = (tx.get("personal_finance_category") or {}).get("primary", "")
            tx_date = (
                tx.get("authorized_date")
                or tx.get("date")
                or (tx.get("authorized_datetime") or "")[:10]
                or (tx.get("datetime") or "")[:10]
                or date.today().isoformat()
            )
            tx_budget_month = tx_date[:7]
            is_pending = 1 if tx.get("pending") else 0
            pending_tx_id = tx.get("pending_transaction_id")

            # Enforce November (STARTING_BUDGET_MONTH) starting point for synced transactions
            if tx_budget_month < STARTING_BUDGET_MONTH:
                continue

            # In Plaid, negative amounts or INCOME / TRANSFER_IN primary category represent inflows/deposits
            if amount < 0 or pfc in ("INCOME", "TRANSFER_IN"):
                inc_amt = round(abs(amount), 2)
                if inc_amt > 0:
                    name_str = (tx.get("merchant_name") or tx.get("name") or "Plaid Deposit").strip()
                    name_lower = name_str.lower()
                    acc_row = db.execute("SELECT * FROM accounts WHERE id = ?", (local_acc_id,)).fetchone()
                    acc_dict = dict(acc_row) if acc_row else {}
                    is_credit_acc = bool(acc_dict and (acc_dict.get("type") == "credit" or "credit" in (acc_dict.get("subtype") or "").lower()))
                    is_sav_acc = classify_savings_account(acc_dict)["is_savings_or_brokerage"] if acc_dict else False

                    category_map = {
                        "FOOD_AND_DRINK": "Groceries & Dining",
                        "GENERAL_MERCHANDISE": "Shopping & Tech",
                        "ENTERTAINMENT": "Entertainment & Gaming",
                        "MEDICAL": "Health & Medical",
                        "RENT_AND_UTILITIES": "Housing & Utilities",
                        "TRAVEL": "Travel & Experiences",
                    }
                    mapped_cat = category_map.get(pfc, "Shopping & Tech")

                    # Auto-classify inflow: Credit Card Payment, Return, Account/Savings Transfer, or Payroll
                    if is_credit_acc or any(w in name_lower for w in ["payment", "autopay", "thank you", "card payment", "bill pay"]):
                        auto_income_type = "cc_payment"
                        ret_cat = ""
                    elif any(w in name_lower for w in ["return", "refund", "reimbursement", "credit for return"]) or pfc in ["GENERAL_MERCHANDISE", "FOOD_AND_DRINK", "ENTERTAINMENT"]:
                        auto_income_type = "return"
                        ret_cat = mapped_cat
                    elif (
                        pfc == "TRANSFER_IN"
                        or any(w in name_lower for w in ["transfer", "zelle", "venmo", "xfer", "wire", "deposit transfer", "internal transfer", "contribution"])
                        or (is_sav_acc and not any(w in name_lower for w in ["payroll", "salary", "paycheck", "direct dep"]))
                    ):
                        auto_income_type = "transfer"
                        ret_cat = ""
                    else:
                        auto_income_type = "payroll"
                        ret_cat = ""

                    # If this settled transaction replaces an earlier pending deposit, upgrade it in-place
                    if pending_tx_id:
                        existing_pending_inc = db.execute(
                            "SELECT id FROM income_entries WHERE plaid_transaction_id = ?",
                            (pending_tx_id,),
                        ).fetchone()
                        if existing_pending_inc:
                            db.execute(
                                """
                                UPDATE income_entries
                                SET plaid_transaction_id = ?, date = ?, amount = ?, source_name = ?, is_pending = ?
                                WHERE id = ?
                                """,
                                (tx.get("transaction_id"), tx_date, inc_amt, name_str, is_pending, existing_pending_inc["id"]),
                            )
                            continue

                    db.execute(
                        """
                        INSERT INTO income_entries
                        (partner_id, account_id, plaid_transaction_id, date, budget_month, source_name, amount, expected_monthly_amount, income_type, category, is_recurring, notes, is_pending)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
                        ON CONFLICT(plaid_transaction_id) DO UPDATE SET
                            is_pending = excluded.is_pending,
                            amount = excluded.amount,
                            date = excluded.date,
                            source_name = excluded.source_name
                        """,
                        (
                            partner_id,
                            local_acc_id,
                            tx.get("transaction_id"),
                            tx_date,
                            tx_budget_month,
                            name_str,
                            inc_amt,
                            inc_amt if auto_income_type == "payroll" else 0.0,
                            auto_income_type,
                            ret_cat,
                            1 if auto_income_type == "payroll" else 0,
                            is_pending,
                        ),
                    )
                continue

            if amount == 0:
                continue

            category_map = {
                "FOOD_AND_DRINK": "Groceries & Dining",
                "GENERAL_MERCHANDISE": "Shopping & Tech",
                "ENTERTAINMENT": "Entertainment & Gaming",
                "MEDICAL": "Health & Medical",
                "RENT_AND_UTILITIES": "Housing & Utilities",
                "TRAVEL": "Travel & Experiences",
            }
            mapped_cat = category_map.get(pfc, "Shopping & Tech")

            # If this posted transaction replaces an earlier pending transaction, upgrade it in-place to preserve user's assigned category
            if pending_tx_id:
                existing_pending_tx = db.execute(
                    "SELECT id FROM transactions WHERE plaid_transaction_id = ?",
                    (pending_tx_id,),
                ).fetchone()
                if existing_pending_tx:
                    db.execute(
                        """
                        UPDATE transactions
                        SET plaid_transaction_id = ?,
                            date = ?,
                            amount = ?,
                            name = ?,
                            merchant_name = ?,
                            is_pending = ?
                        WHERE id = ?
                        """,
                        (
                            tx.get("transaction_id"),
                            tx_date,
                            round(amount, 2),
                            tx.get("name", "Plaid Transaction"),
                            tx.get("merchant_name") or tx.get("name"),
                            is_pending,
                            existing_pending_tx["id"],
                        ),
                    )
                    imported_txs += 1
                    continue

            db.execute(
                """
                INSERT INTO transactions
                (account_id, plaid_transaction_id, date, budget_month, name, merchant_name, amount, category, partner_id, is_shared, notes, is_pending)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?)
                ON CONFLICT(plaid_transaction_id) DO UPDATE SET
                    is_pending = excluded.is_pending,
                    amount = excluded.amount,
                    date = excluded.date,
                    name = excluded.name,
                    merchant_name = excluded.merchant_name
                """,
                (
                    local_acc_id,
                    tx.get("transaction_id"),
                    tx_date,
                    tx_budget_month,
                    tx.get("name", "Plaid Transaction"),
                    tx.get("merchant_name") or tx.get("name"),
                    round(amount, 2),
                    mapped_cat,
                    partner_id,
                    is_pending,
                ),
            )
            imported_txs += 1

        # Process modified transactions (e.g., pending transitions to posted or amounts adjust)
        for mtx in tx_data.get("modified", []):
            m_plaid_id = mtx.get("transaction_id")
            if not m_plaid_id:
                continue
            m_pending = 1 if mtx.get("pending") else 0
            m_amt = float(mtx.get("amount") or 0.0)
            m_date = (
                mtx.get("authorized_date")
                or mtx.get("date")
                or (mtx.get("authorized_datetime") or "")[:10]
                or (mtx.get("datetime") or "")[:10]
                or date.today().isoformat()
            )
            db.execute(
                """
                UPDATE transactions
                SET is_pending = ?,
                    amount = ?,
                    date = ?,
                    name = COALESCE(?, name),
                    merchant_name = COALESCE(?, merchant_name)
                WHERE plaid_transaction_id = ?
                """,
                (
                    m_pending,
                    round(m_amt, 2),
                    m_date,
                    mtx.get("name"),
                    mtx.get("merchant_name") or mtx.get("name"),
                    m_plaid_id,
                ),
            )
            db.execute(
                """
                UPDATE income_entries
                SET is_pending = ?,
                    amount = ?,
                    date = ?,
                    source_name = COALESCE(?, source_name)
                WHERE plaid_transaction_id = ?
                """,
                (
                    m_pending,
                    round(abs(m_amt), 2),
                    m_date,
                    mtx.get("merchant_name") or mtx.get("name"),
                    m_plaid_id,
                ),
            )

        # Process removed transactions (e.g., cancelled pending items)
        for rtx in tx_data.get("removed", []):
            r_id = rtx.get("transaction_id") if isinstance(rtx, dict) else rtx
            if r_id:
                db.execute("DELETE FROM transactions WHERE plaid_transaction_id = ? AND is_pending = 1", (r_id,))
                db.execute("DELETE FROM income_entries WHERE plaid_transaction_id = ? AND is_pending = 1", (r_id,))

    # Save latest cursor for subsequent incremental syncs
    if cursor and item_id:
        db.execute("UPDATE plaid_items SET cursor = ? WHERE item_id = ?", (cursor, item_id))

    now_iso = datetime.now(timezone.utc).isoformat()
    if item_id:
        db.execute(
            "UPDATE plaid_items SET status = 'healthy', last_error_code = NULL, last_error = NULL, last_synced_at = ? WHERE item_id = ?",
            (now_iso, item_id),
        )
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_plaid_sync_at', ?)",
        (now_iso,),
    )
    db.commit()
    return imported_accounts, imported_txs, None


@finance_bp.route("/plaid/exchange_public_token", methods=["POST"])
def exchange_public_token():
    base_url, client_id, secret = _plaid_headers_and_auth()
    if not client_id or not secret:
        return jsonify({"error": "Plaid credentials not configured"}), 400

    data = request.get_json(silent=True) or {}
    public_token = data.get("public_token")
    institution_name = data.get("institution_name", "Plaid Linked Bank")
    actor = getattr(g, "current_partner", None)
    partner_id_int = actor["id"] if actor else (int(data["partner_id"]) if data.get("partner_id") else None)

    if not public_token:
        return jsonify({"error": "public_token is required"}), 400

    try:
        ex_resp = requests.post(
            f"{base_url}/item/public_token/exchange",
            json={"client_id": client_id, "secret": secret, "public_token": public_token},
            timeout=15,
        )
        ex_data = ex_resp.json()
        if ex_resp.status_code != 200:
            return jsonify({"error": ex_data.get("error_message", "Exchange failed"), "details": ex_data}), ex_resp.status_code

        access_token = ex_data["access_token"]
        item_id = ex_data["item_id"]

        db = get_db()
        # If no active accounts exist for this institution, clear any prior blocklist entries so a fresh link works
        active_for_inst = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE LOWER(COALESCE(institution_name, '')) = ?",
            ((institution_name or "").strip().lower(),),
        ).fetchone()["cnt"]
        if active_for_inst == 0:
            db.execute(
                "DELETE FROM deleted_accounts_blocklist WHERE LOWER(COALESCE(institution_name, '')) = ?",
                ((institution_name or "").strip().lower(),),
            )

        db.execute(
            "INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_name, linked_by_partner_id) VALUES (?, ?, ?, ?)",
            (item_id, encrypt_plaid_token(access_token), institution_name, partner_id_int),
        )
        db.commit()

        imported_accounts, imported_txs, _ = _sync_plaid_accounts_and_transactions(access_token, institution_name, partner_id_int, item_id)
        return jsonify({
            "linked": True,
            "item_id": item_id,
            "institution_name": institution_name,
            "imported_accounts": imported_accounts,
            "imported_transactions": imported_txs,
        })
    except requests.RequestException as exc:
        return jsonify({"error": f"Plaid exchange network error: {exc}"}), 502


@finance_bp.route("/plaid/sandbox_quick_connect", methods=["POST"])
def sandbox_quick_connect():
    base_url, client_id, secret = _plaid_headers_and_auth()
    if not client_id or not secret:
        return jsonify({"error": "Plaid credentials missing in .env"}), 400

    data = request.get_json(silent=True) or {}
    institution_id = data.get("institution_id", "ins_109508")
    institution_name = data.get("institution_name", "First Platypus Bank (Plaid Sandbox)")
    actor = getattr(g, "current_partner", None)
    partner_id_int = actor["id"] if actor else (int(data["partner_id"]) if data.get("partner_id") else None)

    try:
        pt_resp = requests.post(
            f"{base_url}/sandbox/public_token/create",
            json={
                "client_id": client_id,
                "secret": secret,
                "institution_id": institution_id,
                "initial_products": ["transactions"],
            },
            timeout=15,
        )
        pt_data = pt_resp.json()
        if pt_resp.status_code != 200:
            return jsonify({"error": pt_data.get("error_message", "Sandbox public token creation failed"), "details": pt_data}), pt_resp.status_code

        public_token = pt_data["public_token"]
        ex_resp = requests.post(
            f"{base_url}/item/public_token/exchange",
            json={"client_id": client_id, "secret": secret, "public_token": public_token},
            timeout=15,
        )
        ex_data = ex_resp.json()
        if ex_resp.status_code != 200:
            return jsonify({"error": ex_data.get("error_message", "Token exchange failed"), "details": ex_data}), ex_resp.status_code

        access_token = ex_data["access_token"]
        item_id = ex_data["item_id"]

        db = get_db()
        active_for_inst = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE LOWER(COALESCE(institution_name, '')) = ?",
            ((institution_name or "").strip().lower(),),
        ).fetchone()["cnt"]
        if active_for_inst == 0:
            db.execute(
                "DELETE FROM deleted_accounts_blocklist WHERE LOWER(COALESCE(institution_name, '')) = ?",
                ((institution_name or "").strip().lower(),),
            )

        db.execute(
            "INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_name, linked_by_partner_id) VALUES (?, ?, ?, ?)",
            (item_id, encrypt_plaid_token(access_token), institution_name, partner_id_int),
        )
        db.commit()

        imported_accounts, imported_txs, _ = _sync_plaid_accounts_and_transactions(access_token, institution_name, partner_id_int, item_id)
        return jsonify({
            "linked": True,
            "item_id": item_id,
            "institution_name": institution_name,
            "imported_accounts": imported_accounts,
            "imported_transactions": imported_txs,
        })
    except requests.RequestException as exc:
        return jsonify({"error": f"Plaid Sandbox connection error: {exc}"}), 502


@finance_bp.route("/plaid/sync", methods=["POST"])
def sync_all_plaid_items():
    data = request.get_json(silent=True) or {}
    reset_cursor = bool(data.get("reset_cursor", False) or data.get("force", False))
    target_item_id = data.get("item_id")

    db = get_db()
    if target_item_id:
        items = db.execute("SELECT * FROM plaid_items WHERE item_id = ?", (target_item_id,)).fetchall()
    else:
        items = db.execute("SELECT * FROM plaid_items").fetchall()

    if not items:
        return jsonify({"error": "No Plaid bank items linked yet. Connect a bank first."}), 400

    total_acc = 0
    total_tx = 0
    item_errors = []
    for item in items:
        raw_access_token = decrypt_plaid_token(item["access_token"])
        acc_cnt, tx_cnt, err = _sync_plaid_accounts_and_transactions(
            raw_access_token,
            item["institution_name"],
            item["linked_by_partner_id"],
            item["item_id"],
            reset_cursor=reset_cursor,
        )
        total_acc += acc_cnt
        total_tx += tx_cnt
        if err:
            item_errors.append({
                "item_id": item["item_id"],
                "institution_name": item["institution_name"],
                "error": err,
                "requires_reauth": any(k in err for k in ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "ITEM_LOCKED", "USER_PERMISSION_REVOKED", "INVALID_CREDENTIALS"]),
            })

    return jsonify({
        "synced": True,
        "updated_accounts": total_acc,
        "imported_transactions": total_tx,
        "reset_cursor": reset_cursor,
        "item_errors": item_errors,
        "last_plaid_sync_at": datetime.now(timezone.utc).isoformat(),
    })


@finance_bp.route("/plaid/webhook", methods=["POST"])
def plaid_webhook():
    """
    Public webhook receiver for Plaid asynchronous lifecycle events.
    Handles TRANSACTIONS updates (SYNC_UPDATES_AVAILABLE, DEFAULT_UPDATE, etc.)
    and ITEM errors (ITEM_LOGIN_REQUIRED).
    """
    data = request.get_json(silent=True) or {}
    webhook_type = (data.get("webhook_type") or "").upper()
    webhook_code = (data.get("webhook_code") or "").upper()
    item_id = data.get("item_id")

    if not item_id:
        return jsonify({"received": True, "note": "No item_id provided"}), 200

    db = get_db()
    item = db.execute("SELECT * FROM plaid_items WHERE item_id = ?", (item_id,)).fetchone()
    if not item:
        return jsonify({"received": True, "note": "Item not found"}), 200

    if webhook_type == "TRANSACTIONS":
        raw_token = decrypt_plaid_token(item["access_token"])

        def _bg_webhook_sync(app_ctx, token, inst, partner, i_id):
            with app_ctx:
                _sync_plaid_accounts_and_transactions(token, inst, partner, i_id)
                bump_state_version(get_db())

        app_obj = current_app._get_current_object()
        threading.Thread(
            target=_bg_webhook_sync,
            args=(app_obj.app_context(), raw_token, item["institution_name"], item["linked_by_partner_id"], item_id),
            daemon=True,
        ).start()
        return jsonify({"received": True, "action": "sync_dispatched", "webhook_code": webhook_code}), 200

    elif webhook_type == "ITEM" and webhook_code == "ERROR":
        err_obj = data.get("error") or {}
        err_code = err_obj.get("error_code", "ITEM_ERROR")
        err_msg = err_obj.get("error_message", "Item error reported by Plaid")
        db.execute(
            "UPDATE plaid_items SET status = 'error', last_error_code = ?, last_error = ? WHERE item_id = ?",
            (err_code, err_msg, item_id),
        )
        bump_state_version(db)
        db.commit()
        return jsonify({"received": True, "action": "item_error_recorded", "error_code": err_code}), 200

    return jsonify({"received": True, "unhandled_type": webhook_type}), 200


@finance_bp.route("/plaid/auto-sync", methods=["POST"])
def auto_sync_plaid_items():
    """
    Background server action triggered on page load.
    If Plaid bank accounts are linked and haven't been synced in >= 12 hours,
    triggers a background sync (or synchronous if `background=False`).
    """
    data = request.get_json(silent=True) or {}
    run_in_background = bool(data.get("background", True))
    force = bool(data.get("force", False))

    db = get_db()
    items = [dict(r) for r in db.execute("SELECT * FROM plaid_items").fetchall()]
    if not items:
        return jsonify({
            "triggered": False,
            "reason": "no_linked_items",
            "last_plaid_sync_at": None,
        })

    last_sync_iso, hours_since, is_stale = _get_plaid_sync_freshness(db, max_age_hours=12.0)
    if not is_stale and not force:
        return jsonify({
            "triggered": False,
            "reason": "recently_synced",
            "last_plaid_sync_at": last_sync_iso,
            "hours_since_last_sync": hours_since,
        })

    # Stamp immediately so concurrent page loads don't trigger duplicate syncs
    now_iso = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_plaid_sync_at', ?)",
        (now_iso,),
    )
    db.commit()

    app_obj = current_app._get_current_object()

    def _perform_sync():
        with app_obj.app_context():
            bg_db = get_db()
            t_acc = 0
            t_tx = 0
            for item in items:
                try:
                    raw_token = decrypt_plaid_token(item["access_token"])
                    ac, tc, _ = _sync_plaid_accounts_and_transactions(
                        raw_token,
                        item["institution_name"],
                        item["linked_by_partner_id"],
                        item["item_id"],
                    )
                    t_acc += ac
                    t_tx += tc
                except Exception:
                    pass
            bump_state_version(bg_db)
            return t_acc, t_tx

    if run_in_background:
        t = threading.Thread(target=_perform_sync, daemon=True)
        t.start()
        return jsonify({
            "triggered": True,
            "background": True,
            "last_plaid_sync_at": now_iso,
            "previous_hours_since_sync": hours_since,
        })
    else:
        acc_cnt, tx_cnt = _perform_sync()
        return jsonify({
            "triggered": True,
            "background": False,
            "updated_accounts": acc_cnt,
            "imported_transactions": tx_cnt,
            "last_plaid_sync_at": now_iso,
            "previous_hours_since_sync": hours_since,
        })


@finance_bp.route("/plaid/items/<item_identifier>", methods=["DELETE"])
def delete_plaid_item(item_identifier: str):
    """
    Unlinks and removes a Plaid linked bank item.
    Deletes the item from plaid_items, removes its synced accounts, and purges
    all duplicate transactions and income entries imported for those accounts.
    """
    db = get_db()
    item = db.execute(
        "SELECT * FROM plaid_items WHERE id = ? OR item_id = ?",
        (item_identifier, item_identifier),
    ).fetchone()
    if not item:
        return jsonify({"error": "Plaid bank connection not found"}), 404

    base_url, client_id, secret = _plaid_headers_and_auth()
    # Attempt to de-register from Plaid API servers (best-effort)
    if client_id and secret and item["access_token"]:
        try:
            raw_access_token = decrypt_plaid_token(item["access_token"])
            requests.post(
                f"{base_url}/item/remove",
                json={"client_id": client_id, "secret": secret, "access_token": raw_access_token},
                timeout=10,
            )
        except Exception:
            pass

    # 1. First find accounts where item_id matches this item
    matched_acc_rows = db.execute(
        "SELECT id FROM accounts WHERE item_id = ?", (item["item_id"],)
    ).fetchall()
    matched_acc_ids = [r["id"] for r in matched_acc_rows]

    # 2. If no accounts have item_id, try fetching account IDs from Plaid using decrypted token
    if not matched_acc_ids and item["access_token"]:
        try:
            raw_access_token = decrypt_plaid_token(item["access_token"])
            acc_resp = requests.post(
                f"{base_url}/accounts/get",
                json={"client_id": client_id, "secret": secret, "access_token": raw_access_token},
                timeout=10,
            )
            if acc_resp.status_code == 200:
                p_acc_ids = [a["account_id"] for a in acc_resp.json().get("accounts", [])]
                if p_acc_ids:
                    ph = ",".join("?" * len(p_acc_ids))
                    matched_acc_ids = [
                        r["id"]
                        for r in db.execute(
                            f"SELECT id FROM accounts WHERE plaid_account_id IN ({ph})",
                            p_acc_ids,
                        ).fetchall()
                    ]
        except Exception:
            pass

    # 3. Fallback: if still no match and there are accounts matching this institution_name
    other_items = db.execute(
        "SELECT COUNT(*) AS cnt FROM plaid_items WHERE institution_name = ? AND id != ?",
        (item["institution_name"], item["id"]),
    ).fetchone()["cnt"]
    if not matched_acc_ids and other_items == 0:
        matched_acc_ids = [
            r["id"]
            for r in db.execute(
                "SELECT id FROM accounts WHERE institution_name = ?",
                (item["institution_name"],),
            ).fetchall()
        ]

    # Delete transactions, income_entries, and accounts belonging to this connection
    deleted_tx_cnt = 0
    deleted_inc_cnt = 0
    deleted_acc_cnt = len(matched_acc_ids)

    if matched_acc_ids:
        ph = ",".join("?" * len(matched_acc_ids))
        acc_rows_to_del = db.execute(
            f"SELECT * FROM accounts WHERE id IN ({ph})", matched_acc_ids
        ).fetchall()
        for ar in acc_rows_to_del:
            db.execute(
                """
                INSERT INTO deleted_accounts_blocklist (plaid_account_id, item_id, institution_name, name, subtype, mask)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    ar["plaid_account_id"],
                    ar["item_id"] or item["item_id"],
                    ar["institution_name"] or item["institution_name"],
                    ar["name"],
                    ar["subtype"],
                    ar["mask"],
                ),
            )
        deleted_tx_cnt = db.execute(
            f"DELETE FROM transactions WHERE account_id IN ({ph})", matched_acc_ids
        ).rowcount
        deleted_inc_cnt = db.execute(
            f"DELETE FROM income_entries WHERE account_id IN ({ph})", matched_acc_ids
        ).rowcount
        db.execute(f"DELETE FROM accounts WHERE id IN ({ph})", matched_acc_ids)

    # Finally delete from plaid_items
    db.execute("DELETE FROM plaid_items WHERE id = ?", (item["id"],))
    db.commit()

    return jsonify({
        "unlinked": True,
        "item_id": item["item_id"],
        "institution_name": item["institution_name"],
        "deleted_accounts": deleted_acc_cnt,
        "deleted_transactions": deleted_tx_cnt,
        "deleted_income_entries": deleted_inc_cnt,
    })


@finance_bp.route("/summary", methods=["GET"])
def finance_summary():
    current_ym = max(date.today().strftime("%Y-%m"), STARTING_BUDGET_MONTH)
    raw_req_month = (request.args.get("month") or "").strip()[:7]
    selected_month = raw_req_month if len(raw_req_month) == 7 else current_ym
    include_all = request.args.get("include_all_months") == "true"

    db = get_db()
    accounts = []
    for r in db.execute(
        """
        SELECT a.*,
               p.name AS owner_partner_name,
               p.avatar_color AS owner_partner_color
        FROM accounts a
        LEFT JOIN partners p ON a.owner_partner_id = p.id
        ORDER BY a.type, a.subtype, a.name
        """
    ).fetchall():
        acc_d = dict(r)
        acc_d.update(classify_savings_account(acc_d))
        accounts.append(acc_d)

    household_partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color, monthly_fun_allowance FROM partners ORDER BY id"
        ).fetchall()
    ]
    month_budgets = _ensure_monthly_budgets_for_month(db, selected_month)

    all_transactions = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*,
                   COALESCE(NULLIF(t.budget_month, ''), substr(t.date, 1, 7)) AS effective_budget_month,
                   p.name AS partner_name,
                   p.avatar_color AS partner_color,
                   a.name AS account_name,
                   a.color AS account_color,
                   a.mask AS account_mask,
                   a.institution_name AS account_institution,
                   sa.name AS savings_account_name,
                   sa.color AS savings_account_color
            FROM transactions t
            LEFT JOIN partners p ON t.partner_id = p.id
            LEFT JOIN accounts a ON t.account_id = a.id
            LEFT JOIN accounts sa ON t.savings_account_id = sa.id
            ORDER BY t.date DESC, t.id DESC
            """
        ).fetchall()
    ]

    # Do not auto-generate months prior to STARTING_BUDGET_MONTH (November 2026)
    month_set = {
        m
        for m in [
            STARTING_BUDGET_MONTH,
            selected_month,
            _shift_year_month(selected_month, 1),
            current_ym,
        ]
        if m >= STARTING_BUDGET_MONTH
    }
    splits_by_tx = {}
    for sr in db.execute(
        "SELECT id, transaction_id, category, amount, notes FROM transaction_splits ORDER BY id ASC"
    ).fetchall():
        splits_by_tx.setdefault(sr["transaction_id"], []).append({
            "id": sr["id"],
            "transaction_id": sr["transaction_id"],
            "category": sr["category"],
            "amount": round(float(sr["amount"]), 2),
            "notes": sr["notes"] or "",
        })

    tx_categories = set()
    for tx in all_transactions:
        tx["budget_month"] = tx["effective_budget_month"]
        tx["original_date_month"] = (tx["date"] or "")[:7]
        tx["previous_budget_month"] = _shift_year_month(tx["budget_month"], -1)
        tx["next_budget_month"] = _shift_year_month(tx["budget_month"], 1)
        tx["is_savings_spend"] = is_tx_savings_spend(tx)
        tx["is_cc_payment"] = is_tx_cc_payment(tx)
        tx_splits = splits_by_tx.get(tx["id"], [])
        tx["splits"] = tx_splits
        tx["is_split"] = bool(tx.get("is_split")) or len(tx_splits) > 0
        if tx["budget_month"] and tx["budget_month"] >= STARTING_BUDGET_MONTH:
            month_set.add(tx["budget_month"])
        if not tx["is_savings_spend"] and not tx["is_cc_payment"]:
            if tx["is_split"] and tx_splits:
                for sp in tx_splits:
                    if sp.get("category"):
                        tx_categories.add(sp["category"])
            elif tx.get("category"):
                tx_categories.add(tx["category"])

    # Also include any months from monthly_budgets and income_entries (>= STARTING_BUDGET_MONTH)
    for mb_row in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets WHERE is_active = 1").fetchall():
        if mb_row["budget_month"] and mb_row["budget_month"] >= STARTING_BUDGET_MONTH:
            month_set.add(mb_row["budget_month"])

    all_income_entries = [
        dict(r)
        for r in db.execute(
            """
            SELECT i.*,
                   COALESCE(NULLIF(i.budget_month, ''), substr(i.date, 1, 7)) AS effective_budget_month,
                   p.name AS partner_name,
                   p.avatar_color AS partner_color,
                   a.name AS account_name,
                   a.color AS account_color,
                   a.mask AS account_mask,
                   a.institution_name AS account_institution
            FROM income_entries i
            LEFT JOIN partners p ON i.partner_id = p.id
            LEFT JOIN accounts a ON i.account_id = a.id
            ORDER BY i.date DESC, i.id DESC
            """
        ).fetchall()
    ]

    income_by_month = {}
    expected_by_month = {}
    recurring_by_month = {}
    variable_by_month = {}
    returns_by_month = {}
    transfers_by_month = {}

    for inc in all_income_entries:
        ym = inc["effective_budget_month"]
        inc["budget_month"] = ym
        itype = (inc.get("income_type") or "payroll").strip().lower()
        amt = float(inc["amount"] or 0.0)
        exp = float(inc["expected_monthly_amount"]) if inc.get("expected_monthly_amount") is not None else amt

        is_real = is_real_earned_income(itype)
        is_ret = is_return_refund(itype)
        is_trans = is_transfer_or_cc_payment(itype)
        inc["is_real_income"] = is_real
        inc["is_return"] = is_ret
        inc["is_transfer_or_cc"] = is_trans

        if ym:
            if ym >= STARTING_BUDGET_MONTH:
                month_set.add(ym)
            if is_real:
                income_by_month[ym] = income_by_month.get(ym, 0.0) + amt
                expected_by_month[ym] = expected_by_month.get(ym, 0.0) + exp
                if itype in ["paycheck", "payroll"]:
                    recurring_by_month[ym] = recurring_by_month.get(ym, 0.0) + amt
                else:
                    variable_by_month[ym] = variable_by_month.get(ym, 0.0) + amt
            elif is_ret:
                returns_by_month[ym] = returns_by_month.get(ym, 0.0) + amt
            elif is_trans:
                transfers_by_month[ym] = transfers_by_month.get(ym, 0.0) + amt

    month_income_entries = [inc for inc in all_income_entries if inc["budget_month"] == selected_month]
    month_returns = [inc for inc in month_income_entries if inc["is_return"]]
    month_transfers = [inc for inc in month_income_entries if inc["is_transfer_or_cc"]]

    total_monthly_income = round(income_by_month.get(selected_month, 0.0), 2)
    total_monthly_returns = round(sum(float(inc["amount"] or 0.0) for inc in month_returns), 2)
    total_cc_payments = round(sum(float(inc["amount"] or 0.0) for inc in month_transfers if "cc" in (inc.get("income_type") or "")), 2)
    total_transfers = round(sum(float(inc["amount"] or 0.0) for inc in month_transfers if "transfer" in (inc.get("income_type") or "")), 2)

    returns_by_cat = {}
    for ret in month_returns:
        rcat = (ret.get("category") or "").strip()
        if rcat:
            returns_by_cat[rcat] = returns_by_cat.get(rcat, 0.0) + float(ret["amount"] or 0.0)

    prev_ym = _shift_year_month(selected_month, -1)
    previous_month_income = round(income_by_month.get(prev_ym, 0.0), 2)
    active_income_months = [v for v in income_by_month.values() if v > 0]
    average_monthly_income = (
        round(sum(active_income_months) / len(active_income_months), 2)
        if active_income_months
        else 0.0
    )
    expected_monthly_income = round(
        expected_by_month.get(selected_month, average_monthly_income or previous_month_income),
        2,
    )

    # Compute Auto Projected Monthly Income based on previous months (< selected_month, up to trailing 6 active months)
    prior_active_yms = sorted(
        [ym for ym, tot in income_by_month.items() if ym < selected_month and tot > 0]
    )[-6:]
    if prior_active_yms:
        prior_totals = [round(income_by_month[ym], 2) for ym in prior_active_yms]
        auto_projected_income = round(sum(prior_totals) / len(prior_totals), 2)
        projected_recurring_income = round(
            sum(recurring_by_month.get(ym, 0.0) for ym in prior_active_yms) / len(prior_active_yms),
            2,
        )
        projected_variable_income = round(
            sum(variable_by_month.get(ym, 0.0) for ym in prior_active_yms) / len(prior_active_yms),
            2,
        )
        projected_income_min = round(min(prior_totals), 2)
        projected_income_max = round(max(prior_totals), 2)
        projected_income_months_used = [
            {"month": ym, "total_income": round(income_by_month[ym], 2)}
            for ym in prior_active_yms
        ]
    else:
        # Fallback if no prior months have logged income yet: use current expected or multi-month average
        fallback_proj = expected_monthly_income or average_monthly_income or total_monthly_income
        auto_projected_income = round(fallback_proj, 2)
        projected_recurring_income = round(recurring_by_month.get(selected_month, fallback_proj), 2)
        projected_variable_income = round(variable_by_month.get(selected_month, 0.0), 2)
        projected_income_min = auto_projected_income
        projected_income_max = auto_projected_income
        projected_income_months_used = []

    # Check for custom projected income override
    proj_row = db.execute(
        "SELECT custom_projected_income FROM monthly_income_projections WHERE budget_month = ?",
        (selected_month,),
    ).fetchone()
    if proj_row and proj_row["custom_projected_income"] is not None and float(proj_row["custom_projected_income"]) > 0:
        custom_projected_income = round(float(proj_row["custom_projected_income"]), 2)
        projected_monthly_income = custom_projected_income
        is_custom_projection = True
    else:
        custom_projected_income = None
        projected_monthly_income = auto_projected_income
        is_custom_projection = False

    income_vs_projected = round(total_monthly_income - projected_monthly_income, 2)
    income_vs_projected_pct = (
        round((income_vs_projected / projected_monthly_income) * 100, 1)
        if projected_monthly_income > 0
        else 0.0
    )

    income_fluctuation_vs_prev = round(total_monthly_income - previous_month_income, 2)
    income_fluctuation_vs_prev_pct = (
        round((income_fluctuation_vs_prev / previous_month_income) * 100, 1)
        if previous_month_income > 0
        else 0.0
    )
    income_fluctuation_vs_expected = round(total_monthly_income - expected_monthly_income, 2)
    income_fluctuation_vs_avg = round(total_monthly_income - average_monthly_income, 2)

    month_transactions = [
        tx for tx in all_transactions if tx["budget_month"] == selected_month
    ]
    budget_month_transactions = [
        tx for tx in month_transactions if not tx["is_savings_spend"] and not tx["is_cc_payment"]
    ]
    savings_month_transactions = [
        tx for tx in month_transactions if tx["is_savings_spend"]
    ]
    cc_payment_transactions = [
        tx for tx in month_transactions if tx["is_cc_payment"]
    ]

    total_cash = sum(a["balance_current"] for a in accounts if a["type"] == "depository")
    total_credit_used = sum(a["balance_current"] for a in accounts if a["type"] == "credit")

    spend_by_category = {}
    for tx in budget_month_transactions:
        if tx.get("is_split") and tx.get("splits"):
            for sp in tx["splits"]:
                sp_cat = sp["category"]
                spend_by_category[sp_cat] = spend_by_category.get(sp_cat, 0.0) + float(sp["amount"])
        else:
            cat = tx["category"]
            spend_by_category[cat] = spend_by_category.get(cat, 0.0) + float(tx["amount"])

    enriched_budgets = []
    total_budget_limit = 0.0
    total_budget_spent = 0.0
    total_budget_gross_spent = 0.0
    for b in month_budgets:
        cat_name = b["category"]
        gross_spent = round(spend_by_category.get(cat_name, 0.0), 2)
        cat_returns = round(returns_by_cat.get(cat_name, 0.0), 2)
        net_spent = round(gross_spent - cat_returns, 2)
        limit_val = float(b["monthly_limit"])
        total_budget_limit += limit_val
        total_budget_gross_spent += gross_spent
        total_budget_spent += net_spent
        pct = round((net_spent / limit_val) * 100, 1) if limit_val > 0 else 0.0
        enriched_budgets.append({
            **b,
            "gross_spent": gross_spent,
            "returns_credited": cat_returns,
            "spent": net_spent,
            "remaining": round(limit_val - net_spent, 2),
            "utilization_pct": max(0.0, pct),
        })

    cat_mgmt = _build_category_management_payload(
        db, selected_month, month_budgets, month_transactions, all_transactions
    )
    all_categories = cat_mgmt["active_categories"]

    # Mark each transaction with whether its category is currently tracked in its budget month
    tracked_cat_names = {b["category"] for b in enriched_budgets}
    for tx in all_transactions:
        if tx["is_savings_spend"] or tx["is_cc_payment"]:
            tx["is_category_tracked"] = True
        elif tx.get("is_split") and tx.get("splits"):
            tx["is_category_tracked"] = all(sp.get("category") in tracked_cat_names for sp in tx["splits"])
        else:
            tx["is_category_tracked"] = tx.get("category") in tracked_cat_names

    total_gross_spent = round(sum(float(t["amount"]) for t in budget_month_transactions), 2)
    total_savings_spent = round(sum(float(t["amount"]) for t in savings_month_transactions), 2)
    total_cc_payments_spent = round(sum(float(t["amount"]) for t in cc_payment_transactions), 2)
    # Net monthly spent subtracts returns so equilibrium is strictly maintained and returns offset spending
    total_monthly_spent = round(max(0.0, total_gross_spent - total_monthly_returns), 2)
    net_monthly_cashflow = round(total_monthly_income - total_monthly_spent, 2)
    unallocated_income = round(total_monthly_income - total_budget_limit, 2)
    projected_net_cashflow = round(projected_monthly_income - total_monthly_spent, 2)
    projected_unallocated_income = round(projected_monthly_income - total_budget_limit, 2)

    # Balanced Budget & Overlap Analysis (Projected Income max, Grey Savings at end, Expense Budgets & Actual Spend)
    savings_budget_limit = round(
        sum(
            float(b["monthly_limit"])
            for b in month_budgets
            if "saving" in (b.get("category") or "").lower()
        ),
        2,
    )
    expense_budget_limit = round(max(0.0, total_budget_limit - savings_budget_limit), 2)
    unallocated_projected_savings = round(max(0.0, projected_monthly_income - total_budget_limit), 2)
    projected_savings_reserve = round(savings_budget_limit + unallocated_projected_savings, 2)
    savings_zone_start = round(max(0.0, projected_monthly_income - projected_savings_reserve), 2)

    budget_exceeds_projected_income = bool(
        projected_monthly_income > 0 and total_budget_limit > projected_monthly_income
    )
    budget_over_projected_amount = (
        round(max(0.0, total_budget_limit - projected_monthly_income), 2)
        if projected_monthly_income > 0
        else 0.0
    )
    budget_exceeds_actual_income = bool(total_budget_limit > total_monthly_income)
    budget_over_actual_amount = round(max(0.0, total_budget_limit - total_monthly_income), 2)

    spent_exceeds_projected_income = bool(
        projected_monthly_income > 0 and total_monthly_spent > projected_monthly_income
    )
    spent_over_projected_amount = (
        round(max(0.0, total_monthly_spent - projected_monthly_income), 2)
        if projected_monthly_income > 0
        else 0.0
    )
    spent_dipping_into_savings = bool(
        projected_monthly_income > 0
        and projected_savings_reserve > 0
        and total_monthly_spent > savings_zone_start
    )
    spent_dipping_into_savings_amount = (
        round(max(0.0, total_monthly_spent - savings_zone_start), 2)
        if spent_dipping_into_savings
        else 0.0
    )
    is_balanced_budget = bool(
        projected_monthly_income > 0
        and total_budget_limit <= projected_monthly_income
        and not spent_dipping_into_savings
        and not spent_exceeds_projected_income
    )

    return jsonify({
        "selected_month": selected_month,
        "current_calendar_month": current_ym,
        "previous_month": prev_ym,
        "next_month": _shift_year_month(selected_month, 1),
        "available_months": sorted(month_set, reverse=True),
        "all_categories": all_categories,
        "categories_catalog": cat_mgmt["categories_catalog"],
        "untracked_categories": cat_mgmt["untracked_categories"],
        "untracked_count": cat_mgmt["untracked_count"],
        "untracked_with_spend_count": cat_mgmt["untracked_with_spend_count"],
        "untracked_monthly_spent": cat_mgmt["untracked_monthly_spent"],
        "net_cash": round(total_cash, 2),
        "credit_balance": round(total_credit_used, 2),
        "net_liquid": round(total_cash - total_credit_used, 2),
        "total_monthly_budget": round(total_budget_limit, 2),
        "expense_budget_limit": expense_budget_limit,
        "savings_budget_limit": savings_budget_limit,
        "projected_savings_reserve": projected_savings_reserve,
        "savings_zone_start": savings_zone_start,
        "budget_exceeds_projected_income": budget_exceeds_projected_income,
        "budget_over_projected_amount": budget_over_projected_amount,
        "budget_exceeds_actual_income": budget_exceeds_actual_income,
        "budget_over_actual_amount": budget_over_actual_amount,
        "spent_exceeds_projected_income": spent_exceeds_projected_income,
        "spent_over_projected_amount": spent_over_projected_amount,
        "spent_dipping_into_savings": spent_dipping_into_savings,
        "spent_dipping_into_savings_amount": spent_dipping_into_savings_amount,
        "is_balanced_budget": is_balanced_budget,
        "total_monthly_spent": total_monthly_spent,
        "total_gross_spent": total_gross_spent,
        "total_savings_spent": total_savings_spent,
        "savings_spend_count": len(savings_month_transactions),
        "savings_transactions": savings_month_transactions,
        "total_monthly_returns": total_monthly_returns,
        "total_cc_payments": total_cc_payments,
        "total_cc_payments_spent": total_cc_payments_spent,
        "cc_payment_spend_count": len(cc_payment_transactions),
        "total_transfers": total_transfers,
        "budgeted_categories_spent": round(total_budget_spent, 2),
        "total_monthly_income": total_monthly_income,
        "expected_monthly_income": expected_monthly_income,
        "previous_month_income": previous_month_income,
        "average_monthly_income": average_monthly_income,
        "projected_monthly_income": projected_monthly_income,
        "auto_projected_income": auto_projected_income,
        "custom_projected_income": custom_projected_income,
        "is_custom_projection": is_custom_projection,
        "projected_recurring_income": projected_recurring_income,
        "projected_variable_income": projected_variable_income,
        "projected_income_min": projected_income_min,
        "projected_income_max": projected_income_max,
        "projected_income_months_used": projected_income_months_used,
        "projected_income_months_count": len(projected_income_months_used),
        "income_vs_projected": income_vs_projected,
        "income_vs_projected_pct": income_vs_projected_pct,
        "projected_net_cashflow": projected_net_cashflow,
        "projected_unallocated_income": projected_unallocated_income,
        "income_fluctuation_vs_prev": income_fluctuation_vs_prev,
        "income_fluctuation_vs_prev_pct": income_fluctuation_vs_prev_pct,
        "income_fluctuation_vs_expected": income_fluctuation_vs_expected,
        "income_fluctuation_vs_avg": income_fluctuation_vs_avg,
        "net_monthly_cashflow": net_monthly_cashflow,
        "unallocated_income": unallocated_income,
        "income_entries": all_income_entries if include_all else month_income_entries,
        "accounts": accounts,
        "partners": household_partners,
        "budgets": enriched_budgets,
        "transactions": all_transactions if include_all else month_transactions,
        "month_transaction_count": len(month_transactions),
        "total_transaction_count": len(all_transactions),
    })


@finance_bp.route("/history", methods=["GET"])
def finance_history():
    """
    Returns month-by-month historical spending & budget breakdown across all months.
    """
    db = get_db()
    current_ym = date.today().strftime("%Y-%m")

    all_txs = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*,
                   COALESCE(NULLIF(t.budget_month, ''), substr(t.date, 1, 7)) AS effective_budget_month
            FROM transactions t
            ORDER BY t.date DESC
            """
        ).fetchall()
    ]

    all_incomes = [
        dict(r)
        for r in db.execute(
            """
            SELECT i.*,
                   COALESCE(NULLIF(i.budget_month, ''), substr(i.date, 1, 7)) AS effective_budget_month
            FROM income_entries i
            ORDER BY i.date DESC
            """
        ).fetchall()
    ]

    splits_by_tx = {}
    for sr in db.execute(
        "SELECT id, transaction_id, category, amount, notes FROM transaction_splits ORDER BY id ASC"
    ).fetchall():
        splits_by_tx.setdefault(sr["transaction_id"], []).append({
            "id": sr["id"],
            "category": sr["category"],
            "amount": round(float(sr["amount"]), 2),
            "notes": sr["notes"] or "",
        })

    for tx in all_txs:
        tx_splits = splits_by_tx.get(tx["id"], [])
        tx["splits"] = tx_splits
        tx["is_split"] = bool(tx.get("is_split")) or len(tx_splits) > 0
        tx["is_savings_spend"] = is_tx_savings_spend(tx)
        tx["is_cc_payment"] = is_tx_cc_payment(tx)

    months_set = {
        max(current_ym, STARTING_BUDGET_MONTH),
    }
    for tx in all_txs:
        if tx["effective_budget_month"] and tx["effective_budget_month"] >= STARTING_BUDGET_MONTH:
            months_set.add(tx["effective_budget_month"])
    for inc in all_incomes:
        if inc["effective_budget_month"] and inc["effective_budget_month"] >= STARTING_BUDGET_MONTH:
            months_set.add(inc["effective_budget_month"])
    for mb in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets").fetchall():
        if mb["budget_month"] and mb["budget_month"] >= STARTING_BUDGET_MONTH:
            months_set.add(mb["budget_month"])

    income_totals_by_month = {}
    expected_totals_by_month = {}
    returns_by_month = {}
    transfers_by_month = {}

    for inc in all_incomes:
        ym = inc["effective_budget_month"]
        itype = (inc.get("income_type") or "payroll").strip().lower()
        amt = float(inc["amount"] or 0.0)
        exp = float(inc["expected_monthly_amount"]) if inc.get("expected_monthly_amount") is not None else amt
        if is_real_earned_income(itype):
            income_totals_by_month[ym] = income_totals_by_month.get(ym, 0.0) + amt
            expected_totals_by_month[ym] = expected_totals_by_month.get(ym, 0.0) + exp
        elif is_return_refund(itype):
            returns_by_month[ym] = returns_by_month.get(ym, 0.0) + amt
        elif is_transfer_or_cc_payment(itype):
            transfers_by_month[ym] = transfers_by_month.get(ym, 0.0) + amt

    custom_proj_rows = db.execute(
        "SELECT budget_month, custom_projected_income FROM monthly_income_projections"
    ).fetchall()
    custom_proj_map = {
        r["budget_month"]: round(float(r["custom_projected_income"]), 2)
        for r in custom_proj_rows
        if r["custom_projected_income"] and float(r["custom_projected_income"]) > 0
    }

    sorted_months = sorted(months_set, reverse=True)
    history_list = []

    for ym in sorted_months:
        m_budgets = _ensure_monthly_budgets_for_month(db, ym)
        m_txs = [tx for tx in all_txs if tx["effective_budget_month"] == ym]
        budget_m_txs = [tx for tx in m_txs if not is_tx_savings_spend(tx) and not is_tx_cc_payment(tx)]
        savings_m_txs = [tx for tx in m_txs if is_tx_savings_spend(tx)]
        cc_payment_m_txs = [tx for tx in m_txs if is_tx_cc_payment(tx)]
        m_incomes = [inc for inc in all_incomes if inc["effective_budget_month"] == ym]

        spend_by_cat = {}
        for tx in budget_m_txs:
            if tx.get("is_split") and tx.get("splits"):
                for sp in tx["splits"]:
                    cat = sp["category"]
                    spend_by_cat[cat] = spend_by_cat.get(cat, 0.0) + float(sp["amount"])
            else:
                cat = tx["category"]
                spend_by_cat[cat] = spend_by_cat.get(cat, 0.0) + float(tx["amount"])

        cat_returns_map = {}
        for r_inc in m_incomes:
            if is_return_refund(r_inc.get("income_type")):
                rc = (r_inc.get("category") or "").strip()
                if rc:
                    cat_returns_map[rc] = cat_returns_map.get(rc, 0.0) + float(r_inc.get("amount") or 0.0)

        month_ret = returns_by_month.get(ym, 0.0)
        gross_spent = round(sum(float(tx["amount"]) for tx in budget_m_txs), 2)
        savings_spent = round(sum(float(tx["amount"]) for tx in savings_m_txs), 2)
        total_spent = round(max(0.0, gross_spent - month_ret), 2)
        total_limit = round(sum(float(b["monthly_limit"]) for b in m_budgets), 2)
        total_income = round(income_totals_by_month.get(ym, 0.0), 2)
        expected_income = round(expected_totals_by_month.get(ym, 0.0), 2)
        prev_ym = _shift_year_month(ym, -1)
        prev_income = round(income_totals_by_month.get(prev_ym, 0.0), 2)
        prior_hist_yms = sorted([k for k, v in income_totals_by_month.items() if k < ym and v > 0])[-6:]
        auto_proj_inc = (
            round(sum(income_totals_by_month[k] for k in prior_hist_yms) / len(prior_hist_yms), 2)
            if prior_hist_yms
            else round(expected_income or total_income, 2)
        )
        is_custom_proj = ym in custom_proj_map
        projected_inc = custom_proj_map[ym] if is_custom_proj else auto_proj_inc

        inc_delta = round(total_income - prev_income, 2)
        inc_delta_pct = round((inc_delta / prev_income) * 100, 1) if prev_income > 0 else 0.0

        cat_breakdown = []
        seen_cats = set()
        for b in m_budgets:
            cat = b["category"]
            seen_cats.add(cat)
            cat_gross = round(spend_by_cat.get(cat, 0.0), 2)
            cat_ret = round(cat_returns_map.get(cat, 0.0), 2)
            spent = round(cat_gross - cat_ret, 2)
            lim = float(b["monthly_limit"])
            cat_breakdown.append({
                "category": cat,
                "gross_spent": cat_gross,
                "returns_credited": cat_ret,
                "spent": spent,
                "monthly_limit": lim,
                "remaining": round(lim - spent, 2),
                "utilization_pct": round((spent / lim) * 100, 1) if lim > 0 else 0.0,
                "is_budgeted": True,
                "is_active": bool(b.get("is_active", 1)),
            })

        for cat, spent_val in spend_by_cat.items():
            if cat not in seen_cats:
                cat_ret = round(cat_returns_map.get(cat, 0.0), 2)
                spent = round(spent_val - cat_ret, 2)
                cat_breakdown.append({
                    "category": cat,
                    "gross_spent": round(spent_val, 2),
                    "returns_credited": cat_ret,
                    "spent": spent,
                    "monthly_limit": 0.0,
                    "remaining": -round(spent, 2),
                    "utilization_pct": 100.0,
                    "is_budgeted": False,
                    "is_active": False,
                })

        history_list.append({
            "month": ym,
            "budget_month": ym,
            "total_spent": total_spent,
            "total_gross_spent": gross_spent,
            "total_savings_spent": savings_spent,
            "savings_spend_count": len(savings_m_txs),
            "total_returns": month_ret,
            "total_budget": total_limit,
            "total_income": total_income,
            "projected_income": projected_inc,
            "is_custom_projection": is_custom_proj,
            "expected_income": expected_income,
            "net_cashflow": round(total_income - total_spent, 2),
            "income_fluctuation_delta": inc_delta,
            "income_fluctuation_pct": inc_delta_pct,
            "income_count": len(m_incomes),
            "net_variance": round(total_limit - total_spent, 2),
            "utilization_pct": round((total_spent / total_limit) * 100, 1) if total_limit > 0 else 0.0,
            "transaction_count": len(budget_m_txs),
            "categories": cat_breakdown,
        })

    return jsonify({"history": history_list})


@finance_bp.route("/income", methods=["POST"])
def create_income_entry():
    data = request.get_json(silent=True) or {}
    source_name = (data.get("source_name") or "").strip()
    amount = float(data.get("amount", 0))
    if not source_name or amount <= 0:
        return jsonify({"error": "Source name and positive income amount are required"}), 400

    actor = getattr(g, "current_partner", None)
    partner_id = data.get("partner_id") or (actor["id"] if actor else None)
    account_id = data.get("account_id")

    inc_date = (data.get("date") or date.today().isoformat()).strip()
    date_ym = inc_date[:7]
    explicit_bm = (data.get("budget_month") or "").strip()[:7]
    budget_month = explicit_bm if len(explicit_bm) == 7 else date_ym

    expected_raw = data.get("expected_monthly_amount")
    expected_amt = (
        round(float(expected_raw), 2)
        if expected_raw is not None and str(expected_raw).strip() != ""
        else round(amount, 2)
    )
    income_type = (data.get("income_type") or "payroll").strip()
    category = (data.get("category") or "").strip()
    is_recurring = 1 if data.get("is_recurring", income_type in ["paycheck", "payroll"]) else 0
    notes = (data.get("notes") or "").strip()

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO income_entries
        (partner_id, account_id, date, budget_month, source_name, amount, expected_monthly_amount, income_type, category, is_recurring, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(partner_id) if partner_id else None,
            int(account_id) if account_id else None,
            inc_date,
            budget_month,
            source_name,
            round(amount, 2),
            expected_amt,
            income_type,
            category,
            is_recurring,
            notes,
        ),
    )
    db.commit()
    row = dict(db.execute("SELECT * FROM income_entries WHERE id = ?", (cur.lastrowid,)).fetchone())
    return jsonify(row), 201


@finance_bp.route("/income/<int:income_id>", methods=["PUT"])
def update_income_entry(income_id: int):
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.execute("SELECT * FROM income_entries WHERE id = ?", (income_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Income entry not found"}), 404

    source_name = (data.get("source_name") or existing["source_name"]).strip()
    amount = round(float(data.get("amount", existing["amount"])), 2)
    expected_raw = data.get("expected_monthly_amount", existing["expected_monthly_amount"])
    expected_amt = round(float(expected_raw), 2) if expected_raw is not None and str(expected_raw) != "" else amount
    income_type = (data.get("income_type") or existing["income_type"]).strip()
    category = (data.get("category") if "category" in data else (existing.get("category") or "")).strip()
    budget_month = (data.get("budget_month") or existing["budget_month"] or existing["date"][:7]).strip()[:7]
    notes = data.get("notes", existing["notes"])

    db.execute(
        """
        UPDATE income_entries
        SET source_name = ?, amount = ?, expected_monthly_amount = ?, income_type = ?, category = ?, budget_month = ?, notes = ?
        WHERE id = ?
        """,
        (source_name, amount, expected_amt, income_type, category, budget_month, notes, income_id),
    )
    db.commit()
    updated = dict(db.execute("SELECT * FROM income_entries WHERE id = ?", (income_id,)).fetchone())
    return jsonify(updated)


@finance_bp.route("/income/<int:income_id>", methods=["DELETE"])
def delete_income_entry(income_id: int):
    db = get_db()
    db.execute("DELETE FROM income_entries WHERE id = ?", (income_id,))
    db.commit()
    return jsonify({"deleted": True, "id": income_id})


@finance_bp.route("/projected-income", methods=["POST", "PUT"])
def set_custom_projected_income():
    data = request.get_json(silent=True) or {}
    budget_month = (data.get("budget_month") or date.today().strftime("%Y-%m")).strip()[:7]
    raw_amount = (
        data.get("custom_projected_income")
        if "custom_projected_income" in data
        else data.get("projected_income")
    )

    db = get_db()
    if raw_amount is None or str(raw_amount).strip() == "":
        db.execute("DELETE FROM monthly_income_projections WHERE budget_month = ?", (budget_month,))
        db.commit()
        return jsonify({
            "budget_month": budget_month,
            "custom_projected_income": None,
            "is_custom": False,
            "is_custom_projection": False,
            "reverted_to_auto": True,
        })

    try:
        custom_val = round(float(raw_amount), 2)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid projected income amount"}), 400

    if custom_val <= 0:
        db.execute("DELETE FROM monthly_income_projections WHERE budget_month = ?", (budget_month,))
        db.commit()
        return jsonify({
            "budget_month": budget_month,
            "custom_projected_income": None,
            "is_custom": False,
            "is_custom_projection": False,
            "reverted_to_auto": True,
        })

    db.execute(
        """
        INSERT INTO monthly_income_projections (budget_month, custom_projected_income, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(budget_month) DO UPDATE SET
            custom_projected_income = excluded.custom_projected_income,
            updated_at = datetime('now')
        """,
        (budget_month, custom_val),
    )
    db.commit()
    return jsonify({
        "budget_month": budget_month,
        "custom_projected_income": custom_val,
        "is_custom": True,
        "is_custom_projection": True,
    })


@finance_bp.route("/projected-income", methods=["DELETE"])
def delete_custom_projected_income():
    budget_month = (request.args.get("month") or date.today().strftime("%Y-%m")).strip()[:7]
    db = get_db()
    db.execute("DELETE FROM monthly_income_projections WHERE budget_month = ?", (budget_month,))
    db.commit()
    return jsonify({"budget_month": budget_month, "reverted_to_auto": True})


@finance_bp.route("/accounts", methods=["POST"])
def create_account():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Account name is required"}), 400

    raw_pid = data.get("owner_partner_id")
    if raw_pid is not None and str(raw_pid).isdigit() and int(raw_pid) > 0:
        owner_partner_id = int(raw_pid)
    else:
        owner_partner_id = None

    raw_sav_flag = data.get("is_savings_account")
    if raw_sav_flag is None or str(raw_sav_flag).strip().lower() in ["", "auto", "null", "none"]:
        is_savings_account = None
    else:
        is_savings_account = 1 if bool(raw_sav_flag) and str(raw_sav_flag).lower() not in ["0", "false"] else 0

    db = get_db()
    existing_cnt = db.execute("SELECT COUNT(*) AS cnt FROM accounts").fetchone()["cnt"]
    color = (data.get("color") or "").strip() or ACCOUNT_COLOR_PALETTE[existing_cnt % len(ACCOUNT_COLOR_PALETTE)]
    bal_curr = float(data.get("balance_current", 0.0))
    bal_avail = float(data.get("balance_available", bal_curr))

    cur = db.execute(
        """
        INSERT INTO accounts (name, official_name, type, subtype, mask, balance_current, balance_available, owner_scope, owner_partner_id, institution_name, color, is_savings_account)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            data.get("official_name") or name,
            data.get("type", "depository"),
            data.get("subtype", "checking"),
            data.get("mask", "0000"),
            bal_curr,
            bal_avail,
            data.get("owner_scope", "individual" if owner_partner_id else "shared"),
            owner_partner_id,
            data.get("institution_name", "Manual Entry"),
            color,
            is_savings_account,
        ),
    )
    _upsert_account_balance_snapshot(db, cur.lastrowid, bal_curr)
    db.commit()
    acc = dict(
        db.execute(
            """
            SELECT a.*, p.name AS owner_partner_name, p.avatar_color AS owner_partner_color
            FROM accounts a
            LEFT JOIN partners p ON a.owner_partner_id = p.id
            WHERE a.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    )
    acc.update(classify_savings_account(acc))
    return jsonify(acc), 201


@finance_bp.route("/accounts/<int:acc_id>", methods=["PUT"])
def update_account(acc_id: int):
    db = get_db()
    acc = db.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    if not acc:
        return jsonify({"error": "Account not found"}), 404

    data = request.get_json(silent=True) or {}
    fields = []
    params = []

    if "name" in data and str(data["name"]).strip():
        fields.append("name = ?")
        params.append(str(data["name"]).strip())

    if "official_name" in data:
        fields.append("official_name = ?")
        params.append(str(data["official_name"]).strip() if data["official_name"] else None)

    if "type" in data and str(data["type"]).strip():
        fields.append("type = ?")
        params.append(str(data["type"]).strip())

    if "subtype" in data and str(data["subtype"]).strip():
        fields.append("subtype = ?")
        params.append(str(data["subtype"]).strip())

    if "mask" in data:
        fields.append("mask = ?")
        params.append(str(data["mask"]).strip())

    if "institution_name" in data and str(data["institution_name"]).strip():
        fields.append("institution_name = ?")
        params.append(str(data["institution_name"]).strip())

    if "balance_current" in data:
        fields.append("balance_current = ?")
        params.append(float(data["balance_current"]))
        _upsert_account_balance_snapshot(db, acc_id, float(data["balance_current"]))

    if "balance_available" in data:
        fields.append("balance_available = ?")
        params.append(float(data["balance_available"]))

    if "color" in data and str(data["color"]).strip():
        fields.append("color = ?")
        params.append(str(data["color"]).strip())

    if "is_savings_account" in data:
        raw_sav = data["is_savings_account"]
        if raw_sav is None or str(raw_sav).strip().lower() in ["", "auto", "null", "none"]:
            fields.append("is_savings_account = ?")
            params.append(None)
        else:
            fields.append("is_savings_account = ?")
            params.append(1 if bool(raw_sav) and str(raw_sav).lower() not in ["0", "false"] else 0)

    if "owner_partner_id" in data:
        raw_pid = data["owner_partner_id"]
        if raw_pid is None or str(raw_pid).strip().lower() in ["", "none", "null", "0", "shared"]:
            fields.append("owner_partner_id = ?")
            params.append(None)
            if "owner_scope" not in data:
                fields.append("owner_scope = ?")
                params.append("shared")
        else:
            fields.append("owner_partner_id = ?")
            params.append(int(raw_pid))
            if "owner_scope" not in data:
                fields.append("owner_scope = ?")
                params.append("individual")

    if "owner_scope" in data:
        fields.append("owner_scope = ?")
        params.append(str(data["owner_scope"]).strip())

    if fields:
        params.append(acc_id)
        db.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", params)
        db.commit()

    updated = dict(
        db.execute(
            """
            SELECT a.*, p.name AS owner_partner_name, p.avatar_color AS owner_partner_color
            FROM accounts a
            LEFT JOIN partners p ON a.owner_partner_id = p.id
            WHERE a.id = ?
            """,
            (acc_id,),
        ).fetchone()
    )
    updated.update(classify_savings_account(updated))
    return jsonify(updated)


@finance_bp.route("/accounts/<int:acc_id>", methods=["DELETE"])
def delete_account(acc_id: int):
    db = get_db()
    acc = db.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    if not acc:
        return jsonify({"error": "Account not found"}), 404

    # 1. Also locate any duplicate Plaid accounts matching the same institution/mask/subtype/name
    sig = (
        (acc["institution_name"] or "").strip().lower(),
        (acc["mask"] or "").strip(),
        (acc["subtype"] or "").strip().lower(),
        (acc["name"] or "").strip().lower(),
    )
    matching_rows = db.execute(
        """
        SELECT * FROM accounts
        WHERE id = ?
           OR (
               plaid_account_id IS NOT NULL
               AND LOWER(COALESCE(institution_name, '')) = ?
               AND COALESCE(mask, '') = ?
               AND LOWER(COALESCE(subtype, '')) = ?
               AND LOWER(COALESCE(name, '')) = ?
           )
        """,
        (acc_id, *sig),
    ).fetchall()

    target_acc_ids = [r["id"] for r in matching_rows]
    affected_item_ids = {r["item_id"] for r in matching_rows if r["item_id"]}

    # 2. Record in deleted_accounts_blocklist so future Plaid syncs never re-create this account
    for r in matching_rows:
        if r["plaid_account_id"] or r["institution_name"]:
            db.execute(
                """
                INSERT INTO deleted_accounts_blocklist (plaid_account_id, item_id, institution_name, name, subtype, mask)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    r["plaid_account_id"],
                    r["item_id"],
                    r["institution_name"],
                    r["name"],
                    r["subtype"],
                    r["mask"],
                ),
            )

    # 3. Delete transactions, income entries, and account rows
    ph = ",".join("?" * len(target_acc_ids))
    deleted_tx = db.execute(f"DELETE FROM transactions WHERE account_id IN ({ph})", target_acc_ids).rowcount
    deleted_inc = db.execute(f"DELETE FROM income_entries WHERE account_id IN ({ph})", target_acc_ids).rowcount
    db.execute(f"DELETE FROM accounts WHERE id IN ({ph})", target_acc_ids)

    # 4. Clean up plaid_items if no accounts remain for that item_id OR for that institution_name
    for it_id in affected_item_ids:
        remaining = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE item_id = ?", (it_id,)
        ).fetchone()["cnt"]
        if remaining == 0:
            db.execute("DELETE FROM plaid_items WHERE item_id = ?", (it_id,))

    if acc["institution_name"]:
        rem_inst = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE LOWER(COALESCE(institution_name, '')) = ? AND plaid_account_id IS NOT NULL",
            ((acc["institution_name"] or "").strip().lower(),),
        ).fetchone()["cnt"]
        if rem_inst == 0:
            db.execute(
                "DELETE FROM plaid_items WHERE LOWER(COALESCE(institution_name, '')) = ?",
                ((acc["institution_name"] or "").strip().lower(),),
            )

    db.commit()
    return jsonify({
        "deleted": True,
        "id": acc_id,
        "deleted_account_ids": target_acc_ids,
        "deleted_accounts_count": len(target_acc_ids),
        "deleted_transactions": deleted_tx,
        "deleted_income_entries": deleted_inc,
    })


@finance_bp.route("/transactions", methods=["POST"])
def create_transaction():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    amount = float(data.get("amount", 0))
    if not name or amount <= 0:
        return jsonify({"error": "Valid transaction name and positive amount are required"}), 400

    account_id = data.get("account_id")
    raw_sav_acc = data.get("savings_account_id")
    savings_account_id = (
        int(raw_sav_acc)
        if raw_sav_acc and str(raw_sav_acc).isdigit() and int(raw_sav_acc) > 0
        else None
    )
    actor = getattr(g, "current_partner", None)
    partner_id = actor["id"] if actor else data.get("partner_id")

    tx_date = (data.get("date") or date.today().isoformat()).strip()
    date_ym = tx_date[:7]

    explicit_budget_month = (data.get("budget_month") or "").strip()[:7]
    month_offset = int(data.get("month_offset", 0))
    if explicit_budget_month and len(explicit_budget_month) == 7:
        budget_month = explicit_budget_month
    elif month_offset != 0:
        budget_month = _shift_year_month(date_ym, month_offset)
    else:
        budget_month = date_ym

    category = (data.get("category") or "Groceries & Dining").strip()
    is_pending = 1 if data.get("is_pending") else 0
    is_savings_spend = 1 if (bool(data.get("is_savings_spend")) or category.lower() in SAVINGS_SPEND_ALIASES) else 0
    if is_savings_spend:
        category = SAVINGS_SPEND_CATEGORY

    is_cc_payment = 1 if (bool(data.get("is_cc_payment")) or category.lower() in CC_PAYMENT_ALIASES) else 0
    if is_cc_payment:
        category = CC_PAYMENT_CATEGORY

    db = get_db()
    if not is_savings_spend and not is_cc_payment and category.lower() != "split":
        _ensure_category_in_catalog(db, category, is_preloaded=1 if category in DEFAULT_CATEGORIES else 0, unarchive=True)
    cur = db.execute(
        """
        INSERT INTO transactions (account_id, savings_account_id, date, budget_month, name, merchant_name, amount, category, partner_id, is_shared, notes, is_pending, is_savings_spend, is_cc_payment, is_split)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(account_id) if account_id else None,
            savings_account_id,
            tx_date,
            budget_month,
            name,
            data.get("merchant_name") or name,
            round(amount, 2),
            category,
            int(partner_id) if partner_id else None,
            1 if data.get("is_shared", True) else 0,
            data.get("notes", ""),
            is_pending,
            is_savings_spend,
            is_cc_payment,
            0,
        ),
    )
    new_id = cur.lastrowid
    db.commit()
    tx = dict(
        db.execute(
            """
            SELECT t.*,
                   a.name AS account_name, a.color AS account_color, a.mask AS account_mask,
                   sa.name AS savings_account_name, sa.color AS savings_account_color
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            LEFT JOIN accounts sa ON t.savings_account_id = sa.id
            WHERE t.id = ?
            """,
            (new_id,),
        ).fetchone()
    )
    tx["is_savings_spend"] = is_tx_savings_spend(tx)
    tx["is_cc_payment"] = is_tx_cc_payment(tx)
    tx["splits"] = []
    tx["is_split"] = False
    return jsonify(tx), 201


@finance_bp.route("/transactions/<int:tx_id>", methods=["PUT"])
def update_transaction(tx_id: int):
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Transaction not found"}), 404

    current_budget_month = existing["budget_month"] or existing["date"][:7]
    date_month = existing["date"][:7]

    new_category = (data.get("category") or existing["category"]).strip()
    if not new_category:
        return jsonify({"error": "Category cannot be empty"}), 400

    new_is_split = int(existing["is_split"] or 0)

    # 1. Savings Spend Handling
    if "is_savings_spend" in data:
        if bool(data["is_savings_spend"]):
            new_is_savings_spend = 1
            new_category = SAVINGS_SPEND_CATEGORY
            new_is_cc_payment = 0
            new_is_split = 0
            db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
        else:
            new_is_savings_spend = 0
            if new_category.lower() in SAVINGS_SPEND_ALIASES:
                new_category = (data.get("fallback_category") or "Shopping & Tech").strip()
    else:
        if "category" in data:
            if new_category.lower() in SAVINGS_SPEND_ALIASES:
                new_is_savings_spend = 1
                new_category = SAVINGS_SPEND_CATEGORY
                new_is_cc_payment = 0
                new_is_split = 0
                db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
            else:
                new_is_savings_spend = 0
        else:
            new_is_savings_spend = int(existing["is_savings_spend"] or 0)
            if new_category.lower() in SAVINGS_SPEND_ALIASES:
                new_is_savings_spend = 1

    # 2. CC Payment Handling
    if "is_cc_payment" in data:
        if bool(data["is_cc_payment"]):
            new_is_cc_payment = 1
            new_category = CC_PAYMENT_CATEGORY
            new_is_savings_spend = 0
            new_is_split = 0
            db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
        else:
            new_is_cc_payment = 0
            if new_category.lower() in CC_PAYMENT_ALIASES:
                new_category = (data.get("fallback_category") or "General").strip()
    else:
        if "category" in data:
            if new_category.lower() in CC_PAYMENT_ALIASES:
                new_is_cc_payment = 1
                new_category = CC_PAYMENT_CATEGORY
                new_is_savings_spend = 0
                new_is_split = 0
                db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
            else:
                new_is_cc_payment = 0
        else:
            new_is_cc_payment = int(existing["is_cc_payment"] or 0)
            if new_category.lower() in CC_PAYMENT_ALIASES:
                new_is_cc_payment = 1

    # 3. Split reset if user sets a regular category
    if "category" in data and data["category"].strip().lower() not in ("split", ""):
        if not new_is_savings_spend and not new_is_cc_payment:
            db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
            new_is_split = 0

    if "allocate_direction" in data:
        direction = data["allocate_direction"]
        if direction == "prev":
            new_budget_month = _shift_year_month(current_budget_month, -1)
        elif direction == "next":
            new_budget_month = _shift_year_month(current_budget_month, 1)
        elif direction == "reset":
            new_budget_month = date_month
        else:
            new_budget_month = current_budget_month
    elif "budget_month" in data and str(data["budget_month"]).strip():
        new_budget_month = str(data["budget_month"]).strip()[:7]
    else:
        new_budget_month = current_budget_month

    new_notes = data.get("notes", existing["notes"])
    new_name = (data.get("name") or existing["name"]).strip()
    if "account_id" in data:
        raw_acc = data["account_id"]
        new_account_id = int(raw_acc) if raw_acc and str(raw_acc).isdigit() and int(raw_acc) > 0 else None
    else:
        new_account_id = existing["account_id"]

    if "savings_account_id" in data:
        raw_sav = data["savings_account_id"]
        new_savings_account_id = int(raw_sav) if raw_sav and str(raw_sav).isdigit() and int(raw_sav) > 0 else None
    else:
        new_savings_account_id = existing["savings_account_id"]

    new_is_pending = (1 if data["is_pending"] else 0) if "is_pending" in data else existing["is_pending"]

    if not new_is_savings_spend and not new_is_cc_payment and new_category.lower() != "split":
        _ensure_category_in_catalog(db, new_category, is_preloaded=1 if new_category in DEFAULT_CATEGORIES else 0, unarchive=True)
    db.execute(
        """
        UPDATE transactions
        SET category = ?, budget_month = ?, notes = ?, name = ?, account_id = ?, savings_account_id = ?, is_pending = ?, is_savings_spend = ?, is_cc_payment = ?, is_split = ?
        WHERE id = ?
        """,
        (
            new_category,
            new_budget_month,
            new_notes,
            new_name,
            new_account_id,
            new_savings_account_id,
            new_is_pending,
            new_is_savings_spend,
            new_is_cc_payment,
            new_is_split,
            tx_id,
        ),
    )
    db.commit()

    updated = dict(
        db.execute(
            """
            SELECT t.*,
                   a.name AS account_name, a.color AS account_color, a.mask AS account_mask,
                   sa.name AS savings_account_name, sa.color AS savings_account_color
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            LEFT JOIN accounts sa ON t.savings_account_id = sa.id
            WHERE t.id = ?
            """,
            (tx_id,),
        ).fetchone()
    )
    updated["is_savings_spend"] = is_tx_savings_spend(updated)
    updated["is_cc_payment"] = is_tx_cc_payment(updated)
    split_rows = db.execute(
        "SELECT id, transaction_id, category, amount, notes FROM transaction_splits WHERE transaction_id = ? ORDER BY id ASC",
        (tx_id,),
    ).fetchall()
    updated["splits"] = [
        {
            "id": r["id"],
            "transaction_id": r["transaction_id"],
            "category": r["category"],
            "amount": round(float(r["amount"]), 2),
            "notes": r["notes"] or "",
        }
        for r in split_rows
    ]
    updated["is_split"] = bool(updated.get("is_split")) or len(updated["splits"]) > 0
    return jsonify(updated)


@finance_bp.route("/transactions/<int:tx_id>/split", methods=["POST"])
def split_transaction(tx_id: int):
    data = request.get_json(silent=True) or {}
    splits = data.get("splits")
    if not isinstance(splits, list) or len(splits) == 0:
        return jsonify({"error": "Splits array must contain at least one item"}), 400

    db = get_db()
    existing = db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Transaction not found"}), 404

    tx_amount = round(float(existing["amount"]), 2)

    # If only 1 split provided, treat as reverting to single category
    if len(splits) == 1:
        cat = (splits[0].get("category") or "General").strip()
        db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
        _ensure_category_in_catalog(db, cat, unarchive=True)
        db.execute(
            "UPDATE transactions SET category = ?, is_split = 0, is_cc_payment = 0, is_savings_spend = 0 WHERE id = ?",
            (cat, tx_id),
        )
        db.commit()
        return jsonify({
            "message": "Transaction reverted to single category",
            "id": tx_id,
            "category": cat,
            "is_split": False,
            "splits": [],
        })

    # Validate each split item and sum
    sum_amounts = 0.0
    cleaned_splits = []
    for sp in splits:
        cat = (sp.get("category") or "").strip()
        if not cat:
            return jsonify({"error": "Every split must have a selected category"}), 400
        try:
            amt = round(float(sp.get("amount") or 0.0), 2)
        except (ValueError, TypeError):
            return jsonify({"error": f"Invalid amount for category '{cat}'"}), 400
        if amt <= 0:
            return jsonify({"error": f"Split amount for '{cat}' must be greater than $0.00"}), 400
        sum_amounts += amt
        cleaned_splits.append({
            "category": cat,
            "amount": amt,
            "notes": (sp.get("notes") or "").strip(),
        })

    sum_amounts = round(sum_amounts, 2)
    # Allow 1 cent rounding difference and auto-adjust last split if needed
    diff = round(tx_amount - sum_amounts, 2)
    if abs(diff) > 0.01:
        return (
            jsonify({
                "error": f"Total split amounts (${sum_amounts:.2f}) must equal transaction amount (${tx_amount:.2f}). Difference: ${diff:.2f}"
            }),
            400,
        )
    if diff != 0.0:
        cleaned_splits[-1]["amount"] = round(cleaned_splits[-1]["amount"] + diff, 2)

    # Delete previous splits
    db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))

    # Insert new splits & ensure categories exist in catalog
    for sp in cleaned_splits:
        _ensure_category_in_catalog(db, sp["category"], unarchive=True)
        db.execute(
            """
            INSERT INTO transaction_splits (transaction_id, category, amount, notes)
            VALUES (?, ?, ?, ?)
            """,
            (tx_id, sp["category"], sp["amount"], sp["notes"]),
        )

    db.execute(
        """
        UPDATE transactions
        SET is_split = 1, is_cc_payment = 0, is_savings_spend = 0, category = 'Split'
        WHERE id = ?
        """,
        (tx_id,),
    )
    db.commit()

    saved_splits = [
        dict(r)
        for r in db.execute(
            "SELECT id, transaction_id, category, amount, notes FROM transaction_splits WHERE transaction_id = ? ORDER BY id ASC",
            (tx_id,),
        ).fetchall()
    ]
    return jsonify({
        "message": "Transaction split successfully",
        "id": tx_id,
        "is_split": True,
        "category": "Split",
        "splits": saved_splits,
    })


@finance_bp.route("/transactions/<int:tx_id>/split", methods=["DELETE"])
def revert_split_transaction(tx_id: int):
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Transaction not found"}), 404

    # Determine fallback category: user specified, or first split category, or 'General'
    fallback_cat = (data.get("category") or "").strip()
    if not fallback_cat:
        first_sp = db.execute(
            "SELECT category FROM transaction_splits WHERE transaction_id = ? ORDER BY id ASC LIMIT 1",
            (tx_id,),
        ).fetchone()
        if first_sp and first_sp["category"]:
            fallback_cat = first_sp["category"]
        else:
            fallback_cat = "General"

    db.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (tx_id,))
    _ensure_category_in_catalog(db, fallback_cat, unarchive=True)
    db.execute(
        "UPDATE transactions SET is_split = 0, category = ? WHERE id = ?",
        (fallback_cat, tx_id),
    )
    db.commit()

    return jsonify({
        "message": "Transaction split removed, reverted to single category",
        "id": tx_id,
        "is_split": False,
        "category": fallback_cat,
        "splits": [],
    })


@finance_bp.route("/transactions/<int:tx_id>", methods=["DELETE"])
def delete_transaction(tx_id: int):
    db = get_db()
    db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    db.commit()
    return jsonify({"deleted": True, "id": tx_id})


@finance_bp.route("/budgets", methods=["POST"])
def upsert_budget():
    """
    Creates or updates a monthly category budget for a specific `budget_month`.
    `apply_scope`:
      - 'this_and_future' (default): updates `budget_month` and future months (plus base template), leaving past historical months untouched!
      - 'only_this_month': updates ONLY `budget_month`.
    """
    data = request.get_json(silent=True) or {}
    category = (data.get("category") or "").strip()
    monthly_limit = float(data.get("monthly_limit", 0))
    if not category or monthly_limit <= 0:
        return jsonify({"error": "Category and positive monthly_limit are required"}), 400

    color = data.get("color", "#6366f1")
    target_month = (data.get("budget_month") or date.today().strftime("%Y-%m")).strip()[:7]
    apply_scope = data.get("apply_scope", "this_and_future")

    db = get_db()
    _ensure_category_in_catalog(db, category, is_preloaded=1 if category in DEFAULT_CATEGORIES else 0, unarchive=True)
    # Ensure the target month is initialized before modifying it
    _ensure_monthly_budgets_for_month(db, target_month)

    db.execute(
        """
        INSERT INTO monthly_budgets (budget_month, category, monthly_limit, color, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(budget_month, category) DO UPDATE SET
            monthly_limit = excluded.monthly_limit,
            color = excluded.color,
            is_active = 1
        """,
        (target_month, category, monthly_limit, color),
    )

    if apply_scope == "this_and_future":
        # Update base template for future uninitialized months
        db.execute(
            """
            INSERT INTO budgets (category, monthly_limit, color)
            VALUES (?, ?, ?)
            ON CONFLICT(category) DO UPDATE SET
                monthly_limit = excluded.monthly_limit,
                color = excluded.color
            """,
            (category, monthly_limit, color),
        )
        # Also update any already-initialized future months (> target_month), leaving past months (< target_month) untouched!
        future_months = db.execute(
            "SELECT DISTINCT budget_month FROM monthly_budgets WHERE budget_month > ?",
            (target_month,),
        ).fetchall()
        for fm in future_months:
            db.execute(
                """
                INSERT INTO monthly_budgets (budget_month, category, monthly_limit, color, is_active)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(budget_month, category) DO UPDATE SET
                    monthly_limit = excluded.monthly_limit,
                    color = excluded.color,
                    is_active = 1
                """,
                (fm["budget_month"], category, monthly_limit, color),
            )

    db.commit()
    row = dict(
        db.execute(
            "SELECT * FROM monthly_budgets WHERE budget_month = ? AND category = ?",
            (target_month, category),
        ).fetchone()
    )
    return jsonify(row), 201


@finance_bp.route("/budgets/<int:budget_id>", methods=["DELETE"])
def delete_budget(budget_id: int):
    """
    Removes/cancels a budget category in `month` (e.g. when cancelling Netflix).
    `apply_scope`:
      - 'this_and_future' (default): removes from `month` and future months, while keeping it in historical months `< month`!
      - 'only_this_month': removes from `month` only.
    """
    db = get_db()
    apply_scope = request.args.get("apply_scope", "this_and_future")

    mb_row = db.execute("SELECT * FROM monthly_budgets WHERE id = ?", (budget_id,)).fetchone()
    if mb_row:
        target_month = mb_row["budget_month"]
        category = mb_row["category"]
        db.execute("UPDATE monthly_budgets SET is_active = 0 WHERE id = ?", (budget_id,))
        if apply_scope == "this_and_future":
            db.execute("DELETE FROM budgets WHERE category = ?", (category,))
            db.execute(
                "UPDATE monthly_budgets SET is_active = 0 WHERE category = ? AND budget_month >= ?",
                (category, target_month),
            )
    else:
        # Fallback if deleting by base budgets id
        b_row = db.execute("SELECT * FROM budgets WHERE id = ?", (budget_id,)).fetchone()
        if b_row:
            db.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
            db.execute(
                "UPDATE monthly_budgets SET is_active = 0 WHERE category = ?",
                (b_row["category"],),
            )

    db.commit()
    return jsonify({"deleted": True, "id": budget_id})


# --- Category Management Panel API (Pre-Loaded & Custom Categories + Untracked Flagging) ---

@finance_bp.route("/categories", methods=["GET"])
def list_categories_catalog():
    current_ym = date.today().strftime("%Y-%m")
    selected_month = (request.args.get("month") or current_ym).strip()[:7]
    db = get_db()
    month_budgets = _ensure_monthly_budgets_for_month(db, selected_month)
    all_txs = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*,
                   COALESCE(NULLIF(t.budget_month, ''), substr(t.date, 1, 7)) AS effective_budget_month
            FROM transactions t
            """
        ).fetchall()
    ]
    month_txs = [tx for tx in all_txs if tx["effective_budget_month"] == selected_month]
    payload = _build_category_management_payload(db, selected_month, month_budgets, month_txs, all_txs)
    return jsonify(payload)


@finance_bp.route("/categories", methods=["POST"])
def create_or_restore_category():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Category name is required"}), 400

    color = (data.get("color") or "#06b6d4").strip()
    monthly_limit = float(data.get("monthly_limit") or 0.0)
    target_month = (data.get("budget_month") or date.today().strftime("%Y-%m")).strip()[:7]
    apply_scope = data.get("apply_scope", "this_and_future")

    db = get_db()
    _sync_category_catalog(db)
    db.execute(
        """
        INSERT INTO category_catalog (name, is_preloaded, is_archived, color)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(name) DO UPDATE SET
            is_archived = 0,
            color = excluded.color
        """,
        (name, 1 if name in DEFAULT_CATEGORIES else 0, color),
    )

    if monthly_limit > 0:
        _ensure_monthly_budgets_for_month(db, target_month)
        db.execute(
            """
            INSERT INTO monthly_budgets (budget_month, category, monthly_limit, color, is_active)
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(budget_month, category) DO UPDATE SET
                monthly_limit = excluded.monthly_limit,
                color = excluded.color,
                is_active = 1
            """,
            (target_month, name, monthly_limit, color),
        )
        if apply_scope == "this_and_future":
            db.execute(
                """
                INSERT INTO budgets (category, monthly_limit, color)
                VALUES (?, ?, ?)
                ON CONFLICT(category) DO UPDATE SET
                    monthly_limit = excluded.monthly_limit,
                    color = excluded.color
                """,
                (name, monthly_limit, color),
            )
            future_months = db.execute(
                "SELECT DISTINCT budget_month FROM monthly_budgets WHERE budget_month > ?",
                (target_month,),
            ).fetchall()
            for fm in future_months:
                db.execute(
                    """
                    INSERT INTO monthly_budgets (budget_month, category, monthly_limit, color, is_active)
                    VALUES (?, ?, ?, ?, 1)
                    ON CONFLICT(budget_month, category) DO UPDATE SET
                        monthly_limit = excluded.monthly_limit,
                        color = excluded.color,
                        is_active = 1
                    """,
                    (fm["budget_month"], name, monthly_limit, color),
                )

    db.commit()
    cat_row = dict(db.execute("SELECT * FROM category_catalog WHERE name = ?", (name,)).fetchone())
    return jsonify(cat_row), 201


@finance_bp.route("/categories", methods=["PUT"])
def rename_or_merge_category():
    """
    Renames a category or merges `old_name` into `new_name` across all transactions,
    budgets, monthly_budgets, purchase_requests, future_purchases, and category_catalog.
    """
    data = request.get_json(silent=True) or {}
    old_name = (data.get("old_name") or "").strip()
    new_name = (data.get("new_name") or "").strip()
    if not old_name or not new_name:
        return jsonify({"error": "Both old_name and new_name are required"}), 400

    db = get_db()
    _sync_category_catalog(db)

    if old_name == new_name:
        return jsonify({"updated": True, "old_name": old_name, "new_name": new_name})

    # Ensure new_name exists and is unarchived in category_catalog
    _ensure_category_in_catalog(
        db,
        new_name,
        is_preloaded=1 if new_name in DEFAULT_CATEGORIES else 0,
        unarchive=True,
    )

    # Reassign transactions, purchase_requests, and future_purchases
    db.execute("UPDATE transactions SET category = ? WHERE category = ?", (new_name, old_name))
    db.execute("UPDATE transaction_splits SET category = ? WHERE category = ?", (new_name, old_name))
    db.execute("UPDATE purchase_requests SET category = ? WHERE category = ?", (new_name, old_name))
    db.execute("UPDATE future_purchases SET category = ? WHERE category = ?", (new_name, old_name))

    # Merge or rename in base `budgets`
    old_base = db.execute("SELECT * FROM budgets WHERE category = ?", (old_name,)).fetchone()
    new_base = db.execute("SELECT * FROM budgets WHERE category = ?", (new_name,)).fetchone()
    if old_base and not new_base:
        db.execute("UPDATE budgets SET category = ? WHERE id = ?", (new_name, old_base["id"]))
    elif old_base and new_base:
        db.execute("DELETE FROM budgets WHERE id = ?", (old_base["id"],))

    # Merge or rename in `monthly_budgets`
    old_mbs = db.execute("SELECT * FROM monthly_budgets WHERE category = ?", (old_name,)).fetchall()
    for omb in old_mbs:
        existing_target = db.execute(
            "SELECT * FROM monthly_budgets WHERE budget_month = ? AND category = ?",
            (omb["budget_month"], new_name),
        ).fetchone()
        if not existing_target:
            db.execute("UPDATE monthly_budgets SET category = ? WHERE id = ?", (new_name, omb["id"]))
        else:
            if omb["is_active"] and not existing_target["is_active"]:
                db.execute(
                    "UPDATE monthly_budgets SET is_active = 1, monthly_limit = ? WHERE id = ?",
                    (omb["monthly_limit"], existing_target["id"]),
                )
            db.execute("DELETE FROM monthly_budgets WHERE id = ?", (omb["id"],))

    # Archive old_name if pre-loaded (so it doesn't get re-seeded), or delete if custom
    old_cat_row = db.execute("SELECT * FROM category_catalog WHERE name = ?", (old_name,)).fetchone()
    if old_cat_row and old_cat_row["is_preloaded"]:
        db.execute("UPDATE category_catalog SET is_archived = 1 WHERE name = ?", (old_name,))
    else:
        db.execute("DELETE FROM category_catalog WHERE name = ?", (old_name,))

    db.commit()
    return jsonify({"updated": True, "old_name": old_name, "new_name": new_name})


@finance_bp.route("/categories", methods=["DELETE"])
def delete_or_archive_category():
    """
    Removes/archives a pre-loaded or custom category so it no longer clutters dropdowns or budgets.
    Optionally reassigns any existing transactions to `reassign_to`.
    """
    data = request.get_json(silent=True) or {}
    name = (request.args.get("name") or data.get("name") or "").strip()
    reassign_to = (request.args.get("reassign_to") or data.get("reassign_to") or "").strip()
    target_month = (request.args.get("month") or data.get("month") or date.today().strftime("%Y-%m")).strip()[:7]

    if not name:
        return jsonify({"error": "Category name is required"}), 400

    db = get_db()
    _sync_category_catalog(db)

    if reassign_to and reassign_to != name:
        _ensure_category_in_catalog(
            db,
            reassign_to,
            is_preloaded=1 if reassign_to in DEFAULT_CATEGORIES else 0,
            unarchive=True,
        )
        db.execute("UPDATE transactions SET category = ? WHERE category = ?", (reassign_to, name))
        db.execute("UPDATE transaction_splits SET category = ? WHERE category = ?", (reassign_to, name))
        db.execute("UPDATE purchase_requests SET category = ? WHERE category = ?", (reassign_to, name))
        db.execute("UPDATE future_purchases SET category = ? WHERE category = ?", (reassign_to, name))

    # Remove from base budgets and deactivate in monthly_budgets from target_month onward
    db.execute("DELETE FROM budgets WHERE category = ?", (name,))
    db.execute(
        "UPDATE monthly_budgets SET is_active = 0 WHERE category = ? AND budget_month >= ?",
        (name, target_month),
    )

    cat_row = db.execute("SELECT * FROM category_catalog WHERE name = ?", (name,)).fetchone()
    remaining_tx = db.execute(
        "SELECT COUNT(*) AS cnt FROM transactions WHERE category = ?", (name,)
    ).fetchone()["cnt"]

    if (cat_row and cat_row["is_preloaded"]) or remaining_tx > 0:
        db.execute(
            """
            INSERT INTO category_catalog (name, is_preloaded, is_archived, color)
            VALUES (?, ?, 1, '#6366f1')
            ON CONFLICT(name) DO UPDATE SET is_archived = 1
            """,
            (name, 1 if name in DEFAULT_CATEGORIES else 0),
        )
    else:
        db.execute("DELETE FROM category_catalog WHERE name = ?", (name,))

    db.commit()
    return jsonify({"deleted": True, "name": name, "reassigned_to": reassign_to or None})


# --- Savings & Brokerage Long-Term Analytics Module API ---

def _build_continuous_month_range(min_ym: str, max_ym: str) -> list[str]:
    if not min_ym or not max_ym or min_ym > max_ym:
        return [max_ym or STARTING_BUDGET_MONTH]
    months = []
    curr = min_ym
    guard = 0
    while curr <= max_ym and guard < 120:
        months.append(curr)
        curr = _shift_year_month(curr, 1)
        guard += 1
    return months


@finance_bp.route("/savings", methods=["GET"])
def get_savings_analytics():
    """
    Returns comprehensive Month-over-Month (MoM) and Year-over-Year (YoY) analytics
    for Savings & Brokerage accounts, Transfers into Savings, and Purchases Funded from Savings.
    """
    current_ym = max(date.today().strftime("%Y-%m"), STARTING_BUDGET_MONTH)
    raw_req_month = (request.args.get("month") or "").strip()[:7]
    selected_month = raw_req_month if len(raw_req_month) == 7 else current_ym

    db = get_db()
    household_partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color FROM partners ORDER BY id"
        ).fetchall()
    ]

    all_accounts = []
    for r in db.execute(
        """
        SELECT a.*,
               p.name AS owner_partner_name,
               p.avatar_color AS owner_partner_color
        FROM accounts a
        LEFT JOIN partners p ON a.owner_partner_id = p.id
        ORDER BY a.type, a.subtype, a.name
        """
    ).fetchall():
        acc_d = dict(r)
        acc_d.update(classify_savings_account(acc_d))
        all_accounts.append(acc_d)

    savings_accounts = [a for a in all_accounts if a["is_savings_or_brokerage"]]
    sav_acc_ids = {a["id"] for a in savings_accounts}
    acc_lookup = {a["id"]: a for a in all_accounts}

    # Ensure current month snapshot exists for each savings/brokerage account if it has no snapshot for current_ym
    for sa in savings_accounts:
        existing_snap = db.execute(
            "SELECT id FROM account_balance_snapshots WHERE account_id = ? AND snapshot_month = ?",
            (sa["id"], current_ym),
        ).fetchone()
        if not existing_snap:
            _upsert_account_balance_snapshot(db, sa["id"], float(sa["balance_current"] or 0.0), current_ym)
    db.commit()

    # Load all snapshots
    snapshot_rows = db.execute(
        "SELECT * FROM account_balance_snapshots ORDER BY snapshot_month ASC"
    ).fetchall()
    snapshots_by_acc = {}
    snapshot_months = set()
    for sr in snapshot_rows:
        aid = sr["account_id"]
        sm = (sr["snapshot_month"] or "").strip()[:7]
        if len(sm) == 7 and aid in sav_acc_ids:
            snapshots_by_acc.setdefault(aid, {})[sm] = {
                "id": sr["id"],
                "account_id": aid,
                "snapshot_month": sm,
                "balance": round(float(sr["balance"] or 0.0), 2),
                "notes": sr["notes"] or "",
                "updated_at": sr["updated_at"],
            }
            snapshot_months.add(sm)

    # Fetch all inflows and identify Transfers Into Savings
    all_incomes = [
        dict(r)
        for r in db.execute(
            """
            SELECT i.*,
                   COALESCE(NULLIF(i.budget_month, ''), substr(i.date, 1, 7)) AS effective_budget_month,
                   p.name AS partner_name,
                   p.avatar_color AS partner_color,
                   a.name AS account_name,
                   a.color AS account_color,
                   a.mask AS account_mask,
                   a.subtype AS account_subtype,
                   a.type AS account_type,
                   a.institution_name AS account_institution
            FROM income_entries i
            LEFT JOIN partners p ON i.partner_id = p.id
            LEFT JOIN accounts a ON i.account_id = a.id
            ORDER BY i.date DESC, i.id DESC
            """
        ).fetchall()
    ]

    savings_transfers = []
    for inc in all_incomes:
        inc["budget_month"] = inc["effective_budget_month"]
        itype = (inc.get("income_type") or "").strip().lower()
        aid = inc.get("account_id")
        text_blob = f"{inc.get('source_name') or ''} {inc.get('notes') or ''}".lower()
        is_sav_transfer = False
        if aid in sav_acc_ids and not is_return_refund(itype) and itype != "cc_payment":
            is_sav_transfer = True
        elif itype in ("savings_transfer", "transfer_to_savings"):
            is_sav_transfer = True
        elif itype in ("transfer", "account_transfer") and any(
            k in text_blob for k in ("saving", "hysa", "brokerage", "invest", "ira", "roth", "401k", "vault", "reserve")
        ):
            is_sav_transfer = True

        if is_sav_transfer:
            acc_info = acc_lookup.get(aid)
            inc["savings_bucket"] = acc_info["savings_bucket"] if acc_info else "savings"
            savings_transfers.append(inc)

    # Fetch all transactions and identify Purchases Funded from Savings
    all_txs = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*,
                   COALESCE(NULLIF(t.budget_month, ''), substr(t.date, 1, 7)) AS effective_budget_month,
                   p.name AS partner_name,
                   p.avatar_color AS partner_color,
                   a.name AS account_name,
                   a.color AS account_color,
                   a.mask AS account_mask,
                   a.institution_name AS account_institution,
                   sa.name AS savings_account_name,
                   sa.color AS savings_account_color,
                   sa.mask AS savings_account_mask
            FROM transactions t
            LEFT JOIN partners p ON t.partner_id = p.id
            LEFT JOIN accounts a ON t.account_id = a.id
            LEFT JOIN accounts sa ON t.savings_account_id = sa.id
            ORDER BY t.date DESC, t.id DESC
            """
        ).fetchall()
    ]

    savings_spends = []
    for tx in all_txs:
        tx["budget_month"] = tx["effective_budget_month"]
        tx["is_savings_spend"] = is_tx_savings_spend(tx)
        if tx["is_savings_spend"] or (tx.get("account_id") in sav_acc_ids):
            eff_sav_acc_id = tx.get("savings_account_id") or (
                tx.get("account_id") if tx.get("account_id") in sav_acc_ids else None
            )
            tx["effective_savings_account_id"] = eff_sav_acc_id
            if eff_sav_acc_id and eff_sav_acc_id in acc_lookup:
                s_acc = acc_lookup[eff_sav_acc_id]
                tx["effective_savings_account_name"] = s_acc["name"]
                tx["effective_savings_account_color"] = s_acc["color"]
                tx["savings_bucket"] = s_acc["savings_bucket"]
            else:
                tx["effective_savings_account_name"] = "Household Savings"
                tx["effective_savings_account_color"] = "#10b981"
                tx["savings_bucket"] = "savings"
            savings_spends.append(tx)

    # Build timeline of months
    raw_months = {STARTING_BUDGET_MONTH, current_ym, selected_month}
    raw_months.update(snapshot_months)
    for tr in savings_transfers:
        if tr["budget_month"] and tr["budget_month"] >= STARTING_BUDGET_MONTH:
            raw_months.add(tr["budget_month"])
    for sp in savings_spends:
        if sp["budget_month"] and sp["budget_month"] >= STARTING_BUDGET_MONTH:
            raw_months.add(sp["budget_month"])
    for mb in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets WHERE is_active = 1").fetchall():
        if mb["budget_month"] and mb["budget_month"] >= STARTING_BUDGET_MONTH:
            raw_months.add(mb["budget_month"])

    valid_months = sorted(m for m in raw_months if m and len(m) == 7)
    chron_months = _build_continuous_month_range(valid_months[0], valid_months[-1]) if valid_months else [current_ym]

    # Map inflows & outflows per account & month, plus unassigned household flows
    inflows_by_acc_ym = {aid: {} for aid in sav_acc_ids}
    unassigned_inflows_by_ym = {}
    total_inflows_by_ym = {}

    for tr in savings_transfers:
        ym = tr["budget_month"]
        amt = round(float(tr["amount"] or 0.0), 2)
        total_inflows_by_ym[ym] = round(total_inflows_by_ym.get(ym, 0.0) + amt, 2)
        aid = tr.get("account_id")
        if aid in sav_acc_ids:
            inflows_by_acc_ym[aid][ym] = round(inflows_by_acc_ym[aid].get(ym, 0.0) + amt, 2)
        else:
            unassigned_inflows_by_ym[ym] = round(unassigned_inflows_by_ym.get(ym, 0.0) + amt, 2)

    outflows_by_acc_ym = {aid: {} for aid in sav_acc_ids}
    unassigned_outflows_by_ym = {}
    total_outflows_by_ym = {}

    for sp in savings_spends:
        ym = sp["budget_month"]
        amt = round(float(sp["amount"] or 0.0), 2)
        total_outflows_by_ym[ym] = round(total_outflows_by_ym.get(ym, 0.0) + amt, 2)
        aid = sp.get("effective_savings_account_id")
        if aid in sav_acc_ids:
            outflows_by_acc_ym[aid][ym] = round(outflows_by_acc_ym[aid].get(ym, 0.0) + amt, 2)
        else:
            unassigned_outflows_by_ym[ym] = round(unassigned_outflows_by_ym.get(ym, 0.0) + amt, 2)

    # Reconstruct monthly balance curve per account
    account_series = {}
    acc_bal_by_ym = {aid: {} for aid in sav_acc_ids}

    for sa in savings_accounts:
        aid = sa["id"]
        curr_live_bal = round(float(sa["balance_current"] or 0.0), 2)
        acc_snaps = snapshots_by_acc.get(aid, {})

        # Step 1: Anchor known snapshots; always anchor current_ym to live balance unless a snapshot was explicitly set
        month_vals = {}
        for m, s_obj in acc_snaps.items():
            month_vals[m] = s_obj["balance"]
        if current_ym in chron_months:
            month_vals[current_ym] = curr_live_bal
        elif chron_months:
            month_vals[chron_months[-1]] = curr_live_bal

        # Step 2: Fill backwards from the earliest anchored month
        anchor_indices = [i for i, m in enumerate(chron_months) if m in month_vals]
        if not anchor_indices:
            for m in chron_months:
                month_vals[m] = curr_live_bal
        else:
            first_idx = anchor_indices[0]
            for idx in range(first_idx - 1, -1, -1):
                next_m = chron_months[idx + 1]
                curr_m = chron_months[idx]
                next_net = inflows_by_acc_ym[aid].get(next_m, 0.0) - outflows_by_acc_ym[aid].get(next_m, 0.0)
                month_vals[curr_m] = round(max(0.0, month_vals[next_m] - next_net), 2)

            # Step 3: Fill forwards between/after anchored months
            for idx in range(first_idx + 1, len(chron_months)):
                curr_m = chron_months[idx]
                if curr_m not in month_vals:
                    prev_m = chron_months[idx - 1]
                    curr_net = inflows_by_acc_ym[aid].get(curr_m, 0.0) - outflows_by_acc_ym[aid].get(curr_m, 0.0)
                    month_vals[curr_m] = round(max(0.0, month_vals[prev_m] + curr_net), 2)

        series_list = []
        for idx, m in enumerate(chron_months):
            end_bal = round(month_vals.get(m, curr_live_bal), 2)
            acc_bal_by_ym[aid][m] = end_bal
            tin = round(inflows_by_acc_ym[aid].get(m, 0.0), 2)
            tout = round(outflows_by_acc_ym[aid].get(m, 0.0), 2)
            nflow = round(tin - tout, 2)
            start_bal = round(month_vals[chron_months[idx - 1]], 2) if idx > 0 else round(max(0.0, end_bal - nflow), 2)
            mom_chg = round(end_bal - start_bal, 2)
            mom_pct = round((mom_chg / start_bal) * 100, 1) if start_bal > 0 else 0.0
            series_list.append({
                "month": m,
                "year": m[:4],
                "starting_balance": start_bal,
                "balance": end_bal,
                "ending_balance": end_bal,
                "transfers_in": tin,
                "savings_spent": tout,
                "net_flow": nflow,
                "mom_change": mom_chg,
                "mom_change_pct": mom_pct,
                "is_snapshot": m in acc_snaps,
            })
        account_series[str(aid)] = series_list

    # Build Combined Month-over-Month (MoM) Series
    monthly_chron = []
    combined_bal_by_ym = {}

    for idx, m in enumerate(chron_months):
        sav_bal = round(
            sum(acc_bal_by_ym[a["id"]].get(m, 0.0) for a in savings_accounts if a["savings_bucket"] == "savings"),
            2,
        )
        brok_bal = round(
            sum(acc_bal_by_ym[a["id"]].get(m, 0.0) for a in savings_accounts if a["savings_bucket"] == "brokerage"),
            2,
        )
        comb_bal = round(sav_bal + brok_bal, 2)
        combined_bal_by_ym[m] = comb_bal

        tin = round(total_inflows_by_ym.get(m, 0.0), 2)
        tout = round(total_outflows_by_ym.get(m, 0.0), 2)
        unassigned_out = round(unassigned_outflows_by_ym.get(m, 0.0), 2)
        nflow = round(tin - tout, 2)

        start_bal = combined_bal_by_ym[chron_months[idx - 1]] if idx > 0 else round(max(0.0, comb_bal - nflow), 2)
        mom_chg = round(comb_bal - start_bal, 2)
        mom_pct = round((mom_chg / start_bal) * 100, 1) if start_bal > 0 else 0.0

        prev_year_m = _shift_year_month(m, -12)
        if prev_year_m in combined_bal_by_ym:
            yoy_base = combined_bal_by_ym[prev_year_m]
        else:
            yoy_base = start_bal if idx == 0 else combined_bal_by_ym[chron_months[0]]
        yoy_chg = round(comb_bal - yoy_base, 2)
        yoy_pct = round((yoy_chg / yoy_base) * 100, 1) if yoy_base > 0 else 0.0

        monthly_chron.append({
            "month": m,
            "year": m[:4],
            "starting_balance": start_bal,
            "combined_balance": comb_bal,
            "savings_balance": sav_bal,
            "brokerage_balance": brok_bal,
            "transfers_in": tin,
            "savings_spent": tout,
            "unassigned_savings_spent": unassigned_out,
            "net_flow": nflow,
            "mom_change": mom_chg,
            "mom_change_pct": mom_pct,
            "yoy_change": yoy_chg,
            "yoy_change_pct": yoy_pct,
            "account_balances": {str(a["id"]): acc_bal_by_ym[a["id"]].get(m, 0.0) for a in savings_accounts},
            "account_transfers_in": {str(a["id"]): inflows_by_acc_ym[a["id"]].get(m, 0.0) for a in savings_accounts},
            "account_savings_spent": {str(a["id"]): outflows_by_acc_ym[a["id"]].get(m, 0.0) for a in savings_accounts},
        })

    # Build Year-over-Year (YoY) Series
    years_order = sorted({m[:4] for m in chron_months})
    yearly_chron = []
    for y_idx, yr in enumerate(years_order):
        yr_months = [row for row in monthly_chron if row["year"] == yr]
        if not yr_months:
            continue
        first_m = yr_months[0]
        last_m = yr_months[-1]
        yr_start_bal = yearly_chron[y_idx - 1]["ending_balance"] if y_idx > 0 else first_m["starting_balance"]
        yr_end_bal = last_m["combined_balance"]
        yr_sav_end = last_m["savings_balance"]
        yr_brok_end = last_m["brokerage_balance"]
        yr_tin = round(sum(r["transfers_in"] for r in yr_months), 2)
        yr_tout = round(sum(r["savings_spent"] for r in yr_months), 2)
        yr_unassigned_out = round(sum(r["unassigned_savings_spent"] for r in yr_months), 2)
        yr_net = round(yr_tin - yr_tout, 2)
        yoy_chg = round(yr_end_bal - yr_start_bal, 2)
        yoy_pct = round((yoy_chg / yr_start_bal) * 100, 1) if yr_start_bal > 0 else 0.0

        acc_yr_tin = {
            str(a["id"]): round(sum(r["account_transfers_in"].get(str(a["id"]), 0.0) for r in yr_months), 2)
            for a in savings_accounts
        }
        acc_yr_tout = {
            str(a["id"]): round(sum(r["account_savings_spent"].get(str(a["id"]), 0.0) for r in yr_months), 2)
            for a in savings_accounts
        }

        yearly_chron.append({
            "year": yr,
            "starting_balance": yr_start_bal,
            "ending_balance": yr_end_bal,
            "combined_balance": yr_end_bal,
            "savings_ending_balance": yr_sav_end,
            "brokerage_ending_balance": yr_brok_end,
            "transfers_in": yr_tin,
            "savings_spent": yr_tout,
            "unassigned_savings_spent": yr_unassigned_out,
            "net_flow": yr_net,
            "yoy_change": yoy_chg,
            "yoy_change_pct": yoy_pct,
            "months_count": len(yr_months),
            "account_ending_balances": last_m["account_balances"],
            "account_transfers_in": acc_yr_tin,
            "account_savings_spent": acc_yr_tout,
        })

    # Enrich each savings_account with current month & MoM/YoY metrics
    for sa in savings_accounts:
        aid = sa["id"]
        s_list = account_series.get(str(aid), [])
        sel_entry = next((r for r in s_list if r["month"] == selected_month), s_list[-1] if s_list else None)
        first_entry = s_list[0] if s_list else None
        sa["month_transfers_in"] = sel_entry["transfers_in"] if sel_entry else 0.0
        sa["month_savings_spent"] = sel_entry["savings_spent"] if sel_entry else 0.0
        sa["month_net_flow"] = sel_entry["net_flow"] if sel_entry else 0.0
        sa["mom_change"] = sel_entry["mom_change"] if sel_entry else 0.0
        sa["mom_change_pct"] = sel_entry["mom_change_pct"] if sel_entry else 0.0
        yoy_base_val = first_entry["starting_balance"] if first_entry else float(sa["balance_current"] or 0.0)
        sa["yoy_change"] = round(float(sa["balance_current"] or 0.0) - yoy_base_val, 2)
        sa["yoy_change_pct"] = (
            round((sa["yoy_change"] / yoy_base_val) * 100, 1) if yoy_base_val > 0 else 0.0
        )

    total_savings_bal = round(
        sum(float(a["balance_current"] or 0.0) for a in savings_accounts if a["savings_bucket"] == "savings"),
        2,
    )
    total_brokerage_bal = round(
        sum(float(a["balance_current"] or 0.0) for a in savings_accounts if a["savings_bucket"] == "brokerage"),
        2,
    )
    total_combined_bal = round(total_savings_bal + total_brokerage_bal, 2)

    sel_month_row = next(
        (r for r in monthly_chron if r["month"] == selected_month),
        monthly_chron[-1] if monthly_chron else None,
    )
    curr_year_row = yearly_chron[-1] if yearly_chron else None

    kpis = {
        "total_combined_balance": total_combined_bal,
        "total_savings_balance": total_savings_bal,
        "total_brokerage_balance": total_brokerage_bal,
        "savings_account_count": sum(1 for a in savings_accounts if a["savings_bucket"] == "savings"),
        "brokerage_account_count": sum(1 for a in savings_accounts if a["savings_bucket"] == "brokerage"),
        "total_tracked_accounts": len(savings_accounts),
        "month_transfers_in": sel_month_row["transfers_in"] if sel_month_row else 0.0,
        "month_savings_spent": sel_month_row["savings_spent"] if sel_month_row else 0.0,
        "month_net_flow": sel_month_row["net_flow"] if sel_month_row else 0.0,
        "mom_balance_change": sel_month_row["mom_change"] if sel_month_row else 0.0,
        "mom_balance_change_pct": sel_month_row["mom_change_pct"] if sel_month_row else 0.0,
        "yoy_balance_change": curr_year_row["yoy_change"] if curr_year_row else 0.0,
        "yoy_balance_change_pct": curr_year_row["yoy_change_pct"] if curr_year_row else 0.0,
        "all_time_transfers_in": round(sum(float(t["amount"] or 0.0) for t in savings_transfers), 2),
        "all_time_savings_spent": round(sum(float(s["amount"] or 0.0) for s in savings_spends), 2),
        "all_time_net_flow": round(
            sum(float(t["amount"] or 0.0) for t in savings_transfers)
            - sum(float(s["amount"] or 0.0) for s in savings_spends),
            2,
        ),
    }

    return jsonify({
        "selected_month": selected_month,
        "current_calendar_month": current_ym,
        "available_months": list(reversed(chron_months)),
        "chronological_months": chron_months,
        "available_years": list(reversed(years_order)),
        "kpis": kpis,
        "savings_accounts": savings_accounts,
        "all_accounts": all_accounts,
        "partners": household_partners,
        "monthly_history": list(reversed(monthly_chron)),
        "monthly_chronological": monthly_chron,
        "yearly_history": list(reversed(yearly_chron)),
        "yearly_chronological": yearly_chron,
        "account_series": account_series,
        "savings_transfers": savings_transfers,
        "savings_spends": savings_spends,
    })


@finance_bp.route("/savings/transfer", methods=["POST"])
def log_savings_transfer():
    """
    Logs a transfer/deposit into a savings or brokerage account.
    Optionally updates the target account's current balance and monthly snapshot.
    """
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount") or 0.0)
    if amount <= 0:
        return jsonify({"error": "Positive transfer amount is required"}), 400

    raw_acc_id = data.get("account_id")
    account_id = int(raw_acc_id) if raw_acc_id and str(raw_acc_id).isdigit() and int(raw_acc_id) > 0 else None

    actor = getattr(g, "current_partner", None)
    partner_id = data.get("partner_id") or (actor["id"] if actor else None)

    tx_date = (data.get("date") or date.today().isoformat()).strip()
    budget_month = (data.get("budget_month") or tx_date[:7]).strip()[:7]
    source_name = (data.get("source_name") or "Transfer to Savings").strip()
    notes = (data.get("notes") or "").strip()
    update_balance = bool(data.get("update_account_balance", True))

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO income_entries
        (partner_id, account_id, date, budget_month, source_name, amount, expected_monthly_amount, income_type, category, is_recurring, notes)
        VALUES (?, ?, ?, ?, ?, ?, 0.0, 'transfer', '', 0, ?)
        """,
        (
            int(partner_id) if partner_id else None,
            account_id,
            tx_date,
            budget_month,
            source_name,
            round(amount, 2),
            notes,
        ),
    )

    if account_id and update_balance:
        acc_row = db.execute("SELECT balance_current, balance_available FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if acc_row:
            new_curr = round(float(acc_row["balance_current"] or 0.0) + amount, 2)
            new_avail = round(float(acc_row["balance_available"] or 0.0) + amount, 2)
            db.execute(
                "UPDATE accounts SET balance_current = ?, balance_available = ? WHERE id = ?",
                (new_curr, new_avail, account_id),
            )
            _upsert_account_balance_snapshot(db, account_id, new_curr, budget_month, f"After +${amount:.2f} transfer")

    db.commit()
    row = dict(db.execute("SELECT * FROM income_entries WHERE id = ?", (cur.lastrowid,)).fetchone())
    return jsonify(row), 201


@finance_bp.route("/savings/spend", methods=["POST"])
def log_savings_spend():
    """
    Logs a big purchase funded from savings (`is_savings_spend = 1`, `category = 'Spent from Savings'`).
    Excluded from monthly living budgets, tracked in long-term Savings & Analytics.
    """
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    amount = float(data.get("amount") or 0.0)
    if not name or amount <= 0:
        return jsonify({"error": "Purchase name and positive amount are required"}), 400

    raw_acc_id = data.get("account_id")
    account_id = int(raw_acc_id) if raw_acc_id and str(raw_acc_id).isdigit() and int(raw_acc_id) > 0 else None

    raw_sav_id = data.get("savings_account_id") or raw_acc_id
    savings_account_id = int(raw_sav_id) if raw_sav_id and str(raw_sav_id).isdigit() and int(raw_sav_id) > 0 else None

    actor = getattr(g, "current_partner", None)
    partner_id = data.get("partner_id") or (actor["id"] if actor else None)

    tx_date = (data.get("date") or date.today().isoformat()).strip()
    budget_month = (data.get("budget_month") or tx_date[:7]).strip()[:7]
    notes = (data.get("notes") or "").strip()
    deduct_balance = bool(
        data.get("deduct_from_account_balance") or data.get("update_account_balance")
    )

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO transactions
        (account_id, savings_account_id, date, budget_month, name, merchant_name, amount, category, partner_id, is_shared, notes, is_pending, is_savings_spend)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 1)
        """,
        (
            account_id,
            savings_account_id,
            tx_date,
            budget_month,
            name,
            data.get("merchant_name") or name,
            round(amount, 2),
            SAVINGS_SPEND_CATEGORY,
            int(partner_id) if partner_id else None,
            notes,
        ),
    )

    if savings_account_id and deduct_balance:
        acc_row = db.execute("SELECT balance_current, balance_available FROM accounts WHERE id = ?", (savings_account_id,)).fetchone()
        if acc_row:
            new_curr = round(max(0.0, float(acc_row["balance_current"] or 0.0) - amount), 2)
            new_avail = round(max(0.0, float(acc_row["balance_available"] or 0.0) - amount), 2)
            db.execute(
                "UPDATE accounts SET balance_current = ?, balance_available = ? WHERE id = ?",
                (new_curr, new_avail, savings_account_id),
            )
            _upsert_account_balance_snapshot(db, savings_account_id, new_curr, budget_month, f"After -${amount:.2f} savings spend")

    db.commit()
    tx = dict(
        db.execute(
            """
            SELECT t.*,
                   a.name AS account_name, a.color AS account_color, a.mask AS account_mask,
                   sa.name AS savings_account_name, sa.color AS savings_account_color
            FROM transactions t
            LEFT JOIN accounts a ON t.account_id = a.id
            LEFT JOIN accounts sa ON t.savings_account_id = sa.id
            WHERE t.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    )
    tx["is_savings_spend"] = True
    return jsonify(tx), 201


@finance_bp.route("/savings/snapshots", methods=["POST", "PUT"])
def upsert_savings_snapshot():
    """
    Records or updates a monthly balance snapshot for a savings or brokerage account.
    """
    data = request.get_json(silent=True) or {}
    raw_acc_id = data.get("account_id")
    if not raw_acc_id or not str(raw_acc_id).isdigit():
        return jsonify({"error": "Valid account_id is required"}), 400
    account_id = int(raw_acc_id)

    snapshot_month = (data.get("snapshot_month") or date.today().strftime("%Y-%m")).strip()[:7]
    if len(snapshot_month) != 7:
        return jsonify({"error": "Valid YYYY-MM snapshot_month is required"}), 400

    try:
        balance = round(float(data.get("balance", 0.0)), 2)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid balance amount"}), 400

    notes = (data.get("notes") or "").strip()
    current_ym = max(date.today().strftime("%Y-%m"), STARTING_BUDGET_MONTH)

    db = get_db()
    _upsert_account_balance_snapshot(db, account_id, balance, snapshot_month, notes or "Manual snapshot")

    # If updating the current month (or if update_current_balance is requested), sync live account balance
    if snapshot_month == current_ym or data.get("update_current_balance"):
        db.execute(
            "UPDATE accounts SET balance_current = ?, balance_available = ? WHERE id = ?",
            (balance, balance, account_id),
        )
    db.commit()
    snap = dict(
        db.execute(
            "SELECT * FROM account_balance_snapshots WHERE account_id = ? AND snapshot_month = ?",
            (account_id, snapshot_month),
        ).fetchone()
    )
    return jsonify(snap), 201

