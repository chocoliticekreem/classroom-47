import type { Archetype } from "@/lib/types";

export const LINES: Record<Archetype, string[]> = {
  hype: [
    "W",
    "W stream",
    "WWWW 🔥🔥",
    "{streamer} is HIM",
    "this is peak content fr",
    "London IRL arc goes hard 🔥",
    "sheeeesh 😮‍💨",
    "clip that 📸",
    "bro is locked in",
    "{loc} looking mad tonight",
    "🔥🔥🔥",
    "LETS GOOO",
    "vibes are immaculate rn",
    "best IRL streamer in the UK no debate",
    "this city never sleeps 🌃",
    "😂😂😂",
  ],
  questioner: [
    "is that {loc}?",
    "who's this guy",
    "where is this",
    "what camera is that?",
    "how long you streaming for?",
    "what's the plan tonight",
    "first time here, what's going on",
    "is it raining there?",
    "what time is it in London rn",
    "which tube line is that",
    "are you going to Soho after?",
    "what mic you using",
  ],
  local: [
    "bro is NOT in zone 1 💀",
    "that's literally {area}",
    "i know exactly where that is",
    "avoid {loc} after 9 it gets mental",
    "tube is rammed today",
    "the Pret behind you is closed fyi",
    "Northern line delays again 😤",
    "classic {loc} madness",
    "london prices are a joke",
    "it's always busy round there on a saturday",
  ],
  superfan: [
    "love this stream ❤️",
    "been here since day one 🫶",
    "{streamer} never misses",
    "hi {streamer}!! ❤️",
    "ur the reason i get through the week",
    "can you say hi to me 🥺",
    "best part of my saturday",
    "chat be nice today 🙏",
  ],
  troll: [
    "mid",
    "fell off",
    "L stream",
    "boring 😴",
    "who even watches this",
    "ratio",
    "touch grass",
    "bro thinks he's famous 💀",
    "this is staged",
  ],
  mod: [
    "Reminder: no posting personal locations in chat 🙏",
    "Keep it respectful chat",
    "Be kind or be banned",
    "Follow the stream to stay updated",
    "No backseating please",
  ],
};

/** Locals who place the streamer or say they're nearby — the raw material for crowding. */
export const LOCATION_SIGNAL_LINES: string[] = [
  "wait i'm literally at {loc} rn",
  "that's by the {area} station i can see you lol",
  "5 mins away from {loc} 👀",
  "i'm across the road from you",
  "yo is that {loc}? i'm round the corner",
  "just saw you walk past 😭",
  "coming to find you",
];

export const SURGE_LINES: string[] = [
  "OMW",
  "OMW 🏃‍♂️🏃‍♂️",
  "pulling up in 10",
  "who's at {loc} rn",
  "everyone to {loc} 🚨",
  "getting the tube now",
  "on the bus, 15 mins",
  "bringing the mandem",
  "the whole of {area} is coming 💀",
  "i'm already here where are you",
  "otw from Brixton",
  "uber's 4 mins away",
  "crowd is getting MAD",
  "can't even see you there's so many people",
];

export const STREAMER_REPLY_LINES: string[] = [
  "W",
  "real",
  "facts",
  "LMAO",
  "😂😂",
  "say less",
  "frrr",
  "{streamer} spitting",
  "true",
  "no way 💀",
  "agreed",
  "W take",
];

export const FIRST_MESSAGE_LINES: string[] = [
  "first time chatting, love the stream",
  "hi from Manchester 👋",
  "just found this stream, hello",
  "first message! hi {streamer}",
];

export const DONATION_LINES: string[] = [
  "buy yourself a meal deal 🥪",
  "for the Oyster top-up",
  "keep the London streams coming",
  "get a cab home safe",
  "W stream, here's a fiver",
];
