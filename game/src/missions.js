// Port Solano — story missions.
//
// Six jobs for Rook, handed out by Delia Maren at her diner (the gold "R"
// marker, 600,600). The rival crew is the Harbor Kings, led by Sal Moretti.
// All characters, places and dialogue are original.
//
// Mission 1 folds the original marina job into the campaign: Delia's sedan,
// the marina pier pickup (hold 3 s in the circle), then the Solano Arms
// hotel delivery — the same job the first build shipped, now as job one of
// six ($500 / $800 / $1000 / $1200 / $1500 / $5000).
//
// Flow: updateMission runs every frame while playing. With no mission active
// and the player near the diner, E starts the next unlocked job (or retries
// a failed one). Completing a job pays out, sets mode='missionComplete' for
// ~3.5 s, then returns to free roam. Failing (timer out / wasted / busted)
// leaves the job pending at the diner for a retry.
//
// E-KEY OWNERSHIP: this module never reads the key state itself. main.js
// owns E and calls tryInteract(state) once per frame; tryInteract returns
// true when the press started / retried a job or worked a mission prompt
// (the vault), and main.js only then falls through to enter/exit car. That
// is the whole edge handling — no poll loop, no stale prev flag.
import { addWanted, clearWanted } from './police.js';
import { saveGame } from './save.js';
import { spawnParticles, addFloatText } from './effects.js';
import { spawnEnemy } from './combat.js';
import { createCar, repairCar } from './vehicles.js';
import { createPed, busiestSpot, crowdReaction } from './peds.js';
import { roadPointNear } from './world.js';
import { coinFlip } from './random.js';
import { BOUNTIES, DELIA_LINES, GARAGES, JOB_FLAVOUR, MISSIONS as CFG_MISSIONS, SAL_LINES, SIDE_JOBS, STREET_EVENTS, WANTED } from './config.js';

export const LOC = {
  diner: { x: 600, y: 600 }, // Delia's diner — the "R" marker
  docks: { x: 3000, y: 2200 },
  marina: { x: 3000, y: 200 },
  marinaPier: { x: 732, y: 2140 }, // the pier pickup from the original Mission 1
  hotel: { x: 2600, y: 600 }, // Solano Arms hotel
  chopShop: { x: 200, y: 2200 },
  motel: { x: 1400, y: 200 },
  warehouse: { x: 2200, y: 1800 },
  bank: { x: 1400, y: 1000 },
  safehouse: { x: 200, y: 600 },
};

const COMPLETE_HOLD = 3.5; // seconds the MISSION COMPLETE screen holds
const BRIEF_HOLD = 7; // seconds the opening dialogue stays on screen
const PICKUP_HOLD = CFG_MISSIONS.pickupSeconds; // seconds inside the pickup circle

function distTo(state, pt) {
  return Math.hypot(state.player.x - pt.x, state.player.y - pt.y);
}

function near(state, pt, r = 90) {
  return distTo(state, pt) <= r;
}

function setObjective(state, text, waypoint = null) {
  state.mission.objectiveText = text;
  state.mission.waypoint = waypoint ? { x: waypoint.x, y: waypoint.y } : null;
}

// Spawn a mission car into state.cars (driver 'none' = parked, enterable).
// `angle` faces the car toward the job's first leg, so the player is not
// parked nose-first into the block next door: Delia's sedan faces south
// down the avenue to the pier, the marina coupe faces west toward town.
function spawnMissionCar(state, model, x, y, color, maxSpeed, angle = 0, opts = {}) {
  if (!state.cars) state.cars = [];
  const car = createCar(model, x, y, angle, {
    color,
    driver: 'none',
    maxSpeed,
    id: `mission-${model}-${Math.floor((state.rng || Math.random)() * 1e9)}`,
    // A mission car can be tougher than its model (opts.health): the Heat
    // Wave getaway coupe is armored for a 120 s chase, because the stock
    // coupe (80 hp) dies under 3-star cop rams in ~5 s and the mission
    // is unwinnable in it. maxHealth follows health so the damage smoke
    // (health < 40) and the HUD read the right scale.
    health: opts.health,
    maxHealth: opts.health,
  });
  state.cars.push(car);
  return car;
}

function ensureWanted(state, stars) {
  const p = state.player;
  if (p.wanted < stars) addWanted(state, stars - p.wanted, 'heat');
}

// The other half of ensureWanted: hold the heat DOWN to `stars`. A
// mission that sets its own wanted level owns it in both directions —
// without the cap, a ped caught on a crosswalk during Heat Wave's
// survive phase pushes the heat to 4–5 stars and the mission's
// scripted 3-star survival becomes a 5-star siege the 400 hp coupe
// was never tuned for. The cap only ever lowers heat, and only while
// the calling mission asks for it.
function capWanted(state, stars) {
  const p = state.player;
  const cap = stars * WANTED.heatPerStar;
  if (p.heat > cap) {
    p.heat = cap;
    p.wanted = stars;
  }
}

export const MISSIONS = [
  {
    id: 'welcome-home',
    title: 'Welcome Home',
    payout: 500,
    brief: [
      'Delia Maren: "Rook. Back in Port Solano at last — and already broke, I bet."',
      'Delia Maren: "Take my sedan down to the marina pier. A package came in with your name on it."',
      'Rook: "One package. No questions. Got it, Delia."',
    ],
    start(state) {
      // On the avenue centreline (diner.x = 600), not diner.x + 60: +60
      // put the sedan at x=660, on the sidewalk (avenue 600's road band
      // ends at 648), so the first thing a new driver did was plough
      // down the sidewalk through the peds walking it — one run-over,
      // wanted 2, and the 100hp sedan died under cop rams before the
      // pier. A car Delia hands over starts in the road.
      const car = spawnMissionCar(state, 'sedan', LOC.diner.x, LOC.diner.y + 40, '#7a1f1f', 380, Math.PI / 2);
      state.mission.data.carId = car.id;
      setObjective(state, "Get in Delia's sedan.", { x: car.x, y: car.y });
    },
    update(state, dt) {
      const m = state.mission;
      if (m.stage === 0) {
        if (state.player.inCar && state.player.inCar.id === m.data.carId) {
          m.stage = 1;
          setObjective(state, 'Drive the sedan to the marina pier.', LOC.marinaPier);
        }
      } else if (m.stage === 1) {
        if (near(state, LOC.marinaPier, CFG_MISSIONS.waypointRadius)) {
          m.stage = 2;
          m.timer = PICKUP_HOLD;
          setObjective(state, 'Pick up the package — stay in the circle.', LOC.marinaPier);
        }
      } else if (m.stage === 2) {
        if (near(state, LOC.marinaPier, CFG_MISSIONS.waypointRadius)) {
          m.timer -= dt;
          if (m.timer <= 0) {
            m.stage = 3;
            setObjective(state, 'Deliver the package to the Solano Arms hotel.', LOC.hotel);
            state.audio?.sfx?.('pickup');
          }
        } else {
          m.timer = PICKUP_HOLD;
        }
      } else if (m.stage === 3) {
        if (near(state, LOC.hotel, CFG_MISSIONS.waypointRadius)) missionComplete(state);
      }
    },
  },
  {
    id: 'hot-wheels',
    title: 'Hot Wheels',
    payout: 800,
    brief: [
      'Delia Maren: "A coupe is sitting in the marina lot, keys in it, owner in the bar."',
      'Delia Maren: "Borrow it. Permanently. The chop shop pays good money for that model."',
      'Rook: "Borrow. Right. I will try not to scratch the paint."',
    ],
    start(state) {
      // The coupe is armored (400 hp, not the stock coupe's 80): it has
      // to survive a 2-star chase across town, and a wanted escalation
      // to 4 (two ped run-overs at an intersection) puts 4 cop cars on
      // it ramming 10-14 dmg each — the stock 80hp coupe died in ~6 s
      // under that, and even 250hp wrecked on the south leg (~1 ram/s
      // over the ~25 s drive at the 200px/s ped-safe speed). Same reason
      // the Heat Wave getaway coupe is armored to 400.
      const car = spawnMissionCar(state, 'coupe', LOC.marina.x - 40, LOC.marina.y + 40, '#c8a020', 560, Math.PI, { health: 400 });
      state.mission.data.carId = car.id;
      setObjective(state, 'Steal the coupe from the marina lot.', LOC.marina);
    },
    update(state, dt) {
      const m = state.mission;
      if (m.stage === 0) {
        if (state.player.inCar && state.player.inCar.id === m.data.carId) {
          m.stage = 1;
          addWanted(state, 2, 'steal');
          setObjective(state, 'Deliver it to the chop shop — the cops are on you.', LOC.chopShop);
        }
      } else if (m.stage === 1) {
        if (near(state, LOC.chopShop)) missionComplete(state);
      }
    },
  },
  {
    id: 'the-drop',
    title: 'The Drop',
    payout: 1000,
    brief: [
      'Delia Maren: "A package needs to be at the north motel in ninety seconds. Not ninety-one."',
      'Delia Maren: "The buyer does not wait, Rook. Neither do I."',
      'Rook: "Ninety seconds. I know these streets better than my own name."',
    ],
    start(state) {
      state.mission.timer = 90;
      // The total is what the HUD's countdown bar measures against — the
      // bar shows the fraction of the 90 s left, not just the number.
      state.mission.timerTotal = 90;
      setObjective(state, 'Deliver the package to the north motel — 90s left.', LOC.motel);
    },
    update(state, dt) {
      const m = state.mission;
      m.timer -= dt;
      if (m.timer <= 0) {
        missionFailed(state, 'Out of time — the buyer walked away.');
        return;
      }
      setObjective(
        state,
        `Deliver the package to the north motel — ${Math.ceil(m.timer)}s left.`,
        LOC.motel,
      );
      if (near(state, LOC.motel)) missionComplete(state);
    },
  },
  {
    id: 'heat-wave',
    title: 'Heat Wave',
    payout: 1200,
    brief: [
      'Delia Maren: "Sal Moretti tipped the police about you. Three stars, Rook, and climbing."',
      'Delia Maren: "Survive two minutes. Then vanish. No hero moves — just gone."',
      'Rook: "Two minutes of heat? I have survived worse Mondays."',
    ],
    start(state) {
      ensureWanted(state, 3);
      state.mission.timer = 120;
      state.mission.timerTotal = 120;
      // A getaway car: Heat Wave is a DRIVING survival, and on foot it is
      // over in seconds — a foot cop touches the player for 1.5s and the
      // bust lands, and the cop-car swarm shoves an on-foot player into
      // the same meter. The baseline run busted an on-foot player at 7.4s.
      // If the player drove to the diner they keep their car; if they
      // walked, Delia leaves a coupe by the door (the fiction already has
      // her handing Rook cars — mission 1's sedan spawns the same way).
      // Without this the mission is unwinnable as designed.
      if (!state.player.inCar) {
        // Armored (400 hp, not the stock coupe's 80): the chase is 120 s
        // at 3 stars, and a stock coupe dies under cop rams in ~5 s —
        // the mission is unwinnable in it. Delia's getaway car is
        // reinforced for the job, and the fiction already has her handing
        // Rook cars (mission 1's sedan spawns the same way).
        // Facing NORTH (-PI/2): the survival loop runs north up avenue
        // 600 first, and a south-facing car has to U-turn at the diner
        // intersection — it wedged on the southeast block corner and
        // reversed into the wall instead.
        // Same centreline spawn as Mission 1's sedan (see there): the
        // getaway coupe used to appear at diner.x + 60 = 660, on the
        // sidewalk, and the first turn east swept the peds walking it.
        const car = spawnMissionCar(state, 'coupe', LOC.diner.x, LOC.diner.y + 40, '#c8a020', 540, -Math.PI / 2, { health: 400 });
        state.player.inCar = car;
        state.player.x = car.x;
        state.player.y = car.y;
        state.player.angle = car.angle;
        state.mission.data.getawayCarId = car.id;
      }
      setObjective(state, 'Survive the heat — 120s left.', null);
    },
    update(state, dt) {
      const m = state.mission;
      if (m.stage === 0) {
        m.timer -= dt;
        // The heat stays at 3 stars while the clock runs — floor AND
        // cap. The floor keeps the pressure on if the player goes
        // unseen; the cap keeps a ped caught on a crosswalk from
        // turning the scripted 3-star survival into a 5-star siege.
        ensureWanted(state, 3);
        capWanted(state, 3);
        setObjective(state, `Survive the heat — ${Math.ceil(Math.max(0, m.timer))}s left.`, null);
        if (m.timer <= 0) {
          m.stage = 1;
          setObjective(state, 'Lose the tail — get clean.', null);
        }
      } else if (m.stage === 1) {
        if (state.player.wanted <= 0) missionComplete(state);
      }
    },
  },
  {
    id: 'warehouse-payback',
    title: 'Warehouse Payback',
    payout: 1500,
    brief: [
      'Delia Maren: "Sal Moretti\'s Harbor Kings jumped one of my drivers at the warehouse."',
      'Delia Maren: "Six of them in there. Take the pistol. Make them regret it."',
      'Rook: "Six Kings. One warehouse. Tell Sal I said hello."',
    ],
    start(state) {
      const p = state.player;
      p.weapon = 'pistol';
      p.ammo = 12;
      state.mission.data.total = 6;
      const spots = [
        [0, 0],
        [70, -40],
        [-70, -30],
        [40, 70],
        [-50, 60],
        [110, 30],
      ];
      for (const [dx, dy] of spots) {
        spawnEnemy(state, LOC.warehouse.x + dx, LOC.warehouse.y + dy);
      }
      setObjective(state, 'Clear the warehouse — 6 Harbor Kings left.', LOC.warehouse);
    },
    update(state, dt) {
      const m = state.mission;
      const left = (state.enemies || []).length;
      // Sanctioned hit: while the Harbor Kings are still up, the cops
      // stay out of it. The player drives to the warehouse (and can pick
      // up 1-2 stars on the way — a ped at an intersection, a cop car
      // ramming the sedan), then fights on foot; without this, a foot cop
      // or a cop car reaches the stationary player mid-fight and busts
      // them in 1.5 s of contact before they can drop the 6 gunmen.
      // The combat.js heat fix already makes shooting during this fight
      // free; clearing the wanted here makes the arrival free too, so
      // the mission is a gang fight, not a cop ambush.
      if (left > 0) {
        state.player.heat = 0;
        state.player.wanted = 0;
      }
      setObjective(
        state,
        left > 0
          ? `Clear the warehouse — ${left} Harbor King${left === 1 ? '' : 's'} left.`
          : 'Warehouse clear.',
        LOC.warehouse,
      );
      if (left === 0) missionComplete(state);
    },
  },
  {
    id: 'the-big-score',
    title: 'The Big Score',
    payout: 5000,
    brief: [
      'Delia Maren: "Solano Trust bank. The vault, the alarm, the whole thing. This is the one, Rook."',
      'Delia Maren: "Crack it, grab it, and get to the safehouse before the whole city wakes up."',
      'Rook: "Five thousand reasons to be quick. Let us go steal a bank."',
    ],
    start(state) {
      setObjective(state, 'Hit Solano Trust bank downtown.', LOC.bank);
    },
    update(state, dt) {
      const m = state.mission;
      if (m.stage === 0) {
        if (near(state, LOC.bank)) {
          m.stage = 1;
          setObjective(state, 'Press E at the vault.', LOC.bank);
        }
      } else if (m.stage === 1) {
        // E at the vault is consumed by tryInteract, which calls vaultCrack().
        // Nothing to do here until that happens.
      } else if (m.stage === 2) {
        if (near(state, LOC.bank, 140)) {
          m.timer -= dt;
          setObjective(
            state,
            `Cracking the vault — stay close! ${Math.ceil(Math.max(0, m.timer))}s.`,
            LOC.bank,
          );
        } else {
          setObjective(state, 'Get back to the vault — the crack stalls outside!', LOC.bank);
        }
        if (m.timer <= 0) {
          m.stage = 3;
          ensureWanted(state, 4);
          setObjective(state, 'Run! Get to the safehouse with the money.', LOC.safehouse);
          state.audio?.sfx?.('siren');
        }
      } else if (m.stage === 3) {
        if (near(state, LOC.safehouse)) missionComplete(state);
      }
    },
  },
];

/** Start the vault crack (Big Score stage 1 -> 2). Called by tryInteract. */
export function vaultCrack(state) {
  const m = state.mission;
  if (!m.active || m.index !== 5 || m.stage !== 1) return false;
  m.stage = 2;
  m.timer = 10;
  m.timerTotal = 10;
  setObjective(state, 'Cracking the vault — stay close! 10s.', LOC.bank);
  state.audio?.sfx?.('click');
  return true;
}

/** Start mission i (0..5). Returns false for a bad index. */
export function startMission(state, i, stage = 0) {
  const def = MISSIONS[i];
  if (!def || !state.mission) return false;
  // A story job cancels any side job in progress (no pay, no penalty):
  // Rook cannot run a taxi fare and rob a bank at the same time, and a
  // fare timer ticking through a 120 s survival would fail on its own.
  // The same goes for a street event: the city stops throwing trouble
  // the moment a story job starts, so the event never fights a mission
  // for the objective line or the player's attention.
  cancelActiveJob(state, 'Story job started.');
  cancelActiveEvent(state, 'Story job started.');
  cancelActiveBounty(state, 'Story job started.');
  const m = state.mission;
  m.index = i;
  m.stage = stage || 0;
  m.data = {};
  m.timer = 0;
  m.active = true;
  m.failT = 0;
  m.brief = def.brief;
  m.briefT = BRIEF_HOLD;
  m.unlocked = Math.max(m.unlocked ?? 0, i);
  state.mode = 'playing';
  def.start(state);
  state.audio?.sfx?.('mission');
  return true;
}

/** Fail the active mission; the job stays pending at the diner for a retry. */
export function missionFailed(state, reason) {
  const m = state.mission;
  if (!m) return;
  m.active = false;
  m.timer = 0;
  m.failT = 4; // hold the failure message on screen before the retry prompt
  setObjective(state, `Mission failed — ${reason} Return to Delia's diner (R) to retry.`, LOC.diner);
  state.audio?.sfx?.('fail');
}

/** Pay out, mark progress, hold the MISSION COMPLETE screen, then free roam. */
export function missionComplete(state) {
  const m = state.mission;
  const def = MISSIONS[m.index];
  if (!def) return;
  state.player.money += def.payout;
  if (state.stats) {
    state.stats.missionsDone = (state.stats.missionsDone || 0) + 1;
    state.stats.moneyEarned = (state.stats.moneyEarned || 0) + def.payout;
  }
  addFloatText(state, state.player.x, state.player.y - 30, `+$${def.payout}`, '#ffd94d');
  spawnParticles(state, state.player.x, state.player.y, 'cash', 24);
  state.audio?.sfx?.('cash');
  if (!m.completed) m.completed = [];
  if (!m.completed.includes(def.id)) m.completed.push(def.id);
  m.unlocked = Math.max(m.unlocked ?? 0, m.index + 1);
  m.active = false;
  m.brief = null;
  m.briefT = 0;
  setObjective(state, `${def.title} complete! +$${def.payout}`, null);
  state.mode = 'missionComplete';
  m.completeT = COMPLETE_HOLD;
  try {
    saveGame(state);
  } catch {
    // A failed save must never fail the mission.
  }
}

/**
 * The ONE E-press handler. main.js calls this once per frame when E was
 * pressed; it returns true when the press did mission work (and main.js must
 * NOT also treat it as enter/exit car). Cases, in order:
 *  - the Big Score vault prompt (stage 1, player at the bank),
 *  - retrying a failed job at the diner (even during the 4 s fail hold),
 *  - starting the next unlocked job at the diner.
 */
export function tryInteract(state) {
  const m = state.mission;
  if (!m || !state.player || !state.player.alive) return false;
  if (state.mode !== 'playing') return false;
  // The vault prompt: on foot at the bank during The Big Score.
  if (m.active && m.index === 5 && m.stage === 1 && near(state, LOC.bank)) {
    return vaultCrack(state);
  }
  if (m.active) return false;
  // No job running: the diner offers the next job (or a retry).
  if (!near(state, LOC.diner, 110)) return false;
  const target = m.index >= 0 ? m.index : (m.unlocked ?? 0);
  if (target >= MISSIONS.length) return false;
  return startMission(state, target);
}

/**
 * Per-frame mission driver. Call after updatePolice / updateCombat.
 * Also handles the wasted / busted fail path and the diner "R" prompt.
 * E handling lives in tryInteract — this function never reads the key.
 */
export function updateMission(state, dt) {
  const m = state.mission;
  if (!m) return;
  if (m.briefT > 0) m.briefT -= dt;

  // Celebration hold after a completion.
  if (state.mode === 'missionComplete') {
    m.completeT -= dt;
    if (m.completeT <= 0) {
      state.mode = 'playing';
      m.index = -1;
      m.stage = 0;
      m.data = {};
      m.timer = 0;
      setObjective(state, "Head to Delia's diner (R) for the next job.", LOC.diner);
    }
    return;
  }

  // Wasted / busted during a mission fails it.
  if (state.mode === 'wasted' || state.mode === 'busted') {
    if (m.active) missionFailed(state, state.mode === 'wasted' ? 'You got wasted.' : 'You got busted.');
    return;
  }

  if (m.active && m.index >= 0) {
    MISSIONS[m.index].update(state, dt);
    return;
  }

  // No active mission: the diner "R" marker offers the next job (or a retry).
  // The failure message holds for a few seconds first so it can be read —
  // but tryInteract retries immediately even during the hold.
  if (m.failT > 0) {
    m.failT -= dt;
    return;
  }
  const target = m.index >= 0 ? m.index : (m.unlocked ?? 0);
  if (target >= MISSIONS.length) {
    setObjective(state, 'All jobs done. Port Solano is yours, Rook.', null);
    m.waypoint = null;
    return;
  }
  if (near(state, LOC.diner, 110)) {
    const verb = m.index >= 0 ? 'Retry' : 'Start';
    setObjective(state, `Press E at Delia's diner (R) — ${verb}: ${MISSIONS[target].title}`, LOC.diner);
  } else if (!m.active) {
    setObjective(state, `Next job at Delia's diner (R): ${MISSIONS[target].title}`, LOC.diner);
  }
}

// ---------------------------------------------------------------------------
// Mission metadata (for the HUD tracker) + the data-driven side-job engine.
//
// The six story missions are hand-scripted above (their stages are bespoke
// logic). The tracker does not need that logic — it needs the facts, and
// the facts live here as data: giver, place, difficulty, tip. A new story
// job is a row here plus its stage code; the tracker never reads the
// stage functions.
//
// Side jobs (taxi fares, delivery gigs) are the opposite: fully
// data-driven. A job type is a row in JOB_TYPES (label, blurb, rules),
// and the runner below (offer / accept / timer / payout / fail) works
// for every type. Adding a third job type is a row, not a new system.
// ---------------------------------------------------------------------------

/** Facts about each story job, for the HUD mission tracker. */
export const MISSION_DEFS = [
  { id: 'welcome-home', title: 'Welcome Home', payout: 500, giver: 'Delia Maren', location: 'Marina Pier → Solano Arms', difficulty: 1, tip: 'Delia\'s sedan is slow but steady. Stay on the avenue.' },
  { id: 'hot-wheels', title: 'Hot Wheels', payout: 800, giver: 'Delia Maren', location: 'Marina → Chop Shop', difficulty: 2, tip: 'The coupe is fast and fragile. Do not stop for the cops.' },
  { id: 'the-drop', title: 'The Drop', payout: 1000, giver: 'Old Sal', location: 'Motel → Docks', difficulty: 2, tip: 'Ninety seconds. Take the avenue, not the alleys.' },
  { id: 'heat-wave', title: 'Heat Wave', payout: 1200, giver: 'Delia Maren', location: 'Downtown loop', difficulty: 3, tip: 'Survive 120 s at 3 stars, then lose the tail on the outer ring.' },
  { id: 'warehouse-payback', title: 'Warehouse Payback', payout: 1500, giver: 'Delia Maren', location: 'Warehouse, 2200/1800', difficulty: 3, tip: 'Six gunmen, sanctioned. Keep moving and use the doorways.' },
  { id: 'the-big-score', title: 'The Big Score', payout: 5000, giver: 'Old Sal', location: 'Bank → Safehouse', difficulty: 4, tip: 'Crack the vault, then run — the whole city wakes up.' },
];

/** The metadata row for a story job id, or null. */
export function missionDef(id) {
  return MISSION_DEFS.find((d) => d.id === id) || null;
}

/** The metadata row for the next unlocked story job, or null when done. */
export function nextMissionDef(state) {
  const m = state.mission;
  if (!m) return null;
  const target = m.index >= 0 ? m.index : (m.unlocked ?? 0);
  if (target >= MISSION_DEFS.length) return null;
  return MISSION_DEFS[target];
}

/** { title, payout, difficulty, stage, objective } for the HUD tracker. */
export function missionProgress(state) {
  const m = state.mission;
  if (!m) return null;
  const def = m.index >= 0 ? MISSION_DEFS[m.index] : nextMissionDef(state);
  if (!def) return { title: 'All jobs done', payout: 0, difficulty: 0, stage: 0, objective: 'Port Solano is yours, Rook.' };
  return {
    title: def.title,
    payout: def.payout,
    difficulty: def.difficulty,
    giver: def.giver,
    location: def.location,
    tip: def.tip,
    stage: m.stage || 0,
    active: !!m.active,
    objective: m.objectiveText || '',
  };
}

// --- Side jobs ---------------------------------------------------------------

/** The job types, as data. `needsCar`: the player must be in a car to pick up. */
export const JOB_TYPES = {
  taxi: {
    label: 'Taxi fare',
    blurb: 'A fare is waiting — drive them across town before the meter runs out.',
    needsCar: true,
    pickupKind: 'ped',
    base: SIDE_JOBS.taxi.base,
    perMetre: SIDE_JOBS.taxi.perMetre,
    secondsPer100px: SIDE_JOBS.taxi.secondsPer100px,
    timeBase: SIDE_JOBS.taxi.timeBase,
  },
  delivery: {
    label: 'Delivery gig',
    blurb: 'A package needs legs — no questions, no stops, no dents.',
    needsCar: false,
    pickupKind: 'package',
    base: SIDE_JOBS.delivery.base,
    perMetre: SIDE_JOBS.delivery.perMetre,
    secondsPer100px: SIDE_JOBS.delivery.secondsPer100px,
    timeBase: SIDE_JOBS.delivery.timeBase,
  },
  getaway: {
    label: 'Getaway fare',
    blurb: 'A client who cannot be seen — keep the heat down and drive smooth.',
    needsCar: true,
    pickupKind: 'ped',
    base: SIDE_JOBS.getaway.base,
    perMetre: SIDE_JOBS.getaway.perMetre,
    secondsPer100px: SIDE_JOBS.getaway.secondsPer100px,
    timeBase: SIDE_JOBS.getaway.timeBase,
  },
  // Courier: a sealed package, no passenger, no car required. The
  // pickup is a point on the road (not a ped — nobody waits with it),
  // the dropoff is a named place, and the run never bails on wanted
  // stars: a courier who is already hot still gets paid. The blurb
  // says it plainly so the player picks this job when the heat is on.
  courier: {
    label: 'Courier run',
    blurb: 'A sealed package, no questions — on foot or by car, just don\'t be late.',
    needsCar: false,
    pickupKind: 'package',
    base: SIDE_JOBS.courier.base,
    perMetre: SIDE_JOBS.courier.perMetre,
    secondsPer100px: SIDE_JOBS.courier.secondsPer100px,
    timeBase: SIDE_JOBS.courier.timeBase,
  },
  // Valet: a client waits at the marker with the keys to their car,
  // and the job is to drive it across town and park it. It runs on
  // the taxi flow (pickupKind 'ped' — the client stands at the marker
  // and vanishes into the car on pickup) with no bail rule and no tip:
  // the client is not riding, so there is nobody to bail, and the pay
  // is the parking, not the company.
  valet: {
    label: 'Valet run',
    blurb: 'A client waits at the marker with the keys — take their car across town and park it. The car is the passenger.',
    needsCar: true,
    pickupKind: 'ped',
    base: SIDE_JOBS.valet.base,
    perMetre: SIDE_JOBS.valet.perMetre,
    secondsPer100px: SIDE_JOBS.valet.secondsPer100px,
    timeBase: SIDE_JOBS.valet.timeBase,
  },
  // Medic: clinic supplies, on foot or by car, to a drop point. Like
  // a courier it never bails on wanted stars — the supplies do not
  // care who carries them — and like a delivery it pays for care:
  // the damage penalty is the delivery rule, read from the same
  // tuning, because a dented crate of supplies is a wasted crate.
  medic: {
    label: 'Medic run',
    blurb: 'Clinic supplies, fragile and urgent — on foot or by car, just don\'t dent the crate.',
    needsCar: false,
    pickupKind: 'package',
    base: SIDE_JOBS.medic.base,
    perMetre: SIDE_JOBS.medic.perMetre,
    secondsPer100px: SIDE_JOBS.medic.secondsPer100px,
    timeBase: SIDE_JOBS.medic.timeBase,
  },
};

/** Fresh side-job state (installed by main.js's createGameState). */
export function createJobState() {
  // streak: consecutive side jobs completed without a failure. The 3rd
  // job in a row pays a $20 bonus, the 4th $30, and so on — the board
  // rewards a driver who keeps the fares coming. A failure or a
  // cancellation resets it to zero.
  return { offers: [], active: null, done: 0, earned: 0, offerT: 0, streak: 0, bestStreak: 0 };
}

function ensureJobs(state) {
  if (!state.jobs) state.jobs = createJobState();
  return state.jobs;
}

function rngOf(state) {
  return state.rng || Math.random;
}

// Named places a fare or a package can be going to (not the diner — the
// diner is where story jobs start, and a side job should not point there).
const JOB_DESTINATIONS = [
  LOC.marina, LOC.hotel, LOC.chopShop, LOC.motel, LOC.warehouse,
  LOC.bank, LOC.safehouse, LOC.docks, LOC.marinaPier,
];

/** Build one job offer of `type` near the player. */
export function makeJobOffer(state, type) {
  const def = JOB_TYPES[type] || JOB_TYPES.taxi;
  const rng = rngOf(state);
  const p = state.player;
  // Taxi fares come from where the people are: if the streets have a
  // crowd, the pickup is near the busiest spot (peds.js busiestSpot)
  // instead of a random corner — a cab rank forms where the crowd is.
  // Deliveries and getaways take a random road point near the player.
  let pickup;
  if (type === 'taxi') {
    const busy = busiestSpot(state);
    if (busy && busy.count >= 3) {
      pickup = roadPointNear(state.world, rng, busy.x, busy.y, 100, 300);
    }
  }
  if (!pickup) pickup = roadPointNear(state.world, rng, p.x, p.y, 400, 900);
  let dropoff = JOB_DESTINATIONS[Math.floor(rng() * JOB_DESTINATIONS.length)];
  // A dropoff on top of the pickup is not a job — pick again.
  if (Math.hypot(dropoff.x - pickup.x, dropoff.y - pickup.y) < 500) {
    dropoff = roadPointNear(state.world, rng, pickup.x, pickup.y, 800, 2000);
  }
  const dist = Math.hypot(dropoff.x - pickup.x, dropoff.y - pickup.y);
  const job = {
    id: `job-${type}-${Math.floor(rng() * 1e9)}`,
    type,
    label: def.label,
    pickup: { x: pickup.x, y: pickup.y },
    dropoff: { x: dropoff.x, y: dropoff.y },
    dist,
    timer: def.timeBase + (dist / 100) * def.secondsPer100px,
    timerTotal: def.timeBase + (dist / 100) * def.secondsPer100px,
    payoutBase: Math.round(def.base + dist * def.perMetre),
    pickedUp: false,
    holdT: 0,
    carHpAtPickup: 0,
    passenger: null,
    status: 'offer',
  };
  // A taxi fare has a person standing at the pickup: spawn a ped there
  // and park it (pauseTimer 999 — it waits for its cab). The ped is a
  // normal ped again if the offer expires or the job fails.
  if (def.pickupKind === 'ped') {
    const ped = createPed(rng, pickup.x, pickup.y, 0);
    ped.pauseTimer = 999;
    ped._fare = true;
    if (!Array.isArray(state.peds)) state.peds = [];
    state.peds.push(ped);
    job.passenger = ped;
  }
  return job;
}

/** Fill the board up to SIDE_JOBS.offers, in free roam only. */
export function offerJobs(state) {
  const jobs = ensureJobs(state);
  if (state.mission && (state.mission.active || state.mission.index >= 0)) return;
  const types = Object.keys(JOB_TYPES);
  const rng = rngOf(state);
  while (jobs.offers.length < SIDE_JOBS.offers) {
    const type = types[Math.floor(rng() * types.length)];
    jobs.offers.push(makeJobOffer(state, type));
  }
}

/** Accept an offer: it becomes the active job. Returns the job or null. */
export function startJob(state, jobId) {
  const jobs = ensureJobs(state);
  if (jobs.active) return null;
  const i = jobs.offers.findIndex((j) => j.id === jobId);
  if (i < 0) return null;
  const job = jobs.offers[i];
  jobs.offers.splice(i, 1);
  job.status = 'active';
  jobs.active = job;
  const def = JOB_TYPES[job.type];
  setObjective(state, `${job.label} — get to the pickup (${def.needsCar ? 'in a car' : 'on foot'}) and hold still 1 s.`, job.pickup);
  state.audio?.sfx?.('click');
  return job;
}

/** The active job's payout right now (tip / damage / clean bonus counted at completion). */
export function jobPayout(job, state) {
  if (!job) return 0;
  let pay = job.payoutBase;
  if (job.type === 'taxi' && job.timer > 0 && job.timerTotal > 0) {
    const leftFrac = job.timer / job.timerTotal;
    if (leftFrac > SIDE_JOBS.taxi.tipFastFrac) pay += SIDE_JOBS.taxi.tipFast;
  }
  if (job.type === 'delivery' && job.carHpAtPickup > 0 && job.carHpNow !== undefined) {
    const damage = Math.max(0, job.carHpAtPickup - job.carHpNow);
    pay = Math.max(5, Math.round(pay - damage * SIDE_JOBS.delivery.damagePenalty));
  }
  // Getaway: a clean finish (zero wanted stars at the dropoff) pays the
  // bonus — the client pays for discretion, not just speed. The bonus
  // is only known at completion (state.player.wanted is read here).
  if (job.type === 'getaway' && state && state.player && (state.player.wanted || 0) === 0) {
    pay += SIDE_JOBS.getaway.cleanBonus;
  }
  // Streak bonus: the 3rd consecutive completed job pays +$20, the 4th
  // +$30, and so on (10 * the streak coming in). The streak is read
  // from state.jobs — the HUD shows it, so the player can see the next
  // bonus before taking the fare.
  const streak = (state && state.jobs && state.jobs.streak) || 0;
  if (streak >= 2) pay += 10 * streak;
  return pay;
}

function completeJob(state, job) {
  const jobs = ensureJobs(state);
  const pay = jobPayout(job, state);
  state.player.money += pay;
  jobs.done += 1;
  jobs.earned += pay;
  // Streak: this completion extends the run; the bonus was already
  // counted in jobPayout from the incoming streak. bestStreak is the
  // career best, for the stats screen.
  jobs.streak = (jobs.streak || 0) + 1;
  jobs.bestStreak = Math.max(jobs.bestStreak || 0, jobs.streak);
  job.status = 'done';
  jobs.active = null;
  if (state.stats) {
    state.stats.jobsDone = (state.stats.jobsDone || 0) + 1;
    state.stats.jobMoney = (state.stats.jobMoney || 0) + pay;
    state.stats.moneyEarned = (state.stats.moneyEarned || 0) + pay;
  }
  addFloatText(state, state.player.x, state.player.y - 30, `+$${pay} ${job.label}`, '#ffd94d');
  spawnParticles(state, state.player.x, state.player.y, 'cash', 12);
  state.audio?.sfx?.('cash');
  setObjective(state, `${job.label} done! +$${pay}. More fares on the board.`, null);
}

function failJob(state, job, reason) {
  const jobs = ensureJobs(state);
  job.status = 'failed';
  jobs.active = null;
  jobs.streak = 0; // a failure breaks the streak, whatever it was
  // The fare ped goes back to being a normal pedestrian.
  if (job.passenger) job.passenger._fare = false;
  state.audio?.sfx?.('fail');
  setObjective(state, `${job.label} failed — ${reason}`, null);
}

/** The current job streak (consecutive completions), for the HUD. */
export function jobStreak(state) {
  return (state.jobs && state.jobs.streak) || 0;
}

/** Cancel the active job (story mission starting). No pay, no penalty. */
export function cancelActiveJob(state, reason) {
  const jobs = ensureJobs(state);
  if (!jobs.active) return;
  const job = jobs.active;
  job.status = 'failed';
  jobs.active = null;
  jobs.streak = 0; // a cancellation breaks the streak too
  if (job.passenger) job.passenger._fare = false;
  setObjective(state, `${job.label} cancelled — ${reason}`, null);
}

/**
 * Per-frame side-job driver. Call from main.js's step, after updateMission.
 * Free roam only: the board refills on a timer, the active job ticks down,
 * pickup is a 1 s hold in the circle (slow, in a car for a fare), and the
 * dropoff pays on arrival. A fare passenger bails the moment the player
 * has any wanted stars — nobody rides with a wanted man.
 */
export function updateJobs(state, dt) {
  const jobs = ensureJobs(state);
  if (dt <= 0 || !state.player || !state.player.alive) return;
  if (state.mode && state.mode !== 'playing') return;
  const m = state.mission;
  if (m && (m.active || m.index >= 0)) return; // story mission: no side jobs

  // Board refill.
  jobs.offerT -= dt;
  if (jobs.offerT <= 0) {
    jobs.offerT = SIDE_JOBS.offerEvery;
    offerJobs(state);
  }

  const job = jobs.active;
  if (!job) return;
  const p = state.player;
  const def = JOB_TYPES[job.type];

  job.timer -= dt;
  if (job.timer <= 0) {
    failJob(state, job, 'Out of time.');
    return;
  }

  // Taxi bail: any wanted stars while the passenger is aboard.
  if (job.type === 'taxi' && job.pickedUp && (p.wanted || 0) > SIDE_JOBS.taxi.bailWanted) {
    failJob(state, job, 'The passenger saw the cops and bailed.');
    return;
  }

  // Getaway bail: the client cannot be seen — more than one star of
  // heat and the fare is over. One star is tolerated (a single patrol
  // car is "just traffic"); two is a chase, and the client walks.
  if (job.type === 'getaway' && job.pickedUp && (p.wanted || 0) > SIDE_JOBS.getaway.maxWanted) {
    failJob(state, job, 'Too hot — the client bailed at the next corner.');
    return;
  }

  if (!job.pickedUp) {
    // Pickup: in the circle, slow (under 60px/s), in a car for a fare.
    const inCar = !!p.inCar;
    const speed = inCar ? Math.abs(p.inCar.speed || 0) : (p.speed || 0);
    const nearPickup = Math.hypot(p.x - job.pickup.x, p.y - job.pickup.y) < 70;
    const rightVehicle = def.needsCar ? inCar : true;
    if (nearPickup && speed < 60 && rightVehicle) {
      job.holdT += dt;
      if (job.holdT >= 1) {
        job.pickedUp = true;
        job.carHpAtPickup = inCar ? p.inCar.health : 0;
        if (job.passenger) {
          const pi = (state.peds || []).indexOf(job.passenger);
          if (pi >= 0) state.peds.splice(pi, 1);
          job.passenger = null;
        }
        setObjective(state, `${job.label} — deliver to the marker. ${Math.ceil(job.timer)}s left.`, job.dropoff);
        state.audio?.sfx?.('pickup');
      }
    } else {
      job.holdT = 0;
    }
    return;
  }

  // Delivery damage tracking (the car the player is driving, if any).
  if (p.inCar) job.carHpNow = p.inCar.health;

  // Dropoff: in the circle (in a car for a fare).
  const nearDrop = Math.hypot(p.x - job.dropoff.x, p.y - job.dropoff.y) < 70;
  if (nearDrop && (!def.needsCar || p.inCar)) {
    completeJob(state, job);
  }
}

/** The active job (or null), for the HUD tracker and the minimap. */
export function activeJob(state) {
  return (state.jobs && state.jobs.active) || null;
}

/** The offers on the board, for the HUD. */
export function jobOffers(state) {
  return (state.jobs && state.jobs.offers) || [];
}

/** The marker the renderer / minimap should draw for the active job. */
export function jobMarker(state) {
  const job = activeJob(state);
  if (!job) return null;
  return {
    type: job.type,
    label: job.label,
    pickup: job.pickedUp ? null : job.pickup,
    dropoff: job.dropoff,
    timer: job.timer,
    timerTotal: job.timerTotal,
    payout: jobPayout(job, state),
  };
}

/** The side-job career numbers, for the stats screen. */
export function jobStats(state) {
  const jobs = ensureJobs(state);
  return {
    done: jobs.done || 0,
    earned: jobs.earned || 0,
    bestStreak: jobs.bestStreak || 0,
    streak: jobs.streak || 0,
  };
}

/**
 * A job offer in one line ("Taxi fare · $45 · pickup 320m away"):
 * the board's row as a sentence, so the player can read an offer
 * without opening it. The payout is the base (before the tip, the
 * damage penalty, or the streak bonus) — the board advertises the
 * floor, and the completion pays the ceiling.
 */
export function jobOfferLabel(job) {
  if (!job) return 'No job';
  const type = JOB_TYPES[job.type] || {};
  const label = type.label || job.type;
  return `${label} · $${job.payout || 0} · pickup ${Math.round(job.pickupDist || 0)}m away`;
}

/**
 * The job board in one line ("3 jobs · best streak 4 · $1,250 earned"):
 * the board's state as a sentence, for the HUD free-roam line and the
 * pause menu. The numbers are the same ones jobStats returns, so the
 * sentence and the stats screen can never disagree.
 */
export function jobBoardLabel(state) {
  const jobs = ensureJobs(state);
  const offers = (jobs.offers || []).length;
  return `${offers} job${offers === 1 ? '' : 's'} on the board · best streak ${jobs.bestStreak || 0} · $${(jobs.earned || 0).toLocaleString('en-US')} earned`;
}

// --- Street events ---------------------------------------------------------
// Random trouble that finds the player in free roam: one event at a
// time, on a timer, never during a story mission. The engine is data
// driven — STREET_EVENTS.kinds in config.js is the whole catalogue,
// and each kind is a small setup plus a completion check below. An
// event is not a mission: it pays on completion, vanishes on failure,
// and there is no penalty beyond the lost payout. Starting a story
// mission cancels the active event, the same way it cancels a job.

/** Fresh street-event state (installed by main.js's createGameState). */
export function createEventState() {
  // rollT: seconds until the next spawn roll. The first roll comes
  // 30 s into free roam, so the player has time to learn the streets
  // before the city starts throwing trouble at them.
  return { active: null, rollT: 30, done: 0, earned: 0 };
}

function ensureEvents(state) {
  if (!state.events) state.events = createEventState();
  return state.events;
}

/** The event definition for `id`, or null. */
export function eventDef(id) {
  return (STREET_EVENTS.kinds || []).find((k) => k.id === id) || null;
}

/**
 * Build an event of `kindId` near the player and make it active. The
 * location is a road point 400–900 px away, so the event is always a
 * short drive, never on top of the player and never across the map.
 * Each kind sets up its own stage: a shootout spawns gunmen, a stolen
 * car parks a Comet GT, a race lays out checkpoints, a mugging puts
 * one gunman on a victim. Returns the event, or null when the kind
 * is unknown.
 */
export function spawnEvent(state, kindId) {
  const def = eventDef(kindId);
  if (!def) return null;
  const ev = ensureEvents(state);
  if (ev.active) return ev.active;
  const rng = rngOf(state);
  const p = state.player;
  const loc = roadPointNear(state.world, rng, p.x, p.y, 400, 900);
  const event = {
    id: `event-${def.id}-${Math.floor(rng() * 1e9)}`,
    kind: def.id,
    name: def.name,
    line: def.line,
    payout: def.payout,
    timer: def.timeLimit,
    timerTotal: def.timeLimit,
    x: loc.x,
    y: loc.y,
    status: 'active',
    enemies: [],
    car: null,
    checkpoints: [],
    checkpointIndex: 0,
    victim: null,
  };
  if (def.id === 'shootout' || def.id === 'mugging' || def.id === 'hitman' || def.id === 'ambush' || def.id === 'rescue' || def.id === 'street-fight') {
    // A shootout is three Kings; a mugging is one man working a
    // corner; a hitman is one man hunting Rook; an ambush is two Kings
    // stepping out of an alley; a rescue is a mugging where the victim
    // matters. The enemies are ordinary gunmen (combat.js spawnEnemy),
    // so the fight plays exactly like the warehouse fight, only
    // smaller — the player already knows how to win it. The hitman
    // gets no victim: there is nobody to save, only a gun to stop.
    // A street fight is two men with bats — same count as an ambush,
    // same engine, counting bodies.
    const n = def.id === 'shootout' ? (def.enemies || 3) : (def.id === 'ambush' || def.id === 'street-fight') ? (def.enemies || 2) : 1;
    for (let i = 0; i < n; i += 1) {
      const e = spawnEnemy(state, loc.x + (rng() - 0.5) * 120, loc.y + (rng() - 0.5) * 120);
      if (e) event.enemies.push(e);
    }
    if (def.id === 'mugging' || def.id === 'rescue') {
      const victim = createPed(rng, loc.x + 40, loc.y + 40, 0);
      victim.pauseTimer = 999;
      if (!Array.isArray(state.peds)) state.peds = [];
      state.peds.push(victim);
      event.victim = victim;
    }
  } else if (def.id === 'package-rush') {
    // A package rush is a courier run with a clock: the package waits
    // at the marker, the dropoff is a named place across town, and
    // the timer is the whole job. The pickup is a touch (within 70
    // px), not a hold — a rush has no time to wait for a handover.
    event.pickedUp = false;
    const dest = JOB_DESTINATIONS[Math.floor(rng() * JOB_DESTINATIONS.length)];
    event.dropoff = { x: dest.x, y: dest.y };
  } else if (def.id === 'stolen-car' || def.id === 'car-theft') {
    // The stolen Comet GT, parked with the keys in it (driver 'none').
    // The player steals it by pressing E, then drives it to the chop
    // shop — the same chop shop the story uses, so the player already
    // knows where it is. A car theft is the same job with a blue
    // coupe instead of a red Comet GT.
    const model = def.id === 'car-theft' ? 'coupe' : 'sports';
    const color = def.id === 'car-theft' ? '#3498db' : '#e74c3c';
    const car = createCar(model, loc.x, loc.y, 0, { driver: 'none', color });
    car._eventCar = true;
    state.cars.push(car);
    event.car = car;
  } else if (def.id === 'race' || def.id === 'joyride' || def.id === 'taxi-race') {
    // Three checkpoints in a rough circuit around the event point
    // (four for a joyride — the dare is longer and the clock is
    // tighter), each 500–900 px from the last, so the race is a drive,
    // not a straight line. The player must pass them in order.
    let cx = loc.x;
    let cy = loc.y;
    const n = def.checkpoints || 3;
    for (let i = 0; i < n; i += 1) {
      const pt = roadPointNear(state.world, rng, cx, cy, 500, 900);
      event.checkpoints.push({ x: pt.x, y: pt.y });
      cx = pt.x;
      cy = pt.y;
    }
  }
  ev.active = event;
  setObjective(state, `${event.name} — ${event.line} ${Math.ceil(event.timer)}s left.`, { x: event.x, y: event.y });
  state.audio?.sfx?.('event');
  return event;
}

/** The street-event career numbers, for the stats screen. */
export function eventStats(state) {
  const ev = ensureEvents(state);
  return { done: ev.done || 0, earned: ev.earned || 0 };
}

/** Total dollars earned from street events, for the stats screen. */
export function eventPayoutTotal(state) {
  return (ensureEvents(state).earned || 0);
}

/** The active street event (or null), for the HUD tracker and the minimap. */
export function activeEvent(state) {
  return (state.events && state.events.active) || null;
}

function completeEvent(state, event) {
  const ev = ensureEvents(state);
  const pay = event.payout;
  state.player.money += pay;
  ev.done += 1;
  ev.earned += pay;
  event.status = 'done';
  ev.active = null;
  // An event payout is career money, same as a job: it counts toward
  // the rep title and the stats screen. Without this, a player who
  // earns $300 from a hitman would still read as a Nobody.
  if (state.stats) {
    state.stats.eventsDone = (state.stats.eventsDone || 0) + 1;
    state.stats.eventsEarned = (state.stats.eventsEarned || 0) + pay;
    state.stats.moneyEarned = (state.stats.moneyEarned || 0) + pay;
  }
  state.audio?.sfx?.('payout');
  setObjective(state, `${event.name} done — $${pay} earned.`, null);
}

function failEvent(state, event, reason) {
  const ev = ensureEvents(state);
  event.status = 'failed';
  ev.active = null;
  // The stage clears itself: gunmen left standing go back to being
  // nobody (they are removed, not left to wander), the stolen car
  // stays where it is (it is just a car now), the victim goes back
  // to walking.
  for (const e of event.enemies || []) {
    const i = (state.enemies || []).indexOf(e);
    if (i >= 0) state.enemies.splice(i, 1);
  }
  if (event.victim) {
    event.victim.pauseTimer = 0;
    event.victim._fare = false;
  }
  state.audio?.sfx?.('fail');
  setObjective(state, `${event.name} failed — ${reason}`, null);
}

/** Cancel the active event (story mission starting). No pay, no penalty. */
export function cancelActiveEvent(state, reason) {
  const ev = ensureEvents(state);
  if (!ev.active) return;
  const event = ev.active;
  event.status = 'failed';
  ev.active = null;
  for (const e of event.enemies || []) {
    const i = (state.enemies || []).indexOf(e);
    if (i >= 0) state.enemies.splice(i, 1);
  }
  if (event.victim) event.victim.pauseTimer = 0;
  setObjective(state, `${event.name} cancelled — ${reason}`, null);
}

/**
 * The event tick, called from main.js's step() while playing. In free
 * roam with no active event it rolls the spawn dice every rollEvery
 * seconds; with an active event it counts the timer down and checks
 * the kind's completion rule. A story mission suppresses both halves:
 * no new events, and the active event is cancelled by the mission
 * start, so updateEvents never has to fight a mission for the
 * objective line.
 */
export function updateEvents(state, dt) {
  if (dt <= 0) return;
  const ev = ensureEvents(state);
  const p = state.player;
  if (!p || !p.alive) return;
  if (state.mission && state.mission.active) return;
  if (!ev.active) {
    ev.rollT -= dt;
    if (ev.rollT <= 0) {
      ev.rollT = STREET_EVENTS.rollEvery;
      const rng = rngOf(state);
      if (rng() < STREET_EVENTS.rollChance) {
        const kinds = STREET_EVENTS.kinds || [];
        const def = kinds[Math.floor(rng() * kinds.length)];
        if (def) spawnEvent(state, def.id);
      }
    }
    return;
  }
  const event = ev.active;
  event.timer -= dt;
  if (event.timer <= 0) {
    failEvent(state, event, 'time ran out');
    return;
  }
  setObjective(state, `${event.name} — ${event.line} ${Math.ceil(event.timer)}s left.`, { x: event.x, y: event.y });
  if (event.kind === 'shootout' || event.kind === 'mugging' || event.kind === 'hitman' || event.kind === 'ambush' || event.kind === 'rescue' || event.kind === 'street-fight') {
    // Done when every gunman the event spawned is dead. The player
    // can use any weapon — the engine counts bodies, not bullets.
    const alive = (event.enemies || []).filter((e) => !e.dead).length;
    if (alive === 0) completeEvent(state, event);
  } else if (event.kind === 'package-rush') {
    // Two legs: touch the marker to pick the package up, then reach
    // the dropoff. The pickup is a touch, not a hold — a rush has no
    // time for a handover — and the dropoff is a plain arrival, on
    // foot or by car, because the package does not care how it travels.
    if (!event.pickedUp) {
      if (Math.hypot(p.x - event.x, p.y - event.y) < 70) {
        event.pickedUp = true;
        state.audio?.sfx?.('pickup');
        setObjective(state, `${event.name} — package collected, deliver it. ${Math.ceil(event.timer)}s left.`, event.dropoff);
      }
    } else if (event.dropoff && Math.hypot(p.x - event.dropoff.x, p.y - event.dropoff.y) < 70) {
      completeEvent(state, event);
    }
  } else if (event.kind === 'stolen-car' || event.kind === 'car-theft') {
    // Done when the player is sitting in the event car at the chop
    // shop. The car is marked _eventCar, so any other Comet GT does
    // not count — the player has to bring the stolen one.
    const car = event.car;
    if (car && p.inCar === car && Math.hypot(p.x - LOC.chopShop.x, p.y - LOC.chopShop.y) < 90) {
      completeEvent(state, event);
    }
  } else if (event.kind === 'race' || event.kind === 'joyride' || event.kind === 'taxi-race') {
    // Checkpoints in order, 80 px each. Missing one is not a fail —
    // the player can circle back — but the timer keeps running, so a
    // missed checkpoint costs time, which is the race.
    const cp = event.checkpoints[event.checkpointIndex];
    if (cp && Math.hypot(p.x - cp.x, p.y - cp.y) < 80) {
      event.checkpointIndex += 1;
      state.audio?.sfx?.('pickup');
      if (event.checkpointIndex >= event.checkpoints.length) {
        completeEvent(state, event);
      }
    }
  }
}

/** The marker the renderer / minimap should draw for the active event. */
export function eventMarker(state) {
  const event = activeEvent(state);
  if (!event) return null;
  // The marker follows the next checkpoint for every race kind — a
  // joyride or a taxi race points at its checkpoint, not at the
  // event's origin, so the player always knows where to drive next.
  const cp = (event.kind === 'race' || event.kind === 'joyride' || event.kind === 'taxi-race') ? event.checkpoints[event.checkpointIndex] : null;
  // A package rush points at the pickup until the package is
  // collected, then at the dropoff — the marker follows the job, not
  // the event's origin.
  const target = cp || (event.kind === 'package-rush' && event.pickedUp && event.dropoff ? event.dropoff : null);
  return {
    kind: event.kind,
    name: event.name,
    x: target ? target.x : event.x,
    y: target ? target.y : event.y,
    timer: event.timer,
    timerTotal: event.timerTotal,
    payout: event.payout,
  };
}

// --- Most Wanted bounty board ----------------------------------------------
// The PD's quiet answer to the Harbor Kings: six named targets with a
// price on each head. A bounty is a hunt, not a mission — it lives in
// free roam, it pays the moment the target is down, and turning one in
// clears a star of heat (the PD looks the other way for a hunter who
// just did their job). One bounty at a time, like one street event at
// a time: the city never throws two hunts at Rook at once, and a story
// mission cancels the active bounty the same way it cancels a job and
// an event, so the objective line is never fought over.
//
// A target is a gunman (or two, for the guarded ones) spawned near the
// player when the bounty starts — the same spawnEnemy the warehouse
// fight uses, so the fight plays exactly like the one the player
// already knows how to win. The bounty is done when every target is
// dead or gone; the payout is the board price, and the street cheers
// (crowdReaction) because a collected bounty is the one killing the
// whole block applauds.

/** Fresh bounty-board state (installed by main.js's createGameState). */
export function createBountyState() {
  // doneIds: the targets already collected, so the board never offers
  // the same head twice — a dead King stays dead, and the board
  // refills from the ones still breathing. When all six are done the
  // board stays empty until a new game.
  return { offers: [], active: null, done: 0, earned: 0, offerT: 0, doneIds: [] };
}

function ensureBounties(state) {
  if (!state.bounties) state.bounties = createBountyState();
  return state.bounties;
}

/** The bounty definition for `id`, or null. */
export function bountyDef(id) {
  return (BOUNTIES.targets || []).find((t) => t.id === id) || null;
}

/** Fill the board up to BOUNTIES.offers, in free roam only. */
export function offerBounties(state) {
  const board = ensureBounties(state);
  if (state.mission && (state.mission.active || state.mission.index >= 0)) return;
  const rng = rngOf(state);
  // The board offers the targets still breathing, in a shuffled order
  // with a coin flip deciding whether a fresh offer appears now or on
  // the next refill — the board feels alive instead of dealing the
  // same three heads every time the player glances at it.
  const pool = (BOUNTIES.targets || []).filter(
    (t) => !(board.doneIds || []).includes(t.id)
      && !board.offers.some((o) => o.id === t.id)
      && (!board.active || board.active.id !== t.id),
  );
  while (board.offers.length < BOUNTIES.offers && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    const def = pool.splice(i, 1)[0];
    if (!coinFlip(rng) && board.offers.length > 0) {
      pool.push(def);
      break;
    }
    board.offers.push({
      id: `bounty-${def.id}-${Math.floor(rng() * 1e9)}`,
      defId: def.id,
      name: def.name,
      alias: def.alias,
      payout: def.payout,
      enemies: def.enemies || 1,
      district: def.district,
      line: def.line,
      status: 'offer',
      targets: [],
    });
  }
}

/** Accept a board offer: it becomes the active bounty. Returns it or null. */
export function startBounty(state, bountyId) {
  const board = ensureBounties(state);
  if (board.active) return null;
  const i = board.offers.findIndex((b) => b.id === bountyId);
  if (i < 0) return null;
  const bounty = board.offers[i];
  board.offers.splice(i, 1);
  const rng = rngOf(state);
  const p = state.player;
  const loc = roadPointNear(state.world, rng, p.x, p.y, 400, 900);
  // The target and his guards spawn together at the marker, so the
  // hunt has a place to go — the first target is the named man, the
  // rest are his guards, and the marker follows the first live one.
  for (let k = 0; k < bounty.enemies; k += 1) {
    const e = spawnEnemy(state, loc.x + (rng() - 0.5) * 120, loc.y + (rng() - 0.5) * 120);
    if (e) {
      e._bounty = bounty.defId;
      bounty.targets.push(e);
    }
  }
  bounty.x = loc.x;
  bounty.y = loc.y;
  bounty.status = 'active';
  board.active = bounty;
  setObjective(state, `Most Wanted — ${bounty.name}: ${bounty.line} $${bounty.payout} on his head.`, { x: loc.x, y: loc.y });
  state.audio?.sfx?.('event');
  return bounty;
}

/** The active bounty (or null), for the HUD tracker and the minimap. */
export function activeBounty(state) {
  return (state.bounties && state.bounties.active) || null;
}

/** The bounty-board career numbers, for the stats screen. */
export function bountyStats(state) {
  const board = ensureBounties(state);
  return { done: board.done || 0, earned: board.earned || 0 };
}

/** The marker the renderer / minimap should draw for the active bounty. */
export function bountyMarker(state) {
  const bounty = activeBounty(state);
  if (!bounty) return null;
  const live = (bounty.targets || []).find((e) => !e.dead && (state.enemies || []).includes(e));
  return {
    name: bounty.name,
    alias: bounty.alias,
    x: live ? live.x : bounty.x,
    y: live ? live.y : bounty.y,
    payout: bounty.payout,
  };
}

function completeBounty(state, bounty) {
  const board = ensureBounties(state);
  const pay = bounty.payout;
  state.player.money += pay;
  board.done += 1;
  board.earned += pay;
  if (!board.doneIds) board.doneIds = [];
  if (!board.doneIds.includes(bounty.defId)) board.doneIds.push(bounty.defId);
  bounty.status = 'done';
  board.active = null;
  // A collected bounty is career money, same as a job: it counts toward
  // the rep title and the stats screen. And the PD looks the other way
  // for a hunter — one star of heat comes off, so a bounty is also the
  // way out of a chase the player started by taking the shot.
  if (state.stats) {
    state.stats.bountiesDone = (state.stats.bountiesDone || 0) + 1;
    state.stats.bountiesEarned = (state.stats.bountiesEarned || 0) + pay;
    state.stats.moneyEarned = (state.stats.moneyEarned || 0) + pay;
  }
  clearWanted(state, 1, 'bounty');
  crowdReaction(state, 'bounty');
  addFloatText(state, state.player.x, state.player.y - 30, `BOUNTY +$${pay} — ${bounty.alias} down`, '#ffd94d');
  spawnParticles(state, state.player.x, state.player.y, 'gold', 16);
  state.audio?.sfx?.('bounty');
  setObjective(state, `Most Wanted — ${bounty.name} collected! +$${pay}. More heads on the board.`, null);
}

/**
 * The bounty tick, called from main.js's step() while playing. In free
 * roam with no active bounty it refills the board on a timer; with an
 * active bounty it checks whether every target is down. A story mission
 * suppresses both halves: no new bounties, and the active bounty is
 * cancelled by the mission start, so updateBounties never has to fight
 * a mission for the objective line.
 */
export function updateBounties(state, dt) {
  if (dt <= 0) return;
  const board = ensureBounties(state);
  const p = state.player;
  if (!p || !p.alive) return;
  if (state.mission && state.mission.active) return;
  if (!board.active) {
    board.offerT -= dt;
    if (board.offerT <= 0) {
      board.offerT = BOUNTIES.offerEvery;
      offerBounties(state);
    }
    return;
  }
  const bounty = board.active;
  // Done when every target is dead or gone from the field. A target
  // that wandered off and despawned counts as gone, not as a blocker —
  // the board never holds a bounty open on a man who is not there.
  const alive = (bounty.targets || []).filter(
    (e) => !e.dead && (state.enemies || []).includes(e),
  ).length;
  if (alive === 0) completeBounty(state, bounty);
}

/** Cancel the active bounty (story mission starting). No pay, no penalty. */
export function cancelActiveBounty(state, reason) {
  const board = ensureBounties(state);
  if (!board.active) return;
  const bounty = board.active;
  bounty.status = 'failed';
  board.active = null;
  for (const e of bounty.targets || []) {
    const i = (state.enemies || []).indexOf(e);
    if (i >= 0) state.enemies.splice(i, 1);
  }
  setObjective(state, `Most Wanted — ${bounty.name} cancelled — ${reason}`, null);
}

// --- Garages and safehouses -------------------------------------------------
// Four places Rook can own. Buying one costs cash, makes it the respawn
// home (busted or wasted, Rook wakes up there instead of the marina),
// and throws in a free repair of whatever he is driving — a garage
// that cannot fix a car is just a parking space. The purchase is the
// only transaction: there is no rent, no upkeep, no resale, and the
// home is the last garage bought, so upgrading moves the respawn with
// it. Ownership is saved with the career (save v3).

function ensureGarages(state) {
  if (!state.garages) state.garages = { owned: [], home: null };
  if (!Array.isArray(state.garages.owned)) state.garages.owned = [];
  return state.garages;
}

/** The garage definition for `id`, or null. */
export function garageDef(id) {
  return (GARAGES || []).find((g) => g.id === id) || null;
}

/** The ids of the garages Rook owns. */
export function ownedGarages(state) {
  return ensureGarages(state).owned.slice();
}

/** The home garage definition (the respawn point), or null. */
export function garageHome(state) {
  const home = ensureGarages(state).home;
  return home ? garageDef(home) : null;
}

/** The respawn point: the home garage, or the marina spawn when none is owned. */
export function respawnPoint(state) {
  const home = garageHome(state);
  if (home) return { x: home.x, y: home.y, name: home.name };
  return { x: state.world.spawns.player.x, y: state.world.spawns.player.y, name: 'Marina' };
}

/**
 * Buy a garage. Returns false when the id is unknown, already owned,
 * or unaffordable — the money never moves on a failed buy, so the
 * player can check the price without risking the cash.
 */
export function buyGarage(state, id) {
  const def = garageDef(id);
  if (!def) return false;
  const garages = ensureGarages(state);
  if (garages.owned.includes(id)) return false;
  if ((state.player.money || 0) < def.price) return false;
  state.player.money -= def.price;
  garages.owned.push(id);
  garages.home = id;
  // The free repair: whatever Rook is driving comes out of the new
  // garage in showroom condition, and the street notices the purchase.
  if (state.player.inCar) repairCar(state, state.player.inCar);
  crowdReaction(state, 'garage');
  addFloatText(state, state.player.x, state.player.y - 30, `${def.name} — yours! -$${def.price}`, '#7ddb6a');
  spawnParticles(state, state.player.x, state.player.y, 'gold', 16);
  state.audio?.sfx?.('garage');
  setObjective(state, `${def.name} is yours — respawn home set. ${def.line}`, null);
  return true;
}

/** The owned garages as map markers (for the renderer / minimap). */
export function garageMarkers(state) {
  return ownedGarages(state)
    .map((id) => garageDef(id))
    .filter(Boolean)
    .map((g) => ({ id: g.id, name: g.name, x: g.x, y: g.y, home: ensureGarages(state).home === g.id }));
}

// The line the mission tracker shows under the objective: Delia's
// voice while a job is running (one line per job, so the diner feels
// like a conversation, not a menu), and Old Sal's voice while Rook is
// between jobs. Deterministic by mission index — the HUD draws every
// frame, and a random line would flicker.
export function missionDialogue(state) {
  const m = state.mission;
  if (!m) return null;
  if (m.active && typeof m.index === 'number') {
    return DELIA_LINES[(m.index * 3) % DELIA_LINES.length];
  }
  // Between jobs the index is -1 (the last job is done) — the next
  // job is the unlocked one, and Sal's line follows that, the same
  // way the diner marker picks the next job.
  const target = (typeof m.index === 'number' && m.index >= 0) ? m.index : (m.unlocked ?? 0);
  return SAL_LINES[(target * 2) % SAL_LINES.length];
}

// What the client says when they hand over a job: a taxi fare is a
// person in a hurry, a medic run is a crate that cannot be dropped,
// and a valet run is a set of keys to a car worth more than the fare.
export function jobFlavour(type) {
  return JOB_FLAVOUR[type] || 'A job is a job. The money spends the same either way.';
}
