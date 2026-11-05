import os
from pathlib import Path
from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from backend.config import Config
from backend.database import bump_state_version, get_db, init_db
from backend.security import load_current_session
from backend.modules.auth_webauthn import auth_bp
from backend.modules.finance import finance_bp
from backend.modules.requests_and_plans import requests_bp
from backend.modules.couples_hub import hub_bp

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/setup-status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/webauthn/authenticate/options",
    "/api/auth/webauthn/authenticate/verify",
}

LOCKED_ALLOWED_API_PATHS = PUBLIC_API_PATHS | {
    "/api/auth/unlock-password",
    "/api/auth/lock",
}


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(
        __name__,
        static_folder=str(FRONTEND_DIST) if FRONTEND_DIST.exists() else None,
        static_url_path="",
    )
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)

    allowed_origin = app.config.get("WEBAUTHN_ORIGIN", "http://localhost:5173")
    CORS(
        app,
        resources={r"/api/*": {"origins": [allowed_origin, "http://localhost:5173", "http://127.0.0.1:5173"]}},
        supports_credentials=True,
    )

    init_db(app)

    @app.before_request
    def enforce_api_authentication():
        load_current_session()
        path = request.path

        if not path.startswith("/api/"):
            return None

        if request.method == "OPTIONS":
            return None

        if path in PUBLIC_API_PATHS:
            return None

        # Allow initial partner creation only before onboarding is completed
        if path == "/api/auth/partners" and request.method == "POST":
            db = get_db()
            onb = db.execute("SELECT value FROM app_settings WHERE key = 'onboarding_completed'").fetchone()
            p_cnt = db.execute("SELECT COUNT(*) AS cnt FROM partners").fetchone()["cnt"]
            if not (onb and onb["value"] == "1" and p_cnt >= 1):
                return None

        if not getattr(g, "current_partner", None):
            return jsonify({"error": "Authentication required. Please log in."}), 401

        if getattr(g, "current_session", None) and g.current_session.get("is_screen_locked"):
            if path not in LOCKED_ALLOWED_API_PATHS:
                return jsonify({"error": "Session is screen-locked. Unlock with your Passkey or password."}), 423

        return None

    @app.after_request
    def apply_security_headers(response):
        if (
            request.path.startswith("/api/")
            and request.method in ("POST", "PUT", "DELETE")
            and 200 <= response.status_code < 300
        ):
            try:
                db = get_db()
                bump_state_version(db)
                db.commit()
            except Exception:
                pass

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()"
        )
        if request.is_secure or request.headers.get("X-Forwarded-Proto", "") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        return response

    # Register modular Blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(finance_bp)
    app.register_blueprint(requests_bp)
    app.register_blueprint(hub_bp)

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({
            "status": "ok",
            "app": "GibsonFamily Modular Hub",
            "plaid_env": app.config.get("PLAID_ENV", "production"),
            "plaid_configured": bool(app.config.get("PLAID_CLIENT_ID") and app.config.get("PLAID_SECRET")),
        })

    def _build_overview_payload(db, actor):
        pending_reqs = db.execute("SELECT COUNT(*) AS cnt FROM purchase_requests WHERE status IN ('pending', 'under_review')").fetchone()["cnt"]
        under_review_reqs = db.execute("SELECT COUNT(*) AS cnt FROM purchase_requests WHERE status = 'under_review'").fetchone()["cnt"]
        planned_reqs = db.execute("SELECT COUNT(*) AS cnt FROM purchase_requests WHERE status = 'budget_planned'").fetchone()["cnt"]
        open_todos = db.execute("SELECT COUNT(*) AS cnt FROM todos WHERE completed = 0").fetchone()["cnt"]
        unchecked_groceries = db.execute("SELECT COUNT(*) AS cnt FROM grocery_items WHERE checked = 0").fetchone()["cnt"]
        active_admin = db.execute("SELECT COUNT(*) AS cnt FROM admin_records WHERE status != 'completed'").fetchone()["cnt"]
        future_goals = db.execute("SELECT COUNT(*) AS cnt FROM future_purchases").fetchone()["cnt"]
        unread_notifs = db.execute(
            "SELECT COUNT(*) AS cnt FROM notifications WHERE recipient_partner_id = ? AND is_read = 0",
            (actor["id"],),
        ).fetchone()["cnt"]
        sv_row = db.execute("SELECT value FROM app_settings WHERE key = 'state_version'").fetchone()
        state_version = int(sv_row["value"]) if sv_row and str(sv_row["value"]).isdigit() else 1
        return {
            "state_version": state_version,
            "pending_requests": pending_reqs,
            "under_review_requests": under_review_reqs,
            "planned_requests": planned_reqs,
            "open_todos": open_todos,
            "unchecked_groceries": unchecked_groceries,
            "active_admin_records": active_admin,
            "future_goals": future_goals,
            "unread_notifications": unread_notifs,
        }

    @app.route("/api/overview", methods=["GET"])
    def overview():
        db = get_db()
        actor = g.current_partner
        return jsonify(_build_overview_payload(db, actor))

    @app.route("/api/sync-pulse", methods=["GET"])
    def sync_pulse():
        db = get_db()
        actor = g.current_partner
        return jsonify(_build_overview_payload(db, actor))

    # Serve compiled React SPA in production (e.g., on Render)
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path: str):
        if path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        if FRONTEND_DIST.exists():
            target = FRONTEND_DIST / path
            if path and target.exists() and target.is_file():
                return send_from_directory(str(FRONTEND_DIST), path)
            index_file = FRONTEND_DIST / "index.html"
            if index_file.exists():
                return send_from_directory(str(FRONTEND_DIST), "index.html")
        return jsonify({
            "app": "GibsonFamily Hub API",
            "message": "Frontend dist not built yet. Run `npm run build --prefix frontend`.",
        })

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
