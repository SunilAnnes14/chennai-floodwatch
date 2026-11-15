"""
forecast.py - Data for the Forecast Map (rain, wind and temperature, hour by hour).

We ask Open-Meteo for the forecast at a 15 x 15 grid of points (~6 km apart) covering
greater Chennai and the nearby sea, for the next 48 hours. The website colours the map between the points
and animates the wind.

APPROXIMATE: the weather models behind Open-Meteo have a resolution of roughly 10-25 km,
so the map shows the general pattern of rain, not exact street-by-street rain.

Radar: RainViewer publishes real OBSERVED radar images (past ~2 hours). We pass on the
list of images; the website shows the newest one.
"""
import time

import httpx

GRID = {"lat_min": 12.66, "lon_min": 79.92, "lat_step": 0.06, "lon_step": 0.05, "rows": 15, "cols": 15}
CACHE_SECONDS = 30 * 60

_cache = {"forecast": (0, None), "radar": (0, None)}


class ForecastError(Exception):
    pass


def grid_coordinates():
    lats = [round(GRID["lat_min"] + i * GRID["lat_step"], 3) for i in range(GRID["rows"])]
    lons = [round(GRID["lon_min"] + j * GRID["lon_step"], 3) for j in range(GRID["cols"])]
    return lats, lons


def get_forecast_grid():
    saved_at, data = _cache["forecast"]
    if data and time.time() - saved_at < CACHE_SECONDS:
        return data

    lats, lons = grid_coordinates()
    points = [(lat, lon) for lat in lats for lon in lons]  # row by row, south to north
    try:
        response = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=30, params={
            "latitude": ",".join(str(p[0]) for p in points),
            "longitude": ",".join(str(p[1]) for p in points),
            "hourly": "precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,temperature_2m",
            "forecast_hours": 48,   # 48 hours starting from the current hour
            "timezone": "Asia/Kolkata",
        })
        response.raise_for_status()
        results = response.json()
    except Exception as error:
        raise ForecastError(f"Open-Meteo is unavailable: {error}")

    def table(name):
        """values[hour][row][col] for one weather variable (None where the model has no value)."""
        hours = len(results[0]["hourly"]["time"])
        return [[[results[i * len(lons) + j]["hourly"][name][h] for j in range(len(lons))]
                 for i in range(len(lats))] for h in range(hours)]

    data = {
        "lats": lats,
        "lons": lons,
        "times": results[0]["hourly"]["time"],  # Indian time, e.g. "2026-11-15T21:00"
        "rain_mm": table("precipitation"),
        "rain_chance": table("precipitation_probability"),
        "wind_kmh": table("wind_speed_10m"),
        "wind_from_deg": table("wind_direction_10m"),  # direction the wind blows FROM
        "temperature_c": table("temperature_2m"),
        "source": "Open-Meteo.com (CC BY 4.0) - weather model forecast",
        "note": "Approximate: weather models have a resolution of about 10-25 km.",
    }
    _cache["forecast"] = (time.time(), data)
    return data


def get_radar():
    saved_at, data = _cache["radar"]
    if data and time.time() - saved_at < 5 * 60:
        return data
    try:
        response = httpx.get("https://api.rainviewer.com/public/weather-maps.json", timeout=15)
        response.raise_for_status()
        maps = response.json()
    except Exception as error:
        raise ForecastError(f"RainViewer radar is unavailable: {error}")
    frames = maps.get("radar", {}).get("past", [])
    data = {
        "frames": [{"time": f["time"], "tile_url": f"{maps['host']}{f['path']}/256/{{z}}/{{x}}/{{y}}/2/1_1.png"}
                   for f in frames],
        "source": "RainViewer.com - observed radar",
        "note": "Observed rain from weather radars (not a forecast). An empty map can mean no rain, "
                "or no radar coverage here.",
    }
    _cache["radar"] = (time.time(), data)
    return data
