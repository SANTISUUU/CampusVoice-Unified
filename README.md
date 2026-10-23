# CampusVoice — Unified Flask Codebase

This is the consolidated local Flask version, combining the main CampusVoice app with the media upload/compression implementation. It is **not yet converted to Vercel/Supabase**; that is the next phase.

## Included features

- Flask authentication and session handling
- Student feedback posts and ratings
- Like/dislike reactions with one reaction per user per post
- Replies and reports
- Guest feedback with role selection
- Admin workload and pending/completed status tracking
- Image/video uploads and client-side media preparation
- WebP image compression/fallback handling and Live Photo-style media flow where supported
- Responsive CSS layout

## Run locally

1. Install Python 3.10+ (recommended)
2. Create and activate a virtual environment
3. Install dependencies: `pip install -r requirements.txt`
4. Set `SECRET_KEY` in your environment (recommended) or let the local development key file be generated automatically
5. Run: `python app.py`
6. Open `http://127.0.0.1:5000`

The local SQLite database and uploaded files are created on disk. Do not rely on these local folders for serverless production hosting; the Vercel/Supabase conversion should replace these with persistent Supabase database and storage services.

## Important deployment note

This folder is the merge checkpoint. Before deploying, migrate SQLite queries/schema to Supabase/Postgres, move uploaded media to Supabase Storage, configure production secrets, and add Vercel's Python/Flask entry configuration.


## Verification checklist

Run these checks locally after installing requirements:

- Sign up a test user and log in; confirm invalid credentials are rejected.
- Open `/api/me` while logged in and after logging out; confirm protected routes reject unauthenticated requests.
- Create a post, like it, verify the count and liker username, then unlike it and verify both disappear/update.
- Sign in as a second user and confirm the same user cannot create duplicate reactions; confirm switching like/dislike updates the single reaction.
- Submit guest feedback using Student, Faculty, Staff, and Guest; verify the chosen role is saved and invalid roles are rejected.
- Verify non-admin users receive 403 from `/api/admin/workload`; verify admins can see pending/completed counts and update statuses.
- Upload a valid image/video and confirm it renders/plays; try invalid extensions, invalid file signatures, and oversized files and confirm they are rejected.
- Check the UI at 375px, 768px, and 1280px viewport widths.

The code was statically checked in the merge environment, but Flask could not be installed there because package-network access was unavailable. Therefore the live Flask end-to-end checklist still needs to be run on a machine with the project dependencies installed.
