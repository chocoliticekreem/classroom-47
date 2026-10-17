// Pure layout for the city HUD: one source of truth for where each overlay sits, so they never collide.
// Every region is an inset box ({left|right, top|bottom, width?}) relative to the viewport; `toRect`
// turns one into pixels so tests can check that no two regions overlap at real screen sizes.

export const GUTTER = 12; // px between overlays and the viewport edge
export const GAP = 8; // px between stacked overlays

/** Minimap card (Minimap.tsx): canvas + padding + border, anchored bottom-left at MINIMAP.inset. */
export const MINIMAP = { size: 240, inset: 16, pad: 6, border: 1 } as const;
export const MINIMAP_OUTER = MINIMAP.size + 2 * MINIMAP.pad + 2 * MINIMAP.border; // 254
/** Distance from the left and bottom viewport edges to the far side of the minimap card. */
export const MINIMAP_EXTENT = MINIMAP.inset + MINIMAP_OUTER; // 270

export const OPS_W = 380; // right-hand ops panel
export const SCEN_W = 340; // scenario launcher panel (left)
export const TOAST_MAX_W = 440; // decision card
export const TOPBAR_FALLBACK_H = 52; // before the top bar has been measured

export interface Insets {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface HudLayoutInput {
  /** Measured top bar height (it may wrap onto two rows on narrow screens). */
  topBarH: number;
  opsOpen: boolean;
  /** Whether the minimap is shown (hidden in embed mode). */
  minimap: boolean;
}

export interface HudLayout {
  topBar: Insets;
  ops: Insets;
  scenario: Insets;
  bottomBand: Insets;
}

/** Top edge for panels that hang below the top bar. */
export function panelTop(topBarH: number): number {
  return GUTTER + Math.max(0, topBarH) + GAP;
}

export function hudLayout({ topBarH, opsOpen, minimap }: HudLayoutInput): HudLayout {
  const top = panelTop(topBarH);
  const opsClear = opsOpen ? GUTTER + OPS_W + GUTTER : GUTTER;
  const mapClear = minimap ? MINIMAP_EXTENT + GUTTER : GUTTER;
  return {
    topBar: { left: GUTTER, right: GUTTER, top: GUTTER },
    // The ops panel runs from under the top bar to the bottom; the bottom band stays left of it.
    ops: { right: GUTTER, top, bottom: GUTTER, width: OPS_W },
    // The scenario launcher stops above the minimap card.
    scenario: { left: GUTTER, top, bottom: mapClear, width: SCEN_W },
    // Decision card + hotkeys footer: between the minimap and the ops panel.
    bottomBand: { left: mapClear, right: opsClear, bottom: GUTTER },
  };
}

/** Pixel rect of an inset box in a vw x vh viewport. Height defaults to `fallbackH` when only one of top/bottom is set. */
export function toRect(b: Insets, vw: number, vh: number, fallbackH = 0): Rect {
  let x0: number;
  let x1: number;
  if (b.left !== undefined && b.right !== undefined) [x0, x1] = [b.left, vw - b.right];
  else if (b.left !== undefined) [x0, x1] = [b.left, b.left + (b.width ?? 0)];
  else [x0, x1] = [vw - (b.right ?? 0) - (b.width ?? 0), vw - (b.right ?? 0)];
  // Width caps a stretched box (max-width), mirroring `w-[N] max-w-full` style boxes.
  if (b.left !== undefined && b.right !== undefined && b.width !== undefined) x1 = Math.min(x1, x0 + b.width);
  const h = b.height ?? fallbackH;
  let y0: number;
  let y1: number;
  if (b.top !== undefined && b.bottom !== undefined) [y0, y1] = [b.top, vh - b.bottom];
  else if (b.top !== undefined) [y0, y1] = [b.top, b.top + h];
  else [y0, y1] = [vh - (b.bottom ?? 0) - h, vh - (b.bottom ?? 0)];
  return { x0, y0, x1, y1 };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** The minimap card's rect (bottom-left). */
export function minimapRect(vh: number): Rect {
  return { x0: MINIMAP.inset, x1: MINIMAP_EXTENT, y0: vh - MINIMAP_EXTENT, y1: vh - MINIMAP.inset };
}

/** Width available to the decision card in the bottom band. */
export function bottomBandWidth(vw: number, l: HudLayout): number {
  return vw - (l.bottomBand.left ?? 0) - (l.bottomBand.right ?? 0);
}

/** `?embed=1` (the desk console's iframe): city view with only a corner badge. Accepts "1", "true" or a bare flag. */
export function isEmbedSearch(search: string): boolean {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!q.has("embed")) return false;
  const v = (q.get("embed") ?? "").trim().toLowerCase();
  return v === "" || v === "1" || v === "true" || v === "yes";
}
