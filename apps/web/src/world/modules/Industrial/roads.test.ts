import { describe, expect, it } from "vitest";
import { ZONES, inBox } from "../../config";
import { IND_CT_TARGET, IND_MW_TARGET, IND_ROUNDABOUT, industrial } from "../../districts/industrial";
import { PLACES, ROAD_NODES, findPath, getEdge, getNode, neighbours } from "../../roads";
import { BARRIERS, FENCES, YARD_LIGHTS, footprints, type V2 } from "./layout";

const Z = ZONES.industrial;
const isOurs = (id: string) => id.startsWith("ind_");

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function cross(a: V2, b: V2, c: V2, d: V2) {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
const P = (id: string): V2 => {
  const n = getNode(id);
  return [n.x, n.z];
};
/** Only the roads inside the estate (the links to the ring / docks / motorway are allowed to leave the zone). */
const insideEdges = () => industrial.edges.filter((e) => inBox(Z, ...P(e.a), 1) && inBox(Z, ...P(e.b), 1));

describe("industrial roads", () => {
  it("uses ind_ ids only, all unique", () => {
    const ids = industrial.nodes.map((n) => n.id);
    expect(ids.every(isOurs)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every edge references a known node and is merged into the shared graph", () => {
    for (const e of industrial.edges) {
      expect(ROAD_NODES.has(e.a), e.a).toBe(true);
      expect(ROAD_NODES.has(e.b), e.b).toBe(true);
      expect(getEdge(e.a, e.b), `${e.a}-${e.b}`).toBeDefined();
    }
  });

  it("stays in the zone, except the connector corridors", () => {
    for (const n of industrial.nodes) {
      const inZone = inBox(Z, n.x, n.z);
      const ringCorridor = n.x >= 105 && n.x <= 225 && n.z >= 215 && n.z <= 372; // down from h_8 / h_9
      const ctLink = n.x >= 290 && n.x <= 340 && n.z >= 55 && n.z <= 372; // to the container terminal / docks
      const mwLink = n.x >= 140 && n.x <= 260 && n.z > 660 && n.z <= 800; // down to the motorway
      expect(inZone || ringCorridor || ctLink || mwLink, `${n.id} (${n.x},${n.z})`).toBe(true);
    }
  });

  it("is reachable from the depot, every node", () => {
    for (const n of industrial.nodes) expect(findPath(PLACES.depot, n.id), n.id).not.toBeNull();
  });

  it("joins the ring south side, the container terminal and leaves a motorway link", () => {
    expect(neighbours("h_9").some(isOurs)).toBe(true);
    expect(neighbours("h_8").some(isOurs)).toBe(true);
    expect(IND_CT_TARGET === "dock_s" || IND_CT_TARGET.startsWith("ct_")).toBe(true);
    expect(neighbours(IND_CT_TARGET).some(isOurs)).toBe(true);
    const link = getNode("ind_mw_link");
    expect([link.x, link.z]).toEqual([200, 700]);
    expect(neighbours("ind_mw_link").length).toBeGreaterThanOrEqual(1);
    if (IND_MW_TARGET) expect(findPath("ind_mw_link", IND_MW_TARGET)).not.toBeNull();
  });

  it("has an 8-node roundabout ring", () => {
    for (let k = 0; k < 8; k++) {
      const id = `ind_rb_${k}`;
      expect(getEdge(id, `ind_rb_${(k + 1) % 8}`), id).toBeDefined();
      const n = getNode(id);
      expect(Math.abs(Math.hypot(n.x - IND_ROUNDABOUT.x, n.z - IND_ROUNDABOUT.z) - IND_ROUNDABOUT.r)).toBeLessThan(1);
    }
    // four arms
    expect([0, 2, 4, 6].every((k) => neighbours(`ind_rb_${k}`).length === 3)).toBe(true);
  });

  it("uses short edges inside the estate (organic curves)", () => {
    for (const e of insideEdges()) {
      const [ax, az] = P(e.a);
      const [bx, bz] = P(e.b);
      expect(Math.hypot(ax - bx, az - bz), `${e.a}-${e.b}`).toBeLessThanOrEqual(31);
    }
  });

  it("never has two edges crossing without a junction", () => {
    const es = industrial.edges;
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++) {
        const a = es[i];
        const b = es[j];
        if ([a.a, a.b].some((id) => id === b.a || id === b.b)) continue;
        expect(cross(P(a.a), P(a.b), P(b.a), P(b.b)), `${a.a}-${a.b} x ${b.a}-${b.b}`).toBe(false);
      }
  });
});

describe("industrial layout vs roads", () => {
  const roads = industrial.edges.map((e) => [...P(e.a), ...P(e.b)] as [number, number, number, number]);
  const clear = (x: number, z: number, m: number) => roads.every(([ax, az, bx, bz]) => segDist(x, z, ax, az, bx, bz) > m);

  it("keeps every footprint inside the zone and off the roads", () => {
    for (const f of footprints()) {
      const pts: V2[] = [];
      if (f.rect) {
        const { x, z, w, d } = f.rect;
        for (let u = 0; u <= 1; u += 0.05) {
          pts.push([x - w / 2 + w * u, z - d / 2], [x - w / 2 + w * u, z + d / 2], [x - w / 2, z - d / 2 + d * u], [x + w / 2, z - d / 2 + d * u]);
        }
      } else if (f.circle) {
        const { x, z, r } = f.circle;
        for (let k = 0; k < 32; k++) pts.push([x + Math.cos((k / 32) * 6.283) * r, z + Math.sin((k / 32) * 6.283) * r]);
      }
      for (const [x, z] of pts) {
        expect(inBox(Z, x, z), `${f.name} in zone`).toBe(true);
        expect(clear(x, z, 5), `${f.name} clear of roads at (${x.toFixed(1)},${z.toFixed(1)})`).toBe(true);
      }
    }
  });

  it("runs fences inside the zone without crossing a road", () => {
    for (const fence of FENCES)
      for (let i = 1; i < fence.length; i++) {
        const [ax, az] = fence[i - 1];
        const [bx, bz] = fence[i];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n;
          const z = az + ((bz - az) * k) / n;
          expect(inBox(Z, x, z), `fence (${x},${z})`).toBe(true);
          expect(clear(x, z, 4.4), `fence (${x.toFixed(1)},${z.toFixed(1)}) clear`).toBe(true);
        }
      }
  });

  it("keeps yard lights and hazard barriers off the carriageway", () => {
    for (const [x, z] of YARD_LIGHTS) expect(clear(x, z, 4.4), `light (${x},${z})`).toBe(true);
    for (const [x, z, len, yaw] of BARRIERS)
      for (const s of [-0.5, 0, 0.5]) {
        const px = x + Math.cos(yaw) * s * len;
        const pz = z - Math.sin(yaw) * s * len;
        expect(clear(px, pz, 4.3), `barrier (${px.toFixed(1)},${pz.toFixed(1)})`).toBe(true);
      }
  });
});
