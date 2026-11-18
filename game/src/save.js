// Port Solano — localStorage save / load. Plain JSON only, one key.
// SAVE_KEY 'portsolano-save-v1' — the same key config.js documents.
//
// What is saved: money, the highest UNLOCKED mission index (0..6; 6 = all
// jobs done), the player's vitals + position, the list of completed mission
// ids, and the clock — plus, since v2, the career record (stats), the radio
// station, the time of day and the weather. What is NOT saved, by design: any mid-mission stage,
// timer, waypoint or enemy — Continue restarts the next unlocked job from
// its beginning (see main.js loadSave).
export const SAVE_KEY = 'portsolano-save-v1';

/** The save schema version. Bump when the shape changes; older saves are rejected, not guessed at. */
export const SAVE_VERSION = 3;

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

// --- validation ------------------------------------------------------------
// A save is player-editable JSON in localStorage: a hand-edited (or
// truncated, or half-written) value must never crash the load or put the
// player out of the world. Every field is type-checked and clamped; the
// first bad field rejects the whole save (return null) instead of loading
// a half-valid state the game then has to defend against everywhere.

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampNum(v, lo, hi, fallback) {
  if (!isFiniteNumber(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Validate a parsed save object. Returns a cleaned copy (numbers clamped,
 * strings filtered, missing optionals defaulted) or null when the save is
 * not a v2 save at all. Exported for tests and for main.js's load path.
 *
 * v2 adds the career record (stats), the radio station, the clock and the
 * weather. v1 saves are rejected by the version check (they predate those
 * fields), not upgraded — a v1 save has no stats to carry over. v3 adds
 * the garages, the achievements and the bounty board (and the radio
 * index now runs 0..7 for the eight stations); a v2 save is rejected
 * by the same version check, not upgraded — the new systems start
 * empty on a fresh v3 save, and the old career carries over only
 * through the v3 fields it already wrote.
 */
export function validateSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.version !== SAVE_VERSION) return null;
  if (!isFiniteNumber(data.money)) return null;
  if (!isFiniteNumber(data.missionIndex)) return null;
  if (data.player !== undefined && (typeof data.player !== 'object' || data.player === null)) return null;
  if (data.completedMissions !== undefined && !Array.isArray(data.completedMissions)) return null;
  if (data.time !== undefined && !isFiniteNumber(data.time)) return null;
  // savedAt is optional (old v1 saves predate it) and never trusted as a
  // date: a negative or far-future value is dropped, not displayed.
  if (data.savedAt !== undefined && !isFiniteNumber(data.savedAt)) return null;
  // v2 fields are optional in the JSON (a hand-written save may omit
  // them) but validated when present: stats must be an object of finite
  // numbers, radioStation an index, timeOfDay 0..1, weather a known kind.
  if (data.stats !== undefined && (typeof data.stats !== 'object' || data.stats === null || Array.isArray(data.stats))) return null;
  if (data.radioStation !== undefined && !isFiniteNumber(data.radioStation)) return null;
  if (data.timeOfDay !== undefined && !isFiniteNumber(data.timeOfDay)) return null;
  if (data.weather !== undefined && !['clear', 'overcast', 'rain', 'storm'].includes(data.weather)) return null;
  // v3 fields are optional too, but validated when present: garages
  // is a list of garage ids, achievements a list of achievement ids,
  // and the bounty counters are finite numbers. A hand-written save
  // that names a garage that does not exist is rejected whole — the
  // load must never resurrect a place the game never built.
  if (data.garages !== undefined && !Array.isArray(data.garages)) return null;
  if (data.achievements !== undefined && !Array.isArray(data.achievements)) return null;
  if (data.bountiesDone !== undefined && !isFiniteNumber(data.bountiesDone)) return null;
  if (data.bountiesEarned !== undefined && !isFiniteNumber(data.bountiesEarned)) return null;
  if (data.bountyIds !== undefined && !Array.isArray(data.bountyIds)) return null;

  const p = data.player || {};
  const now = Date.now();
  const savedAt = isFiniteNumber(data.savedAt) && data.savedAt > 0 && data.savedAt <= now + 86400000
    ? data.savedAt
    : null;
  const rawStats = data.stats || {};
  const stats = {};
  for (const key of ['moneyEarned', 'missionsDone', 'jobsDone', 'jobMoney', 'carsStolen', 'arrestsEscaped', 'pedsHit', 'shotsFired', 'kills', 'topSpeed', 'timePlayed', 'eventsDone', 'eventsEarned', 'bountiesDone', 'bountiesEarned']) {
    stats[key] = clampNum(rawStats[key], 0, 1e9, 0);
  }
  // v3: the garages Rook owns (validated against the known ids —
  // an unknown id is dropped, not loaded) and the achievements he
  // has earned (same rule: unknown ids are dropped). The radio
  // station now clamps to 0..7 — eight stations since the second
  // wave, not the six the v2 clamp knew.
  const KNOWN_GARAGES = ['marina-lockup', 'downtown-garage', 'docks-warehouse', 'hilltop-villa', 'eastside-duplex', 'pier-house'];
  const KNOWN_ACHIEVEMENTS = ['first-job', 'first-grand', 'wheelman', 'car-thief', 'trigger-happy', 'gangbuster', 'fare-master', 'streak-3', 'bounty-hunter', 'homeowner', 'clean-escape', 'night-owl', 'lifer', 'survivor', 'legend', 'all-jobs'];
  const KNOWN_BOUNTIES = ['vic-kane', 'lena-cross', 'eddie-marsh', 'tomas-rivas', 'darla-vane', 'oscar-boone', 'nina-vasquez', 'ray-delgado', 'marta-kane', 'joe-peluso'];
  return {
    version: SAVE_VERSION,
    money: clampNum(data.money, 0, 99999999, 0),
    missionIndex: clampNum(data.missionIndex, 0, 6, 0),
    player: {
      x: clampNum(p.x, 16, 3184, 1400),
      y: clampNum(p.y, 16, 2244, 1000),
      hp: clampNum(p.hp, 1, 100, 100),
      armor: clampNum(p.armor, 0, 100, 0),
      weapon: p.weapon === 'pistol' ? 'pistol' : 'fists',
      ammo: clampNum(p.ammo, 0, 999, 0),
    },
    completedMissions: (data.completedMissions || []).filter((id) => typeof id === 'string'),
    time: clampNum(data.time, 0, 1e9, 0),
    savedAt,
    stats,
    radioStation: clampNum(data.radioStation, 0, 7, 0),
    timeOfDay: clampNum(data.timeOfDay, 0, 1, 0.5),
    weather: data.weather || 'clear',
    garages: (data.garages || []).filter((id) => KNOWN_GARAGES.includes(id)),
    garageHome: typeof data.garageHome === 'string' && KNOWN_GARAGES.includes(data.garageHome) ? data.garageHome : null,
    achievements: (data.achievements || []).filter((id) => KNOWN_ACHIEVEMENTS.includes(id)),
    bountiesDone: clampNum(data.bountiesDone, 0, 1e9, 0),
    bountiesEarned: clampNum(data.bountiesEarned, 0, 1e9, 0),
    bountyIds: (data.bountyIds || []).filter((id) => KNOWN_BOUNTIES.includes(id)),
  };
}

/**
 * A human-readable "saved <date>" label for the Continue button, or null
 * when the save has no trustworthy timestamp. Uses the locale's short
 * date + time, so the player can tell this session's save from an old one.
 */
export function saveDateLabel(data) {
  const d = data && data.savedAt ? new Date(data.savedAt) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * One-line summary of a save for the Continue button
 * ("$1,250 · 3/6 jobs · saved 18 Nov, 14:32"). Null when the save is
 * not valid — the button then shows a plain "Continue" instead of a lie.
 */
export function saveSummary(data) {
  const clean = validateSave(data);
  if (!clean) return null;
  const jobs = clean.completedMissions.length;
  const date = saveDateLabel(clean);
  const money = `$${clean.money.toLocaleString('en-US')}`;
  return date ? `${money} · ${jobs}/6 jobs · saved ${date}` : `${money} · ${jobs}/6 jobs`;
}

/** Persist money, highest unlocked mission, player vitals and progress. */
export function saveGame(state) {
  const store = storage();
  if (!store || !state.player) return false;
  const p = state.player;
  const m = state.mission || {};
  const data = {
    version: SAVE_VERSION,
    money: p.money || 0,
    // Highest unlocked mission index (0..6; 6 = all missions complete).
    missionIndex: Math.min(6, Math.max(0, m.unlocked ?? 0)),
    player: {
      x: p.x,
      y: p.y,
      hp: p.hp,
      armor: p.armor || 0,
      weapon: p.weapon || 'fists',
      ammo: p.ammo || 0,
    },
    completedMissions: Array.isArray(m.completed)
      ? m.completed.filter((id) => typeof id === 'string')
      : [],
    time: state.time || 0,
    // When the save was written (epoch ms): the Continue button shows
    // "Continue — saved <date>", so the player can tell whether the save
    // is from this session or an old one. Validated on load (a negative
    // or far-future timestamp is clamped, never trusted as a date).
    savedAt: Date.now(),
    // v2: the career record, the radio station, the clock and the
    // weather — so Continue resumes the same career, the same station
    // and the same time of day, not a fresh noon with empty stats.
    stats: { ...(state.stats || {}) },
    radioStation: state.audio && typeof state.audio.stationIndex === 'number' ? state.audio.stationIndex : 0,
    timeOfDay: state.sky ? state.sky.timeOfDay : 0.5,
    weather: state.sky ? state.sky.weather : 'clear',
    // v3: the garages Rook owns (and the home, which is the last one
    // bought), the achievements he has earned, and the bounty board's
    // career numbers — so Continue resumes the same roof, the same
    // titles and the same hunt, not a fresh start with the board full
    // of heads he already collected.
    garages: state.garages && Array.isArray(state.garages.owned) ? state.garages.owned.slice() : [],
    garageHome: state.garages ? state.garages.home : null,
    achievements: state.achievements && Array.isArray(state.achievements.unlocked) ? state.achievements.unlocked.slice() : [],
    bountiesDone: state.bounties ? state.bounties.done || 0 : 0,
    bountiesEarned: state.bounties ? state.bounties.earned || 0 : 0,
    bountyIds: state.bounties && Array.isArray(state.bounties.doneIds) ? state.bounties.doneIds.slice() : [],
  };
  try {
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Returns the validated save object, or null when there is no (or corrupt) save. */
export function loadGame() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    return validateSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasSave() {
  return loadGame() !== null;
}

export function clearSave() {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a loaded save to a fresh state. main.js calls this right after
 * building state and before the loop, then restarts the next unlocked job.
 * Mid-mission progress is deliberately NOT restored: the mission fields are
 * reset to "no job running" and the caller starts the next unlocked one.
 */
export function applySave(state, save) {
  // Re-validate even though loadGame already did: applySave is exported
  // and main.js is not its only possible caller, and a save that was
  // valid when written can be edited between write and apply.
  const clean = validateSave(save);
  if (!clean || !state.player) return;
  const p = state.player;
  p.money = clean.money;
  p.x = clean.player.x;
  p.y = clean.player.y;
  p.hp = clean.player.hp;
  p.armor = clean.player.armor;
  p.weapon = clean.player.weapon;
  p.ammo = clean.player.ammo;
  if (state.mission) {
    state.mission.unlocked = clean.missionIndex;
    state.mission.completed = clean.completedMissions.slice();
    // No job is running after a load; the next unlocked job starts fresh.
    state.mission.index = -1;
    state.mission.stage = 0;
    state.mission.data = {};
    state.mission.timer = 0;
    state.mission.active = false;
    state.mission.brief = null;
    state.mission.briefT = 0;
    state.mission.failT = 0;
    state.mission.objectiveText = '';
    state.mission.waypoint = null;
  }
  state.time = clean.time;
  // v2: the career record, the radio station, the clock and the weather.
  // The station is set through audio.setStation (it wraps and plays the
  // change blip); the sky is written directly — no weather roll fires
  // on load, so Continue resumes the weather that was saved.
  if (clean.stats) state.stats = { ...(state.stats || {}), ...clean.stats };
  if (state.audio && typeof state.audio.setStation === 'function') {
    state.audio.setStation(clean.radioStation || 0);
  }
  if (state.sky) {
    state.sky.timeOfDay = clean.timeOfDay;
    state.sky.weather = clean.weather;
    state.sky.rainAmount = clean.weather === 'rain' ? 0.7 : clean.weather === 'storm' ? 1 : 0;
  }
  // v3: the garages, the achievements and the bounty board. The home
  // is restored only when it is one of the owned garages — a save
  // that names a home Rook never bought is a lie, and the respawn
  // point falls back to the marina instead of a stranger's villa.
  if (state.garages) {
    state.garages.owned = (clean.garages || []).slice();
    state.garages.home = state.garages.owned.includes(clean.garageHome) ? clean.garageHome : (state.garages.owned[0] || null);
  }
  if (state.achievements) {
    state.achievements.unlocked = (clean.achievements || []).slice();
    state.achievements.lastUnlock = state.achievements.unlocked[state.achievements.unlocked.length - 1] || null;
  }
  if (state.bounties) {
    state.bounties.done = clean.bountiesDone || 0;
    state.bounties.earned = clean.bountiesEarned || 0;
    state.bounties.doneIds = (clean.bountyIds || []).slice();
  }
}
