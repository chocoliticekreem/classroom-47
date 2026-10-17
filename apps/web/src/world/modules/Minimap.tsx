"use client";
// Overlay module: Minimap. Plain DOM + 2D canvas, rendered on top of the 3D canvas by CityPage.
// Static layer (sea, zones, roads, labels) is drawn once to an offscreen canvas; vehicles, blocked
// roads, incidents and the selection are drawn on top each frame (~30 fps). Click to fly the camera.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { WATER_X, ZONES, type ZoneName } from "../config";
import { allVehicles, type VehicleKind } from "../registry";
import { ROAD_EDGES, ROAD_NODES, type RoadKind } from "../roads";
import { useWorld } from "../store";
import { MINIMAP } from "./WorkflowHud/layout";

// Footprint is shared with the HUD (WorkflowHud/layout.ts) so the scenario panel and decision card clear it.
const SIZE = MINIMAP.size; // CSS px
const WORLD_MIN = -1100; // metres, map covers WORLD_MIN..WORLD_MAX on both axes
const WORLD_MAX = 1100;
const SCALE = SIZE / (WORLD_MAX - WORLD_MIN);
const FRAME_MS = 1000 / 30;

const toPx = (w: number) => (w - WORLD_MIN) * SCALE;
const toWorld = (p: number) => p / SCALE + WORLD_MIN;

const ZONE_TINT: Record<ZoneName, string> = {
  downtown: "rgba(150, 140, 170, 0.22)",
  docks: "rgba(90, 150, 200, 0.22)",
  countryside: "rgba(110, 190, 90, 0.25)",
  depot: "rgba(255, 106, 26, 0.22)",
  suburbs: "rgba(230, 190, 120, 0.22)",
  airport: "rgba(200, 200, 210, 0.25)",
  containerTerminal: "rgba(90, 150, 200, 0.25)",
  industrial: "rgba(150, 120, 100, 0.28)",
  southbank: "rgba(190, 150, 170, 0.22)",
  oldTown: "rgba(200, 170, 120, 0.24)",
  shoreditch: "rgba(170, 120, 160, 0.22)",
  hampstead: "rgba(120, 190, 110, 0.22)",
  government: "rgba(240, 240, 250, 0.28)",
};

const ZONE_LABEL: Partial<Record<ZoneName, string>> = {
  docks: "DOCKS",
  depot: "DEPOT",
  countryside: "FARMS",
  suburbs: "SUBURBS",
  airport: "AIRPORT",
  containerTerminal: "TERMINAL",
  industrial: "INDUSTRY",
  southbank: "SOUTHBANK",
  oldTown: "OLD TOWN",
  shoreditch: "SHOREDITCH",
  hampstead: "HAMPSTEAD",
  government: "GOV",
};

const ROAD_STYLE: Record<RoadKind, { w: number; c: string }> = {
  highway: { w: 3, c: "rgba(235, 235, 245, 0.85)" },
  ramp: { w: 1.6, c: "rgba(200, 200, 215, 0.7)" },
  street: { w: 1.2, c: "rgba(170, 170, 190, 0.6)" },
  country: { w: 0.9, c: "rgba(190, 170, 120, 0.6)" },
};

interface DotStyle {
  fill: string;
  stroke?: string;
  r: number;
}

const DOT: Record<VehicleKind, DotStyle> = {
  van: { fill: "#ff6a1a", r: 2.6 },
  truck: { fill: "#ff6a1a", r: 3.2 },
  police: { fill: "#3b82f6", r: 2.6 },
  ambulance: { fill: "#ffffff", stroke: "#22c55e", r: 2.6 },
  fire: { fill: "#ef4444", r: 2.8 },
  tow: { fill: "#f59e0b", r: 2.6 },
  roadworks: { fill: "#facc15", r: 2.6 },
  car: { fill: "#9ca3af", r: 1.6 },
  bus: { fill: "#dc2626", r: 2.6 },
  taxi: { fill: "#111111", stroke: "#ffffff", r: 2 },
  cyclist: { fill: "#22d3ee", r: 1.2 },
  motorcade: { fill: "#1e3a8a", stroke: "#ffffff", r: 2.8 },
};

const LEGEND: { label: string; style: DotStyle }[] = [
  { label: "Hamyway City van / truck", style: DOT.van },
  { label: "Police", style: DOT.police },
  { label: "Ambulance", style: DOT.ambulance },
  { label: "Fire", style: DOT.fire },
  { label: "Tow truck", style: DOT.tow },
  { label: "Roadworks crew", style: DOT.roadworks },
  { label: "Car", style: DOT.car },
  { label: "Bus", style: DOT.bus },
  { label: "Taxi", style: DOT.taxi },
];

function drawStatic(dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE * dpr;
  c.height = SIZE * dpr;
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // Land
  ctx.fillStyle = "#1c2128";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Sea (east of WATER_X)
  ctx.fillStyle = "#123a5c";
  ctx.fillRect(toPx(WATER_X), 0, SIZE - toPx(WATER_X), SIZE);
  ctx.strokeStyle = "rgba(120, 180, 230, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(toPx(WATER_X), 0);
  ctx.lineTo(toPx(WATER_X), SIZE);
  ctx.stroke();

  // Zone tints
  for (const [name, b] of Object.entries(ZONES) as [ZoneName, (typeof ZONES)[ZoneName]][]) {
    ctx.fillStyle = ZONE_TINT[name];
    const x = toPx(b.minX);
    const y = toPx(b.minZ);
    ctx.beginPath();
    ctx.roundRect(x, y, toPx(b.maxX) - x, toPx(b.maxZ) - y, 4);
    ctx.fill();
  }

  // Roads: thin first, highway last so it sits on top
  ctx.lineCap = "round";
  const order: RoadKind[] = ["country", "street", "ramp", "highway"];
  for (const kind of order) {
    const st = ROAD_STYLE[kind];
    ctx.strokeStyle = st.c;
    ctx.lineWidth = st.w;
    ctx.beginPath();
    for (const e of ROAD_EDGES.values()) {
      if (e.kind !== kind) continue;
      const a = ROAD_NODES.get(e.a);
      const b = ROAD_NODES.get(e.b);
      if (!a || !b) continue;
      ctx.moveTo(toPx(a.x), toPx(a.z));
      ctx.lineTo(toPx(b.x), toPx(b.z));
    }
    ctx.stroke();
  }

  // Labels
  ctx.font = "600 8px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [name, label] of Object.entries(ZONE_LABEL) as [ZoneName, string][]) {
    const b = ZONES[name];
    const cx = toPx((b.minX + b.maxX) / 2);
    let cy = toPx((b.minZ + b.maxZ) / 2);
    if (name === "depot") cy = toPx(b.maxZ) + 6;
    if (name === "suburbs") cy = toPx(b.minZ) - 6;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(label, cx + 0.6, cy + 0.6);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(label, cx, cy);
  }

  // North marker (top-right corner, over the sea)
  const nx = SIZE - 14;
  const ny = 16;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(nx, ny - 10);
  ctx.lineTo(nx + 4, ny - 3);
  ctx.lineTo(nx - 4, ny - 3);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("N", nx, ny + 3);
  return c;
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, s: DotStyle) {
  ctx.beginPath();
  ctx.arc(x, y, s.r, 0, Math.PI * 2);
  ctx.fillStyle = s.fill;
  ctx.fill();
  if (s.stroke) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = s.stroke;
    ctx.stroke();
  }
}

export default function Minimap({ embed = false }: { embed?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = 0;
    let base: HTMLCanvasElement | null = null;
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;

      const d = Math.min(window.devicePixelRatio || 1, 3);
      if (d !== dpr || !base) {
        dpr = d;
        canvas.width = SIZE * dpr;
        canvas.height = SIZE * dpr;
        base = drawStatic(dpr);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const st = useWorld.getState();
      const flash = 0.5 + 0.5 * Math.sin(now / 120);

      // Blocked roads, flashing red
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255, 40, 40, ${0.35 + 0.65 * flash})`;
      ctx.beginPath();
      for (const key in st.blocked) {
        const e = ROAD_EDGES.get(key);
        if (!e) continue;
        const a = ROAD_NODES.get(e.a);
        const b = ROAD_NODES.get(e.b);
        if (!a || !b) continue;
        ctx.moveTo(toPx(a.x), toPx(a.z));
        ctx.lineTo(toPx(b.x), toPx(b.z));
      }
      ctx.stroke();

      // Incidents (not cleared): pulsing rings
      for (const inc of st.incidents) {
        if (inc.status === "cleared") continue;
        const x = toPx(inc.x);
        const y = toPx(inc.z);
        const p = ((now - inc.createdAt) / 1200) % 1;
        const col = inc.kind === "roadworks" ? "250, 204, 21" : "255, 60, 60";
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${col}, ${1 - p})`;
        ctx.beginPath();
        ctx.arc(x, y, 3 + p * 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Vehicles: cars first so service vehicles sit on top
      let sel: { x: number; y: number } | null = null;
      for (let pass = 0; pass < 2; pass++) {
        for (const v of allVehicles()) {
          const isCar = v.kind === "car" || v.kind === "taxi";
          if ((pass === 0) !== isCar) continue;
          const pos = v.object.position;
          const x = toPx(pos.x);
          const y = toPx(pos.z);
          if (x < -4 || y < -4 || x > SIZE + 4 || y > SIZE + 4) continue;
          drawDot(ctx, x, y, DOT[v.kind] ?? DOT.car);
          if (v.id === st.selectedVehicle) sel = { x, y };
        }
      }

      // Selected vehicle: bright ring
      if (sel) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 + 0.4 * flash})`;
        ctx.beginPath();
        ctx.arc(sel.x, sel.y, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Camera focus point (where the camera was last asked to fly)
      if (st.focus && !st.selectedVehicle) {
        const x = toPx(st.focus.x);
        const y = toPx(st.focus.z);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x - 2, y);
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + 6, y);
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y - 2);
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x, y + 6);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [embed]);

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * SIZE;
    const py = ((e.clientY - r.top) / r.height) * SIZE;
    const s = useWorld.getState();
    s.select(null);
    s.setFocus({ x: toWorld(px), z: toWorld(py) });
  };

  // Embed mode (the desk console's iframe) shows the bare city: no minimap.
  if (embed) return null;

  // The legend overlays the map inside the card, so the card's footprint never changes (the HUD's
  // scenario panel sits right above it).
  return (
    <div
      className="pointer-events-none absolute z-20 select-none"
      style={{ left: MINIMAP.inset, bottom: MINIMAP.inset }}
    >
      <div
        className="relative rounded-2xl border-white/10 bg-black/45 shadow-2xl shadow-black/50 backdrop-blur-md"
        style={{ padding: MINIMAP.pad, borderWidth: MINIMAP.border, borderStyle: "solid" }}
      >
        <canvas
          ref={canvasRef}
          onClick={onClick}
          aria-label="City minimap. Click to move the camera."
          className="pointer-events-auto block cursor-crosshair rounded-xl"
          style={{ width: SIZE, height: SIZE }}
        />
        <button
          type="button"
          onClick={() => setLegendOpen((o) => !o)}
          aria-label={legendOpen ? "Hide minimap legend" : "Show minimap legend"}
          aria-expanded={legendOpen}
          className="pointer-events-auto absolute top-3 left-3 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/60 text-[11px] font-semibold text-white/80 hover:bg-black/80 hover:text-white"
        >
          {legendOpen ? "×" : "?"}
        </button>
        {legendOpen && (
          <div
            className="pointer-events-auto absolute grid grid-cols-2 content-start gap-x-3 gap-y-1 overflow-y-auto rounded-xl bg-black/80 px-3 pb-2 pt-8 text-[10px] text-white/85"
            style={{ inset: MINIMAP.pad }}
            onClick={() => setLegendOpen(false)}
          >
            {LEGEND.map(({ label, style }) => (
              <div key={label} className="flex min-w-0 items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: style.fill, boxShadow: style.stroke ? `0 0 0 1px ${style.stroke}` : undefined }}
                />
                <span className="truncate">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3 shrink-0 bg-red-500" />
              Road closed
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-red-500" />
              Incident
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
