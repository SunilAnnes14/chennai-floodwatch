"""
streets.py - Finds WHICH STREET a flood report is on, using OpenStreetMap.

For a GPS point, Nominatim "reverse search" tells us:
  * the street name (e.g. "Velachery Bypass Road")
  * the locality (e.g. "Gangai Nagar")
  * the shape of the street (a list of points)

We only keep the part of the street within 150 m of the report. Otherwise one
report would paint a whole 10 km road as flooded.

Nominatim allows at most 1 request per second, so every request goes through
nominatim_get(), which waits if needed.
"""
import math
import time

import httpx

NOMINATIM = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "ChennaiFloodWatch student project"}
KEEP_METRES = 150   # how much of the street around a report we highlight

_last_request = [0.0]


def nominatim_get(path, params):
    """Call Nominatim, waiting so we never send more than 1 request per second."""
    wait = 1 - (time.time() - _last_request[0])
    if wait > 0:
        time.sleep(wait)
    _last_request[0] = time.time()
    response = httpx.get(NOMINATIM + path, params=params, headers=HEADERS, timeout=15)
    response.raise_for_status()
    return response.json()


def distance_m(lat1, lon1, lat2, lon2):
    """Distance in metres between two GPS points (haversine formula)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def nearby_part(line, lat, lon, keep=KEEP_METRES):
    """
    line = street points as [[lon, lat], ...] (GeoJSON order).
    Returns only the points within `keep` metres of (lat, lon), as [[lat, lon], ...] for Leaflet.

    Long straight roads may have points 1 km apart, so we first add extra points
    every ~10 m along each piece of road ("densify"), then keep the close ones.
    """
    dense = []
    for (lon1, lat1), (lon2, lat2) in zip(line, line[1:]):
        steps = max(1, int(distance_m(lat1, lon1, lat2, lon2) / 10))
        for i in range(steps):
            t = i / steps
            dense.append([lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t])
    if line:
        dense.append([line[-1][1], line[-1][0]])

    close = [p for p in dense if distance_m(lat, lon, p[0], p[1]) <= keep]
    if len(close) < 2:
        return None
    return [[round(p[0], 6), round(p[1], 6)] for p in close]


def find_street(lat, lon):
    """Returns {"street_name", "locality", "geometry"} or None if the lookup fails."""
    try:
        data = nominatim_get("/reverse", {"lat": lat, "lon": lon, "format": "jsonv2",
                                          "zoom": 17, "polygon_geojson": 1})
    except Exception as error:
        print("Street lookup failed:", error)
        return None

    address = data.get("address", {})
    locality = (address.get("neighbourhood") or address.get("suburb")
                or address.get("quarter") or address.get("city_district") or "Chennai")
    street = address.get("road") or f"Unnamed road in {locality}"

    geometry = None
    shape = data.get("geojson") or {}
    if data.get("category") == "highway" and shape.get("type") == "LineString":
        geometry = nearby_part(shape["coordinates"], lat, lon)
    return {"street_name": street, "locality": locality, "geometry": geometry}
