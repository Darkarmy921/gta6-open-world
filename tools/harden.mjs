// Port Solano — node stub-DOM smoke harness (tools/harden.mjs).
//
// Rebuilt from scratch under recording #6 (the old /tmp copies were wiped
// twice by VM replacements), and saved in the repo so it survives the next
// one. It runs the real game modules in node with a stubbed window /
// document / canvas / localStorage, drives the fixed-step simulation
// directly, and asserts the campaign, the side systems, the save, the
// police, the weather, the audio, the traffic, the new bounty /
// achievement / garage systems and every ?shot= scene. No browser, no
// network, no real AudioContext: audio no-ops on a missing context.
//
// Run:  node tools/harden.mjs            (exit 0 = every scenario green)
// The harness never touches the real DOM or the real localStorage, and it
// never writes to the game tree — it only reads it and steps it.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'game', 'src');

// ---------------------------------------------------------------------------
// Stub browser: window / document / canvas / localStorage / performance.
// ---------------------------------------------------------------------------

// The rAF queue: createGame registers one callback per frame; the harness
// pumps it manually so a ?shot= scene can reach window.__shotReady.
const rafQueue = [];
let rafIdCounter = 0;
let nowMs = 0;

function makeGradient() {
  return { addColorStop() {} };
}

// A 2D context that accepts every call render.js / hud.js make and never
// draws anything. Property writes (fillStyle, font, ...) land on the
// target object; method reads return a no-op (or a gradient / measure
// stub for the two factories the game actually uses the return of).
function makeCtx(canvas) {
  const target = { canvas, measureText: (t) => ({ width: String(t).length * 7 }) };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => makeGradient();
      if (k === 'getImageData') return () => ({ data: new Uint8Array(4) });
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

function makeCanvas() {
  const listeners = new Map();
  const canvas = {
    width: 1280,
    height: 720,
    style: {},
    _ctx: null,
    getContext(kind) {
      if (kind !== '2d') return null;
      if (!this._ctx) this._ctx = makeCtx(this);
      return this._ctx;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720 };
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    setAttribute() {},
    focus() {},
  };
  return canvas;
}

function makeElement() {
  return {
    style: {},
    textContent: '',
    disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    querySelector: () => null,
  };
}

const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const windowStub = {
  location: { search: '', href: 'http://localhost:8080/' },
  navigator: { userAgent: 'node-harness' },
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  AudioContext: undefined,
  webkitAudioContext: undefined,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(cb) {
    rafQueue.push(cb);
    rafIdCounter += 1;
    return rafIdCounter;
  },
  cancelAnimationFrame(id) {
    // The queue holds callbacks, not ids: drop the most recent one —
    // destroy() only ever cancels the single live frame callback.
    if (rafQueue.length > 0) rafQueue.pop();
    void id;
  },
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
  performance: { now: () => nowMs },
  __shotReady: false,
};

const documentStub = {
  hidden: false,
  getElementById: () => null,
  createElement: () => makeElement(),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  body: makeElement(),
};

globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.localStorage = localStorageStub;
globalThis.performance = windowStub.performance;
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame.bind(windowStub);
globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame.bind(windowStub);

// The game modules, imported AFTER the stubs exist (main.js auto-boots
// only when document.getElementById finds a canvas — ours returns null,
// so the harness creates every game explicitly).
const mainMod = await import(join(SRC, 'main.js'));
const configMod = await import(join(SRC, 'config.js'));
const missionsMod = await import(join(SRC, 'missions.js'));
const policeMod = await import(join(SRC, 'police.js'));
const combatMod = await import(join(SRC, 'combat.js'));
const inputMod = await import(join(SRC, 'input.js'));
const saveMod = await import(join(SRC, 'save.js'));
const worldMod = await import(join(SRC, 'world.js'));
const vehiclesMod = await import(join(SRC, 'vehicles.js'));
const pedsMod = await import(join(SRC, 'peds.js'));
const trafficMod = await import(join(SRC, 'traffic.js'));
const hudMod = await import(join(SRC, 'hud.js'));
const renderMod = await import(join(SRC, 'render.js'));
const audioMod = await import(join(SRC, 'audio.js'));
const shotsMod = await import(join(SRC, 'shots.js'));
const randomMod = await import(join(SRC, 'random.js'));
const effectsMod = await import(join(SRC, 'effects.js'));

const { createGame, createGameState, MODES } = mainMod;
const { STEP } = configMod;
const { keys, mouse, pressed, endFrame, clearAll } = inputMod;

// ---------------------------------------------------------------------------
// Scenario runner: counts assertions, keeps going after a failure so one
// broken scenario does not hide the rest, and exits non-zero on any fail.
// ---------------------------------------------------------------------------

let totalChecks = 0;
let totalFailed = 0;
const scenarioResults = [];

function check(cond, label) {
  totalChecks += 1;
  assert.ok(cond, label);
}

async function scenario(name, fn) {
  const before = totalChecks;
  const beforeFailed = totalFailed;
  try {
    await fn();
    scenarioResults.push({ name, checks: totalChecks - before, failed: 0 });
    console.log(`  PASS ${name} (${totalChecks - before} checks)`);
  } catch (err) {
    totalFailed += 1;
    scenarioResults.push({ name, checks: totalChecks - before, failed: 1 });
    console.log(`  FAIL ${name}: ${err.message}`);
  }
  void beforeFailed;
}

function freshGame(seed = 42, opts = {}) {
  clearAll();
  if (!opts.keepStore) store.clear();
  windowStub.__shotReady = false;
  rafQueue.length = 0;
  nowMs = 0;
  audioMod.audio.stationIndex = 0;
  audioMod.audio.musicOn = true;
  const { keepStore, ...gameOpts } = opts;
  void keepStore;
  return createGame(makeCanvas(), { seed, ...gameOpts });
}

function endGame(game) {
  try { game.destroy(); } catch { /* already torn down */ }
  clearAll();
  rafQueue.length = 0;
}

// Pump the stub rAF loop `n` frames (16.7 ms apart): the frame loop runs
// handleFrameKeys + steps + drawGame on the stub canvas, and sets
// window.__shotReady after 3 painted frames for a ?shot= scene.
function pumpFrames(game, n) {
  for (let i = 0; i < n; i += 1) {
    nowMs += 16.7;
    const cb = rafQueue.shift();
    if (!cb) return i;
    cb(nowMs);
    endFrame();
  }
  return n;
}

// --- driving helpers -------------------------------------------------------

function stepN(game, n, keysHeld = []) {
  for (const k of keysHeld) keys.add(k);
  for (let i = 0; i < n; i += 1) {
    game.step(STEP);
    endFrame();
  }
  for (const k of keysHeld) keys.delete(k);
}

function pressE(game) {
  pressed.add('KeyE');
  game.step(STEP);
  endFrame();
}

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function teleport(game, x, y) {
  const p = game.state.player;
  p.x = x; p.y = y;
  if (p.inCar) { p.inCar.x = x; p.inCar.y = y; }
}

function teleportCar(game, x, y) {
  const p = game.state.player;
  if (!p.inCar) return false;
  p.inCar.x = x; p.inCar.y = y;
  p.inCar.speed = 0;
  p.x = x; p.y = y;
  return true;
}

// Put the player in a car (spawn one if none is near): the car tests
// need a driver, not a walk.
function ensureCar(game, model = 'sedan', x = null, y = null) {
  const s = game.state;
  const p = s.player;
  if (p.inCar) return p.inCar;
  const cx = x ?? p.x;
  const cy = y ?? p.y;
  const car = vehiclesMod.createCar(model, cx, cy, -Math.PI / 2, { driver: 'player', color: '#c94f43' });
  s.cars.push(car);
  p.inCar = car;
  p.x = cx; p.y = cy; p.angle = car.angle;
  return car;
}

function clearCarsNear(game, x, y, r = 200) {
  const s = game.state;
  const keep = (c) => Math.hypot(c.x - x, c.y - y) >= r || c === s.player.inCar;
  s.cars = s.cars.filter(keep);
  s.traffic = s.traffic.filter(keep);
  s.cops = s.cops.filter(keep);
}

function resetPolice(game) {
  const s = game.state;
  s.cops = [];
  s.copsFoot = [];
  s.player.heat = 0;
  s.player.wanted = 0;
  s.bustPending = false;
  s.bustProgress = 0;
  if (s._police) { s._police.losTimer = 0; s._police.lastSeenAt = -100; }
}

// Hold keys for `seconds` of simulation; return the distance moved.
function driveLeg(game, keyList, seconds) {
  const p = game.state.player;
  const sx = p.x;
  const sy = p.y;
  stepN(game, Math.round(seconds / STEP), keyList);
  return Math.hypot(p.x - sx, p.y - sy);
}

// Drive (or walk) toward one point, steering at it. Returns true when the
// point was reached (within 80 px). If the car wedges (no progress for
// 3 s) the helper nudges it 150 px toward the point and counts the nudge
// — the mission logic is what is under test, not the autopilot.
function driveToPoint(game, tx, ty, maxSeconds = 90, clearCops = false) {
  const s = game.state;
  const p = s.player;
  let assisted = 0;
  let lastDist = Math.hypot(tx - p.x, ty - p.y);
  let stallT = 0;
  const maxSteps = Math.round(maxSeconds / STEP);
  for (let i = 0; i < maxSteps; i += 1) {
    // Campaign legs clear the chase every 0.5 s: a cop car spawns
    // 750 px out and reaches the player in ~1.3 s, so a 5 s interval
    // still lets it land rams (the 400 hp coupe died in 40 s that
    // way). The leg tests the mission logic, not the pursuit — the
    // police scenario covers the pursuit on its own.
    if (clearCops && i % 30 === 0) resetPolice(game);
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 80) {
      // Reached: let go of every key BEFORE returning, or the car
      // keeps driving itself on a stuck W for the rest of the test.
      keys.clear();
      return { reached: true, assisted };
    }
    if (d > lastDist - 2) stallT += STEP;
    else stallT = 0;
    lastDist = d;
    if (stallT > 3) {
      // Wedged on a building corner or a traffic jam: nudge along.
      const nx = p.x + (dx / d) * 150;
      const ny = p.y + (dy / d) * 150;
      if (p.inCar) { p.inCar.x = nx; p.inCar.y = ny; p.inCar.speed = 0; }
      p.x = nx; p.y = ny;
      assisted += 1;
      stallT = 0;
    }
    keys.clear();
    if (p.inCar) {
      const car = p.inCar;
      const want = Math.atan2(dy, dx);
      const err = normAngle(want - car.angle);
      const speed = Math.abs(car.speed || 0);
      if (speed < 40 && Math.abs(err) > 1.0) {
        // Too slow to turn: reverse out of the bad angle.
        keys.add('KeyS');
        if (err > 0) keys.add('KeyA');
        else keys.add('KeyD');
      } else if (Math.abs(err) > 0.9) {
        // Sharp turn ahead at speed: brake first, steer while slowing —
        // a 90-degree turn at 400 px/s swings 200 px wide, off the road
        // and into the block, where the car wedges and dies on corners.
        keys.add('KeyS');
        if (err > 0) keys.add('KeyD');
        else keys.add('KeyA');
      } else if (Math.abs(err) > 0.35) {
        // Wide turn: coast (no throttle) and steer, so the turn radius
        // stays inside the 96 px road instead of the next block.
        if (err > 0) keys.add('KeyD');
        else keys.add('KeyA');
      } else {
        keys.add('KeyW');
        if (err > 0.18) keys.add('KeyD');
        else if (err < -0.18) keys.add('KeyA');
      }
    } else {
      if (dx < -20) keys.add('KeyA');
      else if (dx > 20) keys.add('KeyD');
      if (dy < -20) keys.add('KeyW');
      else if (dy > 20) keys.add('KeyS');
      keys.add('ShiftLeft');
    }
    game.step(STEP);
    endFrame();
  }
  keys.clear();
  const d = Math.hypot(tx - p.x, ty - p.y);
  return { reached: d < 80, assisted };
}

// Road-grid route: avenues at x = 200 + 400i, streets at y = 200 + 400j.
// Go to the nearest avenue, along it to the target street, then along
// the street to the target — the car stays on roads the whole way.
const AVENUES = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
const STREETS = [200, 600, 1000, 1400, 1800, 2200];
function nearestOf(list, v) {
  return list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

function routeTo(game, tx, ty, maxSeconds = 360, clearCops = false) {
  const p = game.state.player;
  const ax = nearestOf(AVENUES, p.x);
  const sy = nearestOf(STREETS, ty);
  const ix = nearestOf(AVENUES, p.x);
  const iy = nearestOf(STREETS, p.y);
  const waypoints = [
    { x: ix, y: iy },
    { x: ax, y: sy },
    { x: tx, y: sy },
    { x: tx, y: ty },
  ];
  let assisted = 0;
  for (const wp of waypoints) {
    if (Math.hypot(wp.x - p.x, wp.y - p.y) < 80) continue;
    const r = driveToPoint(game, wp.x, wp.y, maxSeconds / 4, clearCops);
    assisted += r.assisted;
    if (!r.reached) return { reached: false, assisted };
  }
  return { reached: true, assisted };
}

function aimAt(game, wx, wy) {
  const s = game.state;
  mouse.x = wx - s.camera.x;
  mouse.y = wy - s.camera.y;
}

// Shoot the nearest live enemy until it is dead (or the mag runs dry and
// the auto-reload finishes). Returns the shots fired.
function shootEnemyDead(game, enemy) {
  const s = game.state;
  let shots = 0;
  // A dead player cannot shoot: stop at once instead of burning 900
  // steps on a corpse (which is also what made a failed M5 slow).
  for (let i = 0; i < 900 && !enemy.dead && s.player.alive; i += 1) {
    aimAt(game, enemy.x, enemy.y);
    mouse.down = true;
    game.step(STEP);
    mouse.down = false;
    endFrame();
    shots += 1;
    // A dead enemy is removed from state.enemies by the bullet hit;
    // the flag is set by hurtEnemy.
    if (!s.enemies.includes(enemy)) return shots;
  }
  return shots;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const MONEY_AFTER = [750, 1550, 2550, 3750, 5650, 10650];

function missionCar(game, model) {
  return game.state.cars.find((c) => c.id !== undefined && String(c.id).startsWith(`mission-${model}`));
}

async function runCampaign(seed) {
  const game = freshGame(seed);
  const s = game.state;
  try {
    game.start(false);
    check(s.mode === 'playing', `seed ${seed}: mode playing after start`);
    check(s.mission.active && s.mission.index === 0, `seed ${seed}: M1 active`);

    // M1 — Welcome Home: sedan at the diner, pier pickup, hotel delivery.
    const sedan = missionCar(game, 'sedan');
    check(!!sedan, `seed ${seed}: M1 sedan spawned`);
    teleport(game, sedan.x, sedan.y);
    pressE(game);
    check(s.player.inCar === sedan, `seed ${seed}: entered Delia's sedan`);
    const leg1 = routeTo(game, 732, 2140, 360, true);
    check(leg1.reached, `seed ${seed}: reached the marina pier (assisted ${leg1.assisted})`);
    // Isolate the 3 s pickup hold: a cop ramming the parked sedan out
    // of the circle resets the hold, so the hold tests the mission
    // logic, not the chase.
    resetPolice(game);
    teleportCar(game, 732, 2140);
    stepN(game, 220);
    check(s.mission.stage === 3, `seed ${seed}: package picked up, stage 3`);
    resetPolice(game);
    const leg2 = routeTo(game, 2600, 600, 360, true);
    check(leg2.reached, `seed ${seed}: reached the hotel (assisted ${leg2.assisted})`);
    if (s.player.inCar) teleportCar(game, 2600, 600);
    else teleport(game, 2600, 600);
    stepN(game, 10);
    check(s.mode === 'missionComplete', `seed ${seed}: M1 complete screen`);
    stepN(game, 220);
    check(s.mode === 'playing', `seed ${seed}: back to free roam after M1`);
    check(s.player.money === MONEY_AFTER[0], `seed ${seed}: money $${s.player.money} after M1`);

    // M2 — Hot Wheels: steal the coupe, deliver to the chop shop.
    check(game.startMission(1, 0), `seed ${seed}: M2 starts`);
    const coupe = missionCar(game, 'coupe');
    check(!!coupe, `seed ${seed}: M2 coupe spawned`);
    if (s.player.inCar) { s.player.inCar = null; }
    teleport(game, coupe.x, coupe.y);
    pressE(game);
    check(s.player.inCar === coupe, `seed ${seed}: stole the coupe`);
    check(s.player.wanted >= 2, `seed ${seed}: stealing the coupe is wanted ${s.player.wanted}`);
    const leg3 = routeTo(game, 200, 2200, 360, true);
    check(leg3.reached, `seed ${seed}: reached the chop shop (assisted ${leg3.assisted})`);
    if (s.player.inCar) teleportCar(game, 200, 2200);
    else teleport(game, 200, 2200);
    stepN(game, 10);
    check(s.mode === 'missionComplete', `seed ${seed}: M2 complete screen`);
    stepN(game, 220);
    check(s.player.money === MONEY_AFTER[1], `seed ${seed}: money $${s.player.money} after M2`);

    // M3 — The Drop: 90 s to the north motel.
    check(game.startMission(2, 0), `seed ${seed}: M3 starts`);
    check(s.mission.timer <= 90 && s.mission.timer > 0, `seed ${seed}: M3 timer running`);
    if (s.player.inCar) teleportCar(game, 1400, 200);
    else teleport(game, 1400, 200);
    stepN(game, 10);
    check(s.mode === 'missionComplete', `seed ${seed}: M3 complete screen`);
    stepN(game, 220);
    check(s.player.money === MONEY_AFTER[2], `seed ${seed}: money $${s.player.money} after M3`);

    // M4 — Heat Wave: survive 120 s at 3 stars, then lose the tail.
    if (s.player.inCar) s.player.inCar = null;
    teleport(game, 600, 600);
    resetPolice(game);
    check(game.startMission(3, 0), `seed ${seed}: M4 starts`);
    check(s.player.inCar !== null, `seed ${seed}: M4 hands over a getaway car on foot`);
    check(s.player.wanted >= 3, `seed ${seed}: M4 heat is 3 stars`);
    // Evasive loop: the survival is a DRIVING survival, and a parked
    // car is rammed to a wreck in seconds — the corners keep the car
    // moving at speed, which is what the mission is tuned for.
    // The survival can COMPLETE inside one driveToPoint call: the
    // timer hits 0 (stage 1), the cleared chase lets the heat decay
    // to 0 (missionComplete), and the celebration hold then resets
    // stage to 0 — so the loop must stop the moment the mission is
    // no longer active, and the check must accept either stage 1 or
    // the complete screen. Stopping at stage 0 with an inactive
    // mission is the old bug: the loop spun all 125 iterations and
    // the check read the post-celebration state.
    const corners = [[600, 200], [2600, 200], [2600, 2200], [600, 2200]];
    let ci = 0;
    for (let s60 = 0; s60 < 40 && s.mission.stage === 0 && s.mission.active && s.mode !== 'missionComplete'; s60 += 1) {
      const cp = corners[ci % corners.length];
      ci += 1;
      driveToPoint(game, cp[0], cp[1], 30, true);
      if (!s.player.inCar) break;
      stepN(game, 60);
    }
    if (s.mission.stage === 0 && s.mission.active) stepN(game, Math.round(10 / STEP));
    check(s.mission.stage === 1 || s.mode === 'missionComplete' || s.player.money === MONEY_AFTER[3], `seed ${seed}: M4 survival done, stage 1 or complete (stage ${s.mission.stage}, mode ${s.mode}, money $${s.player.money})`);
    if (s.mode !== 'missionComplete' && s.mission.stage === 1) {
      s.player.heat = 0;
      s.player.wanted = 0;
      stepN(game, 10);
    }
    // The celebration may already have expired inside the last
    // driveToPoint call (money paid, mode back to playing) — the
    // money is the proof, not the screen.
    if (s.mode === 'missionComplete') stepN(game, 220);
    check(s.player.money === MONEY_AFTER[3], `seed ${seed}: money $${s.player.money} after M4`);

    // M5 — Warehouse Payback: drop 6 Harbor Kings on foot.
    if (s.player.inCar) s.player.inCar = null;
    teleport(game, 2200, 1800);
    resetPolice(game);
    check(game.startMission(4, 0), `seed ${seed}: M5 starts`);
    check(s.enemies.length === 6, `seed ${seed}: 6 Kings in the warehouse`);
    for (const e of [...s.enemies]) {
      // The mission under test is "kill 6 -> complete", not "survive
      // 6 gunmen with 100 hp": a strafing King at 100 px eats dozens
      // of shots while the other five shoot back, and seed 1234 died
      // on the second King that way. Full health and 60 px makes the
      // kill loop test the mission, not the player's armour.
      s.player.hp = 100;
      teleport(game, e.x - 60, e.y);
      shootEnemyDead(game, e);
    }
    stepN(game, 10);
    check(s.mode === 'missionComplete', `seed ${seed}: M5 complete screen`);
    stepN(game, 220);
    check(s.player.money === MONEY_AFTER[4], `seed ${seed}: money $${s.player.money} after M5`);
    check((s.stats.kills || 0) >= 6, `seed ${seed}: 6 kills recorded`);

    // M6 — The Big Score: bank vault, then the safehouse.
    if (s.player.inCar) s.player.inCar = null;
    teleport(game, 1400, 1000);
    resetPolice(game);
    check(game.startMission(5, 0), `seed ${seed}: M6 starts`);
    // One step first: E is processed BEFORE updateMission in a step,
    // so the stage 0 -> 1 transition (arriving at the bank) has to
    // happen on a step before the E press can crack the vault.
    stepN(game, 3);
    check(s.mission.stage === 1, `seed ${seed}: at the vault, stage 1`);
    pressE(game);
    check(s.mission.stage === 2, `seed ${seed}: vault crack started`);
    stepN(game, Math.round(11 / STEP));
    check(s.mission.stage === 3, `seed ${seed}: vault cracked, run to the safehouse`);
    check(s.player.wanted >= 4, `seed ${seed}: the whole city wakes up (wanted ${s.player.wanted})`);
    teleport(game, 200, 600);
    stepN(game, 10);
    check(s.mode === 'missionComplete', `seed ${seed}: M6 complete screen`);
    stepN(game, 220);
    check(s.player.money === MONEY_AFTER[5], `seed ${seed}: money $${s.player.money} after M6`);
    check(s.mission.unlocked >= 6, `seed ${seed}: all 6 jobs unlocked`);
    check(s.mission.completed.length === 6, `seed ${seed}: all 6 jobs completed`);
  } finally {
    endGame(game);
  }
}

async function main() {
  console.log('Port Solano harden harness — stub-DOM smoke suite');

  await scenario('boot', async () => {
    const game = freshGame(42);
    try {
      const s = game.state;
      check(s.mode === 'title', 'boots to the title screen');
      check(s.cars.length > 0, 'city populated with cars');
      check(s.traffic.length === 14, `traffic at target (got ${s.traffic.length})`);
      check(s.peds.length >= 20, `peds populated (got ${s.peds.length})`);
      check(s.player.money === 250, 'starting money $250');
      check(s.player.hp === 100, 'full hp at boot');
      check(s.sky.timeOfDay === 0.5, 'fresh game starts at noon');
      check(s.sky.weather === 'clear', 'fresh game starts clear');
      check(Array.isArray(s.mission.completed), 'mission record present');
      check(s.stats && typeof s.stats.moneyEarned === 'number', 'career record present');
      check(s.jobs && Array.isArray(s.jobs.offers), 'job board present');
      check(s.events && s.events.rollT > 0, 'street-event timer present');
    } finally { endGame(game); }
  });

  await scenario('campaign-seed-42', () => runCampaign(42));
  await scenario('campaign-seed-7', () => runCampaign(7));
  await scenario('campaign-seed-1234', () => runCampaign(1234));

  await scenario('run31-free-roam-soak', async () => {
    const game = freshGame(99);
    try {
      game.start(false);
      const s = game.state;
      // Complete M1 first (enter the sedan, pier, hotel) so the soak
      // runs in free roam.
      const sedan = s.cars.find((c) => c.id !== undefined && String(c.id).startsWith('mission-sedan'));
      teleport(game, sedan.x, sedan.y);
      pressE(game);
      resetPolice(game);
      teleportCar(game, 732, 2140);
      stepN(game, 220);
      teleportCar(game, 2600, 600);
      stepN(game, 230);
      check(s.mode === 'playing', 'soak: free roam after M1');
      let badFrames = 0;
      for (let sec = 0; sec < 31; sec += 1) {
        stepN(game, 60);
        const p = s.player;
        if (!p.alive || s.mode !== 'playing') badFrames += 1;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) badFrames += 1;
        if (s.traffic.length < 5 || s.traffic.length > 40) badFrames += 1;
        if (s.peds.length < 5) badFrames += 1;
        // The HUD must never throw on a live frame.
        try {
          hudMod.drawHUD(makeCtx(makeCanvas()), s);
        } catch { badFrames += 1; }
      }
      check(badFrames === 0, `soak: 31 s of free roam with no bad frame (bad=${badFrames})`);
      check(s.stats.timePlayed > 30, 'soak: clock kept running');
    } finally { endGame(game); }
  });

  await scenario('save', async () => {
    const game = freshGame(42);
    try {
      const s = game.state;
      game.start(false);
      s.player.money = 1234;
      s.stats.missionsDone = 2;
      s.stats.kills = 5;
      check(game.saveGame() === true, 'save writes');
      check(saveMod.hasSave(), 'save present after write');
      const loaded = saveMod.loadGame();
      check(loaded !== null, 'save loads');
      check(loaded.money === 1234, 'save keeps money');
      check(loaded.version === saveMod.SAVE_VERSION, `save version is ${saveMod.SAVE_VERSION}`);
      check(loaded.stats.kills === 5, 'save keeps career kills');
      check(typeof saveMod.saveSummary(loaded) === 'string' && saveMod.saveSummary(loaded).includes('1,234'), 'save summary names the money');
      // A fresh state takes the save (keepStore: freshGame clears the
      // stub localStorage by default, which would wipe the save).
      const game2 = freshGame(7, { keepStore: true });
      try {
        check(game2.loadSave() === true, 'second game loads the save');
        check(game2.state.player.money === 1234, 'loaded money applied');
        check(game2.state.mission.unlocked >= 0, 'loaded mission index applied');
      } finally { endGame(game2); }
      // Corrupt and stale saves are rejected, never half-loaded.
      localStorageStub.setItem(saveMod.SAVE_KEY, '{not json');
      check(saveMod.loadGame() === null, 'corrupt save rejected');
      localStorageStub.setItem(saveMod.SAVE_KEY, JSON.stringify({ version: 1, money: 999, missionIndex: 0 }));
      check(saveMod.loadGame() === null, 'v1 save rejected');
      localStorageStub.setItem(saveMod.SAVE_KEY, JSON.stringify({ version: saveMod.SAVE_VERSION, money: -5, missionIndex: 99 }));
      const clamped = saveMod.loadGame();
      check(clamped !== null && clamped.money === 0, 'negative money clamped, save still loads');
      check(saveMod.clearSave() === true, 'save clears');
      check(saveMod.hasSave() === false, 'no save after clear');
    } finally { endGame(game); }
  });

  await scenario('police', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      policeMod.addWanted(s, 1, 'steal');
      check(s.player.wanted === 1, 'one star after a steal');
      check(policeMod.wantedName(1) === 'One Star' || typeof policeMod.wantedName(1) === 'string', 'wanted name is a string');
      policeMod.addWanted(s, 10, 'rampage');
      check(s.player.wanted === 5, 'wanted caps at 5 stars');
      check(s.player.heat <= 100, 'heat caps at 100');
      check(policeMod.heatLabel(s).length > 0, 'heat label exists');
      check(typeof policeMod.secondsToClean(s) === 'number', 'seconds-to-clean is a number');
      // Heat decays once the cops lose sight.
      s.player.heat = 60;
      s.player.wanted = 3;
      s.lastCrimeAt = -100;
      if (s._police) s._police.losTimer = 10;
      const before = s.player.heat;
      stepN(game, Math.round(10 / STEP));
      check(s.player.heat < before, `heat decays out of sight (${before} -> ${s.player.heat})`);
      // Tactic reads: chase at 3 stars, null when clean (before the
      // lethal-damage check below — a wasted player cannot gain heat).
      s.player.heat = 60;
      s.player.wanted = 3;
      check(policeMod.copTactic(s) === 'chase', 'cop tactic is chase at 3 stars');
      resetPolice(game);
      check(policeMod.copTactic(s) === null, 'cop tactic is null when clean');
      // Lethal damage wastes the player; the loop converts it.
      resetPolice(game);
      s.player.hp = 10;
      policeMod.damagePlayer(s, 50);
      stepN(game, 2);
      check(s.mode === 'wasted' || s.player.alive === false, 'lethal damage wastes the player');
    } finally { endGame(game); }
  });

  await scenario('freeroam-jobs-events', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      // Finish M1 by teleport so the board opens in free roam.
      const sedan = s.cars.find((c) => c.id !== undefined && String(c.id).startsWith('mission-sedan'));
      teleport(game, sedan.x, sedan.y);
      pressE(game);
      resetPolice(game);
      teleportCar(game, 732, 2140);
      stepN(game, 220);
      teleportCar(game, 2600, 600);
      stepN(game, 230);
      check(s.mode === 'playing' && !s.mission.active, 'free roam after M1');
      missionsMod.offerJobs(s);
      check(s.jobs.offers.length === 3, `board offers 3 jobs (got ${s.jobs.offers.length})`);
      const types = new Set(s.jobs.offers.map((j) => j.type));
      check(types.size >= 1, 'offers have types');
      // Take the first offer and run it end to end by teleport.
      const job = s.jobs.offers[0];
      const started = missionsMod.startJob(s, job.id);
      check(!!started, 'job starts');
      check(missionsMod.activeJob(s) === job, 'job is active');
      if (missionsMod.JOB_TYPES[job.type].needsCar) ensureCar(game);
      teleport(game, job.pickup.x, job.pickup.y);
      stepN(game, 70);
      check(job.pickedUp === true, 'pickup hold completes the pickup');
      teleport(game, job.dropoff.x, job.dropoff.y);
      stepN(game, 5);
      check(missionsMod.activeJob(s) === null, 'job completes at the dropoff');
      check(s.stats.jobsDone >= 1, 'job counted in career');
      check(s.player.money > 750, 'job paid out');
      // Street events: shootout, race, package rush, stolen car.
      const shoot = missionsMod.spawnEvent(s, 'shootout');
      check(!!shoot && shoot.enemies.length === 3, 'shootout spawns 3 gunmen');
      for (const e of [...shoot.enemies]) {
        teleport(game, e.x - 100, e.y);
        shootEnemyDead(game, e);
      }
      stepN(game, 5);
      check(missionsMod.activeEvent(s) === null, 'shootout completes when the gang is down');
      const race = missionsMod.spawnEvent(s, 'race');
      check(!!race && race.checkpoints.length === 3, 'race lays 3 checkpoints');
      for (const cp of race.checkpoints) {
        teleport(game, cp.x, cp.y);
        stepN(game, 3);
      }
      check(missionsMod.activeEvent(s) === null, 'race completes at the last checkpoint');
      const rush = missionsMod.spawnEvent(s, 'package-rush');
      check(!!rush, 'package rush spawns');
      teleport(game, rush.x, rush.y);
      stepN(game, 3);
      teleport(game, rush.dropoff.x, rush.dropoff.y);
      stepN(game, 3);
      check(missionsMod.activeEvent(s) === null, 'package rush completes at the dropoff');
    } finally { endGame(game); }
  });

  await scenario('weather-time', async () => {
    const game = freshGame(42);
    try {
      const s = game.state;
      worldMod.setWeather(s, 'rain');
      check(worldMod.gripFactor(s) === 0.85, 'rain grip is 0.85');
      worldMod.setWeather(s, 'clear');
      check(worldMod.gripFactor(s) === 1, 'clear grip is 1');
      worldMod.setTimeOfDay(s, 0);
      check(worldMod.isNight(s) === true, 'midnight is night');
      check(worldMod.skyLight(s).darkness > 0.5, 'midnight is dark');
      worldMod.setTimeOfDay(s, 0.5);
      check(worldMod.isNight(s) === false, 'noon is day');
      const t0 = s.sky.timeOfDay;
      game.start(false);
      stepN(game, 60);
      check(s.sky.timeOfDay !== t0, 'the clock advances while playing');
      check(typeof worldMod.clockLabel(s) === 'string' && worldMod.clockLabel(s).length > 0, 'clock label renders');
      check(typeof worldMod.forecastLabel(s) === 'string', 'forecast label renders');
      check(typeof worldMod.playerDistrict(s) === 'string', 'district resolves');
      check(typeof worldMod.districtDescription(worldMod.playerDistrict(s)) === 'string', 'district description renders');
    } finally { endGame(game); }
  });

  await scenario('audio', async () => {
    const au = audioMod.audio;
    const n = configMod.RADIO_STATIONS.length;
    check(n >= 6, `${n} radio stations`);
    check(au.currentStation().id === configMod.RADIO_STATIONS[0].id, 'station 0 is the default');
    au.nextStation();
    check(au.stationIndex === 1, 'N moves to the next station');
    au.setStation(-1);
    check(au.stationIndex === n - 1, 'setStation(-1) wraps to the last station');
    au.setStation(n);
    check(au.stationIndex === 0, 'setStation(n) wraps to the first station');
    check(au.stationLabel().includes(au.currentStation().name), 'station label names the station');
    check(au.stationIdent().includes('Port Solano'), 'station ident names the city');
    au.setMusic(false);
    check(au.musicOn === false, 'music toggles off');
    au.setMusic(true);
    check(au.musicOn === true, 'music toggles on');
    // Every station has the fields the scheduler reads.
    for (const st of configMod.RADIO_STATIONS) {
      check(typeof st.bpm === 'number' && st.bpm > 0, `station ${st.id} has a bpm`);
      check(Array.isArray(st.scale) && st.scale.length > 0, `station ${st.id} has a scale`);
    }
  });

  await scenario('traffic', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      check(s.traffic.length === 14, 'traffic at target on start');
      check(trafficMod.taxiCount(s) >= 0, 'taxi count reads');
      check(typeof trafficMod.trafficByModel(s) === 'object', 'traffic by model reads');
      check(trafficMod.isJammed(s) === false, 'no jam at start');
      const taxi = trafficMod.spawnTaxiNear(s, s.player.x, s.player.y);
      check(!!taxi, 'a taxi spawns near the player');
      // Genuine driving: hold W on an avenue, the car must move.
      ensureCar(game, 'coupe', 1000, 1200);
      game.state.player.inCar.angle = Math.PI / 2;
      const moved = driveLeg(game, ['KeyW'], 3);
      check(moved > 300, `coupe moves under power (${Math.round(moved)}px in 3s)`);
      const moved2 = driveLeg(game, ['KeyW', 'KeyD'], 2);
      check(moved2 > 100, 'coupe turns under power');
      // On foot: WASD moves the player.
      game.state.player.inCar = null;
      teleport(game, 1000, 1000);
      const walked = driveLeg(game, ['KeyW'], 2);
      check(walked > 300, `on-foot movement works (${Math.round(walked)}px in 2s)`);
    } finally { endGame(game); }
  });

  await scenario('shots', async () => {
    for (const name of shotsMod.SHOT_NAMES) {
      const game = freshGame(1, { shot: name });
      try {
        const want = shotsMod.shotMode(name);
        check(game.state.mode === want, `shot ${name} lands in mode ${want}`);
        const pumped = pumpFrames(game, 5);
        check(pumped >= 3, `shot ${name} painted ${pumped} frames`);
        check(windowStub.__shotReady === true, `shot ${name} sets __shotReady`);
        if (name === 'chase') check(game.state.player.wanted === 3, 'chase shot holds 3 stars');
        if (name === 'night') check(worldMod.isNight(game.state) === true, 'night shot is night');
        if (name === 'mission') check(game.state.mission.active === true, 'mission shot has a live job');
      } finally { endGame(game); }
    }
    check(shotsMod.normalizeShot('bogus') === 'start', 'unknown shot normalizes to start');
    check(shotsMod.isShotScene('drive') === true, 'drive is a real scene');
  });

  await scenario('panels-render', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      const ctx = makeCtx(makeCanvas());
      const fns = [
        ['drawGame', () => renderMod.drawGame(ctx, s)],
        ['drawHUD', () => hudMod.drawHUD(ctx, s)],
        ['drawMinimap', () => hudMod.drawMinimap(ctx, s)],
        ['drawClock', () => hudMod.drawClock(ctx, s)],
        ['drawWantedHeat', () => hudMod.drawWantedHeat(ctx, s)],
        ['drawCarCard', () => hudMod.drawCarCard(ctx, s)],
        ['drawDistrictInfo', () => hudMod.drawDistrictInfo(ctx, s)],
        ['drawEventTracker', () => hudMod.drawEventTracker(ctx, s)],
        ['drawPauseMenu', () => hudMod.drawPauseMenu(ctx, s)],
        ['drawMissionTracker', () => hudMod.drawMissionTracker(ctx, s)],
        ['drawJobBoard', () => hudMod.drawJobBoard(ctx, s)],
        ['drawRadioBadge', () => hudMod.drawRadioBadge(ctx, s)],
        ['drawTacticWarning', () => hudMod.drawTacticWarning(ctx, s)],
        ['drawStatsScreen', () => hudMod.drawStatsScreen(ctx, s)],
        ['drawNightOverlay', () => renderMod.drawNightOverlay(ctx, s)],
        ['drawJobMarkers', () => renderMod.drawJobMarkers(ctx, s)],
        ['drawEventMarkers', () => renderMod.drawEventMarkers(ctx, s)],
        ['drawStreetlights', () => renderMod.drawStreetlights(ctx, s)],
        ['drawNightGlow', () => renderMod.drawNightGlow(ctx, s)],
      ];
      for (const [name, fn] of fns) {
        fn();
        check(true, `${name} draws without throwing`);
      }
      // The stats screen toggle (T) and the pause (P) are mode-safe.
      s.ui.showStats = true;
      hudMod.drawHUD(ctx, s);
      check(true, 'HUD draws with the stats screen open');
      s.ui.showStats = false;
    } finally { endGame(game); }
  });

  await scenario('m3-retry', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      check(game.startMission(2, 0), 'M3 starts');
      stepN(game, Math.round(91 / STEP));
      check(s.mission.active === false, 'M3 fails on timeout');
      check(s.mission.objectiveText.includes('failed'), 'failure message shows');
      teleport(game, 600, 600);
      pressE(game);
      check(s.mission.active === true && s.mission.index === 2, 'M3 retries from the diner');
      check(s.mission.timer > 80, 'retried M3 has a fresh timer');
    } finally { endGame(game); }
  });

  await scenario('m4-foot', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      check(game.startMission(3, 0), 'M4 starts on foot');
      check(s.player.inCar !== null, 'M4 hands over a getaway car');
      // Step out and survive on foot for 2 s — the mission is a driving
      // survival, but stepping out must not instantly bust the player.
      s.player.inCar = null;
      teleport(game, 600, 600);
      stepN(game, 120);
      check(s.player.alive === true, 'on-foot M4: still alive after 2 s');
      check(s.mission.active === true, 'on-foot M4: mission still active');
      // Get back in and keep surviving.
      const car = s.cars.find((c) => c.id === s.mission.data.getawayCarId);
      check(!!car, 'getaway car still exists');
      teleport(game, car.x, car.y);
      pressE(game);
      check(s.player.inCar !== null, 'back in a car (sedan and coupe share the diner spawn)');
      stepN(game, 300);
      check(s.mission.active === true, 'M4 still running after getting back in');
    } finally { endGame(game); }
  });

  await scenario('night-sweep', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      const ctx = makeCtx(makeCanvas());
      for (let h = 0; h < 24; h += 1) {
        worldMod.setTimeOfDay(s, h / 24);
        const light = worldMod.skyLight(s);
        check(light.darkness >= 0 && light.darkness <= 1, `hour ${h}: darkness in range`);
        renderMod.drawGame(ctx, s);
        check(true, `hour ${h}: frame draws`);
        hudMod.drawHUD(ctx, s);
        check(true, `hour ${h}: HUD draws`);
        check(typeof worldMod.clockLabel(s) === 'string', `hour ${h}: clock label`);
      }
      // Rain at night: grip still 0.85, overlay still draws.
      worldMod.setWeather(s, 'rain');
      worldMod.setTimeOfDay(s, 0);
      renderMod.drawGame(ctx, s);
      check(worldMod.gripFactor(s) === 0.85, 'rain grip holds at night');
    } finally { endGame(game); }
  });

  await scenario('new-systems', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      // Finish M1 so the new systems run in free roam.
      const sedan = s.cars.find((c) => c.id !== undefined && String(c.id).startsWith('mission-sedan'));
      teleport(game, sedan.x, sedan.y);
      pressE(game);
      resetPolice(game);
      teleportCar(game, 732, 2140);
      stepN(game, 220);
      teleportCar(game, 2600, 600);
      stepN(game, 230);
      check(s.mode === 'playing' && !s.mission.active, 'new systems: free roam');

      // Most Wanted bounty board: offers, accept, hunt, collect.
      missionsMod.offerBounties(s);
      check(s.bounties.offers.length >= 1, `bounty board offers targets (got ${s.bounties.offers.length})`);
      const bounty = s.bounties.offers[0];
      const started = missionsMod.startBounty(s, bounty.id);
      check(!!started, 'bounty starts');
      check(missionsMod.activeBounty(s) === bounty, 'bounty is active');
      check((bounty.targets || []).length >= 1, 'bounty has a target on the street');
      for (const target of [...bounty.targets]) {
        s.player.hp = 100;
        teleport(game, target.x - 60, target.y);
        shootEnemyDead(game, target);
      }
      stepN(game, 5);
      check(missionsMod.activeBounty(s) === null, 'bounty completes when the target is down');
      check(s.bounties.done >= 1, 'bounty counted as done');
      check(s.player.money > 750, 'bounty paid out');

      // Achievements: a career milestone unlocks one.
      s.stats.moneyEarned = 1000;
      const unlocked = (await import(join(SRC, 'player.js'))).checkAchievements(s);
      check(unlocked.length >= 1, 'a milestone unlocks an achievement');
      check(s.achievements.unlocked.length >= 1, 'achievement recorded on state');
      check(configMod.ACHIEVEMENTS.length >= 10, `${configMod.ACHIEVEMENTS.length} achievements defined`);

      // Garages: buy one, it becomes the respawn home and persists.
      s.player.money = 5000;
      const bought = missionsMod.buyGarage(s, 'marina-lockup');
      check(bought === true, 'garage buys with cash');
      check(s.player.money < 5000, 'garage costs money');
      check(missionsMod.ownedGarages(s).includes('marina-lockup'), 'garage owned');
      check(s.garages.home === 'marina-lockup', 'bought garage becomes home');
      check(missionsMod.buyGarage(s, 'marina-lockup') === false, 'cannot buy the same garage twice');
      check(game.saveGame() === true, 'save writes with the new systems');
      const loaded = saveMod.loadGame();
      check(loaded.garages && loaded.garages.includes('marina-lockup'), 'save keeps the garage');
      check(loaded.achievements && loaded.achievements.length >= 1, 'save keeps achievements');

      // City guide: landmarks resolve and the guide lists them.
      check(configMod.LANDMARKS.length >= 10, `${configMod.LANDMARKS.length} landmarks defined`);
      const lm = worldMod.landmarkAt(732, 2140);
      check(!!lm, 'the marina pier is a landmark');
      check(typeof worldMod.nearestLandmark(s) === 'object', 'nearest landmark resolves');
      const guide = worldMod.districtGuide('Marina');
      check(Array.isArray(guide) && guide.length >= 1, 'district guide lists Marina landmarks');

      // New job types and street-event kinds run on the generic engines.
      const seen = new Set();
      for (let i = 0; i < 6; i += 1) {
        s.jobs.offers = [];
        missionsMod.offerJobs(s);
        for (const o of s.jobs.offers) seen.add(o.type);
      }
      check(seen.has('valet') || seen.has('medic'), `new job types appear on the board (${[...seen].join(', ')})`);
      const ambush = missionsMod.spawnEvent(s, 'ambush');
      check(!!ambush && ambush.enemies.length === 2, 'ambush spawns 2 gunmen');
      for (const e of [...ambush.enemies]) {
        s.player.hp = 100;
        teleport(game, e.x - 60, e.y);
        shootEnemyDead(game, e);
      }
      stepN(game, 5);
      check(missionsMod.activeEvent(s) === null, 'ambush completes when the gunmen are down');
      const joyride = missionsMod.spawnEvent(s, 'joyride');
      check(!!joyride && joyride.checkpoints.length >= 2, 'joyride lays checkpoints');
      for (const cp of joyride.checkpoints) {
        teleport(game, cp.x, cp.y);
        stepN(game, 3);
      }
      check(missionsMod.activeEvent(s) === null, 'joyride completes at the last checkpoint');

      // New HUD panels draw without throwing.
      const ctx = makeCtx(makeCanvas());
      hudMod.drawBountyTracker(ctx, s);
      check(true, 'bounty tracker draws');
      hudMod.drawAchievementsPanel(ctx, s);
      check(true, 'achievements panel draws');
      s.ui.showGuide = true;
      hudMod.drawCityGuide(ctx, s);
      check(true, 'city guide draws');
      s.ui.showGuide = false;
    } finally { endGame(game); }
  });

  await scenario('new-content-2', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      const ctx = makeCtx(makeCanvas());
      // Finish M1 first, like new-systems: the bounty board, the
      // events and the jobs run in free roam, not mid-mission.
      const sedan = s.cars.find((c) => c.id !== undefined && String(c.id).startsWith('mission-sedan'));
      teleport(game, sedan.x, sedan.y);
      pressE(game);
      resetPolice(game);
      teleportCar(game, 732, 2140);
      stepN(game, 220);
      teleportCar(game, 2600, 600);
      stepN(game, 230);
      check(s.mode === 'playing' && !s.mission.active, 'new-content-2: free roam');

      // The second wave merged into the first: the counts are the
      // merged counts, not the first-wave counts.
      check(configMod.LANDMARKS.length === 20, `${configMod.LANDMARKS.length} landmarks after the merge`);
      check(configMod.BOUNTIES.targets.length === 10, `${configMod.BOUNTIES.targets.length} bounty targets after the merge`);
      check(configMod.GARAGES.length === 6, `${configMod.GARAGES.length} garages after the merge`);
      check(configMod.ACHIEVEMENTS.length === 24, `${configMod.ACHIEVEMENTS.length} achievements after the merge`);
      check(configMod.TIPS.length >= 48, `${configMod.TIPS.length} tips after the merge`);
      check((configMod.BARKS.nearMiss || []).length >= 8, `near-miss pool has ${configMod.BARKS.nearMiss.length} lines`);
      check((configMod.BARKS.fisherman || []).length === 8, 'fisherman pool has 8 lines');
      check((configMod.BARKS.dealer || []).length === 8, 'dealer pool has 8 lines');
      check((configMod.BARKS.nearMiss2 || []).length >= 8, 'third near-miss pool exists');
      check(configMod.STREET_EVENTS.kinds.length === 12, `${configMod.STREET_EVENTS.kinds.length} street-event kinds`);

      // The DJ talks: every station has patter, and it rotates with
      // game time instead of flickering every frame.
      check(configMod.RADIO_STATIONS.length === 8, '8 radio stations');
      for (const st of configMod.RADIO_STATIONS) {
        const lines = configMod.RADIO_DJ_LINES[st.id] || [];
        check(lines.length >= 5, `DJ lines for ${st.id} (${lines.length})`);
      }
      s.radioStation = 0;
      s.time = 0;
      const dj0 = audioMod.djLine(s);
      check(typeof dj0 === 'string' && dj0.length > 10, 'djLine returns a line');
      s.time = 30;
      const dj1 = audioMod.djLine(s);
      check(dj1 !== dj0, 'the DJ line rotates every 30 s');
      check(audioMod.djLine(s).length > 0, 'the second DJ line is a line');

      // The giver's voice: Sal between jobs (M1 is done, no job is
      // running), Delia while a job is running — the index picks the
      // line, so the tracker never flickers.
      const sal = missionsMod.missionDialogue(s);
      check(typeof sal === 'string' && sal.startsWith('Old Sal:'), `between jobs the voice is Sal's (${sal.slice(0, 30)}…)`);
      s.mission.active = true;
      s.mission.index = 2;
      const dlg = missionsMod.missionDialogue(s);
      check(typeof dlg === 'string' && dlg.startsWith('Delia Maren:'), `mid-job the voice is Delia's (${dlg.slice(0, 30)}…)`);
      s.mission.active = false;
      check(missionsMod.jobFlavour('taxi').length > 10, 'taxi flavour is a line');
      check(missionsMod.jobFlavour('medic').includes('crate'), 'medic flavour mentions the crate');
      check(missionsMod.jobFlavour('valet').includes('keys'), 'valet flavour mentions the keys');
      check(missionsMod.jobFlavour('nope').includes('A job is a job'), 'unknown job type falls back');

      // The district's secret and the wanted poster.
      for (const d of ['The Park', 'Marina', 'Docks', 'Old Town', 'Harbor Heights', 'Downtown', 'Westside', 'The Strip', 'Northside', 'The Harbour']) {
        const sec = worldMod.districtSecret(d);
        check(typeof sec === 'string' && sec.length > 10, `secret for ${d}`);
      }
      check(worldMod.districtSecret('Nowhere').includes('secret'), 'unknown district falls back');
      s.player.wanted = 0;
      check(policeMod.wantedPoster(s).startsWith('CLEAN'), 'clean poster at 0 stars');
      s.player.wanted = 5;
      check(policeMod.wantedPoster(s).startsWith('FIVE STARS'), 'five-star poster at 5 stars');
      s.player.wanted = 3;
      check(policeMod.wantedPoster(s).startsWith('THREE STARS'), 'three-star poster at 3 stars');

      // The car card carries the flavour of the model.
      const comet = vehiclesMod.carCard({ model: 'sports', health: 100, maxHealth: 100 });
      check(comet.flavour.includes('Comet GT'), 'Comet GT flavour names the car');
      const limo = vehiclesMod.carCard({ model: 'limo', health: 50, maxHealth: 100 });
      check(limo.flavour.includes('Regal Limo'), 'limo flavour names the car');

      // Second-wave achievements measure counters the game already keeps.
      const playerMod = await import(join(SRC, 'player.js'));
      const tests = playerMod.ACHIEVEMENT_TESTS;
      s.bounties = s.bounties || { done: 0 };
      s.bounties.done = 3;
      check(tests.bountiesDone3(s), 'three bounties measures');
      s.garages = s.garages || { owned: [] };
      s.garages.owned = ['marina-lockup', 'downtown-garage'];
      check(tests.garagesOwned2(s), 'two garages measures');
      s.garages.owned = ['a', 'b', 'c', 'd'];
      check(tests.garagesOwned4(s), 'four garages measures');
      s.stats.kills = 25;
      check(tests.kills25(s), 'twenty-five kills measures');
      s.stats.shotsFired = 150;
      check(tests.shotsFired150(s), 'a hundred and fifty shots measures');
      s.stats.carsStolen = 15;
      check(tests.carsStolen15(s), 'fifteen cars measures');
      s.stats.moneyEarned = 25000;
      check(tests.earned25000(s), 'twenty-five thousand measures');
      s.stats.jobsDone = 25;
      check(tests.jobsDone25(s), 'twenty-five jobs measures');

      // The second-wave garages and bounties survive a save round-trip.
      s.player.money = 5000;
      check(missionsMod.buyGarage(s, 'pier-house') === true, 'Pier House buys with cash');
      check(missionsMod.ownedGarages(s).includes('pier-house'), 'Pier House owned');
      check(game.saveGame() === true, 'save writes with the second wave');
      const loaded = saveMod.loadGame();
      check(loaded.garages && loaded.garages.includes('pier-house'), 'save keeps the Pier House');
      s.bounties.doneIds = ['nina-vasquez'];
      check(game.saveGame() === true, 'save writes with a second-wave bounty');
      const loaded2 = saveMod.loadGame();
      check(loaded2.bountyIds && loaded2.bountyIds.includes('nina-vasquez'), 'save keeps second-wave bounty ids');

      // The three new street-event kinds run on the existing engines.
      const fight = missionsMod.spawnEvent(s, 'street-fight');
      check(!!fight && fight.enemies.length === 2, 'street fight spawns 2 men');
      for (const e of [...fight.enemies]) {
        s.player.hp = 100;
        teleport(game, e.x - 60, e.y);
        shootEnemyDead(game, e);
      }
      stepN(game, 5);
      check(missionsMod.activeEvent(s) === null, 'street fight completes when the men are down');
      const theft = missionsMod.spawnEvent(s, 'car-theft');
      check(!!theft && theft.car && theft.car.model === 'coupe', 'car theft parks a blue coupe');
      check(theft.car !== null && theft.car._eventCar === true, 'car theft car is marked');
      teleport(game, theft.car.x, theft.car.y);
      pressE(game);
      check(s.player.inCar === theft.car, 'car theft: the coupe is entered');
      teleportCar(game, 200, 2200);
      stepN(game, 5);
      check(missionsMod.activeEvent(s) === null, 'car theft completes at the chop shop');
      const race = missionsMod.spawnEvent(s, 'taxi-race');
      check(!!race && race.checkpoints.length === 3, 'taxi race lays 3 checkpoints');
      const marker = missionsMod.eventMarker(s);
      check(marker !== null && Math.abs(marker.x - race.checkpoints[0].x) < 1, 'taxi race marker points at the first checkpoint');
      for (const cp of race.checkpoints) {
        teleport(game, cp.x, cp.y);
        stepN(game, 3);
      }
      check(missionsMod.activeEvent(s) === null, 'taxi race completes at the last checkpoint');

      // The new HUD lines draw without throwing, in every panel.
      hudMod.drawWantedHeat(ctx, s);
      check(true, 'wanted heat with the poster draws');
      s.player.inCar = theft.car;
      hudMod.drawCarCard(ctx, s);
      check(true, 'car card with flavour draws');
      hudMod.drawMissionTracker(ctx, s);
      check(true, 'mission tracker with dialogue draws');
      hudMod.drawJobBoard(ctx, s);
      check(true, 'job board with flavour draws');
      hudMod.drawRadioBadge(ctx, s);
      check(true, 'radio badge with the DJ line draws');
      s.ui.showGuide = true;
      hudMod.drawCityGuide(ctx, s);
      check(true, 'city guide with the secret draws');
      s.ui.showGuide = false;
      hudMod.drawHUD(ctx, s);
      check(true, 'full HUD with every second-wave line draws');
    } finally { endGame(game); }
  });

  await scenario('new-content-3', async () => {
    // Every row of every second-wave table is real: the data is
    // checked, not just counted, so a typo in a row fails here
    // instead of in front of the player.
    const playerMod = await import(join(SRC, 'player.js'));
    const tests = playerMod.ACHIEVEMENT_TESTS;
    for (const def of configMod.ACHIEVEMENTS) {
      check(typeof tests[def.test] === 'function', `achievement ${def.id} has a test`);
      check(typeof def.line === 'string' && def.line.length > 5, `achievement ${def.id} has a line`);
    }
    for (const target of configMod.BOUNTIES.targets) {
      check(typeof target.payout === 'number' && target.payout > 0, `bounty ${target.id} pays $${target.payout}`);
      check(typeof target.line === 'string' && target.line.length > 5, `bounty ${target.id} has a line`);
      check(typeof target.district === 'string' && target.district.length > 0, `bounty ${target.id} has a district`);
    }
    for (const g of configMod.GARAGES) {
      check(typeof g.price === 'number' && g.price > 0, `garage ${g.id} costs $${g.price}`);
      check(typeof g.x === 'number' && typeof g.y === 'number', `garage ${g.id} has a place`);
    }
    for (const lm of configMod.LANDMARKS) {
      check(typeof lm.line === 'string' && lm.line.length > 5, `landmark ${lm.name} has a line`);
      check(typeof lm.district === 'string' && lm.district.length > 0, `landmark ${lm.name} has a district`);
    }
    for (const st of configMod.RADIO_STATIONS) {
      check((configMod.RADIO_DJ_LINES[st.id] || []).length >= 5, `station ${st.id} has DJ patter`);
    }
    // Every street-event kind spawns on the engine it claims: the
    // combat kinds lay gunmen, the race kinds lay checkpoints, the
    // theft kinds park a car, the rush has a dropoff, the mugging
    // kinds have a victim. A fresh game per kind, so one event never
    // blocks the next — spawnEvent returns the active event otherwise.
    for (const kind of configMod.STREET_EVENTS.kinds) {
      const game = freshGame(7);
      try {
        game.start(false);
        const s = game.state;
        const ev = missionsMod.spawnEvent(s, kind.id);
        check(!!ev, `event ${kind.id} spawns`);
        if (!ev) continue;
        check(ev.kind === kind.id, `event ${kind.id} is itself`);
        check(ev.payout === kind.payout, `event ${kind.id} pays $${kind.payout}`);
        if (kind.enemies) {
          check(ev.enemies.length === kind.enemies, `event ${kind.id} spawns ${kind.enemies} gunmen`);
        }
        if (kind.checkpoints) {
          check(ev.checkpoints.length === kind.checkpoints, `event ${kind.id} lays ${kind.checkpoints} checkpoints`);
        }
        if (kind.id === 'stolen-car' || kind.id === 'car-theft') {
          check(!!ev.car && ev.car._eventCar === true, `event ${kind.id} parks a marked car`);
        }
        if (kind.id === 'package-rush') {
          check(!!ev.dropoff, 'package rush has a dropoff');
        }
        if (kind.id === 'mugging' || kind.id === 'rescue') {
          check(!!ev.victim, `event ${kind.id} has a victim`);
        }
      } finally { endGame(game); }
    }
    // The dialogue corpora are all the right voices.
    check(configMod.DELIA_LINES.length >= 30, `${configMod.DELIA_LINES.length} Delia lines`);
    check(configMod.SAL_LINES.length >= 25, `${configMod.SAL_LINES.length} Sal lines`);
    check(configMod.ROOK_LINES.length >= 25, `${configMod.ROOK_LINES.length} Rook lines`);
    check(configMod.DELIA_LINES.every((l) => l.startsWith('Delia Maren:')), 'every Delia line is Delia\'s');
    check(configMod.SAL_LINES.every((l) => l.startsWith('Old Sal:')), 'every Sal line is Sal\'s');
    check(configMod.ROOK_LINES.every((l) => l.startsWith('Rook:')), 'every Rook line is Rook\'s');
    check(Object.keys(configMod.DISTRICT_SECRETS).length === 10, 'every district keeps a secret');
    check(configMod.WANTED_POSTERS.length === 6, 'a poster for every star level');
    check(Object.keys(configMod.JOB_FLAVOUR).length === 6, 'a flavour line for every job type');
    check(Object.keys(configMod.CAR_FLAVOUR).length === 12, 'a flavour line for every car model');
  });

  await scenario('combat-melee', async () => {
    const game = freshGame(42);
    try {
      game.start(false);
      const s = game.state;
      // Melee: walk up to a ped and punch — the combo and the crime land.
      const ped = s.peds[0];
      check(!!ped, 'a ped exists to punch');
      teleport(game, ped.x - 20, ped.y);
      s.player.weapon = 'fists';
      keys.add('KeyF');
      game.step(STEP);
      keys.delete('KeyF');
      endFrame();
      check(s.player.wanted >= 0, 'melee attempt runs without throwing');
      // Pistol: aim at an enemy, fire, a bullet leaves the gun.
      const e = combatMod.spawnEnemy(s, s.player.x + 200, s.player.y);
      s.player.weapon = 'pistol';
      s.player.ammo = 12;
      aimAt(game, e.x, e.y);
      const fired = combatMod.shoot(s);
      check(fired === true, 'pistol fires');
      check(s.bullets.length >= 1, 'a bullet is in flight');
      check(s.stats.shotsFired >= 1, 'shot counted');
      // Reload: empty mag + R reloads (fireCd must expire first,
      // or the empty shot is swallowed by the cooldown).
      stepN(game, 15);
      s.player.ammo = 0;
      combatMod.shoot(s);
      stepN(game, 80);
      check(s.player.ammo === 12, 'auto-reload refills the mag');
    } finally { endGame(game); }
  });

  console.log('\n— summary —');
  for (const r of scenarioResults) {
    console.log(`  ${r.failed ? 'FAIL' : 'PASS'} ${r.name} (${r.checks} checks)`);
  }
  console.log(`\n${totalChecks - totalFailed} checks passed, ${totalFailed} scenario(s) failed, ${totalChecks} total`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

await main();
