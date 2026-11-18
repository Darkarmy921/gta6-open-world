// Port Solano itself: a seeded 3200x2400 city, generated once and drawn every
// frame, plus the road helpers every other system steers by. Nothing here
// knows about screens, sound or the player — it is pure city.
//
// Building records are { x, y, w, h, color, rise, roof }: w/h is the ground
// footprint (what collision uses) and `rise` is the pseudo-3D height used
// only for the drawn shadow / roof offset. (An earlier draft stored both the
// footprint height and the rise under the key `h`, so buildings collided and
// drew as 10–34 px strips; the two are separate fields now.)

import {
  AVENUE_NAMES, BEACH, BUILDING_COLORS, DAYNIGHT, DISTRICT_INFO, DISTRICT_SECRETS, LANDMARKS, PALETTE, PARK, RAIN_LABELS, ROAD, RUSH_HOUR, STREET_NAMES, VIEW, WATER, WEATHER, WORLD as CFG_WORLD,
} from './config.js';
import { createRandom, lerp, pick, pickWeighted, rand, randInt } from './random.js';

/** World extents for the shared contract: WORLD = { W: 3200, H: 2400 }. */
export const WORLD = { W: CFG_WORLD.width, H: CFG_WORLD.height };
export const WORLD_SIZE = WORLD;

const HALF_ROAD = ROAD.width / 2;
const SIDEWALK_OUT = HALF_ROAD + ROAD.sidewalk;

const TREE_COLORS = ['#3f7a34', '#5da24a', '#6ab04a', '#2f6a2a'];

/**
 * Generate the city from a seed. Returns
 * { roads, blocks, buildings, water, parks, piers, spawns } where roads is
 * { vertical: [{x, name}], horizontal: [{y, name}], width, sidewalk },
 * blocks are the buildable cells between roads, buildings are
 * {x, y, w, h, color, rise, roof} (w/h = footprint, rise = drawn height),
 * and spawns holds named starting points on the road network.
 */
export function generateWorld(seed) {
  const rng = createRandom(seed);
  const roads = {
    vertical: [],
    horizontal: [],
    width: ROAD.width,
    sidewalk: ROAD.sidewalk,
  };
  for (let i = 0; i < ROAD.avenueCount; i += 1) {
    roads.vertical.push({ x: ROAD.avenueX(i), name: AVENUE_NAMES[i % AVENUE_NAMES.length] });
  }
  for (let j = 0; j < ROAD.streetCount; j += 1) {
    roads.horizontal.push({ y: ROAD.streetY(j), name: STREET_NAMES[j % STREET_NAMES.length] });
  }

  const blocks = [];
  const buildings = [];
  for (let i = 0; i < ROAD.avenueCount - 1; i += 1) {
    for (let j = 0; j < ROAD.streetCount - 1; j += 1) {
      const x0 = ROAD.avenueX(i) + SIDEWALK_OUT;
      const x1 = ROAD.avenueX(i + 1) - SIDEWALK_OUT;
      const y0 = ROAD.streetY(j) + SIDEWALK_OUT;
      const y1 = ROAD.streetY(j + 1) - SIDEWALK_OUT;
      const isPark = x0 >= PARK.x - 1 && y0 >= PARK.y - 1
        && x1 <= PARK.x + PARK.width + 1 && y1 <= PARK.y + PARK.height + 1;
      const block = { x: x0, y: y0, width: x1 - x0, height: y1 - y0, park: isPark };
      blocks.push(block);
      if (isPark) continue;
      const count = randInt(rng, 1, 4);
      if (count === 1) {
        buildings.push(makeBuilding(rng, block, 0.12, 0.12, 0.76, 0.76));
      } else if (count === 2) {
        buildings.push(makeBuilding(rng, block, 0.08, 0.08, 0.38, 0.84));
        buildings.push(makeBuilding(rng, block, 0.54, 0.08, 0.38, 0.84));
      } else if (count === 3) {
        buildings.push(makeBuilding(rng, block, 0.08, 0.08, 0.38, 0.38));
        buildings.push(makeBuilding(rng, block, 0.54, 0.08, 0.38, 0.38));
        buildings.push(makeBuilding(rng, block, 0.08, 0.54, 0.84, 0.38));
      } else {
        buildings.push(makeBuilding(rng, block, 0.08, 0.08, 0.38, 0.38));
        buildings.push(makeBuilding(rng, block, 0.54, 0.08, 0.38, 0.38));
        buildings.push(makeBuilding(rng, block, 0.08, 0.54, 0.38, 0.38));
        buildings.push(makeBuilding(rng, block, 0.54, 0.54, 0.38, 0.38));
      }
    }
  }

  // The park's trees and pond, placed once so they never jump between frames.
  const parkTrees = [];
  for (let n = 0; n < 26; n += 1) {
    const tx = rand(rng, PARK.x + 24, PARK.x + PARK.width - 24);
    const ty = rand(rng, PARK.y + 24, PARK.y + PARK.height - 24);
    // Keep the pond clear.
    if (Math.hypot(tx - (PARK.x + 200), ty - (PARK.y + 210)) < 78) continue;
    parkTrees.push({ x: tx, y: ty, r: rand(rng, 10, 18), color: pick(rng, TREE_COLORS) });
  }
  const parks = [{
    x: PARK.x, y: PARK.y, width: PARK.width, height: PARK.height,
    pond: { x: PARK.x + 200, y: PARK.y + 210, rx: 62, ry: 44 },
    trees: parkTrees,
  }];

  const water = { x: 0, y: WATER.y, width: CFG_WORLD.width, height: WATER.height };
  const piers = [
    { x: 700, y: 2196, width: 64, height: 184 },
    { x: 2400, y: 2196, width: 64, height: 184 },
  ];

  const world = { roads, blocks, buildings, water, parks, piers, spawns: null };
  world.spawns = {
    player: { x: 1800, y: 1400 },
    marina: { x: 732, y: 2140 },
    hotel: { x: 2600, y: 600 },
    downtown: { x: 1800, y: 1000 },
  };
  return world;
}

function makeBuilding(rng, block, fx, fy, fw, fh) {
  const w = Math.max(40, block.width * fw);
  const h = Math.max(40, block.height * fh);
  return {
    x: block.x + block.width * fx,
    y: block.y + block.height * fy,
    w,
    h,
    color: pick(rng, BUILDING_COLORS),
    rise: randInt(rng, 10, 34),
    roof: pick(rng, ['flat', 'flat', 'flat', 'garden', 'tower']),
  };
}

/** True when (x, y) is on drivable asphalt (road surface, not sidewalk). */
export function pointOnRoad(world, x, y) {
  if (y > ROAD.landEdgeY || x < 0 || y < 0 || x > CFG_WORLD.width || y > CFG_WORLD.height) return false;
  for (const road of world.roads.vertical) {
    if (Math.abs(x - road.x) <= HALF_ROAD) return true;
  }
  for (const road of world.roads.horizontal) {
    if (Math.abs(y - road.y) <= HALF_ROAD) return true;
  }
  return false;
}

/** True when (x, y) is on road or sidewalk. */
export function pointOnRoadOrSidewalk(world, x, y) {
  if (y > ROAD.landEdgeY) return false;
  for (const road of world.roads.vertical) {
    if (Math.abs(x - road.x) <= SIDEWALK_OUT) return true;
  }
  for (const road of world.roads.horizontal) {
    if (Math.abs(y - road.y) <= SIDEWALK_OUT) return true;
  }
  return false;
}

/**
 * True when (x, y) is on a road AND the road runs in the given direction:
 * 'vertical' (an avenue, traffic flows north/south) or 'horizontal' (a
 * street, east/west). pointOnRoad answers "is this road?" — this answers
 * "is this the road I am driving along?", which is what a car's lane
 * logic and a cop's pursuit need: a car on avenue 600 at a street-1400
 * intersection is on BOTH roads, and only the direction tells you which
 * one it is following. Returns false outside the world / in the water.
 */
export function isOnRoad(world, x, y, direction) {
  if (!world || y > ROAD.landEdgeY || x < 0 || y < 0 || x > CFG_WORLD.width || y > CFG_WORLD.height) return false;
  if (direction === 'vertical') {
    for (const road of world.roads.vertical) {
      if (Math.abs(x - road.x) <= HALF_ROAD) return true;
    }
    return false;
  }
  if (direction === 'horizontal') {
    for (const road of world.roads.horizontal) {
      if (Math.abs(y - road.y) <= HALF_ROAD) return true;
    }
    return false;
  }
  return pointOnRoad(world, x, y);
}

/**
 * A point in a lane on a road: the right-hand lane for the given heading
 * (traffic drives on the right). `lane` is +1 for the right lane, -1 for
 * the left; the offset is 24px from the centreline, half the 96px road
 * width minus the car's half-width, so two cars passing in opposite
 * lanes clear each other by 48px — more than the 44px separation radius
 * that makes centreline drivers shove each other sideways. traffic.js's
 * randomRoadPoint used to hardcode the ±24 offsets; there is now one
 * place that knows what a lane is.
 */
export function roadLanePoint(world, rng, direction, lane = 1) {
  const randFn = typeof rng === 'function' ? rng : Math.random;
  const off = lane * 24;
  if (direction === 'vertical') {
    const road = pick(randFn, world.roads.vertical);
    return {
      x: road.x + off,
      y: rand(randFn, 120, ROAD.landEdgeY - 120),
      angle: randFn() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
    };
  }
  const road = pick(randFn, world.roads.horizontal);
  return {
    x: rand(randFn, 120, CFG_WORLD.width - 120),
    y: road.y + off,
    angle: randFn() < 0.5 ? 0 : Math.PI,
  };
}

/** True when (x, y) is in the harbour water (south edge) or on a pier gap. */
export function isInWater(world, x, y) {
  if (y >= WATER.y) return true;
  if (world && world.water && y >= world.water.y && y <= world.water.y + world.water.height) return true;
  return false;
}

/** The closest point on a road centreline to (x, y). */
export function nearestRoadPoint(world, x, y) {
  let best = { x, y };
  let bestDist = Infinity;
  for (const road of world.roads.vertical) {
    const cy = Math.min(Math.max(y, 0), ROAD.landEdgeY);
    const d = Math.abs(x - road.x) + Math.abs(y - cy) * 0.001;
    if (d < bestDist) {
      bestDist = d;
      best = { x: road.x, y: cy };
    }
  }
  for (const road of world.roads.horizontal) {
    const cx = Math.min(Math.max(x, 0), CFG_WORLD.width);
    const d = Math.abs(y - road.y) + Math.abs(x - cx) * 0.001;
    if (d < bestDist) {
      bestDist = d;
      best = { x: cx, y: road.y };
    }
  }
  return best;
}

/** A random point on a random road, with a heading along that road. */
export function randomSpawnOnRoad(world, rng) {
  if (rng() < 0.5) {
    const road = pick(rng, world.roads.vertical);
    return {
      x: road.x + (rng() < 0.5 ? -24 : 24),
      y: rand(rng, 120, ROAD.landEdgeY - 120),
      angle: rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
    };
  }
  const road = pick(rng, world.roads.horizontal);
  return {
    x: rand(rng, 120, CFG_WORLD.width - 120),
    y: road.y + (rng() < 0.5 ? -24 : 24),
    angle: rng() < 0.5 ? 0 : Math.PI,
  };
}

/**
 * A point on a road at a distance in [minDist, maxDist] from (x, y) —
 * where police cars and foot cops spawn, so they arrive from off-screen
 * but not from across the map. police.js used to carry its own copy of
 * this (with its own avenue/street tables); there is now one, here, using
 * the world's own road lists. Tries 12 random picks and keeps the best
 * (closest to the band); a point outside the band is still returned
 * rather than null, so a caller never has to handle "no spawn point".
 */
export function roadPointNear(world, rng, x, y, minDist, maxDist) {
  const randFn = typeof rng === 'function' ? rng : Math.random;
  let best = { x: 600, y: 600 };
  let bestErr = Infinity;
  for (let i = 0; i < 12; i++) {
    let px, py;
    if (randFn() < 0.5) {
      const road = pick(randFn, world.roads.vertical);
      px = road.x;
      py = Math.min(Math.max(y + (randFn() < 0.5 ? -1 : 1) * rand(randFn, minDist, maxDist), 40), CFG_WORLD.height - 40);
    } else {
      const road = pick(randFn, world.roads.horizontal);
      py = road.y;
      px = Math.min(Math.max(x + (randFn() < 0.5 ? -1 : 1) * rand(randFn, minDist, maxDist), 40), CFG_WORLD.width - 40);
    }
    const d = Math.hypot(px - x, py - y);
    const err = d < minDist ? minDist - d : d > maxDist ? d - maxDist : 0;
    if (err < bestErr) {
      bestErr = err;
      best = { x: px, y: py };
      if (err === 0) break;
    }
  }
  return best;
}

/** True when the circle (x, y, r) overlaps any building. Returns the building or null. */
export function buildingHit(world, x, y, r) {
  for (const b of world.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return b;
  }
  return null;
}

/** Push a circle out of any building it overlaps; returns the building hit, if any. */
export function resolveBuildingCollision(world, pos, r) {
  const b = buildingHit(world, pos.x, pos.y, r);
  if (!b) return null;
  const left = (pos.x + r) - b.x;
  const right = (b.x + b.w) - (pos.x - r);
  const top = (pos.y + r) - b.y;
  const bottom = (b.y + b.h) - (pos.y - r);
  const min = Math.min(left, right, top, bottom);
  if (min === left) pos.x = b.x - r;
  else if (min === right) pos.x = b.x + b.w + r;
  else if (min === top) pos.y = b.y - r;
  else pos.y = b.y + b.h + r;
  return b;
}

// ---------------------------------------------------------------------------
// Drawing. drawWorld paints only the part of the city the camera can see.
// `cam` is the viewport's TOP-LEFT in world coords (the unified convention).
// ---------------------------------------------------------------------------

function inView(cam, viewW, viewH, x, y, w, h) {
  return x + w >= cam.x - 40 && x <= cam.x + viewW + 40
    && y + h >= cam.y - 40 && y <= cam.y + viewH + 40;
}

/** Draw the city: ground, water, park, roads, buildings, piers. */
export function drawWorld(ctx, world, cam, state) {
  const viewW = VIEW.width;
  const viewH = VIEW.height;
  const x0 = cam.x;
  const y0 = cam.y;
  const x1 = cam.x + viewW;
  const y1 = cam.y + viewH;

  // Ground.
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(x0, y0, viewW, viewH);
  // Subtle checker of district tints so the ground is not one flat slab.
  ctx.fillStyle = PALETTE.groundAlt;
  const blockW = 400;
  const blockH = 400;
  const gx0 = Math.max(0, Math.floor(x0 / blockW));
  const gy0 = Math.max(0, Math.floor(y0 / blockH));
  for (let gx = gx0; gx * blockW < x1; gx += 1) {
    for (let gy = gy0; gy * blockH < y1; gy += 1) {
      if ((gx + gy) % 2 === 0) {
        ctx.fillRect(gx * blockW, gy * blockH, blockW, blockH);
      }
    }
  }

  // Beach strip, then water.
  if (y1 > BEACH.y) {
    ctx.fillStyle = PALETTE.beach;
    ctx.fillRect(x0, BEACH.y, viewW, Math.min(y1, WATER.y) - BEACH.y);
  }
  if (y1 > WATER.y) {
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(x0, WATER.y, viewW, Math.min(y1, WATER.y + WATER.height) - WATER.y);
    // Animated wave lines, driven by state.time so the harbour feels alive.
    ctx.strokeStyle = PALETTE.waterDeep;
    ctx.lineWidth = 2;
    const t = state ? state.time : 0;
    for (let wy = WATER.y + 18; wy < WATER.y + WATER.height; wy += 26) {
      ctx.beginPath();
      for (let wx = Math.max(0, x0 - 40); wx < x1 + 40; wx += 40) {
        const wave = Math.sin((wx + t * 40) * 0.02 + wy * 0.11) * 3;
        if (wx === Math.max(0, x0 - 40)) ctx.moveTo(wx, wy + wave);
        else ctx.lineTo(wx, wy + wave);
      }
      ctx.stroke();
    }
  }

  drawPark(ctx, world, cam, viewW, viewH);
  drawRoads(ctx, world, cam, viewW, viewH);
  drawPiers(ctx, world, cam, viewW, viewH);
  drawBuildings(ctx, world, cam, viewW, viewH);
}

function drawPark(ctx, world, cam, viewW, viewH) {
  for (const park of world.parks) {
    if (!inView(cam, viewW, viewH, park.x, park.y, park.width, park.height)) continue;
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(park.x, park.y, park.width, park.height);
    // Footpaths crossing the park.
    ctx.fillStyle = PALETTE.sidewalk;
    ctx.fillRect(park.x, park.y + park.height / 2 - 8, park.width, 16);
    ctx.fillRect(park.x + park.width / 2 - 8, park.y, 16, park.height);
    // Pond.
    ctx.fillStyle = PALETTE.water;
    ctx.beginPath();
    ctx.ellipse(park.pond.x, park.pond.y, park.pond.rx, park.pond.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.waterDeep;
    ctx.beginPath();
    ctx.ellipse(park.pond.x, park.pond.y, park.pond.rx - 10, park.pond.ry - 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Trees: canopy + trunk shadow.
    for (const tree of park.trees) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.arc(tree.x + 4, tree.y + 5, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tree.color;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.grassDark;
      ctx.beginPath();
      ctx.arc(tree.x - tree.r * 0.25, tree.y - tree.r * 0.25, tree.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRoads(ctx, world, cam, viewW, viewH) {
  const x0 = cam.x;
  const y0 = cam.y;
  const x1 = cam.x + viewW;
  const y1 = cam.y + viewH;

  for (const road of world.roads.vertical) {
    if (road.x + SIDEWALK_OUT < x0 || road.x - SIDEWALK_OUT > x1) continue;
    // Sidewalk, then asphalt.
    ctx.fillStyle = PALETTE.sidewalk;
    ctx.fillRect(road.x - SIDEWALK_OUT, Math.max(y0, 0), SIDEWALK_OUT * 2, Math.min(y1, ROAD.landEdgeY) - Math.max(y0, 0));
    ctx.fillStyle = PALETTE.road;
    ctx.fillRect(road.x - HALF_ROAD, Math.max(y0, 0), ROAD.width, Math.min(y1, ROAD.landEdgeY) - Math.max(y0, 0));
    // Centre dashes.
    ctx.fillStyle = PALETTE.lane;
    for (let y = Math.floor(Math.max(y0, 0) / 56) * 56; y < Math.min(y1, ROAD.landEdgeY); y += 56) {
      ctx.fillRect(road.x - 2, y, 4, 28);
    }
    // Street name, upright along the avenue.
    ctx.save();
    ctx.fillStyle = 'rgba(232, 228, 218, 0.75)';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(road.x, Math.min(Math.max(360, y0 + 120), ROAD.landEdgeY - 60));
    ctx.rotate(Math.PI / 2);
    ctx.fillText(road.name.toUpperCase(), 0, 0);
    ctx.restore();
  }

  for (const road of world.roads.horizontal) {
    if (road.y + SIDEWALK_OUT < y0 || road.y - SIDEWALK_OUT > y1) continue;
    ctx.fillStyle = PALETTE.sidewalk;
    ctx.fillRect(Math.max(x0, 0), road.y - SIDEWALK_OUT, Math.min(x1, CFG_WORLD.width) - Math.max(x0, 0), SIDEWALK_OUT * 2);
    ctx.fillStyle = PALETTE.road;
    ctx.fillRect(Math.max(x0, 0), road.y - HALF_ROAD, Math.min(x1, CFG_WORLD.width) - Math.max(x0, 0), ROAD.width);
    ctx.fillStyle = PALETTE.lane;
    for (let x = Math.floor(Math.max(x0, 0) / 56) * 56; x < Math.min(x1, CFG_WORLD.width); x += 56) {
      ctx.fillRect(x, road.y - 2, 28, 4);
    }
    ctx.fillStyle = 'rgba(232, 228, 218, 0.75)';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(road.name.toUpperCase(), Math.min(Math.max(300, x0 + 160), CFG_WORLD.width - 160), road.y);
  }

  // Crosswalk stripes where avenues meet streets.
  ctx.fillStyle = PALETTE.crosswalk;
  for (const v of world.roads.vertical) {
    if (v.x + HALF_ROAD < x0 || v.x - HALF_ROAD > x1) continue;
    for (const h of world.roads.horizontal) {
      if (h.y + HALF_ROAD < y0 || h.y - HALF_ROAD > y1) continue;
      for (let s = -36; s <= 36; s += 18) {
        ctx.fillRect(v.x + s - 4, h.y - HALF_ROAD - 2, 8, 10);
        ctx.fillRect(v.x + s - 4, h.y + HALF_ROAD - 8, 8, 10);
        ctx.fillRect(v.x - HALF_ROAD - 2, h.y + s - 4, 10, 8);
        ctx.fillRect(v.x + HALF_ROAD - 8, h.y + s - 4, 10, 8);
      }
    }
  }
}

function drawPiers(ctx, world, cam, viewW, viewH) {
  for (const pier of world.piers) {
    if (!inView(cam, viewW, viewH, pier.x, pier.y, pier.width, pier.height)) continue;
    ctx.fillStyle = PALETTE.pierPost;
    ctx.fillRect(pier.x - 4, pier.y, pier.width + 8, pier.height);
    ctx.fillStyle = PALETTE.pier;
    ctx.fillRect(pier.x, pier.y, pier.width, pier.height);
    ctx.strokeStyle = PALETTE.pierPost;
    ctx.lineWidth = 2;
    for (let y = pier.y + 16; y < pier.y + pier.height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(pier.x, y);
      ctx.lineTo(pier.x + pier.width, y);
      ctx.stroke();
    }
    // Mooring posts at the pier end.
    ctx.fillStyle = PALETTE.pierPost;
    ctx.fillRect(pier.x + 4, pier.y + pier.height - 14, 8, 14);
    ctx.fillRect(pier.x + pier.width - 12, pier.y + pier.height - 14, 8, 14);
  }
}

function drawBuildings(ctx, world, cam, viewW, viewH) {
  for (const b of world.buildings) {
    const rise = b.rise || 0;
    if (!inView(cam, viewW, viewH, b.x - rise, b.y - rise, b.w + rise * 2, b.h + rise * 2)) continue;
    // Drop shadow / pseudo-3D side, offset by the building's rise.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + rise * 0.45, b.y + rise * 0.45, b.w, b.h);
    // Walls.
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Windows: a grid of lit and dark panes.
    const cols = Math.max(1, Math.floor(b.w / 26));
    const rows = Math.max(1, Math.floor(b.h / 26));
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const lit = ((c * 7 + r * 13 + b.x + b.y) % 5) === 0;
        ctx.fillStyle = lit ? '#ffe9a8' : 'rgba(20, 28, 36, 0.55)';
        ctx.fillRect(b.x + 8 + c * ((b.w - 16) / cols), b.y + 8 + r * ((b.h - 16) / rows), 10, 12);
      }
    }
    // Roof: lighter slab shifted up-left by the rise, with rooftop detail.
    ctx.fillStyle = PALETTE.buildingRoof;
    ctx.fillRect(b.x - rise * 0.3, b.y - rise * 0.3, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(b.x - rise * 0.3, b.y - rise * 0.3, b.w, 6);
    if (b.roof === 'garden') {
      ctx.fillStyle = PALETTE.grassDark;
      ctx.fillRect(b.x - rise * 0.3 + 10, b.y - rise * 0.3 + 10, b.w - 20, b.h - 20);
    } else if (b.roof === 'tower') {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - rise * 0.3 + b.w * 0.3, b.y - rise * 0.3 + b.h * 0.25, b.w * 0.4, b.h * 0.5);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(b.x - rise * 0.3 + 12, b.y - rise * 0.3 + 12, 18, 12);
      ctx.fillRect(b.x - rise * 0.3 + b.w - 34, b.y - rise * 0.3 + b.h - 26, 20, 12);
    }
  }
}

// ---------------------------------------------------------------------------
// Day / night + weather. The sky is state, not scenery: timeOfDay drives
// the clock, the night overlay and the headlights; weather drives grip
// and rain. Both live on state.sky (created by createSkyState, installed
// by main.js's createGameState) so every system reads the same sky.
//
// Rules that keep the campaign deterministic:
// - timeOfDay always advances (a day is DAYNIGHT.dayLength of game time).
// - Weather only ever CHANGES in free roam (no story mission active). A
//   mission that starts dry stays dry; a storm that starts in free roam
//   can persist into a mission, which is the player's own weather.
// - Night is visual only: it never changes grip, spawns or cop behaviour.
// ---------------------------------------------------------------------------

/** Fresh sky state: noon, clear, no rain, no flash. */
export function createSkyState() {
  return {
    timeOfDay: DAYNIGHT.startTime,
    weather: 'clear',
    weatherT: 0,
    rainAmount: 0,
    lightningT: WEATHER.stormFlashEvery,
    flashT: 0,
  };
}

function skyOf(state) {
  if (!state.sky) state.sky = createSkyState();
  return state.sky;
}

/** True when no story mission is running (index -1, not active). */
export function isFreeRoam(state) {
  const m = state && state.mission;
  if (!m) return true;
  return m.index < 0 && !m.active;
}

/** Advance the clock and (in free roam only) roll the weather. */
export function updateSky(state, dt) {
  if (dt <= 0) return;
  const sky = skyOf(state);
  sky.timeOfDay = (sky.timeOfDay + dt / DAYNIGHT.dayLength) % 1;
  // Rain amount ramps toward its target so a storm fades in, not on.
  const targetRain = sky.weather === 'rain' ? 0.7 : sky.weather === 'storm' ? 1 : 0;
  sky.rainAmount += (targetRain - sky.rainAmount) * Math.min(1, dt * 0.5);
  if (sky.flashT > 0) sky.flashT -= dt;
  if (sky.weather === 'storm') {
    sky.lightningT -= dt;
    if (sky.lightningT <= 0) {
      sky.flashT = 0.12;
      const rng = state.rng || Math.random;
      sky.lightningT = WEATHER.stormFlashEvery * (0.5 + rng());
    }
  }
  if (!isFreeRoam(state)) return;
  sky.weatherT += dt;
  if (sky.weatherT < WEATHER.rollEvery) return;
  sky.weatherT = 0;
  const rng = state.rng || Math.random;
  sky.weather = pickWeighted(rng, [
    ['clear', 3],
    ['overcast', 1],
    ['rain', WEATHER.rainChance * 2],
    ['storm', WEATHER.rainChance * 0.5],
  ]);
}

/** Set the weather directly (tests, and the ?shot= staging). */
export function setWeather(state, kind) {
  const sky = skyOf(state);
  if (!['clear', 'overcast', 'rain', 'storm'].includes(kind)) return false;
  sky.weather = kind;
  sky.rainAmount = kind === 'rain' ? 0.7 : kind === 'storm' ? 1 : 0;
  sky.weatherT = 0;
  return true;
}

/** Set the clock directly (0..1, 0 = midnight). */
export function setTimeOfDay(state, t) {
  const sky = skyOf(state);
  sky.timeOfDay = ((t % 1) + 1) % 1;
  return sky.timeOfDay;
}

/** 'night' | 'dawn' | 'day' | 'dusk', from the clock. */
export function dayPhase(state) {
  const t = skyOf(state).timeOfDay;
  if (t < DAYNIGHT.dawn) return 'night';
  if (t < DAYNIGHT.day) return 'dawn';
  if (t < DAYNIGHT.dusk) return 'day';
  if (t < DAYNIGHT.night) return 'dusk';
  return 'night';
}

/** True when the sun is down (phase night). */
export function isNight(state) {
  return dayPhase(state) === 'night';
}

// Darkness anchors across the day: (timeOfDay, darkness). render.js
// interpolates between them for the night overlay and the headlights.
// The flat [day, 0] -> [0.6, 0] stretch is the point: midday stays
// fully lit, and darkness only starts deepening after 14:24.
const DARKNESS_ANCHORS = [
  [0, 0.82],
  [DAYNIGHT.dawn, 0.25],
  [DAYNIGHT.day, 0],
  [0.6, 0],
  [DAYNIGHT.dusk, 0.3],
  [DAYNIGHT.night, 0.82],
  [1, 0.82],
];

/** { darkness 0..1, phase, isNight } — what the renderer needs. */
export function skyLight(state) {
  const sky = skyOf(state);
  const t = sky.timeOfDay;
  let darkness = 0.82;
  for (let i = 0; i < DARKNESS_ANCHORS.length - 1; i += 1) {
    const [t0, d0] = DARKNESS_ANCHORS[i];
    const [t1, d1] = DARKNESS_ANCHORS[i + 1];
    if (t >= t0 && t <= t1) {
      darkness = lerp(d0, d1, t1 === t0 ? 0 : (t - t0) / (t1 - t0));
      break;
    }
  }
  // A lightning flash briefly lifts the darkness (the flash is drawn
  // as a white overlay on top; the lift keeps the world readable).
  if (sky.flashT > 0) darkness = Math.max(0, darkness - 0.5);
  const phase = dayPhase(state);
  return { darkness, phase, isNight: phase === 'night' };
}

/** "HH:MM" on a 24 h clock. */
export function clockLabel(state) {
  const t = skyOf(state).timeOfDay * 24;
  const h = Math.floor(t) % 24;
  const m = Math.floor((t - Math.floor(t)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'Clear' | 'Overcast' | 'Rain' | 'Storm'. */
export function weatherLabel(state) {
  const w = skyOf(state).weather;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * The rain intensity as a word ("Drizzle" / "Rain" / "Downpour"),
 * from the sky's rainAmount. The weather label says what kind of
 * sky it is; the rain label says how hard it is falling — the
 * difference between a drizzle the player ignores and a downpour
 * that halves the grip. Clear weather is "Clear", not "Drizzle",
 * so the label never lies about a dry road.
 */
export function rainLabel(state) {
  const sky = skyOf(state);
  if (!sky || sky.weather !== 'rain' && sky.weather !== 'storm') return 'Clear';
  const amount = sky.rainAmount || 0;
  let best = RAIN_LABELS[0];
  for (const row of RAIN_LABELS) {
    if (amount >= row.at) best = row;
  }
  return best.label;
}

/**
 * True when the player is on the beach (the sand strip along the
 * south edge, y past BEACH.y). The beach is not a road — cars bog
 * down on it, and the HUD can say so — but it is the only place in
 * the city where the water is next to the sand, so the label matters
 * for the district banner too.
 */
export function onBeach(state) {
  const p = state && state.player;
  if (!p) return false;
  return p.y >= BEACH.y;
}

/** Grip multiplier for the road right now: 1 dry, WEATHER.rainGrip wet. */
export function gripFactor(state) {
  const sky = state && state.sky;
  if (!sky) return 1;
  return sky.weather === 'rain' || sky.weather === 'storm' ? WEATHER.rainGrip : 1;
}

/** True during the morning or evening rush windows. */
export function isRushHour(state) {
  const t = skyOf(state).timeOfDay;
  const inWindow = (w) => t >= w.start && t < w.end;
  return inWindow(RUSH_HOUR.morning) || inWindow(RUSH_HOUR.evening);
}

/** Traffic density multiplier right now (1 outside rush hour, 1.5 in it). */
export function trafficFactor(state) {
  return isRushHour(state) ? RUSH_HOUR.multiplier : 1;
}

// --- Districts ---------------------------------------------------------------
// Named neighbourhoods, by region. The HUD clock shows the district the
// player is standing in ("14:32 · Downtown · Clear · Day"), so the city
// reads as places, not coordinates. The park block is its own district;
// the harbour (y > 2200) is the Marina. Boundaries are the avenues and
// streets, so a district never cuts a road in half.

const DISTRICTS = [
  { name: 'The Park', x0: 1400, y0: 1000, x1: 1800, y1: 1400 },
  { name: 'Marina', x0: 0, y0: 1800, x1: 1600, y1: 2200 },
  { name: 'Docks', x0: 1600, y0: 1800, x1: 3200, y1: 2200 },
  { name: 'Old Town', x0: 0, y0: 0, x1: 1200, y1: 600 },
  { name: 'Harbor Heights', x0: 2000, y0: 0, x1: 3200, y1: 600 },
  { name: 'Downtown', x0: 1200, y0: 600, x1: 2000, y1: 1400 },
  { name: 'Westside', x0: 0, y0: 600, x1: 1200, y1: 1800 },
  { name: 'The Strip', x0: 2000, y0: 600, x1: 3200, y1: 1800 },
  { name: 'Northside', x0: 1200, y0: 0, x1: 2000, y1: 600 },
];

/** The district name for a world point. */
export function districtAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d.name;
  }
  return y >= 2200 ? 'The Harbour' : 'Port Solano';
}

/** The district the player is standing in right now. */
export function playerDistrict(state) {
  const p = state && state.player;
  if (!p) return 'Port Solano';
  return districtAt(p.x, p.y);
}

/** The one-line character of a district, for the HUD's entry banner. */
export function districtDescription(name) {
  return DISTRICT_INFO[name] || '';
}

/**
 * Seconds until the day reaches `phase` ('dawn' | 'day' | 'dusk' |
 * 'night'), from the current timeOfDay. The day is 1200 s long and
 * the phases sit at fixed fractions (DAYNIGHT), so the answer is
 * arithmetic, not a simulation — the HUD can show "dusk in 3:36"
 * without running the clock forward. Wraps past midnight.
 */
export function timeUntilPhase(state, phase) {
  const sky = skyOf(state);
  const t = sky.timeOfDay;
  const at = { dawn: DAYNIGHT.dawn, day: DAYNIGHT.day, dusk: DAYNIGHT.dusk, night: DAYNIGHT.night }[phase];
  if (at === undefined) return 0;
  let frac = at - t;
  if (frac <= 0) frac += 1;
  return Math.round(frac * DAYNIGHT.dayLength);
}

/** The next phase the day will reach, from the current time. */
export function nextPhase(state) {
  const t = skyOf(state).timeOfDay;
  if (t < DAYNIGHT.dawn) return 'dawn';
  if (t < DAYNIGHT.day) return 'day';
  if (t < DAYNIGHT.dusk) return 'dusk';
  if (t < DAYNIGHT.night) return 'night';
  return 'dawn';
}

/**
 * The forecast line for the HUD clock: the current weather plus the
 * next phase and when it arrives ("Rain · dusk in 3:36"). The weather
 * itself has no forecast — it rolls every 90 s in free roam and the
 * city does not predict it — but the sun does keep a schedule, and
 * the player plans around the light.
 */
export function forecastLabel(state) {
  const phase = nextPhase(state);
  const secs = timeUntilPhase(state, phase);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  return `${weatherLabel(state)} · ${phase} in ${mm}:${ss}`;
}

// --- Landmarks and the city guide -------------------------------------------
// Twelve places worth knowing (LANDMARKS in config.js). The guide panel
// (G key) lists the landmarks of the district Rook is standing in;
// these are the lookups it reads. A landmark is found by distance, not
// by district box: the pier is a point on the map, and the player
// standing next to it should get its line even if the district border
// runs through the pier car park.

/** The landmark within `r` px of (x, y), or null. */
export function landmarkAt(x, y, r = 120) {
  let best = null;
  let bestD = r;
  for (const lm of LANDMARKS) {
    const d = Math.hypot(lm.x - x, lm.y - y);
    if (d < bestD) { bestD = d; best = lm; }
  }
  return best;
}

/** The nearest landmark to the player, however far (for the guide header). */
export function nearestLandmark(state) {
  const p = state && state.player;
  if (!p) return null;
  let best = null;
  let bestD = Infinity;
  for (const lm of LANDMARKS) {
    const d = Math.hypot(lm.x - p.x, lm.y - p.y);
    if (d < bestD) { bestD = d; best = lm; }
  }
  return best ? { ...best, dist: Math.round(bestD) } : null;
}

/** The landmarks of a district, in map order (north to south). */
export function districtGuide(district) {
  return LANDMARKS
    .filter((lm) => lm.district === district)
    .sort((a, b) => a.y - b.y)
    .map((lm) => ({ name: lm.name, x: lm.x, y: lm.y, line: lm.line }));
}

/** One line for a landmark ("Marina Pier — the pier where packages come in"). */
// What the district keeps to itself: the guide shows one secret per
// district, so the tour has gossip, not just street names. A local
// knows the secrets, and now Rook does too.
export function districtSecret(district) {
  return DISTRICT_SECRETS[district] || 'Every district keeps a secret. This one keeps it well.';
}

export function landmarkLine(lm) {
  if (!lm) return '';
  return `${lm.name} — ${lm.line}`;
}
