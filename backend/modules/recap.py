import json
import re
from datetime import date
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from flask import Blueprint, current_app, g, jsonify, request
from backend.database import create_notification, get_db

recap_bp = Blueprint("recap", __name__, url_prefix="/api/recap")

_YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
_IG_SHORTCODE_RE = re.compile(r"^[A-Za-z0-9_-]{4,40}$")


def current_week_and_day() -> tuple[str, str]:
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()
    return f"{iso_year}-W{iso_week:02d}", today.isoformat()


def parse_clip_url(raw_url: str) -> dict | None:
    """Validate and classify a shared video URL (YouTube Shorts, Instagram Reels, or generic link)."""
    candidate = (raw_url or "").strip()
    if not candidate:
        return None
    if not re.match(r"^https?://", candidate, re.IGNORECASE):
        if re.match(r"^(www\.)?(youtube\.com|youtu\.be|instagram\.com|instagr\.am)/", candidate, re.IGNORECASE):
            candidate = f"https://{candidate}"
        else:
            return None

    parsed = urlparse(candidate)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None

    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]

    path_parts = [p for p in parsed.path.split("/") if p]

    # YouTube Shorts / youtu.be / watch
    if host in ("youtube.com", "youtube-nocookie.com"):
        video_id = None
        if len(path_parts) >= 2 and path_parts[0] in ("shorts", "embed", "live", "v"):
            video_id = path_parts[1]
        elif path_parts and path_parts[0] == "watch":
            qs = parse_qs(parsed.query)
            video_id = (qs.get("v") or [None])[0]
        if video_id and _YOUTUBE_ID_RE.match(video_id):
            is_short = len(path_parts) >= 1 and path_parts[0] == "shorts"
            normalized = (
                f"https://www.youtube.com/shorts/{video_id}"
                if is_short
                else f"https://www.youtube.com/watch?v={video_id}"
            )
            return {
                "platform": "youtube_short",
                "external_id": video_id,
                "normalized_url": normalized,
                "thumbnail_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "default_title": "YouTube Short" if is_short else "YouTube Video",
            }

    if host == "youtu.be" and path_parts:
        video_id = path_parts[0]
        if _YOUTUBE_ID_RE.match(video_id):
            return {
                "platform": "youtube_short",
                "external_id": video_id,
                "normalized_url": f"https://www.youtube.com/shorts/{video_id}",
                "thumbnail_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "default_title": "YouTube Short",
            }

    # Instagram Reels / Posts
    if host in ("instagram.com", "instagr.am"):
        shortcode = None
        if len(path_parts) >= 2 and path_parts[0] in ("reel", "reels", "p", "tv"):
            shortcode = path_parts[1]
        elif len(path_parts) >= 3 and path_parts[1] in ("reel", "reels", "p"):
            # Handle /<username>/reel/<shortcode>/
            shortcode = path_parts[2]
        if shortcode and _IG_SHORTCODE_RE.match(shortcode):
            return {
                "platform": "instagram_reel",
                "external_id": shortcode,
                "normalized_url": f"https://www.instagram.com/reel/{shortcode}/",
                "thumbnail_url": "",
                "default_title": "Instagram Reel",
            }

    return {
        "platform": "other",
        "external_id": "",
        "normalized_url": candidate,
        "thumbnail_url": "",
        "default_title": host,
    }


def fetch_clip_metadata(platform: str, normalized_url: str) -> dict:
    """Best-effort metadata lookup via YouTube oEmbed. Never raises or blocks creation."""
    if platform != "youtube_short":
        return {}
    try:
        if current_app.config.get("TESTING"):
            return {}
    except RuntimeError:
        pass

    try:
        oembed_url = "https://www.youtube.com/oembed?" + urlencode(
            {"url": normalized_url, "format": "json"}
        )
        req = Request(oembed_url, headers={"User-Agent": "GibsonFamilyHub/1.0"})
        with urlopen(req, timeout=2.5) as resp:
            if resp.status != 200:
                return {}
            payload = json.loads(resp.read().decode("utf-8"))
            return {
                "title": (payload.get("title") or "").strip()[:200],
                "author_name": (payload.get("author_name") or "").strip()[:120],
                "thumbnail_url": (payload.get("thumbnail_url") or "").strip()[:400],
            }
    except Exception:
        return {}


def _get_clip_row(db, clip_id: int) -> dict | None:
    row = db.execute(
        """
        SELECT c.*, p.name AS submitted_by_name, p.avatar_color AS submitted_by_color
        FROM recap_clips c
        LEFT JOIN partners p ON c.submitted_by = p.id
        WHERE c.id = ?
        """,
        (clip_id,),
    ).fetchone()
    return dict(row) if row else None


@recap_bp.route("/clips", methods=["GET"])
def list_clips():
    db = get_db()
    period = (request.args.get("period") or "week").strip().lower()
    key = (request.args.get("key") or "").strip()
    status = (request.args.get("status") or "all").strip().lower()

    current_week, current_day = current_week_and_day()

    weeks = [
        dict(r)
        for r in db.execute(
            """
            SELECT
                week_key,
                COUNT(*) AS total_count,
                SUM(CASE WHEN watched = 0 THEN 1 ELSE 0 END) AS unwatched_count,
                MIN(day_key) AS start_day,
                MAX(day_key) AS end_day
            FROM recap_clips
            GROUP BY week_key
            ORDER BY week_key DESC
            """
        ).fetchall()
    ]

    days = [
        dict(r)
        for r in db.execute(
            """
            SELECT
                day_key,
                COUNT(*) AS total_count,
                SUM(CASE WHEN watched = 0 THEN 1 ELSE 0 END) AS unwatched_count
            FROM recap_clips
            GROUP BY day_key
            ORDER BY day_key DESC
            LIMIT 60
            """
        ).fetchall()
    ]

    where_clauses = []
    params = []

    if period == "week":
        target_week = key or (weeks[0]["week_key"] if weeks else current_week)
        where_clauses.append("c.week_key = ?")
        params.append(target_week)
    elif period == "day":
        target_day = key or (days[0]["day_key"] if days else current_day)
        where_clauses.append("c.day_key = ?")
        params.append(target_day)

    if status == "unwatched":
        where_clauses.append("c.watched = 0")
    elif status == "watched":
        where_clauses.append("c.watched = 1")
    elif status == "favorites":
        where_clauses.append("c.favorite = 1")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    clips = [
        dict(r)
        for r in db.execute(
            f"""
            SELECT c.*, p.name AS submitted_by_name, p.avatar_color AS submitted_by_color
            FROM recap_clips c
            LEFT JOIN partners p ON c.submitted_by = p.id
            {where_sql}
            ORDER BY c.watched ASC, c.id DESC
            """,
            params,
        ).fetchall()
    ]

    totals = db.execute(
        """
        SELECT
            COUNT(*) AS total_count,
            SUM(CASE WHEN watched = 0 THEN 1 ELSE 0 END) AS unwatched_count,
            SUM(CASE WHEN watched = 1 THEN 1 ELSE 0 END) AS watched_count
        FROM recap_clips
        """
    ).fetchone()

    return jsonify(
        {
            "clips": clips,
            "weeks": weeks,
            "days": days,
            "summary": {
                "total_count": totals["total_count"] or 0,
                "unwatched_count": totals["unwatched_count"] or 0,
                "watched_count": totals["watched_count"] or 0,
                "current_week_key": current_week,
                "current_day_key": current_day,
            },
        }
    )


@recap_bp.route("/clips", methods=["POST"])
def add_clip():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    raw_url = (data.get("url") or data.get("share_url") or "").strip()
    parsed = parse_clip_url(raw_url)
    if not parsed:
        return jsonify({"error": "Please enter a valid Instagram Reel, YouTube Short, or video URL."}), 400

    meta = fetch_clip_metadata(parsed["platform"], parsed["normalized_url"])
    title = (data.get("title") or meta.get("title") or parsed["default_title"]).strip()[:200]
    author_name = (data.get("author_name") or meta.get("author_name") or "").strip()[:120]
    thumbnail_url = (meta.get("thumbnail_url") or parsed["thumbnail_url"] or "").strip()[:400]
    note = (data.get("note") or "").strip()[:300]

    week_key, day_key = current_week_and_day()
    db = get_db()
    cur = db.execute(
        """
        INSERT INTO recap_clips (
            url, normalized_url, platform, external_id, title, author_name,
            thumbnail_url, note, submitted_by, week_key, day_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            raw_url,
            parsed["normalized_url"],
            parsed["platform"],
            parsed["external_id"],
            title,
            author_name,
            thumbnail_url,
            note,
            actor["id"],
            week_key,
            day_key,
        ),
    )
    clip_id = cur.lastrowid

    platform_label = (
        "YouTube Short"
        if parsed["platform"] == "youtube_short"
        else "Instagram Reel"
        if parsed["platform"] == "instagram_reel"
        else "video clip"
    )
    other_partners = db.execute(
        "SELECT id FROM partners WHERE id != ?",
        (actor["id"],),
    ).fetchall()
    for p in other_partners:
        msg = f"{actor['name']} queued a {platform_label} for your Weekly Recap"
        if note:
            msg += f": \"{note[:80]}\""
        create_notification(
            db,
            recipient_partner_id=p["id"],
            actor_partner_id=actor["id"],
            notif_type="recap_added",
            title="New Weekly Recap Clip",
            message=msg,
            link_tab="recap",
            reference_id=clip_id,
        )

    db.commit()
    return jsonify(_get_clip_row(db, clip_id)), 201


@recap_bp.route("/clips/<int:clip_id>", methods=["PUT"])
def update_clip(clip_id: int):
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401

    db = get_db()
    existing = db.execute("SELECT * FROM recap_clips WHERE id = ?", (clip_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Clip not found"}), 404

    data = request.get_json(silent=True) or {}
    updates = []
    params = []

    if "watched" in data:
        watched_val = 1 if data["watched"] else 0
        updates.append("watched = ?")
        params.append(watched_val)
        if watched_val:
            updates.append("watched_at = datetime('now')")
        else:
            updates.append("watched_at = NULL")

    if "favorite" in data:
        updates.append("favorite = ?")
        params.append(1 if data["favorite"] else 0)

    if "note" in data:
        updates.append("note = ?")
        params.append((data["note"] or "").strip()[:300])

    if "title" in data:
        new_title = (data["title"] or "").strip()[:200]
        if new_title:
            updates.append("title = ?")
            params.append(new_title)

    if updates:
        params.append(clip_id)
        db.execute(f"UPDATE recap_clips SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()

    return jsonify(_get_clip_row(db, clip_id))


@recap_bp.route("/clips/mark-period-watched", methods=["POST"])
def mark_period_watched():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    period = (data.get("period") or "week").strip().lower()
    key = (data.get("key") or "").strip()

    db = get_db()
    if period == "week" and key:
        cur = db.execute(
            "UPDATE recap_clips SET watched = 1, watched_at = datetime('now') WHERE week_key = ? AND watched = 0",
            (key,),
        )
    elif period == "day" and key:
        cur = db.execute(
            "UPDATE recap_clips SET watched = 1, watched_at = datetime('now') WHERE day_key = ? AND watched = 0",
            (key,),
        )
    else:
        cur = db.execute(
            "UPDATE recap_clips SET watched = 1, watched_at = datetime('now') WHERE watched = 0"
        )
    db.commit()
    return jsonify({"updated": cur.rowcount})


@recap_bp.route("/clips/<int:clip_id>", methods=["DELETE"])
def delete_clip(clip_id: int):
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401

    db = get_db()
    cur = db.execute("DELETE FROM recap_clips WHERE id = ?", (clip_id,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "Clip not found"}), 404
    return jsonify({"deleted": True, "id": clip_id})
