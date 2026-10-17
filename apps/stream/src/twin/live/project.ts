import type { AroundCam, TrackedObject } from "@/platform/around/types";
import { bearingDeg } from "@/platform/around/flows";
import { ORIGIN, toLocal } from "../config";

/**
 * Same projection as platform/around/flows.ts, in local metres: 60° FOV, ground distance from
 * 8 m (bottom of frame) to 85 m (top), heading from TfL view text else the bearing towards the origin.
 */
export const FOV_DEG = 60;
export const NEAR_M = 8;
export const FAR_M = 85;

export function camHeadingDeg(cam: AroundCam) {
  return cam.heading ?? bearingDeg(cam.lat, cam.lon, ORIGIN.lat, ORIGIN.lon);
}

export interface CamFrame {
  x: number;
  z: number;
  headingRad: number;
}

export function camFrame(cam: AroundCam): CamFrame {
  const [x, z] = toLocal(cam.lat, cam.lon);
  return { x, z, headingRad: (camHeadingDeg(cam) * Math.PI) / 180 };
}

/** Writes the ground point for frame coords (u, v) into `out` as [x, z]. Allocation-free. */
export function projectInto(frame: CamFrame, u: number, v: number, out: Float32Array | number[], o = 0) {
  const bearing = frame.headingRad + ((u - 0.5) * FOV_DEG * Math.PI) / 180;
  const vv = v < 0 ? 0 : v > 1 ? 1 : v;
  const d = NEAR_M + (FAR_M - NEAR_M) * Math.pow(1 - vv, 1.6);
  out[o] = frame.x + d * Math.sin(bearing);
  out[o + 1] = frame.z - d * Math.cos(bearing);
}

/** Interpolates a track at clip time t into out[o], out[o+1] = (u, v). Returns false outside the track. */
export function sampleInto(pts: TrackedObject["pts"], t: number, out: Float32Array | number[], o = 0) {
  const n = pts.length;
  if (n === 0 || t < pts[0][0] || t > pts[n - 1][0]) return false;
  for (let i = 1; i < n; i++) {
    const p1 = pts[i];
    if (p1[0] >= t) {
      const p0 = pts[i - 1];
      const k = p1[0] === p0[0] ? 0 : (t - p0[0]) / (p1[0] - p0[0]);
      out[o] = p0[1] + (p1[1] - p0[1]) * k;
      out[o + 1] = p0[2] + (p1[2] - p0[2]) * k;
      return true;
    }
  }
  return false;
}

/** View cone as a flat triangle fan in local metres: [apex, then points along the far arc]. */
export function viewConePoints(frame: CamFrame): [number, number][] {
  const pts: [number, number][] = [[frame.x, frame.z]];
  const half = (FOV_DEG / 2) * (Math.PI / 180);
  for (let a = -half; a <= half + 1e-6; a += (5 * Math.PI) / 180) {
    const b = frame.headingRad + a;
    pts.push([frame.x + FAR_M * Math.sin(b), frame.z - FAR_M * Math.cos(b)]);
  }
  return pts;
}
