"""Tests for the Reprise API (run: python3 -m unittest discover -s server). No network needed:
yt-dlp is replaced by a stub script that behaves like it."""
import json
import os
import stat
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import reprise_api as api  # noqa: E402


class ParseVideoId(unittest.TestCase):
    def test_accepts_the_common_link_shapes(self):
        vid = "dQw4w9WgXcQ"
        for link in [
            f"https://www.youtube.com/watch?v={vid}",
            f"https://youtube.com/watch?v={vid}&t=42s&list=PL123",
            f"http://m.youtube.com/watch?feature=share&v={vid}",
            f"https://music.youtube.com/watch?v={vid}&si=abc",
            f"https://youtu.be/{vid}?si=xyz",
            f"https://www.youtube.com/shorts/{vid}",
            f"https://www.youtube.com/live/{vid}?feature=share",
            f"https://www.youtube-nocookie.com/embed/{vid}",
            f"youtube.com/watch?v={vid}",
            f"  https://YOUTU.BE/{vid}  ",
        ]:
            self.assertEqual(api.parse_video_id(link), vid, link)

    def test_rejects_everything_else(self):
        for link in [
            "",
            "dQw4w9WgXcQ",  # a bare id is not a link
            "https://evil.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
            "https://evil.com/?u=https://youtube.com/watch?v=dQw4w9WgXcQ",
            "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
            "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ;rm -rf",
            "https://www.youtube.com/playlist?list=PL123",
            "https://www.youtube.com/@channel",
            "https://youtu.be/",
            "https://www.youtube.com/watch?v=" + "a" * 600,
        ]:
            self.assertIsNone(api.parse_video_id(link), link)


class ExplainFailure(unittest.TestCase):
    def test_maps_known_errors(self):
        self.assertEqual(api.explain_ytdlp_failure("ERROR: Sign in to confirm you’re not a bot").status, 503)
        self.assertEqual(api.explain_ytdlp_failure("ERROR: Private video. Sign in").status, 422)
        self.assertEqual(api.explain_ytdlp_failure("ERROR: Sign in to confirm your age").status, 422)
        self.assertEqual(api.explain_ytdlp_failure("ERROR: [youtube] x: Video unavailable").status, 404)
        # The exact wording yt-dlp 2026.11 prints for a nonexistent video:
        self.assertEqual(api.explain_ytdlp_failure("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable").status, 404)
        self.assertEqual(api.explain_ytdlp_failure("ERROR: something new").status, 502)


STUB = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    # Pretends to be yt-dlp: writes <out>/audio.m4a and prints the after_move JSON line.
    import json, os, sys
    args = sys.argv[1:]
    url = args[-1]
    out = args[args.index("-o") + 1]
    vid = url.split("v=")[1]
    with open(os.environ["STUB_CALLS"], "a") as f:
        f.write(vid + "\\n")
    mode = os.environ.get("STUB_MODE", "ok")
    if mode == "fail":
        sys.stderr.write("ERROR: [youtube] " + vid + ": Video unavailable\\n"); sys.exit(1)
    if mode == "skip":
        print(vid + " does not pass filter (duration <= 1200), skipping .."); sys.exit(0)
    with open(out.replace("%(ext)s", "m4a"), "wb") as f:
        f.write(b"\\0" * 1000)
    print(json.dumps({"id": vid, "title": "Song " + vid, "duration": 180, "uploader": "Someone"}))
    """
)


class FetchAudio(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        stub = root / "yt-dlp"
        stub.write_text(STUB)
        stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
        self.calls = root / "calls.txt"
        self.calls.write_text("")
        os.environ["STUB_CALLS"] = str(self.calls)
        os.environ["STUB_MODE"] = "ok"
        self.saved = (api.YTDLP, api.CACHE_DIR)
        api.YTDLP = str(stub)
        api.CACHE_DIR = root / "cache"

    def tearDown(self):
        api.YTDLP, api.CACHE_DIR = self.saved
        self.tmp.cleanup()

    def test_downloads_once_then_serves_from_cache(self):
        info = api.fetch_audio("dQw4w9WgXcQ")
        self.assertEqual(info["title"], "Song dQw4w9WgXcQ")
        self.assertEqual(info["audio"], "/api/audio/dQw4w9WgXcQ.m4a")
        audio = api.CACHE_DIR / "audio" / "dQw4w9WgXcQ.m4a"
        self.assertTrue(audio.is_file())
        self.assertEqual(oct(audio.stat().st_mode & 0o777), "0o644")  # nginx must be able to read it
        self.assertEqual(api.fetch_audio("dQw4w9WgXcQ"), info)
        self.assertEqual(self.calls.read_text().split(), ["dQw4w9WgXcQ"])
        self.assertEqual(list((api.CACHE_DIR / "work").iterdir()), [])  # work dir cleaned

    def test_reports_failures_and_filtered_videos(self):
        os.environ["STUB_MODE"] = "fail"
        with self.assertRaises(api.ApiError) as ctx:
            api.fetch_audio("aaaaaaaaaaa")
        self.assertEqual(ctx.exception.status, 404)
        os.environ["STUB_MODE"] = "skip"
        with self.assertRaises(api.ApiError) as ctx:
            api.fetch_audio("bbbbbbbbbbb")
        self.assertEqual(ctx.exception.status, 422)
        self.assertIn("20 minutes", ctx.exception.message)

    def test_never_passes_user_text_to_ytdlp(self):
        cmd = api.ytdlp_command("dQw4w9WgXcQ", Path("/tmp/x"))
        self.assertEqual(cmd[-1], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        with self.assertRaises(api.ApiError):
            api.fetch_audio("../../etc/x")

    def test_prunes_oldest_entries_beyond_the_size_cap(self):
        for vid in ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]:
            api.fetch_audio(vid)
        audio = api.CACHE_DIR / "audio"
        old = time.time() - 100
        os.utime(audio / "aaaaaaaaaaa.m4a", (old, old))
        api.prune_cache(max_bytes=2500)  # room for two 1000-byte files
        left = sorted(p.stem for p in audio.glob("*.m4a"))
        self.assertEqual(left, ["bbbbbbbbbbb", "ccccccccccc"])
        self.assertFalse((audio / "aaaaaaaaaaa.json").exists())
        api.prune_cache(max_age_s=-1)
        self.assertEqual(list(audio.glob("*")), [])


class RateLimit(unittest.TestCase):
    def test_limits_per_client_within_the_window(self):
        api._hits.clear()
        limit, window = api.RATE_LIMIT
        for _ in range(limit):
            self.assertTrue(api.allow_request("1.2.3.4", now=0))
        self.assertFalse(api.allow_request("1.2.3.4", now=1))
        self.assertTrue(api.allow_request("5.6.7.8", now=1))
        self.assertTrue(api.allow_request("1.2.3.4", now=window + 1))


if __name__ == "__main__":
    unittest.main()
