# Demo scripts

Live demo, no slides. One browser with four tabs open before you start: the stream page
(`http://localhost:3047`, Live tab, location Tower Hill), the cluster agent dashboard
(workshop.thecosmoslabs.com → App, or `https://video-lab-team-47.cosmos.vastdata.com/app/`), the Weave
project (`anson9m23-chocoliticekreem-codes/classroom-47`), and the Predict panel. Trigger one `/app/assess`
two minutes before you're called so the first verdict is already cached; the cluster call takes 20–40 s.

Name the CAMP layer out loud as you touch it. Judges look for each sponsor.

## 2 minutes (round 1, 16:45)

| t | Say | Show |
|---|---|---|
| 0:00 | "Union Square 2023, Oxford Street 2023. Both started with one message from a streamer. Classroom 47 is a video agent that tells an IRL streamer what's around them before they send that message." | Stream page, live from the phone, GPS pin on Tower Hill, viewer count |
| 0:20 | "The streamer asks: should I tell chat where I am? That question goes to **our agent running on the VAST cluster**: a Deployment in our team namespace at `/app`, built and deployed from **Cursor** on the lab VM." | Click the advisor card's question. Flip to the `/app/` dashboard tab for 3 s: same request, same verdict |
| 0:40 | "The agent searches the team's **VSS index on VAST**, 612 videos. Each hit comes with the **NVIDIA Cosmos** description and **YOLO** counts the DataEngine pipeline wrote into **VastDB**." | Advisor card: evidence clips with camera, timestamps, Cosmos text, people/vehicle counts |
| 1:00 | "Then **Nemotron on W&B Inference** turns that evidence into one verdict: calm, busy or danger, two sentences of advice. Every call is a **Weave** trace." | Verdict + reasons. Flip to the Weave tab: the `assess` trace with the VSS results and the model call inside |
| 1:20 | "Around me adds live London: TfL cameras with YOLO counts, buses, closures. The twin shows a calmer route." | Around me tab, then `/twin` with the route |
| 1:40 | "And before the streamer sends the message, Predict rehearses it: 30 minutes forward, then `/score` grades the forecast against what the cameras actually saw." | Predict panel: what-if, ghost layer, score |
| 1:55 | "Know what's around you. Rehearse the future before you cause it." | Back to the stream page |

## 3 minutes (finals, 18:00)

Same spine, with three additions:

| t | Add | Show |
|---|---|---|
| 0:50 | **The re-ingest story.** "The default ingest prompt never asked whether someone is filming the camera holder, so our query 'someone filming or following the camera holder' found nothing: 7 of 8 test queries hit, this one missed. We re-ingested with our own streamer-safety prompt, and now Cosmos writes it down." (Only if Do next #1 in `docs/COMPLIANCE.md` has run; otherwise say "that's the next re-ingest" and show the before table) | README evaluation table, before and after |
| 1:40 | **Follower watch and the reacting chat.** "The same person behind the streamer for minutes is a risk pattern: the follower watch flags it. Chat reacts to what Nemotron VL actually sees in the frame." | Follower warning, chat lines |
| 2:30 | **Why VAST.** "Nothing is copied out: the agent queries VSS and VastDB when the question arrives. Permissions, index and footage stay on the platform; the agent runtime carries the tools, the context and the traces." (If Do next #2 has run: "and writes every verdict back to our own VastDB table.") | `/app/health` → `vss: true, wandb: true`; Weave trace list |

## Fallbacks

- Venue Wi-Fi down: the advisor keeps the last verdict; play the backup recording for the agent section.
- Cluster slow (> 45 s): the stream page falls back to local signals and says so; show the `/app/` dashboard's
  last result instead.
- Never type a new question on stage; use the default one.
