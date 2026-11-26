#!/usr/bin/env python3
"""Reprise API: fetch the audio track of a YouTube video so the browser can analyze it.

All analysis still happens in the visitor's browser. This service only turns a YouTube link
into an audio file:

    POST /api/youtube  {"url": "<YouTube link>"}
      → 200 {"id", "title", "duration", "uploader", "audio": "/api/audio/<id>.m4a"}
    GET  /api/health   → {"ok": true, "ytdlp": "<version>"}

nginx serves /api/audio/<id>.m4a straight from the cache directory, with range requests
supported. Uses only the Python standard library plus two external tools:
yt-dlp (with Deno for YouTube's JS challenges) and ffmpeg.

Safety:
  * User input never reaches yt-dlp as a URL. We extract the 11-character video ID and
    rebuild a canonical https://www.youtube.com/watch?v=<id>, so there are no other sites,
    no playlists and no SSRF. Subprocesses get an argv list, never a shell.
  * Limits: video length, file size, concurrent downloads, requests per IP, and a
    size- and age-capped cache.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

# ── configuration (environment overrides; module attributes so tests can patch them) ──

HOST = os.environ.get("REPRISE_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("REPRISE_API_PORT", "8081"))
CACHE_DIR = Path(os.environ.get("REPRISE_CACHE", "/var/cache/reprise"))
YTDLP = os.environ.get("REPRISE_YTDLP", "yt-dlp")

MAX_DURATION_S = 20 * 60
MAX_FILESIZE = "150M"
DOWNLOAD_TIMEOUT_S = 300
MAX_CONCURRENT_DOWNLOADS = 2
QUEUE_WAIT_S = 90
CACHE_MAX_BYTES = 1_500_000_000
CACHE_MAX_AGE_S = 7 * 24 * 3600
RATE_LIMIT = (12, 600)  # requests per window (seconds), per client IP
MAX_BODY_BYTES = 2048

log = logging.getLogger("reprise-api")

# ── link parsing ──────────────────────────────────────────────────────────────

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
}
PATH_ID = re.compile(r"^/(?:shorts|live|embed|v)/([^/]+)")


def parse_video_id(text: str) -> str | None:
    """The 11-character video ID of a YouTube link, or None if it isn't one."""
    text = (text or "").strip()
    if not text or len(text) > 500:
        return None
    if "://" not in text:
        text = "https://" + text
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or host not in YOUTUBE_HOSTS:
        return None
    if host == "youtu.be":
        candidate = parts.path.lstrip("/").split("/")[0]
    elif parts.path == "/watch":
        candidate = parse_qs(parts.query).get("v", [""])[0]
    else:
        m = PATH_ID.match(parts.path)
        candidate = m.group(1) if m else ""
    return candidate if VIDEO_ID.match(candidate) else None


# ── errors ────────────────────────────────────────────────────────────────────


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# (substring of yt-dlp's stderr, lowercase) → (HTTP status, message for the user)
YTDLP_ERRORS = [
    ("not a bot", 503, "YouTube is temporarily refusing downloads from this server. Try again later."),
    ("confirm your age", 422, "This video is age-restricted, so it can't be fetched."),
    ("age-restricted", 422, "This video is age-restricted, so it can't be fetched."),
    ("private video", 422, "This video is private."),
    ("members-only", 422, "This video is for channel members only."),
    ("join this channel", 422, "This video is for channel members only."),
    ("premieres in", 422, "This video hasn't premiered yet."),
    ("live event will begin", 422, "This live stream hasn't started yet."),
    ("copyright", 404, "This video was taken down."),
    ("unavailable", 404, "This video is unavailable."),
    ("not available", 404, "This video is unavailable."),
    ("has been removed", 404, "This video is unavailable."),
]


def explain_ytdlp_failure(stderr: str) -> ApiError:
    low = stderr.lower()
    for needle, status, message in YTDLP_ERRORS:
        if needle in low:
            return ApiError(status, message)
    return ApiError(502, "Couldn't fetch this video from YouTube.")


# ── cache ─────────────────────────────────────────────────────────────────────


def audio_dir() -> Path:
    return CACHE_DIR / "audio"


def work_dir() -> Path:
    return CACHE_DIR / "work"


def cached(video_id: str) -> dict | None:
    audio = audio_dir() / f"{video_id}.m4a"
    meta = audio_dir() / f"{video_id}.json"
    if not (audio.is_file() and meta.is_file()):
        return None
    try:
        info = json.loads(meta.read_text())
    except (OSError, ValueError):
        return None
    now = time.time()
    os.utime(audio, (now, now))  # mark as recently used
    return info


def prune_cache(max_bytes: int | None = None, max_age_s: float | None = None) -> None:
    """Drop entries older than max_age, then least recently used ones until under max_bytes."""
    max_bytes = CACHE_MAX_BYTES if max_bytes is None else max_bytes
    max_age_s = CACHE_MAX_AGE_S if max_age_s is None else max_age_s
    now = time.time()
    entries = []
    for audio in audio_dir().glob("*.m4a"):
        try:
            st = audio.stat()
        except OSError:
            continue
        entries.append((st.st_mtime, st.st_size, audio))
    entries.sort()  # oldest first
    total = sum(size for _, size, _ in entries)
    for mtime, size, audio in entries:
        if now - mtime <= max_age_s and total <= max_bytes:
            break
        audio.unlink(missing_ok=True)
        audio.with_suffix(".json").unlink(missing_ok=True)
        total -= size


# ── download ──────────────────────────────────────────────────────────────────

_download_slots = threading.BoundedSemaphore(MAX_CONCURRENT_DOWNLOADS)
_id_locks: dict[str, threading.Lock] = {}
_id_locks_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    with _id_locks_guard:
        return _id_locks.setdefault(video_id, threading.Lock())


def ytdlp_command(video_id: str, out_dir: Path) -> list[str]:
    return [
        YTDLP,
        "--ignore-config",
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "--no-simulate",
        # Prefer stereo: some videos also carry 5.1 tracks, which are bigger and downmix worse.
        "-f", "bestaudio[ext=m4a][audio_channels<=2]/bestaudio[audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best",
        "--match-filter", f"duration <= {MAX_DURATION_S} & !is_live",
        "--max-filesize", MAX_FILESIZE,
        # m4a streams are only remuxed; anything else is transcoded to AAC by ffmpeg.
        "-x", "--audio-format", "m4a", "--audio-quality", "192K",
        "-o", str(out_dir / "audio.%(ext)s"),
        "--print", "after_move:%(.{id,title,duration,uploader})j",
        f"https://www.youtube.com/watch?v={video_id}",
    ]


def fetch_audio(video_id: str) -> dict:
    """Return metadata for the video's audio, downloading it into the cache if needed."""
    if not VIDEO_ID.match(video_id):
        raise ApiError(400, "Invalid video id.")
    info = cached(video_id)
    if info:
        return info
    with _lock_for(video_id):  # two requests for the same video share one download
        info = cached(video_id)
        if info:
            return info
        if not _download_slots.acquire(timeout=QUEUE_WAIT_S):
            raise ApiError(503, "Reprise is busy fetching other songs. Try again in a minute.")
        work = work_dir() / video_id
        try:
            shutil.rmtree(work, ignore_errors=True)
            work.mkdir(parents=True)
            started = time.monotonic()
            try:
                proc = subprocess.run(
                    ytdlp_command(video_id, work),
                    capture_output=True,
                    text=True,
                    timeout=DOWNLOAD_TIMEOUT_S,
                )
            except subprocess.TimeoutExpired:
                raise ApiError(504, "YouTube took too long to respond. Try again.")
            except FileNotFoundError:
                raise ApiError(500, "yt-dlp is not installed on the server.")
            if proc.returncode != 0:
                log.warning("yt-dlp failed for %s: %s", video_id, proc.stderr.strip()[-500:])
                raise explain_ytdlp_failure(proc.stderr)
            audio = work / "audio.m4a"
            if not audio.is_file():
                # yt-dlp exits 0 but downloads nothing when --match-filter or --max-filesize rejects.
                raise ApiError(
                    422, f"Only videos up to {MAX_DURATION_S // 60} minutes can be used (and no live streams)."
                )
            lines = [ln for ln in proc.stdout.splitlines() if ln.strip().startswith("{")]
            meta = json.loads(lines[-1]) if lines else {}
            info = {
                "id": video_id,
                "title": str(meta.get("title") or video_id)[:300],
                "duration": meta.get("duration"),
                "uploader": meta.get("uploader"),
                "audio": f"/api/audio/{video_id}.m4a",
            }
            audio_dir().mkdir(parents=True, exist_ok=True)
            os.chmod(audio, 0o644)
            os.replace(audio, audio_dir() / f"{video_id}.m4a")
            tmp_meta = work / "meta.json"
            tmp_meta.write_text(json.dumps(info))
            os.chmod(tmp_meta, 0o644)
            os.replace(tmp_meta, audio_dir() / f"{video_id}.json")
            log.info("fetched %s (%s) in %.1fs", video_id, info["title"], time.monotonic() - started)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            _download_slots.release()
    prune_cache()
    return info


# ── rate limiting ─────────────────────────────────────────────────────────────

_hits: dict[str, deque] = {}
_hits_guard = threading.Lock()


def allow_request(client: str, now: float | None = None) -> bool:
    limit, window = RATE_LIMIT
    now = time.monotonic() if now is None else now
    with _hits_guard:
        q = _hits.setdefault(client, deque())
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


# ── HTTP ──────────────────────────────────────────────────────────────────────

_ytdlp_version = "unknown"


class Handler(BaseHTTPRequestHandler):
    server_version = "reprise-api"
    protocol_version = "HTTP/1.1"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _client(self) -> str:
        # Only nginx on localhost talks to us, so its X-Real-IP is trustworthy.
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self._send(200, {"ok": True, "ytdlp": _ytdlp_version})
        else:
            self._send(404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/youtube":
            self._send(404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ApiError(400, "Send a JSON body with a YouTube link.")
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                raise ApiError(400, "Send a JSON body with a YouTube link.")
            video_id = parse_video_id(body.get("url", "") if isinstance(body, dict) else "")
            if not video_id:
                raise ApiError(400, "That doesn't look like a YouTube video link.")
            if not allow_request(self._client()):
                raise ApiError(429, "Too many songs in a short time. Wait a few minutes.")
            self._send(200, fetch_audio(video_id))
        except ApiError as err:
            self._send(err.status, {"error": err.message})
        except Exception:  # never leak internals to the client
            log.exception("unexpected error")
            self._send(500, {"error": "Something went wrong on the server."})

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self._client(), fmt % args)


def main() -> None:
    global _ytdlp_version
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    audio_dir().mkdir(parents=True, exist_ok=True)
    work_dir().mkdir(parents=True, exist_ok=True)
    try:
        _ytdlp_version = subprocess.run([YTDLP, "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        log.warning("yt-dlp not found at %s", YTDLP)
    prune_cache()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    log.info("listening on %s:%d (yt-dlp %s)", HOST, PORT, _ytdlp_version)
    server.serve_forever()


if __name__ == "__main__":
    main()
