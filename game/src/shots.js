// Port Solano — the ?shot= screenshot scenes.
//
// The six scenes behind ?shot=start|drive|chase|mission|night|jobs. Each one plays the
// real rules forward from a fresh world for a fixed settle (GAME.
// shotSettleSeconds, 2 s) so the frame is what a short game really looks
// like, and the same ?seed= always gives the same frame. main.js's
// stageShot does the staging; this module is the contract it stages
// against — the scene names, what each one shows, and the mode it lands
// in — so a scene name is validated in exactly one place.
//
// This file used to be dead starter code for a different game (a paddle /
// block / coin game): it imported FIELD, EVENT_OVER, KIND_BLOCK and screen
// constants that do not exist in this codebase, referenced world.reset()
// and world.step(), and would have thrown on import. Nothing imported it.
// It is now the shot-scene table, and main.js imports it.
import { GAME } from './config.js';

/** Seconds of simulation before the first ?shot= frame is painted. */
export const SHOT_SETTLE_SECONDS = GAME.shotSettleSeconds;

/**
 * The scenes, in the order the packaging docs list them. `mode` is the
 * mode stageShot leaves the game in; `shows` is what the screenshot is
 * supposed to capture, so a scene that lands in the wrong mode (or with
 * the wrong content) is a staging bug, not a camera problem.
 */
export const SHOT_SCENES = {
  start: {
    mode: 'title',
    shows: 'The title screen over a living city vista — traffic and peds moving, no crimes.',
  },
  drive: {
    mode: 'playing',
    shows: 'Rook driving a coupe down an avenue at speed, traffic ahead and behind in both lanes.',
  },
  chase: {
    mode: 'playing',
    shows: 'A 3-star chase: Rook in a sedan at 380px/s with two cop cars on his tail, sirens on.',
  },
  mission: {
    mode: 'playing',
    shows: 'Mission 1 underway: Rook in Delia\'s sedan, the marina pickup objective live.',
  },
  night: {
    mode: 'playing',
    shows: 'Midnight in Port Solano: Rook in a Comet GT under the night overlay, headlights on, lit windows.',
  },
  jobs: {
    mode: 'playing',
    shows: 'Free roam with a taxi fare on the board: Rook in a cab near the pickup marker, job tracker live.',
  },
};

/** The scene names, in order. */
export const SHOT_NAMES = Object.keys(SHOT_SCENES);

/** True when `name` is a real scene; anything else stages as 'start'. */
export function isShotScene(name) {
  return Object.prototype.hasOwnProperty.call(SHOT_SCENES, name);
}

/** Normalize a raw ?shot= value to a real scene name ('start' by default). */
export function normalizeShot(name) {
  return isShotScene(name) ? name : 'start';
}

/** The mode a scene lands in ('title' for start, 'playing' otherwise). */
export function shotMode(name) {
  return SHOT_SCENES[normalizeShot(name)].mode;
}

/**
 * The scene's one-line description ("A 3-star chase: ..."), for the
 * packaging docs and the screenshot checklist — the scene table is
 * the contract, and this is the sentence that says what the frame is
 * supposed to show, so a screenshot that does not match it is a
 * staging bug, not a camera problem.
 */
export function shotDescription(name) {
  return SHOT_SCENES[normalizeShot(name)].shows;
}

/** The scene names with their modes and descriptions, in order. */
export function shotList() {
  return SHOT_NAMES.map((name) => ({
    name,
    mode: SHOT_SCENES[name].mode,
    shows: SHOT_SCENES[name].shows,
  }));
}
