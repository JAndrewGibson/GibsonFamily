import json
import logging
import os
import sqlite3
import threading
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException, webpush

from backend.config import Config
from backend.security import decrypt_plaid_token, encrypt_plaid_token

logger = logging.getLogger(__name__)


def get_or_create_vapid_keys(db: sqlite3.Connection) -> tuple[str, str, str]:
    """Return (public_key_b64url, private_key_pem_or_str, claims_sub)."""
    claims_sub = Config.VAPID_CLAIMS_SUB or "mailto:notifications@gibsonfamily.app"
    if Config.VAPID_PUBLIC_KEY and Config.VAPID_PRIVATE_KEY:
        return Config.VAPID_PUBLIC_KEY, Config.VAPID_PRIVATE_KEY, claims_sub

    pub_row = db.execute(
        "SELECT value FROM app_settings WHERE key = 'vapid_public_key'"
    ).fetchone()
    priv_row = db.execute(
        "SELECT value FROM app_settings WHERE key = 'vapid_private_key'"
    ).fetchone()

    if pub_row and priv_row and pub_row["value"] and priv_row["value"]:
        decrypted_priv = decrypt_plaid_token(priv_row["value"])
        if decrypted_priv:
            return pub_row["value"], decrypted_priv, claims_sub

    vapid = Vapid02()
    vapid.generate_keys()
    raw_pub = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = b64urlencode(raw_pub)
    priv_pem = vapid.private_pem().decode("utf-8")

    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public_key', ?)",
        (pub_b64,),
    )
    db.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_private_key', ?)",
        (encrypt_plaid_token(priv_pem),),
    )
    db.commit()
    return pub_b64, priv_pem, claims_sub


def build_push_tag(notif_type: str | None, reference_id: int | None = None) -> str:
    base = (notif_type or "gibson-push").strip() or "gibson-push"
    if reference_id is not None:
        return f"{base}-{reference_id}"
    return base


def _send_push_batch(
    subscriptions: list[dict],
    payload_json: str,
    vapid_private_key: str,
    vapid_claims_sub: str,
    db_path: str | None,
) -> int:
    sent_count = 0
    expired_ids: list[int] = []

    for sub in subscriptions:
        sub_info = {
            "endpoint": sub["endpoint"],
            "keys": {
                "p256dh": sub["p256dh"],
                "auth": sub["auth"],
            },
        }
        try:
            webpush(
                subscription_info=sub_info,
                data=payload_json,
                vapid_private_key=vapid_private_key,
                vapid_claims={"sub": vapid_claims_sub},
                ttl=86400,
            )
            sent_count += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                expired_ids.append(sub["id"])
            else:
                logger.warning("WebPush failed for sub %s (status=%s): %s", sub["id"], status, exc)
        except Exception as exc:
            logger.warning("Unexpected WebPush error for sub %s: %s", sub["id"], exc)

    if expired_ids and db_path:
        try:
            conn = sqlite3.connect(db_path, timeout=10)
            placeholders = ",".join("?" for _ in expired_ids)
            conn.execute(
                f"UPDATE push_subscriptions SET enabled = 0, updated_at = datetime('now') WHERE id IN ({placeholders})",
                expired_ids,
            )
            conn.commit()
            conn.close()
        except Exception as exc:
            logger.warning("Failed to deactivate expired push subscriptions: %s", exc)

    return sent_count


def dispatch_web_push(
    db: sqlite3.Connection,
    recipient_partner_id: int,
    title: str,
    message: str,
    link_tab: str = "overview",
    notif_type: str = "general",
    reference_id: int | None = None,
    async_send: bool = True,
) -> int:
    """Send Web Push notifications to all active HTTPS subscriptions for a partner."""
    if not recipient_partner_id:
        return 0

    rows = [
        dict(r)
        for r in db.execute(
            """
            SELECT id, endpoint, p256dh, auth
            FROM push_subscriptions
            WHERE partner_id = ?
              AND enabled = 1
              AND endpoint LIKE 'https://%'
              AND p256dh != ''
              AND auth != ''
            """,
            (recipient_partner_id,),
        ).fetchall()
    ]
    if not rows:
        return 0

    unread_row = db.execute(
        "SELECT COUNT(*) AS cnt FROM notifications WHERE recipient_partner_id = ? AND is_read = 0",
        (recipient_partner_id,),
    ).fetchone()
    unread_count = int(unread_row["cnt"]) if unread_row else 1

    _, priv_key, claims_sub = get_or_create_vapid_keys(db)
    payload_json = json.dumps(
        {
            "title": title,
            "body": message,
            "link_tab": link_tab or "overview",
            "notif_type": notif_type,
            "tag": build_push_tag(notif_type, reference_id),
            "unread_count": unread_count,
        }
    )

    db_path = None
    try:
        db_list = db.execute("PRAGMA database_list").fetchall()
        for entry in db_list:
            if entry["name"] == "main" and entry["file"]:
                db_path = entry["file"]
                break
    except Exception:
        db_path = Config.DATABASE_PATH

    if async_send and not os.environ.get("PYTEST_CURRENT_TEST"):
        thread = threading.Thread(
            target=_send_push_batch,
            args=(rows, payload_json, priv_key, claims_sub, db_path),
            daemon=True,
        )
        thread.start()
        return len(rows)

    return _send_push_batch(rows, payload_json, priv_key, claims_sub, db_path)
