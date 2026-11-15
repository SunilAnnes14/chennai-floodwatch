"""
api/index.py - Entry point for Vercel.

Vercel runs this file as a "serverless function": a small server that starts when a
request arrives. It simply loads our FastAPI app from the backend folder.
vercel.json sends every /api/... request here.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

if os.environ.get("VERCEL") and not (os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")):
    # Online there is no permanent disk, so SQLite can't be used. Until a database is
    # connected, every API call explains what to do instead of failing with a vague error.
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    app = FastAPI()

    @app.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "DELETE"])
    def database_missing(path: str):
        return JSONResponse(status_code=503, content={
            "detail": "Database not connected: in Vercel open your project -> Storage -> connect a Neon "
                      "Postgres database (it sets DATABASE_URL), then redeploy."})
else:
    import main  # noqa: E402
    from main import app, startup  # noqa: E402,F401  (Vercel looks for the variable "app")

    # Create tables, the admin from settings, and load the terrain grid - once per new server.
    # If this fails (e.g. the database can't be reached), the site keeps running and
    # /api/health shows the error instead of every page crashing.
    try:
        startup()
    except Exception as error:  # noqa: BLE001
        main.startup_error["message"] = f"{type(error).__name__}: {error}"
        main._started["done"] = False  # try again on the next request's server start
        print("Startup failed:", main.startup_error["message"])
