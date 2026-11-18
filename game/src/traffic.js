// traffic.js — AI traffic cars on the roads of Port Solano.
//
// Road geometry comes from the shared contract (avenues x = 200 + i*400,
// streets y = 200 + j*400, road width 96). Cars are created with
// vehicles.createCar, so a traffic car IS a car in state.cars — state.traffic
// is only the subset of AI-driven cars (references, never copies), which is
// what render.js draws and what car-vs-car collision iterates.
//
// Distances are measured from the CAMERA CENTRE (camera top-left + 640/360):
// the camera is top-left in world coords, so measuring from its corner would
// spawn and despawn cars asymmetrically.
import { createCar } from './vehicles.js';
import { TRAFFIC, VIEW } from './config.js';
import { rngFloat } from './random.js';
import { isFreeRoam, roadLanePoint, trafficFactor } from './world.js';

export const TRAFFIC_TARGET = TRAFFIC.cars;
export const TRAFFIC_SPAWN_MIN_DIST = 600;
export const TRAFFIC_DESPAWN_DIST = 1200;

export const AVENUES = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
export const STREETS = [200, 600, 1000, 1400, 1800, 2200];

// Traffic models only (no police — police cars are police.js). The list
// is weighted by repetition: sedans dominate, the new street fleet
// (sports, muscle, pickup, limo) shows up as the occasional prize —
// a Comet GT in traffic is a steal worth chasing.
const TRAFFIC_MODELS = ['sedan', 'sedan', 'coupe', 'sedan', 'van', 'coupe', 'taxi', 'truck', 'sports', 'muscle', 'pickup', 'sedan', 'taxi', 'limo', 'convertible', 'hatchback', 'sedan'];

// ---------------------------------------------------------------------------
// RNG helpers (rngFloat lives in random.js — the shared one, not a local
// copy: traffic.js used to carry its own, and peds.js another, and the
// three copies had already drifted in which shapes they tolerated).
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

// Nearest point on any road centreline to (x, y), and the distance to it.
export function nearestRoadPoint(x, y) {
  let bestX = AVENUES[0];
  let bestD = Infinity;
  for (const ax of AVENUES) {
    const d = Math.abs(x - ax);
    if (d < bestD) { bestD = d; bestX = ax; }
  }
  let bestY = STREETS[0];
  let bestDy = Infinity;
  for (const sy of STREETS) {
    const d = Math.abs(y - sy);
    if (d < bestDy) { bestDy = d; bestY = sy; }
  }
  // Snap to whichever centreline is closer.
  if (bestD <= bestDy) return { x: bestX, y, dist: bestD, axis: 'v' };
  return { x, y: bestY, dist: bestDy, axis: 'h' };
}

function isNearIntersection(x, y, tol) {
  for (const ax of AVENUES) {
    if (Math.abs(x - ax) > tol) continue;
    for (const sy of STREETS) {
      if (Math.abs(y - sy) <= tol) return true;
    }
  }
  return false;
}

// A random point on a road with a cardinal driving direction.
// {x, y, angle} — angle 0 = east, PI/2 = south, PI = west, -PI/2 = north.
// The lane offset comes from world.roadLanePoint (right-hand lane, 24px
// off the centreline) — this used to hardcode the ±24 offsets itself,
// so a lane-width change had to be made in two places.
export function randomRoadPoint(state) {
  const lane = rngFloat(state) < 0.5 ? 1 : -1;
  if (rngFloat(state) < 0.5) {
    return roadLanePoint(state.world, state.rng || Math.random, 'vertical', lane);
  }
  return roadLanePoint(state.world, state.rng || Math.random, 'horizontal', lane);
}

// ---------------------------------------------------------------------------
// Spawning. A spawned car lands in BOTH state.traffic and state.cars.
// ---------------------------------------------------------------------------

export function spawnTrafficCar(state) {
  if (!Array.isArray(state.traffic)) state.traffic = [];
  if (!Array.isArray(state.cars)) state.cars = [];
  const cam = camCentreOf(state);
  let spot = null;
  for (let tries = 0; tries < 14; tries += 1) {
    const p = randomRoadPoint(state);
    const d = Math.hypot(p.x - cam.x, p.y - cam.y);
    if (d > TRAFFIC_SPAWN_MIN_DIST) { spot = p; break; }
  }
  if (!spot) return null; // camera covers too much road; try again next frame
  const model = pick(state, TRAFFIC_MODELS);
  const car = createCar(model, spot.x, spot.y, spot.angle, { driver: 'ai' });
  car.cruiseSpeed = rand(state, TRAFFIC.cruiseMin, TRAFFIC.cruiseMax);
  car.targetSpeed = car.cruiseSpeed;
  car.cruise = car.cruiseSpeed;
  car.axis = Math.abs(Math.cos(spot.angle)) > 0.5 ? 'h' : 'v';
  car.dir = Math.abs(Math.cos(spot.angle)) > 0.5
    ? Math.sign(Math.cos(spot.angle))
    : Math.sign(Math.sin(spot.angle));
  car._turnCooldown = 0;
  car._stuckTimer = 0;
  state.traffic.push(car);
  state.cars.push(car);
  return car;
}

function removeTrafficCar(state, car) {
  const ti = state.traffic.indexOf(car);
  if (ti >= 0) state.traffic.splice(ti, 1);
  const ci = state.cars.indexOf(car);
  if (ci >= 0) state.cars.splice(ci, 1);
}

// Nearest car (state.cars holds every car) to a point.
export function nearestCar(state, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of state.cars || []) {
    if (!car) continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// AI update
// ---------------------------------------------------------------------------

// Is `other` ahead of `car` (within a forward cone) and closer than `dist`?
function carAhead(car, other, dist) {
  const dx = other.x - car.x;
  const dy = other.y - car.y;
  const d = Math.hypot(dx, dy);
  if (d > dist || d < 1) return false;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  return (dx * fx + dy * fy) / d > 0.82; // ~35-degree cone
}

function updateOneTrafficCar(state, car, dt, others) {
  if (car.wrecked) return;

  // --- Car-following: brake for anything close ahead, including the
  // player's car. Traffic brakes; it never swerves into buildings. ---
  let blockedDist = Infinity;
  for (const other of others) {
    if (other === car || other.wrecked) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const d = Math.hypot(dx, dy);
    if (d < blockedDist && carAhead(car, other, 130)) blockedDist = d;
  }
  if (blockedDist < 55) car.targetSpeed = 0;
  else if (blockedDist < 110) car.targetSpeed = Math.min(car.cruiseSpeed, 70);
  else car.targetSpeed = car.cruiseSpeed;

  // Braking flag for the renderer: a car whose target is below its speed
  // is decelerating, and its brake lights show. Without it a stopped
  // traffic car and a braking one look identical, and the player cannot
  // tell whether the lane ahead is about to move or is jammed.
  car.braking = car.targetSpeed < car.speed - 5;

  // --- Honk: a car that has sat blocked behind something for 2 s honks.
  // It is the only feedback the player gets that the car ahead is the
  // reason the lane is stopped — without it a traffic jam just looks like
  // the cars died. The honk is rate-limited (one per car per 3 s) and
  // only fires when the blocker is actually in the lane ahead, not when
  // the car is stopped at an intersection with nothing in front of it.
  // Audio is optional (audio?.sfx may be a no-op with no AudioContext);
  // the "!" float text is the visible half of the honk.
  if (blockedDist < 55) {
    car._blockedT = (car._blockedT || 0) + dt;
  } else {
    car._blockedT = 0;
  }
  car._honkCd = Math.max(0, (car._honkCd || 0) - dt);
  if (car._blockedT > 2 && car._honkCd <= 0) {
    car._honkCd = 3;
    state.audio?.sfx?.('honk');
    // A "!" above the car is the visible honk.
    if (typeof state.addFloatText === 'function') state.addFloatText(car.x, car.y - 30, '!', '#ffd94d');
  }

  // Ease toward the target speed (brakes harder than it accelerates).
  const rate = car.targetSpeed < car.speed ? 420 : 160;
  if (car.speed < car.targetSpeed) car.speed = Math.min(car.targetSpeed, car.speed + rate * dt);
  else car.speed = Math.max(car.targetSpeed, car.speed - rate * dt);

  // --- Taxis work for a living. A taxi that stops at an intersection
  // sometimes waits there 2-4 s, picking up or dropping off a fare
  // (the "TAXI" float text is the visible half). It is cosmetic — the
  // side-job taxi the player drives is missions.js — but a city where
  // every taxi just cruises looks dead, and the pause is also the
  // tell that lets the player spot a cab worth stealing.
  if (car.model === 'taxi' && car.speed < 5 && isNearIntersection(car.x, car.y, 26)) {
    car._taxiWait = Math.max(0, (car._taxiWait || 0) - dt);
    if ((car._taxiWait || 0) <= 0 && rngFloat(state) < dt * 0.12) {
      car._taxiWait = 2 + rngFloat(state) * 2;
      if (typeof state.addFloatText === 'function') state.addFloatText(car.x, car.y - 30, 'TAXI', '#ffd94d');
    }
    if (car._taxiWait > 0) car.targetSpeed = 0;
  }

  // --- Intersections: occasionally turn onto the crossing road. ---
  car._turnCooldown = (car._turnCooldown || 0) - dt;
  if (car._turnCooldown <= 0 && isNearIntersection(car.x, car.y, 26)) {
    car._turnCooldown = 1.2;
    if (rngFloat(state) < TRAFFIC.turnChance) {
      const near = nearestRoadPoint(car.x, car.y);
      // Turn onto the other axis: pick one of the two directions along it.
      if (near.axis === 'v') car.angle = rngFloat(state) < 0.5 ? 0 : Math.PI;
      else car.angle = rngFloat(state) < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  // --- Stay on the road: if drifted off the centreline (e.g. after a
  // turn), steer toward the nearest road point instead of wandering
  // through blocks. ---
  const near = nearestRoadPoint(car.x, car.y);
  if (near.dist > 46) {
    const want = Math.atan2(near.y - car.y, near.x - car.x);
    let diff = want - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
  }

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  // World edge: U-turn back along the road and clamp inside. The old code
  // WRAPPED the car to the opposite edge (x<150 -> 3050), a 2900px
  // teleport in a single step — visible in front of the player whenever
  // the camera was near that edge, and it broke the "no teleport" rule
  // the traffic system is supposed to keep. A U-turn keeps the car
  // on-road and visible; the despawn in updateTraffic (1200px from the
  // camera centre, i.e. off-screen) plus the top-up spawner handle the
  // population, so no car ever needs to jump across the map.
  if (car.x < 150 || car.x > 3050 || car.y < 150 || car.y > 2250) {
    car.x = Math.min(3050, Math.max(150, car.x));
    car.y = Math.min(2250, Math.max(150, car.y));
    car.angle += Math.PI; // reverse along the road it is on
    car._turnCooldown = 1.2; // do not immediately turn again at the edge
  }
}

export function updateTraffic(state, dt) {
  if (!Array.isArray(state.traffic)) state.traffic = [];
  if (dt <= 0) return;
  const cam = camCentreOf(state);

  // Despawn cars far from the camera (from both lists).
  for (let i = state.traffic.length - 1; i >= 0; i -= 1) {
    const car = state.traffic[i];
    if (Math.hypot(car.x - cam.x, car.y - cam.y) > TRAFFIC_DESPAWN_DIST) {
      removeTrafficCar(state, car);
    }
  }

  // Top up toward the target (a few per frame so a big gap refills fast
  // without a one-frame burst). In rush hour the target is 1.5x — but
  // only in free roam, so a story mission never has its traffic
  // re-rolled mid-chase (a Heat Wave with 21 cars instead of 14 is a
  // different, harder mission than the one that was balanced).
  const target = Math.round(TRAFFIC_TARGET * (isFreeRoam(state) ? trafficFactor(state) : 1));
  let spawned = 0;
  while (state.traffic.length < target && spawned < 3) {
    if (!spawnTrafficCar(state)) break;
    spawned += 1;
  }

  const others = state.cars || [];
  for (const car of state.traffic.slice()) updateOneTrafficCar(state, car, dt, others);
}

// --- Traffic introspection (HUD + tests) -----------------------------------

/** The car count the spawner is aiming at right now. */
export function trafficTarget(state) {
  return Math.round(TRAFFIC_TARGET * (isFreeRoam(state) ? trafficFactor(state) : 1));
}

/** How many taxis are on the road right now. */
export function taxiCount(state) {
  let n = 0;
  for (const car of state.traffic || []) if (car.model === 'taxi') n += 1;
  return n;
}

/** The nearest taxi to (x, y), or null when no cab is on the road. */
export function nearestTaxi(state, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.traffic || []) {
    if (car.model !== 'taxi' || car.wrecked) continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// --- Traffic jams ----------------------------------------------------------
// A jam is a cluster of stopped cars, not one stopped car: five or
// more traffic cars at under 5 px/s within 300 px of each other. The
// HUD (and the side-job board, which prefers a clear road for a fare)
// reads this, so a jam is a fact about the city, not a feeling. A
// single taxi waiting at an intersection is not a jam — it is one car
// doing its job — and a queue behind a waiting taxi IS one, which is
// the point: the jam tells the player the taxi's pause has backed
// the street up.

/** How many traffic cars are stopped (under 5 px/s) right now. */
export function stoppedCount(state) {
  let n = 0;
  for (const car of state.traffic || []) {
    if (!car.wrecked && Math.abs(car.speed || 0) < 5) n += 1;
  }
  return n;
}

/**
 * The worst jam on the map: the stopped car with the most stopped
 * neighbours within 300 px, or null when no cluster of 5 exists.
 * Returns { x, y, count } — the centre of the jam and how many cars
 * are in it — so the HUD can point at it and the job board can avoid
 * offering a fare through it.
 */
export function worstJam(state) {
  let best = null;
  let bestN = 0;
  for (const car of state.traffic || []) {
    if (car.wrecked || Math.abs(car.speed || 0) >= 5) continue;
    let n = 0;
    for (const other of state.traffic || []) {
      if (other.wrecked || Math.abs(other.speed || 0) >= 5) continue;
      if (Math.hypot(other.x - car.x, other.y - car.y) < 300) n += 1;
    }
    if (n > bestN) { bestN = n; best = car; }
  }
  return bestN >= 5 ? { x: best.x, y: best.y, count: bestN } : null;
}

/** True when any jam of 5+ stopped cars exists on the map. */
export function isJammed(state) {
  return worstJam(state) !== null;
}

/**
 * How many traffic cars of each model are on the road right now:
 * { sedan: 6, taxi: 2, ... }. The mix is the answer to "what is the
 * city driving today" — the board reads the taxi count, a test reads
 * the shape, and the player never sees it. Wrecked cars do not count:
 * a wreck is not traffic, it is an obstacle.
 */
export function trafficByModel(state) {
  const counts = {};
  for (const car of state.traffic || []) {
    if (car.wrecked) continue;
    const model = car.model || 'sedan';
    counts[model] = (counts[model] || 0) + 1;
  }
  return counts;
}

/**
 * Spawn one taxi near the camera on purpose (the side-job system uses
 * this to make sure a cab is available when a fare is offered). It is
 * a normal traffic car with the taxi model; the job itself is
 * missions.js — this only guarantees the car exists.
 */
export function spawnTaxiNear(state, x, y) {
  if (!Array.isArray(state.traffic)) state.traffic = [];
  if (!Array.isArray(state.cars)) state.cars = [];
  const spot = randomRoadPoint(state);
  const car = createCar('taxi', spot.x, spot.y, spot.angle, { driver: 'ai' });
  car.cruiseSpeed = rand(state, TRAFFIC.cruiseMin, TRAFFIC.cruiseMax);
  car.targetSpeed = car.cruiseSpeed;
  car.cruise = car.cruiseSpeed;
  car.axis = Math.abs(Math.cos(spot.angle)) > 0.5 ? 'h' : 'v';
  car.dir = Math.abs(Math.cos(spot.angle)) > 0.5
    ? Math.sign(Math.cos(spot.angle))
    : Math.sign(Math.sin(spot.angle));
  car._turnCooldown = 0;
  car._stuckTimer = 0;
  state.traffic.push(car);
  state.cars.push(car);
  return car;
}

// --- Jam detection for the job board ----------------------------------------
// A fare whose pickup sits inside a traffic jam is a fare that will
// fail on the timer: five stopped cars do not move, and the board
// should say so before the player drives across town for it. A jam
// is three or more traffic cars barely moving (under 10 px/s) within
// the radius — the same stopped definition traffic.js already uses
// for its own jam counter, read here as a question about a point
// instead of a statement about the whole city.

/** True when (x, y) sits in a traffic jam (3+ stopped cars nearby). */
export function jammedNear(state, x, y, r = 150) {
  let stopped = 0;
  for (const c of state.traffic || []) {
    if (Math.hypot(c.x - x, c.y - y) > r) continue;
    if (Math.abs(c.speed || 0) < 10) stopped += 1;
    if (stopped >= 3) return true;
  }
  return false;
}
