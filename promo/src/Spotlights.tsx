import React from 'react';
import {
  AbsoluteFill, Img, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing,
} from 'remotion';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import {
  Ground, Vignette, Grain, Embers, Burst, Flash, shake,
  Eyebrow, Slam, Sub, CardFace,
} from './Promo';

const { fontFamily: CINZEL } = loadCinzel();
const { fontFamily: OUTFIT } = loadOutfit();
const { fontFamily: MONO } = loadMono();

const INK = '#f4efe6';
const MUTED = '#b5ab99';
const GOLD = '#d4a843';
const GOLD_HOT = '#e8be55';

/* the standing sign-off strip every asset shares */
const Footer: React.FC<{ delay?: number; still?: boolean }> = ({ delay = 0, still = false }) => {
  const f = useCurrentFrame();
  const o = still ? 1 : interpolate(f - delay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{
      position: 'absolute', bottom: 38, left: 0, right: 0, display: 'flex',
      justifyContent: 'center', gap: 28, alignItems: 'baseline', opacity: o,
      fontFamily: OUTFIT, fontSize: 19, color: MUTED,
    }}>
      <span style={{ fontFamily: CINZEL, fontWeight: 700, color: GOLD, fontSize: 21 }}>emberfall.fun</span>
      <span>fully onchain TCG · free on testnet · $HTR</span>
    </div>
  );
};

const FadeOut: React.FC<{ children: React.ReactNode; len: number }> = ({ children, len }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [len - 14, len - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

/* ---------------- tweet 1 · the forge (clip) ---------------- */

export const ForgeClip: React.FC = () => {
  const f = useCurrentFrame();
  const MEET = 104;
  // parents close in, tilting harder as they near the strike
  const x = interpolate(f, [16, MEET], [560, 172], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  const tilt = interpolate(f, [16, MEET], [10, 30], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const parentsGone = f >= MEET;
  return (
    <FadeOut len={300}>
      <AbsoluteFill style={{ transform: shake(f, MEET, 13) }}>
        <Ground glow={1.3} />
        <Embers count={40} heat={1.4} />
        <Vignette />
        <Grain />
        <Flash at={MEET} strength={0.5} />
        <Burst at={MEET} y={600} n={34} />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 10 }}>
          <Eyebrow>The forge</Eyebrow>
          <div style={{ marginTop: 8 }}>
            <Slam size={62} delay={6}>TWO GO IN. ONE IS BORN.</Slam>
          </div>
          <div style={{ position: 'relative', height: 560, width: 1400, marginTop: 30 }}>
            {!parentsGone && (<>
              <div style={{ position: 'absolute', left: '50%', top: 0, transform: `translateX(${-x - 150}px)` }}>
                <CardFace slug="grave-singer" name="Grave Singer" rank={1} type="Mystic" power={40} delay={10} tilt={tilt} w={300} />
              </div>
              <div style={{ position: 'absolute', left: '50%', top: 0, transform: `translateX(${x - 150}px)` }}>
                <CardFace slug="storm-caller" name="Storm Caller" rank={1} type="Mystic" power={26} delay={16} tilt={-tilt} w={300} />
              </div>
            </>)}
            {parentsGone && (
              <div style={{ position: 'absolute', left: '50%', top: -12, transform: 'translateX(-170px)' }}>
                <CardFace slug="the-drowned-admiral" name="The Drowned Admiral" rank={2} type="Undead" power={98} delay={MEET + 4} w={340} />
              </div>
            )}
          </div>
          <Sub delay={150}>Both parents lock in the forge&rsquo;s vault forever. The card that returns is one rank higher.</Sub>
        </AbsoluteFill>
        <Footer delay={196} />
      </AbsoluteFill>
    </FadeOut>
  );
};

/* ---------------- tweet 5 · the world boss (clip) ---------------- */

export const WorldBossClip: React.FC = () => {
  const f = useCurrentFrame();
  const hp = interpolate(f, [26, 168], [100, 31], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const strikes = [
    { at: 44, line: 'heyman struck the world boss for 415' },
    { at: 72, line: 'Ser Bedwyr struck for 340 · Kettle & Crown' },
    { at: 100, line: 'Mira Halvorsen struck for 288' },
    { at: 128, line: 'tunnelrat struck for 152' },
  ];
  const sh = strikes.reduce((acc, s) => acc === 'translate(0,0)' ? shake(f, s.at, 6) : acc, 'translate(0,0)');
  return (
    <FadeOut len={240}>
      <AbsoluteFill style={{ transform: sh }}>
        <Ground glow={1.35} />
        <Embers count={40} heat={1.3} />
        <Vignette />
        <Grain />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 20 }}>
          <Eyebrow>The world boss</Eyebrow>
          <div style={{ marginTop: 8 }}>
            <Slam size={60} delay={6}>ONE BOSS. EVERY GUILD. SEVEN DAYS.</Slam>
          </div>
          <div style={{ width: 1080, marginTop: 44 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', fontFamily: CINZEL,
              fontSize: 30, color: INK, marginBottom: 12,
            }}>
              <span>The Unmourned King</span>
              <span style={{ fontFamily: MONO, color: GOLD }}>{Math.round(hp * 55).toLocaleString('en-US')} / 5,500</span>
            </div>
            <div style={{ height: 24, borderRadius: 6, overflow: 'hidden', background: '#241c14' }}>
              <div style={{ width: `${hp}%`, height: '100%', background: `linear-gradient(90deg, #e2733c, ${GOLD_HOT})` }} />
            </div>
          </div>
          <div style={{ width: 1080, marginTop: 30 }}>
            {strikes.map((s, i) => {
              const o = interpolate(f - s.at, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              const tx = interpolate(f - s.at, [0, 16], [34, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
              return (
                <div key={i} style={{
                  display: 'flex', gap: 18, padding: '12px 4px', opacity: o, transform: `translateX(${tx}px)`,
                  borderBottom: '1px solid rgba(255,245,230,.09)', fontFamily: OUTFIT, fontSize: 23, color: '#d8d0c0',
                }}>
                  <span style={{ fontFamily: MONO, fontSize: 18, color: '#8a8170', minWidth: 92 }}>just now</span>
                  <span>{s.line}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 28 }}>
            <Sub delay={158}>Staked champions strike under their guild&rsquo;s banner. The bounty pool pays by damage dealt.</Sub>
          </div>
        </AbsoluteFill>
        <Footer delay={190} />
      </AbsoluteFill>
    </FadeOut>
  );
};

/* ---------------- still furniture (Graphic.tsx language) ---------------- */

const StillShell: React.FC<{ eyebrow: string; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode }> =
  ({ eyebrow, title, sub, children }) => (
  <AbsoluteFill>
    <Ground glow={1.15} />
    <Embers count={26} />
    <Vignette />
    <Grain />
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 46 }}>
      <div style={{
        fontFamily: CINZEL, fontWeight: 700, fontSize: 21, letterSpacing: '.42em',
        color: GOLD, textTransform: 'uppercase',
      }}>{eyebrow}</div>
      <div style={{
        fontFamily: CINZEL, fontWeight: 700, fontSize: 54, color: INK,
        marginTop: 18, letterSpacing: '.03em', textAlign: 'center',
      }}>{title}</div>
      {sub && <div style={{
        fontFamily: OUTFIT, fontSize: 21, color: MUTED, marginTop: 14,
        maxWidth: 980, textAlign: 'center', lineHeight: 1.5,
      }}>{sub}</div>}
      {children}
    </AbsoluteFill>
    <Footer still />
  </AbsoluteFill>
);

const StillBox: React.FC<{ title: string; sub: string; icon: string; w?: number; glow?: boolean }> =
  ({ title, sub, icon, w = 330, glow = false }) => (
  <div style={{
    width: w, borderRadius: 16, padding: '24px 22px', textAlign: 'center',
    background: 'linear-gradient(180deg, #17130c, #100d09)',
    border: `1.5px solid ${glow ? GOLD : 'rgba(212,168,67,.35)'}`,
    boxShadow: glow ? '0 0 44px -8px rgba(212,168,67,.5)' : '0 18px 50px -24px rgba(0,0,0,.45)',
  }}>
    <div style={{ fontSize: 38, marginBottom: 10 }}>{icon}</div>
    <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 25, color: INK }}>{title}</div>
    <div style={{ fontFamily: OUTFIT, fontSize: 16.5, color: MUTED, marginTop: 8, lineHeight: 1.45 }}>{sub}</div>
  </div>
);

const StillArrow: React.FC<{ label: string }> = ({ label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 150 }}>
    <div style={{
      fontFamily: OUTFIT, fontWeight: 600, fontSize: 15, color: GOLD_HOT,
      letterSpacing: '.06em', textAlign: 'center',
    }}>{label}</div>
    <div style={{ fontFamily: MONO, fontSize: 30, color: GOLD, margin: '2px 0' }}>⟶</div>
  </div>
);

/* ---------------- tweet 2 · sealed stances ---------------- */

export const StanceGraphic: React.FC = () => (
  <StillShell
    eyebrow="Sealed stances"
    title={<span>YOUR THROW IS A HASH. <span style={{ color: GOLD_HOT }}>NOBODY CAN PEEK.</span></span>}
    sub="Seal Attack, Defense, or Cunning with your challenge. Holding the winning stance boosts all three rounds by 20%."
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 52 }}>
      <StillBox icon="🔒" title="YOU SEAL" glow
        sub="Pick a stance in secret. Only its hash goes to the chain with your challenge" />
      <StillArrow label="commit" />
      <StillBox icon="📜" title="THE CHAIN"
        sub="Holds the seal while your rival answers openly. No one can read it: not them, not us" />
      <StillArrow label="reveal" />
      <StillBox icon="🔓" title="YOU REVEAL"
        sub="Show the stance within 6 hours and the duel settles. Stall, and the fight forfeits" />
    </div>
    <div style={{
      marginTop: 44, fontFamily: OUTFIT, fontSize: 19, color: INK, letterSpacing: '.04em',
    }}>
      Attack beats Defense · Defense beats Cunning · Cunning beats Attack
    </div>
  </StillShell>
);

/* ---------------- tweet 3 · the delve ---------------- */

export const DelveGraphic: React.FC = () => (
  <StillShell
    eyebrow="The delve"
    title={<span>AN <span style={{ color: GOLD_HOT }}>EIGHT-HOUR</span> GAMBLE.</span>}
    sub="Pull a champion off steady mining and send it into the deep. It comes back one of four ways:"
  >
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 22, marginTop: 52 }}>
      <StillBox w={300} icon="🪨" title="DUST"
        sub="Nothing. The deep owes you nothing" />
      <StillBox w={300} icon="🔥" title="A SEAM"
        sub="A strike of Ember, the realm's working coin" />
      <StillBox w={300} icon="💎" title="RELIC SHARDS"
        sub="The only source of shards in the game. They buy epithets" />
      <StillBox w={300} icon="🏺" title="AN ANCIENT RELIC" glow
        sub="A relic token in your wallet, plus a heap of shards" />
    </div>
    <div style={{
      marginTop: 44, fontFamily: OUTFIT, fontSize: 19, color: INK, letterSpacing: '.04em',
    }}>
      Shards come only from delves. There is no other door.
    </div>
  </StillShell>
);

/* ---------------- tweet 4 · side bets ---------------- */

export const BetsGraphic: React.FC = () => (
  <StillShell
    eyebrow="Side bets"
    title={<span>NOT YOUR FIGHT? <span style={{ color: GOLD_HOT }}>MAKE IT YOUR MONEY.</span></span>}
    sub="Any open duel takes Ember bets from anyone not in it. Both fighters are locked out: no betting on yourself."
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 54, marginTop: 40 }}>
      <CardFace slug="chained-shade" name="Chained Shade" rank={1} type="Undead" power={41} tilt={14} w={280} />
      <div style={{ width: 380, textAlign: 'center' }}>
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 24, color: INK, letterSpacing: '.14em' }}>OPEN DUEL</div>
        <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 21, color: GOLD_HOT }}>340 Ember</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 16, color: MUTED }}>on the challenger</div>
        <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 21, color: MUTED }}>190 Ember</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 16, color: MUTED }}>on the defender</div>
        <div style={{
          marginTop: 26, padding: '14px 18px', borderRadius: 12,
          background: 'linear-gradient(180deg, #17130c, #100d09)', border: `1.5px solid ${GOLD}`,
          fontFamily: OUTFIT, fontSize: 17, color: INK, lineHeight: 1.5,
        }}>
          When it settles, the winning backers split the losing pool, minus a 5% cut.
        </div>
      </div>
      <CardFace slug="grave-singer" name="Grave Singer" rank={1} type="Mystic" power={40} tilt={-14} w={280} />
    </div>
  </StillShell>
);

/* ---------------- tweet 6 · pedigree ---------------- */

export const PedigreeGraphic: React.FC = () => {
  const rows: [string, string][] = [
    ['Victories', '12'],
    ['Veterancy', 'Level 3'],
    ['Tempered', '2×'],
    ['Hardened', '1×'],
    ['Rarity', 'Sovereign · Firstborn'],
    ['Token', '00b41c…9f2c'],
  ];
  return (
    <StillShell
      eyebrow="Pedigree"
      title={<span>THE CARD <span style={{ color: GOLD_HOT }}>CARRIES ITS HISTORY.</span></span>}
      sub="Every victory, temper, and level is written on the token itself. It cannot be forged, and it travels to the next owner."
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 64, marginTop: 40 }}>
        <CardFace slug="the-winter-sovereign" name="The Winter Sovereign" rank={3} type="Firstborn" power={216} tilt={9} w={300} />
        <div style={{
          width: 520, borderRadius: 16, padding: '26px 30px',
          background: 'linear-gradient(180deg, #17130c, #100d09)',
          border: '1.5px solid rgba(212,168,67,.35)',
        }}>
          <div style={{
            fontFamily: CINZEL, fontWeight: 700, fontSize: 19, letterSpacing: '.3em',
            color: GOLD, marginBottom: 16,
          }}>THE RECORD</div>
          {rows.map(([k, v], i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', padding: '11px 2px',
              borderBottom: i < rows.length - 1 ? '1px solid rgba(255,245,230,.09)' : 'none',
            }}>
              <span style={{ fontFamily: OUTFIT, fontSize: 18, color: MUTED }}>{k}</span>
              <span style={{ fontFamily: k === 'Token' ? MONO : OUTFIT, fontSize: 18, fontWeight: 600, color: INK }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </StillShell>
  );
};

/* ---------------- tweet 7 · the Midnight Court ---------------- */

export const MidnightGraphic: React.FC = () => (
  <AbsoluteFill style={{ background: '#000' }}>
    <AbsoluteFill>
      <Img src={staticFile('cards/the-cracked-crown.jpg')} style={{
        width: '100%', height: '100%', objectFit: 'cover',
        filter: 'brightness(.34) saturate(.8)',
      }} />
    </AbsoluteFill>
    <AbsoluteFill style={{
      background: 'linear-gradient(180deg, rgba(4,3,1,.72), transparent 36%, transparent 58%, rgba(4,3,1,.9))',
    }} />
    <Vignette amount={0.85} />
    <Grain />
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 40 }}>
      <div style={{
        fontFamily: CINZEL, fontWeight: 700, fontSize: 22, letterSpacing: '.42em',
        color: GOLD, textTransform: 'uppercase',
      }}>The twelfth boss</div>
      <div style={{
        fontFamily: CINZEL, fontWeight: 700, fontSize: 96, color: INK,
        marginTop: 20, letterSpacing: '.06em', textShadow: '0 10px 60px rgba(0,0,0,.9)',
      }}>THE MIDNIGHT COURT</div>
      <div style={{
        marginTop: 26, fontFamily: MONO, fontSize: 26, color: GOLD_HOT, letterSpacing: '.1em',
      }}>ATTACK 30 · DEFENSE 30 · CUNNING 30</div>
      <div style={{
        marginTop: 24, fontFamily: OUTFIT, fontSize: 22, color: MUTED,
        maxWidth: 900, textAlign: 'center', lineHeight: 1.55,
      }}>
        Eleven bosses stand between you and its gate. Grim, then Dire, then Black. Be the first through.
      </div>
    </AbsoluteFill>
    <Footer still />
  </AbsoluteFill>
);
