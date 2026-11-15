"""
routing.py - Driving routes that try to AVOID flooded roads (the "Alert" step).

1. Ask OSRM (free routing engine with OpenStreetMap roads) for up to 3 routes.
2. Check each route against CONFIRMED problems only:
     - active road closures entered by admins
     - verified flood reports that are still active (not expired)
3. If every route passes a problem, try DETOURS: OSRM cannot "avoid" a point, so we ask
   for routes that go through a point 0.8 km or 1.6 km to the left/right of the problem
   ("via points"). Detours that avoid all known problems are added to the list.
4. Routes are sorted: fewest known problems first, then shortest time.

No route is ever called "safe" - we only know about problems that were reported.
"""
import math

import httpx

OSRM = "https://router.project-osrm.org/route/v1/driving/"
NEAR_ROUTE_M = 100          # a problem within 100 m of the route counts as "on the route"
DETOUR_OFFSETS_M = (800, -800, 1600, -1600)


class RoutingError(Exception):
    pass


def metres(lat1, lon1, lat2, lon2):
    x = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110574
    return math.hypot(x, y)


def osrm(points, alternatives=False):
    """points = [(lat, lon), ...]. Returns OSRM's list of routes."""
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    try:
        response = httpx.get(OSRM + coords, timeout=20, params={
            "alternatives": "true" if alternatives else "false", "overview": "full", "geometries": "geojson"})
        data = response.json()
    except Exception:
        raise RoutingError("Routing service (OSRM) is unavailable")
    if data.get("code") != "Ok":
        return []
    return data["routes"]


def problems_on(coordinates, hazards):
    """Which hazards are within NEAR_ROUTE_M of this route? coordinates = [[lat, lon], ...]"""
    step = max(1, len(coordinates) // 400)  # check at most ~400 route points (fast enough)
    sample = coordinates[::step] + [coordinates[-1]]
    return [h for h in hazards
            if any(metres(h["latitude"], h["longitude"], p[0], p[1]) < NEAR_ROUTE_M for p in sample)]


def describe(route, hazards, detour=False):
    coordinates = [[p[1], p[0]] for p in route["geometry"]["coordinates"]]  # [lat, lon] for Leaflet
    found = problems_on(coordinates, hazards)
    return {
        "distance_km": round(route["distance"] / 1000, 1),
        "duration_min": round(route["duration"] / 60),
        "coordinates": coordinates,
        "closures_on_route": [h for h in found if h["kind"] == "closure"],
        "verified_floods_on_route": [h for h in found if h["kind"] == "flood"],
        "problem_count": len(found),
        "is_detour": detour,
    }


def detour_points(route, hazard):
    """Points 0.8 / 1.6 km to the left and right of a hazard, across the route's direction."""
    coords = route["coordinates"]
    # the route point closest to the hazard, and the direction of travel there
    i = min(range(len(coords)), key=lambda k: metres(hazard["latitude"], hazard["longitude"], *coords[k]))
    a, b = coords[max(0, i - 3)], coords[min(len(coords) - 1, i + 3)]
    dx = (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0]))   # east-west metres
    dy = (b[0] - a[0]) * 110574                                     # north-south metres
    length = math.hypot(dx, dy) or 1
    px, py = -dy / length, dx / length                               # perpendicular direction
    points = []
    for offset in DETOUR_OFFSETS_M:
        lat = hazard["latitude"] + (py * offset) / 110574
        lon = hazard["longitude"] + (px * offset) / (111320 * math.cos(math.radians(hazard["latitude"])))
        points.append((lat, lon))
    return points


def plan(start, end, hazards):
    """start/end = (lat, lon). hazards = [{kind, latitude, longitude, ...}]. Returns a list of routes."""
    routes = [describe(r, hazards) for r in osrm([start, end], alternatives=True)]
    if not routes:
        return []
    routes.sort(key=lambda r: (r["problem_count"], r["duration_min"]))

    if routes[0]["problem_count"] > 0:            # every route has a known problem: try detours
        blocked = routes[0]
        hazard = (blocked["closures_on_route"] + blocked["verified_floods_on_route"])[0]
        for via in detour_points(blocked, hazard):
            for r in osrm([start, via, end]):
                detour = describe(r, hazards, detour=True)
                if detour["problem_count"] < blocked["problem_count"]:
                    routes.append(detour)
            if any(r["is_detour"] and r["problem_count"] == 0 for r in routes):
                break                              # found a clear detour, stop asking
        routes.sort(key=lambda r: (r["problem_count"], r["duration_min"]))
    return routes[:4]
