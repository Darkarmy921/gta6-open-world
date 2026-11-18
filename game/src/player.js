// player.js — on-foot movement + car enter/exit for Port Solano.
//
// The player shape (unified contract):
// { x, y, angle, speed, hp, armor, money, weapon, ammo, inCar, wanted,
//   heat, alive, walkPhase } — created by main.js, updated here.
//
// OWNERSHIP: this module moves the player on foot and enters / exits cars,
// but it does NOT read the E key. main.js owns E (see input.js): one press
// is offered to missions.tryInteract() first, and only then to enterCar /
// exitCar here, so a press can never do two things at once. Driving physics
// live in vehicles.js (updatePlayerCar); shooting lives in combat.js.
import { ACHIEVEMENTS, PLAYER, REP_TITLES, ROAD, WORLD } from './config.js';
import { buildingHit, isInWater } from './world.js';
import { mouseAngleFrom } from './input.js';
import { addFloatText, spawnParticles } from './effects.js';

export const WORLD_W = WORLD.width;
export const WORLD_H = WORLD.height;
export const WATER_Y = ROAD.landEdgeY;
export const WALK_SPEED = PLAYER.walkSpeed;
export const SPRINT_SPEED = PLAYER.runSpeed;
export const PLAYER_RADIUS = PLAYER.radius;
export const ENTER_DIST = 70;

// True when the circle at (x, y) with radius r overlaps any building.
// Accepts world.js buildings {x, y, w, h} (w/h = footprint).
export function collidesBuilding(world, x, y, r) {
  return !!buildingHit(world, x, y, r);
}

// Harbor water: y >= 2260 (world.water rect honoured when present).
export function isInWaterAt(world, x, y) {
  return isInWater(world, x, y);
}

// True when (x, y, r) is a legal on-foot position: inside the world, out of
// buildings and out of the water.
export function isWalkable(world, x, y, r) {
  if (x < r || y < r || x > WORLD_W - r || y > WORLD_H - r) return false;
  if (isInWater(world, x, y)) return false;
  if (buildingHit(world, x, y, r)) return false;
  return true;
}

export function createPlayer(x, y) {
  return {
    x, y,
    angle: -Math.PI / 2, // facing up (north) by default
    speed: 0,
    hp: PLAYER.maxHp,
    armor: 0,
    money: 250,
    weapon: 'pistol',
    ammo: 12,
    inCar: null,
    wanted: 0,
    heat: 0,
    alive: true,
    walkPhase: 0,
    // Sprint stamina (0..100): sprinting drains it, walking / standing
    // regens it. It exists so the on-foot chases are fair both ways — the
    // player gets burst speed to break a foot cop's 1.5s bust, but cannot
    // sprint forever, and a foot cop (150px/s) can close on a walking
    // player (230px/s is still faster, so walking away still works).
    stamina: 100,
    staminaLocked: false,
  };
}

// Read movement input from state.keys (a Set of KeyboardEvent.code strings).
function readMoveKeys(state) {
  const keys = state.keys;
  let mx = 0;
  let my = 0;
  if (keys && typeof keys.has === 'function') {
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    return {
      mx, my,
      sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    };
  }
  return { mx: 0, my: 0, sprint: false };
}

// Nearest enterable car in state.cars (the ONE car list; traffic and police
// cars are already in it, so there is no second list to check).
function nearestCarIn(state, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  const list = state.cars || [];
  for (const car of list) {
    if (!car || car.wrecked || car.health <= 0) continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// Eject the current driver of `car` as a pedestrian standing beside it.
// Stealing a driven car is a crime (+1 star via state.addWanted); taking a
// parked car (driver 'none') is free. Delia's mission sedan is parked, so
// starting Mission 1 never raises the heat.
export function enterCar(state, car) {
  const player = state.player;
  if (!player || !car || player.inCar) return false;
  if (car.wrecked || car.health <= 0) return false;

  if (car.driver === 'ai' || car.driver === 'ped') {
    // Ejected driver becomes a pedestrian. Shape matches peds.js.
    if (Array.isArray(state.peds)) {
      const rng = state.rng || Math.random;
      const side = rng() < 0.5 ? -1 : 1;
      const px = car.x + Math.cos(car.angle + Math.PI / 2) * side * 30;
      const py = car.y + Math.sin(car.angle + Math.PI / 2) * side * 30;
      state.peds.push({
        x: px, y: py, angle: car.angle, speed: 0,
        state: 'flee', color: '#7d3c98',
        hp: 100, walkPhase: rng() * 6, fleeTimer: 2.5, deadTimer: 0,
        cruiseSpeed: 60 + rng() * 30, pauseTimer: 0, panicTimer: 0,
        dead: false,
      });
    }
    if (typeof state.addWanted === 'function') state.addWanted(state, 1, 'steal');
    else player.wanted = Math.max(player.wanted, 1);
  }

  const prevDriver = car.driver;
  car.driver = 'player';
  player.inCar = car;
  // A steal, for the stats screen: a parked civilian car taken by the
  // player. Mission cars (id 'mission-…') are Delia's handovers, not
  // thefts, and police cars are their own crime (already +1 star above).
  // A driven car (ai/ped) is a carjacking, not a steal — it is counted
  // by the wanted system, not here.
  if (state.stats && prevDriver === 'none') {
    const isMissionCar = typeof car.id === 'string' && car.id.startsWith('mission-');
    if (!isMissionCar && !car.isPolice) {
      state.stats.carsStolen = (state.stats.carsStolen || 0) + 1;
    }
  }
  // The car leaves AI traffic: updateTraffic runs after updatePlayerCar
  // in main.js's step, and it brakes a traffic car toward its target
  // speed and steers it toward the road. A car the player is driving
  // that is still in state.traffic gets braked to 0 whenever another car
  // is ahead of it — the player's W does nothing, the car sits at speed
  // 0 while a passing car shoves it sideways, and the driver cannot turn
  // out of it. The M3 motel leg sat at speed 0 for 180 s this way (the
  // harness spawned the diner sedan into state.traffic). The car stays
  // in state.cars (it is still a car); it is just no longer AI-driven.
  // On exit it stays out of traffic too — an abandoned car is parked,
  // it does not drive itself away.
  if (Array.isArray(state.traffic)) {
    const i = state.traffic.indexOf(car);
    if (i >= 0) state.traffic.splice(i, 1);
  }
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speed = 0;
  return true;
}

// Leave the driven car. The player is placed beside it (driver's side
// first, passenger side / front / back as fallbacks) on walkable ground;
// the car stays put with driver 'none' and speed 0.
export function exitCar(state) {
  const player = state.player;
  const car = player && player.inCar;
  if (!player || !car) return false;
  const world = state.world;
  const r = PLAYER_RADIUS;
  // Candidate offsets: left side, right side, front, back.
  const offsets = [
    { dx: Math.cos(car.angle + Math.PI / 2), dy: Math.sin(car.angle + Math.PI / 2) },
    { dx: Math.cos(car.angle - Math.PI / 2), dy: Math.sin(car.angle - Math.PI / 2) },
    { dx: Math.cos(car.angle), dy: Math.sin(car.angle) },
    { dx: -Math.cos(car.angle), dy: -Math.sin(car.angle) },
  ];
  let placed = false;
  for (const o of offsets) {
    const px = car.x + o.dx * 34;
    const py = car.y + o.dy * 34;
    if (isWalkable(world, px, py, r)) {
      player.x = px; player.y = py; placed = true; break;
    }
  }
  if (!placed) { player.x = car.x; player.y = car.y; }
  player.angle = car.angle;
  player.speed = 0;
  car.driver = 'none';
  car.speed = 0;
  player.inCar = null;
  return true;
}

// Enter the nearest car, or exit the driven one. Called by main.js only,
// after missions.tryInteract() has declined the E press.
export function tryEnterExitCar(state) {
  const player = state.player;
  if (!player || !player.alive) return false;
  if (player.inCar) return exitCar(state);
  const car = nearestCarIn(state, player.x, player.y, ENTER_DIST);
  if (!car) return false;
  return enterCar(state, car);
}

// On-foot update only: driving is vehicles.updatePlayerCar (main.js calls
// one or the other based on player.inCar). Axis-separated movement so the
// player slides along building walls instead of sticking to corners.
export function updatePlayer(state, dt) {
  const player = state.player;
  if (!player || !player.alive) return;
  if (dt <= 0) return;
  if (player.inCar) return; // driving is handled by vehicles.updatePlayerCar

  const input = readMoveKeys(state);
  const moving = input.mx !== 0 || input.my !== 0;
  // Sprint stamina: sprinting while moving drains it (~5 s from full);
  // empty locks sprint until it regens to staminaUnlock (so tapping Shift
  // at 0 does not give free bursts). Standing or walking regens it. The
  // lock is a hysteresis, not a hard gate. Tuning lives in config.js
  // PLAYER (staminaDrain / staminaRegen / staminaUnlock).
  const STAMINA_DRAIN = PLAYER.staminaDrain;
  const STAMINA_REGEN = PLAYER.staminaRegen;
  const STAMINA_UNLOCK = PLAYER.staminaUnlock;
  if (player.stamina === undefined) player.stamina = 100;
  if (player.staminaLocked === undefined) player.staminaLocked = false;
  if (player.stamina <= 0) player.staminaLocked = true;
  if (player.staminaLocked && player.stamina >= STAMINA_UNLOCK) player.staminaLocked = false;
  const wantSprint = input.sprint && !player.staminaLocked && player.stamina > 0;
  const sprint = wantSprint && moving;
  if (sprint) {
    player.stamina = Math.max(0, player.stamina - STAMINA_DRAIN * dt);
  } else if (!moving || !input.sprint) {
    player.stamina = Math.min(100, player.stamina + STAMINA_REGEN * dt);
  }
  const targetSpeed = sprint ? SPRINT_SPEED : WALK_SPEED;
  if (moving) {
    const len = Math.hypot(input.mx, input.my);
    const nx = input.mx / len;
    const ny = input.my / len;
    player.angle = Math.atan2(ny, nx);
    player.speed = targetSpeed;
    player.walkPhase += dt * (sprint ? 14 : 10);
    const world = state.world;
    const stepX = nx * targetSpeed * dt;
    const stepY = ny * targetSpeed * dt;
    const nxPos = player.x + stepX;
    if (isWalkable(world, nxPos, player.y, PLAYER_RADIUS)) player.x = nxPos;
    const nyPos = player.y + stepY;
    if (isWalkable(world, player.x, nyPos, PLAYER_RADIUS)) player.y = nyPos;
  } else {
    player.speed = 0;
  }

  // Aim with the mouse while the pistol is out and the pointer is held:
  // the aim angle is what combat.shoot fires along. The conversion is the
  // shared mouseAngleFrom in input.js — this used to inline the same sum
  // (cam.y + mouse.y - player.y) that combat.js also carried locally.
  const mouse = state.mouse;
  if (mouse && mouse.down && player.weapon === 'pistol') {
    player.angle = mouseAngleFrom(state, player.x, player.y);
  }
}

// --- Stats -----------------------------------------------------------------
// state.stats is the career record. Every system writes to it as things
// happen (missions.js pays, combat.js kills, police.js escapes, this
// module steals); the stats screen (hud.js) only reads it. The counters
// are created by main.js's createGameState; recordStat tolerates a state
// that has none yet (a bare test state), so a counter is never a crash.

/** Add n (default 1) to a stats counter. */
export function recordStat(state, key, n = 1) {
  if (!state.stats) state.stats = {};
  state.stats[key] = (state.stats[key] || 0) + n;
  return state.stats[key];
}

/** Read a stats counter (0 when never recorded). */
export function statOf(state, key) {
  return (state.stats && state.stats[key]) || 0;
}

/**
 * The stats screen rows: [{ key, label, value }] in STAT_LABELS order.
 * timePlayed is seconds (rounded), topSpeed is px/s (rounded), money
 * figures are dollars. A row is only as true as the counters behind it
 * — nothing here estimates, it only reads.
 */
export function statsSummary(state) {
  const labels = [
    ['moneyEarned', 'Money earned (all time)'],
    ['missionsDone', 'Story jobs finished'],
    ['jobsDone', 'Side jobs finished'],
    ['jobMoney', 'Side-job earnings'],
    ['eventsDone', 'Street events finished'],
    ['eventsEarned', 'Street-event earnings'],
    ['bountiesDone', 'Bounties collected'],
    ['bountiesEarned', 'Bounty earnings'],
    ['carsStolen', 'Cars stolen'],
    ['arrestsEscaped', 'Arrests escaped'],
    ['pedsHit', 'Pedestrians hit'],
    ['shotsFired', 'Shots fired'],
    ['kills', 'Gang members dropped'],
    ['topSpeed', 'Top speed (px/s)'],
    ['timePlayed', 'Time in Port Solano (s)'],
  ];
  return labels.map(([key, label]) => {
    let value = statOf(state, key);
    if (key === 'moneyEarned' || key === 'jobMoney' || key === 'eventsEarned' || key === 'bountiesEarned') value = `$${Math.round(value)}`;
    else if (key === 'topSpeed') value = `${Math.round(value)} px/s`;
    else if (key === 'timePlayed') value = `${Math.round(value)}s`;
    else value = String(value);
    return { key, label, value };
  });
}

/** One-line career summary for the pause screen ("$12,400 earned · 6 jobs · 3 escapes"). */
export function careerLine(state) {
  const money = Math.round(statOf(state, 'moneyEarned'));
  const jobs = statOf(state, 'missionsDone') + statOf(state, 'jobsDone');
  const escapes = statOf(state, 'arrestsEscaped');
  return `$${money.toLocaleString('en-US')} earned · ${jobs} jobs done · ${escapes} escape${escapes === 1 ? '' : 's'}`;
}

/**
 * The career headline ("Rook · Respected · $10,650 earned"): the one
 * line the stats screen leads with, so the player's standing is one
 * glance, not a table. The rep title comes from moneyEarned and the
 * money is the same number careerLine reports — the headline and the
 * table read the same counter, so they can never disagree.
 */
export function careerHeadline(state) {
  const rep = repTitle(state);
  const money = Math.round(statOf(state, 'moneyEarned'));
  return `Rook · ${rep.title} · $${money.toLocaleString('en-US')} earned`;
}

// --- Reputation ------------------------------------------------------------
// Rep is the career total of money earned (missions plus side jobs
// plus events): it never goes down, it is never spent, and it is the
// number the stats screen and the pause menu lead with. The title is
// the highest REP_TITLES row whose threshold the player has passed —
// a Nobody is invisible, a Legend is a story mothers tell their
// kids. The rep is read from stats.moneyEarned, the one counter that
// every payout already writes to, so no system has to remember to
// update it separately.

/** The player's reputation title and line, from career earnings. */
export function repTitle(state) {
  const earned = statOf(state, 'moneyEarned');
  let best = REP_TITLES[0];
  for (const row of REP_TITLES) {
    if (earned >= row.at) best = row;
  }
  return { title: best.title, line: best.line, earned: Math.round(earned) };
}

/** The player's reputation title alone, for short labels. */
export function repName(state) {
  return repTitle(state).title;
}

// --- Achievements -----------------------------------------------------------
// Sixteen career milestones (ACHIEVEMENTS in config.js). The check
// runs once a second from main.js's step — cheap, because it is a
// scan of counters the game already keeps, not a simulation. An
// unlock is permanent (saved with the career in save v3), announced
// with a gold burst and a float text, and remembered on state so the
// HUD panel can show the latest one without re-scanning. The `test`
// key is a predicate in ACHIEVEMENT_TESTS below: the data says WHAT
// the milestone is, this map says HOW it is measured, so a new
// milestone is a row in config.js plus one line here.

/** The measurement for each achievement `test` key. */
export const ACHIEVEMENT_TESTS = {
  missionsDone1: (s) => (s.stats?.missionsDone || 0) >= 1,
  earned1000: (s) => (s.stats?.moneyEarned || 0) >= 1000,
  topSpeed500: (s) => (s.stats?.topSpeed || 0) >= 500,
  carsStolen5: (s) => (s.stats?.carsStolen || 0) >= 5,
  shotsFired50: (s) => (s.stats?.shotsFired || 0) >= 50,
  kills10: (s) => (s.stats?.kills || 0) >= 10,
  jobsDone10: (s) => (s.stats?.jobsDone || 0) >= 10,
  streak3: (s) => (s.jobs?.bestStreak || 0) >= 3,
  bountiesDone1: (s) => (s.bounties?.done || 0) >= 1,
  garagesOwned1: (s) => (s.garages?.owned || []).length >= 1,
  escapes3: (s) => (s.stats?.arrestsEscaped || 0) >= 3,
  timePlayed600: (s) => (s.stats?.timePlayed || 0) >= 600,
  timePlayed1800: (s) => (s.stats?.timePlayed || 0) >= 1800,
  missionsDone4: (s) => (s.stats?.missionsDone || 0) >= 4,
  earned10000: (s) => (s.stats?.moneyEarned || 0) >= 10000,
  missionsDone6: (s) => (s.stats?.missionsDone || 0) >= 6,
  // Second wave: the board clears, the roofs multiply, the kills pile
  // up and the money climbs — every one reads a counter the game
  // already keeps, so the career is the same career, only longer.
  bountiesDone3: (s) => (s.bounties?.done || 0) >= 3,
  garagesOwned2: (s) => (s.garages?.owned || []).length >= 2,
  garagesOwned4: (s) => (s.garages?.owned || []).length >= 4,
  jobsDone25: (s) => (s.stats?.jobsDone || 0) >= 25,
  kills25: (s) => (s.stats?.kills || 0) >= 25,
  shotsFired150: (s) => (s.stats?.shotsFired || 0) >= 150,
  carsStolen15: (s) => (s.stats?.carsStolen || 0) >= 15,
  earned25000: (s) => (s.stats?.moneyEarned || 0) >= 25000,
};

function ensureAchievements(state) {
  if (!state.achievements) state.achievements = { unlocked: [], lastUnlock: null, lastUnlockAt: 0 };
  if (!Array.isArray(state.achievements.unlocked)) state.achievements.unlocked = [];
  return state.achievements;
}

/**
 * Scan the career for newly-earned achievements, unlock them, and
 * return the ones unlocked by this call (usually none, sometimes one
 * — a big payout can trip two at once, and both unlock). Each unlock
 * announces itself once, with a gold burst and a float text, and the
 * HUD's achievements panel reads state.achievements.lastUnlock.
 */
export function checkAchievements(state) {
  const rec = ensureAchievements(state);
  const fresh = [];
  for (const def of ACHIEVEMENTS) {
    if (rec.unlocked.includes(def.id)) continue;
    const test = ACHIEVEMENT_TESTS[def.test];
    if (!test) continue;
    let earned = false;
    try { earned = !!test(state); } catch { earned = false; }
    if (!earned) continue;
    rec.unlocked.push(def.id);
    rec.lastUnlock = def.id;
    rec.lastUnlockAt = state.time || 0;
    fresh.push(def);
    addFloatText(state, state.player.x, state.player.y - 44, `ACHIEVEMENT — ${def.title}`, '#ffd94d');
    spawnParticles(state, state.player.x, state.player.y, 'gold', 16);
    state.audio?.sfx?.('achievement');
  }
  return fresh;
}

/** The unlocked achievement definitions, in unlock order. */
export function unlockedAchievements(state) {
  const rec = ensureAchievements(state);
  return rec.unlocked
    .map((id) => ACHIEVEMENTS.find((d) => d.id === id))
    .filter(Boolean);
}

/** The most recently unlocked achievement definition, or null. */
export function lastAchievement(state) {
  const rec = ensureAchievements(state);
  if (!rec.lastUnlock) return null;
  return ACHIEVEMENTS.find((d) => d.id === rec.lastUnlock) || null;
}
