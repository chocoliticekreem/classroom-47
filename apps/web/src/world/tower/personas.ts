// Bundled London / Reddit CAMEL-style archetypes for the Tower Bridge streamer sim.
// Local only. No network. No real people.

export type Archetype =
  | "stream_sniper"
  | "fan_swarm"
  | "local_commuter"
  | "reddit_local"
  | "tourist"
  | "chaos_instigator";

export interface PersonaSeed {
  archetype: Archetype;
  subreddit: string;
  thread: string;
  intent: string;
  handle: string;
  /** Walking speed in m/s. */
  speed: number;
}

export const PERSONA_SEEDS: PersonaSeed[] = [
  {
    archetype: "stream_sniper",
    subreddit: "r/ukstreaming",
    thread: "Tower Bridge walk, drop the live pin",
    intent: "Match the bascule towers in frame and cut across to the south abutment",
    handle: "@bascule_shadow",
    speed: 2.45,
  },
  {
    archetype: "stream_sniper",
    subreddit: "r/london",
    thread: "Tooley Street reflection gives the exact corner",
    intent: "Use shopfront glass on Tooley Street to fix the block and close in",
    handle: "@tooley_glass",
    speed: 2.3,
  },
  {
    archetype: "stream_sniper",
    subreddit: "r/ukstreaming",
    thread: "Tower Bridge Road is a single exit, hold the junction",
    intent: "Wait at the Tower Bridge Road pinch so the stream has nowhere to slip",
    handle: "@junction_hold",
    speed: 2.55,
  },
  {
    archetype: "stream_sniper",
    subreddit: "r/casualuk",
    thread: "Tower Bridge north tower just lined up with the bus",
    intent: "Time the passing bus against the tower and close the gap on foot",
    handle: "@bus_sync_walk",
    speed: 2.2,
  },
  {
    archetype: "fan_swarm",
    subreddit: "r/london",
    thread: "he's on Tower Bridge right now, move",
    intent: "Leave London Bridge station and run for a spot in frame",
    handle: "@span_sprint",
    speed: 2.05,
  },
  {
    archetype: "fan_swarm",
    subreddit: "r/ukstreaming",
    thread: "Tooley Street side, whole chat is going",
    intent: "Pull friends off the pavement and pack the south bank path",
    handle: "@tooley_pack",
    speed: 1.95,
  },
  {
    archetype: "fan_swarm",
    subreddit: "r/casualuk",
    thread: "Tower Bridge Road swarm, don't miss it",
    intent: "Jog the road with a phone up so the clip catches the crowd",
    handle: "@road_phone_up",
    speed: 2.15,
  },
  {
    archetype: "fan_swarm",
    subreddit: "r/london",
    thread: "Tower Bridge opening walk, we can still make it",
    intent: "Hurry from the station arcade before the stream turns off the bridge",
    handle: "@arcade_dash",
    speed: 1.85,
  },
  {
    archetype: "local_commuter",
    subreddit: "r/LondonUnderground",
    thread: "Tooley Street exit is slow, Tower Bridge Road worse",
    intent: "Keep the commute moving and step around anyone stopped on the pavement",
    handle: "@jubilee_stride",
    speed: 1.45,
  },
  {
    archetype: "reddit_local",
    subreddit: "r/london",
    thread: "Tooley Street / Tower Bridge Road junction again",
    intent: "Stand the kerb and report whether the crossing is actually blocked",
    handle: "@bermondsey_kerb",
    speed: 1.25,
  },
  {
    archetype: "tourist",
    subreddit: "r/casualuk",
    thread: "first look at Tower Bridge from Tooley Street",
    intent: "Stop for a photo of the towers and drift with the sightseeing flow",
    handle: "@span_photo",
    speed: 0.95,
  },
  {
    archetype: "chaos_instigator",
    subreddit: "r/casualuk",
    thread: "chant at the Tower Bridge Road crossing",
    intent: "Start a shout so people stall in the carriageway for the camera",
    handle: "@crossing_chant",
    speed: 2.05,
  },
  {
    archetype: "local_commuter",
    subreddit: "r/LondonUnderground",
    thread: "change at London Bridge, walk Tooley Street not Tower Bridge",
    intent: "Take the usual south-side walk and don't join anything gathering",
    handle: "@london_bridge_out",
    speed: 1.5,
  },
  {
    archetype: "reddit_local",
    subreddit: "r/london",
    thread: "Tower Bridge Road southbound is people not traffic",
    intent: "Watch from a doorway and update the thread if the crowd thickens",
    handle: "@shad_thames_watch",
    speed: 1.3,
  },
  {
    archetype: "tourist",
    subreddit: "r/london",
    thread: "Tower Bridge photo stop on Tooley Street",
    intent: "Pause mid-pavement for the bascule shot, then wander toward the bridge",
    handle: "@bascule_gawp",
    speed: 0.85,
  },
  {
    archetype: "chaos_instigator",
    subreddit: "r/ukstreaming",
    thread: "speaker on Tower Bridge, who is pulling up",
    intent: "Circle the walkway with a speaker so the stream audio clips",
    handle: "@span_speaker",
    speed: 2.2,
  },
  {
    archetype: "local_commuter",
    subreddit: "r/LondonUnderground",
    thread: "Jubilee line dump onto Tooley Street",
    intent: "Clear the station exit and keep walking toward the usual stop",
    handle: "@jubilee_dump",
    speed: 1.55,
  },
  {
    archetype: "reddit_local",
    subreddit: "r/casualuk",
    thread: "locals: Tower Bridge Road is not a meetup point",
    intent: "Stay on the side street and tell people to keep the crossing clear",
    handle: "@hay_gallery_local",
    speed: 1.35,
  },
  {
    archetype: "tourist",
    subreddit: "r/casualuk",
    thread: "coach dropped us at Tower Bridge Road",
    intent: "Follow the group toward Tower Bridge and bunch up at the first viewpoint",
    handle: "@coach_drop",
    speed: 1.05,
  },
  {
    archetype: "chaos_instigator",
    subreddit: "r/london",
    thread: "flare energy on Tooley Street tonight",
    intent: "Wave people into the Tower Bridge Road junction so the pack can't thin out",
    handle: "@tooley_wave",
    speed: 1.9,
  },
  {
    archetype: "local_commuter",
    subreddit: "r/LondonUnderground",
    thread: "Tower Bridge Road lights, staying on the pavement",
    intent: "Cross only on green and keep the commuting pace past the cameras",
    handle: "@green_light_walk",
    speed: 1.4,
  },
  {
    archetype: "reddit_local",
    subreddit: "r/london",
    thread: "Tower Bridge looks packed from Tooley Street",
    intent: "Note the density for the thread and avoid walking into the middle of it",
    handle: "@more_london_note",
    speed: 1.2,
  },
  {
    archetype: "tourist",
    subreddit: "r/ukstreaming",
    thread: "is Tower Bridge the one on the stream from Tooley Street",
    intent: "Follow the crowd toward the towers without knowing the way off",
    handle: "@which_bridge",
    speed: 1.1,
  },
  {
    archetype: "chaos_instigator",
    subreddit: "r/casualuk",
    thread: "block Tower Bridge Road for one chant",
    intent: "Stop the group on the crossing until the stream pans over",
    handle: "@one_chant",
    speed: 2.1,
  },
];

const SPAWN_ARCHETYPES = {
  sniper: ["stream_sniper"],
  leak: ["fan_swarm"],
  crossing: ["local_commuter", "reddit_local"],
  flow: ["local_commuter", "tourist"],
} as const satisfies Record<"flow" | "sniper" | "crossing" | "leak", readonly Archetype[]>;

function wrap(index: number, length: number): number {
  const m = Math.trunc(index) % length;
  return m < 0 ? m + length : m;
}

/** Cycle the seeds allowed for this spawn. Same index always returns the same seed, with the caller's id. */
export function personaFor(
  kind: "flow" | "sniper" | "crossing" | "leak",
  index: number,
  id: string,
): PersonaSeed & { id: string } {
  const allowed: readonly Archetype[] = SPAWN_ARCHETYPES[kind];
  const pool = PERSONA_SEEDS.filter((seed) => allowed.includes(seed.archetype));
  const seed = pool[wrap(index, pool.length)];
  if (!seed) throw new Error(`no persona seeds for ${kind}`);
  return { ...seed, id };
}
