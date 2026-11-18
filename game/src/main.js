// Port Solano — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and render.js paints what is there.
//
// ===========================================================================
// UNIFIED ARCHITECTURE (the one system every module agrees on)
// ===========================================================================
// Modes: 'title' | 'playing' | 'paused' | 'busted' | 'wasted' |
// 'missionComplete'. There is exactly one mode vocabulary; missions.js,
// police.js and combat.js all use it (they used to say 'play').
//
// Camera: state.camera is the TOP-LEFT of the 1280x720 viewport in world
// coords. Its centre is camera + (640, 360); traffic.js and peds.js spawn
// relative to that centre. combat.js aims mouse = camera + mouse (screen).
//
// Cars: state.cars holds EVERY car. state.traffic (AI traffic) and
// state.cops (police cars) are subsets — references to the same objects, so
// render.js draws one loop, collisions iterate one list, and nothing is
// spawned or drawn twice. state.copsFoot holds foot cops; state.enemies
// holds Harbor Kings gunmen; state.peds holds civilians.
//
// Who owns what (main.js only wires them together; it duplicates no logic):
//   player.js   on-foot movement, enter/exit car (NOT the E key)
//   vehicles.js car creation, player driving physics, damage/wreck, car-car collisions
//   traffic.js  AI traffic (spawn, follow, turn, despawn)
//   peds.js     pedestrians (walk, flee, panic, run-over, body cleanup)
//   police.js   wanted/heat, cop cars + foot cops, ram, bust, decay
//   combat.js   pistol/melee, bullets, enemies, ramming
//   missions.js the 6-mission campaign (Delia Maren), objectives, payout —
//               plus the data-driven side-job engine (taxi fares, delivery
//               gigs) and the mission metadata the HUD tracker reads —
//               plus the Most Wanted bounty board (six named Kings with a
//               price on each head) and the garage/safehouse system
//               (buy a roof, respawn there, free repair thrown in)
//   effects.js  particles, floating text, screen-shake decay, rain, barks
//   hud.js      HUD + minimap (render.js falls back if it throws) — now with
//               the stats screen, mission tracker, wanted heat bar, clock
//               and radio badge — plus the bounty tracker, the
//               achievements strip and the city guide (G key)
//   audio.js    WebAudio SFX + procedural music, eight radio stations (N cycles)
//   save.js     localStorage save/load (SAVE_KEY 'portsolano-save-v1')
//   world.js    the seeded city + road/building helpers + drawing — plus the
//               day/night cycle and the weather (rain grip, storms)
//   render.js   the one painter (world, cars, peds, cops, enemies, player,
//               bullets, particles, HUD)
//
// E-key ownership: main.js is the ONLY reader of E. Each frame it offers the
// press to missions.tryInteract() first (diner start/retry, vault crack);
// only if that declines does it enter/exit a car. One press, one action.
//
// Screen transitions: main.js owns setMode and the DOM overlays. Modules
// never set the mode directly — police.js raises state.bustPending and
// damagePlayer only clears alive; the frame loop converts those into
// setMode('busted') / setMode('wasted') via syncModeOverlay. The one
// exception is missions.js, which sets state.mode to 'missionComplete' and
// back to 'playing' around its 3.5 s hold; syncModeOverlay applies the
// overlay for that too, so a module-driven change can never desync the DOM.
//
// Wanted: heat 0..100, wanted = floor(heat / 20), cap 5 (police.js). Crimes
// add stars (fractional allowed); heat decays after 5 s out of cop sight.
//
// ?seed=N fixes the city and the traffic. ?shot=start|drive|chase|mission
// (with &seed=N) stages that scene, lets the real simulation run for 2 s,
// and sets window.__shotReady once it has painted 3 frames, for screenshots.
// While a shot settles, state.staging suppresses crimes (police.addWanted
// returns early) so the scene cannot bust the player before the screenshot.
import {
  CAMERA, GAME, MAX_FRAME, PEDS, PLAYER, ROAD, STEP, STORY, TIPS, TRAFFIC, VIEW,
  WEAPONS, WORLD,
} from './config.js';
import { createRandom, pick, rand, seedFromString, tipForSeed } from './random.js';
import { endFrame, initInput, keys, mouse, pressed } from './input.js';
import { generateWorld, createSkyState, randomSpawnOnRoad, setTimeOfDay, setWeather, updateSky } from './world.js';
import { drawGame } from './render.js';
import { audio } from './audio.js';
import { applySave, hasSave as hasSaveInStore, loadGame, saveDateLabel, saveGame as persistSave } from './save.js';
import { createPlayer, checkAchievements, tryEnterExitCar, updatePlayer } from './player.js';
import { createCar, pruneSkids, resolveCarCollisions, updatePlayerCar, updateWreckSmoke } from './vehicles.js';
import { spawnTrafficCar, updateTraffic } from './traffic.js';
import { spawnPeds, updatePeds } from './peds.js';
import { addWanted, damagePlayer, nearestCopDist, updatePolice } from './police.js';
import { updateCombat } from './combat.js';
import {
  MISSIONS, createBountyState, createEventState, createJobState, missionFailed, offerJobs, respawnPoint, startMission as startMissionMod, tryInteract, updateBounties, updateEvents, updateJobs, updateMission,
} from './missions.js';
import { addBark, addFloatText, spawnParticles, spawnRain, spawnSparks, updateParticles } from './effects.js';
import { normalizeShot } from './shots.js';

export const MODES = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  BUSTED: 'busted',
  WASTED: 'wasted',
  MISSION_COMPLETE: 'missionComplete',
};

const CAR_MODEL_KEYS = ['sedan', 'sedan', 'coupe', 'taxi', 'van', 'truck'];
const CAR_COLORS = ['#c94f43', '#4f7fa8', '#c9b458', '#8a8a80', '#4f8a5a', '#c9c9c2', '#7a5a8a', '#c97a3a'];

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Sound effects, via audio.js (WebAudio synthesis, no files). */
function playSound(name) {
  try {
    audio.sfx(name);
  } catch {
    // Sound is garnish; a missing audio context never breaks the game.
  }
}
/** Unlock the AudioContext from a user gesture; safe to call repeatedly. */
function ensureAudio() {
  try {
    audio.init();
  } catch {
    // Audio unavailable (no gesture yet, no AudioContext): stay silent.
  }
}

/** Fresh game state, per the unified contract (see the header comment). */
export function createGameState(seed) {
  const rng = createRandom(seed);
  const world = generateWorld(seed ^ 0x9e3779b9);
  const spawn = world.spawns.player;
  const player = createPlayer(spawn.x, spawn.y);
  player.money = GAME.startMoney;
  player.weapon = 'pistol';
  player.ammo = WEAPONS.pistol.ammo;
  return {
    time: 0,
    mode: MODES.TITLE,
    seed,
    player,
    cars: [],
    traffic: [],
    cops: [],
    copsFoot: [],
    peds: [],
    enemies: [],
    particles: [],
    floatTexts: [],
    bullets: [],
    // Skid marks (vehicles.js): initialised here so the state contract
    // always carries the array — render.js's drawSkids and pruneSkids
    // both tolerate an absent array, but a fresh game should start with
    // clean roads, not an undefined that only appears after the first
    // hard brake. Like particles, skids are cosmetic and are not saved.
    skids: [],
    mission: {
      index: -1, stage: 0, data: {}, objectiveText: '', waypoint: null, timer: 0,
      unlocked: 0, completed: [], active: false, brief: null, briefT: 0,
      failT: 0, completeT: 0,
    },
    camera: { x: clamp(spawn.x - VIEW.width / 2, 0, WORLD.width - VIEW.width), y: clamp(spawn.y - VIEW.height / 2, 0, WORLD.height - VIEW.height) },
    world,
    rng,
    audio,
    keys,
    mouse,
    shake: 0,
    bustProgress: 0,
    bustPending: false,
    staging: false,
    lastCrimeAt: -100,
    lastGunshot: null,
    lastExplosion: null,
    _pendingMission: -1,
    // The sky (day/night + weather, world.js), the side jobs and the
    // street events (missions.js) are state, not globals: a fresh game
    // starts at noon in clear weather with an empty job board and no
    // event, and a save restores the sky and the jobs. ui holds the HUD
    // toggles (T = stats screen) and the district banner memory.
    sky: createSkyState(),
    jobs: createJobState(),
    events: createEventState(),
    // The second wave, all state, not globals: the Most Wanted board
    // (missions.js), the achievement record (player.js) and the
    // garages Rook owns (missions.js). A fresh game starts with an
    // empty board, no titles and no roof — and a save restores all
    // three (save v3), so Continue resumes the same hunt, the same
    // titles and the same home.
    bounties: createBountyState(),
    achievements: { unlocked: [], lastUnlock: null, lastUnlockAt: 0 },
    garages: { owned: [], home: null },
    ui: { showStats: false, showGuide: false },
    // The career record. Every system writes its own counters here as
    // things happen (missions.js pays, combat.js kills, police.js
    // escapes, player.js steals); the stats screen only reads them.
    stats: {
      carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0,
      moneyEarned: 0, jobsDone: 0, jobMoney: 0, arrestsEscaped: 0,
      kills: 0, topSpeed: 0, timePlayed: 0,
    },
  };
}

/**
 * Create and run the game on `canvas`. Returns the game API
 * { state, start, step, setMode, saveGame, loadSave, destroy }.
 * `options` may carry { seed, shot } (the URL params are read when omitted).
 */
export function createGame(canvas, options) {
  const opts = options || {};
  let seed = opts.seed;
  if (seed === undefined || seed === null) {
    const fromUrl = (typeof window !== 'undefined')
      ? new URLSearchParams(window.location.search).get('seed') : null;
    seed = fromUrl !== null && fromUrl !== '' ? seedFromString(fromUrl) : Math.floor(Math.random() * 4294967296);
  } else if (typeof seed === 'string') {
    seed = seedFromString(seed);
  }
  const rawShot = opts.shot || ((typeof window !== 'undefined')
    ? new URLSearchParams(window.location.search).get('shot') : null);
  // Normalize a present-but-unknown ?shot= to 'start'; a missing one stays
  // null (no staging — the boot just shows the title). normalizeShot alone
  // would turn null into 'start' and stage on every boot.
  const shot = rawShot ? normalizeShot(rawShot) : null;

  const ctx = canvas.getContext('2d');
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;
  initInput(canvas);
  const state = createGameState(seed);
  state.shot = shot;
  state.audio = audio;
  // Shared hooks every module calls (police.js / effects.js self-wire these
  // too, but main.js assigns them explicitly before the loop).
  state.addWanted = (s, amount, reason) => addWanted(s, amount, reason);
  state.damagePlayer = (amount) => damagePlayer(state, amount);
  state.spawnParticles = (x, y, kind, n) => spawnParticles(state, x, y, kind, n);
  // Collision sparks ride the same hook pattern: vehicles.js fires
  // them on a hard hit, and the wiring lives here so a module never
  // has to know whether effects.js is loaded.
  state.spawnSparks = (x, y, n) => spawnSparks(state, x, y, n);
  // Floating text (payouts, honks, "RELOADING…") is the same wiring:
  // traffic.js honks through state.addFloatText, so it must exist here
  // or the honk is silent AND invisible.
  state.addFloatText = (x, y, text, color) => addFloatText(state, x, y, text, color);
  // Dialogue barks (peds.js) use the speech pill, not the plain text.
  state.addBark = (x, y, text, color) => addBark(state, x, y, text, color);
  const rng = state.rng;

  // -- DOM overlays (index.html). Missing elements are skipped, so the game
  //    still runs headless in a smoke-test harness. -------------------------
  const doc = (typeof document !== 'undefined') ? document : null;
  const el = (id) => (doc ? doc.getElementById(id) : null);
  const menuEl = el('menu');
  const pauseEl = el('pause');
  const briefEl = el('brief');
  const overEl = el('gameover');
  const statusEl = el('status');
  const briefTitleEl = el('brief-title');
  const briefTextEl = el('brief-text');
  const overTitleEl = el('over-title');
  const overTextEl = el('over-text');

  function showOverlay(which) {
    for (const [node, on] of [[menuEl, which === 'menu'], [pauseEl, which === 'pause'],
      [briefEl, which === 'brief'], [overEl, which === 'over']]) {
      if (!node) continue;
      node.classList.toggle('hidden', !on);
      node.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
  }
  function announce(message) {
    if (statusEl) statusEl.textContent = message;
  }
  function refreshMenuButtons() {
    const cont = el('menu-continue');
    // The title tip: one line of advice, picked by the seed, so the
    // same save always shows the same tip. The tip is the manual in
    // one line — the player reads it while deciding whether to start.
    const tipEl = el('menu-tip');
    if (tipEl) tipEl.textContent = `Tip: ${tipForSeed(state.seed, TIPS)}`;
    if (!cont) return;
    cont.disabled = !hasSave();
    // The Continue button shows when the save was written ("Continue —
    // saved Nov 18, 09:12"), so the player can tell this session's save
    // from an old one. No timestamp → the plain label.
    if (!cont.disabled) {
      try {
        const label = saveDateLabel(loadGame());
        cont.textContent = label ? `Continue — saved ${label}` : 'Continue';
      } catch {
        cont.textContent = 'Continue';
      }
    } else {
      cont.textContent = 'Continue';
    }
  }

  // -- Mode / screens ------------------------------------------------------------
  // state.mode is the single source of truth. setMode applies the DOM side
  // effects; syncModeOverlay (run every frame) applies them for changes a
  // module made directly (missions.js missionComplete hold).
  let lastMode = state.mode;
  function applyOverlay(mode) {
    if (mode === MODES.TITLE) { showOverlay('menu'); refreshMenuButtons(); }
    else if (mode === MODES.PAUSED) showOverlay('pause');
    else if (mode === MODES.BUSTED || mode === MODES.WASTED) showOverlay('over');
    else showOverlay(null);
  }
  function setMode(next) {
    state.mode = next;
    lastMode = next;
    applyOverlay(next);
  }
  function syncModeOverlay() {
    if (state.mode !== lastMode) {
      lastMode = state.mode;
      applyOverlay(state.mode);
    }
  }

  function showMissionBrief() {
    const def = MISSIONS[0];
    if (briefTitleEl) briefTitleEl.textContent = `Mission 1 — ${def.title}`;
    if (briefTextEl) briefTextEl.textContent = def.brief.join(' ');
    showOverlay('brief');
  }

  // -- Save / load, via save.js (one localStorage key, plain JSON). ----------
  //    The save shape is save.js's: money, missionIndex (highest unlocked),
  //    player { x, y, hp, armor, weapon, ammo }, completedMissions, time.
  //    Mid-mission stage/timer is NOT restored: Continue restarts the next
  //    unlocked job from its beginning.
  function hasSave() {
    try {
      return hasSaveInStore();
    } catch {
      return false;
    }
  }
  function saveGame() {
    try {
      return persistSave(state);
    } catch {
      return false;
    }
  }
  function loadSave() {
    let data = null;
    try {
      data = loadGame();
    } catch {
      data = null;
    }
    if (!data) return false;
    try {
      applySave(state, data);
    } catch {
      return false;
    }
    state.cops = [];
    state.copsFoot = [];
    state.enemies = [];
    state.bullets = [];
    state.bustPending = false;
    state.bustProgress = 0;
    const next = state.mission.unlocked ?? 0;
    state._pendingMission = next < MISSIONS.length ? next : -1;
    return true;
  }

  // -- Spawning ---------------------------------------------------------------
  function spawnParkedCar() {
    let spot = randomSpawnOnRoad(state.world, rng);
    for (let tries = 0; tries < 10; tries += 1) {
      let free = true;
      for (const car of state.cars) {
        if (dist(car.x, car.y, spot.x, spot.y) < 80) { free = false; break; }
      }
      if (free) break;
      spot = randomSpawnOnRoad(state.world, rng);
    }
    const model = pick(rng, CAR_MODEL_KEYS);
    const side = rng() < 0.5 ? -1 : 1;
    const car = createCar(model,
      spot.x + (Math.abs(Math.cos(spot.angle)) > 0.5 ? 0 : side * 34),
      spot.y + (Math.abs(Math.cos(spot.angle)) > 0.5 ? side * 34 : 0),
      spot.angle, { driver: 'none', color: pick(rng, CAR_COLORS) });
    state.cars.push(car);
    return car;
  }
  function populateCity() {
    state.cars = [];
    state.traffic = [];
    state.cops = [];
    state.copsFoot = [];
    state.peds = [];
    state.enemies = [];
    state.bullets = [];
    state.particles = [];
    state.floatTexts = [];
    for (let tries = 0; tries < 80 && state.traffic.length < TRAFFIC.cars; tries += 1) {
      spawnTrafficCar(state);
    }
    for (let i = 0; i < 6; i += 1) spawnParkedCar();
    for (let tries = 0; tries < 20 && state.peds.length < PEDS.count; tries += 1) {
      spawnPeds(state);
    }
  }

  // -- Missions ----------------------------------------------------------------
  function startMission(index, stage) {
    return startMissionMod(state, index, stage || 0);
  }

  function startGame(fromSave) {
    const p = state.player;
    if (!fromSave) {
      p.x = state.world.spawns.player.x;
      p.y = state.world.spawns.player.y;
      p.angle = -Math.PI / 2;
      p.hp = PLAYER.maxHp;
      p.armor = 0;
      p.money = GAME.startMoney;
      p.weapon = 'pistol';
      p.ammo = WEAPONS.pistol.ammo;
      p.inCar = null;
      p.wanted = 0;
      p.heat = 0;
      p.alive = true;
      p.speed = 0;
      p.walkPhase = 0;
      state.mission.unlocked = 0;
      state.mission.completed = [];
      // A new game starts the whole career over — the stats, the
      // bounty board, the achievements and the garages — so a second
      // playthrough does not inherit the first one's roof or titles.
      state.stats = {
        carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0,
        moneyEarned: 0, jobsDone: 0, jobMoney: 0, arrestsEscaped: 0,
        kills: 0, topSpeed: 0, timePlayed: 0, eventsDone: 0,
        eventsEarned: 0, bountiesDone: 0, bountiesEarned: 0,
      };
      state.bounties = createBountyState();
      state.achievements = { unlocked: [], lastUnlock: null, lastUnlockAt: 0 };
      state.garages = { owned: [], home: null };
      state.bustProgress = 0;
      state.bustPending = false;
      populateCity();
      startMission(0, 0);
    }
    snapCamera();
    setMode(MODES.PLAYING);
    announce('Playing. Follow the gold marker.');
    playSound('click');
  }

  function clearCops() {
    for (const cop of state.cops.slice()) {
      const ci = state.cars.indexOf(cop);
      if (ci >= 0) state.cars.splice(ci, 1);
    }
    state.cops = [];
    state.copsFoot = [];
  }

  function doBusted() {
    state.bustPending = false;
    if (state.mission.active) missionFailed(state, 'You got busted.');
    if (overTitleEl) overTitleEl.textContent = 'BUSTED';
    if (overTextEl) {
      overTextEl.textContent = `Solano PD cuffed Rook on the street. Bail and the impound bill come to $${GAME.bustedFine} — the car, if it was yours, is gone.`;
    }
    setMode(MODES.BUSTED);
    announce('Busted.');
  }

  function doWasted() {
    if (state.mission.active) missionFailed(state, 'You got wasted.');
    if (overTitleEl) overTitleEl.textContent = 'WASTED';
    if (overTextEl) {
      overTextEl.textContent = `Rook went down in Port Solano. The medics patched you up at the marina clinic — $${GAME.wastedFine} lighter, but alive.`;
    }
    setMode(MODES.WASTED);
    announce('Wasted.');
  }

  function respawnAfterFail() {
    const p = state.player;
    const fine = state.mode === MODES.BUSTED ? GAME.bustedFine : GAME.wastedFine;
    p.money = Math.max(0, p.money - fine);
    p.hp = PLAYER.maxHp;
    p.armor = 0;
    p.wanted = 0;
    p.heat = 0;
    p.alive = true;
    p.inCar = null;
    // The respawn point is the home garage when Rook owns one, the
    // marina when he does not — a garage is a roof, and a roof is
    // where you wake up. The announce line names it, so the player
    // knows the purchase moved their mornings.
    const home = respawnPoint(state);
    p.x = home.x;
    p.y = home.y;
    p.angle = -Math.PI / 2;
    p.speed = 0;
    state.bustProgress = 0;
    state.bustPending = false;
    clearCops();
    state.enemies = [];
    state.bullets = [];
    snapCamera();
    setMode(MODES.PLAYING);
    announce('Back on the streets of Port Solano.');
  }

  // -- Camera -------------------------------------------------------------------
  // state.camera is the viewport TOP-LEFT in world coords (unified convention).
  function snapCamera() {
    const focus = state.player;
    state.camera.x = clamp(focus.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    state.camera.y = clamp(focus.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
  }
  function updateCamera(dt) {
    const focus = state.player;
    const tx = clamp(focus.x - VIEW.width / 2, 0, WORLD.width - VIEW.width);
    const ty = clamp(focus.y - VIEW.height / 2, 0, WORLD.height - VIEW.height);
    const k = 1 - Math.exp(-CAMERA.lerp * dt);
    state.camera.x += (tx - state.camera.x) * k;
    state.camera.y += (ty - state.camera.y) * k;
    // Shake decay lives in effects.updateParticles; main.js never decays it.
  }

  // -- One fixed step --------------------------------------------------------------
  function step(dt) {
    state.time += dt;
    if (state.stats) state.stats.timePlayed = (state.stats.timePlayed || 0) + dt;
    if (state.mode === MODES.TITLE) {
      // The title screen's city is alive: traffic and peds move, no crimes.
      // The clock runs here too, so the title vista drifts through the day.
      updateSky(state, dt);
      updateTraffic(state, dt);
      updatePeds(state, dt);
      updateParticles(state, dt);
      // Slow cinematic pan across downtown.
      const cx = 1800 + Math.sin(state.time * 0.05) * 500;
      const cy = 1200 + Math.cos(state.time * 0.04) * 260;
      state.camera.x = clamp(cx - VIEW.width / 2, 0, WORLD.width - VIEW.width);
      state.camera.y = clamp(cy - VIEW.height / 2, 0, WORLD.height - VIEW.height);
      return;
    }
    if (state.mode === MODES.MISSION_COMPLETE) {
      // The celebration hold: only the mission timer, particles and camera run.
      updateMission(state, dt);
      updateParticles(state, dt);
      updateCamera(dt);
      return;
    }
    if (state.mode !== MODES.PLAYING) return;

    // E is owned by main.js: the mission gets first refusal (diner start /
    // retry, vault crack); otherwise it enters / exits a car.
    if (pressed.has('KeyE')) {
      if (!tryInteract(state)) tryEnterExitCar(state);
    }

    // On foot or driving — never both in one step.
    if (state.player.inCar) updatePlayerCar(state, dt);
    else updatePlayer(state, dt);

    // Wrecking the player's car can kill the player (damagePlayer via the
    // vehicles hook); check before the rest of the frame runs.
    if (!state.player.alive) { doWasted(); return; }

    updateCombat(state, dt);
    updateTraffic(state, dt);
    resolveCarCollisions(state, dt);
    updatePeds(state, dt);
    updatePolice(state, dt);
    // The sky, the side jobs and the street events tick with the
    // world: the clock always advances, the weather only changes in
    // free roam (updateSky enforces that), and rain spawns its streaks
    // while it falls. None of these touch the campaign — the mission
    // lock in updateSky/updateJobs/updateEvents is what keeps a storm
    // from re-rolling Heat Wave mid-chase and an event from spawning
    // on top of a story job.
    updateSky(state, dt);
    updateJobs(state, dt);
    updateEvents(state, dt);
    updateBounties(state, dt);
    // Achievements: checked once a second, not every step — the scan
    // is a pass over counters the game already keeps, but sixty
    // passes a second is still sixty passes, and a milestone does not
    // need to land in the same 1/60 s the counter crossed it.
    state._achT = (state._achT || 0) + dt;
    if (state._achT >= 1) {
      state._achT = 0;
      checkAchievements(state);
    }
    spawnRain(state, dt);
    // Wrecked cars burn (smoke + sparks for the first 6 s after the wreck).
    updateWreckSmoke(state, dt);
    // Skid marks fade: drop any older than SKID_LIFE so the array never
    // holds stale marks from a chase that ended minutes ago.
    pruneSkids(state);
    updateParticles(state, dt);

    // Foot-cop bust and death are the only two ways out of 'playing' here.
    if (state.bustPending) { doBusted(); return; }
    if (!state.player.alive) { doWasted(); return; }

    // Bust meter for the HUD fallback is owned by police.js (it sees both
    // the foot cops and the car swarm); see updatePolice.
    updateMission(state, dt);
    updateCamera(dt);
  }

  // -- Frame handling ----------------------------------------------------------------
  function handleFrameKeys() {
    if (pressed.has('KeyP') || pressed.has('Escape')) {
      if (state.mode === MODES.PLAYING) { setMode(MODES.PAUSED); announce('Paused.'); playSound('click'); }
      else if (state.mode === MODES.PAUSED) { setMode(MODES.PLAYING); announce('Playing.'); }
    }
    if (pressed.has('Enter') || pressed.has('Space')) {
      ensureAudio();
      if (state.mode === MODES.TITLE) showMissionBrief();
      else if (state.mode === MODES.BUSTED || state.mode === MODES.WASTED) respawnAfterFail();
    }
    if (pressed.has('KeyR') && (state.mode === MODES.BUSTED || state.mode === MODES.WASTED)) respawnAfterFail();
    // M is owned by audio.js: it toggles the procedural music on/off.
    // N is owned by audio.js too: it cycles the radio station.
    // T is the stats screen (this module owns the toggle; hud.js draws it).
    if (pressed.has('KeyT') && (state.mode === MODES.PLAYING || state.mode === MODES.PAUSED)) {
      state.ui.showStats = !state.ui.showStats;
      playSound('click');
    }
    // G is the city guide (this module owns the toggle; hud.js draws
    // it). It opens over the live game like the stats screen, and
    // closing it returns to the street — the world never pauses for
    // a tour, so the guide is a glance, not a menu.
    if (pressed.has('KeyG') && (state.mode === MODES.PLAYING || state.mode === MODES.PAUSED)) {
      state.ui.showGuide = !state.ui.showGuide;
      if (state.ui.showGuide) state.ui.showStats = false;
      playSound('click');
    }
  }

  // -- DOM button wiring --------------------------------------------------------------
  function wireButton(id, fn) {
    const node = el(id);
    if (node) node.addEventListener('click', fn);
  }
  wireButton('menu-new', () => { ensureAudio(); showMissionBrief(); });
  wireButton('menu-continue', () => {
    ensureAudio();
    if (loadSave()) {
      populateCity();
      snapCamera();
      const next = state._pendingMission;
      state._pendingMission = -1;
      if (next >= 0) startMission(next, 0);
      setMode(MODES.PLAYING);
      announce('Welcome back to Port Solano.');
    }
  });
  wireButton('pause-resume', () => { setMode(MODES.PLAYING); announce('Playing.'); });
  wireButton('pause-restart', () => startGame(false));
  wireButton('pause-save-quit', () => {
    saveGame();
    setMode(MODES.TITLE);
    announce('Saved. See you back in Port Solano.');
  });
  wireButton('brief-continue', () => {
    ensureAudio();
    if (state.mode === MODES.MISSION_COMPLETE) { setMode(MODES.PLAYING); return; }
    startGame(false);
  });
  wireButton('over-restart', () => respawnAfterFail());
  wireButton('over-menu', () => setMode(MODES.TITLE));
  if (doc) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden && state.mode === MODES.PLAYING) { setMode(MODES.PAUSED); announce('Paused.'); }
    });
  }

  // -- ?shot= staging -------------------------------------------------------------------
  function stageShot(name) {
    populateCity();
    const p = state.player;
    if (name === 'drive') {
      // Clear avenue 1000 first: populateCity scatters traffic and
      // parked cars at random road points, and one of them can land in
      // the shot car's lane — a slow cruiser ahead, or a parked car in
      // the path. The shot car coasts from 320 and rear-ends it during
      // the 2 s settle, so the shot shows a stopped, dented car instead
      // of a drive. The four staged cars below are the only traffic on
      // this avenue, all pinned to cruise 200, so the formation holds.
      const onAvenue = (c) => Math.abs(c.x - 1000) < 60;
      state.traffic = state.traffic.filter((c) => !onAvenue(c));
      state.cars = state.cars.filter((c) => !onAvenue(c));
      const car = createCar('coupe', 1000, 1200, Math.PI / 2, { driver: 'player', color: '#c94f43' });
      state.cars.push(car);
      p.inCar = car;
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      car.speed = 320;
      // Traffic ahead and behind on the same avenue, clear of the player's car.
      // The staged cars are pinned to cruise 200 (the speed they are
      // placed at): spawnTrafficCar gives each car a random cruise, and
      // a fast one behind the coasting shot car rear-ends it during the
      // 2 s settle, so the shot shows a stopped, dented car instead of
      // a drive. The formation holds because every car cruises at 200.
      const offsets = [-560, -300, 300, 560];
      for (let i = 0; i < 4; i += 1) {
        const t = spawnTrafficCar(state);
        if (!t) continue;
        t.x = 1000 + (i % 2 === 0 ? -24 : 24);
        t.y = 1200 + offsets[i];
        t.axis = 'v';
        t.angle = Math.PI / 2;
        t.dir = 1;
        t.speed = 200;
        t.cruiseSpeed = 200;
        t.cruise = 200;
        t.targetSpeed = 200;
      }
      setMode(MODES.PLAYING);
    } else if (name === 'chase') {
      const car = createCar('sedan', 1800, 1000, 0, { driver: 'player', color: '#4f7fa8' });
      state.cars.push(car);
      p.inCar = car;
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      car.speed = 380;
      // Staged wanted level, set directly: addWanted is suppressed while
      // staging, so the scene holds 3 stars for the screenshot.
      p.heat = 3 * 20;
      p.wanted = 3;
      state.lastCrimeAt = state.time;
      for (let i = 0; i < 2; i += 1) {
        const cop = createCar('police', 1800 - 180 - i * 120, 1000 + (i === 0 ? -24 : 24), 0,
          { driver: 'ai', siren: true, color: '#20242e' });
        cop.speed = 360;
        state.cars.push(cop);
        state.cops.push(cop);
      }
      setMode(MODES.PLAYING);
    } else if (name === 'mission') {
      startMission(0, 0);
      // Put the player in Delia's sedan so the shot shows the job underway.
      const missionCar = state.cars.find((c) => c.id === state.mission.data.carId);
      if (missionCar) {
        missionCar.driver = 'player';
        p.inCar = missionCar;
        p.x = missionCar.x; p.y = missionCar.y; p.angle = missionCar.angle;
        missionCar.speed = 200;
      } else {
        const car = createCar('sedan', 1400, 1800, -Math.PI / 2, { driver: 'player', color: '#c9b458' });
        state.cars.push(car);
        p.inCar = car;
        p.x = car.x; p.y = car.y; p.angle = car.angle;
        car.speed = 200;
      }
      setMode(MODES.PLAYING);
    } else if (name === 'night') {
      // Midnight: the clock at 0, a Comet GT on the avenue, headlights on.
      setTimeOfDay(state, 0);
      setWeather(state, 'clear');
      const car = createCar('sports', 1400, 1000, Math.PI / 2, { driver: 'player', color: '#7a5a8a' });
      state.cars.push(car);
      p.inCar = car;
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      car.speed = 300;
      setMode(MODES.PLAYING);
    } else if (name === 'jobs') {
      // Free roam with a fare on the board: the player in a taxi near a
      // pickup, the job tracker live. The board is offered by updateJobs
      // in free roam; stage it directly so the shot is deterministic.
      const car = createCar('taxi', 600, 600, 0, { driver: 'player', color: '#f2c94c' });
      state.cars.push(car);
      p.inCar = car;
      p.x = car.x; p.y = car.y; p.angle = car.angle;
      car.speed = 0;
      offerJobs(state);
      setMode(MODES.PLAYING);
    } else {
      // 'start' and anything else: the title screen over a living city vista.
      setMode(MODES.TITLE);
    }
    snapCamera();
    // Let the real simulation settle for two seconds so traffic has spread out.
    // Crimes are suppressed while staging so the scene cannot bust the player.
    state.staging = true;
    for (let i = 0; i < Math.round(GAME.shotSettleSeconds / STEP); i += 1) step(STEP);
    state.staging = false;
    snapCamera();
  }

  // -- The loop ---------------------------------------------------------------------------
  // Engine hum + siren follow the game every frame; both no-op until audio.init().
  function updateAudio() {
    try {
      const p = state.player;
      const speed01 = p.inCar ? Math.abs(p.inCar.speed) / p.inCar.maxSpeed : 0;
      audio.engine(speed01);
      if (p.wanted > 0 && state.cops.length > 0) {
        audio.setSiren(nearestCopDist(state));
      } else {
        audio.setSiren(null);
      }
    } catch {
      // Audio never breaks the frame.
    }
  }

  let accumulator = 0;
  let last = (typeof performance !== 'undefined') ? performance.now() : 0;
  let painted = 0;
  let rafId = 0;
  let destroyed = false;

  function frame(now) {
    if (destroyed) return;
    const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
      ? window.requestAnimationFrame.bind(window) : requestAnimationFrame;
    rafId = raf(frame);
    accumulator += Math.min(((now - last) / 1000) || 0, MAX_FRAME);
    last = now;
    handleFrameKeys();
    while (accumulator >= STEP
      && (state.mode === MODES.TITLE || state.mode === MODES.PLAYING || state.mode === MODES.MISSION_COMPLETE)) {
      step(STEP);
      accumulator -= STEP;
      if (state.mode !== MODES.TITLE && state.mode !== MODES.PLAYING && state.mode !== MODES.MISSION_COMPLETE) {
        accumulator = 0;
        break;
      }
    }
    if (state.mode !== MODES.TITLE && state.mode !== MODES.PLAYING && state.mode !== MODES.MISSION_COMPLETE) {
      accumulator = 0;
    }
    syncModeOverlay();
    updateAudio();
    drawGame(ctx, state);
    endFrame();
    painted += 1;
    if (shot && painted >= 3 && typeof window !== 'undefined') window.__shotReady = true;
  }

  const api = {
    state,
    get mode() { return state.mode; },
    start: startGame,
    step,
    setMode,
    saveGame,
    loadSave,
    hasSave,
    startMission,
    stageShot,
    missions: MISSIONS,
    destroy() {
      destroyed = true;
      if (typeof window !== 'undefined' && window.cancelAnimationFrame && rafId) {
        window.cancelAnimationFrame(rafId);
      }
      // Stop the audio subsystems too: without this a destroyed game left
      // a running music setInterval and live engine/siren oscillators.
      try { state.audio?.shutdown?.(); } catch { /* audio is best-effort */ }
    },
  };

  // Boot: populate the city, stage a ?shot scene if asked, show the menu.
  populateCity();
  refreshMenuButtons();
  if (shot) stageShot(shot);
  else setMode(MODES.TITLE);
  announce(`${STORY.city}. Press Enter or click New Game to start.`);
  const raf = (typeof window !== 'undefined' && window.requestAnimationFrame)
    ? window.requestAnimationFrame.bind(window) : requestAnimationFrame;
  rafId = raf(frame);
  return api;
}

// Auto-boot in the browser: index.html loads this module, and the canvas is
// already in the document by then.
export let game = null;
if (typeof document !== 'undefined' && document.getElementById) {
  const canvas = document.getElementById('game');
  if (canvas) {
    game = createGame(canvas);
    if (typeof window !== 'undefined') window.__portSolanoGame = game;
  }
}
