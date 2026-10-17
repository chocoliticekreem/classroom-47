"""YOLO counts for TfL JamCams.

GET /counts?ids=JamCams_00001.03500,JamCams_00001.03506
    -> {"readings": [{"camId", "people", "vehicles", "at", "frame"}]}
GET /tracks?ids=...  -> {"clips": [{"camId", "at", "duration", "tracks": [{"id", "kind", "cls", "color", "pts": [[t, u, v]]}]}]}
    u, v = bottom-centre of the box, normalised to the frame (0..1).
    cls = YOLO class (person, car, bus, truck, motorcycle, bicycle); color = the object's median colour
    as "#rrggbb" (torso for people, body panel for vehicles), so the twin can draw it like the real one.
GET /frame?id=JamCams_00001.03500  -> annotated JPEG of the busiest analysed frame

Each clip is ~10s and TfL refreshes it every few minutes, so readings are cached per camera.
"""

import json
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np
from ultralytics import YOLO

PORT = 8047
TTL_S = 120
MAX_IDS = 12
STRIDE = 2  # analyse every 2nd frame (~12fps): enough for ByteTrack, half the cost
MIN_TRACK_POINTS = 4
PEOPLE = {0}
VEHICLES = {1, 2, 3, 5, 7}  # bicycle, car, motorcycle, bus, truck
CLASS_NAMES = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
# Part of the box to sample for colour, as (x0, x1, y0, y1) fractions: the torso, or the lower body panel (below the windows).
SAMPLE = {"person": (0.3, 0.7, 0.2, 0.45), "vehicle": (0.25, 0.75, 0.5, 0.8)}

model = YOLO("yolo11n.pt")
model_lock = threading.Lock()
cache: dict[str, dict] = {}
frames: dict[str, bytes] = {}
track_cache: dict[str, dict] = {}
inflight: set[str] = set()
state_lock = threading.Lock()
pool = ThreadPoolExecutor(max_workers=2)


def clip_url(cam_id: str) -> str:
    return f"https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/{cam_id.removeprefix('JamCams_')}.mp4"


def sample_color(frame, kind: str, x1: float, y1: float, x2: float, y2: float):
    """Median BGR of the sampled part of the box, or None when the box is too small to trust."""
    fx0, fx1, fy0, fy1 = SAMPLE[kind]
    w, h = x2 - x1, y2 - y1
    xa, xb = int(x1 + w * fx0), int(x1 + w * fx1)
    ya, yb = int(y1 + h * fy0), int(y1 + h * fy1)
    patch = frame[max(ya, 0):yb, max(xa, 0):xb]
    if patch.size < 3 * 4:
        return None
    return np.median(patch.reshape(-1, 3), axis=0)


def finish_track(t: dict) -> dict:
    """Collapse per-frame samples into one class (majority vote) and one colour (median)."""
    classes = t.pop("classes")
    colors = t.pop("colors")
    t["cls"] = max(set(classes), key=classes.count)
    if colors:
        b, g, r = (int(c) for c in np.median(np.array(colors), axis=0))
        t["color"] = f"#{r:02x}{g:02x}{b:02x}"
    return t


def track_clip(path: str):
    """Track people and vehicles through one clip. Returns counts, tracks and the busiest annotated frame."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    tracks: dict[int, dict] = {}
    people = vehicles = 0
    best_plot, best_total, idx = None, -1, 0
    # One lock for the whole clip: the tracker keeps state between frames, so clips can't interleave.
    with model_lock:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % STRIDE == 0:
                h, w = frame.shape[:2]
                result = model.track(
                    frame, imgsz=640, conf=0.25, persist=idx > 0, tracker="bytetrack.yaml",
                    classes=sorted(PEOPLE | VEHICLES), verbose=False,
                )[0]
                boxes = result.boxes
                classes = [int(c) for c in boxes.cls.tolist()]
                p = sum(c in PEOPLE for c in classes)
                v = sum(c in VEHICLES for c in classes)
                # Peak frame, not the average: a crowd crossing mid-clip is what matters.
                if p + v > best_total:
                    best_total, best_plot = p + v, result.plot(line_width=1, labels=False, conf=False)
                people, vehicles = max(people, p), max(vehicles, v)
                if boxes.id is not None:
                    for tid, c, (x1, y1, x2, y2) in zip(boxes.id.int().tolist(), classes, boxes.xyxy.tolist()):
                        kind = "person" if c in PEOPLE else "vehicle"
                        t = tracks.setdefault(tid, {"id": tid, "kind": kind, "pts": [], "classes": [], "colors": []})
                        # Bottom-centre of the box = where the object touches the ground.
                        t["pts"].append([round(idx / fps, 2), round((x1 + x2) / 2 / w, 4), round(y2 / h, 4)])
                        t["classes"].append(CLASS_NAMES.get(c, kind))
                        color = sample_color(frame, kind, x1, y1, x2, y2)
                        if color is not None:
                            t["colors"].append(color)
            idx += 1
    cap.release()
    kept = [finish_track(t) for t in tracks.values() if len(t["pts"]) >= MIN_TRACK_POINTS]
    return people, vehicles, kept, best_plot, round(idx / fps, 2)


def analyse(cam_id: str) -> None:
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
            req = urllib.request.Request(clip_url(cam_id), headers={"User-Agent": "classroom-47"})
            with urllib.request.urlopen(req, timeout=15) as res:
                tmp.write(res.read())
            tmp.flush()
            people, vehicles, kept, best_plot, duration = track_clip(tmp.name)
        at = int(time.time() * 1000)
        reading = {"camId": cam_id, "people": people, "vehicles": vehicles, "at": at}
        with state_lock:
            cache[cam_id] = reading
            track_cache[cam_id] = {"camId": cam_id, "at": at, "duration": duration, "tracks": kept}
            if best_plot is not None:
                ok, jpg = cv2.imencode(".jpg", best_plot, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    frames[cam_id] = jpg.tobytes()
    except Exception as e:  # noqa: BLE001 - one bad clip must not kill the batch
        print(f"[yolo] {cam_id} failed: {e}", flush=True)
    finally:
        with state_lock:
            inflight.discard(cam_id)


def schedule(cam_id: str) -> None:
    with state_lock:
        fresh = cam_id in cache and time.time() * 1000 - cache[cam_id]["at"] < TTL_S * 1000
        if fresh or cam_id in inflight:
            return
        inflight.add(cam_id)
    pool.submit(analyse, cam_id)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path == "/counts":
            ids = [i for i in q.get("ids", [""])[0].split(",") if i.startswith("JamCams_")][:MAX_IDS]
            for cam_id in ids:
                schedule(cam_id)
            with state_lock:
                readings = [
                    {**cache[i], "frame": i in frames} for i in ids if i in cache
                ]
                pending = [i for i in ids if i not in cache]
            self._send(200, json.dumps({"readings": readings, "pending": pending}).encode(), "application/json")
        elif url.path == "/tracks":
            ids = [i for i in q.get("ids", [""])[0].split(",") if i.startswith("JamCams_")][:MAX_IDS]
            for cam_id in ids:
                schedule(cam_id)
            with state_lock:
                clips = [track_cache[i] for i in ids if i in track_cache]
            self._send(200, json.dumps({"clips": clips}).encode(), "application/json")
        elif url.path == "/frame":
            with state_lock:
                jpg = frames.get(q.get("id", [""])[0])
            if jpg:
                self._send(200, jpg, "image/jpeg")
            else:
                self._send(404, b'{"error":"no frame yet"}', "application/json")
        elif url.path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
        else:
            self._send(404, b'{"error":"not found"}', "application/json")

    def log_message(self, *_args) -> None:
        pass


if __name__ == "__main__":
    print(f"[yolo] listening on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
