"""
database.py - Everything about storing data.

We use SQLite: the whole database is ONE file (floodwatch.db).
Nothing extra needs to be installed - Python already includes sqlite3.
"""
import sqlite3
import os

# The database file lives next to this script (tests can change this path).
DB_PATH = os.environ.get("FLOODWATCH_DB", os.path.join(os.path.dirname(__file__), "floodwatch.db"))


def get_connection():
    """Open a connection. row_factory lets us read rows like dictionaries: row["name"]."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def add_missing_columns(conn, table, columns):
    """Add each column in `columns` ({name: type}) to `table` if it isn't there yet."""
    existing = [row["name"] for row in conn.execute(f"PRAGMA table_info({table})")]
    for column, column_type in columns.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")


def create_tables():
    """Create all tables if they don't exist yet. Safe to run many times."""
    conn = get_connection()
    # An early version of the terrain grid had a different column. The grid can always be
    # rebuilt (python terrain.py), so an old-style table is simply removed.
    if "hollow_m" in [row["name"] for row in conn.execute("PRAGMA table_info(grid_cells)")]:
        conn.execute("DROP TABLE grid_cells")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS admins (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Chennai neighbourhoods we monitor
    CREATE TABLE IF NOT EXISTS areas (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT UNIQUE NOT NULL,
        latitude    REAL NOT NULL,
        longitude   REAL NOT NULL,
        elevation_m REAL            -- filled from the Open-Meteo elevation API (real data)
    );

    -- Flood reports sent by citizens
    CREATE TABLE IF NOT EXISTS reports (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        location_text  TEXT NOT NULL,
        latitude       REAL NOT NULL,
        longitude      REAL NOT NULL,
        water_depth_cm INTEGER NOT NULL,
        severity       TEXT NOT NULL,     -- LOW / MODERATE / HIGH / SEVERE
        description    TEXT DEFAULT '',
        photo          TEXT,              -- file name inside the uploads folder
        status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING / VERIFIED / REJECTED / RESOLVED
        reporter_ip    TEXT,
        created_at     TEXT NOT NULL
    );

    -- Alerts and announcements written by admins
    CREATE TABLE IF NOT EXISTS alerts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        message    TEXT NOT NULL,
        alert_type TEXT NOT NULL,   -- OFFICIAL / VERIFIED_REPORT / PREDICTION
        source     TEXT NOT NULL,   -- where the information came from
        created_at TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 1
    );

    -- Road closures entered by admins
    CREATE TABLE IF NOT EXISTS road_closures (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        road_name  TEXT NOT NULL,
        latitude   REAL NOT NULL,
        longitude  REAL NOT NULL,
        reason     TEXT DEFAULT '',
        source     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 1
    );

    -- Hourly rainfall saved from Open-Meteo (keeps a history)
    CREATE TABLE IF NOT EXISTS rainfall (
        area_id          INTEGER NOT NULL REFERENCES areas(id),
        time             TEXT NOT NULL,
        precipitation_mm REAL,
        PRIMARY KEY (area_id, time)
    );

    -- Relief shelters / relief centres, entered by admins from official lists
    CREATE TABLE IF NOT EXISTS shelters (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        latitude   REAL NOT NULL,
        longitude  REAL NOT NULL,
        capacity   INTEGER,
        source     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 1
    );

    -- Street-level terrain susceptibility grid (~650 m squares), built by terrain.py
    CREATE TABLE IF NOT EXISTS grid_cells (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude             REAL NOT NULL,
        longitude            REAL NOT NULL,
        elevation_m          REAL NOT NULL,
        height_above_water_m REAL,        -- height above the local river / lake level (empty = no water nearby)
        water_distance_m     REAL,        -- distance to the nearest river / lake / marsh
        nearest_water        TEXT,
        score                REAL NOT NULL,   -- 0 (unlikely to flood) .. 1 (very likely)
        level                TEXT NOT NULL    -- LOW / MEDIUM / HIGH susceptibility
    );

    -- Known waterlogging spots imported by admins from official lists (e.g. GCC vulnerable locations)
    CREATE TABLE IF NOT EXISTS waterlogging_points (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        latitude    REAL NOT NULL,
        longitude   REAL NOT NULL,
        source      TEXT NOT NULL,
        imported_at TEXT NOT NULL
    );

    -- Every risk prediction we make is saved, so we can later check how often it was right
    CREATE TABLE IF NOT EXISTS risk_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        area_id    INTEGER NOT NULL REFERENCES areas(id),
        logged_at  TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        rain_total REAL
    );
    """)

    # Columns added later. Older databases don't have them yet, so we add any that are
    # missing. Existing data keeps working.
    add_missing_columns(conn, "reports", {
        "street_name": "TEXT",       # e.g. "Velachery Bypass Road" (from OpenStreetMap)
        "locality": "TEXT",          # e.g. "Gangai Nagar"
        "street_geometry": "TEXT",   # JSON list of [lat, lon] points: the flooded part of the street
        "verified_at": "TEXT",       # when an admin last verified / re-confirmed it
    })
    add_missing_columns(conn, "alerts", {
        "area_id": "INTEGER",        # empty = whole of Chennai
        "expires_at": "TEXT",        # empty = until an admin removes it
        "is_automatic": "INTEGER NOT NULL DEFAULT 0",
        "dedupe_key": "TEXT",        # stops the same automatic alert being created twice
    })
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL")

    # Add the 8 focus areas once. Coordinates are approximate neighbourhood
    # centres taken from OpenStreetMap.
    focus_areas = [
        ("Velachery", 12.9815, 80.2180),
        ("Mudichur", 12.9137, 80.0716),
        ("Pallikaranai", 12.9349, 80.2137),
        ("Tambaram", 12.9249, 80.1000),
        ("Adyar", 13.0012, 80.2565),
        ("Perungudi", 12.9654, 80.2461),
        ("Saidapet", 13.0213, 80.2231),
        ("T. Nagar", 13.0418, 80.2341),
    ]
    conn.executemany("INSERT OR IGNORE INTO areas (name, latitude, longitude) VALUES (?, ?, ?)", focus_areas)
    conn.commit()
    conn.close()
