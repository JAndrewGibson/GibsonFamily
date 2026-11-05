import math
from datetime import date, timedelta
from flask import Blueprint, jsonify, request
from backend.database import get_db

requests_bp = Blueprint("requests_and_plans", __name__, url_prefix="/api")


def _compute_timeline_metrics(target_amount: float, saved_amount: float, monthly_contribution: float, target_date_str: str | None):
    remaining = max(0.0, round(target_amount - saved_amount, 2))
    progress_pct = round((saved_amount / target_amount) * 100, 1) if target_amount > 0 else 100.0
    months_to_goal = None
    estimated_ready_date = None

    if remaining <= 0:
        months_to_goal = 0
        estimated_ready_date = date.today().isoformat()
    elif monthly_contribution and monthly_contribution > 0:
        months_to_goal = math.ceil(remaining / monthly_contribution)
        est_date = date.today() + timedelta(days=30 * months_to_goal)
        estimated_ready_date = est_date.isoformat()

    required_monthly_for_target_date = None
    if target_date_str and remaining > 0:
        try:
            td = date.fromisoformat(target_date_str[:10])
            days_left = max(1, (td - date.today()).days)
            months_left = max(1.0, round(days_left / 30.0, 1))
            required_monthly_for_target_date = round(remaining / months_left, 2)
        except ValueError:
            pass

    return {
        "remaining_amount": remaining,
        "progress_pct": min(100.0, progress_pct),
        "months_to_goal": months_to_goal,
        "estimated_ready_date": estimated_ready_date,
        "required_monthly_for_target_date": required_monthly_for_target_date,
    }


def _hydrate_request(db, req_row) -> dict:
    r = dict(req_row)
    comments = [
        dict(c)
        for c in db.execute(
            """
            SELECT rc.*, p.name AS partner_name, p.avatar_color AS partner_color
            FROM request_comments rc
            JOIN partners p ON rc.partner_id = p.id
            WHERE rc.request_id = ?
            ORDER BY rc.id ASC
            """,
            (r["id"],),
        ).fetchall()
    ]
    r["comments"] = comments
    r["timeline"] = _compute_timeline_metrics(
        float(r["amount"]),
        float(r["saved_amount"] or 0.0),
        float(r["proposed_monthly_contribution"] or 0.0),
        r.get("proposed_target_date"),
    )
    return r


@requests_bp.route("/requests", methods=["GET"])
def list_requests():
    db = get_db()
    rows = db.execute(
        """
        SELECT pr.*,
               req_p.name AS requester_name,
               req_p.avatar_color AS requester_color,
               rev_p.name AS reviewer_name,
               rev_p.avatar_color AS reviewer_color
        FROM purchase_requests pr
        JOIN partners req_p ON pr.requester_id = req_p.id
        JOIN partners rev_p ON pr.reviewer_id = rev_p.id
        ORDER BY
            CASE pr.status
                WHEN 'pending' THEN 1
                WHEN 'budget_planned' THEN 2
                WHEN 'approved' THEN 3
                WHEN 'denied' THEN 4
                ELSE 5
            END,
            pr.id DESC
        """
    ).fetchall()
    return jsonify({"requests": [_hydrate_request(db, row) for row in rows]})


@requests_bp.route("/requests", methods=["POST"])
def create_request():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    amount = float(data.get("amount", 0))
    if not title or amount <= 0:
        return jsonify({"error": "Title and a positive amount are required"}), 400

    requester_id = int(data.get("requester_id", 2))
    reviewer_id = int(data.get("reviewer_id", 1 if requester_id == 2 else 2))
    proposed_monthly = float(data["proposed_monthly_contribution"]) if data.get("proposed_monthly_contribution") else None
    proposed_target_date = data.get("proposed_target_date") or None

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO purchase_requests (
            requester_id, reviewer_id, title, description, category,
            amount, priority, url, status, proposed_monthly_contribution,
            proposed_target_date, saved_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        """,
        (
            requester_id,
            reviewer_id,
            title,
            (data.get("description") or "").strip(),
            data.get("category", "Entertainment & Gaming"),
            round(amount, 2),
            data.get("priority", "medium"),
            (data.get("url") or "").strip(),
            proposed_monthly,
            proposed_target_date,
            float(data.get("saved_amount", 0.0)),
        ),
    )
    req_id = cur.lastrowid

    initial_note = (data.get("initial_comment") or "").strip()
    if initial_note:
        db.execute(
            "INSERT INTO request_comments (request_id, partner_id, comment, action_type) VALUES (?, ?, ?, 'comment')",
            (req_id, requester_id, initial_note),
        )

    db.commit()
    row = db.execute(
        """
        SELECT pr.*,
               req_p.name AS requester_name,
               req_p.avatar_color AS requester_color,
               rev_p.name AS reviewer_name,
               rev_p.avatar_color AS reviewer_color
        FROM purchase_requests pr
        JOIN partners req_p ON pr.requester_id = req_p.id
        JOIN partners rev_p ON pr.reviewer_id = rev_p.id
        WHERE pr.id = ?
        """,
        (req_id,),
    ).fetchone()
    return jsonify(_hydrate_request(db, row)), 201


@requests_bp.route("/requests/<int:req_id>/decision", methods=["POST"])
def decide_request(req_id: int):
    """
    Allows a partner to:
    - approve ('approved')
    - deny ('denied')
    - set up a budget/timeline ('budget_planned') with monthly_contribution, target_date, and optional initial saved_amount
    """
    data = request.get_json(silent=True) or {}
    action = data.get("status") or data.get("action")
    if action not in ("approved", "denied", "budget_planned", "pending", "purchased"):
        return jsonify({"error": "Invalid decision status. Must be approved, denied, budget_planned, or purchased."}), 400

    db = get_db()
    existing = db.execute("SELECT * FROM purchase_requests WHERE id = ?", (req_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Purchase request not found"}), 404

    partner_id = int(data.get("partner_id", existing["reviewer_id"]))
    decision_notes = (data.get("decision_notes") or "").strip()
    monthly_contrib = (
        float(data["proposed_monthly_contribution"])
        if data.get("proposed_monthly_contribution") is not None and data.get("proposed_monthly_contribution") != ""
        else existing["proposed_monthly_contribution"]
    )
    target_date = data.get("proposed_target_date") or existing["proposed_target_date"]
    saved_amount = (
        float(data["saved_amount"])
        if data.get("saved_amount") is not None and data.get("saved_amount") != ""
        else float(existing["saved_amount"] or 0.0)
    )
    if action == "approved" and saved_amount == 0.0:
        saved_amount = float(existing["amount"])

    db.execute(
        """
        UPDATE purchase_requests
        SET status = ?,
            decision_notes = ?,
            proposed_monthly_contribution = ?,
            proposed_target_date = ?,
            saved_amount = ?,
            updated_at = datetime('now')
        WHERE id = ?
        """,
        (action, decision_notes, monthly_contrib, target_date, saved_amount, req_id),
    )

    action_type_map = {
        "approved": "approve",
        "denied": "deny",
        "budget_planned": "propose_plan",
        "purchased": "approve",
    }
    log_text = decision_notes or {
        "approved": "Approved this purchase request!",
        "denied": "Declined this purchase request for now.",
        "budget_planned": f"Set up a budget & timeline: ${monthly_contrib or 0:.0f}/mo targeting {target_date or 'flexible date'}.",
        "purchased": "Marked as purchased!",
    }.get(action, f"Updated status to {action}")

    db.execute(
        "INSERT INTO request_comments (request_id, partner_id, comment, action_type) VALUES (?, ?, ?, ?)",
        (req_id, partner_id, log_text, action_type_map.get(action, "comment")),
    )

    # If a budget/timeline was set up, automatically create or update a linked Future Purchase plan!
    if action == "budget_planned":
        linked = db.execute(
            "SELECT id FROM future_purchases WHERE linked_request_id = ?",
            (req_id,),
        ).fetchone()
        if linked:
            db.execute(
                """
                UPDATE future_purchases
                SET current_saved = ?, monthly_contribution = ?, target_date = ?, notes = ?
                WHERE id = ?
                """,
                (
                    saved_amount,
                    monthly_contrib or 100.0,
                    target_date,
                    decision_notes or f"Budget timeline for Request #{req_id}",
                    linked["id"],
                ),
            )
        else:
            db.execute(
                """
                INSERT INTO future_purchases (
                    title, category, target_amount, current_saved, monthly_contribution,
                    target_date, priority, status, linked_request_id, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'saving', ?, ?)
                """,
                (
                    existing["title"],
                    existing["category"],
                    existing["amount"],
                    saved_amount,
                    monthly_contrib or 100.0,
                    target_date,
                    existing["priority"],
                    req_id,
                    decision_notes or f"Created from Partner Request #{req_id}",
                ),
            )

    db.commit()
    row = db.execute(
        """
        SELECT pr.*,
               req_p.name AS requester_name,
               req_p.avatar_color AS requester_color,
               rev_p.name AS reviewer_name,
               rev_p.avatar_color AS reviewer_color
        FROM purchase_requests pr
        JOIN partners req_p ON pr.requester_id = req_p.id
        JOIN partners rev_p ON pr.reviewer_id = rev_p.id
        WHERE pr.id = ?
        """,
        (req_id,),
    ).fetchone()
    return jsonify(_hydrate_request(db, row))


@requests_bp.route("/requests/<int:req_id>/contribute", methods=["POST"])
def contribute_to_request(req_id: int):
    data = request.get_json(silent=True) or {}
    add_amount = float(data.get("amount", 0))
    partner_id = int(data.get("partner_id", 1))
    if add_amount <= 0:
        return jsonify({"error": "Contribution amount must be positive"}), 400

    db = get_db()
    existing = db.execute("SELECT * FROM purchase_requests WHERE id = ?", (req_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Request not found"}), 404

    new_saved = round(float(existing["saved_amount"] or 0.0) + add_amount, 2)
    new_status = "approved" if new_saved >= float(existing["amount"]) and existing["status"] == "budget_planned" else existing["status"]

    db.execute(
        "UPDATE purchase_requests SET saved_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
        (new_saved, new_status, req_id),
    )
    db.execute(
        "INSERT INTO request_comments (request_id, partner_id, comment, action_type) VALUES (?, ?, ?, 'contribute')",
        (req_id, partner_id, f"Added ${add_amount:.2f} to savings goal (Total saved: ${new_saved:.2f})."),
    )
    db.execute(
        "UPDATE future_purchases SET current_saved = ? WHERE linked_request_id = ?",
        (new_saved, req_id),
    )
    db.commit()

    row = db.execute(
        """
        SELECT pr.*,
               req_p.name AS requester_name,
               req_p.avatar_color AS requester_color,
               rev_p.name AS reviewer_name,
               rev_p.avatar_color AS reviewer_color
        FROM purchase_requests pr
        JOIN partners req_p ON pr.requester_id = req_p.id
        JOIN partners rev_p ON pr.reviewer_id = rev_p.id
        WHERE pr.id = ?
        """,
        (req_id,),
    ).fetchone()
    return jsonify(_hydrate_request(db, row))


@requests_bp.route("/requests/<int:req_id>/comments", methods=["POST"])
def add_request_comment(req_id: int):
    data = request.get_json(silent=True) or {}
    comment = (data.get("comment") or "").strip()
    partner_id = int(data.get("partner_id", 1))
    if not comment:
        return jsonify({"error": "Comment cannot be empty"}), 400

    db = get_db()
    db.execute(
        "INSERT INTO request_comments (request_id, partner_id, comment, action_type) VALUES (?, ?, ?, 'comment')",
        (req_id, partner_id, comment),
    )
    db.commit()
    row = db.execute(
        """
        SELECT pr.*,
               req_p.name AS requester_name,
               req_p.avatar_color AS requester_color,
               rev_p.name AS reviewer_name,
               rev_p.avatar_color AS reviewer_color
        FROM purchase_requests pr
        JOIN partners req_p ON pr.requester_id = req_p.id
        JOIN partners rev_p ON pr.reviewer_id = rev_p.id
        WHERE pr.id = ?
        """,
        (req_id,),
    ).fetchone()
    return jsonify(_hydrate_request(db, row)), 201


@requests_bp.route("/future-purchases", methods=["GET"])
def list_future_purchases():
    db = get_db()
    rows = db.execute("SELECT * FROM future_purchases ORDER BY id DESC").fetchall()
    plans = []
    for r in rows:
        item = dict(r)
        item["timeline"] = _compute_timeline_metrics(
            float(item["target_amount"]),
            float(item["current_saved"]),
            float(item["monthly_contribution"]),
            item.get("target_date"),
        )
        plans.append(item)
    return jsonify({"future_purchases": plans})


@requests_bp.route("/future-purchases", methods=["POST"])
def create_future_purchase():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    target_amount = float(data.get("target_amount", 0))
    if not title or target_amount <= 0:
        return jsonify({"error": "Title and positive target_amount are required"}), 400

    current_saved = float(data.get("current_saved", 0.0))
    monthly_contribution = float(data.get("monthly_contribution", 100.0))
    target_date = data.get("target_date") or None

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO future_purchases (
            title, category, target_amount, current_saved, monthly_contribution,
            target_date, priority, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'saving', ?)
        """,
        (
            title,
            data.get("category", "Home & Lifestyle"),
            round(target_amount, 2),
            round(current_saved, 2),
            round(monthly_contribution, 2),
            target_date,
            data.get("priority", "medium"),
            (data.get("notes") or "").strip(),
        ),
    )
    db.commit()
    row = dict(db.execute("SELECT * FROM future_purchases WHERE id = ?", (cur.lastrowid,)).fetchone())
    row["timeline"] = _compute_timeline_metrics(
        float(row["target_amount"]),
        float(row["current_saved"]),
        float(row["monthly_contribution"]),
        row.get("target_date"),
    )
    return jsonify(row), 201


@requests_bp.route("/future-purchases/<int:plan_id>/contribute", methods=["POST"])
def contribute_future_purchase(plan_id: int):
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount", 0))
    if amount <= 0:
        return jsonify({"error": "Positive contribution amount required"}), 400

    db = get_db()
    row = db.execute("SELECT * FROM future_purchases WHERE id = ?", (plan_id,)).fetchone()
    if not row:
        return jsonify({"error": "Future purchase plan not found"}), 404

    new_saved = round(float(row["current_saved"]) + amount, 2)
    new_status = "ready" if new_saved >= float(row["target_amount"]) else row["status"]
    db.execute(
        "UPDATE future_purchases SET current_saved = ?, status = ? WHERE id = ?",
        (new_saved, new_status, plan_id),
    )
    if row["linked_request_id"]:
        db.execute(
            "UPDATE purchase_requests SET saved_amount = ?, updated_at = datetime('now') WHERE id = ?",
            (new_saved, row["linked_request_id"]),
        )
    db.commit()
    updated = dict(db.execute("SELECT * FROM future_purchases WHERE id = ?", (plan_id,)).fetchone())
    updated["timeline"] = _compute_timeline_metrics(
        float(updated["target_amount"]),
        float(updated["current_saved"]),
        float(updated["monthly_contribution"]),
        updated.get("target_date"),
    )
    return jsonify(updated)


@requests_bp.route("/future-purchases/<int:plan_id>", methods=["DELETE"])
def delete_future_purchase(plan_id: int):
    db = get_db()
    db.execute("DELETE FROM future_purchases WHERE id = ?", (plan_id,))
    db.commit()
    return jsonify({"deleted": True, "id": plan_id})

