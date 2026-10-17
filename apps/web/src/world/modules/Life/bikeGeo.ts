// Shared low-poly bike and rider geometry (vertex-coloured, merged). Used by the live cyclists
// (Life/Cyclists.tsx) and by the knocked-off bikes and riders at a cyclist_hit (Collisions).
import { BoxGeometry, CapsuleGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, type BufferGeometry } from "three";
import { merge, paint } from "./geo";

/** Bike along +z, wheels on the ground (y = 0), about 1.7 m long. */
export function bikeGeometry(): BufferGeometry {
  const wheel = (z: number) => {
    const g = new TorusGeometry(0.33, 0.05, 5, 12);
    g.rotateY(Math.PI / 2);
    g.translate(0, 0.36, z);
    return paint(g, "#1b1b1b");
  };
  const frame = paint(new BoxGeometry(0.07, 0.07, 0.95), "#c0c4c8");
  frame.rotateX(-0.25);
  frame.translate(0, 0.6, 0);
  const seatPost = paint(new BoxGeometry(0.06, 0.4, 0.06), "#c0c4c8");
  seatPost.translate(0, 0.62, -0.2);
  const bars = paint(new BoxGeometry(0.5, 0.05, 0.05), "#333333");
  bars.translate(0, 0.98, 0.42);
  return merge([wheel(0.52), wheel(-0.52), frame, seatPost, bars]);
}

/** Rider leaning to the bars. The torso is white so the instance colour (jersey) shows through. */
export function riderGeometry(): BufferGeometry {
  const torso = new CapsuleGeometry(0.2, 0.5, 3, 6);
  torso.rotateX(0.55);
  torso.translate(0, 1.22, -0.05);
  const head = new SphereGeometry(0.18, 8, 6);
  head.translate(0, 1.66, 0.18);
  const legs = new CylinderGeometry(0.09, 0.07, 0.6, 5);
  legs.translate(0, 0.72, -0.05);
  return merge([paint(torso, "#ffffff"), paint(head, "#2b2b2b"), paint(legs, "#3a3a3a")]);
}

/** A rider lying on the road along +z (head at +z), centred on the origin, for the fallen pose. */
export function fallenRiderGeometry(): BufferGeometry {
  const torso = new CapsuleGeometry(0.2, 0.55, 3, 6);
  torso.rotateX(Math.PI / 2);
  torso.translate(0, 0.2, 0.15);
  const head = new SphereGeometry(0.18, 8, 6);
  head.translate(0.05, 0.2, 0.75);
  const legA = new CylinderGeometry(0.09, 0.07, 0.75, 5);
  legA.rotateX(Math.PI / 2);
  legA.rotateY(0.25);
  legA.translate(0.12, 0.12, -0.55);
  const legB = new CylinderGeometry(0.09, 0.07, 0.75, 5);
  legB.rotateX(Math.PI / 2);
  legB.rotateY(-0.5);
  legB.translate(-0.2, 0.12, -0.5);
  const arm = new CylinderGeometry(0.07, 0.06, 0.6, 5);
  arm.rotateZ(Math.PI / 2);
  arm.translate(0.38, 0.14, 0.45);
  return merge([paint(torso, "#ffffff"), paint(head, "#2b2b2b"), paint(legA, "#3a3a3a"), paint(legB, "#3a3a3a"), paint(arm, "#ffffff")]);
}

/** A standing onlooker, about 1.75 m tall. White body (instance colour), dark head and legs. */
export function onlookerGeometry(): BufferGeometry {
  const body = new CapsuleGeometry(0.22, 0.55, 3, 6);
  body.translate(0, 1.05, 0);
  const head = new SphereGeometry(0.17, 8, 6);
  head.translate(0, 1.62, 0);
  const legs = new CylinderGeometry(0.17, 0.12, 0.7, 6);
  legs.translate(0, 0.35, 0);
  return merge([paint(body, "#ffffff"), paint(head, "#d9a982"), paint(legs, "#2e3440")]);
}
