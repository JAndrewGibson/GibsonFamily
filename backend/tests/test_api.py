import base64
import hashlib
import json
import struct
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from backend.app import create_app
from backend.database import get_db
from backend.security import SESSION_COOKIE_NAME, decrypt_plaid_token, encrypt_plaid_token


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _build_test_webauthn_attestation_and_signer(cred_id_bytes: bytes, rp_id: str = "localhost", sign_count: int = 1):
    """Generates a real ECDSA P-256 keypair and builds a standards-compliant CBOR attestationObject."""
    priv_key = ec.generate_private_key(ec.SECP256R1())
    pub_numbers = priv_key.public_key().public_numbers()
    x_bytes = pub_numbers.x.to_bytes(32, "big")
    y_bytes = pub_numbers.y.to_bytes(32, "big")

    # Minimal CBOR map for COSE EC2 P-256 public key:
    # {1: 2, 3: -7, -1: 1, -2: x_bytes (32B), -3: y_bytes (32B)}
    cose_key_cbor = (
        b"\xa5"
        b"\x01\x02"
        b"\x03\x26"
        b"\x20\x01"
        b"\x21\x58\x20" + x_bytes +
        b"\x22\x58\x20" + y_bytes
    )

    rp_id_hash = hashlib.sha256(rp_id.encode("utf-8")).digest()
    flags = b"\x45"  # UP (0x01) | UV (0x04) | AT (0x40)
    sc_bytes = struct.pack(">I", sign_count)
    aaguid = b"\x00" * 16
    cred_len = struct.pack(">H", len(cred_id_bytes))
    auth_data = rp_id_hash + flags + sc_bytes + aaguid + cred_len + cred_id_bytes + cose_key_cbor

    # CBOR map: {"fmt": "none", "authData": <bytes>}
    if len(auth_data) < 256:
        auth_data_hdr = b"\x58" + bytes([len(auth_data)])
    else:
        auth_data_hdr = b"\x59" + struct.pack(">H", len(auth_data))
    att_obj_cbor = (
        b"\xa2"
        b"\x63fmt\x64none"
        b"\x68authData" + auth_data_hdr + auth_data
    )

    def sign_assertion(client_data_raw: bytes, assertion_rp_id: str = rp_id, next_sign_count: int = 2):
        a_rp_hash = hashlib.sha256(assertion_rp_id.encode("utf-8")).digest()
        a_data = a_rp_hash + b"\x05" + struct.pack(">I", next_sign_count)
        signed_payload = a_data + hashlib.sha256(client_data_raw).digest()
        sig = priv_key.sign(signed_payload, ec.ECDSA(hashes.SHA256()))
        return a_data, sig

    return att_obj_cbor, sign_assertion


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
        # Should now use standard AES-256-GCM (enc:v2:)
        assert encrypted.startswith("enc:v2:")
        assert raw_token not in encrypted
        decrypted = decrypt_plaid_token(encrypted)
        assert decrypted == raw_token

        # Tampering with the ciphertext must fail AES-GCM integrity verification
        tampered = encrypted[:-4] + "AAAA"
        with pytest.raises(Exception):
            decrypt_plaid_token(tampered)

        # Backwards compatibility: verify legacy enc:v1: tokens can still be decrypted
        from backend.security import _derive_keys, _keystream_xor
        import secrets as sec
        salt = sec.token_bytes(16)
        nonce = sec.token_bytes(16)
        secret = app_instance.config["SECRET_KEY"]
        enc_key, mac_key = _derive_keys(secret, salt)
        ct = _keystream_xor(raw_token.encode("utf-8"), enc_key, nonce)
        import hmac as hm
        import hashlib as hl
        tag = hm.new(mac_key, salt + nonce + ct, hl.sha256).digest()
        legacy_payload = base64.urlsafe_b64encode(salt + nonce + tag + ct).decode("ascii")
        legacy_enc = f"enc:v1:{legacy_payload}"
        assert decrypt_plaid_token(legacy_enc) == raw_token


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

    # 3. Register WebAuthn Passkey for Partner 1 using real ECDSA P-256 COSE key & CBOR attestation
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
    cred_id_raw = b"gibson-passkey-cred-001"
    cred_id = _b64url(cred_id_raw)
    att_obj_cbor, sign_assertion = _build_test_webauthn_attestation_and_signer(cred_id_raw, rp_id="localhost", sign_count=1)
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
                    "attestationObject": _b64url(att_obj_cbor),
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

    # Unlock with WebAuthn Passkey (cryptographically signed assertion)
    auth_opt_res = client.post("/api/auth/webauthn/authenticate/options", json={"partner_id": p1_id})
    auth_challenge = auth_opt_res.get_json()["challenge"]
    auth_client_data_raw = json.dumps({
        "type": "webauthn.get",
        "challenge": auth_challenge,
        "origin": "http://localhost:5173",
    }).encode("utf-8")
    auth_client_data = _b64url(auth_client_data_raw)
    auth_data_bytes, sig_bytes = sign_assertion(auth_client_data_raw, assertion_rp_id="localhost", next_sign_count=2)

    unlock_res = client.post(
        "/api/auth/webauthn/authenticate/verify",
        headers=auth_p1,
        json={
            "credential": {
                "id": cred_id,
                "rawId": cred_id,
                "response": {
                    "clientDataJSON": auth_client_data,
                    "authenticatorData": _b64url(auth_data_bytes),
                    "signature": _b64url(sig_bytes),
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

    # Ensure 'Split' is never treated as an untracked category or registered in category catalog
    assert not any(c["name"].lower() == "split" for c in sum4.get("untracked_categories", []))
    assert not any(c["name"].lower() == "split" for c in sum4.get("categories_catalog", []))
    assert not any(c.lower() == "split" for c in sum4.get("all_categories", []))

    # Reject trying to track or budget 'Split' as a category
    bad_cat_res = client.post(
        "/api/finance/categories",
        headers=headers,
        json={"name": "Split", "monthly_limit": 100.0, "month": month},
    )
    assert bad_cat_res.status_code == 400
    assert "status" in bad_cat_res.get_json()["error"]

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


def test_rollover_spending_partner_spending_money_and_decimal_budgets(app_instance, client):
    """
    Tests:
    1. Home Dashboard ('dashboard') is registered as the first module.
    2. Dedicated "{user}'s Spending Money" category is automatically created for each partner
       with allow_rollover = True by default.
    3. Category budgets support decimal limits (e.g., $49.95, $25.50).
    4. Cumulative positive rollover across months:
       - 2026-11: Budget $50.00, Spent $45.00 -> +$5.00 rollover_out
       - 2026-12: Budget $50.00, Spent $41.00 -> +$9.00 month delta + $5.00 prior = +$14.00 rollover_out
       - 2027-01: Budget $50.00, rollover_in = +$14.00 (total available $64.00)
         Notice total_monthly_budget does NOT include the $14.00 rollover.
    5. Spending into positive rollover (Rainbow bar):
       - In 2027-01, spend $60.00 (over the $50.00 monthly limit, within $64.00 effective available).
       - Category has is_using_rollover = True, is_in_debt = False, spent_from_rollover = $10.00, rollover_out = +$4.00.
       - Crucial Equilibrium: $10.00 spent_from_rollover is excluded from total_monthly_spent so the month's
         Layered Budget Bar only counts $50.00 against the month's budget.
    6. Negative rollover debt (Red until positive again):
       - In 2027-02, rollover_in = +$4.00, budget = $50.00 (effective available $54.00).
       - Spend $120.00 -> rollover_out = -$66.00 (debt), is_in_debt = True, is_using_rollover = False.
       - In 2027-03, rollover_in = -$66.00, budget = $50.00, spend = $0.00 -> rollover_out = -$16.00,
         stays red (is_in_debt = True) because cumulative balance is still <= $0.00.
       - In 2027-04, rollover_in = -$16.00, budget = $50.00, spend = $10.00 -> rollover_out = +$24.00,
         is_in_debt = False (back to green!).
    """
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Andrew", "email": "andrew@gibson.local", "password": "PassAndrew123!"},
                {"name": "Ashley", "email": "ashley@gibson.local", "password": "PassAshley123!"},
            ],
        },
    )
    assert p_res.status_code == 201
    headers = {"Authorization": f"Bearer {p_res.get_json()['token']}"}

    # 1. Verify 'dashboard' is first in /api/modules
    mods_res = client.get("/api/modules", headers=headers)
    assert mods_res.status_code == 200
    mods = mods_res.get_json()["modules"]
    assert mods[0]["id"] == "dashboard"

    # 2. Verify decimal budget limit support
    dec_res = client.post(
        "/api/finance/budgets",
        headers=headers,
        json={
            "category": "Streaming & Apps",
            "monthly_limit": 49.95,
            "budget_month": "2026-11",
            "apply_scope": "this_and_future",
        },
    )
    assert dec_res.status_code == 201
    assert dec_res.get_json()["monthly_limit"] == 49.95

    # 3. Verify Andrew's Spending Money & Ashley's Spending Money exist with allow_rollover = True
    sum_nov_init = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    psm_list = sum_nov_init.get("partner_spending_money", [])
    assert len(psm_list) == 2
    andrew_sm = next(p for p in psm_list if p["partner_name"] == "Andrew")
    assert andrew_sm["category"] == "Andrew's Spending Money"
    assert andrew_sm["allow_rollover"] is True

    # Set Andrew's Spending Money budget to $50.00/mo starting 2026-11
    sm_budget_res = client.post(
        "/api/finance/budgets",
        headers=headers,
        json={
            "category": "Andrew's Spending Money",
            "monthly_limit": 50.00,
            "budget_month": "2026-11",
            "apply_scope": "this_and_future",
            "allow_rollover": True,
        },
    )
    assert sm_budget_res.status_code == 201

    # 4. Log $45.00 in 2026-11 -> leaves +$5.00 rollover
    client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Coffee & Books",
            "amount": 45.00,
            "category": "Andrew's Spending Money",
            "date": "2026-11-10",
            "budget_month": "2026-11",
        },
    )
    # Log $41.00 in 2026-12 -> leaves +$9.00 from Dec + $5.00 from Nov = +$14.00 rollover
    client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Steam Winter Sale",
            "amount": 41.00,
            "category": "Andrew's Spending Money",
            "date": "2026-12-15",
            "budget_month": "2026-12",
        },
    )

    sum_dec = client.get("/api/finance/summary?month=2026-12", headers=headers).get_json()
    andrew_dec = next(b for b in sum_dec["budgets"] if b["category"] == "Andrew's Spending Money")
    assert andrew_dec["rollover_in"] == 5.00
    assert andrew_dec["spent"] == 41.00
    assert andrew_dec["rollover_out"] == 14.00
    assert andrew_dec["is_using_rollover"] is False
    assert andrew_dec["is_in_debt"] is False

    # 5. In 2027-01, Andrew has $50.00 monthly budget + $14.00 rollover_in = $64.00 available.
    # Spend $60.00 -> $10.00 comes from rollover saving!
    client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Mechanical Keyboard",
            "amount": 60.00,
            "category": "Andrew's Spending Money",
            "date": "2027-01-12",
            "budget_month": "2027-01",
        },
    )
    sum_jan = client.get("/api/finance/summary?month=2027-01", headers=headers).get_json()
    andrew_jan = next(b for b in sum_jan["budgets"] if b["category"] == "Andrew's Spending Money")
    assert andrew_jan["rollover_in"] == 14.00
    assert andrew_jan["monthly_limit"] == 50.00
    assert andrew_jan["spent"] == 60.00
    assert andrew_jan["spent_from_rollover"] == 10.00
    assert andrew_jan["rollover_out"] == 4.00
    assert andrew_jan["is_using_rollover"] is True
    assert andrew_jan["is_in_debt"] is False

    # Verify total_monthly_spent in 2027-01 excludes the $10.00 spent_from_rollover!
    assert sum_jan["total_gross_spent"] == 60.00
    assert sum_jan["total_rollover_spent"] == 10.00
    assert sum_jan["total_monthly_spent"] == 50.00

    # 6. Negative Rollover Debt in 2027-02:
    # Entering 2027-02 with +$4.00 rollover_in + $50.00 budget = $54.00 available.
    # Spend $120.00 -> -$66.00 negative rollover debt!
    client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Headphones Impulse Buy",
            "amount": 120.00,
            "category": "Andrew's Spending Money",
            "date": "2027-02-05",
            "budget_month": "2027-02",
        },
    )
    sum_feb = client.get("/api/finance/summary?month=2027-02", headers=headers).get_json()
    andrew_feb = next(b for b in sum_feb["budgets"] if b["category"] == "Andrew's Spending Money")
    assert andrew_feb["rollover_in"] == 4.00
    assert andrew_feb["spent_from_rollover"] == 4.00
    assert andrew_feb["rollover_out"] == -66.00
    assert andrew_feb["is_using_rollover"] is False
    assert andrew_feb["is_in_debt"] is True

    # In 2027-03, $0 spent, $50 budget offsets -$66 debt -> -$16.00 rollover_out (still in debt / red!)
    sum_mar = client.get("/api/finance/summary?month=2027-03", headers=headers).get_json()
    andrew_mar = next(b for b in sum_mar["budgets"] if b["category"] == "Andrew's Spending Money")
    assert andrew_mar["rollover_in"] == -66.00
    assert andrew_mar["rollover_out"] == -16.00
    assert andrew_mar["is_in_debt"] is True

    # In 2027-04, $10 spent, $50 budget offsets -$16 debt -> +$24.00 rollover_out (positive again!)
    client.post(
        "/api/finance/transactions",
        headers=headers,
        json={
            "name": "Snack",
            "amount": 10.00,
            "category": "Andrew's Spending Money",
            "date": "2027-04-03",
            "budget_month": "2027-04",
        },
    )
    sum_apr = client.get("/api/finance/summary?month=2027-04", headers=headers).get_json()
    andrew_apr = next(b for b in sum_apr["budgets"] if b["category"] == "Andrew's Spending Money")
    assert andrew_apr["rollover_in"] == -16.00
    assert andrew_apr["rollover_out"] == 24.00
    assert andrew_apr["is_in_debt"] is False


def test_closing_months_notifications_leftover_and_fun_recap(client):
    from datetime import date
    from backend.modules.finance import (
        get_month_close_eligibility,
        check_and_create_month_close_notifications,
        _compute_month_leftover_data,
        _build_algorithmic_month_recap,
    )
    from backend.database import get_db

    # 1. Reset and setup household
    client.post("/api/auth/reset-all")
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Family",
            "partners": [
                {"name": "Alex Gibson", "email": "alex@example.com", "password": "AlexSecurePassword123!", "avatar_color": "#6366f1"},
                {"name": "Jordan Gibson", "email": "jordan@example.com", "password": "JordanSecurePassword123!", "avatar_color": "#ec4899"},
            ],
        },
    )
    assert p_res.status_code == 201
    p_data = p_res.get_json()
    token = p_data["token"]
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/auth/onboarding/complete", headers=headers, json={"household_name": "Gibson Family"})

    # Add checking account and savings account
    chk_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={"name": "Primary Checking", "type": "depository", "subtype": "checking", "balance_current": 5000.0, "mask": "1111"},
    )
    chk_id = chk_res.get_json()["id"]

    sav_res = client.post(
        "/api/finance/accounts",
        headers=headers,
        json={"name": "High-Yield Savings", "type": "depository", "subtype": "savings", "balance_current": 10000.0, "mask": "2222", "is_savings_account": True},
    )
    sav_id = sav_res.get_json()["id"]

    # 2. Test Eligibility Rule: 3 days before the 1st of the new month
    # For November 2026 (2026-11), next month starts 2026-12-01.
    # 3 days before is 2026-11-28.
    not_yet_eligible, days_left, notif_date = get_month_close_eligibility("2026-11", date(2026, 11, 25))
    assert not_yet_eligible is False
    assert days_left == 3
    assert notif_date == "2026-11-28"

    eligible_day, days_left_0, notif_date_2 = get_month_close_eligibility("2026-11", date(2026, 11, 28))
    assert eligible_day is True
    assert days_left_0 == 0

    past_month_eligible, _, _ = get_month_close_eligibility("2026-11", date(2026, 12, 5))
    assert past_month_eligible is True

    # 3. Test Notification Creation on 3 days before 1st of new month
    with client.application.app_context():
        db = get_db()
        created = check_and_create_month_close_notifications(db, date(2026, 11, 28))
        assert "2026-11" in created

    notifs = client.get("/api/notifications", headers=headers).get_json()["notifications"]
    assert any("Time to Close November '26!" in n["title"] for n in notifs)

    # 4. Set category budgets in 2026-11
    # Non-rollover: Groceries ($500), Dining ($300), Utilities ($200)
    # Rollover: "Alex's Spending Money" ($100, allow_rollover = 1)
    client.post("/api/finance/budgets", headers=headers, json={"category": "Groceries", "monthly_limit": 500.0, "budget_month": "2026-11", "allow_rollover": 0})
    client.post("/api/finance/budgets", headers=headers, json={"category": "Dining Out", "monthly_limit": 300.0, "budget_month": "2026-11", "allow_rollover": 0})
    client.post("/api/finance/budgets", headers=headers, json={"category": "Utilities", "monthly_limit": 200.0, "budget_month": "2026-11", "allow_rollover": 0})
    client.post("/api/finance/budgets", headers=headers, json={"category": "Alex's Spending Money", "monthly_limit": 100.0, "budget_month": "2026-11", "allow_rollover": 1})

    # Log income in 2026-11
    client.post("/api/finance/income", headers=headers, json={"source_name": "Tech Corp Salary", "amount": 4500.0, "income_type": "payroll", "budget_month": "2026-11", "date": "2026-11-01"})

    # Log expenses in 2026-11
    # Groceries: $400 spent -> $100 leftover
    client.post("/api/finance/transactions", headers=headers, json={"name": "Trader Joe's", "merchant_name": "Trader Joe's", "amount": 250.0, "category": "Groceries", "budget_month": "2026-11", "date": "2026-11-05", "account_id": chk_id})
    client.post("/api/finance/transactions", headers=headers, json={"name": "Trader Joe's #2", "merchant_name": "Trader Joe's", "amount": 150.0, "category": "Groceries", "budget_month": "2026-11", "date": "2026-11-12", "account_id": chk_id})

    # Dining: $220 spent -> $80 leftover
    client.post("/api/finance/transactions", headers=headers, json={"name": "Pizzeria Luigi", "merchant_name": "Pizzeria Luigi", "amount": 120.0, "category": "Dining Out", "budget_month": "2026-11", "date": "2026-11-15", "account_id": chk_id})
    client.post("/api/finance/transactions", headers=headers, json={"name": "Sushi Bar", "merchant_name": "Sushi Bar", "amount": 100.0, "category": "Dining Out", "budget_month": "2026-11", "date": "2026-11-20", "account_id": chk_id})

    # Utilities: $180 spent -> $20 leftover
    client.post("/api/finance/transactions", headers=headers, json={"name": "Electric Power Co", "merchant_name": "Electric Power Co", "amount": 180.0, "category": "Utilities", "budget_month": "2026-11", "date": "2026-11-10", "account_id": chk_id})

    # Alex's Spending Money: $60 spent -> $40 unused rollover
    client.post("/api/finance/transactions", headers=headers, json={"name": "Bookstore", "merchant_name": "Local Books", "amount": 60.0, "category": "Alex's Spending Money", "budget_month": "2026-11", "date": "2026-11-18", "account_id": chk_id})

    # 5. Check Leftover Calculation (Not including rollovers!)
    status_res = client.get("/api/finance/month-close-status?month=2026-11", headers=headers).get_json()
    assert status_res["is_closed"] is False
    # Total non-rollover leftover: $100 (Groceries) + $80 (Dining) + $20 (Utilities) = $200.00
    assert status_res["leftover_amount"] == 200.00

    # Ensure rollover category (Alex's Spending Money: $40) is in rollover_categories and EXCLUDED from leftover_amount!
    leftover_cat_names = [c["category"] for c in status_res["leftover_categories"] if c["leftover"] > 0]
    assert "Groceries" in leftover_cat_names
    assert "Dining Out" in leftover_cat_names
    assert "Utilities" in leftover_cat_names
    assert "Alex's Spending Money" not in leftover_cat_names

    ro_cat_names = [c["category"] for c in status_res["rollover_categories"]]
    assert "Alex's Spending Money" in ro_cat_names
    alex_ro = next(c for c in status_res["rollover_categories"] if c["category"] == "Alex's Spending Money")
    assert alex_ro["rollover_out"] == 40.00

    # Check Month-End Tasks list
    task_ids = [t["id"] for t in status_res["tasks"]]
    assert "pending_txs" in task_ids
    assert "transfer_leftover" in task_ids
    assert "partner_rollovers" in task_ids

    # 6. Close the Month & Transfer Leftover into Savings
    close_res = client.post(
        "/api/finance/close-month",
        headers=headers,
        json={
            "month": "2026-11",
            "transferred_to_savings": True,
            "savings_account_id": sav_id,
            "transfer_amount": 200.00,
            "notes": "November closed cleanly!",
        },
    )
    assert close_res.status_code == 201
    close_data = close_res.get_json()
    assert close_data["closed"] is True
    assert close_data["leftover_amount"] == 200.00
    assert close_data["transferred_to_savings"] is True

    # Verify savings account balance increased by $200.00
    sav_check = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    sav_acc = next(a for a in sav_check["accounts"] if a["id"] == sav_id)
    assert sav_acc["balance_current"] == 10200.00

    # Verify summary returns month_close object
    assert sav_check["month_close"]["is_closed"] is True
    assert sav_check["month_close"]["leftover_amount"] == 200.00
    assert sav_check["month_close"]["transferred_to_savings"] is True

    # 7. Algorithmic Recap Verification (Spotify Wrapped / Year In Review style)
    recap = close_data["recap"]
    assert recap["budget_month"] == "2026-11"
    assert "November '26 Recap" in recap["recap_title"]
    assert recap["overview"]["total_income"] == 4500.00
    assert recap["overview"]["total_spent"] == 860.00  # 400 + 220 + 180 + 60
    assert recap["overview"]["net_cashflow"] == 3640.00
    assert recap["persona"]["title"] != ""
    assert len(recap["slides"]) >= 6

    # Top Category is Groceries ($400)
    assert recap["top_categories"][0]["category"] == "Groceries"
    assert recap["top_categories"][0]["spent"] == 400.00

    # Top Merchant is Trader Joe's (visited 2 times)
    assert recap["top_merchant"]["name"] == "Trader Joe's"
    assert recap["top_merchant"]["count"] == 2

    # Biggest single purchase is Trader Joe's $250.00
    assert recap["biggest_purchase"]["amount"] == 250.00

    # Budget MVP is Groceries ($100 saved)
    assert recap["budget_mvp"]["category"] == "Groceries"
    assert recap["budget_mvp"]["saved"] == 100.00

    # 8. Test Trends (MoM and YoY)
    # Add December 2026 transactions to test MoM trend
    # In Dec 2026, total spending is $1100 (up from Nov's $960)
    client.post("/api/finance/budgets", headers=headers, json={"category": "Groceries", "monthly_limit": 500.0, "budget_month": "2026-12", "allow_rollover": 0})
    client.post("/api/finance/income", headers=headers, json={"source_name": "Salary", "amount": 4500.0, "income_type": "payroll", "budget_month": "2026-12", "date": "2026-12-01"})
    client.post("/api/finance/transactions", headers=headers, json={"name": "Supermarket", "amount": 1100.0, "category": "Groceries", "budget_month": "2026-12", "date": "2026-12-05", "account_id": chk_id})

    with client.application.app_context():
        db = get_db()
        dec_recap = _build_algorithmic_month_recap(db, "2026-12")
        # In Dec, spent $1100 vs Nov $960 -> spending up ~15% from last month!
        assert dec_recap["trends"]["mom_spend_trend"] is not None
        assert "Spending up" in dec_recap["trends"]["mom_spend_trend"]
        assert "from last month!" in dec_recap["trends"]["mom_spend_trend"]

    # Also test YoY: add November 2025 transaction of $1400
    # In Nov 2026, spending was $960 vs Nov 2025 $1400 -> Spending down 31% from last November!
    client.post("/api/finance/transactions", headers=headers, json={"name": "Historical Grocery", "amount": 1400.0, "category": "Groceries", "budget_month": "2025-11", "date": "2025-11-10", "account_id": chk_id})
    with client.application.app_context():
        db = get_db()
        nov_recap_with_yoy = _build_algorithmic_month_recap(db, "2026-11")
        assert nov_recap_with_yoy["trends"]["yoy_spend_trend"] is not None
        assert "Spending down" in nov_recap_with_yoy["trends"]["yoy_spend_trend"]
        assert "from last November!" in nov_recap_with_yoy["trends"]["yoy_spend_trend"]

    # 9. Test Reopen Month and Historical Months integration
    reopen_res = client.post("/api/finance/reopen-month", headers=headers, json={"month": "2026-11"})
    assert reopen_res.status_code == 200
    assert reopen_res.get_json()["reopened"] is True

    status_reopened = client.get("/api/finance/month-close-status?month=2026-11", headers=headers).get_json()
    assert status_reopened["is_closed"] is False

    # Check history endpoint contains is_closed flag
    history = client.get("/api/finance/history", headers=headers).get_json()["history"]
    nov_hist = next(h for h in history if h["month"] == "2026-11")
    assert nov_hist["is_closed"] is False


def test_security_audit_secret_key_mandate(tmp_path):
    # Weak default or missing secret must raise RuntimeError in non-testing mode
    db_file = tmp_path / "test_sec.db"
    with pytest.raises(RuntimeError) as exc_info:
        create_app({
            "TESTING": False,
            "DATABASE_PATH": str(db_file),
            "SECRET_KEY": "gibson-family-dev-secret-key",
        })
    assert "CRITICAL: FLASK_SECRET_KEY must be configured" in str(exc_info.value)


def test_security_audit_url_scheme_validation(client):
    # Setup partners
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Security Household",
            "partners": [
                {"name": "Alice", "email": "alice@test.local", "password": "Password123!", "avatar_color": "#6366f1"},
                {"name": "Bob", "email": "bob@test.local", "password": "Password123!", "avatar_color": "#ec4899"},
            ],
        },
    )
    token = p_res.get_json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Attempt to inject javascript: URI in purchase request must be rejected with 400
    bad_res = client.post(
        "/api/requests",
        headers=headers,
        json={
            "title": "Malicious Request",
            "amount": 99.0,
            "url": "javascript:alert(document.cookie)",
        },
    )
    assert bad_res.status_code == 400
    assert "Only http:// and https:// URLs are permitted" in bad_res.get_json()["error"]

    # Legitimate https URL must succeed
    good_res = client.post(
        "/api/requests",
        headers=headers,
        json={
            "title": "Legitimate Item",
            "amount": 49.99,
            "url": "https://www.target.com/p/item",
        },
    )
    assert good_res.status_code == 201
    assert good_res.get_json()["url"] == "https://www.target.com/p/item"


def test_security_audit_account_deletion_and_data_erasure(client):
    # Create partners
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Erasure Household",
            "partners": [
                {"name": "Charlie", "email": "charlie@test.local", "password": "Password123!", "avatar_color": "#6366f1"},
            ],
        },
    )
    token = p_res.get_json()["token"]
    partner_id = p_res.get_json()["partners"][0]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    # Add a purchase request and a push subscription
    client.post(
        "/api/requests",
        headers=headers,
        json={"title": "Chair", "amount": 120.0},
    )
    client.post(
        "/api/notifications/push-subscribe",
        headers=headers,
        json={"endpoint": "https://push.example.com/sub/123", "p256dh": "key", "auth": "secret"},
    )

    # Invoke DELETE /api/account
    del_res = client.delete("/api/account", headers=headers)
    assert del_res.status_code == 200
    assert del_res.get_json()["deleted"] is True

    # Partner, sessions, requests, and subscriptions should be completely erased
    with client.application.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) AS cnt FROM partners WHERE id = ?", (partner_id,)).fetchone()["cnt"] == 0
        assert db.execute("SELECT COUNT(*) AS cnt FROM auth_sessions WHERE partner_id = ?", (partner_id,)).fetchone()["cnt"] == 0
        assert db.execute("SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE partner_id = ?", (partner_id,)).fetchone()["cnt"] == 0
        assert db.execute("SELECT COUNT(*) AS cnt FROM purchase_requests WHERE requester_id = ?", (partner_id,)).fetchone()["cnt"] == 0

        # Since 0 partners remain, onboarding should be reset
        onb = db.execute("SELECT value FROM app_settings WHERE key = 'onboarding_completed'").fetchone()
        assert onb["value"] == "0"


def test_security_audit_csrf_protection(tmp_path):
    # Test CSRF protection when cookie is used without custom header
    db_file = tmp_path / "test_csrf.db"
    app = create_app({
        "TESTING": True,
        "ENFORCE_CSRF_IN_TESTS": True,
        "DATABASE_PATH": str(db_file),
    })
    with app.test_client() as c:
        # Create user
        p_res = c.post(
            "/api/auth/partners",
            json={
                "household_name": "CSRF Household",
                "partners": [
                    {"name": "Dave", "email": "dave@test.local", "password": "Password123!", "avatar_color": "#6366f1"},
                ],
            },
        )
        token = p_res.get_json()["token"]

        # Set the session cookie manually (simulating browser cookie)
        c.set_cookie(SESSION_COOKIE_NAME, token)

        # Mutating request with cookie but WITHOUT custom header and with cross-origin Origin must be rejected (403)
        csrf_blocked = c.post(
            "/api/requests",
            headers={"Origin": "https://malicious-evil-site.com"},
            json={"title": "Evil Request", "amount": 1000.0},
        )
        assert csrf_blocked.status_code == 403
        assert "CSRF validation failed" in csrf_blocked.get_json()["error"]

        # Mutating request WITH X-Requested-With: GibsonApp header must be accepted
        csrf_allowed = c.post(
            "/api/requests",
            headers={"X-Requested-With": "GibsonApp"},
            json={"title": "Legit Request", "amount": 25.0},
        )
        assert csrf_allowed.status_code == 201


def test_security_audit_setup_invite_token(tmp_path):
    db_file = tmp_path / "test_setup.db"
    app = create_app({
        "TESTING": True,
        "SETUP_INVITE_TOKEN": "secret-invite-token-7788",
        "DATABASE_PATH": str(db_file),
    })
    with app.test_client() as c:
        # 1. Onboarding without token should be 403
        blocked = c.post(
            "/api/auth/partners",
            json={
                "household_name": "Token Household",
                "partners": [{"name": "Eve", "email": "eve@test.local", "password": "Password123!", "avatar_color": "#6366f1"}],
            },
        )
        assert blocked.status_code == 403
        assert "setup invite token is required" in blocked.get_json()["error"]

        # 2. Onboarding with valid setup token should succeed
        allowed = c.post(
            "/api/auth/partners",
            json={
                "setup_token": "secret-invite-token-7788",
                "household_name": "Token Household",
                "partners": [{"name": "Eve", "email": "eve@test.local", "password": "Password123!", "avatar_color": "#6366f1"}],
            },
        )
        assert allowed.status_code == 201


def test_facelift_modules_household_and_spending_money_sync(client):
    res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {
                    "name": "Alex",
                    "email": "alex@test.local",
                    "password": "Password123!",
                    "monthly_fun_allowance": 300,
                },
                {
                    "name": "Jordan",
                    "email": "jordan@test.local",
                    "password": "Password123!",
                    "monthly_fun_allowance": 200,
                },
            ],
        },
    )
    assert res.status_code == 201
    data = res.get_json()
    headers = {"Authorization": f"Bearer {data['token']}"}
    alex_id = data["partners"][0]["id"]

    # 1. Verify renamed & reordered modules
    mods = client.get("/api/modules", headers=headers).get_json()["modules"]
    assert [m["name"] for m in mods] == [
        "Home",
        "Budget",
        "Purchase Requests",
        "Savings",
        "Big Purchases",
        "Groceries",
        "Admin Planning",
        "Recurring Tasks",
        "Games",
        "Splendor",
        "Weekly Recap",
    ]
    splendor_mod = next(m for m in mods if m["id"] == "splendor")
    assert splendor_mod["parent_id"] == "games"

    # 2. Verify Spending Money budget was created from partner profile
    summary = client.get("/api/finance/summary?month=2026-11", headers=headers).get_json()
    alex_budget = next((b for b in summary["budgets"] if b["category"] == "Alex's Spending Money"), None)
    assert alex_budget is not None
    assert alex_budget["monthly_limit"] == 300.0

    # 3. Updating Alex's Spending Money via /api/finance/budgets syncs back to partner
    up_res = client.post(
        "/api/finance/budgets",
        headers=headers,
        json={
            "category": "Alex's Spending Money",
            "monthly_limit": 450.0,
            "budget_month": "2026-11",
            "apply_scope": "this_and_future",
        },
    )
    assert up_res.status_code == 201
    setup_data = client.get("/api/auth/setup-status", headers=headers).get_json()
    alex_p = next(p for p in setup_data["partners"] if p["id"] == alex_id)
    assert alex_p["monthly_fun_allowance"] == 450.0

    # 4. Updating household_name & starting_budget_month via PUT /api/auth/household
    hh_res = client.put(
        "/api/auth/household",
        headers=headers,
        json={"household_name": "Smith", "starting_budget_month": "2026-06"},
    )
    assert hh_res.status_code == 200
    assert hh_res.get_json()["household_name"] == "Smith"
    assert hh_res.get_json()["starting_budget_month"] == "2026-06"

    setup_after = client.get("/api/auth/setup-status", headers=headers).get_json()
    assert setup_after["starting_budget_month"] == "2026-06"

    sum_after = client.get("/api/finance/summary?month=2026-06", headers=headers).get_json()
    assert sum_after["starting_budget_month"] == "2026-06"
    assert "2026-06" in sum_after["available_months"]


def test_splendor_game_turns_bump_cooldown_forfeit_and_analytics(client):
    res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {
                    "name": "Alex",
                    "email": "alex@splendor.local",
                    "password": "Password123!",
                    "monthly_fun_allowance": 200,
                },
                {
                    "name": "Jordan",
                    "email": "jordan@splendor.local",
                    "password": "Password123!",
                    "monthly_fun_allowance": 200,
                },
            ],
        },
    )
    assert res.status_code == 201
    p_data = res.get_json()
    p1_id = p_data["partners"][0]["id"]
    p2_id = p_data["partners"][1]["id"]
    auth_p1 = {"Authorization": f"Bearer {p_data['token']}"}

    p2_login = client.post(
        "/api/auth/login",
        json={"email": "jordan@splendor.local", "password": "Password123!"},
    )
    auth_p2 = {"Authorization": f"Bearer {p2_login.get_json()['token']}"}

    # 1. Check initial state & catalog summary (90 cards, 10 nobles)
    init_state = client.get("/api/splendor/state", headers=auth_p1).get_json()
    assert init_state["active_game"] is None
    assert init_state["catalog_summary"]["total_development_cards"] == 90
    assert init_state["catalog_summary"]["tier_1_cards"] == 40
    assert init_state["catalog_summary"]["tier_2_cards"] == 30
    assert init_state["catalog_summary"]["tier_3_cards"] == 20
    assert init_state["catalog_summary"]["total_nobles"] == 10

    # 2. Start a new game with P1 going first
    new_res = client.post(
        "/api/splendor/new",
        headers=auth_p1,
        json={"first_turn_partner_id": p1_id},
    )
    assert new_res.status_code == 201
    game = new_res.get_json()["game"]
    game_id = game["id"]
    assert game["status"] == "active"
    assert game["current_turn_partner_id"] == p1_id
    assert len(game["state"]["nobles"]) == 3
    assert len(game["state"]["board"]["1"]) == 4
    assert len(game["state"]["board"]["2"]) == 4
    assert len(game["state"]["board"]["3"]) == 4
    assert game["state"]["deck_counts"]["1"] == 36
    assert game["state"]["deck_counts"]["2"] == 26
    assert game["state"]["deck_counts"]["3"] == 16

    # 3. Partner 2 (not their turn) sends a bump notification to Partner 1
    bump_res = client.post(f"/api/splendor/{game_id}/bump", headers=auth_p2)
    assert bump_res.status_code == 200
    assert bump_res.get_json()["bumped"] is True
    assert bump_res.get_json()["game"]["bump_available"] is False

    # Second bump within 24 hours is blocked with 429 cooldown
    bump_again = client.post(f"/api/splendor/{game_id}/bump", headers=auth_p2)
    assert bump_again.status_code == 429
    assert "24 hours" in bump_again.get_json()["error"]

    # Verify Partner 1 received the bump notification
    p1_notifs = client.get("/api/notifications", headers=auth_p1).get_json()["notifications"]
    assert any(n["notif_type"] == "splendor_bump" and n["link_tab"] == "games" for n in p1_notifs)

    # 4. Partner 1 takes 3 different gems
    t1_res = client.post(
        f"/api/splendor/{game_id}/turn",
        headers=auth_p1,
        json={"action": "take_different", "gems": ["white", "blue", "green"]},
    )
    assert t1_res.status_code == 200
    g_after_t1 = t1_res.get_json()["game"]
    assert g_after_t1["current_turn_partner_id"] == p2_id
    assert g_after_t1["state"]["players"][str(p1_id)]["tokens"]["white"] == 1
    assert g_after_t1["state"]["bank"]["white"] == 3

    # 5. Partner 2 takes 2 red gems (4 in bank initially)
    t2_res = client.post(
        f"/api/splendor/{game_id}/turn",
        headers=auth_p2,
        json={"action": "take_same", "gem": "red"},
    )
    assert t2_res.status_code == 200
    g_after_t2 = t2_res.get_json()["game"]
    assert g_after_t2["current_turn_partner_id"] == p1_id
    assert g_after_t2["state"]["players"][str(p2_id)]["tokens"]["red"] == 2
    assert g_after_t2["state"]["bank"]["red"] == 2

    # 6. Partner 1 reserves a card from Tier 1 board & gets 1 gold token
    card_to_reserve = g_after_t2["state"]["board"]["1"][0]["id"]
    t3_res = client.post(
        f"/api/splendor/{game_id}/turn",
        headers=auth_p1,
        json={"action": "reserve", "card_id": card_to_reserve},
    )
    assert t3_res.status_code == 200
    g_after_t3 = t3_res.get_json()["game"]
    assert len(g_after_t3["state"]["players"][str(p1_id)]["reserved_cards"]) == 1
    assert g_after_t3["state"]["players"][str(p1_id)]["tokens"]["gold"] == 1

    # 7. Partner 2 forfeits the game -> Partner 1 wins, stats recorded
    forfeit_res = client.post(f"/api/splendor/{game_id}/forfeit", headers=auth_p2)
    assert forfeit_res.status_code == 200
    f_data = forfeit_res.get_json()
    assert f_data["game"]["status"] == "forfeited"
    assert f_data["game"]["winner_partner_id"] == p1_id
    assert f_data["game"]["forfeited_by_partner_id"] == p2_id

    analytics = f_data["analytics"]
    assert analytics["total_games"] == 1
    assert analytics["completed_games_count"] == 1
    p1_stats = next(s for s in analytics["partner_stats"] if s["partner_id"] == p1_id)
    p2_stats = next(s for s in analytics["partner_stats"] if s["partner_id"] == p2_id)
    assert p1_stats["wins"] == 1
    assert p2_stats["forfeits"] == 1

    # 8. Start a second game with a $25 Spending Money wager (current month only)
    # First verify wager > 200 is rejected
    over_wager = client.post(
        "/api/splendor/new",
        headers=auth_p1,
        json={"first_turn_partner_id": p1_id, "wager_amount": 500},
    )
    assert over_wager.status_code == 400
    assert "exceeds" in over_wager.get_json()["error"]

    g2_res = client.post(
        "/api/splendor/new",
        headers=auth_p1,
        json={"first_turn_partner_id": p1_id, "wager_amount": 25.0},
    )
    assert g2_res.status_code == 201
    g2 = g2_res.get_json()["game"]
    g2_id = g2["id"]
    wager_month = g2["wager_month"]
    assert g2["wager_amount"] == 25.0

    # Partner 2 forfeits Game #2 -> Partner 1 wins $25 Spending Money for wager_month ONLY
    f2_res = client.post(f"/api/splendor/{g2_id}/forfeit", headers=auth_p2)
    assert f2_res.status_code == 200
    f2_data = f2_res.get_json()
    assert f2_data["game"]["wager_settled"] is True
    settlement = f2_data["events"]["wager_settlement"]
    assert settlement["wager_amount"] == 25.0
    assert settlement["winner_old_limit"] == 200.0
    assert settlement["winner_new_limit"] == 225.0
    assert settlement["loser_old_limit"] == 200.0
    assert settlement["loser_new_limit"] == 175.0

    # Verify current month summary has Alex at $225 and Jordan at $175
    curr_sum = client.get(f"/api/finance/summary?month={wager_month}", headers=auth_p1).get_json()
    alex_curr = next(b for b in curr_sum["budgets"] if b["category"] == "Alex's Spending Money")
    jordan_curr = next(b for b in curr_sum["budgets"] if b["category"] == "Jordan's Spending Money")
    assert alex_curr["monthly_limit"] == 225.0
    assert jordan_curr["monthly_limit"] == 175.0

    # Verify next month (e.g. 2026-12) still uses the baseline $200.00 each (current month only!)
    next_sum = client.get("/api/finance/summary?month=2026-12", headers=auth_p1).get_json()
    alex_next = next(b for b in next_sum["budgets"] if b["category"] == "Alex's Spending Money")
    jordan_next = next(b for b in next_sum["budgets"] if b["category"] == "Jordan's Spending Money")
    assert alex_next["monthly_limit"] == 200.0
    assert jordan_next["monthly_limit"] == 200.0


def test_vapid_web_push_dispatch_and_cleanup(client, monkeypatch):
    setup_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Push Test Family",
            "partners": [
                {"name": "Alex", "email": "alex@push.local", "avatar_color": "#6366f1", "password": "Password123!"},
                {"name": "Jordan", "email": "jordan@push.local", "avatar_color": "#ec4899", "password": "Password456!"},
            ],
        },
    )
    assert setup_res.status_code == 201
    p_data = setup_res.get_json()
    p1_id = p_data["partners"][0]["id"]
    p2_id = p_data["partners"][1]["id"]

    auth_p1 = {"Authorization": f"Bearer {p_data['token']}"}
    auth_p2 = {
        "Authorization": f"Bearer {client.post('/api/auth/login', json={'email': 'jordan@push.local', 'password': 'Password456!'}).get_json()['token']}"
    }

    # 1. VAPID public key is generated and returned
    vapid_res = client.get("/api/notifications/vapid-public-key", headers=auth_p1)
    assert vapid_res.status_code == 200
    vapid_data = vapid_res.get_json()
    assert vapid_data["configured"] is True
    assert len(vapid_data["public_key"]) > 40

    # Calling again returns the same persisted public key
    vapid_res2 = client.get("/api/notifications/vapid-public-key", headers=auth_p2)
    assert vapid_res2.get_json()["public_key"] == vapid_data["public_key"]

    # 2. Subscribe an HTTPS push endpoint for Alex
    sub_res = client.post(
        "/api/notifications/push-subscribe",
        headers=auth_p1,
        json={
            "device_label": "Alex iPhone",
            "subscription": {
                "endpoint": "https://web.push.apple.com/sub/alex-iphone-1",
                "keys": {"p256dh": "test-p256dh-key", "auth": "test-auth-key"},
            },
        },
    )
    assert sub_res.status_code == 201
    sub_id = sub_res.get_json()["subscriptions"][0]["id"]

    # 3. Mock pywebpush.webpush to verify payload & tag on notification creation
    sent_calls = []

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims, ttl):
        sent_calls.append({
            "endpoint": subscription_info["endpoint"],
            "data": json.loads(data),
            "sub": vapid_claims["sub"],
            "ttl": ttl,
        })

    import backend.modules.push_service as push_service

    monkeypatch.setattr(push_service, "webpush", fake_webpush)

    req_res = client.post(
        "/api/requests",
        headers=auth_p2,
        json={"title": "Espresso Grinder", "amount": 250.0, "category": "Household"},
    )
    assert req_res.status_code == 201
    assert len(sent_calls) == 1
    assert sent_calls[0]["endpoint"] == "https://web.push.apple.com/sub/alex-iphone-1"
    assert "Espresso Grinder" in sent_calls[0]["data"]["title"]
    assert sent_calls[0]["data"]["link_tab"] == "requests"
    assert sent_calls[0]["data"]["unread_count"] >= 1
    assert sent_calls[0]["data"]["tag"].startswith("request_created-")

    # 4. Expired endpoint (410 Gone) is automatically deactivated
    class FakeResp:
        status_code = 410

    def fake_webpush_gone(*args, **kwargs):
        raise push_service.WebPushException("Gone", response=FakeResp())

    monkeypatch.setattr(push_service, "webpush", fake_webpush_gone)
    test_res = client.post("/api/notifications/push-test", headers=auth_p1)
    assert test_res.status_code == 201

    status_after = client.get("/api/notifications/push-status", headers=auth_p1).get_json()
    assert status_after["subscribed"] is False

    # 5. Re-subscribe and test explicit device delete
    sub_res2 = client.post(
        "/api/notifications/push-subscribe",
        headers=auth_p1,
        json={
            "device_label": "Alex Android",
            "subscription": {
                "endpoint": "https://fcm.googleapis.com/fcm/send/alex-android-1",
                "keys": {"p256dh": "test-p256dh-key-2", "auth": "test-auth-key-2"},
            },
        },
    )
    assert sub_res2.status_code == 201
    del_id = sub_res2.get_json()["subscriptions"][0]["id"]
    del_res = client.delete(f"/api/notifications/push-subscriptions/{del_id}", headers=auth_p1)
    assert del_res.status_code == 200
    assert client.get("/api/notifications/push-status", headers=auth_p1).get_json()["subscribed"] is False


def test_security_audit_webauthn_cryptography_rate_limits_pii_and_plaid_revocation(tmp_path, monkeypatch):
    db_file = tmp_path / "test_hardening.db"
    app = create_app({
        "TESTING": True,
        "DATABASE_PATH": str(db_file),
        "SECRET_KEY": "old-session-secret-key-for-rotation-test",
        "PLAID_ENCRYPTION_KEY": "dedicated-plaid-aes-gcm-master-key-999",
        "PLAID_CLIENT_ID": "test-plaid-client-id",
        "PLAID_SECRET": "test-plaid-secret",
        "PLAID_ENV": "production",
        "APPLE_APP_ID": "ABC12345.com.gibsonfamily.hub",
        "ANDROID_PACKAGE_NAME": "com.gibsonfamily.hub",
        "ANDROID_SHA256_CERT_FINGERPRINT": "AA:BB:CC:DD",
    })

    # 1. Verify PLAID_ENCRYPTION_KEY separation & key-rotation fallback to SECRET_KEY
    with app.app_context():
        from backend.security import _derive_aes_key
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        import secrets as sec

        # Encrypt with dedicated PLAID_ENCRYPTION_KEY
        enc_new = encrypt_plaid_token("access-production-tok-new")
        assert decrypt_plaid_token(enc_new) == "access-production-tok-new"

        # Simulate token previously encrypted with SECRET_KEY before PLAID_ENCRYPTION_KEY was added
        salt = sec.token_bytes(16)
        nonce = sec.token_bytes(12)
        legacy_key = _derive_aes_key("old-session-secret-key-for-rotation-test", salt)
        ct = AESGCM(legacy_key).encrypt(nonce, b"access-production-tok-rotated", None)
        enc_old_key = "enc:v2:" + base64.urlsafe_b64encode(salt + nonce + ct).decode("ascii")
        assert decrypt_plaid_token(enc_old_key) == "access-production-tok-rotated"

    with app.test_client() as client:
        # 2. Verify CSP, COOP, Cross-Domain, and unauthenticated /api/health & /.well-known endpoints
        health_res = client.get("/api/health")
        assert health_res.status_code == 200
        assert "Content-Security-Policy" in health_res.headers
        assert "https://cdn.plaid.com" in health_res.headers["Content-Security-Policy"]
        assert health_res.headers["Cross-Origin-Opener-Policy"] == "same-origin"
        assert health_res.headers["X-Permitted-Cross-Domain-Policies"] == "none"
        health_json = health_res.get_json()
        assert "plaid_env" not in health_json
        assert "plaid_configured" not in health_json

        aasa_res = client.get("/.well-known/apple-app-site-association")
        assert aasa_res.status_code == 200
        assert "ABC12345.com.gibsonfamily.hub" in aasa_res.get_json()["webcredentials"]["apps"]

        assetlinks_res = client.get("/.well-known/assetlinks.json")
        assert assetlinks_res.status_code == 200
        assert assetlinks_res.get_json()[0]["target"]["package_name"] == "com.gibsonfamily.hub"

        # 3. Onboard two partners
        p_res = client.post(
            "/api/auth/partners",
            json={
                "household_name": "Hardened Household",
                "starting_budget_month": "2026-11",
                "partners": [
                    {"name": "Alex Gibson", "email": "alex.secret@gibson.local", "password": "StrongPassword1!"},
                    {"name": "Jordan Gibson", "email": "jordan.secret@gibson.local", "password": "StrongPassword2!"},
                ],
            },
        )
        assert p_res.status_code == 201
        p1_token = p_res.get_json()["token"]
        p1_id = p_res.get_json()["partners"][0]["id"]
        auth_p1 = {"Authorization": f"Bearer {p1_token}"}
        client.post("/api/auth/onboarding/complete", headers=auth_p1, json={"household_name": "Hardened Household"})

        # 4. Verify unauthenticated /api/auth/setup-status masks emails and hides starting_budget_month
        client.delete_cookie(SESSION_COOKIE_NAME)
        unauth_status = client.get("/api/auth/setup-status").get_json()
        assert unauth_status["authenticated"] is False
        assert unauth_status["starting_budget_month"] is None
        for pub_p in unauth_status["partners"]:
            assert "email" not in pub_p
            assert pub_p["masked_email"].endswith("@gibson.local")
            assert "***" in pub_p["masked_email"]

        # 5. Verify sandbox_quick_connect is blocked (403) when PLAID_ENV == 'production'
        sb_res = client.post("/api/finance/plaid/sandbox_quick_connect", headers=auth_p1)
        assert sb_res.status_code == 403
        assert "disabled in the Plaid Production environment" in sb_res.get_json()["error"]

        # 6. Verify WebAuthn rejects forged signatures, invalid origins, and cloned sign_count regressions
        opt_res = client.post("/api/auth/webauthn/register/options", headers=auth_p1, json={"partner_id": p1_id})
        reg_challenge = opt_res.get_json()["challenge"]
        cred_id_raw = b"hardened-cred-001"
        cred_id = _b64url(cred_id_raw)
        att_cbor, sign_fn = _build_test_webauthn_attestation_and_signer(cred_id_raw, rp_id="localhost", sign_count=5)

        # Registration from untrusted origin must be rejected
        bad_origin_cd = _b64url(
            json.dumps({"type": "webauthn.create", "challenge": reg_challenge, "origin": "https://evil-phishing.com"}).encode("utf-8")
        )
        bad_reg = client.post(
            "/api/auth/webauthn/register/verify",
            headers=auth_p1,
            json={
                "partner_id": p1_id,
                "credential": {"id": cred_id, "response": {"clientDataJSON": bad_origin_cd, "attestationObject": _b64url(att_cbor)}},
            },
        )
        assert bad_reg.status_code == 400
        assert "origin mismatch" in bad_reg.get_json()["error"]

        # Valid registration succeeds
        good_reg_cd = _b64url(
            json.dumps({"type": "webauthn.create", "challenge": reg_challenge, "origin": "http://localhost:5173"}).encode("utf-8")
        )
        good_reg = client.post(
            "/api/auth/webauthn/register/verify",
            headers=auth_p1,
            json={
                "partner_id": p1_id,
                "credential": {"id": cred_id, "response": {"clientDataJSON": good_reg_cd, "attestationObject": _b64url(att_cbor)}},
            },
        )
        assert good_reg.status_code == 201

        # Forged signature during authentication must be rejected with 401
        a_opt = client.post("/api/auth/webauthn/authenticate/options", json={"partner_id": p1_id}).get_json()
        a_cd_raw = json.dumps({"type": "webauthn.get", "challenge": a_opt["challenge"], "origin": "http://localhost:5173"}).encode("utf-8")
        a_data_bytes, _ = sign_fn(a_cd_raw, assertion_rp_id="localhost", next_sign_count=6)
        forged_res = client.post(
            "/api/auth/webauthn/authenticate/verify",
            json={
                "credential": {
                    "id": cred_id,
                    "response": {
                        "clientDataJSON": _b64url(a_cd_raw),
                        "authenticatorData": _b64url(a_data_bytes),
                        "signature": _b64url(b"forged-invalid-signature-bytes"),
                    },
                }
            },
        )
        assert forged_res.status_code == 401

        # Sign-count regression (sign_count=4 <= stored 5) must be rejected as a cloned authenticator
        a_opt2 = client.post("/api/auth/webauthn/authenticate/options", json={"partner_id": p1_id}).get_json()
        a_cd_raw2 = json.dumps({"type": "webauthn.get", "challenge": a_opt2["challenge"], "origin": "http://localhost:5173"}).encode("utf-8")
        regressed_auth_data, regressed_sig = sign_fn(a_cd_raw2, assertion_rp_id="localhost", next_sign_count=4)
        cloned_res = client.post(
            "/api/auth/webauthn/authenticate/verify",
            json={
                "credential": {
                    "id": cred_id,
                    "response": {
                        "clientDataJSON": _b64url(a_cd_raw2),
                        "authenticatorData": _b64url(regressed_auth_data),
                        "signature": _b64url(regressed_sig),
                    },
                }
            },
        )
        assert cloned_res.status_code == 401
        assert "counter regression" in cloned_res.get_json()["error"]

        # 7. Verify password change requires current_password and invalidates other active sessions
        second_login = client.post(
            "/api/auth/login",
            json={"email": "alex.secret@gibson.local", "password": "StrongPassword1!"},
        ).get_json()
        second_session_headers = {"Authorization": f"Bearer {second_login['token']}"}

        # Changing password without current_password fails with 401
        no_curr_pw = client.put(
            f"/api/auth/partners/{p1_id}",
            headers=auth_p1,
            json={"name": "Alex Gibson", "password": "NewStrongPassword99!"},
        )
        assert no_curr_pw.status_code == 401

        # Changing password with valid current_password succeeds and revokes second_session_headers
        ok_pw = client.put(
            f"/api/auth/partners/{p1_id}",
            headers=auth_p1,
            json={"name": "Alex Gibson", "current_password": "StrongPassword1!", "password": "NewStrongPassword99!"},
        )
        assert ok_pw.status_code == 200
        assert client.get("/api/finance/summary", headers=second_session_headers).status_code == 401
        assert client.get("/api/finance/summary", headers=auth_p1).status_code == 200

        # 8. Verify /api/auth/unlock-password rate limiting & session revocation after 5 failed attempts
        lock_login = client.post(
            "/api/auth/login",
            json={"email": "alex.secret@gibson.local", "password": "NewStrongPassword99!"},
        ).get_json()
        locked_headers = {"Authorization": f"Bearer {lock_login['token']}"}
        client.post("/api/auth/lock", headers=locked_headers)

        for _ in range(5):
            bad_un = client.post("/api/auth/unlock-password", headers=locked_headers, json={"password": "WrongPassword"})
            assert bad_un.status_code == 401

        # After 5 failed attempts, session was revoked (401) or rate-limited (429)
        sixth_un = client.post("/api/auth/unlock-password", headers=locked_headers, json={"password": "NewStrongPassword99!"})
        assert sixth_un.status_code in (401, 429)

        # 9. Verify reset-all requires password confirmation and revokes Plaid tokens via /item/remove
        with app.app_context():
            db = get_db()
            db.execute(
                "INSERT INTO plaid_items (item_id, access_token, institution_name, linked_by_partner_id) VALUES (?, ?, ?, ?)",
                ("item-sec-1", encrypt_plaid_token("access-production-token-to-revoke"), "Chase", p1_id),
            )
            db.commit()

        removed_plaid_tokens = []

        class FakePlaidRemoveResp:
            status_code = 200
            def json(self):
                return {"removed": True}

        def fake_requests_post(url, json=None, timeout=10):
            if url.endswith("/item/remove"):
                removed_plaid_tokens.append(json.get("access_token"))
            return FakePlaidRemoveResp()

        import backend.modules.auth_webauthn as auth_mod
        monkeypatch.setattr(auth_mod.requests, "post", fake_requests_post)

        # Calling reset-all without password fails with 401
        bad_reset = client.post("/api/auth/reset-all", headers=auth_p1, json={})
        assert bad_reset.status_code == 401
        assert len(removed_plaid_tokens) == 0

        # Calling reset-all with valid password revokes Plaid access_token and resets workspace
        good_reset = client.post("/api/auth/reset-all", headers=auth_p1, json={"password": "NewStrongPassword99!"})
        assert good_reset.status_code == 200
        assert removed_plaid_tokens == ["access-production-token-to-revoke"]


def test_account_ownership_categorization_notifications(app_instance, client):
    from datetime import date
    from unittest.mock import MagicMock, patch

    setup = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex.acct@test.local", "password": "Password123!"},
                {"name": "Jordan", "email": "jordan.acct@test.local", "password": "Password123!"},
            ],
        },
    ).get_json()
    alex_id = setup["partners"][0]["id"]
    jordan_id = setup["partners"][1]["id"]
    h_alex = {"Authorization": f"Bearer {setup['token']}"}
    jordan_login = client.post(
        "/api/auth/login",
        json={"email": "jordan.acct@test.local", "password": "Password123!"},
    ).get_json()
    h_jordan = {"Authorization": f"Bearer {jordan_login['token']}"}

    # Create 2 accounts: one attached to Alex, one attached to Both (shared)
    acc_alex = client.post(
        "/api/finance/accounts",
        headers=h_alex,
        json={"name": "Alex Card", "owner_partner_id": alex_id, "owner_scope": "individual", "notify_on_tx": True},
    ).get_json()
    acc_both = client.post(
        "/api/finance/accounts",
        headers=h_alex,
        json={"name": "Joint Checking", "owner_partner_id": None, "owner_scope": "shared", "notify_on_tx": True},
    ).get_json()

    today_str = date.today().isoformat()
    # Uncategorized transaction on Alex's account -> only Alex notified
    client.post(
        "/api/finance/transactions",
        headers=h_alex,
        json={
            "account_id": acc_alex["id"],
            "name": "Corner Market",
            "amount": 18.50,
            "date": today_str,
            "category": "General",
        },
    )
    alex_notifs = client.get("/api/notifications", headers=h_alex).get_json()["notifications"]
    jordan_notifs = client.get("/api/notifications", headers=h_jordan).get_json()["notifications"]
    assert any(n["notif_type"] == "tx_categorize" and "Corner Market" in n["title"] for n in alex_notifs)
    assert not any(n["notif_type"] == "tx_categorize" and "Corner Market" in n["title"] for n in jordan_notifs)

    # New transaction on Joint Checking (Both) via Plaid sync -> BOTH Alex & Jordan notified
    with app_instance.app_context():
        from backend.database import get_db
        from backend.modules.finance import _sync_plaid_accounts_and_transactions

        db = get_db()
        db.execute("UPDATE accounts SET plaid_account_id = 'plaid_joint_1' WHERE id = ?", (acc_both["id"],))
        db.commit()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.side_effect = [
            {"accounts": [{"account_id": "plaid_joint_1", "name": "Joint Checking", "type": "depository", "subtype": "checking", "mask": "1111", "balances": {"current": 1000.0}}]},
            {
                "added": [
                    {
                        "transaction_id": "plaid_tx_joint_new_1",
                        "account_id": "plaid_joint_1",
                        "amount": 42.75,
                        "date": today_str,
                        "name": "Target Store",
                        "merchant_name": "Target",
                        "pending": False,
                    }
                ],
                "modified": [],
                "removed": [],
                "has_more": False,
                "next_cursor": "cur_1",
            },
        ]
        with patch("backend.modules.finance.requests.post", return_value=mock_resp):
            _sync_plaid_accounts_and_transactions("tok_test", "Bank", alex_id, "item_joint")

    alex_notifs2 = client.get("/api/notifications", headers=h_alex).get_json()["notifications"]
    jordan_notifs2 = client.get("/api/notifications", headers=h_jordan).get_json()["notifications"]
    assert any(n["notif_type"] == "tx_categorize" and "Target" in n["title"] for n in alex_notifs2)
    assert any(n["notif_type"] == "tx_categorize" and "Target" in n["title"] for n in jordan_notifs2)

    # Disable alerts on Joint Checking -> no notification on next uncategorized tx
    client.put(f"/api/finance/accounts/{acc_both['id']}", headers=h_alex, json={"notify_on_tx": False})
    client.post(
        "/api/finance/transactions",
        headers=h_alex,
        json={"account_id": acc_both["id"], "name": "Silent Cafe", "amount": 9.0, "date": today_str, "category": "General"},
    )
    alex_notifs3 = client.get("/api/notifications", headers=h_alex).get_json()["notifications"]
    assert not any("Silent Cafe" in n["title"] for n in alex_notifs3)


def test_admin_planning_projects_shopping_notes_and_standalone_todos(client):
    setup = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex.plan@test.local", "password": "Password123!"},
                {"name": "Jordan", "email": "jordan.plan@test.local", "password": "Password123!"},
            ],
        },
    ).get_json()
    headers = {"Authorization": f"Bearer {setup['token']}"}
    alex_id = setup["partners"][0]["id"]

    # 1. Create Christmas Project with shopping list, to-dos, and note
    proj_res = client.post(
        "/api/hub/projects",
        headers=headers,
        json={
            "title": "Christmas Project",
            "description": "Holiday prep",
            "shopping_items": [
                {"name": "Decorations", "quantity": "2", "estimated_price": 45.0},
                {"name": "Wrapping paper", "quantity": "3", "estimated_price": 15.0},
            ],
            "todos": [
                {"title": "Put up decorations", "assigned_to": alex_id},
                {"title": "Set up tree", "assigned_to": alex_id},
            ],
            "notes": [{"title": "Dinner Menu", "content": "Roast, potatoes, pie"}],
        },
    )
    assert proj_res.status_code == 201
    proj = proj_res.get_json()
    assert proj["title"] == "Christmas Project"
    assert len(proj["shopping_items"]) == 2
    assert proj["shopping_total"] == 60.0
    assert len(proj["todos"]) == 2
    assert len(proj["notes"]) == 1

    # 2. Toggle shopping item & edit note
    item_id = proj["shopping_items"][0]["id"]
    toggled = client.put(f"/api/hub/projects/shopping/{item_id}/toggle", headers=headers).get_json()
    assert toggled["purchased"] == 1

    note_id = proj["notes"][0]["id"]
    updated_note = client.put(
        f"/api/hub/projects/notes/{note_id}",
        headers=headers,
        json={"title": "Dinner Menu", "content": "Ham, potatoes, apple pie"},
    ).get_json()
    assert "apple pie" in updated_note["content"]

    # 3. Create standalone to-do outside of any project
    standalone_res = client.post(
        "/api/hub/todos",
        headers=headers,
        json={"title": "Call dentist", "category": "Household", "assigned_to": alex_id},
    )
    assert standalone_res.status_code == 201
    assert standalone_res.get_json()["project_id"] is None

    standalone_only = client.get("/api/hub/todos?scope=standalone", headers=headers).get_json()["todos"]
    all_todos = client.get("/api/hub/todos?scope=all", headers=headers).get_json()["todos"]
    assert len(standalone_only) == 1
    assert standalone_only[0]["title"] == "Call dentist"
    assert len(all_todos) == 3


def test_recurring_tasks_day_assignments_and_notifications(app_instance, client):
    from datetime import datetime, timezone

    setup = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson",
            "partners": [
                {"name": "Alex", "email": "alex.rec@test.local", "password": "Password123!"},
                {"name": "Jordan", "email": "jordan.rec@test.local", "password": "Password123!"},
            ],
        },
    ).get_json()
    alex_id = setup["partners"][0]["id"]
    jordan_id = setup["partners"][1]["id"]
    h_alex = {"Authorization": f"Bearer {setup['token']}"}
    jordan_login = client.post(
        "/api/auth/login",
        json={"email": "jordan.rec@test.local", "password": "Password123!"},
    ).get_json()
    h_jordan = {"Authorization": f"Bearer {jordan_login['token']}"}

    # Create nightly "Reset the House" with day-by-day partner assignment
    create_res = client.post(
        "/api/hub/recurring-tasks",
        headers=h_alex,
        json={
            "title": "Reset the House",
            "description": "Nightly reset",
            "checklist_items": ["Start the dishwasher", "Pick up the living room"],
            "days_of_week": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "day_assignments": {
                "mon": str(alex_id),
                "tue": str(jordan_id),
                "wed": "both",
                "thu": str(alex_id),
                "fri": str(jordan_id),
                "sat": "both",
                "sun": "both",
            },
            "notify_enabled": True,
            "notify_time": "20:00",
            "timezone_offset_minutes": 0,
        },
    )
    assert create_res.status_code == 201
    task = create_res.get_json()
    assert task["title"] == "Reset the House"
    assert len(task["checklist_items"]) == 2

    with app_instance.app_context():
        from backend.database import get_db
        from backend.modules.couples_hub import check_and_dispatch_recurring_notifications

        db = get_db()
        # Monday 2026-11-23 at 20:05 UTC -> Alex only
        mon_dt = datetime(2026, 11, 23, 20, 5, tzinfo=timezone.utc)
        sent_mon = check_and_dispatch_recurring_notifications(db, now_utc=mon_dt)
        assert sent_mon == 1

        # Tuesday 2026-11-24 at 20:05 UTC -> Jordan only
        tue_dt = datetime(2026, 11, 24, 20, 5, tzinfo=timezone.utc)
        sent_tue = check_and_dispatch_recurring_notifications(db, now_utc=tue_dt)
        assert sent_tue == 1

        # Wednesday 2026-11-25 at 20:05 UTC -> Both (2 notifications)
        wed_dt = datetime(2026, 11, 25, 20, 5, tzinfo=timezone.utc)
        sent_wed = check_and_dispatch_recurring_notifications(db, now_utc=wed_dt)
        assert sent_wed == 2

    alex_notifs = [n for n in client.get("/api/notifications", headers=h_alex).get_json()["notifications"] if n["notif_type"] == "recurring_task"]
    jordan_notifs = [n for n in client.get("/api/notifications", headers=h_jordan).get_json()["notifications"] if n["notif_type"] == "recurring_task"]
    assert len(alex_notifs) == 2  # Mon + Wed
    assert len(jordan_notifs) == 2  # Tue + Wed

    # Complete task for Thursday 2026-11-26 before 20:00 -> should not notify
    comp_res = client.post(
        f"/api/hub/recurring-tasks/{task['id']}/complete",
        headers=h_alex,
        json={"occurrence_date": "2026-11-26", "completed": True, "checked_steps": [0, 1]},
    )
    assert comp_res.status_code == 200
    with app_instance.app_context():
        from backend.database import get_db
        from backend.modules.couples_hub import check_and_dispatch_recurring_notifications

        thu_dt = datetime(2026, 11, 26, 20, 5, tzinfo=timezone.utc)
        assert check_and_dispatch_recurring_notifications(get_db(), now_utc=thu_dt) == 0



















