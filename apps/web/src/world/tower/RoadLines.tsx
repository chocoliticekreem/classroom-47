"use client";

import { Line } from "@react-three/drei";
import { ROADS } from "./layout";

const Y = 1.6;

type XZ = readonly number[];
type Road = readonly XZ[] | { points?: readonly XZ[]; name?: string };

/** Polylines may be [x, z][] or { points, name }. */
function lift(road: Road): [number, number, number][] {
  const src = Array.isArray(road) ? road : (road.points ?? []);
  const out: [number, number, number][] = [];
  for (let i = 0; i < src.length; i++) out.push([src[i][0], Y, src[i][1]]);
  return out;
}

const approach = lift(ROADS.towerBridgeApproach);
const bridgeRoad = lift(ROADS.towerBridgeRoad);
const tooley = lift(ROADS.tooleyStreet);
const druid = lift(ROADS.druidStreet);

export default function RoadLines() {
  return (
    <group>
      {approach.length >= 2 && <Line points={approach} color="#f5d76e" lineWidth={3} />}
      {bridgeRoad.length >= 2 && <Line points={bridgeRoad} color="#f5d76e" lineWidth={3} />}
      {tooley.length >= 2 && <Line points={tooley} color="#7ee0ff" lineWidth={3} />}
      {druid.length >= 2 && <Line points={druid} color="#d7c4ff" lineWidth={3} />}
    </group>
  );
}
