# Cloud Storage Migration — Persisting Audio Uploads

**Project:** Harmonia — Music Library & Audio Analysis Platform
**Component:** FastAPI backend (`Harmonia-web/backend`)
**Objective:** Migrate the audio upload pipeline from Render's ephemeral local disk to a permanent cloud object store (Supabase Storage or AWS S3).
**Status:** Engineering blueprint / reference appendix (not yet implemented).

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Prerequisites & Setup](#2-prerequisites--setup)
3. [Library Dependencies](#3-library-dependencies)
4. [FastAPI Code Blueprint](#4-fastapi-code-blueprint)
5. [Database Schema Mapping](#5-database-schema-mapping)
6. [Streaming Endpoint Updates](#6-streaming-endpoint-updates)
7. [Migrating Existing Rows](#7-migrating-existing-rows)
8. [Testing & Rollback](#8-testing--rollback)
9. [Appendix — Affected Files Checklist](#appendix--affected-files-checklist)

---

## 1. Architectural Overview

### 1.1 The problem: ephemeral container storage

The current pipeline writes uploaded audio to a local folder:

```python
# backend/api/tracks.py  (current)
UPLOAD_DIR = "uploads"
file_path = os.path.join(UPLOAD_DIR, filename)
with open(file_path, "wb") as buffer:
    shutil.copyfileobj(file.file, buffer)
```

The relative path (e.g. `uploads/3f2a…c1.mp3`) is then stored in the `tracks.file_path`
column, and `GET /api/tracks/{id}/audio` serves the bytes with `FileResponse`.

On Render's free tier (and most container PaaS platforms) the filesystem is
**ephemeral**. The container's writable layer is discarded and rebuilt on:

- every deploy / new build,
- every manual or automatic restart,
- every cold start after the instance is spun down for inactivity,
- any horizontal scale event (a new replica starts with an empty disk).

When that happens, everything under `uploads/` is wiped, **but the PostgreSQL
database (hosted separately on Neon) survives**. The result is exactly the failure
observed in production:

```
GET /api/tracks/1/audio  →  404  {"detail":"Audio file not found"}
```

The database row still exists (title, artist, BPM, key, …), but
`os.path.exists(track.file_path)` is now `False`, so the audio route 404s and the
client reports `NotSupportedError: Failed to load because no supported source was found`.

### 1.2 The solution: external object storage

The fix is to **decouple binary assets from the application container**. Audio files
are written to a dedicated, durable object store (Supabase Storage or AWS S3) whose
lifecycle is independent of the FastAPI container. The database then stores a stable,
absolute public URL instead of a disposable local path.

```
                         BEFORE (ephemeral)                         AFTER (durable)

  ┌─────────────┐  upload   ┌──────────────────┐        ┌─────────────┐  upload   ┌──────────────────┐
  │ Mobile/Web  │ ────────► │ FastAPI container │        │ Mobile/Web  │ ────────► │ FastAPI container │
  └─────────────┘           │  ./uploads/*.mp3 │        └─────────────┘           │   (stateless)     │
        ▲                    │  (wiped on deploy)│              ▲                   └────────┬──────────┘
        │  GET /audio        └──────────────────┘              │                            │ put object
        │  (FileResponse)             ▲                        │  stream from CDN URL       ▼
        └─────────────────────────────┘                       │                   ┌──────────────────┐
                                                               └───────────────────│  Object store /  │
                                                                  (direct, or 302) │  CDN (S3/Supabase)│
                                                                                    └──────────────────┘
```

Benefits:

- **Persistence:** files survive deploys, restarts, cold starts, and scaling.
- **Statelessness:** the API container holds no durable state, which is a prerequisite
  for safe horizontal scaling and zero‑downtime deploys.
- **Performance & cost:** assets are served by a CDN edge, offloading bandwidth and
  CPU from the API container (which on the free tier is the scarcest resource).
- **Separation of concerns:** the database stores *metadata + a pointer*; the object
  store owns the *bytes*.

### 1.3 One critical design consequence

Several server-side routines currently consume `file_path` as a **local filesystem
path**. They cannot read an `https://` URL directly:

| Routine | File | Why it needs a local file |
|---|---|---|
| `analyze_audio()` | `audio/analyzer.py` | `librosa.load(path)` requires a path or file-like object |
| `extract_artwork()` | `audio/artwork.py` | `mutagen.File(path)` requires a path |
| `/{id}/spectrum` | `api/analysis.py` | `librosa.load(track.file_path)` |
| `run_analysis()` (background task) | `api/analysis.py` | calls `analyze_audio()` |

**Therefore the migration must introduce a "materialise to a temp file" step** for
any code path that performs DSP/metadata work. The pattern: download the object to a
short-lived `tempfile`, process it, then delete it. This is covered in
[§4.4](#44-make-the-background-analysis-task-cloud-aware).

---

## 2. Prerequisites & Setup

Two fully worked options are provided. **Supabase Storage is the recommended default**
for this project (generous free tier, S3-compatible, trivial public URLs, and it pairs
naturally with the existing Postgres-centric stack). AWS S3 is documented as the
enterprise-grade alternative.

### 2.1 Option A — Supabase Storage (recommended)

1. **Create a project** at <https://supabase.com> (or reuse an existing one).
2. **Create a bucket:** Dashboard → *Storage* → *New bucket*.
   - Name: `harmonia-audio`
   - **Public bucket: ON** (enables CDN-style public read URLs for streaming).
   - (Optional) a second bucket `harmonia-artwork`, or reuse the same bucket with an
     `artwork/` prefix.
3. **Read policy.** A public bucket already exposes objects at a stable public URL:
   ```
   https://<project-ref>.supabase.co/storage/v1/object/public/harmonia-audio/<key>
   ```
   If you prefer a **private** bucket, leave it private and generate short-lived
   *signed URLs* on demand (see [§6.3](#63-private-bucket-variant-signed-urls)).
4. **Row-Level Security / write policy.** Server-side writes use the **service-role
   key**, which bypasses RLS — so no extra insert policy is required for the backend.
   If you ever upload from a browser with the *anon* key, add an explicit
   `INSERT`/`SELECT` storage policy.
5. **Collect credentials:** Dashboard → *Project Settings* → *API*.

```bash
# .env  (Render → Environment, and your local .env — NEVER commit secrets)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-secret-key>     # server-only, full access
SUPABASE_BUCKET=harmonia-audio
```

> ⚠️ The **service-role key is a full-access secret**. Store it only as a backend
> environment variable. Never ship it to the mobile/web client and never commit it.

### 2.2 Option B — AWS S3 (+ optional CloudFront CDN)

1. **Create a bucket** in the S3 console, e.g. `harmonia-audio-prod`, in a region close
   to your users (e.g. `eu-west-1`).
2. **Public read for streaming** (simplest). Disable "Block all public access" for this
   bucket and attach a read-only bucket policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Sid": "PublicReadGetObject",
       "Effect": "Allow",
       "Principal": "*",
       "Action": "s3:GetObject",
       "Resource": "arn:aws:s3:::harmonia-audio-prod/*"
     }]
   }
   ```
   For production, prefer a **private bucket fronted by CloudFront** with an Origin
   Access Control, and serve via the CloudFront domain.
3. **CORS** (so a browser `<audio>` element can stream cross-origin):
   ```json
   [{
     "AllowedOrigins": ["*"],
     "AllowedMethods": ["GET", "HEAD"],
     "AllowedHeaders": ["*"],
     "ExposeHeaders": ["Content-Range", "Accept-Ranges", "Content-Length"],
     "MaxAgeSeconds": 3000
   }]
   ```
   > Range headers must be exposed so browsers can seek within the audio stream.
4. **Create an IAM user** with programmatic access scoped to `s3:PutObject`,
   `s3:GetObject`, `s3:DeleteObject` on the bucket ARN.

```bash
# .env
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
AWS_REGION=eu-west-1
S3_BUCKET=harmonia-audio-prod
# Optional: serve through a CDN domain instead of the raw S3 endpoint
S3_PUBLIC_BASE_URL=https://d111111abcdef8.cloudfront.net
```

---

## 3. Library Dependencies

Add the client for whichever backend you chose. Pin versions in `requirements.txt`.

```bash
# Supabase (Option A)
pip install "supabase>=2.4,<3"

# AWS S3 (Option B)
pip install "boto3>=1.34,<2"

# Used by the analysis task to fetch the object into a temp file for DSP
pip install "httpx>=0.27,<1"
```

`requirements.txt` additions:

```
# --- cloud object storage ---
supabase>=2.4,<3        # Option A only
boto3>=1.34,<2          # Option B only
httpx>=0.27,<1          # download objects for librosa/mutagen processing
```

> Keep only the client you actually use. Installing both is harmless but bloats the
> image and slows cold starts on the free tier.

---

## 4. FastAPI Code Blueprint

The cleanest approach is a small **storage abstraction layer** so the rest of the app
never imports `supabase`/`boto3` directly. This keeps the upload/stream routes
provider-agnostic and makes switching providers a one-file change.

### 4.1 New module — `backend/storage/cloud.py`

```python
"""
Provider-agnostic object-storage facade.
The rest of the app only ever calls: upload_bytes(), public_url(), delete_object().
Select the implementation with STORAGE_PROVIDER=supabase|s3 (default: supabase).
"""
import os

STORAGE_PROVIDER = os.environ.get("STORAGE_PROVIDER", "supabase").lower()


# ─────────────────────────────────────────────────────────── Supabase ──
if STORAGE_PROVIDER == "supabase":
    from supabase import create_client

    _SUPABASE_URL = os.environ["SUPABASE_URL"]
    _SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
    _BUCKET       = os.environ.get("SUPABASE_BUCKET", "harmonia-audio")
    _client       = create_client(_SUPABASE_URL, _SUPABASE_KEY)

    def upload_bytes(key: str, data: bytes, content_type: str) -> None:
        # upsert=true makes re-uploads idempotent (handy for retries/migrations)
        _client.storage.from_(_BUCKET).upload(
            path=key,
            file=data,
            file_options={"content-type": content_type, "upsert": "true"},
        )

    def public_url(key: str) -> str:
        # For a public bucket this is a stable, CDN-served URL.
        return _client.storage.from_(_BUCKET).get_public_url(key)

    def delete_object(key: str) -> None:
        _client.storage.from_(_BUCKET).remove([key])


# ───────────────────────────────────────────────────────────── AWS S3 ──
elif STORAGE_PROVIDER == "s3":
    import boto3

    _BUCKET          = os.environ["S3_BUCKET"]
    _REGION          = os.environ.get("AWS_REGION", "eu-west-1")
    _PUBLIC_BASE_URL = os.environ.get("S3_PUBLIC_BASE_URL")  # e.g. CloudFront domain
    _s3 = boto3.client("s3", region_name=_REGION)

    def upload_bytes(key: str, data: bytes, content_type: str) -> None:
        _s3.put_object(Bucket=_BUCKET, Key=key, Body=data, ContentType=content_type)

    def public_url(key: str) -> str:
        if _PUBLIC_BASE_URL:
            return f"{_PUBLIC_BASE_URL.rstrip('/')}/{key}"
        return f"https://{_BUCKET}.s3.{_REGION}.amazonaws.com/{key}"

    def delete_object(key: str) -> None:
        _s3.delete_object(Bucket=_BUCKET, Key=key)


else:
    raise RuntimeError(f"Unknown STORAGE_PROVIDER: {STORAGE_PROVIDER!r}")


# ──────────────────────────────────────────────── shared helper ──
def key_from_url(url: str) -> str | None:
    """
    Best-effort extraction of the object key from a stored public URL, used by
    delete_track(). Returns None for legacy local paths (handled separately).
    """
    if not url or "://" not in url:
        return None
    # Supabase public URLs:  .../object/public/<bucket>/<key>
    marker = "/object/public/"
    if marker in url:
        return url.split(marker, 1)[1].split("/", 1)[1]  # strip "<bucket>/"
    # S3 / CDN: the key is everything after the last domain segment
    return url.split("/", 3)[-1] if url.count("/") >= 3 else None
```

### 4.2 Rewrite the upload endpoint — `backend/api/tracks.py`

The new handler buffers the upload to a **temp file** (so we can enforce the size cap,
extract artwork, and feed analysis a real path), pushes the bytes to the bucket, and
stores the **public URL** in `file_path`.

```python
import os, uuid, shutil, tempfile
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from backend.models.database import get_db
from backend.models.models import Track, User
from backend.audio.artwork import extract_artwork
from backend.storage.cloud import upload_bytes, public_url   # ← new

router = APIRouter()
MAX_SIZE = 20 * 1024 * 1024  # 20 MB

@router.post("/upload")
async def upload_track(
    file: UploadFile = File(...),
    title: str = Form(...),
    artist: str = Form(None),
    album: str = Form(None),
    user_id: int = Form(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ext = os.path.splitext(file.filename)[1].lower()
    object_key = f"tracks/{uuid.uuid4()}{ext}"

    # 1) Buffer to a short-lived temp file (NOT the permanent disk).
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp_path = tmp.name
        shutil.copyfileobj(file.file, tmp)

    try:
        # 2) Enforce the size cap before we pay to upload it.
        if os.path.getsize(tmp_path) > MAX_SIZE:
            raise HTTPException(
                status_code=413,
                detail="File too large. Please upload a track under 20 MB.",
            )

        # 3) Push the audio bytes to the bucket → durable, CDN-served.
        with open(tmp_path, "rb") as f:
            upload_bytes(object_key, f.read(),
                         content_type=file.content_type or "audio/mpeg")
        audio_url = public_url(object_key)

        # 4) Artwork: extract from the temp file, then upload it too.
        artwork_url = None
        local_art = extract_artwork(tmp_path)
        if local_art:
            art_key = f"artwork/{uuid.uuid4()}.jpg"
            with open(local_art, "rb") as af:
                upload_bytes(art_key, af.read(), content_type="image/jpeg")
            artwork_url = public_url(art_key)
            os.remove(local_art)

        # 5) Persist the URLs (not local paths) in the database.
        track = Track(
            title=title, artist=artist, album=album,
            file_path=audio_url,        # ← now an absolute https URL
            artwork_path=artwork_url,   # ← now an absolute https URL (or None)
            user_id=user_id,
        )
        db.add(track)
        db.commit()
        db.refresh(track)
        return {"id": track.id, "title": track.title, "file_path": track.file_path}

    finally:
        # 6) Always clean up the temp file.
        os.remove(tmp_path)
```

### 4.3 Update `delete_track` to remove the remote object

```python
from backend.storage.cloud import delete_object, key_from_url

@router.delete("/{track_id}")
def delete_track(track_id: int, db: Session = Depends(get_db)):
    track = db.query(Track).filter(Track.id == track_id).first()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    for url in (track.file_path, track.artwork_path):
        key = key_from_url(url)
        if key:
            try:
                delete_object(key)
            except Exception as e:
                print(f"Object delete failed (non-fatal): {e}")

    db.delete(track)
    db.commit()
    return {"message": "Track deleted"}
```

### 4.4 Make the background analysis task cloud-aware

`run_analysis` runs *after* the request returns, so the temp file from the upload
handler is already gone. It must fetch the object into its own temp file. Add a small
downloader and reuse it for the spectrum endpoint.

```python
# backend/audio/fetch.py  (new)
import os, tempfile, httpx

def materialize(file_ref: str) -> str:
    """
    Return a local path for `file_ref`, which may be an https URL (cloud) or a
    legacy local path. For URLs, stream to a temp file the caller must delete.
    """
    if file_ref.startswith(("http://", "https://")):
        suffix = os.path.splitext(file_ref.split("?")[0])[1] or ".mp3"
        fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as out, httpx.stream("GET", file_ref, timeout=60) as r:
            r.raise_for_status()
            for chunk in r.iter_bytes():
                out.write(chunk)
        return tmp_path
    return file_ref  # legacy local path — use as-is
```

```python
# backend/api/analysis.py  (run_analysis — updated)
from backend.audio.fetch import materialize

def run_analysis(track_id: int, file_ref: str):
    from backend.models.database import SessionLocal
    db = SessionLocal()
    local_path, is_temp = None, False
    try:
        local_path = materialize(file_ref)
        is_temp = local_path != file_ref
        result = analyze_audio(local_path)
        existing = db.query(Analysis).filter(Analysis.track_id == track_id).first()
        if existing:
            existing.bpm, existing.key, existing.scale = result["bpm"], result["key"], result["scale"]
            existing.energy, existing.danceability = result["energy"], result["danceability"]
        else:
            db.add(Analysis(track_id=track_id, **result))
        db.commit()
    finally:
        db.close()
        if is_temp and local_path and os.path.exists(local_path):
            os.remove(local_path)
```

Apply the same `materialize()` → process → delete pattern to the `/{track_id}/spectrum`
route (which calls `librosa.load(track.file_path, ...)`).

---

## 5. Database Schema Mapping

**No DDL change is required.** `tracks.file_path` (and `tracks.artwork_path`) remain
`Column(String)`. Only the **semantic content** of the column changes:

| | Before | After |
|---|---|---|
| `file_path` value | relative local path | absolute public URL |
| Example | `uploads/3f2a…c1.mp3` | `https://<ref>.supabase.co/storage/v1/object/public/harmonia-audio/tracks/3f2a…c1.mp3` |
| Lifetime | wiped on restart | permanent |
| Consumed by | `FileResponse(path)` | client streams directly / `RedirectResponse(url)` |

Recommended documentation/clarity improvements (optional):

- Add a model comment so the intent is unambiguous:
  ```python
  file_path = Column(String, nullable=False)   # absolute public URL to the audio object
  artwork_path = Column(String)                # absolute public URL to artwork, or NULL
  ```
- If you want a strict, self-documenting schema, introduce a nullable
  `storage_provider` column (`'local' | 'supabase' | 's3'`) during the transition so
  legacy rows can be told apart from migrated ones. This is optional; the
  `startswith("http")` check is sufficient in practice.

A length note: Postgres `String`/`VARCHAR` without a length is unbounded (`text`),
so long CDN URLs are fine. If your column was declared as `String(255)`, widen it:

```sql
ALTER TABLE tracks ALTER COLUMN file_path TYPE varchar(1024);
ALTER TABLE tracks ALTER COLUMN artwork_path TYPE varchar(1024);
```

---

## 6. Streaming Endpoint Updates

### 6.1 Recommended: thin redirect (keeps the existing API contract)

Keep `GET /api/tracks/{id}/audio` as the public contract, but have it **302-redirect**
to the CDN. Clients that already hit this route keep working, and bytes are served by
the edge, not the API container. A backwards-compatible shim still serves any legacy
local file that happens to exist.

```python
import os
from fastapi.responses import FileResponse, RedirectResponse

@router.get("/{track_id}/audio")
def get_track_audio(track_id: int, db: Session = Depends(get_db)):
    track = db.query(Track).filter(Track.id == track_id).first()
    if not track or not track.file_path:
        raise HTTPException(status_code=404, detail="Track not found")

    # New: file_path is a cloud URL → hand the client straight to the CDN.
    if track.file_path.startswith(("http://", "https://")):
        return RedirectResponse(url=track.file_path, status_code=307)

    # Legacy fallback: a local file that still exists on this container.
    if os.path.exists(track.file_path):
        return FileResponse(track.file_path, media_type="audio/mpeg")

    raise HTTPException(status_code=404, detail="Audio file not found")
```

> Use **307 (Temporary Redirect)** so the method/body are preserved and the redirect is
> never cached as permanent — handy if you later move providers.

### 6.2 Optimal: stream directly from the CDN (skip the API entirely)

Because the mobile client's `resolveAudioUrl()` already returns an absolute
`file_path` when one is present, the cleanest setup is to **expose `file_path` in the
read APIs and let the client stream straight from the CDN** — the API never touches the
audio bytes.

Update the read endpoints to include the URL:

```python
# GET /api/tracks/user/{user_id}  — add file_path to each row
return [{
    "id": t.id, "title": t.title, "artist": t.artist,
    "album": t.album, "uploaded_at": t.uploaded_at,
    "file_path": t.file_path,            # ← expose the CDN URL
} for t in tracks]

# GET /api/tracks/{id}  — include file_path alongside analysis
return {"id": track.id, "title": track.title, "artist": track.artist,
        "file_path": track.file_path, "analysis": track.analysis}
```

On the client, `data/api.ts → normalizeTrack()` already maps `raw.file_path`, and
`TrackDetailScreen.tsx → resolveAudioUrl()` already prefers an absolute `file_path`.
So once the API returns it, playback streams from the CDN with **zero** extra API hops.
The `/audio` redirect from §6.1 can remain as a compatibility fallback.

### 6.3 Private-bucket variant (signed URLs)

If the bucket is **private**, do not store a permanent public URL. Store the **object
key** in `file_path` and mint a short-lived signed URL on demand:

```python
# Supabase
signed = _client.storage.from_(_BUCKET).create_signed_url(object_key, 3600)  # 1 h
url = signed["signedURL"]

# S3
url = _s3.generate_presigned_url("get_object",
        Params={"Bucket": _BUCKET, "Key": object_key}, ExpiresIn=3600)
```

In this model, `GET /api/tracks/{id}/audio` generates a fresh signed URL and 307-redirects
to it on every request. This trades a little latency for access control.

---

## 7. Migrating Existing Rows

Existing production rows point at local paths whose files were already wiped — they are
**unrecoverable** and must be re-uploaded. For a clean transition:

1. **Flag dead local rows** (optional, for clarity in the UI):
   ```sql
   -- Mark legacy rows so the client can show "re-upload required"
   UPDATE tracks
   SET file_path = NULL
   WHERE file_path NOT LIKE 'http%';
   ```
   (Make `file_path` nullable first if it isn't, or instead delete the orphaned rows.)

2. **Or delete orphaned rows** if you prefer a clean slate:
   ```sql
   DELETE FROM analyses
   WHERE track_id IN (SELECT id FROM tracks WHERE file_path NOT LIKE 'http%');
   DELETE FROM tracks WHERE file_path NOT LIKE 'http%';
   ```

3. **Re-upload** the test/demo tracks through the new pipeline; they now persist.

> There is no automated "lift" for the old files because the bytes no longer exist on
> Render. This migration is forward-looking: every upload *after* deployment is durable.

---

## 8. Testing & Rollback

### 8.1 Pre-deploy local test

```bash
# point STORAGE_PROVIDER + credentials at a real bucket, then:
uvicorn backend.main:app --reload

# upload
curl -F "file=@sample.mp3" -F "title=Test" -F "user_id=1" \
     http://localhost:8000/api/tracks/upload
# → {"id": N, "file_path": "https://.../harmonia-audio/tracks/....mp3"}

# verify the URL is publicly streamable (expect HTTP 200, audio/mpeg, Accept-Ranges)
curl -sI "https://.../harmonia-audio/tracks/....mp3"

# verify the redirect contract
curl -sI http://localhost:8000/api/tracks/N/audio    # → 307 Location: https://...
```

### 8.2 Acceptance checklist

- [ ] Upload returns an `https://` `file_path`.
- [ ] The object is publicly reachable and returns `Accept-Ranges: bytes` (seeking works).
- [ ] Background analysis populates BPM/key/energy (confirms `materialize()` works).
- [ ] `/spectrum` still returns bands.
- [ ] Web `<audio>` element plays the URL (CORS correct — see §2.2.3 for S3).
- [ ] Deleting a track removes the bucket object.
- [ ] **Restart the Render service and confirm previously-uploaded audio still plays.**

### 8.3 Rollback

The change is additive and provider-gated:

- Revert by setting the code back to `shutil.copyfileobj` + `FileResponse`, **or**
- keep the new code and only the legacy `FileResponse` branch (§6.1) is exercised.

Because `file_path` may now hold either a URL or a local path, the §6.1 endpoint
handles both, making the transition safe to roll forward or back without data loss.

---

## Appendix — Affected Files Checklist

| File | Change |
|---|---|
| `backend/storage/cloud.py` | **New** — provider-agnostic storage facade (`upload_bytes`, `public_url`, `delete_object`, `key_from_url`). |
| `backend/audio/fetch.py` | **New** — `materialize()` downloads a cloud object to a temp file for DSP. |
| `backend/api/tracks.py` | `upload_track` → bucket upload + temp file; `delete_track` → remove remote object; `/{id}/audio` → 307 redirect with legacy fallback; read routes expose `file_path`. |
| `backend/api/analysis.py` | `run_analysis` + `/{id}/spectrum` → `materialize()` → process → delete temp. |
| `backend/audio/artwork.py` | Unchanged logic; now called against the temp file, output uploaded to the bucket. |
| `backend/models/models.py` | No DDL change; clarify `file_path`/`artwork_path` comments (optionally add `storage_provider`). |
| `requirements.txt` | Add `supabase` *or* `boto3`, plus `httpx`. |
| Render / `.env` | Add `STORAGE_PROVIDER` + provider credentials (`SUPABASE_*` or `AWS_*`/`S3_*`). |
| Mobile (`harmonia-expo`) | No change required — `normalizeTrack()` and `resolveAudioUrl()` already handle an absolute `file_path`. |

---

*End of blueprint. This document describes a forward-looking migration; implement and
validate in a staging environment before deploying to production.*
