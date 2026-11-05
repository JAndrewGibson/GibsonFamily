import os
from pathlib import Path
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from backend.config import Config
from backend.database import get_db, init_db
from backend.modules.auth_webauthn import auth_bp
from backend.modules.finance import finance_bp
from backend.modules.requests_and_plans import requests_bp
from backend.modules.couples_hub import hub_bp

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(
        __name__,
        static_folder=str(FRONTEND_DIST) if FRONTEND_DIST.exists() else None,
        static_url_path="",
    )
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    init_db(app)

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

    @app.route("/api/overview", methods=["GET"])
    def overview():
        db = get_db()
        pending_reqs = db.execute("SELECT COUNT(*) AS cnt FROM purchase_requests WHERE status = 'pending'").fetchone()["cnt"]
        planned_reqs = db.execute("SELECT COUNT(*) AS cnt FROM purchase_requests WHERE status = 'budget_planned'").fetchone()["cnt"]
        open_todos = db.execute("SELECT COUNT(*) AS cnt FROM todos WHERE completed = 0").fetchone()["cnt"]
        unchecked_groceries = db.execute("SELECT COUNT(*) AS cnt FROM grocery_items WHERE checked = 0").fetchone()["cnt"]
        active_admin = db.execute("SELECT COUNT(*) AS cnt FROM admin_records WHERE status != 'completed'").fetchone()["cnt"]
        future_goals = db.execute("SELECT COUNT(*) AS cnt FROM future_purchases").fetchone()["cnt"]
        return jsonify({
            "pending_requests": pending_reqs,
            "planned_requests": planned_reqs,
            "open_todos": open_todos,
            "unchecked_groceries": unchecked_groceries,
            "active_admin_records": active_admin,
            "future_goals": future_goals,
        })

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


# Expose a module-level `app` for Gunicorn (`gunicorn backend.app:app`)
app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
