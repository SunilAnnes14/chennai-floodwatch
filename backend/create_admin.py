"""
create_admin.py - Create an admin account, or change its password (there are no default passwords).

Usage:  python create_admin.py admin@example.com MyStrongPassword123

Uses your local SQLite file, or the online database if DATABASE_URL is set.
(Online you can also use the ADMIN_EMAIL / ADMIN_PASSWORD settings instead - see README.)
"""
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

from database import create_tables, get_connection  # noqa: E402
from auth import hash_password  # noqa: E402

if len(sys.argv) != 3:
    print("Usage: python create_admin.py <email> <password>")
    sys.exit(1)

email, password = sys.argv[1].lower(), sys.argv[2]
if len(password) < 10:
    print("Password must be at least 10 characters.")
    sys.exit(1)

create_tables()
conn = get_connection()
conn.execute("INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?) "
             "ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash",
             (email, hash_password(password), datetime.now(timezone.utc).isoformat(timespec="seconds")))
conn.commit()
conn.close()
print(f"Admin {email} is ready.")
