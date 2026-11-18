# gta6-open-world — Port Solano

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Darkarmy921/gta6-open-world/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Darkarmy921/gta6-open-world/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Port Solano is a 2D top-down open-world crime game, built for make.fun's
"Make GTA 6" bounty. You are Rook, fresh back in a sun-soaked harbour city
run by the Harbor Kings and watched by the Solano PD. Steal cars, outrun the
cops, run six story jobs for Delia Maren, take taxi fares and delivery gigs
between jobs, collect bounties off the Most Wanted board, buy a garage to
call home, and climb from Nobody to Legend — all in vanilla JavaScript and
Canvas 2D, with no libraries and no network requests.

## The city

Port Solano is a fixed 3200×2400 city: eight avenues, six streets, a marina,
a beach and a harbour, ten districts, twelve landmarks, a park, docks, a
strip that never closes, and the bank that holds Sal Moretti's money. The
clock runs a full day in twenty minutes, the weather rolls from clear to
storm (rain cuts your grip by 15%), traffic thickens at rush hour, and the
radio plays eight procedural stations — harbour pop, desert rock, late-night
jazz, street rap, lo-fi haze, slow strings, harbour country and synthwave.

## The campaign

Six jobs for Delia Maren, paid $500 / $800 / $1,000 / $1,200 / $1,500 /
$5,000:

1. **Welcome Home** — take Delia's sedan to the marina pier, pick up a
   package, deliver it to the Solano Arms hotel.
2. **Hot Wheels** — steal a coupe from the marina lot and run it to the
   chop shop with the cops on you.
3. **The Drop** — a package to the north motel in ninety seconds. Not
   ninety-one.
4. **Heat Wave** — survive two minutes at three stars, then vanish.
5. **Warehouse Payback** — six Harbor Kings in a warehouse. Sanctioned.
6. **The Big Score** — crack the Solano Trust vault, then run for the
   safehouse while the whole city wakes up.

## Free roam

- **Side jobs** — taxi fares, delivery gigs, getaway fares, courier runs,
  valet runs and medic runs, on a board that refills every 45 seconds,
  with a streak bonus for consecutive completions.
- **Most Wanted** — six named Kings with a price on each head. Collect one
  and the PD looks the other way: one star of heat comes off.
- **Street events** — gang shootouts, stolen cars, street races, muggings,
  hitmen, package rushes, ambushes, joyrides and rescues, rolling in
  every 75 seconds.
- **Garages** — four to buy, from the $800 Marina Lockup to the $6,000
  Hilltop Villa. A garage is your respawn home, and buying one throws in
  a free repair of whatever you are driving.
- **Achievements** — sixteen career milestones, from First Grand to King
  of Port Solano, saved with your career.
- **City guide** — twelve landmarks across ten districts, one key away.

## Wanted

Heat runs 0–100 and wanted stars are heat divided by 20, capped at five.
Stealing a car, shooting, hitting a ped — all of it adds heat, and the heat
decays after five seconds out of cop sight. At five stars the PD sets
roadblocks and sends a pincer car to cut you off. Foot cops bust you in
1.5 seconds of contact; break contact early, lose the tail, and the
clean-in countdown starts.

## How to play

Open `game/index.html` in a desktop browser, or serve the folder:

```sh
node serve.ts
```

then open http://localhost:8080. No build step, no install, no downloads —
the game is plain static files.

## Controls

| Keys | Action |
| --- | --- |
| WASD / Arrows | Move on foot / drive |
| Mouse | Aim |
| Left mouse button | Shoot |
| F | Punch (melee combo, kill streaks pay) |
| E | Interact / enter or exit a car |
| R | Reload the pistol |
| M | Music on / off |
| N | Next radio station |
| T | Stats screen (career, reputation, achievements) |
| G | City guide (landmarks of the district you are in) |
| P / Esc | Pause |

`?seed=N` fixes the city and the traffic, so the same seed always plays
the same city. `?shot=start|drive|chase|mission|night|jobs` stages a
screenshot scene: two seconds of real simulation, then the frame is ready.

## Saving

Progress saves to the browser's local storage (money, highest unlocked job,
career record, radio station, time of day, weather, garages, achievements,
bounties). Continue resumes the next unlocked job from the diner — a
mid-mission stage is never restored, by design.

## Files

- `game/index.html` — the page, the overlays, the controls table.
- `game/src/main.js` — the boot, the loop, the mode machine, the E key.
- `game/src/config.js` — every tuning number, the city data, the dialogue.
- `game/src/missions.js` — the six story jobs, side jobs, street events,
  the bounty board and the garages.
- `game/src/police.js` — wanted, heat, cop cars, foot cops, roadblocks.
- `game/src/combat.js` — pistol, melee, bullets, gang members, streaks.
- `game/src/world.js` — the seeded city, day/night, weather, districts.
- `game/src/hud.js` — HUD, minimap, trackers, stats screen, city guide.
- `game/src/render.js` — the one painter.
- `game/src/audio.js` — WebAudio SFX and procedural music, no files.
- `game/src/save.js` — localStorage save/load, schema v3.
- `game/src/player.js` — on-foot movement, achievements, reputation.
- `game/src/vehicles.js` — car physics, damage, wrecks, repairs.
- `game/src/traffic.js` — AI traffic, taxis, jams.
- `game/src/peds.js` — pedestrians, barks, the crowd reaction.
- `game/src/effects.js` — particles, floating text, screen shake, rain.
- `game/src/input.js` — keyboard and pointer, one shared key set.
- `game/src/random.js` — the seeded RNG and its helpers.
- `game/src/shots.js` — the six screenshot scenes.
- `tools/harden.mjs` — the node stub-DOM smoke harness (run it with
  `node tools/harden.mjs`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=ppee1fs7&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
