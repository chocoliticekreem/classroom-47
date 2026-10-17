import type { StreamLocation } from "./types";

export const LOCATIONS: StreamLocation[] = [
  { id: "tower-hill", name: "Tower Hill", area: "EC3N", lat: 51.5098, lon: -0.0766 },
  { id: "tower-bridge", name: "Tower Bridge", area: "SE1", lat: 51.5055, lon: -0.0754 },
  { id: "st-katharine", name: "St Katharine Docks", area: "E1W", lat: 51.5066, lon: -0.0706 },
  { id: "leicester-sq", name: "Leicester Square", area: "WC2H", lat: 51.5103, lon: -0.1301 },
  { id: "piccadilly", name: "Piccadilly Circus", area: "W1J", lat: 51.5101, lon: -0.1344 },
  { id: "oxford-circus", name: "Oxford Circus", area: "W1B", lat: 51.5152, lon: -0.1418 },
  { id: "trafalgar-sq", name: "Trafalgar Square", area: "WC2N", lat: 51.508, lon: -0.1281 },
  { id: "camden", name: "Camden Market", area: "NW1", lat: 51.5413, lon: -0.1462 },
  { id: "shoreditch", name: "Shoreditch High St", area: "E1", lat: 51.5233, lon: -0.0753 },
];

export const JAMCAMS: { label: string; url: string }[] = [
  {
    label: "Tower Bridge Approach (TfL JamCam)",
    url: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.03500.mp4",
  },
  {
    label: "Piccadilly Circus (TfL JamCam)",
    url: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07450.mp4",
  },
  {
    label: "Parliament Square (TfL JamCam)",
    url: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.06501.mp4",
  },
];
