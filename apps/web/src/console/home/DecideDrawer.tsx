"use client";
// The Decisions drawer, opened from a Home card on that card's case. Same look and behaviour as
// review/ReviewDrawer (which Shell opens from the header), plus `initialTaskId` so "Decide" lands
// on the right case. The review desk itself (HumanDesk) is used as is, read-only from here.
import { useEffect, useRef } from "react";
import HumanDesk from "../../review/HumanDesk";

export default function DecideDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button[aria-label='Close decisions']")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,[tabindex='0']",
        ) ?? []),
      ].filter((node) => node.offsetParent !== null);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return (
    <div
      className="review-drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="review-drawer" ref={panel} role="dialog" aria-modal="true" aria-label="Decisions">
        <HumanDesk embedded onClose={onClose} initialTaskId={taskId} initialSource="agent" />
      </div>
    </div>
  );
}
