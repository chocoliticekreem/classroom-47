"use client";
// Module: Events (Layer 3). The city events director: a presidential motorcade with a rolling road
// closure, a marathon, a protest march, a carnival parade, a stadium concert surge and fireworks over the
// river. Seeded schedule (one every ~3-5 min) plus bus `request:event {kind}`; see modules/Events/*.
// Dev hook: window.__cityEvent("motorcade" | "marathon" | "protest" | "parade" | "concert" | "fireworks").
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { on } from "../bus";
import { EventsDirector } from "./Events/director";
import type { EventKind } from "./Events/schedule";

export default function Events() {
  const [director] = useState(() => new EventsDirector());
  const warned = useRef(false);

  useEffect(() => {
    director.sweep(); // reopen anything a previous (hot-reloaded) director left closed
    const off = on((e) => {
      if (e.type === "request:event") director.request(e.kind);
    });
    const w = window as unknown as Record<string, unknown>;
    w.__cityEvent = (kind: EventKind) => director.request(kind);
    w.__cityEvents = () => director.active;
    return () => {
      off();
      delete w.__cityEvent;
      delete w.__cityEvents;
    };
  }, [director]);

  useEffect(() => () => director.dispose(), [director]);

  useFrame((_, delta) => {
    try {
      director.step(delta);
    } catch (err) {
      if (!warned.current) console.warn("[Events] frame step failed", err);
      warned.current = true;
    }
  });

  return <primitive object={director.root} />;
}
