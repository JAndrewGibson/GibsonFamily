from datetime import datetime, timedelta, timezone
import json
from flask import Blueprint, g, jsonify, request
from backend.database import create_notification, get_db

hub_bp = Blueprint("couples_hub", __name__, url_prefix="/api")


@hub_bp.route("/modules", methods=["GET"])
def list_modules():
    db = get_db()
    modules = [
        dict(r)
        for r in db.execute("SELECT * FROM module_registry ORDER BY sort_order ASC").fetchall()
    ]
    return jsonify({"modules": modules})


@hub_bp.route("/modules/<string:module_id>/toggle", methods=["PUT"])
def toggle_module(module_id: str):
    db = get_db()
    row = db.execute("SELECT * FROM module_registry WHERE id = ?", (module_id,)).fetchone()
    if not row:
        return jsonify({"error": "Module not found"}), 404

    new_enabled = 0 if row["enabled"] else 1
    db.execute("UPDATE module_registry SET enabled = ? WHERE id = ?", (new_enabled, module_id))
    db.commit()
    updated = dict(db.execute("SELECT * FROM module_registry WHERE id = ?", (module_id,)).fetchone())
    return jsonify(updated)


# --- Notifications API ---

@hub_bp.route("/notifications", methods=["GET"])
def list_notifications():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"notifications": [], "unread_count": 0})

    db = get_db()
    try:
        from backend.modules.finance import check_and_create_month_close_notifications
        check_and_create_month_close_notifications(db)
    except Exception:
        pass
    try:
        check_and_dispatch_recurring_notifications(db)
    except Exception:
        pass
    rows = [
        dict(r)
        for r in db.execute(
            """
            SELECT n.*, p.name AS actor_name, p.avatar_color AS actor_color
            FROM notifications n
            LEFT JOIN partners p ON n.actor_partner_id = p.id
            WHERE n.recipient_partner_id = ?
            ORDER BY n.is_read ASC, n.id DESC
            LIMIT 50
            """,
            (actor["id"],),
        ).fetchall()
    ]
    unread_count = sum(1 for r in rows if not r["is_read"])
    return jsonify({"notifications": rows, "unread_count": unread_count})


@hub_bp.route("/notifications/<int:notif_id>/read", methods=["PUT"])
def mark_notification_read(notif_id: int):
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    db.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_partner_id = ?",
        (notif_id, actor["id"]),
    )
    db.commit()
    return jsonify({"read": True, "id": notif_id})


@hub_bp.route("/notifications/read-all", methods=["POST"])
def mark_all_notifications_read():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    db.execute(
        "UPDATE notifications SET is_read = 1 WHERE recipient_partner_id = ?",
        (actor["id"],),
    )
    db.commit()
    return jsonify({"read_all": True})


@hub_bp.route("/notifications/<int:notif_id>", methods=["DELETE"])
def delete_notification(notif_id: int):
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    db.execute(
        "DELETE FROM notifications WHERE id = ? AND recipient_partner_id = ?",
        (notif_id, actor["id"]),
    )
    db.commit()
    return jsonify({"deleted": True, "id": notif_id})


# --- Mobile Push Notifications Registration & Test Endpoints ---

@hub_bp.route("/notifications/vapid-public-key", methods=["GET"])
def get_vapid_public_key():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    from backend.modules.push_service import get_or_create_vapid_keys

    public_key, _, _ = get_or_create_vapid_keys(db)
    return jsonify({"public_key": public_key, "configured": bool(public_key)})


@hub_bp.route("/notifications/push-status", methods=["GET"])
def get_push_status():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"subscribed": False, "subscriptions": []})
    db = get_db()
    rows = [
        dict(r)
        for r in db.execute(
            "SELECT id, partner_id, endpoint, device_label, enabled, created_at, updated_at FROM push_subscriptions WHERE partner_id = ? AND enabled = 1 ORDER BY id DESC",
            (actor["id"],),
        ).fetchall()
    ]
    return jsonify({
        "subscribed": len(rows) > 0,
        "subscriptions": rows,
    })


@hub_bp.route("/notifications/push-subscribe", methods=["POST"])
def subscribe_push_notifications():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    sub = data.get("subscription") or {}
    keys = sub.get("keys") or {}
    endpoint = (
        sub.get("endpoint")
        or data.get("endpoint")
        or f"mobile-sw://{actor['id']}/{ (request.headers.get('User-Agent') or 'device')[:48] }"
    ).strip()
    p256dh = (keys.get("p256dh") or data.get("p256dh") or "").strip()
    auth_key = (keys.get("auth") or data.get("auth") or "").strip()
    device_label = (data.get("device_label") or "Mobile Device").strip()
    user_agent = (request.headers.get("User-Agent") or "")[:250]
    enabled = 0 if data.get("enabled") is False else 1

    db = get_db()
    if endpoint.startswith("https://"):
        db.execute(
            "DELETE FROM push_subscriptions WHERE partner_id = ? AND endpoint LIKE 'mobile-sw://%'",
            (actor["id"],),
        )
    db.execute(
        """
        INSERT INTO push_subscriptions (partner_id, endpoint, p256dh, auth, device_label, user_agent, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(endpoint) DO UPDATE SET
            partner_id = excluded.partner_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            device_label = excluded.device_label,
            user_agent = excluded.user_agent,
            enabled = excluded.enabled,
            updated_at = datetime('now')
        """,
        (actor["id"], endpoint, p256dh, auth_key, device_label, user_agent, enabled),
    )
    db.commit()

    rows = [
        dict(r)
        for r in db.execute(
            "SELECT id, partner_id, endpoint, device_label, enabled, created_at, updated_at FROM push_subscriptions WHERE partner_id = ? AND enabled = 1 ORDER BY id DESC",
            (actor["id"],),
        ).fetchall()
    ]
    return jsonify({
        "subscribed": len(rows) > 0,
        "subscriptions": rows,
    }), 201


@hub_bp.route("/notifications/push-subscriptions/<int:sub_id>", methods=["DELETE"])
def delete_push_subscription(sub_id: int):
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401
    db = get_db()
    db.execute(
        "DELETE FROM push_subscriptions WHERE id = ? AND partner_id = ?",
        (sub_id, actor["id"]),
    )
    db.commit()
    return jsonify({"deleted": True, "id": sub_id})


@hub_bp.route("/notifications/push-unsubscribe", methods=["POST"])
def unsubscribe_push_notification():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401
    data = request.get_json(silent=True) or {}
    endpoint = (data.get("endpoint") or "").strip()
    db = get_db()
    if endpoint:
        db.execute(
            "UPDATE push_subscriptions SET enabled = 0, updated_at = datetime('now') WHERE partner_id = ? AND endpoint = ?",
            (actor["id"], endpoint),
        )
    else:
        db.execute(
            "UPDATE push_subscriptions SET enabled = 0, updated_at = datetime('now') WHERE partner_id = ?",
            (actor["id"],),
        )
    db.commit()
    return jsonify({"unsubscribed": True})


@hub_bp.route("/notifications/push-test", methods=["POST"])
def send_test_push_notification():
    actor = getattr(g, "current_partner", None)
    if not actor:
        return jsonify({"error": "Authentication required"}), 401

    db = get_db()
    title = "Mobile Push Alerts Active"
    message = f"Hi {actor['name']}! Push alerts are active for purchase requests, under-review updates, and budget milestones."
    cur = db.execute(
        """
        INSERT INTO notifications (recipient_partner_id, actor_partner_id, notif_type, title, message, link_tab, is_read)
        VALUES (?, ?, 'push_test', ?, ?, 'overview', 0)
        """,
        (actor["id"], actor["id"], title, message),
    )
    db.commit()
    notif = dict(db.execute("SELECT * FROM notifications WHERE id = ?", (cur.lastrowid,)).fetchone())
    dispatched = 0
    try:
        from backend.modules.push_service import dispatch_web_push

        dispatched = dispatch_web_push(
            db,
            recipient_partner_id=actor["id"],
            title=title,
            message=message,
            link_tab="overview",
            notif_type="push_test",
            reference_id=notif["id"],
        )
    except Exception:
        pass
    return jsonify({
        "sent": True,
        "web_push_dispatched": dispatched > 0,
        "notification": notif,
    }), 201


# --- Admin Planning (Projects, Shopping Lists, Notes & Standalone To-Dos) ---

def _hydrate_project(db, project_row) -> dict:
    proj = dict(project_row)
    pid = proj["id"]
    shopping_items = [
        dict(r)
        for r in db.execute(
            """
            SELECT s.*, p.name AS added_by_name, p.avatar_color AS added_by_color
            FROM admin_project_shopping_items s
            LEFT JOIN partners p ON s.added_by = p.id
            WHERE s.project_id = ?
            ORDER BY s.purchased ASC, s.id DESC
            """,
            (pid,),
        ).fetchall()
    ]
    todos = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
            WHERE t.project_id = ?
            ORDER BY t.completed ASC, t.due_date ASC, t.id DESC
            """,
            (pid,),
        ).fetchall()
    ]
    notes = [
        dict(r)
        for r in db.execute(
            """
            SELECT n.*, p.name AS updated_by_name
            FROM admin_project_notes n
            LEFT JOIN partners p ON n.updated_by = p.id
            WHERE n.project_id = ?
            ORDER BY n.updated_at DESC, n.id DESC
            """,
            (pid,),
        ).fetchall()
    ]
    proj["shopping_items"] = shopping_items
    proj["todos"] = todos
    proj["notes"] = notes
    proj["shopping_total"] = round(sum(float(i["estimated_price"] or 0.0) for i in shopping_items), 2)
    proj["shopping_remaining"] = sum(1 for i in shopping_items if not i["purchased"])
    proj["todos_remaining"] = sum(1 for t in todos if not t["completed"])
    return proj


@hub_bp.route("/hub/projects", methods=["GET"])
def list_admin_projects():
    db = get_db()
    rows = db.execute(
        """
        SELECT ap.*, p.name AS created_by_name
        FROM admin_projects ap
        LEFT JOIN partners p ON ap.created_by = p.id
        ORDER BY
            CASE ap.status WHEN 'active' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
            ap.target_date ASC,
            ap.id DESC
        """
    ).fetchall()
    projects = [_hydrate_project(db, r) for r in rows]
    return jsonify({"projects": projects})


@hub_bp.route("/hub/projects", methods=["POST"])
def create_admin_project():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Project title is required"}), 400

    actor = getattr(g, "current_partner", None)
    created_by = actor["id"] if actor else None

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO admin_projects (title, description, status, target_date, color, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            title,
            (data.get("description") or "").strip(),
            data.get("status", "active"),
            data.get("target_date") or None,
            (data.get("color") or "#6366f1").strip(),
            created_by,
        ),
    )
    project_id = cur.lastrowid

    # Optional initial shopping items, todos, or notes
    for item in (data.get("shopping_items") or []):
        if isinstance(item, str):
            item_name = item.strip()
            qty, price, item_notes = "1", 0.0, ""
        else:
            item_name = (item.get("name") or "").strip()
            qty = str(item.get("quantity") or "1").strip() or "1"
            price = round(float(item.get("estimated_price") or 0.0), 2)
            item_notes = (item.get("notes") or "").strip()
        if item_name:
            db.execute(
                """
                INSERT INTO admin_project_shopping_items (project_id, name, quantity, estimated_price, notes, added_by)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (project_id, item_name, qty, price, item_notes, created_by),
            )

    for td in (data.get("todos") or []):
        if isinstance(td, str):
            td_title = td.strip()
            td_assigned, td_due, td_priority = created_by, None, "medium"
        else:
            td_title = (td.get("title") or "").strip()
            td_assigned = td.get("assigned_to") or created_by
            td_due = td.get("due_date") or None
            td_priority = td.get("priority", "medium")
        if td_title:
            db.execute(
                """
                INSERT INTO todos (project_id, title, category, assigned_to, due_date, completed, priority)
                VALUES (?, ?, 'Project', ?, ?, 0, ?)
                """,
                (project_id, td_title, td_assigned, td_due, td_priority),
            )

    for nt in (data.get("notes") or []):
        if isinstance(nt, str):
            nt_title, nt_content = "Project Note", nt.strip()
        else:
            nt_title = (nt.get("title") or "Project Note").strip()
            nt_content = (nt.get("content") or "").strip()
        if nt_content:
            db.execute(
                """
                INSERT INTO admin_project_notes (project_id, title, content, updated_by)
                VALUES (?, ?, ?, ?)
                """,
                (project_id, nt_title, nt_content, created_by),
            )

    db.commit()
    row = db.execute(
        "SELECT ap.*, p.name AS created_by_name FROM admin_projects ap LEFT JOIN partners p ON ap.created_by = p.id WHERE ap.id = ?",
        (project_id,),
    ).fetchone()
    return jsonify(_hydrate_project(db, row)), 201


@hub_bp.route("/hub/projects/<int:project_id>", methods=["PUT"])
def update_admin_project(project_id: int):
    db = get_db()
    existing = db.execute("SELECT * FROM admin_projects WHERE id = ?", (project_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Project not found"}), 404

    data = request.get_json(silent=True) or {}
    title = (data.get("title") if "title" in data else existing["title"] or "").strip()
    if not title:
        return jsonify({"error": "Project title cannot be empty"}), 400
    description = (data.get("description") if "description" in data else existing["description"] or "").strip()
    status = data.get("status", existing["status"])
    target_date = data.get("target_date", existing["target_date"]) or None
    color = (data.get("color") or existing["color"] or "#6366f1").strip()

    db.execute(
        """
        UPDATE admin_projects
        SET title = ?, description = ?, status = ?, target_date = ?, color = ?, updated_at = datetime('now')
        WHERE id = ?
        """,
        (title, description, status, target_date, color, project_id),
    )
    db.commit()
    row = db.execute(
        "SELECT ap.*, p.name AS created_by_name FROM admin_projects ap LEFT JOIN partners p ON ap.created_by = p.id WHERE ap.id = ?",
        (project_id,),
    ).fetchone()
    return jsonify(_hydrate_project(db, row))


@hub_bp.route("/hub/projects/<int:project_id>", methods=["DELETE"])
def delete_admin_project(project_id: int):
    db = get_db()
    db.execute("DELETE FROM admin_projects WHERE id = ?", (project_id,))
    db.commit()
    return jsonify({"deleted": True, "id": project_id})


@hub_bp.route("/hub/projects/<int:project_id>/shopping", methods=["POST"])
def add_project_shopping_item(project_id: int):
    db = get_db()
    if not db.execute("SELECT id FROM admin_projects WHERE id = ?", (project_id,)).fetchone():
        return jsonify({"error": "Project not found"}), 404
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Item name is required"}), 400

    actor = getattr(g, "current_partner", None)
    cur = db.execute(
        """
        INSERT INTO admin_project_shopping_items (project_id, name, quantity, estimated_price, notes, added_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            project_id,
            name,
            str(data.get("quantity") or "1").strip() or "1",
            round(float(data.get("estimated_price") or 0.0), 2),
            (data.get("notes") or "").strip(),
            actor["id"] if actor else None,
        ),
    )
    db.execute("UPDATE admin_projects SET updated_at = datetime('now') WHERE id = ?", (project_id,))
    db.commit()
    item = dict(
        db.execute(
            """
            SELECT s.*, p.name AS added_by_name, p.avatar_color AS added_by_color
            FROM admin_project_shopping_items s
            LEFT JOIN partners p ON s.added_by = p.id
            WHERE s.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    )
    return jsonify(item), 201


@hub_bp.route("/hub/projects/shopping/<int:item_id>/toggle", methods=["PUT"])
def toggle_project_shopping_item(item_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM admin_project_shopping_items WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return jsonify({"error": "Shopping item not found"}), 404
    new_val = 0 if row["purchased"] else 1
    db.execute("UPDATE admin_project_shopping_items SET purchased = ? WHERE id = ?", (new_val, item_id))
    db.commit()
    updated = dict(db.execute("SELECT * FROM admin_project_shopping_items WHERE id = ?", (item_id,)).fetchone())
    return jsonify(updated)


@hub_bp.route("/hub/projects/shopping/<int:item_id>", methods=["DELETE"])
def delete_project_shopping_item(item_id: int):
    db = get_db()
    db.execute("DELETE FROM admin_project_shopping_items WHERE id = ?", (item_id,))
    db.commit()
    return jsonify({"deleted": True, "id": item_id})


@hub_bp.route("/hub/projects/<int:project_id>/notes", methods=["POST"])
def add_project_note(project_id: int):
    db = get_db()
    if not db.execute("SELECT id FROM admin_projects WHERE id = ?", (project_id,)).fetchone():
        return jsonify({"error": "Project not found"}), 404
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()
    title = (data.get("title") or "Note").strip() or "Note"
    if not content:
        return jsonify({"error": "Note content is required"}), 400
    actor = getattr(g, "current_partner", None)
    cur = db.execute(
        """
        INSERT INTO admin_project_notes (project_id, title, content, updated_by)
        VALUES (?, ?, ?, ?)
        """,
        (project_id, title, content, actor["id"] if actor else None),
    )
    db.execute("UPDATE admin_projects SET updated_at = datetime('now') WHERE id = ?", (project_id,))
    db.commit()
    note = dict(
        db.execute(
            "SELECT n.*, p.name AS updated_by_name FROM admin_project_notes n LEFT JOIN partners p ON n.updated_by = p.id WHERE n.id = ?",
            (cur.lastrowid,),
        ).fetchone()
    )
    return jsonify(note), 201


@hub_bp.route("/hub/projects/notes/<int:note_id>", methods=["PUT"])
def update_project_note(note_id: int):
    db = get_db()
    existing = db.execute("SELECT * FROM admin_project_notes WHERE id = ?", (note_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Note not found"}), 404
    data = request.get_json(silent=True) or {}
    title = (data.get("title") if "title" in data else existing["title"] or "Note").strip() or "Note"
    content = (data.get("content") if "content" in data else existing["content"] or "").strip()
    actor = getattr(g, "current_partner", None)
    db.execute(
        """
        UPDATE admin_project_notes
        SET title = ?, content = ?, updated_by = ?, updated_at = datetime('now')
        WHERE id = ?
        """,
        (title, content, actor["id"] if actor else existing["updated_by"], note_id),
    )
    db.commit()
    note = dict(
        db.execute(
            "SELECT n.*, p.name AS updated_by_name FROM admin_project_notes n LEFT JOIN partners p ON n.updated_by = p.id WHERE n.id = ?",
            (note_id,),
        ).fetchone()
    )
    return jsonify(note)


@hub_bp.route("/hub/projects/notes/<int:note_id>", methods=["DELETE"])
def delete_project_note(note_id: int):
    db = get_db()
    db.execute("DELETE FROM admin_project_notes WHERE id = ?", (note_id,))
    db.commit()
    return jsonify({"deleted": True, "id": note_id})


# --- Shared & Project To-Do Lists ---

@hub_bp.route("/hub/todos", methods=["GET"])
def list_todos():
    db = get_db()
    scope = (request.args.get("scope") or "all").strip().lower()
    project_id = request.args.get("project_id")

    where_clauses = []
    params: list = []
    if project_id and str(project_id).isdigit():
        where_clauses.append("t.project_id = ?")
        params.append(int(project_id))
    elif scope == "standalone":
        where_clauses.append("t.project_id IS NULL")
    elif scope == "project":
        where_clauses.append("t.project_id IS NOT NULL")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    rows = [
        dict(r)
        for r in db.execute(
            f"""
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color, ap.title AS project_title
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
            LEFT JOIN admin_projects ap ON t.project_id = ap.id
            {where_sql}
            ORDER BY t.completed ASC, t.due_date ASC, t.id DESC
            """,
            params,
        ).fetchall()
    ]
    return jsonify({"todos": rows})


@hub_bp.route("/hub/todos", methods=["POST"])
def create_todo():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Task title is required"}), 400

    actor = getattr(g, "current_partner", None)
    assigned_to = int(data.get("assigned_to", actor["id"] if actor else 1))
    raw_pid = data.get("project_id")
    project_id = int(raw_pid) if raw_pid is not None and str(raw_pid).isdigit() and int(raw_pid) > 0 else None

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO todos (project_id, title, category, assigned_to, due_date, completed, priority)
        VALUES (?, ?, ?, ?, ?, 0, ?)
        """,
        (
            project_id,
            title,
            data.get("category", "Project" if project_id else "Household"),
            assigned_to,
            data.get("due_date") or None,
            data.get("priority", "medium"),
        ),
    )

    if actor and assigned_to != actor["id"]:
        create_notification(
            db,
            recipient_partner_id=assigned_to,
            actor_partner_id=actor["id"],
            notif_type="todo_assigned",
            title=f"New Task Assigned: {title}",
            message=f"{actor['name']} assigned task \"{title}\" to you.",
            link_tab="admin_planning",
            reference_id=cur.lastrowid,
        )

    db.commit()
    row = dict(
        db.execute(
            """
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color, ap.title AS project_title
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
            LEFT JOIN admin_projects ap ON t.project_id = ap.id
            WHERE t.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    )
    return jsonify(row), 201


@hub_bp.route("/hub/todos/<int:todo_id>/toggle", methods=["PUT"])
def toggle_todo(todo_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
    if not row:
        return jsonify({"error": "Todo not found"}), 404

    new_state = 0 if row["completed"] else 1
    db.execute("UPDATE todos SET completed = ? WHERE id = ?", (new_state, todo_id))
    db.commit()
    updated = dict(
        db.execute(
            """
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color, ap.title AS project_title
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
            LEFT JOIN admin_projects ap ON t.project_id = ap.id
            WHERE t.id = ?
            """,
            (todo_id,),
        ).fetchone()
    )
    return jsonify(updated)


@hub_bp.route("/hub/todos/<int:todo_id>", methods=["DELETE"])
def delete_todo(todo_id: int):
    db = get_db()
    db.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
    db.commit()
    return jsonify({"deleted": True, "id": todo_id})


# --- Recurring Tasks & Scheduled Partner Notifications ---

WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _parse_json_field(raw, default):
    if isinstance(raw, (list, dict)):
        return raw
    try:
        parsed = json.loads(raw or "")
        return parsed if isinstance(parsed, type(default)) else default
    except Exception:
        return default


def _resolve_day_recipients(db, assignment_val) -> list[int]:
    if assignment_val is None or assignment_val == "" or assignment_val == "unassigned":
        return []
    if str(assignment_val).lower() == "both":
        return [int(r["id"]) for r in db.execute("SELECT id FROM partners ORDER BY id ASC").fetchall()]
    if str(assignment_val).isdigit():
        return [int(assignment_val)]
    return []


def check_and_dispatch_recurring_notifications(db, now_utc: datetime | None = None) -> int:
    """Checks active recurring tasks and dispatches notifications to today's assigned partner(s)."""
    utc_now = now_utc or datetime.now(timezone.utc)
    tasks = db.execute(
        "SELECT * FROM recurring_tasks WHERE is_active = 1 AND notify_enabled = 1"
    ).fetchall()
    sent = 0
    for task in tasks:
        offset_min = int(task["timezone_offset_minutes"]) if task["timezone_offset_minutes"] is not None else -480
        local_dt = utc_now + timedelta(minutes=offset_min)
        today_date = local_dt.strftime("%Y-%m-%d")
        today_key = WEEKDAY_KEYS[local_dt.weekday()]
        now_hhmm = local_dt.strftime("%H:%M")

        days_of_week = [str(d).lower() for d in _parse_json_field(task["days_of_week"], [])]
        if today_key not in days_of_week:
            continue
        notify_time = (task["notify_time"] or "20:00").strip()
        if now_hhmm < notify_time:
            continue
        if (task["last_notified_date"] or "") == today_date:
            continue

        # Skip if already completed today
        comp = db.execute(
            "SELECT completed FROM recurring_task_completions WHERE task_id = ? AND occurrence_date = ?",
            (task["id"], today_date),
        ).fetchone()
        if comp and comp["completed"]:
            continue

        assignments = _parse_json_field(task["day_assignments"], {})
        recipients = _resolve_day_recipients(db, assignments.get(today_key))
        if not recipients:
            continue

        steps = _parse_json_field(task["checklist_items"], [])
        detail_preview = ", ".join(str(s) for s in steps[:3]) if steps else (task["description"] or "Scheduled recurring routine.")
        if len(steps) > 3:
            detail_preview += f" (+{len(steps) - 3} more)"

        for pid in recipients:
            create_notification(
                db,
                recipient_partner_id=pid,
                actor_partner_id=None,
                notif_type="recurring_task",
                title=f"Routine Reminder: {task['title']}",
                message=detail_preview,
                link_tab="recurring_tasks",
                reference_id=task["id"],
            )
            sent += 1

        db.execute(
            "UPDATE recurring_tasks SET last_notified_date = ? WHERE id = ?",
            (today_date, task["id"]),
        )
        db.commit()
    return sent


def _hydrate_recurring_task(db, row, now_utc: datetime | None = None) -> dict:
    utc_now = now_utc or datetime.now(timezone.utc)
    offset_min = int(row["timezone_offset_minutes"]) if row["timezone_offset_minutes"] is not None else -480
    local_dt = utc_now + timedelta(minutes=offset_min)
    today_date = local_dt.strftime("%Y-%m-%d")
    today_key = WEEKDAY_KEYS[local_dt.weekday()]

    task = dict(row)
    task["checklist_items"] = _parse_json_field(row["checklist_items"], [])
    task["days_of_week"] = [str(d).lower() for d in _parse_json_field(row["days_of_week"], WEEKDAY_KEYS)]
    task["day_assignments"] = _parse_json_field(row["day_assignments"], {})
    task["today_key"] = today_key
    task["today_date"] = today_date
    task["is_scheduled_today"] = today_key in task["days_of_week"]
    task["today_assignment"] = task["day_assignments"].get(today_key)

    comp = db.execute(
        """
        SELECT c.*, p.name AS completed_by_name
        FROM recurring_task_completions c
        LEFT JOIN partners p ON c.completed_by = p.id
        WHERE c.task_id = ? AND c.occurrence_date = ?
        """,
        (row["id"], today_date),
    ).fetchone()
    if comp:
        comp_dict = dict(comp)
        comp_dict["checked_steps"] = _parse_json_field(comp["checked_steps"], [])
        task["today_completion"] = comp_dict
    else:
        task["today_completion"] = None
    return task


@hub_bp.route("/hub/recurring-tasks", methods=["GET"])
def list_recurring_tasks():
    db = get_db()
    try:
        check_and_dispatch_recurring_notifications(db)
    except Exception:
        pass
    rows = db.execute("SELECT * FROM recurring_tasks ORDER BY is_active DESC, notify_time ASC, id DESC").fetchall()
    return jsonify({"tasks": [_hydrate_recurring_task(db, r) for r in rows]})


@hub_bp.route("/hub/recurring-tasks", methods=["POST"])
def create_recurring_task():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Task title is required"}), 400

    actor = getattr(g, "current_partner", None)
    checklist = [str(x).strip() for x in (data.get("checklist_items") or []) if str(x).strip()]
    days_of_week = [str(d).lower() for d in (data.get("days_of_week") or WEEKDAY_KEYS) if str(d).lower() in WEEKDAY_KEYS]
    if not days_of_week:
        days_of_week = list(WEEKDAY_KEYS)
    day_assignments = data.get("day_assignments") or {}
    frequency = (data.get("frequency") or ("daily" if len(days_of_week) == 7 else "weekly")).strip()
    notify_enabled = 1 if data.get("notify_enabled", True) else 0
    notify_time = (data.get("notify_time") or "20:00").strip()
    tz_offset = int(data.get("timezone_offset_minutes", -480))

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO recurring_tasks
        (title, description, checklist_items, frequency, days_of_week, day_assignments, notify_enabled, notify_time, timezone_offset_minutes, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """,
        (
            title,
            (data.get("description") or "").strip(),
            json.dumps(checklist),
            frequency,
            json.dumps(days_of_week),
            json.dumps(day_assignments),
            notify_enabled,
            notify_time,
            tz_offset,
            actor["id"] if actor else None,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM recurring_tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(_hydrate_recurring_task(db, row)), 201


@hub_bp.route("/hub/recurring-tasks/<int:task_id>", methods=["PUT"])
def update_recurring_task(task_id: int):
    db = get_db()
    existing = db.execute("SELECT * FROM recurring_tasks WHERE id = ?", (task_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Recurring task not found"}), 404

    data = request.get_json(silent=True) or {}
    title = (data.get("title") if "title" in data else existing["title"] or "").strip()
    if not title:
        return jsonify({"error": "Task title cannot be empty"}), 400

    description = (data.get("description") if "description" in data else existing["description"] or "").strip()
    checklist = (
        [str(x).strip() for x in (data.get("checklist_items") or []) if str(x).strip()]
        if "checklist_items" in data
        else _parse_json_field(existing["checklist_items"], [])
    )
    days_of_week = (
        [str(d).lower() for d in (data.get("days_of_week") or []) if str(d).lower() in WEEKDAY_KEYS]
        if "days_of_week" in data
        else _parse_json_field(existing["days_of_week"], WEEKDAY_KEYS)
    )
    day_assignments = (
        data.get("day_assignments") or {}
        if "day_assignments" in data
        else _parse_json_field(existing["day_assignments"], {})
    )
    frequency = (data.get("frequency") or existing["frequency"] or "daily").strip()
    notify_enabled = (1 if data["notify_enabled"] else 0) if "notify_enabled" in data else existing["notify_enabled"]
    notify_time = (data.get("notify_time") or existing["notify_time"] or "20:00").strip()
    tz_offset = int(data.get("timezone_offset_minutes", existing["timezone_offset_minutes"]))
    is_active = (1 if data["is_active"] else 0) if "is_active" in data else existing["is_active"]

    db.execute(
        """
        UPDATE recurring_tasks
        SET title = ?, description = ?, checklist_items = ?, frequency = ?, days_of_week = ?,
            day_assignments = ?, notify_enabled = ?, notify_time = ?, timezone_offset_minutes = ?,
            is_active = ?, updated_at = datetime('now')
        WHERE id = ?
        """,
        (
            title,
            description,
            json.dumps(checklist),
            frequency,
            json.dumps(days_of_week),
            json.dumps(day_assignments),
            notify_enabled,
            notify_time,
            tz_offset,
            is_active,
            task_id,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM recurring_tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify(_hydrate_recurring_task(db, row))


@hub_bp.route("/hub/recurring-tasks/<int:task_id>", methods=["DELETE"])
def delete_recurring_task(task_id: int):
    db = get_db()
    db.execute("DELETE FROM recurring_tasks WHERE id = ?", (task_id,))
    db.commit()
    return jsonify({"deleted": True, "id": task_id})


@hub_bp.route("/hub/recurring-tasks/<int:task_id>/complete", methods=["POST"])
def complete_recurring_task(task_id: int):
    db = get_db()
    existing = db.execute("SELECT * FROM recurring_tasks WHERE id = ?", (task_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Recurring task not found"}), 404

    data = request.get_json(silent=True) or {}
    actor = getattr(g, "current_partner", None)
    offset_min = int(existing["timezone_offset_minutes"]) if existing["timezone_offset_minutes"] is not None else -480
    default_date = (datetime.now(timezone.utc) + timedelta(minutes=offset_min)).strftime("%Y-%m-%d")
    occurrence_date = (data.get("occurrence_date") or default_date).strip()[:10]
    checked_steps = data.get("checked_steps")
    completed = 1 if data.get("completed", True) else 0

    prev = db.execute(
        "SELECT * FROM recurring_task_completions WHERE task_id = ? AND occurrence_date = ?",
        (task_id, occurrence_date),
    ).fetchone()
    if prev:
        new_steps = json.dumps(checked_steps) if checked_steps is not None else prev["checked_steps"]
        db.execute(
            """
            UPDATE recurring_task_completions
            SET completed = ?, checked_steps = ?, completed_by = ?, completed_at = datetime('now')
            WHERE id = ?
            """,
            (completed, new_steps, actor["id"] if actor else prev["completed_by"], prev["id"]),
        )
    else:
        db.execute(
            """
            INSERT INTO recurring_task_completions (task_id, occurrence_date, completed_by, checked_steps, completed)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                task_id,
                occurrence_date,
                actor["id"] if actor else None,
                json.dumps(checked_steps or []),
                completed,
            ),
        )
    db.commit()
    row = db.execute("SELECT * FROM recurring_tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify(_hydrate_recurring_task(db, row))


@hub_bp.route("/hub/recurring-tasks/<int:task_id>/notify-now", methods=["POST"])
def notify_recurring_task_now(task_id: int):
    db = get_db()
    task = db.execute("SELECT * FROM recurring_tasks WHERE id = ?", (task_id,)).fetchone()
    if not task:
        return jsonify({"error": "Recurring task not found"}), 404

    actor = getattr(g, "current_partner", None)
    offset_min = int(task["timezone_offset_minutes"]) if task["timezone_offset_minutes"] is not None else -480
    local_dt = datetime.now(timezone.utc) + timedelta(minutes=offset_min)
    today_key = WEEKDAY_KEYS[local_dt.weekday()]
    assignments = _parse_json_field(task["day_assignments"], {})
    recipients = _resolve_day_recipients(db, assignments.get(today_key))
    if not recipients and actor:
        recipients = [actor["id"]]

    steps = _parse_json_field(task["checklist_items"], [])
    detail_preview = ", ".join(str(s) for s in steps[:3]) if steps else (task["description"] or "Routine reminder.")

    for pid in recipients:
        create_notification(
            db,
            recipient_partner_id=pid,
            actor_partner_id=actor["id"] if actor else None,
            notif_type="recurring_task",
            title=f"Routine Reminder: {task['title']}",
            message=detail_preview,
            link_tab="recurring_tasks",
            reference_id=task_id,
        )
    return jsonify({"sent_to": recipients, "count": len(recipients)})


# --- Shared Grocery List ---

@hub_bp.route("/hub/groceries", methods=["GET"])
def list_groceries():
    db = get_db()
    rows = [
        dict(r)
        for r in db.execute(
            """
            SELECT g.*, p.name AS added_by_name, p.avatar_color AS added_by_color
            FROM grocery_items g
            LEFT JOIN partners p ON g.added_by = p.id
            ORDER BY g.checked ASC, g.aisle_category ASC, g.id DESC
            """
        ).fetchall()
    ]
    estimated_total = round(sum(float(r["estimated_price"] or 0.0) for r in rows), 2)
    unchecked_total = round(sum(float(r["estimated_price"] or 0.0) for r in rows if not r["checked"]), 2)
    return jsonify({
        "items": rows,
        "estimated_total": estimated_total,
        "unchecked_total": unchecked_total,
    })


@hub_bp.route("/hub/groceries", methods=["POST"])
def create_grocery_item():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Grocery item name is required"}), 400

    actor = getattr(g, "current_partner", None)
    added_by = actor["id"] if actor else int(data.get("added_by", 1))

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO grocery_items (name, aisle_category, quantity, estimated_price, added_by, checked)
        VALUES (?, ?, ?, ?, ?, 0)
        """,
        (
            name,
            data.get("aisle_category", "Produce"),
            str(data.get("quantity", "1")).strip() or "1",
            round(float(data.get("estimated_price", 0.0)), 2),
            added_by,
        ),
    )
    db.commit()
    row = dict(
        db.execute(
            """
            SELECT g.*, p.name AS added_by_name, p.avatar_color AS added_by_color
            FROM grocery_items g
            LEFT JOIN partners p ON g.added_by = p.id
            WHERE g.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    )
    return jsonify(row), 201


@hub_bp.route("/hub/groceries/<int:item_id>/toggle", methods=["PUT"])
def toggle_grocery_item(item_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM grocery_items WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return jsonify({"error": "Grocery item not found"}), 404

    new_checked = 0 if row["checked"] else 1
    db.execute("UPDATE grocery_items SET checked = ? WHERE id = ?", (new_checked, item_id))
    db.commit()
    updated = dict(
        db.execute(
            """
            SELECT g.*, p.name AS added_by_name, p.avatar_color AS added_by_color
            FROM grocery_items g
            LEFT JOIN partners p ON g.added_by = p.id
            WHERE g.id = ?
            """,
            (item_id,),
        ).fetchone()
    )
    return jsonify(updated)


@hub_bp.route("/hub/groceries/clear-checked", methods=["POST"])
def clear_checked_groceries():
    db = get_db()
    db.execute("DELETE FROM grocery_items WHERE checked = 1")
    db.commit()
    return jsonify({"cleared": True})
