"use client";

import { MapControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MapControls as MapControlsImpl } from "three-stdlib";
import { toLocal } from "../config";
import { FAR_M, FOV_DEG } from "../live/project";
import { useLive } from "../live/store";
import { PRESETS, useCameraStore } from "./cameraStore";

const DEFAULT_FOV = 50;
const CCTV_HEIGHT_M = 6;
const EYE_HEIGHT_M = 1.7;
const STREAMER_FOV = 65;
const TOWER_BRIDGE = { lat: 51.5055, lon: -0.0754 };
const DRAG_RAD_PER_PX = 0.0045;
const TRAVEL_MIN_M = 1.5;

const goalPos = new THREE.Vector3();
const goalTarget = new THREE.Vector3();
const streamerGoal = new THREE.Vector3();
const _look = new THREE.Vector3();
const toLocalBridge = toLocal(TOWER_BRIDGE.lat, TOWER_BRIDGE.lon);

/** Vertical FOV that gives a 60° horizontal FOV (project.ts) at the given aspect. */
function verticalFovDeg(aspect: number) {
  const half = Math.tan((FOV_DEG * Math.PI) / 360) / aspect;
  return (Math.atan(half) * 360) / Math.PI;
}

/** Pitch so the far edge of the YOLO ground band (85 m) sits in the upper part of the frame. */
function cctvPitchRad(vfovDeg: number) {
  const toFar = Math.atan(CCTV_HEIGHT_M / FAR_M);
  return toFar + ((vfovDeg / 2) * Math.PI * 0.35) / 180;
}

function bearingRad(ax: number, az: number, bx: number, bz: number) {
  return Math.atan2(bx - ax, -(bz - az));
}

function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function CameraRig() {
  const controls = useRef<MapControlsImpl>(null);
  const flying = useRef(false);
  const flight = useCameraStore((s) => s.flight);
  const preset = useCameraStore((s) => s.preset);
  const cctv = useCameraStore((s) => s.cctv);
  const { gl, size } = useThree();
  const firstPerson = !cctv && preset === "streamer";

  const fp = useRef({ yaw: 0, travelYaw: 0, hasTravel: false, dragYaw: 0, dragPitch: 0, dragging: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    if (cctv) {
      const vfov = verticalFovDeg(size.width / 2 / size.height);
      const pitch = cctvPitchRad(vfov);
      goalPos.set(cctv.x, CCTV_HEIGHT_M, cctv.z);
      const d = 30;
      goalTarget.set(
        cctv.x + d * Math.cos(pitch) * Math.sin(cctv.headingRad),
        CCTV_HEIGHT_M - d * Math.sin(pitch),
        cctv.z - d * Math.cos(pitch) * Math.cos(cctv.headingRad),
      );
      flying.current = true;
      return;
    }
    if (preset === "streamer") {
      flying.current = false;
      fp.current.dragYaw = 0;
      fp.current.dragPitch = 0;
      return;
    }
    goalPos.set(...PRESETS[preset].pos);
    goalTarget.set(...PRESETS[preset].target);
    flying.current = true;
  }, [flight, preset, cctv, size.width, size.height]);

  const projectionDirty = useRef(true);
  useEffect(() => {
    projectionDirty.current = true;
  }, [cctv, firstPerson, size.width, size.height]);

  useEffect(() => {
    const apply = (s: { streamer: { lat: number; lon: number } }) => {
      const [x, z] = toLocal(s.streamer.lat, s.streamer.lon);
      const dx = x - streamerGoal.x;
      const dz = z - streamerGoal.z;
      if (streamerGoal.lengthSq() > 0 && dx * dx + dz * dz > TRAVEL_MIN_M * TRAVEL_MIN_M) {
        fp.current.travelYaw = bearingRad(streamerGoal.x, streamerGoal.z, x, z);
        fp.current.hasTravel = true;
      }
      streamerGoal.set(x, EYE_HEIGHT_M, z);
    };
    apply(useLive.getState());
    return useLive.subscribe(apply);
  }, []);

  useEffect(() => {
    if (!firstPerson) return;
    const el = gl.domElement;
    const f = fp.current;
    const down = (e: PointerEvent) => {
      f.dragging = true;
      f.lastX = e.clientX;
      f.lastY = e.clientY;
    };
    const move = (e: PointerEvent) => {
      if (!f.dragging) return;
      f.dragYaw += (e.clientX - f.lastX) * DRAG_RAD_PER_PX;
      f.dragPitch = Math.max(-1.2, Math.min(1.2, f.dragPitch + (e.clientY - f.lastY) * DRAG_RAD_PER_PX));
      f.lastX = e.clientX;
      f.lastY = e.clientY;
    };
    const up = () => {
      f.dragging = false;
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [firstPerson, gl]);

  useFrame(({ camera }, dt) => {
    const step = Math.min(dt, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    if (projectionDirty.current) {
      projectionDirty.current = false;
      if (cctv) {
        cam.fov = verticalFovDeg(size.width / 2 / size.height);
        cam.setViewOffset(size.width / 2, size.height, -size.width / 2, 0, size.width, size.height);
      } else {
        cam.fov = firstPerson ? STREAMER_FOV : DEFAULT_FOV;
        cam.clearViewOffset();
      }
      cam.updateProjectionMatrix();
    }
    if (cctv) {
      const aspect = size.width / 2 / size.height;
      if (Math.abs(cam.aspect - aspect) > 1e-4) {
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
      }
    }
    if (firstPerson) {
      const f = fp.current;
      const k = 1 - Math.exp(-3 * step);
      camera.position.lerp(streamerGoal, k);
      const [bx, bz] = toLocalBridge;
      const baseYaw = f.hasTravel ? f.travelYaw : bearingRad(camera.position.x, camera.position.z, bx, bz);
      f.yaw = lerpAngle(f.yaw, baseYaw, 1 - Math.exp(-2 * step));
      const yaw = f.yaw + f.dragYaw;
      const pitch = -f.dragPitch;
      _look.set(
        camera.position.x + Math.cos(pitch) * Math.sin(yaw),
        camera.position.y + Math.sin(pitch),
        camera.position.z - Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(_look);
      return;
    }
    const c = controls.current;
    if (!c || !flying.current) return;
    const k = 1 - Math.exp(-2.2 * step);
    camera.position.lerp(goalPos, k);
    c.target.lerp(goalTarget, k);
    if (camera.position.distanceTo(goalPos) < 0.3 && c.target.distanceTo(goalTarget) < 0.3) {
      flying.current = false;
    }
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enabled={!firstPerson}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={cctv ? 1 : 12}
      maxDistance={1800}
      onStart={() => {
        flying.current = false;
      }}
    />
  );
}
