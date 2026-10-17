// Inline SVG icons (own drawings, 24x24 stroke style). Size via `size`, colour via currentColor.
import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function make(name: string, body: React.ReactNode, fill = false) {
  function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? "currentColor" : "none"}
        stroke={fill ? "none" : "currentColor"}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconOverview = make("Overview", <>
  <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
  <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
  <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
  <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
</>);

export const IconWorkflow = make("Workflow", <>
  <rect x="2.5" y="9" width="6" height="6" rx="1.5" />
  <rect x="15.5" y="3" width="6" height="6" rx="1.5" />
  <rect x="15.5" y="15" width="6" height="6" rx="1.5" />
  <path d="M8.5 12h3a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2" />
  <path d="M11.5 12a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2" />
</>);

export const IconExecutions = make("Executions", <>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 7.5V12l3 2" />
</>);

export const IconEvidence = make("Evidence", <>
  <rect x="3.5" y="4" width="17" height="16" rx="2" />
  <path d="M3.5 9h17M9 9v11" />
  <path d="m12.5 14.5 1.6 1.6 3.4-3.4" />
</>);

export const IconCity = make("City", <>
  <path d="M3 20.5h18" />
  <path d="M5 20.5V9l5-3v14.5" />
  <path d="M10 20.5V3.5l7 3.5v13.5" />
  <path d="M17 11h2.5v9.5" />
  <path d="M13 9.5h1M13 12.5h1M13 15.5h1M7 12h.5M7 15h.5" />
</>);

export const IconPlay = make("Play", <path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.3-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5Z" />, true);

export const IconRefresh = make("Refresh", <>
  <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
  <path d="M4 4v4h4" />
  <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
  <path d="M20 20v-4h-4" />
</>);

export const IconImport = make("Import", <>
  <path d="M12 3.5v11" />
  <path d="m7.5 10 4.5 4.5 4.5-4.5" />
  <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
</>);

export const IconExternal = make("External", <>
  <path d="M14 4h6v6" />
  <path d="M20 4 11 13" />
  <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
</>);

export const IconChevronRight = make("ChevronRight", <path d="m9.5 6 6 6-6 6" />);
export const IconChevronLeft = make("ChevronLeft", <path d="m14.5 6-6 6 6 6" />);
export const IconChevronDown = make("ChevronDown", <path d="m6 9.5 6 6 6-6" />);

export const IconCheck = make("Check", <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconX = make("X", <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);

export const IconAlert = make("Alert", <>
  <path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
  <path d="M12 9.5v4M12 17h.01" />
</>);

export const IconCoin = make("Coin", <>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M14.8 9.2c-.5-.8-1.5-1.2-2.8-1.2-1.7 0-2.8.8-2.8 2s1.1 1.7 2.8 2 2.8.8 2.8 2-1.1 2-2.8 2c-1.3 0-2.3-.4-2.8-1.2M12 6.5V8M12 16v1.5" />
</>);

export const IconClock = make("Clock", <>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 7.5V12h4" />
</>);

export const IconCases = make("Cases", <>
  <rect x="3.5" y="6.5" width="17" height="13" rx="2" />
  <path d="M8.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v1.5" />
  <path d="M3.5 12h17" />
</>);

export const IconTarget = make("Target", <>
  <circle cx="12" cy="12" r="8.5" />
  <circle cx="12" cy="12" r="4.5" />
  <circle cx="12" cy="12" r="1" />
</>);

export const IconShield = make("Shield", <>
  <path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-2.5Z" />
  <path d="M12 8.5v4M12 15.5h.01" />
</>);

export const IconInbox = make("Inbox", <>
  <path d="M3.5 13.5 6 5.5h12l2.5 8" />
  <path d="M3.5 13.5v5h17v-5h-5a3.5 3.5 0 0 1-7 0h-5Z" />
</>);

export const IconSearch = make("Search", <>
  <circle cx="11" cy="11" r="6.5" />
  <path d="m20 20-4.2-4.2" />
</>);

export const IconSidebar = make("Sidebar", <>
  <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
  <path d="M9 4.5v15" />
</>);

export const IconHome = make("Home", <>
  <path d="M4 10.5 12 4l8 6.5" />
  <path d="M6 9v10.5h12V9" />
  <path d="M10 19.5v-5h4v5" />
</>);

/** New case: a page with a plus. */
export const IconNewCase = make("NewCase", <>
  <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
  <path d="M13.5 3.5V9H19" />
  <path d="M12 12v5M9.5 14.5h5" />
</>);

/** Case runs: a list with play marks. */
export const IconRuns = make("Runs", <>
  <path d="m4 5.5 3 2-3 2v-4ZM4 14.5l3 2-3 2v-4Z" />
  <path d="M10.5 7.5H20M10.5 16.5H20" />
</>);

/** Decisions waiting for a person. */
export const IconDecisions = make("Decisions", <>
  <circle cx="12" cy="8" r="3.5" />
  <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  <path d="M18.5 4.5v3M18.5 10h.01" />
</>);

/** Reality test: a target with a check. */
export const IconReality = make("Reality", <>
  <circle cx="12" cy="12" r="8.5" />
  <circle cx="12" cy="12" r="4.5" />
  <path d="M12 12h.01" />
</>);

export const IconSettings = make("Settings", <>
  <circle cx="12" cy="12" r="3" />
  <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
</>);

export const IconPlus = make("Plus", <path d="M12 5v14M5 12h14" />);

export const IconInfo = make("Info", <>
  <circle cx="12" cy="12" r="8.5" />
  <path d="M12 11v5M12 8h.01" />
</>);

export const IconArrowRight = make("ArrowRight", <path d="M5 12h14M13 6l6 6-6 6" />);

export const IconSend = make("Send", <>
  <path d="M20.5 3.5 10 14" />
  <path d="M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z" />
</>);

/** Hamyway City brand mark: an "H" on the orange tile (identifier kept for imports). */
export function RivetMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#ff6a1a" />
      <path d="M10.5 9v14M21.5 9v14M10.5 16h11" fill="none" stroke="#1f1f23" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
