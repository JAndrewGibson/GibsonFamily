import requests
from flask import Blueprint, current_app, g, jsonify, request
from backend.database import get_db
from backend.security import decrypt_plaid_token, encrypt_plaid_token

finance_bp = Blueprint("finance", __name__, url_prefix="/api/finance")


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
    return jsonify({
        "configured": bool(client_id and secret),
        "environment": env_name,
        "is_production": env_name == "production",
        "base_url": base_url,
        "client_id_preview": f"{client_id[:6]}...{client_id[-4:]}" if len(client_id) >= 10 else ("configured" if client_id else ""),
        "linked_items": items,
    })


@finance_bp.route("/plaid/create_link_token", methods=["POST"])
def create_link_token():
    base_url, client_id, secret = _plaid_headers_and_auth()
    if not client_id or not secret:
        return jsonify({"error": "Plaid credentials (plaid_client_id / plaid_production_secret) are missing in environment"}), 400

    data = request.get_json(silent=True) or {}
    partner_id = str(data.get("partner_id", "1"))

    payload = {
        "client_id": client_id,
        "secret": secret,
        "client_name": "GibsonFamily Financial Hub",
        "user": {"client_user_id": f"gibson-partner-{partner_id}"},
        "products": ["transactions"],
        "country_codes": ["US"],
        "language": "en",
    }

    redirect_uri = current_app.config.get("PLAID_REDIRECT_URI", "")
    if redirect_uri:
        payload["redirect_uri"] = redirect_uri

    try:
        resp = requests.post(f"{base_url}/link/token/create", json=payload, timeout=15)
        resp_data = resp.json()
        if resp.status_code != 200:
            return jsonify({"error": resp_data.get("error_message", "Plaid link token error"), "details": resp_data}), resp.status_code
        return jsonify(resp_data)
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
    for tx in tx_data.get("added", [])[:50]:
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
        db.execute(
            """
            INSERT OR IGNORE INTO transactions
            (account_id, plaid_transaction_id, date, name, merchant_name, amount, category, partner_id, is_shared, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'Synced from Plaid')
            """,
            (
                local_acc_id,
                tx.get("transaction_id"),
                tx.get("date") or "2026-11-04",
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
    partner_id = data.get("partner_id")
    partner_id_int = int(partner_id) if partner_id else None

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
    """Creates a Plaid Sandbox public_token using the configured credentials, exchanges it, and imports accounts."""
    base_url, client_id, secret = _plaid_headers_and_auth()
    if not client_id or not secret:
        return jsonify({"error": "Plaid credentials missing in .env"}), 400

    data = request.get_json(silent=True) or {}
    institution_id = data.get("institution_id", "ins_109508")
    institution_name = data.get("institution_name", "First Platypus Bank (Plaid Sandbox)")
    partner_id = data.get("partner_id")
    partner_id_int = int(partner_id) if partner_id else None

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
    db = get_db()
    accounts = [dict(r) for r in db.execute("SELECT * FROM accounts ORDER BY id").fetchall()]
    budgets = [dict(r) for r in db.execute("SELECT * FROM budgets ORDER BY id").fetchall()]
    transactions = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*, p.name AS partner_name, p.avatar_color AS partner_color, a.name AS account_name
            FROM transactions t
            LEFT JOIN partners p ON t.partner_id = p.id
            LEFT JOIN accounts a ON t.account_id = a.id
            ORDER BY t.date DESC, t.id DESC
            """
        ).fetchall()
    ]

    total_cash = sum(a["balance_current"] for a in accounts if a["type"] == "depository")
    total_credit_used = sum(a["balance_current"] for a in accounts if a["type"] == "credit")

    spend_by_category = {}
    for tx in transactions:
        cat = tx["category"]
        spend_by_category[cat] = spend_by_category.get(cat, 0.0) + float(tx["amount"])

    enriched_budgets = []
    total_budget_limit = 0.0
    total_budget_spent = 0.0
    for b in budgets:
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

    return jsonify({
        "net_cash": round(total_cash, 2),
        "credit_balance": round(total_credit_used, 2),
        "net_liquid": round(total_cash - total_credit_used, 2),
        "total_monthly_budget": round(total_budget_limit, 2),
        "total_monthly_spent": round(total_budget_spent, 2),
        "accounts": accounts,
        "budgets": enriched_budgets,
        "transactions": transactions,
    })


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
    partner_id = data.get("partner_id")

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO transactions (account_id, date, name, merchant_name, amount, category, partner_id, is_shared, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(account_id) if account_id else None,
            data.get("date", "2026-11-04"),
            name,
            data.get("merchant_name") or name,
            round(amount, 2),
            data.get("category", "Groceries & Dining"),
            int(partner_id) if partner_id else None,
            1 if data.get("is_shared", True) else 0,
            data.get("notes", ""),
        ),
    )
    db.commit()
    tx = dict(db.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone())
    return jsonify(tx), 201


@finance_bp.route("/transactions/<int:tx_id>", methods=["DELETE"])
def delete_transaction(tx_id: int):
    db = get_db()
    db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    db.commit()
    return jsonify({"deleted": True, "id": tx_id})


@finance_bp.route("/budgets", methods=["POST"])
def upsert_budget():
    data = request.get_json(silent=True) or {}
    category = (data.get("category") or "").strip()
    monthly_limit = float(data.get("monthly_limit", 0))
    if not category or monthly_limit <= 0:
        return jsonify({"error": "Category and positive monthly_limit are required"}), 400

    color = data.get("color", "#6366f1")
    db = get_db()
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
    db.commit()
    row = dict(db.execute("SELECT * FROM budgets WHERE category = ?", (category,)).fetchone())
    return jsonify(row), 201


@finance_bp.route("/budgets/<int:budget_id>", methods=["DELETE"])
def delete_budget(budget_id: int):
    db = get_db()
    db.execute("DELETE FROM budgets WHERE id = ?", (budget_id,))
    db.commit()
    return jsonify({"deleted": True, "id": budget_id})
