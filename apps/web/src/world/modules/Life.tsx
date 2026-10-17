"use client";
// Module: Life. Ambient city life, all cheap and mostly instanced:
// pedestrians, cyclists, street furniture, birds, a plane, a news helicopter, boats and a lighthouse.
// Pure simulation lives in ./Life/sim.ts (tested); each piece is its own component under ./Life/.
import Birds from "./Life/Birds";
import Cyclists from "./Life/Cyclists";
import Furniture from "./Life/Furniture";
import Helicopter from "./Life/Helicopter";
import Plane from "./Life/Plane";
import Sea from "./Life/Sea";

export default function Life() {
  return (
    <group name="life">
      <Furniture />
      <Cyclists />
      <Birds />
      <Plane />
      <Helicopter />
      <Sea />
    </group>
  );
}
