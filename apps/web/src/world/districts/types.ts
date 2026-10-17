// District road data. Each Layer 2 district agent owns ONE file in this folder and fills it with
// its own road nodes and edges. roads.ts merges them all into the shared graph at load.
import type { ZoneName } from "../config";
import type { RoadKind } from "../roads";

export interface DistrictNode {
  id: string; // MUST be prefixed with the district name, e.g. "ind_furnace_gate"
  x: number;
  z: number;
  zone: ZoneName | "highway";
}

export interface DistrictEdge {
  a: string; // may reference this district's nodes OR existing nodes (e.g. ring "h_4", grid "g_4_0", "dock_s")
  b: string;
  kind: RoadKind; // "highway" draws as a 12 m dual carriageway with barriers; "street" 8 m; "country" 6 m; "ramp"
}

export interface DistrictRoads {
  nodes: DistrictNode[];
  edges: DistrictEdge[];
}

export const EMPTY: DistrictRoads = { nodes: [], edges: [] };
