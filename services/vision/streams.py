"""Resolve live London camera streams on demand.

    uv run python streams.py list               # catalogue
    uv run python streams.py resolve <id>       # print a fresh HLS URL (expires in hours)
    uv run python streams.py check              # which cameras are live right now
    uv run python streams.py frame <id> out.jpg # grab one frame (for quick tests)

From code: `resolve(camera_id)` returns a URL that OpenCV, ffmpeg or Ultralytics
(`YOLO(...).track(source=url, stream=True)`) can read directly.
"""

import json
import subprocess
import sys
from pathlib import Path

import yt_dlp

CATALOGUE = Path(__file__).parent / "cameras" / "london_live.json"
# 720p is plenty for detection and keeps bandwidth sane when many streams are open.
# YouTube live serves video-only HLS variants, so pick the video track (AI doesn't need audio).
FORMAT = "bestvideo[height<=720]/best[height<=720]/bestvideo/best"


def cameras() -> list[dict]:
    return json.loads(CATALOGUE.read_text())["cameras"]


def camera(camera_id: str) -> dict:
    for c in cameras():
        if c["id"] == camera_id:
            return c
    raise KeyError(f"unknown camera: {camera_id}")


def _info(url: str, **opts) -> dict:
    # Node is already on the machine; yt-dlp needs a JS runtime to see all YouTube formats.
    base = {"quiet": True, "no_warnings": True, "js_runtimes": {"node": {}}}
    with yt_dlp.YoutubeDL({**base, **opts}) as ydl:
        return ydl.extract_info(url, download=False)


def _live_video_id(rule: dict) -> str | None:
    """Current live video for a camera: the saved ID if still live, else search the channel."""
    try:
        if _info(f"https://www.youtube.com/watch?v={rule['video_id']}").get("live_status") == "is_live":
            return rule["video_id"]
    except yt_dlp.utils.DownloadError:
        pass
    streams = _info(
        f"https://www.youtube.com/{rule['channel']}/streams",
        extract_flat=True,
        playlistend=60,
    )
    for entry in streams.get("entries") or []:
        if entry.get("live_status") == "is_live" and rule["match"].lower() in (entry.get("title") or "").lower():
            return entry["id"]
    return None


def resolve(camera_id: str) -> str:
    rule = camera(camera_id)["resolve"]
    video_id = _live_video_id(rule)
    if not video_id:
        raise RuntimeError(f"{camera_id} is not live right now")
    return _info(f"https://www.youtube.com/watch?v={video_id}", format=FORMAT)["url"]


def frame(camera_id: str, out: str) -> None:
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", resolve(camera_id), "-frames:v", "1", out],
        check=True,
        timeout=60,
    )


def main(argv: list[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "list"
    if cmd == "list":
        for c in cameras():
            print(f"{c['id']:30} {c['lat']:.5f},{c['lon']:.5f}  {c['kind']:15} {c['name']}")
    elif cmd == "resolve":
        print(resolve(argv[2]))
    elif cmd == "check":
        for c in cameras():
            try:
                resolve(c["id"])
                print(f"LIVE  {c['id']}")
            except Exception as e:  # report every camera, don't stop at the first failure
                print(f"DOWN  {c['id']}  ({e})")
    elif cmd == "frame":
        frame(argv[2], argv[3])
        print(argv[3])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
