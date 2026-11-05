import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / ".env"

load_dotenv(dotenv_path=ENV_PATH, override=False)


def _get_env_case_insensitive(key: str, default: str = "") -> str:
    for k, v in os.environ.items():
        if k.strip().lower() == key.lower():
            return v.strip()
    return default


class Config:
    SECRET_KEY = _get_env_case_insensitive("FLASK_SECRET_KEY", "gibson-family-dev-secret-key")
    PLAID_CLIENT_ID = _get_env_case_insensitive("plaid_client_id", "")
    PLAID_PRODUCTION_SECRET = _get_env_case_insensitive("plaid_production_secret", "")
    PLAID_SANDBOX_SECRET = _get_env_case_insensitive("plaid_sandbox_secret", "")

    # Determine environment: default to 'production' whenever plaid_production_secret is provided
    _raw_env = _get_env_case_insensitive("PLAID_ENV", "").lower()
    if _raw_env in ("production", "development", "sandbox"):
        PLAID_ENV = _raw_env
    elif PLAID_PRODUCTION_SECRET:
        PLAID_ENV = "production"
    else:
        PLAID_ENV = "sandbox"

    # Select the matching secret for the active Plaid environment
    if PLAID_ENV == "production":
        PLAID_SECRET = (
            PLAID_PRODUCTION_SECRET
            or _get_env_case_insensitive("plaid_secret", "")
        )
    else:
        PLAID_SECRET = (
            PLAID_SANDBOX_SECRET
            or _get_env_case_insensitive("plaid_secret", "")
            or PLAID_PRODUCTION_SECRET
        )

    PLAID_BASE_URL = {
        "production": "https://production.plaid.com",
        "development": "https://development.plaid.com",
        "sandbox": "https://sandbox.plaid.com",
    }.get(PLAID_ENV, "https://production.plaid.com")

    PLAID_REDIRECT_URI = _get_env_case_insensitive(
        "PLAID_REDIRECT_URI", "https://gibsonfamily.onrender.com"
    )

    DATABASE_PATH = _get_env_case_insensitive(
        "DATABASE_PATH",
        str(Path(__file__).resolve().parent / "instance" / "gibson_family.db"),
    )

    WEBAUTHN_RP_ID = _get_env_case_insensitive("WEBAUTHN_RP_ID", "localhost")
    WEBAUTHN_RP_NAME = _get_env_case_insensitive("WEBAUTHN_RP_NAME", "GibsonFamily Hub")
    WEBAUTHN_ORIGIN = _get_env_case_insensitive(
        "WEBAUTHN_ORIGIN", "https://gibsonfamily.onrender.com"
    )
