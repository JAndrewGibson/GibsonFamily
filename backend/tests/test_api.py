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

    # 2. Add a "Netflix" budget starting in 2026-09 ($22.99/mo) for 2026-09 & future months
    client.post(
        "/api/finance/budgets",
        headers=headers,
        json={
            "category": "Netflix",
            "monthly_limit": 22.99,
            "budget_month": "2026-09",
            "apply_scope": "this_and_future",
        },
    )

    # Verify state_version incremented for real-time partner reactivity
    pulse_2 = client.get("/api/sync-pulse", headers=headers).get_json()
    assert pulse_2["state_version"] > v1

    # Materialize 2026-09, 2026-10, and 2026-11
    sep_sum = client.get("/api/finance/summary?month=2026-09", headers=headers).get_json()
    oct_sum = client.get("/api/finance/summary?month=2026-10", headers=headers).get_json()
    nov_sum = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    assert any(b["category"] == "Netflix" for b in sep_sum["budgets"])
    assert any(b["category"] == "Netflix" for b in oct_sum["budgets"])
    nov_netflix = next(b for b in nov_sum["budgets"] if b["category"] == "Netflix")

    # 3. Cancel "Netflix" starting in 2026-11 (this_and_future) -> must disappear in 2026-11 & 2026-12,
    #    but remain preserved in historical months 2026-09 and 2026-10!
    del_res = client.delete(
        f"/api/finance/budgets/{nov_netflix['id']}?month=2026-11&category=Netflix&apply_scope=this_and_future",
        headers=headers,
    )
    assert del_res.status_code == 200

    sep_after = client.get("/api/finance/summary?month=2026-09", headers=headers).get_json()
    oct_after = client.get("/api/finance/summary?month=2026-10", headers=headers).get_json()
    nov_after = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    dec_after = client.get("/api/finance/summary?month=2026-12", headers=headers).get_json()

    assert any(b["category"] == "Netflix" for b in sep_after["budgets"])
    assert any(b["category"] == "Netflix" for b in oct_after["budgets"])
    assert not any(b["category"] == "Netflix" for b in nov_after["budgets"])
    assert not any(b["category"] == "Netflix" for b in dec_after["budgets"])

    # 4. Check Historical Months endpoint (/api/finance/history)
    hist_res = client.get("/api/finance/history", headers=headers)
    assert hist_res.status_code == 200
    hist_data = hist_res.get_json()
    months_map = {m["budget_month"]: m for m in hist_data["history"]}
    assert "2026-09" in months_map
    assert "2026-10" in months_map
    assert "2026-11" in months_map
    assert any(c["category"] == "Netflix" for c in months_map["2026-09"]["categories"])
    assert any(c["category"] == "Netflix" for c in months_map["2026-10"]["categories"])
    assert not any(c["category"] == "Netflix" for c in months_map["2026-11"]["categories"])

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


