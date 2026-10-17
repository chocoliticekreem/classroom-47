"""Calibrate TfL JamCam poses with Nemotron 3.5 Super VL so the 3D twin sees what the real camera sees.

    uv run python calibrate.py                      # cameras within 700 m of Tower Hill (the twin's area)
    uv run python calibrate.py JamCams_00001.03500  # specific cameras
    uv run python calibrate.py --fit                # also fit YOLO vehicle tracks to OSM roads (experimental)

For each camera: grab the live still, list the streets at the camera from OpenStreetMap with their
compass bearings, and ask the VLM which way the camera looks, where the horizon sits, how high the
camera is and how wide the lens is. The answer becomes a pinhole pose (heading, pitch, height,
horizontal FOV) in apps/stream/src/twin/live/calibration.json, which both the ground projection and
the twin's virtual CCTV camera read, so simulated people and cars land on the same pixels as the
real ones.
"""

import base64
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from dotenv import load_dotenv
from openai import OpenAI

import fit_pose

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")

OUT = HERE.parent.parent / "apps" / "stream" / "src" / "twin" / "live" / "calibration.json"
TOWER_HILL = (51.5098, -0.0766)
RADIUS_M = 700
STREET_RADIUS_M = 45
LENS_HFOV = {"wide": 70.0, "normal": 55.0, "zoom": 32.0}
YOLO_URL = os.environ.get("JAMCAM_YOLO_URL", "http://127.0.0.1:8047")
MIN_FIT_POINTS = 40
FIT = "--fit" in sys.argv
UA = {"User-Agent": "classroom-47-hackathon/0.1"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

PROMPT = """You are calibrating a fixed London traffic CCTV camera (TfL JamCam) so a 3D model of the street can be rendered from exactly the same viewpoint.

Camera: "{name}". TfL's note on its view: "{view}".
Streets meeting at the camera position (from OpenStreetMap), with the compass direction you would face looking along each way:
{candidates}

Look at the image and answer with JSON only:
{{
  "facing": "<letter of the option that best matches the direction the camera looks>",
  "horizon_y": <where the horizon / vanishing point of the road sits, as a fraction of image height from the top; negative if it is above the frame>,
  "camera_height_m": <height of the camera above the road in metres>,
  "lens": "wide" | "normal" | "zoom",
  "confidence": <0..1>,
  "reason": "<one short sentence>"
}}"""


def vlm() -> OpenAI:
    return OpenAI(base_url=os.environ["WANDB_INFERENCE_URL"], api_key=os.environ["WANDB_API_KEY"])


def tfl_cams() -> list[dict]:
    res = requests.get("https://api.tfl.gov.uk/Place/Type/JamCam", headers=UA, timeout=30)
    res.raise_for_status()
    cams = []
    for c in res.json():
        p = {x["key"]: x["value"] for x in c["additionalProperties"]}
        cams.append({"id": c["id"], "name": c["commonName"], "lat": c["lat"], "lon": c["lon"],
                     "view": p.get("view", ""), "image": p.get("imageUrl"), "available": p.get("available") == "true"})
    return cams


def dist_m(a_lat, a_lon, b_lat, b_lon) -> float:
    return math.hypot((a_lat - b_lat) * 111_320, (a_lon - b_lon) * 111_320 * math.cos(math.radians(a_lat)))


def bearing(a_lat, a_lon, b_lat, b_lon) -> float:
    y = math.sin(math.radians(b_lon - a_lon)) * math.cos(math.radians(b_lat))
    x = math.cos(math.radians(a_lat)) * math.sin(math.radians(b_lat)) - math.sin(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.cos(math.radians(b_lon - a_lon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass(deg: float) -> str:
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][round(deg / 45) % 8]


def street_candidates(lat: float, lon: float) -> list[dict]:
    """Both directions along each named road near the camera, using the road segment closest to it."""
    q = f'[out:json][timeout:30];way(around:{STREET_RADIUS_M},{lat},{lon})["highway"]["name"];out geom;'
    for attempt, url in enumerate(OVERPASS * 2):
        try:
            res = requests.post(url, data={"data": q}, headers=UA, timeout=60)
            res.raise_for_status()
            break
        except requests.RequestException:
            if attempt == len(OVERPASS) * 2 - 1:
                raise
            time.sleep(2)
    best: dict[str, tuple[float, float]] = {}
    for way in res.json()["elements"]:
        g = way.get("geometry") or []
        for a, b in zip(g, g[1:]):
            mid = ((a["lat"] + b["lat"]) / 2, (a["lon"] + b["lon"]) / 2)
            d = dist_m(lat, lon, *mid)
            name = way["tags"]["name"]
            if name not in best or d < best[name][1]:
                best[name] = (bearing(a["lat"], a["lon"], b["lat"], b["lon"]), d)
    out = []
    for name, (b, _) in sorted(best.items(), key=lambda kv: kv[1][1]):
        for heading in (b, (b + 180) % 360):
            out.append({"street": name, "heading": round(heading, 1)})
    return out


COMPASS = {"NORTH": 0, "N": 0, "EAST": 90, "E": 90, "SOUTH": 180, "S": 180, "WEST": 270, "W": 270}


def tfl_heading(view: str) -> float | None:
    """TfL's view note often states the direction, e.g. "WEST-twds Blackfriars" or "Zoom West-Twd Minories"."""
    import re
    m = re.search(r"\b(NORTH|SOUTH|EAST|WEST)\b", view.upper()) or re.match(r"^([NSEW])\b", view.strip().upper())
    return COMPASS[m.group(1)] if m else None


def agrees(heading: float, stated: float, tolerance: float = 67.5) -> bool:
    return abs((heading - stated + 180) % 360 - 180) <= tolerance


def ask(cam: dict, jpeg: bytes, candidates: list[dict]) -> dict:
    letters = "ABCDEFGHIJKLMNOP"
    lines = "\n".join(f"{letters[i]}: along {c['street']}, facing {compass(c['heading'])} ({c['heading']:.0f}°)" for i, c in enumerate(candidates))
    msg = [{"role": "user", "content": [
        {"type": "text", "text": PROMPT.format(name=cam["name"], view=cam["view"], candidates=lines)},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
    ]}]
    res = vlm().chat.completions.create(
        model=os.environ["WANDB_VL_MODEL"], messages=msg, max_tokens=400, temperature=0,
        # Nemotron VL reasons by default and would spend the whole budget thinking.
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    text = res.choices[0].message.content or ""
    answer = json.loads(text[text.find("{"): text.rfind("}") + 1])
    pick = letters.find(str(answer.get("facing", "")).strip()[:1].upper())
    answer["candidate"] = candidates[pick] if 0 <= pick < len(candidates) else None
    return answer


def pose(answer: dict, aspect: float) -> dict:
    """Pinhole pose from the VLM's answer. Pitch comes from the horizon: a horizontal ray hits the image at y = tan(pitch)."""
    hfov = LENS_HFOV.get(answer.get("lens"), LENS_HFOV["normal"])
    tan_v = math.tan(math.radians(hfov / 2)) / aspect
    horizon = max(-1.5, min(0.95, float(answer.get("horizon_y", 0.25))))
    pitch = math.degrees(math.atan((1 - 2 * horizon) * tan_v))
    return {
        "headingDeg": answer["candidate"]["heading"],
        "pitchDeg": round(max(3.0, min(60.0, pitch)), 1),
        "heightM": round(max(3.0, min(25.0, float(answer.get("camera_height_m", 7)))), 1),
        "hfovDeg": hfov,
        "aspect": round(aspect, 4),
    }


def vehicle_points(cam_id: str) -> np.ndarray:
    """(u, v) bottom-centre points of every vehicle track YOLO has for this camera (services/yolo must be running)."""
    try:
        clips = requests.get(f"{YOLO_URL}/tracks", params={"ids": cam_id}, timeout=10).json().get("clips", [])
    except requests.RequestException:
        return np.zeros((0, 2))
    pts = [(p[1], p[2]) for c in clips for t in c["tracks"] if t["kind"] == "vehicle" for p in t["pts"]]
    return np.array(pts[:: max(1, len(pts) // 800)]) if pts else np.zeros((0, 2))


def calibrate(cam: dict) -> dict | None:
    jpeg = requests.get(cam["image"], headers=UA, timeout=20).content
    import cv2
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    candidates = street_candidates(cam["lat"], cam["lon"])
    # TfL's stated direction is ground truth when it exists; the model then picks among streets that agree with it.
    stated = tfl_heading(cam["view"])
    if stated is not None and any(agrees(c["heading"], stated) for c in candidates):
        candidates = [c for c in candidates if agrees(c["heading"], stated)]
    if not candidates:
        print(f"  {cam['id']}: no named streets within {STREET_RADIUS_M} m, skipped")
        return None
    t = time.time()
    answer = ask(cam, jpeg, candidates)
    if not answer["candidate"]:
        print(f"  {cam['id']}: model picked no valid option ({answer.get('facing')!r}), skipped")
        return None
    p = pose(answer, w / h)
    print(f"  {cam['id']} {cam['name']}: facing {answer['candidate']['street']} {p['headingDeg']:.0f}°, "
          f"pitch {p['pitchDeg']}°, height {p['heightM']} m, {answer.get('lens')} lens, "
          f"confidence {answer.get('confidence')} ({time.time() - t:.1f}s) - {answer.get('reason')}")
    result = {**p, "source": os.environ["WANDB_VL_MODEL"], "confidence": answer.get("confidence"),
              "reason": answer.get("reason"), "street": answer["candidate"]["street"],
              "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}

    # Optional refinement (--fit): the pose where YOLO's vehicle tracks land on OpenStreetMap's roads. Off by
    # default: near junctions it is ambiguous (a steep tilt pulls every point onto the road under the camera),
    # so the compare view's Align controls are the reliable way to finish a pose.
    if not FIT:
        return result
    uv = vehicle_points(cam["id"])
    if len(uv) < MIN_FIT_POINTS:
        print(f"    only {len(uv)} vehicle points from YOLO, keeping the VLM pose (start services/yolo and retry)")
        return result
    # A straight road fits equally well facing either way, so the search stays near a known direction:
    # TfL's stated one, else the VLM's.
    window = (stated - 70, stated + 70) if stated is not None else (p["headingDeg"] - 60, p["headingDeg"] + 60)
    fitted = fit_pose.fit(fit_pose.road_distance_field(cam["lat"], cam["lon"]), uv, w / h, p, window)
    print(f"    fitted to roads with {len(uv)} vehicle points: facing {fitted['headingDeg']:.0f}°, pitch {fitted['pitchDeg']}°, "
          f"height {fitted['heightM']} m, {fitted['hfovDeg']}° lens; mean distance to a road {fitted['priorErrorM']} m -> {fitted['fitErrorM']} m")
    return {**result, **fitted, "vlm": p, "fitPoints": len(uv),
            "source": f"{os.environ['WANDB_VL_MODEL']} estimate, refined by fitting YOLO vehicle tracks to OpenStreetMap roads"}


def main(ids: list[str]) -> None:
    try:
        import weave
        weave.init(f"{os.environ['WANDB_TEAM']}/{os.environ.get('WANDB_PROJECT', 'classroom-47')}")
        global ask
        ask = weave.op(ask)
    except Exception as e:  # tracing is a bonus; calibration must still run
        print(f"(Weave tracing off: {e})")
    cams = tfl_cams()
    if ids:
        cams = [c for c in cams if c["id"] in ids]
    else:
        cams = [c for c in cams if c["available"] and dist_m(*TOWER_HILL, c["lat"], c["lon"]) <= RADIUS_M]
    print(f"Calibrating {len(cams)} cameras with {os.environ['WANDB_VL_MODEL']}")
    existing = json.loads(OUT.read_text()) if OUT.exists() else {}
    for cam in cams:
        try:
            result = calibrate(cam)
        except Exception as e:  # one bad camera must not stop the rest
            print(f"  {cam['id']}: failed ({type(e).__name__}: {e})")
            continue
        if result:
            existing[cam["id"]] = result
        time.sleep(1)  # Overpass etiquette
    OUT.write_text(json.dumps(existing, indent=2) + "\n")
    print(f"Wrote {len(existing)} calibrations to {OUT}")


if __name__ == "__main__":
    main([a for a in sys.argv[1:] if not a.startswith("--")])
