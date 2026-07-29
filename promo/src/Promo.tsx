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

/* Emberfall's own palette: the realm is lit by one gold on near-black, and
   rank is a material, not an MMO rarity hue. */
const INK = '#f4efe6';
const GOLD = '#d4a843';
const GOLD_HOT = '#e8be55';
const BG = '#0b0a08';
const MATERIALS = ['#8e887a', '#7fa0bd', '#5fa894', '#e8ae3f'];

const card = (slug: string) => staticFile(`cards/${slug}.jpg`);

/* ---------------- shared furniture ---------------- */

const Ground: React.FC<{ glow?: number }> = ({ glow = 1 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: BG }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 800px at 50% ${38 + Math.sin(f / 60) * 3}%,
            rgba(212,168,67,${0.16 * glow}), transparent 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.05,
          background: `repeating-linear-gradient(0deg, transparent 0 46px, ${GOLD} 46px 47px),
                       repeating-linear-gradient(90deg, transparent 0 46px, ${GOLD} 46px 47px)`,
        }}
      />
    </AbsoluteFill>
  );
};

// embers drifting up, the one piece of ambient motion the game itself uses
const Embers: React.FC<{ count?: number }> = ({ count = 26 }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      {new Array(count).fill(0).map((_, i) => {
        const seed = (i * 97) % 100;
        const x = (seed / 100) * 1920;
        const speed = 0.6 + ((i % 5) * 0.25);
        const y = 1180 - ((f * speed * 6 + seed * 11) % 1300);
        const s = 2 + (i % 3);
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: x + Math.sin((f + seed) / 24) * 26, top: y,
              width: s, height: s, borderRadius: '50%',
              background: i % 4 === 0 ? GOLD_HOT : GOLD,
              opacity: 0.16 + ((i % 4) * 0.12),
              filter: 'blur(0.5px)',
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(f - delay, [0, 20], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <div style={{
      fontFamily: CINZEL, fontWeight: 700, fontSize: 22, letterSpacing: '0.42em',
      color: GOLD, opacity: o, transform: `translateY(${y}px)`, textTransform: 'uppercase',
    }}>{children}</div>
  );
};

const Headline: React.FC<{ children: React.ReactNode; delay?: number; size?: number }> =
  ({ children, delay = 0, size = 92 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 200, mass: 0.7 } });
  return (
    <div style={{
      fontFamily: CINZEL, fontWeight: 700, fontSize: size, color: INK,
      letterSpacing: '0.04em', lineHeight: 1.04, textAlign: 'center',
      opacity: s, transform: `translateY(${(1 - s) * 26}px)`,
      textShadow: '0 8px 40px rgba(0,0,0,.7)',
    }}>{children}</div>
  );
};

const Sub: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{
      fontFamily: OUTFIT, fontWeight: 400, fontSize: 30, color: '#b5ab99',
      opacity: o, textAlign: 'center', maxWidth: 1150, lineHeight: 1.45,
    }}>{children}</div>
  );
};

/* A real card face, drawn the way the game draws one. */
const CardFace: React.FC<{
  slug: string; name: string; rank: number; type: string; power: number;
  delay?: number; rise?: number;
}> = ({ slug, name, rank, type, power, delay = 0, rise = 40 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 26, mass: 1.1, stiffness: 120 } });
  const rc = MATERIALS[rank];
  return (
    <div style={{
      width: 340, borderRadius: 18, overflow: 'hidden', background: '#141109',
      border: `2px solid ${rc}`, boxShadow: `0 30px 70px rgba(0,0,0,.72), 0 0 46px -12px ${rc}`,
      opacity: s, transform: `translateY(${(1 - s) * rise}px) scale(${0.94 + s * 0.06})`,
    }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
        <Img src={card(slug)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, transparent 55%, rgba(5,4,2,.92))',
        }} />
        <div style={{
          position: 'absolute', top: 12, right: 12, padding: '5px 11px', borderRadius: 20,
          background: 'rgba(11,10,8,.86)', border: `1px solid ${rc}`,
          fontFamily: MONO, fontSize: 17, fontWeight: 700, color: INK,
        }}>⚡ {power}</div>
      </div>
      <div style={{ padding: '14px 16px 18px' }}>
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 25, color: INK }}>{name}</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 15, letterSpacing: '0.16em', color: rc, marginTop: 4 }}>
          {['FOOTMAN', 'KNIGHT', 'HIGHLORD', 'SOVEREIGN'][rank]} · {type.toUpperCase()}
        </div>
      </div>
    </div>
  );
};

/* ---------------- scenes ---------------- */

// 0–110 · the throne is empty
const Open: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame: f - 4, fps, config: { damping: 14, mass: 1.4, stiffness: 90 } });
  const fall = interpolate(f, [0, 34], [-220, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const wm = spring({ frame: f - 22, fps, config: { damping: 200 } });
  const zoom = interpolate(f, [0, 110], [1.06, 1.0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Ground />
      <Embers count={34} />
      <AbsoluteFill style={{
        justifyContent: 'center', alignItems: 'center', gap: 22, transform: `scale(${zoom})`,
      }}>
        <div style={{ opacity: mark, transform: `translateY(${fall}px)` }}>
          <Img src={staticFile('mark.png')} style={{ width: 132, filter: 'drop-shadow(0 0 44px rgba(212,168,67,.55))' }} />
        </div>
        <div style={{
          fontFamily: CINZEL, fontWeight: 700, fontSize: 124, letterSpacing: '0.13em',
          color: INK, opacity: wm, transform: `scale(${0.96 + wm * 0.04})`,
        }}>EMBERFALL</div>
        <div style={{ width: 620, height: 2, background: GOLD, opacity: wm * 0.9 }} />
        <Eyebrow delay={40}>a fully onchain trading card game</Eyebrow>
        <div style={{ marginTop: 16 }}>
          <Sub delay={58}>The throne of Emberfall sits empty. A host must be raised.</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 110–290 · summon: three champions answer, rarity climbing
const Summon: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Ground />
      <Embers />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 24 }}>
        <Eyebrow>Summon</Eyebrow>
        <div style={{ marginTop: 14 }}>
          <Headline size={62} delay={6}>One of a kind, struck at birth</Headline>
        </div>
        <div style={{ display: 'flex', gap: 46, marginTop: 54, alignItems: 'flex-end' }}>
          <div style={{ transform: `translateY(${interpolate(f, [30, 70], [0, -10], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)` }}>
            <CardFace slug="grain-weevil" name="Grain Weevil" rank={0} type="Vermin" power={12} delay={22} />
          </div>
          <div style={{ transform: `translateY(${interpolate(f, [46, 86], [0, -22], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)` }}>
            <CardFace slug="sewer-baron" name="Sewer Baron" rank={1} type="Vermin" power={38} delay={40} />
          </div>
          <div style={{ transform: `translateY(${interpolate(f, [62, 102], [0, -34], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)` }}>
            <CardFace slug="the-last-king" name="The Last King" rank={3} type="Undead" power={271} delay={58} />
          </div>
        </div>
        <div style={{ marginTop: 44 }}>
          <Sub delay={86}>180 illustrated champions. Every one a real token in your wallet.</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 290–450 · the mines: Ember by the minute
const Mine: React.FC = () => {
  const f = useCurrentFrame();
  const ember = Math.round(interpolate(f, [10, 120], [0, 57600], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }));
  return (
    <AbsoluteFill>
      <Ground />
      <Embers count={40} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <Eyebrow>Mine</Eyebrow>
        <Headline size={68} delay={8}>Soulstone sweats Ember</Headline>
        <div style={{
          fontFamily: MONO, fontSize: 132, fontWeight: 700, color: GOLD_HOT,
          textShadow: `0 0 60px rgba(232,190,85,.45)`, marginTop: 8,
        }}>{ember.toLocaleString('en-US')}</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 26, color: '#b5ab99', letterSpacing: '.18em' }}>
          EMBER A DAY FROM ONE SOVEREIGN
        </div>
        <div style={{ marginTop: 26 }}>
          <Sub delay={70}>Temper their aspects. Forge greater bloodlines. Send them delving.</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 450–650 · trial by combat, three rounds
const Fight: React.FC = () => {
  const f = useCurrentFrame();
  const rounds = [
    { name: 'ATTACK', mine: 18, theirs: 10, at: 26 },
    { name: 'DEFENSE', mine: 19, theirs: 22, at: 46 },
    { name: 'CUNNING', mine: 43, theirs: 12, at: 66 },
  ];
  const verdict = spring({ frame: f - 96, fps: 30, config: { damping: 12, mass: 1.2 } });
  return (
    <AbsoluteFill>
      <Ground glow={1.3} />
      <Embers count={44} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 18 }}>
        <Eyebrow>Fight</Eyebrow>
        <div style={{ marginTop: 12 }}>
          <Headline size={60} delay={6}>Trial by combat, best of three</Headline>
        </div>
        <div style={{ display: 'flex', gap: 60, marginTop: 40, alignItems: 'center' }}>
          <CardFace slug="grave-singer" name="Grave Singer" rank={1} type="Mystic" power={40} delay={14} rise={60} />
          <div style={{ width: 520 }}>
            {rounds.map((r, i) => {
              const p = interpolate(f - r.at, [0, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
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
          <CardFace slug="storm-caller" name="Storm Caller" rank={1} type="Mystic" power={26} delay={22} rise={60} />
        </div>
        <div style={{
          marginTop: 30, fontFamily: CINZEL, fontWeight: 700, fontSize: 58, letterSpacing: '.12em',
          color: GOLD_HOT, opacity: verdict, transform: `scale(${0.9 + verdict * 0.1})`,
          textShadow: '0 0 50px rgba(232,190,85,.5)',
        }}>VICTORY</div>
        <div style={{ marginTop: 10 }}>
          <Sub delay={104}>Sealed stances · 3v3 squads · a ranked ladder · wager Ember on any fight</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 650–790 · the realm: bosses, guilds, market
const Realm: React.FC = () => {
  const f = useCurrentFrame();
  const hp = interpolate(f, [20, 100], [100, 34], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lines = [
    'heyman fused two champions into Waking Gargoyle',
    'Mira Halvorsen won a 25-Ember ranked match',
    'tunnelrat put Cart Mule up for 1.80 HTR',
    'Ser Bedwyr struck the world boss for 340',
  ];
  return (
    <AbsoluteFill>
      <Ground />
      <Embers count={30} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 20 }}>
        <Eyebrow>The realm</Eyebrow>
        <div style={{ marginTop: 12 }}>
          <Headline size={58} delay={6}>Bosses, guilds, tournaments, a market</Headline>
        </div>
        <div style={{ width: 1080, marginTop: 46 }}>
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
        <div style={{ width: 1080, marginTop: 40 }}>
          {lines.map((l, i) => {
            const o = interpolate(f - (34 + i * 15), [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const x = interpolate(f - (34 + i * 15), [0, 18], [26, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
            return (
              <div key={i} style={{
                display: 'flex', gap: 18, padding: '13px 4px', opacity: o, transform: `translateX(${x}px)`,
                borderBottom: '1px solid rgba(255,245,230,.09)', fontFamily: OUTFIT, fontSize: 23, color: '#d8d0c0',
              }}>
                <span style={{ fontFamily: MONO, fontSize: 18, color: '#776f60', minWidth: 92 }}>just now</span>
                <span>{l}</span>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 790–900 · the close
const Close: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 6, fps, config: { damping: 200 } });
  const url = spring({ frame: f - 34, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Ground glow={1.4} />
      <Embers count={46} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <Img src={staticFile('mark.png')} style={{
          width: 120, opacity: s, transform: `translateY(${(1 - s) * 20}px)`,
          filter: 'drop-shadow(0 0 50px rgba(212,168,67,.6))',
        }} />
        <div style={{
          fontFamily: CINZEL, fontWeight: 700, fontSize: 116, letterSpacing: '0.13em',
          color: INK, opacity: s,
        }}>EMBERFALL</div>
        <div style={{ width: 560, height: 2, background: GOLD, opacity: s * 0.9 }} />
        <div style={{
          fontFamily: CINZEL, fontWeight: 700, fontSize: 44, letterSpacing: '0.08em',
          color: GOLD_HOT, opacity: url, transform: `scale(${0.94 + url * 0.06})`, marginTop: 12,
        }}>emberfall.fun</div>
        <div style={{ marginTop: 6 }}>
          <Sub delay={48}>Free to play on testnet · every deed witnessed forever on Hathor</Sub>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------------- the cut ---------------- */

const Fade: React.FC<{ children: React.ReactNode; len: number }> = ({ children, len }) => {
  const f = useCurrentFrame();
  const o = Math.min(
    interpolate(f, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
    interpolate(f, [len - 12, len], [1, 0], { extrapolateLeft: 'clamp' }),
  );
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <Sequence from={0} durationInFrames={112}><Fade len={112}><Open /></Fade></Sequence>
    <Sequence from={110} durationInFrames={182}><Fade len={182}><Summon /></Fade></Sequence>
    <Sequence from={290} durationInFrames={162}><Fade len={162}><Mine /></Fade></Sequence>
    <Sequence from={450} durationInFrames={202}><Fade len={202}><Fight /></Fade></Sequence>
    <Sequence from={650} durationInFrames={142}><Fade len={142}><Realm /></Fade></Sequence>
    <Sequence from={790} durationInFrames={110}><Fade len={110}><Close /></Fade></Sequence>
  </AbsoluteFill>
);
