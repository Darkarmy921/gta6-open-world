// A small seeded random number generator (mulberry32): the same seed gives the
// same city and the same game, which is what makes the screenshot scenes
// repeatable. The function form matches the kit starter's createRandom.
//
// One rule for the whole codebase: anything that must be repeatable for a
// given seed draws from state.rng (a function built by createRandom). Math.random
// is only for cosmetics that never affect gameplay (muzzle flicker, audio noise).

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn any seed value (number, or a string such as a ?seed= param) into an int. */
export function seedFromString(seed) {
  if (Number.isInteger(seed)) return seed | 0;
  const text = String(seed ?? '');
  if (/^-?\d+$/.test(text.trim())) return parseInt(text.trim(), 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Uniform float in [min, max). */
export function rand(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * One float from state.rng, tolerating the three shapes it can take
 * (a bare function, an object with .next(), an object with .random())
 * and falling back to Math.random when there is no seeded rng at all.
 * traffic.js and peds.js each carried their own copy of this; there is
 * now one, here, so a shape change only has to be made once.
 */
export function rngFloat(state) {
  const rng = state && state.rng;
  if (typeof rng === 'function') return rng();
  if (rng && typeof rng.next === 'function') return rng.next();
  if (rng && typeof rng.random === 'function') return rng.random();
  return Math.random();
}

/** Uniform integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One element of `items`, uniformly. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/** True with probability `p` (0..1). */
export function chance(rng, p) {
  return rng() < p;
}

/** -1 or +1, uniformly. */
export function randSign(rng) {
  return rng() < 0.5 ? -1 : 1;
}

/** A new array with `items` shuffled (Fisher-Yates, seeded). */
export function shuffle(rng, items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// --- New helpers for the side-job / weather / radio systems -----------------

/**
 * One entry of `entries` ([value, weight] pairs), weighted by weight.
 * Weights are relative; a zero total falls back to a uniform pick.
 * Used for weather rolls and job-offer picks, where "clear" should come
 * up far more often than "storm" without a chain of if/else.
 */
export function pickWeighted(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  if (total <= 0) return entries[Math.floor(rng() * entries.length)][0];
  let roll = rng() * total;
  for (const [value, w] of entries) {
    roll -= Math.max(0, w);
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

/**
 * A roughly normal value around `mean` with spread `sd` (Box-Muller).
 * Used for job payouts and ped speeds, which should cluster around a
 * typical value instead of spreading uniformly from min to max.
 */
export function gaussian(rng, mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Linear interpolation between a and b at t (0..1). */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Clamp to 0..1. */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * `n` distinct elements of `items`, in random order (partial Fisher-Yates).
 * Used to pick job destinations and bark lines without repeats.
 */
export function sample(rng, items, n) {
  const out = items.slice();
  const take = Math.min(n, out.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rng() * (out.length - i));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out.slice(0, take);
}

/**
 * The tip of the day for a seed: one line from the TIPS table, picked
 * by a seeded shuffle of the table, so the same seed always shows the
 * same tip and a different seed shows a different one. The title
 * screen shows it; the pause menu could too. The table lives in
 * config.js (TIPS) and the pick lives here, so the tip is data, not
 * a hardcoded string in the HUD.
 */
export function tipForSeed(seed, tips) {
  if (!tips || tips.length === 0) return '';
  const rng = createRandom(seed);
  const order = shuffle(rng, tips);
  return order[0];
}

// --- Small chance helpers ---------------------------------------------------
// The bounty board flips a coin before dealing a fresh offer, and the
// street events roll dice for their spawns — both are one-liners over
// the same seeded rng the rest of the game uses, so a seeded run
// replays the same coin and the same dice. A coin is just a 50/50
// chance with a name the reader understands; a die is a 1..sides roll
// with a name the reader understands. Nothing here invents entropy —
// the rng is passed in, and the same seed gives the same result.

/** True half the time, from the passed rng. */
export function coinFlip(rng) {
  const r = typeof rng === 'function' ? rng : Math.random;
  return r() < 0.5;
}

/** A 1..sides roll from the passed rng (a d6 is dice(rng, 6)). */
export function dice(rng, sides = 6) {
  const r = typeof rng === 'function' ? rng : Math.random;
  return 1 + Math.floor(r() * sides);
}
