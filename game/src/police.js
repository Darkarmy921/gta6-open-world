// Port Solano — police / wanted system.
//
// Owns player.wanted (0..5) and player.heat (0..100), the police cars in
// state.cops and the foot cops in state.copsFoot. Pure simulation: no drawing
// here except the optional drawPoliceLights helper (the light bar itself is
// drawn by render.js drawCar; this is only the flashing bar for any extra
// overlay the renderer wants).
//
// WANTED MODEL (unified): heat is continuous. addWanted(state, stars) adds
// stars * 20 heat; wanted = floor(heat / 20), capped at 5. Fractional stars
// are allowed, so a single gunshot (+0.6) does not instantly earn a star.
// Heat decays only after the cops have lost sight of the player for 5 s.
//
// MODE RULES: this module never sets state.mode directly, except through the
// bustPending flag main.js converts into the busted screen. damagePlayer
// never changes the mode either — it only drops hp / sets alive = false and
// main.js turns that into the wasted screen. That keeps every screen
// transition in one place (main.js setMode / syncModeOverlay).
//
// Police cars live in BOTH state.cops and state.cars (same objects); a cop
// removed from one list is removed from the other, so the renderer and the
// collision code never see a ghost car.
import { rand, pick } from './random.js';
import { spawnParticles, addShake } from './effects.js';
import { createCar, damageCar } from './vehicles.js';
import { buildingHit, resolveBuildingCollision, roadPointNear as roadPointNearWorld } from './world.js';
import { PLAYER, POLICE_TACTICS, WANTED, WANTED_POSTERS, WATER } from './config.js';

export const WANTED_MAX = WANTED.max;
// Single source of truth: config.js PLAYER.bustTime. This used to be a
// second literal 1.5 here, and the two copies drifted apart in meaning
// (the config comment says "a foot cop must stay touching the player",
// this one said the same thing with a different number once). Re-exported
// so existing importers keep working.
export const BUST_TIME = PLAYER.bustTime;

const WORLD_W = 3200;
const WORLD_H = 2400;
const WATER_Y = WATER.y;
// Road grid from the world contract: avenues x = 200 + i*400, streets y = 200 + j*400.
const AVENUES = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
const STREETS = [200, 600, 1000, 1400, 1800, 2200];

// Stars granted per reason when addWanted is called with a reason and no amount.
const REASON_STARS = { steal: 1, assault: 1, killPed: 2, killCop: 2, heat: 3, shoot: 0.6 };
// Composition / tuning per wanted level (index = stars).
const CARS_FOR_STARS = [0, 1, 2, 3, 4, 5];
const FOOT_FOR_STARS = [0, 1, 1, 0, 0, 0];
const COP_TOP_SPEED = [0, 320, 360, 400, 470, 540];
const COP_ACCEL = [0, 240, 280, 320, 400, 480];
const COP_TURN = [0, 2.4, 2.6, 2.8, 3.1, 3.5];

const LOS_BREAK_DIST = 650; // beyond this no cop has line of sight
const LOS_BREAK_TIME = WANTED.quietSeconds; // seconds unseen before heat starts falling
const RAM_COOLDOWN = 0.9;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function angleLerp(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + clamp(d, -maxStep, maxStep);
}

function ensurePolice(state) {
  if (!state.cops) state.cops = [];
  if (!state.copsFoot) state.copsFoot = [];
  if (!state.cars) state.cars = [];
  if (!state._police) {
    state._police = { losTimer: 0, decayTimer: 0, bustTimer: 0, spawnCd: 0, bustMeter: 0 };
  }
  // Self-wire the shared hooks so other modules can call them even if main.js
  // has not assigned them yet. main.js still sets them before the loop.
  if (!state.addWanted) state.addWanted = (s, amount, reason) => addWanted(s, amount, reason);
  return state._police;
}

/** Remove a cop car from both state.cops and state.cars. */
function removeCopCar(state, car) {
  const ci = state.cops.indexOf(car);
  if (ci >= 0) state.cops.splice(ci, 1);
  const ai = state.cars.indexOf(car);
  if (ai >= 0) state.cars.splice(ai, 1);
}

/** Damage the player, armor absorbing half its value first. Wasted at hp 0. */
export function damagePlayer(state, amount) {
  const p = state.player;
  if (!p || !p.alive) return;
  let remaining = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, remaining * 0.5);
    p.armor -= absorbed;
    remaining -= absorbed;
  }
  p.hp -= remaining;
  addShake(state, 3);
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    state.audio?.sfx?.('fail');
  }
}

/**
 * Raise the wanted level. amount is stars (fractional allowed); when it is
 * not a number the reason table is used (steal/assault +1, killPed/killCop
 * +2). Heat rises by stars * 20; wanted = floor(heat / 20), capped at 5.
 * Suppressed while state.staging is set (?shot= scenes settle crime-free).
 */
export function addWanted(state, amount, reason) {
  const p = state.player;
  if (!p || !p.alive) return;
  if (state.staging) return;
  let stars = amount;
  if (typeof stars !== 'number') stars = REASON_STARS[reason] ?? 1;
  if (stars <= 0) return;
  const before = p.wanted || 0;
  p.heat = clamp((p.heat || 0) + stars * WANTED.heatPerStar, 0, 100);
  p.wanted = clamp(Math.floor(p.heat / WANTED.heatPerStar), 0, WANTED_MAX);
  const pol = ensurePolice(state);
  pol.losTimer = 0;
  pol.decayTimer = 0;
  if (p.wanted > 0 && before === 0) state.audio?.sfx?.('siren');
}

/**
 * Lower the wanted level. The mirror of addWanted: `stars` of heat
 * come off, the star count is recomputed from the heat, and the
 * line-of-sight timers reset so the decay clock starts clean. The
 * bounty turn-in is the only caller (one star per collected head) —
 * nothing else in the city forgives a crime, and a bounty is the one
 * killing the PD is glad happened.
 */
export function clearWanted(state, stars, reason) {
  const p = state.player;
  if (!p || !p.alive) return;
  if (typeof stars !== 'number' || stars <= 0) return;
  p.heat = clamp((p.heat || 0) - stars * WANTED.heatPerStar, 0, 100);
  p.wanted = clamp(Math.floor(p.heat / WANTED.heatPerStar), 0, WANTED_MAX);
  const pol = ensurePolice(state);
  pol.losTimer = 0;
  pol.decayTimer = 0;
  void reason;
}

/** Distance to the nearest cop (car or foot), Infinity when none. */
export function nearestCopDist(state) {
  const p = state.player;
  if (!p) return Infinity;
  let best = Infinity;
  for (const c of state.cops || []) {
    best = Math.min(best, Math.hypot(c.x - p.x, c.y - p.y));
  }
  for (const c of state.copsFoot || []) {
    best = Math.min(best, Math.hypot(c.x - p.x, c.y - p.y));
  }
  return best;
}

// Pick a point on a road roughly minDist..maxDist away from the player.
// The shared roadPointNear in world.js (it used to be a local copy here
// with its own avenue/street tables — the world's road lists are the
// authority now, so a road added to the world is automatically a spawn
// road for the police).
function roadPointNear(state, minDist, maxDist) {
  const p = state.player;
  return roadPointNearWorld(state.world, state.rng || Math.random, p.x, p.y, minDist, maxDist);
}

function spawnCopCar(state) {
  // Spawn at 550-950px: close enough to arrive in waves, far enough not
  // to appear on top of the player. (A 700-1100px spawn was tried to help
  // Heat Wave's "lose the tail" — it made M2/M3 worse, because the cops
  // arrived later but from farther out and the chase felt empty, while
  // the tail still could not be lost. The no-reinforcement rule in
  // updatePolice is what fixes the tail, not the spawn distance.)
  const pt = roadPointNear(state, 550, 950);
  const p = state.player;
  // Never spawn in the player's path: a cop appearing head-on in front of
  // a car accelerating from a standstill is a collision the player cannot
  // avoid — the coupe's accel (330) is barely above a 2-star cop's (280),
  // so the coupe drives straight into it before it gets up to speed, and
  // the second cop then sandwiches the pinned car. Reflect an ahead-spawn
  // through the player so the cop comes up from behind instead.
  const fwd = p.inCar || p;
  const fx = Math.cos(fwd.angle || 0), fy = Math.sin(fwd.angle || 0);
  const ox = pt.x - p.x, oy = pt.y - p.y;
  const d = Math.hypot(ox, oy) || 1;
  if ((ox * fx + oy * fy) / d > 0.3) {
    pt.x = clamp(p.x - ox, 40, WORLD_W - 40);
    pt.y = clamp(p.y - oy, 40, WORLD_H - 40);
  }
  const stars = clamp(p.wanted, 1, WANTED_MAX);
  const car = createCar('police', pt.x, pt.y, Math.atan2(p.y - pt.y, p.x - pt.x), {
    driver: 'ai',
    siren: true,
  });
  car.maxSpeed = COP_TOP_SPEED[stars];
  car.accel = COP_ACCEL[stars];
  state.cops.push(car);
  state.cars.push(car);
  return car;
}

function spawnFootCop(state) {
  const pt = roadPointNear(state, 250, 450);
  const p = state.player;
  const cop = {
    x: pt.x,
    y: pt.y,
    angle: Math.atan2(p.y - pt.y, p.x - pt.x),
    hp: 100,
    dead: false,
    bustT: 0,
  };
  state.copsFoot.push(cop);
  return cop;
}

function explodeCopCar(state, car) {
  spawnParticles(state, car.x, car.y, 'explosion', 26);
  spawnParticles(state, car.x, car.y, 'smoke', 12);
  addShake(state, 8);
  state.audio?.sfx?.('explosion');
}

// One police car chasing the player. Ramming hurts the player (on foot) or
// their car; at 5 stars the car is faster and rams harder / more often.
function updateCopCar(state, car, dt) {
  const p = state.player;
  const stars = clamp(p.wanted, 1, WANTED_MAX);
  car.maxSpeed = COP_TOP_SPEED[stars];
  car.accel = COP_ACCEL[stars];
  if (car.ramCd > 0) car.ramCd -= dt;

  const dx = p.x - car.x;
  const dy = p.y - car.y;
  const dist = Math.hypot(dx, dy) || 1;

  // Roadblock: parked across the road until the player comes close.
  // The car does not move, does not steer, does not ram — it IS the
  // wall. Inside 300px the trap is sprung and it joins the chase.
  if (car.roadblock && !car.leaving) {
    if (dist < 300) {
      car.roadblock = false;
    } else {
      car.speed = 0;
      return;
    }
  }

  if (car.leaving) {
    // Driving off: away from the player, removed once far enough.
    const away = Math.atan2(car.y - p.y, car.x - p.x);
    car.angle = angleLerp(car.angle, away, COP_TURN[stars] * dt);
    car.speed = Math.min(car.speed + car.accel * dt, car.maxSpeed * 0.8);
  } else {
    // Pincer: aim for where the player WILL be (position + velocity x
    // 1.5 s), not where they are — the cop cuts the corner instead of
    // following the tail. Only the designated pincer car does this.
    let tx = p.x;
    let ty = p.y;
    if (car.pincer) {
      const v = p.inCar ? p.inCar.speed : (p.speed || 0);
      tx += Math.cos(p.angle || 0) * v * POLICE_TACTICS.pincerLead;
      ty += Math.sin(p.angle || 0) * v * POLICE_TACTICS.pincerLead;
    }
    const want = Math.atan2(ty - car.y, tx - car.x);
    car.angle = angleLerp(car.angle, want, COP_TURN[stars] * dt);
    // 5 stars: aggressive — full throttle even up close so the ram lands.
    const target = stars >= 5 ? car.maxSpeed : dist < 70 ? car.maxSpeed * 0.55 : car.maxSpeed;
    car.speed = Math.min(car.speed + car.accel * dt, target);
    // Stuck (wedged on a building / corner): respawn near the player.
    // The threshold is 1.5 s, not 2.5: with building collision a cop can
    // wedge on a corner while the player sits on the other side of the
    // block, and a 2.5 s wait plus a 550-900px respawn meant the
    // unattended chase (SH5) never reached a stationary player in 25 s.
    // The respawn is closer now (300-600px, on a road) so the cop
    // re-acquires quickly instead of spending the chase driving back.
    if (car.speed < 25 && dist > 120) {
      car.stuckT += dt;
      if (car.stuckT > 1.5) {
        const pt = roadPointNear(state, 300, 600);
        car.x = pt.x;
        car.y = pt.y;
        car.angle = Math.atan2(p.y - pt.y, p.x - pt.x);
        car.speed = 0;
        car.stuckT = 0;
      }
    } else {
      car.stuckT = 0;
    }
  }

  // Move — with building collision, axis-separated like the player's car.
  // Cop cars used to drive straight through buildings (no collision at
  // all), so they cut the diagonal across a block while the player had to
  // follow the road and slow for the turn — they intercepted the player
  // at every corner, and the Heat Wave coupe (80 hp) died under their
  // rams in ~5 s. A cop that has to go around the block like the player
  // is still fast (it steers toward the player and re-acquires after the
  // slide), but it cannot teleport through a wall to cut the corner.
  // The slide also means a cop that does wedge on a corner slows down
  // (speed scrubbed), which is what the stuck detector below then sees.
  const radius = 24;
  const blockedAtPos = (x, y) => x < radius || y < radius || x > WORLD_W - radius || y > WORLD_H - radius
    || y >= WATER_Y - radius * 0.5
    || buildingHit(state.world, x, y, radius);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (!blockedAtPos(nx, ny)) {
    car.x = nx;
    car.y = ny;
  } else {
    const blockedX = blockedAtPos(nx, car.y);
    const blockedY = blockedAtPos(car.x, ny);
    if (!blockedX) car.x = nx;
    else if (!blockedY) car.y = ny;
    else car.speed *= 0.5; // fully blocked: scrub speed so stuckT can fire
    car.speed *= Math.exp(-0.7 * dt);
  }
  resolveBuildingCollision(state.world, car, radius);
  car.x = clamp(car.x, 20, WORLD_W - 20);
  car.y = clamp(car.y, 20, WORLD_H - 20);

  // Ram: contact with the player or the player's car.
  if (!car.leaving && dist < 52 && car.ramCd <= 0) {
    car.ramCd = RAM_COOLDOWN * (stars >= 5 ? 0.7 : 1);
    if (p.inCar) {
      damageCar(p.inCar, stars >= 4 ? 14 : 10, state);
      car.health -= 4;
      // Recoil: the ram knocks the cop back off the player's car (speed
      // cut and a shove away), so it cannot sit in contact ramming every
      // 0.9s while the player's car is pinned at speed 0. Without this,
      // two cop cars sandwich the coupe from a standstill and it never
      // gets up to speed — the chase is over before it starts.
      car.speed *= 0.3;
      car.x -= (dx / dist) * 30;
      car.y -= (dy / dist) * 30;
      spawnParticles(state, p.x, p.y, 'spark', 10);
      addShake(state, 6);
      state.audio?.sfx?.('hit');
    } else {
      // On foot, a cop car slows to a crawl beside the player and nudges
      // them (10px, not 26): the old 26px shove broke the 46px bust
      // contact on every ram — the meter built to 0.45, the shove pushed
      // the player out of range, it drained to 0, and the unattended
      // chase (SH5) never ended busted in 25 s. But stopping the cop
      // dead (speed 0, no shove) made the bust too effective: a single
      // touch cuffed an ejected M2 driver in 1.5 s with no chance to run.
      // A 10px nudge keeps the car in bust contact (it was at ~40px, so
      // it stays under 46px) while the cop's halved speed lets a
      // sprinting player (350px/s) break away — the bust is earned by
      // sustained contact, not by one touch.
      car.speed *= 0.5;
      p.x += (dx / dist) * 10;
      p.y += (dy / dist) * 10;
      spawnParticles(state, p.x, p.y, 'spark', 8);
      state.audio?.sfx?.('hit');
    }
  }
}

// One foot cop: chases on foot, and busts the player after BUST_TIME of contact.
function updateFootCop(state, cop, dt) {
  const p = state.player;
  const dx = p.x - cop.x;
  const dy = p.y - cop.y;
  const dist = Math.hypot(dx, dy) || 1;
  cop.angle = Math.atan2(dy, dx);
  const speed = 150;
  if (dist > 24) {
    cop.x += (dx / dist) * speed * dt;
    cop.y += (dy / dist) * speed * dt;
    // Foot cops chase in a straight line and would walk through a block
    // to reach the player — then they stand inside a building, unreachable
    // and unshootable, while the bust meter keeps ticking. Push them out
    // to the face so they run around the block instead.
    resolveBuildingCollision(state.world, cop, 12);
  }
  if (dist < 26 && !p.inCar) {
    cop.bustT += dt;
    if (cop.bustT >= BUST_TIME) {
      p.wanted = 0;
      p.heat = 0;
      for (const car of state.cops.slice()) removeCopCar(state, car);
      state.copsFoot.length = 0;
      state.bustPending = true; // main.js turns this into the busted screen
      state.audio?.sfx?.('busted');
      state.audio?.setSiren?.(null);
    }
  } else {
    cop.bustT = 0;
  }
}

// --- Police tactics: roadblocks + pincer ---------------------------------
// At 5 stars the PD stops chasing from behind only. A roadblock is two
// cars parked across the road ahead of the player — but only while the
// player is crawling (under POLICE_TACTICS.roadblockMaxSpeed): a
// roadblock across a flat-out getaway would be a wall the player cannot
// see coming, and the escape missions would be re-rolled by it. The
// block sits until the player comes within 300px, then the cars join
// the chase like any other cop. When the heat drops below 5 stars the
// block stands down (leaving = true, they drive off).

function updateRoadblocks(state, dt) {
  const pol = ensurePolice(state);
  const p = state.player;
  if (!p || !p.alive) return;
  // Free roam only: a roadblock is the city's answer to a rampage, not
  // a scripted mission's pressure. During a story mission the wanted
  // level is the mission's own dial (M4's survive phase already runs
  // at 3 stars with the coupe crawling through corners) — a roadblock
  // spawning across the escape route would be a second mission the
  // player never signed up for, and it makes the scripted survival
  // unwinnable at the hp the mission leaves you with.
  if (state.mission && state.mission.active) {
    for (const car of state.cops.filter((c) => c.roadblock)) car.leaving = true;
    return;
  }
  pol.roadblockCd = Math.max(0, (pol.roadblockCd || 0) - dt);
  const wanted = clamp(p.wanted || 0, 0, WANTED_MAX);
  const blocks = state.cops.filter((c) => c.roadblock);
  if (wanted < POLICE_TACTICS.roadblockStars) {
    for (const car of blocks) car.leaving = true;
    return;
  }
  if (blocks.length > 0) return;
  if (pol.roadblockCd > 0) return;
  if (!p.inCar) return;
  if (Math.abs(p.inCar.speed || 0) > POLICE_TACTICS.roadblockMaxSpeed) return;
  // Park across the road ahead: 600px along the player's heading, one
  // car in each lane (perpendicular offset ±30px), noses across the road.
  const ahead = POLICE_TACTICS.roadblockAhead;
  const hx = Math.cos(p.angle || 0);
  const hy = Math.sin(p.angle || 0);
  const px = -hy;
  const py = hx;
  for (let i = 0; i < POLICE_TACTICS.roadblockCars; i += 1) {
    const side = i === 0 ? -30 : 30;
    const car = createCar('police', p.x + hx * ahead + px * side, p.y + hy * ahead + py * side,
      Math.atan2(hy, hx) + Math.PI / 2, { driver: 'ai', siren: true });
    car.roadblock = true;
    car.maxSpeed = COP_TOP_SPEED[5];
    car.accel = COP_ACCEL[5];
    state.cops.push(car);
    state.cars.push(car);
  }
  pol.roadblockCd = 20;
  state.audio?.sfx?.('siren');
}

/**
 * The pincer: at 5 stars the farthest cop (over 800px away) stops
 * chasing the player's tail and drives for where the player WILL be
 * (position + velocity x 1.5 s), to cut them off head-on. Only one cop
 * pincers at a time, and only a far one — a near cop pincering would
 * turn every chase into a head-on collision the player cannot dodge.
 */
function updatePincer(state) {
  const p = state.player;
  if (!p) return;
  // Free roam only — same reason as the roadblock: a story mission's
  // wanted level is the mission's own dial, and a pincer cutting the
  // player off head-on during a scripted survival is a second mission
  // the player never signed up for.
  if (state.mission && state.mission.active) {
    for (const car of state.cops) car.pincer = false;
    return;
  }
  const wanted = clamp(p.wanted || 0, 0, WANTED_MAX);
  let best = null;
  let bestD = POLICE_TACTICS.pincerMinDist;
  if (wanted >= POLICE_TACTICS.pincerStars) {
    for (const car of state.cops) {
      if (car.roadblock || car.leaving || car.wrecked) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d > bestD) { bestD = d; best = car; }
    }
  }
  for (const car of state.cops) car.pincer = car === best;
}

/** The current police tactic, for the HUD ("Roadblock ahead", "Cutting you off"). */
export function copTactic(state) {
  const p = state.player;
  if (!p) return null;
  if ((state.cops || []).some((c) => c.roadblock)) return 'roadblock';
  if ((state.cops || []).some((c) => c.pincer)) return 'pincer';
  if ((p.wanted || 0) >= 3) return 'chase';
  if ((p.wanted || 0) > 0) return 'pursuit';
  return null;
}

/** How many roadblock cars are currently set up. */
export function roadblockCount(state) {
  return (state.cops || []).filter((c) => c.roadblock).length;
}

// --- Wanted names ----------------------------------------------------------
// What the city calls each wanted level. The stars are the number; the
// name is the meaning — one star is a patrol car that saw something,
// five stars is the whole department plus the roadblocks. The HUD
// shows the name under the stars so a new player learns what the
// stars mean without reading a manual.
const WANTED_NAMES = [
  'Clean', 'Patrol', 'Pursuit', 'Manhunt', 'Lockdown', 'Army',
];

/** The name of a wanted level (0–5 stars). */
export function wantedName(stars) {
  const n = Math.max(0, Math.min(5, Math.floor(stars || 0)));
  return WANTED_NAMES[n];
}

/**
 * Seconds until the heat is clean, from right now: the time left
 * until the cops have lost sight for 5 s (LOS_BREAK_TIME), plus the
 * heat divided by the decay rate. While the cops can still see the
 * player the clock has not started — the 5 s is the whole game, and
 * the heat is the rest. The HUD shows this while LOSING THEM…, so
 * the player knows whether to keep running or to hide for a moment.
 */
export function secondsToClean(state) {
  const p = state && state.player;
  if (!p) return 0;
  const heat = p.heat || 0;
  if (heat <= 0) return 0;
  const pol = state._police || {};
  const los = pol.losTimer || 0;
  const unseenLeft = Math.max(0, LOS_BREAK_TIME - los);
  return Math.ceil(unseenLeft + heat / WANTED.decay);
}
export function heatLabel(state) {
  const p = state && state.player;
  if (!p) return 'CLEAN';
  const wanted = p.wanted || 0;
  if (wanted <= 0) {
    const heat = p.heat || 0;
    if (heat > 0) return 'LOSING THEM…';
    return 'CLEAN';
  }
  return wantedName(wanted).toUpperCase();
}

export function updatePolice(state, dt) {
  const pol = ensurePolice(state);
  const p = state.player;
  if (!p) return;
  // Frozen scenes: no chasing, siren off. (Title / pause / game-over / the
  // mission-complete hold all freeze the chase; only 'playing' hunts.)
  if (state.mode && state.mode !== 'playing') {
    state.audio?.setSiren?.(null);
    return;
  }
  if (!p.alive) {
    state.audio?.setSiren?.(null);
    return;
  }

  const wanted = clamp(p.wanted || 0, 0, WANTED_MAX);

  // Maintain the roster: spawn one car at a time so they arrive in waves.
  // Except during Heat Wave stage 1 ("lose the tail"): no reinforcements.
  // The stage completes when the player breaks sight and the heat decays,
  // but a fresh cop spawning 700px away drives straight into sight range
  // and resets the 5 s out-of-sight timer — so the tail could never be
  // lost while the roster kept refilling. The cops already on the scene
  // keep chasing (and leave when the wanted drops); the player outruns
  // them (coupe 540 vs cop 400) to break sight.
  const losingTail = state.mission?.active && state.mission.index === 3 && state.mission.stage === 1;
  pol.spawnCd -= dt;
  const wantCars = CARS_FOR_STARS[wanted];
  const wantFoot = FOOT_FOR_STARS[wanted];
  if (!losingTail && state.cops.length < wantCars && pol.spawnCd <= 0) {
    spawnCopCar(state);
    pol.spawnCd = 0.8;
  }
  if (!losingTail && state.copsFoot.filter((c) => !c.dead).length < wantFoot && pol.spawnCd <= 0) {
    spawnFootCop(state);
    pol.spawnCd = 0.8;
  }
  // Surplus cars (wanted just dropped) drive off instead of vanishing.
  // Roadblock cars are not part of the chase roster: they are managed
  // by updateRoadblocks, so the surplus sort skips them (otherwise the
  // roadblock would be marked "leaving" the moment it was set up).
  if (state.cops.length > wantCars) {
    const chase = state.cops.filter((c) => !c.roadblock);
    if (chase.length > wantCars) {
      const sorted = [...chase].sort(
        (a, b) => Math.hypot(b.x - p.x, b.y - p.y) - Math.hypot(a.x - p.x, a.y - p.y),
      );
      for (let i = 0; i < chase.length - wantCars; i++) sorted[i].leaving = true;
    }
  }
  updateRoadblocks(state, dt);
  updatePincer(state);
  if (wanted === 0 || wanted > 2) {
    // Foot cops only work the low-heat beat; otherwise they stand down.
    state.copsFoot.length = 0;
    pol.bustTimer = 0;
  }

  // Chase / ram / bust.
  for (let i = state.cops.length - 1; i >= 0; i--) {
    const car = state.cops[i];
    if (car.wrecked || car.health <= 0) {
      explodeCopCar(state, car);
      removeCopCar(state, car);
      continue;
    }
    updateCopCar(state, car, dt);
    if (car.leaving && Math.hypot(car.x - p.x, car.y - p.y) > 1100) {
      removeCopCar(state, car);
    }
  }
  for (let i = state.copsFoot.length - 1; i >= 0; i--) {
    const cop = state.copsFoot[i];
    if (cop.dead || cop.hp <= 0) {
      state.copsFoot.splice(i, 1);
      continue;
    }
    updateFootCop(state, cop, dt);
    if (state.bustPending) return;
  }

  // On-foot bust by the car swarm: cop cars touching a player on foot build
  // the shared bust meter (1.5 s of contact cuffs them); it drains when the
  // player breaks away. This is what busts a player whose car was wrecked
  // at 3+ stars, where no foot cop spawns.
  if (!p.inCar && p.alive) {
    const contact = state.cops.some(
      (c) => !c.leaving && !c.wrecked && Math.hypot(c.x - p.x, c.y - p.y) < 46,
    );
    pol.bustMeter = clamp((pol.bustMeter || 0) + (contact ? dt / BUST_TIME : -dt * 0.25), 0, 1);
    if (pol.bustMeter >= 1) {
      p.wanted = 0;
      p.heat = 0;
      for (const car of state.cops.slice()) removeCopCar(state, car);
      state.copsFoot.length = 0;
      state.bustPending = true;
      state.audio?.sfx?.('busted');
      state.audio?.setSiren?.(null);
      return;
    }
  } else {
    pol.bustMeter = 0;
  }

  // Bust meter for the HUD: furthest along of foot-cop contact / car swarm.
  let footBust = 0;
  for (const cop of state.copsFoot) footBust = Math.max(footBust, (cop.bustT || 0) / BUST_TIME);
  state.bustProgress = Math.max(footBust, pol.bustMeter || 0);

  // Line of sight + decay: heat falls after 5 s unseen (~1 star per 3.3 s).
  if (wanted > 0) {
    const near = nearestCopDist(state);
    if (near > LOS_BREAK_DIST) pol.losTimer += dt;
    else pol.losTimer = 0;
    if (pol.losTimer >= LOS_BREAK_TIME) {
      p.heat = Math.max(0, (p.heat || 0) - WANTED.decay * dt);
      p.wanted = clamp(Math.floor(p.heat / WANTED.heatPerStar), 0, WANTED_MAX);
      if (p.wanted === 0) {
        p.heat = 0;
        pol.losTimer = 0;
        // Escaped: the heat hit zero after the player was wanted. This
        // branch only runs while `wanted` (captured at the top of the
        // frame) was above zero, so it fires exactly once per escape —
        // a bust clears wanted on a different path and never counts.
        if (state.stats) state.stats.arrestsEscaped = (state.stats.arrestsEscaped || 0) + 1;
      }
    }
    state.audio?.setSiren?.(near);
  } else {
    state.audio?.setSiren?.(null);
  }
}

/**
 * Flashing light bar above a police car. The caller must already be in screen
 * space (world -> screen applied by the renderer); x/y is the car centre.
 */
export function drawPoliceLights(ctx, x, y, time) {
  const phase = Math.floor(time * 6) % 2 === 0;
  ctx.save();
  ctx.fillStyle = phase ? '#ff2d2d' : '#7a1010';
  ctx.fillRect(x - 11, y - 6, 10, 4);
  ctx.fillStyle = phase ? '#1010c8' : '#3a6bff';
  ctx.fillRect(x + 1, y - 6, 10, 4);
  ctx.restore();
}

// What the wanted poster says at the current star level: the heat
// bar shows the number, the poster is the city's voice — one star is
// a patrol car that saw something, five stars is the whole department
// plus the roadblocks, and the poster is what the corner stores read.
export function wantedPoster(state) {
  const wanted = Math.max(0, Math.min(5, state.player?.wanted || 0));
  return WANTED_POSTERS[wanted] || WANTED_POSTERS[0];
}
