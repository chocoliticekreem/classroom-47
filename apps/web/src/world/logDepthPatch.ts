// The renderer uses a logarithmic depth buffer (fixes ground z-fighting on the big map). Built-in
// materials handle that automatically, but hand-written ShaderMaterials don't, so their depth would be
// wrong (smoke, water and particles hidden or poking through). This patch makes every ShaderMaterial
// log-depth aware at compile time, unless its shader already includes the logdepthbuf chunks.
import { ShaderMaterial, type WebGLProgramParametersWithUniforms } from "three";

const VERT_PARS = `
#ifdef USE_LOGDEPTHBUF
varying float vFragDepth;
varying float vIsPerspective;
#endif
`;
const VERT_BODY = `
#ifdef USE_LOGDEPTHBUF
vFragDepth = 1.0 + gl_Position.w;
vIsPerspective = float(projectionMatrix[2][3] == -1.0);
#endif
`;
const FRAG_PARS = `
#ifdef USE_LOGDEPTHBUF
uniform float logDepthBufFC;
varying float vFragDepth;
varying float vIsPerspective;
#endif
`;
const FRAG_BODY = `
#ifdef USE_LOGDEPTHBUF
gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(vFragDepth) * logDepthBufFC * 0.5;
#endif
`;

const MAIN = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/;

export function addLogDepth(vertex: string, fragment: string): { vertex: string; fragment: string } {
  if (vertex.includes("logdepthbuf") || fragment.includes("logdepthbuf") || vertex.includes("vFragDepth")) return { vertex, fragment };
  const vm = vertex.search(MAIN);
  const fm = fragment.search(MAIN);
  const vEnd = vertex.lastIndexOf("}");
  if (vm < 0 || fm < 0 || vEnd < vm) return { vertex, fragment };
  const v = vertex.slice(0, vm) + VERT_PARS + vertex.slice(vm, vEnd) + VERT_BODY + vertex.slice(vEnd);
  const fMatch = fragment.match(MAIN)!;
  const fOpen = fm + fMatch[0].length;
  const f = fragment.slice(0, fm) + FRAG_PARS + fragment.slice(fm, fOpen) + FRAG_BODY + fragment.slice(fOpen);
  return { vertex: v, fragment: f };
}

let installed = false;
export function installLogDepthPatch() {
  if (installed) return;
  installed = true;
  const proto = ShaderMaterial.prototype as ShaderMaterial & { onBeforeCompile: (s: WebGLProgramParametersWithUniforms) => void };
  proto.onBeforeCompile = function (shader: WebGLProgramParametersWithUniforms) {
    const out = addLogDepth(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = out.vertex;
    shader.fragmentShader = out.fragment;
  };
}
