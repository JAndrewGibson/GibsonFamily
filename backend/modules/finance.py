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
    items = [
        dict(r)
        for r in db.execute(
            "SELECT id, item_id, institution_name, linked_by_partner_id, created_at FROM plaid_items ORDER BY id DESC"
        ).fetchall()
    ]
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


def _sync_plaid_accounts_and_transactions(access_token: str, institution_name: str, partner_id: int | None):
    base_url, client_id, secret = _plaid_headers_and_auth()
    db = get_db()

    acc_resp = requests.post(
        f"{base_url}/accounts/get",
        json={"client_id": client_id, "secret": secret, "access_token": access_token},
        timeout=15,
    )
    acc_data = acc_resp.json()
    imported_accounts = 0
    account_id_map = {}

    for acc in acc_data.get("accounts", []):
        plaid_acc_id = acc.get("account_id")
        balances = acc.get("balances") or {}
        current_bal = float(balances.get("current") or 0.0)
        avail_bal = float(balances.get("available") if balances.get("available") is not None else current_bal)
        db.execute(
            """
            INSERT INTO accounts (plaid_account_id, name, official_name, type, subtype, mask, balance_current, balance_available, owner_scope, institution_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'shared', ?)
            ON CONFLICT(plaid_account_id) DO UPDATE SET
                balance_current = excluded.balance_current,
                balance_available = excluded.balance_available
            """,
            (
                plaid_acc_id,
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
        if amount <= 0:
            continue
        pfc = (tx.get("personal_finance_category") or {}).get("primary", "")
        category_map = {
            "FOOD_AND_DRINK": "Groceries & Dining",
            "GENERAL_MERCHANDISE": "Shopping & Tech",
            "ENTERTAINMENT": "Entertainment & Gaming",
            "MEDICAL": "Health & Medical",
            "RENT_AND_UTILITIES": "Housing & Utilities",
            "TRAVEL": "Travel & Experiences",
        }
        mapped_cat = category_map.get(pfc, "Shopping & Tech")
        local_acc_id = account_id_map.get(tx.get("account_id"))
        tx_date = tx.get("date") or date.today().isoformat()
        tx_budget_month = tx_date[:7]

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

        imported_accounts, imported_txs = _sync_plaid_accounts_and_transactions(access_token, institution_name, partner_id_int)
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

        imported_accounts, imported_txs = _sync_plaid_accounts_and_transactions(access_token, institution_name, partner_id_int)
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
            raw_access_token, item["institution_name"], item["linked_by_partner_id"]
        )
        total_acc += acc_cnt
        total_tx += tx_cnt

    return jsonify({
        "synced": True,
        "updated_accounts": total_acc,
        "imported_transactions": total_tx,
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

    # Also include any months from monthly_budgets
    for mb_row in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets WHERE is_active = 1").fetchall():
        if mb_row["budget_month"]:
            month_set.add(mb_row["budget_month"])

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
    for b in month_budgets:
        spent = round(spend_by_category.get(b["category"], 0.0), 2)
        limit_val = float(b["monthly_limit"])
        total_budget_limit += limit_val
        total_budget_spent += spent
        pct = round((spent / limit_val) * 100, 1) if limit_val > 0 else 0.0
        enriched_budgets.append({
            **b,
            "spent": spent,
            "remaining": round(limit_val - spent, 2),
            "utilization_pct": pct,
        })

    # All known custom + standard categories across all months
    all_budget_cats = [
        r["category"]
        for r in db.execute(
            "SELECT DISTINCT category FROM monthly_budgets UNION SELECT DISTINCT category FROM budgets"
        ).fetchall()
    ]
    all_categories = list(
        dict.fromkeys(all_budget_cats + sorted(tx_categories) + DEFAULT_CATEGORIES)
    )

    return jsonify({
        "selected_month": selected_month,
        "current_calendar_month": current_ym,
        "previous_month": _shift_year_month(selected_month, -1),
        "next_month": _shift_year_month(selected_month, 1),
        "available_months": sorted(month_set, reverse=True),
        "all_categories": all_categories,
        "net_cash": round(total_cash, 2),
        "credit_balance": round(total_credit_used, 2),
        "net_liquid": round(total_cash - total_credit_used, 2),
        "total_monthly_budget": round(total_budget_limit, 2),
        "total_monthly_spent": round(sum(float(t["amount"]) for t in month_transactions), 2),
        "budgeted_categories_spent": round(total_budget_spent, 2),
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

    months_set = {
        _shift_year_month(current_ym, -2),
        _shift_year_month(current_ym, -1),
        current_ym,
    }
    for tx in all_txs:
        if tx["effective_budget_month"]:
            months_set.add(tx["effective_budget_month"])
    for mb in db.execute("SELECT DISTINCT budget_month FROM monthly_budgets WHERE is_active = 1").fetchall():
        if mb["budget_month"]:
            months_set.add(mb["budget_month"])

    sorted_months = sorted(months_set, reverse=True)
    history_list = []

    for ym in sorted_months:
        m_budgets = _ensure_monthly_budgets_for_month(db, ym)
        m_txs = [tx for tx in all_txs if tx["effective_budget_month"] == ym]

        spend_by_cat = {}
        for tx in m_txs:
            cat = tx["category"]
            spend_by_cat[cat] = spend_by_cat.get(cat, 0.0) + float(tx["amount"])

        total_spent = round(sum(float(tx["amount"]) for tx in m_txs), 2)
        total_limit = round(sum(float(b["monthly_limit"]) for b in m_budgets), 2)

        cat_breakdown = []
        seen_cats = set()
        for b in m_budgets:
            cat = b["category"]
            seen_cats.add(cat)
            spent = round(spend_by_cat.get(cat, 0.0), 2)
            lim = float(b["monthly_limit"])
            cat_breakdown.append({
                "category": cat,
                "spent": spent,
                "monthly_limit": lim,
                "remaining": round(lim - spent, 2),
                "utilization_pct": round((spent / lim) * 100, 1) if lim > 0 else 0.0,
                "is_budgeted": True,
                "is_active": bool(b.get("is_active", 1)),
            })

        for cat, spent_val in spend_by_cat.items():
            if cat not in seen_cats:
                cat_breakdown.append({
                    "category": cat,
                    "spent": round(spent_val, 2),
                    "monthly_limit": 0.0,
                    "remaining": -round(spent_val, 2),
                    "utilization_pct": 100.0,
                    "is_budgeted": False,
                    "is_active": False,
                })

        history_list.append({
            "month": ym,
            "budget_month": ym,
            "total_spent": total_spent,
            "total_budget": total_limit,
            "net_variance": round(total_limit - total_spent, 2),
            "utilization_pct": round((total_spent / total_limit) * 100, 1) if total_limit > 0 else 0.0,
            "transaction_count": len(m_txs),
            "categories": cat_breakdown,
        })

    return jsonify({"history": history_list})


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
    db.execute("DELETE FROM accounts WHERE id = ?", (acc_id,))
    db.commit()
    return jsonify({"deleted": True, "id": acc_id})


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
