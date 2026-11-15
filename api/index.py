"""
api/index.py - Entry point for Vercel.

Vercel runs this file as a "serverless function": a small server that starts when a
request arrives. It loads our FastAPI app from the backend folder.
vercel.json sends every /api/... request here.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))


def database_missing_app():
    """Online there is no permanent disk, so SQLite can't be used. Until a database is
    connected, every API call explains what to do instead of failing with a vague error."""
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    fallback = FastAPI()

    @fallback.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "DELETE"])
    def database_missing(path: str):
        return JSONResponse(status_code=503, content={
            "detail": "Database not connected: in Vercel open your project -> Storage -> connect a Neon "
                      "Postgres database (it sets DATABASE_URL), then redeploy."})

    return fallback


def floodwatch_app():
    import main

    # Create tables, the admin from settings, and load the terrain grid - once per new server.
    # If this fails (e.g. the database can't be reached), the site keeps running and
    # /api/health shows the error instead of every page crashing.
    try:
        main.startup()
    except Exception as error:  # noqa: BLE001
        main.startup_error["message"] = f"{type(error).__name__}: {error}"
        main._started["done"] = False  # try again later
        print("Startup failed:", main.startup_error["message"])
    return main.app


ON_VERCEL_WITHOUT_DATABASE = bool(os.environ.get("VERCEL")) and not (
    os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL"))

# Vercel looks for a top-level variable called "app"
app = database_missing_app() if ON_VERCEL_WITHOUT_DATABASE else floodwatch_app()
