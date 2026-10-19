/* =========================================================
   BEES — game.js
   The game logic. Chapter content (bees, flowers, level plans)
   lives in chapters.js.
   Sections:
   1. Settings
   2. Game state
   3. DOM references
   4. Small helpers
   5. Scene building (flowers)
   6. Bees, wasps, the queen and her soldiers: create, move, draw
   7. Player actions: catching & getting stung
   8. Level flow (new game, levels, chapters, game over)
      + Chapters journey map, leaderboard table and full screen helpers
   9. HUD updates
   10. Main game loop
   11. Event listeners & start-up
   ========================================================= */

'use strict';

/* ---------- 1. SETTINGS ---------- */
const CONFIG = {
  MAX_STINGS: 4,          // stings allowed before game over
  HORIZON: 0.42,          // must match --horizon in CSS (ground starts at 42% height)
  FLOWER_COUNT: 42,
  STING_RADIUS: 160,      // bees closer than this (px) to the net may get angry
  WARN_TIME: 0.75,        // seconds a bee glows red before it dives
  STING_COOLDOWN: 1.6,    // minimum seconds between two angry bees
  STING_GRACE: 1,         // seconds after a sting when you can't be stung again
  SPAWN_DELAY: 0.7,       // seconds between new bees appearing
  WASP_SHARE: 0.3,        // in wasp chapters, about 3 in 10 new insects are wasps
  WASP_MAX_SHARE: 0.35,   // …but never more than about a third of the meadow
  WASP_LIFETIME: [8, 14], // seconds a wasp hangs around before flying off
  QUEEN_EVERY: [14, 22],  // seconds between queen visits (random in this range)
  QUEEN_FIRST: [6, 10],   // seconds before the first queen of a level
  QUEEN_SWOOP: 260,       // how fast the queen flies in (px per second)
  QUEEN_CALL_TIME: 0.5,   // seconds she glows before her soldiers come out
  SOLDIER_TIME: 5,        // seconds soldiers chase the net before giving up
  SOLDIER_HIT_RADIUS: 22, // how close a soldier must get to sting (px)
  LANTERN_RADIUS: 150,    // size of the lit circle in dark levels (px)
};

/* ---------- 2. GAME STATE ---------- */
const state = {
  level: 1,
  chapter: Chapters.chapterForLevel(1),
  plan: null,             // { type: 'ramp' | 'sweet' | 'normal' | 'swarm', target }
  settings: null,         // speed, bee count etc. for this level
  seed: 0,                // decides which levels are sweet / swarm (picked by the server)
  startLevel: 1,          // the level this game started from (players can pick)
  gameId: 0,              // changes every new game, so late server replies are ignored
  dark: false,
  honey: 0,
  totalHoney: 0,
  stings: 0,
  running: false,
  paused: false,          // true while a menu (leaderboard, chapters) is open mid-game
  bees: [],               // every flying insect: bees, wasps, the queen and soldiers
  nextBeeId: 0,
  spawnTimer: 0,
  stingCooldown: 0,
  invulnerable: 0,
  queenTimer: 0,
  pendingLevel: null,     // level waiting behind the chapter intro screen
  journeyPick: null,      // level picked on the journey map (to start a new game from)
  lastTime: 0,
  pointer: { x: -999, y: -999, inside: false },
};
state.plan = Chapters.levelPlan(state.seed, 1);
state.settings = Chapters.levelSettings(1, state.plan);

/* ---------- 3. DOM REFERENCES ---------- */
const $ = (id) => document.getElementById(id);
const gameEl = $('game');
const fieldEl = $('field');
const cursorEl = $('cursor');
const flashEl = $('sting-flash');
const darknessEl = $('darkness');
const levelBanner = $('level-banner');
const announcer = $('announcer');

const levelValue = $('level-value');
const levelType = $('level-type');
const sceneName = $('scene-name');
const honeyValue = $('honey-value');
const honeyTarget = $('honey-target');
const honeyMeter = $('honey-meter');
const potHoney = $('pot-honey');
const potEl = document.querySelector('.pot');
const stingList = $('sting-list');

const startDialog = $('start-dialog');
const levelDialog = $('level-dialog');
const overDialog = $('over-dialog');
const levelSummary = $('level-summary');
const overSummary = $('over-summary');
const overBest = $('over-best');
const soundToggle = $('sound-toggle');

const chapterDialog = $('chapter-dialog');
const chaptersDialog = $('chapters-dialog');

const scoreForm = $('score-form');
const playerName = $('player-name');
const saveBtn = $('save-btn');
const scoreNote = $('score-note');
const overBoard = $('over-board');
const boardDialog = $('board-dialog');
const boardList = $('board-list');
const boardReset = $('board-reset');
const boardBest = $('board-best');

const playArea = $('play-area');
const fullscreenBtn = $('fullscreen-btn');

/* ---------- 4. HELPERS ---------- */
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Size of the playing field (re-read each frame so resizing just works)
function fieldSize() {
  return { w: gameEl.clientWidth, h: gameEl.clientHeight };
}

/*
  The "2.5D" trick: every bee has an x position, a depth z (0 = far, 1 = near)
  and an altitude. Depth decides where the bee's shadow sits on the ground and
  how big the bee is drawn; altitude lifts the bee above its shadow.
*/
function project(x, z, altitude) {
  const { h } = fieldSize();
  const horizonY = h * CONFIG.HORIZON;
  const groundY = horizonY + z * (h - horizonY) * 0.95;
  const scale = 0.55 + z * 0.7;
  return { x, groundY, y: groundY - altitude * scale, scale };
}

// Say something to screen reader users
function announce(message) {
  announcer.textContent = '';
  // Small delay so repeated messages are still read out
  requestAnimationFrame(() => { announcer.textContent = message; });
}

// Restart a CSS animation class on an element
function replayClass(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so the animation can play again
  el.classList.add(className);
}

// The furthest level reached on this device, used to unlock chapter cards
function getFurthestLevel() {
  try {
    return Number(localStorage.getItem('bees-furthest-level')) || 1;
  } catch (error) {
    return 1;
  }
}

function saveFurthestLevel(level) {
  try {
    if (level > getFurthestLevel()) localStorage.setItem('bees-furthest-level', String(level));
  } catch (error) {
    /* storage unavailable: ignore */
  }
}

/* ---------- 5. SCENE BUILDING ---------- */

// Scatter the chapter's flowers across the meadow; nearer flowers are bigger and on top
function buildFlowers(chapter, scene) {
  // Clear the old flowers first (bees live in the same layer, so only remove flowers)
  fieldEl.querySelectorAll('.flower').forEach((flower) => flower.remove());

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < CONFIG.FLOWER_COUNT; i++) {
    const z = Math.random();
    const { type, colour } = Chapters.flowerFor(chapter, scene);
    const flower = document.createElement('div');
    flower.className = `flower flower--${type}`;
    flower.setAttribute('aria-hidden', 'true');
    flower.style.setProperty('--x', `${rand(2, 98)}%`);
    flower.style.setProperty('--z', z.toFixed(3));
    flower.style.setProperty('--scale', (0.45 + z * 0.9).toFixed(2));
    flower.style.setProperty('--petal', colour);
    flower.style.setProperty('--sway', `${rand(3, 5.5).toFixed(1)}s`);
    flower.style.zIndex = Math.round(z * 100);
    flower.innerHTML = Chapters.flowerSVG(type);
    fragment.appendChild(flower);
  }
  fieldEl.appendChild(fragment);
}

// Switch the meadow to this level's sky and the chapter's flowers, with a soft fade
function applyScene(level) {
  const scene = Chapters.sceneForLevel(level);
  const chapter = Chapters.chapterForLevel(level);
  const look = `${chapter.number}-${scene.id}`;
  // Endless levels mix flower types, so replant every level there
  if (gameEl.dataset.look !== look || chapter.flower === 'mixed') {
    gameEl.dataset.look = look;
    gameEl.dataset.scene = scene.id;
    buildFlowers(chapter, scene);
    replayClass(gameEl, 'is-changing-scene');
  }
  sceneName.textContent = `Chapter ${chapter.number} · ${scene.name}`;
}

/* ---------- 6. BEES, WASPS, THE QUEEN AND HER SOLDIERS ----------
   Everything that flies is an "insect" object in state.bees with a `role`:
     bee     → catch it for honey
     wasp    → a decoy: clicking it stings you
     queen   → can't be caught; she swoops in, calls soldiers, then flies off
     soldier → chases your net; touching one stings you
   Each insect also has a `mode` (what it's doing right now):
     fly → warn → dive → leave, chase → leave, or caught */

// Build the element for any insect. Bees and wasps are buttons so keyboard
// users can reach them; the queen and her soldiers are decorative (they come to you).
function createInsect({ role, kind, label }) {
  const el = document.createElement(label ? 'button' : 'div');
  if (label) {
    el.type = 'button';
    el.setAttribute('aria-label', label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  el.className = `bee bee--${kind}`;
  el.innerHTML = Chapters.beeSVG(kind);

  const shadow = document.createElement('div');
  shadow.className = 'bee-shadow';
  shadow.setAttribute('aria-hidden', 'true');
  fieldEl.append(shadow, el);

  const insect = {
    id: state.nextBeeId++,
    role,
    kind,
    el,
    shadow,
    mode: 'fly',
    x: 0,
    z: 0.5,
    baseAltitude: 120,
    altitude: 0,
    phase: rand(0, Math.PI * 2),
    facing: 1,
    size: 1,              // extra size on top of the depth scale (the queen is bigger)
    timer: 0,
    sx: 0, sy: 0, scale: 1, // last on-screen position & size
  };

  // Pointerdown (not click) so fast-moving bees still count when you tap them
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    updatePointer(event); // on touch screens, the net jumps to where you tapped
    pressInsect(insect);
  });
  // Keyboard users: Enter / Space fire a click with detail 0
  if (label) {
    el.addEventListener('click', (event) => {
      if (event.detail === 0) pressInsect(insect);
    });
  }

  state.bees.push(insect);
  return insect;
}

// Choose a new random spot in the meadow for a bee to fly towards
function pickTarget(bee) {
  const { w } = fieldSize();
  bee.targetX = rand(40, w - 40);
  bee.targetZ = rand(0.05, 0.95);
}

// A bee or wasp enters from the left or right edge
function spawnBee(role) {
  const { w } = fieldSize();
  const fromLeft = Math.random() < 0.5;
  const isWasp = role === 'wasp';
  const bee = createInsect({
    role,
    kind: isWasp ? 'wasp' : Chapters.beeKindFor(state.chapter),
    label: isWasp ? 'Wasp. Do not catch!' : 'Bee. Press to catch',
  });
  bee.x = fromLeft ? -50 : w + 50;
  bee.z = rand(0.1, 0.9);
  bee.baseAltitude = rand(70, 170);
  bee.facing = fromLeft ? 1 : -1;
  // Wasps are meant to be avoided, not clicked, so they leave on their own
  // after a while. Otherwise they'd pile up and push the bees out.
  if (isWasp) bee.lifetime = rand(...CONFIG.WASP_LIFETIME);
  pickTarget(bee);
}

// The queen swoops in from the side, calls her soldiers almost straight away,
// then flies off. She can't be caught, so there's nothing to click.
function spawnQueen() {
  const { w } = fieldSize();
  const fromLeft = Math.random() < 0.5;
  const queen = createInsect({ role: 'queen', kind: 'queen' });
  queen.x = fromLeft ? -70 : w + 70;
  queen.z = 0.3;
  queen.baseAltitude = 190;
  queen.facing = fromLeft ? 1 : -1;
  queen.size = 1.5;
  // She stops just inside the meadow (15–30% in from her side)
  const stopAt = rand(0.15, 0.3) * w;
  queen.deployAt = fromLeft ? stopAt : w - stopAt;

  BeeAudio.queen();
  announce('The queen bee is here! Get ready to dodge her soldiers.');
}

// The queen sends 3 or 4 soldiers after the net
function deploySoldiers(queen) {
  const count = Math.random() < 0.5 ? 3 : 4;
  for (let i = 0; i < count; i++) {
    const soldier = createInsect({ role: 'soldier', kind: 'soldier' });
    soldier.mode = 'chase';
    soldier.timer = CONFIG.SOLDIER_TIME;
    soldier.sx = queen.sx + rand(-25, 25);
    soldier.sy = queen.sy + rand(-10, 25);
    soldier.scale = queen.scale;
    soldier.size = 0.8;
    soldier.facing = queen.facing;
    soldier.wobble = rand(0, Math.PI * 2);
  }
  BeeAudio.swarm();
  announce(`The queen sent ${count} soldier bees. Dodge them!`);
}

// Remove an insect from the page and from our list
function removeBee(bee) {
  bee.el.remove();
  bee.shadow.remove();
  state.bees = state.bees.filter((b) => b !== bee);
}

// Move one insect according to its role and what it is doing
function updateBee(bee, dt) {
  bee.phase += dt * 4;
  if (bee.mode === 'caught') return; // just playing its CSS animation

  // Anything leaving zooms up and off the top of the screen
  if (bee.mode === 'leave') {
    const { speed } = state.settings;
    bee.sy -= speed * 3 * dt;
    bee.sx += bee.facing * speed * 1.5 * dt;
    if (bee.sy < -80) removeBee(bee);
    return;
  }

  if (bee.role === 'queen') updateQueen(bee, dt);
  else if (bee.role === 'soldier') updateSoldier(bee, dt);
  else updateWanderer(bee, dt);
}

// Bees and wasps: wander the meadow; bees may get angry and dive at the net
function updateWanderer(bee, dt) {
  const { speed } = state.settings;

  switch (bee.mode) {
    // Wandering between random spots, bobbing up and down
    case 'fly': {
      const dx = bee.targetX - bee.x;
      const dz = (bee.targetZ - bee.z) * 300; // treat depth as ~300px of travel
      const dist = Math.hypot(dx, dz);
      if (dist < 15) {
        pickTarget(bee);
      } else {
        bee.x += (dx / dist) * speed * dt;
        bee.z += ((dz / dist) * speed * dt) / 300;
        if (Math.abs(dx) > 4) bee.facing = dx < 0 ? -1 : 1;
      }
      bee.altitude = bee.baseAltitude + Math.sin(bee.phase) * 14;
      if (bee.role === 'bee') maybeGetAngry(bee, dt);

      // A wasp whose time is up flies away, making room for a new insect
      if (bee.role === 'wasp') {
        bee.lifetime -= dt;
        if (bee.lifetime <= 0) bee.mode = 'leave';
      }
      break;
    }

    // Angry: hovers in place, glowing red, giving the player time to react
    case 'warn': {
      bee.timer -= dt;
      bee.altitude = bee.baseAltitude + Math.sin(bee.phase * 3) * 4;
      if (bee.timer <= 0) bee.mode = 'dive';
      break;
    }

    // Dive straight at the net in screen space
    case 'dive': {
      const p = state.pointer;
      const dx = p.x - bee.sx;
      const dy = p.y - bee.sy;
      const dist = Math.hypot(dx, dy);
      if (dist < 18 || !p.inside) {
        if (p.inside) sting();
        bee.el.classList.remove('is-angry');
        bee.mode = 'leave';
      } else {
        const diveSpeed = speed * 5;
        bee.sx += (dx / dist) * diveSpeed * dt;
        bee.sy += (dy / dist) * diveSpeed * dt;
        bee.facing = dx < 0 ? -1 : 1;
      }
      break;
    }

    default:
      break;
  }
}

// The queen: swoop in, glow for a moment, release the soldiers, fly away
function updateQueen(queen, dt) {
  queen.altitude = queen.baseAltitude + Math.sin(queen.phase) * 10;

  // Calling her soldiers: a short glow so the player sees it coming
  if (queen.mode === 'warn') {
    queen.timer -= dt;
    if (queen.timer <= 0) {
      queen.el.classList.remove('is-angry');
      deploySoldiers(queen);
      queen.mode = 'leave'; // job done: she zooms up and away
    }
    return;
  }

  queen.x += queen.facing * CONFIG.QUEEN_SWOOP * dt;

  const arrived = queen.facing > 0 ? queen.x >= queen.deployAt : queen.x <= queen.deployAt;
  if (arrived) {
    queen.mode = 'warn';
    queen.timer = CONFIG.QUEEN_CALL_TIME;
    queen.el.classList.add('is-angry');
    BeeAudio.warn();
  }
}

// Soldiers buzz after the net for a few seconds, then give up and leave
function updateSoldier(soldier, dt) {
  soldier.timer -= dt;
  if (soldier.timer <= 0) {
    soldier.mode = 'leave';
    return;
  }

  const p = state.pointer;
  const { w, h } = fieldSize();
  // Chase the net if it's in the meadow, otherwise drift about
  const targetX = p.inside ? p.x : soldier.sx + Math.cos(soldier.wobble) * 60;
  const targetY = p.inside ? p.y : soldier.sy + Math.sin(soldier.wobble) * 30;
  const dx = targetX - soldier.sx;
  const dy = targetY - soldier.sy;
  const dist = Math.hypot(dx, dy) || 1;

  // A sideways wiggle so they buzz around instead of flying in a straight line
  const wiggle = Math.sin(soldier.phase * 2 + soldier.wobble) * 0.6;
  const chaseSpeed = Math.min(state.settings.speed * 1.2, 170) + 30;
  soldier.sx += ((dx - dy * wiggle) / dist) * chaseSpeed * dt;
  soldier.sy += ((dy + dx * wiggle) / dist) * chaseSpeed * dt;
  soldier.sx = clamp(soldier.sx, 0, w);
  soldier.sy = clamp(soldier.sy, 0, h);
  soldier.facing = dx < 0 ? -1 : 1;

  if (p.inside && dist < CONFIG.SOLDIER_HIT_RADIUS) {
    sting();
    soldier.mode = 'leave';
  }
}

// Where the lantern is in dark levels: the net, or the middle if there's no net
function lanternPosition() {
  const { w, h } = fieldSize();
  return state.pointer.inside ? state.pointer : { x: w / 2, y: h * 0.6 };
}

// Draw an insect and its shadow at their current positions
function drawBee(bee) {
  const depthLift = state.dark ? 160 : 0; // in the dark, insects sit above the darkness layer

  // Wandering insects are positioned from their 3D-ish coordinates
  if ((bee.mode === 'fly' || bee.mode === 'warn') && bee.role !== 'soldier') {
    const pos = project(bee.x, bee.z, bee.altitude);
    bee.sx = pos.x;
    bee.sy = pos.y;
    bee.scale = pos.scale;

    const shadowScale = pos.scale * Math.max(0.4, 1 - bee.altitude / 400);
    bee.shadow.style.opacity = '1';
    bee.shadow.style.transform =
      `translate3d(${pos.x - 23}px, ${pos.groundY - 6}px, 0) scale(${shadowScale})`;
    bee.el.style.zIndex = Math.round(bee.z * 100) + 1 + depthLift;
  } else {
    // Diving, chasing and leaving insects fly in front of everything, without a shadow
    bee.shadow.style.opacity = '0';
    bee.el.style.zIndex = 250 + depthLift;
  }

  // In the dark, insects far from the lantern fade to a faint glow
  if (state.dark && bee.mode !== 'caught') {
    const lantern = lanternPosition();
    const distance = Math.hypot(bee.sx - lantern.x, bee.sy - lantern.y);
    bee.el.style.opacity = clamp(1.15 - distance / 260, 0.18, 1).toFixed(2);
  } else {
    bee.el.style.opacity = '';
  }

  bee.el.style.setProperty('--facing', bee.facing);
  bee.el.style.transform =
    `translate3d(${bee.sx - 32}px, ${bee.sy - 28}px, 0) scale(${bee.scale * bee.size})`;
}

/* ---------- 7. PLAYER ACTIONS ---------- */

// A wandering bee near the net may randomly decide to sting
function maybeGetAngry(bee, dt) {
  const p = state.pointer;
  if (!p.inside || state.stingCooldown > 0) return;

  const distance = Math.hypot(bee.sx - p.x, bee.sy - p.y);
  if (distance < CONFIG.STING_RADIUS && Math.random() < state.settings.stingRate * dt) {
    bee.mode = 'warn';
    bee.timer = CONFIG.WARN_TIME;
    bee.el.classList.add('is-angry');
    bee.el.setAttribute('aria-label', 'Angry bee about to sting! Press to catch');
    state.stingCooldown = CONFIG.STING_COOLDOWN + CONFIG.WARN_TIME;
    BeeAudio.warn();
  }
}

// The player clicked / tapped / pressed Enter on an insect
function pressInsect(insect) {
  if (!state.running || state.paused) return;
  if (insect.mode === 'caught' || insect.mode === 'leave') return;
  if (insect.role === 'queen') return; // the queen can't be caught

  if (insect.role === 'wasp') {
    showFloatText('Wasp!', insect.sx, insect.sy - 20, 'burst');
    insect.mode = 'leave';
    sting();
  } else if (insect.role === 'soldier') {
    insect.mode = 'leave';
    sting();
  } else {
    catchBee(insect);
  }
}

// The player caught a bee
function catchBee(bee) {
  bee.mode = 'caught';
  bee.el.classList.remove('is-angry');
  bee.el.classList.add('is-caught');
  bee.el.setAttribute('aria-hidden', 'true');
  bee.el.tabIndex = -1;
  bee.shadow.style.opacity = '0';
  setTimeout(() => removeBee(bee), 460);

  showFloatText('+1', bee.sx, bee.sy - 20, 'drop');
  replayClass(cursorEl, 'is-swinging');
  BeeAudio.catch();

  state.honey += 1;
  state.totalHoney += 1;
  Leaderboard.recordCatch(); // the server keeps its own count for the online board
  updateHoney();
  replayClass(potEl, 'is-filling');

  if (state.honey >= state.settings.target) {
    completeLevel();
  } else {
    announce(`Caught a bee! ${state.honey} of ${state.settings.target}.`);
  }
}

// The player got stung
function sting() {
  if (!state.running || state.invulnerable > 0) return;
  state.invulnerable = CONFIG.STING_GRACE; // a moment of safety so stings don't stack

  state.stings += 1;
  updateHearts();
  BeeAudio.sting();
  replayClass(cursorEl, 'is-stung');
  replayClass(flashEl, 'is-active');
  replayClass(gameEl, 'is-shaking');

  const left = CONFIG.MAX_STINGS - state.stings;
  if (left <= 0 && state.honey < state.settings.target) {
    gameOver();
  } else {
    announce(`Ouch, stung! ${left} ${left === 1 ? 'sting' : 'stings'} left.`);
  }
}

// Little "+1" that floats up from a caught bee, with an optional icon
function showFloatText(text, x, y, icon = null) {
  const span = document.createElement('span');
  span.className = 'float-text';
  span.setAttribute('aria-hidden', 'true');
  Icons.withText(span, icon, text);
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  span.addEventListener('animationend', () => span.remove());
  fieldEl.appendChild(span);
}

/* ---------- 8. LEVEL FLOW ---------- */

// A brand new game: always starts at level 1
// A brand new game, from level 1 or any level the player has already reached.
// From there you always climb upwards, through the chapters in order.
async function newGame(fromLevel = 1) {
  state.running = false;
  state.startLevel = fromLevel;
  state.totalHoney = 0;
  state.gameId += 1;
  const gameId = state.gameId;

  // Ask the server for a run first: its seed decides which levels are sweet or swarm,
  // and the server needs the same seed to check the level. A local seed is used if
  // the server is slow or offline, so the game always starts within a few seconds.
  state.seed = Math.floor(Math.random() * 2147483646);
  const noAnswer = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  const run = await Promise.race([Leaderboard.startRun(fromLevel), noAnswer]);
  if (state.gameId !== gameId) return; // another game was started meanwhile
  if (run && Number.isInteger(run.seed)) state.seed = run.seed;

  startLevel(fromLevel);
}

// Clear the meadow and begin a level
function startLevel(level) {
  state.level = level;
  state.chapter = Chapters.chapterForLevel(level);
  state.plan = Chapters.levelPlan(state.seed, level);
  state.settings = Chapters.levelSettings(level, state.plan);
  state.dark = Chapters.isDarkLevel(level);
  state.honey = 0;
  state.stings = 0;
  state.spawnTimer = 0;
  state.stingCooldown = 1.5; // a short grace period at the start
  state.invulnerable = 0;
  state.queenTimer = rand(...CONFIG.QUEEN_FIRST);
  [...state.bees].forEach(removeBee);

  saveFurthestLevel(level);
  gameEl.classList.toggle('is-dark', state.dark);
  applyScene(level);
  updateLevel();
  updateHoney();
  updateHearts();

  state.running = true;
  state.lastTime = performance.now();
  gameEl.focus({ preventScroll: true });
  showLevelBanner();
}

// Big "Level 12 · Sweet level!" banner over the meadow when a level starts
function showLevelBanner() {
  const { level, plan, chapter } = state;
  let subtitle;
  let icon = null;
  if (level === chapter.firstLevel) {
    subtitle = `Chapter ${chapter.number}: ${chapter.name}`;
  } else if (plan.type === 'sweet') {
    subtitle = `Sweet level! Only ${plan.target} bees`;
    icon = 'honey';
    BeeAudio.sweet();
  } else if (plan.type === 'swarm') {
    subtitle = `Swarm level! ${plan.target} bees`;
    icon = 'swarm';
    BeeAudio.swarm();
  } else {
    subtitle = `Catch ${plan.target} bees`;
  }

  levelBanner.querySelector('.level-banner__title').textContent = `Level ${level}`;
  Icons.withText(levelBanner.querySelector('.level-banner__sub'), icon, subtitle);
  replayClass(levelBanner, 'is-showing');
  announce(`Level ${level}. ${subtitle}.`);
}

function completeLevel() {
  state.running = false;
  BeeAudio.levelUp();
  const next = state.level + 1;
  const nextText = Chapters.isChapterStart(next)
    ? 'Next up: a brand new chapter!'
    : `Next up: level ${next} in the ${Chapters.sceneForLevel(next).name}.`;
  levelSummary.textContent =
    `You caught ${state.settings.target} bees on level ${state.level}. ${nextText}`;
  // Let the catch animation finish before the dialog appears
  setTimeout(() => levelDialog.showModal(), 500);
}

// Fill and open the "new chapter" screen; the level starts when it closes
function showChapterIntro(level) {
  const chapter = Chapters.chapterForLevel(level);
  const art = Chapters.cardArt(chapter);
  state.pendingLevel = level;

  $('chapter-art').innerHTML = Chapters.beeSVG(art.bee) + Chapters.beeSVG(art.threat);
  $('chapter-eyebrow').textContent = chapter.lastLevel === Infinity
    ? `Levels ${chapter.firstLevel}+`
    : `Chapter ${chapter.number} · Levels ${chapter.firstLevel}–${chapter.lastLevel}`;
  $('chapter-title').textContent = chapter.name;
  $('chapter-description').textContent = chapter.description;
  $('chapter-bee').textContent = chapter.beeName;
  $('chapter-flowers').textContent = chapter.flowerName;
  $('chapter-challenge').textContent = chapter.challenge;

  BeeAudio.chapter();
  chapterDialog.showModal();
}

async function gameOver() {
  state.running = false;
  BeeAudio.gameOver();

  let where = `You reached level ${state.level}`;
  if (state.startLevel > 1 && state.level > state.startLevel) {
    where = `You started at level ${state.startLevel} and reached level ${state.level}`;
  } else if (state.startLevel > 1) {
    where = `You started at level ${state.startLevel}`;
  }
  overSummary.textContent =
    `${where} (chapter ${state.chapter.number}) and collected ${state.totalHoney} honey in total.`;

  // Personal best lives on this device and never resets
  const { isNew, best } = Leaderboard.savePersonalBest({
    honey: state.totalHoney,
    level: state.level,
  });
  if (isNew) {
    Icons.withText(overBest, 'star', 'New personal best!');
  } else if (best) {
    overBest.textContent = `Your personal best: ${describeRun(best)}`;
  } else {
    overBest.textContent = '';
  }

  // Leaderboard: if this run makes the top 10, ask for a name
  overBoard.hidden = true;
  scoreForm.hidden = !(await Leaderboard.qualifies(state.totalHoney));
  if (!scoreForm.hidden) {
    playerName.value = Leaderboard.getSavedName();
    scoreNote.textContent = (await Leaderboard.isOnline())
      ? 'Your score goes on today\'s leaderboard for everyone. No account needed.'
      : 'Offline right now, so this is saved on this device only.';
  }

  updateChooseButtons();

  // The dialog focuses its first control: the name box if shown, otherwise "Try again"
  setTimeout(() => overDialog.showModal(), 450);
}

/* ---------- CHAPTERS JOURNEY ----------
   A winding path of level stops, like a board-game map. Level 1 sits at the
   bottom and the path climbs up through each chapter's own little world.
   Everything is placed with `bottom` (px) and `left` (%) inside .journey,
   and one SVG path is drawn through the same points.
   (All text comes from chapters.js, never from players, so innerHTML is safe.) */

const JOURNEY = {
  ROW: 84,           // vertical space per level stop (px)
  SIGN: 170,         // space for each chapter's signpost (px)
  BOTTOM: 24,        // space under level 1 (px)
  TOP: 170,          // space for the "coming soon" cloud at the top (px)
  ENDLESS_SHOWN: 5,  // endless stops shown beyond your furthest level
};

// The path snakes left and right; `i` counts stops from level 1 upwards
function journeyX(i) {
  return 50 + 28 * Math.sin(i * 0.85);
}

function renderJourney() {
  const furthest = getFurthestLevel();
  const container = $('journey');
  const points = [];   // { x (%), y (px from bottom) } for every level stop, level 1 first
  const chapterItems = [];
  let y = JOURNEY.BOTTOM;
  let stop = 0;

  Chapters.list.forEach((chapter) => {
    const endless = chapter.lastLevel === Infinity;
    const last = endless
      ? Math.max(chapter.firstLevel + JOURNEY.ENDLESS_SHOWN - 1, furthest + 2)
      : chapter.lastLevel;
    const unlocked = furthest >= chapter.firstLevel;
    const finished = furthest > chapter.lastLevel;
    const bandStart = y;

    // Signpost at the start of the chapter
    const signY = y;
    y += JOURNEY.SIGN;

    // Level stops
    const levels = [];
    for (let level = chapter.firstLevel; level <= last; level++) {
      const point = { x: journeyX(stop), y: y + JOURNEY.ROW / 2 };
      points.push(point);
      levels.push({ level, ...point });
      stop += 1;
      y += JOURNEY.ROW;
    }

    chapterItems.push({ chapter, endless, unlocked, finished, bandStart, bandEnd: y, signY, levels });
  });

  const height = y + JOURNEY.TOP;

  // Path through every stop: solid honey up to where you are, dashed after
  const toSvg = (p) => `${p.x.toFixed(2)} ${(height - p.y).toFixed(1)}`;
  const pathThrough = (list) => list.reduce((d, p, i) => {
    if (i === 0) return `M${toSvg(p)}`;
    const prev = list[i - 1];
    const midY = (height - (prev.y + p.y) / 2).toFixed(1);
    // Smooth S-curve between neighbouring stops
    return `${d} C${prev.x.toFixed(2)} ${midY} ${p.x.toFixed(2)} ${midY} ${toSvg(p)}`;
  }, '');
  const reached = Math.min(furthest, points.length);
  const donePath = pathThrough(points.slice(0, reached));
  const todoPath = pathThrough(points.slice(reached - 1));

  // Build each chapter's area
  const chaptersHtml = chapterItems.map((item) => {
    const { chapter, endless, unlocked, finished } = item;
    const art = Chapters.cardArt(chapter);
    const levelsText = endless
      ? `Levels ${chapter.firstLevel}+`
      : `Levels ${chapter.firstLevel}–${chapter.lastLevel}`;
    const label = endless ? 'After the last chapter' : `Chapter ${chapter.number}`;

    let status = `${Icons.svg('lock')}<span>Reach level ${chapter.firstLevel} to unlock</span>`;
    if (finished) status = `${Icons.svg('check')}<span>Completed</span>`;
    else if (unlocked) status = `${Icons.svg('pin')}<span>You are here</span>`;

    // A few of the chapter's flowers along the edges of its area
    const flowerTypes = chapter.flower === 'mixed'
      ? ['daisy', 'tulip', 'sunflower', 'bluebell']
      : [chapter.flower];
    const bandHeight = item.bandEnd - item.bandStart;
    const flowers = Array.from({ length: 6 }, (_, i) => {
      const side = i % 2 === 0 ? 3 + (i % 3) * 3 : 85 + (i % 3) * 3;
      // Measured from the bottom of this chapter's own band
      const bottom = 30 + ((i * 0.37) % 1) * (bandHeight - 120);
      const type = flowerTypes[i % flowerTypes.length];
      return `<div class="journey-flower flower--${type}" style="left:${side}%;bottom:${bottom.toFixed(0)}px;--petal:${['#ff9ec4', '#c9a7ff', '#ffb38a', '#9fd3ff'][i % 4]}">${Chapters.flowerSVG(type)}</div>`;
    }).join('');

    const stops = item.levels.map(({ level, x, y: stopY }) => {
      let stopState = 'locked';
      let spoken = 'locked';
      if (level < furthest) { stopState = 'done'; spoken = 'completed'; }
      if (level === furthest) { stopState = 'current'; spoken = 'you are here'; }
      const marker = stopState === 'current'
        ? `<span class="journey-node__bee">${Chapters.beeSVG(chapter.bee === 'mixed' ? 'honey' : chapter.bee)}</span>`
        : '';
      const badge = stopState === 'locked' ? Icons.svg('lock') : stopState === 'done' ? Icons.svg('check') : '';
      // Levels you've reached are buttons: pick one to start a game from there
      const number = stopState === 'locked'
        ? `<span class="journey-node__num">${level}</span><span class="visually-hidden">, ${spoken}</span>`
        : `<button class="journey-node__btn" type="button" data-level="${level}" aria-pressed="false"
             aria-label="Level ${level}, ${spoken}. Start from here">${level}</button>`;
      return `
        <li class="journey-node is-${stopState}" style="left:${x.toFixed(2)}%;bottom:${(stopY - 24).toFixed(0)}px">
          ${marker}
          ${number}
          <span class="journey-node__badge">${badge}</span>
        </li>`;
    }).join('');

    return `
      <li class="journey-chapter journey-chapter--${chapter.number} ${unlocked ? '' : 'is-locked'}">
        <div class="journey-chapter__bg" aria-hidden="true" style="bottom:${item.bandStart}px;height:${bandHeight}px">${flowers}</div>
        <div class="journey-sign" style="bottom:${item.signY + 22}px">
          <div class="journey-sign__art" aria-hidden="true">
            ${Chapters.beeSVG(art.bee)}${unlocked ? Chapters.beeSVG(art.threat) : ''}
          </div>
          <p class="text-xs upper journey-sign__label">${label} · ${levelsText}</p>
          <h3 class="font-display text-lg">${chapter.name}</h3>
          <p class="text-sm">${unlocked ? chapter.challenge : 'A new bee and a new challenge'}</p>
          <p class="journey-sign__status text-sm">${status}</p>
        </div>
        <ol class="journey-levels" aria-label="${chapter.name} levels">${stops}</ol>
      </li>`;
  }).join('');

  container.style.height = `${height}px`;
  container.innerHTML = `
    <svg class="journey__path" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="journey__road" d="${pathThrough(points)}"/>
      <path class="journey__trail journey__trail--todo" d="${todoPath}"/>
      <path class="journey__trail journey__trail--done" d="${donePath}"/>
    </svg>
    <ol class="journey__chapters">${chaptersHtml}</ol>
    <div class="journey-soon" style="bottom:${height - JOURNEY.TOP + 20}px">
      ${Icons.svg('sprout', 'icon--large')}
      <p class="font-display text-lg">More chapters coming soon</p>
      <p class="text-sm text-soft">New bees, flowers and challenges are on their way.</p>
    </div>`;

  // Nothing picked yet each time the map opens
  selectJourneyLevel(null);

  // Scroll so your current stop is in the middle
  const current = points[reached - 1];
  return () => {
    const scroller = $('journey-scroll');
    scroller.scrollTop = height - current.y - scroller.clientHeight / 2;
  };
}

/* ---------- LEADERBOARD ---------- */

// "23 honey, level 4"
function describeRun(run) {
  return `${run.honey} honey, level ${run.level}`;
}

// "in 5h 12m" until the daily reset
function describeTimeUntilReset() {
  const minutes = Math.max(1, Math.ceil(Leaderboard.msUntilReset() / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `in ${hours}h ${minutes % 60}m` : `in ${minutes}m`;
}

// Draw the top 10 as a table inside `container`, highlighting one entry if given
async function renderBoard(container, highlightId = null) {
  const scores = await Leaderboard.getTop();
  container.replaceChildren();

  if (!scores.length) {
    const empty = document.createElement('p');
    empty.className = 'board-empty text-sm text-soft';
    empty.textContent = 'No scores yet today. Catch some bees and be the first!';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'board';
  table.innerHTML = `
    <caption class="visually-hidden">Today's top ${Leaderboard.MAX_ENTRIES} scores</caption>
    <thead>
      <tr>
        <th scope="col">Rank</th>
        <th scope="col">Name</th>
        <th scope="col" class="num">Honey</th>
        <th scope="col" class="num">Level</th>
      </tr>
    </thead>`;

  const tbody = document.createElement('tbody');
  scores.forEach((score, index) => {
    const row = document.createElement('tr');
    if (score.id === highlightId) {
      row.className = 'is-new';
      row.setAttribute('aria-current', 'true');
    }

    // Rank is a row header so screen readers announce it with each cell
    const rankCell = document.createElement('th');
    rankCell.scope = 'row';
    rankCell.className = 'rank';
    // Gold, silver and bronze medals for the top three
    if (index < 3) rankCell.innerHTML = Icons.medal(index + 1);
    else rankCell.textContent = String(index + 1);
    rankCell.setAttribute('aria-label', `Rank ${index + 1}`);

    // textContent (not innerHTML) so a name can never inject HTML
    const cells = [
      [score.name, ''],
      [score.honey, 'num'],
      [score.level, 'num'],
    ].map(([value, className]) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (className) cell.className = className;
      return cell;
    });

    row.append(rankCell, ...cells);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

/* ---------- FULL SCREEN ----------
   Two ways to go full screen:
   1. The browser's Fullscreen API (true full screen, hides the browser UI).
   2. A fallback that makes the play area fill the browser window. Used when
      the API is missing or refused (iPhone Safari, embedded previews, iframes).
   Both add the .is-fullscreen class, which the CSS uses for the layout. */

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function isFallbackFullscreen() {
  return playArea.classList.contains('is-fullscreen-fallback');
}

async function enterFullscreen() {
  const request = playArea.requestFullscreen || playArea.webkitRequestFullscreen;
  try {
    if (!request) throw new Error('Fullscreen API not available');
    // Some browsers never answer the request, so give up after one second
    const timeout = new Promise((resolve) => setTimeout(resolve, 1000));
    await Promise.race([request.call(playArea), timeout]);
  } catch (error) {
    /* refused: handled below */
  }

  // Some browsers say yes but never actually go full screen, so check for real.
  // If it didn't happen, fill the window instead.
  if (!fullscreenElement()) {
    playArea.classList.add('is-fullscreen-fallback');
    document.body.classList.add('no-scroll');
  }
  updateFullscreenState();
}

function exitFullscreen() {
  if (fullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    Promise.resolve(exit.call(document)).catch(() => {});
  }
  playArea.classList.remove('is-fullscreen-fallback');
  document.body.classList.remove('no-scroll');
  updateFullscreenState();
}

function toggleFullscreen() {
  if (fullscreenElement() || isFallbackFullscreen()) {
    exitFullscreen();
  } else {
    enterFullscreen();
  }
}

// Keep the class, the button state and the label in sync
function updateFullscreenState() {
  const on = Boolean(fullscreenElement()) || isFallbackFullscreen();
  playArea.classList.toggle('is-fullscreen', on);
  fullscreenBtn.setAttribute('aria-pressed', String(on));
}

// Mark one level stop as picked and show the "Play from level N" button
function selectJourneyLevel(level) {
  state.journeyPick = level;
  $('journey').querySelectorAll('.journey-node__btn').forEach((button) => {
    const picked = Number(button.dataset.level) === level;
    button.setAttribute('aria-pressed', String(picked));
    button.parentElement.classList.toggle('is-selected', picked);
  });

  const playBtn = $('journey-play');
  playBtn.hidden = !level;
  $('journey-note').hidden = !level;
  if (level) {
    playBtn.textContent = `Play from level ${level}`;
    // `running` stays true while a menu pauses the game, so this means "mid-game"
    $('journey-note').textContent = state.running
      ? 'This starts a new game from there. You\'ll climb up through every chapter after it.'
      : 'You\'ll climb up from there through every chapter after it.';
  }
}

/* ---------- 9. HUD UPDATES ---------- */
function updateLevel() {
  levelValue.textContent = state.level;

  // A little tag next to the level number for sweet and swarm levels
  const tags = { sweet: ['honey', 'Sweet level'], swarm: ['swarm', 'Swarm level'] };
  const tag = tags[state.plan.type];
  if (tag) Icons.withText(levelType, tag[0], tag[1]);
  levelType.dataset.type = state.plan.type;
  levelType.hidden = !tags[state.plan.type];
}

function updateHoney() {
  const { target } = state.settings;
  const fill = Math.min(state.honey / target, 1);
  honeyValue.textContent = state.honey;
  honeyTarget.textContent = target;
  honeyMeter.setAttribute('aria-valuemax', target);
  honeyMeter.setAttribute('aria-valuenow', state.honey);
  honeyMeter.setAttribute('aria-valuetext', `${state.honey} of ${target} bees caught`);
  potHoney.style.transform = `scaleY(${fill})`;
}

// Build the heart icons once, then toggle them as stings happen
const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M12 21s-7.5-4.6-9.5-9.2C1 8.4 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z"/>' +
  '</svg>';

function buildHearts() {
  stingList.innerHTML = '';
  for (let i = 0; i < CONFIG.MAX_STINGS; i++) {
    const li = document.createElement('li');
    li.innerHTML = HEART_SVG;
    stingList.appendChild(li);
  }
}

function updateHearts() {
  const left = CONFIG.MAX_STINGS - state.stings;
  [...stingList.children].forEach((li, i) => {
    const lost = i >= left;
    li.classList.toggle('is-lost', lost);
  });
  stingList.setAttribute('aria-label', `${left} of ${CONFIG.MAX_STINGS} stings left`);
}

/* ---------- 10. MAIN LOOP ---------- */
function loop(now) {
  // dt = seconds since last frame (capped so a slow frame doesn't teleport bees)
  const dt = Math.min((now - state.lastTime) / 1000, 0.05);
  state.lastTime = now;

  if (state.running && !state.paused) {
    state.stingCooldown = Math.max(0, state.stingCooldown - dt);
    state.invulnerable = Math.max(0, state.invulnerable - dt);
    const { features } = state.chapter;

    // Keep the meadow topped up with bees (and some wasps, in wasp chapters)
    const flying = state.bees.filter(
      (b) => (b.role === 'bee' || b.role === 'wasp') && b.mode !== 'caught' && b.mode !== 'leave'
    );
    state.spawnTimer -= dt;
    if (flying.length < state.settings.beeCount && state.spawnTimer <= 0) {
      // Only add a wasp if there's room: wasps never take over the meadow
      const wasps = flying.filter((b) => b.role === 'wasp').length;
      const maxWasps = Math.max(1, Math.floor(state.settings.beeCount * CONFIG.WASP_MAX_SHARE));
      const addWasp = features.wasps && wasps < maxWasps && Math.random() < CONFIG.WASP_SHARE;
      spawnBee(addWasp ? 'wasp' : 'bee');
      state.spawnTimer = CONFIG.SPAWN_DELAY;
    }

    // Queen chapters: every so often the queen visits (one at a time)
    if (features.queen) {
      state.queenTimer -= dt;
      const queenHere = state.bees.some((b) => b.role === 'queen');
      if (state.queenTimer <= 0 && !queenHere) {
        spawnQueen();
        state.queenTimer = rand(...CONFIG.QUEEN_EVERY);
      }
    }

    // Copy the list because insects can remove themselves while updating
    [...state.bees].forEach((bee) => updateBee(bee, dt));
  }

  // Dark levels: move the lantern's lit circle to the net
  if (state.dark) {
    const lantern = lanternPosition();
    darknessEl.style.setProperty('--lx', `${lantern.x}px`);
    darknessEl.style.setProperty('--ly', `${lantern.y}px`);
  }

  state.bees.forEach(drawBee);
  requestAnimationFrame(loop);
}

/* ---------- 11. EVENTS & START-UP ---------- */

// Track the mouse inside the meadow and move the custom net cursor
function updatePointer(event) {
  const rect = gameEl.getBoundingClientRect();
  state.pointer.x = event.clientX - rect.left;
  state.pointer.y = event.clientY - rect.top;
  state.pointer.inside = true;
  // The net's hoop centre (20, 20 in the SVG) is the hotspot
  cursorEl.style.transform = `translate3d(${state.pointer.x - 20}px, ${state.pointer.y - 20}px, 0)`;
  cursorEl.classList.add('is-visible');
}

gameEl.addEventListener('pointermove', updatePointer);
gameEl.addEventListener('pointerenter', updatePointer);
// Mouse leaving the meadow hides the net.
// Touch screens fire pointerleave every time a finger lifts, so for touch the
// net stays where you last tapped. Bees can still dive at it there.
gameEl.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'touch') return;
  hideNet();
});

// Tapping anywhere outside the meadow (HUD, header…) puts the net away
document.addEventListener('pointerdown', (event) => {
  if (!gameEl.contains(event.target)) hideNet();
});

function hideNet() {
  state.pointer.inside = false;
  cursorEl.classList.remove('is-visible');
}

// Clicking empty meadow: just swing the net
gameEl.addEventListener('pointerdown', (event) => {
  updatePointer(event);
  if (!state.running) return;
  replayClass(cursorEl, 'is-swinging');
  BeeAudio.swish();
});

// Buttons in the dialogs
$('start-btn').addEventListener('click', () => {
  BeeAudio.start();
  startDialog.close();
  newGame();
});

// Next level: a new chapter gets its intro screen first
$('next-btn').addEventListener('click', () => {
  levelDialog.close();
  const next = state.level + 1;
  if (Chapters.isChapterStart(next)) {
    showChapterIntro(next);
  } else {
    startLevel(next);
  }
});

$('chapter-start-btn').addEventListener('click', () => chapterDialog.close());
chapterDialog.addEventListener('close', () => {
  if (state.pendingLevel) {
    const level = state.pendingLevel;
    state.pendingLevel = null;
    startLevel(level);
  }
});

// Try again: start over from the same level this game started from
$('restart-btn').addEventListener('click', () => {
  overDialog.close();
  newGame(state.startLevel);
});

// Pressing Escape on a dialog does the same as its main button, so the game never gets stuck
[startDialog, levelDialog, overDialog, boardDialog, chapterDialog, chaptersDialog].forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.querySelector('[data-default]').click();
  });
});

// Save a high score from the game-over screen, then show where it landed
scoreForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  Leaderboard.setSavedName(playerName.value);

  // Saving can take a moment online (the last catches are still being sent)
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  const id = await Leaderboard.add({
    name: playerName.value,
    honey: state.totalHoney,
    level: state.level,
  });
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';

  scoreForm.hidden = true;
  await renderBoard(overBoard, id);
  overBoard.hidden = false;
  announce('Score saved to the leaderboard.');
  $('restart-btn').focus();
});

// Menus in the header pause the game while they're open
function resumeAfterMenu() {
  state.paused = false;
  state.lastTime = performance.now();
}

$('board-btn').addEventListener('click', async () => {
  state.paused = true;
  const best = Leaderboard.getPersonalBest();
  boardBest.textContent = best ? describeRun(best) : 'Play a game to set one!';
  boardReset.textContent = describeTimeUntilReset();
  await renderBoard(boardList);
  boardDialog.showModal();
});
$('board-close').addEventListener('click', () => boardDialog.close());
boardDialog.addEventListener('close', resumeAfterMenu);

// The journey map doubles as a level picker. It opens from the header,
// the start screen and the game-over screen.
function openJourney() {
  state.paused = true;
  const scrollToCurrent = renderJourney();
  chaptersDialog.showModal();
  scrollToCurrent(); // after opening, so the map has its real size
}

$('chapters-btn').addEventListener('click', openJourney);
$('start-choose-btn').addEventListener('click', openJourney);
$('over-choose-btn').addEventListener('click', openJourney);
$('chapters-close').addEventListener('click', () => chaptersDialog.close());
chaptersDialog.addEventListener('close', resumeAfterMenu);

// Tapping a level stop picks it (clicks are handled once, for every stop)
$('journey').addEventListener('click', (event) => {
  const stop = event.target.closest('.journey-node__btn');
  if (stop) selectJourneyLevel(Number(stop.dataset.level));
});

// Play from the picked level: close every open screen and start a new game there
$('journey-play').addEventListener('click', () => {
  const level = state.journeyPick;
  if (!level) return;
  state.pendingLevel = null; // don't let a chapter intro start its own level
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  BeeAudio.start();
  newGame(level);
});

// Show "Choose a level" on the start and game-over screens once there's a choice to make
function updateChooseButtons() {
  const hasChoice = getFurthestLevel() > 1;
  $('start-choose-btn').hidden = !hasChoice;
  $('over-choose-btn').hidden = !hasChoice;
}

// Full screen button (works everywhere thanks to the fill-the-window fallback)
fullscreenBtn.addEventListener('pointerdown', (event) => event.stopPropagation()); // don't swing the net
fullscreenBtn.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenState);
document.addEventListener('webkitfullscreenchange', updateFullscreenState);

// Escape leaves the fallback mode (real full screen handles Escape by itself).
// Skip it when a dialog is open, because Escape belongs to the dialog then.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isFallbackFullscreen() && !document.querySelector('dialog[open]')) {
    exitFullscreen();
  }
});

// Sound on/off
soundToggle.addEventListener('click', () => {
  const muted = !BeeAudio.isMuted();
  BeeAudio.setMuted(muted);
  soundToggle.setAttribute('aria-pressed', String(!muted));
  soundToggle.querySelector('.sound-label').textContent = muted ? 'Sound off' : 'Sound on';
});

// Pause sound when the tab is hidden; avoid a huge dt when it comes back
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    BeeAudio.suspend();
  } else {
    BeeAudio.resume();
    state.lastTime = performance.now();
  }
});

// Build the scene, draw the page's icons and show the welcome screen
Icons.fill();
updateChooseButtons();
applyScene(1);
buildHearts();
updateLevel();
updateHoney();
updateHearts();
startDialog.showModal();
requestAnimationFrame((now) => {
  state.lastTime = now;
  loop(now);
});
