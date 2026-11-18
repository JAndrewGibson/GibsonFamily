import json
import random
from datetime import date, datetime, timedelta, timezone
from flask import Blueprint, g, jsonify, request
from backend.database import create_notification, get_db
from backend.modules.finance import (
    _ensure_category_in_catalog,
    _ensure_monthly_budgets_for_month,
    _shift_year_month,
    get_starting_budget_month,
    resolve_partner_spending_money_category,
)

splendor_bp = Blueprint("splendor", __name__, url_prefix="/api/splendor")

GEM_COLORS = ["white", "blue", "green", "red", "black"]
ALL_TOKEN_TYPES = ["white", "blue", "green", "red", "black", "gold"]

GEM_LABELS = {
    "white": "Diamond",
    "blue": "Sapphire",
    "green": "Emerald",
    "red": "Ruby",
    "black": "Onyx",
    "gold": "Gold",
}

CARD_TYPE_TITLES = {
    1: {
        "white": "Diamond Mine",
        "blue": "Sapphire Quarry",
        "green": "Emerald Vein",
        "red": "Ruby Deposit",
        "black": "Onyx Cavern",
    },
    2: {
        "white": "Diamond Merchant",
        "blue": "Sapphire Cutter",
        "green": "Emerald Artisan",
        "red": "Ruby Goldsmith",
        "black": "Onyx Guildhall",
    },
    3: {
        "white": "Diamond Crown Estate",
        "blue": "Sapphire Royal Vault",
        "green": "Emerald Grand Palace",
        "red": "Ruby Imperial Court",
        "black": "Onyx Sovereign Citadel",
    },
}

# Official 90 Splendor Development Cards (40 Tier 1, 30 Tier 2, 20 Tier 3)
# Format: (id, tier, bonus, points, {cost})
RAW_CARDS = [
    # --- TIER 1 (40 cards: 8 per bonus color) ---
    # Black bonus (8)
    (1, 1, "black", 0, {"white": 1, "blue": 1, "green": 1, "red": 1}),
    (2, 1, "black", 0, {"white": 1, "blue": 2, "green": 1, "red": 1}),
    (3, 1, "black", 0, {"white": 2, "blue": 2, "red": 1}),
    (4, 1, "black", 0, {"green": 1, "red": 3, "black": 1}),
    (5, 1, "black", 0, {"green": 2, "red": 1}),
    (6, 1, "black", 0, {"white": 2, "green": 2}),
    (7, 1, "black", 0, {"green": 3}),
    (8, 1, "black", 1, {"blue": 4}),
    # Blue bonus (8)
    (9, 1, "blue", 0, {"white": 1, "green": 1, "red": 1, "black": 1}),
    (10, 1, "blue", 0, {"white": 1, "green": 1, "red": 2, "black": 1}),
    (11, 1, "blue", 0, {"white": 1, "green": 2, "red": 2}),
    (12, 1, "blue", 0, {"blue": 1, "green": 3, "red": 1}),
    (13, 1, "blue", 0, {"white": 1, "black": 2}),
    (14, 1, "blue", 0, {"green": 2, "black": 2}),
    (15, 1, "blue", 0, {"black": 3}),
    (16, 1, "blue", 1, {"red": 4}),
    # White bonus (8)
    (17, 1, "white", 0, {"blue": 1, "green": 1, "red": 1, "black": 1}),
    (18, 1, "white", 0, {"blue": 1, "green": 2, "red": 1, "black": 1}),
    (19, 1, "white", 0, {"blue": 2, "green": 2, "black": 1}),
    (20, 1, "white", 0, {"white": 3, "blue": 1, "black": 1}),
    (21, 1, "white", 0, {"red": 2, "black": 1}),
    (22, 1, "white", 0, {"blue": 2, "black": 2}),
    (23, 1, "white", 0, {"blue": 3}),
    (24, 1, "white", 1, {"green": 4}),
    # Green bonus (8)
    (25, 1, "green", 0, {"white": 1, "blue": 1, "red": 1, "black": 1}),
    (26, 1, "green", 0, {"white": 1, "blue": 1, "red": 1, "black": 2}),
    (27, 1, "green", 0, {"blue": 1, "red": 2, "black": 2}),
    (28, 1, "green", 0, {"white": 1, "blue": 3, "green": 1}),
    (29, 1, "green", 0, {"white": 2, "blue": 1}),
    (30, 1, "green", 0, {"blue": 2, "red": 2}),
    (31, 1, "green", 0, {"red": 3}),
    (32, 1, "green", 1, {"black": 4}),
    # Red bonus (8)
    (33, 1, "red", 0, {"white": 1, "blue": 1, "green": 1, "black": 1}),
    (34, 1, "red", 0, {"white": 2, "blue": 1, "green": 1, "black": 1}),
    (35, 1, "red", 0, {"white": 2, "green": 1, "black": 2}),
    (36, 1, "red", 0, {"white": 1, "red": 1, "black": 3}),
    (37, 1, "red", 0, {"blue": 2, "green": 1}),
    (38, 1, "red", 0, {"white": 2, "red": 2}),
    (39, 1, "red", 0, {"white": 3}),
    (40, 1, "red", 1, {"white": 4}),

    # --- TIER 2 (30 cards: 6 per bonus color) ---
    # Black bonus (6)
    (41, 2, "black", 1, {"white": 3, "blue": 2, "green": 2}),
    (42, 2, "black", 1, {"white": 3, "green": 3, "black": 2}),
    (43, 2, "black", 2, {"blue": 1, "green": 4, "red": 2}),
    (44, 2, "black", 2, {"green": 5, "red": 3}),
    (45, 2, "black", 2, {"white": 5}),
    (46, 2, "black", 3, {"black": 6}),
    # Blue bonus (6)
    (47, 2, "blue", 1, {"blue": 2, "green": 2, "red": 3}),
    (48, 2, "blue", 1, {"blue": 2, "green": 3, "black": 3}),
    (49, 2, "blue", 2, {"white": 5, "blue": 3}),
    (50, 2, "blue", 2, {"white": 2, "red": 1, "black": 4}),
    (51, 2, "blue", 2, {"blue": 5}),
    (52, 2, "blue", 3, {"blue": 6}),
    # White bonus (6)
    (53, 2, "white", 1, {"green": 3, "red": 2, "black": 2}),
    (54, 2, "white", 1, {"white": 2, "blue": 3, "red": 3}),
    (55, 2, "white", 2, {"green": 1, "red": 4, "black": 2}),
    (56, 2, "white", 2, {"red": 5, "black": 3}),
    (57, 2, "white", 2, {"red": 5}),
    (58, 2, "white", 3, {"white": 6}),
    # Green bonus (6)
    (59, 2, "green", 1, {"white": 3, "green": 2, "red": 3}),
    (60, 2, "green", 1, {"white": 2, "blue": 3, "black": 2}),
    (61, 2, "green", 2, {"white": 4, "blue": 2, "black": 1}),
    (62, 2, "green", 2, {"blue": 5, "green": 3}),
    (63, 2, "green", 2, {"green": 5}),
    (64, 2, "green", 3, {"green": 6}),
    # Red bonus (6)
    (65, 2, "red", 1, {"white": 2, "red": 2, "black": 3}),
    (66, 2, "red", 1, {"blue": 3, "red": 2, "black": 3}),
    (67, 2, "red", 2, {"white": 1, "blue": 4, "green": 2}),
    (68, 2, "red", 2, {"white": 3, "black": 5}),
    (69, 2, "red", 2, {"black": 5}),
    (70, 2, "red", 3, {"red": 6}),

    # --- TIER 3 (20 cards: 4 per bonus color) ---
    # Black bonus (4)
    (71, 3, "black", 3, {"white": 3, "blue": 3, "green": 5, "red": 3}),
    (72, 3, "black", 4, {"red": 7}),
    (73, 3, "black", 4, {"green": 3, "red": 6, "black": 3}),
    (74, 3, "black", 5, {"red": 7, "black": 3}),
    # Blue bonus (4)
    (75, 3, "blue", 3, {"white": 3, "green": 3, "red": 3, "black": 5}),
    (76, 3, "blue", 4, {"white": 7}),
    (77, 3, "blue", 4, {"white": 6, "blue": 3, "black": 3}),
    (78, 3, "blue", 5, {"white": 7, "blue": 3}),
    # White bonus (4)
    (79, 3, "white", 3, {"blue": 3, "green": 3, "red": 5, "black": 3}),
    (80, 3, "white", 4, {"black": 7}),
    (81, 3, "white", 4, {"white": 3, "red": 3, "black": 6}),
    (82, 3, "white", 5, {"white": 3, "black": 7}),
    # Green bonus (4)
    (83, 3, "green", 3, {"white": 5, "blue": 3, "red": 3, "black": 3}),
    (84, 3, "green", 4, {"blue": 7}),
    (85, 3, "green", 4, {"white": 3, "blue": 6, "green": 3}),
    (86, 3, "green", 5, {"blue": 7, "green": 3}),
    # Red bonus (4)
    (87, 3, "red", 3, {"white": 3, "blue": 5, "green": 3, "black": 3}),
    (88, 3, "red", 4, {"green": 7}),
    (89, 3, "red", 4, {"blue": 3, "green": 6, "red": 3}),
    (90, 3, "red", 5, {"green": 7, "red": 3}),
]

# Official 10 Noble Tiles (3 points each)
RAW_NOBLES = [
    (101, "Noble Patron of Arts", 3, {"red": 4, "green": 4}),
    (102, "Royal Merchant Guild", 3, {"black": 4, "red": 4}),
    (103, "High Chancellor", 3, {"blue": 4, "green": 4}),
    (104, "Grand Sovereign", 3, {"black": 4, "white": 4}),
    (105, "Duchess of Sapphires", 3, {"blue": 4, "white": 4}),
    (106, "Imperial Envoy", 3, {"black": 3, "red": 3, "white": 3}),
    (107, "Archduke of Emeralds", 3, {"green": 3, "blue": 3, "white": 3}),
    (108, "Order of the Onyx Crown", 3, {"black": 3, "red": 3, "green": 3}),
    (109, "Countess of Rubies", 3, {"green": 3, "blue": 3, "red": 3}),
    (110, "Marquis of Diamonds", 3, {"black": 3, "blue": 3, "white": 3}),
]


def _get_current_budget_month(db) -> str:
    return max(get_starting_budget_month(db), date.today().strftime("%Y-%m"))


def _get_partner_current_spending_money_limit(db, partner: dict, budget_month: str) -> tuple[str, float]:
    """Returns (category_name, current_month_limit) for a partner's Spending Money in budget_month."""
    _ensure_monthly_budgets_for_month(db, budget_month)
    cat = resolve_partner_spending_money_category(db, partner["name"])
    row = db.execute(
        "SELECT monthly_limit, is_active FROM monthly_budgets WHERE budget_month = ? AND category = ?",
        (budget_month, cat),
    ).fetchone()
    if row and row["is_active"]:
        return cat, round(float(row["monthly_limit"] or 0.0), 2)
    b_row = db.execute(
        "SELECT monthly_limit FROM budgets WHERE category = ?",
        (cat,),
    ).fetchone()
    if b_row:
        return cat, round(float(b_row["monthly_limit"] or 0.0), 2)
    return cat, round(float(partner.get("monthly_fun_allowance") or 0.0), 2)


def _settle_wager_for_current_month(
    db,
    winner_id: int,
    loser_id: int,
    wager_amount: float,
    wager_month: str,
) -> dict | None:
    """
    Transfers `wager_amount` from the loser's Spending Money budget to the winner's
    Spending Money budget ONLY for `wager_month` (current month).
    """
    wager_val = round(float(wager_amount or 0.0), 2)
    if wager_val <= 0 or not winner_id or not loser_id or winner_id == loser_id:
        return None

    target_ym = wager_month or _get_current_budget_month(db)
    next_ym = _shift_year_month(target_ym, 1)
    _ensure_monthly_budgets_for_month(db, target_ym)
    _ensure_monthly_budgets_for_month(db, next_ym)

    winner_row = db.execute("SELECT * FROM partners WHERE id = ?", (winner_id,)).fetchone()
    loser_row = db.execute("SELECT * FROM partners WHERE id = ?", (loser_id,)).fetchone()
    if not winner_row or not loser_row:
        return None

    winner = dict(winner_row)
    loser = dict(loser_row)

    w_cat, w_old = _get_partner_current_spending_money_limit(db, winner, target_ym)
    l_cat, l_old = _get_partner_current_spending_money_limit(db, loser, target_ym)

    w_new = round(w_old + wager_val, 2)
    l_new = round(max(0.0, l_old - wager_val), 2)

    for cat_name, p_obj, new_lim in [
        (w_cat, winner, w_new),
        (l_cat, loser, l_new),
    ]:
        color = p_obj.get("avatar_color") or "#6366f1"
        _ensure_category_in_catalog(
            db,
            cat_name,
            is_preloaded=1,
            unarchive=True,
            allow_rollover=1,
            color=color,
        )
        db.execute(
            """
            INSERT INTO monthly_budgets (budget_month, category, monthly_limit, color, is_active, allow_rollover)
            VALUES (?, ?, ?, ?, 1, 1)
            ON CONFLICT(budget_month, category) DO UPDATE SET
                monthly_limit = excluded.monthly_limit,
                is_active = 1,
                allow_rollover = 1
            """,
            (target_ym, cat_name, new_lim, color),
        )

    return {
        "wager_amount": wager_val,
        "budget_month": target_ym,
        "winner_id": winner_id,
        "winner_name": winner["name"],
        "winner_category": w_cat,
        "winner_old_limit": w_old,
        "winner_new_limit": w_new,
        "loser_id": loser_id,
        "loser_name": loser["name"],
        "loser_category": l_cat,
        "loser_old_limit": l_old,
        "loser_new_limit": l_new,
    }


def _serialize_card(t):
    cid, tier, bonus, points, cost = t
    full_cost = {c: int(cost.get(c, 0)) for c in GEM_COLORS if int(cost.get(c, 0)) > 0}
    return {
        "id": cid,
        "tier": tier,
        "bonus": bonus,
        "bonus_label": GEM_LABELS[bonus],
        "title": CARD_TYPE_TITLES[tier][bonus],
        "type_label": f"Tier {tier} · {CARD_TYPE_TITLES[tier][bonus]}",
        "points": points,
        "cost": full_cost,
    }


def _serialize_noble(n):
    nid, title, points, req = n
    return {
        "id": nid,
        "title": title,
        "points": points,
        "requirements": {c: int(req.get(c, 0)) for c in GEM_COLORS if int(req.get(c, 0)) > 0},
    }


CARDS_BY_ID = {c[0]: _serialize_card(c) for c in RAW_CARDS}
NOBLES_BY_ID = {n[0]: _serialize_noble(n) for n in RAW_NOBLES}


def _create_initial_game_state(
    p1_id: int,
    p2_id: int,
    first_turn_id: int,
    wager_amount: float = 0.0,
    wager_month: str = "",
) -> dict:
    t1 = [_serialize_card(c) for c in RAW_CARDS if c[1] == 1]
    t2 = [_serialize_card(c) for c in RAW_CARDS if c[1] == 2]
    t3 = [_serialize_card(c) for c in RAW_CARDS if c[1] == 3]
    random.shuffle(t1)
    random.shuffle(t2)
    random.shuffle(t3)

    all_nobles = [_serialize_noble(n) for n in RAW_NOBLES]
    random.shuffle(all_nobles)
    # 2-player Splendor uses 3 nobles (players + 1)
    selected_nobles = all_nobles[:3]

    board = {
        "1": t1[:4],
        "2": t2[:4],
        "3": t3[:4],
    }
    decks = {
        "1": t1[4:],
        "2": t2[4:],
        "3": t3[4:],
    }

    def _empty_player(pid):
        return {
            "partner_id": pid,
            "tokens": {c: 0 for c in ALL_TOKEN_TYPES},
            "bonuses": {c: 0 for c in GEM_COLORS},
            "points": 0,
            "purchased_cards": [],
            "reserved_cards": [],
            "nobles": [],
        }

    wager_note = (
        f" 💰 Spending Money Wager: ${wager_amount:.2f} ({wager_month})."
        if wager_amount > 0
        else ""
    )

    return {
        # Official 2-player Splendor rules: 4 of each gem color, 5 gold jokers
        "bank": {
            "white": 4,
            "blue": 4,
            "green": 4,
            "red": 4,
            "black": 4,
            "gold": 5,
        },
        "nobles": selected_nobles,
        "board": board,
        "decks": decks,
        "players": {
            str(p1_id): _empty_player(p1_id),
            str(p2_id): _empty_player(p2_id),
        },
        "first_player_id": first_turn_id,
        "final_round_triggered": False,
        "wager_settlement": None,
        "move_log": [
            {
                "turn": 0,
                "text": f"New game of Splendor started!{wager_note}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ],
    }


def _recalculate_player_metrics(p_state: dict) -> None:
    bonuses = {c: 0 for c in GEM_COLORS}
    card_pts = 0
    for card in p_state.get("purchased_cards", []):
        b = card.get("bonus")
        if b in bonuses:
            bonuses[b] += 1
        card_pts += int(card.get("points", 0))
    noble_pts = sum(int(n.get("points", 3)) for n in p_state.get("nobles", []))
    p_state["bonuses"] = bonuses
    p_state["points"] = card_pts + noble_pts


def _can_afford_card(p_state: dict, card: dict) -> tuple[bool, dict]:
    """Returns (can_afford, tokens_to_spend_by_color_including_gold)."""
    tokens = p_state.get("tokens", {})
    bonuses = p_state.get("bonuses", {})
    cost = card.get("cost", {})

    spend = {c: 0 for c in ALL_TOKEN_TYPES}
    gold_needed = 0

    for color in GEM_COLORS:
        required = int(cost.get(color, 0))
        discount = int(bonuses.get(color, 0))
        effective = max(0, required - discount)
        have = int(tokens.get(color, 0))
        use_color = min(have, effective)
        spend[color] = use_color
        shortfall = effective - use_color
        gold_needed += shortfall

    if gold_needed > int(tokens.get("gold", 0)):
        return False, {}
    spend["gold"] = gold_needed
    return True, spend


def _check_and_award_noble(state: dict, p_state: dict) -> dict | None:
    """In Splendor, at the end of a turn a player may receive at most 1 visiting Noble if eligible."""
    bonuses = p_state.get("bonuses", {})
    remaining_nobles = []
    awarded = None
    for noble in state.get("nobles", []):
        if awarded is None:
            reqs = noble.get("requirements", {})
            eligible = all(int(bonuses.get(c, 0)) >= int(cnt) for c, cnt in reqs.items())
            if eligible:
                awarded = noble
                p_state.setdefault("nobles", []).append(noble)
                continue
        remaining_nobles.append(noble)

    if awarded is not None:
        state["nobles"] = remaining_nobles
        _recalculate_player_metrics(p_state)
    return awarded


def _sanitize_state_for_client(state: dict) -> dict:
    """Replaces full hidden deck arrays with deck counts while keeping visible board & player hands."""
    decks = state.get("decks", {})
    return {
        "bank": state.get("bank", {}),
        "nobles": state.get("nobles", []),
        "board": state.get("board", {"1": [], "2": [], "3": []}),
        "deck_counts": {
            "1": len(decks.get("1", [])),
            "2": len(decks.get("2", [])),
            "3": len(decks.get("3", [])),
        },
        "players": state.get("players", {}),
        "first_player_id": state.get("first_player_id"),
        "final_round_triggered": bool(state.get("final_round_triggered", False)),
        "wager_settlement": state.get("wager_settlement"),
        "move_log": state.get("move_log", [])[-25:],
    }


def _format_game_row(row, partners_by_id: dict) -> dict:
    d = dict(row)
    raw_state = json.loads(d.pop("game_state", "{}") or "{}")
    d["state"] = _sanitize_state_for_client(raw_state)
    d["wager_amount"] = round(float(d.get("wager_amount") or 0.0), 2)
    d["wager_month"] = d.get("wager_month") or ""
    d["wager_settled"] = bool(d.get("wager_settled"))
    d["player1_name"] = partners_by_id.get(d["player1_id"], {}).get("name", "Player 1")
    d["player1_color"] = partners_by_id.get(d["player1_id"], {}).get("avatar_color", "#6366f1")
    d["player2_name"] = partners_by_id.get(d["player2_id"], {}).get("name", "Player 2")
    d["player2_color"] = partners_by_id.get(d["player2_id"], {}).get("avatar_color", "#ec4899")
    d["current_turn_name"] = partners_by_id.get(d["current_turn_partner_id"], {}).get("name", "Partner")
    d["winner_name"] = partners_by_id.get(d["winner_partner_id"], {}).get("name") if d.get("winner_partner_id") else None
    d["forfeited_by_name"] = (
        partners_by_id.get(d["forfeited_by_partner_id"], {}).get("name")
        if d.get("forfeited_by_partner_id")
        else None
    )

    # Bump cooldown calculation (1 every 24 hours)
    bump_available = True
    bump_wait_seconds = 0
    next_bump_at = None
    if d.get("last_bump_at"):
        try:
            last_dt = datetime.fromisoformat(d["last_bump_at"].replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            now_dt = datetime.now(timezone.utc)
            next_dt = last_dt + timedelta(hours=24)
            if now_dt < next_dt:
                bump_available = False
                bump_wait_seconds = int((next_dt - now_dt).total_seconds())
                next_bump_at = next_dt.isoformat()
        except Exception:
            pass
    d["bump_available"] = bump_available
    d["bump_cooldown_seconds"] = bump_wait_seconds
    d["next_bump_at"] = next_bump_at
    return d


def _build_analytics(db, partners: list[dict]) -> dict:
    partners_by_id = {p["id"]: p for p in partners}
    rows = db.execute(
        """
        SELECT id, status, player1_id, player2_id, current_turn_partner_id,
               winner_partner_id, forfeited_by_partner_id,
               player1_points, player2_points,
               player1_cards_played, player2_cards_played,
               player1_nobles_count, player2_nobles_count,
               turns_count, wager_amount, wager_month, wager_settled,
               created_at, completed_at
        FROM splendor_games
        ORDER BY id DESC
        """
    ).fetchall()

    total_games = len(rows)
    completed_games = [dict(r) for r in rows if r["status"] in ("completed", "forfeited")]
    active_games = [dict(r) for r in rows if r["status"] == "active"]

    per_partner = {}
    for p in partners:
        pid = p["id"]
        per_partner[pid] = {
            "partner_id": pid,
            "name": p["name"],
            "avatar_color": p["avatar_color"],
            "games_played": 0,
            "wins": 0,
            "losses": 0,
            "forfeits": 0,
            "win_rate": 0.0,
            "total_cards_played": 0,
            "avg_cards_per_game": 0.0,
            "max_cards_in_game": 0,
            "total_points_scored": 0,
            "avg_points_per_game": 0.0,
            "high_score": 0,
            "total_nobles_visited": 0,
            "net_wager_won": 0.0,
        }

    history_entries = []
    total_cards_all_games = 0
    total_turns_completed = 0

    for r in rows:
        d = dict(r)
        p1_id = d["player1_id"]
        p2_id = d["player2_id"]
        p1_cards = int(d["player1_cards_played"] or 0)
        p2_cards = int(d["player2_cards_played"] or 0)
        p1_pts = int(d["player1_points"] or 0)
        p2_pts = int(d["player2_points"] or 0)
        p1_nobles = int(d["player1_nobles_count"] or 0)
        p2_nobles = int(d["player2_nobles_count"] or 0)
        wager_amt = round(float(d.get("wager_amount") or 0.0), 2)

        total_cards_all_games += p1_cards + p2_cards

        for pid, cards, pts, nobles in [
            (p1_id, p1_cards, p1_pts, p1_nobles),
            (p2_id, p2_cards, p2_pts, p2_nobles),
        ]:
            if pid not in per_partner:
                continue
            ps = per_partner[pid]
            ps["total_cards_played"] += cards
            ps["total_points_scored"] += pts
            ps["total_nobles_visited"] += nobles
            if cards > ps["max_cards_in_game"]:
                ps["max_cards_in_game"] = cards
            if pts > ps["high_score"]:
                ps["high_score"] = pts

            if d["status"] in ("completed", "forfeited"):
                ps["games_played"] += 1
                if d["winner_partner_id"] == pid:
                    ps["wins"] += 1
                    ps["net_wager_won"] = round(ps["net_wager_won"] + wager_amt, 2)
                elif d["winner_partner_id"] is not None:
                    ps["losses"] += 1
                    ps["net_wager_won"] = round(ps["net_wager_won"] - wager_amt, 2)
                if d["forfeited_by_partner_id"] == pid:
                    ps["forfeits"] += 1

        if d["status"] in ("completed", "forfeited"):
            total_turns_completed += int(d["turns_count"] or 0)

        history_entries.append({
            "id": d["id"],
            "status": d["status"],
            "player1_id": p1_id,
            "player1_name": partners_by_id.get(p1_id, {}).get("name", "Player 1"),
            "player1_color": partners_by_id.get(p1_id, {}).get("avatar_color", "#6366f1"),
            "player1_points": p1_pts,
            "player1_cards_played": p1_cards,
            "player1_nobles_count": p1_nobles,
            "player2_id": p2_id,
            "player2_name": partners_by_id.get(p2_id, {}).get("name", "Player 2"),
            "player2_color": partners_by_id.get(p2_id, {}).get("avatar_color", "#ec4899"),
            "player2_points": p2_pts,
            "player2_cards_played": p2_cards,
            "player2_nobles_count": p2_nobles,
            "winner_partner_id": d["winner_partner_id"],
            "winner_name": (
                partners_by_id.get(d["winner_partner_id"], {}).get("name")
                if d["winner_partner_id"]
                else None
            ),
            "forfeited_by_partner_id": d["forfeited_by_partner_id"],
            "forfeited_by_name": (
                partners_by_id.get(d["forfeited_by_partner_id"], {}).get("name")
                if d["forfeited_by_partner_id"]
                else None
            ),
            "turns_count": int(d["turns_count"] or 0),
            "wager_amount": wager_amt,
            "wager_month": d.get("wager_month") or "",
            "wager_settled": bool(d.get("wager_settled")),
            "created_at": d["created_at"],
            "completed_at": d["completed_at"],
        })

    for pid, ps in per_partner.items():
        gp = ps["games_played"]
        if gp > 0:
            ps["win_rate"] = round((ps["wins"] / gp) * 100.0, 1)
            ps["avg_cards_per_game"] = round(ps["total_cards_played"] / gp, 1)
            ps["avg_points_per_game"] = round(ps["total_points_scored"] / gp, 1)
        elif total_games > 0:
            ps["avg_cards_per_game"] = round(ps["total_cards_played"] / total_games, 1)
            ps["avg_points_per_game"] = round(ps["total_points_scored"] / total_games, 1)

    return {
        "total_games": total_games,
        "completed_games_count": len(completed_games),
        "active_games_count": len(active_games),
        "total_cards_played_all_time": total_cards_all_games,
        "avg_turns_per_completed_game": (
            round(total_turns_completed / len(completed_games), 1)
            if completed_games
            else 0.0
        ),
        "partner_stats": list(per_partner.values()),
        "game_history": history_entries[:30],
    }


@splendor_bp.route("/state", methods=["GET"])
def get_splendor_state():
    db = get_db()
    current_ym = _get_current_budget_month(db)
    partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color, monthly_fun_allowance FROM partners ORDER BY id ASC"
        ).fetchall()
    ]
    for p in partners:
        cat_name, lim = _get_partner_current_spending_money_limit(db, p, current_ym)
        p["spending_money_category"] = cat_name
        p["current_spending_money_limit"] = lim

    partners_by_id = {p["id"]: p for p in partners}

    active_row = db.execute(
        "SELECT * FROM splendor_games WHERE status = 'active' ORDER BY id DESC LIMIT 1"
    ).fetchone()

    active_game = _format_game_row(active_row, partners_by_id) if active_row else None
    latest_finished_row = None
    if not active_game:
        latest_finished_row = db.execute(
            "SELECT * FROM splendor_games WHERE status IN ('completed', 'forfeited') ORDER BY id DESC LIMIT 1"
        ).fetchone()
    latest_finished_game = (
        _format_game_row(latest_finished_row, partners_by_id)
        if latest_finished_row
        else None
    )

    analytics = _build_analytics(db, partners)

    return jsonify({
        "active_game": active_game,
        "latest_finished_game": latest_finished_game,
        "analytics": analytics,
        "partners": partners,
        "current_budget_month": current_ym,
        "catalog_summary": {
            "total_development_cards": len(RAW_CARDS),
            "tier_1_cards": 40,
            "tier_2_cards": 30,
            "tier_3_cards": 20,
            "total_nobles": len(RAW_NOBLES),
            "gem_colors": GEM_COLORS,
        },
    })


@splendor_bp.route("/new", methods=["POST"])
def create_new_splendor_game():
    actor = g.current_partner
    db = get_db()
    current_ym = _get_current_budget_month(db)
    partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color, monthly_fun_allowance FROM partners ORDER BY id ASC"
        ).fetchall()
    ]
    if len(partners) < 2:
        return jsonify({"error": "Two partner accounts are required to play Splendor."}), 400

    existing = db.execute(
        "SELECT id FROM splendor_games WHERE status = 'active' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if existing:
        return jsonify({"error": "An active game is already in progress. Finish or forfeit it first."}), 400

    data = request.get_json(silent=True) or {}
    p1_id = partners[0]["id"]
    p2_id = partners[1]["id"]

    try:
        wager_amount = round(max(0.0, float(data.get("wager_amount") or 0.0)), 2)
    except (TypeError, ValueError):
        return jsonify({"error": "Wager amount must be a valid number."}), 400

    for p in partners:
        cat_name, lim = _get_partner_current_spending_money_limit(db, p, current_ym)
        p["spending_money_category"] = cat_name
        p["current_spending_money_limit"] = lim

    if wager_amount > 0:
        for p in partners[:2]:
            if wager_amount > p["current_spending_money_limit"]:
                return jsonify({
                    "error": (
                        f"Wager of ${wager_amount:.2f} exceeds {p['name']}'s current month "
                        f"Spending Money budget (${p['current_spending_money_limit']:.2f})."
                    )
                }), 400

    requested_first = data.get("first_turn_partner_id")
    if requested_first in (p1_id, p2_id):
        first_turn_id = int(requested_first)
    else:
        first_turn_id = actor["id"] if actor["id"] in (p1_id, p2_id) else p1_id

    initial_state = _create_initial_game_state(
        p1_id,
        p2_id,
        first_turn_id,
        wager_amount=wager_amount,
        wager_month=current_ym,
    )

    cur = db.execute(
        """
        INSERT INTO splendor_games (
            status, player1_id, player2_id, current_turn_partner_id,
            player1_points, player2_points, player1_cards_played, player2_cards_played,
            player1_nobles_count, player2_nobles_count, turns_count,
            wager_amount, wager_month, wager_settled, game_state
        )
        VALUES ('active', ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?, 0, ?)
        """,
        (p1_id, p2_id, first_turn_id, wager_amount, current_ym, json.dumps(initial_state)),
    )
    game_id = cur.lastrowid

    other_partner_id = p2_id if actor["id"] == p1_id else p1_id
    wager_msg = f" (Wager: ${wager_amount:.2f} Spending Money!)" if wager_amount > 0 else ""
    create_notification(
        db,
        recipient_partner_id=other_partner_id,
        actor_partner_id=actor["id"],
        notif_type="splendor_new_game",
        title=f"{actor['name']} started a new game of Splendor!{wager_msg}",
        message="Open the Splendor board to collect gems, reserve cards, and race to 15 Prestige Points.",
        link_tab="splendor",
        reference_id=game_id,
    )

    row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    partners_by_id = {p["id"]: p for p in partners}
    return jsonify({
        "game": _format_game_row(row, partners_by_id),
        "analytics": _build_analytics(db, partners),
        "partners": partners,
    }), 201


def _validate_and_apply_discard(p_state: dict, bank: dict, return_tokens: dict) -> str | None:
    """Validates and applies token returns so player ends with <= 10 tokens."""
    if not isinstance(return_tokens, dict):
        return_tokens = {}
    for color, count in return_tokens.items():
        if color not in ALL_TOKEN_TYPES:
            return f"Invalid token color to return: {color}"
        cnt = int(count or 0)
        if cnt < 0:
            return "Return token count cannot be negative."
        if cnt > int(p_state["tokens"].get(color, 0)):
            return f"Cannot return more {GEM_LABELS.get(color, color)} tokens than you hold."

    for color, count in return_tokens.items():
        cnt = int(count or 0)
        if cnt > 0:
            p_state["tokens"][color] -= cnt
            bank[color] = int(bank.get(color, 0)) + cnt

    total_held = sum(int(v) for v in p_state["tokens"].values())
    if total_held > 10:
        return f"You have {total_held} tokens (limit is 10). Please select {total_held - 10} token(s) to return."
    return None


@splendor_bp.route("/<int:game_id>/turn", methods=["POST"])
def play_splendor_turn(game_id: int):
    actor = g.current_partner
    db = get_db()
    row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    if not row:
        return jsonify({"error": "Game not found."}), 404
    if row["status"] != "active":
        return jsonify({"error": "This game has already ended."}), 400
    if row["current_turn_partner_id"] != actor["id"]:
        return jsonify({"error": "It is your partner's turn right now."}), 403

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip()
    return_tokens = data.get("return_tokens") or {}

    state = json.loads(row["game_state"])
    bank = state["bank"]
    p_key = str(actor["id"])
    if p_key not in state["players"]:
        return jsonify({"error": "You are not a player in this game."}), 403
    p_state = state["players"][p_key]

    action_summary = ""
    purchased_card_obj = None

    if action == "take_different":
        gems = data.get("gems") or []
        if not isinstance(gems, list) or len(gems) == 0 or len(gems) > 3:
            return jsonify({"error": "Select 1 to 3 different gem types to take."}), 400
        if len(set(gems)) != len(gems):
            return jsonify({"error": "All selected gems must be of different types."}), 400
        for g_color in gems:
            if g_color not in GEM_COLORS:
                return jsonify({"error": f"Invalid gem: {g_color}. Gold cannot be taken directly."}), 400
            if int(bank.get(g_color, 0)) < 1:
                return jsonify({"error": f"No {GEM_LABELS[g_color]} gems remaining in the bank."}), 400

        available_colors_in_bank = sum(1 for c in GEM_COLORS if int(bank.get(c, 0)) > 0)
        if len(gems) < min(3, available_colors_in_bank):
            return jsonify({
                "error": f"You must take {min(3, available_colors_in_bank)} different gems when available in the bank."
            }), 400

        for g_color in gems:
            bank[g_color] -= 1
            p_state["tokens"][g_color] = int(p_state["tokens"].get(g_color, 0)) + 1

        discard_err = _validate_and_apply_discard(p_state, bank, return_tokens)
        if discard_err:
            return jsonify({"error": discard_err}), 400

        gem_names = ", ".join(GEM_LABELS[g] for g in gems)
        action_summary = f"{actor['name']} took {len(gems)} gems ({gem_names})."

    elif action == "take_same":
        g_color = (data.get("gem") or "").strip().lower()
        if g_color not in GEM_COLORS:
            return jsonify({"error": "Select a valid gem to take 2 of."}), 400
        if int(bank.get(g_color, 0)) < 4:
            return jsonify({"error": f"At least 4 {GEM_LABELS[g_color]} gems must be in the bank to take 2."}), 400

        bank[g_color] -= 2
        p_state["tokens"][g_color] = int(p_state["tokens"].get(g_color, 0)) + 2

        discard_err = _validate_and_apply_discard(p_state, bank, return_tokens)
        if discard_err:
            return jsonify({"error": discard_err}), 400

        action_summary = f"{actor['name']} took 2 {GEM_LABELS[g_color]} gems."

    elif action == "reserve":
        if len(p_state.get("reserved_cards", [])) >= 3:
            return jsonify({"error": "You already have 3 reserved cards (max 3)."}), 400

        card_id = data.get("card_id")
        tier = str(data.get("tier") or "")
        reserved_card = None

        if card_id is not None:
            card_id = int(card_id)
            for t_key in ("1", "2", "3"):
                board_list = state["board"].get(t_key, [])
                idx = next((i for i, c in enumerate(board_list) if c["id"] == card_id), None)
                if idx is not None:
                    reserved_card = board_list.pop(idx)
                    deck_list = state["decks"].get(t_key, [])
                    if deck_list:
                        board_list.append(deck_list.pop(0))
                    break
            if not reserved_card:
                return jsonify({"error": "Selected card is no longer on the board."}), 400
        elif tier in ("1", "2", "3"):
            deck_list = state["decks"].get(tier, [])
            if not deck_list:
                return jsonify({"error": f"Tier {tier} deck is empty."}), 400
            reserved_card = deck_list.pop(0)
        else:
            return jsonify({"error": "Provide a card_id or deck tier (1, 2, or 3) to reserve."}), 400

        p_state.setdefault("reserved_cards", []).append(reserved_card)
        got_gold = False
        if int(bank.get("gold", 0)) > 0:
            bank["gold"] -= 1
            p_state["tokens"]["gold"] = int(p_state["tokens"].get("gold", 0)) + 1
            got_gold = True

        discard_err = _validate_and_apply_discard(p_state, bank, return_tokens)
        if discard_err:
            return jsonify({"error": discard_err}), 400

        action_summary = (
            f"{actor['name']} reserved {reserved_card['title']} (Tier {reserved_card['tier']})"
            + (" and received 1 Gold." if got_gold else ".")
        )

    elif action == "buy":
        card_id = data.get("card_id")
        if card_id is None:
            return jsonify({"error": "card_id is required to purchase a card."}), 400
        card_id = int(card_id)

        target_card = None
        source_location = None
        source_tier = None
        source_idx = None

        res_list = p_state.get("reserved_cards", [])
        r_idx = next((i for i, c in enumerate(res_list) if c["id"] == card_id), None)
        if r_idx is not None:
            target_card = res_list[r_idx]
            source_location = "reserved"
            source_idx = r_idx
        else:
            for t_key in ("1", "2", "3"):
                board_list = state["board"].get(t_key, [])
                b_idx = next((i for i, c in enumerate(board_list) if c["id"] == card_id), None)
                if b_idx is not None:
                    target_card = board_list[b_idx]
                    source_location = "board"
                    source_tier = t_key
                    source_idx = b_idx
                    break

        if not target_card:
            return jsonify({"error": "Card not found on the board or in your reserved hand."}), 404

        can_afford, spend = _can_afford_card(p_state, target_card)
        if not can_afford:
            return jsonify({"error": "You do not have enough tokens and bonuses to buy this card."}), 400

        for color, amt in spend.items():
            if amt > 0:
                p_state["tokens"][color] -= amt
                bank[color] = int(bank.get(color, 0)) + amt

        if source_location == "reserved":
            res_list.pop(source_idx)
        else:
            board_list = state["board"][source_tier]
            board_list.pop(source_idx)
            deck_list = state["decks"].get(source_tier, [])
            if deck_list:
                board_list.append(deck_list.pop(0))

        p_state.setdefault("purchased_cards", []).append(target_card)
        _recalculate_player_metrics(p_state)
        purchased_card_obj = target_card

        pts_str = f" (+{target_card['points']} pts)" if target_card["points"] > 0 else ""
        action_summary = (
            f"{actor['name']} bought {target_card['title']} "
            f"[{GEM_LABELS[target_card['bonus']]} bonus{pts_str}]."
        )

    elif action == "pass":
        action_summary = f"{actor['name']} passed their turn."
    else:
        return jsonify({"error": f"Unknown action '{action}'."}), 400

    # Check Noble visit at end of turn
    awarded_noble = _check_and_award_noble(state, p_state)
    if awarded_noble:
        action_summary += f" 👑 Visited by {awarded_noble['title']} (+3 pts)!"

    new_turns_count = int(row["turns_count"] or 0) + 1
    state.setdefault("move_log", []).append({
        "turn": new_turns_count,
        "actor_id": actor["id"],
        "actor_name": actor["name"],
        "text": action_summary,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    p1_id = row["player1_id"]
    p2_id = row["player2_id"]
    p1_state = state["players"][str(p1_id)]
    p2_state = state["players"][str(p2_id)]

    _recalculate_player_metrics(p1_state)
    _recalculate_player_metrics(p2_state)

    p1_pts = int(p1_state["points"])
    p2_pts = int(p2_state["points"])
    p1_cards_cnt = len(p1_state.get("purchased_cards", []))
    p2_cards_cnt = len(p2_state.get("purchased_cards", []))
    p1_nobles_cnt = len(p1_state.get("nobles", []))
    p2_nobles_cnt = len(p2_state.get("nobles", []))

    if p1_pts >= 15 or p2_pts >= 15:
        state["final_round_triggered"] = True

    first_player_id = int(state.get("first_player_id") or p1_id)
    second_player_id = p2_id if first_player_id == p1_id else p1_id
    other_partner_id = p2_id if actor["id"] == p1_id else p1_id

    game_finished = bool(state.get("final_round_triggered")) and (actor["id"] == second_player_id)

    new_status = "active"
    winner_id = None
    completed_at = None
    wager_settled = int(row["wager_settled"] or 0)
    wager_amount = round(float(row["wager_amount"] or 0.0), 2)
    wager_month = row["wager_month"] or _get_current_budget_month(db)
    settlement_info = None

    if game_finished:
        new_status = "completed"
        completed_at = datetime.now(timezone.utc).isoformat()
        if p1_pts > p2_pts:
            winner_id = p1_id
        elif p2_pts > p1_pts:
            winner_id = p2_id
        else:
            if p1_cards_cnt < p2_cards_cnt:
                winner_id = p1_id
            elif p2_cards_cnt < p1_cards_cnt:
                winner_id = p2_id
            else:
                winner_id = actor["id"]

        loser_id = p2_id if winner_id == p1_id else p1_id

        if wager_amount > 0 and not wager_settled:
            settlement_info = _settle_wager_for_current_month(
                db,
                winner_id=winner_id,
                loser_id=loser_id,
                wager_amount=wager_amount,
                wager_month=wager_month,
            )
            if settlement_info:
                wager_settled = 1
                state["wager_settlement"] = settlement_info

        partners_map = {
            r["id"]: r["name"]
            for r in db.execute("SELECT id, name FROM partners").fetchall()
        }
        winner_name = partners_map.get(winner_id, "Winner")
        wager_win_str = (
            f" 💰 +${wager_amount:.2f} Spending Money won for {wager_month}!"
            if settlement_info
            else ""
        )
        state["move_log"].append({
            "turn": new_turns_count,
            "text": f"🏆 Game Over! {winner_name} wins ({p1_pts} to {p2_pts} pts)!{wager_win_str}",
            "timestamp": completed_at,
        })

    next_turn_id = other_partner_id

    db.execute(
        """
        UPDATE splendor_games
        SET status = ?,
            current_turn_partner_id = ?,
            winner_partner_id = ?,
            player1_points = ?,
            player2_points = ?,
            player1_cards_played = ?,
            player2_cards_played = ?,
            player1_nobles_count = ?,
            player2_nobles_count = ?,
            turns_count = ?,
            wager_settled = ?,
            game_state = ?,
            updated_at = datetime('now'),
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?
        """,
        (
            new_status,
            next_turn_id,
            winner_id,
            p1_pts,
            p2_pts,
            p1_cards_cnt,
            p2_cards_cnt,
            p1_nobles_cnt,
            p2_nobles_cnt,
            new_turns_count,
            wager_settled,
            json.dumps(state),
            completed_at,
            game_id,
        ),
    )
    db.commit()

    if new_status == "completed":
        create_notification(
            db,
            recipient_partner_id=other_partner_id,
            actor_partner_id=actor["id"],
            notif_type="splendor_game_over",
            title="Splendor Game Finished!",
            message=action_summary,
            link_tab="splendor",
            reference_id=game_id,
        )

    current_ym = _get_current_budget_month(db)
    partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color, monthly_fun_allowance FROM partners ORDER BY id ASC"
        ).fetchall()
    ]
    for p in partners:
        cat_name, lim = _get_partner_current_spending_money_limit(db, p, current_ym)
        p["spending_money_category"] = cat_name
        p["current_spending_money_limit"] = lim

    partners_by_id = {p["id"]: p for p in partners}
    updated_row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    return jsonify({
        "game": _format_game_row(updated_row, partners_by_id),
        "analytics": _build_analytics(db, partners),
        "partners": partners,
        "events": {
            "bought_card": purchased_card_obj,
            "awarded_noble": awarded_noble,
            "game_won": new_status == "completed",
            "winner_id": winner_id,
            "wager_settlement": settlement_info,
        },
    })


@splendor_bp.route("/<int:game_id>/forfeit", methods=["POST"])
def forfeit_splendor_game(game_id: int):
    actor = g.current_partner
    db = get_db()
    row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    if not row:
        return jsonify({"error": "Game not found."}), 404
    if row["status"] != "active":
        return jsonify({"error": "Only an active game can be forfeited."}), 400

    p1_id = row["player1_id"]
    p2_id = row["player2_id"]
    if actor["id"] not in (p1_id, p2_id):
        return jsonify({"error": "You are not a player in this game."}), 403

    winner_id = p2_id if actor["id"] == p1_id else p1_id
    loser_id = actor["id"]
    now_iso = datetime.now(timezone.utc).isoformat()

    state = json.loads(row["game_state"])
    p1_state = state["players"][str(p1_id)]
    p2_state = state["players"][str(p2_id)]
    _recalculate_player_metrics(p1_state)
    _recalculate_player_metrics(p2_state)

    p1_pts = int(p1_state["points"])
    p2_pts = int(p2_state["points"])
    p1_cards_cnt = len(p1_state.get("purchased_cards", []))
    p2_cards_cnt = len(p2_state.get("purchased_cards", []))

    wager_settled = int(row["wager_settled"] or 0)
    wager_amount = round(float(row["wager_amount"] or 0.0), 2)
    wager_month = row["wager_month"] or _get_current_budget_month(db)
    settlement_info = None

    if wager_amount > 0 and not wager_settled:
        settlement_info = _settle_wager_for_current_month(
            db,
            winner_id=winner_id,
            loser_id=loser_id,
            wager_amount=wager_amount,
            wager_month=wager_month,
        )
        if settlement_info:
            wager_settled = 1
            state["wager_settlement"] = settlement_info

    current_ym = _get_current_budget_month(db)
    partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color, monthly_fun_allowance FROM partners ORDER BY id ASC"
        ).fetchall()
    ]
    for p in partners:
        cat_name, lim = _get_partner_current_spending_money_limit(db, p, current_ym)
        p["spending_money_category"] = cat_name
        p["current_spending_money_limit"] = lim

    partners_by_id = {p["id"]: p for p in partners}
    winner_name = partners_by_id.get(winner_id, {}).get("name", "Partner")

    wager_note = f" 💰 ${wager_amount:.2f} Spending Money transferred to {winner_name}!" if settlement_info else ""
    state.setdefault("move_log", []).append({
        "turn": int(row["turns_count"] or 0),
        "actor_id": actor["id"],
        "actor_name": actor["name"],
        "text": f"🏳️ {actor['name']} forfeited. {winner_name} wins!{wager_note}",
        "timestamp": now_iso,
    })

    db.execute(
        """
        UPDATE splendor_games
        SET status = 'forfeited',
            winner_partner_id = ?,
            forfeited_by_partner_id = ?,
            player1_points = ?,
            player2_points = ?,
            player1_cards_played = ?,
            player2_cards_played = ?,
            wager_settled = ?,
            game_state = ?,
            updated_at = datetime('now'),
            completed_at = ?
        WHERE id = ?
        """,
        (
            winner_id,
            actor["id"],
            p1_pts,
            p2_pts,
            p1_cards_cnt,
            p2_cards_cnt,
            wager_settled,
            json.dumps(state),
            now_iso,
            game_id,
        ),
    )
    db.commit()

    create_notification(
        db,
        recipient_partner_id=winner_id,
        actor_partner_id=actor["id"],
        notif_type="splendor_forfeit",
        title=f"{actor['name']} forfeited Splendor — You Win!",
        message=f"You won Game #{game_id}!{wager_note}",
        link_tab="splendor",
        reference_id=game_id,
    )

    updated_row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    return jsonify({
        "game": _format_game_row(updated_row, partners_by_id),
        "analytics": _build_analytics(db, partners),
        "partners": partners,
        "events": {
            "game_won": True,
            "winner_id": winner_id,
            "wager_settlement": settlement_info,
        },
    })


@splendor_bp.route("/<int:game_id>/bump", methods=["POST"])
def bump_partner_turn(game_id: int):
    actor = g.current_partner
    db = get_db()
    row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    if not row:
        return jsonify({"error": "Game not found."}), 404
    if row["status"] != "active":
        return jsonify({"error": "This game is not active."}), 400

    p1_id = row["player1_id"]
    p2_id = row["player2_id"]
    if actor["id"] not in (p1_id, p2_id):
        return jsonify({"error": "You are not a player in this game."}), 403

    if row["current_turn_partner_id"] == actor["id"]:
        return jsonify({"error": "It is currently your turn! Play your move instead of bumping."}), 400

    now_dt = datetime.now(timezone.utc)
    if row["last_bump_at"]:
        try:
            last_dt = datetime.fromisoformat(row["last_bump_at"].replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            next_dt = last_dt + timedelta(hours=24)
            if now_dt < next_dt:
                rem_hours = round((next_dt - now_dt).total_seconds() / 3600.0, 1)
                return jsonify({
                    "error": f"Bump cooldown active: only one bump notification is allowed every 24 hours ({rem_hours}h remaining).",
                    "next_bump_at": next_dt.isoformat(),
                }), 429
        except ValueError:
            pass

    now_iso = now_dt.isoformat()
    db.execute(
        """
        UPDATE splendor_games
        SET last_bump_at = ?,
            last_bump_by_partner_id = ?,
            updated_at = datetime('now')
        WHERE id = ?
        """,
        (now_iso, actor["id"], game_id),
    )
    db.commit()

    recipient_id = row["current_turn_partner_id"]
    create_notification(
        db,
        recipient_partner_id=recipient_id,
        actor_partner_id=actor["id"],
        notif_type="splendor_bump",
        title=f"💎 {actor['name']} bumped you in Splendor!",
        message=f"It's your turn in Game #{game_id} ({row['player1_points']} - {row['player2_points']} pts). Tap to play your move!",
        link_tab="splendor",
        reference_id=game_id,
    )

    partners = [
        dict(r)
        for r in db.execute(
            "SELECT id, name, email, avatar_color FROM partners ORDER BY id ASC"
        ).fetchall()
    ]
    partners_by_id = {p["id"]: p for p in partners}
    updated_row = db.execute("SELECT * FROM splendor_games WHERE id = ?", (game_id,)).fetchone()
    return jsonify({
        "bumped": True,
        "game": _format_game_row(updated_row, partners_by_id),
    })
