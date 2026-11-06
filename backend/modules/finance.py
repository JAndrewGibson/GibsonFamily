from datetime import date
import requests
from flask import Blueprint, current_app, g, jsonify, request
from backend.database import get_db
from backend.security import decrypt_plaid_token, encrypt_plaid_token

finance_bp = Blueprint("finance", __name__, url_prefix="/api/finance")

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
NON_INCOME_TYPES = {"cc_payment", "credit_card_payment", "transfer", "account_transfer"}


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
        cat = (tx.get("category") or "").strip()
        if cat:
            month_spend_map[cat] = month_spend_map.get(cat, 0.0) + float(tx.get("amount") or 0.0)
            month_cnt_map[cat] = month_cnt_map.get(cat, 0) + 1

    all_spend_map = {}
    all_cnt_map = {}
    for tx in all_transactions:
        cat = (tx.get("category") or "").strip()
        if cat:
            all_spend_map[cat] = all_spend_map.get(cat, 0.0) + float(tx.get("amount") or 0.0)
            all_cnt_map[cat] = all_cnt_map.get(cat, 0) + 1

    enriched_catalog = []
    for row in catalog_rows:
        cat_name = row["name"]
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
        if not c["is_tracked"] and (not c["is_archived"] or c["month_tx_count"] > 0)
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


@finance_bp.route("/plaid/status", methods=["GET"])
def plaid_status():
    base_url, client_id, secret = _plaid_headers_and_auth()
    env_name = current_app.config.get("PLAID_ENV", "production")
    db = get_db()
    items = []
    for r in db.execute(
        "SELECT id, item_id, institution_name, linked_by_partner_id, created_at FROM plaid_items ORDER BY id DESC"
    ).fetchall():
        item_dict = dict(r)
        acc_cnt = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE item_id = ? OR (item_id IS NULL AND institution_name = ?)",
            (item_dict["item_id"], item_dict["institution_name"]),
        ).fetchone()["cnt"]
        item_dict["account_count"] = acc_cnt
        items.append(item_dict)

    dismissed_row = db.execute(
        "SELECT value FROM app_settings WHERE key = 'plaid_banner_dismissed'"
    ).fetchone()
    banner_dismissed = bool(dismissed_row and dismissed_row["value"] == "1")

    return jsonify({
        "configured": bool(client_id and secret),
        "environment": env_name,
        "is_production": env_name == "production",
        "base_url": base_url,
        "client_id_preview": f"{client_id[:6]}...{client_id[-4:]}" if len(client_id) >= 10 else ("configured" if client_id else ""),
        "linked_items": items,
        "banner_dismissed": banner_dismissed,
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

    base_payload = {
        "client_id": client_id,
        "secret": secret,
        "client_name": "GibsonFamily Financial Hub",
        "user": {"client_user_id": f"gibson-partner-{partner_id}"},
        "products": ["transactions"],
        "country_codes": ["US"],
        "language": "en",
    }

    configured_uri = (current_app.config.get("PLAID_REDIRECT_URI") or "https://gibsonfamily.onrender.com").strip()
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
    access_token: str, institution_name: str, partner_id: int | None, item_id: str | None = None
):
    base_url, client_id, secret = _plaid_headers_and_auth()
    db = get_db()

    acc_resp = requests.post(
        f"{base_url}/accounts/get",
        json={"client_id": client_id, "secret": secret, "access_token": access_token},
        timeout=15,
    )
    acc_data = acc_resp.json()
    if not item_id and "item" in acc_data and "item_id" in acc_data["item"]:
        item_id = acc_data["item"]["item_id"]

    imported_accounts = 0
    account_id_map = {}

    for acc in acc_data.get("accounts", []):
        plaid_acc_id = acc.get("account_id")
        balances = acc.get("balances") or {}
        current_bal = float(balances.get("current") or 0.0)
        avail_bal = float(balances.get("available") if balances.get("available") is not None else current_bal)
        db.execute(
            """
            INSERT INTO accounts (plaid_account_id, item_id, name, official_name, type, subtype, mask, balance_current, balance_available, owner_scope, institution_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'shared', ?)
            ON CONFLICT(plaid_account_id) DO UPDATE SET
                item_id = COALESCE(excluded.item_id, accounts.item_id),
                balance_current = excluded.balance_current,
                balance_available = excluded.balance_available
            """,
            (
                plaid_acc_id,
                item_id,
                acc.get("name", "Plaid Account"),
                acc.get("official_name") or acc.get("name"),
                acc.get("type", "depository"),
                acc.get("subtype", "checking"),
                acc.get("mask") or "0000",
                current_bal,
                avail_bal,
                institution_name,
            ),
        )
        row = db.execute("SELECT id FROM accounts WHERE plaid_account_id = ?", (plaid_acc_id,)).fetchone()
        if row:
            account_id_map[plaid_acc_id] = row["id"]
        imported_accounts += 1

    tx_resp = requests.post(
        f"{base_url}/transactions/sync",
        json={"client_id": client_id, "secret": secret, "access_token": access_token},
        timeout=15,
    )
    tx_data = tx_resp.json()
    imported_txs = 0
    for tx in tx_data.get("added", [])[:100]:
        amount = float(tx.get("amount") or 0.0)
        pfc = (tx.get("personal_finance_category") or {}).get("primary", "")
        local_acc_id = account_id_map.get(tx.get("account_id"))
        tx_date = tx.get("date") or date.today().isoformat()
        tx_budget_month = tx_date[:7]

        # In Plaid, negative amounts or INCOME primary category represent inflows/deposits
        if amount < 0 or pfc == "INCOME":
            inc_amt = round(abs(amount), 2)
            if inc_amt > 0:
                name_str = (tx.get("merchant_name") or tx.get("name") or "Plaid Deposit").strip()
                name_lower = name_str.lower()
                acc_row = db.execute("SELECT type, subtype FROM accounts WHERE id = ?", (local_acc_id,)).fetchone()
                is_credit_acc = bool(acc_row and (acc_row["type"] == "credit" or "credit" in (acc_row["subtype"] or "").lower()))

                category_map = {
                    "FOOD_AND_DRINK": "Groceries & Dining",
                    "GENERAL_MERCHANDISE": "Shopping & Tech",
                    "ENTERTAINMENT": "Entertainment & Gaming",
                    "MEDICAL": "Health & Medical",
                    "RENT_AND_UTILITIES": "Housing & Utilities",
                    "TRAVEL": "Travel & Experiences",
                }
                mapped_cat = category_map.get(pfc, "Shopping & Tech")

                # Auto-classify inflow: Credit Card Payment, Return, Account Transfer, or Payroll
                if is_credit_acc or any(w in name_lower for w in ["payment", "autopay", "thank you", "card payment", "bill pay"]):
                    auto_income_type = "cc_payment"
                    ret_cat = ""
                elif any(w in name_lower for w in ["return", "refund", "reimbursement", "credit for return"]) or pfc in ["GENERAL_MERCHANDISE", "FOOD_AND_DRINK", "ENTERTAINMENT"]:
                    auto_income_type = "return"
                    ret_cat = mapped_cat
                elif any(w in name_lower for w in ["transfer", "zelle", "venmo", "xfer", "wire", "deposit transfer", "internal transfer"]):
                    auto_income_type = "transfer"
                    ret_cat = ""
                else:
                    auto_income_type = "payroll"
                    ret_cat = ""

                db.execute(
                    """
                    INSERT OR IGNORE INTO income_entries
                    (partner_id, account_id, plaid_transaction_id, date, budget_month, source_name, amount, expected_monthly_amount, income_type, category, is_recurring, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Synced from Plaid')
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

        db.execute(
            """
            INSERT OR IGNORE INTO transactions
            (account_id, plaid_transaction_id, date, budget_month, name, merchant_name, amount, category, partner_id, is_shared, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Synced from Plaid')
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
            ),
        )
        imported_txs += 1

    db.commit()
    return imported_accounts, imported_txs


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
        db.execute(
            "INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_name, linked_by_partner_id) VALUES (?, ?, ?, ?)",
            (item_id, encrypt_plaid_token(access_token), institution_name, partner_id_int),
        )
        db.commit()

        imported_accounts, imported_txs = _sync_plaid_accounts_and_transactions(access_token, institution_name, partner_id_int, item_id)
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
        db.execute(
            "INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_name, linked_by_partner_id) VALUES (?, ?, ?, ?)",
            (item_id, encrypt_plaid_token(access_token), institution_name, partner_id_int),
        )
        db.commit()

        imported_accounts, imported_txs = _sync_plaid_accounts_and_transactions(access_token, institution_name, partner_id_int, item_id)
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
    db = get_db()
    items = db.execute("SELECT * FROM plaid_items").fetchall()
    if not items:
        return jsonify({"error": "No Plaid bank items linked yet. Connect a bank first."}), 400

    total_acc = 0
    total_tx = 0
    for item in items:
        raw_access_token = decrypt_plaid_token(item["access_token"])
        acc_cnt, tx_cnt = _sync_plaid_accounts_and_transactions(
            raw_access_token, item["institution_name"], item["linked_by_partner_id"], item["item_id"]
        )
        total_acc += acc_cnt
        total_tx += tx_cnt

    return jsonify({
        "synced": True,
        "updated_accounts": total_acc,
        "imported_transactions": total_tx,
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
    if not matched_acc_ids:
        other_items = db.execute(
            "SELECT COUNT(*) AS cnt FROM plaid_items WHERE institution_name = ? AND id != ?",
            (item["institution_name"], item["id"]),
        ).fetchone()["cnt"]
        if other_items == 0:
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
    current_ym = date.today().strftime("%Y-%m")
    selected_month = (request.args.get("month") or current_ym).strip()[:7]
    include_all = request.args.get("include_all_months") == "true"

    db = get_db()
    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts ORDER BY id").fetchall()]
    month_budgets = _ensure_monthly_budgets_for_month(db, selected_month)

    all_transactions = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*,
                   COALESCE(NULLIF(t.budget_month, ''), substr(t.date, 1, 7)) AS effective_budget_month,
                   p.name AS partner_name,
                   p.avatar_color AS partner_color,
                   a.name AS account_name
            FROM transactions t
            LEFT JOIN partners p ON t.partner_id = p.id
            LEFT JOIN accounts a ON t.account_id = a.id
            ORDER BY t.date DESC, t.id DESC
            """
        ).fetchall()
    ]

    month_set = {
        _shift_year_month(selected_month, -2),
        _shift_year_month(selected_month, -1),
        selected_month,
        _shift_year_month(selected_month, 1),
        current_ym,
    }
    tx_categories = set()
    for tx in all_transactions:
        tx["budget_month"] = tx["effective_budget_month"]
        tx["original_date_month"] = (tx["date"] or "")[:7]
        tx["previous_budget_month"] = _shift_year_month(tx["budget_month"], -1)
        tx["next_budget_month"] = _shift_year_month(tx["budget_month"], 1)
        if tx["budget_month"]:
            month_set.add(tx["budget_month"])
        if tx.get("category"):
            tx_categories.add(tx["category"])

    # Also include any months from monthly_budgets and income_entries
    for mb_row in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets WHERE is_active = 1").fetchall():
        if mb_row["budget_month"]:
            month_set.add(mb_row["budget_month"])

    all_income_entries = [
        dict(r)
        for r in db.execute(
            """
            SELECT i.*,
                   COALESCE(NULLIF(i.budget_month, ''), substr(i.date, 1, 7)) AS effective_budget_month,
                   p.name AS partner_name,
                   p.avatar_color AS partner_color,
                   a.name AS account_name
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

    total_cash = sum(a["balance_current"] for a in accounts if a["type"] == "depository")
    total_credit_used = sum(a["balance_current"] for a in accounts if a["type"] == "credit")

    spend_by_category = {}
    for tx in month_transactions:
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
        tx["is_category_tracked"] = tx.get("category") in tracked_cat_names

    total_gross_spent = round(sum(float(t["amount"]) for t in month_transactions), 2)
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
        "total_monthly_returns": total_monthly_returns,
        "total_cc_payments": total_cc_payments,
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

    months_set = {
        _shift_year_month(current_ym, -2),
        _shift_year_month(current_ym, -1),
        current_ym,
    }
    for tx in all_txs:
        if tx["effective_budget_month"]:
            months_set.add(tx["effective_budget_month"])
    for inc in all_incomes:
        if inc["effective_budget_month"]:
            months_set.add(inc["effective_budget_month"])
    for mb in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets WHERE is_active = 1").fetchall():
        if mb["budget_month"]:
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
        m_incomes = [inc for inc in all_incomes if inc["effective_budget_month"] == ym]

        spend_by_cat = {}
        for tx in m_txs:
            cat = tx["category"]
            spend_by_cat[cat] = spend_by_cat.get(cat, 0.0) + float(tx["amount"])

        cat_returns_map = {}
        for r_inc in m_incomes:
            if is_return_refund(r_inc.get("income_type")):
                rc = (r_inc.get("category") or "").strip()
                if rc:
                    cat_returns_map[rc] = cat_returns_map.get(rc, 0.0) + float(r_inc.get("amount") or 0.0)

        month_ret = returns_by_month.get(ym, 0.0)
        gross_spent = round(sum(float(tx["amount"]) for tx in m_txs), 2)
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
            "transaction_count": len(m_txs),
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

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO accounts (name, official_name, type, subtype, mask, balance_current, balance_available, owner_scope, institution_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            data.get("official_name") or name,
            data.get("type", "depository"),
            data.get("subtype", "checking"),
            data.get("mask", "0000"),
            float(data.get("balance_current", 0.0)),
            float(data.get("balance_available", data.get("balance_current", 0.0))),
            data.get("owner_scope", "shared"),
            data.get("institution_name", "Manual Entry"),
        ),
    )
    db.commit()
    acc = dict(db.execute("SELECT * FROM accounts WHERE id = ?", (cur.lastrowid,)).fetchone())
    return jsonify(acc), 201


@finance_bp.route("/accounts/<int:acc_id>", methods=["DELETE"])
def delete_account(acc_id: int):
    db = get_db()
    acc = db.execute("SELECT * FROM accounts WHERE id = ?", (acc_id,)).fetchone()
    if not acc:
        return jsonify({"error": "Account not found"}), 404

    # Delete transactions and income entries belonging to this deleted account
    deleted_tx = db.execute("DELETE FROM transactions WHERE account_id = ?", (acc_id,)).rowcount
    deleted_inc = db.execute("DELETE FROM income_entries WHERE account_id = ?", (acc_id,)).rowcount
    db.execute("DELETE FROM accounts WHERE id = ?", (acc_id,))

    # If this account was linked to a Plaid item and no other accounts remain for it, clean up plaid_items
    if acc["item_id"]:
        remaining = db.execute(
            "SELECT COUNT(*) AS cnt FROM accounts WHERE item_id = ?", (acc["item_id"],)
        ).fetchone()["cnt"]
        if remaining == 0:
            db.execute("DELETE FROM plaid_items WHERE item_id = ?", (acc["item_id"],))

    db.commit()
    return jsonify({
        "deleted": True,
        "id": acc_id,
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

    db = get_db()
    _ensure_category_in_catalog(db, category, is_preloaded=1 if category in DEFAULT_CATEGORIES else 0, unarchive=True)
    cur = db.execute(
        """
        INSERT INTO transactions (account_id, date, budget_month, name, merchant_name, amount, category, partner_id, is_shared, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(account_id) if account_id else None,
            tx_date,
            budget_month,
            name,
            data.get("merchant_name") or name,
            round(amount, 2),
            category,
            int(partner_id) if partner_id else None,
            1 if data.get("is_shared", True) else 0,
            data.get("notes", ""),
        ),
    )
    db.commit()
    tx = dict(db.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone())
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

    _ensure_category_in_catalog(db, new_category, is_preloaded=1 if new_category in DEFAULT_CATEGORIES else 0, unarchive=True)
    db.execute(
        """
        UPDATE transactions
        SET category = ?, budget_month = ?, notes = ?, name = ?
        WHERE id = ?
        """,
        (new_category, new_budget_month, new_notes, new_name, tx_id),
    )
    db.commit()

    updated = dict(db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone())
    return jsonify(updated)


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
