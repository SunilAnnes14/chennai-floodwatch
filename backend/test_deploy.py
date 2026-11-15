"""test_deploy.py - Tests for running online (Vercel + PostgreSQL). Offline, like the other tests."""
import importlib.util
import io
import os

from PIL import Image

from test_main import GOOD_REPORT, client, fresh_start, token  # noqa: F401  (pytest fixtures)
import auth
import main
import terrain
from database import get_connection


def big_image():
    buffer = io.BytesIO()
    Image.new("RGB", (3000, 2000), "green").save(buffer, "JPEG")
    return buffer.getvalue()


def test_photo_is_stored_in_database_and_shrunk(client, token):
    client.post("/api/reports", data=GOOD_REPORT, files={"photo": ("big.jpg", big_image(), "image/jpeg")})
    report_id = client.get("/api/admin/reports", headers={"Authorization": f"Bearer {token}"}).json()[0]["id"]
    r = client.get(f"/api/admin/reports/{report_id}/photo", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert max(Image.open(io.BytesIO(r.content)).size) == main.MAX_PHOTO_PIXELS
    conn = get_connection()
    assert conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0] == 1
    conn.close()


def test_on_vercel_the_real_visitor_ip_is_used(client, monkeypatch):
    monkeypatch.setattr(main, "ON_VERCEL", True)
    client.post("/api/reports", data=GOOD_REPORT, headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.1"})
    conn = get_connection()
    assert conn.execute("SELECT reporter_ip FROM reports").fetchone()[0] == "203.0.113.7"
    conn.close()


def test_rate_limit_is_counted_in_the_database(client):
    """Online there are many short-lived servers, so the limit must not live in memory."""
    for i in range(main.REPORTS_PER_HOUR):
        assert client.post("/api/reports", data=dict(GOOD_REPORT, latitude=str(12.90 + i * 0.02))).status_code == 201
    assert client.post("/api/reports", data=dict(GOOD_REPORT, latitude="13.10")).status_code == 429


def test_admin_login_refused_online_without_a_real_secret(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(auth, "SECRET", auth.DEFAULT_SECRET)
    r = client.post("/api/admin/login", json={"email": "admin@test.com", "password": "correct-password"})
    assert r.status_code == 503 and "JWT_SECRET" in r.json()["detail"]
    monkeypatch.setattr(auth, "SECRET", "x" * 40)  # a real secret -> login works
    assert client.post("/api/admin/login", json={"email": "admin@test.com", "password": "correct-password"}).status_code == 200


def test_admin_created_from_settings(client, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "Owner@Example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "a-long-password-123")
    main.create_admin_from_settings()
    main.create_admin_from_settings()  # running twice must not fail or duplicate
    r = client.post("/api/admin/login", json={"email": "owner@example.com", "password": "a-long-password-123"})
    assert r.status_code == 200


def test_short_admin_password_is_ignored(client, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "weak@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "short")
    main.create_admin_from_settings()
    conn = get_connection()
    assert conn.execute("SELECT COUNT(*) FROM admins WHERE email = 'weak@example.com'").fetchone()[0] == 0
    conn.close()


def test_ready_made_terrain_grid_loads(client):
    assert terrain.load_saved_grid() is True
    data = client.get("/api/terrain").json()
    assert data["built"] is True and len(data["cells"]) > 1000


def load_vercel_entry(name):
    path = os.path.join(os.path.dirname(__file__), "..", "api", "index.py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_vercel_entry_point_imports_the_app():
    assert load_vercel_entry("vercel_entry").app is main.app


def test_vercel_without_database_explains_what_to_do(monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("DATABASE_URL", "")
    module = load_vercel_entry("vercel_entry_no_db")
    r = TestClient(module.app).get("/api/weather")
    assert r.status_code == 503 and "Neon" in r.json()["detail"]
