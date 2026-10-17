// Railway engine: owns the scene, the fleet and the per-frame update. Trains are a pure function of a sim
// clock that only runs while the world isn't paused; level crossings close their road edges in the store
// (only on transitions), signals and lamps update their instance colours only when they change.
import * as THREE from "three";
import { emit } from "../../bus";
import { useWorld } from "../../store";
import { buildRailScene } from "./build";
import { barrierDown, flashPhase, lightsOn, newCrossingTimes, roadClosed, updateCrossing } from "./crossing";
import { compose, nightLevel } from "./kit";
import { createFleet } from "./rolling";
import { ASPECT, createTrains, crossingCalled, sampleTrain, signalAspect } from "./sim";

const ASPECT_COLORS = [new THREE.Color("#ff2a1a"), new THREE.Color("#ffc21a"), new THREE.Color("#2aff6a")];
const LAMP_ON = new THREE.Color("#ff2a14");
const LAMP_OFF = new THREE.Color("#3a0b08");
const ARM_LEN = 5.4; // barrier arm geometry length
const m4 = new THREE.Matrix4();

export function createRail() {
  const scene = buildRailScene();
  const trains = createTrains();
  const fleet = createFleet(trains, scene.sidings);
  const nightMats = scene.meshes
    .map((m) => m.userData.night as THREE.MeshStandardMaterial | undefined)
    .filter((m): m is THREE.MeshStandardMaterial => !!m);

  const lcs = scene.crossings.map((v) => ({ v, times: newCrossingTimes(), blocked: false, phase: -2, down: -1 }));
  let T = 30; // sim seconds: start with the timetable already running
  let lastNight = -1;
  let lastMinute = -1;
  let sigTimer = 0;

  const setArms = (i: number, down: number) => {
    const { v } = lcs[i];
    const raise = (1 - down) * THREE.MathUtils.degToRad(84);
    v.armPivots.forEach((p, k) => scene.arms.setMatrixAt(v.armBase + k, compose(p.x, p.y, p.z, p.yaw, p.len / ARM_LEN, 1, 1, m4, 0, raise)));
    scene.arms.instanceMatrix.needsUpdate = true;
  };
  lcs.forEach((_, i) => setArms(i, 0));

  const closeRoad = (i: number, closed: boolean) => {
    const st = lcs[i];
    st.blocked = closed;
    const w = useWorld.getState();
    for (const key of st.v.lc.edges) {
      if (closed) {
        if (!(key in w.blocked)) {
          w.blockEdge(key, st.v.lc.note);
          emit({ type: "road:blocked", edgeKey: key, reason: st.v.lc.note });
        }
      } else if (useWorld.getState().blocked[key] === st.v.lc.note) {
        useWorld.getState().unblockEdge(key);
        emit({ type: "road:reopened", edgeKey: key });
      }
    }
  };

  const setClock = (hour: number) => {
    const h = ((hour % 24) + 24) % 24;
    const minutes = (h % 1) * 60;
    const angH = ((h % 12) / 12) * Math.PI * 2;
    const angM = (minutes / 60) * Math.PI * 2;
    scene.clockCentres.forEach((c, i) => {
      const nx = Math.sin(c.yaw) * 0.1, nz = Math.cos(c.yaw) * 0.1;
      scene.clockHands.setMatrixAt(i * 2, compose(c.x + nx, c.y, c.z + nz, c.yaw, 0.32, 2.0, 0.06, m4, 0, -angH));
      scene.clockHands.setMatrixAt(i * 2 + 1, compose(c.x + nx * 1.6, c.y, c.z + nz * 1.6, c.yaw, 0.22, 3.0, 0.06, m4, 0, -angM));
    });
    scene.clockHands.instanceMatrix.needsUpdate = true;
  };

  return {
    meshes: [...scene.meshes, ...fleet.meshes],
    tick(delta: number) {
      const dt = Math.min(delta, 0.1);
      const { paused, timeOfDay } = useWorld.getState();
      if (!paused) T += dt;

      for (const tr of trains) sampleTrain(tr, T);

      // night lighting, only when it changes
      const night = nightLevel(timeOfDay);
      const nb = Math.round(night * 40);
      if (nb !== lastNight) {
        lastNight = nb;
        scene.glowMat.emissiveIntensity = night * 1.5;
        fleet.windowMat.emissiveIntensity = night * 1.4;
        scene.clockMat.emissiveIntensity = night * 0.55;
        for (const m of nightMats) m.emissiveIntensity = night * 0.45;
      }
      const minute = Math.floor(timeOfDay * 60);
      if (minute !== lastMinute) {
        lastMinute = minute;
        setClock(timeOfDay);
      }

      fleet.update(trains, night);

      // level crossings
      let lampsDirty = false;
      for (let i = 0; i < lcs.length; i++) {
        const st = lcs[i];
        updateCrossing(st.times, crossingCalled(st.v.lc, trains, T), T);
        const down = barrierDown(st.times, T);
        if (Math.abs(down - st.down) > 1e-3 || (down === 0 && st.down !== 0) || (down === 1 && st.down !== 1)) {
          st.down = down;
          setArms(i, down);
        }
        const phase = lightsOn(st.times) ? flashPhase(T) : -1;
        if (phase !== st.phase) {
          st.phase = phase;
          for (let k = 0; k < st.v.lamps; k++) {
            // two lamps per post, alternating; posts flash in step
            const on = phase >= 0 && k % 2 === phase;
            scene.lcLamps.setColorAt(st.v.lampBase + k, on ? LAMP_ON : LAMP_OFF);
          }
          lampsDirty = true;
        }
        const closed = roadClosed(st.times, T);
        if (closed !== st.blocked) closeRoad(i, closed);
      }
      if (lampsDirty && scene.lcLamps.instanceColor) scene.lcLamps.instanceColor.needsUpdate = true;

      // signals, a few times a second
      sigTimer -= dt;
      if (sigTimer <= 0) {
        sigTimer = 0.25;
        let dirty = false;
        scene.signals.forEach((sv, i) => {
          const a = signalAspect(sv.site, sv.next, trains);
          if (a !== sv.aspect) {
            sv.aspect = a;
            scene.signalLamps.setColorAt(i, ASPECT_COLORS[a] ?? ASPECT_COLORS[ASPECT.green]);
            dirty = true;
          }
        });
        if (dirty && scene.signalLamps.instanceColor) scene.signalLamps.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      lcs.forEach((st, i) => st.blocked && closeRoad(i, false));
      scene.dispose();
      fleet.dispose();
    },
  };
}
