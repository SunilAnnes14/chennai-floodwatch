"""
terrain.py - STREET-LEVEL flood susceptibility (the "Predict" step, at street scale).

Rainfall data only covers whole areas, but the ground is different on every street.
So we cover south/central Chennai with a grid of points ~650 m apart and give each
point a TERRAIN SCORE (how easily river/lake water reaches it), from real data:

  1. Height above nearby water - "HAND" (Height Above Nearest Drainage), a standard
     hydrology idea. A street 20 m above the sea can still flood if the river next to
     it is at 18 m. We estimate the local water level as the low ground on the banks of
     rivers/lakes within 1.5 km. (Ground heights: Copernicus DEM 90 m, via Open-Meteo.)
  2. Distance to the nearest river, canal, lake or marsh (OpenStreetMap shapes).

  score = 0.55 x low above water + 0.45 x near water        (each part is 0..1)

LOW CONFIDENCE: the 90 m height model includes buildings, so dense neighbourhoods look
higher than the real ground. That is why main.py also uses FLOOD HISTORY (verified reports
and known waterlogging points), which is the stronger street-level signal.
The weights are our own simple choice and are NOT validated against real floods.

Build the grid once (takes a few minutes, needs internet):   python terrain.py
"""
import json
import math
import os
import time

import httpx
from shapely.geometry import shape
from shapely.ops import transform

from database import create_tables, get_connection
from risk import rain_points

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
WATER_FILE = os.path.join(DATA_DIR, "water_bodies.json")

# Grid covering the 8 focus areas (south & central Chennai)
GRID = {"lat_min": 12.88, "lat_max": 13.10, "lon_min": 80.04, "lon_max": 80.30, "step": 0.006}

# Rivers, canals, lakes and marshes we look up in OpenStreetMap
WATER_FEATURES = [
    "Adyar River", "Cooum River", "Buckingham Canal", "Otteri Nullah", "Velachery Lake",
    "Pallikaranai Marsh", "Chembarambakkam Lake", "Porur Lake", "Madipakkam Lake",
    "Sembakkam Lake", "Selaiyur Lake", "Mudichur Lake", "Adambakkam Lake", "Chitlapakkam Lake",
    "Perungudi Lake", "Narayanapuram Lake", "Keelkattalai Lake", "Nanmangalam Lake",
]
WATER_CATEGORIES = {"waterway", "water", "natural"}
WATER_TYPES = {"river", "canal", "drain", "stream", "lake", "reservoir", "wetland", "nature_reserve", "water"}


def clip(value, low=0.0, high=1.0):
    return max(low, min(high, value))


# ---------------- the scoring rule (pure maths, easy to test) ----------------

def susceptibility(height_above_water_m, water_distance_m):
    """Terrain score. Returns (score 0..1, level LOW/MEDIUM/HIGH, list of reasons)."""
    if height_above_water_m is None or water_distance_m is None:
        return 0.0, "LOW", ["no river, canal or lake within 1.5 km"]
    low_above_water = clip(1 - (height_above_water_m - 1) / 7)   # 1 m or less above the water -> 1,  8 m+ -> 0
    near_water = clip(1 - (water_distance_m - 100) / 1400)       # 100 m or closer -> 1,  1.5 km+ -> 0
    score = round(0.55 * low_above_water + 0.45 * near_water, 2)
    level = "HIGH" if score >= 0.6 else "MEDIUM" if score >= 0.35 else "LOW"
    reasons = [f"about {max(height_above_water_m, 0):.0f} m above the nearby water level",
               f"{water_distance_m:.0f} m from the nearest river / lake"]
    return score, level, reasons


def street_level_risk(area_rain_total, cell, flood_history=0):
    """
    Combine the area's rainfall with what we know about this exact spot:
      - terrain (cell level, low confidence)
      - flood history: verified floods here before + known waterlogging points (strong signal)
    Heavy rain + (HIGH terrain OR flood history) raises the level one step.
    """
    if area_rain_total is None:
        return None, "Rainfall data missing"
    points = rain_points(area_rain_total)
    notes = [f"{area_rain_total:.1f} mm rain in the area (past 24 h + next 24 h)"]
    flood_prone = flood_history > 0 or (cell is not None and cell["level"] == "HIGH")
    if flood_history:
        notes.append(f"{flood_history} past flood / waterlogging record(s) within 300 m")
    if cell is None:
        notes.append("street not inside the terrain grid")
    else:
        notes.append(f"{cell['level'].lower()} terrain susceptibility")
    if points > 0 and flood_prone:
        points += 1
        notes.append("flood-prone spot raises the level one step")
    return ["LOW", "MODERATE", "HIGH", "VERY_HIGH", "VERY_HIGH"][points], "; ".join(notes)


# ---------------- looking things up ----------------

def nearest_cell(lat, lon, max_m=600):
    """The grid point nearest to (lat, lon), or None if we have no grid there."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM grid_cells WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",
        (lat - 0.01, lat + 0.01, lon - 0.01, lon + 0.01)).fetchall()
    conn.close()
    best, best_d = None, None
    for row in rows:
        d = metres(lat, lon, row["latitude"], row["longitude"])
        if best_d is None or d < best_d:
            best, best_d = dict(row), d
    return best if best_d is not None and best_d <= max_m else None


def metres(lat1, lon1, lat2, lon2):
    """Quick distance in metres (fine for short distances inside a city)."""
    x = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110574
    return math.hypot(x, y)


# ---------------- building the grid (run once) ----------------

def to_metres(lon, lat, z=None):
    """Turn longitude/latitude into metres so shapely can measure distances."""
    return lon * 111320 * math.cos(math.radians(13.0)), lat * 110574


def fetch_water_bodies():
    """Download river/lake shapes from OpenStreetMap (Nominatim) and save them to data/water_bodies.json."""
    import streets  # uses the 1-request-per-second helper
    found = []
    for name in WATER_FEATURES:
        try:
            results = streets.nominatim_get("/search", {
                "q": name + ", Chennai", "format": "jsonv2", "limit": 5, "countrycodes": "in",
                "polygon_geojson": 1, "polygon_threshold": 0.0003})
        except Exception as error:
            print(f"  {name}: lookup failed ({error})")
            continue
        match = next((r for r in results
                      if (r.get("category") in WATER_CATEGORIES or r.get("type") in WATER_TYPES)
                      and r.get("geojson", {}).get("type") != "Point"), None)
        if match:
            found.append({"name": name, "type": match["type"], "geojson": match["geojson"]})
            print(f"  {name}: found ({match['type']}, {match['geojson']['type']})")
        else:
            print(f"  {name}: not found as a water feature - skipped")
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(WATER_FILE, "w", encoding="utf-8") as f:
        json.dump({"source": "© OpenStreetMap contributors (ODbL), via Nominatim", "features": found}, f)
    return found


def fetch_elevations(points):
    """Heights for many points, 100 per request (Open-Meteo elevation API, Copernicus DEM)."""
    # The free API allows about 600 points per minute, so we wait between batches,
    # and if it still says "too many requests" (429) we wait a minute and try again.
    heights = []
    for i in range(0, len(points), 100):
        batch = points[i:i + 100]
        for attempt in range(4):
            response = httpx.get("https://api.open-meteo.com/v1/elevation", timeout=30, params={
                "latitude": ",".join(f"{p[0]:.4f}" for p in batch),
                "longitude": ",".join(f"{p[1]:.4f}" for p in batch)})
            if response.status_code != 429:
                break
            print("  rate limit reached, waiting 65 s...")
            time.sleep(65)
        response.raise_for_status()
        heights += response.json()["elevation"]
        print(f"  {min(i + 100, len(points))}/{len(points)} points")
        time.sleep(12)
    return heights


HEIGHTS_FILE = os.path.join(DATA_DIR, "grid_heights.json")
CELLS_FILE = os.path.join(DATA_DIR, "grid_cells.json")   # the finished grid, ready to load
CELL_COLUMNS = ["latitude", "longitude", "elevation_m", "height_above_water_m",
                "water_distance_m", "nearest_water", "score", "level"]


def save_cells(cells):
    """Replace the grid in the database with `cells` (a list of rows in CELL_COLUMNS order)."""
    conn = get_connection()
    conn.execute("DELETE FROM grid_cells")
    conn.executemany(f"INSERT INTO grid_cells ({', '.join(CELL_COLUMNS)}) VALUES ({', '.join('?' * len(CELL_COLUMNS))})",
                     [tuple(c) for c in cells])
    conn.commit()
    conn.close()


def load_saved_grid():
    """Load the ready-made grid from data/grid_cells.json (no internet needed). Returns True if it worked."""
    if not os.path.exists(CELLS_FILE):
        return False
    with open(CELLS_FILE, encoding="utf-8") as f:
        saved = json.load(f)
    if saved.get("columns") != CELL_COLUMNS or not saved.get("cells"):
        return False
    save_cells(saved["cells"])
    print(f"Loaded {len(saved['cells'])} terrain grid cells from {os.path.basename(CELLS_FILE)}")
    return True


def grid_points():
    points = []
    lat = GRID["lat_min"]
    while lat <= GRID["lat_max"]:
        lon = GRID["lon_min"]
        while lon <= GRID["lon_max"]:
            points.append((round(lat, 4), round(lon, 4)))
            lon += GRID["step"]
        lat += GRID["step"]
    return points


def build_grid():
    print("1/3 Looking up rivers, canals and lakes in OpenStreetMap...")
    water = fetch_water_bodies()
    water_shapes = [(w["name"], transform(to_metres, shape(w["geojson"]))) for w in water]

    print("2/3 Getting ground heights...")
    points = grid_points()
    if os.path.exists(HEIGHTS_FILE):  # downloaded before: reuse it (heights don't change)
        with open(HEIGHTS_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        heights = saved["heights"] if saved.get("points") == [list(p) for p in points] else None
    else:
        heights = None
    if heights is None:
        heights = fetch_elevations(points)
        with open(HEIGHTS_FILE, "w", encoding="utf-8") as f:
            json.dump({"source": "Copernicus DEM 90 m via Open-Meteo", "points": points, "heights": heights}, f)
    land = [(p, h) for p, h in zip(points, heights) if h is not None and h > 0]  # height 0 = sea

    print(f"3/3 Scoring {len(land)} grid points...")
    here = {p: transform(to_metres, shape({"type": "Point", "coordinates": [p[1], p[0]]})) for p, _ in land}
    distances = {p: min(((n, s.distance(here[p])) for n, s in water_shapes), key=lambda x: x[1]) if water_shapes else (None, None)
                 for p, _ in land}
    # "Bank" points: within 400 m of a river/lake. Their heights show the local water level.
    banks = [(here[p], h) for p, h in land if distances[p][1] is not None and distances[p][1] <= 400]

    cells = []
    for p, height in land:
        water_name, water_distance = distances[p]
        height_above_water = None
        if water_distance is not None and water_distance <= 1500:
            nearby_banks = sorted(h for q, h in banks if q.distance(here[p]) <= 1500)
            if nearby_banks:
                water_level = nearby_banks[len(nearby_banks) // 5]  # one of the lowest (ignores single odd values)
                height_above_water = max(0.0, height - water_level)
        score, level, _ = susceptibility(height_above_water, water_distance if height_above_water is not None else None)
        cells.append((p[0], p[1], height,
                      round(height_above_water, 1) if height_above_water is not None else None,
                      round(water_distance) if water_distance is not None else None, water_name, score, level))

    save_cells(cells)
    # Also keep a copy in data/grid_cells.json: the online server loads this instead of rebuilding
    with open(CELLS_FILE, "w", encoding="utf-8") as f:
        json.dump({"columns": CELL_COLUMNS, "cells": cells}, f)
    counts = {lvl: sum(1 for c in cells if c[7] == lvl) for lvl in ("LOW", "MEDIUM", "HIGH")}
    print(f"Done: {len(cells)} cells saved ({counts}), {len(water)} water features used.")
    return {"cells": len(cells), "levels": counts, "water_features": [w["name"] for w in water]}


if __name__ == "__main__":
    create_tables()
    build_grid()
