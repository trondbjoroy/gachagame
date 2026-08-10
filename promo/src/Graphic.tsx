import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily: CINZEL } = loadCinzel();
const { fontFamily: OUTFIT } = loadOutfit();
const { fontFamily: MONO } = loadMono();

const INK = '#f4efe6';
const MUTED = '#b5ab99';
const GOLD = '#d4a843';
const GOLD_HOT = '#e8be55';
const BG = '#0b0a08';

const Box: React.FC<{
  title: string; sub: string; icon: string; w?: number; glow?: boolean;
}> = ({ title, sub, icon, w = 330, glow = false }) => (
  <div style={{
    width: w, borderRadius: 16, padding: '26px 24px', textAlign: 'center',
    background: 'linear-gradient(180deg, #17130c, #100d09)',
    border: `1.5px solid ${glow ? GOLD : 'rgba(212,168,67,.35)'}`,
    boxShadow: glow ? `0 0 44px -8px ${GOLD}` : '0 18px 50px -24px #000',
  }}>
    <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
    <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 26, color: INK }}>{title}</div>
    <div style={{ fontFamily: OUTFIT, fontSize: 17, color: MUTED, marginTop: 8, lineHeight: 1.45 }}>{sub}</div>
  </div>
);

const Arrow: React.FC<{ label: string; sub?: string; back?: boolean }> = ({ label, sub, back }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 210 }}>
    <div style={{
      fontFamily: OUTFIT, fontWeight: 600, fontSize: 15, color: GOLD_HOT,
      letterSpacing: '.06em', textAlign: 'center',
    }}>{label}</div>
    <div style={{
      fontFamily: MONO, fontSize: 30, color: GOLD, margin: '2px 0',
    }}>{back ? '⟵' : '⟶'}</div>
    {sub && <div style={{
      fontFamily: OUTFIT, fontSize: 13.5, color: MUTED, textAlign: 'center', lineHeight: 1.4,
    }}>{sub}</div>}
  </div>
);

export const Graphic: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <AbsoluteFill style={{
      background: `radial-gradient(1100px 700px at 50% 30%, rgba(212,168,67,.13), transparent 62%)`,
    }} />
    <AbsoluteFill style={{
      background: 'radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(4,3,1,.6) 100%)',
    }} />
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: 54 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Img src={staticFile('shield.webp')} style={{ width: 54, filter: 'drop-shadow(0 0 22px rgba(212,168,67,.5))' }} />
        <div style={{ fontFamily: CINZEL, fontWeight: 700, fontSize: 30, letterSpacing: '.12em', color: INK }}>
          EMBERFALL
        </div>
      </div>
      <div style={{
        fontFamily: CINZEL, fontWeight: 700, fontSize: 52, color: INK,
        marginTop: 26, letterSpacing: '.03em',
      }}>
        ONE APPROVAL. <span style={{ color: GOLD_HOT }}>THEN NO POPUPS.</span>
      </div>
      <div style={{ fontFamily: OUTFIT, fontSize: 21, color: MUTED, marginTop: 12, maxWidth: 900, textAlign: 'center', lineHeight: 1.5 }}>
        Hathor has no native session keys — no account abstraction, no scoped keys.
        So the game contract enforces them itself.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 56 }}>
        <Box icon="💰" title="YOUR WALLET" glow
          sub="Signs ONE approval: it funds a session and binds it to your identity, on-chain" />
        <Arrow label="one approval" sub="fund + bind" />
        <Box icon="🔑" title="SESSION KEY"
          sub="A throwaway key in your browser. Signs every move instantly — summon, fight, mine" />
        <Arrow label="every move, no popups" sub="instant signatures" />
        <Box icon="📜" title="THE CONTRACT"
          sub="Resolves every action to your identity: cards, Ember, renown accrue to your main wallet" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 44 }}>
        <div style={{ fontFamily: MONO, fontSize: 26, color: GOLD }}>⟲</div>
        <div style={{ fontFamily: OUTFIT, fontSize: 19, color: INK }}>
          End the session anytime: <b style={{ color: GOLD_HOT }}>one click sweeps everything home.</b>
          &nbsp;Your keys never leave your wallet.
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 40, display: 'flex', gap: 30, alignItems: 'center',
        fontFamily: OUTFIT, fontSize: 18, color: MUTED,
      }}>
        <span style={{ fontFamily: CINZEL, fontWeight: 700, color: GOLD, fontSize: 20 }}>emberfall.fun</span>
        <span>fully onchain TCG · free on testnet · $HTR</span>
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
