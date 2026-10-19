/* =========================================================
   BEES — game.js
   Sections:
   1. Settings
   2. Game state
   3. DOM references
   4. Small helpers
   5. Scene building (flowers)
   6. Bees: create, move, draw
   7. Player actions: catching & getting stung
   8. Level flow (start, complete, game over)
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
  STING_RADIUS: 160,      // bees closer than this (px) to the net may sting
  WARN_TIME: 0.75,        // seconds a bee glows red before it dives
  STING_COOLDOWN: 1.6,    // minimum seconds between two stings
  SPAWN_DELAY: 0.7,       // seconds between new bees appearing
};

// Difficulty grows a little every level
function levelSettings(level) {
  return {
    target: 5 + (level - 1) * 2,           // bees needed to fill the pot
    beeCount: Math.min(3 + level, 10),     // bees in the air at once
    speed: 55 + level * 12,                // flying speed in px per second
    stingRate: 0.05 + level * 0.035,       // chance per second a nearby bee gets angry
  };
}

/* ---------- 2. GAME STATE ---------- */
const state = {
  level: 1,
  honey: 0,
  totalHoney: 0,
  stings: 0,
  running: false,
  settings: levelSettings(1),
  bees: [],
  nextBeeId: 0,
  spawnTimer: 0,
  stingCooldown: 0,
  lastTime: 0,
  pointer: { x: -999, y: -999, inside: false },
};

/* ---------- 3. DOM REFERENCES ---------- */
const $ = (id) => document.getElementById(id);
const gameEl = $('game');
const fieldEl = $('field');
const cursorEl = $('cursor');
const flashEl = $('sting-flash');
const announcer = $('announcer');

const levelValue = $('level-value');
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
const soundToggle = $('sound-toggle');

/* ---------- 4. HELPERS ---------- */
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

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

/* ---------- 5. SCENE BUILDING ---------- */
const PETAL_COLOURS = ['#ff9ec4', '#c9a7ff', '#ffb38a', '#ffffff', '#ff7f9e', '#9fd3ff'];

// Builds the SVG markup for one cute flower
function flowerSVG(petalCount) {
  const cx = 20;
  const cy = 22;
  let petals = '';
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const px = cx + Math.cos(angle) * 8;
    const py = cy + Math.sin(angle) * 8;
    petals += `<circle class="flower__petal" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7"/>`;
  }
  return `
    <svg viewBox="0 0 40 90" focusable="false">
      <path class="flower__stem" d="M20 90 Q16 60 20 26"/>
      <path class="flower__leaf" d="M19 66 Q6 58 8 50 Q16 54 19 62 Z"/>
      ${petals}
      <circle class="flower__center" cx="${cx}" cy="${cy}" r="6"/>
    </svg>`;
}

// Scatter flowers across the meadow; nearer flowers are bigger and drawn on top
function buildFlowers() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < CONFIG.FLOWER_COUNT; i++) {
    const z = Math.random();
    const flower = document.createElement('div');
    flower.className = 'flower';
    flower.setAttribute('aria-hidden', 'true');
    flower.style.setProperty('--x', `${rand(2, 98)}%`);
    flower.style.setProperty('--z', z.toFixed(3));
    flower.style.setProperty('--scale', (0.45 + z * 0.9).toFixed(2));
    flower.style.setProperty('--petal', pick(PETAL_COLOURS));
    flower.style.setProperty('--sway', `${rand(3, 5.5).toFixed(1)}s`);
    flower.style.zIndex = Math.round(z * 100);
    flower.innerHTML = flowerSVG(pick([5, 6, 7]));
    fragment.appendChild(flower);
  }
  fieldEl.appendChild(fragment);
}

/* ---------- 6. BEES ---------- */

// The bee artwork, shared by every bee (faces right; flipped with --facing)
const BEE_SVG = `
  <svg class="bee__art" viewBox="0 0 64 56" aria-hidden="true" focusable="false">
    <path class="bee__stinger" d="M11 32 L2 34.5 L11 37 Z"/>
    <ellipse class="bee__wing bee__wing--back" cx="27" cy="13" rx="9" ry="13"/>
    <ellipse class="bee__body" cx="32" cy="34" rx="22" ry="16"/>
    <ellipse class="bee__stripe" cx="25" cy="34" rx="3.5" ry="15"/>
    <ellipse class="bee__stripe" cx="36" cy="34" rx="3.5" ry="15.3"/>
    <ellipse class="bee__wing bee__wing--front" cx="36" cy="14" rx="10" ry="14"/>
    <path class="bee__antenna" d="M47 21 Q49 13 55 11"/>
    <circle class="bee__antenna-tip" cx="55.5" cy="11" r="2.2"/>
    <circle class="bee__eye" cx="46" cy="30" r="3"/>
    <circle class="bee__shine" cx="47" cy="29" r="1"/>
    <ellipse class="bee__blush" cx="47.5" cy="37" rx="3.5" ry="2"/>
    <path class="bee__smile" d="M49 40.5 q2 2 4 -0.5"/>
  </svg>`;

// Choose a new random spot in the meadow for the bee to fly towards
function pickTarget(bee) {
  const { w } = fieldSize();
  bee.targetX = rand(40, w - 40);
  bee.targetZ = rand(0.05, 0.95);
}

// Create a bee (a focusable <button>) entering from the left or right edge
function spawnBee() {
  const { w } = fieldSize();
  const fromLeft = Math.random() < 0.5;

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'bee';
  el.setAttribute('aria-label', 'Bee. Press to catch');
  el.innerHTML = BEE_SVG;

  const shadow = document.createElement('div');
  shadow.className = 'bee-shadow';
  shadow.setAttribute('aria-hidden', 'true');

  fieldEl.append(shadow, el);

  const bee = {
    id: state.nextBeeId++,
    el,
    shadow,
    mode: 'fly',          // fly → warn → dive → leave, or caught
    x: fromLeft ? -50 : w + 50,
    z: rand(0.1, 0.9),
    baseAltitude: rand(70, 170),
    altitude: 0,
    phase: rand(0, Math.PI * 2),
    facing: fromLeft ? 1 : -1,
    timer: 0,
    sx: 0, sy: 0, scale: 1, // last on-screen position & size
  };
  pickTarget(bee);

  // Pointerdown (not click) so fast-moving bees still count when you tap them
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    catchBee(bee);
  });
  // Keyboard users: Enter / Space fire a click with detail 0
  el.addEventListener('click', (event) => {
    if (event.detail === 0) catchBee(bee);
  });

  state.bees.push(bee);
}

// Remove a bee from the page and from our list
function removeBee(bee) {
  bee.el.remove();
  bee.shadow.remove();
  state.bees = state.bees.filter((b) => b !== bee);
}

// Move one bee according to what it is currently doing
function updateBee(bee, dt) {
  const { speed } = state.settings;
  bee.phase += dt * 4;

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
      maybeGetAngry(bee, dt);
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

    // After stinging (or missing), zoom up and off the top of the screen
    case 'leave': {
      bee.sy -= speed * 3 * dt;
      bee.sx += bee.facing * speed * 1.5 * dt;
      if (bee.sy < -80) removeBee(bee);
      break;
    }

    default:
      break; // 'caught' bees just play their CSS animation
  }
}

// Draw a bee and its shadow at their current positions
function drawBee(bee) {
  // Wandering bees are positioned from their 3D-ish coordinates
  if (bee.mode === 'fly' || bee.mode === 'warn') {
    const pos = project(bee.x, bee.z, bee.altitude);
    bee.sx = pos.x;
    bee.sy = pos.y;
    bee.scale = pos.scale;

    const shadowScale = pos.scale * Math.max(0.4, 1 - bee.altitude / 400);
    bee.shadow.style.opacity = '1';
    bee.shadow.style.transform =
      `translate3d(${pos.x - 23}px, ${pos.groundY - 6}px, 0) scale(${shadowScale})`;
    bee.el.style.zIndex = Math.round(bee.z * 100) + 1;
  } else {
    // Diving / leaving bees fly in front of everything, without a shadow
    bee.shadow.style.opacity = '0';
    bee.el.style.zIndex = 250;
  }

  bee.el.style.setProperty('--facing', bee.facing);
  bee.el.style.transform =
    `translate3d(${bee.sx - 32}px, ${bee.sy - 28}px, 0) scale(${bee.scale})`;
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

// The player caught a bee
function catchBee(bee) {
  if (!state.running || bee.mode === 'caught' || bee.mode === 'leave') return;

  bee.mode = 'caught';
  bee.el.classList.remove('is-angry');
  bee.el.classList.add('is-caught');
  bee.el.setAttribute('aria-hidden', 'true');
  bee.el.tabIndex = -1;
  bee.shadow.style.opacity = '0';
  setTimeout(() => removeBee(bee), 460);

  showFloatText('+1 🍯', bee.sx, bee.sy - 20);
  replayClass(cursorEl, 'is-swinging');
  BeeAudio.catch();

  state.honey += 1;
  state.totalHoney += 1;
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
  if (!state.running) return;

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

// Little "+1" that floats up from a caught bee
function showFloatText(text, x, y) {
  const span = document.createElement('span');
  span.className = 'float-text';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = text;
  span.style.left = `${x}px`;
  span.style.top = `${y}px`;
  span.addEventListener('animationend', () => span.remove());
  fieldEl.appendChild(span);
}

/* ---------- 8. LEVEL FLOW ---------- */

// Clear the meadow and begin a level
function startLevel(level) {
  state.level = level;
  state.settings = levelSettings(level);
  state.honey = 0;
  state.stings = 0;
  state.spawnTimer = 0;
  state.stingCooldown = 1.5; // a short grace period at the start
  [...state.bees].forEach(removeBee);

  updateLevel();
  updateHoney();
  updateHearts();

  state.running = true;
  state.lastTime = performance.now();
  gameEl.focus({ preventScroll: true });
  announce(`Level ${level}. Catch ${state.settings.target} bees.`);
}

function completeLevel() {
  state.running = false;
  BeeAudio.levelUp();
  levelSummary.textContent =
    `You caught ${state.settings.target} bees on level ${state.level}. ` +
    `Next up: level ${state.level + 1}, with faster, grumpier bees!`;
  // Let the catch animation finish before the dialog appears
  setTimeout(() => levelDialog.showModal(), 500);
}

function gameOver() {
  state.running = false;
  BeeAudio.gameOver();

  // Remember the best level reached on this device (storage may be blocked)
  let best = state.level;
  try {
    best = Math.max(best, Number(localStorage.getItem('bees-best-level')) || 0);
    localStorage.setItem('bees-best-level', String(best));
  } catch (error) {
    /* storage unavailable: ignore */
  }

  overSummary.textContent =
    `You reached level ${state.level} and collected ${state.totalHoney} honey in total. ` +
    `Best level: ${best}.`;
  setTimeout(() => overDialog.showModal(), 450);
}

/* ---------- 9. HUD UPDATES ---------- */
function updateLevel() {
  levelValue.textContent = state.level;
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

  if (state.running) {
    state.stingCooldown = Math.max(0, state.stingCooldown - dt);

    // Keep the meadow topped up with bees
    const active = state.bees.filter((b) => b.mode !== 'caught' && b.mode !== 'leave').length;
    state.spawnTimer -= dt;
    if (active < state.settings.beeCount && state.spawnTimer <= 0) {
      spawnBee();
      state.spawnTimer = CONFIG.SPAWN_DELAY;
    }

    // Copy the list because bees can remove themselves while updating
    [...state.bees].forEach((bee) => updateBee(bee, dt));
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
  startLevel(1);
});

$('next-btn').addEventListener('click', () => {
  levelDialog.close();
  startLevel(state.level + 1);
});

$('restart-btn').addEventListener('click', () => {
  overDialog.close();
  state.totalHoney = 0;
  startLevel(1);
});

// Pressing Escape on a dialog does the same as its main button, so the game never gets stuck
[startDialog, levelDialog, overDialog].forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.querySelector('.btn--primary').click();
  });
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

// Build the scene and show the welcome screen
buildFlowers();
buildHearts();
updateHoney();
updateHearts();
startDialog.showModal();
requestAnimationFrame((now) => {
  state.lastTime = now;
  loop(now);
});
