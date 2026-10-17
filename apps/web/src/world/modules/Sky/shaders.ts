// GLSL for the Sky module: the dome (gradient, sun, moon, stars, smog haze, lightning) and GPU rain streaks.

export const domeVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const domeFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
uniform float uCover;  // 0..1 cloud cover: hides sun disc, moon and stars
uniform float uSmog;   // 0..1 brownish haze near the horizon, strongest toward the industrial south-east
uniform float uFlash;  // lightning
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  float y = d.y;
  float clearSky = 1.0 - smoothstep(0.35, 0.95, uCover);

  // Gradient: horizon -> zenith; slightly deeper colour below the horizon (mostly hidden by fog/ground).
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.45));
  col = mix(col, uHorizon * 0.82, clamp(-y * 3.0, 0.0, 1.0));

  // Smog: brown haze hugging the horizon, heavier toward the SE (+x east, +z south).
  float se = max(dot(normalize(d.xz + 1e-4), vec2(0.7071, 0.7071)), 0.0);
  float band = 1.0 - smoothstep(-0.02, 0.22, y);
  float haze = band * (0.3 + 0.7 * se * se) * uSmog;
  col = mix(col, uHorizon * vec3(1.02, 0.84, 0.62), haze * 0.6);

  // Sun glow and disc (glow survives thin cloud as a soft bright patch).
  float sunVis = smoothstep(-0.18, 0.04, uSunDir.y);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 10.0) * 0.35 * (1.0 - 0.5 * uCover) + pow(sd, 180.0) * 0.7 * clearSky) * sunVis;
  float disc = smoothstep(0.99935, 0.99965, sd) * smoothstep(-0.01, 0.01, y);
  col = mix(col, uSunColor * 5.0 + vec3(1.2), disc * sunVis * clearSky);

  // Moon (with halo) and stars at night.
  float night = uStars * clearSky;
  float md = max(dot(d, uMoonDir), 0.0);
  float moonVis = night * smoothstep(-0.02, 0.08, uMoonDir.y) * smoothstep(-0.01, 0.01, y);
  col += vec3(0.55, 0.62, 0.9) * pow(md, 300.0) * 0.25 * moonVis;
  float mdisc = smoothstep(0.99955, 0.99975, md);
  float crater = 0.85 + 0.15 * hash13(floor(d * 2600.0));
  col = mix(col, vec3(1.0, 0.97, 0.88) * 2.2 * crater, mdisc * moonVis);

  if (night > 0.001 && y > 0.0) {
    vec3 p = d * 170.0;
    vec3 cell = floor(p);
    float h = hash13(cell);
    if (h > 0.986) {
      vec3 off = vec3(hash13(cell + 7.1), hash13(cell + 3.7), hash13(cell + 1.3)) - 0.5;
      float dist = length(fract(p) - 0.5 - off * 0.5);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 91.0);
      float s = (1.0 - smoothstep(0.0, 0.14, dist)) * tw * smoothstep(0.0, 0.25, y);
      vec3 tint = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash13(cell + 11.0));
      col += tint * s * night * (h > 0.997 ? 1.6 : 0.9);
    }
  }

  // Lightning lights the whole cloud deck, brightest overhead.
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.35 + 0.65 * clamp(y, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Rain: each drop is a 2-vertex line segment. position = random seed in [0,1)^3, aEnd = 0 head / 1 tail,
// aIdx in [0,1) used to thin the drops out with intensity. Everything moves in the vertex shader.
export const rainVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uOffset;   // accumulated fall (wrapped in JS)
uniform vec3 uDir;      // normalised fall direction
uniform float uLen;
uniform float uRain;
attribute float aEnd;
attribute float aIdx;
varying float vAlpha;
void main() {
  vec3 p = position * uBox + uOffset;
  p = mod(p - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox + uCenter;
  p -= uDir * uLen * (0.7 + 0.6 * fract(position.x * 97.3)) * aEnd;
  vAlpha = (1.0 - 0.85 * aEnd) * step(aIdx, uRain) * step(0.0, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const rainFragment = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  if (vAlpha <= 0.001) discard;
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <colorspace_fragment>
}
`;

// Cloud puffs: instance matrices are static; drift with the wind is a wrapped uniform offset per cloud anchor.
export const cloudVertexDecl = /* glsl */ `
attribute vec2 aAnchor;
uniform vec2 uDrift;
uniform float uSpan;
uniform float uPuff;
`;

export const cloudProjectVertex = /* glsl */ `
vec4 mvPosition = vec4(transformed * uPuff, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec2 moved = mod(aAnchor + uDrift + 0.5 * uSpan, uSpan) - 0.5 * uSpan;
mvPosition.xz += moved - aAnchor;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;
