"""
CampusVoice backend (Flask + Supabase PostgreSQL).

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000

- Accounts, posts, likes/dislikes, replies and reports are saved in Supabase PostgreSQL.
- Set DATABASE_URL in .env before starting the app.
- Passwords are hashed. A login is kept in Flask's signed session cookie.
- Every /api route except signup and login needs a logged-in session.
- Write requests must send JSON (browsers can't send that cross-site
  without permission), which also protects against CSRF. The one
  exception is the media upload, which sends a custom header instead
  (browsers can't add that cross-site without permission either).
- Photos and videos are uploaded to /api/media and saved in the uploads
  folder (created automatically). Posts only store the file's URL.
"""

import base64
import json
import os
import re
import secrets
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import timedelta
from functools import wraps
from supabase import create_client
from urllib.parse import urljoin

from flask import (
    Flask,
    g,
    jsonify,
    request,
    send_from_directory,
    render_template,
    session,
    redirect,
)
from werkzeug.security import check_password_hash, generate_password_hash
from dotenv import load_dotenv
import psycopg
from psycopg.rows import dict_row



BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
# Supabase's current server-only credentials are named secret keys
# (sb_secret_...). Keep the former service-role name as a fallback so existing
# deployments continue to work while keys are rotated.
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY", ""
).strip()
SUPABASE_SERVER_KEY = SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY

SUPABASE_BUCKET = "CampusVoice-media"

# Vercel functions are short lived, so use Supabase's transaction pooler
# connection string there. Transaction poolers do not support server-side
# prepared statements; psycopg starts preparing repeated statements by default.
# Keep that feature disabled for every connection so repeated API requests work.
DB_CONNECT_OPTIONS = {
    "row_factory": dict_row,
    "connect_timeout": 10,
    "sslmode": "require",
    "prepare_threshold": None,
}

supabase_client = (
    create_client(SUPABASE_URL, SUPABASE_SERVER_KEY)
    if SUPABASE_URL and SUPABASE_SERVER_KEY
    else None
)

SECRET_PATH = os.path.join(BASE_DIR, ".secret_key")

UPLOAD_DIR = (
    "/tmp/campusvoice-uploads"
    if os.environ.get("VERCEL")
    else os.path.join(BASE_DIR, "uploads")
)

MB = 1024 * 1024

# Media size limits. Static/script.js has matching numbers so the page can
# warn before uploading, but these are the ones that actually count.
MAX_IMAGE_BYTES = 5 * MB        # the page shrinks photos to WebP first
MAX_VIDEO_BYTES = 30 * MB
MAX_LIVE_VIDEO_BYTES = 8 * MB   # the short clip that goes with a Live Photo
MAX_JSON_BYTES = 4 * MB         # every request except the media upload

CATEGORIES = (
    "Information Accessibility",
    "Quality & Condition",
    "Responsiveness",
)

# Roles a guest can pick on the public feedback form
GUEST_ROLES = ("Student", "Faculty", "Staff", "Guest")



def load_secret_key():
    # On Vercel, use the configured environment variable.
    env_key = os.environ.get("SECRET_KEY", "").strip()

    if env_key:
        return env_key

    # Never try to write a secret file in Vercel's read-only app directory.
    if os.environ.get("VERCEL"):
        raise RuntimeError(
            "SECRET_KEY is missing. Configure it in Vercel Environment Variables."
        )

    # Local development: reuse the existing secret file if available.
    if os.path.isfile(SECRET_PATH):
        with open(SECRET_PATH, "r", encoding="utf-8") as file:
            existing_key = file.read().strip()

        if existing_key:
            return existing_key

    # Generate and save a secret only for local development.
    generated_key = secrets.token_urlsafe(32)

    with open(SECRET_PATH, "w", encoding="utf-8") as file:
        file.write(generated_key)

    return generated_key



app = Flask(
    __name__,
    static_folder="static",
    static_url_path="/static",
    template_folder="templates",
)

app.config.update(
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    # Big enough for the largest video plus the upload envelope. Everything
    # that isn't the media upload is held to MAX_JSON_BYTES (see below).
    MAX_CONTENT_LENGTH=MAX_VIDEO_BYTES + MB,
    SEND_FILE_MAX_AGE_DEFAULT=0,
)


# =========================================================
# DATABASE
# =========================================================

_schema_initialized = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    student_number TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
    ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS reviews (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    image TEXT NOT NULL DEFAULT '',
    video TEXT NOT NULL DEFAULT '',
    is_live BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reactions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_id BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('like', 'dislike')),
    PRIMARY KEY (user_id, review_id)
);

CREATE TABLE IF NOT EXISTS replies (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    review_id BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    review_id BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guest_feedback (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    role TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'mobile', 'facebook')),
    contact_value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_number TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS video TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE guest_feedback ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS password_reset_requests (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    student_number TEXT NOT NULL,
    new_password_hash TEXT NOT NULL DEFAULT '',
    contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'mobile', 'facebook')),
    contact_value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
"""


def get_db():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is missing. Add your Supabase PostgreSQL connection string "
            "to the local .env file. Do not commit .env to Git."
        )

    ensure_schema()

    if "db" not in g:
        g.db = psycopg.connect(DATABASE_URL, **DB_CONNECT_OPTIONS)
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()



def ensure_schema():
    """Initialize once per function process, on the first database request.

    Running this at import time makes a bad deployment variable fail every
    Vercel invocation before Flask can return a response. Deferring it keeps
    the page available and still creates/updates the schema on a cold start
    once DATABASE_URL is valid.
    """
    global _schema_initialized

    if not _schema_initialized:
        init_db()
        _schema_initialized = True


def init_db():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is missing. Set it in .env before starting CampusVoice."
        )

    os.makedirs(UPLOAD_DIR, exist_ok=True)

    with psycopg.connect(
        DATABASE_URL,
        **DB_CONNECT_OPTIONS,
    ) as db:
        # Serialize schema initialization across application instances.
        db.execute("SELECT pg_advisory_xact_lock(20261024, 1)")

        for statement in SCHEMA.split(";"):
            if statement.strip():
                db.execute(statement)

        db.commit()


# =========================================================
# HELPERS
# =========================================================

def error(message, status=400):
    return jsonify(error=message), status


def json_body():
    """The JSON object sent by the page, or None."""

    data = request.get_json(silent=True)

    return data if isinstance(data, dict) else None


def clean(value, max_length):
    """Trimmed string, or None if it isn't text or is too long."""

    if not isinstance(value, str):
        return None

    value = value.strip()

    return value if len(value) <= max_length else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = None

        if "uid" in session:
            user = get_db().execute(
                "SELECT id, username, student_number, created_at, is_admin "
                "FROM users WHERE id = %s",
                (session["uid"],),
            ).fetchone()

        if user is None:
            session.clear()

            return error("Please log in first.", 401)

        g.user = user

        return view(*args, **kwargs)

    return wrapper


def user_json(user):
    return {
        "id": user["id"],
        "username": user["username"],
        "student_number": user["student_number"],
        "created_at": user["created_at"],
        "is_admin": bool(user["is_admin"]),
    }


def fetch_reviews(review_id=None):
    """All posts (newest first), or just one. Counts come from the database."""

    db = get_db()

    where = "WHERE r.id = %s" if review_id else ""

    args = (review_id,) if review_id else ()

    reviews = db.execute(
        f"""
        SELECT r.id, r.user_id, u.username, r.category, r.rating,
               r.text, r.image, r.video, r.is_live, r.created_at, r.status
          FROM reviews r
          JOIN users u ON u.id = r.user_id
          {where}
         ORDER BY r.created_at DESC, r.id DESC
        """,
        args,
    ).fetchall()

    # Who reacted how (one query for every post)
    likes = defaultdict(list)

    dislikes = defaultdict(int)

    mine = {}

    for row in db.execute(
        "SELECT x.review_id, x.kind, x.user_id, u.username "
        "FROM reactions x JOIN users u ON u.id = x.user_id "
        "ORDER BY x.user_id, x.review_id"
    ):
        if row["kind"] == "like":
            likes[row["review_id"]].append(row["username"])
        else:
            dislikes[row["review_id"]] += 1

        if row["user_id"] == g.user["id"]:
            mine[row["review_id"]] = row["kind"]

    replies = defaultdict(list)

    for row in db.execute(
        "SELECT p.review_id, u.username, p.text, p.created_at "
        "FROM replies p JOIN users u ON u.id = p.user_id "
        "ORDER BY p.id"
    ):
        replies[row["review_id"]].append({
            "username": row["username"],
            "text": row["text"],
            "date": row["created_at"],
        })

    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "username": row["username"],
            "category": row["category"],
            "rating": row["rating"],
            "text": row["text"],
            "image": row["image"],
            "video": row["video"],
            "live": bool(row["is_live"]),
            "date": row["created_at"],
            "status": row["status"],
            "likes": len(likes[row["id"]]),
            "liked_by": likes[row["id"]],
            "dislikes": dislikes[row["id"]],
            "my_reaction": mine.get(row["id"]),
            "replies": replies[row["id"]],
        }
        for row in reviews
    ]


@app.errorhandler(404)
def not_found(_error):
    return error("Not found.", 404)


@app.errorhandler(405)
def not_allowed(_error):
    return error("Method not allowed.", 405)


@app.errorhandler(413)
def too_large(_error):
    return error("That upload is too large.", 413)


@app.errorhandler(psycopg.OperationalError)
def database_unavailable(_error):
    # Keep a database configuration problem from becoming Vercel's generic
    # "function invocation failed" page. The original exception remains in
    # the function log, while the browser gets an actionable status.
    app.logger.exception("Supabase database connection failed")
    return error(
        "Database is unavailable. Configure DATABASE_URL with the exact "
        "Supabase Connect pooler URL, then redeploy.",
        503,
    )


@app.before_request
def limit_json_size():
    """Only the media upload may be big; everything else stays small."""

    if (
        request.endpoint != "upload_media"
        and (request.content_length or 0) > MAX_JSON_BYTES
    ):
        return error("That upload is too large.", 413)


# =========================================================
# PAGE
# =========================================================

@app.get("/")
def index():
    return render_template("index.html")


# =========================================================
# ACCOUNTS
# =========================================================

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{2,29}$")

# Exactly like 21-0123-456
STUDENT_NUMBER_PATTERN = re.compile(r"^[0-9]{2}-[0-9]{4}-[0-9]{3}$")


@app.post("/api/signup")
def signup():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    username = clean(data.get("username"), 30)

    student_number = clean(data.get("student_number"), 11)

    password = data.get("password")

    if not username or not student_number or not isinstance(password, str):
        return error("Please complete all fields.")

    if not USERNAME_PATTERN.match(username):
        return error(
            "Username must be 3-30 characters: letters, numbers, "
            "spaces, dots, dashes or underscores."
        )

    if not STUDENT_NUMBER_PATTERN.match(student_number):
        return error("Student number must look like 21-0123-456.")

    if not 6 <= len(password) <= 128:
        return error("Password must contain at least 6 characters.")

    db = get_db()

    try:
        db.execute(
            "INSERT INTO users (username, student_number, password_hash) "
            "VALUES (%s, %s, %s)",
            (username, student_number, generate_password_hash(password)),
        )
        db.commit()
    except psycopg.IntegrityError:
        return error("That username is already registered.", 409)

    return jsonify(ok=True), 201


@app.post("/api/login")
def login():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    username = clean(data.get("username"), 30)

    password = data.get("password")

    if not username or not isinstance(password, str):
        return error("Please enter your username and password.")

    user = get_db().execute(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(%s)",
        (username,),
    ).fetchone()

    if user is None or not check_password_hash(user["password_hash"], password):
        return error("Incorrect username or password.", 401)

    session.clear()

    session["uid"] = user["id"]

    session.permanent = True

    return jsonify(user=user_json(user))


@app.post("/api/logout")
def logout():
    session.clear()

    return jsonify(ok=True)


@app.get("/api/me")
@login_required
def me():
    return jsonify(user=user_json(g.user))


# =========================================================
# POSTS
# =========================================================

# Older posts keep their photo inside the database as a data URL.
# New photos and videos are uploaded as files instead (see below).
IMAGE_PATTERN = re.compile(
    r"^data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$"
)

# What an uploaded file may be: extension -> (kind, Content-Type it is sent as)
# .mov (iPhone / QuickTime) uses the same container as .mp4, and labelling it
# video/mp4 lets more browsers play it.
MEDIA_TYPES = {
    ".jpg": ("image", "image/jpeg"),
    ".png": ("image", "image/png"),
    ".gif": ("image", "image/gif"),
    ".webp": ("image", "image/webp"),
    ".mp4": ("video", "video/mp4"),
    ".mov": ("video", "video/mp4"),
    ".webm": ("video", "video/webm"),
}

# Stored files are named with 32 random hex characters plus an extension
MEDIA_NAME = re.compile(r"^[0-9a-f]{32}(\.[a-z0-9]{3,4})$")

# MP4-family brands that are really photos or audio, not video
NOT_VIDEO_BRANDS = (
    b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx",
    b"mif1", b"msf1", b"avif", b"avis",
    b"M4A ", b"M4B ", b"M4P ",
)


def sniff_media(head):
    """Work out what a file really is from its first bytes.

    The file name and the browser's Content-Type are easy to fake, so only
    the file's own signature is trusted. Returns the extension to store it
    under (a key of MEDIA_TYPES), or None if it is not an allowed type.
    """

    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"

    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"

    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"

    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"

    # WebM and Matroska share a header; the DocType says which one it is
    if head[:4] == b"\x1a\x45\xdf\xa3" and b"webm" in head:
        return ".webm"

    if head[4:8] == b"ftyp":
        brand = head[8:12]

        if brand in NOT_VIDEO_BRANDS:
            return None

        return ".mov" if brand == b"qt  " else ".mp4"

    return None


def stored_media_info(url, kind):
    """Validate a media URL and return its name, size and local path."""

    if not isinstance(url, str) or not url.startswith("/media/"):
        return None

    name = url[len("/media/"):]
    match = MEDIA_NAME.fullmatch(name)

    if not match or match.group(1) not in MEDIA_TYPES:
        return None

    if MEDIA_TYPES[match.group(1)][0] != kind:
        return None

    # Support existing files from local development.
    local_path = os.path.join(UPLOAD_DIR, name)

    if os.path.isfile(local_path):
        return {
            "name": name,
            "size": os.path.getsize(local_path),
            "local_path": local_path,
        }

    # Otherwise, verify that the object exists in Supabase Storage.
    if supabase_client is None:
        return None

    try:
        info = supabase_client.storage.from_(
            SUPABASE_BUCKET
        ).info(name)

        metadata = info.get("metadata") or {}
        raw_size = info.get("size") or metadata.get("size")

        if raw_size is None:
            raw_size = metadata.get("contentLength")

        if raw_size is None:
            return None

        return {
            "name": name,
            "size": int(raw_size),
            "local_path": None,
        }

    except Exception:
        return None


@app.post("/api/media")
@login_required
def upload_media():
    """Validate and upload a photo or video to Supabase Storage."""

    if request.headers.get("X-CampusVoice-Upload") != "1":
        return error("Invalid request.")

    # Without Supabase, local development saves files to the uploads
    # folder. On Vercel that folder is wiped, so it stays an error there.
    use_local_storage = supabase_client is None and not os.environ.get("VERCEL")

    if supabase_client is None and not use_local_storage:
        return error("Media storage is not configured.", 503)

    upload = request.files.get("file")

    if upload is None:
        return error("Please choose a file to upload.")

    head = upload.stream.read(64)
    upload.stream.seek(0, os.SEEK_END)
    size = upload.stream.tell()
    upload.stream.seek(0)

    extension = sniff_media(head)

    if extension is None:
        return error(
            "Unsupported file. Please use a JPG, PNG, WebP or GIF photo, "
            "or an MP4, WebM or MOV video."
        )

    kind, mime = MEDIA_TYPES[extension]
    limit = MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES

    if size == 0:
        return error("That file is empty.")

    if size > limit:
        return error(
            f"That {kind} is too large (the limit is {limit // MB} MB).",
            413,
        )

    name = secrets.token_hex(16) + extension
    contents = upload.stream.read()

    if use_local_storage:

        os.makedirs(UPLOAD_DIR, exist_ok=True)

        with open(os.path.join(UPLOAD_DIR, name), "wb") as file:
            file.write(contents)

        return jsonify(
            url="/media/" + name,
            kind=kind,
            mime=mime,
            size=size,
        ), 201

    try:
        supabase_client.storage.from_(SUPABASE_BUCKET).upload(
            path=name,
            file=contents,
            file_options={
                "content-type": mime,
                "cache-control": "3600",
                "upsert": "false",
            },
        )
    except Exception:
        app.logger.exception("Supabase media upload failed")
        return error("The media upload failed. Please try again.", 502)

    return jsonify(
        url="/media/" + name,
        kind=kind,
        mime=mime,
        size=size,
    ), 201


@app.get("/media/<name>")
@login_required
def serve_media(name):
    """Serve existing local media or redirect to a temporary signed URL."""

    match = MEDIA_NAME.fullmatch(name)

    if not match or match.group(1) not in MEDIA_TYPES:
        return error("Not found.", 404)

    mime = MEDIA_TYPES[match.group(1)][1]
    local_path = os.path.join(UPLOAD_DIR, name)

    # Keep existing local development files accessible.
    if os.path.isfile(local_path):
        response = send_from_directory(
            UPLOAD_DIR,
            name,
            mimetype=mime,
            conditional=True,
            max_age=0,
        )
    else:
        if supabase_client is None:
            return error("Media storage is not configured.", 503)

        try:
            result = supabase_client.storage.from_(
                SUPABASE_BUCKET
            ).create_signed_url(name, 3600)

            signed_url = (
                result.get("signedURL")
                or result.get("signedUrl")
                or result.get("signed_url")
            )

            if not signed_url:
                return error("Not found.", 404)

            if signed_url.startswith("https://") or signed_url.startswith("http://"):
                target_url = signed_url
            elif signed_url.startswith("/storage/v1/"):
                target_url = SUPABASE_URL + signed_url
            else:
                target_url = (
                    SUPABASE_URL
                    + "/storage/v1"
                    + (
                        signed_url
                        if signed_url.startswith("/")
                        else "/" + signed_url
                    )
                )

            response = redirect(target_url, code=302)

        except Exception:
            app.logger.exception("Supabase media retrieval failed")
            return error("Unable to retrieve this media right now.", 502)

    response.cache_control.public = False
    response.cache_control.private = True
    response.cache_control.no_store = True
    response.headers["X-Content-Type-Options"] = "nosniff"

    return response


@app.get("/api/reviews")
@login_required
def list_reviews():
    return jsonify(reviews=fetch_reviews())


@app.post("/api/reviews")
@login_required
def create_review():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    category = data.get("category")

    rating = data.get("rating")

    text = clean(data.get("text"), 2000)

    image = data.get("image") or ""

    video = data.get("video") or ""

    live = data.get("live") is True

    if category not in CATEGORIES:
        return error("Please choose a feedback area.")

    if (
        not isinstance(rating, int)
        or isinstance(rating, bool)
        or not 1 <= rating <= 5
    ):
        return error("Please select a rating from 1 to 5 stars.")

    if not text:
        return error("Please write your feedback (up to 2000 characters).")

    if image:
        if not isinstance(image, str):
            return error("Please choose a valid photo.")

        if image.startswith("/media/"):
            # A photo uploaded through /api/media
            if stored_media_info(image, "image") is None:
                return error("Please choose a valid photo.")

        elif len(image) > 3_000_000 or not IMAGE_PATTERN.match(image):
            # An inline photo, as older versions of the page sent
            return error("Please choose a valid image smaller than 2MB.")

        video_info = None

    if video:
        video_info = stored_media_info(video, "video")

        if video_info is None:
            return error("Please choose a valid video.")

    if live:
        if not image or not video_info:
            return error("A Live Photo needs both a photo and its short video.")

        if video_info["size"] > MAX_LIVE_VIDEO_BYTES:
            return error(
                "The Live Photo video is too large "
                f"(the limit is {MAX_LIVE_VIDEO_BYTES // MB} MB)."
            )


    db = get_db()

    db.execute(
        "INSERT INTO reviews "
        "(user_id, category, rating, text, image, video, is_live) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (g.user["id"], category, rating, text, image, video, live),
    )

    db.commit()

    return jsonify(ok=True), 201


def review_exists(review_id):
    return get_db().execute(
        "SELECT 1 FROM reviews WHERE id = %s",
        (review_id,),
    ).fetchone() is not None


@app.post("/api/reviews/<int:review_id>/react")
@login_required
def react(review_id):
    """Like / dislike a post. Sending the same one again undoes it."""

    data = json_body()

    kind = data.get("kind") if data else None

    if kind not in ("like", "dislike"):
        return error("Invalid reaction.")

    if not review_exists(review_id):
        return error("That post no longer exists.", 404)

    db = get_db()

    existing = db.execute(
        "SELECT kind FROM reactions WHERE user_id = %s AND review_id = %s",
        (g.user["id"], review_id),
    ).fetchone()

    if existing and existing["kind"] == kind:
        db.execute(
            "DELETE FROM reactions WHERE user_id = %s AND review_id = %s",
            (g.user["id"], review_id),
        )
    elif existing:
        db.execute(
            "UPDATE reactions SET kind = %s "
            "WHERE user_id = %s AND review_id = %s",
            (kind, g.user["id"], review_id),
        )
    else:
        db.execute(
            "INSERT INTO reactions (user_id, review_id, kind) "
            "VALUES (%s, %s, %s)",
            (g.user["id"], review_id, kind),
        )

    db.commit()

    return jsonify(review=fetch_reviews(review_id)[0])


@app.post("/api/reviews/<int:review_id>/reply")
@login_required
def reply(review_id):
    data = json_body()

    text = clean(data.get("text"), 1000) if data else None

    if not text:
        return error("Please write a reply (up to 1000 characters).")

    if not review_exists(review_id):
        return error("That post no longer exists.", 404)

    db = get_db()

    db.execute(
        "INSERT INTO replies (review_id, user_id, text) VALUES (%s, %s, %s)",
        (review_id, g.user["id"], text),
    )

    db.commit()

    return jsonify(ok=True), 201


@app.post("/api/reviews/<int:review_id>/report")
@login_required
def report(review_id):
    data = json_body()

    reason = clean(data.get("reason"), 500) if data else None

    if not reason:
        return error("Please give a reason (up to 500 characters).")

    if not review_exists(review_id):
        return error("That post no longer exists.", 404)

    db = get_db()

    db.execute(
        "INSERT INTO reports (review_id, user_id, reason) VALUES (%s, %s, %s)",
        (review_id, g.user["id"], reason),
    )

    db.commit()

    return jsonify(ok=True), 201

# =========================================================
# GUEST FEEDBACK (public, no login needed)
# =========================================================

GUEST_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

GUEST_MOBILE = re.compile(r"^(09\d{9}|\+639\d{9})$")


@app.post("/api/guest-feedback")
def guest_feedback():
    data = json_body()

    if data is None:
        return error("Invalid request.")

    role = data.get("role")

    message = clean(data.get("message"), 2000)

    contact_type = data.get("contact_type")

    contact_value = clean(data.get("contact_value"), 254)

    if role not in GUEST_ROLES:
        return error(
            "Please select your role: Student, Faculty, Staff, or Guest."
        )

    if not message or len(message) < 10:
        return error("Please write at least 10 characters.")

    if contact_type not in ("email", "mobile", "facebook") or not contact_value:
        return error("Please give a valid way to contact you.")

    if contact_type == "email" and not GUEST_EMAIL.match(contact_value):
        return error("Please enter a valid email address.")

    if contact_type == "mobile" and not GUEST_MOBILE.match(contact_value):
        return error("Please enter a valid PH mobile number.")

    db = get_db()

    db.execute(
        "INSERT INTO guest_feedback "
        "(role, message, contact_type, contact_value) "
        "VALUES (%s, %s, %s, %s)",
        (role, message, contact_type, contact_value),
    )

    db.commit()

    return jsonify(ok=True), 201


# =========================================================
# ADMIN WORKLOAD TRACKING
# =========================================================

def admin_required(view):
    @login_required
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not g.user["is_admin"]:
            return error("Admins only.", 403)

        return view(*args, **kwargs)

    return wrapper


@app.get("/api/admin/workload")
@admin_required
def admin_workload():
    db = get_db()

    posts = [
        dict(row) for row in db.execute(
            "SELECT r.id, u.username, r.category, r.rating, r.text, "
            "r.status, r.created_at AS date "
            "FROM reviews r JOIN users u ON u.id = r.user_id "
            "ORDER BY r.created_at DESC, r.id DESC"
        )
    ]

    guests = [
        dict(row) for row in db.execute(
            "SELECT id, role, message, contact_type, contact_value, status, "
            "created_at AS date FROM guest_feedback "
            "ORDER BY created_at DESC, id DESC"
        )
    ]

    items = posts + guests

    pending = sum(1 for item in items if item["status"] == "pending")

    return jsonify(
        counts={
            "pending": pending,
            "completed": len(items) - pending,
            "total": len(items),
        },
        posts=posts,
        guests=guests,
    )


def set_status(table, item_id):
    data = json_body()

    status = data.get("status") if data else None

    if status not in ("pending", "completed"):
        return error("Invalid status.")

    db = get_db()

    cursor = db.execute(
        f"UPDATE {table} SET status = %s WHERE id = %s",
        (status, item_id),
    )

    db.commit()

    if cursor.rowcount == 0:
        return error("Not found.", 404)

    return jsonify(ok=True)


@app.post("/api/admin/posts/<int:item_id>/status")
@admin_required
def admin_post_status(item_id):
    return set_status("reviews", item_id)


@app.post("/api/admin/guests/<int:item_id>/status")
@admin_required
def admin_guest_status(item_id):
    return set_status("guest_feedback", item_id)
# =========================================================
# FORGOT PASSWORD
# There is no email service, so the student sends a request:
# student number, the new password they want, and how to reach
# them. An admin contacts them to verify it's really them, then
# approves (the new password takes effect) or rejects it.
# Only a hash of the requested password is ever stored.
# =========================================================

@app.post("/api/password-reset/request")
def password_reset_request():

    data = json_body()

    if data is None:
        return error("Invalid request.")

    student_number = clean(data.get("student_number"), 11)
    password = data.get("password")
    contact_type = data.get("contact_type")
    contact_value = clean(data.get("contact_value"), 254)

    if not student_number or not STUDENT_NUMBER_PATTERN.match(student_number):
        return error("Please enter your student number like 21-0123-456.")

    if not isinstance(password, str) or not 6 <= len(password) <= 128:
        return error("Password must contain at least 6 characters.")

    if contact_type not in ("email", "mobile", "facebook") or not contact_value:
        return error("Please give a valid way to contact you.")

    if contact_type == "email" and not GUEST_EMAIL.match(contact_value):
        return error("Please enter a valid email address.")

    if contact_type == "mobile" and not GUEST_MOBILE.match(contact_value):
        return error("Please enter a valid PH mobile number.")

    db = get_db()

    user = db.execute(
        "SELECT id FROM users WHERE student_number = %s", (student_number,)
    ).fetchone()

    # A newer request replaces an older pending one for the same number
    db.execute(
        "DELETE FROM password_reset_requests "
        "WHERE student_number = %s AND status = 'pending'",
        (student_number,),
    )

    # Saved even when no account matches, so the admin can reply, and so
    # the answer doesn't reveal which student numbers have accounts.
    db.execute(
        "INSERT INTO password_reset_requests "
        "(user_id, student_number, new_password_hash, contact_type, contact_value) "
        "VALUES (%s, %s, %s, %s, %s)",
        (
            user["id"] if user else None,
            student_number,
            generate_password_hash(password),
            contact_type,
            contact_value,
        ),
    )
    db.commit()

    return jsonify(ok=True), 201


@app.get("/api/admin/reset-requests")
@admin_required
def admin_reset_requests():

    rows = get_db().execute(
        "SELECT r.id, r.student_number, r.contact_type, r.contact_value, "
        "r.created_at AS requested, u.username "
        "FROM password_reset_requests r LEFT JOIN users u ON u.id = r.user_id "
        "WHERE r.status = 'pending' ORDER BY r.created_at DESC"
    ).fetchall()

    return jsonify(requests=[dict(row) for row in rows])


@app.post("/api/admin/reset-requests/<int:request_id>/approve")
@admin_required
def admin_reset_approve(request_id):

    db = get_db()

    row = db.execute(
        "SELECT user_id, new_password_hash FROM password_reset_requests "
        "WHERE id = %s AND status = 'pending'",
        (request_id,),
    ).fetchone()

    if row is None:
        return error("That request was already handled.", 404)

    if row["user_id"] is None:
        return error("No account has this student number, so there's no password to change.")

    db.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        (row["new_password_hash"], row["user_id"]),
    )
    db.execute(
        "UPDATE password_reset_requests SET status = 'approved', "
        "new_password_hash = '', resolved_at = NOW() WHERE id = %s",
        (request_id,),
    )
    db.commit()

    return jsonify(ok=True)


@app.post("/api/admin/reset-requests/<int:request_id>/reject")
@admin_required
def admin_reset_reject(request_id):

    db = get_db()

    cursor = db.execute(
        "UPDATE password_reset_requests SET status = 'rejected', "
        "new_password_hash = '', resolved_at = NOW() "
        "WHERE id = %s AND status = 'pending'",
        (request_id,),
    )
    db.commit()

    if cursor.rowcount == 0:
        return error("That request was already handled.", 404)

    return jsonify(ok=True)


# =========================================================
# ADMIN SYSTEM STATUS
# Explains hosting problems (Vercel / Supabase / code) without
# needing access to either dashboard. Never returns a key or
# password, only whether each one is set and looks right.
# =========================================================

def describe_key(key):
    """Which kind of Supabase key this is, without revealing it."""

    if not key:
        return "missing"

    if key.startswith("sb_secret_"):
        return "secret"

    if key.startswith("sb_publishable_"):
        return "publishable"

    # Legacy keys are JWTs; the payload says which role they grant
    try:
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        role = json.loads(base64.urlsafe_b64decode(payload)).get("role")
    except Exception:
        return "unrecognised"

    return {"service_role": "secret", "anon": "publishable"}.get(role, "unrecognised")


def check(label, state, detail, hint=""):
    return {"label": label, "state": state, "detail": detail, "hint": hint}


def code_version():
    """The deployed commit on Vercel, or the local checkout's commit."""

    sha = os.environ.get("VERCEL_GIT_COMMIT_SHA", "")
    branch = os.environ.get("VERCEL_GIT_COMMIT_REF", "")

    if not sha:
        try:
            git_dir = os.path.join(BASE_DIR, ".git")
            with open(os.path.join(git_dir, "HEAD"), encoding="utf-8") as file:
                head = file.read().strip()
            if head.startswith("ref: "):
                ref = head[5:]
                branch = ref.rsplit("/", 1)[-1]
                with open(os.path.join(git_dir, ref), encoding="utf-8") as file:
                    sha = file.read().strip()
            else:
                sha = head
        except OSError:
            pass

    return sha[:7], branch


@app.get("/api/admin/status")
@admin_required
def admin_status():

    checks = []
    on_vercel = bool(os.environ.get("VERCEL"))
    sha, branch = code_version()

    # ---------- Where and what is running ----------

    if on_vercel:
        where = "Vercel (" + os.environ.get("VERCEL_ENV", "unknown") + ")"
    else:
        where = "Local computer"

    checks.append(check(
        "Hosting",
        "ok",
        where,
    ))

    checks.append(check(
        "Code version",
        "ok" if sha else "warn",
        (sha + (" on " + branch if branch else "")) if sha else "Unknown",
        "" if sha else "Can't tell which commit is running. On Vercel, check the deployment's commit.",
    ))

    checks.append(check(
        "Secret key",
        "ok" if os.environ.get("SECRET_KEY") else ("fail" if on_vercel else "ok"),
        "SECRET_KEY is set" if os.environ.get("SECRET_KEY") else "Using a local key file",
        "Set SECRET_KEY in Vercel's environment variables, or logins break between servers."
        if on_vercel and not os.environ.get("SECRET_KEY") else "",
    ))

    # ---------- Database ----------

    db = get_db()

    try:
        version = db.execute("SHOW server_version").fetchone()["server_version"]
        counts = db.execute(
            "SELECT "
            "(SELECT COUNT(*) FROM users) AS users, "
            "(SELECT COUNT(*) FROM reviews) AS posts, "
            "(SELECT COUNT(*) FROM reviews WHERE image <> '' OR video <> '') AS media_posts"
        ).fetchone()
        checks.append(check(
            "Database",
            "ok",
            f"PostgreSQL {version} · {counts['users']} users · {counts['posts']} posts "
            f"({counts['media_posts']} with media)",
        ))
    except Exception as exc:
        db.rollback()
        checks.append(check(
            "Database",
            "fail",
            type(exc).__name__,
            "Check DATABASE_URL.",
        ))
        counts = None

    # ---------- Supabase Storage settings ----------

    key_kind = describe_key(SUPABASE_SERVICE_ROLE_KEY)

    if not SUPABASE_URL:
        checks.append(check(
            "Supabase URL",
            "fail" if on_vercel else "warn",
            "Not set",
            "Set SUPABASE_URL on Vercel." if on_vercel
            else "Not needed locally: uploads are saved in the uploads folder.",
        ))
    else:
        host = SUPABASE_URL.split("//")[-1].split("/")[0]
        bad_path = "/" in SUPABASE_URL.split("//")[-1]
        checks.append(check(
            "Supabase URL",
            "warn" if bad_path else "ok",
            host,
            "SUPABASE_URL should be just https://<project>.supabase.co with nothing after it."
            if bad_path else "",
        ))

    key_states = {
        "secret": ("ok", "Secret (service role) key"),
        "publishable": ("fail", "Publishable / anon key"),
        "missing": ("fail" if on_vercel else "warn", "Not set"),
        "unrecognised": ("warn", "Unrecognised key format"),
    }
    state, detail = key_states[key_kind]
    checks.append(check(
        "Supabase key",
        state,
        detail,
        {
            "publishable": "SUPABASE_SERVICE_ROLE_KEY must be the secret / service_role key. "
                           "The anon key can't upload or sign links to a private bucket.",
            "missing": "Set SUPABASE_SERVICE_ROLE_KEY on Vercel." if on_vercel
                       else "Not needed locally: uploads are saved in the uploads folder.",
            "unrecognised": "Copy the key again from Supabase → Project Settings → API Keys.",
        }.get(key_kind, ""),
    ))

    # ---------- Bucket ----------

    if supabase_client is not None:
        try:
            bucket = supabase_client.storage.get_bucket(SUPABASE_BUCKET)
            public = getattr(bucket, "public", None)
            checks.append(check(
                "Storage bucket",
                "ok",
                f"“{SUPABASE_BUCKET}” found ({'public' if public else 'private'})",
            ))
        except Exception as exc:
            checks.append(check(
                "Storage bucket",
                "fail",
                f"Can't open “{SUPABASE_BUCKET}”: {type(exc).__name__}",
                f"Create a bucket named exactly {SUPABASE_BUCKET} in Supabase Storage, "
                "or check the key above.",
            ))
    elif not on_vercel:
        checks.append(check(
            "Storage bucket",
            "ok",
            "Local uploads folder",
        ))

    # ---------- Recent media: do the files still exist? ----------

    if counts:
        rows = db.execute(
            "SELECT id, image, video FROM reviews "
            "WHERE image LIKE '/media/%%' OR video LIKE '/media/%%' "
            "ORDER BY created_at DESC LIMIT 15"
        ).fetchall()

        missing = []
        sample = None

        for row in rows:
            for url, kind in ((row["image"], "image"), (row["video"], "video")):
                if url.startswith("/media/"):
                    info = stored_media_info(url, kind)
                    if info is None:
                        missing.append(row["id"])
                    elif sample is None and info["local_path"] is None:
                        sample = info["name"]

        checked = len(rows)

        if checked == 0:
            checks.append(check(
                "Recent media files",
                "ok",
                "No posts with uploaded media yet",
            ))
        else:
            checks.append(check(
                "Recent media files",
                "fail" if missing else "ok",
                f"{checked - len(set(missing))} of {checked} recent media posts have their file"
                + (f" · missing on posts {', '.join(map(str, sorted(set(missing))))}" if missing else ""),
                "Those files no longer exist. Posts made before Supabase Storage was added "
                "were saved to Vercel's temporary disk, which is wiped; those can't be recovered."
                if missing else "",
            ))

        # ---------- Can a browser actually load one? ----------

        if sample:
            try:
                result = supabase_client.storage.from_(SUPABASE_BUCKET).create_signed_url(sample, 60)
                signed = (
                    result.get("signedURL") or result.get("signedUrl") or result.get("signed_url") or ""
                )
                if signed.startswith("/"):
                    signed = SUPABASE_URL + ("" if signed.startswith("/storage/v1/") else "/storage/v1") + signed
                with urllib.request.urlopen(
                    urllib.request.Request(signed, headers={"Range": "bytes=0-0"}),
                    timeout=8,
                ) as response:
                    status = response.status
                checks.append(check(
                    "Media link test",
                    "ok",
                    f"Signed link for a recent file returned HTTP {status}",
                ))
            except urllib.error.HTTPError as exc:
                checks.append(check(
                    "Media link test",
                    "fail",
                    f"Supabase returned HTTP {exc.code} for a signed link",
                    "The file exists but Supabase refused the link. Check the key and the bucket's policies.",
                ))
            except Exception as exc:
                checks.append(check(
                    "Media link test",
                    "fail",
                    f"Couldn't create or open a signed link: {type(exc).__name__}",
                    "Check SUPABASE_URL and the key.",
                ))

    # ---------- Vercel upload size ----------

    if on_vercel:
        checks.append(check(
            "Upload size limit",
            "warn",
            f"Vercel rejects uploads over 4.5 MB; the app allows videos up to {MAX_VIDEO_BYTES // MB} MB",
            "Large videos will fail to upload on Vercel. Photos are compressed and usually fit.",
        ))

    worst = (
        "fail" if any(c["state"] == "fail" for c in checks)
        else "warn" if any(c["state"] == "warn" for c in checks)
        else "ok"
    )

    return jsonify(overall=worst, checks=checks)

if __name__ == "__main__":
    # Local startup should still fail early when its .env file is invalid.
    init_db()
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=os.environ.get("CAMPUSVOICE_DEBUG") == "1",
    )
