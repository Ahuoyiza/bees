# 🐝 Bees

A small, cozy browser game. Bees drift over a meadow of swaying flowers while soft music plays. Catch bees with your net to fill the honey pot, and don't let them sting you too often.

Built with plain **HTML, CSS and JavaScript**. There are no frameworks, no build step and no image or audio files.

---

## How to play

1. Click **Start buzzing**.
2. **Click a bee** to catch it. Each bee adds one honey to your pot.
3. Fill the pot (the target appears next to it) to finish the level. Each new level needs more bees, and the bees fly faster and sting more often.
4. A bee that **turns red** is about to dive at your net. Catch it first or move your net away.
5. Get stung **4 times** before your pot is full and the game is over.

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
│   └── game.js     # Game state, bees, catching, stings, levels and the main loop
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

### JavaScript
- **`game.js`** runs a `requestAnimationFrame` loop. Each bee moves through a simple set of states:
  `fly` (wander) → `warn` (turns red) → `dive` (at your net) → `leave`, or `caught`.
- Difficulty comes from `levelSettings(level)`: the bee target, number of bees, speed and sting chance.
- The cursor is a hand-drawn SVG **bee net** that follows the mouse. It swings when you click and shakes red when you're stung.
- Your best level is saved in `localStorage` when it's available.
- **`audio.js`** creates all sound with the **Web Audio API**: a warm chord pad, a random pentatonic music-box melody with echo, a faint bee hum and occasional bird chirps, plus sound effects for catching, stinging, levelling up and game over.

---

Built by **Sophia Ahuoyiza**
