import type { Archetype, Badge, Persona } from "@/lib/types";

type Seed = [username: string, color: string, badges?: Badge[], subMonths?: number];

const SEEDS: Record<Archetype, Seed[]> = {
  hype: [
    ["peckhamW", "#ff6b3d", ["sub"], 7],
    ["zone1zayn", "#ffb020"],
    ["W_in_the_chat", "#ff8a3d", ["sub"], 2],
    ["bossmanjr", "#ffd23d"],
    ["sheeshmerchant", "#ff6b3d", ["sub"], 14],
    ["oysterkid", "#ffa53d"],
    ["leytonlegend", "#ffcc33", ["sub"], 3],
    ["innitbruv22", "#ff7a3d"],
    ["fullsendfaisal", "#ffb84d"],
    ["clipthatbro", "#ff9933", ["sub"], 1],
    ["nocapnadia", "#ffc23d"],
    ["bigmandem", "#ff6633"],
    ["mandemtv", "#ffaa33", ["sub"], 5],
  ],
  questioner: [
    ["firsttimer_kev", "#5aa9ff"],
    ["whereisthis_", "#6ec1ff"],
    ["curiousCass", "#4d8dff", ["sub"], 1],
    ["touristTom", "#7ab8ff"],
    ["whatcamisthat", "#5ab0ff"],
    ["justtunedin", "#8ec5ff"],
    ["sourcepls_", "#4da3ff"],
    ["hmm_actually", "#6aa8ff"],
    ["lurker_lena", "#7fb6ff"],
    ["newhereuk", "#5c9dff"],
  ],
  local: [
    ["sohoSam", "#3ddc97", ["sub"], 9],
    ["camdenkid", "#4ce0a3"],
    ["brixtonbabe", "#35d48c", ["sub"], 4],
    ["hackneyhex", "#52e6ac"],
    ["shoreditchsid", "#2fcf88"],
    ["e17ellie", "#46dc9e"],
    ["northlinejess", "#3bd893"],
    ["victorialineviv", "#58e3ad", ["sub"], 2],
    ["elephantandcass", "#33d18a"],
    ["kingsxkhalid", "#4fdfa3"],
    ["tottenhamtash", "#3fd595"],
  ],
  superfan: [
    ["streamerstan_01", "#c77dff", ["sub", "vip"], 24],
    ["dayonefan", "#b366ff", ["founder", "sub"], 31],
    ["neverMissedOne", "#d08cff", ["sub"], 18],
    ["clipqueen", "#bf73ff", ["vip", "sub"], 12],
    ["ogviewerozzy", "#a855f7", ["founder", "sub"], 36],
    ["heartsonly", "#d89bff", ["sub"], 8],
    ["simpforthestream", "#c084fc", ["sub"], 6],
    ["fanclubfran", "#b47cff", ["sub", "verified"], 20],
  ],
  troll: [
    ["ratio_rob", "#ff4d6d"],
    ["mid_stream_mike", "#ff5c7a"],
    ["L_plus_bozo", "#ff3d5c"],
    ["fellOffFR", "#ff6b85"],
    ["cringe_detector", "#ff4466"],
    ["unsubbedtoday", "#ff5577"],
    ["touchgrass_tbh", "#ff6680"],
    ["notimpressed", "#ff3355"],
  ],
  mod: [
    ["Nightbot", "#9aa0ff", ["mod", "verified"]],
    ["mod_marcus", "#8f9bff", ["mod", "sub"], 22],
    ["safetymod_sara", "#a3a9ff", ["mod", "sub"], 15],
    ["c47_mod", "#8a95ff", ["mod"]],
  ],
};

export const PERSONAS: Persona[] = (Object.keys(SEEDS) as Archetype[]).flatMap((archetype) =>
  SEEDS[archetype].map(([username, color, badges = [], subMonths], i) => ({
    id: `${archetype}-${i}`,
    username,
    color,
    archetype,
    badges,
    subMonths,
  })),
);

export const PERSONAS_BY_ARCHETYPE: Record<Archetype, Persona[]> = (
  Object.keys(SEEDS) as Archetype[]
).reduce(
  (acc, a) => {
    acc[a] = PERSONAS.filter((p) => p.archetype === a);
    return acc;
  },
  {} as Record<Archetype, Persona[]>,
);
