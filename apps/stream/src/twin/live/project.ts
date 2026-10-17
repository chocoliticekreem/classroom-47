import type { AroundCam, TrackedObject } from "@/platform/around/types";
import { bearingDeg } from "@/platform/around/flows";
import { ORIGIN, toLocal } from "../config";
import CALIBRATION from "./calibration.json";

/**
 * One pinhole camera model shared by the ground projection (YOLO u,v → street) and the twin's virtual
 * CCTV camera (CameraRig). Because both use the same pose, a simulated person or car lands on the same
 * pixel as the real one in the compare view. Per-camera poses come from calibration.json, written by
 * services/vision/calibrate.py (Nemotron 3.5 Super VL); cameras without one use a typical JamCam pose.
 */

export interface CamCalibration {
  headingDeg: number;
  pitchDeg: number;
  heightM: number;
  hfovDeg: number;
  /** Width / height of the real camera's frame. */
  aspect: number;
  source?: string;
  confidence?: number;
  reason?: string;
  street?: string;
}

const CALIBRATIONS = CALIBRATION as Record<string, CamCalibration>;

/** Typical TfL JamCam: ~7 m pole, tilted ~15° down, 352×288 frame. */
export const DEFAULT_POSE = { pitchDeg: 15, heightM: 7, hfovDeg: 60, aspect: 352 / 288 } as const;
/** Rays that meet the ground further than this (or never) are clamped here along their bearing. */
export const MAX_GROUND_M = 150;
/** Far edge of the drawn view cone. */
export const CONE_M = 90;

export function calibrationFor(camId: string): CamCalibration | null {
  return CALIBRATIONS[camId] ?? null;
}

export function camHeadingDeg(cam: AroundCam) {
  return calibrationFor(cam.id)?.headingDeg ?? cam.heading ?? bearingDeg(cam.lat, cam.lon, ORIGIN.lat, ORIGIN.lon);
}

export interface CamFrame {
  x: number;
  z: number;
  /** Compass heading, 0 = north (-z), clockwise. */
  headingRad: number;
  /** Downward tilt. */
  pitchRad: number;
  heightM: number;
  /** tan(half horizontal FOV) and tan(half vertical FOV) of the real frame. */
  tanH: number;
  tanV: number;
  aspect: number;
  calibrated: boolean;
}

export function camFrame(cam: AroundCam): CamFrame {
  const [x, z] = toLocal(cam.lat, cam.lon);
  const cal = calibrationFor(cam.id);
  const hfov = cal?.hfovDeg ?? DEFAULT_POSE.hfovDeg;
  const aspect = cal?.aspect ?? DEFAULT_POSE.aspect;
  const tanH = Math.tan((hfov * Math.PI) / 360);
  return {
    x,
    z,
    headingRad: (camHeadingDeg(cam) * Math.PI) / 180,
    pitchRad: ((cal?.pitchDeg ?? DEFAULT_POSE.pitchDeg) * Math.PI) / 180,
    heightM: cal?.heightM ?? DEFAULT_POSE.heightM,
    tanH,
    tanV: tanH / aspect,
    aspect,
    calibrated: cal !== null,
  };
}

/** Unit-free forward direction of the camera as [x, y, z]. */
export function forwardOf(frame: CamFrame): [number, number, number] {
  const sh = Math.sin(frame.headingRad);
  const ch = Math.cos(frame.headingRad);
  const sp = Math.sin(frame.pitchRad);
  const cp = Math.cos(frame.pitchRad);
  return [sh * cp, -sp, -ch * cp];
}

/**
 * Writes the ground point seen at frame coords (u, v) into `out` as [x, z]: the ray through that pixel
 * meets the road (y = 0). Same maths as a three.js PerspectiveCamera at the frame's pose. Allocation-free.
 */
export function projectInto(frame: CamFrame, u: number, v: number, out: Float32Array | number[], o = 0, maxM = MAX_GROUND_M) {
  const sh = Math.sin(frame.headingRad);
  const ch = Math.cos(frame.headingRad);
  const sp = Math.sin(frame.pitchRad);
  const cp = Math.cos(frame.pitchRad);
  const xn = (2 * u - 1) * frame.tanH;
  const yn = (1 - 2 * v) * frame.tanV;
  // ray = forward + xn·right + yn·up, with right = (cos h, 0, sin h) and up tilted with the pitch
  const dx = sh * cp + xn * ch + yn * sh * sp;
  const dy = -sp + yn * cp;
  const dz = -ch * cp + xn * sh - yn * ch * sp;
  const flat = Math.hypot(dx, dz) || 1e-9;
  let reach = dy < -1e-6 ? (frame.heightM / -dy) * flat : maxM;
  if (reach > maxM) reach = maxM;
  out[o] = frame.x + (dx / flat) * reach;
  out[o + 1] = frame.z + (dz / flat) * reach;
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

/** View cone as a flat triangle fan in local metres: [apex, then the ground seen along the top of the frame]. */
export function viewConePoints(frame: CamFrame): [number, number][] {
  const pts: [number, number][] = [[frame.x, frame.z]];
  const out = [0, 0];
  for (let i = 0; i <= 12; i++) {
    projectInto(frame, i / 12, 0, out, 0, CONE_M);
    pts.push([out[0], out[1]]);
  }
  return pts;
}
