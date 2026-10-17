/** Contract for the "Around me" view. Chris's data layer can serve the same shapes. */

export interface AroundCam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  videoUrl: string;
  imageUrl: string;
  /** TfL's free-text view description, e.g. "WEST-twds Blackfriars". */
  view: string;
  /** Compass bearing the camera faces, when the view text states it. */
  heading: number | null;
  distanceM: number;
}

export interface AroundDisruption {
  id: string;
  street: string;
  severity: string;
  category: string;
  closure: string;
  comments: string;
  /** [lon, lat] pairs, ready for GeoJSON. */
  line: [number, number][];
  distanceM: number;
}

/** YOLO detections for one camera clip (services/yolo). Peak counts across sampled frames. */
export interface CamReading {
  camId: string;
  people: number;
  vehicles: number;
  at: number;
  /** An annotated frame is available at /api/around/frame?id=camId. */
  frame: boolean;
}

export interface BusArrival {
  line: string;
  destination: string;
  /** Seconds until arrival, as of the stop's `at`. */
  seconds: number;
}

export interface AroundBusStop {
  id: string;
  name: string;
  /** Stop letter painted on the flag, e.g. "TH". */
  indicator: string;
  lat: number;
  lon: number;
  distanceM: number;
  arrivals: BusArrival[];
  at: number;
}


export type TrackedClass = "person" | "car" | "bus" | "truck" | "motorcycle" | "bicycle";

export interface TrackedObject {
  id: number;
  kind: "person" | "vehicle";
  /** YOLO class, majority vote over the clip. Absent from older YOLO servers. */
  cls?: TrackedClass;
  /** Median colour of the object in the real frame, "#rrggbb" (torso for people, body panel for vehicles). */
  color?: string;
  /** [seconds into clip, u, v]: bottom-centre of the box, normalised to the frame. */
  pts: [number, number, number][];
}

/** One clip's YOLO + ByteTrack tracks (services/yolo /tracks). */
export interface CamClipTracks {
  camId: string;
  at: number;
  duration: number;
  tracks: TrackedObject[];
}
