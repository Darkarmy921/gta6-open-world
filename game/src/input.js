// Keyboard and pointer input, shared by every system that needs it.
// `keys` is the live set of held key codes, `mouse` the live pointer state,
// and `pressed` the set of codes pressed since the last frame (one-shot
// actions such as "enter car" read it, then the loop clears it with
// endFrame, so a press between two frames is never lost or counted twice).
//
// OWNERSHIP: main.js is the ONLY reader of the E key (and of Enter / Space /
// P / Escape). It asks missions.tryInteract() first and only then treats E
// as enter/exit car, so one press can never both start a job and steal a car.
// No other module reads `pressed` for E; player.js / combat.js read the held
// `keys` set (movement, driving, F-melee edge via their own prev flag).

export const keys = new Set();
export const mouse = { x: 0, y: 0, down: false, clicked: false };
export const pressed = new Set();

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyE', 'KeyQ', 'KeyR', 'KeyM', 'KeyN', 'KeyT', 'KeyP', 'KeyF', 'KeyG',
  'Space', 'Enter', 'Escape', 'ShiftLeft', 'ShiftRight',
]);

/**
 * The control scheme, as data — the HUD's controls hint and the pause
 * screen read this instead of hardcoding the key list in two places.
 * N cycles the radio station (audio.js owns it), T toggles the stats
 * screen (main.js owns it). M still toggles music.
 */
export const KEY_BINDINGS = [
  { keys: 'WASD / Arrows', action: 'Move / drive' },
  { keys: 'Mouse', action: 'Aim' },
  { keys: 'LMB', action: 'Shoot' },
  { keys: 'F', action: 'Punch' },
  { keys: 'E', action: 'Interact / enter car' },
  { keys: 'R', action: 'Reload' },
  { keys: 'M', action: 'Music on / off' },
  { keys: 'N', action: 'Next radio station' },
  { keys: 'T', action: 'Stats screen' },
  { keys: 'G', action: 'City guide' },
  { keys: 'P / Esc', action: 'Pause' },
];

/** One-line controls hint for the HUD ("WASD move / drive • …"). */
export function controlsHint() {
  return KEY_BINDINGS.map((b) => `${b.keys} ${b.action.toLowerCase()}`).join(' • ');
}

/** Pretty name for a KeyboardEvent.code ("KeyW" -> "W", "Space" -> "Space"). */
export function keyName(code) {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code.startsWith('Shift')) return 'Shift';
  return code;
}

/** True when the code is a movement key (WASD or arrows). */
export function isMoveKey(code) {
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code);
}

let attachedWindow = null;

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

/**
 * Attach keyboard + mouse listeners. Safe to call twice on the same window;
 * a different window object (a fresh page / test harness) gets its own listeners.
 * Returns the shared { keys, mouse, pressed } objects.
 */
export function initInput(canvas) {
  if (typeof window === 'undefined') return { keys, mouse, pressed };
  if (attachedWindow === window) return { keys, mouse, pressed };
  attachedWindow = window;

  window.addEventListener('keydown', (event) => {
    if (!GAME_KEYS.has(event.code)) return;
    if (!event.repeat) pressed.add(event.code);
    keys.add(event.code);
    // The game owns these keys while it runs; don't let arrows scroll the page.
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    keys.clear();
    mouse.down = false;
  });

  canvas.addEventListener('pointermove', (event) => {
    const p = canvasPoint(canvas, event);
    mouse.x = p.x;
    mouse.y = p.y;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const p = canvasPoint(canvas, event);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.down = true;
    mouse.clicked = true;
    pressed.add('Mouse');
  });
  window.addEventListener('pointerup', () => {
    mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return { keys, mouse, pressed };
}

/** True while `code` (a KeyboardEvent.code, or 'Mouse') is held down. */
export function isDown(code) {
  return code === 'Mouse' ? mouse.down : keys.has(code);
}

/** True if `code` was pressed since the last endFrame(). */
export function wasPressed(code) {
  return pressed.has(code);
}

/**
 * True if `code` was pressed since the last endFrame(), and consume it so
 * no later reader in the same frame sees it again. For single-owner keys.
 */
export function consumePressed(code) {
  if (!pressed.has(code)) return false;
  pressed.delete(code);
  return true;
}

/** True if any of the given codes was pressed since the last endFrame(). */
export function anyPressed(...codes) {
  return codes.some((code) => pressed.has(code));
}

/** Clear the one-shot press set. The game loop calls this once per frame. */
export function endFrame() {
  pressed.clear();
  mouse.clicked = false;
}

/** Forget every held key (used when a fresh game instance takes over). */
export function clearAll() {
  keys.clear();
  pressed.clear();
  mouse.down = false;
  mouse.clicked = false;
}

/** Movement vector from held keys: {x, y} each in -1..1, normalised. */
export function moveVector() {
  let x = 0;
  let y = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
  if (x !== 0 && y !== 0) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  return { x, y };
}

// --- pointer in world coordinates -----------------------------------------
// The mouse is canvas (screen) pixels; the camera is the viewport's
// top-left in world coordinates, so world = camera + mouse. combat.js used
// to carry its own local mouseWorld and player.js inlined the same sum
// (cam.y + mouse.y - player.y) — two copies of one conversion, and a third
// reader would have made a third. Every system that aims with the pointer
// goes through here.

/** The pointer's position in world coordinates. */
export function mouseWorldPos(state) {
  const cam = (state && state.camera) || { x: 0, y: 0 };
  const m = (state && state.mouse) || mouse;
  return { x: cam.x + (m.x || 0), y: cam.y + (m.y || 0) };
}

/** The angle from (x, y) to the pointer, in world coordinates. */
export function mouseAngleFrom(state, x, y) {
  const w = mouseWorldPos(state);
  return Math.atan2(w.y - y, w.x - x);
}
