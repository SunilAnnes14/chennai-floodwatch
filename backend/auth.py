"""
auth.py - Admin login.

* Passwords are never stored directly. We store a bcrypt "hash" of them.
* After logging in, the admin gets a JWT token (a signed string).
  The browser sends it back with every admin request to prove who it is.
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Header, HTTPException

# The secret used to sign tokens. Set JWT_SECRET in the .env file!
SECRET = os.environ.get("JWT_SECRET", "change-this-secret-in-the-env-file")
TOKEN_HOURS = 8


def hash_password(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password, password_hash):
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def make_token(email):
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    return jwt.encode({"sub": email, "exp": expires}, SECRET, algorithm="HS256")


def require_admin(authorization: str = Header(default="")):
    """FastAPI runs this before every admin route. No valid token -> error 401."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Please log in")
    token = authorization.removeprefix("Bearer ")
    try:
        data = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid login token")
    return data["sub"]  # the admin's email
