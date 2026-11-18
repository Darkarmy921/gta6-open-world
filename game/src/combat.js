// Port Solano — melee + shooting + bullets + enemy gang members.
//
// Owns state.bullets (contract field) and state.enemies (spawned by missions.js
// during combat missions, updated here). Player damage goes through
// damagePlayer from police.js so armor / wasted handling stays in one place.
//
// BULLET SHAPE (unified): { x, y, vx, vy, life, from: 'player'|'enemy',
// damage }. Bullets die on buildings (world.buildingHit), on any car in
// state.cars except the player's own (via vehicles.damageCar, so a wrecked
// car ejects its driver the same way everywhere), on peds, foot cops and
// gang members. The camera is the viewport TOP-LEFT in world coords, so
// mouse world = camera + mouse (screen) — see mouseWorld.
import { addWanted, damagePlayer } from './police.js';
import { spawnParticles, addShake, addFloatText } from './effects.js';
import { rand } from './random.js';
import { buildingHit, resolveBuildingCollision } from './world.js';
import { BARKS, PISTOL } from './config.js';
import { damageCar } from './vehicles.js';
import { markPedDead } from './peds.js';
import { mouseWorldPos } from './input.js';

// PISTOL lives in config.js now (single source of truth — see there for
// the drift it fixes). It is re-exported here so existing importers
// that read combat.js's PISTOL keep working.
export { PISTOL };
export const MELEE = { range: 46, damage: 25, cooldown: 0.4 };

const ENEMY_SPEED = 120;
const ENEMY_SHOOT_RANGE = 420;
const ENEMY_BULLET_SPEED = 700;
const ENEMY_BULLET_DAMAGE = 10;
const GANG_KILL_PAY = 50;

function rngOf(state) {
  return state.rng || Math.random;
}

// Mouse is canvas (screen) pixels; the camera is the viewport's top-left in
// world coordinates, so world = camera + mouse. Shared helper in input.js
// (player.js uses the same one for the aim angle); combat.js used to carry
// its own local copy.
const mouseWorld = mouseWorldPos;

function ensureCombat(state) {
  if (!state.bullets) state.bullets = [];
  if (!state.enemies) state.enemies = [];
  if (!state._combat) {
    // combo: consecutive melee hits within the combo window (1.5 s).
    // Each hit in the chain adds +5 damage, capped at +20 — a brawl
    // rewards staying on the attack instead of trading single punches.
    // streak: consecutive gang kills within 5 s; 3+ pays a $25 bonus.
    state._combat = { fireCd: 0, reloadT: 0, reloading: false, meleeCd: 0, fPrev: false, combo: 0, comboT: 0, streak: 0, streakT: 0 };
  }
  return state._combat;
}

/** Current melee combo damage (base + chain bonus, capped). */
export function comboDamage(state) {
  const c = ensureCombat(state);
  return MELEE.damage + Math.min(20, (c.combo || 0) * 5);
}

/**
 * The fight summary for the HUD during a gang fight: how many gunmen
 * are still up, how many are down, the current melee combo and the
 * kill streak. The HUD shows this only while enemies are alive, so a
 * free-roam screen never carries a fight panel.
 */
export function combatSummary(state) {
  const c = ensureCombat(state);
  const enemies = state.enemies || [];
  let alive = 0;
  let dead = 0;
  for (const e of enemies) {
    if (e.dead) dead += 1;
    else alive += 1;
  }
  return {
    enemiesAlive: alive,
    enemiesDead: dead,
    enemiesTotal: enemies.length,
    combo: c.combo || 0,
    streak: c.streak || 0,
    reloading: !!c.reloading,
  };
}

function startReload(state) {
  const c = ensureCombat(state);
  if (c.reloading || state.player.ammo >= PISTOL.magSize) return;
  c.reloading = true;
  c.reloadT = PISTOL.reloadTime;
}

/** Spawn one Harbor Kings gunman at (x, y). Returns the enemy object. */
export function spawnEnemy(state, x, y) {
  ensureCombat(state);
  const e = {
    x, y, hp: 100, angle: 0, shootCd: rand(rngOf(state), 0.4, 1.2), dead: false,
    // Home post: the spot it guards. The return-home rule in
    // updateEnemies needs it (see there).
    homeX: x, homeY: y,
  };
  state.enemies.push(e);
  return e;
}

/**
 * Fire the pistol toward the mouse. Returns true when a bullet left the gun.
 * Ammo 0 starts the automatic reload (reserve is infinite). Firing is a
 * crime (+0.6 stars of heat) — the cops hear gunfire — EXCEPT during a
 * sanctioned gang fight: when a mission is active and live enemies are on
 * the field (the Warehouse Payback), the hits are Delia's job, not a street
 * crime, and the melee code already pays $50 per gang kill with no wanted.
 * The old code added heat on every shot regardless, so the 18 shots needed
 * to drop 6 gunmen (3 hits each from a 34-damage pistol) added 10.8 stars
 * of heat — wanted 5, five cop cars, mid-fight, on foot. Unwinnable.
 */
export function shoot(state) {
  const p = state.player;
  const c = ensureCombat(state);
  if (!p || !p.alive || p.weapon !== 'pistol' || p.inCar) return false;
  if (c.reloading || c.fireCd > 0) return false;
  if (p.ammo <= 0) {
    startReload(state);
    return false;
  }
  const target = mouseWorld(state);
  const angle = Math.atan2(target.y - p.y, target.x - p.x);
  const mx = p.x + Math.cos(angle) * 20;
  const my = p.y + Math.sin(angle) * 20;
  state.bullets.push({
    x: mx,
    y: my,
    vx: Math.cos(angle) * PISTOL.bulletSpeed,
    vy: Math.sin(angle) * PISTOL.bulletSpeed,
    life: PISTOL.range / PISTOL.bulletSpeed,
    from: 'player',
    damage: PISTOL.damage,
  });
  p.ammo -= 1;
  c.fireCd = PISTOL.fireRate;
  if (state.stats) state.stats.shotsFired = (state.stats.shotsFired || 0) + 1;
  state.lastGunshot = { x: p.x, y: p.y, at: state.time };
  // Muzzle flash: the renderer's drawMuzzleFlash draws a brief star at
  // the muzzle for 0.06s after a shot. Without it, the pistol fires
  // silently on screen — the bullet streak alone does not read as a
  // gunshot, and the player cannot tell whether the shot actually left
  // the barrel or the fire button was eaten by the reload.
  state.muzzleFlash = { x: mx, y: my, angle, at: state.time };
  // Sanctioned fight: a mission is running and its gunmen are still up.
  // Enemies only exist during the Warehouse Payback (missions.js is the
  // only spawner), so this cannot be gamed in free roam.
  const sanctioned = state.mission?.active && (state.enemies || []).some((e) => !e.dead);
  if (!sanctioned) addWanted(state, 0.6, 'shoot');
  spawnParticles(state, mx, my, 'muzzle', 3);
  addShake(state, 0.7);
  state.audio?.sfx?.('shoot');
  if (p.ammo <= 0) startReload(state);
  return true;
}

/**
 * F-melee punch. Hits the nearest enemy / ped / foot cop inside MELEE.range.
 * Punching a civilian is assault (+1 star); punching a cop who dies is a cop
 * kill (+2). Gang members shot or punched during missions pay $50, no wanted.
 * Returns true when the punch connected with something.
 */
export function melee(state) {
  const p = state.player;
  const c = ensureCombat(state);
  if (!p || !p.alive || c.meleeCd > 0) return false;
  c.meleeCd = MELEE.cooldown;

  const nearest = (list) => {
    let best = null;
    let bestD = Infinity;
    for (const t of list || []) {
      if (t.dead) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d <= MELEE.range && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  };

  // Gang members first — no wanted for fighting them. The punch uses
  // the combo damage: a hit inside the 1.5 s window chains, and the
  // chain resets when the window lapses (updateCombat counts it down).
  const enemy = nearest(state.enemies);
  if (enemy) {
    const dmg = comboDamage(state);
    hurtEnemy(state, enemy, dmg);
    c.combo = (c.combo || 0) + 1;
    c.comboT = 1.5;
    if (c.combo >= 3) addFloatText(state, p.x, p.y - 26, `COMBO x${c.combo}`, '#ffd94d');
    spawnParticles(state, enemy.x, enemy.y, 'blood', 6);
    state.audio?.sfx?.('punch');
    return true;
  }
  const cop = nearest(state.copsFoot);
  if (cop) {
    cop.hp = (cop.hp ?? 100) - MELEE.damage;
    spawnParticles(state, cop.x, cop.y, 'blood', 6);
    state.audio?.sfx?.('punch');
    if (cop.hp <= 0) {
      cop.dead = true;
      addWanted(state, 2, 'killCop');
    } else {
      addWanted(state, 1, 'assault');
    }
    return true;
  }
  const ped = nearest(state.peds);
  if (ped) {
    hurtPed(state, ped, MELEE.damage);
    spawnParticles(state, ped.x, ped.y, 'blood', 6);
    state.audio?.sfx?.('punch');
    if (!ped.dead) addWanted(state, 1, 'assault');
    return true;
  }
  return false;
}

// Damage a civilian ped. Sets BOTH death flags (see peds.js markPedDead).
// Returns true if the ped died.
function hurtPed(state, ped, dmg) {
  if (typeof ped.hp === 'number') {
    ped.hp -= dmg;
    if (ped.hp <= 0) {
      markPedDead(state, ped);
      addWanted(state, 2, 'killPed');
      return true;
    }
    return false;
  }
  markPedDead(state, ped);
  addWanted(state, 2, 'killPed');
  return true;
}

// Damage a gang member. Death pays $50 and drops cash particles; a
// kill streak (3+ gang kills inside 5 s) pays a $25 bonus on each
// further kill, so clearing a room fast is worth more than picking
// them off one at a time from cover.
function hurtEnemy(state, enemy, dmg) {
  enemy.hp -= dmg;
  if (enemy.hp <= 0 && !enemy.dead) {
    enemy.dead = true;
    const c = ensureCombat(state);
    c.streak = (c.streak || 0) + 1;
    c.streakT = 5;
    const bonus = c.streak >= 3 ? 25 : 0;
    const pay = GANG_KILL_PAY + bonus;
    state.player.money += pay;
    if (state.stats) {
      state.stats.kills = (state.stats.kills || 0) + 1;
      state.stats.moneyEarned = (state.stats.moneyEarned || 0) + pay;
    }
    addFloatText(state, enemy.x, enemy.y - 18, `+$${pay}`, '#ffd94d');
    if (bonus > 0) addFloatText(state, enemy.x, enemy.y - 36, `STREAK x${c.streak}`, '#ff9f43');
    spawnParticles(state, enemy.x, enemy.y, 'cash', 8);
    state.audio?.sfx?.('cash');
  }
}

function updateBullets(state, dt) {
  const p = state.player;
  const bullets = state.bullets;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0;
    // Buildings stop bullets.
    if (!dead && buildingHit(state.world, b.x, b.y, 2)) {
      spawnParticles(state, b.x, b.y, 'hit', 4);
      dead = true;
    }
    if (!dead && (b.x < 0 || b.x > 3200 || b.y < 0 || b.y > 2400)) dead = true;
    if (!dead && b.from === 'player') {
      // Gang members.
      for (const e of state.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < 16) {
          hurtEnemy(state, e, b.damage);
          spawnParticles(state, b.x, b.y, 'blood', 6);
          dead = true;
          break;
        }
      }
      // Civilians.
      if (!dead) {
        for (const ped of state.peds || []) {
          if (ped.dead) continue;
          if (Math.hypot(ped.x - b.x, ped.y - b.y) < 16) {
            hurtPed(state, ped, b.damage);
            spawnParticles(state, b.x, b.y, 'blood', 6);
            dead = true;
            break;
          }
        }
      }
      // Foot cops.
      if (!dead) {
        for (const cop of state.copsFoot || []) {
          if (cop.dead) continue;
          if (Math.hypot(cop.x - b.x, cop.y - b.y) < 16) {
            cop.hp = (cop.hp ?? 100) - b.damage;
            spawnParticles(state, b.x, b.y, 'blood', 6);
            if (cop.hp <= 0) {
              cop.dead = true;
              addWanted(state, 2, 'killCop');
            }
            dead = true;
            break;
          }
        }
      }
      // Any car except the player's own (traffic, parked, police).
      if (!dead) {
        for (const car of state.cars || []) {
          if (car === p.inCar || car.wrecked) continue;
          if (Math.hypot(car.x - b.x, car.y - b.y) < 26) {
            const wasPolice = car.isPolice;
            damageCar(car, b.damage, state);
            spawnParticles(state, b.x, b.y, 'spark', 6);
            if (wasPolice && car.wrecked) addWanted(state, 2, 'killCop');
            dead = true;
            break;
          }
        }
      }
    } else if (!dead && b.from === 'enemy') {
      if (!p.inCar && p.alive && Math.hypot(p.x - b.x, p.y - b.y) < 14) {
        damagePlayer(state, ENEMY_BULLET_DAMAGE);
        spawnParticles(state, p.x, p.y, 'blood', 5);
        dead = true;
      } else if (p.inCar && Math.hypot(p.x - b.x, p.y - b.y) < 30) {
        damageCar(p.inCar, 6, state);
        spawnParticles(state, b.x, b.y, 'spark', 4);
        dead = true;
      }
    }
    if (dead) bullets.splice(i, 1);
  }
  // Sweep the dead out of the enemy list.
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    if (state.enemies[i].dead) state.enemies.splice(i, 1);
  }
}

function updateEnemies(state, dt) {
  const p = state.player;
  const rng = rngOf(state);
  for (const e of state.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    e.angle = Math.atan2(dy, dx);
    if (dist > 500) {
      // Too far to care: drift back to the post instead of chasing the
      // player across the city. The old rule closed in from any distance,
      // so during the drive to the warehouse the gunmen walked 120px/s
      // for ~30 s after the player, ended up scattered behind buildings
      // the player could not shoot through, and the fight soft-locked
      // (player firing into a wall at an unreachable gunman). They guard
      // the warehouse; they advance only when the player comes to them.
      const hx = e.homeX ?? e.x;
      const hy = e.homeY ?? e.y;
      const hd = Math.hypot(hx - e.x, hy - e.y) || 1;
      if (hd > 10) {
        e.x += ((hx - e.x) / hd) * ENEMY_SPEED * dt;
        e.y += ((hy - e.y) / hd) * ENEMY_SPEED * dt;
      }
    } else if (dist > 260) {
      // Close the distance.
      e.x += (dx / dist) * ENEMY_SPEED * dt;
      e.y += (dy / dist) * ENEMY_SPEED * dt;
    }
    // Never walk into a building: an enemy inside one is unshootable
    // (bullets die on buildings) and the fight soft-locks. Push it out
    // to the face, like cars — it slides around the block instead.
    resolveBuildingCollision(state.world, e, 14);
    // Taunt: the first time a gunman gets the player in shooting range
    // he shouts a line (once per gunman). It is the fight's audio cue
    // that the player has been spotted, and it marks which gunman is
    // engaging instead of all six silently shooting from off-screen.
    if (!e.taunted && dist < ENEMY_SHOOT_RANGE && p.alive) {
      e.taunted = true;
      const line = BARKS.gunman[Math.floor(rng() * BARKS.gunman.length)];
      addFloatText(state, e.x, e.y - 26, line, '#ff9f43');
      state.audio?.sfx?.('shout');
    }
    // Shoot with inaccuracy when in range and the player is alive.
    e.shootCd -= dt;
    if (e.shootCd <= 0 && dist < ENEMY_SHOOT_RANGE && p.alive) {
      e.shootCd = 1.1 + rng() * 0.6;
      const aim = e.angle + (rng() - 0.5) * 0.24;
      state.bullets.push({
        x: e.x + Math.cos(aim) * 18,
        y: e.y + Math.sin(aim) * 18,
        vx: Math.cos(aim) * ENEMY_BULLET_SPEED,
        vy: Math.sin(aim) * ENEMY_BULLET_SPEED,
        life: ENEMY_SHOOT_RANGE / ENEMY_BULLET_SPEED,
        from: 'enemy',
        damage: ENEMY_BULLET_DAMAGE,
      });
      spawnParticles(state, e.x, e.y, 'muzzle', 2);
    }
  }
}

// Ramming: a fast player car hitting a ped / foot cop / gang member hurts them.
function updateRamming(state) {
  const p = state.player;
  const car = p.inCar;
  if (!car || Math.abs(car.speed || 0) <= 200) return;
  const hitAt = (t, r) => Math.hypot(t.x - car.x, t.y - car.y) < r;
  for (const ped of state.peds || []) {
    if (!ped.dead && hitAt(ped, 30)) {
      // A traffic accident, not a murder: +1 star, the same price as
      // peds.js checkRunOver charges for a run-over (its comment says
      // "a traffic offence (+1 star), not a murder"). This used to call
      // hurtPed(100), which charges +2 (the deliberate-kill price, right
      // for shooting or punching a ped) — so one clipped ped at 3 stars
      // during Heat Wave meant instant 5 stars, five cop cars, and a
      // wrecked getaway car before the timer ran out. The two run-over
      // paths now agree: a fast car kills the ped either way, for +1.
      markPedDead(state, ped);
      addWanted(state, 1, 'killPed');
      spawnParticles(state, ped.x, ped.y, 'blood', 8);
      addShake(state, 4);
      state.audio?.sfx?.('hit');
    }
  }
  for (const cop of state.copsFoot || []) {
    if (!cop.dead && hitAt(cop, 30)) {
      cop.hp = 0;
      cop.dead = true;
      addWanted(state, 2, 'killCop');
      spawnParticles(state, cop.x, cop.y, 'blood', 8);
      addShake(state, 4);
      state.audio?.sfx?.('hit');
    }
  }
  for (const e of state.enemies) {
    if (!e.dead && hitAt(e, 30)) {
      hurtEnemy(state, e, 100);
      addShake(state, 4);
      state.audio?.sfx?.('hit');
    }
  }
}

export function updateCombat(state, dt) {
  const p = state.player;
  const c = ensureCombat(state);
  if (!p || !p.alive) return;
  if (state.mode && state.mode !== 'playing') return;

  if (c.fireCd > 0) c.fireCd -= dt;
  if (c.meleeCd > 0) c.meleeCd -= dt;

  // Melee combo window: 1.5 s from the last connecting hit, then the
  // chain resets to zero. Kill streak window: 5 s from the last gang
  // kill, then the streak resets (the bonus only pays inside it).
  if (c.comboT > 0) {
    c.comboT -= dt;
    if (c.comboT <= 0) c.combo = 0;
  }
  if (c.streakT > 0) {
    c.streakT -= dt;
    if (c.streakT <= 0) c.streak = 0;
  }

  // Reload: automatic when the mag runs dry, manual on R.
  if (c.reloading) {
    c.reloadT -= dt;
    if (c.reloadT <= 0) {
      c.reloading = false;
      p.ammo = PISTOL.magSize;
      state.audio?.sfx?.('reload');
    }
  } else if (p.weapon === 'pistol' && p.ammo < PISTOL.magSize && state.keys?.has('KeyR')) {
    startReload(state);
  }

  // Hold LMB to fire (on foot only — no drive-bys).
  if (state.mouse?.down && p.weapon === 'pistol' && !p.inCar) shoot(state);

  // F melee, edge-triggered so holding F does not machine-gun punches.
  const fDown = !!state.keys?.has('KeyF');
  if (fDown && !c.fPrev) melee(state);
  c.fPrev = fDown;

  updateBullets(state, dt);
  updateEnemies(state, dt);
  updateRamming(state);
}

// --- Bounty hunting helpers -------------------------------------------------
// The bounty tracker needs to know how far the target is, and the
// nearest live gang member is the answer — the same nearest search
// the melee code runs, but over enemies and at any range, not just
// inside punch distance. A bounty target is an enemy like any other
// (combat.js spawnEnemy), so the tracker reads the field, not a
// second list: the target is the nearest enemy, and the bounty
// marker in missions.js already knows which one it is.

/** The nearest live enemy to (x, y) within maxDist, or null. */
export function nearestEnemy(state, x, y, maxDist = Infinity) {
  let best = null;
  let bestD = maxDist;
  for (const e of state.enemies || []) {
    if (!e || e.dead) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
