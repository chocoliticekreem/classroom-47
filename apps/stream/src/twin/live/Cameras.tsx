"use client";

import { Billboard } from "@react-three/drei";
import { Label } from "./Label";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { AroundCam } from "@/platform/around/types";
import { camFrame, viewConePoints } from "./project";
import { useCompare } from "../compare/store";
import { useLive } from "./store";

const POLE_H = 7;
const SCREEN_W = 12;
const SCREEN_H = 9;
const FRAME_REFRESH_MS = 15_000;

type ScreenMode = "loading" | "video" | "frame";

/** Live clip as a VideoTexture when TfL's S3 allows CORS; otherwise the same-origin annotated frame. */
function useScreenTexture(cam: AroundCam) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [mode, setMode] = useState<ScreenMode>("loading");

  useEffect(() => {
    let disposed = false;
    let current: THREE.Texture | null = null;
    let frameTimer: ReturnType<typeof setInterval> | null = null;
    const loader = new THREE.TextureLoader();

    const swap = (t: THREE.Texture) => {
      if (disposed) {
        t.dispose();
        return;
      }
      current?.dispose();
      current = t;
      t.colorSpace = THREE.SRGBColorSpace;
      setTexture(t);
    };

    const loadFrame = () => {
      loader.load(`/api/around/frame?id=${encodeURIComponent(cam.id)}&t=${Date.now()}`, swap, undefined, () => {});
    };

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    const onError = () => {
      if (disposed) return;
      setMode("frame");
      useLive.setState((s) => (s.screenMode === "video" ? {} : { screenMode: "frame" }));
      loadFrame();
      frameTimer = setInterval(loadFrame, FRAME_REFRESH_MS);
    };
    const onReady = () => {
      if (disposed) return;
      const t = new THREE.VideoTexture(video);
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      swap(t);
      setMode("video");
      useLive.setState({ screenMode: "video" });
      void video.play().catch(() => {});
    };
    video.addEventListener("error", onError);
    video.addEventListener("loadeddata", onReady);
    video.src = cam.videoUrl;

    return () => {
      disposed = true;
      video.removeEventListener("error", onError);
      video.removeEventListener("loadeddata", onReady);
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (frameTimer) clearInterval(frameTimer);
      current?.dispose();
    };
  }, [cam.id, cam.videoUrl]);

  return { texture, mode };
}

function Camera({ cam }: { cam: AroundCam }) {
  const clip = useLive((s) => s.clips[cam.id]);
  const { texture, mode } = useScreenTexture(cam);
  const frame = useMemo(() => camFrame(cam), [cam]);
  const comparing = useCompare((s) => s.camId === cam.id);
  const open = useCompare((s) => s.open);

  const cone = useMemo(() => {
    const pts = viewConePoints(frame);
    const g = new THREE.BufferGeometry();
    const n = pts.length - 1;
    const pos = new Float32Array(n * 3 * 3);
    for (let i = 1; i < n; i++) {
      const o = (i - 1) * 9;
      pos[o] = pts[0][0];
      pos[o + 1] = 0;
      pos[o + 2] = pts[0][1];
      pos[o + 3] = pts[i][0];
      pos[o + 4] = 0;
      pos[o + 5] = pts[i][1];
      pos[o + 6] = pts[i + 1][0];
      pos[o + 7] = 0;
      pos[o + 8] = pts[i + 1][1];
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [frame]);
  useEffect(() => () => cone.dispose(), [cone]);

  const counts = useMemo(() => {
    let people = 0;
    let vehicles = 0;
    for (const t of clip?.tracks ?? []) {
      if (t.kind === "person") people++;
      else vehicles++;
    }
    return { people, vehicles };
  }, [clip]);

  return (
    <group visible={!comparing}>
      <mesh geometry={cone} position={[0, 0.08, 0]} renderOrder={1}>
        <meshBasicMaterial
          color="#ff4d2e"
          transparent
          opacity={0.14}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <group position={[frame.x, 0, frame.z]}>
        <mesh position={[0, POLE_H / 2, 0]}>
          <cylinderGeometry args={[0.18, 0.22, POLE_H, 8]} />
          <meshStandardMaterial color="#2c2c36" roughness={0.6} metalness={0.5} />
        </mesh>
        <mesh position={[0, POLE_H, 0]}>
          <sphereGeometry args={[0.45, 12, 10]} />
          <meshStandardMaterial color="#ff2d55" emissive="#ff2d55" emissiveIntensity={2} />
        </mesh>
        <Billboard position={[0, POLE_H + SCREEN_H / 2 + 1.5, 0]}>
          <mesh position={[0, 0, -0.1]}>
            <planeGeometry args={[SCREEN_W + 0.6, SCREEN_H + 0.6]} />
            <meshBasicMaterial color="#0c0c10" />
          </mesh>
          <mesh onClick={(e) => (e.stopPropagation(), open(cam.id))}>
            <planeGeometry args={[SCREEN_W, SCREEN_H]} />
            {texture ? (
              <meshBasicMaterial key="live" map={texture} toneMapped={false} />
            ) : (
              <meshBasicMaterial key="blank" color="#131318" />
            )}
          </mesh>
        </Billboard>
        <Label position={[0, POLE_H + SCREEN_H + 3.2, 0]}>
          <div
            role="button"
            onClick={() => open(cam.id)}
            style={{
              pointerEvents: "auto",
              cursor: "pointer",
              fontFamily: "var(--font-figtree), system-ui, sans-serif",
              background: "rgba(12,12,16,0.78)",
              border: `1px solid ${comparing ? "var(--ember)" : "var(--border-strong)"}`,
              borderRadius: 10,
              padding: "6px 10px",
              color: "var(--text)",
              whiteSpace: "nowrap",
              fontSize: 12,
              lineHeight: 1.3,
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: mode === "loading" ? "var(--muted)" : "var(--live)",
                  boxShadow: mode === "loading" ? "none" : "0 0 8px var(--live)",
                }}
              />
              {cam.name}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>
              {clip ? (
                <>
                  <span style={{ color: "#ffb37a" }}>{counts.people} people</span>
                  {" · "}
                  <span style={{ color: "#9fd3ff" }}>{counts.vehicles} vehicles</span>
                </>
              ) : (
                "analysing clip…"
              )}
              {mode === "frame" ? " · frame" : mode === "video" ? " · video" : ""}
            </div>
            <div style={{ color: comparing ? "var(--ember)" : "var(--dim)", fontSize: 11, marginTop: 2 }}>
              {comparing ? "Comparing" : "Click to compare with real CCTV"}
            </div>
          </div>
        </Label>
      </group>
    </group>
  );
}

export function Cameras() {
  const cams = useLive((s) => s.cams);
  return (
    <group>
      {cams.map((cam) => (
        <Camera key={cam.id} cam={cam} />
      ))}
    </group>
  );
}
