"""test_forecast.py - Tests for the Forecast Map data (offline, with fake Open-Meteo / RainViewer)."""
import pytest

from test_main import client, fresh_start  # noqa: F401  (pytest fixtures)
import forecast
import weather


@pytest.fixture(autouse=True)
def empty_cache():
    forecast._cache.update(forecast=(0, None), radar=(0, None))


def fake_get(json_body):
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return json_body
    return lambda *a, **k: FakeResponse()


def test_forecast_grid_is_reshaped_hour_row_column(client, monkeypatch):
    lats, lons = forecast.grid_coordinates()
    points = [(lat, lon) for lat in lats for lon in lons]
    times = ["2026-11-15T00:00", "2026-11-15T01:00"]
    # Each point gets rain = its row number, so we can check the reshaping
    fake = [{"hourly": {"time": times,
                        "precipitation": [float(k // len(lons))] * 2, "precipitation_probability": [50, 60],
                        "wind_speed_10m": [10, 12], "wind_direction_10m": [90, 180], "temperature_2m": [27, 26]}}
            for k, _ in enumerate(points)]
    monkeypatch.setattr(weather.httpx, "get", fake_get(fake))
    data = client.get("/api/forecast-grid").json()
    rows, cols = forecast.GRID["rows"], forecast.GRID["cols"]
    assert len(data["lats"]) == rows and len(data["lons"]) == cols and data["times"] == times
    assert len(data["rain_mm"]) == 2 and len(data["rain_mm"][0]) == rows and len(data["rain_mm"][0][0]) == cols
    assert data["rain_mm"][1][5][3] == 5.0          # hour 1, row 5 -> rain 5
    assert data["wind_from_deg"][1][0][0] == 180
    assert "Approximate" in data["note"]


def test_forecast_grid_unavailable_gives_503(client):
    r = client.get("/api/forecast-grid")
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]


def test_radar_frames(client, monkeypatch):
    monkeypatch.setattr(weather.httpx, "get", fake_get({
        "host": "https://tiles.example", "radar": {"past": [{"time": 1, "path": "/v2/radar/1"}]}}))
    data = client.get("/api/radar").json()
    assert data["frames"] == [{"time": 1, "tile_url": "https://tiles.example/v2/radar/1/256/{z}/{x}/{y}/2/1_1.png"}]
    assert "not a forecast" in data["note"]


def test_radar_unavailable_gives_503(client):
    assert client.get("/api/radar").status_code == 503
