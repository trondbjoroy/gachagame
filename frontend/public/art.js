/* Emberfall champion sigils — hand-drawn heraldic SVG silhouettes.
   Injected as a hidden <symbol> sprite; use window.artFor(name). */
(function () {
  const SIGILS = {
    'moss-snail': `
      <path fill-rule="evenodd" d="M40 19a15 15 0 1 0 .01 0zM40 27a7 7 0 1 1-.01 0z"/>
      <path d="M10 50q1-9 9-9h26q8 0 9 7l0 2zM14 42q-4-8 0-13l4 2q-3 5 0 10z"/>
      <circle cx="13" cy="26" r="3"/><circle cx="21" cy="24" r="3"/>`,
    'pixel-slime': `
      <path fill-rule="evenodd" d="M12 52v-8h4v-10h6v-8h8v-6h6v6h8v8h6v10h4v8zM24 40v6h6v-6zM38 40v6h6v-6z"/>`,
    'tin-knight': `
      <path fill-rule="evenodd" d="M20 14h24v34q0 6-6 6H26q-6 0-6-6zM24 26h16v5H24zM30 35h4v11h-4z"/>
      <path d="M28 6h8v6h-8z"/>
      <circle cx="23" cy="20" r="1.4"/><circle cx="41" cy="20" r="1.4"/>`,
    'rusty-dagger': `
      <path d="M32 6l7 14-4 20h-6l-4-20zM21 42h22v4H21zM29 46h6v9h-6z"/>
      <circle cx="32" cy="58" r="3.4"/>`,
    'levy-spearman': `
      <path d="M16 53l24-31 3 2-24 31zM42 20l9-11 2 9-8 7z"/>
      <path fill-rule="evenodd" d="M14 40a9 9 0 1 0 .01 0zM14 45a4 4 0 1 1-.01 0z"/>`,
    'bog-witch': `
      <path d="M12 42h40l-15-4-3-24-8 21zM22 46h20l-2 6H26z"/>
      <path fill-rule="evenodd" d="M50 12a8 8 0 1 0 4 15 9 9 0 0 1-4-15z"/>`,
    'plague-rat': `
      <ellipse cx="30" cy="41" rx="17" ry="11"/>
      <path d="M44 35l14 7-14 7zM12 45q-9 3-4 11 2-6 8-6z"/>
      <circle cx="41" cy="28" r="5.4"/><circle cx="49" cy="41" r="1.8" fill="#0b0a08"/>`,
    'storm-falcon': `
      <path d="M8 26q22-15 46-6l-15 6q9 2 13 9l-19-3q3 9-2 16-6-14-23-22zM33 46h9l-6 7h5l-11 11 3-8h-5z"/>`,
    'ember-fox': `
      <path fill-rule="evenodd" d="M18 18l7 9h12l7-9 4 15q0 14-15 19-15-5-15-19zM27 34a2.4 2.4 0 1 0 .01 0zM35 34a2.4 2.4 0 1 0 .01 0z"/>
      <path d="M50 40q9-3 6-14 8 12-2 19z"/>`,
    'crystal-golem': `
      <path d="M32 8l9 7-4 9h-10l-4-9z"/>
      <path fill-rule="evenodd" d="M20 27h24l7 14-11 15H24L13 41zM32 34l5 7-5 7-5-7z"/>`,
    'raven-keeper': `
      <path d="M22 22q9-9 17-1 7 2 9 9h-9q5 11-3 20l-4-7q-2 7-11 7 6-7 4-16-8-2-8-8 0-2 5-4z"/>
      <path d="M45 25l11 3-9 4z"/><path d="M14 54h36v4H14z"/>`,
    'heartwood-archer': `
      <path fill-rule="evenodd" d="M20 8a26 26 0 0 1 0 48l-2-4a22 22 0 0 0 0-40z"/>
      <path d="M14 30h30v4H14zM44 26l12 6-12 6zM8 28l6 2v4l-6 2z"/>`,
    'void-kraken': `
      <path fill-rule="evenodd" d="M15 32a17 15 0 0 1 34 0v6H15zM27 28a3 3 0 1 0 .01 0zM39 28a3 3 0 1 0 .01 0z"/>
      <path d="M17 40q-1 9-8 12 9 2 12-9zM27 41q0 10-4 14 8-1 8-13zM37 41q0 12 8 13-4-4-4-13zM47 40q3 11 12 9-7-3-8-12z"/>`,
    'shadow-dragon': `
      <path fill-rule="evenodd" d="M10 36q6-14 22-14l5-10 6 12q11 3 13 12l-11 2q2 7-5 11l-6-5-24 2zM36 30a2.6 2.6 0 1 0 .01 0z"/>
      <path d="M18 48l5 8 3-8zM30 48l5 8 3-8z"/>`,
    'dire-wolf': `
      <path fill-rule="evenodd" d="M13 37q0-13 13-16l5-11 6 9q11 0 17 8l-16 3 12 10-17-4q-2 8-10 9-10 1-10-8zM31 28a2.6 2.6 0 1 0 .01 0z"/>
      <path d="M20 48q12 6 24 0l-4 8H24z"/>`,
    'barrow-wight': `
      <path fill-rule="evenodd" d="M32 8q-19 4-19 27v19h38V35q0-23-19-27zM32 20q11 3 11 16v6H21v-6q0-13 11-16z"/>
      <circle cx="27" cy="35" r="2.6"/><circle cx="37" cy="35" r="2.6"/>
      <path d="M30 42h4l-2 5z"/>`,
    'genesis-phoenix': `
      <path d="M32 52q-4-9 0-17 4 8 0 17zM28 42q-15-3-20-19 12 3 17-5 2 11 5 16zM36 42q3-5 5-16 5 8 17 5-5 16-20 19z"/>
      <circle cx="32" cy="16" r="4"/><path d="M32 10l4 4-4 2-4-2z"/>
      <path d="M26 54q6 4 12 0l-2 6h-8z"/>`,
    'winter-sovereign': `
      <path d="M14 44V26l9 8 9-14 9 14 9-8v18zM14 48h36v6H14z"/>
      <path d="M32 4l2 6 6-2-4 6 4 6-6-2-2 6-2-6-6 2 4-6-4-6 6 2z" opacity=".9"/>`,
    'fallback': `
      <path fill-rule="evenodd" d="M32 8l17 7v14q0 15-17 22-17-7-17-22V15zM32 20l3 7h8l-6 5 2 8-7-4-7 4 2-8-6-5h8z"/>`,
  };

  const NAME_TO_ID = {
    'Moss Snail': 'moss-snail', 'Pixel Slime': 'pixel-slime', 'Tin Knight': 'tin-knight',
    'Rusty Dagger': 'rusty-dagger', 'Levy Spearman': 'levy-spearman', 'Bog Witch': 'bog-witch',
    'Plague Rat': 'plague-rat', 'Storm Falcon': 'storm-falcon', 'Ember Fox': 'ember-fox',
    'Crystal Golem': 'crystal-golem', 'Raven Keeper': 'raven-keeper',
    'Heartwood Archer': 'heartwood-archer', 'Void Kraken': 'void-kraken',
    'Shadow Dragon': 'shadow-dragon', 'Dire Wolf': 'dire-wolf', 'Barrow Wight': 'barrow-wight',
    'Genesis Phoenix': 'genesis-phoenix', 'The Winter Sovereign': 'winter-sovereign',
  };

  const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sprite.setAttribute('style', 'display:none');
  sprite.innerHTML = Object.entries(SIGILS).map(([id, body]) =>
    `<symbol id="art-${id}" viewBox="0 0 64 64" fill="currentColor">${body}</symbol>`).join('');
  document.body.prepend(sprite);

  window.artFor = name => `art-${NAME_TO_ID[name] || 'fallback'}`;
  window.artSvg = (name, cls) =>
    `<svg class="${cls || 'card-art'}" aria-hidden="true"><use href="#${window.artFor(name)}"/></svg>`;
})();
