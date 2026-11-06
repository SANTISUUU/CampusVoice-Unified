
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
        sslmode="require",
        prepare_threshold=None,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), version()")
            database, version = cur.fetchone()

    print("Supabase connection successful!")
    print("Database:", database)
    print("PostgreSQL:", version.split(",")[0])

except Exception as exc:
    # Do not print DATABASE_URL: it contains the database password. Give a
    # specific, safe next step instead of hiding every connection failure.
    message = str(exc).lower()

    print("Connection failed:", type(exc).__name__)

    if "password authentication failed" in message:
        print(
            "Supabase rejected the password. Reset the database password, "
            "update DATABASE_URL, and URL-encode reserved characters."
        )
    elif "tenant/user" in message:
        print(
            "The pooler host or username is wrong. Copy the complete "
            "Transaction pooler URL from Supabase Connect without editing "
            "its host, port, or username."
        )
    elif "could not translate host name" in message or "name or service not known" in message:
        print("The pooler host cannot be resolved. Re-copy it from Supabase Connect.")
    elif "timeout" in message or "timed out" in message:
        print("The connection timed out. Check your network/firewall, then retry.")
    else:
        print("Check the Supabase project status, connection URL, and network.")
