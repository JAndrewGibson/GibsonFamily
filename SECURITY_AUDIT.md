# Security Audit & Exploit Risk Assessment

**Application:** GibsonFamily Hub (`https://gibsonfamily.onrender.com`)  
**Scope:** Backend (`backend/app.py`, `backend/security.py`, `backend/database.py`, modules: `auth_webauthn.py`, `finance.py`, `requests_and_plans.py`, `couples_hub.py`), Frontend (`frontend/src/`, `sw.js`), and Deployment (`render.yaml`).  
**Audit Date:** November 2026

---

## Executive Summary

The application has multiple solid security foundations in place:
- Session tokens are hashed via SHA-256 before storage in SQLite (`auth_sessions`).
- Passwords are encrypted with PBKDF2 (`werkzeug.security`).
- Plaid access tokens are encrypted at rest using custom PBKDF2 key derivation and HMAC-SHA256 authenticated encryption.
- HTTP security headers (`nosniff`, `DENY` for frames, strict cache control for `/api/`, strict HSTS) are applied.
- SQLite queries uniformly use parameterized SQL statements (`?`), mitigating traditional SQL injection attacks.

However, moving toward public multi-tenant deployment, mobile App Stores, or broader exposure introduces **Critical**, **High**, and **Medium** security vulnerabilities that must be addressed.

---

## Severity Matrix

| Severity | Issue | Area | Impact | Status |
| :--- | :--- | :--- | :--- | :--- |
| **CRITICAL** | Default `FLASK_SECRET_KEY` Fallback | Configuration / Crypto | Token & session decryption compromise if env var missing | **RESOLVED** |
| **CRITICAL** | Single-Tenant IDOR & Shared SQLite Data Model | Authorization / Multi-Tenancy | Complete data exposure between households if deployed publicly | *Documented / Prior to Multi-Tenant Launch* |
| **HIGH** | Unverified Plaid Webhook Endpoint (`/api/finance/plaid/webhook`) | Finance / Webhooks | Rogue webhook injection / fake transaction triggers | **RESOLVED** |
| **HIGH** | Missing CSRF Protection on Cookie-Authenticated Endpoints | Authentication / Sessions | Cross-Site Request Forgery via malicious web origins | **RESOLVED** |
| **HIGH** | Client-Supplied IP in Rate Limiter (`X-Forwarded-For` Spoofing) | Authentication / Brute-Force | Rate-limit bypass on password logins | **RESOLVED** |
| **MEDIUM** | Permissive Onboarding Account Injection | Authentication / Setup | Hijacking uncompleted setup to inject admin/partner accounts | **RESOLVED** |
| **MEDIUM** | Custom Stream Cipher Used for Token Encryption | Cryptography | Nonce reuse risk / Non-standard cryptographic primitives | **RESOLVED** |
| **MEDIUM** | In-Memory Token Decryption In Plaid Calls Without Zeroing | Memory Security | Sensitive Plaid secrets lingering in runtime memory | *Open (Low impact in managed GC)* |
| **MEDIUM** | Unvalidated URL Schemes in Links (`link_url`, `url`) | Front-End / XSS | `javascript:` URI execution in purchase requests & medical docs | **RESOLVED** |
| **LOW** | Lack of Account Deletion (App Store Rejection & GDPR/CCPA Risk) | Compliance & Privacy | App rejection and unfulfilled privacy rights | **RESOLVED** |

---

## Detailed Vulnerability Analysis & Exploitation Scenarios

### 1. [CRITICAL] Hardcoded Fallback for `FLASK_SECRET_KEY`
- **Location:** `backend/config.py` (line 19) and `backend/security.py` (lines 45, 64)
- **Vulnerability:**
  ```python
  SECRET_KEY = _get_env_case_insensitive("FLASK_SECRET_KEY", "gibson-family-dev-secret-key")
  # and in security.py:
  secret = current_app.config.get("SECRET_KEY", "gibson-default-secret")
  ```
- **Exploitation:**
  If an instance is spun up where `FLASK_SECRET_KEY` is not provided (or fails to load from `.env`), the application falls back to a known public string. Any attacker can derive the encryption keys and decrypt all stored Plaid tokens in `items.access_token`.
- **Remediation:**
  Raise a fatal runtime error on startup if `FLASK_SECRET_KEY` is empty or matches default dev strings in non-testing mode:
  ```python
  if not app.config.get("SECRET_KEY") or app.config["SECRET_KEY"] in ("gibson-family-dev-secret-key", "gibson-default-secret"):
      if not app.config.get("TESTING"):
          raise RuntimeError("CRITICAL: FLASK_SECRET_KEY must be configured with a cryptographically secure random string.")
  ```

---

### 2. [CRITICAL] Absence of Household Multi-Tenancy (Insecure Direct Object Reference - IDOR)
- **Location:** Throughout all modules (`finance.py`, `couples_hub.py`, `requests_and_plans.py`, `auth_webauthn.py`)
- **Vulnerability:**
  The current schema has a single global database without a `household_id` or `tenant_id` namespace. Queries such as:
  ```sql
  SELECT * FROM transactions WHERE id = ?
  SELECT * FROM purchase_requests WHERE id = ?
  ```
  assume only two trusted partners exist in the entire instance.
- **Exploitation:**
  If published to the App Store or Google Play Store where multiple public users sign up, User A from Household 1 can view, edit, or delete transactions, bank balances, medical paperwork, and grocery lists belonging to Household 2 simply by passing `id`.
- **Remediation:**
  - Introduce `households` table.
  - Add `household_id` foreign key to `partners`, `accounts`, `transactions`, `monthly_budgets`, `purchase_requests`, `todos`, `grocery_items`, and `admin_records`.
  - Enforce `WHERE household_id = g.current_partner['household_id']` on every single select, update, and delete query.

---

### 3. [HIGH] Unverified Plaid Webhook (`/api/finance/plaid/webhook`)
- **Location:** `backend/app.py` (line 22) and `backend/modules/finance.py`
- **Vulnerability:**
  `/api/finance/plaid/webhook` is in `PUBLIC_API_PATHS` and accepts unauthenticated POST requests without verifying Plaid's webhook verification header (`Plaid-Verification`).
- **Exploitation:**
  An attacker can spoof Plaid webhooks (`DEFAULT_UPDATE`, `TRANSACTIONS_REMOVED`) with fabricated item IDs or transaction IDs, triggering unwanted background sync threads, exhausting server resources (Denial of Service), or desynchronizing local ledger state.
- **Remediation:**
  Implement Plaid JWT webhook verification:
  1. Extract the `Plaid-Verification` header.
  2. Verify the signed JWT using Plaid's webhook verification key endpoint (`/webhook_verification_key/get`).
  3. Validate the payload body hash matches the JWT `request_body_sha256` claim.

---

### 4. [HIGH] CSRF Vulnerability on Cookie-Authenticated Session Endpoints
- **Location:** `backend/app.py` (`enforce_api_authentication`) and `backend/security.py` (`extract_request_token`)
- **Vulnerability:**
  Authentication accepts either a `Bearer` token or a cookie (`SESSION_COOKIE_NAME`).
  The cookie is set with `SameSite=Lax`. While `SameSite=Lax` prevents cookies on cross-origin `POST` from traditional form tags in modern browsers, top-level navigations or cross-site fetch in certain WebView configurations or subdomain takeovers could send the cookie.
  Furthermore, there is no anti-CSRF token (e.g., Double Submit Cookie or `X-CSRF-Token` header check) on state-modifying requests (`POST`, `PUT`, `DELETE`).
- **Exploitation:**
  A malicious third-party site visited by a logged-in partner could execute unwanted state changes (e.g., approving purchase requests, modifying budgets) if SameSite protections are bypassed or if CORS origins are loosened.
- **Remediation:**
  - Set session cookies to `SameSite=Strict`.
  - Require a custom header (e.g., `X-Requested-With: GibsonApp` or `X-Gibson-CSRF`) on all mutating endpoints (`POST`, `PUT`, `DELETE`), which browsers never send cross-origin without CORS preflight.

---

### 5. [HIGH] Rate Limiter IP Spoofing (`X-Forwarded-For`)
- **Location:** `backend/modules/auth_webauthn.py` (lines 124–128)
- **Vulnerability:**
  ```python
  client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "local").split(",")[0].strip()
  rate_key = f"{client_ip}:{identifier}"
  ```
- **Exploitation:**
  An attacker attempting to brute-force a partner's password can rotate the `X-Forwarded-For` HTTP header with each request (`X-Forwarded-For: 1.1.1.1`, `X-Forwarded-For: 1.1.1.2`). Because the application blindly trusts the first entry in the header, each attempt gets a new bucket, bypassing the 5-attempt rate limit.
- **Remediation:**
  Use Werkzeug's `ProxyFix` middleware configured with the exact trusted proxy count (e.g. Render's 1 reverse proxy hop) and read `request.remote_addr` directly:
  ```python
  from werkzeug.middleware.proxy_fix import ProxyFix
  app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
  ```

---

### 6. [MEDIUM] Onboarding Partner Injection Race Condition
- **Location:** `backend/app.py` (lines 65–70)
- **Vulnerability:**
  ```python
  if path == "/api/auth/partners" and request.method == "POST":
      db = get_db()
      onb = db.execute("SELECT value FROM app_settings WHERE key = 'onboarding_completed'").fetchone()
      p_cnt = db.execute("SELECT COUNT(*) AS cnt FROM partners").fetchone()["cnt"]
      if not (onb and onb["value"] == "1" and p_cnt >= 1):
          return None
  ```
- **Exploitation:**
  During initial server boot before onboarding is completed, anyone on the internet who hits the server can POST to `/api/auth/partners` to create an unauthorized account with arbitrary passwords and roles, locking out the legitimate family.
- **Remediation:**
  Require a one-time setup token (`SETUP_INVITE_TOKEN` or generated in server logs on initial startup) to complete initial onboarding.

---

### 7. [MEDIUM] Custom Stream-Cipher Implementation (`_keystream_xor`)
- **Location:** `backend/security.py` (lines 27–38, 49)
- **Vulnerability:**
  Instead of using an industry-standard authenticated encryption library (like Python's `cryptography.fernet` or `AES-GCM` from `cryptography.hazmat`), the codebase constructs a bespoke stream cipher using HMAC-SHA256 blocks XORed with plaintext:
  ```python
  def _keystream_xor(data: bytes, enc_key: bytes, nonce: bytes) -> bytes: ...
  ```
- **Exploitation Risk:**
  Bespoke cryptography ("rolling your own crypto") is susceptible to subtle cryptographic weaknesses, side-channel attacks, or keystream reuse if nonces collide or state counters wrap.
- **Remediation:**
  Replace custom HMAC-XOR with Python's standard `cryptography.hazmat.primitives.ciphers.aead.AESGCM` or `Fernet`:
  ```python
  from cryptography.hazmat.primitives.ciphers.aead import AESGCM
  aesgcm = AESGCM(enc_key)
  ciphertext = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)
  ```

---

### 8. [MEDIUM] Unvalidated URL Schemes in User Input (`javascript:` URI execution)
- **Location:** `backend/modules/requests_and_plans.py` and `couples_hub.py`
- **Vulnerability:**
  Fields such as `url` in purchase requests and `attachment_url` / `portal_url` in medical admin records accept arbitrary strings without validating that the protocol is strictly `http://` or `https://`.
- **Exploitation:**
  If a partner (or an attacker who compromised a session) submits a purchase request with `url: "javascript:fetch('/api/auth/partners').then(...)"`, clicking "View Product" in the UI executes malicious JavaScript in the context of the other partner's browser (Stored XSS).
- **Remediation:**
  Validate all URL fields before saving:
  ```python
  import urllib.parse
  parsed = urllib.parse.urlparse(raw_url)
  if parsed.scheme not in ('http', 'https'):
      return jsonify({"error": "Only http and https URLs are permitted"}), 400
  ```

---

### 9. [LOW] Lack of Account & Data Erasure Capability (Right to be Forgotten)
- **Location:** `backend/modules/auth_webauthn.py`
- **Vulnerability:**
  There is currently no API endpoint to completely wipe a partner's data, credentials, and linked accounts.
- **App Store Impact:**
  Apple App Store Review Guideline 5.1.1(v) and Google Play Store policies mandate that any app supporting account creation must provide an easily discoverable in-app account deletion mechanism that deletes personal and financial data.
- **Remediation:**
  Provide `DELETE /api/account` that cascades deletions across `partners`, `webauthn_credentials`, `auth_sessions`, `accounts`, `transactions`, and `push_subscriptions`.

---

## Remediation Roadmap & Resolution Status

1. **Immediate (Deploy-blocking for Production / App Stores):**
   - [x] Mandate `FLASK_SECRET_KEY` in environment variables with no weak hardcoded fallback (raises `RuntimeError` on startup if missing or matching default dev strings; tested in `test_security_audit_secret_key_mandate`).
   - [x] Enforce trusted reverse proxy IP handling via `werkzeug.middleware.proxy_fix.ProxyFix(x_for=1, x_proto=1, x_host=1)` and read `request.remote_addr` directly to prevent brute-force rate limit evasion.
   - [x] Implement `DELETE /api/account` (and `/api/auth/account`) to comply with Apple Guideline 5.1.1(v) & GDPR erasure, along with front-end confirmation in `PasskeyLockScreen.jsx` (tested in `test_security_audit_account_deletion_and_data_erasure`).
   - [x] Sanitize all URL schemes (`http://` / `https://` only) in backend validation and front-end href rendering to eliminate Stored XSS (tested in `test_security_audit_url_scheme_validation`).
2. **Prior to Multi-Tenant Launch:**
   - [ ] Implement `household_id` tenancy isolation across all database tables and queries (for multi-tenant SaaS; single-tenant/self-hosted instances are already isolated).
   - [x] Transition custom HMAC keystream cipher to standard `AES-256-GCM` (`enc:v2:`) with PBKDF2 key derivation and backward compatibility for legacy `enc:v1:` tokens (tested in `test_plaid_access_token_encryption_at_rest`).
3. **Plaid Production & Session Hardening:**
   - [x] Implement Plaid webhook JWT cryptographic signature verification (`verify_plaid_webhook` using ES256 and Plaid verification key retrieval) with request body SHA-256 hash checks and 5-minute timestamp expiration.
   - [x] Set session cookies to `SameSite=Strict` and enforce custom anti-CSRF request headers (`X-Requested-With: GibsonApp`) on cookie-authenticated mutating requests (tested in `test_security_audit_csrf_protection`).
   - [x] Protect initial onboarding account setup with `SETUP_INVITE_TOKEN` environment variable enforcement (tested in `test_security_audit_setup_invite_token`).

