# Classroom 47 — Team TODO

IRL streaming platform + London awareness layer + parallel-reality 3D city sim with Reddit-archetype personas.
Hard deadline: **16:30 BST** submission. Code freeze **15:45**. Backup recording by **15:30**.

## Streaming platform — Sonion / Claude
Being built this session:
- [ ] Next.js app scaffold, CAMP-layered (`apps/stream/src/agents`, `apps/stream/src/platform`, `apps/stream/src/components`)
- [ ] Player: webcam, TfL JamCam clip, or uploaded/URL video, with LIVE pill, viewer count, location chip
- [ ] Mock chat crowd (`apps/stream/src/agents/chat-crowd`): personas, archetype lines, London IRL slang, rate scaled to viewers
- [ ] Location-signal flagging in chat (messages that leak or react to the streamer's location)
- [ ] Streamer bar: location picker, "Tell chat my location" (reveal), "Mirror" (sim request)
- [ ] Surroundings card, fed by `surroundings.update` on the bus
- [ ] Cross-tab event bus (`apps/stream/src/platform/bus.ts`, BroadcastChannel `classroom-47`)

Next:
- [ ] Real streamer location: phone GPS via a companion page posting `stream.location`
- [ ] Real stream ingest: phone/OBS → WebRTC or HLS into the player
- [ ] Chat lines from W&B inference (LLM), conditioned on the scene description and location
- [ ] Stretch: stream-sniper detection (same person re-appearing across the stream; chat-reported snipers)

## City / parallel reality — Arvin
- [ ] 3D London twin around the streamer (Google Photorealistic 3D Tiles via CesiumJS, or Mapbox/deck.gl extruded buildings)
- [ ] Seed the twin's baseline crowd from live JamCam YOLO counts
- [ ] Crowd sim: agents walk to target, avoid each other; density heatmap over time; crush-risk threshold (~4 people/m²)
- [ ] Listen on the bus for `location.reveal` and `sim.request`; run the sim at that location
- [ ] Publish results back (`surroundings.update`) so the stream page shows them
- [ ] Camera fly-in from the stream view to the twin for the demo

## Awareness data — Chris (sourcing + linking feeds to the stream and city)
- [ ] TfL JamCams: 890 cams (`api.tfl.gov.uk/Place/Type/JamCam`), pick the nearest N to the streamer
- [ ] YOLO people/vehicle counts per clip → density + flow
- [ ] TfL disruptions + arrivals near the route
- [ ] Cosmos incident reasoning on the 3–5 nearest cams ("is that an accident / crowd forming?")
- [ ] Optional: adsb.lol, Open-Meteo for extra context
- [ ] Ingest clips into VAST; semantic search ("cams with crowds forming")

## Personas — Chris (data) + Arvin (sim)
- [ ] Scrape Reddit (r/london, streamer fan subs) for real behaviour signals
- [ ] W&B LLM distils into ~15–20 archetypes (superfan, opportunist, hater, local, tourist…) with travel time, likelihood to show, behaviour
- [ ] Archetypes only; never model real individuals
- [ ] Persona agents decide who comes after a reveal, from where, how fast → feed the city sim

## Agent (advisor)
- [ ] Turns surroundings + sim output into a decision: reroute, delay, or announce a safer spot
- [ ] Re-sim the alternative and show it stays green
- [ ] Trace agent calls in W&B Weave

## Sponsors (need ≥3, aim for 4+)
- [ ] YOLO — crowd counts on JamCams
- [ ] NVIDIA Cosmos — incident reasoning
- [ ] W&B inference + Weave — personas, advisor, traces
- [ ] VAST AI OS — clip ingest + search (CAMP structure)
- [ ] CoreWeave — model serving
- [ ] Cursor — dev environment

## Demo & submission
- [ ] Problem slide: Union Square Aug 2023 (3,000–5,000 people, 65+ arrests, inciting-a-riot charge); Oxford Street Aug 2023 (TikTok-summoned crowd, 34 dispersal orders, 9 arrests)
- [ ] 3-minute demo script: hook → awareness → "should I tell chat?" → twin + personas flood → crush warning → safer spot → tagline
- [ ] Rehearse with fixed inputs; cache every network-dependent result
- [ ] Backup demo recording by 15:30
- [ ] Code freeze 15:45
- [ ] README current (what, sponsor tools, how to run, demo video)
- [ ] Submit GitHub repo by 16:30 BST
