"""
database.py - Everything about storing data.

Two kinds of database, same code:
  * On your computer: SQLite - the whole database is ONE file (floodwatch.db), nothing to install.
  * Online (Vercel): PostgreSQL (e.g. a free Neon database). Used automatically when the
    DATABASE_URL (or POSTGRES_URL) environment variable is set.

All SQL in this project is written so it works in both:
  - placeholders are written as ?  (changed to %s for PostgreSQL below)
  - "INSERT ... ON CONFLICT DO NOTHING" instead of SQLite-only "INSERT OR IGNORE"
  - "INSERT ... RETURNING id" instead of SQLite-only "cursor.lastrowid"
"""
import os
import sqlite3
import threading

# The SQLite file lives next to this script (tests can change this path).
DB_PATH = os.environ.get("FLOODWATCH_DB", os.path.join(os.path.dirname(__file__), "floodwatch.db"))


def database_url():
    return os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")


def using_postgres():
    return bool(database_url())


# ---------------------------------------------------------------- PostgreSQL helpers

class Row(dict):
    """A result row you can read by name (row["email"]) or by position (row[0]), like sqlite3.Row."""

    def __init__(self, names, values):
        super().__init__(zip(names, values))
        self._values = values

    def __getitem__(self, key):
        return self._values[key] if isinstance(key, int) else super().__getitem__(key)


def _row_factory(cursor):
    names = [c.name for c in cursor.description] if cursor.description else []
    return lambda values: Row(names, values)


class PostgresConnection:
    """Wraps a psycopg connection so the rest of the code can use it exactly like sqlite3."""

    def __init__(self, raw):
        self.raw = raw

    @staticmethod
    def _sql(sql):
        return sql.replace("%", "%%").replace("?", "%s")

    def execute(self, sql, params=()):
        return self.raw.execute(self._sql(sql), params)

    def executemany(self, sql, rows):
        with self.raw.cursor() as cur:
            cur.executemany(self._sql(sql), list(rows))

    def executescript(self, script):
        for statement in script.split(";"):
            if statement.strip():
                self.raw.execute(statement)

    def commit(self):
        pass  # autocommit: every statement is saved straight away

    def close(self):
        pass  # the connection is kept open and reused (see get_connection)


_local = threading.local()


def _postgres_connection():
    """One open connection per server thread, reused (opening one per query would be slow online)."""
    import psycopg  # only needed online

    conn = getattr(_local, "conn", None)
    if conn is None or conn.raw.closed or conn.raw.broken:
        # prepare_threshold=None: needed for "pooled" connection URLs (PgBouncer), e.g. Neon
        raw = psycopg.connect(database_url(), autocommit=True, prepare_threshold=None, row_factory=_row_factory)
        conn = _local.conn = PostgresConnection(raw)
    return conn


# ---------------------------------------------------------------- the one function everyone uses

def get_connection():
    """Open a connection. Rows can be read like dictionaries: row["name"]."""
    if using_postgres():
        return _postgres_connection()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def column_names(conn, table):
    if using_postgres():
        rows = conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = ?", (table,))
        return [r[0] for r in rows]
    return [row["name"] for row in conn.execute(f"PRAGMA table_info({table})")]


def add_missing_columns(conn, table, columns):
    """Add each column in `columns` ({name: type}) to `table` if it isn't there yet."""
    existing = column_names(conn, table)
    for column, column_type in columns.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")


SCHEMA = """
CREATE TABLE IF NOT EXISTS admins (
    id            {ID},
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT
);

-- Chennai neighbourhoods we monitor
CREATE TABLE IF NOT EXISTS areas (
    id          {ID},
    name        TEXT UNIQUE NOT NULL,
    latitude    {REAL} NOT NULL,
    longitude   {REAL} NOT NULL,
    elevation_m {REAL}            -- filled from the Open-Meteo elevation API (real data)
);

-- Flood reports sent by citizens
CREATE TABLE IF NOT EXISTS reports (
    id             {ID},
    location_text  TEXT NOT NULL,
    latitude       {REAL} NOT NULL,
    longitude      {REAL} NOT NULL,
    water_depth_cm INTEGER NOT NULL,
    severity       TEXT NOT NULL,     -- LOW / MODERATE / HIGH / SEVERE
    description    TEXT DEFAULT '',
    photo          TEXT,              -- name of the photo in the photos table
    status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING / VERIFIED / REJECTED / RESOLVED
    reporter_ip    TEXT,
    created_at     TEXT NOT NULL
);

-- Report photos are stored inside the database (online servers have no permanent disk)
CREATE TABLE IF NOT EXISTS photos (
    name       TEXT PRIMARY KEY,
    data       {BLOB} NOT NULL,
    created_at TEXT NOT NULL
);

-- Alerts and announcements
CREATE TABLE IF NOT EXISTS alerts (
    id         {ID},
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    alert_type TEXT NOT NULL,   -- OFFICIAL / VERIFIED_REPORT / PREDICTION
    source     TEXT NOT NULL,   -- where the information came from
    created_at TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1
);

-- Road closures entered by admins
CREATE TABLE IF NOT EXISTS road_closures (
    id         {ID},
    road_name  TEXT NOT NULL,
    latitude   {REAL} NOT NULL,
    longitude  {REAL} NOT NULL,
    reason     TEXT DEFAULT '',
    source     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1
);

-- Hourly rainfall saved from Open-Meteo (keeps a history)
CREATE TABLE IF NOT EXISTS rainfall (
    area_id          INTEGER NOT NULL REFERENCES areas(id),
    time             TEXT NOT NULL,
    precipitation_mm {REAL},
    PRIMARY KEY (area_id, time)
);

-- Relief shelters / relief centres, entered by admins from official lists
CREATE TABLE IF NOT EXISTS shelters (
    id         {ID},
    name       TEXT NOT NULL,
    latitude   {REAL} NOT NULL,
    longitude  {REAL} NOT NULL,
    capacity   INTEGER,
    source     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1
);

-- Street-level terrain susceptibility grid (~650 m squares), built by terrain.py
CREATE TABLE IF NOT EXISTS grid_cells (
    id                   {ID},
    latitude             {REAL} NOT NULL,
    longitude            {REAL} NOT NULL,
    elevation_m          {REAL} NOT NULL,
    height_above_water_m {REAL},        -- height above the local river / lake level (empty = no water nearby)
    water_distance_m     {REAL},        -- distance to the nearest river / lake / marsh
    nearest_water        TEXT,
    score                {REAL} NOT NULL,   -- 0 (unlikely to flood) .. 1 (very likely)
    level                TEXT NOT NULL      -- LOW / MEDIUM / HIGH susceptibility
);

-- Known waterlogging spots imported by admins from official lists (e.g. GCC vulnerable locations)
CREATE TABLE IF NOT EXISTS waterlogging_points (
    id          {ID},
    name        TEXT NOT NULL,
    latitude    {REAL} NOT NULL,
    longitude   {REAL} NOT NULL,
    source      TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

-- Every risk prediction we make is saved, so we can later check how often it was right
CREATE TABLE IF NOT EXISTS risk_log (
    id         {ID},
    area_id    INTEGER NOT NULL REFERENCES areas(id),
    logged_at  TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    rain_total {REAL}
)
"""

# The few words that differ between SQLite and PostgreSQL
TYPES = {
    "sqlite": {"ID": "INTEGER PRIMARY KEY AUTOINCREMENT", "REAL": "REAL", "BLOB": "BLOB"},
    "postgres": {"ID": "SERIAL PRIMARY KEY", "REAL": "DOUBLE PRECISION", "BLOB": "BYTEA"},
}


def create_tables():
    """Create all tables if they don't exist yet. Safe to run many times."""
    conn = get_connection()
    # An early version of the terrain grid had a different column. The grid can always be
    # rebuilt (python terrain.py), so an old-style table is simply removed.
    if "hollow_m" in column_names(conn, "grid_cells"):
        conn.execute("DROP TABLE grid_cells")
    conn.executescript(SCHEMA.format(**TYPES["postgres" if using_postgres() else "sqlite"]))

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
    conn.executemany("INSERT INTO areas (name, latitude, longitude) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                     focus_areas)
    conn.commit()
    conn.close()
