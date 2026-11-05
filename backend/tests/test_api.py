import base64
import json
import pytest
from backend.app import create_app


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


@pytest.fixture()
def client(tmp_path):
    db_file = tmp_path / "test_gibson.db"
    app = create_app({"TESTING": True, "DATABASE_PATH": str(db_file)})
    with app.test_client() as c:
        yield c


def test_clean_initial_state_and_plaid_env(client):
    # Fresh database should have 0 pre-populated test data and onboarding_completed == False
    setup_res = client.get("/api/auth/setup-status")
    assert setup_res.status_code == 200
    setup_data = setup_res.get_json()
    assert setup_data["onboarding_completed"] is False
    assert setup_data["partners"] == []

    # Verify no fake accounts, requests, or transactions exist on first launch
    fin_res = client.get("/api/finance/summary")
    fin_data = fin_res.get_json()
    assert fin_data["accounts"] == []
    assert fin_data["transactions"] == []
    assert fin_data["budgets"] == []

    req_res = client.get("/api/requests")
    assert req_res.get_json()["requests"] == []

    # Plaid credentials should be loaded from .env
    plaid_res = client.get("/api/finance/plaid/status")
    assert plaid_res.status_code == 200
    assert plaid_res.get_json()["configured"] is True


def test_end_to_end_onboarding_webauthn_and_requests(client):
    # Step 1: Create both partner profiles during onboarding
    p_res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Family",
            "partners": [
                {"name": "Alex Gibson", "email": "alex@gibson.local", "avatar_color": "#6366f1", "monthly_fun_allowance": 250},
                {"name": "Jordan Gibson", "email": "jordan@gibson.local", "avatar_color": "#ec4899", "monthly_fun_allowance": 250},
            ],
        },
    )
    assert p_res.status_code == 201
    partners = p_res.get_json()["partners"]
    assert len(partners) == 2
    p1_id = partners[0]["id"]
    p2_id = partners[1]["id"]

    # Step 2: Register WebAuthn Passkey for Partner 1
    opt_res = client.post("/api/auth/webauthn/register/options", json={"partner_id": p1_id})
    assert opt_res.status_code == 200
    challenge = opt_res.get_json()["challenge"]

    client_data_json = _b64url(
        json.dumps({
            "type": "webauthn.create",
            "challenge": challenge,
            "origin": "http://localhost:5173",
        }).encode("utf-8")
    )
    fake_attestation = _b64url(b"cbor-attestation-bytes-123456")
    cred_id = _b64url(b"gibson-passkey-cred-001")

    ver_res = client.post(
        "/api/auth/webauthn/register/verify",
        json={
            "partner_id": p1_id,
            "device_name": "Alex Windows Hello",
            "credential": {
                "id": cred_id,
                "rawId": cred_id,
                "response": {
                    "clientDataJSON": client_data_json,
                    "attestationObject": fake_attestation,
                },
                "transports": ["internal"],
            },
        },
    )
    assert ver_res.status_code == 201
    assert ver_res.get_json()["verified"] is True

    # Verify screen unlock via WebAuthn Passkey
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
    assert unlock_res.get_json()["unlocked"] is True

    # Step 3 & 4: Complete onboarding with initial budgets and module selection
    comp_res = client.post(
        "/api/auth/onboarding/complete",
        json={
            "household_name": "Gibson Family",
            "budgets": [
                {"category": "Groceries & Dining", "monthly_limit": 850},
                {"category": "Entertainment & Gaming", "monthly_limit": 300},
            ],
            "enabled_modules": {"requests": True, "finance": True, "future_plans": True},
        },
    )
    assert comp_res.status_code == 200
    assert comp_res.get_json()["onboarding_completed"] is True

    # Partner 2 submits a purchase request to Partner 1
    create_res = client.post(
        "/api/requests",
        json={
            "requester_id": p2_id,
            "reviewer_id": p1_id,
            "title": "New Game Console",
            "description": "Living room co-op console",
            "category": "Entertainment & Gaming",
            "amount": 600.0,
            "priority": "medium",
            "initial_comment": "Can we budget for this over 3 months?",
        },
    )
    assert create_res.status_code == 201
    req_id = create_res.get_json()["id"]

    # Partner 1 sets up a budget & timeline ($200/mo, $200 initial saved)
    decide_res = client.post(
        f"/api/requests/{req_id}/decision",
        json={
            "partner_id": p1_id,
            "status": "budget_planned",
            "decision_notes": "Let's save $200/mo!",
            "proposed_monthly_contribution": 200.0,
            "proposed_target_date": "2027-02-01",
            "saved_amount": 200.0,
        },
    )
    assert decide_res.status_code == 200
    decided = decide_res.get_json()
    assert decided["status"] == "budget_planned"
    assert decided["timeline"]["remaining_amount"] == 400.0
    assert decided["timeline"]["months_to_goal"] == 2

    # Verify linked Future Purchase plan was created
    fp_res = client.get("/api/future-purchases")
    plans = fp_res.get_json()["future_purchases"]
    assert len(plans) == 1
    assert plans[0]["linked_request_id"] == req_id
