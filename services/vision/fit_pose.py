"""Fit a CCTV camera's pose so the real vehicle tracks it sees land on OpenStreetMap's roads.

The projection here is the same pinhole maths as apps/stream/src/twin/live/project.ts: a pixel's ray from a
camera at height h, heading ψ (0 = north, clockwise), pitched down θ, meets the road at y = 0. Vehicles drive
on roads, so the right pose is the one where YOLO's projected vehicle points sit closest to road centre
lines. A grid search over heading, pitch, height and lens width finds it, starting from the VLM's estimate.
"""

import math
import time

import cv2
import numpy as np
import requests

UA = {"User-Agent": "classroom-47-hackathon/0.1"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
ROADS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|motorway_link|trunk_link|primary_link|secondary_link"
RADIUS_M = 220
MAX_GROUND_M = 150  # same clamp as project.ts
CLIP_M = 15.0  # a point further than this from any road counts as this far (robust to stray detections)


def road_distance_field(lat: float, lon: float) -> np.ndarray:
    """Metres from each 1 m cell to the nearest road centre line, in a square centred on the camera.
    Row = south offset + R, column = east offset + R."""
    q = f'[out:json][timeout:40];way(around:{RADIUS_M},{lat},{lon})["highway"~"^({ROADS})$"];out geom;'
    for attempt, url in enumerate(OVERPASS * 2):
        try:
            res = requests.post(url, data={"data": q}, headers=UA, timeout=60)
            res.raise_for_status()
            break
        except requests.RequestException:
            if attempt == len(OVERPASS) * 2 - 1:
                raise
            time.sleep(2)
    size = 2 * RADIUS_M + 1
    mask = np.full((size, size), 255, np.uint8)
    cos = math.cos(math.radians(lat))
    for way in res.json()["elements"]:
        pts = np.array([[(p["lon"] - lon) * 111_320 * cos + RADIUS_M, -(p["lat"] - lat) * 111_320 + RADIUS_M] for p in way.get("geometry") or []])
        if len(pts) >= 2:
            cv2.polylines(mask, [np.round(pts).astype(np.int32)], False, 0, 1)
    return cv2.distanceTransform(mask, cv2.DIST_L2, 5)


def project(u: np.ndarray, v: np.ndarray, heading: np.ndarray, pitch: float, height: float, tan_h: float, tan_v: float):
    """Ground points (east, south) in metres from the camera, for every heading at once: shape (headings, points)."""
    sh, ch = np.sin(heading)[:, None], np.cos(heading)[:, None]
    sp, cp = math.sin(pitch), math.cos(pitch)
    xn = (2 * u - 1)[None, :] * tan_h
    yn = (1 - 2 * v)[None, :] * tan_v
    dx = sh * cp + xn * ch + yn * sh * sp
    dy = (-sp + yn * cp) * np.ones_like(sh)
    dz = -ch * cp + xn * sh - yn * ch * sp
    flat = np.hypot(dx, dz) + 1e-9
    reach = np.where(dy < -1e-6, height / np.maximum(-dy, 1e-6) * flat, MAX_GROUND_M)
    reach = np.minimum(reach, MAX_GROUND_M)
    return dx / flat * reach, dz / flat * reach


def score(field: np.ndarray, x: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Mean clipped distance to the nearest road for each heading row."""
    col = np.round(x + RADIUS_M).astype(int)
    row = np.round(z + RADIUS_M).astype(int)
    inside = (col >= 0) & (col < field.shape[1]) & (row >= 0) & (row < field.shape[0])
    d = np.full(x.shape, CLIP_M)
    d[inside] = np.minimum(field[row[inside], col[inside]], CLIP_M)
    return d.mean(axis=1)


def fit(field: np.ndarray, uv: np.ndarray, aspect: float, prior: dict, heading_window: tuple[float, float] | None) -> dict:
    """Coarse-to-fine search. `prior` holds the VLM's pose; small penalties keep height and pitch near it
    when the road fit alone can't tell them apart (they trade off against each other)."""
    u, v = uv[:, 0], uv[:, 1]

    def search(headings_deg, pitches, heights, hfovs):
        best = (1e9, None)
        hd = np.radians(np.asarray(headings_deg, float))
        for hfov in hfovs:
            tan_h = math.tan(math.radians(hfov / 2))
            tan_v = tan_h / aspect
            for pitch in pitches:
                for height in heights:
                    x, z = project(u, v, hd, math.radians(pitch), height, tan_h, tan_v)
                    s = score(field, x, z)
                    # Narrow lenses and low cameras squeeze every point onto one road and always "fit", so lens
                    # width and height stay near the VLM's estimate; the fit mostly decides heading and pitch.
                    s = s + 0.04 * (height - prior["heightM"]) ** 2 + 0.01 * (pitch - prior["pitchDeg"]) ** 2 + 0.02 * (hfov - prior["hfovDeg"]) ** 2
                    i = int(np.argmin(s))
                    if s[i] < best[0]:
                        best = (float(s[i]), {"headingDeg": float(headings_deg[i]) % 360, "pitchDeg": pitch, "heightM": height, "hfovDeg": hfov})
        return best

    if heading_window:
        lo, hi = heading_window
        coarse_h = np.arange(lo, hi + 0.01, 2.0)
    else:
        coarse_h = np.arange(0, 360, 2.0)
    lens = prior["hfovDeg"]
    err, pose = search(coarse_h, np.arange(4, 41, 2.0), [5, 6, 7, 8, 9, 10], [lens - 8, lens, lens + 8])
    err, pose = search(
        np.arange(pose["headingDeg"] - 3, pose["headingDeg"] + 3.01, 0.5),
        np.arange(max(2, pose["pitchDeg"] - 2), pose["pitchDeg"] + 2.01, 0.5),
        np.arange(max(5, pose["heightM"] - 1), min(10, pose["heightM"] + 1) + 0.01, 0.5),
        np.arange(pose["hfovDeg"] - 4, pose["hfovDeg"] + 4.01, 2.0),
    )
    # Same scoring at the VLM's own pose, to report how much the fit improved on it.
    tan_h = math.tan(math.radians(prior["hfovDeg"] / 2))
    x, z = project(u, v, np.radians([prior["headingDeg"]]), math.radians(prior["pitchDeg"]), prior["heightM"], tan_h, tan_h / aspect)
    prior_err = float(score(field, x, z)[0])
    return {**{k: round(float(val), 2) for k, val in pose.items()}, "fitErrorM": round(err, 2), "priorErrorM": round(prior_err, 2)}
