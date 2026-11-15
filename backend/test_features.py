"""
test_features.py - Tests for the Predict -> Detect -> Alert improvements.  Run with:  pytest -v

Uses the same offline set-up as test_main.py (temporary database, no real internet).
"""
from datetime import datetime, timedelta, timezone

from test_main import client, fresh_start, token  # noqa: F401  (pytest fixtures)
import main
import routing
import terrain
import weather
from database import get_connection


def fake_weather(monkeypatch, mm_per_hour):
    """Pretend Open-Meteo: the same rain every hour, for all 8 areas (48 h: 24 past + 24 forecast)."""
    hours = [f"2026-11-13T{h:02d}:00" for h in range(24)] + [f"2026-11-14T{h:02d}:00" for h in range(24)]

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            one = {"current": {"time": "2026-11-13T23:15", "temperature_2m": 27, "precipitation": 1.0},
                   "hourly": {"time": hours, "precipitation": [mm_per_hour] * 48,
                              "precipitation_probability": [80] * 48}}
            return [one] * 8

    monkeypatch.setattr(weather.httpx, "get", lambda *a, **k: FakeResponse())
    conn = get_connection()
    conn.execute("UPDATE areas SET elevation_m = 5")
    conn.commit()
    conn.close()


def ago(hours):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")


def add_report(ip, lat=12.98, lon=80.22, status="PENDING", created=None, verified=None, severity="HIGH", depth=40):
    """Put a report straight into the database (lets us fake different people and times)."""
    conn = get_connection()
    cur = conn.execute(
        """INSERT INTO reports (location_text, latitude, longitude, water_depth_cm, severity, status, reporter_ip,
                                created_at, verified_at, street_name, locality) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id""",
        ("test place", lat, lon, depth, severity, status, ip, created or ago(0), verified,
         "Velachery Main Road", "Vijaya Nagar"))
    new_id = cur.fetchone()["id"]
    conn.commit()
    conn.close()
    return new_id


def area_id(name):
    conn = get_connection()
    value = conn.execute("SELECT id FROM areas WHERE name = ?", (name,)).fetchone()[0]
    conn.close()
    return value


# ---------- PREDICT: street-level susceptibility ----------

def test_susceptibility_rule():
    # Just above a river, right next to it -> HIGH (even if the place is 20 m above the sea, like Mudichur)
    high, level_high, _ = terrain.susceptibility(height_above_water_m=1, water_distance_m=100)
    low, level_low, _ = terrain.susceptibility(height_above_water_m=12, water_distance_m=2000)
    assert level_high == "HIGH" and high == 1.0
    assert level_low == "LOW" and low == 0
    assert terrain.susceptibility(None, None)[1] == "LOW"   # no water nearby


def test_street_level_risk_uses_ground_and_history():
    high_cell, low_cell = {"level": "HIGH"}, {"level": "LOW"}
    assert terrain.street_level_risk(80, high_cell)[0] == "HIGH"       # heavy rain + flood-prone ground
    assert terrain.street_level_risk(80, low_cell)[0] == "MODERATE"    # same rain, higher ground
    assert terrain.street_level_risk(80, low_cell, flood_history=2)[0] == "HIGH"  # flooded here before
    assert terrain.street_level_risk(10, high_cell, flood_history=5)[0] == "LOW"  # no heavy rain -> no raise
    assert terrain.street_level_risk(None, high_cell)[0] is None       # no rain data -> no guess


def test_flood_history_raises_street_risk(client, monkeypatch):
    fake_weather(monkeypatch, 2.0)  # heavy rain
    before = client.get("/api/street-risk", params={"latitude": 12.98, "longitude": 80.22}).json()
    add_report("x", status="RESOLVED", created=ago(24 * 300))  # a verified flood here ~10 months ago
    after = client.get("/api/street-risk", params={"latitude": 12.98, "longitude": 80.22}).json()
    assert (before["predicted_level"], after["predicted_level"]) == ("MODERATE", "HIGH")
    assert after["flood_history"] == 1


def test_import_waterlogging_points(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    csv_file = ("name,latitude,longitude\n"
                "Vijaya Nagar 2nd Main Road,12.9790,80.2195\n"
                "Bad row,not-a-number,80.2\n"        # skipped, never guessed
                "Delhi street,28.6,77.2\n")           # outside Chennai, skipped
    r = client.post("/api/admin/waterlogging/import", headers=headers, data={"source": "GCC list (test)"},
                    files={"file": ("points.csv", csv_file, "text/csv")})
    assert r.json() == {"added": 1, "skipped_lines": [3, 4]}
    points = client.get("/api/waterlogging").json()
    assert points[0]["name"] == "Vijaya Nagar 2nd Main Road" and points[0]["source"] == "GCC list (test)"
    assert main.flood_history(12.98, 80.22) == 1
    bad = client.post("/api/admin/waterlogging/import", headers=headers, data={"source": "x"},
                      files={"file": ("p.csv", "street,lat\nA,1\n", "text/csv")})
    assert bad.status_code == 422


def test_street_risk_endpoint(client, monkeypatch):
    fake_weather(monkeypatch, 2.0)  # 48 + 48 = 96 mm -> heavy rain
    conn = get_connection()
    conn.execute("INSERT INTO grid_cells (latitude, longitude, elevation_m, height_above_water_m, water_distance_m,"
                 " nearest_water, score, level) VALUES (12.98, 80.22, 6, 1, 150, 'Velachery Lake', 0.9, 'HIGH')")
    conn.commit()
    conn.close()
    data = client.get("/api/street-risk", params={"latitude": 12.981, "longitude": 80.221}).json()
    assert data["predicted_level"] == "HIGH"
    assert data["susceptibility"]["nearest_water"] == "Velachery Lake"
    assert client.get("/api/terrain").json()["built"] is True


def test_street_outside_grid_still_answers(client, monkeypatch):
    fake_weather(monkeypatch, 2.0)
    data = client.get("/api/street-risk", params={"latitude": 13.05, "longitude": 80.25}).json()  # no grid here
    assert data["susceptibility"] is None and data["predicted_level"] == "MODERATE"
    assert "not inside the terrain grid" in data["explanation"]


def test_street_risk_without_weather_makes_no_guess(client):
    data = client.get("/api/street-risk", params={"latitude": 12.98, "longitude": 80.22}).json()
    assert data["weather_available"] is False and data["predicted_level"] is None


# ---------- PREDICT: logging, automatic prediction alerts, track record ----------

def test_high_risk_creates_one_automatic_alert_per_area(client, monkeypatch):
    fake_weather(monkeypatch, 5.0)  # 120 + 120 mm -> VERY HIGH everywhere
    client.get("/api/risk")
    client.get("/api/risk")  # a second call must not duplicate anything
    predictions = [a for a in client.get("/api/alerts").json() if a["alert_type"] == "PREDICTION"]
    assert len(predictions) == 8 and all(a["is_automatic"] == 1 for a in predictions)
    assert {a["area_name"] for a in predictions} >= {"Velachery", "Adyar"}
    conn = get_connection()
    assert conn.execute("SELECT COUNT(*) FROM risk_log").fetchone()[0] == 8
    conn.close()


def test_low_rain_creates_no_alert(client, monkeypatch):
    fake_weather(monkeypatch, 0.1)
    client.get("/api/risk")
    assert client.get("/api/alerts").json() == []


def test_track_record(client):
    conn = get_connection()
    for name, logged, level in (("Velachery", ago(30), "HIGH"), ("Adyar", ago(30), "HIGH"), ("Velachery", ago(2), "LOW")):
        conn.execute("INSERT INTO risk_log (area_id, logged_at, risk_level, rain_total) VALUES (?, ?, ?, 100)",
                     (area_id(name), logged, level))
    conn.commit()
    conn.close()
    add_report("a", status="VERIFIED", created=ago(28), verified=ago(27))  # flooding in Velachery 2 h later
    data = client.get("/api/risk/track-record").json()
    assert data["total_predictions"] == 2  # the 2-hour-old prediction is too recent to judge
    assert data["levels"]["HIGH"] == {"predictions": 2, "followed_by_flooding": 1, "rate": 0.5}


# ---------- DETECT: corroboration and expiry ----------

def test_three_people_make_a_street_likely_flooded(client, token):
    for i, ip in enumerate(("1.1.1.1", "2.2.2.2", "3.3.3.3")):
        add_report(ip, lat=12.98 + 0.0005 * i)
    street = client.get("/api/streets").json()["streets"][0]
    assert street["independent_reporters"] == 3 and street["likely_flooded"] is True
    queue = client.get("/api/admin/reports?status=PENDING", headers={"Authorization": f"Bearer {token}"}).json()
    assert queue[0]["independent_reporters"] == 3


def test_same_person_twice_is_not_corroboration(client):
    add_report("1.1.1.1")
    add_report("1.1.1.1", lat=12.981)
    street = client.get("/api/streets").json()["streets"][0]
    assert street["independent_reporters"] == 1 and street["likely_flooded"] is False


def test_verified_report_expires_and_can_be_reconfirmed(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    report_id = add_report("a", status="VERIFIED", created=ago(8), verified=ago(7))
    assert client.get("/api/reports").json() == []          # 7 h old -> no longer "flooded now"
    assert client.get("/api/streets").json()["streets"] == []
    assert client.get("/api/admin/reports", headers=headers).json()[0]["expired"] is True
    client.patch(f"/api/admin/reports/{report_id}", json={"status": "VERIFIED"}, headers=headers)  # re-confirm
    assert client.get("/api/reports").json()[0]["id"] == report_id


def test_expired_floods_do_not_block_routes(client, token):
    add_report("a", status="VERIFIED", created=ago(10), verified=ago(9))
    assert main.current_hazards() == []


# ---------- ALERT: automatic, area-specific, expiring ----------

def test_verifying_dangerous_flooding_creates_area_alert_once(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    first = add_report("a", depth=45, severity="HIGH")
    second = add_report("b", lat=12.981, depth=50, severity="SEVERE")
    r = client.patch(f"/api/admin/reports/{first}", json={"status": "VERIFIED"}, headers=headers)
    assert r.json()["auto_alert_id"] is not None
    client.patch(f"/api/admin/reports/{second}", json={"status": "VERIFIED"}, headers=headers)  # same street, same day
    alerts = client.get("/api/alerts").json()
    assert len(alerts) == 1
    assert alerts[0]["alert_type"] == "VERIFIED_REPORT" and alerts[0]["area_name"] == "Velachery"


def test_shallow_flooding_creates_no_alert(client, token):
    report_id = add_report("a", depth=10, severity="LOW")
    client.patch(f"/api/admin/reports/{report_id}", json={"status": "VERIFIED"},
                 headers={"Authorization": f"Bearer {token}"})
    assert client.get("/api/alerts").json() == []


def test_alert_for_one_area_and_expiry(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    alert = {"title": "Adyar warning", "message": "Water rising", "alert_type": "OFFICIAL", "source": "GCC"}
    assert client.post("/api/admin/alerts", headers=headers, json={**alert, "area_id": 999}).status_code == 422
    client.post("/api/admin/alerts", headers=headers, json={**alert, "area_id": area_id("Adyar"), "expires_hours": 2})
    assert client.get("/api/alerts").json()[0]["area_name"] == "Adyar"
    conn = get_connection()
    conn.execute("UPDATE alerts SET expires_at = ?", (ago(1),))
    conn.commit()
    conn.close()
    assert client.get("/api/alerts").json() == []  # expired alerts disappear


# ---------- ALERT: routing around problems, evacuation, briefing ----------

def fake_route(points):
    """A straight 'route' through the given points, in OSRM's format."""
    coords = []
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        coords += [[lon1 + (lon2 - lon1) * i / 50, lat1 + (lat2 - lat1) * i / 50] for i in range(51)]
    return {"distance": 5000 * (len(points) - 1), "duration": 600 * (len(points) - 1),
            "geometry": {"coordinates": coords}}


def test_detour_avoids_a_closed_road(monkeypatch):
    monkeypatch.setattr(routing, "osrm", lambda points, alternatives=False: [fake_route(points)])
    start, end = (12.95, 80.20), (13.05, 80.20)            # straight north
    closure = {"kind": "closure", "id": 1, "road_name": "Blocked Rd", "latitude": 13.00, "longitude": 80.20}
    routes = routing.plan(start, end, [closure])
    assert routes[0]["is_detour"] is True and routes[0]["problem_count"] == 0
    assert any(r["closures_on_route"] for r in routes)       # the blocked direct route is still listed


def test_no_detour_needed_when_road_is_clear(monkeypatch):
    calls = []
    monkeypatch.setattr(routing, "osrm",
                        lambda points, alternatives=False: calls.append(points) or [fake_route(points)])
    routes = routing.plan((12.95, 80.20), (13.05, 80.20), [])
    assert len(calls) == 1 and routes[0]["is_detour"] is False


def test_evacuation_to_nearest_shelter(client, token, monkeypatch):
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get("/api/evacuate", params={"latitude": 12.98, "longitude": 80.22})
    assert r.status_code == 404 and "1070" in r.json()["detail"]   # no shelters yet: say who to call
    client.post("/api/admin/shelters", headers=headers, json={
        "name": "Far school", "latitude": 13.08, "longitude": 80.27, "source": "test"})
    client.post("/api/admin/shelters", headers=headers, json={
        "name": "Near hall", "latitude": 12.99, "longitude": 80.22, "capacity": 200, "source": "test"})
    monkeypatch.setattr(routing, "osrm", lambda points, alternatives=False: [fake_route(points)])
    data = client.get("/api/evacuate", params={"latitude": 12.98, "longitude": 80.22}).json()
    assert data["shelter"]["name"] == "Near hall"
    assert data["other_shelters"][0]["name"] == "Far school"


def test_shelter_outside_chennai_rejected(client, token):
    r = client.post("/api/admin/shelters", headers={"Authorization": f"Bearer {token}"}, json={
        "name": "Delhi hall", "latitude": 28.6, "longitude": 77.2, "source": "test"})
    assert r.status_code == 422


def test_briefing_and_csv(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    report_id = add_report("a", depth=60, severity="SEVERE")
    client.patch(f"/api/admin/reports/{report_id}", json={"status": "VERIFIED"}, headers=headers)
    data = client.get("/api/admin/briefing", headers=headers).json()
    assert data["dangerous_streets"][0]["street_name"] == "Velachery Main Road"
    csv_text = client.get("/api/admin/briefing.csv", headers=headers).text
    assert csv_text.startswith("type,name") and "DANGEROUS STREET,Velachery Main Road" in csv_text
    assert client.get("/api/admin/briefing").status_code == 401  # authorities' page needs login


# ---------- PREDICT: tide ----------

def test_tide_finds_high_and_low_water(client, monkeypatch):
    levels = [0.2, 0.5, 0.8, 0.6, 0.3, 0.1, 0.4]

    class FakeMarine:
        def raise_for_status(self):
            pass

        def json(self):
            return {"hourly": {"time": [f"2026-11-14T{h:02d}:00" for h in range(7)], "sea_level_height_msl": levels}}

    monkeypatch.setattr(weather.httpx, "get", lambda *a, **k: FakeMarine())
    data = client.get("/api/tide").json()
    assert [(t["type"], t["sea_level_m"]) for t in data["turns"]] == [("HIGH", 0.8), ("LOW", 0.1)]


def test_tide_unavailable_gives_503(client):
    assert client.get("/api/tide").status_code == 503
