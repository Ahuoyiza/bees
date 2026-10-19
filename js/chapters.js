/* =========================================================
   BEES — chapters.js
   All the game's "content" lives here, separate from the game logic:
   1. Chapters: which levels, bee, flowers and challenge each one has
   2. Level plan: how many bees each level needs (sweet / normal / swarm)
   3. Scenes: sky colours per level
   4. Artwork: SVG for every kind of bee and flower
   game.js reads everything through the `Chapters` object at the bottom.
   ========================================================= */

const Chapters = (() => {
  /* ---------- 1. CHAPTERS ----------
     Each chapter is 10 levels with its own bee, flowers and challenge.
     `features` switches the challenges on in game.js. */
  const CHAPTERS = [
    {
      number: 1,
      name: 'The Meadow',
      firstLevel: 1,
      lastLevel: 10,
      bee: 'honey',
      beeName: 'Honeybee',
      flower: 'daisy',
      flowerName: 'Daisies',
      challenge: 'Angry bees',
      description: 'Bees that turn red are about to dive at your net. Catch them first, or move away!',
      features: { queen: false, wasps: false, dark: false },
    },
    {
      number: 2,
      name: "The Queen's Garden",
      firstLevel: 11,
      lastLevel: 20,
      bee: 'bumble',
      beeName: 'Bumblebee',
      flower: 'tulip',
      flowerName: 'Tulips',
      challenge: 'The queen bee',
      description:
        'Now and then the queen flies over and sends 3 or 4 soldier bees after your net. ' +
        'Dodge them! Catch the queen before she calls them, and her soldiers stay home.',
      features: { queen: true, wasps: false, dark: false },
    },
    {
      number: 3,
      name: 'Sunflower Fields',
      firstLevel: 21,
      lastLevel: 30,
      bee: 'carpenter',
      beeName: 'Carpenter bee',
      flower: 'sunflower',
      flowerName: 'Sunflowers',
      challenge: 'Wasp decoys',
      description:
        'Wasps are sneaking in among the bees. They are slimmer, with pointy tails and ' +
        'grumpy eyebrows. Click a wasp and you get stung, so look before you swing!',
      features: { queen: false, wasps: true, dark: false },
    },
    {
      number: 4,
      name: 'Moonlit Grove',
      firstLevel: 31,
      lastLevel: 40,
      bee: 'glow',
      beeName: 'Glow bee',
      flower: 'bluebell',
      flowerName: 'Bluebells',
      challenge: 'Darkness',
      description:
        'Night has fallen. Only the lantern around your net lights up the meadow, ' +
        'so follow the soft glow of the bees.',
      features: { queen: false, wasps: false, dark: true },
    },
  ];

  // After the last chapter the game keeps going, mixing every challenge
  const ENDLESS = {
    number: CHAPTERS.length + 1,
    name: 'Endless Meadow',
    firstLevel: CHAPTERS[CHAPTERS.length - 1].lastLevel + 1,
    lastLevel: Infinity,
    bee: 'mixed',
    beeName: 'Every kind',
    flower: 'mixed',
    flowerName: 'Every kind',
    challenge: 'Everything at once',
    description:
      'You finished every chapter! From here the queen, the wasps and the dark all mix ' +
      'together, and it keeps going until you get stung out. How far can you go?',
    features: { queen: true, wasps: true, dark: 'sometimes' },
  };

  const ALL = [...CHAPTERS, ENDLESS];

  function chapterForLevel(level) {
    return ALL.find((chapter) => level >= chapter.firstLevel && level <= chapter.lastLevel);
  }

  // Levels 11, 21, 31 and 41 open a new chapter
  function isChapterStart(level) {
    return level > 1 && ALL.some((chapter) => chapter.firstLevel === level);
  }

  // Does this level have the darkness challenge?
  function isDarkLevel(level) {
    const { features } = chapterForLevel(level);
    return features.dark === true || (features.dark === 'sometimes' && level % 3 === 0);
  }

  /* ---------- 2. LEVEL PLAN ----------
     Levels 1–10 ramp up gently (5, 7, 9 … 23 bees).
     From level 11 each level is randomly one of:
       sweet  (about 1 in 7): only 12–15 bees, a quick happy win
       normal (most levels):  25 bees
       swarm  (about 1 in 7): 30 bees and extra bees in the air
     Rules: never two swarms in a row, and a new chapter always starts normal.

     The randomness comes from a "seed" number the server picks for each game,
     so the server can work out the exact same plan and check your level.
     !! Keep this in sync with level_for_honey() in supabase/schema.sql !! */
  const RAMP_LAST_LEVEL = 10;
  const NORMAL_TARGET = 25;
  const SWARM_TARGET = 30;
  const SWEET_BASE = 12;   // sweet levels need 12–15
  const SWEET_CHANCE = 14; // out of 100
  const SWARM_CHANCE = 14; // out of 100

  // A repeatable "random" number 0–99 for a given seed and level.
  // Uses small whole-number maths so JavaScript and Postgres get identical results.
  function levelRoll(seed, level) {
    const MOD = 2147483647;
    let x = ((seed % MOD) * 31 + level) % MOD;
    x = (x * 48271) % MOD;
    x = (x * 48271) % MOD;
    return x % 100;
  }

  const planCache = new Map(); // seed → array of level plans

  // The plan for one level: { type: 'ramp' | 'sweet' | 'normal' | 'swarm', target }
  function levelPlan(seed, level) {
    if (!planCache.has(seed)) planCache.set(seed, []);
    const plans = planCache.get(seed);

    // Each level depends on the one before (no two swarms in a row), so build in order
    for (let l = plans.length + 1; l <= level; l++) {
      const previous = plans[l - 2];
      let plan;
      if (l <= RAMP_LAST_LEVEL) {
        plan = { type: 'ramp', target: 5 + (l - 1) * 2 };
      } else if (isChapterStart(l)) {
        plan = { type: 'normal', target: NORMAL_TARGET };
      } else {
        const roll = levelRoll(seed, l);
        if (roll < SWEET_CHANCE) {
          plan = { type: 'sweet', target: SWEET_BASE + (roll % 4) };
        } else if (roll >= 100 - SWARM_CHANCE && previous.type !== 'swarm') {
          plan = { type: 'swarm', target: SWARM_TARGET };
        } else {
          plan = { type: 'normal', target: NORMAL_TARGET };
        }
      }
      plans.push(plan);
    }
    return plans[level - 1];
  }

  // Speed, sting chance and number of bees for a level
  function levelSettings(level, plan) {
    const chapter = chapterForLevel(level);
    // Difficulty climbs within a chapter (1–10), then eases back a little at
    // the start of the next one, because the new challenge adds the difficulty
    const step = Math.min(level - chapter.firstLevel + 1, 10);
    const chapterBoost = chapter.number - 1;
    return {
      target: plan.target,
      beeCount: Math.min(3 + step, 9) + (plan.type === 'swarm' ? 3 : 0),
      speed: Math.min(55 + step * 10 + chapterBoost * 15, 200),
      stingRate: Math.min(0.05 + step * 0.03 + chapterBoost * 0.02, 0.45),
    };
  }

  /* ---------- 3. SCENES ----------
     The sky changes every level. Chapter 4 is always night; the endless
     meadow uses night only on its dark levels. `petals` are flower colours. */
  const SCENES = {
    meadow:   { id: 'meadow',   name: 'Sunny Meadow',    petals: ['#ff9ec4', '#c9a7ff', '#ffb38a', '#ffffff', '#ff7f9e', '#9fd3ff'] },
    sunset:   { id: 'sunset',   name: 'Golden Sunset',   petals: ['#ff8a5c', '#ffc94d', '#ff6f61', '#ffe08a', '#f7a072'] },
    lavender: { id: 'lavender', name: 'Lavender Fields', petals: ['#b79cf5', '#9a7ee6', '#d8c8ff', '#f3c4ff', '#ffffff'] },
    blossom:  { id: 'blossom',  name: 'Cherry Blossom',  petals: ['#ffb3cf', '#ff8fb8', '#ffd6e6', '#ffffff', '#f7a8c8'] },
    night:    { id: 'night',    name: 'Moonlit Night',   petals: ['#cfe3ff', '#ffffff', '#b7f0e6', '#ffd1f0', '#a8c4ff'] },
  };
  const DAY_CYCLE = ['meadow', 'sunset', 'lavender', 'blossom'];

  function sceneForLevel(level) {
    if (isDarkLevel(level)) return SCENES.night;
    return SCENES[DAY_CYCLE[(level - 1) % DAY_CYCLE.length]];
  }

  /* ---------- 4. ARTWORK ----------
     Every bee faces right in a 64×56 box (game.js flips it with --facing).
     Shared class names (bee__wing, bee__eye …) are styled in styles.css. */

  // Pieces several bees share
  const WINGS_BACK = '<ellipse class="bee__wing bee__wing--back" cx="27" cy="13" rx="9" ry="13"/>';
  const WINGS_FRONT = '<ellipse class="bee__wing bee__wing--front" cx="36" cy="14" rx="10" ry="14"/>';
  const ANTENNA =
    '<path class="bee__antenna" d="M47 21 Q49 13 55 11"/>' +
    '<circle class="bee__antenna-tip" cx="55.5" cy="11" r="2.2"/>';
  const HAPPY_FACE =
    '<circle class="bee__eye" cx="46" cy="30" r="3"/>' +
    '<circle class="bee__shine" cx="47" cy="29" r="1"/>' +
    '<ellipse class="bee__blush" cx="47.5" cy="37" rx="3.5" ry="2"/>' +
    '<path class="bee__smile" d="M49 40.5 q2 2 4 -0.5"/>';
  const ANGRY_FACE =
    '<circle class="bee__eye" cx="46" cy="30" r="3"/>' +
    '<circle class="bee__shine" cx="47" cy="29" r="1"/>' +
    '<path class="bee__brow" d="M41.5 24.5 L50 27.5"/>' +
    '<path class="bee__smile" d="M48.5 40 q2 -1.8 4 0"/>';

  const BEE_ART = {
    // Chapter 1: the classic striped honeybee
    honey: `
      <path class="bee__stinger" d="M11 32 L2 34.5 L11 37 Z"/>
      ${WINGS_BACK}
      <ellipse class="bee__body" cx="32" cy="34" rx="22" ry="16"/>
      <ellipse class="bee__stripe" cx="25" cy="34" rx="3.5" ry="15"/>
      <ellipse class="bee__stripe" cx="36" cy="34" rx="3.5" ry="15.3"/>
      ${WINGS_FRONT}${ANTENNA}${HAPPY_FACE}`,

    // Chapter 2: a round, fuzzy bumblebee with a white tail
    bumble: `
      <path class="bee__stinger" d="M12 33 L4 35 L12 37 Z"/>
      ${WINGS_BACK}
      <ellipse class="bee__body bee__body--fuzzy" cx="32" cy="34" rx="21" ry="18"/>
      <ellipse class="bee__tail" cx="15.5" cy="34" rx="4.5" ry="10"/>
      <ellipse class="bee__stripe" cx="27" cy="34" rx="5.5" ry="17.4"/>
      ${WINGS_FRONT}${ANTENNA}${HAPPY_FACE}`,

    // Chapter 3: a glossy black carpenter bee with a fluffy yellow front
    carpenter: `
      <path class="bee__stinger" d="M11 32 L2 34.5 L11 37 Z"/>
      ${WINGS_BACK}
      <ellipse class="bee__body bee__body--dark" cx="30" cy="34" rx="20" ry="15"/>
      <ellipse class="bee__gloss" cx="25" cy="27" rx="8" ry="3"/>
      <circle class="bee__body bee__body--fuzzy" cx="45" cy="32" r="10"/>
      ${WINGS_FRONT}${ANTENNA}${HAPPY_FACE}`,

    // Chapter 4: a pale bee that glows in the dark
    glow: `
      <path class="bee__stinger" d="M11 32 L2 34.5 L11 37 Z"/>
      ${WINGS_BACK}
      <ellipse class="bee__body bee__body--glow" cx="32" cy="34" rx="22" ry="16"/>
      <ellipse class="bee__stripe bee__stripe--soft" cx="25" cy="34" rx="3.5" ry="15"/>
      <ellipse class="bee__stripe bee__stripe--soft" cx="36" cy="34" rx="3.5" ry="15.3"/>
      ${WINGS_FRONT}${ANTENNA}${HAPPY_FACE}`,

    // Chapter 3 decoy: slim wasp with a pinched waist, pointy tail and grumpy eyebrows
    wasp: `
      <path class="bee__stinger" d="M6 37 L0 39 L6 40 Z"/>
      <ellipse class="bee__wing bee__wing--back" cx="33" cy="18" rx="6" ry="12"/>
      <path class="bee__body" d="M37 34 Q30 25 19 29 Q9 33 5 38 Q12 42 21 42 Q31 43 37 34 Z"/>
      <ellipse class="bee__stripe" cx="27" cy="34.5" rx="2.4" ry="7.5"/>
      <ellipse class="bee__stripe" cx="18" cy="36" rx="2.2" ry="6"/>
      <ellipse class="bee__body" cx="45" cy="31" rx="9" ry="8"/>
      <ellipse class="bee__wing bee__wing--front" cx="40" cy="18" rx="6.5" ry="13"/>
      ${ANTENNA}${ANGRY_FACE}`,

    // Chapter 2 boss: the queen, with a crown and a regal purple stripe
    queen: `
      <path class="bee__stinger" d="M11 32 L1 34.5 L11 37 Z"/>
      ${WINGS_BACK}
      <ellipse class="bee__body bee__body--queen" cx="32" cy="34" rx="23" ry="17"/>
      <ellipse class="bee__stripe bee__stripe--royal" cx="24" cy="34" rx="3.5" ry="15.6"/>
      <ellipse class="bee__stripe bee__stripe--royal" cx="35" cy="34" rx="3.5" ry="16.6"/>
      ${WINGS_FRONT}
      <path class="bee__crown" d="M40 15 L42 5 L46.5 11 L50 3 L53.5 11 L58 5 L60 15 Z"/>
      ${ANTENNA}${HAPPY_FACE}`,

    // The queen's soldiers: small, red and cross
    soldier: `
      <path class="bee__stinger" d="M11 32 L2 34.5 L11 37 Z"/>
      ${WINGS_BACK}
      <ellipse class="bee__body bee__body--soldier" cx="32" cy="34" rx="22" ry="16"/>
      <ellipse class="bee__stripe" cx="25" cy="34" rx="3.5" ry="15"/>
      <ellipse class="bee__stripe" cx="36" cy="34" rx="3.5" ry="15.3"/>
      ${WINGS_FRONT}${ANTENNA}${ANGRY_FACE}`,
  };

  const PLAIN_BEES = ['honey', 'bumble', 'carpenter', 'glow'];

  function beeSVG(kind) {
    return `<svg class="bee__art" viewBox="0 0 64 56" aria-hidden="true" focusable="false">${BEE_ART[kind]}</svg>`;
  }

  // Which bee to spawn: the chapter's bee, or any kind in the endless meadow
  function beeKindFor(chapter) {
    return chapter.bee === 'mixed'
      ? PLAIN_BEES[Math.floor(Math.random() * PLAIN_BEES.length)]
      : chapter.bee;
  }

  /* Flowers: each one is drawn in a 40×90 box, anchored at the bottom of the stem.
     --petal (set per flower) colours the petals of daisies, tulips and bluebells. */
  const STEM = '<path class="flower__stem" d="M20 90 Q16 60 20 26"/>';
  const LEAF = '<path class="flower__leaf" d="M19 66 Q6 58 8 50 Q16 54 19 62 Z"/>';

  const FLOWER_ART = {
    daisy() {
      const count = 5 + Math.floor(Math.random() * 3);
      let petals = '';
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        petals += `<circle class="flower__petal" cx="${(20 + Math.cos(angle) * 8).toFixed(1)}" cy="${(22 + Math.sin(angle) * 8).toFixed(1)}" r="7"/>`;
      }
      return `${STEM}${LEAF}${petals}<circle class="flower__center" cx="20" cy="22" r="6"/>`;
    },

    tulip() {
      return `
        <path class="flower__stem" d="M20 90 Q18 60 20 30"/>
        <path class="flower__leaf" d="M19 88 Q4 70 9 46 Q16 62 19 76 Z"/>
        <path class="flower__leaf" d="M21 88 Q35 74 31 54 Q25 66 21 78 Z"/>
        <path class="flower__petal flower__cup" d="M10 12 Q9 31 20 33 Q31 31 30 12 L25 19 L20 9 L15 19 Z"/>`;
    },

    sunflower() {
      let petals = '';
      for (let i = 0; i < 14; i++) {
        petals += `<ellipse class="flower__ray" cx="20" cy="9" rx="3.4" ry="7.5" transform="rotate(${(i * 360) / 14} 20 21)"/>`;
      }
      return `
        <path class="flower__stem flower__stem--thick" d="M20 90 Q17 60 20 30"/>
        <path class="flower__leaf" d="M19 70 Q2 64 4 50 Q15 54 19 64 Z"/>
        <path class="flower__leaf" d="M21 58 Q37 54 36 42 Q26 44 21 52 Z"/>
        ${petals}
        <circle class="flower__seeds" cx="20" cy="21" r="8"/>`;
    },

    bluebell() {
      // Little bell hanging from (x, y)
      const bell = (x, y) =>
        `<path class="flower__petal flower__bell" d="M${x - 4} ${y + 1} Q${x} ${y - 6} ${x + 4} ${y + 1} L${x + 5} ${y + 7} L${x + 2.5} ${y + 5.5} L${x} ${y + 8} L${x - 2.5} ${y + 5.5} L${x - 5} ${y + 7} Z"/>`;
      return `
        <path class="flower__stem" d="M20 90 Q17 52 20 30 Q24 16 33 17"/>
        <path class="flower__leaf" d="M19 88 Q8 70 11 52 Q16 66 19 78 Z"/>
        <path class="flower__stem flower__stem--thin" d="M19 42 Q15 41 14 44 M20 30 Q22 32 22 35 M30 17 Q32 20 32 23"/>
        ${bell(14, 45)}${bell(22, 36)}${bell(32, 24)}`;
    },
  };

  const FLOWER_TYPES = Object.keys(FLOWER_ART);

  // Some flowers always use their own colours, whatever the sky
  const FLOWER_PALETTES = {
    sunflower: ['#ffc93c', '#ffb627', '#ffd95a'],
    bluebell: ['#8fb5ff', '#a99cff', '#c7d8ff', '#7fd1e8'],
  };

  function flowerSVG(type) {
    return `<svg viewBox="0 0 40 90" focusable="false" class="flower__art flower__art--${type}">${FLOWER_ART[type]()}</svg>`;
  }

  // Which flower to plant, and in which colour
  function flowerFor(chapter, scene) {
    const type = chapter.flower === 'mixed'
      ? FLOWER_TYPES[Math.floor(Math.random() * FLOWER_TYPES.length)]
      : chapter.flower;
    const palette = FLOWER_PALETTES[type] || scene.petals;
    return { type, colour: palette[Math.floor(Math.random() * palette.length)] };
  }

  // Artwork for a chapter card: its bee, plus the challenge's threat
  const CHALLENGE_ART = { 1: 'soldier', 2: 'queen', 3: 'wasp', 4: 'glow', 5: 'queen' };

  /* ---------- Public API ---------- */
  return {
    list: ALL,
    chapterForLevel,
    isChapterStart,
    isDarkLevel,
    levelPlan,
    levelSettings,
    sceneForLevel,
    beeSVG,
    beeKindFor,
    flowerSVG,
    flowerFor,
    cardArt(chapter) {
      const bee = chapter.bee === 'mixed' ? 'honey' : chapter.bee;
      return { bee, threat: CHALLENGE_ART[chapter.number] };
    },
  };
})();
