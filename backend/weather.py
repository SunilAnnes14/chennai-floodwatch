"""
weather.py - Gets REAL weather from the free Open-Meteo API (https://open-meteo.com).

* One request fetches all 8 areas at once (Open-Meteo accepts many coordinates).
* Results are kept in memory for 15 minutes so we don't call the API too often.
* If the API fails we raise WeatherError -> the website shows "service unavailable".
  We NEVER make up weather numbers.

Note: Open-Meteo values come from weather models, not rain gauges.
"""
import time
import httpx

from database import get_connection

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
CACHE_SECONDS = 15 * 60

_cache = {"time": 0, "data": None}  # simple in-memory cache


class WeatherError(Exception):
    pass


def get_areas():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM areas ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def total(values):
    """Add up rainfall values. If any hour is missing (None), return None instead of guessing."""
    if not values or any(v is None for v in values):
        return None
    return round(sum(values), 1)


def get_weather():
    # 1. Use the cached copy if it is fresh
    if _cache["data"] and time.time() - _cache["time"] < CACHE_SECONDS:
        return _cache["data"]

    areas = get_areas()
    params = {
        "latitude": ",".join(str(a["latitude"]) for a in areas),
        "longitude": ",".join(str(a["longitude"]) for a in areas),
        "current": "temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m",
        "hourly": "precipitation,precipitation_probability",
        "past_days": 1,
        "forecast_days": 2,
        "timezone": "Asia/Kolkata",
    }

    # 2. Call the API
    try:
        response = httpx.get(FORECAST_URL, params=params, timeout=15)
        response.raise_for_status()
        results = response.json()
    except Exception as error:
        raise WeatherError(f"Open-Meteo is unavailable: {error}")
    if isinstance(results, dict):  # only one location -> API returns a dict, not a list
        results = [results]

    # 3. Work out rainfall numbers for each area
    output = []
    conn = get_connection()
    for area, data in zip(areas, results):
        current = data["current"]
        hours = data["hourly"]["time"]          # like "2026-11-13T21:00" (Indian time)
        rain = data["hourly"]["precipitation"]
        chance = data["hourly"]["precipitation_probability"]
        now = current["time"][:13] + ":00"      # current hour, e.g. "2026-11-13T21:00"

        past = [r for h, r in zip(hours, rain) if h <= now]
        future = [r for h, r in zip(hours, rain) if h > now]
        future_chance = [c for h, c in zip(hours, chance) if h > now and c is not None]

        # save past hours to the database (history); an hour saved before is updated
        conn.executemany(
            "INSERT INTO rainfall (area_id, time, precipitation_mm) VALUES (?, ?, ?) "
            "ON CONFLICT (area_id, time) DO UPDATE SET precipitation_mm = excluded.precipitation_mm",
            [(area["id"], h, r) for h, r in zip(hours, rain) if h <= now])

        output.append({
            "area_id": area["id"],
            "name": area["name"],
            "latitude": area["latitude"],
            "longitude": area["longitude"],
            "elevation_m": area["elevation_m"],
            "temperature_c": current.get("temperature_2m"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_kmh": current.get("wind_speed_10m"),
            "rain_now_mm": current.get("precipitation"),
            "rain_last_1h": total(past[-1:]),
            "rain_last_3h": total(past[-3:]),
            "rain_last_24h": total(past[-24:]),
            "rain_next_24h": total(future[:24]),
            "max_chance_next_24h": max(future_chance[:24]) if future_chance else None,
            "hourly": [{"time": h, "rain_mm": r, "chance": c} for h, r, c in zip(hours, rain, chance)],
            "data_time": current["time"],
        })
    conn.commit()
    conn.close()

    result = {
        "areas": output,
        "updated_at": output[0]["data_time"] if output else None,
        "source": "Open-Meteo.com (CC BY 4.0) - model data, not rain-gauge measurements",
    }
    _cache["data"], _cache["time"] = result, time.time()
    return result


def load_elevations():
    """Fill in missing area elevations from the Open-Meteo elevation API (Copernicus DEM, 90 m)."""
    areas = [a for a in get_areas() if a["elevation_m"] is None]
    if not areas:
        return
    try:
        response = httpx.get(ELEVATION_URL, timeout=15, params={
            "latitude": ",".join(str(a["latitude"]) for a in areas),
            "longitude": ",".join(str(a["longitude"]) for a in areas),
        })
        response.raise_for_status()
        elevations = response.json()["elevation"]
    except Exception as error:
        print("Could not load elevations (will try again next start):", error)
        return
    conn = get_connection()
    for area, elevation in zip(areas, elevations):
        conn.execute("UPDATE areas SET elevation_m = ? WHERE id = ?", (elevation, area["id"]))
    conn.commit()
    conn.close()
