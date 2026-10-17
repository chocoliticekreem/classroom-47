// Transit engine: one passenger pool shared by buses and metro, rendered in two draw calls.
import { useWorld } from "../../store";
import type { Camera } from "three";
import { ViewCheck } from "../DeliveryFleet/lookahead";
import { createBuses, type BusOptions } from "./buses";
import { nightLevel } from "./kit";
import { createMetro } from "./metro";
import { PassengerPool } from "./passengers";
import { createPeople } from "./people";

export function createTransit(opts: BusOptions = {}) {
  const pool = new PassengerPool(720, 1717);
  const buses = createBuses(pool, undefined, opts);
  const view = new ViewCheck(); // off-screen buses raycast every 4th frame
  const metro = createMetro(pool);
  const people = createPeople(pool);
  return {
    meshes: [...buses.meshes, ...metro.meshes, ...people.meshes],
    register: () => buses.register(),
    busState: () => buses.state(),
    tick(delta: number, camera?: Camera) {
      const dt = Math.min(delta, 0.1);
      const { paused, timeOfDay } = useWorld.getState();
      const night = nightLevel(timeOfDay);
      const now = performance.now();
      if (!paused) pool.step(dt);
      if (camera) view.update(camera);
      buses.tick(dt, now, !paused, night, view.sees);
      metro.tick(dt, !paused, night);
      people.tick();
    },
    dispose() {
      buses.dispose();
      metro.dispose();
      people.dispose();
    },
  };
}
