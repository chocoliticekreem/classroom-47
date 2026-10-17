"""Prepare the "virtual live cams": high-quality fixed street footage that plays as if it were live CCTV.

    uv run python vcams.py                  # download + YOLO-track every cam in apps/stream/src/lib/vcams.json
    uv run python vcams.py VCAM_bank        # just one (run several in parallel: one process per cam)
    uv run python vcams.py --calibrate      # Nemotron 3.5 Super VL estimates each in-twin cam's pose

For each cam this writes, into apps/stream/public/footage/cams/ (gitignored):
    <file>.mp4          15 min of the source video at 1080p
    <file>.tracks.json  YOLO26 + ByteTrack tracks over the whole video, in services/yolo's /tracks shape
    <file>.frame.jpg    the busiest frame with YOLO's boxes drawn (what /frame serves)
    <file>.jpg          a plain poster frame

TfL JamCams are 352x288 and repeat one 10 s clip; these are sharp and run 15 min before looping, and the
player starts them at the wall-clock position so they look live. Never put them into VAST (internet video).
"""

import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
MANIFEST = ROOT / "apps" / "stream" / "src" / "lib" / "vcams.json"
OUT = ROOT / "apps" / "stream" / "public" / "footage" / "cams"
CALIBRATION = ROOT / "apps" / "stream" / "src" / "twin" / "live" / "calibration.json"
# Footage is 1080p, so objects are far bigger than in a JamCam frame: YOLO26n at 640 holds up. Decoding every
# 1080p frame dominates: 15 min of footage takes ~40 min on a laptop CPU, so run one process per cam.
os.environ.setdefault("JAMCAM_YOLO_WEIGHTS", str(HERE / "weights" / "yolo26n.pt"))
os.environ.setdefault("JAMCAM_YOLO_IMGSZ", "640")
STRIDE = 6  # 5 tracked samples a second on 30 fps footage
# Tripod height of these street-level shots; the VLM prompt assumes a pole-mounted CCTV camera.
TRIPOD_HEIGHT_M = 1.6
# The twin's 3D city only exists here (apps/stream/src/twin/config.ts GEOMETRY_BOUNDS, local metres).
ORIGIN = (51.5098, -0.0766)
BOUNDS = {"xMin": -1100, "xMax": 650, "zMin": -650, "zMax": 1100}


def cams() -> list[dict]:
    return json.loads(MANIFEST.read_text())


def in_twin(cam: dict) -> bool:
    x = (cam["lon"] - ORIGIN[1]) * 111_320 * math.cos(math.radians(ORIGIN[0]))
    z = -(cam["lat"] - ORIGIN[0]) * 111_320
    return BOUNDS["xMin"] <= x <= BOUNDS["xMax"] and BOUNDS["zMin"] <= z <= BOUNDS["zMax"]


def download(cam: dict) -> Path:
    mp4 = OUT / f"{cam['file']}.mp4"
    if mp4.exists():
        return mp4
    import yt_dlp
    from yt_dlp.utils import download_range_func

    opts = {
        "format": "bv*[height<=1080][vcodec^=avc1]/bv*[height<=1080]",
        "outtmpl": str(OUT / f"{cam['file']}.%(ext)s"),
        "download_ranges": download_range_func(None, [tuple(cam["section"])]),
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        "concurrent_fragment_downloads": 4,
        "js_runtimes": {"node": {}},
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([f"https://www.youtube.com/watch?v={cam['youtube']}"])
    return mp4


def track(cam: dict, mp4: Path) -> None:
    out = OUT / f"{cam['file']}.tracks.json"
    if out.exists():
        print(f"have  {cam['id']} tracks")
        return
    import cv2
    import torch

    sys.path.insert(0, str(ROOT / "services" / "yolo"))
    import server  # the same tracker, colours and track shape the live JamCam path uses

    torch.set_num_threads(max(2, (os.cpu_count() or 4) // 3))
    server.STRIDE = STRIDE
    _, _, tracks, best_plot, duration = server.track_clip(str(mp4))
    out.write_text(json.dumps({"camId": cam["id"], "at": 0, "duration": duration, "tracks": tracks}, separators=(",", ":")))
    if best_plot is not None:
        cv2.imwrite(str(OUT / f"{cam['file']}.frame.jpg"), best_plot, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f"done  {cam['id']}: {len(tracks)} tracks over {duration:.0f} s", flush=True)


def poster(cam: dict, mp4: Path) -> Path:
    jpg = OUT / f"{cam['file']}.jpg"
    if not jpg.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "60", "-i", str(mp4), "-frames:v", "1", "-vf", "scale=1280:-2", str(jpg)], check=True)
    return jpg


def twin_street_candidates(lat: float, lon: float, radius_m: float = 45) -> list[dict]:
    """Both directions along each named road near the camera, from the twin's own cached OpenStreetMap roads
    (apps/stream/.cache, written by /api/twin/osm): the geometry the twin draws, and no Overpass call."""
    import glob
    import gzip

    path = sorted(glob.glob(str(ROOT / "apps" / "stream" / ".cache" / "twin-osm-*.json.gz")))[-1]
    body = json.loads(gzip.open(path).read())["body"]
    body = json.loads(body) if isinstance(body, str) else body
    cx = (lon - ORIGIN[1]) * 111_320 * math.cos(math.radians(ORIGIN[0]))
    cz = -(lat - ORIGIN[0]) * 111_320
    best: dict[str, tuple[float, float]] = {}
    for road in body["roads"]:
        name = road.get("name")
        if not name or road.get("kind") == "rail":
            continue
        for (ax, az), (bx, bz) in zip(road["line"], road["line"][1:]):
            d = math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz)
            if d <= radius_m and (name not in best or d < best[name][1]):
                # Local metres are +x east, +z south, so compass heading = atan2(dx, -dz).
                best[name] = ((math.degrees(math.atan2(bx - ax, -(bz - az))) + 360) % 360, d)
    out = []
    for name, (b, _) in sorted(best.items(), key=lambda kv: kv[1][1]):
        out += [{"street": name, "heading": round(b, 1)}, {"street": name, "heading": round((b + 180) % 360, 1)}]
    return out


def calibrate_all() -> None:
    """Nemotron picks the street the camera faces and reads the horizon and lens, as for the TfL cams."""
    import calibrate

    poses = json.loads(CALIBRATION.read_text())
    for cam in cams():
        if not in_twin(cam):
            print(f"skip  {cam['id']}: outside the twin's 3D city")
            continue
        jpeg = poster(cam, OUT / f"{cam['file']}.mp4").read_bytes()
        candidates = twin_street_candidates(cam["lat"], cam["lon"])
        stated = calibrate.tfl_heading(cam["view"])
        if stated is not None and any(calibrate.agrees(c["heading"], stated) for c in candidates):
            candidates = [c for c in candidates if calibrate.agrees(c["heading"], stated)]
        answer = calibrate.ask(cam, jpeg, candidates)
        heading = answer["candidate"]["heading"] if answer.get("candidate") else cam["heading"]
        # The manifest heading was measured from the landmark in shot (e.g. the Royal Exchange); a street pick far
        # from it means the nearest OSM segment bends at the camera, so keep the measured one.
        if not calibrate.agrees(heading, cam["heading"], 30):
            print(f"      {cam['id']}: model picked {heading:.0f}°, measured {cam['heading']}°; keeping the measured heading")
            heading = cam["heading"]
        hfov = calibrate.LENS_HFOV.get(answer.get("lens"), calibrate.LENS_HFOV["normal"])
        aspect = 16 / 9
        horizon = max(-1.5, min(0.95, float(answer.get("horizon_y", 0.45))))
        # Same pinhole relation as calibrate.pose(), without its pole-camera clamps: a tripod can look level or up.
        pitch = math.degrees(math.atan((1 - 2 * horizon) * math.tan(math.radians(hfov / 2)) / aspect))
        poses[cam["id"]] = {
            "headingDeg": round(heading, 1),
            "pitchDeg": round(max(-10.0, min(30.0, pitch)), 1),
            "heightM": TRIPOD_HEIGHT_M,
            "hfovDeg": hfov,
            "aspect": round(aspect, 4),
            "source": os.environ["WANDB_VL_MODEL"],
            "confidence": answer.get("confidence"),
            "reason": answer.get("reason"),
            "street": (answer.get("candidate") or {}).get("street"),
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        print(f"pose  {cam['id']}: {poses[cam['id']]}")
    CALIBRATION.write_text(json.dumps(poses, indent=2) + "\n")


def main(args: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if "--calibrate" in args:
        calibrate_all()
        return
    for cam in cams():
        if args and cam["id"] not in args:
            continue
        mp4 = download(cam)
        poster(cam, mp4)
        track(cam, mp4)


if __name__ == "__main__":
    main(sys.argv[1:])
