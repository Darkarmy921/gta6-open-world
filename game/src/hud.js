// Port Solano — HUD + live minimap (canvas-drawn, no assets).
//
// drawHUD renders health / armor / money / wanted stars / weapon / objective /
// speed / controls hint / damage vignette / mode overlays, then the minimap.
// drawMinimap renders the 200x140 live map bottom-right: roads, buildings,
// water along the SOUTH edge (the harbour is y 2260..2400 — not the east
// edge), player arrow, pulsing waypoint, police dots, traffic dots, gang
// dots and a north indicator. The camera is the viewport TOP-LEFT in world
// coords, so the viewport rectangle on the minimap starts at camera.x/y.
//
// PISTOL comes from config.js (single source of truth): the reload bar
// measures against its reloadTime, so a tuning change there moves the
// bar too instead of leaving a hardcoded 1.2 behind.
import { ACHIEVEMENTS, PISTOL } from './config.js';
import { clockLabel, districtDescription, districtGuide, districtSecret, forecastLabel, nearestLandmark, playerDistrict, skyLight } from './world.js';
import { activeBounty, activeEvent, activeJob, bountyStats, eventMarker, jobFlavour, jobMarker, jobOffers, missionDialogue, missionProgress } from './missions.js';
import { careerHeadline, lastAchievement, repTitle, statsSummary, unlockedAchievements } from './player.js';
import { copTactic, heatLabel, secondsToClean, wantedPoster } from './police.js';
import { carCard } from './vehicles.js';
import { jammedNear } from './traffic.js';
import { controlsHint } from './input.js';
import { djLine } from './audio.js';

const WORLD_W = 3200;
const WORLD_H = 2400;
const AVENUES = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
const STREETS = [200, 600, 1000, 1400, 1800, 2200];
const MINIMAP_W = 200;
const MINIMAP_H = 140;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Simple word wrap into lines no wider than maxW.
function wrapText(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawStars(ctx, x, y, wanted, time) {
  ctx.save();
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const flashing = wanted >= 3 && Math.sin(time * 8) > 0;
  for (let i = 0; i < 5; i++) {
    const filled = i < wanted;
    ctx.globalAlpha = filled ? (flashing ? 0.35 : 1) : 0.4;
    ctx.fillStyle = filled ? '#ffd94d' : '#8b93a3';
    ctx.fillText(filled ? '★' : '☆', x + i * 22, y);
  }
  ctx.restore();
}

function drawBar(ctx, x, y, w, h, frac, color, label) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#1c2027';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, w * clamp(frac, 0, 1)), h);
  ctx.fillStyle = '#eef1f5';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 4, y + h / 2 + 0.5);
  ctx.restore();
}

export function drawHUD(ctx, state) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const p = state.player;
  const time = state.time || 0;
  ctx.save();

  // --- Mission objective, top-left -------------------------------------
  const m = state.mission;
  if (m && m.objectiveText) {
    ctx.font = '13px system-ui, sans-serif';
    const lines = wrapText(ctx, m.objectiveText, 340);
    // Jobs-done line under the objective when no job is running.
    const jobsLine = !m.active && m.completed
      ? `Jobs done: ${m.completed.length} / 6`
      : null;
    const extra = jobsLine ? 17 : 0;
    const boxH = 12 + lines.length * 17 + 10 + extra;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(12, 12, 364, boxH);
    ctx.fillStyle = '#ffd94d';
    ctx.fillRect(12, 12, 4, boxH);
    ctx.fillStyle = '#eef1f5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, 26, 20 + i * 17));
    if (jobsLine) {
      ctx.fillStyle = '#ffd94d';
      ctx.fillText(jobsLine, 26, 20 + lines.length * 17);
    }
    // Countdown chip when a mission timer is running.
    if (m.timer > 0 && m.active) {
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillStyle = m.timer < 15 ? '#ff5a4b' : '#ffffff';
      ctx.fillText(`${Math.ceil(m.timer)}s`, 26, 20 + lines.length * 17 + extra);
      // Countdown bar under the objective: the fraction of the mission's
      // total time left, so the player sees the pressure at a glance
      // instead of reading a number. timerTotal is set where the timer
      // is set (missions.js start); it falls back to the current timer
      // when a save or an older mission did not record one.
      const total = m.timerTotal > 0 ? m.timerTotal : m.timer;
      const frac = Math.max(0, Math.min(1, m.timer / total));
      const barW = 340;
      const barX = 26;
      const barY = 20 + lines.length * 17 + extra + 28;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(barX, barY, barW, 6);
      ctx.fillStyle = m.timer < 15 ? '#ff5a4b' : '#ffd94d';
      ctx.fillRect(barX, barY, Math.max(0, barW * frac), 6);
    }
  }

  // --- Money + wanted stars, top-right ----------------------------------
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillStyle = '#7ddb6a';
  ctx.fillText(`$${(p.money || 0).toLocaleString('en-US')}`, W - 14, 12);
  drawStars(ctx, W - 14 - 5 * 22 + 6, 48, p.wanted || 0, time);

  // --- Weapon + ammo, under the stars -----------------------------------
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillStyle = '#eef1f5';
  const reloading = state._combat?.reloading;
  const weaponText =
    p.weapon === 'pistol'
      ? reloading
        ? 'PISTOL — RELOADING…'
        : `PISTOL • ${p.ammo ?? 0}`
      : 'FISTS';
  ctx.fillText(weaponText, W - 14, 74);
  // Reload progress: a thin bar under the weapon text, so the player
  // knows WHEN the reload finishes instead of just that it is happening.
  // The bar measures reloadT against the pistol's 1.2s reload time; it
  // fills left-to-right as the reload completes. Without it, the player
  // mashes LMB during a reload and cannot tell whether the gun is ready.
  if (reloading && state._combat) {
    const total = PISTOL.reloadTime;
    const done = 1 - Math.max(0, Math.min(1, (state._combat.reloadT || 0) / total));
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W - 14 - 110, 94, 110, 5);
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(W - 14 - 110, 94, 110 * done, 5);
  }
  // Low ammo: at 3 or fewer rounds the count turns red and flashes, and
  // a "press R" hint appears — the player who empties the mag mid-fight
  // (6 gunmen, 3 hits each, 12-round mag) needs to know the reload is
  // coming before the click of an empty chamber.
  if (p.weapon === 'pistol' && !reloading && (p.ammo ?? 0) <= 3) {
    const flash = Math.sin(time * 8) > 0;
    ctx.fillStyle = flash ? '#ff5a4b' : '#e5534b';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText((p.ammo ?? 0) === 0 ? 'EMPTY — PRESS R TO RELOAD' : `LOW AMMO — PRESS R (${p.ammo})`, W - 14, 96);
  }

  // --- Health / armor, bottom-left ---------------------------------------
  const hpColor = p.hp > 50 ? '#4fc36a' : p.hp > 25 ? '#f2c94c' : '#e5534b';
  drawBar(ctx, 14, H - 44, 220, 14, (p.hp || 0) / 100, hpColor, 'HP');
  if ((p.armor || 0) > 0) {
    drawBar(ctx, 14, H - 26, 220, 10, (p.armor || 0) / 100, '#4aa3ff', 'ARMOR');
  }
  // --- Sprint stamina, under HP when not full: a drained bar tells the
  // player why Shift stopped working (the lock holds until 30), instead
  // of sprint silently doing nothing.
  if (!p.inCar && (p.stamina ?? 100) < 100) {
    const stY = (p.armor || 0) > 0 ? H - 10 : H - 26;
    drawBar(ctx, 14, stY, 220, 8, (p.stamina ?? 100) / 100,
      p.staminaLocked ? '#e5534b' : '#f2c94c', p.staminaLocked ? 'TIRED' : 'SPRINT');
  }

  // --- Bust meter, centre-top: the player had NO way to see how close
  // the bust was. render.js only prints a warning line, and only in the
  // fallback HUD — the main HUD never showed bustProgress at all, so a
  // foot cop (or the car swarm) could fill the 1.5s meter with no
  // on-screen warning until the BUSTED screen. The bar fills red and the
  // label flashes; breaking contact drains it.
  const bust = clamp(state.bustProgress || 0, 0, 1);
  if (bust > 0) {
    const bw = 260;
    const bx = (W - bw) / 2;
    const by = 14;
    const flash = Math.sin(time * 10) > 0;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, 22);
    ctx.fillStyle = '#1c2027';
    ctx.fillRect(bx, by, bw, 18);
    ctx.fillStyle = flash ? '#ff5a4b' : '#e5534b';
    ctx.fillRect(bx, by, Math.max(0, bw * bust), 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(flash ? 'BREAK CONTACT — THEY ARE CUFFING YOU!' : 'SOLANO PD IS CUFFING YOU', W / 2, by + 9);
    ctx.restore();
  }

  // --- Speed, above the minimap ------------------------------------------
  if (p.inCar) {
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#eef1f5';
    // Car speeds are px/s (ramming threshold 200); ~0.45x reads as km/h.
    ctx.fillText(`${Math.round(Math.abs(p.inCar.speed || 0) * 0.45)} km/h`, W - 14, H - MINIMAP_H - 34);
  }

  // --- Controls hint, fades out after ~12 s ------------------------------
  if (time < 12) {
    ctx.globalAlpha = clamp(1 - time / 12, 0, 1) * 0.9;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eef1f5';
    ctx.fillText(
      'WASD move / drive • Mouse aim • LMB shoot • F punch • E interact • R reload • M music • N radio • T stats • P pause',
      W / 2,
      H - 14,
    );
    ctx.globalAlpha = 1;
  }

  // --- Opening dialogue, bottom-centre while briefT runs ------------------
  if (m && m.brief && m.briefT > 0) {
    ctx.font = '13px system-ui, sans-serif';
    const lines = m.brief.slice(0, 3);
    const boxW = 620;
    const boxH = 14 + lines.length * 18 + 10;
    const bx = (W - boxW) / 2;
    const by = H - MINIMAP_H - 24 - boxH;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = '#ffd94d';
    ctx.fillRect(bx, by, 4, boxH);
    ctx.fillStyle = '#eef1f5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => ctx.fillText(ln, bx + 14, by + 8 + i * 18));
  }

  // --- Damage vignette when hp is low -------------------------------------
  if ((p.hp || 0) < 30 && p.alive) {
    const pulse = 0.22 + 0.12 * Math.sin(time * 6);
    const grad = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.35,
      W / 2, H / 2, Math.max(W, H) * 0.75,
    );
    grad.addColorStop(0, 'rgba(200,0,0,0)');
    grad.addColorStop(1, `rgba(200,0,0,${pulse.toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // --- Mode overlays -------------------------------------------------------
  if (state.mode === 'wasted') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillStyle = '#e5534b';
    ctx.fillText('WASTED', W / 2, H / 2 - 10);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#eef1f5';
    ctx.fillText('The streets of Port Solano claim another one.', W / 2, H / 2 + 34);
  } else if (state.mode === 'busted') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.fillStyle = '#4aa3ff';
    ctx.fillText('BUSTED', W / 2, H / 2 - 10);
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#eef1f5';
    ctx.fillText('The Solano PD has you. The job will have to wait.', W / 2, H / 2 + 34);
  } else if (state.mode === 'missionComplete') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillStyle = '#ffd94d';
    ctx.fillText('MISSION COMPLETE', W / 2, H / 2 - 10);
  }

  ctx.restore();

  // --- New panels (playing / paused / mission-complete only — the
  // WASTED and BUSTED screens are theirs alone, no clutter on top).
  const live = state.mode === 'playing' || state.mode === 'paused' || state.mode === 'missionComplete';
  if (live) {
    drawClock(ctx, state);
    drawWantedHeat(ctx, state);
    drawMissionTracker(ctx, state);
    drawJobBoard(ctx, state);
    drawRadioBadge(ctx, state);
    drawTacticWarning(ctx, state);
    drawCarCard(ctx, state);
    drawDistrictInfo(ctx, state);
    drawEventTracker(ctx, state);
    drawBountyTracker(ctx, state);
    drawAchievementsPanel(ctx, state);
    drawCityGuide(ctx, state);
  }

  // Pause menu on top of the live panels, paused mode only.
  if (state.mode === 'paused') drawPauseMenu(ctx, state);

  // Minimap last, on top of everything else.
  drawMinimap(ctx, state);

  // Stats screen (T key) on top of everything, minimap included.
  if (state.ui?.showStats) drawStatsScreen(ctx, state);
}

export function drawMinimap(ctx, state) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const mx = W - MINIMAP_W - 14;
  const my = H - MINIMAP_H - 14;
  const time = state.time || 0;
  const scale = Math.min(MINIMAP_W / WORLD_W, MINIMAP_H / WORLD_H);
  const mapW = WORLD_W * scale;
  const mapH = WORLD_H * scale;
  const ox = mx + (MINIMAP_W - mapW) / 2;
  const oy = my + (MINIMAP_H - mapH) / 2;
  const X = (wx) => ox + wx * scale;
  const Y = (wy) => oy + wy * scale;

  ctx.save();
  // Panel.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(mx, my, MINIMAP_W, MINIMAP_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, my + 0.5, MINIMAP_W - 1, MINIMAP_H - 1);
  // Clip everything to the panel.
  ctx.beginPath();
  ctx.rect(mx, my, MINIMAP_W, MINIMAP_H);
  ctx.clip();

  // Ground + water along the SOUTH edge (the harbour is y 2260..2400).
  ctx.fillStyle = '#232a24';
  ctx.fillRect(mx, my, MINIMAP_W, MINIMAP_H);
  ctx.fillStyle = '#2b5d8a';
  ctx.fillRect(mx, Y(2260), MINIMAP_W, my + MINIMAP_H - Y(2260));

  // Buildings: dark blocks between the roads.
  ctx.fillStyle = '#15181d';
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 5; j++) {
      const bx = 400 + i * 400;
      const by = 400 + j * 400;
      ctx.fillRect(X(bx - 140), Y(by - 140), 280 * scale, 280 * scale);
    }
  }

  // Roads.
  ctx.strokeStyle = '#5a6068';
  ctx.lineWidth = Math.max(2, 96 * scale);
  ctx.beginPath();
  for (const ax of AVENUES) {
    ctx.moveTo(X(ax), Y(0));
    ctx.lineTo(X(ax), Y(WORLD_H));
  }
  for (const sy of STREETS) {
    ctx.moveTo(X(0), Y(sy));
    ctx.lineTo(X(WORLD_W), Y(sy));
  }
  ctx.stroke();

  // Traffic, faint.
  ctx.fillStyle = 'rgba(220,225,230,0.5)';
  for (const t of state.traffic || []) {
    ctx.fillRect(X(t.x) - 1, Y(t.y) - 1, 2, 2);
  }

  // Gang members, orange.
  ctx.fillStyle = '#ff9d2e';
  for (const e of state.enemies || []) {
    if (e.dead) continue;
    ctx.beginPath();
    ctx.arc(X(e.x), Y(e.y), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Police: red/blue flashing dots.
  const policeRed = Math.floor(time * 4) % 2 === 0;
  ctx.fillStyle = policeRed ? '#ff2d2d' : '#3a6bff';
  for (const c of state.cops || []) {
    ctx.beginPath();
    ctx.arc(X(c.x), Y(c.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const c of state.copsFoot || []) {
    ctx.beginPath();
    ctx.arc(X(c.x), Y(c.y), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mission waypoint: pulsing yellow blip.
  const wp = state.mission?.waypoint;
  if (wp) {
    const r = 4 + 2 * Math.sin(time * 5);
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath();
    ctx.arc(X(wp.x), Y(wp.y), Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,217,77,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(wp.x), Y(wp.y), Math.max(3, r + 3), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Side-job markers: pickup (green) and dropoff (gold), same language
  // as the story waypoint so the player reads them the same way.
  drawMinimapJobs(ctx, state, X, Y, time);

  // Street-event marker: orange, same target as the world-space event
  // marker, so the minimap and the world agree about where the trouble is.
  drawMinimapEvents(ctx, state, X, Y, time);

  // Viewport rectangle (what the camera currently shows). The camera is the
  // viewport TOP-LEFT in world coords.
  const cam = state.camera;
  if (cam) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(cam.x), Y(cam.y), ctx.canvas.width * scale, ctx.canvas.height * scale);
  }

  // Player: white arrow, rotated by facing.
  const p = state.player;
  if (p) {
    ctx.save();
    ctx.translate(X(p.x), Y(p.y));
    ctx.rotate(p.angle || 0);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4.5);
    ctx.lineTo(-5, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // North indicator.
  ctx.fillStyle = '#eef1f5';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', mx + MINIMAP_W / 2, my + 3);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// New HUD panels: clock/weather, wanted heat, mission tracker, radio badge,
// tactic warning, stats screen. Each is a pure function of state — no
// input, no side effects — so the harness can call them directly with a
// stub canvas context and assert they do not throw.
// ---------------------------------------------------------------------------

/** Top-centre clock: time of day, district, weather, phase ("14:32 · Downtown · Clear · Day"). */
export function drawClock(ctx, state) {
  const W = ctx.canvas.width;
  const light = skyLight(state);
  // The forecast line carries the weather AND the next phase with its
  // countdown ("Rain · dusk in 3:36"), so the clock is the one place
  // the player checks the time, the place, the weather and the light.
  const label = `${clockLabel(state)} · ${playerDistrict(state)} · ${forecastLabel(state)}`;
  ctx.save();
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const w = ctx.measureText(label).width + 20;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect((W - w) / 2, 12, w, 22);
  ctx.fillStyle = light.isNight ? '#9db8ff' : '#ffd94d';
  ctx.fillText(label, W / 2, 17);
  ctx.restore();
}

/**
 * Wanted heat bar under the stars (top-right): heat 0..100 as a bar,
 * plus the status line. The stars say HOW wanted the player is; the
 * bar says how CLOSE the next star is, and "LOSING THEM…" says the
 * heat is already falling (the cops have lost sight).
 */
export function drawWantedHeat(ctx, state) {
  const W = ctx.canvas.width;
  const p = state.player;
  if (!p) return;
  const heat = Math.max(0, Math.min(100, p.heat || 0));
  const wanted = p.wanted || 0;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  const barW = 110;
  const barX = W - 14 - barW;
  const barY = 104;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(barX - 1, barY - 1, barW + 2, 8);
  ctx.fillStyle = '#1c2027';
  ctx.fillRect(barX, barY, barW, 6);
  ctx.fillStyle = wanted >= 4 ? '#e5534b' : wanted >= 2 ? '#f2c94c' : '#4fc36a';
  ctx.fillRect(barX, barY, Math.max(0, barW * (heat / 100)), 6);
  // The status is the heat label from police.js (CLEAN / LOSING
  // THEM… / the wanted name), with the star count while the chase is
  // on — one source of truth, so the label and the stars never
  // disagree about how much trouble the player is in.
  const losing = wanted > 0 && (state._police?.losTimer || 0) > 0;
  const label = heatLabel(state);
  // While the cops have lost sight, the status also says how long
  // until the heat is clean — the player decides whether to keep
  // running or to hide for that many seconds.
  const cleanIn = losing ? ` · CLEAN IN ${secondsToClean(state)}s` : '';
  const status = wanted === 0 ? (label === 'LOSING THEM…' ? 'LOSING THEM…' : 'CLEAR') : losing ? `LOSING THEM…${cleanIn}` : `${label} — ${wanted} STAR${wanted === 1 ? '' : 'S'}`;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = wanted === 0 ? '#7ddb6a' : losing ? '#9db8ff' : '#ff8a7a';
  ctx.fillText(status, W - 14, 116);
  // The poster line under the bar: the city's voice about the heat.
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#cbbf9f';
  ctx.fillText(wantedPoster(state), W - 14, 130);
  ctx.restore();
}

/**
 * Car card (bottom-left, above the HP bar, while driving): the car
 * the player is in, as a card — name, condition, value, top speed,
 * and an hp bar. The point is the CONDITION: a "Barely running"
 * Comet GT is a warning to switch cars before the next fare, and the
 * value tells the player what the chop shop would pay for it. The
 * card reads from vehicles.js carCard, so the HUD never re-derives
 * a field from the model table on its own.
 */
export function drawCarCard(ctx, state) {
  const p = state.player;
  if (!p || !p.inCar) return;
  const card = carCard(p.inCar);
  if (!card) return;
  const H = ctx.canvas.height;
  const x = 14;
  const w = 240;
  const h = 80;
  const y = H - 44 - 12 - h;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffd94d';
  ctx.fillRect(x, y, 4, h);
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#eef1f5';
  ctx.fillText(card.name, x + 12, y + 8);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = card.condition === 'Pristine' ? '#7ddb6a' : card.condition === 'Wrecked' ? '#e5534b' : '#f2c94c';
  ctx.fillText(card.condition, x + 12, y + 26);
  ctx.fillStyle = '#9db8ff';
  ctx.fillText(`$${card.value.toLocaleString('en-US')} · ${card.topSpeed} mph`, x + 12, y + 42);
  // The flavour of the model: a Comet GT reads as a prize and a Regal
  // Limo reads as a boat, so the player picks a car by character.
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#cbbf9f';
  ctx.fillText(card.flavour || '', x + 12, y + 58);
  // HP bar along the bottom of the card: the fraction of the car's
  // health left, so a dented car reads at a glance.
  const frac = card.maxHp > 0 ? Math.max(0, Math.min(1, card.hp / card.maxHp)) : 0;
  ctx.fillStyle = '#1c2027';
  ctx.fillRect(x + 12, y + h - 10, w - 24, 5);
  ctx.fillStyle = frac > 0.5 ? '#4fc36a' : frac > 0.25 ? '#f2c94c' : '#e5534b';
  ctx.fillRect(x + 12, y + h - 10, Math.max(0, (w - 24) * frac), 5);
  ctx.restore();
}

/**
 * District banner (top-centre, under the clock, for 4 s after
 * entering a new district): the district's name and its one-line
 * character. The entry is detected here from state.time — the banner
 * stores the district and the game time it changed, and shows while
 * less than 4 s of game time have passed, so it never needs a dt
 * tick from the HUD. The first district (at spawn) shows too: the
 * player should know where they woke up.
 */
export function drawDistrictInfo(ctx, state) {
  const W = ctx.canvas.width;
  const ui = state.ui || (state.ui = {});
  const district = playerDistrict(state);
  if (ui.lastDistrict !== district) {
    ui.lastDistrict = district;
    ui.districtAt = state.time || 0;
  }
  const shownFor = (state.time || 0) - (ui.districtAt || 0);
  if (shownFor >= 4) return;
  const desc = districtDescription(district);
  if (!desc) return;
  const label = `${district} — ${desc}`;
  ctx.save();
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const w = Math.min(W - 40, ctx.measureText(label).width + 24);
  ctx.globalAlpha = shownFor < 3 ? 0.95 : 0.95 * (4 - shownFor);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect((W - w) / 2, 38, w, 22);
  ctx.fillStyle = '#ffd94d';
  ctx.fillText(label, W / 2, 43);
  ctx.restore();
}

/**
 * Street-event tracker (top-centre, under the district banner): the
 * active event's name, its timer bar and its payout. The event is
 * not a story mission — it has no objective box of its own — so this
 * is the only place the player sees what the trouble is, how long
 * they have, and what it pays. A race shows the checkpoint count
 * instead of a location, because the target moves.
 */
export function drawEventTracker(ctx, state) {
  const event = activeEvent(state);
  if (!event) return;
  const W = ctx.canvas.width;
  const w = 340;
  const x = (W - w) / 2;
  const y = 64;
  const frac = event.timerTotal > 0 ? Math.max(0, Math.min(1, event.timer / event.timerTotal)) : 0;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, 40);
  ctx.fillStyle = '#ff9f43';
  ctx.fillRect(x, y, 4, 40);
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#ff9f43';
  ctx.fillText(`${event.name} — $${event.payout}`, x + 12, y + 6);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#eef1f5';
  ctx.fillText(`${Math.ceil(event.timer)}s left`, x + 12, y + 22);
  ctx.fillStyle = '#1c2027';
  ctx.fillRect(x + 120, y + 24, w - 132, 6);
  ctx.fillStyle = event.timer < 15 ? '#ff5a4b' : '#ff9f43';
  ctx.fillRect(x + 120, y + 24, Math.max(0, (w - 132) * frac), 6);
  ctx.restore();
}

/**
 * Pause menu (full-screen, paused mode only): the career at a glance.
 * The stats summary (money earned, jobs, cars stolen, arrests
 * escaped, rep title), the controls, and the resume hint. The pause
 * screen used to be a bare "PAUSED" line; now it is the place the
 * player checks the career without opening the stats screen — the
 * two panels share statsSummary, so they can never disagree.
 */
export function drawPauseMenu(ctx, state) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const rows = statsSummary(state);
  const rep = repTitle(state);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillStyle = '#eef1f5';
  ctx.fillText('PAUSED', W / 2, H / 2 - 170);
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillStyle = '#ffd94d';
  ctx.fillText(`${rep.title} — ${rep.line}`, W / 2, H / 2 - 120);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#eef1f5';
  rows.forEach((r, i) => {
    ctx.fillText(`${r.label}: ${r.value}`, W / 2, H / 2 - 92 + i * 22);
  });
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#9db8ff';
  ctx.fillText(controlsHint(), W / 2, H / 2 + 40);
  ctx.fillStyle = '#eef1f5';
  ctx.fillText('Press P to resume', W / 2, H / 2 + 62);
  ctx.restore();
}

/**
 * Mission tracker (left, under the objective box): the current story
 * job with giver, difficulty stars and payout, the active side job
 * with its timer bar and payout, or the board count in free roam.
 * The objective box already shows WHAT to do; this shows WHY and
 * WHAT IT PAYS — the two things a player checks before a job.
 */
export function drawMissionTracker(ctx, state) {
  const prog = missionProgress(state);
  const job = activeJob(state);
  const offers = jobOffers(state);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const x = 12;
  let y = 150;
  const w = 364;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const lines = [];
  if (prog && prog.active) {
    const diff = '★'.repeat(prog.difficulty || 1) + '☆'.repeat(Math.max(0, 4 - (prog.difficulty || 1)));
    lines.push({ text: `${prog.title}  ${diff}`, color: '#ffd94d' });
    lines.push({ text: `${prog.giver} · ${prog.location} · $${prog.payout}`, color: '#eef1f5' });
    if (prog.tip) lines.push({ text: `Tip: ${prog.tip}`, color: '#cbbf9f' });
    // The giver's voice: Delia while a job is running, so the tracker
    // reads like a conversation at the diner, not a menu.
    const dlg = missionDialogue(state);
    if (dlg) lines.push({ text: dlg, color: '#9db8ff' });
  } else if (prog) {
    lines.push({ text: `Next: ${prog.title} — $${prog.payout}`, color: '#ffd94d' });
    lines.push({ text: `${prog.giver} · ${prog.location}`, color: '#eef1f5' });
  }
  if (job) {
    lines.push({ text: `${job.label} — $${job.payoutBase} · ${Math.ceil(job.timer)}s left`, color: '#7ddb6a' });
  } else if (offers.length > 0) {
    lines.push({ text: `${offers.length} side job${offers.length === 1 ? '' : 's'} on the board — drive to a $ marker`, color: '#7ddb6a' });
  }
  // Streak: the run of consecutive completed side jobs, and what the
  // next one pays on top. A streak is the board's long game — the
  // tracker shows it so the player knows a failure costs more than
  // one fare.
  const streak = (state.jobs && state.jobs.streak) || 0;
  if (streak >= 2) {
    lines.push({ text: `Streak x${streak} — next job +$${10 * streak}`, color: '#ff9f43' });
  }
  if (lines.length === 0) { ctx.restore(); return; }
  const boxH = 10 + lines.length * 16 + (job ? 10 : 0);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, boxH);
  ctx.fillStyle = '#ffd94d';
  ctx.fillRect(x, y, 4, boxH);
  for (const ln of lines) {
    ctx.fillStyle = ln.color;
    ctx.fillText(ln.text, x + 14, y + 6);
    y += 16;
  }
  // Side-job timer bar under the lines.
  if (job && job.timerTotal > 0) {
    const frac = Math.max(0, Math.min(1, job.timer / job.timerTotal));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x + 14, y + 2, w - 28, 5);
    ctx.fillStyle = job.timer < 10 ? '#ff5a4b' : '#7ddb6a';
    ctx.fillRect(x + 14, y + 2, Math.max(0, (w - 28) * frac), 5);
  }
  ctx.restore();
}

/**
 * Job board (left, under the mission tracker): the offers on the board,
 * one line each — type, payout, distance to the pickup, and the time
 * allowed. The tracker shows the ACTIVE job; the board shows the jobs
 * the player has NOT taken yet, so they can choose a fare worth the
 * drive instead of taking whatever is nearest. Hidden while a job is
 * active (the tracker has the screen then) and while a story mission
 * runs (the board is empty in a mission anyway).
 */
export function drawJobBoard(ctx, state) {
  const m = state.mission;
  if (m && (m.active || m.index >= 0)) return;
  if (activeJob(state)) return;
  const offers = jobOffers(state);
  if (offers.length === 0) return;
  const p = state.player;
  if (!p) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const x = 12;
  // Below the mission tracker (which sits at y=150 with ~3 lines).
  const y = 258;
  const w = 364;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const boxH = 40 + offers.length * 16;
  ctx.fillRect(x, y, w, boxH);
  ctx.fillStyle = '#7ddb6a';
  ctx.fillRect(x, y, 4, boxH);
  ctx.fillStyle = '#7ddb6a';
  ctx.fillText('SIDE JOBS — drive to a $ marker to take one', x + 14, y + 6);
  ctx.font = '12px system-ui, sans-serif';
  // The client's voice for the first offer: a fare is a person in a
  // hurry, a medic run is a crate that cannot be dropped.
  ctx.fillStyle = '#cbbf9f';
  ctx.fillText(jobFlavour(offers[0].type), x + 14, y + 22);
  let ly = y + 38;
  for (const job of offers) {
    const d = Math.round(Math.hypot(job.pickup.x - p.x, job.pickup.y - p.y));
    const dir = directionWord(p.x, p.y, job.pickup.x, job.pickup.y);
    // A fare whose pickup sits in a jam is a fare that will fail on
    // the timer — the board flags it, so the player picks a fare
    // worth the drive instead of one stuck behind five stopped cars.
    const jam = jammedNear(state, job.pickup.x, job.pickup.y) ? ' · JAM!' : '';
    ctx.fillStyle = jam ? '#ff8a7a' : '#eef1f5';
    ctx.fillText(`${job.label} — $${job.payoutBase} · ${d}px ${dir} · ${Math.ceil(job.timer)}s${jam}`, x + 14, ly);
    ly += 16;
  }
  ctx.restore();
}

/** Compass word for a direction ("N", "SE", "W") — the board's pickup hint. */
function directionWord(fx, fy, tx, ty) {
  const dx = tx - fx;
  const dy = ty - fy;
  const ns = dy < -40 ? 'N' : dy > 40 ? 'S' : '';
  const ew = dx < -40 ? 'W' : dx > 40 ? 'E' : '';
  return ns + ew || 'here';
}

/** Radio badge (bottom-right, above the minimap): station + M/N hints. */
export function drawRadioBadge(ctx, state) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const au = state.audio;
  if (!au || typeof au.stationLabel !== 'function') return;
  const label = `♪ ${au.stationLabel()}${au.musicOn === false ? ' (muted)' : ''}`;
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(label).width + 16;
  const y = H - MINIMAP_H - 40;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(W - 14 - w, y, w, 20);
  ctx.fillStyle = '#eef1f5';
  ctx.fillText(label, W - 22, y + 15);
  // The DJ line, just above the badge: the station's voice between
  // songs, rotating every 30 s of game time.
  const dj = djLine(state);
  if (dj) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#cbbf9f';
    ctx.fillText(dj, W - 22, y - 6);
  }
  ctx.restore();
}

/**
 * Tactic warning (centre-top, under the bust bar): the PD's current
 * play, so the player is not surprised by a roadblock or a cop
 * cutting across their nose. Only at 5 stars — below that the chase
 * is just a chase.
 */
export function drawTacticWarning(ctx, state) {
  const tactic = copTactic(state);
  if (tactic !== 'roadblock' && tactic !== 'pincer') return;
  const W = ctx.canvas.width;
  const time = state.time || 0;
  const flash = Math.sin(time * 10) > 0;
  ctx.save();
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const text = tactic === 'roadblock'
    ? 'ROADBLOCK AHEAD — SLOW DOWN OR GO AROUND'
    : 'THEY ARE CUTTING YOU OFF — WATCH THE NOSE';
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect((W - w) / 2, 40, w, 22);
  ctx.fillStyle = flash ? '#ff5a4b' : '#ffb347';
  ctx.fillText(text, W / 2, 44);
  ctx.restore();
}

/**
 * Stats screen (T key): the career record as rows, over a dimmed game.
 * Pure read of state.stats (player.js statsSummary) — no input here;
 * main.js owns the T key and toggles state.ui.showStats.
 */
export function drawStatsScreen(ctx, state) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const rows = statsSummary(state);
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 18, 0.82)';
  ctx.fillRect(0, 0, W, H);
  const boxW = 520;
  const boxH = 60 + rows.length * 24 + 30;
  const bx = (W - boxW) / 2;
  const by = (H - boxH) / 2;
  ctx.fillStyle = 'rgba(16, 24, 32, 0.95)';
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 1, by + 1, boxW - 2, boxH - 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffd94d';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText('ROOK — CAREER', bx + 24, by + 18);
  // The headline under the title: rep and career total in one line,
  // so the player reads their standing before the table of numbers.
  ctx.fillStyle = '#9db8d6';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(careerHeadline(state), bx + 24, by + 44);
  ctx.fillStyle = '#eef1f5';
  ctx.font = '14px system-ui, sans-serif';
  let y = by + 66;
  for (const row of rows) {
    ctx.fillStyle = '#cbbf9f';
    ctx.fillText(row.label, bx + 24, y);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(row.value, bx + boxW - 24, y);
    ctx.textAlign = 'left';
    y += 24;
  }
  ctx.fillStyle = '#cbbf9f';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('Press T to close · M music · N radio', bx + 24, y + 8);
  ctx.restore();
}

// --- Minimap job markers -----------------------------------------------------
// The active job's pickup (green $) and dropoff (gold $) on the minimap,
// drawn by drawMinimap. The markers are the side-job equivalent of the
// story waypoint blip — without them the player cannot find a fare.

/** Draw the job markers onto the minimap (called from drawMinimap). */
export function drawMinimapJobs(ctx, state, X, Y, time) {
  const jm = jobMarker(state);
  if (!jm) return;
  if (jm.pickup) {
    const r = 3 + 1.5 * Math.sin(time * 5);
    ctx.fillStyle = '#7ddb6a';
    ctx.beginPath();
    ctx.arc(X(jm.pickup.x), Y(jm.pickup.y), Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
  }
  const r2 = 4 + 2 * Math.sin(time * 5 + 1);
  ctx.fillStyle = '#ffd94d';
  ctx.beginPath();
  ctx.arc(X(jm.dropoff.x), Y(jm.dropoff.y), Math.max(2, r2), 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Minimap event dot (orange, pulsing): the active street event's
 * location, or its next race checkpoint / package dropoff — the same
 * target the world-space marker points at, so the minimap and the
 * world never disagree about where the trouble is. The dot is orange
 * because a job is green/gold (money) and an event is orange
 * (trouble); the colour is the category, not a decoration.
 */
export function drawMinimapEvents(ctx, state, X, Y, time) {
  const em = eventMarker(state);
  if (!em) return;
  const r = 4 + 2 * Math.sin(time * 5 + 2);
  ctx.fillStyle = '#ff9f43';
  ctx.beginPath();
  ctx.arc(X(em.x), Y(em.y), Math.max(2, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,159,67,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(X(em.x), Y(em.y), Math.max(4, r + 3), 0, Math.PI * 2);
  ctx.stroke();
}

// --- Bounty tracker, achievements panel, city guide --------------------------
// Three new live panels, all pure functions of state like the rest of
// the HUD. The bounty tracker sits under the event tracker (a bounty
// is trouble with a price, an event is trouble without one); the
// achievements panel is a one-line strip under the mission tracker
// (the count and the latest title, not the whole list — the stats
// screen has the list); the city guide is a full overlay the player
// opens with G and closes with G or T.

/**
 * Most Wanted tracker (top-centre, under the event tracker): the
 * active bounty's name, its payout, and the board's career count.
 * The bounty is not a story mission — it has no objective box of its
 * own — so this is the only place the player sees who the target is
 * and what he is worth. The world-space marker (render.js) shows
 * WHERE; this shows WHO and HOW MUCH.
 */
export function drawBountyTracker(ctx, state) {
  const bounty = activeBounty(state);
  const stats = bountyStats(state);
  const W = ctx.canvas.width;
  const w = 340;
  const x = (W - w) / 2;
  // Below the event tracker (y=64, 40 tall) when one is showing, else
  // in its place — the two panels never stack on top of each other.
  const y = activeEvent(state) ? 110 : 64;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, 40);
  ctx.fillStyle = '#e5534b';
  ctx.fillRect(x, y, 4, 40);
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#ff8a7a';
  if (bounty) {
    ctx.fillText(`MOST WANTED — ${bounty.name} · $${bounty.payout}`, x + 12, y + 6);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#eef1f5';
    ctx.fillText(`${bounty.line}`, x + 12, y + 22);
  } else {
    ctx.fillText('MOST WANTED', x + 12, y + 6);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#eef1f5';
    ctx.fillText(stats.done > 0
      ? `${stats.done} collected · $${stats.earned} earned — check the board at the diner`
      : 'No bounty active — check the board at the diner', x + 12, y + 22);
  }
  ctx.restore();
}

/**
 * Achievements strip (left, under the mission tracker): how many of
 * the sixteen the player has earned, and the latest title. The strip
 * is one line because the achievements are a career, not a job — the
 * player glances at it, and the stats screen (T) has the full list
 * with every title and line.
 */
export function drawAchievementsPanel(ctx, state) {
  const unlocked = unlockedAchievements(state);
  const last = lastAchievement(state);
  const total = ACHIEVEMENTS.length;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const x = 12;
  const y = 340;
  const w = 364;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, 34);
  ctx.fillStyle = '#ffd94d';
  ctx.fillRect(x, y, 4, 34);
  ctx.fillStyle = '#ffd94d';
  ctx.fillText(`ACHIEVEMENTS ${unlocked.length}/${total}`, x + 14, y + 6);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#eef1f5';
  ctx.fillText(last ? `Latest: ${last.title} — ${last.line}` : 'Earn your first: finish a story job.', x + 14, y + 20);
  ctx.restore();
}

/**
 * City guide overlay (G key): the landmarks of the district Rook is
 * standing in, with the nearest landmark's distance, and the hint
 * that G closes it. The guide is a pause in the action, not a menu —
 * it draws over the live game (the world keeps moving behind it, the
 * way the stats screen does), and it lists only this district's
 * landmarks, so the player learns the neighbourhood they are in
 * instead of reading a map of the whole city.
 */
export function drawCityGuide(ctx, state) {
  if (!state.ui?.showGuide) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const district = playerDistrict(state);
  const landmarks = districtGuide(district);
  const near = nearestLandmark(state);
  ctx.save();
  ctx.fillStyle = 'rgba(8, 12, 18, 0.82)';
  ctx.fillRect(0, 0, W, H);
  const boxW = 560;
  const boxH = 70 + landmarks.length * 24 + 46;
  const bx = (W - boxW) / 2;
  const by = (H - boxH) / 2;
  ctx.fillStyle = 'rgba(16, 24, 32, 0.95)';
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 1, by + 1, boxW - 2, boxH - 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffd94d';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(`CITY GUIDE — ${district.toUpperCase()}`, bx + 24, by + 18);
  ctx.fillStyle = '#9db8d6';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(near ? `Nearest: ${near.name} (${near.dist} px away)` : 'No landmarks near you.', bx + 24, by + 44);
  ctx.fillStyle = '#eef1f5';
  ctx.font = '14px system-ui, sans-serif';
  let y = by + 66;
  for (const lm of landmarks) {
    // One row per landmark: the name in gold, then its line in muted
    // text after it, so the guide reads as a list — the player reads
    // the name, then the line, then the next name.
    ctx.fillStyle = '#ffd94d';
    ctx.fillText(lm.name, bx + 24, y);
    const nameW = ctx.measureText(lm.name).width;
    ctx.fillStyle = '#cbbf9f';
    ctx.fillText(`— ${lm.line}`, bx + 24 + nameW + 8, y);
    y += 24;
  }
  // The district's secret: the guide is a tour with gossip, not
  // just a list of street names.
  ctx.fillStyle = '#ffd94d';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`Local secret: ${districtSecret(district)}`, bx + 24, y + 4);
  ctx.fillStyle = '#cbbf9f';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('Press G to close · T stats · M music · N radio', bx + 24, y + 24);
  ctx.restore();
}
