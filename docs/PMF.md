# Classroom 47: product-market fit research

*Drafted 17 Oct 2026 at the VAST Real-Time Video Agents Hack, London. Every figure has a numbered source in section 7. Anything marked **estimate** or **hypothesis** is our own reasoning and has no source behind it.*

## 1. Summary

- **Who:** IRL streamers and vloggers on Kick, Twitch, TikTok Live and YouTube. We start with the London and UK scene, then move to talent teams, productions and security firms.
- **Pain:** streamers broadcast where they are to thousands of people live, but they can't see what's building up around them. Stream snipers find them from the buildings behind them [6], and a single message can draw a crowd of 3,000–5,000 people [4].
- **Wedge:** one screen that shows "what's around me right now" (crowds on nearby TfL cameras, buses, disruptions, POIs) and a Mirror button that rehearses "what if I tell chat?" before the streamer says it.
- **Why now:** IRL watch time on Twitch nearly tripled in 2025 [2], Kick grew 131% year on year [1], and top streamers already pay security bills in the five figures each month [10].
- **Why us:** we built it today on open London data under TfL's free licence [17]: geotagged JamCams (about 890 in our own pull of the feed, not a published figure), plus TfL bus and road feeds, with YOLO counts and a 3D twin. No streaming tool or safety app combines live surroundings with a way to rehearse a decision.

## 2. Beachhead: IRL streamers and vloggers

### 2.1 Ideal customer profile (hypothesis)

| Tier | Followers / concurrent viewers | Why they care | Who pays |
|---|---|---|---|
| Rising | 1k–50k followers, <500 CCV | Wants to grow fast without getting doxxed. Streams alone. | The streamer (low price) |
| Established | 50k–1M, 500–10k CCV | Gets recognised in public, has a mod team, uses bonded kit | The streamer or their manager |
| Top / touring | 1M+, 10k+ CCV | Draws crowds, travels with security (e.g. IShowSpeed's two bodyguards [11]) | Agency, manager, brand or event |

Platforms: Kick, Twitch, TikTok Live, YouTube Live. **London first:** the UK has over 1M active Twitch streamers (411k of them joined in 2025) and UK viewers watched 637M hours [3]. Our data (TfL JamCams, buses, roads) only covers London today.

### 2.2 Jobs to be done

1. **Before going live:** "Is this spot safe and interesting right now? How busy is it? Are there road closures, and how do I get out?"
2. **While live:** "Is a crowd building near me? Is someone following me? Where's the nearest exit, bus or busy shop?"
3. **Before a risky message** (revealing location, a giveaway, a meetup): "If I say this, how many people turn up, how fast, and does it become a crush?"
4. **After the stream:** show the platform, venue or police that we checked the risk (a duty-of-care record).

### 2.3 Pain evidence

| Incident | What happened | Source |
|---|---|---|
| Kai Cenat, Union Square NYC, 4 Aug 2023 | An announced giveaway drew an estimated 3,000–5,000 people. 65 arrests (30 of them juveniles), 7 injured, about 1,000 NYPD officers deployed. Cenat was charged with inciting a riot; the charges were dismissed in May 2024 after he paid $55k restitution and apologised. | [4], [5] |
| Oxford Street, London, 9 Aug 2023 | TikTok posts calling for an "Oxford Street JD robbery" at 3pm brought crowds to the West End. 9 arrests and 34 dispersal orders, under a Section 35 order. | [7], [8] |
| Airi Sato, Tokyo, 11 Mar 2025 | Stabbed to death while live in front of more than 6,000 viewers. The attacker found her by recognising the buildings behind her. | [6] |
| Valkyrae, Cinna and Emiru, Santa Monica Pier, 2 Mar 2025 | A man who tracked their live stream threatened to kill them. Police escorted them out. | [9], [10] |
| IShowSpeed, Oslo, 3 Jul 2024, and the Netherlands | Mobbed and injured in Oslo. In the Netherlands he fled by boat while fans followed in their own boats, and police asked him to stop streaming. | [11], [12] |

**Platform policy is pushing the burden onto streamers.** Kick requires every IRL stream to have an active moderator "ready to turn the stream off" [13]. Twitch's off-service conduct policy covers doxxing and swatting [14]. Both policies react after something happens. Neither gives the streamer warning beforehand.

### 2.4 Market size

| Metric | Figure | Source |
|---|---|---|
| Global live-stream hours watched, 2025 | 36.4B (+6% YoY) | [1] |
| Twitch hours watched, 2025 | 19.2B | [1] |
| Kick hours watched, 2025 | 4.5B (+131% YoY) | [1] |
| TikTok Live hours watched, Q2 2025 | Just over 8B in the quarter. Its most popular categories are IRL ones (Chats, Fashion, Outdoors) | [15] |
| Twitch IRL growth, 2025 | Twitch's own recap says IRL watch time "nearly tripled". Stream Hatchet puts IRL growth on Twitch at +19%. The two measure different things, so treat the range as uncertain. | [2], [1] |
| Twitch active streamers, 2025 | 21M worldwide, of which 1M+ in the UK | [3] |
| Creator economy | $250B, projected to reach $480B by 2027. 50M creators, of whom about 4% earn more than $100k a year | [16] |

**How many IRL streamers there are: no source found.** Neither Stream Hatchet nor Streams Charts publishes a count of IRL channels. **Estimate:** if 1–2% of the UK's 1M+ Twitch streamers stream outdoors regularly, that's 10k–20k people. Kick and TikTok would add more. We need to check this against Streams Charts category data before relying on it.

### 2.5 What streamers already pay for (willingness-to-pay signals)

| Spend | Price | Source |
|---|---|---|
| IRLToolkit (cloud IRL streaming) | $129/mo Standard, $179/mo Advanced | [18] |
| LiveU Solo Pro (bonded encoder) | €1,495 hardware. Connect data plans $295–$435/mo (US) | [19], [20] |
| BELABOX cloud relay | Vouchers from £4.50 to £200 | [21] |
| Streamlabs Ultra | $27/mo, Ultra+ $79/mo | [22] |
| Private security | Pokimane spends "five figures" a month. MontanaBlack's security reportedly costs about as much as an IRL stream earns (~€10k) | [10], [23] |
| Consumer safety apps | bSafe Premium $4.99/mo, Noonlight $4.99–$9.99/mo, Citizen Protect $20/mo | [24], [25] |

The signal: an established IRL streamer already spends $150–$400/mo on connectivity alone. Safety is currently paid for with people (moderators, bodyguards), not software.

### 2.6 Pricing hypothesis (all hypothesis, not tested)

| Tier | Price | Includes |
|---|---|---|
| Free | £0 | Surroundings card: nearest cameras, crowd level, buses, disruptions. 3 Mirror runs a month. |
| Pro | £15/mo | Unlimited Mirror, crowd-surge alerts, follower/sniper heuristics, overlay for the stream. Priced between Streamlabs Ultra and IRLToolkit. |
| Agency / Event | £250 per event or £149/mo per seat | Multiple streamers, a shared map for security staff, pre-event risk report, exportable log. |

### 2.7 Go-to-market (London first)

1. **London IRL scene:** run demos at meetups and at the spots streamers use most (Leicester Square, Oxford Circus, Tower Bridge, Camden).
2. **Agencies and managers:** they carry the liability and the security bill, so they are the faster buyer. Sell a pilot during a single meetup stream.
3. **Clips spread the word:** a Mirror run that shows "the crowd hits crush density at 14 minutes" makes a good clip. Give users a shareable output by default.
4. **Platforms:** Kick already requires IRL moderators [13], so a moderator-facing view is a natural integration. Approach after we have usage data.

## 3. Competitive landscape

| Player | What it does | What it misses vs us |
|---|---|---|
| Life360 (95.8M MAU, 2.8M paying circles, $489.5M revenue in 2025) [26] | Family location sharing and alerts | It shows where you are. It doesn't show what's around you or what happens next. It's also built for private circles, not for a live audience of thousands. |
| bSafe [24] | SOS button, guardians, records an alarm | Only reacts once something has happened. No crowd or environment data. |
| Noonlight [25] | Hold-to-protect button that dispatches emergency services | Same as bSafe: only reacts after the fact. |
| Citizen ($20/mo Protect) [27] | Crime alerts and live safety agents | US-focused. Incident feed, no crowd density, no simulation. Its surveillance image has been controversial. |
| IRLToolkit [18] | Cloud IRL streaming and switching | Handles the stream, not what's going on around the streamer. |
| LiveU Solo [19] | Bonded cellular encoder | Hardware for connectivity only. |
| Streamlabs [22] | Overlays, alerts, chat tools | Studio-oriented. No location context. |
| Movement Strategies (GHD) [28] | Crowd modelling and analytics for major events (London 2012, Wimbledon, Glastonbury) | Consultancy for venues, done in advance at enterprise prices. Not live, not mobile, not for creators. |
| Crowd Dynamics [29] | Crowd modelling, evacuation, micro-simulation | Same: consultancy, not a self-serve live tool. |
| Wi-Fi / CCTV analytics vendors | People counts inside a single venue | Locked to the venue that owns the cameras. Nothing for a person on the move. |
| Google Maps / Citymapper | Routes, live transit, "busyness" | Only historical busyness. No live cameras, no "what if I tell chat?". |

**Our gap:** nobody combines (a) live, camera-based crowd counts around a moving person with (b) a way to rehearse a decision before acting on it.

## 4. Future potential (the ladder: streamers, then celebrities, then productions, then security)

**Celebrities and talent management.** The same problem at higher stakes: a public appearance or sighting gets posted and a crowd forms within minutes. Managers already pay for protection.
- Buyers: talent agencies and management firms. The product is a pre-appearance Mirror plus a live map for the protection team.
- Sizing: estimates of the global executive-protection market range from $0.43B to $19.4B (2024) depending on how it's defined, so treat any one of those numbers with caution [30].

**Film and TV location shoots.** London averages about 27 film crews on location on any given day, with 11,966 filming days in 2022 [31]. £6.5B was spent on UK film and high-end TV production between Oct 2024 and Sep 2025 [32].
- Job: plan crowd control and the unit base, and anticipate a fan surge when a star is spotted on set.
- Buyers: location managers and unit managers. It fits alongside borough permits (Film London's filming partnership).

**Live events and venues.** UK consumers spent £6.68B on live music in 2024, with a concert somewhere in the UK every 137 seconds [33]. Martyn's Law (Royal Assent 3 Apr 2025) adds duties for venues with 200+ capacity and enhanced duties at 800+, with a lead-in of at least 24 months [34].
- This creates a compliance pull for crowd-awareness tools at the edges of a venue, where in-venue CCTV doesn't reach.

**Private security and executive protection.** There are about 446k–460k SIA licence holders in the UK [35].
- Product: a live surroundings map for close-protection teams, for advance work and route planning.

**City operations and emergency services (speculative).** The Oxford Street response [7] shows police reacting to social posts. A "predicted gathering" signal could be valuable, but the sales cycle is long and public-sector optics are hard. Treat it as optional.

## 5. Risks and open questions

| Risk | Detail | Mitigation |
|---|---|---|
| Privacy / UK GDPR and how surveillance looks | ICO video-surveillance guidance expects a DPIA, data protection by design and a lawful basis under Art. 6. It calls out facial recognition and machine-learning analytics specifically [36]. Tracking people on public cameras looks bad even when it's done lawfully. | We only produce counts and anonymous short-lived tracks. No faces, no IDs, no re-identification, no storing frames. Publish a DPIA before launch. |
| TfL data terms | The TfL feed is free under an OGL v2.0-based licence, but it requires the "Powered by TfL Open Data" credit plus OS and Geomni attributions [17]. We have not yet checked whether running ML over JamCam imagery for a commercial product is allowed. | Read the full terms. Contact TfL if they're unclear. |
| OSM ODbL | Using OSM for shops and POIs requires attribution. A modified or derivative database must be shared under the same licence [37]. | Keep OSM-derived layers separate from our own data. Credit OSM in the UI. |
| Camera projection accuracy | JamCams are pointed at roads and refresh every few minutes (they serve short loops [17]). Placing counts accurately on a map needs per-camera calibration. Blind spots are large. | Show confidence levels and when each camera was last updated. Never present it as complete coverage. |
| Simulation validity | Persona-based crowd forecasts haven't been tested against real outcomes. | Backtest against known events (Union Square [4], Oxford Street [7]) before claiming any accuracy. |
| Liability | If we say a spot is safe and it isn't, we carry the blame. | Present outputs as advisory. Make the terms clear. Never claim "safe". Phrase it as "here's what we see and why". |
| Platform dependency | Overlays and moderator integrations depend on Kick/Twitch APIs and policies. | Make the companion app standalone first. Integrations are a bonus. |
| Coverage | London only. | The beachhead is London on purpose. Outside London we need other open camera networks city by city. |
| Misuse | A stalker could use the tool to find crowds or a target. | The streamer's location is never shared with others. Rate-limit lookups. Show only aggregates. |

## 6. What to validate next

| # | Experiment | Success threshold |
|---|---|---|
| 1 | Interview 10 London IRL streamers (5 under 50k followers, 5 over) about the last time they felt unsafe and what they did about it | 7 of 10 describe a specific incident. 5 of 10 say they'd use a surroundings card before every outdoor stream. |
| 2 | Pilot with one agency or manager during a meetup or announced-location stream | The agency uses Mirror before announcing. Their safety lead rates it useful (4/5 or higher). They ask for a second event. |
| 3 | Fake-door Pro tier at £15/mo on a landing page shared in UK IRL Discords | At least 5% of visitors click "Start Pro", from 300+ visitors. |
| 4 | Backtest Mirror against the Union Square and Oxford Street timelines | The forecast lands within ±50% of the reported peak crowd and arrival time. |
| 5 | Check accuracy: YOLO counts on 20 JamCams against manual counts | Mean absolute error under 20% at the levels that matter (busy vs quiet). |

## 7. Sources

1. Stream Hatchet 2025 Live Streaming Trends Report, via Net Influencer (18 Feb 2026). https://www.netinfluencer.com/live-streaming-viewership-hits-four-year-high-as-kick-surges-and-twitch-loses-ground/
2. Tubefilter, Twitch 2025 year-end recap (3 Dec 2025). https://www.tubefilter.com/2025/12/03/twitch-year-end-recap-2025-900-million-hours-watch-time/
3. PocketGamer.biz, Twitch hits 21m streamers in 2025. https://www.pocketgamer.biz/twitch-hits-21m-streamers-with-billions-of-hours-watched-in-2025/
4. Wikipedia, 2023 Union Square riot. https://en.wikipedia.org/wiki/2023_Union_Square_riot
5. Rolling Stone, Kai Cenat charged with inciting a riot. https://www.rollingstone.com/culture/culture-news/twitch-streamer-kai-cenat-giveaway-chaos-nyc-1234801203/
6. CBS News, YouTuber Airi Sato killed while livestreaming in Tokyo. https://www.cbsnews.com/amp/news/youtuber-airi-sato-killed-while-livestreaming-tokyo-street
7. ITV News, Oxford Street rampage (10 Aug 2023). https://www.itv.com/news/london/2023-08-10/youths-in-oxford-street-rampage-must-be-hunted-down-says-home-secretary
8. NBC News, London Oxford Street TikTok looters. https://www.nbcnews.com/news/world/london-oxford-street-tiktok-social-media-looters-police-arrests-rcna99059
9. FOX LA, Twitch streamers get death threats on Santa Monica Pier. https://www.foxla.com/news/valkyrae-cinna-emiru-attacked-santa-monica-pier-livestream
10. Tubefilter, Is paying for private security just another cost of being a female streamer? (6 Mar 2025). https://www.tubefilter.com/?p=185149
11. Esports.gg, IShowSpeed assaulted in Norway. https://esports.gg/news/streamers/ishowspeed-assaulted-in-norway-vows-to-never-go-back
12. Sportskeeda, IShowSpeed swarmed in the Netherlands. https://sportskeeda.com/us/streamers/news-ishowspeed-gets-microphone-stolen-pants-pull-fans-swarm-car-netherlands
13. Creator Handbook, Kick launches new categories (2 Jul 2024). https://www.creatorhandbook.net/kick-launches-new-categories-to-hopefully-help-moderation/
14. Engadget, Twitch off-service conduct policy covers doxxing and swatting. https://www.engadget.com/twitchs-off-service-conduct-policy-finally-covers-doxxing-and-swatting-193222663.html
15. Streams Charts Q2 2025 report, via Net Influencer (28 Jul 2025). https://www.netinfluencer.com/livestreaming-sees-shift-as-kick-joins-big-four-in-q2-2025/
16. Goldman Sachs, The creator economy could approach half a trillion dollars by 2027. https://www.goldmansachs.com/insights/articles/the-creator-economy-could-approach-half-a-trillion-dollars-by-2027
17. TfL, Transport Data Service terms and conditions. https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service
18. IRLToolkit pricing. https://irltoolkit.com/pricing
19. Streamingserver.io, LiveU Solo (Pro) and LRT. https://streamingserver.io/en/blog/liveu-solo
20. Videoguys, LiveU Solo Pro Connect kits. https://videoguys.com/blogs/news-and-sales/stream-from-anywhere-with-liveu-solo-pro-connect-kits-unlimited-data-and-bonding
21. BELABOX shop, cloud voucher. https://shop.belabox.net/product/belabox-cloud-voucher
22. Creator Stack Club, Streamlabs pricing. https://www.creatorstackclub.com/software/streamlabs
23. EarlyGame, MontanaBlack security costs. https://earlygame.com/de/news/influencers/montanablack-security-kosten-10000-euro
24. LocalsInsider, solo travel SOS safety apps (bSafe pricing). https://localsinsider.com/?p=27807
25. Apple App Store, Noonlight. https://apps.apple.com/app/id716262008
26. Life360, Record Q4 2025 results. https://seekingalpha.com/pr/20420494
27. TechCrunch, Citizen launches $20/month Protect (3 Aug 2021). https://techcrunch.com/2021/08/03/controversial-crime-app-citizen-launches-20-month-protect-service/
28. GHD, Movement Strategies. https://www.ghd.com/en/expertise/movement-strategies.aspx
29. Crowd Dynamics. https://www.crowddynamics.com/
30. Verified Market Research / SkyQuest / DataHorizzon, executive protection market (conflicting estimates). https://www.verifiedmarketresearch.com/product/executive-protection-service-market/ · https://www.skyquestt.com/report/executive-protection-services-market · https://datahorizzonresearch.com/executive-protection-service-market-43814
31. Film London, Impact. https://filmlondon.org.uk/what-we-do/impact
32. CineD, Why film production is leaving LA for London (cites BFI). https://www.cined.com/welcome-to-lollywood-why-film-production-is-leaving-los-angeles-for-london/
33. Music Business Worldwide, LIVE 2024 report. https://www.musicbusinessworldwide.com/a-concert-took-place-every-137-seconds-across-the-uk-in-2024-as-live-music-spend-in-the-market-jumped-9-5-to-7-2bn-according-to-new-report
34. Wikipedia, Terrorism (Protection of Premises) Act 2025. https://en.wikipedia.org/wiki/Terrorism_(Protection_of_Premises)_Act_2025
35. Coredinate, UK security workforce shortage, and the SIA business plan 2025–26. https://coredinate.de/en/blog/uk-security-workforce-shortage · https://assets.publishing.service.gov.uk/media/686fe6c22cfe301b5fb67a5a/sia-business-plan-2025-26.pdf
36. DWF, ICO guidance on video surveillance. https://dwfgroup.com/en/news-and-insights/insights/2022/3/ico-guidance-video-surveillance
37. OpenStreetMap Foundation, Licence. https://www.osmfoundation.org/wiki/Licence
