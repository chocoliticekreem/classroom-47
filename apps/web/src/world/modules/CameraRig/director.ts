// Imperative camera director for CameraRig: fly-to, follow/chase, hotkeys, cinematic tour, crash shake.
// Lives outside React so per-frame mutation of the camera doesn't fight the hooks rules.
import { Object3D, Raycaster, Vector2, Vector3, type Camera } from "three";
import { on } from "../../bus";
import { allVehicles, getVehicle, type VehicleEntry } from "../../registry";
import { useWorld } from "../../store";
import {
  approach, clamp, dollyDistance, wheelAction, FOLLOW_DIST, easeInOutCubic, framePosition, pickTourShot, poseIsSane, wheelDollyLog, zoneFrame,
  HOME_POS, HOME_TARGET, INTRO_POS, KEY_SPEED, WORLD_HALF, ZONE_KEYS, type TourShot,
} from "./logic";

const UP = new Vector3(0, 1, 0);
const TOUR_SHOT_MS = 7000;
const DOCK_CRANES = { x: 315, z: 0 };
const MAINT_YARD = { x: -140, z: -140 };
const FLY_S = 1.2;
const USER_HOLD_MS = 2500; // after manual input, auto-chase/drift waits this long
const SHAKE_MS = 700;
const MOVE_KEYS = new Set(["w", "a", "s", "d", "q", "e", "r", "f", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

interface Fly {
  fromPos: Vector3;
  fromTarget: Vector3;
  toPos: Vector3;
  toTarget: Vector3;
  start: number;
  dur: number;
  intro?: boolean;
}

export interface ControlsLike {
  target: Vector3;
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

const keyName = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

function randomVan(exclude?: string | null): VehicleEntry | undefined {
  const vans: VehicleEntry[] = [];
  for (const v of allVehicles()) if ((v.kind === "van" || v.kind === "truck") && v.id !== exclude) vans.push(v);
  return vans[Math.floor(Math.random() * vans.length)];
}

/** True if the wheel target sits in a HUD list that can actually scroll (so the wheel should scroll it). */
function overScrollableHud(target: EventTarget | null, stopAt: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== stopAt && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    if (el.hasAttribute("data-hud-scroll") || el.classList.contains("hud-scroll")) return true;
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return true;
  }
  return false;
}

export type CameraMode = "intro" | "fly" | "follow" | "tour" | "free";
/** Debug counters, exposed as window.__cityCamera. */
export const cameraDebug = { pinches: 0, wheels: 0, lastDolly: 0, mode: "free" as CameraMode };
declare global {
  interface Window {
    __cityCamera?: typeof cameraDebug;
  }
}

/** Readable from anywhere (e.g. the HUD) without touching the shared store. */
export const cameraRigStatus = { tour: false };

export class CameraDirector {
  private camera: Camera | null = null;
  private controls: ControlsLike | null = null;

  private fly: Fly | null = null;
  private followId: string | null = null;
  private lastVehPos = new Vector3();
  private heading = new Vector3(0, 0, 1);
  private hasLast = false;
  private lastUserInput = -1e9;
  private keys = new Set<string>();
  private tour = false;
  private tourStep = 0;
  private tourShotAt = 0;
  private tourDrift = 0.06; // rad/s orbit drift while holding a tour shot
  private shown = new Set<string>();
  private shakeUntil = 0;
  private shakeAmp = 0;
  private shake = new Vector3();
  /** pending: not started; running: swooping; done: finished or skipped by the user. */
  private introState: "pending" | "running" | "done" = "pending";
  private bound = false;
  private followDistance: number = FOLLOW_DIST.initial; // chase-cam distance; wheel/pinch adjust it
  private pendingZoom = 0; // natural-log dolly still to apply (wheel/pinch), eased in per frame
  private kv = { fwd: 0, right: 0, rot: 0, zoom: 0 }; // smoothed held-key axes
  // scratch
  private a = new Vector3();
  private b = new Vector3();
  private off = new Vector3();

  /**
   * Called on every (re)mount. The first bind resets to the home pose and drops stale selection/focus; later
   * binds (StrictMode double-mount, drei recreating the controls) carry the current target over.
   */
  bind(camera: Camera, controls: ControlsLike) {
    const prev = this.controls;
    this.camera = camera;
    this.controls = controls;
    if (!this.bound) {
      this.bound = true;
      this.reset();
      const st = useWorld.getState();
      if (st.selectedVehicle) st.select(null);
      if (st.focus) st.setFocus(null);
    } else if (prev && prev !== controls && poseIsSane(camera.position, prev.target)) {
      controls.target.copy(prev.target);
    }
  }

  /** Snap to the known home pose and stop every animation. */
  reset() {
    this.stopAll();
    const cam = this.camera, c = this.controls;
    if (!cam || !c) return;
    cam.position.set(...HOME_POS);
    c.target.set(...HOME_TARGET);
    cam.lookAt(c.target);
  }

  /** Cancel fly, tour, follow-chase easing, shake and held keys (camera stays where it is). */
  private stopAll() {
    if (this.fly?.intro) this.introState = "pending"; // interrupted by unmount, not the user: replay on remount
    this.fly = null;
    this.setTour(false);
    this.keys.clear();
    this.kv.fwd = this.kv.right = this.kv.rot = this.kv.zoom = 0;
    this.pendingZoom = 0;
    if (this.camera) this.camera.position.sub(this.shake);
    this.shake.set(0, 0, 0);
    this.shakeUntil = 0;
    this.shakeAmp = 0;
  }

  // ---------- shots ----------
  flyTo(toTarget: Vector3, toPos: Vector3, dur = FLY_S) {
    const cam = this.camera, c = this.controls;
    if (!cam || !c) return;
    this.fly = {
      fromPos: cam.position.clone(),
      fromTarget: c.target.clone(),
      toPos: toPos.clone(),
      toTarget: toTarget.clone(),
      start: performance.now(),
      dur: dur * 1000,
    };
  }

  private azimuth() {
    const cam = this.camera, c = this.controls;
    if (!cam || !c) return 0;
    return Math.atan2(cam.position.x - c.target.x, cam.position.z - c.target.z);
  }

  /** Frame a ground point keeping roughly the current azimuth so the camera doesn't spin wildly. */
  framePoint(x: number, z: number, distance = 110, elevation = 0.62, y = 0, dur = FLY_S) {
    const [px, py, pz] = framePosition(x, y, z, this.azimuth(), elevation, distance);
    this.flyTo(new Vector3(x, y, z), new Vector3(px, py, pz), dur);
  }

  /** One-time swoop into the home pose. Idempotent; any user input skips it. */
  intro() {
    const cam = this.camera, c = this.controls;
    if (!cam || !c || this.introState !== "pending") return;
    this.introState = "running";
    cam.position.set(...INTRO_POS);
    c.target.set(...HOME_TARGET);
    cam.lookAt(c.target);
    this.flyTo(new Vector3(...HOME_TARGET), new Vector3(...HOME_POS), 3.2);
    if (this.fly) this.fly.intro = true;
  }

  private endIntro() {
    if (this.introState === "running") this.introState = "done";
  }

  follow(id: string | null) {
    this.followId = id;
    this.hasLast = false;
    this.followDistance = FOLLOW_DIST.initial;
    if (!id) return;
    const v = getVehicle(id);
    if (!v) return;
    const p = v.object.position;
    const [px, py, pz] = framePosition(p.x, 1.5, p.z, this.azimuth(), 0.5, 45);
    this.flyTo(new Vector3(p.x, 1.5, p.z), new Vector3(px, py, pz), 1.0);
  }

  private setTour(on: boolean) {
    this.tour = on;
    cameraRigStatus.tour = on;
  }

  private runTourShot() {
    const st = useWorld.getState();
    const shot: TourShot = pickTourShot(this.tourStep++, st.incidents, this.shown);
    this.tourShotAt = performance.now();
    this.tourDrift = 0.06;
    if (shot.kind !== "chase" && st.selectedVehicle) st.select(null);
    switch (shot.kind) {
      case "incident":
        this.shown.add(shot.id);
        this.framePoint(shot.x, shot.z, 75, 0.55);
        break;
      case "chase": {
        const v = randomVan(st.selectedVehicle);
        if (v) st.select(v.id);
        else this.framePoint(0, 0, 420, 0.6);
        break;
      }
      case "skyline":
        this.tourDrift = 0.16;
        this.flyTo(new Vector3(0, 25, 0), new Vector3(...framePosition(0, 25, 0, -0.9, 0.38, 330)), 1.8);
        break;
      case "docks":
        this.tourDrift = 0.1;
        this.flyTo(
          new Vector3(DOCK_CRANES.x, 12, DOCK_CRANES.z),
          new Vector3(...framePosition(DOCK_CRANES.x, 12, DOCK_CRANES.z, -2.2, 0.3, 120)),
          1.8,
        );
        break;
      case "roadworks": {
        const rw = [...st.incidents].reverse().find((i) => i.kind === "roadworks" && i.status !== "cleared");
        const p = rw ?? MAINT_YARD;
        this.framePoint(p.x, p.z, 85, 0.5);
        break;
      }
    }
  }

  /** Called by MapControls onStart (user drag/wheel). */
  userInput() {
    this.lastUserInput = performance.now();
    this.fly = null;
    this.endIntro();
  }

  // ---------- wiring ----------
  /** Subscribes to store, bus, keyboard and canvas clicks. Returns cleanup. */
  attach(dom: HTMLElement) {
    const cleanups: (() => void)[] = [];

    // Store: follow + focus.
    const st0 = useWorld.getState();
    if (st0.selectedVehicle) this.follow(st0.selectedVehicle);
    if (st0.focus) this.handleFocus(st0.focus);
    cleanups.push(
      useWorld.subscribe((s, prev) => {
        if (s.selectedVehicle !== prev.selectedVehicle) this.follow(s.selectedVehicle);
        if (s.focus && s.focus !== prev.focus) this.handleFocus(s.focus);
      }),
    );

    // Bus: tour auto-focus on new incidents, crash shake.
    cleanups.push(
      on((e) => {
        if (e.type === "incident:created" && this.tour) {
          const st = useWorld.getState();
          const inc = st.incidents.find((i) => i.id === e.incidentId);
          if (!inc) return;
          if (st.selectedVehicle) st.select(null);
          this.shown.add(inc.id);
          this.tourShotAt = performance.now(); // hold this shot a full beat
          this.tourDrift = 0.06;
          this.framePoint(inc.x, inc.z, 75, 0.55);
        } else if (e.type === "vehicle:crashed") {
          const v = getVehicle(e.vehicleId);
          const c = this.controls;
          if (!v || !c) return;
          const d = Math.hypot(v.object.position.x - c.target.x, v.object.position.z - c.target.z);
          if (d < 160) {
            this.shakeAmp = Math.max(this.shakeAmp, 1.1 * (1 - d / 160) + 0.25);
            this.shakeUntil = performance.now() + SHAKE_MS;
          }
        }
      }),
    );

    // Keyboard.
    const down = (e: KeyboardEvent) => this.onKeyDown(e);
    const up = (e: KeyboardEvent) => this.keys.delete(keyName(e));
    const blur = () => this.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    cleanups.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    });

    // Click: vehicle -> follow, empty ground -> release.
    const ray = new Raycaster();
    const ndc = new Vector2();
    let downX = 0, downY = 0, downT = 0;
    const pd = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    };
    const pu = (e: PointerEvent) => {
      if (e.button !== 0 || !this.camera) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5 || performance.now() - downT > 450) return; // a drag
      const rect = dom.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const roots: Object3D[] = [];
      const owner = new Map<Object3D, string>();
      for (const v of allVehicles()) {
        roots.push(v.object);
        owner.set(v.object, v.id);
      }
      const hits = ray.intersectObjects(roots, true);
      let id: string | null = null;
      for (let o: Object3D | null = hits[0]?.object ?? null; o && !id; o = o.parent) id = owner.get(o) ?? null;
      const st = useWorld.getState();
      if (id) {
        if (st.selectedVehicle !== id) st.select(id);
      } else if (st.selectedVehicle) st.select(null);
    };
    dom.addEventListener("pointerdown", pd);
    dom.addEventListener("pointerup", pu);
    cleanups.push(() => {
      dom.removeEventListener("pointerdown", pd);
      dom.removeEventListener("pointerup", pu);
    });

    // Wheel / trackpad zoom. MapControls' own zoom is off (it steps a fixed amount per event, so trackpads
    // fly). Pinch arrives as wheel + ctrlKey: block the browser's page zoom anywhere on the page while the
    // city is mounted, and turn it into a camera dolly when it's over the canvas. ⌘+/⌘- still work.
    const container = dom.parentElement ?? dom;
    window.__cityCamera = cameraDebug;
    const wheel = (e: WheelEvent) => {
      const act = wheelAction({
        ctrl: e.ctrlKey,
        overCanvas: e.target instanceof Node && container.contains(e.target),
        overScrollableHud: overScrollableHud(e.target, container),
      });
      if (act.prevent) e.preventDefault();
      if (e.ctrlKey) cameraDebug.pinches++;
      else cameraDebug.wheels++;
      if (!act.zoom || !this.camera || !this.controls) return;
      const dist = this.followId ? this.followDistance : this.camera.position.distanceTo(this.controls.target);
      const d = wheelDollyLog(e.deltaY, e.deltaMode, e.ctrlKey, dist);
      cameraDebug.lastDolly = d;
      this.pendingZoom = clamp(this.pendingZoom + d, -1.5, 1.5);
      this.userInput(); // cancels any fly (intro, fly-to) so the dolly applies this frame
    };
    // Safari pinch fires non-standard gesture events; stop them zooming the page.
    const gesture = (e: Event) => e.preventDefault();
    window.addEventListener("wheel", wheel, { passive: false });
    for (const g of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(g, gesture, { passive: false });
    const prevTouch = container.style.touchAction;
    const prevOverscroll = container.style.overscrollBehavior;
    container.style.touchAction = "none";
    container.style.overscrollBehavior = "none";
    cleanups.push(() => {
      window.removeEventListener("wheel", wheel);
      for (const g of ["gesturestart", "gesturechange", "gestureend"]) document.removeEventListener(g, gesture);
      container.style.touchAction = prevTouch;
      container.style.overscrollBehavior = prevOverscroll;
    });

    return () => {
      cleanups.forEach((f) => f());
      this.stopAll();
    };
  }

  private handleFocus(f: { x: number; z: number }) {
    const st = useWorld.getState();
    if (st.selectedVehicle) st.select(null);
    this.framePoint(f.x, f.z, 80, 0.6);
    queueMicrotask(() => useWorld.getState().setFocus(null));
  }

  private onKeyDown(e: KeyboardEvent) {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = keyName(e);
    const st = useWorld.getState();
    if (this.introState === "running" && (MOVE_KEYS.has(k) || k === "Escape" || "12345vc".includes(k))) {
      this.fly = null;
      this.endIntro();
    }
    if (k === "Escape") {
      this.setTour(false);
      this.fly = null;
      if (st.selectedVehicle) st.select(null);
      return;
    }
    if (MOVE_KEYS.has(k)) {
      this.keys.add(k);
      if (k.startsWith("Arrow")) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    const zi = "12345".indexOf(k);
    if (zi >= 0) {
      if (st.selectedVehicle) st.select(null);
      const z = zoneFrame(ZONE_KEYS[zi]);
      this.framePoint(z.x, z.z, z.distance, 0.72, 0, 1.4);
    } else if (k === "v") {
      const v = randomVan(st.selectedVehicle);
      if (v) st.select(v.id);
    } else if (k === "c") {
      this.setTour(!this.tour);
      if (this.tour) {
        this.tourStep = st.incidents.some((i) => i.status !== "cleared") ? 1 : 0;
        this.runTourShot();
      } else if (st.selectedVehicle) st.select(null);
    }
  }

  // ---------- per frame ----------
  frame(rawDelta: number) {
    const cam = this.camera, c = this.controls;
    if (!cam || !c) return;
    const dt = Math.min(rawDelta, 0.1);
    const now = performance.now();
    const { a, b, off } = this;

    // Remove last frame's shake before doing anything else.
    cam.position.sub(this.shake);
    this.shake.set(0, 0, 0);

    // Recover from a broken pose (NaN from a bad target, camera on its target) instead of rendering nothing.
    if (!poseIsSane(cam.position, c.target)) this.reset();

    // Held keys: eased velocities so movement starts and stops smoothly.
    const k = this.keys;
    const kv = this.kv;
    const axis = (p: boolean, n: boolean) => (p ? 1 : 0) - (n ? 1 : 0);
    const r = KEY_SPEED.response;
    kv.fwd = approach(kv.fwd, axis(k.has("w") || k.has("ArrowUp"), k.has("s") || k.has("ArrowDown")), r, dt);
    kv.right = approach(kv.right, axis(k.has("d") || k.has("ArrowRight"), k.has("a") || k.has("ArrowLeft")), r, dt);
    kv.rot = approach(kv.rot, axis(k.has("q"), k.has("e")), r, dt);
    kv.zoom = approach(kv.zoom, axis(k.has("f"), k.has("r")), r, dt);
    const keyed = k.size > 0;
    if (keyed) this.lastUserInput = now;
    const EPS = 1e-3;
    if (Math.abs(kv.fwd) > EPS || Math.abs(kv.right) > EPS) {
      if (keyed && this.followId) useWorld.getState().select(null);
      const dist = cam.position.distanceTo(c.target);
      a.subVectors(c.target, cam.position).setY(0); // ground-projected forward
      if (a.lengthSq() < 1e-6) a.set(0, 0, -1);
      a.normalize();
      b.set(-a.z, 0, a.x); // right
      const pan = dist * KEY_SPEED.pan * dt;
      off.copy(a).multiplyScalar(kv.fwd * pan).addScaledVector(b, kv.right * pan);
      c.target.add(off);
      cam.position.add(off);
      if (keyed) this.fly = null;
    }
    if (Math.abs(kv.rot) > EPS) {
      off.subVectors(cam.position, c.target).applyAxisAngle(UP, kv.rot * KEY_SPEED.rotate * dt);
      cam.position.copy(c.target).add(off);
    }
    // Zoom: held R/F plus eased wheel/pinch dolly.
    let zoomLog = kv.zoom * KEY_SPEED.zoom * dt;
    if (this.pendingZoom !== 0) {
      const step = this.pendingZoom * (1 - Math.exp(-14 * dt));
      this.pendingZoom = Math.abs(this.pendingZoom - step) < 1e-4 ? 0 : this.pendingZoom - step;
      zoomLog += step;
    }
    if (zoomLog !== 0) {
      if (this.fly) {
        // A zoom always wins over a running fly (intro or fly-to).
        if (this.fly.intro) this.endIntro();
        this.fly = null;
      }
      if (this.followId) {
        // The chase recomputes the offset each frame, so zoom its distance instead of the camera.
        this.followDistance = clamp(this.followDistance * Math.exp(zoomLog), FOLLOW_DIST.min, FOLLOW_DIST.max);
      }
      off.subVectors(cam.position, c.target);
      off.setLength(dollyDistance(off.length(), zoomLog));
      cam.position.copy(c.target).add(off);
    }

    if (this.fly) {
      // Eased fly-to.
      const f = this.fly;
      if (this.followId) {
        // Keep the destination glued to the moving vehicle.
        const v = getVehicle(this.followId);
        if (v) {
          off.subVectors(f.toPos, f.toTarget);
          f.toTarget.set(v.object.position.x, 1.5, v.object.position.z);
          f.toPos.copy(f.toTarget).add(off);
        }
      }
      const t = easeInOutCubic((now - f.start) / f.dur);
      c.target.lerpVectors(f.fromTarget, f.toTarget, t);
      cam.position.lerpVectors(f.fromPos, f.toPos, t);
      if (t >= 1) {
        if (f.intro) this.endIntro();
        this.fly = null;
      }
    } else if (this.followId) {
      this.chase(dt, now);
    } else if (this.tour && !keyed && now - this.lastUserInput > USER_HOLD_MS) {
      // Slow orbital drift while holding a tour shot.
      off.subVectors(cam.position, c.target).applyAxisAngle(UP, this.tourDrift * dt);
      cam.position.copy(c.target).add(off);
    }

    if (this.tour && now - this.tourShotAt > TOUR_SHOT_MS) this.runTourShot();

    // Crash shake (removed again next frame).
    if (now < this.shakeUntil) {
      const k = ((this.shakeUntil - now) / SHAKE_MS) * this.shakeAmp;
      this.shake.set(Math.sin(now * 0.071) * k, Math.sin(now * 0.093 + 1.3) * k * 0.6, Math.sin(now * 0.057 + 2.1) * k);
      cam.position.add(this.shake);
    } else this.shakeAmp = 0;

    // Keep the target inside the world so panning can't drift into the void.
    const cx = clamp(c.target.x, -WORLD_HALF, WORLD_HALF) - c.target.x;
    const cz = clamp(c.target.z, -WORLD_HALF, WORLD_HALF) - c.target.z;
    if (cx || cz) {
      c.target.x += cx;
      c.target.z += cz;
      cam.position.x += cx;
      cam.position.z += cz;
    }
    if (cam.position.y < 2) cam.position.y = 2;
    cam.lookAt(c.target);
    cameraDebug.mode = this.fly ? (this.fly.intro ? "intro" : "fly") : this.followId ? "follow" : this.tour ? "tour" : "free";
  }

  private chase(dt: number, now: number) {
    const cam = this.camera!, c = this.controls!;
    const { a, b, off } = this;
    const v = getVehicle(this.followId!);
    if (!v) {
      useWorld.getState().select(null);
      return;
    }
    const p = v.object.position;
    if (this.hasLast) {
      a.subVectors(p, this.lastVehPos).setY(0);
      const moved = a.length();
      if (moved > 0.02 && moved < 20) this.heading.lerp(a.normalize(), 1 - Math.exp(-4 * dt)).normalize();
    } else {
      this.heading.set(Math.sin(v.object.rotation.y), 0, Math.cos(v.object.rotation.y));
    }
    this.lastVehPos.copy(p);
    this.hasLast = true;

    off.subVectors(cam.position, c.target);
    // Glide the target onto the vehicle; the camera keeps its offset so orbit/zoom stay usable.
    b.set(p.x, 1.5, p.z);
    a.subVectors(b, c.target).multiplyScalar(1 - Math.exp(-8 * dt));
    c.target.add(a);
    // Ease the offset toward "behind and above" unless the user touched the controls recently.
    const dist = this.followDistance;
    if (now - this.lastUserInput > USER_HOLD_MS) {
      b.copy(this.heading).multiplyScalar(-Math.cos(0.42) * dist);
      b.y = Math.sin(0.42) * dist;
      off.lerp(b, 1 - Math.exp(-1.6 * dt));
    }
    // Distance follows followDistance (wheel/pinch) quickly, whatever the direction is doing.
    if (off.lengthSq() < 1e-6) off.set(0, dist, dist);
    off.setLength(approach(off.length(), dist, 12, dt));
    cam.position.copy(c.target).add(off);
  }
}
