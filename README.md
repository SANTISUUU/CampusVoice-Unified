# CampusVoice — Unified Flask Codebase

This is the consolidated Flask version, using Supabase PostgreSQL and Storage for deployment on Vercel.

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
4. Copy `.env.example` to `.env`, then set `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SECRET_KEY`
5. Run: `python app.py`
6. Open `http://127.0.0.1:5000`

For `DATABASE_URL`, open the correct Supabase project, choose **Connect → Transaction pooler**, and copy the entire value. Replace only the password placeholder, URL-encoding reserved password characters such as `#`, `?`, `&`, and spaces. Do not construct an `aws-…pooler.supabase.com` host from the region: Supabase assigns the pooler cluster.

## Important deployment note

In Vercel, configure the same four variables under **Project Settings → Environment Variables** for Production (and Preview if you use previews), then redeploy. Use the exact same current connection URL from Supabase—not an older URL copied from another project or a manually typed pooler host. `SUPABASE_SECRET_KEY` is server-only and must never be put in frontend JavaScript. The app uses SSL and disables prepared statements, which makes it compatible with the transaction pooler.


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
