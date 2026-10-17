"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import SatelliteGround from "./SatelliteGround";
import Bridge from "./Bridge";
import RoadLines from "./RoadLines";
import JamCams from "./JamCams";
import CrowdMesh from "./CrowdMesh";
import StreamerMarker from "./StreamerMarker";
import RouteLines from "./RouteLines";
import AccidentMarker from "./AccidentMarker";
import SkyDome from "./SkyDome";
import Water from "./Water";

export default function TowerWorld() {
  return (
    <Canvas
      dpr={1}
      shadows={false}
      camera={{ position: [160, 240, 210], fov: 38, near: 0.5, far: 4000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <color attach="background" args={["#9ec9ef"]} />
      <hemisphereLight args={["#fff4e0", "#3d5a40", 0.85]} />
      <ambientLight intensity={0.35} />
      <SkyDome />
      <SatelliteGround />
      <Water />
      <RoadLines />
      <Bridge />
      <JamCams />
      <AccidentMarker />
      <RouteLines />
      <StreamerMarker />
      <CrowdMesh />
      <OrbitControls target={[-20, 8, 30]} maxPolarAngle={Math.PI / 2.15} />
    </Canvas>
  );
}
