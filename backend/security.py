import base64
import hashlib
import hmac
import json
import secrets
import struct
from datetime import datetime, timedelta, timezone
from flask import current_app, g, jsonify, request
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from backend.database import get_db

SESSION_COOKIE_NAME = "gibson_session"


def sanitize_partner(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    d.pop("password_hash", None)
    return d


def mask_email(email: str) -> str:
    """Masks an email address for unauthenticated display (e.g. a***@gibson.local)."""
    clean = (email or "").strip()
    if not clean or "@" not in clean:
        return ""
    local, domain = clean.split("@", 1)
    if len(local) <= 1:
        masked_local = "*"
    else:
        masked_local = f"{local[0]}***"
    return f"{masked_local}@{domain}"


def _get_master_secret() -> str:
    secret = current_app.config.get("SECRET_KEY")
    if not secret or secret in ("gibson-family-dev-secret-key", "gibson-default-secret"):
        if not current_app.config.get("TESTING"):
            raise RuntimeError("CRITICAL: FLASK_SECRET_KEY must be configured with a cryptographically secure random string.")
    return secret or "test-fallback-secret-key"


def _get_plaid_encryption_secrets() -> list[str]:
    """
    Returns ordered candidate secrets for Plaid token encryption/decryption.
    Prefers dedicated PLAID_ENCRYPTION_KEY if configured, with fallback to FLASK_SECRET_KEY
    so rotating session secrets never breaks existing encrypted Plaid tokens.
    """
    dedicated = (current_app.config.get("PLAID_ENCRYPTION_KEY") or "").strip()
    master = _get_master_secret()
    if dedicated and dedicated != master:
        return [dedicated, master]
    return [master]


def _derive_aes_key(master_secret: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256", master_secret.encode("utf-8"), salt, 100_000, dklen=32
    )


def _derive_keys(master_secret: str, salt: bytes) -> tuple[bytes, bytes]:
    derived = hashlib.pbkdf2_hmac(
        "sha256", master_secret.encode("utf-8"), salt, 100_000, dklen=64
    )
    return derived[:32], derived[32:]


def _keystream_xor(data: bytes, enc_key: bytes, nonce: bytes) -> bytes:
    out = bytearray(len(data))
    block_count = (len(data) + 31) // 32
    for counter in range(block_count):
        block = hmac.new(
            enc_key, nonce + counter.to_bytes(4, "big"), hashlib.sha256
        ).digest()
        start = counter * 32
        end = min(start + 32, len(data))
        for i in range(start, end):
            out[i] = data[i] ^ block[i - start]
    return bytes(out)


def encrypt_plaid_token(plaintext: str) -> str:
    """Encrypts a Plaid access_token at rest using standard AES-256-GCM with PBKDF2 key derivation."""
    if not plaintext or plaintext.startswith("enc:"):
        return plaintext
    secret = _get_plaid_encryption_secrets()[0]
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)  # Standard 96-bit nonce for AES-GCM
    key = _derive_aes_key(secret, salt)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(salt + nonce + ciphertext).decode("ascii")
    return f"enc:v2:{payload}"


def decrypt_plaid_token(stored_value: str) -> str:
    """Decrypts an encrypted Plaid access_token (supports standard enc:v2: AES-GCM, key rotation, and legacy enc:v1:)."""
    if not stored_value or not stored_value.startswith("enc:"):
        return stored_value

    candidate_secrets = _get_plaid_encryption_secrets()

    if stored_value.startswith("enc:v2:"):
        raw = base64.urlsafe_b64decode(stored_value[len("enc:v2:"):].encode("ascii"))
        if len(raw) < 16 + 12 + 16:
            raise ValueError("Payload too short for AES-GCM")
        salt = raw[:16]
        nonce = raw[16:28]
        ciphertext = raw[28:]
        last_err = None
        for secret in candidate_secrets:
            try:
                key = _derive_aes_key(secret, salt)
                aesgcm = AESGCM(key)
                plaintext_bytes = aesgcm.decrypt(nonce, ciphertext, None)
                return plaintext_bytes.decode("utf-8")
            except Exception as e:
                last_err = e
        raise ValueError(f"Encrypted Plaid access token failed integrity check: {last_err}") from last_err

    if stored_value.startswith("enc:v1:"):
        raw = base64.urlsafe_b64decode(stored_value[len("enc:v1:"):].encode("ascii"))
        salt = raw[:16]
        nonce = raw[16:32]
        tag = raw[32:64]
        ciphertext = raw[64:]
        last_err = None
        for secret in candidate_secrets:
            try:
                enc_key, mac_key = _derive_keys(secret, salt)
                expected_tag = hmac.new(mac_key, salt + nonce + ciphertext, hashlib.sha256).digest()
                if not hmac.compare_digest(tag, expected_tag):
                    raise ValueError("Encrypted Plaid access token failed integrity check")
                plaintext_bytes = _keystream_xor(ciphertext, enc_key, nonce)
                return plaintext_bytes.decode("utf-8")
            except Exception as e:
                last_err = e
        raise ValueError(f"Legacy encrypted Plaid access token failed integrity check: {last_err}") from last_err

    return stored_value


# --- Minimal RFC 8949 CBOR Decoder & WebAuthn Cryptographic Verification ---

def _cbor_decode_item(data: bytes, offset: int = 0):
    if offset >= len(data):
        raise ValueError("Unexpected end of CBOR stream")
    initial = data[offset]
    offset += 1
    major = initial >> 5
    addl = initial & 0x1F

    def _read_length(ai: int, pos: int):
        if ai < 24:
            return ai, pos
        elif ai == 24:
            return data[pos], pos + 1
        elif ai == 25:
            return struct.unpack(">H", data[pos:pos + 2])[0], pos + 2
        elif ai == 26:
            return struct.unpack(">I", data[pos:pos + 4])[0], pos + 4
        elif ai == 27:
            return struct.unpack(">Q", data[pos:pos + 8])[0], pos + 8
        raise ValueError(f"Unsupported CBOR additional info: {ai}")

    val, offset = _read_length(addl, offset)

    if major == 0:  # Unsigned int
        return val, offset
    elif major == 1:  # Negative int
        return -1 - val, offset
    elif major == 2:  # Byte string
        end = offset + val
        if end > len(data):
            raise ValueError("CBOR byte string exceeds buffer")
        return data[offset:end], end
    elif major == 3:  # Text string
        end = offset + val
        if end > len(data):
            raise ValueError("CBOR text string exceeds buffer")
        return data[offset:end].decode("utf-8"), end
    elif major == 4:  # Array
        arr = []
        for _ in range(val):
            item, offset = _cbor_decode_item(data, offset)
            arr.append(item)
        return arr, offset
    elif major == 5:  # Map
        mp = {}
        for _ in range(val):
            k, offset = _cbor_decode_item(data, offset)
            v, offset = _cbor_decode_item(data, offset)
            mp[k] = v
        return mp, offset
    elif major == 7:  # Simple / primitives
        if addl == 20:
            return False, offset
        elif addl == 21:
            return True, offset
        elif addl == 22:
            return None, offset
        return val, offset
    raise ValueError(f"Unsupported CBOR major type: {major}")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(val: str) -> bytes:
    padding_str = "=" * ((4 - len(val) % 4) % 4)
    return base64.urlsafe_b64decode(val + padding_str)


def parse_webauthn_registration_attestation(
    attestation_bytes: bytes,
    expected_rp_id: str,
) -> dict:
    """
    Parses a WebAuthn CBOR attestationObject, verifies rpIdHash and attested credential data flag,
    and extracts the COSE credential public key and initial sign_count.
    Returns a dict with {"public_key_json": str, "sign_count": int, "credential_id_b64": str}.
    """
    att_obj, _ = _cbor_decode_item(attestation_bytes, 0)
    if not isinstance(att_obj, dict) or "authData" not in att_obj:
        raise ValueError("Invalid WebAuthn attestationObject: missing authData")

    auth_data = att_obj["authData"]
    if not isinstance(auth_data, (bytes, bytearray)) or len(auth_data) < 55:
        raise ValueError("Invalid WebAuthn authData in attestationObject")

    rp_id_hash = auth_data[:32]
    expected_hash = hashlib.sha256(expected_rp_id.encode("utf-8")).digest()
    if not hmac.compare_digest(rp_id_hash, expected_hash):
        raise ValueError("WebAuthn registration rpIdHash mismatch")

    flags = auth_data[32]
    user_present = bool(flags & 0x01)
    attested_cred_present = bool(flags & 0x40)
    if not user_present:
        raise ValueError("WebAuthn registration user presence (UP) flag not set")
    if not attested_cred_present:
        raise ValueError("WebAuthn registration attestedCredentialData (AT) flag not set")

    sign_count = struct.unpack(">I", auth_data[33:37])[0]
    # 16-byte AAGUID is at auth_data[37:53]
    cred_id_len = struct.unpack(">H", auth_data[53:55])[0]
    cose_offset = 55 + cred_id_len
    if len(auth_data) <= cose_offset:
        raise ValueError("WebAuthn authData truncated before COSE public key")

    cred_id_bytes = auth_data[55:cose_offset]
    cose_key, _ = _cbor_decode_item(auth_data, cose_offset)
    if not isinstance(cose_key, dict):
        raise ValueError("Invalid COSE public key structure")

    kty = cose_key.get(1)
    alg = cose_key.get(3)

    if kty == 2 and alg == -7:  # EC2 ES256 (P-256)
        x_bytes = cose_key.get(-2)
        y_bytes = cose_key.get(-3)
        if not isinstance(x_bytes, bytes) or not isinstance(y_bytes, bytes) or len(x_bytes) != 32 or len(y_bytes) != 32:
            raise ValueError("Invalid EC2 P-256 coordinates in COSE public key")
        pub_key_record = {
            "kty": "EC2",
            "alg": -7,
            "crv": cose_key.get(-1, 1),
            "x": _b64url_encode(x_bytes),
            "y": _b64url_encode(y_bytes),
        }
    elif kty == 3 and alg == -257:  # RSA RS256
        n_bytes = cose_key.get(-1)
        e_bytes = cose_key.get(-2)
        if not isinstance(n_bytes, bytes) or not isinstance(e_bytes, bytes):
            raise ValueError("Invalid RSA modulus/exponent in COSE public key")
        pub_key_record = {
            "kty": "RSA",
            "alg": -257,
            "n": _b64url_encode(n_bytes),
            "e": _b64url_encode(e_bytes),
        }
    elif kty == 1 and alg == -8:  # OKP EdDSA (Ed25519)
        x_bytes = cose_key.get(-2)
        if not isinstance(x_bytes, bytes) or len(x_bytes) != 32:
            raise ValueError("Invalid Ed25519 public key in COSE key")
        pub_key_record = {
            "kty": "OKP",
            "alg": -8,
            "crv": cose_key.get(-1, 6),
            "x": _b64url_encode(x_bytes),
        }
    else:
        raise ValueError(f"Unsupported COSE key type/algorithm: kty={kty}, alg={alg}")

    return {
        "public_key_json": "cose:" + json.dumps(pub_key_record, separators=(",", ":")),
        "sign_count": int(sign_count),
        "credential_id_b64": _b64url_encode(cred_id_bytes),
    }


def verify_webauthn_assertion_signature(
    stored_public_key: str,
    auth_data_bytes: bytes,
    client_data_raw: bytes,
    signature_bytes: bytes,
    expected_rp_id: str,
    stored_sign_count: int = 0,
) -> int:
    """
    Cryptographically verifies a WebAuthn assertion signature, rpIdHash, user presence,
    and sign_count progression. Returns the new sign_count if valid, or raises ValueError.
    """
    if not stored_public_key or not stored_public_key.startswith("cose:"):
        raise ValueError("Passkey uses an outdated format and must be re-enrolled after signing in with your password.")

    if len(auth_data_bytes) < 37:
        raise ValueError("Invalid authenticatorData length")

    rp_id_hash = auth_data_bytes[:32]
    expected_hash = hashlib.sha256(expected_rp_id.encode("utf-8")).digest()
    if not hmac.compare_digest(rp_id_hash, expected_hash):
        raise ValueError("WebAuthn assertion rpIdHash mismatch")

    flags = auth_data_bytes[32]
    if not (flags & 0x01):
        raise ValueError("User presence (UP) flag not set in authenticatorData")

    incoming_sign_count = struct.unpack(">I", auth_data_bytes[33:37])[0]
    if (stored_sign_count > 0 or incoming_sign_count > 0) and incoming_sign_count <= stored_sign_count:
        raise ValueError("WebAuthn signature counter regression detected (potential cloned credential)")

    key_info = json.loads(stored_public_key[len("cose:"):])
    client_data_hash = hashlib.sha256(client_data_raw).digest()
    signed_data = auth_data_bytes + client_data_hash

    kty = key_info.get("kty")
    alg = key_info.get("alg")

    if kty == "EC2" and alg == -7:
        x_bytes = _b64url_decode(key_info["x"])
        y_bytes = _b64url_decode(key_info["y"])
        pub_numbers = ec.EllipticCurvePublicNumbers(
            int.from_bytes(x_bytes, "big"),
            int.from_bytes(y_bytes, "big"),
            ec.SECP256R1(),
        )
        pub_key = pub_numbers.public_key()
        pub_key.verify(signature_bytes, signed_data, ec.ECDSA(hashes.SHA256()))
    elif kty == "RSA" and alg == -257:
        n_int = int.from_bytes(_b64url_decode(key_info["n"]), "big")
        e_int = int.from_bytes(_b64url_decode(key_info["e"]), "big")
        pub_key = rsa.RSAPublicNumbers(e_int, n_int).public_key()
        pub_key.verify(signature_bytes, signed_data, padding.PKCS1v15(), hashes.SHA256())
    elif kty == "OKP" and alg == -8:
        x_bytes = _b64url_decode(key_info["x"])
        pub_key = ed25519.Ed25519PublicKey.from_public_bytes(x_bytes)
        pub_key.verify(signature_bytes, signed_data)
    else:
        raise ValueError(f"Unsupported stored COSE key algorithm: {kty}/{alg}")

    return incoming_sign_count if incoming_sign_count > 0 else stored_sign_count + 1


def hash_session_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_session_for_partner(db, partner_id: int) -> str:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(raw_token)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    db.execute(
        "INSERT INTO auth_sessions (token_hash, partner_id, is_screen_locked, expires_at) VALUES (?, ?, 0, ?)",
        (token_hash, partner_id, expires_at),
    )
    db.commit()
    return raw_token


def extract_request_token() -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    cookie_token = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie_token:
        return cookie_token.strip()
    return None


def load_current_session():
    """Loads g.current_partner and g.current_session from the request token/cookie."""
    g.current_partner = None
    g.current_session = None
    raw_token = extract_request_token()
    if not raw_token:
        return

    token_hash = hash_session_token(raw_token)
    db = get_db()
    sess = db.execute(
        "SELECT * FROM auth_sessions WHERE token_hash = ?",
        (token_hash,),
    ).fetchone()
    if not sess:
        return

    try:
        exp = datetime.fromisoformat(sess["expires_at"])
        if exp < datetime.now(timezone.utc):
            db.execute("DELETE FROM auth_sessions WHERE id = ?", (sess["id"],))
            db.commit()
            return
    except ValueError:
        pass

    partner_row = db.execute(
        "SELECT * FROM partners WHERE id = ?",
        (sess["partner_id"],),
    ).fetchone()
    if not partner_row:
        return

    g.current_session = dict(sess)
    g.current_partner = sanitize_partner(partner_row)


def check_rate_limit(db, identifier: str, max_attempts: int = 5) -> bool:
    """Returns True if allowed, False if rate-limited (> max_attempts in last 15 minutes)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    db.execute("DELETE FROM login_attempts WHERE attempted_at < ?", (cutoff,))
    cnt = db.execute(
        "SELECT COUNT(*) AS cnt FROM login_attempts WHERE identifier = ? AND attempted_at >= ?",
        (identifier, cutoff),
    ).fetchone()["cnt"]
    return cnt < max_attempts


def record_failed_login(db, identifier: str) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    db.execute(
        "INSERT INTO login_attempts (identifier, attempted_at) VALUES (?, ?)",
        (identifier, now_iso),
    )
    db.commit()


def clear_failed_logins(db, identifier: str) -> None:
    db.execute("DELETE FROM login_attempts WHERE identifier = ?", (identifier,))
    db.commit()

