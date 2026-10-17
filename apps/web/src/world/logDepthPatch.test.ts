import { describe, expect, it } from "vitest";
import { addLogDepth } from "./logDepthPatch";

describe("addLogDepth", () => {
  const vert = "attribute float a;\nvoid main() {\n  gl_Position = vec4(0.0);\n}\n";
  const frag = "uniform vec3 c;\nvoid main() {\n  gl_FragColor = vec4(c, 1.0);\n}\n";
  it("injects declarations before main and depth writes inside it", () => {
    const { vertex, fragment } = addLogDepth(vert, frag);
    expect(vertex.indexOf("varying float vFragDepth")).toBeLessThan(vertex.indexOf("void main"));
    expect(vertex.indexOf("vFragDepth = 1.0 + gl_Position.w")).toBeGreaterThan(vertex.indexOf("gl_Position = vec4"));
    expect(fragment.indexOf("gl_FragDepth")).toBeGreaterThan(fragment.indexOf("void main"));
    expect(fragment.indexOf("gl_FragDepth")).toBeLessThan(fragment.indexOf("gl_FragColor"));
  });
  it("leaves shaders that already handle log depth alone", () => {
    const v = "#include <logdepthbuf_pars_vertex>\n" + vert;
    expect(addLogDepth(v, frag)).toEqual({ vertex: v, fragment: frag });
  });
});
