// The police helicopter that shadows the motorcade (and hovers over marches): the Chases module's NPAS
// mesh, flown here with a lazy follow and a slow orbit. Searchlight on at night.
import * as THREE from "three";
import { buildHeli, type HeliParts } from "../Chases/meshes";

const UP = new THREE.Vector3(0, 1, 0);
const DIR = new THREE.Vector3();

export class HeliRig {
  readonly root = new THREE.Group();
  private parts: HeliParts | null = null;
  private x = 0;
  private z = 0;
  private y = 70;
  private yaw = 0;
  private orbit = 0;
  private active = false;
  private t = 0;

  private ensure() {
    if (this.parts) return this.parts;
    this.parts = buildHeli();
    this.root.add(this.parts.root, this.parts.cone, this.parts.spot);
    return this.parts;
  }

  /** Appear near (x, z), already flying. */
  show(x: number, z: number) {
    const p = this.ensure();
    this.x = x - 60;
    this.z = z - 60;
    this.y = 70;
    this.active = true;
    p.root.visible = true;
  }

  hide() {
    this.active = false;
    if (!this.parts) return;
    this.parts.root.visible = false;
    this.parts.cone.visible = false;
    this.parts.spot.visible = false;
  }

  /** Follow a target on the ground: trail `behind` metres and circle slowly when it stops. */
  follow(tx: number, tz: number, dt: number, night: boolean, behind = 35, alt = 58) {
    if (!this.active || !this.parts) return;
    const p = this.parts;
    this.t += dt;
    this.orbit += dt * 0.25;
    const gx = tx + Math.sin(this.orbit) * behind;
    const gz = tz + Math.cos(this.orbit) * behind;
    const k = 1 - Math.exp(-dt * 0.9);
    const ox = this.x;
    const oz = this.z;
    this.x += (gx - this.x) * k;
    this.z += (gz - this.z) * k;
    this.y += (alt - this.y) * k;
    const vx = this.x - ox;
    const vz = this.z - oz;
    // face the target, bank a little with speed
    const want = Math.atan2(tx - this.x, tz - this.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 1.5);
    p.root.position.set(this.x, this.y + Math.sin(this.t * 1.3) * 0.4, this.z);
    p.root.rotation.set(Math.min(0.25, Math.hypot(vx, vz) / Math.max(dt, 1e-3) * 0.01), this.yaw, 0, "YXZ");
    p.rotor.rotation.y += dt * 38;
    p.tailRotor.rotation.x += dt * 60;
    const blink = Math.floor(this.t * 1.5) % 2 === 0;
    p.beacon.visible = blink;
    // searchlight on the target at night
    p.cone.visible = night;
    p.spot.visible = night;
    if (night) {
      const h = this.y - 1.2;
      p.cone.position.set((this.x + tx) / 2, h / 2 + 0.6, (this.z + tz) / 2);
      const dx = tx - this.x;
      const dz = tz - this.z;
      const len = Math.hypot(dx, dz, h);
      p.cone.scale.set(5, len, 5);
      p.cone.quaternion.setFromUnitVectors(UP, DIR.set(-dx / len, h / len, -dz / len));
      p.coneMat.uniforms.uOpacity.value = 0.35;
      p.spot.position.set(tx, 0.12, tz);
      p.spotMat.opacity = 0.55;
    }
  }

  dispose() {
    if (!this.parts) return;
    for (const m of this.parts.own) m.dispose();
    for (const g of this.parts.geos) g.dispose();
    this.parts = null;
  }
}
