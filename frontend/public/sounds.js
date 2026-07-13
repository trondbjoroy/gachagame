/* Emberfall SoundKit: lazy-loaded one-shots, gesture-unlocked, mutable,
   and silent (never throwing) if a file is missing or blocked. */

const SFX_VOL = {
  summon: .7,
  'reveal-footman': .6, 'reveal-knight': .7, 'reveal-highlord': .8, 'reveal-sovereign': .9,
  coin: .55, fuse: .7, clash: .6, win: .8, lose: .6, deed: .6, favor: .75,
};

let sfxMuted = localStorage.getItem('emberfall_muted') === '1';
let sfxUnlocked = false;
document.addEventListener('pointerdown', () => {
  sfxUnlocked = true;
  startMusic();
}, { once: true, capture: true });

/* background music: gapless WebAudio loop, fades in softly after the
   first interaction; own toggle, persisted */
let musicOff = localStorage.getItem('emberfall_music_off') === '1';
let musicCtx = null;
let musicGain = null;
const MUSIC_VOL = 0.18;

async function startMusic() {
  try {
    if (musicOff || musicCtx) return;
    musicCtx = new (window.AudioContext || window.webkitAudioContext)();
    const raw = await (await fetch('sounds/music.mp3')).arrayBuffer();
    const buf = await musicCtx.decodeAudioData(raw);
    const src = musicCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    musicGain = musicCtx.createGain();
    musicGain.gain.setValueAtTime(0, musicCtx.currentTime);
    musicGain.gain.linearRampToValueAtTime(MUSIC_VOL, musicCtx.currentTime + 5);
    src.connect(musicGain).connect(musicCtx.destination);
    src.start();
  } catch { /* music must never break the game */ }
}

function syncMusicBtn() {
  const b = $('musicBtn');
  if (!b) return;
  b.textContent = '🎵';
  b.style.opacity = musicOff ? '.35' : '1';
  b.title = musicOff ? 'Music off' : 'Music on';
}
$('musicBtn').onclick = () => {
  musicOff = !musicOff;
  localStorage.setItem('emberfall_music_off', musicOff ? '1' : '0');
  syncMusicBtn();
  if (musicOff) {
    if (musicCtx) musicCtx.suspend().catch(() => { });
  } else if (musicCtx) {
    musicCtx.resume().catch(() => { });
  } else {
    startMusic();
  }
};
syncMusicBtn();

/* physical feedback on touch devices. Android has the Vibration API;
   iOS Safari has none, but toggling a switch control fires the system
   haptic tick on iOS 18+. Patterns in ms, keyed to the moments below. */
const HAPTICS = {
  summon: 20,
  'reveal-footman': 15,
  'reveal-knight': [15, 60, 25],
  'reveal-highlord': [25, 70, 40],
  'reveal-sovereign': [35, 80, 45, 80, 70],
  coin: 12,
  fuse: [20, 40, 35],
  clash: [15, 30, 15],
  win: [20, 60, 20, 60, 45],
  lose: 35,
  deed: [12, 50, 12],
  favor: [15, 50, 15, 50, 30],
};
let iosSwitch = null;
function iosTick() {
  try {
    if (!iosSwitch) {
      iosSwitch = document.createElement('label');
      // iOS refuses the haptic when the control is fully invisible
      iosSwitch.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;'
        + 'overflow:hidden;opacity:.02;pointer-events:none;z-index:-1';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      iosSwitch.appendChild(input);
      document.body.appendChild(iosSwitch);
    }
    iosSwitch.click();
  } catch { /* haptics must never break the game */ }
}
window.haptic = function haptic(pattern) {
  try {
    if (!matchMedia('(pointer: coarse)').matches) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
    else iosTick();
  } catch { /* haptics must never break the game */ }
};

// iOS only allows the tick DURING a genuine tap (user activation), so async
// moments can never buzz there; give every meaningful press a synchronous
// tick instead. Android gets the same soft press on top of its patterns.
document.addEventListener('pointerdown', e => {
  if (!e.isTrusted) return;
  if (e.target.closest('button, .tab, .card, .connect-opt')) window.haptic(10);
}, { capture: true, passive: true });

const sfxCache = {};
window.sfx = function sfx(name, opts) {
  try {
    // the physical channel is independent of the sound mute
    const h = (opts && opts.haptic) !== undefined ? opts.haptic : HAPTICS[name];
    if (h) window.haptic(h);
    if (sfxMuted || !sfxUnlocked) return;
    let base = sfxCache[name];
    if (!base) {
      base = sfxCache[name] = new Audio('sounds/' + name + '.mp3');
      base.preload = 'auto';
    }
    const node = base.cloneNode();  // clones can overlap
    node.volume = Math.min(1, (SFX_VOL[name] ?? .7) * ((opts && opts.volume) || 1));
    if (opts && opts.rate) node.playbackRate = opts.rate;
    node.play().catch(() => { });
  } catch { /* audio must never break the game */ }
};

function syncMuteBtn() {
  const b = $('muteBtn');
  if (!b) return;
  b.textContent = sfxMuted ? '🔇' : '🔊';
  b.title = sfxMuted ? 'Sound off' : 'Sound on';
}
$('muteBtn').onclick = () => {
  sfxMuted = !sfxMuted;
  localStorage.setItem('emberfall_muted', sfxMuted ? '1' : '0');
  syncMuteBtn();
  if (!sfxMuted) sfx('coin');
};
syncMuteBtn();
