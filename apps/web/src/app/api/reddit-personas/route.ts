import { NextRequest, NextResponse } from "next/server";
import {
  LONDON_DISTRICTS,
  type LondonDistrictId,
  type SyntheticArchetype,
  type SyntheticPersonaSpec,
} from "@/world/streamerContract";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface BuiltinSeed {
  handle: string;
  subreddit: string;
  archetype: SyntheticArchetype;
  headline: string;
  thoughtBubble: string;
  hypeLevel: number;
  sniperRisk: number;
  walkSpeed: number;
  attractedToStreamer: boolean;
  redditKarma: number;
  avatarEmoji: string;
  preferredDistrict?: LondonDistrictId;
}

const BUILTIN_LONDON_CORPUS: BuiltinSeed[] = [
  {
    handle: "u/soho_flatwhite_snob",
    subreddit: "r/london",
    archetype: "reddit_local",
    headline: "Why are 40 teenagers sprinting down Wardour Street screaming at a phone gimbal?",
    thoughtBubble: "Just trying to grab my £4.80 oat flat white on Brewer St without ending up in a TikTok clip 😭",
    hypeLevel: 0.25,
    sniperRisk: 0.08,
    walkSpeed: 1.45,
    attractedToStreamer: false,
    redditKarma: 48210,
    avatarEmoji: "☕",
    preferredDistrict: "soho",
  },
  {
    handle: "u/central_line_survivor",
    subreddit: "r/london",
    archetype: "local_commuter",
    headline: "Oxford Circus exit 4 is completely gridlocked again — avoid if you value your sanity",
    thoughtBubble: "Do NOT block the pavement outside Soho Square, I have a train at Paddington in 14 mins!",
    hypeLevel: 0.15,
    sniperRisk: 0.04,
    walkSpeed: 1.65,
    attractedToStreamer: false,
    redditKarma: 31900,
    avatarEmoji: "🚇",
    preferredDistrict: "soho",
  },
  {
    handle: "u/ldn_sniper_vfx",
    subreddit: "r/ukstreaming",
    archetype: "stream_sniper",
    headline: "CLOCKED THE NEON SIGN REFLECTION IN HIS GLASSES — HE'S PASSING WARDOUR ST NOW",
    thoughtBubble: "Reflected bus route 98 + Pret awning = locked onto his exact Soho corner in 30s 🕵️‍♂️🔥",
    hypeLevel: 0.96,
    sniperRisk: 0.95,
    walkSpeed: 3.7,
    attractedToStreamer: true,
    redditKarma: 6420,
    avatarEmoji: "🕵️",
    preferredDistrict: "soho",
  },
  {
    handle: "u/w_in_the_chat_uk",
    subreddit: "r/ukstreaming",
    archetype: "fan_swarm",
    headline: "ME AND 12 MATES JUST HOPPED OFF AT TOTTENHAM COURT ROAD TO FIND THE STREAM",
    thoughtBubble: "BRO IF HE LEAKS LOCATION WE ARE SPRINTING FULL SPEED FOR THE SELFIE 📸⚡",
    hypeLevel: 0.94,
    sniperRisk: 0.68,
    walkSpeed: 3.4,
    attractedToStreamer: true,
    redditKarma: 2150,
    avatarEmoji: "🏃",
    preferredDistrict: "soho",
  },
  {
    handle: "u/lsf_clip_chimper",
    subreddit: "r/LivestreamFail",
    archetype: "stream_sniper",
    headline: "[LIVE] Streamer accidentally shows street sign in Central London, chat already triangulation-maxxing",
    thoughtBubble: "Got my phone recording in 4K60 — if the crowd swarms this junction it's instant front-page LSF 🎬",
    hypeLevel: 0.89,
    sniperRisk: 0.88,
    walkSpeed: 3.2,
    attractedToStreamer: true,
    redditKarma: 94100,
    avatarEmoji: "📹",
    preferredDistrict: "soho",
  },
  {
    handle: "u/meal_deal_connoisseur",
    subreddit: "r/CasualUK",
    archetype: "reddit_local",
    headline: "Someone just knocked my Tesco chicken triple out of my hand chasing a YouTuber in Soho",
    thoughtBubble: "Hoisin duck wrap or chicken club? Wait why is everyone running toward the arcade?! 🥪",
    hypeLevel: 0.32,
    sniperRisk: 0.1,
    walkSpeed: 1.35,
    attractedToStreamer: false,
    redditKarma: 67300,
    avatarEmoji: "🥪",
    preferredDistrict: "soho",
  },
  {
    handle: "u/southbank_skater_99",
    subreddit: "r/london",
    archetype: "fan_swarm",
    headline: "Whole Southbank Undercroft crew just heard the IRL stream is heading past the London Eye",
    thoughtBubble: "Hold up is that actually him by the skate space?! Grab the boards let's roll over! 🛹🔥",
    hypeLevel: 0.85,
    sniperRisk: 0.55,
    walkSpeed: 3.1,
    attractedToStreamer: true,
    redditKarma: 14800,
    avatarEmoji: "🛹",
    preferredDistrict: "southbank",
  },
  {
    handle: "u/waterloo_sunset_commute",
    subreddit: "r/london",
    archetype: "local_commuter",
    headline: "PSA: Jubilee Walk by the London Eye is a human slalom course of selfie sticks today",
    thoughtBubble: "Walk on the left! Why do people always stop dead in the middle of the Thames path?! 🌊",
    hypeLevel: 0.18,
    sniperRisk: 0.05,
    walkSpeed: 1.55,
    attractedToStreamer: false,
    redditKarma: 22400,
    avatarEmoji: "💼",
    preferredDistrict: "southbank",
  },
  {
    handle: "u/shoreditch_synth_modular",
    subreddit: "r/london",
    archetype: "reddit_local",
    headline: "Boxpark Shoreditch security already looking nervous with 60 kids gathering outside the Overground",
    thoughtBubble: "Just stepped out of Brick Lane vintage market and walked straight into a livestream hurricane 🎨",
    hypeLevel: 0.42,
    sniperRisk: 0.18,
    walkSpeed: 1.4,
    attractedToStreamer: false,
    redditKarma: 19500,
    avatarEmoji: "🎧",
    preferredDistrict: "shoreditch",
  },
  {
    handle: "u/east_ldn_bikelife",
    subreddit: "r/ukstreaming",
    archetype: "chaos_instigator",
    headline: "Wheeling down Shoreditch High St on the Lime bikes to intercept the IRL backpack stream",
    thoughtBubble: "Hear the Lime bike click-click-click? Whole squad pulling up if he stays on this main road 🚲💥",
    hypeLevel: 0.98,
    sniperRisk: 0.92,
    walkSpeed: 3.8,
    attractedToStreamer: true,
    redditKarma: 4300,
    avatarEmoji: "🚲",
    preferredDistrict: "shoreditch",
  },
  {
    handle: "u/big_ben_bongs_daily",
    subreddit: "r/CasualUK",
    archetype: "tourist",
    headline: "First time in Westminster and saw a massive crowd — thought it was the King, turns out it's a Twitch streamer",
    thoughtBubble: "Trying to getBig Ben AND the red double-decker in the same frame! Wait who's that guy? 📸🇬🇧",
    hypeLevel: 0.62,
    sniperRisk: 0.25,
    walkSpeed: 1.25,
    attractedToStreamer: true,
    redditKarma: 11200,
    avatarEmoji: "📸",
    preferredDistrict: "westminster",
  },
  {
    handle: "u/whitehall_civil_servant",
    subreddit: "r/london",
    archetype: "local_commuter",
    headline: "Parliament Square pedestrian crossing completely jammed by livestreamers and tourists",
    thoughtBubble: "If this crowd surges onto the Whitehall crosswalk the police vans will lock the junction down 🕰️",
    hypeLevel: 0.12,
    sniperRisk: 0.03,
    walkSpeed: 1.6,
    attractedToStreamer: false,
    redditKarma: 53900,
    avatarEmoji: "☂️",
    preferredDistrict: "westminster",
  },
  {
    handle: "u/camden_lock_punk77",
    subreddit: "r/london",
    archetype: "reddit_local",
    headline: "Camden High Street bridge is bottlenecked — streamer just mentioned cyberdog on stream",
    thoughtBubble: "Regent's Canal towpath is the only sane escape route when Camden Market packs out like this 🎸",
    hypeLevel: 0.48,
    sniperRisk: 0.22,
    walkSpeed: 1.42,
    attractedToStreamer: false,
    redditKarma: 29800,
    avatarEmoji: "🎸",
    preferredDistrict: "camden",
  },
  {
    handle: "u/canary_wharf_quant",
    subreddit: "r/london",
    archetype: "local_commuter",
    headline: "Did not have 'IRL streamer chased past Jubilee Place by 40 teenagers in hoodies' on my Canary Wharf bingo card",
    thoughtBubble: "Private estate security in Canary Wharf is going to escort this whole swarm out in 90 seconds 📈",
    hypeLevel: 0.28,
    sniperRisk: 0.09,
    walkSpeed: 1.62,
    attractedToStreamer: false,
    redditKarma: 41000,
    avatarEmoji: "📊",
    preferredDistrict: "docks",
  },
  {
    handle: "u/hampstead_heath_whippet",
    subreddit: "r/CasualUK",
    archetype: "reddit_local",
    headline: "Peaceful walk up Parliament Hill interrupted by someone yelling 'CHAT IS THIS REAL' at the skyline",
    thoughtBubble: "At least the North London hills slow down the stream snipers — half of them are out of breath 🌳🐕",
    hypeLevel: 0.35,
    sniperRisk: 0.12,
    walkSpeed: 1.5,
    attractedToStreamer: false,
    redditKarma: 37600,
    avatarEmoji: "🐕",
    preferredDistrict: "hampstead",
  },
  {
    handle: "u/discord_osint_tracker",
    subreddit: "r/LivestreamFail",
    archetype: "stream_sniper",
    headline: "Cross-referenced the Pret menu reflection + TfL bus countdown board — he's 120m from the junction",
    thoughtBubble: "Pinged the Discord sniper lobby. 6 of us closing in from both ends of the street 🎯📡",
    hypeLevel: 0.97,
    sniperRisk: 0.98,
    walkSpeed: 3.75,
    attractedToStreamer: true,
    redditKarma: 18400,
    avatarEmoji: "🎯",
  },
  {
    handle: "u/piccadilly_megaphone",
    subreddit: "r/ukstreaming",
    archetype: "chaos_instigator",
    headline: "BROUGHT THE BLUETOOTH SOUNDBOARD SPEAKER TO SOHO — WAIT TILL CHAT HEARS THIS",
    thoughtBubble: "If he stays on the main strip for 45 more seconds I'm blasting the airhorn right on stream 📢😈",
    hypeLevel: 0.99,
    sniperRisk: 0.96,
    walkSpeed: 3.6,
    attractedToStreamer: true,
    redditKarma: 920,
    avatarEmoji: "📢",
  },
  {
    handle: "u/carnaby_drip_check",
    subreddit: "r/ukstreaming",
    archetype: "fan_swarm",
    headline: "Saw the stream was in Central London so we skipped sixth form lecture to pull up",
    thoughtBubble: "YOOO HE'S RIGHT THERE!! Tell the groupchat to cut through the alleyway now!! 👟🔥",
    hypeLevel: 0.92,
    sniperRisk: 0.64,
    walkSpeed: 3.45,
    attractedToStreamer: true,
    redditKarma: 3400,
    avatarEmoji: "👟",
  },
  {
    handle: "u/tfl_bus_driver_n29",
    subreddit: "r/CasualUK",
    archetype: "local_commuter",
    headline: "To the 50 lads who just ran across the pelican crossing on red chasing a cameraman: give your heads a wobble",
    thoughtBubble: "If 50 people surge across this zebra crossing again nobody is moving until next Tuesday 🚌💢",
    hypeLevel: 0.2,
    sniperRisk: 0.05,
    walkSpeed: 1.38,
    attractedToStreamer: false,
    redditKarma: 82300,
    avatarEmoji: "🚌",
  },
  {
    handle: "u/greggs_sausage_roll_vip",
    subreddit: "r/CasualUK",
    archetype: "reddit_local",
    headline: "Tell the streamer to duck into Greggs off Leicester Square, best camouflage in the UK",
    thoughtBubble: "Steak bake is lava hot. Wait why are 30 kids sprinting past the window with phones out?! 🥐",
    hypeLevel: 0.44,
    sniperRisk: 0.14,
    walkSpeed: 1.4,
    attractedToStreamer: false,
    redditKarma: 59100,
    avatarEmoji: "🥐",
  },
  {
    handle: "u/ohio_tourist_in_ldn",
    subreddit: "r/london",
    archetype: "tourist",
    headline: "Visiting London for the week — why is there a huge crowd following one guy with a backpack?",
    thoughtBubble: "Wait my kids watch this streamer! Honey grab the camera, he's walking right toward us! 🗽📷",
    hypeLevel: 0.74,
    sniperRisk: 0.35,
    walkSpeed: 1.85,
    attractedToStreamer: true,
    redditKarma: 7800,
    avatarEmoji: "🧳",
  },
  {
    handle: "u/twitch_mod_touching_grass",
    subreddit: "r/LivestreamFail",
    archetype: "fan_swarm",
    headline: "Spamming 'DO NOT LEAK LOCATION' in chat while literally watching him walk past my office window",
    thoughtBubble: "Chat is spamming the street name at 400 msgs/min — he needs to take the side alley NOW 💬⚡",
    hypeLevel: 0.86,
    sniperRisk: 0.52,
    walkSpeed: 2.9,
    attractedToStreamer: true,
    redditKarma: 45200,
    avatarEmoji: "💬",
  },
  {
    handle: "u/lime_bike_bandit_ec1",
    subreddit: "r/ukstreaming",
    archetype: "stream_sniper",
    headline: "We got 4 people watching the North exit and 4 on the South junction — no way we miss the cameo",
    thoughtBubble: "Stream delay is only 2 seconds! He's approaching the main intersection right now! 🎯🏃‍♂️",
    hypeLevel: 0.95,
    sniperRisk: 0.91,
    walkSpeed: 3.65,
    attractedToStreamer: true,
    redditKarma: 5120,
    avatarEmoji: "⚡",
  },
  {
    handle: "u/pub_garden_pintman",
    subreddit: "r/CasualUK",
    archetype: "reddit_local",
    headline: "Pint costs £7.40 in Soho now, at least the live chaos outside the pub window is free entertainment",
    thoughtBubble: "Watching 50 stream snipers sprint past the Devonshire Arms while nursing my Guinness 🍺😂",
    hypeLevel: 0.38,
    sniperRisk: 0.11,
    walkSpeed: 1.3,
    attractedToStreamer: false,
    redditKarma: 71400,
    avatarEmoji: "🍺",
  },
  {
    handle: "u/deliveroo_ebike_king",
    subreddit: "r/london",
    archetype: "chaos_instigator",
    headline: "Order #492 delayed because a whole stadium of teenagers just swarmed the Soho crossroads",
    thoughtBubble: "Trying to weave through this crowd surge before the ramen goes cold — total gridlock ahead! 🛵🍜",
    hypeLevel: 0.78,
    sniperRisk: 0.62,
    walkSpeed: 3.3,
    attractedToStreamer: true,
    redditKarma: 15900,
    avatarEmoji: "🛵",
  },
  {
    handle: "u/berwick_st_vinyl_dig",
    subreddit: "r/london",
    archetype: "reddit_local",
    headline: "Pro tip for the streamer in Soho: cut through Berwick St market alleyways, crowd can't follow in a pack",
    thoughtBubble: "Side alleys are quiet right now, main street ahead is turning into a total moshpit 🎵💿",
    hypeLevel: 0.5,
    sniperRisk: 0.16,
    walkSpeed: 1.48,
    attractedToStreamer: false,
    redditKarma: 33200,
    avatarEmoji: "💿",
  },
  {
    handle: "u/uk_clip_factory_hq",
    subreddit: "r/ukstreaming",
    archetype: "fan_swarm",
    headline: "50K LIVE VIEWERS IN LONDON RIGHT NOW — WHOLE TIMELINE IS CONVERGING ON ZONE 1",
    thoughtBubble: "If he says the street name out loud 50 of us are pouring out of the Tube station immediately 🔥📲",
    hypeLevel: 0.93,
    sniperRisk: 0.74,
    walkSpeed: 3.4,
    attractedToStreamer: true,
    redditKarma: 12700,
    avatarEmoji: "📲",
  },
  {
    handle: "u/theatreland_stage_door",
    subreddit: "r/london",
    archetype: "tourist",
    headline: "Matinee crowd letting out on Shaftesbury Ave right as a livestream mob arrives — absolute scenes",
    thoughtBubble: "Everyone has their phones up! Is it a celebrity or a livestreamer? Let's go look! 🎭✨",
    hypeLevel: 0.71,
    sniperRisk: 0.38,
    walkSpeed: 2.1,
    attractedToStreamer: true,
    redditKarma: 16400,
    avatarEmoji: "🎭",
  },
];

interface RedditListingChild {
  data?: {
    id?: string;
    author?: string;
    title?: string;
    subreddit_name_prefixed?: string;
    ups?: number;
    score?: number;
  };
}

function classifyLiveRedditPost(
  title: string,
  subreddit: string,
  districtName: string,
  idx: number
): Omit<SyntheticPersonaSpec, "id" | "handle" | "subreddit" | "headline" | "redditKarma"> {
  const lower = title.toLowerCase();
  const isCrowdOrTransport =
    lower.includes("crowd") ||
    lower.includes("tube") ||
    lower.includes("station") ||
    lower.includes("bus") ||
    lower.includes("street") ||
    lower.includes("police") ||
    lower.includes("traffic");
  const isStreamOrViral =
    lower.includes("stream") ||
    lower.includes("tiktok") ||
    lower.includes("phone") ||
    lower.includes("video") ||
    lower.includes("famous") ||
    lower.includes("spotted");

  if (isStreamOrViral || idx % 6 === 0) {
    return {
      archetype: "stream_sniper",
      thoughtBubble: `Saw this on ${subreddit} & spotted the live camera rig near ${districtName}! Closing in fast 🕵️‍♂️📲`,
      hypeLevel: 0.91,
      sniperRisk: 0.87,
      walkSpeed: 3.5,
      attractedToStreamer: true,
      avatarEmoji: "🕵️",
    };
  }
  if (idx % 4 === 0) {
    return {
      archetype: "fan_swarm",
      thoughtBubble: `Scrolling ${subreddit} on the Tube when the stream went live in ${districtName} — pulling up with the squad! 🔥`,
      hypeLevel: 0.86,
      sniperRisk: 0.62,
      walkSpeed: 3.2,
      attractedToStreamer: true,
      avatarEmoji: "🏃",
    };
  }
  if (isCrowdOrTransport || idx % 3 === 0) {
    return {
      archetype: "local_commuter",
      thoughtBubble: `"${title.slice(0, 68)}${title.length > 68 ? "..." : ""}" — and now there's a livestream crowd in ${districtName}! 🚇`,
      hypeLevel: 0.34,
      sniperRisk: 0.14,
      walkSpeed: 1.55,
      attractedToStreamer: false,
      avatarEmoji: "🚇",
    };
  }
  return {
    archetype: "reddit_local",
    thoughtBubble: `Just posted on ${subreddit}: "${title.slice(0, 64)}${title.length > 64 ? "..." : ""}" — wild scenes in ${districtName} ☕`,
    hypeLevel: 0.48,
    sniperRisk: 0.22,
    walkSpeed: 1.45,
    attractedToStreamer: idx % 2 === 0,
    avatarEmoji: "☕",
  };
}

async function fetchLiveRedditSubreddit(
  subredditClean: string,
  limit: number,
  districtName: string
): Promise<SyntheticPersonaSpec[]> {
  try {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subredditClean)}/hot.json?limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "numa-london-simulator/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(2200),
       next: { revalidate: 120 },
    });

    if (!res.ok) return [];
    const json = await res.json();
    const children: RedditListingChild[] = json?.data?.children ?? [];
    const specs: SyntheticPersonaSpec[] = [];

    for (let i = 0; i < children.length; i++) {
      const d = children[i]?.data;
      if (!d || !d.title || !d.author || d.author === "AutoModerator") continue;
      const sub = d.subreddit_name_prefixed || `r/${subredditClean}`;
      const traits = classifyLiveRedditPost(d.title, sub, districtName, i);
      specs.push({
        id: `reddit-live-${subredditClean}-${d.id || i}`,
        handle: `u/${d.author}`,
        subreddit: sub,
        headline: d.title.slice(0, 140),
        redditKarma: Math.max(420, (d.ups ?? d.score ?? 150) * 14),
        ...traits,
      });
    }
    return specs;
  } catch {
    return [];
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedSub = (searchParams.get("subreddit") || "london").replace(/^r\//i, "");
  const districtParam = (searchParams.get("district") || "soho") as LondonDistrictId;
  const limitParam = Math.min(60, Math.max(25, Number(searchParams.get("limit")) || 28));

  const districtPreset =
    LONDON_DISTRICTS.find((d) => d.id === districtParam) ?? LONDON_DISTRICTS[0];

  // Attempt fast parallel live Reddit JSON scrape within 2.2s timeout budget
  const [primaryLive, casualUkLive] = await Promise.all([
    fetchLiveRedditSubreddit(requestedSub, 15, districtPreset.name),
    fetchLiveRedditSubreddit("CasualUK", 10, districtPreset.name),
  ]);

  const liveSpecs = [...primaryLive, ...casualUkLive];

  // Prioritize district-matched built-in corpus personas first, then general London/UK streaming personas
  const sortedBuiltin = [...BUILTIN_LONDON_CORPUS].sort((a, b) => {
    const aMatch = a.preferredDistrict === districtPreset.id ? 0 : 1;
    const bMatch = b.preferredDistrict === districtPreset.id ? 0 : 1;
    return aMatch - bMatch;
  });

  const fallbackSpecs: SyntheticPersonaSpec[] = sortedBuiltin.map((seed, idx) => ({
    id: `reddit-corpus-${districtPreset.id}-${idx}`,
    handle: seed.handle,
    subreddit: seed.subreddit,
    archetype: seed.archetype,
    headline: seed.headline,
    thoughtBubble: seed.thoughtBubble,
    hypeLevel: seed.hypeLevel,
    sniperRisk: seed.sniperRisk,
    walkSpeed: seed.walkSpeed,
    attractedToStreamer: seed.attractedToStreamer,
    redditKarma: seed.redditKarma,
    avatarEmoji: seed.avatarEmoji,
  }));

  // Combine live Reddit threads + built-in UK streaming/London corpus to guarantee >= 25 rich personas
  const combined: SyntheticPersonaSpec[] = [];
  const seenHandles = new Set<string>();

  for (const item of [...liveSpecs, ...fallbackSpecs]) {
    if (seenHandles.has(item.handle)) continue;
    seenHandles.add(item.handle);
    combined.push(item);
    if (combined.length >= limitParam) break;
  }

  return NextResponse.json(
    {
      ok: true,
      district: districtPreset.id,
      districtName: districtPreset.name,
      liveScrapedCount: liveSpecs.length,
      totalCount: combined.length,
      source: liveSpecs.length > 0 ? "reddit_live_plus_camel_corpus" : "camel_london_corpus",
      personas: combined,
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
