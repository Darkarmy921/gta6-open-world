// peds.js — pedestrians on the sidewalks of Port Solano.
//
// Sidewalk geometry comes from the shared contract (avenues x = 200 + i*400,
// streets y = 200 + j*400, road half-width 48, sidewalk 20, so the sidewalk
// centreline sits 58 px from a road centreline). Ped shape (unified):
// { x, y, angle, speed, state: 'walk'|'flee'|'panic'|'dead', color, hp,
//   walkPhase, fleeTimer, deadTimer, cruiseSpeed, pauseTimer, panicTimer,
//   dead: boolean }
//
// Death has TWO flags that always agree: ped.dead (set by combat.js /
// checkRunOver) and ped.state === 'dead'. updatePeds normalises them, counts
// deadTimer down from 6 s, then removes the body. render.js draws either flag
// as a fallen figure.
//
// Only the PLAYER's car makes a run-over a crime: AI traffic scares peds
// onto the sidewalk instead of killing them, or the wanted level would climb
// while the player stands still.
import { BARKS, PEDS, PED_TYPES, VIEW } from './config.js';
import { resolveBuildingCollision } from './world.js';
import { rngFloat } from './random.js';
import { addBark } from './effects.js';

export const PED_TARGET = PEDS.count;
export const PED_SPAWN_RADIUS = 700;
export const PED_DESPAWN_DIST = 1100;
export const FLEE_SPEED = PEDS.fleeSpeed;
export const DANGER_RADIUS = 200;

export const AVENUES = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
export const STREETS = [200, 600, 1000, 1400, 1800, 2200];
export const SIDEWALK_OFFSET = 58; // 48 road half-width + 10 (sidewalk centre)

export const PED_SHIRTS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#ecf0f1', '#fd79a8', '#00cec9',
  '#6c5ce7', '#d63031', '#00b894', '#fdcb6e', '#636e72',
];
export const PED_SKINS = ['#e8b98a', '#d9a066', '#b07a4a', '#f0c8a0', '#8d5a3b'];

// ---------------------------------------------------------------------------
// RNG helpers (rngFloat is the shared one from random.js; peds.js used to
// carry its own copy, identical to traffic.js's, and the two had already
// drifted in the comment describing which shapes they tolerated).
// ---------------------------------------------------------------------------

function rand(state, a, b) {
  return a + rngFloat(state) * (b - a);
}

function pick(state, arr) {
  return arr[Math.floor(rngFloat(state) * arr.length) % arr.length];
}

// Camera centre in world coords (camera itself is the viewport top-left).
function camCentreOf(state) {
  const cam = state.camera || {};
  const x = cam.x !== undefined ? cam.x : 1600;
  const y = cam.y !== undefined ? cam.y : 1200;
  return { x: x + VIEW.width / 2, y: y + VIEW.height / 2 };
}

export function createPed(rng, x, y, angle = 0) {
  const r = typeof rng === 'function' ? rng : Math.random;
  // A kind, assigned once and never changed: the same ped reads as the
  // same person all day — a jogger is always fast, an old-timer always
  // slow, a tourist always stops to look around. The kind sets the
  // shirt palette and the walk-speed multiplier (applied at spawn).
  const kind = PED_TYPES[Math.floor(r() * PED_TYPES.length)];
  return {
    x, y, angle,
    speed: 0,
    state: 'walk',
    color: kind.shirts[Math.floor(r() * kind.shirts.length)],
    hp: 100,
    walkPhase: r() * 6,
    pauseTimer: 0,
    cruiseSpeed: 50 + r() * 40,
    fleeTimer: 0,
    panicTimer: 0,
    deadTimer: 0,
    dead: false,
    // Variety fields (new): kind id + display name, speed multiplier,
    // and the bark cooldown (a ped that just spoke waits before the
    // next line, so a crowd does not become a wall of text).
    kind: kind.id,
    kindName: kind.name,
    speedMul: kind.speedMul,
    barkT: r() * 4,
  };
}

// ---------------------------------------------------------------------------
// Barks. A ped says one line (floating text above its head) when something
// happens near it: a near-miss, a gunshot, or the player strolling past.
// The line is picked from BARKS (config.js); the cooldown keeps a crowd
// from talking over itself, and barks never fire for dead peds.
// ---------------------------------------------------------------------------

/** Say one line from a BARKS pool above the ped, if the cooldown allows. */
export function pedBark(state, ped, pool) {
  if (!ped || ped.dead || ped.state === 'dead') return false;
  if ((ped.barkT || 0) > 0) return false;
  // Kind pools: a fisherman greets like a fisherman and a dealer
  // greets like a dealer — the greeting pool is the default, the
  // kind pool is the voice.
  if (pool === 'greeting' && (ped.kind === 'fisherman' || ped.kind === 'dealer')) pool = ped.kind;
  // A near-miss repeated while the last bark was a near-miss uses the
  // third pool, so the same close call is never said the same way twice.
  if (pool === 'nearMiss' && ped._lastPool === 'nearMiss') pool = 'nearMiss2';
  ped._lastPool = pool;
  const lines = BARKS[pool] || BARKS.greeting;
  const line = lines[Math.floor(rngFloat(state) * lines.length)];
  ped.barkT = 4 + rngFloat(state) * 4;
  // Barks use the speech pill (addBark), not the plain payout text:
  // a line of dialogue should read as speech, not as a score popup.
  if (typeof state.addBark === 'function') state.addBark(ped.x, ped.y - 24, line, '#ffffff');
  else addBark(state, ped.x, ped.y - 24, line, '#ffffff');
  return true;
}

/** A ped's chance to speak, from its kind (tourists and kids chat; commuters don't). */
export function barkChanceOf(ped) {
  const kind = PED_TYPES.find((k) => k.id === ped.kind);
  return kind ? kind.barkChance : 0.05;
}

/**
 * The crowd reacts: up to three nearby peds bark from `pool` at once.
 * A bounty collection, a garage purchase, an achievement — the city
 * notices, and it notices out loud. The barks are capped at three so
 * a celebration does not become a choir, and each ped still obeys its
 * own bark cooldown (pedBark enforces it), so the same ped never
 * shouts twice about the same thing.
 */
export function crowdReaction(state, pool) {
  if (!state || !Array.isArray(state.peds)) return 0;
  const p = state.player;
  if (!p) return 0;
  let spoke = 0;
  const near = state.peds
    .filter((ped) => !ped.dead && ped.state !== 'dead' && Math.hypot(ped.x - p.x, ped.y - p.y) < 500)
    .slice(0, 3);
  for (const ped of near) {
    if (pedBark(state, ped, pool)) spoke += 1;
  }
  return spoke;
}

// A random point on a sidewalk near the camera: pick an avenue or a street,
// offset to the sidewalk centreline on one side, then a position along it.
function randomSidewalkPoint(state) {
  const cam = camCentreOf(state);
  for (let tries = 0; tries < 12; tries += 1) {
    let x;
    let y;
    let angle;
    if (rngFloat(state) < 0.5) {
      const ax = pick(state, AVENUES);
      const side = rngFloat(state) < 0.5 ? -SIDEWALK_OFFSET : SIDEWALK_OFFSET;
      x = ax + side;
      y = rand(state, 200, 2200);
      angle = rngFloat(state) < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const sy = pick(state, STREETS);
      const side = rngFloat(state) < 0.5 ? -SIDEWALK_OFFSET : SIDEWALK_OFFSET;
      y = sy + side;
      x = rand(state, 200, 3000);
      angle = rngFloat(state) < 0.5 ? 0 : Math.PI;
    }
    // Keep spawns near the camera and out of the harbor.
    if (y >= 2240) continue;
    if (Math.hypot(x - cam.x, y - cam.y) <= PED_SPAWN_RADIUS) return { x, y, angle };
  }
  return null;
}

function spawnOnePed(state) {
  const spot = randomSidewalkPoint(state);
  if (!spot) return null;
  const ped = createPed(state.rng, spot.x, spot.y, spot.angle);
  // The kind's speed multiplier applies to the walk range: a jogger
  // cruises at ~95-150px/s, an old-timer at ~22-44. The multiplier is
  // stored on the ped so the HUD / stats can read it back.
  ped.cruiseSpeed = rand(state, PEDS.walkMin, PEDS.walkMax) * (ped.speedMul || 1);
  state.peds.push(ped);
  return ped;
}

// Keep ~PED_TARGET peds walking on sidewalks near the camera; despawn the far ones.
export function spawnPeds(state) {
  if (!Array.isArray(state.peds)) state.peds = [];
  const cam = camCentreOf(state);
  for (let i = state.peds.length - 1; i >= 0; i -= 1) {
    const ped = state.peds[i];
    if (Math.hypot(ped.x - cam.x, ped.y - cam.y) > PED_DESPAWN_DIST) {
      state.peds.splice(i, 1);
    }
  }
  let spawned = 0;
  while (state.peds.length < PED_TARGET && spawned < 5) {
    if (!spawnOnePed(state)) break;
    spawned += 1;
  }
}

// Is (x, y) on a road surface (as opposed to a sidewalk or a block)?
// A point is on a road when it lies within an avenue's road band
// (x within ax +/- 48) or a street's road band (y within sy +/- 48).
// A sidewalk point along an avenue (x = ax +/- 58) is outside the
// avenue's band, and only counts as "on a road" when it is also inside
// a street's band — i.e. it is crossing that street.
function isOnRoadPoint(x, y) {
  for (const ax of AVENUES) if (Math.abs(x - ax) <= 48) return true;
  for (const sy of STREETS) if (Math.abs(y - sy) <= 48) return true;
  return false;
}

// A fast car bearing down on (x, y): any non-wrecked car over 100px/s
// within speed * 1.0s of travel (min 200px) whose heading has a positive
// component toward the point. This is the crossing check, not the flee
// check: it runs BEFORE the ped steps into the road, so a ped about to
// cross looks both ways instead of walking into a car that is already
// too close to stop. The flee (nearestThreat) only fires once the ped
// is already in the car's path, and at 300-540px/s a crossing ped that
// has just stepped off the kerb cannot clear the 26px kill radius in
// the 0.3-0.5s it has left — which is how the M2 coupe collected two
// run-overs (wanted 2 -> 4) on street 200.
function carBearingDown(state, x, y) {
  for (const car of state.cars || []) {
    if (!car || car.wrecked || Math.abs(car.speed || 0) < 100) continue;
    const dx = x - car.x;
    const dy = y - car.y;
    const d = Math.hypot(dx, dy);
    // 2.0 s of travel, not 1.0: crossing a 96px road at 40-80px/s takes
    // 1.2-1.9 s, so a car 1.0 s away arrives while the ped is still
    // mid-road — the ped steps out, the flee (0.8 s warning) cannot
    // clear it, and a 460px/s coupe collects it. With 2.0 s the ped
    // waits on the kerb until the car has passed.
    const warnRadius = Math.max(200, Math.abs(car.speed || 0) * 2.0);
    if (d > warnRadius) continue;
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    if (d > 0 && (dx * fx + dy * fy) / d > 0.5) return true;
  }
  return false;
}

// Nearest threat to a ped, or null: {x, y, kind} where kind is
// 'gunfire' | 'explosion' | 'player' | 'car'.
function nearestThreat(state, ped) {
  const px = ped.x;
  const py = ped.y;
  let best = null;
  let bestD = DANGER_RADIUS;

  // Gunfire: live bullets near the ped.
  if (Array.isArray(state.bullets)) {
    for (const b of state.bullets) {
      const d = Math.hypot(b.x - px, b.y - py);
      if (d < bestD) { bestD = d; best = { x: b.x, y: b.y, kind: 'gunfire' }; }
    }
  }
  // Recent explosion, if the effects module records one.
  const boom = state.lastExplosion;
  if (boom && typeof state.time === 'number' && state.time - boom.at < 1.5) {
    const d = Math.hypot(boom.x - px, boom.y - py);
    if (d < bestD) { bestD = d; best = { x: boom.x, y: boom.y, kind: 'explosion' }; }
  }
  // A recent gunshot marker (set by combat.js if it records one).
  const shot = state.lastGunshot;
  if (shot && typeof state.time === 'number' && state.time - shot.at < 1.0) {
    const d = Math.hypot(shot.x - px, shot.y - py);
    if (d < bestD) { bestD = d; best = { x: shot.x, y: shot.y, kind: 'gunfire' }; }
  }
  // Wanted player nearby: people run from the cops' target too.
  const player = state.player;
  if (player && !player.inCar && player.wanted > 0) {
    const d = Math.hypot(player.x - px, player.y - py);
    if (d < bestD) { bestD = d; best = { x: player.x, y: player.y, kind: 'player' }; }
  }
  // A fast car about to hit them: panic, not just flee.
  for (const car of state.cars || []) {
    if (!car || car.wrecked || Math.abs(car.speed || 0) < 100) continue;
    const dx = ped.x - car.x;
    const dy = ped.y - car.y;
    const d = Math.hypot(dx, dy);
    // Warning radius scales with the car's speed: a car at 300px/s covers
    // 200px in 0.67s, but the coupe does 540px/s and covers it in 0.37s —
    // not enough time for a ped to clear the lane, so a fast car plowed
    // through a group crossing at an intersection and the Heat Wave chase
    // escalated from 3 stars to 5 on two run-overs. The radius is
    // speed * 0.8s of travel (min 200px), so the ped gets ~0.8s to step
    // aside no matter how fast the car is.
    const warnRadius = Math.max(200, Math.abs(car.speed || 0) * 0.8);
    if (d > warnRadius) continue;
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    // Car heading toward the ped? The dot product is +1 when the ped is
    // directly in the car's path, -1 when it is behind the car. This was
    // `< -0.5`, which is backwards: it made peds panic when a fast car was
    // moving AWAY from them and stand still when one bore down on them —
    // which is how a sedan at speed plowed through two peds at an
    // intersection during Mission 1 and came back with two cop cars.
    if ((dx * fx + dy * fy) / d > 0.5) {
      return { x: car.x, y: car.y, kind: 'car', fx, fy };
    }
  }
  return best;
}

// Mark a ped dead through both flags at once; the 6 s timer is counted
// down by updatePeds, which then removes the body.
export function markPedDead(state, ped) {
  ped.dead = true;
  ped.state = 'dead';
  ped.deadTimer = 6;
  ped.speed = 0;
}

function updateOnePed(state, ped, dt) {
  if (ped.dead || ped.state === 'dead') {
    // Normalise: whichever flag combat or a run-over set, both end up set.
    if (!ped.dead) ped.dead = true;
    if (ped.state !== 'dead') ped.state = 'dead';
    ped.deadTimer -= dt;
    ped.speed = 0;
    return;
  }
  if (ped.barkT > 0) ped.barkT -= dt;

  // --- Sense danger first. ---
  const threat = nearestThreat(state, ped);
  if (threat) {
    // A gunshot or explosion nearby makes the ped shout about it (once
    // per cooldown) before it runs — the bark is the city's reaction,
    // and it is also the tell that the player's gunfire was heard.
    if (threat.kind === 'gunfire' || threat.kind === 'explosion') pedBark(state, ped, 'crime');
    ped.state = threat.kind === 'car' ? 'panic' : 'flee';
    ped.fleeTimer = threat.kind === 'car' ? 1.2 : 2.0;
    ped.panicTimer = threat.kind === 'car' ? 1.2 : 0;
    if (threat.kind === 'car' && threat.fx !== undefined) {
      // Run perpendicular to the car's path, to the side we are already
      // on. Running straight away from a faster car just gets run down
      // from behind; a sidestep clears the 26px kill radius in ~0.2s.
      const dx = ped.x - threat.x, dy = ped.y - threat.y;
      const lat = -dx * threat.fy + dy * threat.fx;
      const s = lat >= 0 ? 1 : -1;
      ped.angle = Math.atan2(s * threat.fx, -s * threat.fy);
    } else {
      // Run directly away from the threat.
      ped.angle = Math.atan2(ped.y - threat.y, ped.x - threat.x);
    }
  } else if (ped.fleeTimer > 0) {
    ped.fleeTimer -= dt;
    if (ped.fleeTimer <= 0) ped.state = 'walk';
  }
  if (ped.panicTimer > 0) ped.panicTimer -= dt;

  if (ped.state === 'flee' || ped.state === 'panic') {
    ped.speed = FLEE_SPEED;
    ped.walkPhase += dt * 16;
    ped.x += Math.cos(ped.angle) * ped.speed * dt;
    ped.y += Math.sin(ped.angle) * ped.speed * dt;
    // Fleeing peds stay inside the world and out of the harbor.
    ped.x = Math.max(16, Math.min(3184, ped.x));
    ped.y = Math.max(16, Math.min(2244, ped.y));
    // And out of buildings: a panicking ped that runs through a wall
    // ends up inside it, where a car cannot run it over and the player
    // cannot reach it — and the next threat check sees it through the
    // wall. Push it out to the face; it slides along the block.
    resolveBuildingCollision(state.world, ped, 12);
    return;
  }

  // --- Walking: along the sidewalk, pause at corners. ---
  if (ped.pauseTimer > 0) {
    ped.pauseTimer -= dt;
    ped.speed = 0;
    return;
  }
  // Near an intersection? Sometimes stop and look around.
  const nearCorner = AVENUES.some((ax) => Math.abs(ped.x - ax) < 70) &&
    STREETS.some((sy) => Math.abs(ped.y - sy) < 70);
  if (nearCorner && rngFloat(state) < dt * 0.25) {
    ped.pauseTimer = rand(state, 1, 3);
    ped.speed = 0;
    return;
  }

  ped.speed = ped.cruiseSpeed;
  ped.walkPhase += dt * 8;
  // Look before crossing: if this step would take the ped off the
  // sidewalk and into a road, and a fast car is bearing down on the
  // crossing point, wait on the kerb instead of stepping out. The ped
  // pauses for a beat (pauseTimer 0.4-0.9s) and re-checks next frame;
  // once the car has passed, it crosses. Without this, a ped that steps
  // off the kerb a fraction of a second before a 300px/s car arrives
  // cannot clear the lane in time, and the driver eats a run-over.
  const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
  const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
  if (!isOnRoadPoint(ped.x, ped.y) && isOnRoadPoint(nx, ny) && carBearingDown(state, nx, ny)) {
    ped.pauseTimer = rand(state, 0.4, 0.9);
    ped.speed = 0;
    return;
  }
  ped.x = nx;
  ped.y = ny;

  // Turn around at the sidewalk ends / world edge instead of walking off.
  if (ped.x < 180 || ped.x > 3020 || ped.y < 180 || ped.y > 2220) {
    ped.angle += Math.PI;
    ped.x = Math.max(180, Math.min(3020, ped.x));
    ped.y = Math.max(180, Math.min(2220, ped.y));
  }

  // --- Barks on the walk. ---
  // Near-miss: a fast car passes within 60px without hitting — the ped
  // shouts at it (once per cooldown). This is the "you almost killed
  // me" line, distinct from the panic flee, which already fired above.
  if (ped.barkT <= 0) {
    for (const car of state.cars || []) {
      if (!car || car.wrecked || Math.abs(car.speed || 0) < 200) continue;
      if (Math.hypot(car.x - ped.x, car.y - ped.y) < 60) {
        pedBark(state, ped, 'nearMiss');
        break;
      }
    }
  }
  // Greeting: the player strolls past on foot, no wanted stars, and the
  // ped's kind feels chatty — a rare, quiet line that makes the city
  // feel inhabited instead of decorative. The chance is per second,
  // scaled by the kind's barkChance.
  if (ped.barkT <= 0 && state.player && !state.player.inCar && (state.player.wanted || 0) === 0) {
    const d = Math.hypot(state.player.x - ped.x, state.player.y - ped.y);
    if (d < 80 && rngFloat(state) < dt * barkChanceOf(ped) * 2) {
      pedBark(state, ped, 'greeting');
    }
  }
  // Rain bark: when the rain is falling and the player is near, a ped
  // sometimes complains about it — the city gets wet together, and the
  // complaint is the tell that the weather changed. Same cooldown and
  // chance shape as a greeting, so the rain never shouts over a fight.
  if (ped.barkT <= 0 && state.sky && (state.sky.weather === 'rain' || state.sky.weather === 'storm')) {
    const d = state.player ? Math.hypot(state.player.x - ped.x, state.player.y - ped.y) : 1e9;
    if (d < 160 && rngFloat(state) < dt * barkChanceOf(ped) * 0.5) {
      pedBark(state, ped, 'rain');
    }
  }
  // Wanted bark: the player walks past with the heat on, and a ped
  // who recognises Rook says so — fear, mostly, and the occasional
  // idiot who thinks a wanted man is a celebrity. Only on foot (in a
  // car the player is a car, not a face), and only while wanted.
  if (ped.barkT <= 0 && state.player && !state.player.inCar && (state.player.wanted || 0) > 0) {
    const d = Math.hypot(state.player.x - ped.x, state.player.y - ped.y);
    if (d < 100 && rngFloat(state) < dt * barkChanceOf(ped) * 1.5) {
      pedBark(state, ped, 'wanted');
    }
  }
}

// Run over by the PLAYER's car at speed > 150: the ped falls and stays down.
// AI traffic never kills here (it only scares — see nearestThreat), and the
// crime bump goes through the shared addWanted hook.
function checkRunOver(state, ped) {
  if (ped.dead || ped.state === 'dead') return;
  const player = state.player;
  const car = player && player.inCar;
  if (!car || car.wrecked || Math.abs(car.speed || 0) <= 150) return;
  if (Math.hypot(car.x - ped.x, car.y - ped.y) < 26) {
    markPedDead(state, ped);
    if (typeof state.spawnParticles === 'function') {
      state.spawnParticles(ped.x, ped.y, 'blood', 8);
    }
    // A run-over in traffic is a traffic offence (+1 star), not a murder:
    // peds cross at intersections and a car at speed cannot stop for them,
    // so +2 here meant one accidental bump put two cop cars on the player
    // and the mission sedan died under their rams at the next slow turn.
    // Deliberately shooting a ped dead (combat.js) still costs +2.
    if (typeof state.addWanted === 'function') state.addWanted(state, 1, 'killPed');
    else if (player) player.wanted = Math.max(player.wanted, 1);
  }
}

export function updatePeds(state, dt) {
  if (!Array.isArray(state.peds)) state.peds = [];
  if (dt <= 0) return;
  spawnPeds(state);
  for (let i = state.peds.length - 1; i >= 0; i -= 1) {
    const ped = state.peds[i];
    updateOnePed(state, ped, dt);
    // Bodies lie for 6 s, then the street clears itself.
    if ((ped.dead || ped.state === 'dead') && ped.deadTimer <= 0) {
      state.peds.splice(i, 1);
      continue;
    }
    checkRunOver(state, ped);
  }
}

// --- Crowds ------------------------------------------------------------------
// The city is not uniformly busy: peds cluster at intersections and
// along the avenues. The taxi board prefers offers near crowds (a fare
// comes from where people are), and the HUD can say how busy the
// player's street is. Both read the same count, so the board and the
// HUD never disagree about where the people are.

/** How many living peds are within r px of (x, y). */
export function pedsNear(state, x, y, r) {
  let n = 0;
  for (const ped of state.peds || []) {
    if (ped.dead || ped.state === 'dead') continue;
    if (Math.hypot(ped.x - x, ped.y - y) < r) n += 1;
  }
  return n;
}

/**
 * The busiest spot on the map right now: the ped with the most living
 * neighbours within 200px, or null when the streets are empty. The
 * side-job board offers taxi fares near this spot first — a cab rank
 * forms where the crowd is, not at a random corner.
 */
export function busiestSpot(state) {
  let best = null;
  let bestN = 0;
  for (const ped of state.peds || []) {
    if (ped.dead || ped.state === 'dead') continue;
    const n = pedsNear(state, ped.x, ped.y, 200);
    if (n > bestN) { bestN = n; best = ped; }
  }
  return best ? { x: best.x, y: best.y, count: bestN } : null;
}

/** 'quiet' | 'busy' | 'crowded' for the player's street, for the HUD. */
export function streetBusyness(state) {
  const p = state.player;
  if (!p) return 'quiet';
  const n = pedsNear(state, p.x, p.y, 300);
  if (n >= 6) return 'crowded';
  if (n >= 3) return 'busy';
  return 'quiet';
}

/**
 * How many living peds of each kind are on the streets right now:
 * { commuter: 9, tourist: 4, ... }. The counts are the city's
 * demography in one object — the job board reads the total, the HUD
 * reads the busyness, and a test reads the shape. Dead peds do not
 * count: a body on the pavement is not a pedestrian.
 */
export function pedCountByKind(state) {
  const counts = {};
  for (const ped of state.peds || []) {
    if (ped.dead || ped.state === 'dead') continue;
    const kind = ped.kind || 'commuter';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}
