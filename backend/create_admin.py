"""
create_admin.py - Create an admin account (there are no default passwords).

Usage:  python create_admin.py admin@example.com MyStrongPassword123
"""
import sys

from database import create_tables, get_connection
from auth import hash_password

if len(sys.argv) != 3:
    print("Usage: python create_admin.py <email> <password>")
    sys.exit(1)

email, password = sys.argv[1].lower(), sys.argv[2]
if len(password) < 10:
    print("Password must be at least 10 characters.")
    sys.exit(1)

create_tables()
conn = get_connection()
conn.execute("INSERT OR REPLACE INTO admins (email, password_hash) VALUES (?, ?)", (email, hash_password(password)))
conn.commit()
conn.close()
print(f"Admin {email} is ready.")
