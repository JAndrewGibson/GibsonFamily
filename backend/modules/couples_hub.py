from flask import Blueprint, jsonify, request
from backend.database import get_db

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

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO admin_records (title, record_type, owner_partner_id, status, due_or_renewal_date, provider_or_location, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            title,
            data.get("record_type", "medical"),
            int(data.get("owner_partner_id", 1)),
            data.get("status", "todo"),
            data.get("due_or_renewal_date") or None,
            (data.get("provider_or_location") or "").strip(),
            (data.get("notes") or "").strip(),
        ),
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

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO todos (title, category, assigned_to, due_date, completed, priority)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (
            title,
            data.get("category", "Household"),
            int(data.get("assigned_to", 1)),
            data.get("due_date") or None,
            data.get("priority", "medium"),
        ),
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
            int(data.get("added_by", 1)),
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

