"""
One-time migration from CampusVoice's local SQLite database to Supabase PostgreSQL.

Run from the project folder after setting DATABASE_URL in .env:
    python migrate_sqlite_to_supabase.py

This script refuses to import if any of the six PostgreSQL tables already contain
rows, to avoid accidentally duplicating or mixing production data.
"""
import os
import sqlite3
from datetime import datetime, timezone

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
SQLITE_PATH = os.path.join(BASE_DIR, "campusvoice.db")

TABLES = (
    "users",
    "reviews",
    "reactions",
    "replies",
    "reports",
    "guest_feedback",
)


def parse_timestamp(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    value = str(value).strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        result = datetime.fromisoformat(value)
    except ValueError:
        # Preserve migration ability for common SQLite timestamp formats.
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                result = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                result = None
        if result is None:
            raise ValueError(f"Unrecognized created_at timestamp: {value!r}")
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def main():
    if not DATABASE_URL:
        raise SystemExit("ERROR: DATABASE_URL is missing from your .env file.")
    if not os.path.isfile(SQLITE_PATH):
        raise SystemExit(f"ERROR: Local SQLite database not found: {SQLITE_PATH}")

    sqlite_db = sqlite3.connect(SQLITE_PATH)
    sqlite_db.row_factory = sqlite3.Row
    try:
        source_tables = {
            row["name"]
            for row in sqlite_db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        missing = set(TABLES) - source_tables
        if missing:
            raise SystemExit(
                "ERROR: The local SQLite database is missing tables: "
                + ", ".join(sorted(missing))
            )

        source_rows = {
            table: [dict(row) for row in sqlite_db.execute(f"SELECT * FROM {table}")]
            for table in TABLES
        }
    finally:
        sqlite_db.close()

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as pg:
        # Keep the schema up to date before checking target counts.
        from app import SCHEMA
        for statement in SCHEMA.split(";"):
            if statement.strip():
                pg.execute(statement)
        pg.commit()

        counts = {
            table: pg.execute(f"SELECT COUNT(*) AS n FROM public.{table}").fetchone()["n"]
            for table in TABLES
        }
        nonempty = {table: count for table, count in counts.items() if count}
        if nonempty:
            details = ", ".join(f"{table}={count}" for table, count in nonempty.items())
            raise SystemExit(
                "ERROR: Supabase tables are not empty (" + details + "). "
                "No rows were imported. Do not clear data unless you are certain "
                "it is safe; inspect the target first."
            )

        defaults = {
            "users": {"is_admin": False, "student_number": ""},
            "reviews": {"status": "pending", "video": "", "is_live": False},
            "guest_feedback": {"role": ""},
        }

        for table in TABLES:
            rows = source_rows[table]
            if not rows:
                print(f"{table}: 0 rows")
                continue

            normalized = []
            for row in rows:
                row = dict(row)
                for key, value in defaults.get(table, {}).items():
                    row.setdefault(key, value)
                if table == "users":
                    row["is_admin"] = bool(row.get("is_admin", False))
                if table == "reviews":
                    row["is_live"] = bool(row.get("is_live", False))
                if table == "guest_feedback" and not row.get("role"):
                    # Older SQLite records may predate the role field; Supabase
                    # schemas may require one of the four valid roles.
                    row["role"] = "Guest"
                if "created_at" in row:
                    row["created_at"] = parse_timestamp(row["created_at"])
                normalized.append(row)

            # Use only columns that exist in the destination table, based on
            # the first source row after applying compatibility defaults.
            columns = list(normalized[0].keys())
            col_sql = ", ".join(f'"{col}"' for col in columns)
            placeholders = ", ".join(["%s"] * len(columns))
            sql = f"INSERT INTO public.{table} ({col_sql}) VALUES ({placeholders})"
            values = [tuple(row.get(col) for col in columns) for row in normalized]
            with pg.cursor() as cur:
                cur.executemany(sql, values)
            print(f"{table}: imported {len(values)} rows")

        # Reset identity sequences after copying explicit SQLite IDs.
        for table in ("users", "reviews", "replies", "reports", "guest_feedback"):
            pg.execute(
                """
                SELECT setval(
                    pg_get_serial_sequence(%s, 'id'),
                    COALESCE((SELECT MAX(id) FROM public.""" + table + """), 1),
                    EXISTS (SELECT 1 FROM public.""" + table + """)
                )
                """,
                (f"public.{table}",),
            )
        pg.commit()

    print("Migration completed. Verify counts and test login/reviews before continuing.")


if __name__ == "__main__":
    main()
