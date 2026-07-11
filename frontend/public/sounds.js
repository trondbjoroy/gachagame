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

const sfxCache = {};
window.sfx = function sfx(name, opts) {
  try {
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
