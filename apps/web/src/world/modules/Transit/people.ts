// Renders the passenger pool as two instanced meshes (body + head), writing matrices straight
// into the instance buffers. ~2 draw calls for every passenger in the city.
import * as THREE from "three";
import { PassengerPool, ST } from "./passengers";
import { std } from "./kit";

const CLOTHES = ["#e4572e", "#2e86ab", "#f2c14e", "#3bb273", "#7768ae", "#e15554", "#1d3557", "#f4a261", "#2a9d8f", "#ef476f", "#3a3a3a", "#ffffff"];
const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
const SIZE = 1.25; // a touch larger than life so they read from the aerial camera

export function createPeople(pool: PassengerPool) {
  const bodyGeo = new THREE.CylinderGeometry(0.2, 0.27, 1.15, 6).translate(0, 0.6, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.2, 0).translate(0, 1.42, 0);
  const bodyMat = std("#ffffff");
  const headMat = std("#ffffff");
  const body = new THREE.InstancedMesh(bodyGeo, bodyMat, pool.cap);
  const head = new THREE.InstancedMesh(headGeo, headMat, pool.cap);
  const col = new THREE.Color();
  for (const m of [body, head]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
  }
  for (let i = 0; i < pool.cap; i++) {
    body.setColorAt(i, col.set(CLOTHES[(i * 7 + 3) % CLOTHES.length]));
    head.setColorAt(i, col.set(SKIN[(i * 5 + 1) % SKIN.length]));
  }
  body.instanceColor!.needsUpdate = true;
  head.instanceColor!.needsUpdate = true;
  const bArr = body.instanceMatrix.array as Float32Array;
  const hArr = head.instanceMatrix.array as Float32Array;
  bArr.fill(0);
  hArr.fill(0);

  const write = (arr: Float32Array, o: number, c: number, sn: number, s: number, x: number, y: number, z: number) => {
    arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  };

  return {
    meshes: [body, head],
    tick() {
      let hi = 0;
      for (let i = 0; i < pool.cap; i++) {
        const o = i * 16;
        if (pool.state[i] === ST.FREE) {
          if (bArr[o + 15] !== 0) {
            bArr.fill(0, o, o + 16);
            hArr.fill(0, o, o + 16);
          }
          continue;
        }
        hi = i + 1;
        const s = pool.scale[i] * SIZE;
        const yaw = pool.yaw[i];
        const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
        const bob = pool.state[i] === ST.WALK ? Math.abs(Math.sin(pool.phase[i])) * 0.07 : 0;
        const y = pool.y[i] + bob;
        write(bArr, o, c, sn, s, pool.x[i], y, pool.z[i]);
        write(hArr, o, c, sn, s, pool.x[i], y, pool.z[i]);
      }
      body.count = head.count = Math.max(hi, 1);
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      bodyGeo.dispose();
      headGeo.dispose();
      bodyMat.dispose();
      headMat.dispose();
      body.dispose();
      head.dispose();
    },
  };
}
