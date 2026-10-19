/* =========================================================
   BEES — leaderboard.js
   Two kinds of score:
   - Today's leaderboard (online, shared by everyone): top 10, resets
     every day at midnight UTC. Stored in Supabase.
   - Personal best: this player's best ever run. Never resets and
     always stays on this device (localStorage).

   How the online leaderboard stays honest (see supabase/schema.sql):
   the game never sends a score. It starts a "run" on the server,
   reports each catch, and at game over the server writes ITS OWN
   honey count to the board. The browser cannot write to the tables.

   Offline fallback: if Supabase can't be reached, today's board is
   kept in localStorage instead, so the game always works.
   ========================================================= */

const Leaderboard = (() => {
  /* ---------- Settings ---------- */

  // The publishable key is meant to be public: the database rules decide
  // what it can do (read the board, call the game functions, nothing else).
  const SUPABASE_URL = 'https://llxvbhalcnhqfosxdmik.supabase.co';
  const SUPABASE_KEY = 'sb_publishable__Y6h8w0gYKKiO-biYrTyUA_esiOYaYe';
  const REQUEST_TIMEOUT_MS = 6000;
  // The server ignores catches less than 400ms apart, so we space them out
  const CATCH_SPACING_MS = 450;

  const SCORES_KEY = 'bees-leaderboard';
  const NAME_KEY = 'bees-player-name';
  const BEST_KEY = 'bees-personal-best';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_ENTRIES = 10;
  const MAX_NAME_LENGTH = 16;

  /* ---------- Online run state ---------- */
  let runPromise = Promise.resolve(null); // resolves to { id, seed } from the server (or null if offline)
  let catchQueue = Promise.resolve();     // catches are sent one after another, in order
  let lastCatchAnswered = 0;              // when the server last answered a catch

  /* ---------- Talking to Supabase ---------- */

  // Call one of the database functions, e.g. rpc('start_run')
  async function rpc(name, args = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${name} failed (${response.status})`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------- Local storage helpers (storage can be blocked, so always try/catch) ---------- */
  function readScores() {
    try {
      const data = JSON.parse(localStorage.getItem(SCORES_KEY));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function writeScores(scores) {
    try {
      localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
      return true;
    } catch (error) {
      return false;
    }
  }

  // Highest honey first; ties go to the higher level, then to whoever got there first
  function rank(scores) {
    return [...scores].sort(
      (a, b) => b.honey - a.honey || b.level - a.level || a.date.localeCompare(b.date)
    );
  }

  // Midnight UTC at the start of today, in milliseconds
  function startOfTodayUTC() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  // Only local scores saved since today's reset count
  function todaysLocalScores() {
    return readScores().filter((score) => Date.parse(score.date) >= startOfTodayUTC());
  }

  // Is run `a` better than run `b`? (more honey, or same honey and a higher level)
  function isBetter(a, b) {
    return !b || a.honey > b.honey || (a.honey === b.honey && a.level > b.level);
  }

  // Tidy up a typed name the same way the server does
  function cleanName(name) {
    const tidy = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    return tidy || 'Anonymous Bee';
  }

  // Save a score locally (offline fallback) and return its id
  function addLocal({ name, honey, level }) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: cleanName(name),
      honey,
      level,
      date: new Date().toISOString(),
    };
    // Older days are dropped here, so storage never grows past 10 scores
    const saved = writeScores(rank([...todaysLocalScores(), entry]).slice(0, MAX_ENTRIES));
    return saved ? entry.id : null;
  }

  /* ---------- Public API ---------- */
  return {
    MAX_ENTRIES,

    // A new game begins: ask the server for a run. Resolves to { id, seed },
    // or null if offline. The seed decides which levels are sweet or swarm.
    // `startLevel` is the level the player chose to start from (1 by default).
    startRun(startLevel = 1) {
      catchQueue = Promise.resolve();
      runPromise = rpc('start_run', startLevel > 1 ? { p_start_level: startLevel } : {})
        // Older database setups returned just the id, so accept both shapes
        .then((run) => (typeof run === 'string' ? { id: run, seed: null } : run))
        .catch(() => null);
      return runPromise;
    },

    // A bee was caught: tell the server. Queued so catches arrive in order
    // and far enough apart for the server's speed check.
    recordCatch() {
      const run = runPromise;
      catchQueue = catchQueue.then(async () => {
        const current = await run;
        if (!current) return;
        const delay = lastCatchAnswered + CATCH_SPACING_MS - Date.now();
        if (delay > 0) await wait(delay);
        try {
          await rpc('record_catch', { p_run_id: current.id });
        } catch (error) {
          /* a lost catch only lowers the online score; the game carries on */
        }
        lastCatchAnswered = Date.now();
      });
    },

    // Is this game being counted online?
    async isOnline() {
      return Boolean(await runPromise);
    },

    // Today's top 10, best first (online if possible, otherwise this device)
    async getTop() {
      try {
        const rows = await rpc('todays_leaderboard');
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          honey: row.honey,
          level: row.level,
          date: row.created_at,
        }));
      } catch (error) {
        return rank(todaysLocalScores()).slice(0, MAX_ENTRIES);
      }
    },

    // Milliseconds until the next daily reset (midnight UTC)
    msUntilReset() {
      return startOfTodayUTC() + DAY_MS - Date.now();
    },

    // Would this much honey earn a place on the board?
    async qualifies(honey) {
      if (honey <= 0) return false;
      const top = await this.getTop();
      return top.length < MAX_ENTRIES || honey > top[top.length - 1].honey;
    },

    // Save the finished game and return its leaderboard id (so the UI can highlight it).
    // Online, the server uses its own honey count; `honey` and `level` are only
    // used for the offline fallback.
    async add({ name, honey, level }) {
      const run = await runPromise;
      if (run) {
        try {
          await catchQueue; // make sure every catch has reached the server first
          await rpc('finish_run', { p_run_id: run.id, p_name: cleanName(name) });
          runPromise = Promise.resolve(null); // this run is closed

          // Find the entry we just made: newest one today with this name
          const top = await this.getTop();
          const mine = top
            .filter((score) => score.name === cleanName(name))
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          return mine ? mine.id : null;
        } catch (error) {
          /* server unreachable: fall back to saving on this device */
        }
      }
      return addLocal({ name, honey, level });
    },

    /* ---------- Personal best (local only, never resets) ---------- */

    getPersonalBest() {
      try {
        const best = JSON.parse(localStorage.getItem(BEST_KEY));
        return best && Number.isFinite(best.honey) ? best : null;
      } catch (error) {
        return null;
      }
    },

    // Save this run if it beats the personal best. Returns { isNew, best }.
    savePersonalBest({ honey, level }) {
      const previous = this.getPersonalBest();
      const run = { honey, level, date: new Date().toISOString() };

      if (honey <= 0 || !isBetter(run, previous)) {
        return { isNew: false, best: previous };
      }
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(run));
      } catch (error) {
        /* storage unavailable: still tell the player, it just won't be remembered */
      }
      return { isNew: true, best: run };
    },

    // Remember the last name used so players don't retype it every time
    getSavedName() {
      try {
        return localStorage.getItem(NAME_KEY) || '';
      } catch (error) {
        return '';
      }
    },

    setSavedName(name) {
      try {
        localStorage.setItem(NAME_KEY, cleanName(name));
      } catch (error) {
        /* storage unavailable: ignore */
      }
    },
  };
})();
