// Small stroke icons for node types and editor chrome (drawn for this project).
import type { IconKey } from "./nodeTypes";

const PATHS: Record<IconKey | UiIcon, string> = {
  router: "M4 12h6m0 0 4-6h6m-10 6 4 6h6M17 3l3 3-3 3M17 15l3 3-3 3",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9",
  scale: "M12 3v18M5 21h14M4 8h16M7 8l-3 7h6zM17 8l-3 7h6z",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
  triage: "M4 20h16M6 20V10M12 20V4M18 20v-7",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6",
  clash: "M4 4l7 7M20 4l-7 7M4 20l7-7M20 20l-7-7M10 4H4v6M14 4h6v6",
  group: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  question: "M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4M12 18h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
  planner: "M8 4h8v3H8zM6 6H4v15h16V6h-2M8 12h8M8 16h5",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4",
  person: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0",
  send: "M21 3 10 14M21 3l-7 18-4-7-7-4z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M6 15V9a3 3 0 0 1 3-3h7M18 9v6a3 3 0 0 1-3 3H8",
  check: "M20 6 9 17l-5-5",
  log: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  handshake: "M3 11l4-4 4 2 2-2 4 0 4 4M7 7l-4 8 5 4 3-2 2 2 3-2 2 1 3-4M11 9l-2 4",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  layout: "M3 5h6v4H3zM15 3h6v4h-6zM15 17h6v4h-6zM9 7h3v12h3M12 5h3",
  save: "M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7",
  play: "M7 4v16l13-8z",
  close: "M6 6l12 12M18 6 6 18",
  chevron: "M9 6l6 6-6 6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3",
  x_circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9 9l6 6M15 9l-6 6",
  minus_circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12h8",
  panel: "M3 4h18v16H3zM9 4v16",
};

export type UiIcon =
  | "plus" | "search" | "undo" | "redo" | "layout" | "save" | "play" | "close" | "chevron" | "trash"
  | "x_circle" | "minus_circle" | "panel";

export function Icon({ name, size = 16, className, strokeWidth = 1.8 }: {
  name: IconKey | UiIcon; size?: number; className?: string; strokeWidth?: number;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
