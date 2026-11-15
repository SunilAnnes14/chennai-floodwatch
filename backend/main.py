"""
main.py - The FastAPI web server. All API routes are in this file.

Sections:  helpers · PREDICT · DETECT · ALERT · ADMIN

Run it:   uvicorn main:app --reload
API docs: http://localhost:8000/docs
"""
import csv
import io
import json
import math
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image
from pydantic import BaseModel, Field

load_dotenv()  # read the .env file (must happen before importing auth)

import forecast  # noqa: E402
import routing  # noqa: E402
import streets  # noqa: E402
import terrain  # noqa: E402
from auth import check_password, make_token, require_admin  # noqa: E402
from database import create_tables, get_connection  # noqa: E402
from risk import calculate_risk  # noqa: E402
from weather import WeatherError, get_weather, load_elevations  # noqa: E402

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
MAX_PHOTO_MB = 5
SEVERITIES = ["LOW", "MODERATE", "HIGH", "SEVERE"]
SEVERITY_ORDER = {"LOW": 1, "MODERATE": 2, "HIGH": 3, "SEVERE": 4}
STATUSES = ["PENDING", "VERIFIED", "REJECTED", "RESOLVED"]
ALERT_TYPES = ["OFFICIAL", "VERIFIED_REPORT", "PREDICTION"]

ACTIVE_HOURS = 6         # a verified report counts as "flooded now" for 6 h, unless re-confirmed
LIKELY_REPORTERS = 3     # this many different people reporting the same street = "likely flooded"
DANGEROUS_DEPTH_CM = 30  # general flood-safety guidance: ~30 cm of water can float a car

app = FastAPI(title="Chennai FloodWatch API")

# Allow the React website (running on port 5173) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("FRONTEND_URL", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

terrain_status = {"running": False, "message": "not started", "result": None}


def run_terrain_build():
    """Build the street-level susceptibility grid (takes a few minutes; needs internet)."""
    if terrain_status["running"]:
        return
    terrain_status.update(running=True, message="building...")
    try:
        terrain_status["result"] = terrain.build_grid()
        terrain_status["message"] = "done"
    except Exception as error:
        terrain_status["message"] = f"failed: {error}"
    finally:
        terrain_status["running"] = False


@app.on_event("startup")
def startup():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    create_tables()
    if os.environ.get("SKIP_ELEVATION") != "1":   # tests set this to stay offline
        load_elevations()
        conn = get_connection()
        has_grid = conn.execute("SELECT COUNT(*) FROM grid_cells").fetchone()[0] > 0
        conn.close()
        if not has_grid:  # first start: build the susceptibility grid in the background
            threading.Thread(target=run_terrain_build, daemon=True).start()


# ======================================================================
# Helpers
# ======================================================================

def now():
    return datetime.now(timezone.utc)


def now_text():
    return now().isoformat(timespec="seconds")


def hours_ago(hours):
    return (now() - timedelta(hours=hours)).isoformat(timespec="seconds")


def ist_today():
    return (now() + timedelta(hours=5, minutes=30)).date().isoformat()


def distance_m(lat1, lon1, lat2, lon2):
    """Distance in metres between two GPS points (haversine formula)."""
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def in_chennai(lat, lon):
    return 12.6 <= lat <= 13.4 and 79.85 <= lon <= 80.45


def is_dangerous(severity, depth_cm):
    return severity in ("HIGH", "SEVERE") or depth_cm >= DANGEROUS_DEPTH_CM


# SQL for "verified AND still active (verified/re-confirmed in the last ACTIVE_HOURS)"
ACTIVE_VERIFIED = "(status = 'VERIFIED' AND COALESCE(verified_at, created_at) > ?)"


def public_report(row):
    """Turn a database row into data that is safe to show (hide the reporter's IP)."""
    report = dict(row)
    report.pop("reporter_ip", None)
    photo = report.pop("photo")
    # Photos are only shown publicly after an admin has verified the report
    report["photo_url"] = (f"/api/reports/{report['id']}/photo"
                           if photo and report["status"] in ("VERIFIED", "RESOLVED") else None)
    # The street shape is stored as JSON text; turn it back into a list
    geometry = report.get("street_geometry")
    report["street_geometry"] = json.loads(geometry) if geometry else None
    return report


def all_areas():
    conn = get_connection()
    rows = [dict(a) for a in conn.execute("SELECT * FROM areas")]
    conn.close()
    return rows


def nearest_area(lat, lon, areas, max_m=6000):
    """Which of our 8 focus areas is closest? None if further than max_m."""
    best = min(areas, key=lambda a: distance_m(lat, lon, a["latitude"], a["longitude"]))
    return best if distance_m(lat, lon, best["latitude"], best["longitude"]) <= max_m else None


def create_auto_alert(conn, title, message, alert_type, source, area_id, dedupe_key, hours):
    """Create an automatic alert once (the dedupe_key stops duplicates). Returns its id or None."""
    cursor = conn.execute(
        """INSERT OR IGNORE INTO alerts (title, message, alert_type, source, created_at, area_id, expires_at,
                                         is_automatic, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)""",
        (title, message, alert_type, source, now_text(), area_id,
         (now() + timedelta(hours=hours)).isoformat(timespec="seconds"), dedupe_key))
    return cursor.lastrowid if cursor.rowcount else None


_place_cache = {}  # remembers places we already searched


def geocode(place):
    """Turn a place name into GPS coordinates using OpenStreetMap Nominatim."""
    key = place.strip().lower()
    if key in _place_cache:
        return _place_cache[key]
    try:
        results = streets.nominatim_get(
            "/search", {"q": place + ", Chennai", "format": "json", "limit": 1, "countrycodes": "in"})
    except Exception:
        raise HTTPException(503, "Location search service (Nominatim) is unavailable")
    if not results:
        raise HTTPException(404, f"Could not find '{place}'")
    _place_cache[key] = (float(results[0]["lat"]), float(results[0]["lon"]))
    return _place_cache[key]


# ======================================================================
# General
# ======================================================================

@app.get("/api/health")
def health():
    conn = get_connection()
    conn.execute("SELECT 1")
    conn.close()
    return {"status": "ok", "time": now_text()}


@app.get("/api/areas")
def areas():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM areas ORDER BY name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/geocode")
def search_place(q: str):
    """Used by the map's search box."""
    lat, lon = geocode(q)
    return {"latitude": lat, "longitude": lon}


# ======================================================================
# PREDICT
# ======================================================================

@app.get("/api/weather")
def weather():
    try:
        return get_weather()
    except WeatherError as error:
        raise HTTPException(status_code=503, detail=str(error))


def compute_area_risk(data):
    """Risk per area. Also saves each prediction (once an hour) and creates automatic alerts."""
    results = []
    conn = get_connection()
    for a in data["areas"]:
        r = calculate_risk(a["rain_last_24h"], a["rain_next_24h"], a["elevation_m"])
        rain_total = (None if a["rain_last_24h"] is None or a["rain_next_24h"] is None
                      else round(a["rain_last_24h"] + a["rain_next_24h"], 1))
        results.append({"area_id": a["area_id"], "name": a["name"], "latitude": a["latitude"],
                        "longitude": a["longitude"], "risk_level": r["level"], "reason": r["reason"],
                        "rain_total": rain_total})
        if r["level"] is None:
            continue
        # Save the prediction for the track record (at most once per hour per area)
        last = conn.execute("SELECT MAX(logged_at) FROM risk_log WHERE area_id = ?", (a["area_id"],)).fetchone()[0]
        if last is None or last < hours_ago(1):
            conn.execute("INSERT INTO risk_log (area_id, logged_at, risk_level, rain_total) VALUES (?, ?, ?, ?)",
                         (a["area_id"], now_text(), r["level"], rain_total))
        # Automatic alert when an area reaches HIGH risk (once per area per day). Clearly NOT official.
        if r["level"] in ("HIGH", "VERY_HIGH"):
            create_auto_alert(
                conn, f"High flood risk predicted for {a['name']}",
                f"Our experimental model rates {a['name']} as {r['level'].replace('_', ' ')} risk ({r['reason']}). "
                "This is a model prediction, not an official warning. Avoid low-lying roads and follow official advice.",
                "PREDICTION", "FloodWatch experimental risk model (automatic)", a["area_id"],
                f"risk:{a['area_id']}:{ist_today()}", 24)
    conn.commit()
    conn.close()
    return results


@app.get("/api/risk")
def risk():
    try:
        data = get_weather()
    except WeatherError as error:
        raise HTTPException(status_code=503, detail=f"Risk cannot be calculated: {error}")
    return {
        "areas": compute_area_risk(data),
        "updated_at": data["updated_at"],
        "experimental": True,
        "note": "EXPERIMENTAL: simple rule-based score (rainfall + elevation). Not validated against real "
                "floods and not an official warning.",
    }


def flood_history(lat, lon, radius_m=300):
    """How many times has flooding been recorded near this spot? (verified reports, any time,
    + known waterlogging points imported from official lists)"""
    box = 0.004  # ~400 m: quick pre-filter before measuring exact distances
    conn = get_connection()
    rows = conn.execute(
        "SELECT latitude, longitude FROM reports WHERE status IN ('VERIFIED', 'RESOLVED') "
        "AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? "
        "UNION ALL SELECT latitude, longitude FROM waterlogging_points "
        "WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
        (lat - box, lat + box, lon - box, lon + box) * 2).fetchall()
    conn.close()
    return sum(1 for r in rows if distance_m(lat, lon, r["latitude"], r["longitude"]) <= radius_m)


def predict_point(lat, lon, weather_data=None):
    """Street-level prediction for one spot: area rainfall x (terrain + flood history) of that spot."""
    cell = terrain.nearest_cell(lat, lon)
    history = flood_history(lat, lon)
    area_weather = None
    if weather_data:
        area_weather = min(weather_data["areas"], key=lambda a: distance_m(lat, lon, a["latitude"], a["longitude"]))
        if distance_m(lat, lon, area_weather["latitude"], area_weather["longitude"]) > 15000:
            area_weather = None
    rain_total = None
    if area_weather and area_weather["rain_last_24h"] is not None and area_weather["rain_next_24h"] is not None:
        rain_total = area_weather["rain_last_24h"] + area_weather["rain_next_24h"]
    level, note = terrain.street_level_risk(rain_total, cell, history)
    susceptibility = None
    if cell:
        _, _, reasons = terrain.susceptibility(cell["height_above_water_m"], cell["water_distance_m"])
        susceptibility = {"level": cell["level"], "score": cell["score"], "reasons": reasons,
                          "nearest_water": cell["nearest_water"], "elevation_m": cell["elevation_m"]}
    return {"predicted_level": level, "explanation": note, "susceptibility": susceptibility,
            "flood_history": history, "rain_area": area_weather["name"] if area_weather else None}


@app.get("/api/waterlogging")
def waterlogging_points():
    """Known waterlogging spots (imported from official lists) - HISTORICAL, not current flooding."""
    conn = get_connection()
    rows = conn.execute("SELECT * FROM waterlogging_points ORDER BY name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/terrain")
def terrain_grid():
    """All susceptibility grid cells, for the map layer."""
    conn = get_connection()
    rows = conn.execute("SELECT latitude, longitude, score, level, elevation_m FROM grid_cells").fetchall()
    conn.close()
    return {
        "cells": [dict(r) for r in rows],
        "cell_size_deg": terrain.GRID["step"],
        "built": bool(rows),
        "building": terrain_status["running"],
        "source": "Ground height: Copernicus DEM 90 m via Open-Meteo. Rivers & lakes: © OpenStreetMap contributors.",
        "note": "EXPERIMENTAL susceptibility (how easily water collects), not a forecast and not validated.",
    }


@app.get("/api/street-risk")
def street_risk(q: str | None = None, latitude: float | None = None, longitude: float | None = None):
    """'Check my street': street-level prediction + any reports on that street."""
    if q:
        latitude, longitude = geocode(q)
    if latitude is None or longitude is None:
        raise HTTPException(422, "Give a street name (q) or latitude and longitude")
    if not in_chennai(latitude, longitude):
        raise HTTPException(422, "The location must be inside the Chennai area")
    try:
        weather_data = get_weather()
    except WeatherError:
        weather_data = None
    prediction = predict_point(latitude, longitude, weather_data)
    nearby = [s for s in affected_streets()["streets"]
              if distance_m(latitude, longitude, s["latitude"], s["longitude"]) < 300]
    return {
        "query": q, "latitude": latitude, "longitude": longitude, **prediction,
        "weather_available": weather_data is not None,
        "reported_nearby": nearby,
        "note": "EXPERIMENTAL street-level estimate. Not an official warning.",
    }


@app.get("/api/forecast-grid")
def forecast_grid():
    """Hour-by-hour rain, wind and temperature on a grid over Chennai, for the Forecast Map."""
    try:
        return forecast.get_forecast_grid()
    except forecast.ForecastError as error:
        raise HTTPException(503, str(error))


@app.get("/api/radar")
def radar():
    """Latest OBSERVED radar images (RainViewer), for the Forecast Map."""
    try:
        return forecast.get_radar()
    except forecast.ForecastError as error:
        raise HTTPException(503, str(error))


_tide_cache = {"time": 0, "data": None}


@app.get("/api/tide")
def tide():
    """Sea level near the Adyar river mouth (tide + storm surge model). High sea level slows drainage."""
    if _tide_cache["data"] and time.time() - _tide_cache["time"] < 1800:
        return _tide_cache["data"]
    try:
        response = httpx.get("https://marine-api.open-meteo.com/v1/marine", timeout=15, params={
            "latitude": 13.0, "longitude": 80.30, "hourly": "sea_level_height_msl",
            "timezone": "Asia/Kolkata", "past_days": 0, "forecast_days": 2})
        response.raise_for_status()
        hourly = response.json()["hourly"]
    except Exception as error:
        raise HTTPException(503, f"Sea level service (Open-Meteo Marine) is unavailable: {error}")
    hours = [{"time": t, "sea_level_m": v} for t, v in zip(hourly["time"], hourly["sea_level_height_msl"])]
    # A high tide is an hour higher than the hours just before and after it (a low tide: lower)
    turns = []
    for i in range(1, len(hours) - 1):
        before, here, after = hours[i - 1]["sea_level_m"], hours[i]["sea_level_m"], hours[i + 1]["sea_level_m"]
        if None in (before, here, after):
            continue
        if here > before and here >= after:
            turns.append({"type": "HIGH", **hours[i]})
        elif here < before and here <= after:
            turns.append({"type": "LOW", **hours[i]})
    _tide_cache["data"] = {
        "hours": hours, "turns": turns,
        "source": "Open-Meteo Marine API (CC BY 4.0) - model values, not a tide gauge",
        "location": "Sea near the Adyar river mouth",
    }
    _tide_cache["time"] = time.time()
    return _tide_cache["data"]


@app.get("/api/risk/track-record")
def track_record():
    """How often was each predicted risk level followed by VERIFIED flooding in that area within 24 h?"""
    conn = get_connection()
    logs = conn.execute("SELECT * FROM risk_log WHERE logged_at < ?", (hours_ago(24),)).fetchall()
    reports = conn.execute("SELECT latitude, longitude, created_at FROM reports "
                           "WHERE status IN ('VERIFIED', 'RESOLVED')").fetchall()
    conn.close()
    areas = all_areas()
    flood_times = {}  # area_id -> list of report times
    for r in reports:
        area = nearest_area(r["latitude"], r["longitude"], areas)
        if area:
            flood_times.setdefault(area["id"], []).append(r["created_at"])

    table = {level: {"predictions": 0, "followed_by_flooding": 0} for level in ("LOW", "MODERATE", "HIGH", "VERY_HIGH")}
    for log in logs:
        end = (datetime.fromisoformat(log["logged_at"]) + timedelta(hours=24)).isoformat(timespec="seconds")
        flooded = any(log["logged_at"] < t <= end for t in flood_times.get(log["area_id"], []))
        table[log["risk_level"]]["predictions"] += 1
        table[log["risk_level"]]["followed_by_flooding"] += int(flooded)
    for row in table.values():
        row["rate"] = round(row["followed_by_flooding"] / row["predictions"], 2) if row["predictions"] else None
    return {
        "levels": table,
        "total_predictions": len(logs),
        "note": "Only predictions older than 24 h are checked. 'Flooding' means a verified citizen report in that "
                "area within 24 h. With few predictions or few reports these numbers mean very little.",
    }


# ======================================================================
# DETECT
# ======================================================================

_report_times = {}  # recent report times per IP address, for rate limiting


@app.post("/api/reports", status_code=201)
async def create_report(
    request: Request,
    location_text: str = Form(..., min_length=3, max_length=200),
    latitude: float = Form(...),
    longitude: float = Form(...),
    water_depth_cm: int = Form(..., ge=0, le=300),
    severity: str = Form(...),
    description: str = Form("", max_length=1000),
    photo: UploadFile | None = File(None),
):
    ip = request.client.host if request.client else "unknown"

    # 1. Check the inputs
    if severity not in SEVERITIES:
        raise HTTPException(422, "Severity must be LOW, MODERATE, HIGH or SEVERE")
    if not in_chennai(latitude, longitude):
        raise HTTPException(422, "The location must be inside the Chennai area")

    # 2. Rate limit: maximum 5 reports per hour from the same IP address
    recent = [t for t in _report_times.get(ip, []) if time.time() - t < 3600]
    if len(recent) >= 5:
        raise HTTPException(429, "Too many reports. Please try again in an hour.")

    # 3. Duplicate check: same person, within 100 m, in the last hour
    conn = get_connection()
    mine = conn.execute("SELECT * FROM reports WHERE reporter_ip = ? AND created_at > ?",
                        (ip, hours_ago(1))).fetchall()
    for old in mine:
        if distance_m(latitude, longitude, old["latitude"], old["longitude"]) < 100:
            conn.close()
            raise HTTPException(409, f"You already reported this place recently (report #{old['id']}).")

    # 4. Check and save the photo (optional)
    photo_name = None
    if photo is not None and photo.filename:
        content = await photo.read()
        if len(content) > MAX_PHOTO_MB * 1024 * 1024:
            conn.close()
            raise HTTPException(413, f"Photo is larger than {MAX_PHOTO_MB} MB")
        try:
            image = Image.open(io.BytesIO(content))
            if image.format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError
            image = image.convert("RGB")  # re-saving also removes hidden GPS/camera info
        except Exception:
            conn.close()
            raise HTTPException(415, "Photo must be a JPG, PNG or WEBP image")
        photo_name = uuid.uuid4().hex + ".jpg"
        image.save(os.path.join(UPLOAD_DIR, photo_name), "JPEG", quality=85)

    # 5. Find which street this is (OpenStreetMap). If it fails, we still save the report.
    street = streets.find_street(latitude, longitude) or {}
    geometry = street.get("geometry")

    # 6. Save the report (always starts as PENDING)
    cursor = conn.execute(
        """INSERT INTO reports (location_text, latitude, longitude, water_depth_cm, severity, description,
                                photo, reporter_ip, created_at, street_name, locality, street_geometry)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (location_text, latitude, longitude, water_depth_cm, severity, description, photo_name, ip, now_text(),
         street.get("street_name"), street.get("locality"), json.dumps(geometry) if geometry else None),
    )
    conn.commit()
    conn.close()
    _report_times[ip] = recent + [time.time()]
    return {"id": cursor.lastrowid, "status": "PENDING", "street_name": street.get("street_name"),
            "locality": street.get("locality"),
            "message": "Thank you! Your report will be checked by an admin before it is marked as verified."}


@app.get("/api/reports")
def list_reports():
    """Active verified reports + pending reports from the last 24 hours (clearly marked as unverified)."""
    conn = get_connection()
    rows = conn.execute(
        f"SELECT * FROM reports WHERE {ACTIVE_VERIFIED} OR (status = 'PENDING' AND created_at > ?) "
        "ORDER BY created_at DESC", (hours_ago(ACTIVE_HOURS), hours_ago(24))).fetchall()
    conn.close()
    return [public_report(r) for r in rows]


@app.get("/api/streets")
def affected_streets():
    """
    Street-by-street flooding, built ONLY from citizen reports:
    active verified reports + unverified reports from the last 24 hours.
    Reports on the same street are grouped together. Each street also gets an
    experimental street-level prediction from the susceptibility grid.
    """
    conn = get_connection()
    rows = conn.execute(
        f"SELECT * FROM reports WHERE {ACTIVE_VERIFIED} OR (status = 'PENDING' AND created_at > ?) "
        "ORDER BY created_at DESC", (hours_ago(ACTIVE_HOURS), hours_ago(24))).fetchall()
    conn.close()
    areas = all_areas()
    try:
        weather_data = get_weather()
    except WeatherError:
        weather_data = None
    last_hour = hours_ago(1)

    groups = {}
    for row in rows:
        report = public_report(row)
        if report["street_name"]:
            key = (report["street_name"], report["locality"])
            name = report["street_name"]
        else:  # the street lookup failed for this report - keep it on its own
            key = ("unknown", report["id"])
            name = f"Street not identified (near {report['location_text']})"

        if key not in groups:
            area = nearest_area(report["latitude"], report["longitude"], areas)
            groups[key] = {
                "street_name": name,
                "locality": report["locality"] or "",
                "area": area["name"] if area else "Other areas",
                "latitude": report["latitude"],
                "longitude": report["longitude"],
                "verified_reports": 0,
                "unverified_reports": 0,
                "max_depth_cm": 0,
                "worst_severity": "LOW",
                "latest_report_at": report["created_at"],  # rows are newest first
                "segments": [],
                "_recent_reporters": set(),
            }
        group = groups[key]

        if report["status"] == "VERIFIED":
            if group["verified_reports"] == 0:  # centre the street on a verified report
                group["latitude"], group["longitude"] = report["latitude"], report["longitude"]
            group["verified_reports"] += 1
        else:
            group["unverified_reports"] += 1
            if report["created_at"] > last_hour:
                group["_recent_reporters"].add(row["reporter_ip"])
        group["max_depth_cm"] = max(group["max_depth_cm"], report["water_depth_cm"])
        if SEVERITY_ORDER[report["severity"]] > SEVERITY_ORDER[group["worst_severity"]]:
            group["worst_severity"] = report["severity"]
        group["segments"].append({
            "report_id": report["id"],
            "status": report["status"],
            "severity": report["severity"],
            "points": report["street_geometry"],  # None if OpenStreetMap had no street shape
            "latitude": report["latitude"],
            "longitude": report["longitude"],
        })

    result = list(groups.values())
    for group in result:
        group["status"] = "VERIFIED" if group["verified_reports"] else "UNVERIFIED"
        # Corroboration: several different people reported this street in the last hour
        group["independent_reporters"] = len(group.pop("_recent_reporters"))
        group["likely_flooded"] = group["status"] == "UNVERIFIED" and group["independent_reporters"] >= LIKELY_REPORTERS
        group["prediction"] = predict_point(group["latitude"], group["longitude"], weather_data)
    # Verified first, then "likely", then the worst flooding
    result.sort(key=lambda g: (g["status"] != "VERIFIED", not g["likely_flooded"],
                               -SEVERITY_ORDER[g["worst_severity"]], -g["max_depth_cm"]))
    return {
        "streets": result,
        "generated_at": now_text(),
        "active_hours": ACTIVE_HOURS,
        "source": "FloodWatch citizen reports. Street names and shapes: © OpenStreetMap contributors (ODbL)",
        "note": "Only streets that someone has reported are listed. A street that is not listed may still be flooded.",
    }


@app.get("/api/reports/{report_id}/photo")
def report_photo(report_id: int):
    conn = get_connection()
    row = conn.execute("SELECT photo, status FROM reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    if not row or not row["photo"] or row["status"] not in ("VERIFIED", "RESOLVED"):
        raise HTTPException(404, "Photo not found")
    return FileResponse(os.path.join(UPLOAD_DIR, row["photo"]), media_type="image/jpeg")


# ======================================================================
# ALERT
# ======================================================================

@app.get("/api/alerts")
def list_alerts():
    """Active alerts that have not expired, with the area name (empty = all of Chennai)."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT alerts.*, areas.name AS area_name FROM alerts LEFT JOIN areas ON areas.id = alerts.area_id
           WHERE alerts.is_active = 1 AND (alerts.expires_at IS NULL OR alerts.expires_at > ?)
           ORDER BY alerts.created_at DESC""", (now_text(),)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/road-closures")
def list_road_closures():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM road_closures WHERE is_active = 1 ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/shelters")
def list_shelters():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM shelters WHERE is_active = 1 ORDER BY name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def current_hazards():
    """Confirmed problems only: active road closures + active verified flood reports."""
    conn = get_connection()
    closures = [dict(r, kind="closure") for r in conn.execute("SELECT * FROM road_closures WHERE is_active = 1")]
    floods = [dict(public_report(r), kind="flood")
              for r in conn.execute(f"SELECT * FROM reports WHERE {ACTIVE_VERIFIED}", (hours_ago(ACTIVE_HOURS),))]
    conn.close()
    return closures + floods


ROUTE_WARNING = ("No route is guaranteed safe. We only know about closures and floods that were reported "
                 "and verified. Never drive through flood water.")


def plan_routes(start, end):
    hazards = current_hazards()
    try:
        routes = routing.plan(start, end, hazards)
    except routing.RoutingError as error:
        raise HTTPException(503, str(error))
    if not routes:
        raise HTTPException(404, "No route found between these places")
    return routes, bool(hazards)


@app.get("/api/route")
def find_route(start: str, end: str):
    """Driving routes, checked against confirmed problems; tries detours if all routes are blocked."""
    start_point, end_point = geocode(start), geocode(end)
    routes, has_info = plan_routes(start_point, end_point)
    return {"start": list(start_point), "end": list(end_point), "routes": routes,
            "has_road_info": has_info, "warning": ROUTE_WARNING}


@app.get("/api/evacuate")
def evacuate(start: str | None = None, latitude: float | None = None, longitude: float | None = None):
    """Route from a place (or GPS position) to the nearest active relief shelter."""
    if start:
        latitude, longitude = geocode(start)
    if latitude is None or longitude is None:
        raise HTTPException(422, "Give a start place or your GPS position")
    shelters = list_shelters()
    if not shelters:
        raise HTTPException(404, "No relief shelters have been added yet. Call 1070 or 1913 for the nearest relief centre.")
    shelters.sort(key=lambda s: distance_m(latitude, longitude, s["latitude"], s["longitude"]))
    nearest = shelters[0]
    routes, has_info = plan_routes((latitude, longitude), (nearest["latitude"], nearest["longitude"]))
    for s in shelters[:3]:
        s["distance_km"] = round(distance_m(latitude, longitude, s["latitude"], s["longitude"]) / 1000, 1)
    return {"start": [latitude, longitude], "end": [nearest["latitude"], nearest["longitude"]],
            "shelter": nearest, "other_shelters": shelters[1:3], "routes": routes,
            "has_road_info": has_info, "warning": ROUTE_WARNING}


# ======================================================================
# ADMIN (need login)
# ======================================================================

class LoginData(BaseModel):
    email: str
    password: str


@app.post("/api/admin/login")
def login(data: LoginData):
    conn = get_connection()
    admin = conn.execute("SELECT * FROM admins WHERE email = ?", (data.email.lower(),)).fetchone()
    conn.close()
    if not admin or not check_password(data.password, admin["password_hash"]):
        raise HTTPException(401, "Wrong email or password")
    return {"token": make_token(admin["email"]), "email": admin["email"]}


@app.get("/api/admin/reports")
def admin_reports(status: str | None = None, admin: str = Depends(require_admin)):
    conn = get_connection()
    if status:
        rows = conn.execute("SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC", (status,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM reports ORDER BY created_at DESC").fetchall()
    recent_pending = conn.execute("SELECT latitude, longitude, reporter_ip, created_at FROM reports "
                                  "WHERE status = 'PENDING' AND created_at > ?", (hours_ago(24),)).fetchall()
    conn.close()
    expiry = hours_ago(ACTIVE_HOURS)
    result = []
    for r in rows:
        report = public_report(r)
        report["has_photo"] = bool(r["photo"])
        # Verified reports older than ACTIVE_HOURS are no longer shown as current flooding
        report["expired"] = r["status"] == "VERIFIED" and (r["verified_at"] or r["created_at"]) <= expiry
        # How many DIFFERENT people reported within 200 m, within an hour of this report?
        if r["status"] == "PENDING":
            t = datetime.fromisoformat(r["created_at"])
            window = ((t - timedelta(hours=1)).isoformat(timespec="seconds"),
                      (t + timedelta(hours=1)).isoformat(timespec="seconds"))
            report["independent_reporters"] = len({
                p["reporter_ip"] for p in recent_pending
                if window[0] <= p["created_at"] <= window[1]
                and distance_m(r["latitude"], r["longitude"], p["latitude"], p["longitude"]) <= 200})
        else:
            report["independent_reporters"] = None
        result.append(report)
    # Most-corroborated pending reports first, so admins check them first
    result.sort(key=lambda x: -(x["independent_reporters"] or 0))
    return result


@app.get("/api/admin/reports/{report_id}/photo")
def admin_photo(report_id: int, admin: str = Depends(require_admin)):
    conn = get_connection()
    row = conn.execute("SELECT photo FROM reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    if not row or not row["photo"]:
        raise HTTPException(404, "No photo")
    return FileResponse(os.path.join(UPLOAD_DIR, row["photo"]), media_type="image/jpeg")


class StatusChange(BaseModel):
    status: str


@app.patch("/api/admin/reports/{report_id}")
def change_report_status(report_id: int, data: StatusChange, admin: str = Depends(require_admin)):
    """Change a report's status. Setting VERIFIED again on a verified report = 're-confirm' (resets its 6 h)."""
    if data.status not in STATUSES:
        raise HTTPException(422, "Unknown status")
    conn = get_connection()
    report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not report:
        conn.close()
        raise HTTPException(404, "Report not found")
    alert_id = None
    if data.status == "VERIFIED":
        conn.execute("UPDATE reports SET status = 'VERIFIED', verified_at = ? WHERE id = ?", (now_text(), report_id))
        # Dangerous flooding confirmed -> automatic location-specific alert (once per street per day)
        if is_dangerous(report["severity"], report["water_depth_cm"]):
            area = nearest_area(report["latitude"], report["longitude"], all_areas())
            place = report["street_name"] or report["location_text"]
            where = f"{place}, {area['name']}" if area else place
            alert_id = create_auto_alert(
                conn, f"Dangerous flooding verified: {where}",
                f"An admin verified a citizen report of {report['water_depth_cm']} cm of water "
                f"({report['severity'].lower()} severity) at {report['location_text']}. Avoid this road.",
                "VERIFIED_REPORT", "FloodWatch verified citizen report (automatic)", area["id"] if area else None,
                f"verified:{place}:{ist_today()}", ACTIVE_HOURS)
    else:
        conn.execute("UPDATE reports SET status = ? WHERE id = ?", (data.status, report_id))
    conn.commit()
    conn.close()
    return {"id": report_id, "status": data.status, "auto_alert_id": alert_id}


@app.post("/api/admin/reports/{report_id}/find-street")
def retry_street_lookup(report_id: int, admin: str = Depends(require_admin)):
    """If the street lookup failed when the report was sent (e.g. no internet), the admin can retry."""
    conn = get_connection()
    row = conn.execute("SELECT latitude, longitude FROM reports WHERE id = ?", (report_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Report not found")
    street = streets.find_street(row["latitude"], row["longitude"])
    if street is None:
        conn.close()
        raise HTTPException(503, "OpenStreetMap street lookup is unavailable, try again later")
    geometry = street["geometry"]
    conn.execute("UPDATE reports SET street_name = ?, locality = ?, street_geometry = ? WHERE id = ?",
                 (street["street_name"], street["locality"], json.dumps(geometry) if geometry else None, report_id))
    conn.commit()
    conn.close()
    return street


class AlertData(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=3, max_length=2000)
    alert_type: str
    source: str = Field(min_length=2, max_length=200)
    area_id: int | None = None          # empty = whole of Chennai
    expires_hours: int | None = Field(default=None, ge=1, le=168)


@app.post("/api/admin/alerts", status_code=201)
def create_alert(data: AlertData, admin: str = Depends(require_admin)):
    if data.alert_type not in ALERT_TYPES:
        raise HTTPException(422, "alert_type must be OFFICIAL, VERIFIED_REPORT or PREDICTION")
    expires = (now() + timedelta(hours=data.expires_hours)).isoformat(timespec="seconds") if data.expires_hours else None
    conn = get_connection()
    if data.area_id is not None and not conn.execute("SELECT 1 FROM areas WHERE id = ?", (data.area_id,)).fetchone():
        conn.close()
        raise HTTPException(422, "Unknown area")
    cursor = conn.execute(
        "INSERT INTO alerts (title, message, alert_type, source, created_at, area_id, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (data.title, data.message, data.alert_type, data.source, now_text(), data.area_id, expires))
    conn.commit()
    conn.close()
    return {"id": cursor.lastrowid}


@app.delete("/api/admin/alerts/{alert_id}")
def remove_alert(alert_id: int, admin: str = Depends(require_admin)):
    conn = get_connection()
    conn.execute("UPDATE alerts SET is_active = 0 WHERE id = ?", (alert_id,))
    conn.commit()
    conn.close()
    return {"removed": alert_id}


class ClosureData(BaseModel):
    road_name: str = Field(min_length=2, max_length=200)
    latitude: float
    longitude: float
    reason: str = ""
    source: str = Field(min_length=2, max_length=200)


@app.post("/api/admin/road-closures", status_code=201)
def create_closure(data: ClosureData, admin: str = Depends(require_admin)):
    if not in_chennai(data.latitude, data.longitude):
        raise HTTPException(422, "The location must be inside the Chennai area")
    conn = get_connection()
    cursor = conn.execute(
        "INSERT INTO road_closures (road_name, latitude, longitude, reason, source, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (data.road_name, data.latitude, data.longitude, data.reason, data.source, now_text()))
    conn.commit()
    conn.close()
    return {"id": cursor.lastrowid}


@app.delete("/api/admin/road-closures/{closure_id}")
def remove_closure(closure_id: int, admin: str = Depends(require_admin)):
    conn = get_connection()
    conn.execute("UPDATE road_closures SET is_active = 0 WHERE id = ?", (closure_id,))
    conn.commit()
    conn.close()
    return {"removed": closure_id}


class ShelterData(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    latitude: float
    longitude: float
    capacity: int | None = Field(default=None, ge=1)
    source: str = Field(min_length=2, max_length=200)


@app.post("/api/admin/shelters", status_code=201)
def create_shelter(data: ShelterData, admin: str = Depends(require_admin)):
    if not in_chennai(data.latitude, data.longitude):
        raise HTTPException(422, "The location must be inside the Chennai area")
    conn = get_connection()
    cursor = conn.execute(
        "INSERT INTO shelters (name, latitude, longitude, capacity, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (data.name, data.latitude, data.longitude, data.capacity, data.source, now_text()))
    conn.commit()
    conn.close()
    return {"id": cursor.lastrowid}


@app.delete("/api/admin/shelters/{shelter_id}")
def remove_shelter(shelter_id: int, admin: str = Depends(require_admin)):
    conn = get_connection()
    conn.execute("UPDATE shelters SET is_active = 0 WHERE id = ?", (shelter_id,))
    conn.commit()
    conn.close()
    return {"removed": shelter_id}


def build_briefing():
    """Everything an emergency authority needs on one page."""
    streets_now = affected_streets()["streets"]
    try:
        risk_now = risk()["areas"]
    except HTTPException:
        risk_now = []
    return {
        "generated_at": now_text(),
        "dangerous_streets": [s for s in streets_now if s["status"] == "VERIFIED"
                              and is_dangerous(s["worst_severity"], s["max_depth_cm"])],
        "likely_flooded_streets": [s for s in streets_now if s["likely_flooded"]],
        "high_risk_areas": [a for a in risk_now if a["risk_level"] in ("HIGH", "VERY_HIGH")],
        "road_closures": list_road_closures(),
        "shelters": list_shelters(),
        "active_alerts": list_alerts(),
        "disclaimer": "Built from citizen reports verified by FloodWatch admins and an EXPERIMENTAL risk model. "
                      "Not an official assessment.",
    }


@app.get("/api/admin/briefing")
def briefing(admin: str = Depends(require_admin)):
    data = build_briefing()
    for s in data["dangerous_streets"] + data["likely_flooded_streets"]:
        s.pop("segments", None)  # the map shapes are not needed in a briefing
    return data


@app.get("/api/admin/briefing.csv")
def briefing_csv(admin: str = Depends(require_admin)):
    """The same briefing as a spreadsheet file (opens in Excel)."""
    data = build_briefing()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["type", "name", "area / locality", "detail", "latitude", "longitude", "time / source"])
    for s in data["dangerous_streets"]:
        writer.writerow(["DANGEROUS STREET", s["street_name"], f"{s['area']} / {s['locality']}",
                         f"{s['max_depth_cm']} cm, {s['worst_severity']}", s["latitude"], s["longitude"], s["latest_report_at"]])
    for s in data["likely_flooded_streets"]:
        writer.writerow(["LIKELY FLOODED (unverified)", s["street_name"], f"{s['area']} / {s['locality']}",
                         f"{s['independent_reporters']} people reported", s["latitude"], s["longitude"], s["latest_report_at"]])
    for a in data["high_risk_areas"]:
        writer.writerow(["HIGH RISK AREA (model)", a["name"], a["name"], a["reason"], a["latitude"], a["longitude"], "experimental"])
    for c in data["road_closures"]:
        writer.writerow(["ROAD CLOSURE", c["road_name"], "", c["reason"], c["latitude"], c["longitude"], c["source"]])
    for s in data["shelters"]:
        writer.writerow(["SHELTER", s["name"], "", f"capacity {s['capacity'] or '?'}", s["latitude"], s["longitude"], s["source"]])
    return Response(out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=floodwatch-briefing-{ist_today()}.csv"})


@app.post("/api/admin/waterlogging/import")
async def import_waterlogging(file: UploadFile = File(...), source: str = Form(..., min_length=2, max_length=200),
                              admin: str = Depends(require_admin)):
    """
    Import known waterlogging spots from a CSV file with columns: name, latitude, longitude
    (e.g. typed in from a Greater Chennai Corporation vulnerable-locations list).
    Rows with missing/invalid coordinates or outside Chennai are skipped and reported - never guessed.
    """
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    columns = {c.strip().lower(): c for c in (reader.fieldnames or [])}
    if not {"name", "latitude", "longitude"} <= set(columns):
        raise HTTPException(422, "The CSV needs the columns: name, latitude, longitude")
    added, skipped = [], []
    for line, row in enumerate(reader, start=2):
        try:
            name = row[columns["name"]].strip()
            lat, lon = float(row[columns["latitude"]]), float(row[columns["longitude"]])
            if not name or not in_chennai(lat, lon):
                raise ValueError
        except (TypeError, ValueError, AttributeError):
            skipped.append(line)
            continue
        added.append((name, lat, lon, source, now_text()))
    conn = get_connection()
    conn.executemany("INSERT INTO waterlogging_points (name, latitude, longitude, source, imported_at) "
                     "VALUES (?, ?, ?, ?, ?)", added)
    conn.commit()
    conn.close()
    return {"added": len(added), "skipped_lines": skipped}


@app.delete("/api/admin/waterlogging/{point_id}")
def remove_waterlogging(point_id: int, admin: str = Depends(require_admin)):
    conn = get_connection()
    conn.execute("DELETE FROM waterlogging_points WHERE id = ?", (point_id,))
    conn.commit()
    conn.close()
    return {"removed": point_id}


@app.post("/api/admin/terrain/rebuild")
def rebuild_terrain(background: BackgroundTasks, admin: str = Depends(require_admin)):
    """Rebuild the susceptibility grid in the background (a few minutes)."""
    if terrain_status["running"]:
        return {"started": False, "message": "Already building"}
    background.add_task(run_terrain_build)
    return {"started": True, "message": "Building in the background; this takes a few minutes."}


@app.get("/api/admin/terrain/status")
def terrain_build_status(admin: str = Depends(require_admin)):
    return terrain_status
