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
    return jsonify({"sent": True, "notification": notif}), 201


# --- Couples Admin & Medical Paperwork ---

@hub_bp.route("/hub/admin-records", methods=["GET"])
def list_admin_records():
    db = get_db()
    rows = [
        dict(r)
        for r in db.execute(
            """
            SELECT ar.*, p.name AS owner_name, p.avatar_color AS owner_color
            FROM admin_records ar
            LEFT JOIN partners p ON ar.owner_partner_id = p.id
            ORDER BY
                CASE ar.status
                    WHEN 'renewal_needed' THEN 1
                    WHEN 'in_progress' THEN 2
                    WHEN 'todo' THEN 3
                    ELSE 4
                END,
                ar.due_or_renewal_date ASC
            """
        ).fetchall()
    ]
    return jsonify({"records": rows})


@hub_bp.route("/hub/admin-records", methods=["POST"])
def create_admin_record():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Title is required"}), 400

    actor = getattr(g, "current_partner", None)
    owner_id = int(data.get("owner_partner_id", actor["id"] if actor else 1))

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO admin_records (title, record_type, owner_partner_id, status, due_or_renewal_date, provider_or_location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            title,
            data.get("record_type", "medical"),
            owner_id,
            data.get("status", "todo"),
            data.get("due_or_renewal_date") or None,
            (data.get("provider_or_location") or "").strip(),
            (data.get("notes") or "").strip(),
        ),
    )

    if actor and owner_id != actor["id"]:
        create_notification(
            db,
            recipient_partner_id=owner_id,
            actor_partner_id=actor["id"],
            notif_type="admin_assigned",
            title=f"Admin / Medical Task Assigned: {title}",
            message=f"{actor['name']} assigned \"{title}\" to you.",
            link_tab="admin_docs",
            reference_id=cur.lastrowid,
        )

    db.commit()
    row = dict(
        db.execute(
            """
            SELECT ar.*, p.name AS owner_name, p.avatar_color AS owner_color
            FROM admin_records ar
            LEFT JOIN partners p ON ar.owner_partner_id = p.id
            WHERE ar.id = ?
            """,
            (cur.lastrowid,),
        ).fetchone()
    )
    return jsonify(row), 201


@hub_bp.route("/hub/admin-records/<int:record_id>", methods=["PUT"])
def update_admin_record(record_id: int):
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.execute("SELECT * FROM admin_records WHERE id = ?", (record_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Admin record not found"}), 404

    status = data.get("status", existing["status"])
    notes = data.get("notes", existing["notes"])
    db.execute(
        "UPDATE admin_records SET status = ?, notes = ? WHERE id = ?",
        (status, notes, record_id),
    )
    db.commit()
    row = dict(
        db.execute(
            """
            SELECT ar.*, p.name AS owner_name, p.avatar_color AS owner_color
            FROM admin_records ar
            LEFT JOIN partners p ON ar.owner_partner_id = p.id
            WHERE ar.id = ?
            """,
            (record_id,),
        ).fetchone()
    )
    return jsonify(row)


@hub_bp.route("/hub/admin-records/<int:record_id>", methods=["DELETE"])
def delete_admin_record(record_id: int):
    db = get_db()
    db.execute("DELETE FROM admin_records WHERE id = ?", (record_id,))
    db.commit()
    return jsonify({"deleted": True, "id": record_id})


# --- Shared To-Do Lists ---

@hub_bp.route("/hub/todos", methods=["GET"])
def list_todos():
    db = get_db()
    rows = [
        dict(r)
        for r in db.execute(
            """
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
            ORDER BY t.completed ASC, t.due_date ASC, t.id DESC
            """
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

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO todos (title, category, assigned_to, due_date, completed, priority)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (
            title,
            data.get("category", "Household"),
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
            title=f"New Shared Task: {title}",
            message=f"{actor['name']} assigned task \"{title}\" to you.",
            link_tab="todos",
            reference_id=cur.lastrowid,
        )

    db.commit()
    row = dict(
        db.execute(
            """
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
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
            SELECT t.*, p.name AS assigned_name, p.avatar_color AS assigned_color
            FROM todos t
            LEFT JOIN partners p ON t.assigned_to = p.id
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
