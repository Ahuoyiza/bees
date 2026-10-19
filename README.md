# 🐝 Bees

A small, cozy browser game. Bees drift over a meadow of swaying flowers while soft music plays. Catch bees with your net to fill the honey pot, and don't let them sting you too often.

Built with plain **HTML, CSS and JavaScript**. There are no frameworks, no build step and no image or audio files.

---

## How to play

1. Click **Start buzzing**.
2. **Click a bee** to catch it. Each bee adds one honey to your pot.
3. Fill the pot (the target appears next to it) to finish the level. Each new level needs more bees, and the bees fly faster and sting more often.
4. A bee that **turns red** is about to dive at your net. Catch it first or move your net away.
5. Each level takes place in a new scene: **Sunny Meadow → Golden Sunset → Lavender Fields → Moonlit Garden → Cherry Blossom**, then the cycle repeats.
6. Get stung **4 times** before your pot is full and the game is over.

**Leaderboard:** there are two kinds of score.
- **Today's leaderboard** is online and shared by everyone who plays. It shows the top 10 runs of the day and **resets every day at midnight UTC**. If a game ends with a top-10 score, you're asked for a name. No account or sign-in is needed. If the game can't reach the server, the score is saved on your device instead.
- **Your personal best** is your best run ever. It's kept on your device and **never resets**. The game-over screen tells you when you beat it.

The **Leaderboard** button in the header shows both, plus how long until the next reset. The game pauses while it's open.

**Full screen:** press the corner button at the top left of the meadow. Press it again or press `Esc` to leave. Where the browser blocks true full screen, as iPhone Safari does, the game fills the browser window instead.

**Phone / tablet:** tap a bee to catch it. Your net stays where you last tapped, and angry bees dive at that spot, so keep tapping around the meadow.

**Keyboard:** every bee is a real button. Press `Tab` to move between bees and `Enter` or `Space` to catch one.

---

## Running it on a Mac

There's nothing to install.

**Option 1: just open it**

```bash
open index.html
```

**Option 2: use a tiny local server** (Python comes with macOS)

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000> in your browser.

> Browsers only allow sound after you interact with the page, so the music starts when you press **Start buzzing**. Use the **Sound** button in the header to mute it.

---

## Project structure

```
bees/
├── index.html      # Page structure: header, HUD, game meadow, dialogs, footer
├── css/
│   └── styles.css  # Design tokens, utility classes, components, scene and animations
├── js/
│   ├── audio.js    # Cozy ambience and sound effects (Web Audio API)
│   ├── leaderboard.js # Online daily top 10 (Supabase) + personal best (localStorage)
│   └── game.js     # Game state, bees, catching, stings, levels and the main loop
├── supabase/
│   └── schema.sql  # Online leaderboard setup: tables, security rules, game functions
├── .gitignore
└── README.md
```

---

## How it's built

### HTML (semantic and accessible)
- Uses landmark elements: `<header>`, `<main>`, `<section>`, `<footer>`, plus a **skip link** for keyboard users.
- Start, level-complete and game-over screens are native `<dialog>` elements, which handle focus and the `Escape` key for you.
- The honey pot is a `role="progressbar"` with live `aria-valuenow` values. The hearts report how many stings you have left.
- A hidden `aria-live` region announces catches, stings and level changes to screen readers.
- Bees are `<button>`s, so you can play with a keyboard.

### CSS (reusable styling)
- **Design tokens** in `:root` hold every colour, font size, spacing step, radius and shadow, for example `--space-4` and `--fs-lg`. Change one value and it updates everywhere.
- **Utility classes** such as `.flex`, `.items-center`, `.gap-3`, `.stack`, `.text-sm`, `.font-display` and `.visually-hidden` are reused across the markup.
- **Components:** `.card`, `.btn`, `.btn--primary`, `.btn--ghost` and `.modal`.
- **Grid** handles the page (header / main / footer rows) and the three-column HUD. **Flexbox** handles alignment inside the header, HUD items, dialogs and footer.
- Fonts: **Fredoka** for headings and **Nunito** for body text, both from Google Fonts.
- Respects `prefers-reduced-motion` and hides the custom cursor on touch screens.

### The 2.5D look
The scene is built from flat layers (sky, sun, drifting clouds, two hill layers and the ground) stacked to suggest depth. Each bee and flower has a **depth value `z`** between 0 (far) and 1 (near):
- Depth sets how low on the screen an object sits and how large it's drawn.
- Each bee also has an **altitude**, which lifts it above a soft **shadow** on the ground. That shadow is what makes the bees look like they're flying above the meadow.
- `z-index` follows depth, so nearer flowers and bees overlap farther ones.

### Scenes per level
The sky, sun, clouds, hills and grass only use colour tokens such as `--color-sky-top` and `--color-hill-front`. Each scene is a `.game[data-scene="…"]` rule in the CSS that gives those tokens new values. In `game.js`, the `SCENES` list holds each scene's name and flower colours. When a level starts, `applyScene()` sets `data-scene`, replants the flowers in the new colours and fades the new scene in. The night scene adds twinkling stars and a moon, and the blossom scene adds falling petals.

### JavaScript
- **`game.js`** runs a `requestAnimationFrame` loop. Each bee moves through a simple set of states:
  `fly` (wander) → `warn` (turns red) → `dive` (at your net) → `leave`, or `caught`.
- Difficulty comes from `levelSettings(level)`: the bee target, number of bees, speed and sting chance.
- The cursor is a hand-drawn SVG **bee net** that follows the mouse. It swings when you click and shakes red when you're stung.
- Your best level is saved in `localStorage` when it's available.
- **`audio.js`** creates all sound with the **Web Audio API**: a warm chord pad, a random pentatonic music-box melody with echo, a faint bee hum and occasional bird chirps, plus sound effects for catching, stinging, levelling up and game over.

### Leaderboard
- `leaderboard.js` talks to **Supabase** with plain `fetch` calls, so there's no extra library.
  - When a game starts, it calls `start_run()` to get a run id.
  - On every catch, it calls `record_catch()`. Catches are queued and spaced about 0.45 seconds apart, so the server's speed check never drops a real catch.
  - At game over, it waits for the queue to finish, then calls `finish_run()` with the player's name. **The server writes its own honey count**, not a number from the browser.
  - It reads the board with `todays_leaderboard()`.
- The Supabase **publishable key** in `leaderboard.js` is meant to be public. It can only read the board and call the game functions, because the database blocks everything else.
- **Offline fallback:** if Supabase can't be reached, today's board is kept in `localStorage` instead, ranked by honey and then level. It also remembers the last name you typed.
- Your personal best is stored separately under `bees-personal-best`. It only changes when a run beats it.
- Names are always inserted with `textContent`, so a name can't inject HTML into the page.
- `supabase/schema.sql` sets up the database. Paste it into the Supabase SQL Editor and click Run. The server counts honey itself from each catch, rejects impossible play, and only accepts writes through its own functions. `todays_leaderboard()` returns today's top 10 using the same midnight-UTC reset.

### Full screen
The HUD and meadow sit inside `#play-area`. The button asks the browser's Fullscreen API to make that element full screen, using the `webkit` versions where needed. Some browsers refuse, never answer, or say yes without actually going full screen. In those cases the game uses a **fallback**: it pins the play area over the whole window with `position: fixed`. Both modes add the `.is-fullscreen` class, and a CSS grid then puts the HUD on top and lets the meadow fill the rest. Dialogs still appear on top, because they open in the browser's top layer.

---

Built by **Sophia Ahuoyiza**
