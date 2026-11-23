from datetime import date, timedelta
import pytest
from backend.app import create_app


@pytest.fixture()
def app_instance(tmp_path):
    db_file = tmp_path / "test_gifts.db"
    return create_app({"TESTING": True, "DATABASE_PATH": str(db_file)})


@pytest.fixture()
def client(app_instance):
    with app_instance.test_client() as c:
        yield c


def _setup_two_partners(client):
    res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Family",
            "starting_budget_month": date.today().strftime("%Y-%m"),
            "partners": [
                {"name": "Alex", "password": "Password123!", "avatar_color": "#6366f1", "monthly_fun_allowance": 200},
                {"name": "Sam", "password": "Password456!", "avatar_color": "#ec4899", "monthly_fun_allowance": 200},
            ],
        },
    )
    assert res.status_code in (200, 201)
    data = res.get_json()
    alex_id = data["partners"][0]["id"]
    sam_id = data["partners"][1]["id"]

    alex_login = client.post("/api/auth/login", json={"partner_id": alex_id, "password": "Password123!"}).get_json()
    sam_login = client.post("/api/auth/login", json={"partner_id": sam_id, "password": "Password456!"}).get_json()
    return (
        alex_id,
        {"Authorization": f"Bearer {alex_login['token']}"},
        sam_id,
        {"Authorization": f"Bearer {sam_login['token']}"},
    )


def test_gift_addon_toggle_notifications_and_category(client):
    alex_id, alex_hdr, sam_id, sam_hdr = _setup_two_partners(client)
    month = date.today().strftime("%Y-%m")

    # 1. Defaults to disabled, and "Gifts" is NOT auto-flagged as an untracked category
    summary = client.get(f"/api/finance/summary?month={month}", headers=alex_hdr).get_json()
    assert summary["gift_addon_enabled"] is False
    assert not any(c["name"] == "Gifts" for c in summary["untracked_categories"])

    # 2. Cannot mark a transaction as a gift while add-on is disabled
    tx = client.post(
        "/api/finance/transactions",
        headers=alex_hdr,
        json={"name": "Secret Necklace", "amount": 120.0, "date": date.today().isoformat(), "category": "Shopping & Tech"},
    ).get_json()
    reveal_str = (date.today() + timedelta(days=10)).isoformat()
    blocked = client.put(
        f"/api/finance/transactions/{tx['id']}",
        headers=alex_hdr,
        json={"is_gift": True, "category": "Gifts", "gift_reveal_date": reveal_str},
    )
    assert blocked.status_code == 400

    # 3. Toggle gift add-on ON -> sends notification to ALL partners
    tog_on = client.put("/api/finance/gift-addon", headers=alex_hdr, json={"enabled": True})
    assert tog_on.status_code == 200
    assert tog_on.get_json()["gift_addon_enabled"] is True

    alex_notifs = client.get("/api/notifications", headers=alex_hdr).get_json()["notifications"]
    sam_notifs = client.get("/api/notifications", headers=sam_hdr).get_json()["notifications"]
    assert any(n["notif_type"] == "gift_addon_enabled" for n in alex_notifs)
    assert any(n["notif_type"] == "gift_addon_enabled" for n in sam_notifs)


def test_gift_90_day_limit_ledger_hiding_and_budget_sums(client):
    alex_id, alex_hdr, sam_id, sam_hdr = _setup_two_partners(client)
    today = date.today()
    month = today.strftime("%Y-%m")
    purchase_str = today.isoformat()

    # Enable Gift Surprises add-on & set Gifts budget to $300
    assert client.put("/api/finance/gift-addon", headers=alex_hdr, json={"enabled": True}).status_code == 200
    assert client.post(
        "/api/finance/budgets",
        headers=alex_hdr,
        json={"category": "Gifts", "monthly_limit": 300.0, "budget_month": month, "apply_scope": "this_and_future"},
    ).status_code == 201

    # Create a normal transaction and a gift transaction (bought by Alex)
    normal_tx = client.post(
        "/api/finance/transactions",
        headers=alex_hdr,
        json={"name": "Coffee", "amount": 10.0, "date": purchase_str, "category": "Groceries & Dining"},
    ).get_json()
    gift_tx = client.post(
        "/api/finance/transactions",
        headers=alex_hdr,
        json={"name": "Surprise Watch", "amount": 150.0, "date": purchase_str, "category": "Shopping & Tech"},
    ).get_json()

    # 1. Reveal date > 90 days from purchase date must be rejected
    too_far = (today + timedelta(days=91)).isoformat()
    res_91 = client.put(
        f"/api/finance/transactions/{gift_tx['id']}",
        headers=alex_hdr,
        json={"is_gift": True, "category": "Gifts", "gift_reveal_date": too_far},
    )
    assert res_91.status_code == 400
    assert "90 days" in res_91.get_json()["error"]

    # 2. Reveal date before purchase date must be rejected
    before_purchase = (today - timedelta(days=1)).isoformat()
    res_before = client.put(
        f"/api/finance/transactions/{gift_tx['id']}",
        headers=alex_hdr,
        json={"is_gift": True, "category": "Gifts", "gift_reveal_date": before_purchase},
    )
    assert res_before.status_code == 400

    # 3. Valid reveal date (exactly 90 days from purchase) succeeds and moves category to "Gifts"
    max_90 = (today + timedelta(days=90)).isoformat()
    res_ok = client.put(
        f"/api/finance/transactions/{gift_tx['id']}",
        headers=alex_hdr,
        json={"is_gift": True, "category": "Gifts", "gift_reveal_date": max_90},
    )
    assert res_ok.status_code == 200
    updated_tx = res_ok.get_json()
    assert updated_tx["is_gift"] is True
    assert updated_tx["category"] == "Gifts"
    assert updated_tx["gift_reveal_date"] == max_90

    # 4. Alex (buyer) sees BOTH transactions and full totals ($160 total, $150 in Gifts)
    alex_sum = client.get(f"/api/finance/summary?month={month}", headers=alex_hdr).get_json()
    assert alex_sum["total_monthly_spent"] == 160.0
    assert len(alex_sum["transactions"]) == 2
    alex_gifts_budget = next(b for b in alex_sum["budgets"] if b["category"] == "Gifts")
    assert alex_gifts_budget["spent"] == 150.0
    assert alex_gifts_budget["remaining"] == 150.0

    # 5. Sam (other user) does NOT see the gift on the ledger, BUT all sums still include it!
    sam_sum = client.get(f"/api/finance/summary?month={month}", headers=sam_hdr).get_json()
    assert sam_sum["total_monthly_spent"] == 160.0
    assert sam_sum["total_gross_spent"] == 160.0
    sam_gifts_budget = next(b for b in sam_sum["budgets"] if b["category"] == "Gifts")
    assert sam_gifts_budget["spent"] == 150.0
    assert sam_gifts_budget["remaining"] == 150.0
    sam_tx_ids = [t["id"] for t in sam_sum["transactions"]]
    assert normal_tx["id"] in sam_tx_ids
    assert gift_tx["id"] not in sam_tx_ids

    # 6. Once reveal date arrives (reveal date == today), Sam CAN see it on the ledger
    res_reveal_today = client.put(
        f"/api/finance/transactions/{gift_tx['id']}",
        headers=alex_hdr,
        json={"is_gift": True, "category": "Gifts", "gift_reveal_date": purchase_str},
    )
    assert res_reveal_today.status_code == 200
    sam_sum_revealed = client.get(f"/api/finance/summary?month={month}", headers=sam_hdr).get_json()
    assert gift_tx["id"] in [t["id"] for t in sam_sum_revealed["transactions"]]

    # 7. Also verify unmarking gift removes gift status cleanly
    res_unmark = client.put(
        f"/api/finance/transactions/{gift_tx['id']}",
        headers=alex_hdr,
        json={"is_gift": False},
    )
    assert res_unmark.status_code == 200
    assert res_unmark.get_json()["is_gift"] is False


def test_month_close_excess_income_above_projected(client):
    alex_id, alex_hdr, sam_id, sam_hdr = _setup_two_partners(client)

    # Prior month (2026-10) earned $4,000 -> sets projected income for 2026-11 to $4,000
    client.post(
        "/api/finance/income",
        headers=alex_hdr,
        json={"source_name": "Salary", "amount": 4000.0, "income_type": "payroll", "budget_month": "2026-10", "date": "2026-10-01"},
    )
    # Current month (2026-11) earned $5,200 ($1,200 excess above projected!)
    client.post(
        "/api/finance/income",
        headers=alex_hdr,
        json={"source_name": "Salary + Bonus", "amount": 5200.0, "income_type": "payroll", "budget_month": "2026-11", "date": "2026-11-01"},
    )
    client.post(
        "/api/finance/budgets",
        headers=alex_hdr,
        json={"category": "Groceries & Dining", "monthly_limit": 500.0, "budget_month": "2026-11", "allow_rollover": 0},
    )
    # Also add a "Savings" budget with a large unspent limit ($2000 limit, $100 spent)
    # and verify it is NOT shown in top_categories or chosen as budget_mvp!
    client.post(
        "/api/finance/budgets",
        headers=alex_hdr,
        json={"category": "Savings", "monthly_limit": 2000.0, "budget_month": "2026-11", "allow_rollover": 0},
    )
    client.post(
        "/api/finance/transactions",
        headers=alex_hdr,
        json={"name": "Market", "amount": 350.0, "date": "2026-11-05", "budget_month": "2026-11", "category": "Groceries & Dining"},
    )

    mc = client.get("/api/finance/month-close-status?month=2026-11", headers=alex_hdr).get_json()
    assert mc["projected_income"] == 4000.0
    assert mc["total_income"] == 5200.0
    assert mc["income_vs_projected"] == 1200.0
    assert mc["excess_income"] == 1200.0
    assert mc["exceeded_income_projection"] is True
    recap = mc["recap"]
    assert recap["overview"]["projected_income"] == 4000.0
    assert recap["overview"]["total_income"] == 5200.0
    assert not any("saving" in c["category"].lower() for c in recap["top_categories"])
    assert recap["budget_mvp"]["category"] == "Groceries & Dining"
    assert "fun_facts" in recap
    assert "badge_showroom" in recap
    assert len(recap["badge_showroom"]) == 50
    # Before closing the month, ZERO badges are unlocked!
    assert all(not b["unlocked"] for b in recap["badge_showroom"])

    # Once the month is officially closed, earned badges unlock!
    close_res = client.post(
        "/api/finance/close-month",
        headers=alex_hdr,
        json={"month": "2026-11", "transferred_to_savings": False},
    )
    assert close_res.status_code == 201
    closed_recap = close_res.get_json()["recap"]
    assert any(b["id"] == "saver_rate_50" and b["unlocked"] for b in closed_recap["badge_showroom"])
    assert any(b["id"] == "record_highest_savings" and b["is_repeatable"] and b["unlocked"] and b["times_earned"] == 1 for b in closed_recap["badge_showroom"])
    assert any(b["unlocked"] for b in closed_recap["badge_showroom"])
    assert any(not b["unlocked"] for b in closed_recap["badge_showroom"])

