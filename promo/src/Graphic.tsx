import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily: CINZEL } = loadCinzel();
const { fontFamily: OUTFIT } = loadOutfit();
const { fontFamily: MONO } = loadMono();

/* both brand themes; the light one mirrors the app's parchment mode */
const THEMES = {
  dark: {
    INK: '#f4efe6', MUTED: '#b5ab99', GOLD: '#d4a843', GOLD_HOT: '#e8be55',
    boxBg: 'linear-gradient(180deg, #17130c, #100d09)',
    boxLine: 'rgba(212,168,67,.35)', boxLineHot: '#d4a843',
    pageBg: '#0b0a08',
    page: 'radial-gradient(1100px 700px at 50% 30%, rgba(212,168,67,.13), transparent 62%)',
    vign: 'radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(4,3,1,.6) 100%)',
    glow: 'rgba(212,168,67,.5)',
  },
  light: {
    INK: '#251a07', MUTED: '#46370f', GOLD: '#7c5312', GOLD_HOT: '#5f3e0b',
    boxBg: 'linear-gradient(180deg, rgba(255,252,240,.6), rgba(238,221,180,.55))',
    boxLine: 'rgba(63,46,14,.3)', boxLineHot: '#96762f',
    pageBg: '#e6c268',
    page: 'linear-gradient(180deg, #f2dc9e, #e6c268 46%, #d4a843)',
    vign: 'radial-gradient(120% 90% at 50% 45%, transparent 60%, rgba(63,46,14,.18) 100%)',
    glow: 'rgba(63,46,14,.35)',
  },
};

const Box: React.FC<{
  title: string; sub: string; icon: string; w?: number; glow?: boolean; T: typeof THEMES.dark;
}> = ({ title, sub, icon, w = 330, glow = false, T }) => (
  <div style={{
    width: w, borderRadius: 16, padding: '26px 24px', textAlign: 'center',
    background: T.boxBg,
    border: `1.5px solid ${glow ? T.boxLineHot : T.boxLine}`,
    boxShadow: glow ? `0 0 44px -8px ${T.glow}` : '0 18px 50px -24px rgba(0,0,0,.45)',
  }}>
    <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
    <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 26, color: T.INK }}>{title}</div>
    <div style={{ fontFamily: OUTFIT, fontSize: 17, color: T.MUTED, marginTop: 8, lineHeight: 1.45 }}>{sub}</div>
  </div>
);

const Arrow: React.FC<{ label: string; sub?: string; back?: boolean; T: typeof THEMES.dark }> = ({ label, sub, back, T }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 210 }}>
    <div style={{
      fontFamily: OUTFIT, fontWeight: 600, fontSize: 15, color: T.GOLD_HOT,
      letterSpacing: '.06em', textAlign: 'center',
    }}>{label}</div>
    <div style={{
      fontFamily: MONO, fontSize: 30, color: T.GOLD, margin: '2px 0',
    }}>{back ? '⟵' : '⟶'}</div>
    {sub && <div style={{
      fontFamily: OUTFIT, fontSize: 13.5, color: T.MUTED, textAlign: 'center', lineHeight: 1.4,
    }}>{sub}</div>}
  </div>
);

export const Graphic: React.FC<{ theme?: 'dark' | 'light' }> = ({ theme = 'dark' }) => {
  const T = THEMES[theme];
  return (
  <AbsoluteFill style={{ background: T.pageBg }}>
    <AbsoluteFill style={{ background: T.page }} />
    <AbsoluteFill style={{ background: T.vign }} />
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 54 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Img src={staticFile('shield.webp')} style={{ width: 54, filter: `drop-shadow(0 0 22px ${T.glow})` }} />
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 30, letterSpacing: '.12em', color: T.INK }}>
          EMBERFALL
        </div>
      </div>
      <div style={{
        fontFamily: CINZEL, fontWeight: 700, fontSize: 52, color: T.INK,
        marginTop: 26, letterSpacing: '.03em',
      }}>
        ONE APPROVAL. <span style={{ color: T.GOLD_HOT }}>THEN NO POPUPS.</span>
      </div>
      <div style={{ fontFamily: OUTFIT, fontSize: 21, color: T.MUTED, marginTop: 12, maxWidth: 900, textAlign: 'center', lineHeight: 1.5 }}>
        Hathor has no native session keys: no account abstraction, no scoped keys.
        So the game contract enforces them itself.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 56 }}>
        <Box T={T} icon="💰" title="YOUR WALLET" glow
          sub="Signs ONE approval: it funds a session and binds it to your identity, on-chain" />
        <Arrow T={T} label="one approval" sub="fund + bind" />
        <Box T={T} icon="🔑" title="SESSION KEY"
          sub="A throwaway key in your browser. Signs every move instantly: summon, fight, mine" />
        <Arrow T={T} label="every move, no popups" sub="instant signatures" />
        <Box T={T} icon="📜" title="THE CONTRACT"
          sub="Resolves every action to your identity: cards, Ember, renown accrue to your main wallet" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 44 }}>
        <div style={{ fontFamily: MONO, fontSize: 26, color: T.GOLD }}>⟲</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 19, color: T.INK }}>
          End the session anytime: <b style={{ color: T.GOLD_HOT }}>one click sweeps everything home.</b>
          &nbsp;Your keys never leave your wallet.
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 40, display: 'flex', gap: 30, alignItems: 'center',
        fontFamily: OUTFIT, fontSize: 18, color: T.MUTED,
      }}>
        <span style={{ fontFamily: CINZEL, fontWeight: 700, color: T.GOLD, fontSize: 20 }}>emberfall.fun</span>
        <span>fully onchain TCG · free on testnet · $HTR</span>
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
};
