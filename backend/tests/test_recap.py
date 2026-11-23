import pytest
from backend.app import create_app
from backend.modules.recap import parse_clip_url


@pytest.fixture()
def app_instance(tmp_path):
    db_file = tmp_path / "test_recap.db"
    return create_app({"TESTING": True, "DATABASE_PATH": str(db_file)})


@pytest.fixture()
def client(app_instance):
    with app_instance.test_client() as c:
        yield c


def _setup_two_partners_and_login(client):
    res = client.post(
        "/api/auth/partners",
        json={
            "household_name": "Gibson Family",
            "starting_budget_month": "2026-11",
            "partners": [
                {"name": "Alex", "password": "Password123!", "avatar_color": "#6366f1"},
                {"name": "Sam", "password": "Password456!", "avatar_color": "#ec4899"},
            ],
        },
    )
    assert res.status_code in (200, 201)
    partners = res.get_json()["partners"]
    alex_id = partners[0]["id"]
    sam_id = partners[1]["id"]

    login_res = client.post(
        "/api/auth/login",
        json={"partner_id": alex_id, "password": "Password123!"},
    )
    assert login_res.status_code == 200
    return alex_id, sam_id


def test_parse_clip_url_variants():
    yt = parse_clip_url("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share")
    assert yt is not None
    assert yt["platform"] == "youtube_short"
    assert yt["external_id"] == "dQw4w9WgXcQ"
    assert yt["normalized_url"] == "https://www.youtube.com/shorts/dQw4w9WgXcQ"

    yt_short = parse_clip_url("https://youtu.be/abc123XYZ")
    assert yt_short["platform"] == "youtube_short"
    assert yt_short["external_id"] == "abc123XYZ"

    ig = parse_clip_url("https://www.instagram.com/reel/C8xYzAb1234/?igsh=MTIzNDU=")
    assert ig is not None
    assert ig["platform"] == "instagram_reel"
    assert ig["external_id"] == "C8xYzAb1234"
    assert ig["normalized_url"] == "https://www.instagram.com/reel/C8xYzAb1234/"

    assert parse_clip_url("javascript:alert(1)") is None
    assert parse_clip_url("not a url") is None


def test_recap_requires_auth_and_sets_csp(client):
    assert client.get("/api/recap/clips").status_code == 401
    health = client.get("/api/health")
    csp = health.headers.get("Content-Security-Policy", "")
    assert "https://www.youtube.com" in csp
    assert "https://www.instagram.com" in csp


def test_recap_crud_notifications_and_period_filters(client):
    _, sam_id = _setup_two_partners_and_login(client)

    # Queue a YouTube Short and an Instagram Reel
    r1 = client.post(
        "/api/recap/clips",
        json={
            "url": "https://www.youtube.com/shorts/dQw4w9WgXcQ?si=test",
            "note": "Funny dog clip",
        },
    )
    assert r1.status_code == 201
    clip1 = r1.get_json()
    assert clip1["platform"] == "youtube_short"
    assert clip1["external_id"] == "dQw4w9WgXcQ"
    assert clip1["note"] == "Funny dog clip"
    assert clip1["watched"] == 0

    r2 = client.post(
        "/api/recap/clips",
        json={"url": "https://www.instagram.com/reel/C8xYzAb1234/?igsh=abc"},
    )
    assert r2.status_code == 201
    clip2 = r2.get_json()
    assert clip2["platform"] == "instagram_reel"
    assert clip2["external_id"] == "C8xYzAb1234"

    # Overview badge count reflects 2 unwatched clips
    ov = client.get("/api/overview").get_json()
    assert ov["unwatched_recap_clips"] == 2

    # List weekly & daily
    weekly = client.get("/api/recap/clips?period=week").get_json()
    assert len(weekly["clips"]) == 2
    assert len(weekly["weeks"]) == 1
    assert weekly["summary"]["unwatched_count"] == 2

    daily = client.get("/api/recap/clips?period=day").get_json()
    assert len(daily["clips"]) == 2

    # Favorite + mark one watched
    upd = client.put(
        f"/api/recap/clips/{clip1['id']}",
        json={"watched": True, "favorite": True},
    )
    assert upd.status_code == 200
    assert upd.get_json()["watched"] == 1
    assert upd.get_json()["favorite"] == 1

    favs = client.get("/api/recap/clips?period=all&status=favorites").get_json()
    assert len(favs["clips"]) == 1
    assert favs["clips"][0]["id"] == clip1["id"]

    # Mark remaining clips in week watched
    mark_res = client.post(
        "/api/recap/clips/mark-period-watched",
        json={"period": "week", "key": clip1["week_key"]},
    )
    assert mark_res.status_code == 200
    assert mark_res.get_json()["updated"] == 1

    ov2 = client.get("/api/overview").get_json()
    assert ov2["unwatched_recap_clips"] == 0

    # Delete a clip
    del_res = client.delete(f"/api/recap/clips/{clip2['id']}")
    assert del_res.status_code == 200

    # Partner Sam should have received recap notifications
    client.post(
        "/api/auth/login",
        json={"partner_id": sam_id, "password": "Password456!"},
    )
    notifs = client.get("/api/notifications").get_json()["notifications"]
    assert any(n["notif_type"] == "recap_added" and n["link_tab"] == "recap" for n in notifs)
