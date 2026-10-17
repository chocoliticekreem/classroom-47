// Quay operations at the terminal berth (pure, no three.js): three ship-to-shore cranes work the REAL ship
// described by berths.ts (BERTHS.terminal). While the ship is `working` they discharge the top box of every
// deck column in their bay range onto the apron (or straight onto a waiting lorry on the quay road), straddle
// carriers ferry apron boxes to the RMG blocks' transfer stacks (the RMGs stack them into the yard), and then
// the flow reverses: RMGs stage exports on the transfer stacks, straddles bring them to the apron and the
// cranes load them into empty deck slots until the deck is ~60% full. Then `craneDone = true`.
import { deckIndex, deckSlotPosition, type BerthState } from "../../berths";
import { BLOCKS, BRANDS, CONTAINER, RMG_COUNT, STS, TINTS, TRAILER_BED_Y, Track, clamp01, smooth } from "./layout";
import { MAX_TIER, type Box, type Yard } from "./yard";

const H = CONTAINER.h;

// ---------------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------------

export const STS_COUNT = 3;
/** Bay ranges (inclusive) per crane: 3 + 4 + 3 of the ship's 10 bays. */
export const STS_RANGES: [number, number][] = [[0, 2], [3, 6], [7, 9]];
export const STS_SPEC = {
  padX: STS.padX, // apron landing lane (between the landside legs and the coast road)
  homeX: 332, // trolley parking position
  topY: 24, // spreader bottom while travelling (clears 4 tiers on deck + a carried box)
  gantrySpeed: 4.5, // m/s along z
  trolleySpeed: 10, // m/s along x
  hoistSpeed: 7, // m/s
  latch: 0.5,
  minGap: 19, // closest two cranes may get (portal width + margin)
  boomRate: 1 / 9, // boom raise/lower, fraction per second
  loadTarget: 0.6, // stop loading at this deck fill
  maxLoadS: 330, // each crane loads for at most this long, so ships keep coming and going
};
export const STRADDLE_COUNT = 6;
const CORRIDOR_X = 319;
const STRADDLE_SPEED = 11;
const STRADDLE_TRAVEL_LIFT = 8.2; // box bottom while driving (1 over 3)
const STRADDLE_HANDLE = 2.6; // s to lower + latch + lift
const PAD_CAP = 2; // boxes a crane may stack on its apron spot
const TRANSFER_CAP = 4;

/** The quay-side transfer stack of each RMG block: bay 3 (east end), the row furthest from the truck lane. */
export function transferStackIds(yard: Yard): number[] {
  const out: number[] = [];
  for (let k = 0; k < RMG_COUNT; k++) {
    const rows = BLOCKS[k].rowsZ.length;
    const s = yard.stacks.find((x) => x.block === k && x.bay === 3 && x.row === rows - 1);
    if (s) out.push(s.id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// box <-> deck slot
// ---------------------------------------------------------------------------------------------------

export function boxFromSlot(color: string, brand?: string): Box {
  const bi = brand ? BRANDS.findIndex((b) => b.name === brand) : -1;
  if (bi > 0) return { brand: bi, tint: 0 };
  const ti = TINTS.indexOf(color);
  return ti >= 0 ? { brand: 0, tint: ti } : { brand: 0, tint: 0, color };
}
export function slotFromBox(b: Box): { color: string; brand?: string } {
  if (b.brand > 0) return { color: BRANDS[b.brand].base, brand: BRANDS[b.brand].name };
  return { color: b.color ?? TINTS[b.tint % TINTS.length] };
}

export function deckFill(b: BerthState) {
  let n = 0;
  for (const s of b.deck) if (s.color) n++;
  return b.deck.length ? n / b.deck.length : 0;
}
export function columnHeight(b: BerthState, bay: number, row: number) {
  let h = 0;
  while (h < b.tiers && b.deck[deckIndex(b, bay, row, h)].color) h++;
  return h;
}

// ---------------------------------------------------------------------------------------------------
// STS cranes
// ---------------------------------------------------------------------------------------------------

type End =
  | { kind: "deck"; bay: number; row: number; tier: number }
  | { kind: "pad"; z: number; tier: number }
  | { kind: "truck"; truckId: string; x: number; z: number };

export interface StsJob {
  kind: "discharge" | "load";
  from: End;
  to: End;
  box: Box | null;
  steps: number[];
  t: number;
  picked: boolean;
  dropped: boolean;
  startX: number;
  startZ: number;
  startY: number;
}

export interface StsCrane {
  index: number;
  range: [number, number];
  homeZ: number;
  z: number; // gantry position along the quay
  trolleyX: number;
  spreaderY: number; // spreader bottom
  sway: number;
  boom: number; // 0 = down (working), 1 = raised
  mode: "idle" | "discharge" | "load" | "done";
  job: StsJob | null;
  queue: { bay: number; row: number }[]; // discharge plan
  discharged: number;
  loaded: number;
  waitLoad: number; // seconds spent waiting for an export box
  loadTime: number; // seconds in load mode this call
}

export interface PadBox {
  crane: number;
  box: Box;
  x: number;
  z: number;
  tier: number;
  export: boolean;
  claimed: boolean;
}

export type QuayEvent = { type: "truckLoaded"; truckId: string; box: Box };

// ---------------------------------------------------------------------------------------------------
// straddle carriers
// ---------------------------------------------------------------------------------------------------

type SEnd = { kind: "pad"; pad: PadBox } | { kind: "stack"; stack: number };
export interface StraddleUnit {
  index: number;
  x: number;
  z: number;
  h: number;
  lift: number; // spreader / box bottom height
  box: Box | null;
  phase: "idle" | "toSrc" | "pick" | "toDst" | "drop" | "park";
  src: SEnd | null;
  dst: SEnd | null;
  track: Track | null;
  s: number;
  reverse: boolean;
  timer: number;
  parkZ: number;
}

export interface QuayHooks {
  /** Is this RMG crane busy with a stack right now (avoid picking a box it's moving)? */
  rmgTouches(stack: number): boolean;
}

const _pos = { x: 0, z: 0, h: 0 };

export class Quay {
  readonly cranes: StsCrane[];
  readonly pads: PadBox[] = [];
  readonly straddles: StraddleUnit[];
  readonly transfers: number[];
  /** Lorries parked on the quay road waiting for a box straight off the ship, per crane. */
  readonly direct: ({ truckId: string; x: number; z: number } | null)[] = [null, null, null];
  private readonly pendingDrop = new Map<number, number>();
  private readonly pendingPick = new Map<number, number>();
  private readonly events: QuayEvent[] = [];
  private lastPhase = "";
  /** Seconds since this call's work started. */
  callTime = 0;

  constructor(
    readonly berth: BerthState,
    private readonly yard: Yard,
    private readonly hooks: QuayHooks,
    private readonly rand: () => number,
  ) {
    this.transfers = transferStackIds(yard);
    for (const t of this.transfers) yard.reserved.add(t);
    this.cranes = STS_RANGES.map((range, index) => {
      const z = this.bayZ((range[0] + range[1]) / 2);
      return {
        index, range, homeZ: z, z, trolleyX: STS_SPEC.homeX, spreaderY: STS_SPEC.topY, sway: 0, boom: 1, mode: "idle" as const,
        job: null, queue: [], discharged: 0, loaded: 0, waitLoad: 0, loadTime: 0,
      };
    });
    this.straddles = Array.from({ length: STRADDLE_COUNT }, (_, index) => {
      const z = 150 + index * 36;
      return {
        index, x: CORRIDOR_X, z, h: 0, lift: STRADDLE_TRAVEL_LIFT, box: null, phase: "idle" as const, src: null, dst: null,
        track: null, s: 0, reverse: false, timer: 0, parkZ: z,
      };
    });
  }

  /** Quay z of a ship bay when the ship is moored at its berth line (cranes park/aim with this). */
  bayZ(bay: number) {
    const b = this.berth;
    return (b.zMin + b.zMax) / 2 + (bay - (b.bays - 1) / 2) * 12.6;
  }

  /** Any crane loading (the RMGs then stage export boxes on the transfer stacks). */
  get exportWanted() {
    return this.cranes.some((c) => c.mode === "load");
  }

  /** A discharging crane that could use a lorry on the quay road (null if none). */
  craneWantingTruck(): number | null {
    let best: number | null = null;
    for (const c of this.cranes)
      if (c.mode === "discharge" && c.queue.length >= 3 && !this.direct[c.index]) {
        if (best === null || this.cranes[best].queue.length < c.queue.length) best = c.index;
      }
    return best;
  }

  requestDirect(crane: number, truckId: string, x: number, z: number) {
    this.direct[crane] = { truckId, x, z };
  }
  cancelDirect(truckId: string) {
    for (let i = 0; i < this.direct.length; i++) if (this.direct[i]?.truckId === truckId) this.direct[i] = null;
  }

  // ------------------------------------------------------------------------------------------------

  update(dt: number): readonly QuayEvent[] {
    this.events.length = 0;
    const b = this.berth;
    if (b.phase !== this.lastPhase) {
      this.lastPhase = b.phase;
      if (b.phase === "working" && !b.craneDone) this.startCall();
      if (b.phase !== "working") for (const c of this.cranes) if (!c.job) c.mode = "idle";
    }
    if (b.phase === "working") this.callTime += dt;
    for (const c of this.cranes) this.tickCrane(c, dt);
    if (b.phase === "working" && !b.craneDone && this.cranes.every((c) => c.mode === "done" && !c.job)) b.craneDone = true;
    for (const s of this.straddles) this.tickStraddle(s, dt);
    return this.events;
  }

  private startCall() {
    const b = this.berth;
    this.callTime = 0;
    for (const c of this.cranes) {
      c.queue = [];
      c.discharged = 0;
      c.loaded = 0;
      c.waitLoad = 0;
      c.loadTime = 0;
      for (let bay = c.range[0]; bay <= c.range[1]; bay++) {
        const rows: number[] = [];
        for (let row = 0; row < b.rows; row++) if (columnHeight(b, bay, row) > 0) rows.push(row);
        // snake across the beam so the trolley doesn't race back and forth
        if ((bay - c.range[0]) % 2) rows.reverse();
        for (const row of rows) c.queue.push({ bay, row });
      }
      c.mode = c.queue.length ? "discharge" : "load";
    }
  }

  /** Would a crane at z crowd (or pass) a neighbour, given where the neighbours are and are heading? */
  private otherCraneNear(c: StsCrane, z: number) {
    for (const o of this.cranes) {
      if (o === c) continue;
      const zs = [o.z];
      if (o.job) zs.push(this.endPos(o.job.from, _e).z, this.endPos(o.job.to, _e).z);
      for (const oz of zs) {
        if (Math.abs(oz - z) < STS_SPEC.minGap) return true;
        if ((o.index < c.index && z < oz) || (o.index > c.index && z > oz)) return true;
      }
    }
    return false;
  }

  private tickCrane(c: StsCrane, dt: number) {
    const b = this.berth;
    if (c.mode === "load") c.loadTime += dt;
    const working = b.phase === "working" && (c.mode === "discharge" || c.mode === "load" || !!c.job);
    // boom: down only while working this call
    const boomTarget = working ? 0 : 1;
    c.boom += Math.max(-STS_SPEC.boomRate * dt, Math.min(STS_SPEC.boomRate * dt, boomTarget - c.boom));
    if (c.job) {
      this.runJob(c, dt);
      return;
    }
    c.sway *= Math.exp(-dt * 2);
    if (!working || c.boom > 0.02) {
      // park: trolley home, gantry drifts back to its home position
      c.trolleyX += Math.max(-STS_SPEC.trolleySpeed * dt, Math.min(STS_SPEC.trolleySpeed * dt, STS_SPEC.homeX - c.trolleyX));
      c.spreaderY += Math.max(-STS_SPEC.hoistSpeed * dt, Math.min(STS_SPEC.hoistSpeed * dt, STS_SPEC.topY - c.spreaderY));
      if (!this.otherCraneNearMoving(c, c.homeZ)) c.z += Math.max(-STS_SPEC.gantrySpeed * dt, Math.min(STS_SPEC.gantrySpeed * dt, c.homeZ - c.z));
      return;
    }
    if (c.mode === "discharge") this.planDischarge(c);
    else if (c.mode === "load") this.planLoad(c, dt);
  }

  private otherCraneNearMoving(c: StsCrane, z: number) {
    for (const o of this.cranes) if (o !== c && Math.abs(o.z - z) < STS_SPEC.minGap - 0.5) return true;
    return false;
  }

  private planDischarge(c: StsCrane) {
    const b = this.berth;
    // drop any planned columns that emptied meanwhile
    while (c.queue.length && columnHeight(b, c.queue[0].bay, c.queue[0].row) === 0) c.queue.shift();
    if (!c.queue.length) {
      c.mode = "load";
      return;
    }
    // first reachable column (skip bays too close to a neighbour for now)
    let qi = -1;
    for (let i = 0; i < c.queue.length; i++)
      if (!this.otherCraneNear(c, this.bayZ(c.queue[i].bay))) {
        qi = i;
        break;
      }
    if (qi < 0) return;
    const { bay, row } = c.queue[qi];
    const tier = columnHeight(b, bay, row) - 1;
    // destination: a lorry waiting on the quay road, else the apron spot under the crane
    let to: End | null = null;
    const d = this.direct[c.index];
    if (d && !this.otherCraneNear(c, d.z)) to = { kind: "truck", truckId: d.truckId, x: d.x, z: d.z };
    if (!to) {
      const z = this.bayZ(bay);
      const here = this.pads.filter((p) => p.crane === c.index);
      if (here.length >= PAD_CAP) return; // apron full: wait for a straddle
      const stack = here.filter((p) => Math.abs(p.z - z) < 0.5 && !p.claimed);
      if (here.length && !stack.length) return; // one apron spot per crane at a time
      to = { kind: "pad", z, tier: stack.length };
    }
    c.queue.splice(qi, 1);
    c.job = this.makeJob(c, "discharge", { kind: "deck", bay, row, tier }, to, null);
  }

  private planLoad(c: StsCrane, dt: number) {
    const b = this.berth;
    const capReached = this.loadCapReached(c);
    const pad = this.pads.find((p) => p.crane === c.index && p.export && !p.claimed && this.isTopPad(p));
    if (capReached && !pad) {
      c.mode = "done";
      return;
    }
    if (!pad) {
      c.waitLoad += dt;
      if (c.waitLoad > 150) c.mode = "done"; // no exports coming: give up for this call
      return;
    }
    c.waitLoad = 0;
    // emptiest column in range that a neighbour isn't crowding
    let best: { bay: number; row: number; h: number } | null = null;
    for (let bay = c.range[0]; bay <= c.range[1]; bay++) {
      if (this.otherCraneNear(c, this.bayZ(bay))) continue;
      for (let row = 0; row < b.rows; row++) {
        const h = columnHeight(b, bay, row);
        if (h >= b.tiers) continue;
        const score = h * 10 + Math.abs(this.bayZ(bay) - c.z) * 0.05;
        if (!best || score < best.h) best = { bay, row, h: score };
      }
    }
    if (!best) {
      if (capReached || !this.anyRoom(c)) c.mode = "done";
      return;
    }
    pad.claimed = true;
    const tier = columnHeight(b, best.bay, best.row);
    c.job = this.makeJob(c, "load", { kind: "pad", z: pad.z, tier: pad.tier }, { kind: "deck", bay: best.bay, row: best.row, tier }, pad.box);
    // remember which pad box we're lifting (removed at pick time)
    (c.job as StsJob & { pad?: PadBox }).pad = pad;
  }

  /** Loading stops at ~60% deck fill (and never more than ~1.3x what this crane took off, to bound the call). */
  loadCapReached(c: StsCrane) {
    return (
      c.loaded >= Math.ceil(c.discharged * 1.3) + 4 || deckFill(this.berth) >= STS_SPEC.loadTarget || c.loadTime > STS_SPEC.maxLoadS
    );
  }

  private anyRoom(c: StsCrane) {
    const b = this.berth;
    for (let bay = c.range[0]; bay <= c.range[1]; bay++) for (let row = 0; row < b.rows; row++) if (columnHeight(b, bay, row) < b.tiers) return true;
    return false;
  }

  private isTopPad(p: PadBox) {
    return !this.pads.some((o) => o !== p && o.crane === p.crane && Math.abs(o.z - p.z) < 0.5 && o.tier > p.tier);
  }

  /** Live world position (x, z, box-bottom y, gantry z) of a job end. */
  endPos(e: End, out: { x: number; y: number; z: number }) {
    if (e.kind === "deck") {
      const p = deckSlotPosition(this.berth, e.bay, e.row, e.tier);
      out.x = p.x;
      out.y = p.y - H / 2;
      out.z = p.z;
    } else if (e.kind === "pad") {
      out.x = STS_SPEC.padX;
      out.y = 0.03 + e.tier * H;
      out.z = e.z;
    } else {
      out.x = e.x;
      out.y = TRAILER_BED_Y;
      out.z = e.z;
    }
    return out;
  }

  private makeJob(c: StsCrane, kind: StsJob["kind"], from: End, to: End, box: Box | null): StsJob {
    const S = STS_SPEC;
    const a = this.endPos(from, { x: 0, y: 0, z: 0 });
    const d = this.endPos(to, { x: 0, y: 0, z: 0 });
    const move = (x0: number, z0: number, x1: number, z1: number) =>
      Math.max(Math.abs(x1 - x0) / S.trolleySpeed, Math.abs(z1 - z0) / S.gantrySpeed) + 0.5;
    const hoist = (y: number) => Math.abs(S.topY - (y + H)) / S.hoistSpeed + 0.3;
    const steps = [move(c.trolleyX, c.z, a.x, a.z), hoist(a.y), S.latch, hoist(a.y), move(a.x, a.z, d.x, d.z), hoist(d.y), S.latch, hoist(d.y)];
    return { kind, from, to, box, steps, t: 0, picked: false, dropped: false, startX: c.trolleyX, startZ: c.z, startY: c.spreaderY };
  }

  private runJob(c: StsCrane, dt: number) {
    const j = c.job!;
    const b = this.berth;
    j.t += dt;
    const a = this.endPos(j.from, _a);
    const d = this.endPos(j.to, _d);
    evalStsJob(j, a, d, c);
    const s = j.steps;
    const tPick = s[0] + s[1] + s[2];
    const tDrop = tPick + s[3] + s[4] + s[5] + s[6];
    if (!j.picked && j.t >= tPick) {
      j.picked = true;
      if (j.from.kind === "deck") {
        const slot = b.deck[deckIndex(b, j.from.bay, j.from.row, j.from.tier)];
        if (slot.color) {
          j.box = boxFromSlot(slot.color, slot.brand);
          slot.color = null;
          slot.brand = undefined;
          b.discharged++;
          c.discharged++;
        }
      } else if (j.from.kind === "pad") {
        const pad = (j as StsJob & { pad?: PadBox }).pad;
        if (pad) {
          const i = this.pads.indexOf(pad);
          if (i >= 0) this.pads.splice(i, 1);
        }
      }
    }
    if (!j.dropped && j.t >= tDrop) {
      j.dropped = true;
      if (j.box) {
        if (j.to.kind === "deck") {
          const slot = b.deck[deckIndex(b, j.to.bay, j.to.row, j.to.tier)];
          const v = slotFromBox(j.box);
          slot.color = v.color;
          slot.brand = v.brand;
          b.loaded++;
          c.loaded++;
        } else if (j.to.kind === "pad") {
          this.pads.push({ crane: c.index, box: j.box, x: STS_SPEC.padX, z: j.to.z, tier: j.to.tier, export: false, claimed: false });
        } else {
          this.events.push({ type: "truckLoaded", truckId: j.to.truckId, box: j.box });
          if (this.direct[c.index]?.truckId === j.to.truckId) this.direct[c.index] = null;
        }
      }
    }
    if (j.t >= s.reduce((x, y) => x + y, 0)) c.job = null;
  }

  /** The box hanging from a crane's spreader right now (null if none). */
  carried(c: StsCrane): Box | null {
    const j = c.job;
    if (!j || !j.picked || j.dropped) return null;
    return j.box;
  }

  // ------------------------------------------------------------------------------------------------
  // straddle carriers

  private pend(m: Map<number, number>, k: number, d: number) {
    m.set(k, (m.get(k) ?? 0) + d);
  }

  private chooseJob(u: StraddleUnit): boolean {
    const y = this.yard;
    // 1) import boxes waiting on the apron (top of their spot first) -> emptiest transfer stack
    // (export boxes left on the apron by a crane that has finished go back to the yard too)
    const imports = this.pads.filter((p) => (!p.export || this.cranes[p.crane].mode !== "load") && !p.claimed && this.isTopPad(p));
    if (imports.length) {
      imports.sort((p, q) => Math.abs(p.z - u.z) - Math.abs(q.z - u.z));
      let best = -1;
      let bh = Infinity;
      for (const t of this.transfers) {
        const h = y.height(t) + (this.pendingDrop.get(t) ?? 0);
        if (h < TRANSFER_CAP && h < bh && !this.hooks.rmgTouches(t)) {
          bh = h;
          best = t;
        }
      }
      if (best >= 0) {
        const pad = imports[0];
        pad.claimed = true;
        this.pend(this.pendingDrop, best, 1);
        this.assign(u, { kind: "pad", pad }, { kind: "stack", stack: best });
        return true;
      }
    }
    // 2) a loading crane short of export boxes on its apron spot -> fetch one from a transfer stack
    for (const c of this.cranes) {
      if (c.mode !== "load" || this.loadCapReached(c)) continue;
      const onPad = this.pads.filter((p) => p.crane === c.index).length;
      const incoming = this.straddles.filter((s) => s.dst?.kind === "pad" && s.dst.pad.crane === c.index).length;
      if (onPad + incoming >= PAD_CAP) continue;
      for (const t of this.transfers) {
        const avail = y.height(t) - (this.pendingPick.get(t) ?? 0);
        if (avail <= 0 || this.hooks.rmgTouches(t)) continue;
        this.pend(this.pendingPick, t, 1);
        const z = this.loadPadZ(c);
        const tier = this.pads.filter((p) => p.crane === c.index && Math.abs(p.z - z) < 0.5).length + incoming;
        const pad: PadBox = { crane: c.index, box: { brand: 0, tint: 0 }, x: STS_SPEC.padX, z, tier, export: true, claimed: true };
        this.assign(u, { kind: "stack", stack: t }, { kind: "pad", pad });
        return true;
      }
    }
    return false;
  }

  /** Where a loading crane wants its export boxes set down: under its current position. */
  private loadPadZ(c: StsCrane) {
    const existing = this.pads.find((p) => p.crane === c.index);
    if (existing) return existing.z;
    const out = this.straddles.find((s) => s.dst?.kind === "pad" && s.dst.pad.crane === c.index);
    if (out && out.dst?.kind === "pad") return out.dst.pad.z;
    return Math.round(c.z * 10) / 10;
  }

  private assign(u: StraddleUnit, src: SEnd, dst: SEnd) {
    u.src = src;
    u.dst = dst;
    u.phase = "toSrc";
    this.route(u, src, null);
  }

  private endPoint(e: SEnd): { x: number; z: number; alongX: boolean } {
    if (e.kind === "pad") return { x: e.pad.x, z: e.pad.z, alongX: false };
    const s = this.yard.stacks[e.stack];
    return { x: s.x, z: s.z, alongX: true };
  }

  /** Build a smooth track from the unit to an end (pads approached along z, yard stacks along x). */
  private route(u: StraddleUnit, to: SEnd | null, park: { z: number } | null) {
    const pts: [number, number][] = [[u.x, u.z]];
    const atStack = u.x < 312;
    const atPad = u.x > 324;
    if (atStack) pts.push([u.x + 8, u.z], [312, u.z]);
    let tx = CORRIDOR_X;
    let tz = park ? park.z : u.z;
    let along = false;
    if (to) {
      const e = this.endPoint(to);
      tx = e.x;
      tz = e.z;
      along = e.alongX;
    }
    if (to && !along) {
      // pad: run along the corridor, then swing in along z
      const s = Math.sign(tz - u.z) || 1;
      if (atPad) pts.push([u.x, u.z + s * 9]);
      pts.push([CORRIDOR_X, tz - s * 22], [tx, tz - s * 10], [tx, tz]);
    } else if (to) {
      if (atPad) {
        const s = Math.sign(tz - u.z) || 1;
        pts.push([u.x, u.z + s * 9], [CORRIDOR_X, u.z + s * 20]);
      }
      pts.push([CORRIDOR_X, tz + (tz > u.z ? -10 : 10)], [310, tz], [tx + 7, tz], [tx, tz]);
    } else {
      if (atPad) pts.push([u.x, u.z + 9]);
      pts.push([CORRIDOR_X, tz]);
    }
    // de-duplicate consecutive points
    const clean: [number, number][] = [];
    for (const p of pts) if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 0.5) clean.push(p);
    if (clean.length < 2) clean.push([tx + 0.01, tz + 0.01]);
    u.track = new Track(clean, 2);
    u.s = 0;
    // drive forward or backward, whichever avoids spinning on the spot
    u.track.at(0.5, _pos);
    const d = Math.cos(_pos.h - u.h);
    u.reverse = d < -0.2;
  }

  private tickStraddle(u: StraddleUnit, dt: number) {
    switch (u.phase) {
      case "idle":
        if (!this.chooseJob(u)) {
          if (Math.abs(u.x - CORRIDOR_X) > 1 || Math.abs(u.z - u.parkZ) > 1) {
            u.phase = "park";
            this.route(u, null, { z: u.parkZ });
          }
        }
        return;
      case "park":
      case "toSrc":
      case "toDst": {
        const tr = u.track!;
        const L = tr.length;
        // trapezoid-ish speed profile from smoothstep over the leg
        const total = L / STRADDLE_SPEED + 1.2;
        u.timer += dt;
        const k = smooth(clamp01(u.timer / total));
        u.s = k * L;
        tr.at(u.s, _pos);
        u.x = _pos.x;
        u.z = _pos.z;
        u.h = u.reverse ? _pos.h + Math.PI : _pos.h;
        u.lift += Math.max(-3 * dt, Math.min(3 * dt, STRADDLE_TRAVEL_LIFT - u.lift));
        if (k >= 1) {
          u.timer = 0;
          if (u.phase === "park") u.phase = "idle";
          else if (u.phase === "toSrc") u.phase = "pick";
          else u.phase = "drop";
          // facing over a pad: along z; over a stack: along x
          if (u.phase === "pick" || u.phase === "drop") this.alignTo(u, u.phase === "pick" ? u.src! : u.dst!);
        }
        return;
      }
      case "pick": {
        u.timer += dt;
        const src = u.src!;
        const bottom = this.endBottom(src, !!u.box);
        const k = u.timer / STRADDLE_HANDLE;
        u.lift = k < 0.5 ? STRADDLE_TRAVEL_LIFT + (bottom - STRADDLE_TRAVEL_LIFT) * smooth(k * 2) : bottom + (STRADDLE_TRAVEL_LIFT - bottom) * smooth(k * 2 - 1);
        if (k >= 0.5 && !u.box) u.box = this.take(src);
        if (k >= 1) {
          u.timer = 0;
          if (!u.box) {
            this.release(u);
            return;
          }
          u.phase = "toDst";
          this.route(u, u.dst!, null);
        }
        return;
      }
      case "drop": {
        u.timer += dt;
        const dst = u.dst!;
        const bottom = this.endBottom(dst, !!u.box);
        const k = u.timer / STRADDLE_HANDLE;
        u.lift = k < 0.5 ? STRADDLE_TRAVEL_LIFT + (bottom - STRADDLE_TRAVEL_LIFT) * smooth(k * 2) : bottom + (STRADDLE_TRAVEL_LIFT - bottom) * smooth(k * 2 - 1);
        if (k >= 0.5 && u.box) {
          this.put(dst, u.box);
          u.box = null;
        }
        if (k >= 1) this.release(u);
        return;
      }
    }
  }

  private alignTo(u: StraddleUnit, e: SEnd) {
    const p = this.endPoint(e);
    u.x = p.x;
    u.z = p.z;
  }

  /** Box-bottom height at an end: on top of the stack while carrying, the top box's bottom while empty. */
  private endBottom(e: SEnd, carrying: boolean) {
    if (e.kind === "pad") return 0.03 + e.pad.tier * H;
    const h = this.yard.height(e.stack);
    return (carrying ? h : Math.max(0, h - 1)) * H;
  }

  private take(e: SEnd): Box | null {
    if (e.kind === "pad") {
      const i = this.pads.indexOf(e.pad);
      if (i >= 0) this.pads.splice(i, 1);
      return e.pad.box;
    }
    this.pend(this.pendingPick, e.stack, -1);
    return this.yard.pick(e.stack);
  }

  private put(e: SEnd, box: Box) {
    if (e.kind === "pad") {
      e.pad.box = box;
      e.pad.claimed = false;
      this.pads.push(e.pad);
      return;
    }
    this.pend(this.pendingDrop, e.stack, -1);
    if (!this.yard.place(e.stack, box)) {
      // transfer full after all: the RMG will sort it; put it anywhere in that block with room
      const s = this.yard.stacks[e.stack];
      const alt = this.yard.placeNear(s.block, s.x);
      if (alt !== null) this.yard.place(alt, box);
    }
  }

  private release(u: StraddleUnit) {
    u.phase = "idle";
    u.src = null;
    u.dst = null;
    u.timer = 0;
  }

  /** RMG idle work for block k: move imports off its transfer stack, or stage exports onto it. */
  rmgIdleJob(k: number): { from: number; to: number } | null {
    const t = this.transfers[k];
    if (t === undefined) return null;
    const y = this.yard;
    const s = y.stacks[t];
    // only keep clear while a straddle is actually over the stack
    const busy = this.straddles.some((u) => (u.phase === "pick" && u.src?.kind === "stack" && u.src.stack === t) || (u.phase === "drop" && u.dst?.kind === "stack" && u.dst.stack === t));
    if (this.exportWanted) {
      if (busy || y.height(t) + (this.pendingDrop.get(t) ?? 0) >= 3 || (this.pendingDrop.get(t) ?? 0) > 0) return null;
      const from = y.pickNear(k, s.x);
      return from === null ? null : { from, to: t };
    }
    if (y.height(t) > 0 && !busy) {
      const to = y.placeNear(k, s.x);
      return to === null ? null : { from: t, to };
    }
    return null;
  }

  /** Total boxes: on the apron, on straddles, in crane spreaders (for tests / HUD). */
  inFlight() {
    let n = this.pads.length;
    for (const u of this.straddles) if (u.box) n++;
    for (const c of this.cranes) if (this.carried(c)) n++;
    return n;
  }
}

const _a = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };
const _e = { x: 0, y: 0, z: 0 };

/** Crane pose at the job's elapsed time, with live end positions (the ship bobs). */
export function evalStsJob(
  j: StsJob,
  a: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  c: { trolleyX: number; spreaderY: number; z: number; sway: number },
) {
  const top = STS_SPEC.topY;
  const s = j.steps;
  let u = j.t;
  const move = (x0: number, z0: number, x1: number, z1: number, dur: number, k: number, carrying: boolean) => {
    const e = smooth(clamp01(k / dur));
    c.trolleyX = x0 + (x1 - x0) * e;
    c.z = z0 + (z1 - z0) * e;
    c.spreaderY = top;
    c.sway = Math.abs(x1 - x0) > 0.5 ? Math.sin(clamp01(k / dur) * Math.PI * 2) * (carrying ? 0.035 : 0.05) * Math.sign(x1 - x0) : c.sway * 0.95;
  };
  const hoist = (x: number, z: number, y0: number, y1: number, dur: number, k: number) => {
    c.trolleyX = x;
    c.z = z;
    c.spreaderY = y0 + (y1 - y0) * smooth(clamp01(k / dur));
    c.sway *= 0.92;
  };
  if (u < s[0]) {
    move(j.startX, j.startZ, a.x, a.z, s[0], u, false);
    c.spreaderY = j.startY + (top - j.startY) * smooth(clamp01(u / Math.min(1, s[0])));
    return;
  }
  u -= s[0];
  if (u < s[1]) return hoist(a.x, a.z, top, a.y + H, s[1], u);
  u -= s[1];
  if (u < s[2]) return hoist(a.x, a.z, a.y + H, a.y + H, s[2], u);
  u -= s[2];
  if (u < s[3]) return hoist(a.x, a.z, a.y + H, top, s[3], u);
  u -= s[3];
  if (u < s[4]) return move(a.x, a.z, d.x, d.z, s[4], u, true);
  u -= s[4];
  if (u < s[5]) return hoist(d.x, d.z, top, d.y + H, s[5], u);
  u -= s[5];
  if (u < s[6]) return hoist(d.x, d.z, d.y + H, d.y + H, s[6], u);
  u -= s[6];
  hoist(d.x, d.z, d.y + H, top, s[7], u);
}

export { MAX_TIER };
