// Port Solano — particles, screen shake and floating text.
//
// All effects live in state.particles (contract field) and state.floatTexts.
// spawnParticles is self-wired onto state.spawnParticles so other builders can
// call state.spawnParticles?.(x, y, kind, n); main.js still assigns it
// explicitly before the loop:
//   state.spawnParticles = (x, y, kind, n) => spawnParticles(state, x, y, kind, n);
//
// OWNERSHIP: effects.js owns the screen shake decay (state.shake falls here
// at 42 px/s). main.js must NOT decay shake itself or the shake halves.
import { VIEW, WEATHER } from './config.js';

const MAX_PARTICLES = 400;
const MAX_FLOAT_TEXTS = 24;

// Per-kind behaviour: colours, speed, life, size, gravity (negative = rises).
const KINDS = {
  smoke: { colors: ['#8a8f96', '#6b7076', '#a9adb3'], speed: 46, life: 0.9, size: 7, grav: -24, grow: 14 },
  spark: { colors: ['#ffd94d', '#fff3b0', '#ff9d2e'], speed: 320, life: 0.3, size: 3, grav: 300, grow: 0 },
  muzzle: { colors: ['#fff3b0', '#ffd94d'], speed: 40, life: 0.07, size: 11, grav: 0, grow: 0 },
  blood: { colors: ['#7a1010', '#5d0b0b', '#931616'], speed: 130, life: 0.5, size: 4, grav: 220, grow: 0 },
  hit: { colors: ['#ffd94d', '#ff9d2e', '#c8c8c8'], speed: 200, life: 0.4, size: 4, grav: 260, grow: 0 },
  skid: { colors: ['#9aa0a8', '#7d838c'], speed: 12, life: 0.4, size: 5, grav: 0, grow: 6 },
  cash: { colors: ['#ffd94d', '#7ddb6a', '#f2c94c'], speed: 90, life: 0.8, size: 3, grav: -70, grow: 0 },
  explosion: { colors: ['#ff9d2e', '#ff5a1f', '#ffd94d', '#8a8f96'], speed: 260, life: 0.7, size: 8, grav: -30, grow: 10 },
  // Water spray (a car clipping the harbour edge, a ped knocked in).
  splash: { colors: ['#1f7fa8', '#4fb3d9', '#bfe8f5'], speed: 190, life: 0.6, size: 4, grav: 420, grow: 0 },
  // Window glass when a car is wrecked / a hard hit lands.
  glass: { colors: ['#bfe8f5', '#7fb8c9', '#e8f6fa'], speed: 280, life: 0.5, size: 3, grav: 380, grow: 0 },
  // Dust kicked up by a drifting car or a sprinting player on the sidewalk.
  dust: { colors: ['#b7a98d', '#c9b18a', '#9a8a6a'], speed: 60, life: 0.7, size: 6, grav: -12, grow: 12 },
  // Rain: fast falling streaks (drawn as lines, not circles — see
  // drawParticles). Spawned by spawnRain, not by spawnParticles: rain
  // falls straight down with a slight slant, never in a random burst.
  rain: { colors: ['#9db8c9', '#7fa0b5', '#b8cdd9'], speed: 700, life: 0.45, size: 2, grav: 0, grow: 0 },
  // Gold: the bounty and achievement burst — bright, rising, slow.
  // It is the only particle kind that rises fast and lives long, so a
  // gold burst reads as a celebration, not an explosion: cash is the
  // same colours but falls, gold climbs.
  gold: { colors: ['#ffd94d', '#fff3b0', '#f2c94c', '#ffffff'], speed: 120, life: 1.1, size: 4, grav: -160, grow: 2 },
};

function pickColor(rng, colors) {
  return colors[Math.floor(rng() * colors.length)];
}

/**
 * Spawn n particles of kind at (x, y). Kinds: smoke, spark, muzzle, blood
 * (dark red puff, no gore detail), hit, skid, cash, explosion, splash,
 * glass, dust. Unknown kinds fall back to smoke. Capped so a big explosion
 * cannot flood the frame.
 */
export function spawnParticles(state, x, y, kind, n = 10) {
  if (!state.particles) state.particles = [];
  if (!state.spawnParticles) {
    state.spawnParticles = (sx, sy, sk, sn) => spawnParticles(state, sx, sy, sk, sn);
  }
  const def = KINDS[kind] || KINDS.smoke;
  const rng = state.rng || Math.random;
  for (let i = 0; i < n; i++) {
    if (state.particles.length >= MAX_PARTICLES) return;
    const a = rng() * Math.PI * 2;
    const sp = def.speed * (0.35 + rng() * 0.85);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: def.life * (0.6 + rng() * 0.7),
      maxLife: def.life,
      size: def.size * (0.7 + rng() * 0.6),
      color: pickColor(rng, def.colors),
      grav: def.grav,
      grow: def.grow,
      kind,
    });
  }
}

/** Screen shake: state.shake is consumed by the renderer as a pixel offset. */
export function addShake(state, amt) {
  if (!state) return;
  state.shake = Math.min(24, (state.shake || 0) + amt);
}

/**
 * A directional burst: n particles of kind thrown mostly along `angle`
 * (spread ±0.5 rad), for impacts that have a direction — a car hit from
 * the side throws glass and sparks away from the impact, an explosion
 * throws debris down the road. Falls back to spawnParticles when the
 * angle is not finite.
 */
export function spawnBurst(state, x, y, kind, n, angle) {
  if (!state || !Number.isFinite(angle)) {
    spawnParticles(state, x, y, kind, n);
    return;
  }
  if (!state.particles) state.particles = [];
  if (!state.spawnParticles) {
    state.spawnParticles = (sx, sy, sk, sn) => spawnParticles(state, sx, sy, sk, sn);
  }
  const def = KINDS[kind] || KINDS.smoke;
  const rng = state.rng || Math.random;
  for (let i = 0; i < n; i++) {
    if (state.particles.length >= MAX_PARTICLES) return;
    const a = angle + (rng() - 0.5) * 1.0;
    const sp = def.speed * (0.4 + rng() * 0.8);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: def.life * (0.6 + rng() * 0.7),
      maxLife: def.life,
      size: def.size * (0.7 + rng() * 0.6),
      color: pickColor(rng, def.colors),
      grav: def.grav,
      grow: def.grow,
      kind,
    });
  }
}

/** Rising text that fades out (payouts, "+$50", "RELOADING…"). */
export function addFloatText(state, x, y, text, color = '#ffffff') {
  if (!state.floatTexts) state.floatTexts = [];
  if (state.floatTexts.length >= MAX_FLOAT_TEXTS) state.floatTexts.shift();
  state.floatTexts.push({ x, y, text, color, life: 1.4, maxLife: 1.4 });
}

/**
 * A dialogue bark: floating text with a dark pill behind it, so a line
 * reads as speech instead of a payout. Peds (peds.js) and gunmen use
 * this; payouts and "+$50" stay plain addFloatText. The pill is drawn
 * by drawParticles (bark texts carry bark: true).
 */
export function addBark(state, x, y, text, color = '#ffffff') {
  if (!state.floatTexts) state.floatTexts = [];
  if (state.floatTexts.length >= MAX_FLOAT_TEXTS) state.floatTexts.shift();
  state.floatTexts.push({ x, y, text, color, life: 1.6, maxLife: 1.6, bark: true });
}

/**
 * Rain, spawned across the camera view while it rains. Called from
 * main.js's step when state.sky.rainAmount > 0: WEATHER.rainRate streaks
 * per second, scaled by the rain amount (a storm is denser than a
 * drizzle). Streaks fall straight down with a slight slant and die at
 * the end of their short life — the ground hit is implied, not drawn,
 * so a storm costs no extra particles beyond the streaks themselves.
 */
export function spawnRain(state, dt) {
  if (!state.particles) state.particles = [];
  const sky = state.sky;
  if (!sky || sky.rainAmount <= 0.05) return;
  const cam = state.camera || { x: 0, y: 0 };
  const rng = state.rng || Math.random;
  const def = KINDS.rain;
  let n = WEATHER.rainRate * sky.rainAmount * dt;
  // Fractional spawn: accumulate the remainder so the rate is exact
  // over time instead of rounding down to zero on short frames.
  state._rainAcc = (state._rainAcc || 0) + n;
  const count = Math.floor(state._rainAcc);
  state._rainAcc -= count;
  for (let i = 0; i < count; i++) {
    if (state.particles.length >= MAX_PARTICLES) return;
    const x = cam.x + rng() * VIEW.width;
    const y = cam.y + rng() * VIEW.height;
    state.particles.push({
      x,
      y,
      vx: -60 - rng() * 40,
      vy: def.speed * (0.8 + rng() * 0.4),
      life: def.life * (0.6 + rng() * 0.7),
      maxLife: def.life,
      size: def.size,
      color: def.colors[Math.floor(rng() * def.colors.length)],
      grav: 0,
      grow: 0,
      kind: 'rain',
    });
  }
}

/** True while a lightning flash is lit (render.js draws the white overlay). */
export function flashActive(state) {
  return !!state.sky && state.sky.flashT > 0;
}

/**
 * Collision sparks: n bright orange-white streaks bursting from (x, y)
 * in random directions, fast and short-lived (0.35 s). A hard impact —
 * a car hitting a wall, a cop ramming the player — reads as sparks,
 * not smoke: smoke is slow and grey (a wreck burning), sparks are
 * fast and bright (metal on metal, right now). The burst is capped by
 * MAX_PARTICLES like everything else, so a pile-up cannot flood the
 * particle list.
 */
export function spawnSparks(state, x, y, n = 10) {
  if (!state.particles) state.particles = [];
  const rng = state.rng || Math.random;
  for (let i = 0; i < n; i++) {
    if (state.particles.length >= MAX_PARTICLES) return;
    const ang = rng() * Math.PI * 2;
    const speed = 120 + rng() * 260;
    state.particles.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0.35 * (0.6 + rng() * 0.7),
      maxLife: 0.35,
      size: 2 + rng() * 2,
      color: rng() < 0.5 ? '#ffd94d' : '#ff9f43',
      grav: 320,
      grow: 0,
      kind: 'spark',
    });
  }
}

export function updateParticles(state, dt) {
  const list = state.particles || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const pt = list[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      list.splice(i, 1);
      continue;
    }
    pt.vy += pt.grav * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    if (pt.grow) pt.size += pt.grow * dt;
  }
  const texts = state.floatTexts || [];
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= dt;
    t.y -= 34 * dt;
    if (t.life <= 0) texts.splice(i, 1);
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - 42 * dt);
}

export function drawParticles(ctx, state) {
  const list = state.particles || [];
  ctx.save();
  for (const pt of list) {
    const a = Math.max(0, Math.min(1, pt.life / pt.maxLife));
    ctx.globalAlpha = a * (pt.kind === 'smoke' ? 0.55 : 0.95);
    ctx.fillStyle = pt.color;
    if (pt.kind === 'rain') {
      // A rain streak is a short slanted line, not a dot: the streak
      // reads as falling water at a glance, a dot reads as a snowflake.
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - 3, pt.y + 14);
      ctx.stroke();
      continue;
    }
    if (pt.kind === 'spark') {
      // A spark is a short bright line along its velocity, not a dot:
      // the streak reads as motion, and a dot would read as an ember.
      const len = Math.hypot(pt.vx, pt.vy) * 0.03;
      const nx = len > 0.5 ? (pt.vx / Math.hypot(pt.vx, pt.vy)) * len : 0;
      const ny = len > 0.5 ? (pt.vy / Math.hypot(pt.vx, pt.vy)) * len : 0;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - nx, pt.y - ny);
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(0.5, pt.size * (0.5 + a * 0.5)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const texts = state.floatTexts || [];
  if (texts.length) {
    ctx.save();
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const t of texts) {
      const a = Math.max(0, Math.min(1, t.life / t.maxLife));
      ctx.globalAlpha = a;
      if (t.bark) {
        // Speech pill: a dark rounded background behind the line, so a
        // bark is readable over a bright road or a dark building.
        // roundRect is guarded (older canvases lack it) — a plain rect
        // is the same pill with square corners, not a crash.
        const w = ctx.measureText(t.text).width + 14;
        ctx.fillStyle = 'rgba(12, 18, 24, 0.82)';
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(t.x - w / 2, t.y - 19, w, 22, 6);
          ctx.fill();
        } else {
          ctx.fillRect(t.x - w / 2, t.y - 19, w, 22);
        }
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
