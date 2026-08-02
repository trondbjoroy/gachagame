import React from 'react';
import {
  AbsoluteFill, Img, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing,
} from 'remotion';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily: CINZEL } = loadCinzel();
const { fontFamily: OUTFIT } = loadOutfit();
const { fontFamily: MONO } = loadMono();

const INK = '#f4efe6';
const GOLD = '#d4a843';
const GOLD_HOT = '#e8be55';
const BG = '#0b0a08';
const MATERIALS = ['#8e887a', '#7fa0bd', '#5fa894', '#e8ae3f'];

const card = (slug: string) => staticFile(`cards/${slug}.jpg`);

/* ---------------- cinematic furniture ---------------- */

const Ground: React.FC<{ glow?: number }> = ({ glow = 1 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: BG }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1300px 850px at 50% ${38 + Math.sin(f / 60) * 3}%,
            rgba(212,168,67,${0.15 * glow}), transparent 62%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Vignette: React.FC<{ amount?: number }> = ({ amount = 0.62 }) => (
  <AbsoluteFill style={{
    pointerEvents: 'none',
    background: `radial-gradient(120% 90% at 50% 45%, transparent 52%, rgba(4,3,1,${amount}) 100%)`,
  }} />
);

/* faint animated grain: reads as film, costs nothing */
const Grain: React.FC = () => {
  const f = useCurrentFrame();
  const j = (f * 7) % 13;
  return (
    <AbsoluteFill style={{
      pointerEvents: 'none', opacity: 0.05, mixBlendMode: 'overlay',
      background: `repeating-radial-gradient(circle at ${20 + j}% ${30 + ((f * 11) % 17)}%,
        #fff 0 0.6px, transparent 0.6px 3px)`,
    }} />
  );
};

const Embers: React.FC<{ count?: number; heat?: number }> = ({ count = 30, heat = 1 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      {new Array(count).fill(0).map((_, i) => {
        const seed = (i * 97) % 100;
        const x = (seed / 100) * 1920;
        const speed = (0.6 + ((i % 5) * 0.25)) * heat;
        const y = 1180 - ((f * speed * 6 + seed * 11) % 1300);
        const s = 2 + (i % 3);
        return (
          <div key={i} style={{
            position: 'absolute', left: x + Math.sin((f + seed) / 24) * 26, top: y,
            width: s, height: s, borderRadius: '50%',
            background: i % 4 === 0 ? GOLD_HOT : GOLD,
            opacity: 0.16 + ((i % 4) * 0.12), filter: 'blur(0.5px)',
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

/* a burst of sparks from a point — victory slams, the title landing */
const Burst: React.FC<{ at: number; x?: number; y?: number; n?: number }> =
  ({ at, x = 960, y = 520, n = 26 }) => {
  const f = useCurrentFrame();
  const t = f - at;
  if (t < 0 || t > 40) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {new Array(n).fill(0).map((_, i) => {
        const a = (i / n) * Math.PI * 2 + (i % 3) * 0.31;
        const v = 9 + (i % 5) * 3.4;
        const px = x + Math.cos(a) * v * t;
        const py = y + Math.sin(a) * v * t + t * t * 0.16;
        const o = interpolate(t, [0, 8, 40], [0, 1, 0]);
        return (
          <div key={i} style={{
            position: 'absolute', left: px, top: py, width: 3 + (i % 3), height: 3 + (i % 3),
            borderRadius: '50%', background: i % 3 ? GOLD_HOT : INK, opacity: o,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

/* one bright frame at a cut: the edit hits instead of dissolving */
const Flash: React.FC<{ at: number; strength?: number }> = ({ at, strength = 0.5 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - at, [-2, 0, 7], [0, strength, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (o <= 0) return null;
  return <AbsoluteFill style={{ background: GOLD_HOT, opacity: o, pointerEvents: 'none' }} />;
};

/* slow cinematic drift for a whole scene */
const Camera: React.FC<{ children: React.ReactNode; from?: number; to?: number; driftX?: number }> =
  ({ children, from = 1.04, to = 1.0, driftX = 0 }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, 170], [from, to], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const x = interpolate(f, [0, 170], [0, driftX], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ transform: `scale(${z}) translateX(${x}px)` }}>{children}</AbsoluteFill>;
};

/* impact shake, decaying */
const shake = (f: number, at: number, power = 10) => {
  const t = f - at;
  if (t < 0 || t > 16) return 'translate(0,0)';
  const d = power * (1 - t / 16);
  return `translate(${Math.sin(t * 2.6) * d}px, ${Math.cos(t * 3.4) * d * 0.6}px)`;
};

const Eyebrow: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ls = interpolate(f - delay, [0, 26], [0.9, 0.42], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{
      fontFamily: CINZEL, fontWeight: 700, fontSize: 22, letterSpacing: `${ls}em`,
      color: GOLD, opacity: o, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>{children}</div>
  );
};

/* headline that arrives out of blur — the trailer move */
const Slam: React.FC<{ children: React.ReactNode; delay?: number; size?: number; color?: string }> =
  ({ children, delay = 0, size = 96, color = INK }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 16, mass: 0.9, stiffness: 130 } });
  const blur = interpolate(f - delay, [0, 14], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{
      fontFamily: CINZEL, fontWeight: 700, fontSize: size, color,
      letterSpacing: '0.05em', lineHeight: 1.05, textAlign: 'center',
      opacity: s, transform: `scale(${1.12 - s * 0.12})`, filter: `blur(${blur}px)`,
      textShadow: '0 10px 50px rgba(0,0,0,.8)',
    }}>{children}</div>
  );
};

const Sub: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{
      fontFamily: OUTFIT, fontWeight: 400, fontSize: 29, color: '#b5ab99',
      opacity: o, textAlign: 'center', maxWidth: 1150, lineHeight: 1.45,
    }}>{children}</div>
  );
};

/* a real card face with 3D presence */
const CardFace: React.FC<{
  slug: string; name: string; rank: number; type: string; power: number;
  delay?: number; tilt?: number; w?: number;
}> = ({ slug, name, rank, type, power, delay = 0, tilt = 0, w = 330 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 22, mass: 1.05, stiffness: 110 } });
  const rc = MATERIALS[rank];
  const hover = Math.sin((f - delay) / 34) * 4;
  return (
    <div style={{ perspective: 1100 }}>
      <div style={{
        width: w, borderRadius: 18, overflow: 'hidden', background: '#141109',
        border: `2px solid ${rc}`, boxShadow: `0 34px 80px rgba(0,0,0,.75), 0 0 52px -12px ${rc}`,
        opacity: s,
        transform: `rotateY(${tilt * (1 - s * 0.25)}deg) translateY(${(1 - s) * 70 + hover}px) scale(${0.92 + s * 0.08})`,
      }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
          <Img src={card(slug)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, transparent 55%, rgba(5,4,2,.92))',
          }} />
          {/* light sweep across the face as it lands */}
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(115deg, transparent 30%, rgba(255,240,200,.22) 46%, transparent 60%)`,
            transform: `translateX(${interpolate(f - delay, [6, 40], [-560, 560], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
          }} />
          <div style={{
            position: 'absolute', top: 12, right: 12, padding: '5px 11px', borderRadius: 20,
            background: 'rgba(11,10,8,.86)', border: `1px solid ${rc}`,
            fontFamily: MONO, fontSize: 17, fontWeight: 700, color: INK,
          }}>⚡ {power}</div>
          <div style={{
            position: 'absolute', top: 12, left: 12, padding: '4px 10px', borderRadius: 5,
            background: 'rgba(11,10,8,.8)', border: `1px solid ${rc}`,
            fontFamily: CINZEL, fontSize: 12, fontWeight: 700, letterSpacing: '.2em', color: rc,
          }}>{['FOOTMAN', 'KNIGHT', 'HIGHLORD', 'SOVEREIGN'][rank]}</div>
        </div>
        <div style={{ padding: '13px 16px 16px' }}>
          <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 24, color: INK }}>{name}</div>
          <div style={{ fontFamily: OUTFIT, fontSize: 14, letterSpacing: '0.17em', color: rc, marginTop: 4 }}>
            {type.toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------- scenes ---------------- */

// 0–78 · the hook: an empty throne, two hard lines
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const push = interpolate(f, [0, 78], [1.12, 1.22], { easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        <Img src={card('the-cracked-crown')} style={{
          width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.62) saturate(.92)',
        }} />
      </AbsoluteFill>
      <AbsoluteFill style={{
        background: 'linear-gradient(180deg, rgba(4,3,1,.68), transparent 34%, transparent 62%, rgba(4,3,1,.85))',
      }} />
      <Vignette amount={0.8} />
      <Grain />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 14, paddingTop: 340 }}>
        <Slam size={78} delay={10}>THE THRONE OF EMBERFALL</Slam>
        <Slam size={104} delay={34} color={GOLD_HOT}>SITS EMPTY.</Slam>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 78–160 · title stinger: the shield falls, the realm is named
const Title: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fall = interpolate(f, [0, 18], [-460, 0], { extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const wm = spring({ frame: f - 22, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ transform: shake(f, 18, 14) }}>
      <Ground glow={1.2} />
      <Embers count={36} />
      <Vignette />
      <Grain />
      <Burst at={18} y={430} n={30} />
      <Flash at={18} strength={0.35} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 22 }}>
        <Img src={staticFile('shield.webp')} style={{
          width: 190, transform: `translateY(${fall}px)`,
          filter: 'drop-shadow(0 0 60px rgba(212,168,67,.6))',
        }} />
        <div style={{
          fontFamily: CINZEL, fontWeight: 700, fontSize: 128,
          letterSpacing: `${interpolate(f, [22, 60], [0.3, 0.13], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}em`,
          color: INK, opacity: wm,
        }}>EMBERFALL</div>
        <div style={{
          width: interpolate(f, [30, 58], [0, 640], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          height: 2, background: GOLD,
        }} />
        <Eyebrow delay={38}>a fully onchain trading card game</Eyebrow>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 160–330 · summon: the Sovereign turns to face you, then the court assembles
const Summon: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flip = spring({ frame: f - 14, fps, config: { damping: 19, mass: 1.2, stiffness: 80 } });
  const deg = interpolate(flip, [0, 1], [178, 0]);
  const showCourt = f >= 84;
  return (
    <AbsoluteFill>
      <Ground glow={1.1} />
      <Embers heat={1.2} />
      <Vignette />
      <Grain />
      <Flash at={86} strength={0.28} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 16 }}>
        <Eyebrow>Summon</Eyebrow>
        <div style={{ marginTop: 10 }}>
          <Slam size={58} delay={4}>One of a kind, struck at birth</Slam>
        </div>
        {!showCourt ? (
          <div style={{ marginTop: 46, perspective: 1300 }}>
            <div style={{ transform: `rotateY(${deg}deg)`, transformStyle: 'preserve-3d' }}>
              {deg > 90 ? (
                <div style={{
                  width: 360, aspectRatio: '10 / 13', borderRadius: 18,
                  background: 'radial-gradient(120% 120% at 50% 30%, #241d12, #0f0d0a 72%)',
                  border: `1.5px solid ${GOLD}`, display: 'grid', placeItems: 'center',
                  transform: 'rotateY(180deg)',
                }}>
                  <Img src={staticFile('shield.webp')} style={{ width: 150, opacity: 0.95 }} />
                </div>
              ) : (
                <CardFace slug="the-winter-sovereign" name="The Winter Sovereign" rank={3}
                  type="Firstborn" power={216} w={360} />
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 40, marginTop: 46, alignItems: 'center' }}>
            <CardFace slug="pitchfork-militiaman" name="Pitchfork Militiaman" rank={0} type="Levy" power={13} delay={86} tilt={16} w={300} />
            <CardFace slug="chained-shade" name="Chained Shade" rank={1} type="Undead" power={41} delay={94} tilt={7} w={300} />
            <CardFace slug="the-drowned-admiral" name="The Drowned Admiral" rank={2} type="Undead" power={98} delay={102} tilt={-7} w={300} />
            <CardFace slug="the-winter-sovereign" name="The Winter Sovereign" rank={3} type="Firstborn" power={216} delay={110} tilt={-16} w={300} />
          </div>
        )}
        <div style={{ marginTop: 36 }}>
          <Sub delay={118}>180 illustrated champions. Every one a real token in your wallet.</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 330–430 · the mines
const Mine: React.FC = () => {
  const f = useCurrentFrame();
  const ember = Math.round(interpolate(f, [8, 86], [0, 57600], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }));
  const pulse = 1 + Math.sin(f / 5) * 0.012;
  return (
    <AbsoluteFill>
      <Camera from={1.0} to={1.06}>
        <Ground glow={1.35} />
        <Embers count={48} heat={1.6} />
      </Camera>
      <Vignette />
      <Grain />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <Eyebrow>Mine</Eyebrow>
        <Slam size={64} delay={6}>Soulstone sweats Ember</Slam>
        <div style={{
          fontFamily: MONO, fontSize: 138, fontWeight: 700, color: GOLD_HOT,
          textShadow: '0 0 70px rgba(232,190,85,.5)', marginTop: 4, transform: `scale(${pulse})`,
        }}>{ember.toLocaleString('en-US')}</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 25, color: '#b5ab99', letterSpacing: '.2em' }}>
          EMBER A DAY FROM ONE SOVEREIGN
        </div>
        <div style={{ marginTop: 18 }}>
          <Sub delay={56}>Temper their aspects. Forge greater bloodlines. Send them delving.</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 430–620 · trial by combat
const Fight: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rounds = [
    { name: 'ATTACK', mine: 18, theirs: 10, at: 30 },
    { name: 'DEFENSE', mine: 19, theirs: 22, at: 54 },
    { name: 'CUNNING', mine: 43, theirs: 12, at: 78 },
  ];
  const verdict = spring({ frame: f - 112, fps, config: { damping: 11, mass: 1.2 } });
  const sh = rounds.reduce((acc, r) => acc === 'translate(0,0)' ? shake(f, r.at + 16, 7) : acc, shake(f, 128, 13));
  return (
    <AbsoluteFill style={{ transform: sh }}>
      <Ground glow={1.4} />
      <Embers count={46} heat={1.4} />
      <Vignette />
      <Grain />
      <Flash at={128} strength={0.4} />
      <Burst at={128} y={780} n={32} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 12 }}>
        <Eyebrow>Fight</Eyebrow>
        <div style={{ marginTop: 8 }}>
          <Slam size={56} delay={4}>Trial by combat, best of three</Slam>
        </div>
        <div style={{ display: 'flex', gap: 56, marginTop: 34, alignItems: 'center' }}>
          <CardFace slug="grave-singer" name="Grave Singer" rank={1} type="Mystic" power={40} delay={10} tilt={14} w={300} />
          <div style={{ width: 520 }}>
            {rounds.map((r, i) => {
              const p = interpolate(f - r.at, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
              const pct = (r.mine / (r.mine + r.theirs)) * 100;
              const won = r.mine > r.theirs;
              return (
                <div key={i} style={{ marginBottom: 22, opacity: p }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', fontFamily: OUTFIT,
                    fontSize: 18, letterSpacing: '.16em', color: '#b5ab99', marginBottom: 8,
                  }}>
                    <span>{r.name}</span>
                    <span style={{ fontFamily: MONO, color: won ? GOLD_HOT : '#8e887a' }}>
                      {Math.round(pct * p)}% yours
                    </span>
                  </div>
                  <div style={{ height: 26, borderRadius: 6, overflow: 'hidden', display: 'flex', background: '#1a1610' }}>
                    <div style={{ width: `${pct * p}%`, background: `linear-gradient(90deg, ${GOLD_HOT}, ${GOLD})` }} />
                    <div style={{ flex: 1, background: '#2a2419' }} />
                  </div>
                </div>
              );
            })}
          </div>
          <CardFace slug="storm-caller" name="Storm Caller" rank={1} type="Mystic" power={26} delay={18} tilt={-14} w={300} />
        </div>
        <div style={{
          marginTop: 26, fontFamily: CINZEL, fontWeight: 700, fontSize: 64, letterSpacing: '.14em',
          color: GOLD_HOT, opacity: verdict, transform: `scale(${0.82 + verdict * 0.18})`,
          textShadow: '0 0 60px rgba(232,190,85,.6)',
        }}>VICTORY</div>
        <div style={{ marginTop: 8 }}>
          <Sub delay={124}>Sealed stances · 3v3 squads · a ranked ladder · wager Ember on any fight</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 620–745 · the living realm
const Realm: React.FC = () => {
  const f = useCurrentFrame();
  const hp = interpolate(f, [16, 92], [100, 31], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const lines = [
    'heyman fused two champions into Waking Gargoyle',
    'Mira Halvorsen won a 25-Ember ranked match',
    'tunnelrat put Cart Mule up for 1.80 HTR',
    'Ser Bedwyr struck the world boss for 340',
  ];
  return (
    <AbsoluteFill>
      <Camera from={1.05} to={1.0}>
        <Ground />
        <Embers count={30} />
      </Camera>
      <Vignette />
      <Grain />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 16 }}>
        <Eyebrow>The realm</Eyebrow>
        <div style={{ marginTop: 8 }}>
          <Slam size={54} delay={4}>Bosses, guilds, tournaments, a market</Slam>
        </div>
        <div style={{ width: 1080, marginTop: 40, transform: shake(f, 90, 5) }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', fontFamily: CINZEL,
            fontSize: 27, color: INK, marginBottom: 12,
          }}>
            <span>The Unmourned King</span>
            <span style={{ fontFamily: MONO, color: GOLD }}>{Math.round(hp * 55)} / 5 500</span>
          </div>
          <div style={{ height: 22, borderRadius: 6, overflow: 'hidden', background: '#241c14' }}>
            <div style={{ width: `${hp}%`, height: '100%', background: `linear-gradient(90deg, #e2733c, ${GOLD_HOT})` }} />
          </div>
        </div>
        <div style={{ width: 1080, marginTop: 36 }}>
          {lines.map((l, i) => {
            const o = interpolate(f - (26 + i * 13), [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const x = interpolate(f - (26 + i * 13), [0, 16], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
            return (
              <div key={i} style={{
                display: 'flex', gap: 18, padding: '13px 4px', opacity: o, transform: `translateX(${x}px)`,
                borderBottom: '1px solid rgba(255,245,230,.09)', fontFamily: OUTFIT, fontSize: 23, color: '#d8d0c0',
              }}>
                <span style={{ fontFamily: MONO, fontSize: 18, color: '#8a8170', minWidth: 92 }}>just now</span>
                <span>{l}</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 745–900 · the close
const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 200 } });
  const url = spring({ frame: f - 30, fps, config: { damping: 13, mass: 1 } });
  const urlPulse = 1 + Math.sin(Math.max(0, f - 44) / 9) * 0.02;
  const fadeOut = interpolate(f, [132, 152], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <Camera from={1.0} to={1.05}>
        <Ground glow={1.5} />
        <Embers count={50} heat={1.2} />
      </Camera>
      <Vignette />
      <Grain />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <Img src={staticFile('shield.webp')} style={{
          width: 150, opacity: s, transform: `translateY(${(1 - s) * 22}px)`,
          filter: 'drop-shadow(0 0 55px rgba(212,168,67,.62))',
        }} />
        <div style={{
          fontFamily: CINZEL, fontWeight: 700, fontSize: 112, letterSpacing: '0.13em',
          color: INK, opacity: s,
        }}>EMBERFALL</div>
        <div style={{ width: 560, height: 2, background: GOLD, opacity: s * 0.9 }} />
        <div style={{
          fontFamily: CINZEL, fontWeight: 700, fontSize: 50, letterSpacing: '0.08em',
          color: GOLD_HOT, opacity: url, transform: `scale(${(0.9 + url * 0.1) * urlPulse})`, marginTop: 10,
          textShadow: '0 0 44px rgba(232,190,85,.4)',
        }}>emberfall.fun</div>
        <div style={{ marginTop: 4 }}>
          <Sub delay={44}>Free to play on testnet · every deed witnessed forever on Hathor</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------------- the cut: hard edits, flashes at the joins ---------------- */

const FadeIn: React.FC<{ children: React.ReactNode; len: number; out?: boolean }> =
  ({ children, len, out = false }) => {
  const f = useCurrentFrame();
  const o = Math.min(
    interpolate(f, [0, 8], [0, 1], { extrapolateRight: 'clamp' }),
    out ? interpolate(f, [len - 10, len], [1, 0], { extrapolateLeft: 'clamp' }) : 1,
  );
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Promo: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={0} durationInFrames={78}><Hook /></Sequence>
      <Sequence from={78} durationInFrames={82}><Title /></Sequence>
      <Sequence from={160} durationInFrames={170}><FadeIn len={170}><Summon /></FadeIn></Sequence>
      <Sequence from={330} durationInFrames={100}><FadeIn len={100}><Mine /></FadeIn></Sequence>
      <Sequence from={430} durationInFrames={190}><FadeIn len={190}><Fight /></FadeIn></Sequence>
      <Sequence from={620} durationInFrames={125}><FadeIn len={125}><Realm /></FadeIn></Sequence>
      <Sequence from={745} durationInFrames={155}><FadeIn len={155}><Close /></FadeIn></Sequence>
      {/* the joins hit rather than dissolve */}
      <Flash at={78} strength={0.55} />
      <Flash at={160} strength={0.3} />
      <Flash at={330} strength={0.3} />
      <Flash at={430} strength={0.35} />
      <Flash at={620} strength={0.3} />
      <Flash at={745} strength={0.3} />
    </AbsoluteFill>
  );
};
