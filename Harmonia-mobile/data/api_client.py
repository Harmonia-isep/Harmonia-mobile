import os
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

_ENV_FILE = Path(__file__).parent.parent / ".env"
load_dotenv(_ENV_FILE)

BASE_URL = (
    os.getenv("EXPO_PUBLIC_API_URL")
    or os.getenv("API_URL", "https://harmonia-api-n8zp.onrender.com")
).rstrip("/")

print(f"DEBUG: .env path  -> {_ENV_FILE}  (exists: {_ENV_FILE.exists()})")
print(f"DEBUG: BASE_URL   -> {BASE_URL}")

SESSION_FILE = Path(__file__).parent.parent / "session.json"


def _load_session() -> dict:
    if SESSION_FILE.exists():
        try:
            return json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_session(data: dict) -> None:
    SESSION_FILE.write_text(json.dumps(data), encoding="utf-8")


def get_or_create_user_id() -> int:
    session = _load_session()
    if "user_id" in session:
        print(f"DEBUG: Reusing saved user_id -> {session['user_id']}")
        return session["user_id"]

    url = f"{BASE_URL}/api/users/guest"
    print(f"DEBUG: Fetching from {url}")
    resp = requests.post(
        url,
        data=b"",
        headers={"Content-Length": "0"},
        timeout=10,
    )
    if not resp.ok:
        print(f"DEBUG: {resp.status_code} error body -> {resp.text}")
        resp.raise_for_status()
    data = resp.json()
    user_id = data.get("id") or data.get("user_id")
    print(f"DEBUG: Guest user created -> user_id={user_id}")
    _save_session({"user_id": user_id})
    return user_id


def get_user_tracks(user_id: int) -> list:
    url = f"{BASE_URL}/api/tracks/user/{user_id}"
    print(f"DEBUG: Fetching from {url}")
    resp = requests.get(url, timeout=10)
    print(f"DEBUG: Response status -> {resp.status_code}")
    if not resp.ok:
        print(f"DEBUG: {resp.status_code} error body -> {resp.text}")
        resp.raise_for_status()
    data = resp.json()
    print(f"DEBUG: Tracks received -> {data}")
    return data or []


def get_track_analysis(track_id: int) -> dict:
    url = f"{BASE_URL}/api/analysis/{track_id}"
    print(f"DEBUG: Fetching from {url}")
    resp = requests.get(url, timeout=10)
    print(f"DEBUG: Analysis response -> {resp.status_code}")
    if resp.status_code == 404:
        return {}   # no analysis yet — not an error
    if not resp.ok:
        print(f"DEBUG: {resp.status_code} error body -> {resp.text}")
        resp.raise_for_status()
    return resp.json() or {}


def trigger_analysis(track_id: int) -> dict:
    url = f"{BASE_URL}/api/analysis/analyze/{track_id}"
    print(f"DEBUG: Triggering analysis for track {track_id}")
    resp = requests.post(url, timeout=10)
    if not resp.ok:
        print(f"DEBUG: trigger_analysis {resp.status_code} -> {resp.text}")
        resp.raise_for_status()
    return resp.json()


def upload_track(user_id: int, file_path: str) -> dict:
    """
    POST /api/tracks/upload — upload an audio file (MP3 or WAV) linked to user_id.
    Returns the newly created track dict from the API.
    """
    url = f"{BASE_URL}/api/tracks/upload"
    file_name = os.path.basename(file_path)
    title = os.path.splitext(file_name)[0]

    print(f"DEBUG: Uploading '{file_name}' for user_id={user_id} -> {url}")

    with open(file_path, "rb") as f:
        mime = "audio/wav" if file_path.lower().endswith(".wav") else "audio/mpeg"
        files = {"file": (file_name, f, mime)}
        data = {
            "user_id": str(user_id),
            "title": title,
            "artist": "Unknown Artist",
        }
        resp = requests.post(url, files=files, data=data, timeout=60)

    print(f"DEBUG: Upload response -> {resp.status_code}  body -> {resp.text[:200]}")
    if not resp.ok:
        resp.raise_for_status()
    return resp.json()


def delete_track(track_id: int) -> bool:
    """
    DELETE /api/tracks/{track_id} — removes the track and its analysis data.
    Returns True on success.
    """
    url = f"{BASE_URL}/api/tracks/{track_id}"
    print(f"DEBUG: Deleting track {track_id} -> {url}")
    resp = requests.delete(url, timeout=10)
    print(f"DEBUG: Delete response -> {resp.status_code}")
    return resp.ok


# ── normalisation helpers ──────────────────────────────────────────────────

def _format_duration(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, (int, float)):
        m, s = divmod(int(value), 60)
        return f"{m}:{s:02d}"
    return str(value)


def _round_bpm(value):
    if isinstance(value, float):
        return round(value)
    return value or "—"


def normalize_track(track_raw: dict, analysis_raw=None) -> dict:
    """Map an API track (+ optional analysis) to the shape the UI expects."""
    a = analysis_raw or {}

    # Combine key + scale ("C" + "minor" -> "C minor")
    key_part   = a.get("key")   or track_raw.get("key")   or ""
    scale_part = a.get("scale") or track_raw.get("scale") or ""
    key_full   = f"{key_part} {scale_part}".strip() or "—"

    return {
        "id":       track_raw.get("id"),
        "title":    track_raw.get("title") or "Unknown",
        "artist":   track_raw.get("artist") or "Unknown Artist",
        "duration": _format_duration(
            track_raw.get("duration") or track_raw.get("duration_seconds")
        ),
        "bpm":    _round_bpm(a.get("bpm") or track_raw.get("bpm")),
        "key":    key_full,
        "status": a.get("status") or track_raw.get("status") or "ready",
    }