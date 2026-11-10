import base64
import json
import pytest
from backend.app import create_app
from backend.security import decrypt_plaid_token, encrypt_plaid_token


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


@pytest.fixture()
def app_instance(tmp_path):
    db_file = tmp_path / "test_gibson.db"
    return create_app({"TESTING": True, "DATABASE_PATH": str(db_file)})


@pytest.fixture()
def client(app_instance):
    with app_instance.test_client() as c:
        yield c


def test_unauthenticated_endpoints_blocked_and_security_headers(client):
    # Public health & setup status work
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.headers["X-Content-Type-Options"] == "nosniff"
    assert health.headers["X-Frame-Options"] == "DENY"
    assert "no-store" in health.headers["Cache-Control"]

    # Protected financial & request endpoints must return 401 when not logged in
    assert client.get("/api/finance/summary").status_code == 401
    assert client.get("/api/requests").status_code == 401
    assert client.get("/api/notifications").status_code == 401
    assert client.post("/api/auth/reset-all").status_code == 401


def test_plaid_access_token_encryption_at_rest(app_instance):
    with app_instance.app_context():
        raw_token = "access-production-secret-plaid-token-998877"
        encrypted = encrypt_plaid_token(raw_token)
        assert encrypted.startswith("enc:v1:")
        assert raw_token not in encrypted
        decrypted = decrypt_plaid_token(encrypted)
        assert decrypted == raw_token

        # Tampering with the ciphertext must fail integrity verification
        tampered = encrypted[:-4] + "AAAA"
        with pytest.raises(Exception):
            decrypt_plaid_token(tampered)


def test_full_auth_login_lock_notifications_and_request_deletion(client):
    # 1. Step 1 Onboarding: Create both partner accounts with passwords
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Family",
            "partners": [
                {
                    "name": "Alex Gibson",
                    "email": "alex@gibson.local",
                    "password": "AlexStrongPassword123!",
                    "avatar_color": "#6366f1",
                    "monthly_fun_allowance": 250,
                },
                {
                    "name": "Jordan Gibson",
                    "email": "jordan@gibson.local",
                    "password": "JordanStrongPassword123!",
                    "avatar_color": "#ec4899",
                    "monthly_fun_allowance": 250,
                },
            ],
        },
    )
    assert p_res.status_code == 201
    p_data = p_res.get_json()
    p1_token = p_data["token"]
    partners = p_data["partners"]
    assert "password_hash" not in partners[0]
    p1_id = partners[0]["id"]
    p2_id = partners[1]["id"]

    auth_p1 = {"Authorization": f"Bearer {p1_token}"}

    # 2. Complete onboarding
    comp_res = client.post(
        "/api/auth/onboarding/complete",
        headers=auth_p1,
        json={"household_name": "Gibson Family"},
    )
    assert comp_res.status_code == 200

    # Once onboarding is complete, unauthenticated POST /api/auth/partners is blocked (403/401)
    client.delete_cookie("gibson_session")
    unauth_create = client.post(
        "/api/auth/partners",
        json={"partners": [{"name": "Hacker", "email": "h@x.com", "password": "password123"}]},
    )
    assert unauth_create.status_code in (401, 403)

    # 3. Register WebAuthn Passkey for Partner 1
    opt_res = client.post("/api/auth/webauthn/register/options", headers=auth_p1, json={"partner_id": p1_id})
    assert opt_res.status_code == 200
    challenge = opt_res.get_json()["challenge"]

    client_data_json = _b64url(
        json.dumps({
            "type": "webauthn.create",
            "challenge": challenge,
            "origin": "http://localhost:5173",
        }).encode("utf-8")
    )
    cred_id = _b64url(b"gibson-passkey-cred-001")
    ver_res = client.post(
        "/api/auth/webauthn/register/verify",
        headers=auth_p1,
        json={
            "partner_id": p1_id,
            "device_name": "Alex Passkey",
            "credential": {
                "id": cred_id,
                "rawId": cred_id,
                "response": {
                    "clientDataJSON": client_data_json,
                    "attestationObject": _b64url(b"attestation-bytes"),
                },
                "transports": ["internal"],
            },
        },
    )
    assert ver_res.status_code == 201

    # 4. Test Screen Lock & Unlock (423 Locked when screen is locked)
    lock_res = client.post("/api/auth/lock", headers=auth_p1)
    assert lock_res.status_code == 200
    assert client.get("/api/finance/summary", headers=auth_p1).status_code == 423

    # Unlock with WebAuthn Passkey
    auth_opt_res = client.post("/api/auth/webauthn/authenticate/options", json={"partner_id": p1_id})
    auth_challenge = auth_opt_res.get_json()["challenge"]
    auth_client_data = _b64url(
        json.dumps({
            "type": "webauthn.get",
            "challenge": auth_challenge,
            "origin": "http://localhost:5173",
        }).encode("utf-8")
    )
    authenticator_data = _b64url((b"\x00" * 32) + b"\x05" + b"\x00\x00\x00\x02")
    unlock_res = client.post(
        "/api/auth/webauthn/authenticate/verify",
        headers=auth_p1,
        json={
            "credential": {
                "id": cred_id,
                "rawId": cred_id,
                "response": {
                    "clientDataJSON": auth_client_data,
                    "authenticatorData": authenticator_data,
                    "signature": _b64url(b"sig"),
                },
            }
        },
    )
    assert unlock_res.status_code == 200
    assert client.get("/api/finance/summary", headers=auth_p1).status_code == 200

    # 5. Partner 2 logs in with email & password
    p2_login = client.post(
        "/api/auth/login",
        json={"email": "jordan@gibson.local", "password": "JordanStrongPassword123!"},
    )
    assert p2_login.status_code == 200
    p2_token = p2_login.get_json()["token"]
    auth_p2 = {"Authorization": f"Bearer {p2_token}"}

    # 6. Partner 2 submits a purchase request -> Partner 1 gets a notification!
    req_res = client.post(
        "/api/requests",
        headers=auth_p2,
        json={
            "title": "PlayStation 5 Pro",
            "amount": 699.99,
            "category": "Entertainment & Gaming",
        },
    )
    assert req_res.status_code == 201
    req_id = req_res.get_json()["id"]

    # Check Partner 1's notifications
    p1_notifs = client.get("/api/notifications", headers=auth_p1).get_json()
    assert p1_notifs["unread_count"] == 1
    assert "PlayStation 5 Pro" in p1_notifs["notifications"][0]["title"]

    # 7. Partner 1 approves/plans the request -> Partner 2 gets a notification!
    decide_res = client.post(
        f"/api/requests/{req_id}/decision",
        headers=auth_p1,
        json={
            "status": "budget_planned",
            "proposed_monthly_contribution": 250.0,
            "proposed_target_date": "2027-02-01",
            "saved_amount": 200.0,
            "decision_notes": "Let's save $250/mo!",
        },
    )
    assert decide_res.status_code == 200

    p2_notifs = client.get("/api/notifications", headers=auth_p2).get_json()
    assert p2_notifs["unread_count"] == 1
    assert "Budget & Timeline Proposed" in p2_notifs["notifications"][0]["title"]

    # 8. Delete the purchase request -> verify it is removed
    del_res = client.delete(f"/api/requests/{req_id}?delete_linked_plan=true", headers=auth_p2)
    assert del_res.status_code == 200
    remaining_reqs = client.get("/api/requests", headers=auth_p1).get_json()["requests"]
    assert len(remaining_reqs) == 0


def test_login_rate_limiting(client):
    # Create partner
    client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    for _ in range(5):
        res = client.post("/api/auth/login", json={"email": "alex@gibson.local", "password": "WrongPassword"})
        assert res.status_code == 401

    # 6th attempt within 15 minutes must be blocked with 429 Too Many Requests
    blocked = client.post("/api/auth/login", json={"email": "alex@gibson.local", "password": "ValidPassword123!"})
    assert blocked.status_code == 429


def test_monthly_budget_separation_category_reassignment_and_month_allocation(client):
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    token = p_res.get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Create a custom budget category "Pet Care" ($200/mo) and "Groceries & Dining" ($800/mo)
    client.post("/api/finance/budgets", headers=headers, json={"category": "Pet Care", "monthly_limit": 200})
    client.post("/api/finance/budgets", headers=headers, json={"category": "Groceries & Dining", "monthly_limit": 800})

    # Add an October transaction (2026-10-28) and a November 1st transaction (2026-11-01)
    tx_oct = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={"name": "October Grocery Run", "amount": 120.0, "category": "Groceries & Dining", "date": "2026-10-28"},
    ).get_json()
    tx_nov = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={"name": "Vet Checkup", "amount": 85.0, "category": "Shopping & Tech", "date": "2026-11-01"},
    ).get_json()

    # Check November 2026 summary: October's $120 transaction must NOT be in November's budget!
    nov_sum = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    assert nov_sum["total_monthly_spent"] == 85.0
    groc_budget_nov = next(b for b in nov_sum["budgets"] if b["category"] == "Groceries & Dining")
    assert groc_budget_nov["spent"] == 0.0

    # Reassign the November transaction from "Shopping & Tech" to custom category "Pet Care"
    re_res = client.put(
        f"/api/finance/transactions/{tx_nov['id']}",
        headers=headers,
        json={"category": "Pet Care"},
    )
    assert re_res.status_code == 200
    assert re_res.get_json()["category"] == "Pet Care"

    nov_sum_2 = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    pet_budget_nov = next(b for b in nov_sum_2["budgets"] if b["category"] == "Pet Care")
    assert pet_budget_nov["spent"] == 85.0

    # Allocate the November transaction to Next Month (2026-12)
    shift_next = client.put(
        f"/api/finance/transactions/{tx_nov['id']}",
        headers=headers,
        json={"allocate_direction": "next"},
    ).get_json()
    assert shift_next["budget_month"] == "2026-12"

    # Now November 2026 spent is $0, and December 2026 spent is $85!
    assert client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()["total_monthly_spent"] == 0.0
    assert client.get("/api/finance/summary?month=2026-12", headers=headers).get_json()["total_monthly_spent"] == 85.0

    # Allocate the October transaction to Next Month (so 2026-10 -> 2026-11)
    shift_oct_to_nov = client.put(
        f"/api/finance/transactions/{tx_oct['id']}",
        headers=headers,
        json={"allocate_direction": "next"},
    ).get_json()
    assert shift_oct_to_nov["budget_month"] == "2026-11"
    assert client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()["total_monthly_spent"] == 120.0


def test_per_month_budget_cancellation_history_sync_pulse_and_plaid_dismiss(client):
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    token = p_res.get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Check initial sync-pulse state_version
    pulse_1 = client.get("/api/sync-pulse", headers=headers).get_json()
    v1 = pulse_1["state_version"]

    # 2. Add a "Netflix" budget starting in 2026-11 ($22.99/mo) for 2026-11 & future months
    client.post(
        "/api/finance/budgets",
        headers=headers,
        json={
            "category": "Netflix",
            "monthly_limit": 22.99,
            "budget_month": "2026-11",
            "apply_scope": "this_and_future",
        },
    )

    # Verify state_version incremented for real-time partner reactivity
    pulse_2 = client.get("/api/sync-pulse", headers=headers).get_json()
    assert pulse_2["state_version"] > v1

    # Materialize 2026-11, 2026-12, and 2027-01
    nov_sum = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    dec_sum = client.get("/api/finance/summary?month=2026-12", headers=headers).get_json()
    jan_sum = client.get("/api/finance/summary?month=2027-01", headers=headers).get_json()
    assert any(b["category"] == "Netflix" for b in nov_sum["budgets"])
    assert any(b["category"] == "Netflix" for b in dec_sum["budgets"])
    jan_netflix = next(b for b in jan_sum["budgets"] if b["category"] == "Netflix")

    # 3. Cancel "Netflix" starting in 2027-01 (this_and_future) -> must disappear in 2027-01 & 2027-02,
    #    but remain preserved in historical months 2026-11 and 2026-12!
    del_res = client.delete(
        f"/api/finance/budgets/{jan_netflix['id']}?month=2027-01&category=Netflix&apply_scope=this_and_future",
        headers=headers,
    )
    assert del_res.status_code == 200

    nov_after = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    dec_after = client.get("/api/finance/summary?month=2026-12", headers=headers).get_json()
    jan_after = client.get("/api/finance/summary?month=2027-01", headers=headers).get_json()
    feb_after = client.get("/api/finance/summary?month=2027-02", headers=headers).get_json()

    assert any(b["category"] == "Netflix" for b in nov_after["budgets"])
    assert any(b["category"] == "Netflix" for b in dec_after["budgets"])
    assert not any(b["category"] == "Netflix" for b in jan_after["budgets"])
    assert not any(b["category"] == "Netflix" for b in feb_after["budgets"])

    # 4. Check Historical Months endpoint (/api/finance/history)
    hist_res = client.get("/api/finance/history", headers=headers)
    assert hist_res.status_code == 200
    hist_data = hist_res.get_json()
    months_map = {m["budget_month"]: m for m in hist_data["history"]}
    assert "2026-11" in months_map
    assert "2026-12" in months_map
    assert "2027-01" in months_map
    assert any(c["category"] == "Netflix" for c in months_map["2026-11"]["categories"])
    assert any(c["category"] == "Netflix" for c in months_map["2026-12"]["categories"])
    assert not any(c["category"] == "Netflix" for c in months_map["2027-01"]["categories"])

    # 5. Test persistent Plaid banner dismissal
    p_status_before = client.get("/api/finance/plaid/status", headers=headers).get_json()
    assert p_status_before["banner_dismissed"] is False

    dismiss_res = client.post(
        "/api/finance/plaid/dismiss-banner",
        headers=headers,
        json={"dismissed": True},
    )
    assert dismiss_res.status_code == 200
    assert dismiss_res.get_json()["banner_dismissed"] is True

    p_status_after = client.get("/api/finance/plaid/status", headers=headers).get_json()
    assert p_status_after["banner_dismissed"] is True


def test_income_fluctuations_under_review_requests_and_mobile_push(client):
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    p_data = p_res.get_json()
    alex_id = p_data["partners"][0]["id"]
    jordan_id = p_data["partners"][1]["id"]
    alex_headers = {"Authorization": f"Bearer {p_data['token']}"}

    jordan_login = client.post(
        "/api/auth/login",
        json={"email": "jordan@gibson.local", "partner_id": jordan_id, "password": "ValidPassword123!"},
    ).get_json()
    jordan_headers = {"Authorization": f"Bearer {jordan_login['token']}"}

    # 1. Log October income ($5,000 actual, $5,000 expected) and November income ($5,750 actual, $5,200 expected)
    inc_oct = client.post(
        "/api/finance/income",
        headers=alex_headers,
        json={
            "partner_id": alex_id,
            "source_name": "Alex Salary",
            "amount": 5000.0,
            "expected_monthly_amount": 5000.0,
            "income_type": "paycheck",
            "date": "2026-10-15",
            "budget_month": "2026-10",
        },
    )
    assert inc_oct.status_code == 201

    inc_nov_1 = client.post(
        "/api/finance/income",
        headers=alex_headers,
        json={
            "partner_id": alex_id,
            "source_name": "Alex Salary",
            "amount": 5000.0,
            "expected_monthly_amount": 5000.0,
            "income_type": "paycheck",
            "date": "2026-11-15",
            "budget_month": "2026-11",
        },
    )
    assert inc_nov_1.status_code == 201

    inc_nov_2 = client.post(
        "/api/finance/income",
        headers=jordan_headers,
        json={
            "partner_id": jordan_id,
            "source_name": "Jordan Q4 Commission",
            "amount": 750.0,
            "expected_monthly_amount": 200.0,
            "income_type": "variable",
            "date": "2026-11-20",
            "budget_month": "2026-11",
        },
    )
    assert inc_nov_2.status_code == 201

    # Verify November income, projected income (from Oct $5,000), & fluctuation metrics in /api/finance/summary?month=2026-11
    nov_summary = client.get("/api/finance/summary?month=2026-11", headers=alex_headers).get_json()
    assert nov_summary["total_monthly_income"] == 5750.0
    assert nov_summary["expected_monthly_income"] == 5200.0
    assert nov_summary["previous_month_income"] == 5000.0
    assert nov_summary["projected_monthly_income"] == 5000.0
    assert nov_summary["projected_income_months_count"] == 1
    assert nov_summary["income_vs_projected"] == 750.0
    assert nov_summary["income_fluctuation_vs_prev"] == 750.0
    assert nov_summary["income_fluctuation_vs_prev_pct"] == 15.0
    assert nov_summary["income_fluctuation_vs_expected"] == 550.0
    assert len(nov_summary["income_entries"]) == 2

    # Check December 2026 projected income based on Oct ($5,000) and Nov ($5,750) -> $5,375.00
    dec_summary = client.get("/api/finance/summary?month=2026-12", headers=alex_headers).get_json()
    assert dec_summary["projected_monthly_income"] == 5375.0
    assert dec_summary["projected_income_months_count"] == 2
    assert dec_summary["projected_recurring_income"] == 5000.0
    assert dec_summary["projected_variable_income"] == 375.0

    # Verify /api/finance/history includes monthly income & fluctuation fields
    hist = client.get("/api/finance/history", headers=alex_headers).get_json()
    nov_hist = next(m for m in hist["history"] if m["budget_month"] == "2026-11")
    assert nov_hist["total_income"] == 5750.0
    assert nov_hist["income_fluctuation_delta"] == 750.0
    assert nov_hist["income_fluctuation_pct"] == 15.0

    # 2. Purchase Request with "Under Review" (under_review) status
    req_res = client.post(
        "/api/requests",
        headers=alex_headers,
        json={
            "requester_id": alex_id,
            "reviewer_id": jordan_id,
            "title": "Espresso Machine",
            "amount": 599.0,
            "category": "Home & Lifestyle",
        },
    )
    assert req_res.status_code == 201
    req_id = req_res.get_json()["id"]

    # Jordan marks the request as "under_review"
    ur_res = client.post(
        f"/api/requests/{req_id}/decision",
        headers=jordan_headers,
        json={
            "partner_id": jordan_id,
            "status": "under_review",
            "decision_notes": "Checking how our November commission looks first!",
        },
    )
    assert ur_res.status_code == 200
    ur_data = ur_res.get_json()
    assert ur_data["status"] == "under_review"
    assert any(c["action_type"] == "under_review" for c in ur_data["comments"])

    # Overview counts under_review_requests
    ov = client.get("/api/overview", headers=alex_headers).get_json()
    assert ov["under_review_requests"] == 1
    assert ov["pending_requests"] == 1  # active pending + under_review

    # Alex received a notification about "Under Review"
    alex_notifs = client.get("/api/notifications", headers=alex_headers).get_json()["notifications"]
    assert any("Under Review: Espresso Machine" in n["title"] for n in alex_notifs)

    # 3. Mobile Push Notification Registration & Test Alert Endpoints
    push_init = client.get("/api/notifications/push-status", headers=alex_headers).get_json()
    assert push_init["subscribed"] is False

    sub_res = client.post(
        "/api/notifications/push-subscribe",
        headers=alex_headers,
        json={
            "device_label": "iPhone / iOS Device",
            "subscription": {
                "endpoint": "https://push.example.com/sub/alex-iphone",
                "keys": {"p256dh": "test-p256dh-key", "auth": "test-auth-key"},
            },
        },
    )
    assert sub_res.status_code == 201
    assert sub_res.get_json()["subscribed"] is True

    test_push = client.post("/api/notifications/push-test", headers=alex_headers)
    assert test_push.status_code == 201
    assert test_push.get_json()["sent"] is True
    assert test_push.get_json()["notification"]["notif_type"] == "push_test"

    # 4. Category Management Panel (Pre-Loaded & Custom Categories) + Untracked Category Flagging
    # Log a transaction in November with an untracked custom category "Coffee Shops"
    tx_coffee = client.post(
        "/api/finance/transactions",
        headers=alex_headers,
        json={
            "name": "Blue Bottle Coffee",
            "amount": 18.50,
            "category": "Coffee Shops",
            "date": "2026-11-04",
        },
    ).get_json()
    assert tx_coffee["category"] == "Coffee Shops"

    # Check November summary: "Coffee Shops" must be flagged in untracked_categories with $18.50 spend!
    nov_cat_check = client.get("/api/finance/summary?month=2026-11", headers=alex_headers).get_json()
    untracked_names = [u["name"] for u in nov_cat_check["untracked_categories"]]
    assert "Coffee Shops" in untracked_names
    coffee_untracked = next(u for u in nov_cat_check["untracked_categories"] if u["name"] == "Coffee Shops")
    assert coffee_untracked["month_spent"] == 18.50
    assert coffee_untracked["is_tracked"] is False
    assert nov_cat_check["untracked_monthly_spent"] >= 18.50
    assert nov_cat_check["transactions"][0]["is_category_tracked"] is False

    # Rename / merge "Coffee Shops" into "Groceries & Dining" via PUT /api/finance/categories
    merge_res = client.put(
        "/api/finance/categories",
        headers=alex_headers,
        json={"old_name": "Coffee Shops", "new_name": "Groceries & Dining"},
    )
    assert merge_res.status_code == 200

    # Set a budget for "Groceries & Dining" in 2026-11 so it is tracked
    client.post(
        "/api/finance/budgets",
        headers=alex_headers,
        json={"category": "Groceries & Dining", "monthly_limit": 600.0, "budget_month": "2026-11"},
    )
    nov_after_merge = client.get("/api/finance/summary?month=2026-11", headers=alex_headers).get_json()
    assert not any(u["name"] == "Coffee Shops" for u in nov_after_merge["untracked_categories"])
    assert nov_after_merge["transactions"][0]["category"] == "Groceries & Dining"
    assert nov_after_merge["transactions"][0]["is_category_tracked"] is True

    # Remove/hide a pre-loaded category ("Future Purchase Savings") via DELETE /api/finance/categories
    del_preloaded = client.delete(
        "/api/finance/categories",
        headers=alex_headers,
        json={"name": "Future Purchase Savings", "month": "2026-11"},
    )
    assert del_preloaded.status_code == 200
    nov_after_hide = client.get("/api/finance/summary?month=2026-11", headers=alex_headers).get_json()
    assert "Future Purchase Savings" not in nov_after_hide["all_categories"]
    fps_entry = next(
        c for c in nov_after_hide["categories_catalog"] if c["name"] == "Future Purchase Savings"
    )
    assert fps_entry["is_archived"] is True


def test_custom_projected_income_and_inflow_reclassification_equilibrium(client):
    """
    Test suite for:
    1. Custom Projected Income override (POST /api/finance/projected-income and DELETE /api/finance/projected-income).
    2. Inflow reclassification & financial equilibrium:
       - 'cc_payment' (Credit Card Payment) and 'transfer' (Account Transfer) excluded from income.
       - 'return' (Return / Refund) excluded from income and credited to category budget (net spend offset).
       - Only 'payroll' / earned income counted in total_monthly_income.
    """
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Family",
            "partners": [
                {"name": "Alex", "email": "alex@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    p_data = p_res.get_json()
    alex_headers = {"Authorization": f"Bearer {p_data['token']}"}

    month = "2026-12"

    # Set up a category budget: "Shopping" $300 limit in 2026-12
    cat_res = client.post(
        "/api/finance/budgets",
        headers=alex_headers,
        json={"category": "Shopping", "monthly_limit": 300.0, "budget_month": month},
    )
    assert cat_res.status_code == 201

    # Log an expense in Shopping for $120.00
    tx_res = client.post(
        "/api/finance/transactions",
        headers=alex_headers,
        json={
            "name": "Target Store",
            "amount": 120.0,
            "category": "Shopping",
            "date": "2026-12-05",
        },
    )
    assert tx_res.status_code == 201

    # Log true Payroll income: $4,000.00
    client.post(
        "/api/finance/income",
        headers=alex_headers,
        json={
            "source_name": "Alex Tech Salary",
            "amount": 4000.0,
            "income_type": "payroll",
            "date": "2026-12-01",
            "budget_month": month,
        },
    )

    # Log Credit Card Payment inflow: $650.00
    client.post(
        "/api/finance/income",
        headers=alex_headers,
        json={
            "source_name": "Chase Autopay Payment",
            "amount": 650.0,
            "income_type": "cc_payment",
            "date": "2026-12-08",
            "budget_month": month,
        },
    )

    # Log Account Transfer inflow: $200.00
    client.post(
        "/api/finance/income",
        headers=alex_headers,
        json={
            "source_name": "Transfer from Savings",
            "amount": 200.0,
            "income_type": "transfer",
            "date": "2026-12-10",
            "budget_month": month,
        },
    )

    # Log Return inflow: $45.00 for returned item to Shopping
    ret_res = client.post(
        "/api/finance/income",
        headers=alex_headers,
        json={
            "source_name": "Target Return / Refund",
            "amount": 45.0,
            "income_type": "return",
            "category": "Shopping",
            "date": "2026-12-12",
            "budget_month": month,
        },
    )
    assert ret_res.status_code == 201
    return_entry = ret_res.get_json()
    assert return_entry["income_type"] == "return"
    assert return_entry["category"] == "Shopping"

    # Query summary for 2026-12
    sum_res = client.get(f"/api/finance/summary?month={month}", headers=alex_headers)
    assert sum_res.status_code == 200
    summary = sum_res.get_json()

    # CRITICAL: Total monthly income must ONLY be the $4,000 payroll income!
    # CC payment ($650), Transfer ($200), and Return ($45) MUST NOT be in total_monthly_income!
    assert summary["total_monthly_income"] == 4000.0
    assert summary["total_monthly_returns"] == 45.0
    assert summary["total_cc_payments"] == 650.0
    assert summary["total_transfers"] == 200.0

    # Equilibrium check on Shopping category budget:
    # Gross spent = $120.00
    # Returns credited = $45.00
    # Net spent = $75.00
    # Remaining = $300 - $75 = $225.00
    shopping_budget = next(b for b in summary["budgets"] if b["category"] == "Shopping")
    assert shopping_budget["gross_spent"] == 120.0
    assert shopping_budget["returns_credited"] == 45.0
    assert shopping_budget["spent"] == 75.0
    assert shopping_budget["remaining"] == 225.0

    # Net total spent in month should be $75.00 (gross $120 - returns $45)
    assert summary["total_gross_spent"] == 120.0
    assert summary["total_monthly_spent"] == 75.0
    assert summary["net_monthly_cashflow"] == 3925.0  # 4000 - 75

    # Test Custom Projected Income:
    # Initially, is_custom_projection is False
    assert summary["is_custom_projection"] is False

    # Set custom projected income with cents: $5,500.75
    proj_post = client.post(
        "/api/finance/projected-income",
        headers=alex_headers,
        json={"budget_month": month, "custom_projected_income": 5500.75},
    )
    assert proj_post.status_code == 200
    proj_data = proj_post.get_json()
    assert proj_data["is_custom_projection"] is True
    assert proj_data["custom_projected_income"] == 5500.75

    # Verify summary reflects custom projection with cents
    sum_custom = client.get(f"/api/finance/summary?month={month}", headers=alex_headers).get_json()
    assert sum_custom["is_custom_projection"] is True
    assert sum_custom["projected_monthly_income"] == 5500.75
    assert sum_custom["custom_projected_income"] == 5500.75

    # Clear custom projected income
    proj_del = client.delete(
        f"/api/finance/projected-income?month={month}",
        headers=alex_headers,
    )
    assert proj_del.status_code == 200
    sum_revert = client.get(f"/api/finance/summary?month={month}", headers=alex_headers).get_json()
    assert sum_revert["is_custom_projection"] is False
    assert sum_revert["custom_projected_income"] is None


def test_unlink_plaid_bank_item_and_account_deletion_cleans_duplicate_transactions(app_instance, client):
    """
    Test suite for unlinking Plaid bank accounts:
    - User accidentally links the same bank twice, causing duplicate accounts, transactions & income.
    - DELETE /api/finance/plaid/items/<item_id> unlinks the bank and purges duplicate accounts,
      transactions, and income entries, perfectly restoring accurate balances and totals.
    - DELETE /api/finance/accounts/<acc_id> deletes the account and its associated transactions.
    """
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Household",
            "partners": [
                {"name": "Alex", "email": "alex@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    p_data = p_res.get_json()
    alex_headers = {"Authorization": f"Bearer {p_data['token']}"}
    month = "2026-11"

    # Set up category budget
    client.post(
        "/api/finance/budgets",
        headers=alex_headers,
        json={"category": "Groceries & Dining", "monthly_limit": 800.0, "budget_month": month},
    )

    with app_instance.app_context():
        from backend.database import get_db
        from backend.security import encrypt_plaid_token

        db = get_db()

        # Simulate Bank linked twice: Item 1 and Item 2 (duplicate connection to Chase Bank)
        db.execute(
            "INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, ?, ?)",
            ("item_chase_111", encrypt_plaid_token("access-111"), "Chase Bank"),
        )
        db.execute(
            "INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, ?, ?)",
            ("item_chase_222", encrypt_plaid_token("access-222"), "Chase Bank"),
        )

        # Account 1 from Item 1
        cur1 = db.execute(
            """
            INSERT INTO accounts (plaid_account_id, item_id, name, type, subtype, mask, balance_current, balance_available, owner_scope, institution_name)
            VALUES ('plaid_acc_1', 'item_chase_111', 'Chase Total Checking', 'depository', 'checking', '4411', 2000.0, 2000.0, 'shared', 'Chase Bank')
            """
        )
        acc1_id = cur1.lastrowid

        # Account 2 from Item 2 (DUPLICATE)
        cur2 = db.execute(
            """
            INSERT INTO accounts (plaid_account_id, item_id, name, type, subtype, mask, balance_current, balance_available, owner_scope, institution_name)
            VALUES ('plaid_acc_2', 'item_chase_222', 'Chase Total Checking', 'depository', 'checking', '4411', 2000.0, 2000.0, 'shared', 'Chase Bank')
            """
        )
        acc2_id = cur2.lastrowid

        # Transactions: 1 under Account 1, 1 under Account 2 (duplicate purchase)
        db.execute(
            """
            INSERT INTO transactions (account_id, plaid_transaction_id, date, budget_month, name, amount, category)
            VALUES (?, 'plaid_tx_1', '2026-11-04', '2026-11', 'Safeway', 65.0, 'Groceries & Dining')
            """,
            (acc1_id,),
        )
        db.execute(
            """
            INSERT INTO transactions (account_id, plaid_transaction_id, date, budget_month, name, amount, category)
            VALUES (?, 'plaid_tx_2', '2026-11-04', '2026-11', 'Safeway', 65.0, 'Groceries & Dining')
            """,
            (acc2_id,),
        )

        # Income: 1 under Account 1, 1 under Account 2 (duplicate paycheck)
        db.execute(
            """
            INSERT INTO income_entries (account_id, plaid_transaction_id, date, budget_month, source_name, amount, expected_monthly_amount, income_type)
            VALUES (?, 'plaid_inc_1', '2026-11-01', '2026-11', 'Direct Deposit', 2500.0, 2500.0, 'payroll')
            """,
            (acc1_id,),
        )
        db.execute(
            """
            INSERT INTO income_entries (account_id, plaid_transaction_id, date, budget_month, source_name, amount, expected_monthly_amount, income_type)
            VALUES (?, 'plaid_inc_2', '2026-11-01', '2026-11', 'Direct Deposit', 2500.0, 2500.0, 'payroll')
            """,
            (acc2_id,),
        )
        db.commit()

    # 1. Verify before unlink: everything is overstated by double!
    sum_before = client.get(f"/api/finance/summary?month={month}", headers=alex_headers).get_json()
    assert len(sum_before["accounts"]) == 2
    assert sum_before["net_cash"] == 4000.0  # $2000 x 2
    assert sum_before["total_monthly_income"] == 5000.0  # $2500 x 2
    assert sum_before["total_monthly_spent"] == 130.0  # $65 x 2

    # Check Plaid status endpoint: shows 2 linked items with account counts
    p_status = client.get("/api/finance/plaid/status", headers=alex_headers).get_json()
    assert len(p_status["linked_items"]) == 2
    assert all(it["account_count"] == 1 for it in p_status["linked_items"])

    # 2. Unlink the duplicate Plaid connection (item_chase_222) via DELETE /api/finance/plaid/items/<item_id>
    unlink_res = client.delete(
        "/api/finance/plaid/items/item_chase_222",
        headers=alex_headers,
    )
    assert unlink_res.status_code == 200
    unlink_data = unlink_res.get_json()
    assert unlink_data["unlinked"] is True
    assert unlink_data["item_id"] == "item_chase_222"
    assert unlink_data["deleted_accounts"] == 1
    assert unlink_data["deleted_transactions"] == 1
    assert unlink_data["deleted_income_entries"] == 1

    # 3. Verify after unlink: duplicate accounts, transactions and income are GONE!
    sum_after = client.get(f"/api/finance/summary?month={month}", headers=alex_headers).get_json()
    assert len(sum_after["accounts"]) == 1
    assert sum_after["accounts"][0]["id"] == acc1_id
    assert sum_after["net_cash"] == 2000.0  # Accurately restored to $2,000!
    assert sum_after["total_monthly_income"] == 2500.0  # Accurately restored to $2,500!
    assert sum_after["total_monthly_spent"] == 65.0  # Accurately restored to $65!

    # Plaid status shows only 1 linked connection remaining
    p_status_after = client.get("/api/finance/plaid/status", headers=alex_headers).get_json()
    assert len(p_status_after["linked_items"]) == 1
    assert p_status_after["linked_items"][0]["item_id"] == "item_chase_111"

    # 4. Verify deleting an account via DELETE /api/finance/accounts/<id> cleans up its transactions
    del_acc_res = client.delete(
        f"/api/finance/accounts/{acc1_id}",
        headers=alex_headers,
    )
    assert del_acc_res.status_code == 200
    del_data = del_acc_res.get_json()
    assert del_data["deleted"] is True
    assert del_data["deleted_transactions"] == 1
    assert del_data["deleted_income_entries"] == 1

    # Now all accounts and transactions are cleared
    sum_empty = client.get(f"/api/finance/summary?month={month}", headers=alex_headers).get_json()
    assert len(sum_empty["accounts"]) == 0
    assert sum_empty["total_monthly_spent"] == 0.0
    assert sum_empty["total_monthly_income"] == 0.0


def test_account_owner_partner_assignment_and_user_balances(client):
    # Setup partners
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Household",
            "partners": [
                {
                    "name": "Alex Gibson",
                    "email": "alex.acc@gibson.local",
                    "password": "Password123!",
                    "avatar_color": "#6366f1",
                    "monthly_fun_allowance": 250,
                },
                {
                    "name": "Jordan Gibson",
                    "email": "jordan.acc@gibson.local",
                    "password": "Password123!",
                    "avatar_color": "#ec4899",
                    "monthly_fun_allowance": 250,
                },
            ],
        },
    )
    assert p_res.status_code == 201
    auth_data = p_res.get_json()
    token = auth_data["token"]
    partners = auth_data["partners"]
    alex_id = partners[0]["id"]
    jordan_id = partners[1]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    client.post(
        "/api/auth/onboarding/complete",
        headers=headers,
        json={"household_name": "Gibson Household"},
    )

    # 1. Create Alex's checking account with owner_partner_id
    alex_acc_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={
            "name": "Alex Primary Checking",
            "type": "depository",
            "subtype": "checking",
            "mask": "1111",
            "balance_current": 4200.50,
            "balance_available": 4150.00,
            "institution_name": "Chase",
            "owner_partner_id": alex_id,
        },
    )
    assert alex_acc_res.status_code == 201
    alex_acc = alex_acc_res.get_json()
    assert alex_acc["owner_partner_id"] == alex_id
    assert alex_acc["owner_partner_name"] == "Alex Gibson"

    # 2. Create Jordan's savings account
    jordan_acc_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={
            "name": "Jordan High Yield Savings",
            "type": "depository",
            "subtype": "savings",
            "mask": "2222",
            "balance_current": 15000.00,
            "institution_name": "Ally",
            "owner_partner_id": jordan_id,
        },
    )
    assert jordan_acc_res.status_code == 201
    jordan_acc = jordan_acc_res.get_json()
    assert jordan_acc["owner_partner_id"] == jordan_id
    assert jordan_acc["owner_partner_name"] == "Jordan Gibson"

    # 3. Create a Shared Credit Card (owner_partner_id = None)
    shared_acc_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={
            "name": "Household Visa",
            "type": "credit",
            "subtype": "credit card",
            "mask": "3333",
            "balance_current": 850.00,
            "institution_name": "Costco Citi",
            "owner_partner_id": None,
        },
    )
    assert shared_acc_res.status_code == 201
    shared_acc = shared_acc_res.get_json()
    assert shared_acc["owner_partner_id"] is None

    # 4. Fetch /api/finance/summary and verify accounts and partners
    summary_res = client.get("/api/finance/summary", headers=headers)
    assert summary_res.status_code == 200
    summary = summary_res.get_json()
    assert "partners" in summary
    assert len(summary["partners"]) == 2
    assert len(summary["accounts"]) == 3

    acc_by_id = {a["id"]: a for a in summary["accounts"]}
    assert acc_by_id[alex_acc["id"]]["owner_partner_name"] == "Alex Gibson"
    assert acc_by_id[jordan_acc["id"]]["owner_partner_name"] == "Jordan Gibson"
    assert acc_by_id[shared_acc["id"]]["owner_partner_name"] is None

    # 5. Reassign the shared card to Alex via PUT /api/finance/accounts/<id>
    update_res = client.put(
        f"/api/finance/accounts/{shared_acc['id']}",
        headers=headers,
        json={"owner_partner_id": alex_id},
    )
    assert update_res.status_code == 200
    updated_acc = update_res.get_json()
    assert updated_acc["owner_partner_id"] == alex_id
    assert updated_acc["owner_partner_name"] == "Alex Gibson"

    # 6. Change it back to Shared (null)
    unassign_res = client.put(
        f"/api/finance/accounts/{shared_acc['id']}",
        headers=headers,
        json={"owner_partner_id": None},
    )
    assert unassign_res.status_code == 200
    assert unassign_res.get_json()["owner_partner_id"] is None


def test_account_color_coding_deleted_account_blocklist_and_12h_autosync(app_instance, client):
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Household",
            "partners": [
                {"name": "Alex Gibson", "email": "alex.color@gibson.local", "password": "Password123!"},
                {"name": "Jordan Gibson", "email": "jordan.color@gibson.local", "password": "Password123!"},
            ],
        },
    )
    token = p_res.get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create an account with a custom color (#ec4899)
    acc_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={
            "name": "Sapphire Reserve",
            "type": "credit",
            "subtype": "credit card",
            "mask": "8899",
            "balance_current": 450.0,
            "institution_name": "Chase",
            "color": "#ec4899",
        },
    )
    assert acc_res.status_code == 201
    acc = acc_res.get_json()
    assert acc["color"] == "#ec4899"

    # 2. Log a transaction linked to this account and verify account_color in summary
    tx_res = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "account_id": acc["id"],
            "name": "Trader Joe's",
            "amount": 92.40,
            "category": "Groceries & Dining",
            "date": "2026-11-08",
        },
    )
    assert tx_res.status_code == 201
    assert tx_res.get_json()["account_color"] == "#ec4899"

    # Update account color to #10b981 and verify transaction reflects updated color in summary
    upd_res = client.put(
        f"/api/finance/accounts/{acc['id']}",
        headers=headers,
        json={"color": "#10b981"},
    )
    assert upd_res.status_code == 200
    assert upd_res.get_json()["color"] == "#10b981"

    sum_data = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    tx_in_sum = next(t for t in sum_data["transactions"] if t["name"] == "Trader Joe's")
    assert tx_in_sum["account_color"] == "#10b981"

    # 3. Verify deleting a Plaid account adds it to deleted_accounts_blocklist and removes duplicates
    with app_instance.app_context():
        from backend.database import get_db

        db = get_db()
        db.execute(
            "INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES ('item_dup_1', 'tok1', 'Wells Fargo')"
        )
        cur_a = db.execute(
            """
            INSERT INTO accounts (plaid_account_id, item_id, name, type, subtype, mask, balance_current, institution_name)
            VALUES ('plaid_wf_1', 'item_dup_1', 'WF Active Cash', 'credit', 'credit card', '7766', 300.0, 'Wells Fargo')
            """
        )
        wf_acc1 = cur_a.lastrowid
        # Duplicate row with same signature (institution, mask, subtype, name)
        db.execute(
            """
            INSERT INTO accounts (plaid_account_id, item_id, name, type, subtype, mask, balance_current, institution_name)
            VALUES ('plaid_wf_2', 'item_dup_1', 'WF Active Cash', 'credit', 'credit card', '7766', 300.0, 'Wells Fargo')
            """
        )
        db.commit()

    del_wf = client.delete(f"/api/finance/accounts/{wf_acc1}", headers=headers)
    assert del_wf.status_code == 200
    # Both duplicate accounts should be removed and blocklisted
    assert del_wf.get_json()["deleted_accounts_count"] == 2

    with app_instance.app_context():
        from backend.database import get_db

        db = get_db()
        bl = db.execute("SELECT * FROM deleted_accounts_blocklist").fetchall()
        assert len(bl) >= 2

    # 4. Verify 12-hour auto-sync endpoint behavior
    # With no remaining Plaid items, auto-sync returns no_linked_items
    auto_res = client.post("/api/finance/plaid/auto-sync", headers=headers, json={"background": False})
    assert auto_res.status_code == 200
    assert auto_res.get_json()["reason"] == "no_linked_items"


def test_pending_transactions_inclusion_and_posting_lifecycle(app_instance, client):
    """
    Test suite for pending transactions:
    1. Pending transactions are included in ledger and summary totals immediately.
    2. Pending transactions can be categorized immediately.
    3. When transaction posts (settles) via Plaid sync (pending_transaction_id or modified),
       is_pending updates to 0 and the user's assigned category is preserved.
    """
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Jordan", "email": "jordan@gibson.local", "password": "PassJordan123!"},
                {"name": "Taylor", "email": "taylor@gibson.local", "password": "PassTaylor123!"},
            ],
        },
    )
    headers = {"Authorization": f"Bearer {p_res.get_json()['token']}"}

    # 1. Create a manual pending transaction and verify it counts in summary
    create_res = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Trader Joe's",
            "amount": 75.50,
            "category": "Groceries & Dining",
            "date": "2026-11-05",
            "is_pending": True,
        },
    )
    assert create_res.status_code == 201
    tx_data = create_res.get_json()
    assert tx_data["is_pending"] == 1

    # Verify summary includes this pending transaction in spending totals
    sum_res = client.get("/api/finance/summary?month=2026-11", headers=headers)
    assert sum_res.status_code == 200
    sum_data = sum_res.get_json()
    assert sum_data["total_gross_spent"] == 75.50
    assert sum_data["total_monthly_spent"] == 75.50

    # Categorize the pending transaction to a custom category
    cat_update = client.put(
        f"/api/finance/transactions/{tx_data['id']}",
        headers=headers,
        json={"category": "Organic Groceries"},
    )
    assert cat_update.status_code == 200
    assert cat_update.get_json()["category"] == "Organic Groceries"
    assert cat_update.get_json()["is_pending"] == 1

    # 2. Simulate Plaid sync lifecycle for pending -> settled transactions
    with app_instance.app_context():
        from backend.database import get_db
        from backend.modules.finance import _sync_plaid_accounts_and_transactions
        from unittest.mock import patch, MagicMock

        db = get_db()
        cur_acc = db.execute(
            """
            INSERT INTO accounts (plaid_account_id, name, type, subtype, mask, balance_current, institution_name)
            VALUES ('plaid_acc_chase_pending', 'Chase Sapphire', 'credit', 'credit card', '4321', 500.0, 'Chase')
            """
        )
        chase_acc_id = cur_acc.lastrowid
        db.commit()

        # Step A: Plaid delivers a pending transaction
        mock_added_pending = {
            "accounts": [{"account_id": "plaid_acc_chase_pending", "name": "Chase Sapphire", "type": "credit", "subtype": "credit card", "mask": "4321", "balances": {"current": 500.0}}],
            "added": [{
                "account_id": "plaid_acc_chase_pending",
                "transaction_id": "plaid_tx_pending_999",
                "date": "2026-11-06",
                "name": "Target Store #1020",
                "amount": 120.00,
                "pending": True,
                "personal_finance_category": {"primary": "GENERAL_MERCHANDISE"},
            }],
            "modified": [],
            "removed": [],
        }

        with patch("requests.post") as mock_post:
            def side_effect(url, **kwargs):
                resp = MagicMock()
                resp.status_code = 200
                if "accounts/get" in url:
                    resp.json.return_value = {"accounts": mock_added_pending["accounts"]}
                else:
                    resp.json.return_value = mock_added_pending
                return resp
            mock_post.side_effect = side_effect
            _sync_plaid_accounts_and_transactions("access_tok_test", "Chase", 1, "item_chase")

        # Verify transaction was inserted as pending
        row_pending = db.execute("SELECT * FROM transactions WHERE plaid_transaction_id = 'plaid_tx_pending_999'").fetchone()
        assert row_pending is not None
        assert row_pending["is_pending"] == 1
        assert row_pending["amount"] == 120.00

        # User categorizes the pending transaction
        db.execute("UPDATE transactions SET category = 'Target Household Items' WHERE id = ?", (row_pending["id"],))
        db.commit()

        # Step B: A few days later, Plaid delivers the posted transaction referencing pending_transaction_id
        mock_settled = {
            "accounts": mock_added_pending["accounts"],
            "added": [{
                "account_id": "plaid_acc_chase_pending",
                "transaction_id": "plaid_tx_posted_1000",
                "pending_transaction_id": "plaid_tx_pending_999",
                "date": "2026-11-08",
                "name": "Target Store #1020",
                "amount": 120.00,
                "pending": False,
                "personal_finance_category": {"primary": "GENERAL_MERCHANDISE"},
            }],
            "modified": [],
            "removed": [{"transaction_id": "plaid_tx_pending_999"}],
        }

        with patch("requests.post") as mock_post:
            def side_effect_settled(url, **kwargs):
                resp = MagicMock()
                resp.status_code = 200
                if "accounts/get" in url:
                    resp.json.return_value = {"accounts": mock_settled["accounts"]}
                else:
                    resp.json.return_value = mock_settled
                return resp
            mock_post.side_effect = side_effect_settled
            _sync_plaid_accounts_and_transactions("access_tok_test", "Chase", 1, "item_chase")

        # Verify: The existing row was updated to posted (is_pending = 0), and preserved the user's category!
        row_settled = db.execute("SELECT * FROM transactions WHERE plaid_transaction_id = 'plaid_tx_posted_1000'").fetchone()
        assert row_settled is not None
        assert row_settled["is_pending"] == 0
        assert row_settled["category"] == "Target Household Items"
        # Old pending transaction ID was upgraded, not lingering as duplicate
        assert db.execute("SELECT COUNT(*) AS cnt FROM transactions WHERE plaid_transaction_id = 'plaid_tx_pending_999'").fetchone()["cnt"] == 0


def test_plaid_resync_cursor_reset_update_mode_and_error_handling(client, app_instance):
    """
    Tests:
    1. Error tracking and reauth status: ITEM_LOGIN_REQUIRED marks item as needing re-authentication.
    2. Plaid Link update mode: create_link_token with item_id includes access_token and excludes products.
    3. Forced cursor reset in Plaid sync (sync with reset_cursor=True).
    4. Plaid public webhook endpoint receiving ITEM errors.
    """
    from backend.database import get_db
    from backend.security import encrypt_plaid_token
    from backend.modules.finance import _sync_plaid_accounts_and_transactions
    from unittest.mock import patch, MagicMock

    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex.sync@gibson.test", "password": "PassAlex123!"},
                {"name": "Jordan", "email": "jordan.sync@gibson.test", "password": "PassJordan123!"},
            ],
        },
    )
    headers = {"Authorization": f"Bearer {p_res.get_json()['token']}"}

    with app_instance.app_context():
        db = get_db()
        p_row = db.execute("SELECT id FROM partners WHERE email = 'alex.sync@gibson.test'").fetchone()
        partner_id = p_row["id"]
        # Setup item and account with an existing cursor
        db.execute(
            "INSERT OR REPLACE INTO plaid_items (item_id, access_token, institution_name, linked_by_partner_id, cursor, status) VALUES ('item_test_1', ?, 'Chase Bank', ?, 'cursor_old_123', 'healthy')",
            (encrypt_plaid_token("access_test_token"), partner_id),
        )
        db.commit()

        # Step 1: Test error recording on ITEM_LOGIN_REQUIRED
        with patch("requests.post") as mock_post:
            resp_err = MagicMock()
            resp_err.status_code = 400
            resp_err.json.return_value = {
                "error_type": "ITEM_ERROR",
                "error_code": "ITEM_LOGIN_REQUIRED",
                "error_message": "The login credentials for this item are no longer valid.",
            }
            mock_post.return_value = resp_err

            accs, txs, err = _sync_plaid_accounts_and_transactions("access_test_token", "Chase Bank", partner_id, "item_test_1")
            assert err is not None
            assert "ITEM_LOGIN_REQUIRED" in err

        item_row = db.execute("SELECT status, last_error_code FROM plaid_items WHERE item_id = 'item_test_1'").fetchone()
        assert item_row["status"] == "error"
        assert item_row["last_error_code"] == "ITEM_LOGIN_REQUIRED"

    # Outside app_context: verify plaid_status returns requires_reauth
    st_resp = client.get("/api/finance/plaid/status", headers=headers)
    assert st_resp.status_code == 200
    st_data = st_resp.get_json()
    assert st_data["has_items_requiring_reauth"] is True
    target_item = next(it for it in st_data["linked_items"] if it["item_id"] == "item_test_1")
    assert target_item["requires_reauth"] is True

    # Step 2: Test create_link_token in Update Mode
    with patch("requests.post") as mock_post:
        resp_token = MagicMock()
        resp_token.status_code = 200
        resp_token.json.return_value = {"link_token": "link-sandbox-update-12345"}
        mock_post.return_value = resp_token

        tok_res = client.post("/api/finance/plaid/create_link_token", headers=headers, json={"partner_id": partner_id, "item_id": "item_test_1"})
        assert tok_res.status_code == 200
        call_kwargs = mock_post.call_args[1]["json"]
        assert call_kwargs["access_token"] == "access_test_token"
        assert "products" not in call_kwargs  # Must be omitted in Update Mode
        assert "webhook" in call_kwargs

    # Step 3: Test Full Re-Sync with reset_cursor=True
    mock_success_sync = {
        "accounts": [{
            "account_id": "acc_chase_main",
            "name": "Total Checking",
            "official_name": "Chase Total Checking",
            "type": "depository",
            "subtype": "checking",
            "mask": "4321",
            "balances": {"current": 4500.0, "available": 4500.0},
        }],
        "added": [{
            "account_id": "acc_chase_main",
            "transaction_id": "tx_new_today_1",
            "date": "2026-11-08",
            "authorized_date": "2026-11-08",
            "name": "Whole Foods Market",
            "amount": 85.50,
            "pending": True,
            "personal_finance_category": {"primary": "FOOD_AND_DRINK"},
        }],
        "modified": [],
        "removed": [],
        "has_more": False,
        "next_cursor": "cursor_fresh_999",
    }

    with patch("requests.post") as mock_post:
        def sync_side_effect(url, **kwargs):
            resp = MagicMock()
            resp.status_code = 200
            if "accounts/get" in url:
                resp.json.return_value = {"accounts": mock_success_sync["accounts"]}
            else:
                resp.json.return_value = mock_success_sync
            return resp
        mock_post.side_effect = sync_side_effect

        # Call /api/finance/plaid/sync with reset_cursor=True
        sync_resp = client.post("/api/finance/plaid/sync", headers=headers, json={"reset_cursor": True, "force": True})
        assert sync_resp.status_code == 200
        sync_json = sync_resp.get_json()
        assert sync_json["synced"] is True
        assert sync_json["reset_cursor"] is True
        assert sync_json["imported_transactions"] == 1

    with app_instance.app_context():
        db = get_db()
        # Check cursor was updated to fresh cursor and status became healthy
        updated_item = db.execute("SELECT status, cursor, last_error_code FROM plaid_items WHERE item_id = 'item_test_1'").fetchone()
        assert updated_item["status"] == "healthy"
        assert updated_item["cursor"] == "cursor_fresh_999"
        assert updated_item["last_error_code"] is None

        # Verify transaction was inserted with pending status
        tx_row = db.execute("SELECT * FROM transactions WHERE plaid_transaction_id = 'tx_new_today_1'").fetchone()
        assert tx_row is not None
        assert tx_row["amount"] == 85.50
        assert tx_row["is_pending"] == 1
        assert tx_row["date"] == "2026-11-08"

    # Step 4: Test public Plaid Webhook endpoint
    hook_resp = client.post(
        "/api/finance/plaid/webhook",
        json={
            "webhook_type": "ITEM",
            "webhook_code": "ERROR",
            "item_id": "item_test_1",
            "error": {
                "error_code": "ITEM_LOGIN_REQUIRED",
                "error_message": "User credentials expired",
            },
        },
    )
    assert hook_resp.status_code == 200
    hook_json = hook_resp.get_json()
    assert hook_json["received"] is True

    with app_instance.app_context():
        db = get_db()
        item_recheck = db.execute("SELECT status, last_error_code FROM plaid_items WHERE item_id = 'item_test_1'").fetchone()
        assert item_recheck["status"] == "error"
        assert item_recheck["last_error_code"] == "ITEM_LOGIN_REQUIRED"


def test_savings_module_spend_exclusion_transfers_and_mom_yoy_analytics(client):
    """
    Verifies:
    1. 'savings' module is registered in /api/hub/modules.
    2. Spending marked as coming from savings (is_savings_spend=True or category='Spent from Savings')
       is completely excluded from monthly budget spending (total_monthly_spent, total_gross_spent,
       category budgets, untracked_categories) while tracked in total_savings_spent and /api/finance/savings.
    3. Transfers into savings/brokerage accounts (/api/finance/savings/transfer), savings purchases
       (/api/finance/savings/spend), and balance snapshots (/api/finance/savings/snapshots) populate
       Month-over-Month (monthly_history), Year-over-Year (yearly_history), and per-account series.
    """
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Household",
            "partners": [
                {"name": "Alex", "email": "alex.sav@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan.sav@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    assert p_res.status_code == 201
    p_data = p_res.get_json()
    headers = {"Authorization": f"Bearer {p_data['token']}"}
    month = "2026-11"

    # 1. Verify 'savings' module exists in module registry
    mods_res = client.get("/api/modules", headers=headers)
    assert mods_res.status_code == 200
    mod_keys = [m["id"] for m in mods_res.get_json()["modules"]]
    assert "savings" in mod_keys

    # 2. Create a High-Yield Savings Account and a Brokerage Account
    hysa_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={
            "name": "Ally High-Yield Savings",
            "institution_name": "Ally Bank",
            "type": "depository",
            "subtype": "savings",
            "mask": "8899",
            "balance_current": 15000.0,
            "balance_available": 15000.0,
            "is_savings_account": True,
        },
    )
    assert hysa_res.status_code == 201
    hysa_id = hysa_res.get_json()["id"]

    brok_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={
            "name": "Fidelity Joint Brokerage",
            "institution_name": "Fidelity",
            "type": "investment",
            "subtype": "brokerage",
            "mask": "7744",
            "balance_current": 42000.0,
            "balance_available": 42000.0,
            "is_savings_account": True,
        },
    )
    assert brok_res.status_code == 201
    brok_id = brok_res.get_json()["id"]

    # 3. Set up a monthly budget for 'Shopping & Tech' ($500) and log a regular $120 purchase
    client.post(
        "/api/finance/budgets",
        headers=headers,
        json={"category": "Shopping & Tech", "monthly_limit": 500.0, "budget_month": month},
    )
    reg_tx = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Wireless Mouse",
            "amount": 120.0,
            "category": "Shopping & Tech",
            "date": "2026-11-05",
        },
    )
    assert reg_tx.status_code == 201

    # 4. Log a big $2,400 purchase (New OLED TV) initially in 'Shopping & Tech', then mark it as Spent from Savings
    big_tx = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "65-inch OLED TV",
            "amount": 2400.0,
            "category": "Shopping & Tech",
            "date": "2026-11-07",
        },
    )
    assert big_tx.status_code == 201
    big_tx_id = big_tx.get_json()["id"]

    # Before marking as savings spend, monthly spent is $2,520 ($120 + $2,400)
    sum_before = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    assert sum_before["total_monthly_spent"] == 2520.0

    # Mark the $2,400 purchase as coming from savings
    toggle_res = client.put(
        f"/api/finance/transactions/{big_tx_id}",
        headers=headers,
        json={"is_savings_spend": True, "savings_account_id": hysa_id},
    )
    assert toggle_res.status_code == 200
    assert toggle_res.get_json()["is_savings_spend"] is True
    assert toggle_res.get_json()["category"] == "Spent from Savings"

    # After marking as Spent from Savings, monthly budget spend drops back to $120.0!
    sum_after = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    assert sum_after["total_monthly_spent"] == 120.0
    assert sum_after["total_gross_spent"] == 120.0
    assert sum_after["total_savings_spent"] == 2400.0
    assert sum_after["savings_spend_count"] == 1

    # Verify 'Shopping & Tech' budget only has $120 spent ($380 remaining)
    shop_budget = next(b for b in sum_after["budgets"] if b["category"] == "Shopping & Tech")
    assert shop_budget["spent"] == 120.0
    assert shop_budget["remaining"] == 380.0

    # Verify 'Spent from Savings' is NOT flagged in untracked_categories
    untracked_names = [u["name"] for u in sum_after["untracked_categories"]]
    assert "Spent from Savings" not in untracked_names

    # 5. Log a transfer into the savings account ($1,500) via POST /api/finance/savings/transfer
    tr_res = client.post(
        "/api/finance/savings/transfer",
        headers=headers,
        json={
            "account_id": hysa_id,
            "source_name": "Monthly HYSA Transfer",
            "amount": 1500.0,
            "date": "2026-11-08",
            "budget_month": month,
            "update_account_balance": True,
        },
    )
    assert tr_res.status_code == 201

    # 6. Log a direct purchase from savings ($600 Vacation Flights) via POST /api/finance/savings/spend
    sp_res = client.post(
        "/api/finance/savings/spend",
        headers=headers,
        json={
            "name": "Anniversary Flights",
            "amount": 600.0,
            "savings_account_id": hysa_id,
            "date": "2026-11-09",
            "budget_month": month,
            "update_account_balance": True,
        },
    )
    assert sp_res.status_code == 201

    # 7. Record a historical balance snapshot for 2025-11 to verify YoY and MoM analytics
    snap_res = client.post(
        "/api/finance/savings/snapshots",
        headers=headers,
        json={
            "account_id": hysa_id,
            "snapshot_month": "2025-11",
            "balance": 10000.0,
            "notes": "Last year HYSA balance",
        },
    )
    assert snap_res.status_code in (200, 201)

    # 8. Query GET /api/finance/savings and verify accounts, KPIs, MoM, YoY, transfers, and spends
    sav_res = client.get("/api/finance/savings", headers=headers)
    assert sav_res.status_code == 200
    sav_data = sav_res.get_json()

    # Both HYSA and Brokerage accounts appear in savings_accounts
    sav_acc_ids = [a["id"] for a in sav_data["savings_accounts"]]
    assert hysa_id in sav_acc_ids
    assert brok_id in sav_acc_ids

    # Check HYSA balance updated: $15,000 + $1,500 transfer - $600 direct spend = $15,900
    hysa_obj = next(a for a in sav_data["savings_accounts"] if a["id"] == hysa_id)
    assert hysa_obj["balance_current"] == 15900.0
    assert hysa_obj["savings_bucket"] == "savings"

    brok_obj = next(a for a in sav_data["savings_accounts"] if a["id"] == brok_id)
    assert brok_obj["savings_bucket"] == "brokerage"

    # Check KPIs
    assert sav_data["kpis"]["total_savings_balance"] == 15900.0
    assert sav_data["kpis"]["total_brokerage_balance"] == 42000.0
    assert sav_data["kpis"]["total_combined_balance"] == 57900.0
    assert sav_data["kpis"]["all_time_transfers_in"] == 1500.0
    assert sav_data["kpis"]["all_time_savings_spent"] == 3000.0  # $2,400 TV + $600 Flights

    # Check MoM row for 2026-11
    nov_row = next(m for m in sav_data["monthly_history"] if m["month"] == "2026-11")
    assert nov_row["transfers_in"] == 1500.0
    assert nov_row["savings_spent"] == 3000.0
    assert nov_row["net_flow"] == -1500.0

    # Check YoY history includes 2025 and 2026
    years = [y["year"] for y in sav_data["yearly_history"]]
    assert "2025" in years
    assert "2026" in years


def test_transaction_cc_payment_and_split_categories(client):
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Household",
            "partners": [
                {"name": "Alex", "email": "alex.split@gibson.local", "password": "ValidPassword123!"},
                {"name": "Jordan", "email": "jordan.split@gibson.local", "password": "ValidPassword123!"},
            ],
        },
    )
    assert p_res.status_code == 201
    p_data = p_res.get_json()
    headers = {"Authorization": f"Bearer {p_data['token']}"}
    month = "2026-11"

    # Setup checking account
    acc_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={"name": "Premier Checking", "type": "depository", "subtype": "checking", "balance_current": 5000.0, "mask": "1122"},
    )
    acc_id = acc_res.get_json()["id"]

    # Set up budgets for Groceries & Dining ($800) and Shopping & Tech ($500)
    client.post(
        "/api/finance/categories",
        headers=headers,
        json={"name": "Groceries & Dining", "monthly_limit": 800.0, "month": month, "apply_scope": "only_this_month"},
    )
    client.post(
        "/api/finance/categories",
        headers=headers,
        json={"name": "Shopping & Tech", "monthly_limit": 500.0, "month": month, "apply_scope": "only_this_month"},
    )

    # 1. TEST CC PAYMENT TOGGLE
    # Log an expense: $650 Chase Card Payment on Checking
    cc_tx_res = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "account_id": acc_id,
            "name": "Chase Credit Card AutoPay",
            "amount": 650.0,
            "category": "General",
            "date": "2026-11-05",
            "budget_month": month,
        },
    )
    assert cc_tx_res.status_code == 201
    cc_tx_id = cc_tx_res.get_json()["id"]

    sum1 = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    assert sum1["total_gross_spent"] == 650.0

    # Mark as CC Payment
    put_cc_res = client.put(
        f"/api/finance/transactions/{cc_tx_id}",
        headers=headers,
        json={"is_cc_payment": True},
    )
    assert put_cc_res.status_code == 200
    cc_updated = put_cc_res.get_json()
    assert cc_updated["is_cc_payment"] is True
    assert cc_updated["category"] == "Credit Card Payment"

    # Verify excluded from budget spend!
    sum2 = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    assert sum2["total_gross_spent"] == 0.0
    assert sum2["total_monthly_spent"] == 0.0
    assert sum2["total_cc_payments_spent"] == 650.0

    # Verify unmarking restores to budget
    unmark_res = client.put(
        f"/api/finance/transactions/{cc_tx_id}",
        headers=headers,
        json={"is_cc_payment": False, "category": "General"},
    )
    assert unmark_res.status_code == 200
    assert unmark_res.get_json()["is_cc_payment"] is False
    sum3 = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    assert sum3["total_gross_spent"] == 650.0

    # Re-mark as CC payment so it doesn't interfere with next split test
    client.put(f"/api/finance/transactions/{cc_tx_id}", headers=headers, json={"is_cc_payment": True})

    # 2. TEST SPLIT TRANSACTION
    # Create a $150 Target transaction
    split_tx_res = client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "account_id": acc_id,
            "name": "Target Superstore",
            "amount": 150.0,
            "category": "General",
            "date": "2026-11-06",
            "budget_month": month,
        },
    )
    target_tx_id = split_tx_res.get_json()["id"]

    # Attempt invalid split (sum doesn't match total)
    bad_split = client.post(
        f"/api/finance/transactions/{target_tx_id}/split",
        headers=headers,
        json={
            "splits": [
                {"category": "Groceries & Dining", "amount": 80.0},
                {"category": "Shopping & Tech", "amount": 50.0},
            ]
        },
    )
    assert bad_split.status_code == 400
    assert "must equal transaction amount" in bad_split.get_json()["error"]

    # Valid split: $100 Groceries, $50 Shopping
    good_split = client.post(
        f"/api/finance/transactions/{target_tx_id}/split",
        headers=headers,
        json={
            "splits": [
                {"category": "Groceries & Dining", "amount": 100.0, "notes": "Weekly produce & snacks"},
                {"category": "Shopping & Tech", "amount": 50.0, "notes": "USB cable & household bins"},
            ]
        },
    )
    assert good_split.status_code == 200
    split_res_data = good_split.get_json()
    assert split_res_data["is_split"] is True
    assert len(split_res_data["splits"]) == 2

    # Check summary: Groceries & Dining spent = $100, Shopping & Tech spent = $50, total spent = $150
    sum4 = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    assert sum4["total_gross_spent"] == 150.0
    groc_b = next(b for b in sum4["budgets"] if b["category"] == "Groceries & Dining")
    shop_b = next(b for b in sum4["budgets"] if b["category"] == "Shopping & Tech")
    assert groc_b["spent"] == 100.0
    assert shop_b["spent"] == 50.0

    # Edit the split: 3 ways ($70 Groceries, $50 Shopping, $30 Baby & Family)
    edit_split = client.post(
        f"/api/finance/transactions/{target_tx_id}/split",
        headers=headers,
        json={
            "splits": [
                {"category": "Groceries & Dining", "amount": 70.0},
                {"category": "Shopping & Tech", "amount": 50.0},
                {"category": "Baby & Family", "amount": 30.0},
            ]
        },
    )
    assert edit_split.status_code == 200
    assert len(edit_split.get_json()["splits"]) == 3

    sum5 = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    groc_b5 = next(b for b in sum5["budgets"] if b["category"] == "Groceries & Dining")
    assert groc_b5["spent"] == 70.0

    # Revert split to single category via DELETE /api/finance/transactions/<id>/split
    revert_res = client.delete(
        f"/api/finance/transactions/{target_tx_id}/split",
        headers=headers,
        json={"category": "Groceries & Dining"},
    )
    assert revert_res.status_code == 200
    rev_data = revert_res.get_json()
    assert rev_data["is_split"] is False
    assert rev_data["category"] == "Groceries & Dining"

    sum6 = client.get(f"/api/finance/summary?month={month}", headers=headers).get_json()
    groc_b6 = next(b for b in sum6["budgets"] if b["category"] == "Groceries & Dining")
    shop_b6 = next(b for b in sum6["budgets"] if b["category"] == "Shopping & Tech")
    assert groc_b6["spent"] == 150.0
    assert shop_b6["spent"] == 0.0











