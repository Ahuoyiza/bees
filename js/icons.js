/* =========================================================
   BEES — icons.js
   Every small icon in the game, drawn as inline SVG in the same
   honey style (no emoji, so they look the same on every device).
   - Icons.svg('trophy')         → the SVG markup for one icon
   - Icons.medal(1)              → gold / silver / bronze medal with a number
   - Icons.fill()                → fills every <span data-icon="..."> in the page
   All icons are 24×24 and decorative (aria-hidden): the text next to
   them, or an aria-label, always says what they mean.
   ========================================================= */

const Icons = (() => {
  // Each icon is the inside of a 24×24 SVG. Classes are styled in styles.css.
  const PATHS = {
    // Honey jar with a lid and a drip
    honey:
      '<path class="btn-icon__fill" d="M6 9h12v8.5a3.5 3.5 0 0 1-3.5 3.5h-5A3.5 3.5 0 0 1 6 17.5z"/>' +
      '<rect class="icon__lid" x="5" y="5.5" width="14" height="3.5" rx="1.75"/>' +
      '<path class="icon__drip" d="M9.5 9v3.2a1.2 1.2 0 0 0 2.4 0V9z"/>',

    // A single honey drop (used for "+1")
    drop: '<path class="btn-icon__fill" d="M12 3C9 8 6.5 11 6.5 14.5a5.5 5.5 0 0 0 11 0C17.5 11 15 8 12 3z"/>' +
      '<path class="icon__shine" d="M9.6 14.5a2.6 2.6 0 0 0 1.4 2.4"/>',

    // A five-petal flower
    flower:
      '<circle class="icon__petal" cx="12" cy="6.5" r="3.6"/>' +
      '<circle class="icon__petal" cx="17.2" cy="10.3" r="3.6"/>' +
      '<circle class="icon__petal" cx="15.2" cy="16.5" r="3.6"/>' +
      '<circle class="icon__petal" cx="8.8" cy="16.5" r="3.6"/>' +
      '<circle class="icon__petal" cx="6.8" cy="10.3" r="3.6"/>' +
      '<circle class="btn-icon__fill" cx="12" cy="12" r="3"/>',

    // A four-point sparkle
    sparkle:
      '<path class="btn-icon__fill" d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z"/>' +
      '<path class="btn-icon__fill" d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',

    // A five-point star (personal best)
    star: '<path class="btn-icon__fill" d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/>',

    // Trophy (same shape as the leaderboard button)
    trophy:
      '<path class="btn-icon__fill" d="M7 4h10v5a5 5 0 0 1-10 0z"/>' +
      '<path class="btn-icon__line" d="M7 6H4.5a2.5 2.5 0 0 0 2.8 3.6M17 6h2.5a2.5 2.5 0 0 1-2.8 3.6M12 14v3M8.5 20h7M10 17h4"/>',

    // "Ouch" burst (stings and wasps)
    burst:
      '<path class="icon__burst" d="M12 2l2.2 5.6 5.8-1.6-3.3 5 4.3 4.2-6 .5-.8 6-3.2-5-3.2 5-.8-6-6-.5 4.3-4.2-3.3-5 5.8 1.6z"/>',

    // The queen's crown
    crown:
      '<path class="icon__crown" d="M3.5 18L5 8l4.5 4L12 5l2.5 7L19 8l1.5 10z"/>' +
      '<path class="btn-icon__line" d="M4 20.5h16"/>',

    // A little swarm: three tiny bees
    swarm:
      '<g class="icon__minibee"><ellipse cx="7" cy="15" rx="4" ry="3"/><path d="M6 12.2v5.6"/></g>' +
      '<g class="icon__minibee"><ellipse cx="17" cy="15.5" rx="4" ry="3"/><path d="M16 12.7v5.6"/></g>' +
      '<g class="icon__minibee"><ellipse cx="12" cy="7.5" rx="4" ry="3"/><path d="M11 4.7v5.6"/></g>',

    // Status icons for the journey map
    lock:
      '<path class="btn-icon__line" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>' +
      '<rect class="btn-icon__fill" x="5" y="10.5" width="14" height="10" rx="2.5"/>' +
      '<circle class="icon__dot" cx="12" cy="15.5" r="1.6"/>',
    check:
      '<circle class="btn-icon__fill" cx="12" cy="12" r="9"/>' +
      '<path class="icon__tick" d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    pin:
      '<path class="btn-icon__fill" d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/>' +
      '<circle class="icon__dot" cx="12" cy="10" r="2.4"/>',
    sprout:
      '<path class="btn-icon__line" d="M12 21v-8"/>' +
      '<path class="icon__leaf" d="M12 13c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5z"/>' +
      '<path class="icon__leaf" d="M12 11c0-3.5 2.6-5.8 6.5-5.8 0 3.5-2.6 5.8-6.5 5.8z"/>',
  };

  // One icon as SVG markup. 'bee' uses the real honeybee artwork from chapters.js.
  function svg(name, className = '') {
    if (name === 'bee') {
      return `<span class="icon icon--bee ${className}" aria-hidden="true">${Chapters.beeSVG('honey')}</span>`;
    }
    return `<svg class="icon icon--${name} ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  }

  // Gold (1), silver (2) or bronze (3) medal with the rank number on it
  function medal(rank) {
    const metal = ['gold', 'silver', 'bronze'][rank - 1];
    return `<svg class="icon icon--medal icon--${metal}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
      '<path class="icon__ribbon" d="M7 2h4l2 7H9zM17 2h-4l-2 7h4z"/>' +
      '<circle class="icon__medal" cx="12" cy="15" r="6.5"/>' +
      `<text class="icon__rank" x="12" y="18.2" text-anchor="middle">${rank}</text></svg>`;
  }

  // Put an icon in front of some text inside an element (text stays plain text)
  function withText(el, name, text) {
    el.replaceChildren();
    if (name) el.insertAdjacentHTML('beforeend', svg(name));
    el.append(text);
  }

  // Fill every <span data-icon="flower bee honey"> in the page (space-separated names)
  function fill(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = el.dataset.icon.split(' ').map((name) => svg(name)).join('');
    });
  }

  return { svg, medal, withText, fill };
})();
