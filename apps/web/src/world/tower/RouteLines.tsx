"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { planRoutes } from "./layout";

/** Blocked primary route in red; Tooley Street exit in green, slightly above it. */
export default function RouteLines() {
  const plan = useMemo(() => {
    const routes = planRoutes();
    return {
      primary: routes.primary.map(([x, z]): [number, number, number] => [x, 2.2, z]),
      detour: routes.detour.map(([x, z]): [number, number, number] => [x, 2.6, z]),
    };
  }, []);

  return (
    <>
      <Line points={plan.primary} color="#ff3355" lineWidth={3} />
      <Line points={plan.detour} color="#3dff9a" lineWidth={4} />
    </>
  );
}
