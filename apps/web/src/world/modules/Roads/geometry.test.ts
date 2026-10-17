import { describe, expect, it } from "vitest";
import { FlatBuilder, dashes } from "./geometry";
import { buildRoadLayout } from "./layout";
import { ROAD_EDGES } from "../../roads";

describe("FlatBuilder", () => {
  it("emits upward-facing quads for any segment direction", () => {
    for (const [x1, z1] of [[10, 0], [-10, 0], [0, 10], [0, -10], [7, -3]]) {
      const b = new FlatBuilder();
      b.strip(0, 0, x1, z1, 0, 10, 1, 0.05);
      const p = b.positions;
      const idx = b.indices;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, c, d] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
        const ux = c[0] - a[0], uz = c[2] - a[2], vx = d[0] - a[0], vz = d[2] - a[2];
        // y component of (c-a) x (d-a) must be positive (CCW seen from above => faces +y)
        expect(uz * vx - ux * vz).toBeGreaterThan(0);
      }
      expect(p.filter((_, i) => i % 3 === 1).every((y) => y === 0.05)).toBe(true);
    }
  });

  it("disc has the requested number of triangles", () => {
    const b = new FlatBuilder();
    b.disc(0, 0, 3, 0.1, 12);
    expect(b.indices.length).toBe(12 * 3);
  });
});

describe("dashes", () => {
  it("splits a span into dash intervals inside the span", () => {
    const d = dashes(0, 20, 3, 3);
    expect(d.length).toBe(3);
    for (const [s, e] of d) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(20);
      expect(e).toBeGreaterThan(s);
    }
  });
  it("returns nothing for an empty span", () => {
    expect(dashes(5, 4, 3, 3)).toEqual([]);
  });
});

describe("buildRoadLayout", () => {
  const L = buildRoadLayout();
  it("draws asphalt for every edge", () => {
    expect(L.street.indices.length + L.highway.indices.length + L.country.indices.length).toBeGreaterThanOrEqual(
      ROAD_EDGES.size * 6,
    );
  });
  it("puts 4 sidewalk strips around each of the 64 downtown blocks", () => {
    expect(L.sidewalks.length).toBe(64 * 4);
  });
  it("keeps all flat road surfaces between y 0.02 and 0.06", () => {
    for (const b of [L.street, L.highway, L.country, L.patches, L.markings]) {
      for (let i = 1; i < b.positions.length; i += 3) {
        expect(b.positions[i]).toBeGreaterThanOrEqual(0.02);
        expect(b.positions[i]).toBeLessThanOrEqual(0.06);
      }
    }
  });
  it("has a few sign gantries on the highway", () => {
    expect(L.gantries.length).toBeGreaterThanOrEqual(4);
  });
});
