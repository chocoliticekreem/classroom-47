// Sidebar + palette icons that the shared kit (ui/icons.tsx) doesn't have. Same 24x24 stroke
// style; size via `size`, colour via currentColor.
import type { ReactNode } from "react";
import type { IconProps } from "../ui/icons";

function make(name: string, body: ReactNode) {
  function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
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

export const IconHome = make("Home", <>
  <path d="M4 10.5 12 4l8 6.5" />
  <path d="M6 9v10.5h12V9" />
  <path d="M10 19.5v-5h4v5" />
</>);

export const IconNewCase = make("NewCase", <>
  <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
  <path d="M13.5 3.5V9H19" />
  <path d="M12 12v5M9.5 14.5h5" />
</>);

export const IconRuns = make("Runs", <>
  <path d="M9 6.5h11M9 12h11M9 17.5h11" />
  <path d="m4 5 2 1.5L4 8" />
  <path d="m4 10.5 2 1.5-2 1.5" />
  <path d="m4 16 2 1.5L4 19" />
</>);

export const IconDecisions = make("Decisions", <>
  <path d="M12 3.5v17" />
  <path d="M7 20.5h10" />
  <path d="M5 7h14" />
  <path d="m5 7-2.5 6a3 3 0 0 0 5 0L5 7Z" />
  <path d="m19 7-2.5 6a3 3 0 0 0 5 0L19 7Z" />
</>);

export const IconReality = make("Reality", <>
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
  <circle cx="12" cy="12" r="3" />
</>);

export const IconSettings = make("Settings", <>
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
</>);

export const IconBolt = make("Bolt", <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8Z" />);
