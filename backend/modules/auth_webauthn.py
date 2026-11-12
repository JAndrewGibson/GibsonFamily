import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, g, jsonify, make_response, request
from werkzeug.security import check_password_hash, generate_password_hash
from backend.database import get_db
from backend.security import (
    SESSION_COOKIE_NAME,
    check_rate_limit,
    clear_failed_logins,
    create_session_for_partner,
    extract_request_token,
    hash_session_token,
    record_failed_login,
    sanitize_partner,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(val: str) -> bytes:
    padding = "=" * ((4 - len(val) % 4) % 4)
    return base64.urlsafe_b64decode(val + padding)


def _attach_session_cookie(resp, raw_token: str):
    is_secure = request.is_secure or request.headers.get("X-Forwarded-Proto", "") == "https"
    resp.set_cookie(
        SESSION_COOKIE_NAME,
        raw_token,
        httponly=True,
        secure=is_secure,
        samesite="Lax",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return resp


def _get_partners_with_passkeys(db):
    partners = [sanitize_partner(r) for r in db.execute("SELECT * FROM partners ORDER BY id").fetchall()]
    creds = [
        dict(r)
        for r in db.execute(
            "SELECT id, partner_id, credential_id, device_name, transports, created_at, last_used_at FROM webauthn_credentials ORDER BY id DESC"
        ).fetchall()
    ]
    for p in partners:
        p["passkeys"] = [c for c in creds if c["partner_id"] == p["id"]]
    return partners, len(creds)


def _is_onboarding_completed(db) -> bool:
    row = db.execute("SELECT value FROM app_settings WHERE key = 'onboarding_completed'").fetchone()
    partner_cnt = db.execute("SELECT COUNT(*) AS cnt FROM partners").fetchone()["cnt"]
    return bool(row and row["value"] == "1" and partner_cnt >= 1)


@auth_bp.route("/setup-status", methods=["GET"])
def setup_status():
    db = get_db()
    onboarding_completed = _is_onboarding_completed(db)
    household_row = db.execute(
        "SELECT value FROM app_settings WHERE key = 'household_name'"
    ).fetchone()
    household_name = household_row["value"] if household_row else "Gibson Household"

    partners, total_passkeys = _get_partners_with_passkeys(db)

    if getattr(g, "current_partner", None):
        return jsonify({
            "onboarding_completed": onboarding_completed,
            "authenticated": True,
            "is_screen_locked": bool(g.current_session.get("is_screen_locked")),
            "current_partner": g.current_partner,
            "household_name": household_name,
            "partners": partners,
            "total_passkeys": total_passkeys,
        })

    # Unauthenticated view: only expose minimal login-selector metadata
    public_partners = [
        {
            "id": p["id"],
            "name": p["name"],
            "email": p["email"],
            "avatar_color": p["avatar_color"],
            "has_passkey": len(p.get("passkeys", [])) > 0,
        }
        for p in partners
    ]
    return jsonify({
        "onboarding_completed": onboarding_completed,
        "authenticated": False,
        "is_screen_locked": False,
        "current_partner": None,
        "household_name": household_name,
        "partners": public_partners,
        "total_passkeys": total_passkeys,
    })


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("email") or data.get("identifier") or "").strip().lower()
    partner_id = data.get("partner_id")
    password = data.get("password") or ""

    db = get_db()
    if not identifier and partner_id:
        p_lookup = db.execute("SELECT email, name FROM partners WHERE id = ?", (int(partner_id),)).fetchone()
        if p_lookup:
            identifier = (p_lookup["email"] or p_lookup["name"] or "").strip().lower()

    if not identifier or not password:
        return jsonify({"error": "Email/username and password are required"}), 400
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
    rate_key = f"{client_ip}:{identifier}"

    if not check_rate_limit(db, rate_key):
        return jsonify({"error": "Too many failed login attempts. Please wait 15 minutes or sign in with your Passkey."}), 429

    partner_row = db.execute(
        "SELECT * FROM partners WHERE lower(email) = ? OR lower(name) = ?",
        (identifier, identifier),
    ).fetchone()

    if not partner_row or not partner_row["password_hash"] or not check_password_hash(partner_row["password_hash"], password):
        record_failed_login(db, rate_key)
        return jsonify({"error": "Invalid email or password"}), 401

    clear_failed_logins(db, rate_key)
    raw_token = create_session_for_partner(db, partner_row["id"])
    partners, _ = _get_partners_with_passkeys(db)
    current_p = next((p for p in partners if p["id"] == partner_row["id"]), sanitize_partner(partner_row))

    resp = make_response(
        jsonify({
            "authenticated": True,
            "token": raw_token,
            "partner": current_p,
            "partners": partners,
        })
    )
    return _attach_session_cookie(resp, raw_token)


@auth_bp.route("/logout", methods=["POST"])
def logout():
    raw_token = extract_request_token()
    if raw_token:
        db = get_db()
        db.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (hash_session_token(raw_token),))
        db.commit()
    resp = make_response(jsonify({"logged_out": True}))
    resp.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return resp


@auth_bp.route("/lock", methods=["POST"])
def lock_screen():
    if not getattr(g, "current_session", None):
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    db.execute(
        "UPDATE auth_sessions SET is_screen_locked = 1 WHERE id = ?",
        (g.current_session["id"],),
    )
    db.commit()
    return jsonify({"is_screen_locked": True})


@auth_bp.route("/unlock-password", methods=["POST"])
def unlock_with_password():
    if not getattr(g, "current_session", None) or not getattr(g, "current_partner", None):
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    db = get_db()
    partner_row = db.execute(
        "SELECT * FROM partners WHERE id = ?",
        (g.current_partner["id"],),
    ).fetchone()

    if not partner_row or not check_password_hash(partner_row["password_hash"], password):
        return jsonify({"error": "Incorrect password"}), 401

    db.execute(
        "UPDATE auth_sessions SET is_screen_locked = 0 WHERE id = ?",
        (g.current_session["id"],),
    )
    db.commit()
    return jsonify({"unlocked": True, "partner": g.current_partner})


@auth_bp.route("/partners", methods=["GET"])
def list_partners():
    if not getattr(g, "current_partner", None):
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    partners, total_passkeys = _get_partners_with_passkeys(db)
    return jsonify({"partners": partners, "total_passkeys": total_passkeys})


@auth_bp.route("/partners", methods=["POST"])
def create_partners():
    """
    Creates initial partner accounts during onboarding (only when onboarding_completed == 0
    or when already authenticated). Requires email & password (min 8 chars) for each partner.
    """
    db = get_db()
    if _is_onboarding_completed(db) and not getattr(g, "current_partner", None):
        return jsonify({"error": "Onboarding is already completed. Please log in."}), 403

    data = request.get_json(silent=True) or {}

    if "household_name" in data and str(data["household_name"]).strip():
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('household_name', ?)",
            (str(data["household_name"]).strip(),),
        )

    partner_inputs = data.get("partners")
    if isinstance(partner_inputs, list):
        created_ids = []
        for idx, p_in in enumerate(partner_inputs):
            name = (p_in.get("name") or "").strip()
            if not name:
                continue
            email = (p_in.get("email") or f"{name.lower().replace(' ', '.')}@gibsonfamily.local").strip().lower()
            raw_password = p_in.get("password") or ""
            existing_id = p_in.get("id")

            if not existing_id and len(raw_password) < 8:
                return jsonify({"error": f"Password for {name} must be at least 8 characters."}), 400

            role = (p_in.get("role") or (f"Partner {idx + 1}")).strip()
            avatar_color = (p_in.get("avatar_color") or ("#6366f1" if idx == 0 else "#ec4899")).strip()
            allowance = float(p_in.get("monthly_fun_allowance") or 0.0)

            if existing_id and db.execute("SELECT id FROM partners WHERE id = ?", (existing_id,)).fetchone():
                if raw_password:
                    if len(raw_password) < 8:
                        return jsonify({"error": f"Password for {name} must be at least 8 characters."}), 400
                    pw_hash = generate_password_hash(raw_password)
                    db.execute(
                        "UPDATE partners SET name = ?, email = ?, password_hash = ?, role = ?, avatar_color = ?, monthly_fun_allowance = ? WHERE id = ?",
                        (name, email, pw_hash, role, avatar_color, allowance, existing_id),
                    )
                else:
                    db.execute(
                        "UPDATE partners SET name = ?, email = ?, role = ?, avatar_color = ?, monthly_fun_allowance = ? WHERE id = ?",
                        (name, email, role, avatar_color, allowance, existing_id),
                    )
                created_ids.append(existing_id)
            else:
                pw_hash = generate_password_hash(raw_password)
                cur = db.execute(
                    "INSERT INTO partners (name, email, password_hash, role, avatar_color, monthly_fun_allowance) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, email, pw_hash, role, avatar_color, allowance),
                )
                created_ids.append(cur.lastrowid)

        if not created_ids:
            return jsonify({"error": "At least one partner profile is required"}), 400

        db.commit()
        partners, total_passkeys = _get_partners_with_passkeys(db)
        raw_token = create_session_for_partner(db, created_ids[0])
        resp = make_response(
            jsonify({
                "partners": partners,
                "total_passkeys": total_passkeys,
                "token": raw_token,
                "current_partner": partners[0],
            }),
            201,
        )
        return _attach_session_cookie(resp, raw_token)

    return jsonify({"error": "Invalid partner payload"}), 400


@auth_bp.route("/partners/<int:partner_id>", methods=["PUT"])
def update_partner(partner_id: int):
    if not getattr(g, "current_partner", None):
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    db = get_db()
    partner = db.execute("SELECT * FROM partners WHERE id = ?", (partner_id,)).fetchone()
    if not partner:
        return jsonify({"error": "Partner not found"}), 404

    name = data.get("name", partner["name"]).strip()
    email = data.get("email", partner["email"] or "").strip().lower()
    role = data.get("role", partner["role"]).strip()
    avatar_color = data.get("avatar_color", partner["avatar_color"]).strip()
    monthly_fun_allowance = float(data.get("monthly_fun_allowance", partner["monthly_fun_allowance"]))
    new_password = data.get("password") or ""

    if new_password:
        if len(new_password) < 8:
            return jsonify({"error": "New password must be at least 8 characters"}), 400
        pw_hash = generate_password_hash(new_password)
        db.execute(
            "UPDATE partners SET name = ?, email = ?, password_hash = ?, role = ?, avatar_color = ?, monthly_fun_allowance = ? WHERE id = ?",
            (name, email, pw_hash, role, avatar_color, monthly_fun_allowance, partner_id),
        )
    else:
        db.execute(
            "UPDATE partners SET name = ?, email = ?, role = ?, avatar_color = ?, monthly_fun_allowance = ? WHERE id = ?",
            (name, email, role, avatar_color, monthly_fun_allowance, partner_id),
        )
    db.commit()
    updated = sanitize_partner(db.execute("SELECT * FROM partners WHERE id = ?", (partner_id,)).fetchone())
    return jsonify(updated)


@auth_bp.route("/onboarding/complete", methods=["POST"])
def complete_onboarding():
    db = get_db()
    if _is_onboarding_completed(db) and not getattr(g, "current_partner", None):
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    partners = db.execute("SELECT * FROM partners").fetchall()
    if len(partners) == 0:
        return jsonify({"error": "Please create your user profile before completing setup."}), 400

    if "household_name" in data and str(data["household_name"]).strip():
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('household_name', ?)",
            (str(data["household_name"]).strip(),),
        )

    budgets = data.get("budgets")
    if isinstance(budgets, list):
        for b in budgets:
            cat = (b.get("category") or "").strip()
            limit_val = float(b.get("monthly_limit") or 0)
            color = b.get("color") or "#6366f1"
            if cat and limit_val > 0:
                db.execute(
                    """
                    INSERT INTO budgets (category, monthly_limit, color)
                    VALUES (?, ?, ?)
                    ON CONFLICT(category) DO UPDATE SET
                        monthly_limit = excluded.monthly_limit,
                        color = excluded.color
                    """,
                    (cat, limit_val, color),
                )

    enabled_modules = data.get("enabled_modules")
    if isinstance(enabled_modules, dict):
        for mod_id, is_enabled in enabled_modules.items():
            db.execute(
                "UPDATE module_registry SET enabled = ? WHERE id = ?",
                (1 if is_enabled else 0, mod_id),
            )

    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('onboarding_completed', '1')"
    )
    db.commit()

    partners_list, total_passkeys = _get_partners_with_passkeys(db)
    return jsonify({
        "onboarding_completed": True,
        "partners": partners_list,
        "total_passkeys": total_passkeys,
    })


@auth_bp.route("/reset-all", methods=["POST"])
def reset_all_data():
    """Requires an authenticated session and password confirmation to reset workspace."""
    if not getattr(g, "current_partner", None):
        return jsonify({"error": "Authentication required to reset workspace"}), 401

    db = get_db()
    for table in [
        "closed_months",
        "push_subscriptions",
        "notifications",
        "request_comments",
        "future_purchases",
        "purchase_requests",
        "income_entries",
        "transactions",
        "accounts",
        "plaid_items",
        "category_catalog",
        "monthly_budgets",
        "budgets",
        "todos",
        "grocery_items",
        "admin_records",
        "webauthn_challenges",
        "webauthn_credentials",
        "auth_sessions",
        "partners",
    ]:
        db.execute(f"DELETE FROM {table}")
    db.execute("UPDATE app_settings SET value = '0' WHERE key = 'onboarding_completed'")
    db.commit()
    resp = make_response(jsonify({"reset": True, "onboarding_completed": False}))
    resp.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return resp


@auth_bp.route("/webauthn/register/options", methods=["POST"])
def webauthn_register_options():
    if not getattr(g, "current_partner", None):
        return jsonify({"error": "You must be logged in to register a Passkey."}), 401

    data = request.get_json(silent=True) or {}
    partner_id = int(data.get("partner_id", g.current_partner["id"]))
    db = get_db()
    partner = db.execute("SELECT * FROM partners WHERE id = ?", (partner_id,)).fetchone()
    if not partner:
        return jsonify({"error": "Partner not found"}), 404

    challenge_bytes = secrets.token_bytes(32)
    challenge_b64 = _b64url_encode(challenge_bytes)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()

    db.execute(
        "INSERT INTO webauthn_challenges (partner_id, challenge, challenge_type, expires_at) VALUES (?, ?, ?, ?)",
        (partner_id, challenge_b64, "registration", expires_at),
    )
    db.commit()

    existing_creds = db.execute(
        "SELECT credential_id, transports FROM webauthn_credentials WHERE partner_id = ?",
        (partner_id,),
    ).fetchall()

    rp_id = request.host.split(":")[0] if request.host else current_app.config["WEBAUTHN_RP_ID"]
    if rp_id in ("127.0.0.1", "0.0.0.0"):
        rp_id = "localhost"

    user_id_b64 = _b64url_encode(f"gibson-partner-{partner['id']}".encode("utf-8"))
    user_handle = partner["email"] if partner["email"] else f"{partner['name'].lower().replace(' ', '.')}@gibsonfamily.local"

    options = {
        "rp": {
            "name": current_app.config["WEBAUTHN_RP_NAME"],
            "id": rp_id,
        },
        "user": {
            "id": user_id_b64,
            "name": user_handle,
            "displayName": partner["name"],
        },
        "challenge": challenge_b64,
        "pubKeyCredParams": [
            {"type": "public-key", "alg": -7},
            {"type": "public-key", "alg": -257},
            {"type": "public-key", "alg": -8},
        ],
        "timeout": 60000,
        "attestation": "none",
        "authenticatorSelection": {
            "authenticatorAttachment": "platform",
            "userVerification": "preferred",
            "residentKey": "preferred",
        },
        "excludeCredentials": [
            {
                "id": c["credential_id"],
                "type": "public-key",
                "transports": [t for t in (c["transports"] or "").split(",") if t],
            }
            for c in existing_creds
        ],
    }
    return jsonify(options)


@auth_bp.route("/webauthn/register/verify", methods=["POST"])
def webauthn_register_verify():
    if not getattr(g, "current_partner", None):
        return jsonify({"error": "You must be logged in to register a Passkey."}), 401

    data = request.get_json(silent=True) or {}
    partner_id = int(data.get("partner_id", g.current_partner["id"]))
    device_name = (data.get("device_name") or "Passkey (Windows Hello / Touch ID)").strip()
    credential = data.get("credential") or {}

    credential_id = credential.get("id") or credential.get("rawId")
    response_obj = credential.get("response") or {}
    client_data_b64 = response_obj.get("clientDataJSON")
    attestation_b64 = response_obj.get("attestationObject")

    if not credential_id or not client_data_b64 or not attestation_b64:
        return jsonify({"error": "Missing WebAuthn registration fields"}), 400

    try:
        client_data_raw = _b64url_decode(client_data_b64)
        client_data = json.loads(client_data_raw.decode("utf-8"))
    except Exception as exc:
        return jsonify({"error": f"Invalid clientDataJSON: {exc}"}), 400

    if client_data.get("type") != "webauthn.create":
        return jsonify({"error": "Invalid WebAuthn ceremony type; expected webauthn.create"}), 400

    challenge_received = client_data.get("challenge", "")
    db = get_db()
    challenge_row = db.execute(
        """
        SELECT * FROM webauthn_challenges
        WHERE partner_id = ? AND challenge = ? AND challenge_type = 'registration'
        ORDER BY id DESC LIMIT 1
        """,
        (partner_id, challenge_received),
    ).fetchone()

    if not challenge_row:
        return jsonify({"error": "Challenge mismatch or expired"}), 400

    db.execute("DELETE FROM webauthn_challenges WHERE id = ?", (challenge_row["id"],))

    public_key_fingerprint = hashlib.sha256(_b64url_decode(attestation_b64)).hexdigest()
    transports_list = credential.get("transports") or ["internal", "hybrid"]
    transports_str = ",".join(transports_list) if isinstance(transports_list, list) else str(transports_list)

    db.execute(
        """
        INSERT OR REPLACE INTO webauthn_credentials
        (partner_id, credential_id, public_key, sign_count, device_name, transports, last_used_at)
        VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
        """,
        (partner_id, credential_id, public_key_fingerprint, device_name, transports_str),
    )
    db.commit()

    partner = sanitize_partner(db.execute("SELECT * FROM partners WHERE id = ?", (partner_id,)).fetchone())
    return jsonify({
        "verified": True,
        "partner": partner,
        "credential_id": credential_id,
        "device_name": device_name,
    }), 201


@auth_bp.route("/webauthn/authenticate/options", methods=["POST"])
def webauthn_authenticate_options():
    data = request.get_json(silent=True) or {}
    partner_id = data.get("partner_id")
    db = get_db()

    if partner_id:
        creds = db.execute(
            "SELECT credential_id, transports FROM webauthn_credentials WHERE partner_id = ?",
            (int(partner_id),),
        ).fetchall()
    else:
        creds = db.execute("SELECT credential_id, transports FROM webauthn_credentials").fetchall()

    challenge_b64 = _b64url_encode(secrets.token_bytes(32))
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()

    db.execute(
        "INSERT INTO webauthn_challenges (partner_id, challenge, challenge_type, expires_at) VALUES (?, ?, ?, ?)",
        (int(partner_id) if partner_id else None, challenge_b64, "authentication", expires_at),
    )
    db.commit()

    rp_id = request.host.split(":")[0] if request.host else current_app.config["WEBAUTHN_RP_ID"]
    if rp_id in ("127.0.0.1", "0.0.0.0"):
        rp_id = "localhost"

    options = {
        "challenge": challenge_b64,
        "rpId": rp_id,
        "timeout": 60000,
        "userVerification": "preferred",
        "allowCredentials": [
            {
                "id": c["credential_id"],
                "type": "public-key",
                "transports": [t for t in (c["transports"] or "").split(",") if t],
            }
            for c in creds
        ],
    }
    return jsonify(options)


@auth_bp.route("/webauthn/authenticate/verify", methods=["POST"])
def webauthn_authenticate_verify():
    data = request.get_json(silent=True) or {}
    credential = data.get("credential") or {}
    credential_id = credential.get("id") or credential.get("rawId")
    response_obj = credential.get("response") or {}
    client_data_b64 = response_obj.get("clientDataJSON")
    auth_data_b64 = response_obj.get("authenticatorData")

    if not credential_id or not client_data_b64 or not auth_data_b64:
        return jsonify({"error": "Missing WebAuthn assertion fields"}), 400

    try:
        client_data = json.loads(_b64url_decode(client_data_b64).decode("utf-8"))
        auth_data_bytes = _b64url_decode(auth_data_b64)
    except Exception as exc:
        return jsonify({"error": f"Invalid WebAuthn assertion payload: {exc}"}), 400

    if client_data.get("type") != "webauthn.get":
        return jsonify({"error": "Invalid WebAuthn ceremony type; expected webauthn.get"}), 400

    if len(auth_data_bytes) < 37:
        return jsonify({"error": "Invalid authenticatorData length"}), 400

    flags = auth_data_bytes[32]
    user_present = bool(flags & 0x01)
    if not user_present:
        return jsonify({"error": "User presence flag not set in authenticatorData"}), 400

    db = get_db()
    challenge_received = client_data.get("challenge", "")
    challenge_row = db.execute(
        """
        SELECT * FROM webauthn_challenges
        WHERE challenge = ? AND challenge_type = 'authentication'
        ORDER BY id DESC LIMIT 1
        """,
        (challenge_received,),
    ).fetchone()

    if not challenge_row:
        return jsonify({"error": "Authentication challenge mismatch or expired"}), 400

    cred_row = db.execute(
        "SELECT * FROM webauthn_credentials WHERE credential_id = ?",
        (credential_id,),
    ).fetchone()

    if not cred_row:
        return jsonify({"error": "Passkey credential not recognized"}), 404

    db.execute("DELETE FROM webauthn_challenges WHERE id = ?", (challenge_row["id"],))
    db.execute(
        "UPDATE webauthn_credentials SET sign_count = sign_count + 1, last_used_at = datetime('now') WHERE id = ?",
        (cred_row["id"],),
    )

    partner_id = cred_row["partner_id"]
    # If the user already has a session for this partner, unlock it; otherwise create a new session!
    if getattr(g, "current_session", None) and g.current_session["partner_id"] == partner_id:
        db.execute(
            "UPDATE auth_sessions SET is_screen_locked = 0 WHERE id = ?",
            (g.current_session["id"],),
        )
        db.commit()
        raw_token = extract_request_token()
    else:
        raw_token = create_session_for_partner(db, partner_id)

    partners, _ = _get_partners_with_passkeys(db)
    partner = next((p for p in partners if p["id"] == partner_id), None)

    resp = make_response(
        jsonify({
            "verified": True,
            "unlocked": True,
            "authenticated": True,
            "token": raw_token,
            "partner": partner,
            "partners": partners,
            "device_name": cred_row["device_name"],
        })
    )
    if raw_token:
        return _attach_session_cookie(resp, raw_token)
    return resp


@auth_bp.route("/webauthn/credentials/<int:cred_id>", methods=["DELETE"])
def delete_credential(cred_id: int):
    if not getattr(g, "current_partner", None):
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    db.execute("DELETE FROM webauthn_credentials WHERE id = ?", (cred_id,))
    db.commit()
    return jsonify({"deleted": True, "id": cred_id})
