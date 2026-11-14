import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from flask import current_app, g, jsonify, request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from backend.database import get_db

SESSION_COOKIE_NAME = "gibson_session"


def sanitize_partner(row) -> dict:
    if not row:
        return {}
    d = dict(row)
    d.pop("password_hash", None)
    return d


def _get_master_secret() -> str:
    secret = current_app.config.get("SECRET_KEY")
    if not secret or secret in ("gibson-family-dev-secret-key", "gibson-default-secret"):
        if not current_app.config.get("TESTING"):
            raise RuntimeError("CRITICAL: FLASK_SECRET_KEY must be configured with a cryptographically secure random string.")
    return secret or "test-fallback-secret-key"


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
    secret = _get_master_secret()
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)  # Standard 96-bit nonce for AES-GCM
    key = _derive_aes_key(secret, salt)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(salt + nonce + ciphertext).decode("ascii")
    return f"enc:v2:{payload}"


def decrypt_plaid_token(stored_value: str) -> str:
    """Decrypts an encrypted Plaid access_token (supports standard enc:v2: AES-GCM and legacy enc:v1:)."""
    if not stored_value or not stored_value.startswith("enc:"):
        return stored_value

    secret = _get_master_secret()

    if stored_value.startswith("enc:v2:"):
        try:
            raw = base64.urlsafe_b64decode(stored_value[len("enc:v2:"):].encode("ascii"))
            if len(raw) < 16 + 12 + 16:
                raise ValueError("Payload too short for AES-GCM")
            salt = raw[:16]
            nonce = raw[16:28]
            ciphertext = raw[28:]
            key = _derive_aes_key(secret, salt)
            aesgcm = AESGCM(key)
            plaintext_bytes = aesgcm.decrypt(nonce, ciphertext, None)
            return plaintext_bytes.decode("utf-8")
        except Exception as e:
            raise ValueError(f"Encrypted Plaid access token failed integrity check: {e}") from e

    if stored_value.startswith("enc:v1:"):
        try:
            raw = base64.urlsafe_b64decode(stored_value[len("enc:v1:"):].encode("ascii"))
            salt = raw[:16]
            nonce = raw[16:32]
            tag = raw[32:64]
            ciphertext = raw[64:]
            enc_key, mac_key = _derive_keys(secret, salt)
            expected_tag = hmac.new(mac_key, salt + nonce + ciphertext, hashlib.sha256).digest()
            if not hmac.compare_digest(tag, expected_tag):
                raise ValueError("Encrypted Plaid access token failed integrity check")
            plaintext_bytes = _keystream_xor(ciphertext, enc_key, nonce)
            return plaintext_bytes.decode("utf-8")
        except Exception as e:
            raise ValueError(f"Legacy encrypted Plaid access token failed integrity check: {e}") from e

    return stored_value


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

