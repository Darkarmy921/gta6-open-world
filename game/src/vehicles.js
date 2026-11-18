// vehicles.js — car models, creation, player-car driving physics, damage,
// and car-vs-car collision for Port Solano. Vanilla JS + Canvas 2D.
//
// Car shape (the unified contract, from config.js CAR_MODELS):
// { id, model, modelName, color, x, y, angle, speed, maxSpeed, accel, turn,
//   health, maxHealth, driver: 'player'|'ai'|'none', isPolice, siren,
//   wrecked, ramCooldown, hitCooldown } plus traffic fields (cruise,
//   cruiseSpeed, targetSpeed, axis, dir) added by traffic.js and police
//   fields (ramCd, stuckT, leaving) added by police.js. Drawing lives in
//   render.js (drawCar) — this module never draws, so there is exactly one
//   car renderer.
import { CAR_FLAVOUR, CAR_MODELS, WATER, WORLD } from './config.js';
import { buildingHit, gripFactor, resolveBuildingCollision } from './world.js';

export const WATER_Y = WATER.y;
export const WORLD_W = WORLD.width;
export const WORLD_H = WORLD.height;

let nextCarId = 1;

/** Model spec for a config key ('sedan' | 'coupe' | ...); falls back to sedan. */
export function modelSpec(modelKey) {
  return CAR_MODELS[modelKey] || CAR_MODELS.sedan;
}

export function createCar(modelKey, x, y, angle, opts = {}) {
  const spec = modelSpec(modelKey);
  return {
    id: opts.id !== undefined ? opts.id : nextCarId++,
    model: modelKey,
    modelName: opts.modelName || spec.name,
    color: opts.color || '#c94f43',
    x,
    y,
    angle: angle || 0,
    speed: 0,
    maxSpeed: opts.maxSpeed || spec.maxSpeed,
    accel: opts.accel || spec.accel,
    turn: opts.turn || spec.turn,
    health: opts.health !== undefined ? opts.health : spec.health,
    maxHealth: opts.maxHealth !== undefined ? opts.maxHealth : spec.health,
    driver: opts.driver || 'none',
    isPolice: opts.isPolice !== undefined ? opts.isPolice : modelKey === 'police',
    siren: !!opts.siren,
    wrecked: false,
    ramCooldown: 0,
    hitCooldown: 0,
    // traffic.js / police.js fields, defaulted so every car has them:
    cruise: 0,
    cruiseSpeed: 0,
    targetSpeed: 0,
    axis: 'h',
    dir: 1,
    ramCd: 0,
    stuckT: 0,
    leaving: false,
    _smokeTimer: 0,
    _skidTimer: 0,
  };
}

// Arcade driving for the player's car. W/Up accelerate, S/Down brake then
// reverse, A/D steer scaled by speed (reversed when reversing). Drift at
// high speed + hard steering spawns skid particles; health < 40 smokes.
export function updatePlayerCar(state, dt) {
  const player = state.player;
  if (!player || !player.inCar) return;
  const car = player.inCar;
  if (dt <= 0) return;
  if (car.wrecked) {
    car.speed = 0;
    player.x = car.x; player.y = car.y; player.angle = car.angle;
    return;
  }

  const keys = state.keys;
  const has = (code) => keys && typeof keys.has === 'function' && keys.has(code);
  const up = has('KeyW') || has('ArrowUp');
  const down = has('KeyS') || has('ArrowDown');
  const left = has('KeyA') || has('ArrowLeft');
  const right = has('KeyD') || has('ArrowRight');

  // Wet asphalt (world.js gripFactor): rain scales accel, braking and
  // steering by 0.85. The campaign runs dry (weather only changes in
  // free roam), so this never re-tunes a mission — it only makes a rainy
  // free-roam drive feel slippery.
  const grip = gripFactor(state);
  const maxReverse = car.maxSpeed * 0.45;
  if (up) car.speed += car.accel * grip * dt;
  else if (down) {
    if (car.speed > 10) car.speed -= car.accel * 1.6 * grip * dt; // brake
    else car.speed -= car.accel * 0.7 * grip * dt; // reverse
  } else {
    // Rolling drag + engine braking when no pedal is pressed.
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 140 * dt);
  }
  // Braking flag for the renderer: the player is on the brake pedal
  // (S while moving forward) — the car's brake lights show, and a cop
  // behind it sees the same signal a traffic car's lights give.
  car.braking = down && car.speed > 10;
  car.speed = Math.max(-maxReverse, Math.min(car.maxSpeed, car.speed));
  // Skid marks: a hard brake (S at speed > 200) or a sharp turn at
  // speed (> 200 with the wheel hard over) leaves a fading dark streak
  // on the road. The marks are the only record of a near-miss — without
  // them, a 540px/s coupe stopping dead at an intersection looks like
  // it teleported. They live in state.skids (capped, fading over 4s)
  // and are drawn by render.js; they are purely cosmetic, never
  // collidable, and never affect the simulation.
  if ((car.braking && Math.abs(car.speed) > 200) || (Math.abs(car.speed) > 200 && ((right ? 1 : 0) - (left ? 1 : 0)) !== 0)) {
    recordSkid(state, car);
  }

  // Steering: effectiveness grows with speed, capped; flips in reverse.
  // The cap is at 30% of top speed, not 55%: below the cap the turn radius
  // is (maxSpeed * 0.30) / turn, so the coupe turns in 54px instead of
  // 99px — a 99px radius is wider than the 96px road, so the coupe could
  // never make a 90-degree turn at an intersection without swinging onto
  // the sidewalk and into the block, where the cops rammed it to death.
  // Above the cap the radius grows with speed, as it should: you cannot
  // turn sharply at top speed.
  const speedRatio = Math.min(1, Math.abs(car.speed) / (car.maxSpeed * 0.30));
  const steerDir = (right ? 1 : 0) - (left ? 1 : 0);
  const steerSign = car.speed >= 0 ? 1 : -1;
  const turning = steerDir !== 0 && Math.abs(car.speed) > 5;
  if (turning) {
    car.angle += steerDir * car.turn * grip * speedRatio * steerSign * dt;
  }

  // Drift: hard steering near top speed slides the tail and leaves marks.
  const drifting = turning && Math.abs(car.speed) > car.maxSpeed * 0.62;
  if (drifting && typeof state.spawnParticles === 'function') {
    car._skidTimer -= dt;
    if (car._skidTimer <= 0) {
      car._skidTimer = 0.06;
      const bx = car.x - Math.cos(car.angle) * 22;
      const by = car.y - Math.sin(car.angle) * 22;
      state.spawnParticles(bx, by, 'skid', 1);
    }
    if (state.shake !== undefined) state.shake = Math.max(state.shake, 0.4);
  }

  // Move; collide with buildings and the harbour like a solid wall.
  // Axis-separated, like the on-foot code: a car driving diagonally into
  // a wall slides along it instead of stopping dead. A car that only ever
  // stops dead wedges nose-first into a building corner and can never
  // drive out again — the cops then ram a stationary car until it wrecks,
  // which is how a first-mission sedan died against a wall in testing.
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
    // Slide along the wall on whichever axis is clear; only a car blocked
    // on both axes takes the head-on crunch. A sliding car must NOT take
    // crunch damage every step — at 60 steps/s that is ~250 hp/s and the
    // car destroys itself just by scraping along a wall it is sliding past.
    const blockedX = blockedAtPos(nx, car.y);
    const blockedY = blockedAtPos(car.x, ny);
    if (!blockedX) {
      car.x = nx;
      if (Math.abs(car.speed) > 120) damageCar(car, Math.abs(car.speed) * 0.0005, state);
    } else if (!blockedY) {
      car.y = ny;
      if (Math.abs(car.speed) > 120) damageCar(car, Math.abs(car.speed) * 0.0005, state);
    } else {
      // Crunch: stop dead-ish, take a little damage, shake the camera.
      if (Math.abs(car.speed) > 120) {
        damageCar(car, Math.min(18, Math.abs(car.speed) * 0.03), state);
        if (typeof state.spawnParticles === 'function') {
          state.spawnParticles(car.x, car.y, 'hit', 6);
        }
      }
      car.speed *= -0.25;
    }
    if (blockedX || blockedY) car.speed *= Math.exp(-0.7 * dt); // scraping the wall scrubs speed
  }
  // Never leave the car overlapping a building: a car whose circle touches
  // a face and faces along it can otherwise never move away — every
  // candidate position still overlaps the building, so the car wedges
  // against the face until the cops wreck it. Push it out to the face
  // (the minimal axis), and it slides along the wall instead.
  resolveBuildingCollision(state.world, car, radius);

  // Damage smoke while the car is still drivable but hurt.
  if (car.health < 40 && !car.wrecked && typeof state.spawnParticles === 'function') {
    car._smokeTimer -= dt;
    if (car._smokeTimer <= 0) {
      car._smokeTimer = 0.12;
      state.spawnParticles(car.x, car.y, 'smoke', 1);
    }
  }

  // Top speed, for the stats screen: the fastest the player has ever
  // driven this session, in px/s. The stat lives on state.stats (the
  // career record); this is the only place it is written.
  if (state.stats) state.stats.topSpeed = Math.max(state.stats.topSpeed || 0, Math.abs(car.speed));

  // Keep the player glued to the car.
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speed = car.speed;
}

// Skid marks: one per rear wheel, recorded when a car brakes hard or
// turns hard at speed. A mark is { x, y, angle, at } — the wheel's
// position and the car's heading when it was laid. Marks fade over
// SKID_LIFE seconds and are capped at SKID_MAX; older marks are dropped
// first. The array lives on state (state.skids) so a save/load does not
// need to preserve it — it is rebuilt by driving, and a fresh game
// starts with clean roads.
export const SKID_LIFE = 4;
export const SKID_MAX = 200;

export function recordSkid(state, car) {
  if (!state) return;
  if (!Array.isArray(state.skids)) state.skids = [];
  const now = typeof state.time === 'number' ? state.time : 0;
  // One mark per rear wheel, offset perpendicular to the heading.
  const px = Math.cos(car.angle + Math.PI / 2);
  const py = Math.sin(car.angle + Math.PI / 2);
  for (const side of [-1, 1]) {
    state.skids.push({
      x: car.x - Math.cos(car.angle) * 20 + px * 13 * side,
      y: car.y - Math.sin(car.angle) * 20 + py * 13 * side,
      angle: car.angle,
      at: now,
    });
  }
  // Tire smoke: a hard brake also throws a puff of grey 'skid' particles
  // off the rear wheels, so the stop reads as friction, not just as a
  // dark line appearing on the road. The 'skid' kind already existed in
  // effects.js but nothing emitted it on braking — the marks were silent.
  // Throttled to one puff per call (the caller already gates on hard
  // braking / hard turning at speed), so a long skid does not flood the
  // 400-particle cap.
  if (typeof state.spawnParticles === 'function') {
    state.spawnParticles(car.x - Math.cos(car.angle) * 20, car.y - Math.sin(car.angle) * 20, 'skid', 2);
  }
  // Cap: drop the oldest marks first so the array never grows without
  // bound during a long chase.
  while (state.skids.length > SKID_MAX) state.skids.shift();
}

// Drop marks older than SKID_LIFE. Called once per frame from main.js's
// step (after updatePlayerCar), so stale marks never accumulate.
export function pruneSkids(state) {
  if (!Array.isArray(state.skids) || state.skids.length === 0) return;
  const now = typeof state.time === 'number' ? state.time : 0;
  while (state.skids.length > 0 && now - state.skids[0].at > SKID_LIFE) {
    state.skids.shift();
  }
}

// True when a car circle at (x, y) would be inside a building, in the
// harbour water, or outside the world: a position cars must never be
// pushed (or ejected) into.
function blockedAt(state, x, y) {
  if (x < 24 || y < 24 || x > WORLD_W - 24 || y > WORLD_H - 24) return true;
  if (y >= WATER_Y - 12) return true;
  if (state && state.world && buildingHit(state.world, x, y, 24)) return true;
  return false;
}

/**
 * Wrecked cars burn: every frame a wrecked car (health <= 0, still in
 * state.cars) has a chance to throw off smoke and, for the first few
 * seconds after the wreck, flame. This is the visual that tells the
 * player "this car is dead, don't try to enter it" — a wrecked car that
 * just sits there looks drivable. The burn is time-boxed per car
 * (_burnT counts down from 6 s) so an old wreck does not emit forever;
 * the smoke rate is capped by the particle cap in effects.js.
 * Call once per frame from main.js's step (after updatePlayerCar).
 */
export function updateWreckSmoke(state, dt) {
  const cars = state.cars || [];
  for (const car of cars) {
    if (!car.wrecked) continue;
    if (car._burnT === undefined) car._burnT = 6;
    car._burnT -= dt;
    if (car._burnT <= 0) continue;
    // Smoke every frame (a slow leak); flame only while the burn is fresh.
    // Uses the seeded state.rng, not Math.random, so a seeded run is
    // reproducible — the same seed must give the same city and the same
    // wrecks, which the shot scenes rely on.
    const rng = state.rng || Math.random;
    if (state.spawnParticles) {
      state.spawnParticles(car.x, car.y, 'smoke', 1);
      if (car._burnT > 3 && rng() < 0.5) {
        state.spawnParticles(car.x, car.y, 'spark', 2);
      }
    }
  }
}

// Eject the driver beside the wreck on walkable ground: try the two sides,
// then front / back, and fall back to the car centre (never inside a
// building — an eject into a wall soft-locks the player, who cannot walk
// out of a building one 4 px step at a time).
function ejectPlayer(state, car) {
  const player = state.player;
  const r = 34;
  const offsets = [
    { dx: Math.cos(car.angle + Math.PI / 2), dy: Math.sin(car.angle + Math.PI / 2) },
    { dx: Math.cos(car.angle - Math.PI / 2), dy: Math.sin(car.angle - Math.PI / 2) },
    { dx: Math.cos(car.angle), dy: Math.sin(car.angle) },
    { dx: -Math.cos(car.angle), dy: -Math.sin(car.angle) },
  ];
  for (const o of offsets) {
    const px = car.x + o.dx * r;
    const py = car.y + o.dy * r;
    if (!blockedAt(state, px, py)) {
      player.x = px; player.y = py;
      return;
    }
  }
  player.x = car.x; player.y = car.y;
}

// Reduce health; at 0 the car is wrecked: speed 0, driver ejected beside it
// (when `state` is passed so the player reference is available), smoke on.
// Wrecking the PLAYER's car also hurts the player 20 hp through the
// state.damagePlayer hook main.js installs (armor / wasted handling lives
// in police.js damagePlayer). Without `state` it still wrecks the car and
// clears the driver flag.
export function damageCar(car, amt, state = null) {
  if (!car || car.wrecked) return;
  car.health -= amt;
  if (car.health > 0) return;
  car.health = 0;
  car.wrecked = true;
  car.speed = 0;
  car.siren = false;
  car.driver = 'none';
  if (state && state.player && state.player.inCar === car) {
    const player = state.player;
    ejectPlayer(state, car);
    player.speed = 0;
    player.inCar = null;
    if (typeof state.spawnParticles === 'function') {
      state.spawnParticles(car.x, car.y, 'smoke', 8);
      state.spawnParticles(car.x, car.y, 'explosion', 10);
    }
    if (typeof state.damagePlayer === 'function') state.damagePlayer(20);
  }
}

/**
 * Car-vs-car separation + crash damage over every car in state.cars
 * (traffic, parked, police, player). Simple circle separation; damage only
 * on a genuinely hard hit, at most once per car per 0.8 s — otherwise two
 * cars that merely touch grind each other to a wreck. Wrecked cars are
 * solid obstacles but take no further damage here.
 *
 * Separation never pushes a car into a building, the harbour, or off the
 * map: a car whose pushed position would be blocked stays put and the
 * other car takes the full separation instead (when it stays clear). This
 * matters most when a cop car rams the player's car — without it the ram
 * shoves the player into the wall, the wall blocks every escape move, and
 * the next rams destroy a car the player can no longer drive away.
 */
export function resolveCarCollisions(state, dt) {
  const all = state.cars || [];
  for (const car of all) car.hitCooldown = Math.max(0, (car.hitCooldown || 0) - dt);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a.wrecked || b.wrecked) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= 44 || d <= 0.01) continue;
      const ux = dx / d;
      const uy = dy / d;
      // Separation is mass-weighted: the player's car counts 3x a normal
      // car, so a cop car cannot pin it by overlapping it. The old code
      // split the push evenly, and two cop cars overlapping the coupe
      // pushed it back (up to 20px/step) faster than its own drive could
      // advance it, so it sat at speed 0 being rammed to death.
      const total = 44 - d; // full separation needed
      const p = state.player;
      const aMass = (p && p.inCar === a) ? 3 : 1;
      const bMass = (p && p.inCar === b) ? 3 : 1;
      let aPush = total * (bMass / (aMass + bMass));
      let bPush = total * (aMass / (aMass + bMass));
      const aBlocked = blockedAt(state, a.x - ux * aPush, a.y - uy * aPush);
      const bBlocked = blockedAt(state, b.x + ux * bPush, b.y + uy * bPush);
      if (aBlocked) aPush = 0;
      if (bBlocked) bPush = 0;
      // One side pinned: the free car takes the whole separation, but only
      // when the full push also stays clear of walls and water.
      if (aBlocked && !bBlocked
        && !blockedAt(state, b.x + ux * total, b.y + uy * total)) bPush = total;
      if (bBlocked && !aBlocked
        && !blockedAt(state, a.x - ux * total, a.y - uy * total)) aPush = total;
      a.x -= ux * aPush;
      a.y -= uy * aPush;
      b.x += ux * bPush;
      b.y += uy * bPush;
      if (Math.abs(a.speed) + Math.abs(b.speed) > 260 && a.hitCooldown <= 0 && b.hitCooldown <= 0) {
        // A hard hit: damage plus a speed loss. A gentle touch must NOT
        // cost speed — the old code multiplied both speeds by 0.92 on
        // EVERY overlapping step, so a car sandwiched between two cop cars
        // could never accelerate away (0.92^2 per step beats any accel)
        // and sat there being rammed to death.
        a.speed *= 0.92;
        b.speed *= 0.92;
        a.hitCooldown = 0.8;
        b.hitCooldown = 0.8;
        if (typeof state.spawnParticles === 'function') {
          state.spawnParticles((a.x + b.x) / 2, (a.y + b.y) / 2, 'hit', 6);
        }
        // Sparks on a hard hit: metal on metal, bright and brief —
        // the 'hit' particles are the dull thud, the sparks are the
        // flash. Only on a hard hit (the 260 combined-speed gate
        // above), so a gentle touch in traffic stays quiet.
        if (typeof state.spawnSparks === 'function') {
          state.spawnSparks((a.x + b.x) / 2, (a.y + b.y) / 2, 8);
        }
        damageCar(a, 6, state);
        damageCar(b, 6, state);
      }
    }
  }
}

// --- Car identity helpers --------------------------------------------------
// The HUD, the stats screen and the side-job payouts all need the same
// answers about a car (what is it called, what is it worth, how fast),
// and they used to each hardcode their own copy of the model table.

/** Display name: the model's name, or the car's own override. */
export function carDisplayName(car) {
  if (!car) return 'Car';
  return car.modelName || modelSpec(car.model).name;
}

/** Top speed in mph (1 px/s ≈ 0.12 mph at this scale), rounded. */
export function topSpeedMph(car) {
  if (!car) return 0;
  return Math.round((car.maxSpeed || 0) * 0.12);
}

/**
 * What a car is worth on the street — the chop-shop value, in dollars.
 * Priced by speed and toughness: a Comet GT is the prize steal, a
 * Regal Limo is worth more dead than alive. Used by the stats screen
 * ("most valuable car stolen") and by delivery-job damage penalties.
 */
export function carValue(car) {
  if (!car) return 0;
  const spec = modelSpec(car.model);
  const base = { sedan: 400, coupe: 900, taxi: 350, van: 500, truck: 700, police: 0, sports: 2200, muscle: 1400, limo: 1800, pickup: 800 };
  return base[car.model] ?? Math.round(spec.maxSpeed * 1.5 + spec.health * 4);
}

/** True for the two fastest civilian models (sports + coupe). */
export function isFastCar(car) {
  return !!car && (car.model === 'sports' || car.model === 'coupe');
}

/** True for the heavy models that shove traffic aside (mass 3 in collisions). */
export function isHeavyCar(car) {
  return !!car && (car.model === 'muscle' || car.model === 'truck' || car.model === 'limo');
}

/**
 * Park a car of a given model at (x, y) — the city's parked fleet.
 * Parked cars are driver 'none', so the player can steal them; a
 * parked car that is wrecked is skipped by the spawner, not placed.
 */
export function spawnParkedCar(state, modelKey, x, y, angle = 0) {
  if (!state.cars) state.cars = [];
  const car = createCar(modelKey, x, y, angle, { driver: 'none' });
  state.cars.push(car);
  return car;
}

/**
 * The model's one-line flavour for the HUD's car card ("Comet GT —
 * 580 top speed, 70 hp: fast, fragile"). A new model is one row in
 * config.js CAR_MODELS; this line is derived, never hardcoded per model.
 */
export function modelFlavour(modelKey) {
  const spec = modelSpec(modelKey);
  const verdict = spec.maxSpeed >= 540 ? 'fast, fragile'
    : spec.health >= 180 ? 'slow, armored'
    : spec.maxSpeed >= 440 ? 'quick all-rounder'
    : 'steady workhorse';
  return `${spec.name} — top ${Math.round(spec.maxSpeed * 0.12)} mph, ${spec.health} hp: ${verdict}.`;
}

/**
 * The car's condition from its health: Pristine / Good / Battered /
 * Barely running / Wrecked. The HUD car card and the delivery-job
 * damage penalty both read this — a "Barely running" car is a warning
 * to switch before the next fare, not a number to interpret.
 */
export function carCondition(car) {
  if (!car) return '—';
  if (car.wrecked || (car.health || 0) <= 0) return 'Wrecked';
  const frac = (car.health || 0) / (car.maxHealth || 1);
  if (frac >= 0.9) return 'Pristine';
  if (frac >= 0.6) return 'Good';
  if (frac >= 0.35) return 'Battered';
  return 'Barely running';
}

/**
 * The car card for the HUD: { name, condition, value, topSpeed, hp }.
 * One call gives the whole card, so the HUD never re-derives a field
 * from the model table on its own.
 */
export function carCard(car) {
  if (!car) return null;
  return {
    name: carDisplayName(car),
    // The flavour of the model: a Comet GT reads as a prize and a
    // Regal Limo reads as a boat, so the player picks a car by
    // character, not just by the top speed number.
    flavour: CAR_FLAVOUR[car.model] || 'A car. It drives. Mostly.',
    condition: carCondition(car),
    value: carValue(car),
    topSpeed: topSpeedMph(car),
    hp: Math.max(0, Math.round(car.health || 0)),
    maxHp: car.maxHealth || 0,
  };
}

// --- Garage repair ----------------------------------------------------------
// A garage that cannot fix a car is just a parking space. Buying a
// garage throws in a free repair of whatever Rook is driving, and the
// price of a repair anywhere else is a third of the damage in dollars
// — a wrecked Comet GT costs real money to put right, which is why
// the chop shop pays less for a dented one. The repair never exceeds
// the car's max health, and a wrecked car stays wrecked: a garage
// fixes dents, it does not raise the dead.

/** Dollars to repair `car` to full health (0 when already pristine). */
export function repairCost(car) {
  if (!car || car.wrecked || (car.health || 0) <= 0) return 0;
  const max = car.maxHealth || 100;
  const missing = Math.max(0, max - (car.health || 0));
  return Math.round(missing / 3);
}

/**
 * Repair `car` to full health, free of charge (the garage-purchase
 * perk). Returns true when anything was fixed. A wrecked car is
 * untouched — buy a new one instead.
 */
export function repairCar(state, car) {
  if (!car || car.wrecked || (car.health || 0) <= 0) return false;
  const max = car.maxHealth || 100;
  if ((car.health || 0) >= max) return false;
  car.health = max;
  if (state && typeof state.spawnParticles === 'function') {
    state.spawnParticles(car.x, car.y, 'spark', 8);
  }
  return true;
}
