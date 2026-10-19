/* =========================================================
   BEES — leaderboard.js
   Keeps the top 10 scores in the browser's localStorage.
   - No accounts and no data leaves the device.
   - Scores are ranked by total honey, then by level reached.
   - Every function is async on purpose: to make the leaderboard
     global later (for example with Supabase), only this file needs
     to change. game.js already awaits these functions.
   ========================================================= */

const Leaderboard = (() => {
  const SCORES_KEY = 'bees-leaderboard';
  const NAME_KEY = 'bees-player-name';
  const MAX_ENTRIES = 10;
  const MAX_NAME_LENGTH = 16;

  /* ---------- Storage helpers (storage can be blocked, so always try/catch) ---------- */
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

  // Tidy up a typed name: trim, squash spaces, limit length, fall back to a default
  function cleanName(name) {
    const tidy = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    return tidy || 'Anonymous Bee';
  }

  /* ---------- Public API ---------- */
  return {
    MAX_ENTRIES,

    // The current top 10, best first
    async getTop() {
      return rank(readScores()).slice(0, MAX_ENTRIES);
    },

    // Would this much honey earn a place on the board?
    async qualifies(honey) {
      if (honey <= 0) return false;
      const top = await this.getTop();
      return top.length < MAX_ENTRIES || honey > top[top.length - 1].honey;
    },

    // Save a score and return its id (so the UI can highlight it)
    async add({ name, honey, level }) {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: cleanName(name),
        honey,
        level,
        date: new Date().toISOString(),
      };
      const saved = writeScores(rank([...readScores(), entry]).slice(0, MAX_ENTRIES));
      return saved ? entry.id : null;
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
