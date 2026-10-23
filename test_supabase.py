
import os
import psycopg
from dotenv import load_dotenv

load_dotenv()

database_url = os.getenv("DATABASE_URL")

if not database_url:
    raise SystemExit("DATABASE_URL is missing from .env")

try:
    with psycopg.connect(
        database_url,
        connect_timeout=10,
        sslmode="require"
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), version()")
            database, version = cur.fetchone()

    print("Supabase connection successful!")
    print("Database:", database)
    print("PostgreSQL:", version.split(",")[0])

except Exception as exc:
    print("Connection failed:", type(exc).__name__)
    print("Check your .env values, password encoding, host, and network.")
