"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeftRight, EyeOff, Maximize, Minimize, Video } from "lucide-react";
import { useFullscreen } from "../useFullscreen";

const SIZES = [
  { label: "S", width: 220 },
  { label: "M", width: 340 },
  { label: "L", width: 520 },
] as const;

const GAP = 16;
const TOOLBAR_CLEARANCE = 64;
// Why: the global Dev chip is fixed to the bottom-right corner, so bottom-right items sit above it.
const DEV_CHIP_CLEARANCE = 52;
const ASPECT = 0.5625;
const MOVE = "350ms cubic-bezier(0.2, 0.8, 0.2, 1)";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface StageState {
  swapped: boolean;
  fullscreen: boolean;
}

interface PipStageProps {
  /** The main surface (map, twin). Stays mounted and keeps its DOM position when swapped. */
  primary: ReactNode;
  /** The picture-in-picture surface (the stream). Nothing is shown while null. */
  secondary: ReactNode | null;
  primaryLabel: string;
  secondaryLabel: string;
  corner: Corner;
  /** Rendered above the main surface; receives the swap state so it can hide while the main is shrunk. */
  overlay?: (state: StageState) => ReactNode;
  /** Extra buttons placed left of the fullscreen button. */
  toolbar?: ReactNode;
  /** Center keeps the buttons clear of a corner that the embedded page already uses. */
  toolbarAlign?: "right" | "center";
  className?: string;
}

/**
 * Two surfaces share one stage. Swapping only changes their geometry, never their place in the tree,
 * so an iframe or WebGL map keeps running instead of reloading.
 */
export function PipStage({ primary, secondary, primaryLabel, secondaryLabel, corner, overlay, toolbar, toolbarAlign = "right", className = "" }: PipStageProps) {
  const [size, setSize] = useState(1);
  const [swapped, setSwapped] = useState(false);
  const [hidden, setHidden] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(stageRef);

  const showPip = secondary !== null && !hidden;
  const width = `min(${SIZES[size].width}px, 46cqw)`;
  const height = `calc(${width} * ${ASPECT})`;
  const atTop = corner.startsWith("top");
  const atLeft = corner.endsWith("left");
  const bottomGap = atLeft ? GAP : DEV_CHIP_CLEARANCE;

  const pipGeometry: CSSProperties = {
    left: atLeft ? GAP : `calc(100% - ${GAP}px - ${width})`,
    top: atTop ? TOOLBAR_CLEARANCE : `calc(100% - ${bottomGap}px - ${height})`,
    width,
    height,
  };
  const fillGeometry: CSSProperties = { left: 0, top: 0, width: "100%", height: "100%" };

  const layer = (key: string, isPip: boolean, children: ReactNode, label: string, canHide: boolean) => (
    <div
      key={key}
      className={`absolute overflow-hidden bg-black ${
        isPip
          ? "group z-20 rounded-[24px] shadow-[0_0_0_3px_rgb(255_255_255/0.16),0_20px_44px_-8px_rgb(0_0_0/0.75),0_0_34px_-6px_rgb(236_17_135/0.45)]"
          : "z-0 rounded-none"
      }`}
      style={{
        ...(isPip ? pipGeometry : fillGeometry),
        transition: `left ${MOVE}, top ${MOVE}, width ${MOVE}, height ${MOVE}, border-radius ${MOVE}`,
      }}
    >
      {children}
      {isPip && (
        <>
          <button
            type="button"
            aria-label={`Swap: show ${label} large`}
            onClick={() => setSwapped((s) => !s)}
            className="absolute inset-0 z-10 cursor-pointer"
          />
          <div className="absolute inset-x-2 top-2 z-20 flex items-center justify-end gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <button
              type="button"
              onClick={() => setSize((s) => (s + 1) % SIZES.length)}
              aria-label={`Resize picture-in-picture, now ${SIZES[size].label}`}
              className="pill pill-sm glass !h-7 !px-2.5"
            >
              {SIZES[size].label}
            </button>
            <button
              type="button"
              onClick={() => setSwapped((s) => !s)}
              aria-label={`Swap: show ${label} large`}
              className="pill pill-sm glass !h-7 !px-2.5"
            >
              <ArrowLeftRight className="size-3.5" aria-hidden />
            </button>
            {canHide && (
              <button
                type="button"
                onClick={() => setHidden(true)}
                aria-label={`Hide ${secondaryLabel}`}
                className="pill pill-sm glass !h-7 !px-2.5"
              >
                <EyeOff className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      ref={stageRef}
      className={`relative min-h-0 w-full overflow-hidden bg-black [container-type:inline-size] ${
        fullscreen ? "" : "rounded-[28px] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_30px_70px_-20px_rgb(0_0_0/0.8)]"
      } ${className}`}
    >
      {layer("primary", swapped && showPip, primary, primaryLabel, false)}
      {showPip && layer("secondary", !swapped, secondary, secondaryLabel, true)}

      <div className="pointer-events-none absolute inset-0 z-10">
        {overlay?.({ swapped: swapped && showPip, fullscreen: fullscreen })}
      </div>

      <div className={`absolute top-3 z-30 flex items-center gap-2 ${toolbarAlign === "center" ? "left-1/2 -translate-x-1/2" : "right-3"}`}>
        {toolbar}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          className="pill pill-sm glass"
        >
          {fullscreen ? <Minimize className="size-3.5" aria-hidden /> : <Maximize className="size-3.5" aria-hidden />}
          {fullscreen ? "Exit" : "Full screen"}
        </button>
      </div>

      {secondary !== null && hidden && (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="pill pill-sm glass absolute z-20"
          style={{
            left: atLeft ? GAP : undefined,
            right: atLeft ? undefined : GAP,
            top: atTop ? TOOLBAR_CLEARANCE : undefined,
            bottom: atTop ? undefined : bottomGap,
          }}
        >
          <Video className="size-3.5" aria-hidden />
          Show {secondaryLabel}
        </button>
      )}
    </div>
  );
}
