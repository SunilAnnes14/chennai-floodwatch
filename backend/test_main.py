"""
test_main.py - Automatic tests for the API.  Run with:  pytest -v

The tests use a separate temporary database and NEVER call the real
weather API - we replace it with a fake one ("monkeypatch") so the tests
work offline and give the same result every time.
"""
import io
import os
import tempfile

os.environ["FLOODWATCH_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["SKIP_ELEVATION"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
import weather  # noqa: E402
from auth import hash_password  # noqa: E402
from database import get_connection  # noqa: E402
from risk import calculate_risk  # noqa: E402

main.UPLOAD_DIR = tempfile.mkdtemp()  # test photos go to a temporary folder, not backend/uploads

GOOD_REPORT = {"location_text": "Velachery Main Road", "latitude": "12.98", "longitude": "80.22",
               "water_depth_cm": "40", "severity": "HIGH", "description": "Knee-deep water"}


def fake_find_street(lat, lon):
    """Pretend OpenStreetMap: everything north of 12.95 is on 'Velachery Main Road'."""
    if lat > 12.95:
        return {"street_name": "Velachery Main Road", "locality": "Vijaya Nagar",
                "geometry": [[lat, lon - 0.001], [lat, lon + 0.001]]}
    return {"street_name": "Pallikaranai Road", "locality": "Pallikaranai", "geometry": None}


def no_internet(*args, **kwargs):
    raise Exception("tests run offline")


@pytest.fixture(autouse=True)
def fresh_start(monkeypatch):
    main._report_times.clear()
    weather._cache["data"] = None
    main._tide_cache["data"] = None
    # No real internet in tests: every outside request fails unless a test replaces it with a fake
    monkeypatch.setattr(weather.httpx, "get", no_internet)
    monkeypatch.setattr(main.streets, "find_street", fake_find_street)
    yield


@pytest.fixture
def client():
    with TestClient(main.app) as c:  # "with" runs the startup code (creates tables)
        conn = get_connection()
        for table in ("reports", "alerts", "road_closures", "shelters", "grid_cells", "risk_log", "waterlogging_points"):
            conn.execute(f"DELETE FROM {table}")
        conn.execute("INSERT OR REPLACE INTO admins (email, password_hash) VALUES (?, ?)",
                     ("admin@test.com", hash_password("correct-password")))
        conn.commit()
        conn.close()
        yield c


@pytest.fixture
def token(client):
    r = client.post("/api/admin/login", json={"email": "admin@test.com", "password": "correct-password"})
    return r.json()["token"]


def make_image(fmt="JPEG"):
    buffer = io.BytesIO()
    Image.new("RGB", (50, 50), "blue").save(buffer, fmt)
    return buffer.getvalue()


# ---------- basic routes ----------

def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_eight_focus_areas_exist(client):
    names = [a["name"] for a in client.get("/api/areas").json()]
    assert "Velachery" in names and "T. Nagar" in names and len(names) == 8


# ---------- weather ----------

def test_weather_api_down_gives_503(client, monkeypatch):
    def broken(*args, **kwargs):
        raise Exception("network down")
    monkeypatch.setattr(weather.httpx, "get", broken)
    r = client.get("/api/weather")
    assert r.status_code == 503
    assert "unavailable" in r.json()["detail"]
    assert client.get("/api/risk").status_code == 503  # no risk without real data


def test_weather_success(client, monkeypatch):
    hours = [f"2026-11-13T{h:02d}:00" for h in range(24)] + [f"2026-11-14T{h:02d}:00" for h in range(24)]

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            one = {"current": {"time": "2026-11-13T23:15", "temperature_2m": 27, "precipitation": 1.0},
                   "hourly": {"time": hours, "precipitation": [2.0] * 48,
                              "precipitation_probability": [80] * 48}}
            return [one] * 8

    monkeypatch.setattr(weather.httpx, "get", lambda *a, **k: FakeResponse())
    data = client.get("/api/weather").json()
    velachery = data["areas"][0]
    assert velachery["rain_last_24h"] == 48.0   # 24 past hours x 2 mm
    assert velachery["rain_next_24h"] == 48.0
    assert velachery["rain_last_1h"] == 2.0


# ---------- risk score ----------

def test_risk_missing_data_gives_no_level():
    assert calculate_risk(None, 10, 5)["level"] is None


def test_risk_levels():
    assert calculate_risk(0, 0, 5)["level"] == "LOW"
    assert calculate_risk(40, 40, 30)["level"] == "MODERATE"   # 80 mm = heavy, high ground
    assert calculate_risk(40, 40, 5)["level"] == "HIGH"        # same rain, low ground
    assert calculate_risk(150, 100, 5)["level"] == "VERY_HIGH"


# ---------- citizen reports ----------

def test_submit_report_with_photo(client):
    r = client.post("/api/reports", data=GOOD_REPORT,
                    files={"photo": ("flood.jpg", make_image(), "image/jpeg")})
    assert r.status_code == 201
    assert r.json()["status"] == "PENDING"
    report = client.get("/api/reports").json()[0]
    assert report["status"] == "PENDING"
    assert "reporter_ip" not in report        # privacy
    assert report["photo_url"] is None        # photo hidden until verified


def test_report_outside_chennai_rejected(client):
    bad = dict(GOOD_REPORT, latitude="28.6", longitude="77.2")  # Delhi
    assert client.post("/api/reports", data=bad).status_code == 422


def test_bad_severity_rejected(client):
    assert client.post("/api/reports", data=dict(GOOD_REPORT, severity="HUGE")).status_code == 422


def test_non_image_file_rejected(client):
    r = client.post("/api/reports", data=GOOD_REPORT,
                    files={"photo": ("virus.jpg", b"not really an image", "image/jpeg")})
    assert r.status_code == 415


def test_duplicate_report_rejected(client):
    assert client.post("/api/reports", data=GOOD_REPORT).status_code == 201
    assert client.post("/api/reports", data=GOOD_REPORT).status_code == 409


def test_rate_limit(client):
    for i in range(5):
        far_away = dict(GOOD_REPORT, latitude=str(12.90 + i * 0.02))  # different places, no duplicates
        assert client.post("/api/reports", data=far_away).status_code == 201
    assert client.post("/api/reports", data=dict(GOOD_REPORT, latitude="13.10")).status_code == 429


# ---------- admin ----------

def test_wrong_password(client):
    r = client.post("/api/admin/login", json={"email": "admin@test.com", "password": "wrong"})
    assert r.status_code == 401


def test_admin_routes_need_login(client):
    assert client.get("/api/admin/reports").status_code == 401
    assert client.get("/api/admin/reports", headers={"Authorization": "Bearer fake"}).status_code == 401


def test_verify_report_flow(client, token):
    client.post("/api/reports", data=GOOD_REPORT, files={"photo": ("f.png", make_image("PNG"), "image/png")})
    headers = {"Authorization": f"Bearer {token}"}
    report = client.get("/api/admin/reports", headers=headers).json()[0]

    r = client.patch(f"/api/admin/reports/{report['id']}", json={"status": "VERIFIED"}, headers=headers)
    assert r.status_code == 200
    public = client.get("/api/reports").json()[0]
    assert public["status"] == "VERIFIED"
    assert client.get(public["photo_url"]).status_code == 200  # photo now visible


def test_rejected_report_is_hidden(client, token):
    client.post("/api/reports", data=GOOD_REPORT)
    headers = {"Authorization": f"Bearer {token}"}
    report_id = client.get("/api/admin/reports", headers=headers).json()[0]["id"]
    client.patch(f"/api/admin/reports/{report_id}", json={"status": "REJECTED"}, headers=headers)
    assert client.get("/api/reports").json() == []


def test_alerts_and_closures(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/admin/alerts", headers=headers, json={
        "title": "Heavy rain warning", "message": "Stay indoors", "alert_type": "OFFICIAL", "source": "IMD Chennai"})
    assert r.status_code == 201
    assert client.get("/api/alerts").json()[0]["title"] == "Heavy rain warning"

    r = client.post("/api/admin/road-closures", headers=headers, json={
        "road_name": "Velachery Bypass", "latitude": 12.98, "longitude": 80.22, "source": "Traffic Police"})
    assert r.status_code == 201
    closure_id = r.json()["id"]
    client.delete(f"/api/admin/road-closures/{closure_id}", headers=headers)
    assert client.get("/api/road-closures").json() == []


# ---------- street by street ----------

import streets  # noqa: E402


def test_only_nearby_part_of_street_is_kept():
    # A straight 2 km road (GeoJSON order: [lon, lat]) with only 2 points
    road = [[80.20, 12.98], [80.2184, 12.98]]
    part = streets.nearby_part(road, 12.98, 80.21)
    assert part is not None
    for lat, lon in part:  # every kept point is within 150 m of the report
        assert streets.distance_m(12.98, 80.21, lat, lon) <= 150
    assert streets.distance_m(*part[0], *part[-1]) > 250  # but it covers about 300 m of road


def test_street_far_away_gives_no_shape():
    assert streets.nearby_part([[80.30, 13.05], [80.31, 13.05]], 12.98, 80.21) is None


def test_report_saves_street_name(client):
    r = client.post("/api/reports", data=GOOD_REPORT)
    assert r.json()["street_name"] == "Velachery Main Road"
    assert client.get("/api/reports").json()[0]["street_geometry"] is not None


def test_report_still_saved_when_street_lookup_fails(client, monkeypatch):
    monkeypatch.setattr(main.streets, "find_street", lambda lat, lon: None)
    assert client.post("/api/reports", data=GOOD_REPORT).status_code == 201
    street = client.get("/api/streets").json()["streets"][0]
    assert street["street_name"].startswith("Street not identified")


def test_streets_are_grouped_and_verified_first(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    # Two reports on Velachery Main Road (from two different people), one on Pallikaranai Road
    main._report_times.clear()
    client.post("/api/reports", data=dict(GOOD_REPORT, water_depth_cm="20", severity="MODERATE"))
    client.post("/api/reports", data=dict(GOOD_REPORT, latitude="12.983", water_depth_cm="60", severity="SEVERE"),
                headers={"X-Forwarded-For": "other"})
    client.post("/api/reports", data=dict(GOOD_REPORT, latitude="12.93", location_text="Pallikaranai marsh road"))
    pallikaranai = [r for r in client.get("/api/admin/reports", headers=headers).json()
                    if r["street_name"] == "Pallikaranai Road"][0]
    client.patch(f"/api/admin/reports/{pallikaranai['id']}", json={"status": "VERIFIED"}, headers=headers)

    result = client.get("/api/streets").json()["streets"]
    assert [s["street_name"] for s in result] == ["Pallikaranai Road", "Velachery Main Road"]
    assert result[0]["status"] == "VERIFIED" and result[0]["area"] == "Pallikaranai"
    velachery = result[1]
    assert velachery["status"] == "UNVERIFIED"
    assert velachery["unverified_reports"] == 2
    assert velachery["max_depth_cm"] == 60 and velachery["worst_severity"] == "SEVERE"
    assert velachery["area"] == "Velachery"


def test_rejected_reports_not_in_streets(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/api/reports", data=GOOD_REPORT)
    report_id = client.get("/api/admin/reports", headers=headers).json()[0]["id"]
    client.patch(f"/api/admin/reports/{report_id}", json={"status": "REJECTED"}, headers=headers)
    assert client.get("/api/streets").json()["streets"] == []
