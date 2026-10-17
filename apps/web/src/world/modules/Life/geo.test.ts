import { describe, expect, it } from "vitest";
import { BoxGeometry, DodecahedronGeometry, ShapeGeometry, Shape } from "three";
import { merge, paint } from "./geo";

describe("merge", () => {
  it("merges indexed and non-indexed painted parts", () => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1, 0);
    shape.lineTo(0, 1);
    const g = merge([paint(new BoxGeometry(1, 1, 1), "#ff0000"), paint(new DodecahedronGeometry(1, 0), "#00ff00"), paint(new ShapeGeometry(shape), "#0000ff")]);
    expect(g.getAttribute("color").count).toBe(g.getAttribute("position").count);
  });
});
