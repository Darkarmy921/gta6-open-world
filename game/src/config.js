// Port Solano — every tuning number and colour in one place.
// The world is a fixed 3200x2400 city; the canvas shows a 1280x720 window
// of it through a following camera, so no rule below depends on screen size.
//
// UNIFIED CONTRACT (all modules agree on this; see main.js header too):
// - Modes: 'title' | 'playing' | 'paused' | 'busted' | 'wasted' | 'missionComplete'.
// - state.camera is the TOP-LEFT of the viewport in world coords. Its centre
//   is camera + (640, 360); traffic / peds spawn relative to that centre.
// - state.cars holds EVERY car; state.traffic and state.cops are subsets of it
//   (references to the same objects, never copies).
// - Wanted is heat 0..100: wanted stars = floor(heat / HEAT_PER_STAR),
//   capped at 5. Crimes add stars (fractional allowed); police.js owns decay.

/** Logical size of the canvas / camera view, in pixels. */
export const VIEW = { width: 1280, height: 720 };

/** The whole city, in pixels. */
export const WORLD = { width: 3200, height: 2400 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Longest real frame the loop catches up on; a longer stall is dropped, not replayed. */
export const MAX_FRAME = 0.25;

export const ROAD = {
  width: 96,
  sidewalk: 20,
  /** Vertical avenues at x = 200 + i*400, i 0..7. */
  avenueX: (i) => 200 + i * 400,
  avenueCount: 8,
  /** Horizontal streets at y = 200 + j*400, j 0..5. */
  streetY: (j) => 200 + j * 400,
  streetCount: 6,
  /** Roads stop at the beach; the water starts here. */
  landEdgeY: 2240,
};

export const WATER = { y: 2260, height: 140 };
export const BEACH = { y: 2200, height: 60 };

/** The one park block: x 1400..1800, y 1000..1400. */
export const PARK = { x: 1400, y: 1000, width: 400, height: 400 };

export const PLAYER = {
  radius: 14,
  walkSpeed: 230,
  runSpeed: 350,
  accel: 2400,
  maxHp: 100,
  maxArmor: 100,
  /** Seconds a foot cop must stay touching the player on foot before the bust lands. */
  bustTime: 1.5,
  /** Sprint stamina (0..100): drain per second while sprinting, regen per
   * second while not, and the stamina a locked sprint needs to unlock.
   * ~5 s of sprint from full, ~2 s to unlock from empty. */
  staminaDrain: 20,
  staminaRegen: 14,
  staminaUnlock: 30,
};

export const WEAPONS = {
  fists: { name: 'Fists', damage: 25, range: 46, rate: 0.4, ammo: Infinity },
  pistol: { name: 'P9 Pistol', damage: 34, range: 520, rate: 0.18, ammo: 12, bulletSpeed: 900 },
};

// Pistol combat tuning — the SINGLE source of truth. combat.js used to
// carry its own PISTOL copy (fireRate 0.18, bulletSpeed 900, range 500,
// damage 34, magSize 12, reloadTime 1.2) alongside WEAPONS.pistol above,
// and the two had already drifted: WEAPONS.pistol.range is 520, the
// combat copy's range is 500, and the bullet's actual life is
// range / bulletSpeed — so the range a reader assumed from WEAPONS
// (520) was not the range the bullets flew (500). The combat copy now
// lives here, WEAPONS.pistol mirrors its values, and hud.js reads the
// reload time from here too (it used to hardcode 1.2).
export const PISTOL = {
  fireRate: 0.18,
  bulletSpeed: 900,
  range: 500,
  damage: 34,
  magSize: 12,
  reloadTime: 1.2,
};

export const CAR_MODELS = {
  sedan: { name: 'Solano Sedan', maxSpeed: 420, accel: 260, turn: 2.6, health: 100 },
  coupe: { name: 'Marina Coupe', maxSpeed: 540, accel: 330, turn: 3.0, health: 80 },
  taxi: { name: 'Harbor Taxi', maxSpeed: 400, accel: 250, turn: 2.7, health: 100 },
  van: { name: 'Dock Van', maxSpeed: 340, accel: 200, turn: 2.2, health: 140 },
  truck: { name: 'Port Hauler', maxSpeed: 300, accel: 170, turn: 1.9, health: 180 },
  police: { name: 'Solano PD Interceptor', maxSpeed: 560, accel: 360, turn: 3.1, health: 160 },
  // The street fleet — new models traffic and parked cars draw from.
  // Each has a distinct job in the city: the Comet is the fastest
  // civilian car (a prize steal), the Bison is a heavy muscle car that
  // shoves traffic aside, the Regal is slow but armored, and the Dune
  // Runner is the beach pickup that shrugs off curb hits.
  sports: { name: 'Comet GT', maxSpeed: 580, accel: 380, turn: 3.3, health: 70 },
  muscle: { name: 'Bison GT', maxSpeed: 480, accel: 300, turn: 2.5, health: 150 },
  limo: { name: 'Regal Limo', maxSpeed: 360, accel: 210, turn: 2.0, health: 200 },
  pickup: { name: 'Dune Runner', maxSpeed: 440, accel: 290, turn: 2.8, health: 130 },
  // The open-top pair: the Spyder is a fair-weather show car (fast,
  // fragile, worth more than a Comet to a chop shop), and the Hatch is
  // the city's anonymous runabout — slow, common, and the car nobody
  // looks twice at, which is exactly why it is the getaway of choice
  // for jobs that need to disappear.
  convertible: { name: 'Sunset Spyder', maxSpeed: 560, accel: 360, turn: 3.2, health: 60 },
  hatchback: { name: 'City Hatch', maxSpeed: 400, accel: 270, turn: 2.9, health: 90 },
};

export const CAR = { length: 56, width: 28, radius: 24 };

export const TRAFFIC = { cars: 14, cruiseMin: 130, cruiseMax: 210, turnChance: 0.35 };
export const PEDS = { count: 26, walkMin: 40, walkMax: 80, fleeSpeed: 200 };

export const COPS = {
  /** Police cars per wanted star, capped by maxCars. */
  perStar: 1,
  maxCars: 5,
  spawnDistance: 750,
  ramDamage: 8,
  sirenRange: 900,
};

export const WANTED = {
  max: 5,
  /** Heat points per wanted star; stars = floor(heat / heatPerStar). */
  heatPerStar: 20,
  /** Crime costs, in stars (fractional allowed — heat is continuous). */
  stealCar: 1.0,
  shoot: 0.6,
  hitPed: 1.0,
  killPed: 2.0,
  killCop: 2.0,
  /** Heat lost per second once the cops have lost sight of the player. */
  decay: 6,
  /** Seconds unseen before heat starts decaying. */
  quietSeconds: 5,
};

export const MISSIONS = {
  reward: 500,
  waypointRadius: 70,
  pickupSeconds: 3,
  count: 6,
};

export const CAMERA = { lerp: 6, shakeDecay: 26, maxShake: 14 };

/** New-game starting cash, and the fines for getting caught or going down. */
export const GAME = {
  startMoney: 250,
  bustedFine: 150,
  wastedFine: 100,
  /** Seconds the real simulation runs before the first ?shot= frame is painted. */
  shotSettleSeconds: 2,
};

/** Sun-soaked Port Solano palette: warm asphalt, sand, teal harbour water. */
export const PALETTE = {
  backdrop: '#0e1a24',
  sky: '#ffd9a0',
  ground: '#c9b18a',
  groundAlt: '#bfa87e',
  grass: '#5da24a',
  grassDark: '#4a8a3c',
  water: '#1f7fa8',
  waterDeep: '#14607f',
  beach: '#e8d5a8',
  road: '#3d3a38',
  roadEdge: '#2c2a29',
  sidewalk: '#b7a98d',
  lane: '#f2d06b',
  crosswalk: '#e8e4da',
  buildingRoof: '#8a6f5c',
  pier: '#7a5a3a',
  pierPost: '#5d4429',
  player: '#ffcf3f',
  playerDark: '#c79a1d',
  pedSkin: '#e8b98a',
  cop: '#20242e',
  copWhite: '#f2f2ee',
  copLightRed: '#ff3b30',
  copLightBlue: '#2f7bff',
  bullet: '#ffe066',
  muzzle: '#ffb347',
  blood: '#a01818',
  dust: '#d8cbb0',
  text: '#f5f1e6',
  muted: '#cbbf9f',
  panel: 'rgba(16, 24, 32, 0.88)',
  panelBorder: '#f2c94c',
  gold: '#f2c94c',
  red: '#e5534b',
  green: '#58b368',
  minimapBg: 'rgba(12, 20, 26, 0.82)',
  minimapRoad: '#8a8378',
  minimapWater: '#1f7fa8',
  waypoint: '#ffcf3f',
};

/** Building paint colours, picked per building from the seeded world gen. */
export const BUILDING_COLORS = [
  '#d9a06b', '#c98d7a', '#a8b8c4', '#b5a06a', '#9fb08a',
  '#c4b49a', '#8fa8b8', '#d08a5a', '#7fa08a', '#b08a9a',
  '#e0c080', '#6a8a9a', '#c47a6a', '#a08a6a',
];

/** Avenue / street names shown on the road surface. */
export const AVENUE_NAMES = [
  'Marina Ave', 'Coral St', 'Palm Blvd', 'Harbor Rd',
  'Solano Ave', 'Cactus Ln', 'Bayview Dr', 'Pier St',
];
export const STREET_NAMES = [
  'Sunset Way', 'Gull St', 'Trade Row', 'Orange Ave', 'Dune St', 'Ferry Rd',
];

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where a save is kept between visits (this browser only). Same key as save.js. */
export const SAVE_KEY = 'portsolano-save-v1';
export const BEST_KEY = 'port-solano.best.v1';

/** Story facts, all original: no Rockstar names, characters or places anywhere. */
export const STORY = {
  city: 'Port Solano',
  hero: 'Rook',
  contact: 'Delia Maren',
  fixer: 'Old Sal',
};

// --- Day / night -----------------------------------------------------------
// timeOfDay is 0..1 around a 24 h clock: 0 = midnight, 0.25 = 06:00,
// 0.5 = noon, 0.75 = 18:00. A full day is DAY_LENGTH seconds of game
// time, so a normal session sees dawn, noon, dusk and night. Night is
// visual only (dark overlay, headlights, lit windows) — it never changes
// grip, spawns or cop behaviour, so a mission that runs long does not
// get harder just because the sun went down.
export const DAYNIGHT = {
  dayLength: 1200,
  /** timeOfDay at a fresh game: noon, the sun-soaked default. */
  startTime: 0.5,
  /** Darkness 0..1 at the four anchors; render interpolates between them. */
  darknessAt: { midnight: 0.82, dawn: 0.25, noon: 0, dusk: 0.3 },
  /** Headlights come on when darkness passes this. */
  headlightDarkness: 0.45,
  /** Clock anchors (timeOfDay) for the named phases. */
  dawn: 0.22,
  day: 0.3,
  dusk: 0.68,
  night: 0.78,
};

// --- Weather ---------------------------------------------------------------
// Rain is the only weather with a gameplay effect: wet asphalt, grip
// 0.85 (accel and steering both scale by it). Weather only ever
// CHANGES in free roam (no story mission active): a mission that starts
// in the dry stays dry, so the campaign is never re-rolled by a storm
// halfway through Heat Wave. A fresh game starts clear.
export const WEATHER = {
  types: ['clear', 'clear', 'clear', 'overcast', 'rain', 'storm'],
  /** Seconds of free-roam time between weather rolls. */
  rollEvery: 90,
  /** Chance a roll picks rain or storm instead of clear/overcast. */
  rainChance: 0.25,
  /** Grip multiplier while it rains (storm counts as rain). */
  rainGrip: 0.85,
  /** Rain streaks per second while raining (cosmetic, capped by particles). */
  rainRate: 90,
  /** Lightning flash every ~this many seconds during a storm. */
  stormFlashEvery: 14,
};

// --- Radio -----------------------------------------------------------------
// Six procedural stations. The music scheduler (audio.js) reads the
// station's bpm / scale / waveform, so switching stations changes what
// actually plays, not just the label. N cycles; M still toggles music.
// Bay Classical is the slow one (60 bpm, a low sine root) — the station
// for driving home at 3 a.m. with the wanted stars off and the rain on.
export const RADIO_STATIONS = [
  { id: 'solano-fm', name: 'Solano FM', tag: 'Harbour pop', bpm: 112, wave: 'triangle', root: 110, scale: [0, 2, 4, 7, 9], bass: [0, 0, 7, 5] },
  { id: 'dune-drive', name: 'Dune Drive', tag: 'Desert rock', bpm: 132, wave: 'sawtooth', root: 98, scale: [0, 3, 5, 7, 10], bass: [0, 0, 3, 7] },
  { id: 'midnight-bay', name: 'Midnight Bay', tag: 'Late-night jazz', bpm: 84, wave: 'sine', root: 87.31, scale: [0, 3, 5, 6, 10], bass: [0, 5, 3, 7] },
  { id: 'kings-rap', name: 'Kings Radio', tag: 'Street rap', bpm: 96, wave: 'square', root: 103.83, scale: [0, 0, 3, 7, 10], bass: [0, 0, 0, 7] },
  { id: 'static-88', name: 'Static 88', tag: 'Lo-fi haze', bpm: 72, wave: 'sine', root: 130.81, scale: [0, 2, 3, 7, 8], bass: [0, 7, 5, 3] },
  { id: 'bay-classical', name: 'Bay Classical', tag: 'Slow strings', bpm: 60, wave: 'sine', root: 65.41, scale: [0, 4, 7, 11], bass: [0, 7, 4, 0] },
  // The second wave: Pier Country is the harbour's own station (fiddles
  // and a walking bass, for the drive home along the water), and Neon
  // Nights is the Strip at 2 a.m. — synthwave, fast, a little too loud.
  // Both read through the same scheduler as the first six, so N cycles
  // eight stations now and the save's radio index clamps to 0..7.
  { id: 'pier-country', name: 'Pier Country', tag: 'Harbour country', bpm: 104, wave: 'triangle', root: 98, scale: [0, 2, 4, 7, 9], bass: [0, 5, 0, 7] },
  { id: 'neon-nights', name: 'Neon Nights', tag: 'Synthwave', bpm: 118, wave: 'sawtooth', root: 116.54, scale: [0, 2, 3, 7, 10], bass: [0, 0, 3, 10] },
];

// --- Side jobs -------------------------------------------------------------
// Taxi fares and delivery gigs between story missions: data-driven, so a
// new job type is a row in this table plus a runner in missions.js —
// no hand-scripted per-job code. Jobs only exist in free roam; starting
// a story mission cancels the active job (no pay, no penalty).
export const SIDE_JOBS = {
  /** Offers kept on the board at once (free roam only). */
  offers: 3,
  /** Seconds between offer refreshes while in free roam. */
  offerEvery: 45,
  taxi: {
    base: 25,
    perMetre: 0.02,
    /** Tip for finishing with more than this fraction of the timer left. */
    tipFast: 15,
    tipFastFrac: 0.4,
    /** A passenger bails the moment the player has any wanted stars. */
    bailWanted: 0,
    /** Seconds allowed per 100 px of trip, plus this base. */
    secondsPer100px: 0.55,
    timeBase: 25,
  },
  delivery: {
    base: 30,
    perMetre: 0.015,
    /** Payout lost per point of car damage taken during the run. */
    damagePenalty: 0.5,
    secondsPer100px: 0.5,
    timeBase: 30,
  },
  getaway: {
    base: 60,
    perMetre: 0.03,
    /** The client bails the moment the heat passes this many stars. */
    maxWanted: 1,
    /** Clean-getaway bonus for finishing with zero wanted stars. */
    cleanBonus: 20,
    secondsPer100px: 0.45,
    timeBase: 20,
  },
  // Courier: no passenger, no car required — a sealed package, on foot
  // or by car, from a pickup point to a drop point. The pay is lower
  // than a getaway because there is nobody in the car to protect, but
  // there is also nobody to bail: a courier run never fails on wanted
  // stars, only on the timer. It is the job for a player who is already
  // hot and still wants to earn.
  courier: {
    base: 35,
    perMetre: 0.02,
    /** A courier run has no passenger, so no bail rule and no tip. */
    secondsPer100px: 0.5,
    timeBase: 30,
  },
  // Valet: a rich client hands you the keys to a car they own and wants
  // it parked across town — the job is a taxi fare where the passenger
  // is the car. It needs a car (the client's, waiting at the pickup),
  // it pays for discretion (no tip, no bail — the client is not in it),
  // and it is the only job where the pickup IS the vehicle.
  valet: {
    base: 40,
    perMetre: 0.02,
    secondsPer100px: 0.5,
    timeBase: 25,
  },
  // Medic: a clinic's supplies, on foot or by car, to a drop point
  // across town. Like a courier it never bails on wanted stars — the
  // supplies do not care who carries them — but it pays better, because
  // the timer is tighter and the cargo is fragile: every dent costs.
  medic: {
    base: 45,
    perMetre: 0.025,
    secondsPer100px: 0.45,
    timeBase: 25,
  },
};

// --- Ped variety -----------------------------------------------------------
// Kinds of people on the sidewalks. A kind sets the walk-speed multiplier,
// the shirt palette and the bark pool; the kind is assigned at spawn and
// never changes, so the same ped reads as the same person all day.
export const PED_TYPES = [
  // speedMul stays in a narrow 0.85–1.15 band on purpose: the variety
  // is visual (shirts, barks, the render details), not a balance
  // change. A ped that crosses at half speed spends twice as long in
  // the road, and the campaign's driving was tuned against the old
  // crossing times — a slow elder on a crosswalk during the M4 escape
  // is a wanted star the player never chose to earn.
  { id: 'commuter', name: 'Commuter', speedMul: 1.0, shirts: ['#e74c3c', '#3498db', '#636e72', '#2ecc71'], barkChance: 0.05 },
  { id: 'tourist', name: 'Tourist', speedMul: 0.9, shirts: ['#f39c12', '#fd79a8', '#ecf0f1', '#00cec9'], barkChance: 0.16 },
  { id: 'jogger', name: 'Jogger', speedMul: 1.15, shirts: ['#1abc9c', '#e67e22', '#00b894'], barkChance: 0.08 },
  { id: 'worker', name: 'Dock Worker', speedMul: 0.95, shirts: ['#fdcb6e', '#d63031', '#6c5ce7'], barkChance: 0.1 },
  { id: 'elder', name: 'Old-timer', speedMul: 0.85, shirts: ['#9b59b6', '#bfa87e', '#8fa8b8'], barkChance: 0.2 },
  { id: 'kid', name: 'Street Kid', speedMul: 1.1, shirts: ['#00cec9', '#fd79a8', '#fdcb6e'], barkChance: 0.22 },
  // The second wave: a fisherman who walks the marina in the early
  // morning (slow, patient, the only ped who never runs from a siren)
  // and a dealer who walks the Strip at night (fast, nervous, always
  // looking over his shoulder). Both draw from the same bark pools —
  // the variety is in the walk, the shirt and the hour, not a new
  // system — and both keep the 0.85–1.15 speed band, so no crossing
  // time changes and the campaign's driving stays tuned.
  { id: 'fisherman', name: 'Fisherman', speedMul: 0.85, shirts: ['#2e6b4f', '#7a8a99', '#c9b458'], barkChance: 0.12 },
  { id: 'dealer', name: 'Dealer', speedMul: 1.12, shirts: ['#1c1c22', '#5a2e6b', '#8a1f1f'], barkChance: 0.18 },
];

// --- Dialogue barks --------------------------------------------------------
// One-liners peds say (as floating text) when something happens near
// them, and lines the Harbor Kings gunmen throw at the player in a
// fight. All original; nobody in Port Solano quotes another game.
export const BARKS = {
  // A bark pool is a voice, not a list: each kind of ped draws from
  // its own lines, and the pool is deep enough that the same ped does
  // not repeat itself twice in one walk. The near-miss lines are the
  // ones the player hears most (every fast pass is a near-miss), so
  // that pool is the deepest; the gunman lines are the shortest pool
  // because a gunman only gets one taunt before the shooting starts.
  nearMiss: [
    'Hey! Watch it!', 'Whoa — my toes!', 'You call that driving?',
    'Outta the way!', 'I almost died!', 'Learn to drive, pal!',
    'My shopping!', 'You missed me by an inch!', 'Slow down, maniac!',
    'This is a sidewalk!', 'I had the light!', 'Are you blind?!',
    'My groceries are everywhere!', 'You drive like my ex!',
    'That was my favourite hat!', 'One more inch and I sue!',
  ],
  crime: [
    'He\'s got a gun!', 'Somebody call the cops!', 'Run!',
    'Did you see that?!', 'Not again…', 'I\'m outta here!',
    'It\'s the Kings again!', 'Don\'t shoot!', 'Everybody down!',
    'Call 911!', 'I saw nothing, I swear!', 'Not my business!',
  ],
  greeting: [
    'Nice day, huh?', 'Morning.', 'You seen Delia?',
    'Harbour\'s calm today.', 'Hot one.', 'Evening.',
    'You from around here?', 'The fish market\'s busy today.',
    'Rook, is that you?', 'Nice car.', 'Watch the rain later.',
    'Quiet night, for once.',
  ],
  taxi: [
    'Over here! Taxi!', 'Need a ride, friend?', 'To the hotel, quick!',
    'I\'m late — step on it!', 'Marina, please.',
    'Airport? No — the docks.', 'Double fare if you hurry!',
    'My shift starts in ten!', 'Take the back streets!',
    'The pier, and don\'t stop for anyone!', 'Motel on the east side.',
    'I tip well if you\'re quick!', 'The bank — I\'m in a rush!',
  ],
  gunman: [
    'There he is!', 'Kings own this block!', 'Get him!',
    'You picked the wrong warehouse, Rook!', 'Sal sends his regards!',
    'He\'s alone — rush him!', 'Don\'t let him reload!',
    'For the Kings!', 'Sal wants him breathing. Mostly.',
    'Flank him! Flank him!', 'He can\'t hit all of us!',
    'The boss is watching — make it count!',
  ],
  cop: [
    'Stop right there!', 'Solano PD — hands up!', 'You\'re done, Rook!',
    'Freeze!', 'Not so fast!',
    'Hands where I can see them!', 'Solano PD, pull over!',
    'You can run, Rook. You can\'t hide.', 'Backup, backup!',
    'Drop the weapon!', 'This ends now.',
  ],
  // The courier's lines: the package changes hands with a word, not a
  // handshake, and the word is always the same — the drop is clean
  // when nobody stops to talk.
  courier: [
    'Package for you. No questions.', 'Sign here. Don\'t open it.',
    'It\'s light. That worries me.', 'The boss says thanks.',
    'Next one\'s already waiting.', 'Handle with care, huh?',
    'This one goes to the docks. Don\'t be late.',
    'Sealed means sealed. You didn\'t see inside.',
    'The client pays in cash. Count it later.',
    'Rain or shine, the package moves.',
  ],
  // What the street-race crowd shouts at the start line: the race is
  // the city's loudest minute, and the crowd is its loudest voice.
  race: [
    'Three! Two! One! GO!', 'My money\'s on the Comet!',
    'Don\'t clip the kerb!', 'That Spyder is fast, man!',
    'First to the pier wins!', 'No brakes, no mercy!',
    'The Kings never lose a race!', 'Watch the hairpin!',
  ],
  // What the street says when the player walks past with the heat on:
  // fear, mostly, and the occasional idiot who thinks a wanted man is
  // a celebrity.
  wanted: [
    'That\'s him! That\'s Rook!', 'Stay away from me!',
    'The cops are coming, run!', 'I knew that guy was trouble.',
    'Five stars? You\'re crazy, man.', 'Not my problem. Not my problem.',
    'He robbed the bank on the news!', 'Don\'t look at him, don\'t look.',
    'My cousin saw him drive through a roadblock once.',
    'Is that a gun? That\'s a gun. Run.',
  ],
  // What peds say when the rain starts: Port Solano rain is sudden,
  // and nobody carries an umbrella — the city just gets wet together.
  rain: [
    'Rain again! My hair!', 'Great, soaked.', 'Where did this come from?',
    'I\'m getting out of this.', 'The harbour rain is the worst.',
    'At least the streets wash clean.', 'My shoes are ruined!',
    'Rain in Solano — means the Kings stay home. Small mercies.',
  ],
  // What the street says when a bounty is collected: the PD looks the
  // other way, the Kings look over their shoulders, and the corner
  // stores talk about it for a week. The crowd cheers a hunter the
  // way it never cheers a thief.
  bounty: [
    'Did you see that? Rook got another one!', 'The Kings are scared now!',
    'That\'s a bounty hunter, that is!', 'Sal\'s men are dropping like flies!',
    'Rook! Over here — buy you a drink?', 'The PD owes that man a favour.',
    'Another King down. The docks breathe a little easier tonight.',
    'I heard the bounty was five hundred. Worth every cent.',
  ],
  // What the street says when Rook buys a place: a garage is a roof,
  // and a roof in Port Solano means you are staying — which, for a
  // man the PD knows by name, is either brave or stupid.
  garage: [
    'Rook bought the lockup? Good for him.', 'A garage of his own, huh?',
    'He\'s putting down roots. Bold, for a wanted man.',
    'I hear the villa has a view of the whole harbour.',
    'A warehouse on the docks — that\'s a lot of room for a lot of cars.',
    'He parks there now. Don\'t scratch anything.',
  ],
  // What the street says when the city notices Rook is not a nobody
  // any more: the achievement lines are the city's voice, not the
  // game's — a title is only real when someone else says it.
  achievement: [
    'That\'s Rook. You\'ve heard the stories, right?',
    'They say he outran five stars once. Five!',
    'Delia vouches for him. That means something.',
    'The Kings check the street before they walk it now.',
    'He\'s a legend already, and he\'s only just started.',
    'My cousin saw him take the bank. The whole bank!',
  ],
  // The near-miss pool, second wave: the player hears these most (every
  // fast pass is a near-miss), so the pool stays the deepest — a ped
  // who repeats himself twice in one walk is a bug, not a voice.
  nearMiss2: [
    'My dog! You nearly hit my dog!', 'I was crossing here!',
    'You drive like the Kings are after you!', 'Oh, come ON!',
    'That\'s the third time today!', 'My hat! My good hat!',
    'I\'m telling Delia about this!', 'Watch where you\'re going, Rook!',
  ],
  // What the cops shout when the chase is on its last legs: the heat
  // is falling, the tail is losing them, and the PD knows it.
  copChase: [
    'He\'s getting away!', 'Cut him off at the next avenue!',
    'I lost visual — repeat, lost visual!', 'Don\'t let him reach the docks!',
    'He\'s too fast for these interceptors!',
    'All units, he\'s heading for the marina!',
  ],
  // What the fare says when the taxi ride is smooth: the passenger
  // relaxes, the meter runs, and the tip gets bigger.
  taxiHappy: [
    'Smooth ride, friend.', 'You know these streets well.',
    'This is the fastest I\'ve ever crossed town.',
    'Keep this up and I\'ll ride with you every day.',
    'The marina by sunset, please. No rush at all.',
    'You drive like you own the road. I like it.',
  ],
};

// --- Districts -----------------------------------------------------------
// One line per district, shown when the player crosses into it. The
// line is the district's character in a sentence: the Park is green
// and quiet, the Docks are loud and dangerous, the Strip is where the
// money is. The HUD shows the line once per entry, not every frame.
export const DISTRICT_INFO = {
  'The Park': 'Green lawns, joggers, and the only quiet in Port Solano.',
  'Marina': 'Yachts, gulls, and the pier where Delia\'s packages land.',
  'Docks': 'Cranes, containers, and men who do not ask questions.',
  'Old Town': 'Brick, bells, and the oldest bars in the city.',
  'Harbor Heights': 'Old money on the hill, looking down at the harbour.',
  'Downtown': 'Glass towers, traffic, and the bank that holds Sal\'s money.',
  'Westside': 'Row houses, corner stores, and kids on bikes.',
  'The Strip': 'Neon, noise, and the clubs that never close.',
  'Northside': 'Warehouses, rail yards, and the Kings\' home turf.',
  'The Harbour': 'The water\'s edge — boats, fog, and the smell of salt.',
};

// --- Reputation ------------------------------------------------------------
// What the street calls Rook, by how much he has earned. Rep is the
// career total of money earned (missions plus side jobs plus events):
// it never goes down, it is never spent, and it is the number the
// stats screen leads with. The titles are the city's voice — a Nobody
// is invisible, a Legend is a story mothers tell their kids.
export const REP_TITLES = [
  { at: 0, title: 'Nobody', line: 'Nobody in Port Solano knows your name yet.' },
  { at: 1000, title: 'Known', line: 'The corner stores know your face.' },
  { at: 3000, title: 'Respected', line: 'Delia vouches for you. That means something.' },
  { at: 6000, title: 'Feared', line: 'The Kings check the street before they walk it.' },
  { at: 10000, title: 'Legend', line: 'They will tell stories about Rook long after he leaves.' },
];

// --- Street events ---------------------------------------------------------
// Random trouble that finds the player in free roam: one event at a
// time, on a timer, never during a story mission. Each row is the whole
// event — its kind (the engine in missions.js reads the kind), its
// payout, its time limit, and the line the HUD shows when it appears.
// A shootout is a fight, a stolen car is a steal-and-deliver, a race
// is checkpoints against the clock. The event pays on completion and
// vanishes on failure; there is no penalty beyond the lost payout.
export const STREET_EVENTS = {
  /** Seconds between event rolls while in free roam. */
  rollEvery: 75,
  /** Chance an event actually spawns on a roll. */
  rollChance: 0.6,
  kinds: [
    { id: 'shootout', name: 'Gang shootout', payout: 150, timeLimit: 90, enemies: 3, line: 'Kings are shooting up the block — clear them out.' },
    { id: 'stolen-car', name: 'Stolen car', payout: 200, timeLimit: 120, line: 'A stolen Comet GT is parked nearby — take it to the chop shop.' },
    { id: 'race', name: 'Street race', payout: 250, timeLimit: 75, checkpoints: 3, line: 'A street race is forming — hit every checkpoint, beat the clock.' },
    { id: 'mugging', name: 'Mugging', payout: 100, timeLimit: 60, line: 'A mugger is working the corner — stop him.' },
    // A hitman is one man, not a gang: he spawns close, he hunts the
    // player (not a spot on the map), and the event ends when he is
    // down. The payout is high because there is no gang to split the
    // attention — it is one gun, and it is aimed at Rook.
    { id: 'hitman', name: 'Hitman', payout: 300, timeLimit: 90, enemies: 1, line: 'Sal sent a hitman. He is close. Drop him.' },
    // A package rush is a courier run with a clock and a stranger's
    // money on it: pick the package up at the marker, deliver it to
    // the drop point, and do not stop for anything. It pays like a
    // getaway because the timer is the whole job.
    { id: 'package-rush', name: 'Package rush', payout: 180, timeLimit: 100, line: 'A sealed package, a ticking clock — run it across town.' },
    // An ambush is a shootout with no warning and no victim: two Kings
    // step out of an alley and open fire. The payout is higher than a
    // shootout's because there is no crowd to hide behind — it is two
    // guns, and both of them are aimed at Rook.
    { id: 'ambush', name: 'Ambush', payout: 220, timeLimit: 90, enemies: 2, line: 'Kings stepped out of the alley — two gunmen, no warning.' },
    // A joyride is a race with a dare attached: four checkpoints, a
    // faster clock than a street race, and a crowd that laughs if you
    // miss one. The engine is the race engine (checkpoints in order),
    // the stakes are the joyride's — it pays like a race because the
    // timer is the whole job.
    { id: 'joyride', name: 'Joyride', payout: 200, timeLimit: 90, checkpoints: 4, line: 'A joyride crew dares you — four checkpoints, beat the clock.' },
    // A rescue is a mugging where the victim matters: the gunman is
    // working a tourist at the corner, and the event ends when the
    // gunman is down — the victim walks away, the city remembers.
    { id: 'rescue', name: 'Rescue', payout: 150, timeLimit: 75, line: 'A tourist is being mugged at the corner — save them.' },
    // A street fight is a shootout without the guns: two Kings with
    // fists and bats, blocking the corner. The payout is lower than an
    // ambush's because there is no gunfire — but a bat still hurts,
    // and the fight is the same engine, counting bodies.
    { id: 'street-fight', name: 'Street fight', payout: 170, timeLimit: 75, enemies: 2, line: 'Two Kings are working a corner over with bats — break it up.' },
    // A car theft is a stolen-car event with a different prize: a
    // coupe instead of a Comet GT, blue instead of red, and the same
    // chop shop at the end of it. The engine is the stolen-car engine
    // (steal it, drive it to the shop); only the car changes.
    { id: 'car-theft', name: 'Car theft', payout: 220, timeLimit: 120, line: 'A blue coupe is sitting with the keys in it — take it to the chop shop.' },
    // A taxi race is a street race in a cab: three checkpoints, a
    // tighter clock, and a fare that pays like a race because the
    // timer is the whole job. The engine is the race engine; the cab
    // is the joke, and the joke pays.
    { id: 'taxi-race', name: 'Taxi race', payout: 230, timeLimit: 75, checkpoints: 3, line: 'A cabbie dares you to a race — three checkpoints, beat the clock.' },
  ],
};

// --- Most Wanted bounty board -------------------------------------------
// The PD's quiet answer to the Harbor Kings: six named targets with a
// price on each head, posted on the board at Delia's diner and in the
// HUD tracker. A bounty is a hunt, not a mission — it lives in free
// roam, it pays the moment the target is down, and turning one in
// clears a star of heat (the PD looks the other way for a hunter who
// just did their job). `enemies` is how many gunmen guard the target;
// the target himself is the first of them.
export const BOUNTIES = {
  /** Offers kept on the board at once (free roam only). */
  offers: 3,
  /** Seconds between board refreshes while in free roam. */
  offerEvery: 60,
  targets: [
    { id: 'vic-kane', name: 'Vic "The Hammer" Kane', alias: 'The Hammer', payout: 400, enemies: 2, district: 'Docks', line: 'Kane runs the Kings\' dock crews. Two guards, no mercy.' },
    { id: 'lena-cross', name: 'Lena Cross', alias: 'The Widow', payout: 350, enemies: 1, district: 'Northside', line: 'Cross plans the Kings\' hits. She works alone — and fast.' },
    { id: 'eddie-marsh', name: 'Big Eddie Marsh', alias: 'Big Eddie', payout: 500, enemies: 2, district: 'Downtown', line: 'Marsh collects for Sal. Bring him down and the docks breathe.' },
    { id: 'tomas-rivas', name: 'Tomas "Ghost" Rivas', alias: 'The Ghost', payout: 600, enemies: 2, district: 'Old Town', line: 'Rivas is never where you look. Two men watch his back.' },
    { id: 'darla-vane', name: 'Darla Vane', alias: 'Darla', payout: 450, enemies: 1, district: 'The Strip', line: 'Vane runs the Strip\'s back rooms. One guard, a short fuse.' },
    { id: 'oscar-boone', name: 'Oscar "Fingers" Boone', alias: 'Fingers', payout: 300, enemies: 1, district: 'Westside', line: 'Boone lifts cars for the Kings. The easiest money on the board.' },
  ],
};

// --- Achievements ----------------------------------------------------------
// Sixteen career milestones, each with a title and the line the city
// says when Rook earns it. The `test` is a key into the predicate map
// in player.js (checkAchievements) — the data says WHAT, the code says
// HOW, so a new milestone is a row, not a new system. Unlocks are
// permanent, saved with the career, and shown on the stats screen.
export const ACHIEVEMENTS = [
  { id: 'first-job', title: 'Back in Business', test: 'missionsDone1', line: 'One job done. Delia is watching, Rook.' },
  { id: 'first-grand', title: 'First Grand', test: 'earned1000', line: 'A thousand dollars earned in Port Solano.' },
  { id: 'wheelman', title: 'Wheelman', test: 'topSpeed500', line: 'Five hundred pixels a second. The city blurs.' },
  { id: 'car-thief', title: 'Car Thief', test: 'carsStolen5', line: 'Five cars borrowed. Permanently.' },
  { id: 'trigger-happy', title: 'Trigger Happy', test: 'shotsFired50', line: 'Fifty rounds downrange. The harbour heard every one.' },
  { id: 'gangbuster', title: 'Gangbuster', test: 'kills10', line: 'Ten Kings down. Sal knows your name now.' },
  { id: 'fare-master', title: 'Fare Master', test: 'jobsDone10', line: 'Ten side jobs, no complaints. The board loves you.' },
  { id: 'streak-3', title: 'On a Roll', test: 'streak3', line: 'Three jobs in a row. The streak pays, and so do you.' },
  { id: 'bounty-hunter', title: 'Bounty Hunter', test: 'bountiesDone1', line: 'First bounty collected. The PD looks the other way.' },
  { id: 'homeowner', title: 'Homeowner', test: 'garagesOwned1', line: 'A roof of your own in Port Solano. It has a garage.' },
  { id: 'clean-escape', title: 'Clean Escape', test: 'escapes3', line: 'Three arrests escaped. The PD hates you for it.' },
  { id: 'night-owl', title: 'Night Owl', test: 'timePlayed600', line: 'Ten minutes in the city. The nights are yours.' },
  { id: 'lifer', title: 'Lifer', test: 'timePlayed1800', line: 'Thirty minutes in Port Solano. You live here now.' },
  { id: 'survivor', title: 'Survivor', test: 'missionsDone4', line: 'Four story jobs done. Heat Wave was the hard one.' },
  { id: 'legend', title: 'Legend in the Making', test: 'earned10000', line: 'Ten thousand earned. The street tells stories about you.' },
  { id: 'all-jobs', title: 'King of Port Solano', test: 'missionsDone6', line: 'Every job done. The Big Score was just the beginning.' },
];

// --- Garages and safehouses ------------------------------------------------
// Four places Rook can own. Buying one costs cash, makes it the respawn
// home (busted or wasted, Rook wakes up there instead of the marina),
// and throws in a free repair of whatever he is driving — a garage
// that cannot fix a car is just a parking space. Prices are the whole
// point: the lockup is a first purchase, the villa is an endgame one.
export const GARAGES = [
  { id: 'marina-lockup', name: 'Marina Lockup', price: 800, x: 3000, y: 200, line: 'A lockup by the marina. Small, dry, yours.' },
  { id: 'downtown-garage', name: 'Downtown Garage', price: 2000, x: 1400, y: 1000, line: 'A garage under the bank district. Central, and quiet.' },
  { id: 'docks-warehouse', name: 'Docks Warehouse', price: 3500, x: 3000, y: 2200, line: 'A warehouse on the docks. Room for everything you steal.' },
  { id: 'hilltop-villa', name: 'Hilltop Villa', price: 6000, x: 2600, y: 600, line: 'A villa above the harbour. The whole city below you.' },
];

// --- Landmarks and the city guide ------------------------------------------
// Twelve places worth knowing, each with the line a local would give
// you. The guide panel (G key) lists the landmarks of the district
// Rook is standing in; the minimap and the HUD banner already name
// the district, and this is the rest of the tour. Coordinates are the
// named places the missions already use, so the guide never points
// at an empty block.
export const LANDMARKS = [
  { name: "Delia's Diner", district: 'Downtown', x: 600, y: 600, line: 'Where every job starts. Delia Maren holds court at the corner booth.' },
  { name: 'Marina Pier', district: 'Marina', x: 732, y: 2140, line: 'The pier where packages come in with the tide — and where M1 begins.' },
  { name: 'Solano Arms Hotel', district: 'Harbor Heights', x: 2600, y: 600, line: 'The grand hotel on the hill. Deliveries go to the back door.' },
  { name: 'Solano Trust Bank', district: 'Downtown', x: 1400, y: 1000, line: 'The bank that holds Sal\'s money. The Big Score\'s front door.' },
  { name: 'The Chop Shop', district: 'Docks', x: 200, y: 2200, line: 'Where stolen cars become cash. No questions, no receipts.' },
  { name: 'The Safehouse', district: 'Westside', x: 200, y: 600, line: 'Rook\'s bolt-hole. The Big Score ends here, if he makes it.' },
  { name: 'North Motel', district: 'Northside', x: 1400, y: 200, line: 'Ninety seconds from the diner, if you know the streets. The Drop ends here.' },
  { name: 'The Warehouse', district: 'Northside', x: 2200, y: 1800, line: 'The Kings\' warehouse. Six gunmen, one payback.' },
  { name: 'The Park Bandstand', district: 'The Park', x: 1600, y: 1200, line: 'The only quiet in Port Solano. Joggers, ducks, no Kings.' },
  { name: 'Docks Crane Yard', district: 'Docks', x: 2800, y: 2000, line: 'Cranes, containers, and men who do not ask questions.' },
  { name: 'The Strip', district: 'The Strip', x: 2200, y: 600, line: 'Neon, noise, and the clubs that never close.' },
  { name: 'Old Town Bells', district: 'Old Town', x: 600, y: 1800, line: 'Brick, bells, and the oldest bars in the city.' },
];

// --- Tips ------------------------------------------------------------------
// One line of advice per load, shown on the title screen. The tips
// are the game's manual in one-liners: they teach the E key, the
// reload, the rain, the roadblocks, and the one rule that matters
// (a story mission cancels a side job). A tip is picked by the seed,
// so the same save always shows the same tip — the title screen is
// stable, not a slot machine.
export const TIPS = [
  'Press E to talk, enter a car, or start a job — E does all three.',
  'R reloads the pistol. Do it before the fight, not during it.',
  'Rain cuts your grip by 15%. Brake earlier, turn slower.',
  'At 5 stars the PD sets roadblocks — but only while you crawl.',
  'A story mission cancels your side job. Finish the fare first.',
  'A taxi passenger bails the moment you have any wanted stars.',
  'The getaway client tolerates one star. Two, and he walks.',
  'Deliveries pay less for every dent. Drive like it is yours.',
  'Three side jobs in a row pay a streak bonus. Keep the fares coming.',
  'The Comet GT is the fastest civilian car — and the best steal.',
  'A parked car is a steal. A mission car is a gift. Learn the difference.',
  'Foot cops bust you in 1.5 seconds of contact. Break contact early.',
  'The heat decays after 5 seconds out of sight. Lose the tail, then hide.',
  'Night is visual only — but the headlights are real, and so is the dark.',
  'The chop shop pays for stolen cars. The bank pays for the Big Score.',
  'N cycles the radio. M toggles the music. T opens your career.',
  'A courier run never bails on wanted stars. Hot and broke? Run packages.',
  'Street events pay for trouble. A shootout is $150 of trouble.',
  'A hitman is one gun, not a gang. He spawns close. Drop him first.',
  'The district banner tells you where you are. The Strip is never quiet.',
  'Bay Classical is 60 bpm. Drive home slow when the stars are off.',
  'A traffic jam is five stopped cars. The board will not send a fare through one.',
  'Sparks mean a hard hit. Smoke means a wreck. Learn the difference.',
  'The wanted bar says how close the next star is. Watch it, not the stars.',
  'A race is three checkpoints and a clock. Missing one costs time, not the race.',
  'The hitman spawns close. If you hear the dispatch tone, look behind you.',
  'The beach is sand, not road. Cars bog down on it — on foot is faster.',
  'The pause menu is your career at a glance. P, then read it.',
  'The headline on the stats screen is your rep. Earn $1,000 and it changes.',
  'A job offer says the base pay. The tip, the streak, and the clean bonus are on top.',
  'The race crowd shouts the countdown. Three, two, one — go on one.',
  'A courier package is light until it isn\'t. Don\'t open it.',
  'The clean-in countdown starts when the cops lose you, not when you lose them.',
  // Second wave: the bounty board, the garages, the guide, the new
  // stations and the new jobs — the tips are the manual, and the
  // manual grows with the city.
  'The bounty board pays for Kings. One target, one payout, one less star.',
  'A garage is a respawn home — busted or wasted, you wake up there.',
  'Press G for the city guide. Every district has a landmark worth knowing.',
  'Pier Country is 104 bpm. Neon Nights is the Strip at 2 a.m.',
  'A valet run pays for parking someone else\'s car across town.',
  'A medic run never bails on wanted stars. The supplies don\'t care.',
  'An ambush is two gunmen, no warning. Check the alleys in the Docks.',
  'A joyride is four checkpoints and a faster clock than a street race.',
  'Achievements are permanent — the stats screen shows every one you earn.',
  'The Marina Lockup is $800. The Hilltop Villa is $6,000. Start small.',
];

// Rain intensity labels, by rainAmount (0..1): the HUD clock says
// "Drizzle" or "Downpour", not a number, because nobody in Port
// Solano says "the rainAmount is 0.7".
export const RAIN_LABELS = [
  { at: 0, label: 'Clear' },
  { at: 0.05, label: 'Drizzle' },
  { at: 0.35, label: 'Rain' },
  { at: 0.7, label: 'Downpour' },
];

// --- Police tactics --------------------------------------------------------
// Beyond the plain chase: at 5 stars the PD sets a roadblock (two cars
// parked across the road ahead) — but only while the player is crawling
// (under 200px/s), never during a flat-out escape, so a roadblock is a
// trap for the cornered, not a wall across the getaway. One cop at 5
// stars also tries to cut ahead (pincer) instead of chasing the tail.
export const POLICE_TACTICS = {
  roadblockStars: 5,
  roadblockMaxSpeed: 200,
  roadblockAhead: 600,
  roadblockCars: 2,
  pincerStars: 5,
  pincerMinDist: 800,
  pincerLead: 1.5,
};

// --- Traffic ----------------------------------------------------------------
// Rush hour: 17:00–18:00 and 08:00–09:00 the city has half as many cars
// again on the road. The multiplier only applies in free roam, so a
// story mission never has its traffic re-rolled mid-chase.
export const RUSH_HOUR = {
  morning: { start: 0.33, end: 0.375 },
  evening: { start: 0.708, end: 0.75 },
  multiplier: 1.5,
};

// --- Stats screen ------------------------------------------------------------
// The labels for the stats screen (T key). The numbers come from
// state.stats, which every system writes to as things happen.
export const STAT_LABELS = [
  { key: 'moneyEarned', label: 'Money earned (all time)' },
  { key: 'missionsDone', label: 'Story jobs finished' },
  { key: 'jobsDone', label: 'Side jobs finished' },
  { key: 'jobMoney', label: 'Side-job earnings' },
  { key: 'carsStolen', label: 'Cars stolen' },
  { key: 'arrestsEscaped', label: 'Arrests escaped' },
  { key: 'pedsHit', label: 'Pedestrians hit' },
  { key: 'shotsFired', label: 'Shots fired' },
  { key: 'kills', label: 'Gang members dropped' },
  { key: 'bountiesDone', label: 'Bounties collected' },
  { key: 'bountiesEarned', label: 'Bounty earnings' },
  { key: 'eventsDone', label: 'Street events finished' },
  { key: 'topSpeed', label: 'Top speed (px/s)' },
  { key: 'timePlayed', label: 'Time in Port Solano (s)' },
];

// --- Second-wave dialogue corpora ------------------------------------------
// The city talks, and it talks a lot. These are the voices the HUD and
// the mission tracker read: the DJ patter each station plays between
// songs, the lines Delia, Sal and Rook trade at the diner, the secrets
// each district keeps, the flavour of every car model, the poster text
// for each wanted level, and the things clients say when they hand
// over a job. All original, all Port Solano — nobody here quotes
// another game, another city, or another crew.

// What the DJ says between songs, per station. The badge shows the
// station; the patter is the station's voice, and the audio module
// reads a line when the station changes, so the ear learns which
// station landed before the eye reads the badge.
export const RADIO_DJ_LINES = {
  'solano-fm': [
    'Good morning, Port Solano — the harbour is calm and the traffic is not.',
    'That was the sound of the marina. This is Solano FM, your harbour pop.',
    'If you are driving to the docks, take the avenue. Trust me on this one.',
    'Solano FM — the only station the Kings listen to. Allegedly.',
    'The sun is out, the gulls are loud, and the pier is busy. Stay safe out there.',
  ],
  'dune-drive': [
    'Dune Drive — desert rock for a city that never stops moving.',
    'Turn it up. The Kings hate it when you turn it up.',
    'That guitar was recorded in a garage on the Westside. True story.',
    'Dune Drive: if your engine is not humming along, it is broken.',
    'Next up, a track for everyone stuck behind a roadblock. You know who you are.',
  ],
  'midnight-bay': [
    'Midnight Bay — late-night jazz for the ones still awake.',
    'It is 2 a.m. in Port Solano. The Strip is loud and the harbour is quiet.',
    'This one goes out to the night drivers. You know the roads better than I do.',
    'Midnight Bay: the saxophone is the city, breathing slow.',
    'If you are listening to this, you are not asleep. Neither am I.',
  ],
  'kings-rap': [
    'Kings Radio — the street, on the radio, all day.',
    'That was for the Northside. The Kings run it, and the radio knows it.',
    'Street rap, straight from the docks. No filter, no apologies.',
    'Kings Radio: if you do not like it, change the station. We dare you.',
    'Sal says hello. That is all Sal ever says, really.',
  ],
  'static-88': [
    'Static 88 — lo-fi haze for the long drive home.',
    'The signal is weak on purpose. The haze is the point.',
    'Static 88: the station that sounds like rain on a windshield.',
    'If you can hear the static, you are exactly where you should be.',
    'Lo-fi, low light, low speed. Drive slow. Listen close.',
  ],
  'bay-classical': [
    'Bay Classical — slow strings for a fast city.',
    'This piece is two hundred years old and still faster than the traffic on Harbor Rd.',
    'Bay Classical: the harbour at dawn, in four movements.',
    'If you are driving home at 3 a.m., this is your station. Welcome home.',
    'The strings are slow. The city is not. Enjoy the contrast.',
  ],
  'pier-country': [
    'Pier Country — harbour country, for the folks who work the water.',
    'That fiddle was played on a boat. You can tell by the salt in it.',
    'Pier Country: the marina, the gulls, and a walking bass.',
    'If you are hauling crates at dawn, this one is for you.',
    'Country from the pier, not the prairie. The harbour has its own twang.',
  ],
  'neon-nights': [
    'Neon Nights — synthwave for the Strip at 2 a.m.',
    'The neon is on, the clubs are full, and the night is just starting.',
    'Neon Nights: if your car does not glow, you are not trying.',
    'That synth was recorded in a basement under the Strip. It shows.',
    'Drive fast, listen loud, and do not stop for anyone. Neon Nights.',
  ],
};

// What Delia Maren says at the diner when Rook comes back for work.
// The tracker shows one line per job, so the diner feels like a
// conversation, not a menu — Delia has known Rook since he was a kid,
// and she talks to him like it.
export const DELIA_LINES = [
  'Delia Maren: "Rook. Sit. Eat something before you go getting shot at."',
  'Delia Maren: "The Kings think this city is theirs. It is mine, Rook. Mine."',
  'Delia Maren: "You drive like your father. Fast, and always in the wrong lane."',
  'Delia Maren: "Sal Moretti sends his regards. I send mine back, with interest."',
  'Delia Maren: "A job is a job, Rook. The money spends the same either way."',
  'Delia Maren: "The marina pier at dawn is the prettiest place in this city. Remember that."',
  'Delia Maren: "You look tired. Sleep in the back room if you need to. No charge."',
  'Delia Maren: "The PD came by asking about you. I told them you were fishing."',
  'Delia Maren: "One day you will leave Port Solano, Rook. Not today, though."',
  'Delia Maren: "The coffee is terrible and the pie is worse. Eat anyway."',
  'Delia Maren: "Your mother would be proud, Rook. Do not tell her what you do."',
  'Delia Maren: "The Kings jumped one of my drivers. That is why you are here."',
  'Delia Maren: "I have run this diner for thirty years. I have seen them all come and go."',
  'Delia Maren: "Take the sedan. It is slow, but it has never let me down."',
  'Delia Maren: "The bank job is the big one, Rook. After that, we are done. Maybe."',
  'Delia Maren: "You have a good heart, Rook. It is a terrible thing to have in this city."',
  'Delia Maren: "The harbour fog comes in at night. Drive slow, or do not drive at all."',
  'Delia Maren: "Old Sal vouches for you. That means something. Do not waste it."',
  'Delia Maren: "The Chop Shop pays in cash. Count it before you leave the lot."',
  'Delia Maren: "If the cops stop you, you are a delivery driver. You have the uniform in the back."',
  'Delia Maren: "The Strip is loud tonight. The Kings are celebrating something. Find out what."',
  'Delia Maren: "You brought the package back in one piece. I knew you would."',
  'Delia Maren: "The villa on the hill is for sale, Rook. Dream a little."',
  'Delia Maren: "Eat. Then drive. In that order. Always in that order."',
  'Delia Maren: "The Kings have a new man on the board. The board has a price on him."',
  'Delia Maren: "Your sedan is in the lot. The keys are where they always are."',
  'Delia Maren: "The rain is coming in off the harbour. Take the coupe, not the sedan."',
  'Delia Maren: "Sal called. He never calls. Whatever it is, it is big."',
  'Delia Maren: "The Strip is quiet tonight. Quiet is worse than loud, Rook."',
  'Delia Maren: "A customer left a map of the docks. It is yours if you want it."',
  'Delia Maren: "The villa has a for-sale sign again. Third time this year."',
  'Delia Maren: "The PD towed a Comet GT from the marina. Shame. It was a beauty."',
  'Delia Maren: "You have flour on your shirt, Rook. The pie is not a disguise."',
  'Delia Maren: "The harbour fog will be thick tonight. Drive by memory, not by sight."',
];

// What Old Sal says when his name comes up. Sal is the fixer who has
// been in Port Solano longer than the harbour wall, and he talks like
// a man who has already seen how every story in this city ends.
export const SAL_LINES = [
  'Old Sal: "Rook. The city has not changed. You have. That is the problem."',
  'Old Sal: "I have buried better men than Sal Moretti. I will bury him too, one day."',
  'Old Sal: "A favour is a debt, Rook. Pay it back before it comes due."',
  'Old Sal: "The Kings are not the enemy, Rook. The city is. The Kings are just the rent."',
  'Old Sal: "You want advice? Drive slow past the PD, fast past everything else."',
  'Old Sal: "I knew your father. He drove the same way. It got him killed. Drive better."',
  'Old Sal: "The bank vault has a ten-second crack. Ten seconds is a lifetime, Rook."',
  'Old Sal: "Delia trusts you. I trust Delia. That is the whole chain."',
  'Old Sal: "The harbour keeps its secrets, Rook. So do I. So should you."',
  'Old Sal: "A man with a garage is a man with a future. Buy one, Rook."',
  'Old Sal: "The bounty board is the PD admitting they cannot do their own job."',
  'Old Sal: "Five stars means the whole department. Five stars means run, not fight."',
  'Old Sal: "The marina at dawn, Rook. That is the only honest place left in this city."',
  'Old Sal: "I have seen a hundred Rooks come through this town. You are the first one I like."',
  'Old Sal: "The package is never just a package, Rook. But you already know that."',
  'Old Sal: "When the heat comes, lose the tail on the outer ring. Always the outer ring."',
  'Old Sal: "A quiet night in Port Solano is a lie the city tells itself."',
  'Old Sal: "You did good work, Rook. Do not let it go to your head. Heads get shot."',
  'Old Sal: "The Kings will offer you money one day. Take it, then do the job anyway."',
  'Old Sal: "Retirement is a villa on the hill, Rook. Earn it."',
  'Old Sal: "The Kings pay their men on Fridays. Fridays are loud. Avoid Fridays."',
  'Old Sal: "The chop shop takes a cut. Everything in this city takes a cut."',
  'Old Sal: "A bounty hunter is a man the PD pays to do their job. Be that man."',
  'Old Sal: "The outer ring is the only road the pincer car cannot cut off."',
  'Old Sal: "The diner pie is terrible. The advice is not. Listen to the advice."',
  'Old Sal: "The marina lockup is eight hundred. Start there. Everyone starts there."',
  'Old Sal: "The Kings have long memories and short tempers. Remember that order."',
  'Old Sal: "A clean escape is worth more than a fast one. The PD forgets the slow."',
  'Old Sal: "The fog takes the sound. Use it. The harbour is your friend."',
  'Old Sal: "You have survived Heat Wave once. Once is enough to know you can."',
];

// What Rook says to himself, and to the city, when nobody is listening.
// The tracker never shows these — they are the lines the stats screen
// and the achievement toasts borrow, the voice of a man who came home
// broke and intends to leave rich, or not leave at all.
export const ROOK_LINES = [
  'Rook: "Back in Port Solano. Broke, as usual. Let us fix that."',
  'Rook: "Delia\'s diner. Same booth, same coffee, same trouble."',
  'Rook: "The Kings own the docks. I own this car. Fair trade."',
  'Rook: "Three stars. I have survived worse Mondays."',
  'Rook: "One package. No questions. Got it, Delia."',
  'Rook: "The Comet GT is the fastest thing in this city. It is mine now."',
  'Rook: "Rain on the windshield, radio on low. This is the job."',
  'Rook: "Sal Moretti wants me gone. Sal Moretti can wait in line."',
  'Rook: "Five thousand reasons to be quick. Let us go steal a bank."',
  'Rook: "The heat is off, the money is in, and the night is mine."',
  'Rook: "A garage of my own. A roof. A future, maybe."',
  'Rook: "The bounty board pays for Kings. One less King, one more star gone."',
  'Rook: "The harbour at midnight. The only quiet in Port Solano."',
  'Rook: "Nobody knows my name yet. Give it a week."',
  'Rook: "The Strip never closes. Neither do I."',
  'Rook: "A taxi fare, a delivery, a getaway — money is money, and rent is rent."',
  'Rook: "The PD thinks they have me. The PD thinks a lot of things."',
  'Rook: "Six jobs. Six Kings. One city. Let us get to work."',
  'Rook: "The villa on the hill has a view of the whole harbour. One day."',
  'Rook: "Port Solano made me. Port Solano will pay me. In that order."',
  'Rook: "The diner booth is still warm. Delia saves it for me. She denies it."',
  'Rook: "The Kings jumped a driver. That is why I am here. That is always why."',
  'Rook: "The coupe is armoured. The sedan is honest. I take the armoured one."',
  'Rook: "The Strip at 2 a.m. is a different city. I like both of them."',
  'Rook: "A garage, a roof, a future. In that order. Sal is right, for once."',
  'Rook: "The bounty board is the PD admitting defeat. I will take their money."',
  'Rook: "The fog is thick tonight. The harbour disappears. I do not."',
  'Rook: "Three checkpoints, one winner. The taxi race is mine. The cab is slow."',
  'Rook: "The villa has a view of the whole harbour. I can see it from here."',
  'Rook: "The city keeps score. So do I. The city is losing."',
];

// What each district keeps to itself. The city guide shows one secret
// per district, so the guide is a tour with gossip, not a list of
// street names — a local knows the secrets, and now Rook does too.
export const DISTRICT_SECRETS = {
  'The Park': 'The bandstand has a loose board. Something is buried under it. Nobody digs it up.',
  'Marina': 'The third pier piling is hollow. The fishermen use it as a mailbox.',
  'Docks': 'Crane seven has not moved in a decade. The Kings use it as a lookout.',
  'Old Town': 'The bells ring thirteen times on the first of the month. Nobody knows why.',
  'Harbor Heights': 'The villa with the blue shutters belongs to a man who does not exist.',
  'Downtown': 'The bank vault has a back door. It has had one since 1962.',
  'Westside': 'The corner store on Cactus sells pie. The pie is a front. The pie is excellent.',
  'The Strip': 'The club with no sign has no sign because it has no licence. It has everything else.',
  'Northside': 'The rail yard has a siding that goes nowhere. The Kings park there.',
  'The Harbour': 'The fog comes in at midnight and takes the sound with it. The old sailors listen for it.',
};

// What each car model feels like to drive, in one line. The car card
// shows the flavour, so a Comet GT reads as a prize and a Regal Limo
// reads as a boat — the player picks a car by character, not just by
// the top speed number.
export const CAR_FLAVOUR = {
  sedan: 'The honest car. Slow, steady, and nobody looks twice.',
  coupe: 'Fast, fragile, and worth every dent. The getaway of choice.',
  taxi: 'A cab is a disguise with a meter. The city ignores it.',
  van: 'A van carries anything. Questions not included.',
  truck: 'A hauler does not hurry. It does not have to.',
  police: 'An interceptor, stolen or borrowed — the PD wants it back.',
  sports: 'The Comet GT: the fastest civilian car in Port Solano. A prize steal.',
  muscle: 'The Bison GT shoves traffic aside. It does not ask permission.',
  limo: 'The Regal Limo is slow, armoured, and impossible to ignore.',
  pickup: 'The Dune Runner shrugs off curbs, sand, and bad decisions.',
  convertible: 'The Sunset Spyder: open-top, fair-weather, and faster than it looks.',
  hatchback: 'The City Hatch is anonymous. That is exactly why it is the getaway of choice.',
};

// What the wanted poster says, per star level. The heat bar shows the
// number; the poster is the city's voice — one star is a patrol car
// that saw something, five stars is the whole department plus the
// roadblocks, and the poster is what the corner stores read.
export const WANTED_POSTERS = [
  'CLEAN — No record. The PD has never heard of Rook. Enjoy it.',
  'ONE STAR — Patrol: a cruiser saw something. Lose it and it stays a story.',
  'TWO STARS — Pursuit: the PD is looking for a car, not a man. Change cars.',
  'THREE STARS — Manhunt: the whole shift is out. Stay moving, stay off the avenues.',
  'FOUR STARS — Lockdown: roadblocks go up, the radio never stops. Go dark.',
  'FIVE STARS — Army: the whole department, the roadblocks, and a pincer car. Run.',
];

// What the client says when they hand over a job. The board shows the
// payout; the flavour line is the job's voice — a taxi fare is a person
// in a hurry, a medic run is a crate that cannot be dropped, and a
// valet run is a set of keys to a car worth more than the fare.
export const JOB_FLAVOUR = {
  taxi: 'The fare is waiting at the kerb, checking their watch.',
  delivery: 'The package is sealed. The client did not say what is in it.',
  getaway: 'The client cannot be seen. Keep the heat down and drive smooth.',
  courier: 'A sealed package, no questions — just do not be late.',
  valet: 'The client hands over the keys and does not watch you go. Trusting. Or careless.',
  medic: 'Clinic supplies, fragile and urgent. Do not dent the crate.',
};

// More landmarks, second wave: the ferry, the fish market, the
// lighthouse, the Coral hotel, the Trade Row market, the old church,
// the racetrack and the Bayview apartments. The guide grows with the
// city — a landmark is a place worth knowing, and Port Solano has
// more of them than the first tour found.
export const LANDMARKS_2 = [
  { name: 'Ferry Terminal', district: 'The Harbour', x: 200, y: 2200, line: 'The ferry to the mainland leaves twice a day. Rook never takes it.' },
  { name: 'Fish Market', district: 'Marina', x: 2600, y: 200, line: 'The fish market opens at dawn and smells like it. The coffee is free.' },
  { name: 'The Lighthouse', district: 'The Harbour', x: 3000, y: 200, line: 'The lighthouse has not worked in years. The harbour does not mind.' },
  { name: 'Coral Hotel', district: 'Harbor Heights', x: 2200, y: 200, line: 'The Coral is where the rich stay when they visit. The rich do not visit often.' },
  { name: 'Trade Row Market', district: 'Downtown', x: 1800, y: 1400, line: 'Trade Row sells everything, including the things it should not.' },
  { name: 'The Old Church', district: 'Old Town', x: 1000, y: 1800, line: 'The old church has not held a service in years. It holds other things now.' },
  { name: 'The Racetrack', district: 'Northside', x: 2600, y: 1400, line: 'The racetrack is where the street races are born. The Kings never lose there.' },
  { name: 'Bayview Apartments', district: 'Westside', x: 1400, y: 1400, line: 'Bayview is where Rook grew up. The rent has not changed. Neither has the view.' },
];

// More heads for the board, second wave: the Kings have more men than
// the first board held, and the PD keeps adding names. The board never
// runs dry while Sal has a crew — a hunter who clears the first six
// finds four more waiting, and the payouts climb with the risk.
export const BOUNTIES_2 = [
  { id: 'nina-vasquez', name: 'Nina Vasquez', alias: 'The Accountant', payout: 550, enemies: 2, district: 'Downtown', line: 'Vasquez keeps the Kings\' books. Two guards, and she never leaves the bank district.' },
  { id: 'ray-delgado', name: 'Ray Delgado', alias: 'Ray', payout: 380, enemies: 1, district: 'Westside', line: 'Delgado runs the Westside corners. One man, a short temper, a long record.' },
  { id: 'marta-kane', name: 'Marta Kane', alias: 'The Widow\'s Sister', payout: 650, enemies: 2, district: 'The Strip', line: 'Kane runs the Strip\'s back rooms since her sister fell. She wants Rook. The board wants her.' },
  { id: 'joe-peluso', name: 'Joe Peluso', alias: 'The Fisherman', payout: 320, enemies: 1, district: 'Marina', line: 'Peluso smuggles for the Kings out of the marina. The easiest money on the second board.' },
];

// More roofs, second wave: a duplex on the east side and a house on
// the pier. The garage ladder is longer than four rungs — a hunter
// who clears the first board can afford a better roof, and a better
// roof is a better respawn.
export const GARAGES_2 = [
  { id: 'eastside-duplex', name: 'Eastside Duplex', price: 1200, x: 2600, y: 1400, line: 'A duplex on the east side. Two floors, one garage, no neighbours who ask questions.' },
  { id: 'pier-house', name: 'Pier House', price: 4500, x: 732, y: 2140, line: 'A house on the pier itself. The tide comes in under the floorboards.' },
];

// More milestones, second wave: the board clears, the roofs multiply,
// the kills pile up and the money climbs. Every one of these reads a
// counter the game already keeps, so a new milestone is a row here
// plus one line in the predicate map — the career is the same career,
// only longer.
export const ACHIEVEMENTS_2 = [
  { id: 'bounty-hunter-3', title: 'Three Heads', test: 'bountiesDone3', line: 'Three bounties collected. The board is getting thin.' },
  { id: 'homeowner-2', title: 'Two Roofs', test: 'garagesOwned2', line: 'Two garages. Rook is a landlord now.' },
  { id: 'homeowner-4', title: 'Property Magnate', test: 'garagesOwned4', line: 'Four garages. The city is starting to look like his.' },
  { id: 'jobs-25', title: 'The Regular', test: 'jobsDone25', line: 'Twenty-five side jobs. The board knows his name.' },
  { id: 'kills-25', title: 'Kingslayer', test: 'kills25', line: 'Twenty-five Kings down. Sal is running out of men.' },
  { id: 'shots-150', title: 'Lead Rain', test: 'shotsFired150', line: 'A hundred and fifty rounds downrange. The harbour is used to it.' },
  { id: 'cars-15', title: 'Grand Theft', test: 'carsStolen15', line: 'Fifteen cars borrowed. Permanently. All of them.' },
  { id: 'earned-25000', title: 'Quarter Millionaire', test: 'earned25000', line: 'Twenty-five thousand earned. The villa is not a dream any more.' },
];

// More tips, second wave: the bounty board, the garages, the guide,
// the new stations and the new jobs — the tips are the manual, and
// the manual grows with the city.
export const TIPS_2 = [
  'The second bounty board opens after the first six heads are collected.',
  'A garage is a respawn home — busted or wasted, you wake up there.',
  'The Pier House costs $4,500 and sits on the water. The tide is free.',
  'Press G for the city guide. Every district keeps a secret.',
  'The DJ talks between songs. Each station has its own voice.',
  'Delia has known Rook since he was a kid. She talks like it.',
  'Old Sal has buried better men than Sal Moretti. Listen to him.',
  'A wanted poster is the city\'s voice. Five stars is the whole department.',
  'The fish market opens at dawn. The coffee is free and the gossip is better.',
  'The lighthouse has not worked in years. The harbour does not mind.',
  'The racetrack is where the street races are born. The Kings never lose there.',
  'Bayview is where Rook grew up. The rent has not changed.',
  'A valet client hands over the keys and does not watch you go. Trusting. Or careless.',
  'A medic run is a crate that cannot be dropped. Drive like it matters.',
  'The ferry leaves twice a day. Rook never takes it.',
  'The old church has not held a service in years. It holds other things now.',
  'Three bounties collected is an achievement. So is owning two garages.',
  'The Comet GT is the fastest civilian car — and the best steal.',
  'A parked car is a steal. A mission car is a gift. Learn the difference.',
  'The heat decays after 5 seconds out of sight. Lose the tail, then hide.',
  'A street fight is two men with bats. An ambush is two men with guns. Know which.',
  'A car theft parks a blue coupe. A stolen car parks a red Comet GT. Both go to the chop shop.',
  'A taxi race is a street race in a cab. The cab is the joke. The joke pays $230.',
  'The DJ rotates every 30 seconds. If the line repeats, you have been driving too long.',
  'Sal says the outer ring is the only road the pincer cannot cut off. Sal is right.',
  'Delia saves Rook a booth at the diner. She denies it. The booth is always warm.',
  'The fish market opens at dawn. The coffee is free and the gossip is better.',
  'The old church holds other things now. Do not ask what. Asking is how you find out.',
  'The racetrack is where the street races are born. The Kings never lose there. Prove them wrong.',
  'Bayview is where Rook grew up. The rent has not changed. Neither has the view.',
  'A valet client hands over the keys and does not watch you go. Trusting. Or careless.',
  'A medic run is a crate that cannot be dropped. Drive like it matters.',
  'The ferry leaves twice a day. Rook never takes it. Neither should you.',
  'Three bounties collected is an achievement. So is owning two garages.',
  'The Comet GT is the fastest civilian car — and the best steal.',
  'A parked car is a steal. A mission car is a gift. Learn the difference.',
  'The Pier House sits on the water. The tide is free. The house is $4,500.',
  'The Eastside Duplex is $1,200. Two floors, one garage, no neighbours who ask questions.',
  'The second bounty board has four more heads. Nina Vasquez keeps the books.',
  'Marta Kane runs the Strip since her sister fell. She wants Rook. The board wants her.',
];

// --- Second-wave barks ------------------------------------------------------
// More voices for the same pools, plus two pools for the two ped kinds
// the first wave added (fisherman, dealer) and a third near-miss pool
// for when the same close call happens twice. The peds module merges
// these into BARKS at boot, so a pool never repeats the same five
// lines — the city has a hundred ways to say the same thing.
export const BARKS_2 = {
  nearMiss: [
    'Another inch and I was a hood ornament!',
    'I have seen you before. You drive worse every time.',
    'The curb is for pedestrians, not your front bumper!',
    'My mother drives better, and she is dead!',
    'One more inch and I sue the whole city!',
    'I was crossing legally! Legally!',
    'You call that driving? I call it attempted murder!',
    'The crosswalk is not a racetrack, friend!',
  ],
  crime: [
    'That is my car! Somebody call the police!',
    'You stole my car! I just washed it!',
    'Hey! That is a felony! A felony!',
    'My insurance does not cover grand theft!',
    'Take the car, leave the groceries!',
    'I just filled the tank! The tank!',
    'Somebody stop him! He took the good car!',
    'That car was a gift from my mother!',
  ],
  greeting: [
    'Nice day, is it not? The harbour looks good today.',
    'You look like a man in a hurry. The city is in a hurry too.',
    'Morning. The coffee on Cactus is terrible. Drink it anyway.',
    'Beautiful day in Port Solano. The gulls agree.',
    'You new here? You look new. Everyone looks new to me.',
    'The Strip is loud tonight. It is always loud tonight.',
    'Lovely weather. The fog comes in later, so enjoy it now.',
    'You heading to the marina? The ferry leaves at six.',
  ],
  taxi: [
    'Thanks for the ride. You drive like the wind, and I mean that kindly.',
    'Five stars. You are the best driver in this city, and I take cabs daily.',
    'That was quick. You know every shortcut, do you not?',
    'Keep the change. And the advice: stay off the avenues at rush hour.',
    'You are a legend. The last cabbie took an hour. An hour!',
    'Smooth ride. I did not even spill my coffee. Miraculous.',
    'You drive like Delia\'s old chauffeur. He was a legend too.',
    'Thanks. The marina was never this close before.',
  ],
  gunman: [
    'For the Kings! For Sal!',
    'You picked the wrong street, friend!',
    'The Kings send their regards. In bullets.',
    'You think you can walk into our warehouse and walk out?',
    'Sal Moretti wants you gone. I am the going.',
    'This is Harbor King turf. You are trespassing.',
    'You took out my brother. Now I take you out.',
    'The Strip belongs to us. Always has.',
  ],
  cop: [
    'Freeze! Solano PD! Hands where I can see them!',
    'You are under arrest. Do not make it worse.',
    'Stop right there! I said stop!',
    'The PD does not negotiate with car thieves!',
    'Hands up! You are going downtown, one way or another.',
    'We have the block surrounded. Give it up.',
    'Solano PD! That car is stolen, and so is your freedom!',
    'You cannot outrun the law. We have radios.',
  ],
  courier: [
    'Package delivered. No signature needed. Keep moving.',
    'The crate is fragile. The contents are not. Funny, that.',
    'Deliver it to the docks. Do not open it. Do not ask.',
    'A package for the Kings, on time. That is how you survive.',
    'The client pays in cash. Count it. Always count it.',
    'Sealed, stamped, and someone\'s problem. Yours now.',
    'Handle with care. It is worth more than the car.',
    'Deliver it before the fog comes in. The fog hides everything.',
  ],
  race: [
    'Beat me to the pier and the money is yours. Lose and I keep the car.',
    'The racetrack is where the street races are born. Show me what you have.',
    'You call that a car? I call it a warm-up.',
    'First to the Strip wins. The Strip is always watching.',
    'My engine has not lost in a month. Today is not the day.',
    'The Kings never lose at the track. Prove them wrong.',
    'Three checkpoints, one winner. Let us see how fast you really are.',
    'You drive a Comet GT. I drive a promise. Let us race.',
  ],
  wanted: [
    'The PD is everywhere today. Stay off the avenues.',
    'Five stars. The whole department is out. Run, do not fight.',
    'The roadblocks are up on Harbor Rd. Go around the back way.',
    'I heard the sirens an hour ago. They are still looking.',
    'The cops are stopping everyone on the Strip. Walk, do not drive.',
    'Heat is high. The harbour is the only quiet place left.',
    'They are looking for a sedan. Drive anything else.',
    'The PD has the block surrounded. Slip out through the park.',
    'The roadblocks are up on Harbor Rd. The back way is the only way.',
    'I heard the sirens an hour ago. They are still looking. They will be looking all night.',
    'The cops are stopping everyone on the Strip. Walk, do not drive, do not run.',
    'Heat is high and the harbour is the only quiet place left. Go there.',
    'They are looking for a car, not a man. Change cars and change your luck.',
    'Five stars means the whole department. Five stars means the outer ring.',
  ],
  rain: [
    'Rain again. The grip goes, the city slides, and the cabs still charge double.',
    'Storm coming off the harbour. Drive slow, or do not drive at all.',
    'The rain cuts the grip by a sixth. I measured. I am a scientist of rain.',
    'Fog after the rain. The harbour disappears. The city forgets itself.',
    'Rain on the windshield, radio on low. The best drive in Port Solano.',
    'The streets flood near the docks. Take the high road.',
    'Rain means fewer peds, fewer witnesses, and better getaways.',
    'The storm is coming in from the sea. The gulls knew first.',
    'The rain washes the streets and the evidence. The city knows it.',
    'Fog after the rain. The harbour disappears and the city forgets itself.',
    'The gulls knew first. The gulls always know first.',
    'Rain on the Strip means the neon reflects twice. The city glows.',
    'The streets flood near the docks. The high road is the only road.',
    'Rain means fewer peds and fewer witnesses. The getaway drivers know it.',
    'The storm is coming in from the sea. The harbour will be loud tonight.',
    'The rain cuts the grip and the sirens carry further. Drive slow.',
  ],
  bounty: [
    'The board has a new name on it. The PD admits they cannot do their own job.',
    'A King with a price on his head. The harbour will be quieter tonight.',
    'Collect the head, collect the money, lose a star. The board pays.',
    'The second board opens after the first six heads. The Kings have more men than that.',
    'Nina Vasquez keeps the Kings\' books. She is worth five hundred and fifty.',
    'Marta Kane runs the Strip since her sister fell. She wants Rook. The board wants her.',
    'Joe Peluso smuggles out of the marina. The easiest money on the second board.',
    'Ray Delgado runs the Westside corners. One man, a short temper, a long record.',
  ],
  garage: [
    'A garage of my own. A roof. A future, maybe.',
    'The Marina Lockup is eight hundred. The Hilltop Villa is six thousand. Dream accordingly.',
    'Buy a garage and the respawn is yours. Busted or wasted, you wake up at home.',
    'The Pier House sits on the water. The tide comes in under the floorboards.',
    'Two garages and Rook is a landlord. Four and he owns the city.',
    'A garage throws in a free repair. The city does not do free twice.',
    'The Eastside Duplex is twelve hundred. Two floors, no questions.',
    'The Docks Warehouse is thirty-five hundred. Room for a truck and a secret.',
  ],
  achievement: [
    'Another milestone. The city keeps score, even when Rook does not.',
    'A hundred and fifty rounds downrange. The harbour is used to it.',
    'Fifteen cars borrowed. Permanently. All of them.',
    'Twenty-five thousand earned. The villa is not a dream any more.',
    'Three heads on the board. The board is getting thin.',
    'Twenty-five Kings down. Sal is running out of men.',
    'Sixteen milestones, then eight more. The career is long.',
    'Legend. The whole city knows the name now. That is the point.',
  ],
  nearMiss2: [
    'That was closer than the last one. You are getting worse.',
    'The city has a thousand near-misses a day. You are half of them.',
    'My heart is still racing. Yours should be too.',
    'You missed me twice today. Twice. I am counting.',
    'The harbour fog hides everything, including your driving.',
    'Another near-miss and I am moving to the mainland.',
    'You drive like the Kings are after you. Are they?',
    'I have lived here thirty years. I have never been missed so closely.',
  ],
  copChase: [
    'The PD is right behind you. Do not stop. Do not ever stop.',
    'Sirens on the avenue. The whole shift is out.',
    'The pincer car is coming from the left. Break right.',
    'Three stars and the whole department is awake.',
    'The roadblock is on Harbor Rd. Take the back way.',
    'The cops have radios. You have a Comet GT. Use it.',
    'Lose the tail on the outer ring. Always the outer ring.',
    'The heat is high. The harbour is the only quiet place left.',
  ],
  taxiHappy: [
    'Best cabbie in Port Solano. I am telling everyone.',
    'You drive like a legend. The marina was never this close.',
    'Five stars and a tip. Keep the change.',
    'Smooth, fast, and not a single dent. Miraculous.',
    'The last cabbie took an hour. You took four minutes.',
    'You know every shortcut in this city. Every one.',
    'That was the best ride of my life. And I take cabs daily.',
    'You are a legend, driver. The Strip is talking about you.',
  ],
  fisherman: [
    'The fish are biting at dawn. The Kings are not. That is the difference.',
    'Third pier piling is hollow. We use it as a mailbox. Do not tell anyone.',
    'The tide comes in at six. The good fish come in with it.',
    'I have fished this harbour for forty years. The city changes. The water does not.',
    'The marina at dawn is the prettiest place in Port Solano. Delia says so too.',
    'Catch and release. The harbour keeps its secrets, and so do I.',
    'The gulls steal the bait. The Kings steal everything else.',
    'Fishing is waiting. The city is waiting. We are good at waiting.',
  ],
  dealer: [
    'Trade Row sells everything, including the things it should not.',
    'I have what you need. Cash only. No questions. No names.',
    'The market opens at dawn. The good stuff goes first.',
    'You look like a man who needs something. I have something.',
    'No receipts, no refunds, no witnesses. That is the deal.',
    'The Strip is loud. The market is quiet. The market is where the money is.',
    'I do not know Sal Moretti. I have never heard of Sal Moretti.',
    'Buy it, carry it, forget where you got it. That is the rule.',
  ],
};

// --- Merge the second wave ---------------------------------------------------
// The game imports BARKS, BOUNTIES, ACHIEVEMENTS, GARAGES, LANDMARKS and
// TIPS — the second-wave collections above are merged into those at
// module load, so every reader sees the full city. A bark pool merges
// line-by-line (a near-miss has sixteen ways to be said, not five);
// the arrays merge whole. Nothing here re-types a first-wave line.
for (const [pool, lines] of Object.entries(BARKS_2)) {
  if (BARKS[pool]) BARKS[pool].push(...lines);
  else BARKS[pool] = [...lines];
}
BOUNTIES.targets.push(...BOUNTIES_2);
ACHIEVEMENTS.push(...ACHIEVEMENTS_2);
GARAGES.push(...GARAGES_2);
LANDMARKS.push(...LANDMARKS_2);
TIPS.push(...TIPS_2);
