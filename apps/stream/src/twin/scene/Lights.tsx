"use client";

export function Lights() {
  return (
    <>
      <hemisphereLight args={["#4a5d96", "#141018", 2.4]} />
      <directionalLight position={[-600, 700, -500]} intensity={1.1} color="#8ea4d8" />
      <directionalLight position={[500, 300, 600]} intensity={0.35} color="#ffb070" />
    </>
  );
}
