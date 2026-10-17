"use client";

import { CompareOverlay } from "../compare/CompareOverlay";
import { ViewBar } from "../compare/ViewBar";
import { Agents } from "./Agents";
import { Buses } from "./Buses";
import { Cameras } from "./Cameras";
import { Disruptions } from "./Disruptions";
import { Hud } from "./Hud";
import { LabelHost, LabelLayer } from "./Label";
import { PredictLayers } from "../predict/Ghost";
import { PredictPanel } from "../predict/Panel";
import { Crowd } from "../sim/Crowd";
import { FieldDebug } from "../sim/FieldDebug";
import { useLiveFeeds } from "./store";
import { Streamer } from "./Streamer";
import { RouteLine } from "../route/RouteLine";

/** Live data layers rendered inside the <Canvas>: real TfL cams, YOLO tracks, buses, disruptions. */
export function LiveLayers() {
  useLiveFeeds();
  return (
    <group>
      <Crowd />
      <FieldDebug />
      <Agents />
      <Cameras />
      <Buses />
      <Disruptions />
      <Streamer />
      <PredictLayers />
      <RouteLine />
      <LabelLayer />
    </group>
  );
}

/** DOM overlay rendered outside the <Canvas>. */
export function LiveHud() {
  return (
    <>
      <LabelHost />
      <Hud />
      <ViewBar />
      <CompareOverlay />
      <PredictPanel />
    </>
  );
}
