// Drawing only: the game state in, pixels out. drawGame paints, in order,
// the city, the waypoint and ground markers, the cars (state.cars holds
// EVERY car — traffic, parked, police and the player's, so one loop draws
// them all and nothing is drawn twice), the pedestrians, the foot cops, the
// gang members, the player, bullets and particles, then the HUD.
//
// The HUD is hud.js (drawHUD); the built-in drawHudFallback below only runs
// if that module ever fails, so a HUD bug can never blank the game.
// Particles and floating texts come from effects.js (drawParticles) —
// render.js keeps no second particle renderer.
//
// The camera is the viewport TOP-LEFT in world coords. drawGame translates
// the world by -(camera + shake); the HUD is drawn afterwards in screen space.
import { DAYNIGHT, FONT, PALETTE, VIEW, WORLD } from './config.js';
import { drawWorld, skyLight } from './world.js';
import { drawHUD } from './hud.js';
import { drawParticles, flashActive } from './effects.js';
import { bountyMarker, eventMarker, garageMarkers, jobMarker } from './missions.js';
// SKID_LIFE is the shared fade time (vehicles.js prunes on the same
// constant): the renderer must fade a mark over exactly the life the
// pruner keeps it for, or a mark would vanish a frame early / late.
import { SKID_LIFE } from './vehicles.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const MINIMAP = { x: 16, y: 556, w: 176, h: 132 };

/** Set when hud.js has thrown once: the built-in HUD takes over after that. */
let hudBroken = false;

const fonts = new Map();
function fontFor(ctx, size, bold) {
  const key = `${bold ? 'b' : ''}${size}`;
  if (!fonts.has(key)) fonts.set(key, `${bold ? 'b' : ''}${size}px ${FONT}`);
  ctx.font = fonts.get(key);
}

function text(ctx, value, x, y, size, color, align, bold) {
  fontFor(ctx, size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bar(ctx, x, y, w, h, fraction, fill, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, fraction)) * w, h);
}

// Skid marks: dark translucent streaks on the road, fading over their
// 4s life (vehicles.js records them, pruneSkids drops the stale ones).
// Each mark is a short thick line along the car's heading at the moment
// it was laid, so a hard stop leaves two parallel streaks and a hard
// turn leaves a curved pair. Purely cosmetic — they never affect the
// simulation, and a save/load starts with clean roads.
function drawSkids(ctx, state) {
  const skids = state.skids;
  if (!Array.isArray(skids) || skids.length === 0) return;
  const now = typeof state.time === 'number' ? state.time : 0;
  ctx.save();
  ctx.lineCap = 'round';
  for (const s of skids) {
    const age = now - (s.at || 0);
    if (age < 0 || age > SKID_LIFE) continue;
    const alpha = 0.4 * (1 - age / SKID_LIFE);
    ctx.strokeStyle = `rgba(20,20,20,${alpha.toFixed(3)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(s.x - Math.cos(s.angle) * 7, s.y - Math.sin(s.angle) * 7);
    ctx.lineTo(s.x + Math.cos(s.angle) * 7, s.y + Math.sin(s.angle) * 7);
    ctx.stroke();
  }
  ctx.restore();
}

// Headlight beams: a soft translucent cone in front of each car that is
// moving (or has its lights on — every car does). The cone is widest
// ahead of the car and fades with distance, so a car coming toward the
// player reads as lit rather than as a dark rectangle. It is drawn in
// world space before the car itself, so the beam sits under the body.
// The beam is subtle by design (alpha 0.05-0.08): Port Solano is a
// daytime city, and a strong beam would wash out the road markings.
function drawHeadlightBeam(ctx, car) {
  if (car.wrecked) return;
  const len = 90;
  const spread = 0.35;
  const ax = Math.cos(car.angle);
  const ay = Math.sin(car.angle);
  const px = -ay;
  const py = ax;
  ctx.save();
  ctx.fillStyle = 'rgba(255,233,168,0.06)';
  ctx.beginPath();
  ctx.moveTo(car.x + ax * 28, car.y + ay * 28);
  ctx.lineTo(car.x + ax * len + px * len * spread, car.y + ay * len + py * len * spread);
  ctx.lineTo(car.x + ax * len - px * len * spread, car.y + ay * len - py * len * spread);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draw one car: body, cabin, wheels, headlights; police cars get a flashing light bar. */
/** Model-specific body details (spoiler / stripe / bed / limo extension). */
function drawModelDetails(ctx, car) {
  if (car.wrecked) return;
  if (car.model === 'sports') {
    // Rear spoiler: a dark wing across the back, plus a lower stance line.
    ctx.fillStyle = '#1c2027';
    ctx.fillRect(-30, -14, 4, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-6, -12, 30, 2);
  } else if (car.model === 'muscle') {
    // Twin hood stripes down the centreline.
    ctx.fillStyle = 'rgba(20,20,24,0.55)';
    ctx.fillRect(4, -6, 22, 4);
    ctx.fillRect(4, 2, 22, 4);
  } else if (car.model === 'pickup') {
    // Open bed: a darker rectangle behind the cabin with bed rails.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-28, -11, 16, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(-28, -13, 16, 2);
    ctx.fillRect(-28, 11, 16, 2);
  } else if (car.model === 'limo') {
    // Longer body: a rear extension with a second cabin window.
    ctx.fillStyle = car.color;
    roundRect(ctx, -40, -13, 14, 26, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 30, 40, 0.85)';
    roundRect(ctx, -36, -11, 10, 22, 5);
    ctx.fill();
  }
}

export function drawCar(ctx, car, time) {
  // Headlight beam first (under the body): a soft cone ahead of the car.
  drawHeadlightBeam(ctx, car);
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(ctx, -26, -12, 56, 28, 8);
  ctx.fill();
  // Wheels.
  ctx.fillStyle = '#141414';
  ctx.fillRect(-20, -16, 12, 5);
  ctx.fillRect(-20, 11, 12, 5);
  ctx.fillRect(10, -16, 12, 5);
  ctx.fillRect(10, 11, 12, 5);
  // Body (wrecks are scorched dark).
  ctx.fillStyle = car.wrecked ? '#3a3a3a' : car.color;
  roundRect(ctx, -28, -13, 56, 26, 9);
  ctx.fill();
  // Cabin + windshield.
  ctx.fillStyle = car.wrecked ? '#222' : 'rgba(20, 30, 40, 0.85)';
  roundRect(ctx, -8, -11, 20, 22, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(160, 210, 235, 0.7)';
  ctx.fillRect(8, -10, 4, 20);
  // Headlights.
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(26, -11, 3, 5);
  ctx.fillRect(26, 6, 3, 5);
  // Brake lights at the rear: bright red while the car is braking
  // (traffic sets car.braking when its target speed is below its speed;
  // the player's car sets it while S is held moving forward), dim red
  // otherwise. They are the only signal that the car ahead is slowing
  // rather than just driving slowly.
  ctx.fillStyle = car.braking ? '#ff2e1f' : 'rgba(160,30,20,0.7)';
  ctx.fillRect(-29, -11, 3, 5);
  ctx.fillRect(-29, 6, 3, 5);
  if (car.braking) {
    ctx.fillStyle = 'rgba(255,46,31,0.25)';
    ctx.fillRect(-33, -13, 4, 26);
  }
  // Taxi sign / police livery.
  if (car.isPolice) {
    ctx.fillStyle = PALETTE.copWhite;
    ctx.fillRect(-28, -13, 22, 26);
    ctx.fillStyle = PALETTE.cop;
    text(ctx, 'PD', -24, 5, 11, PALETTE.copWhite, 'left', true);
    const flash = Math.floor(time * 6) % 2 === 0;
    ctx.fillStyle = flash ? PALETTE.copLightRed : PALETTE.copLightBlue;
    ctx.fillRect(-4, -15, 8, 5);
    ctx.fillStyle = flash ? PALETTE.copLightBlue : PALETTE.copLightRed;
    ctx.fillRect(4, -15, 8, 5);
    if (car.siren) {
      ctx.strokeStyle = flash ? 'rgba(255,59,48,0.5)' : 'rgba(47,123,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 34 + (flash ? 4 : 0), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (car.model === 'taxi') {
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(-4, -15, 10, 5);
    ctx.fillStyle = '#20242e';
    text(ctx, 'TAXI', -2, -10, 6, '#20242e', 'center', true);
  }
  // Model details: the street fleet reads as different cars, not the
  // same body in a different colour. A Comet GT gets a rear spoiler, a
  // Bison GT a hood stripe, a Dune Runner an open bed, a Regal Limo a
  // longer body (drawn as a rear extension). The base body above is
  // shared; these are overlays, so a model the renderer does not know
  // still draws as a normal car.
  drawModelDetails(ctx, car);
  // Damage smoke when the car is nearly wrecked; wrecks smoulder dark.
  if (car.wrecked) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(10, 0, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (car.health < 35) {
    ctx.fillStyle = 'rgba(120,120,120,0.6)';
    ctx.beginPath();
    ctx.arc(-24 + Math.sin(time * 9) * 3, -4, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw one pedestrian: shadow, body, head, facing tick. Dead peds lie flat. */
export function drawPed(ctx, ped) {
  if (ped.state === 'dead' || ped.dead) {
    ctx.save();
    ctx.translate(ped.x, ped.y);
    ctx.rotate(ped.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.color;
    roundRect(ctx, -13, -6, 26, 12, 6);
    ctx.fill();
    ctx.fillStyle = PALETTE.pedSkin;
    ctx.beginPath();
    ctx.arc(15, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(ped.x, ped.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Walk bob.
  const bob = ped.state === 'walk' ? Math.sin(ped.walkPhase || 0) * 1.5 : 0;
  ctx.fillStyle = ped.color;
  roundRect(ctx, -8, -10 + bob, 16, 22, 7);
  ctx.fill();
  ctx.fillStyle = PALETTE.pedSkin;
  ctx.beginPath();
  ctx.arc(0, -14 + bob, 7, 0, Math.PI * 2);
  ctx.fill();
  // Facing tick.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -14 + bob);
  ctx.lineTo(Math.cos(ped.angle) * 12, -14 + bob + Math.sin(ped.angle) * 12);
  ctx.stroke();
  // Kind details: the variety is visible, not just a stat. A jogger
  // wears a sweatband, an old-timer has grey hair, a street kid carries
  // a backpack, a dock worker a hard hat. The kind is assigned at spawn
  // (peds.js) and never changes, so the same ped always reads the same.
  if (ped.kind === 'jogger') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-7, -19 + bob, 14, 3);
  } else if (ped.kind === 'elder') {
    ctx.fillStyle = '#cfcfcf';
    ctx.beginPath();
    ctx.arc(0, -16 + bob, 6, Math.PI, 0);
    ctx.fill();
  } else if (ped.kind === 'kid') {
    ctx.fillStyle = '#f2c94c';
    roundRect(ctx, -11, -6 + bob, 5, 8, 2);
    ctx.fill();
  } else if (ped.kind === 'worker') {
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.arc(0, -16 + bob, 7, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-7, -17 + bob, 14, 3);
  }
  ctx.restore();
}

/** Draw one foot cop: same figure as a ped, dark uniform + cap brim. */
export function drawFootCop(ctx, cop, time) {
  ctx.save();
  ctx.translate(cop.x, cop.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const bob = Math.sin((cop.walkPhase || time * 8)) * 1.5;
  ctx.fillStyle = PALETTE.cop;
  roundRect(ctx, -8, -10 + bob, 16, 22, 7);
  ctx.fill();
  ctx.fillStyle = PALETTE.pedSkin;
  ctx.beginPath();
  ctx.arc(0, -14 + bob, 7, 0, Math.PI * 2);
  ctx.fill();
  // Cap.
  ctx.fillStyle = PALETTE.cop;
  ctx.beginPath();
  ctx.arc(0, -16 + bob, 7, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(-7, -17 + bob, 14, 3);
  // Facing tick.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -14 + bob);
  ctx.lineTo(Math.cos(cop.angle) * 12, -14 + bob + Math.sin(cop.angle) * 12);
  ctx.stroke();
  ctx.restore();
}

/** Draw one Harbor Kings gunman: dark-red figure, gun bar in hand. */
export function drawEnemy(ctx, enemy) {
  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(enemy.angle + Math.PI / 2);
  ctx.fillStyle = '#8a2a20';
  roundRect(ctx, -8, -10, 16, 22, 7);
  ctx.fill();
  ctx.fillStyle = PALETTE.pedSkin;
  ctx.beginPath();
  ctx.arc(0, -14, 7, 0, Math.PI * 2);
  ctx.fill();
  // Gun.
  ctx.fillStyle = '#222';
  ctx.fillRect(6, -8, 12, 4);
  ctx.restore();
  // Health bar above the gunman: the pistol does 34 damage and a gunman
  // has 100 hp, so three hits kill — but without a bar the player cannot
  // tell a fresh gunman from one already hit twice, and wastes ammo
  // finishing the wrong one while the other five shoot back. The bar is
  // drawn unrotated (screen-up) so it reads at a glance in a firefight.
  if (enemy.hp < 100) {
    const bw = 28;
    const bx = enemy.x - bw / 2;
    const by = enemy.y - 30;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
    ctx.fillStyle = '#1c2027';
    ctx.fillRect(bx, by, bw, 4);
    ctx.fillStyle = enemy.hp > 50 ? '#e5534b' : '#ff9d2e';
    ctx.fillRect(bx, by, Math.max(0, bw * (enemy.hp / 100)), 4);
  }
}

/** Draw the player on foot: gold jacket, skin head, aim tick. */
export function drawPlayer(ctx, player, time) {
  const blink = player.invulnerable > 0 && Math.floor(time * 10) % 2 === 0;
  if (blink) return;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 11, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(player.angle + Math.PI / 2);
  ctx.fillStyle = PALETTE.player;
  roundRect(ctx, -9, -11, 18, 24, 8);
  ctx.fill();
  ctx.fillStyle = PALETTE.playerDark;
  ctx.fillRect(-9, 2, 18, 4);
  ctx.fillStyle = PALETTE.pedSkin;
  ctx.beginPath();
  ctx.arc(0, -15, 7.5, 0, Math.PI * 2);
  ctx.fill();
  // Hair.
  ctx.fillStyle = '#2a2018';
  ctx.beginPath();
  ctx.arc(0, -17, 7, Math.PI, 0);
  ctx.fill();
  // Weapon in hand.
  if (player.weapon === 'pistol') {
    ctx.fillStyle = '#222';
    ctx.fillRect(6, -8, 12, 4);
  }
  ctx.restore();
}

// Bullets carry velocity (vx, vy), not an angle: the tracer runs back along it.
function drawBullets(ctx, state) {
  ctx.strokeStyle = PALETTE.bullet;
  ctx.lineWidth = 3;
  for (const b of state.bullets) {
    const len = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / len;
    const uy = b.vy / len;
    ctx.beginPath();
    ctx.moveTo(b.x - ux * 14, b.y - uy * 14);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  drawMuzzleFlash(ctx, state);
}

// Muzzle flash: a brief 4-point star at the muzzle for 0.06s after a
// shot (combat.js records state.muzzleFlash on every player shot).
// The flash is drawn in world space, rotated to the shot angle, and
// fades over its 0.06s life. Enemy shots get 'muzzle' particles instead
// (combat.js spawns them), so this only covers the player's pistol.
function drawMuzzleFlash(ctx, state) {
  const f = state.muzzleFlash;
  if (!f || typeof f.at !== 'number') return;
  const age = state.time - f.at;
  if (age < 0 || age > 0.06) return;
  const alpha = 1 - age / 0.06;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffd94a';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(16, -4);
  ctx.lineTo(10, 0);
  ctx.lineTo(16, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff6c8';
  ctx.beginPath();
  ctx.arc(4, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Pulsing ground ring + a screen-edge arrow pointing at an off-screen waypoint. */
function drawWaypoint(ctx, state, cam) {
  const wp = state.mission.waypoint;
  if (!wp) return;
  const pulse = 1 + Math.sin(state.time * 4) * 0.12;
  ctx.save();
  ctx.strokeStyle = PALETTE.waypoint;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(wp.x, wp.y, 34 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PALETTE.waypoint;
  ctx.beginPath();
  ctx.moveTo(wp.x, wp.y - 44);
  ctx.lineTo(wp.x - 10, wp.y - 22);
  ctx.lineTo(wp.x + 10, wp.y - 22);
  ctx.closePath();
  ctx.fill();
  // Off-screen: clamp a marker to the view edge.
  const vx = wp.x - cam.x;
  const vy = wp.y - cam.y;
  if (vx < 40 || vx > VIEW.width - 40 || vy < 40 || vy > VIEW.height - 40) {
    const cx = Math.min(Math.max(vx, 40), VIEW.width - 40);
    const cy = Math.min(Math.max(vy, 40), VIEW.height - 40);
    const ang = Math.atan2(vy - VIEW.height / 2, vx - VIEW.width / 2);
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = PALETTE.waypoint;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-8, -10);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD (built-in fallback; hud.js replaces this when it registers itself).
// ---------------------------------------------------------------------------

function drawMinimap(ctx, state) {
  const { x, y, w, h } = MINIMAP;
  const sx = w / WORLD.width;
  const sy = h / WORLD.height;
  ctx.fillStyle = PALETTE.minimapBg;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 8);
  ctx.clip();
  // Water.
  ctx.fillStyle = PALETTE.minimapWater;
  ctx.fillRect(x, y + 2260 * sy, w, h - 2260 * sy);
  // Roads.
  ctx.fillStyle = PALETTE.minimapRoad;
  for (const road of state.world.roads.vertical) {
    ctx.fillRect(x + road.x * sx - 1, y, 2, h);
  }
  for (const road of state.world.roads.horizontal) {
    ctx.fillRect(x, y + road.y * sy - 1, w, 2);
  }
  // Park.
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(x + 1400 * sx, y + 1000 * sy, 400 * sx, 400 * sy);
  // Waypoint.
  if (state.mission.waypoint) {
    ctx.fillStyle = PALETTE.waypoint;
    ctx.beginPath();
    ctx.arc(x + state.mission.waypoint.x * sx, y + state.mission.waypoint.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Cops as blue dots, player as a white arrow.
  for (const cop of state.cops) {
    ctx.fillStyle = PALETTE.copLightBlue;
    ctx.fillRect(x + cop.x * sx - 2, y + cop.y * sy - 2, 4, 4);
  }
  const px = x + state.player.x * sx;
  const py = y + state.player.y * sy;
  // Wanted ring: when the player has heat, a red ring around the arrow
  // (pulsing at 3+ stars) shows it at a glance — the minimap is the one
  // place the player looks while driving, and the stars are top-right.
  if (state.player.wanted > 0) {
    ctx.save();
    ctx.strokeStyle = state.player.wanted >= 3 && Math.sin((state.time || 0) * 8) > 0
      ? 'rgba(255,90,75,0.35)'
      : 'rgba(255,90,75,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(state.player.angle + Math.PI / 2);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // View rectangle (camera is the viewport top-left).
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + state.camera.x * sx, y + state.camera.y * sy, VIEW.width * sx, VIEW.height * sy);
  ctx.restore();
  text(ctx, 'PORT SOLANO', x + 4, y + h - 6, 10, PALETTE.muted, 'left', true);
}

function drawHudFallback(ctx, state) {
  const p = state.player;
  // Top-left: cash + weapon.
  ctx.fillStyle = PALETTE.panel;
  roundRect(ctx, 12, 12, 230, 58, 8);
  ctx.fill();
  text(ctx, `$${p.money.toLocaleString('en-US')}`, 24, 40, 26, PALETTE.gold, 'left', true);
  const weapon = p.weapon === 'pistol' ? `P9  ${p.ammo} rounds` : 'Fists';
  text(ctx, weapon, 24, 62, 15, PALETTE.text, 'left');
  // Top-right: wanted stars + health/armor.
  const stars = '★'.repeat(p.wanted) + '☆'.repeat(Math.max(0, 5 - p.wanted));
  text(ctx, stars, VIEW.width - 16, 44, 30, p.wanted > 0 ? PALETTE.gold : 'rgba(245,241,230,0.4)', 'right', true);
  bar(ctx, VIEW.width - 216, 54, 200, 12, p.hp / 100, p.hp > 30 ? PALETTE.green : PALETTE.red);
  text(ctx, 'HP', VIEW.width - 222, 66, 12, PALETTE.text, 'right', true);
  if (p.armor > 0) {
    bar(ctx, VIEW.width - 216, 70, 200, 8, p.armor / 100, '#7fb2d9');
    text(ctx, 'ARMOR', VIEW.width - 222, 80, 12, PALETTE.text, 'right', true);
  }
  // Bottom-centre: mission objective.
  if (state.mission.objectiveText) {
    fontFor(ctx, 18, true);
    const tw = ctx.measureText(state.mission.objectiveText).width;
    ctx.fillStyle = PALETTE.panel;
    roundRect(ctx, VIEW.width / 2 - tw / 2 - 16, 664, tw + 32, 34, 8);
    ctx.fill();
    text(ctx, state.mission.objectiveText, VIEW.width / 2, 688, 18, PALETTE.text, 'center', true);
  }
  // Bottom-right: speed when driving, controls hint otherwise.
  if (p.inCar) {
    const kmh = Math.round(Math.abs(p.inCar.speed) * 0.45);
    text(ctx, `${kmh} km/h`, VIEW.width - 20, 700, 26, PALETTE.text, 'right', true);
    text(ctx, p.inCar.modelName || 'Car', VIEW.width - 20, 672, 13, PALETTE.muted, 'right');
  } else {
    text(ctx, 'WASD move · E enter car · Click shoot · P pause', VIEW.width - 20, 700, 13, PALETTE.muted, 'right');
  }
  // Bust progress warning: a bar, not just a line. The old fallback only
  // printed "SOLANO PD IS CUFFING YOU" with no sense of how close the
  // bust was; the main HUD (hud.js) now draws the same bar, so the two
  // HUDs agree. bustProgress is 0..1 (a fraction of the 1.5s bust time).
  if (state.bustProgress > 0) {
    const bw = 260;
    const bx = VIEW.width / 2 - bw / 2;
    const by = 96;
    const flash = Math.sin((state.time || 0) * 10) > 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, 22);
    ctx.fillStyle = '#1c2027';
    ctx.fillRect(bx, by, bw, 18);
    ctx.fillStyle = flash ? '#ff5a4b' : PALETTE.red;
    ctx.fillRect(bx, by, Math.max(0, bw * Math.min(1, state.bustProgress)), 18);
    text(ctx, flash ? 'BREAK CONTACT — THEY ARE CUFFING YOU!' : 'SOLANO PD IS CUFFING YOU', VIEW.width / 2, by + 9, 12, '#ffffff', 'center', true);
  }
  drawMinimap(ctx, state);
}

/**
 * Paint one frame. `state.mode` is 'title' | 'playing' | 'paused' |
 * 'busted' | 'wasted' | 'missionComplete'. The title screen still draws the
 * living city behind the DOM menu overlay.
 */
export function drawGame(ctx, state) {
  const cam = state.camera;
  const shakeX = state.shake > 0 ? (Math.random() * 2 - 1) * state.shake : 0;
  const shakeY = state.shake > 0 ? (Math.random() * 2 - 1) * state.shake : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PALETTE.backdrop;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);

  ctx.save();
  ctx.translate(-Math.round(cam.x + shakeX), -Math.round(cam.y + shakeY));
  drawWorld(ctx, state.world, { x: cam.x + shakeX, y: cam.y + shakeY }, state);
  drawWaypoint(ctx, state, cam);
  // Skid marks go down BEFORE the cars, so the tyres sit on top of them.
  drawSkids(ctx, state);
  // One loop over the one car list (traffic + parked + police + player car),
  // then peds, foot cops, gang members, then the player on top.
  for (const car of state.cars) drawCar(ctx, car, state.time);
  for (const ped of state.peds) drawPed(ctx, ped);
  for (const cop of state.copsFoot || []) drawFootCop(ctx, cop, state.time);
  for (const enemy of state.enemies || []) drawEnemy(ctx, enemy);
  if (state.player.inCar) {
    // The player's car is already in state.cars; draw the driver marker.
    ctx.fillStyle = 'rgba(255,207,63,0.9)';
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.player.alive) {
    drawPlayer(ctx, state.player, state.time);
  }
  drawBullets(ctx, state);
  drawParticles(ctx, state);
  drawJobMarkers(ctx, state);
  drawEventMarkers(ctx, state);
  drawBountyMarkers(ctx, state);
  drawGarageMarkers(ctx, state);
  ctx.restore();

  // Night overlay + lightning flash, in screen space (after the world
  // transform is restored, before the HUD so the HUD stays bright). The
  // overlay is darkness * 0.85 — never fully black, so the city is
  // always readable, and the headlights (drawn in world space) still
  // read as light cones through it.
  drawNightOverlay(ctx, state);
  // Headlight glow: at night, a soft pool of light around the player's
  // car, drawn AFTER the overlay so it reads as illumination, not as
  // another dark shape. Without it the night overlay would swallow the
  // player's own headlights.
  drawNightGlow(ctx, state);
  // Streetlights: the intersections glow after the overlay too, so the
  // city at night is lit by its grid — the same "after the overlay"
  // rule as the headlight glow, for the same reason.
  drawStreetlights(ctx, state);

  // HUD on top, in screen space: hud.js. If it ever throws (a state field
  // it does not know yet), fall back to the built-in HUD for the rest of the
  // session instead of blanking the frame.
  if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'missionComplete') {
    if (!hudBroken) {
      try {
        drawHUD(ctx, state);
      } catch {
        hudBroken = true;
        drawHudFallback(ctx, state);
      }
    } else {
      drawHudFallback(ctx, state);
    }
  }
}

// ---------------------------------------------------------------------------
// Night, lightning, job markers. All pure functions of state — the harness
// calls them directly with a stub context to verify they never throw.
// ---------------------------------------------------------------------------

/**
 * The night overlay: a dark-blue wash over the whole viewport, alpha
 * from skyLight (0 at noon, 0.82 at midnight, scaled by 0.85 so the
 * city is never unreadable). Drawn in screen space after the world and
 * before the HUD. A lightning flash (storm) draws a white wash on top.
 */
export function drawNightOverlay(ctx, state) {
  const light = skyLight(state);
  if (light.darkness <= 0.01 && !flashActive(state) && light.phase !== 'dawn' && light.phase !== 'dusk') return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (light.darkness > 0.01) {
    ctx.fillStyle = `rgba(8, 14, 34, ${(light.darkness * 0.85).toFixed(3)})`;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }
  // Dawn and dusk get a warm wash on top of (or instead of) the dark:
  // the city glows orange at the edges of the day, which is also the
  // tell that the light is about to change — a player who sees the
  // dusk wash knows the headlights are coming on soon.
  if (light.phase === 'dusk') {
    ctx.fillStyle = 'rgba(255, 140, 60, 0.10)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  } else if (light.phase === 'dawn') {
    ctx.fillStyle = 'rgba(255, 180, 120, 0.08)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }
  if (flashActive(state)) {
    ctx.fillStyle = 'rgba(255, 255, 240, 0.35)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }
  ctx.restore();
}

/**
 * The active side job's ground markers (world space, like the story
 * waypoint): a green pulsing circle at the pickup ("$" — a fare is
 * waiting) and a gold one at the dropoff. The markers are the only
 * in-world sign of a job — without them the player has to read the
 * minimap to find a fare, which is not how a taxi driver works.
 */
export function drawJobMarkers(ctx, state) {
  const jm = jobMarker(state);
  if (!jm) return;
  const time = state.time || 0;
  const drawMarker = (pt, color, label) => {
    const r = 46 + 6 * Math.sin(time * 4);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15 + 0.05 * Math.sin(time * 4);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pt.x, pt.y);
    ctx.restore();
  };
  if (jm.pickup) drawMarker(jm.pickup, '#7ddb6a', '$');
  drawMarker(jm.dropoff, '#ffd94d', '$');
}

/**
 * Street-event marker (world space, pulsing orange "!"): the active
 * event's location, or its next race checkpoint. The colour is the
 * warning — a job marker is green/gold (money), an event marker is
 * orange (trouble). A race shows the checkpoint, not the event's
 * origin, because the origin is where the race started, not where
 * the player needs to be.
 */
export function drawEventMarkers(ctx, state) {
  const em = eventMarker(state);
  if (!em) return;
  const time = state.time || 0;
  const r = 46 + 6 * Math.sin(time * 4);
  ctx.save();
  ctx.strokeStyle = '#ff9f43';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(em.x, em.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ff9f43';
  ctx.globalAlpha = 0.15 + 0.05 * Math.sin(time * 4);
  ctx.beginPath();
  ctx.arc(em.x, em.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', em.x, em.y);
  ctx.restore();
}

/**
 * Most Wanted marker (world space, pulsing red "$"): the active
 * bounty's target, or the board point when the target is off the
 * field. The colour is the warning — a job marker is green/gold
 * (money), an event marker is orange (trouble), and a bounty marker
 * is red (a man with a price on his head). The "$" is the payout,
 * not the danger: the danger is the gunman standing under it.
 */
export function drawBountyMarkers(ctx, state) {
  const bm = bountyMarker(state);
  if (!bm) return;
  const time = state.time || 0;
  const r = 46 + 6 * Math.sin(time * 4 + 1);
  ctx.save();
  ctx.strokeStyle = '#e5534b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(bm.x, bm.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e5534b';
  ctx.globalAlpha = 0.15 + 0.05 * Math.sin(time * 4 + 1);
  ctx.beginPath();
  ctx.arc(bm.x, bm.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', bm.x, bm.y);
  ctx.restore();
}

/**
 * Garage markers (world space, small gold "H" for home, grey for the
 * rest): the garages Rook owns. The home garage is the respawn point,
 * so it gets the gold "H" and the others get a plain house mark — the
 * player should be able to find home from anywhere in the city
 * without opening the guide. Only owned garages are drawn; the ones
 * on the market are the guide's business, not the map's.
 */
export function drawGarageMarkers(ctx, state) {
  const markers = garageMarkers(state);
  if (!markers || markers.length === 0) return;
  ctx.save();
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of markers) {
    ctx.fillStyle = g.home ? '#ffd94d' : '#9aa0a8';
    ctx.beginPath();
    ctx.arc(g.x, g.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14181d';
    ctx.fillText(g.home ? 'H' : 'G', g.x, g.y + 0.5);
  }
  ctx.restore();
}

/**
 * Streetlights (world space, night only): a warm pool of light at
 * every intersection. The pools are drawn AFTER the night overlay,
 * like the headlight glow, so they read as light in the dark — the
 * city at night is lit by its intersections, and the roads between
 * them stay dark. The lights are placed on the avenue/street grid
 * (every 400 px), so there is no per-light state to save: the grid
 * IS the placement. Only intersections within the camera view are
 * drawn, so the loop is bounded by the screen, not the city.
 */
export function drawStreetlights(ctx, state) {
  const light = skyLight(state);
  if (light.darkness < DAYNIGHT.headlightDarkness) return;
  const cam = state.camera || { x: 0, y: 0 };
  const x0 = Math.max(200, Math.floor(cam.x / 400) * 400);
  const x1 = Math.min(3000, cam.x + VIEW.width + 400);
  const y0 = Math.max(200, Math.floor(cam.y / 400) * 400);
  const y1 = Math.min(2200, cam.y + VIEW.height + 400);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let gx = x0; gx <= x1; gx += 400) {
    for (let gy = y0; gy <= y1; gy += 400) {
      const sx = gx - cam.x;
      const sy = gy - cam.y;
      const grad = ctx.createRadialGradient(sx, sy, 4, sx, sy, 130);
      grad.addColorStop(0, 'rgba(255, 214, 130, 0.16)');
      grad.addColorStop(0.6, 'rgba(255, 214, 130, 0.06)');
      grad.addColorStop(1, 'rgba(255, 214, 130, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx - 130, sy - 130, 260, 260);
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Headlight glow: at night, a soft radial pool of warm light around
 * the player's car (screen space, after the night overlay). The pool
 * is centred on the car and fades with distance, so the road ahead of
 * the car reads as lit while the rest of the city stays dark. Only the
 * player's car glows — traffic headlights are the small beams drawn in
 * world space (drawHeadlightBeam), and a glow on every car would turn
 * the night into day.
 */
export function drawNightGlow(ctx, state) {
  const light = skyLight(state);
  if (light.darkness < DAYNIGHT.headlightDarkness) return;
  const p = state.player;
  if (!p || !p.inCar) return;
  const cam = state.camera || { x: 0, y: 0 };
  const sx = p.x - cam.x;
  const sy = p.y - cam.y;
  if (sx < -200 || sx > VIEW.width + 200 || sy < -200 || sy > VIEW.height + 200) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const grad = ctx.createRadialGradient(sx, sy, 10, sx, sy, 260);
  grad.addColorStop(0, 'rgba(255, 233, 168, 0.20)');
  grad.addColorStop(0.5, 'rgba(255, 233, 168, 0.08)');
  grad.addColorStop(1, 'rgba(255, 233, 168, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(sx - 260, sy - 260, 520, 520);
  ctx.restore();
}
