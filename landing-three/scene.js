/* The landing scene: one WebGL canvas behind the whole page.
   Three parts: a golden depth glow, a GPU ember field, and the four
   showcase champions held like a hand of cards at the hero's base.
   Scroll sinks the hand and calms the embers; the pointer tilts the
   hand a few degrees. Reduced motion renders a single still frame. */
import * as THREE from './vendor/three.module.min.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 720px)').matches;

const CARDS = [
  { art: 'pitchfork-militiaman-440.webp', name: 'Pitchfork Militiaman', rank: 'FOOTMAN', type: 'LEVY', power: 13, color: '#8e887a' },
  { art: 'chained-shade-440.webp', name: 'Chained Shade', rank: 'KNIGHT', type: 'UNDEAD', power: 41, color: '#7fa0bd' },
  { art: 'the-drowned-admiral-440.webp', name: 'The Drowned Admiral', rank: 'HIGHLORD', type: 'UNDEAD', power: 98, color: '#5fa894' },
  { art: 'the-winter-sovereign-440.webp', name: 'The Winter Sovereign', rank: 'SOVEREIGN', type: 'FIRSTBORN', power: 216, color: '#e8ae3f' },
];

export function start(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (e) {
    canvas.remove(); // the CSS backdrop carries the page on its own
    return;
  }
  renderer.setClearColor(0x0b0a08, 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0a08, 9, 18);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 40);
  camera.position.set(0, 0, 9);

  /* ---- the golden depth glow: a radial-gradient billboard far behind ---- */
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(212,168,67,.34)');
    grad.addColorStop(0.45, 'rgba(160,110,40,.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.set(0, -0.6, -12);
  glow.scale.set(34, 24, 1);
  scene.add(glow);

  /* ---- the ember field: seeds live in the geometry, motion in the shader ---- */
  const COUNT = MOBILE ? 320 : 850;
  const seeds = new Float32Array(COUNT * 3);
  const phases = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 3] = (Math.random() - 0.5) * 22;      // x
    seeds[i * 3 + 1] = Math.random();               // lift phase 0..1
    seeds[i * 3 + 2] = -Math.random() * 12 + 2;     // depth
    phases[i] = Math.random() * Math.PI * 2;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  emberGeo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const emberMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCalm: { value: 0 }, uPix: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float phase;
      uniform float uTime, uCalm, uPix;
      varying float vGlow;
      void main() {
        // each seed loops its own climb; scroll (uCalm) slows and dims the field
        float speed = mix(0.022, 0.008, uCalm) * (0.6 + fract(phase * 7.13) * 0.8);
        float lift = fract(position.y + uTime * speed);
        vec3 p = position;
        p.y = mix(-7.0, 9.0, lift);
        p.x += sin(uTime * 0.45 + phase) * 0.7;
        vGlow = (1.0 - abs(lift - 0.35) * 1.6) * mix(1.0, 0.45, uCalm);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (60.0 + 50.0 * fract(phase * 3.7)) * uPix / max(1.0, -mv.z * 4.5);
      }`,
    fragmentShader: `
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * clamp(vGlow, 0.0, 1.0);
        gl_FragColor = vec4(1.0, 0.72, 0.32, a * 0.9);
      }`,
  });
  scene.add(new THREE.Points(emberGeo, emberMat));

  /* ---- the hand of cards ---- */
  const hand = new THREE.Group();
  scene.add(hand);
  const CARD_W = MOBILE ? 1.35 : 1.85;
  const CARD_H = CARD_W * 1.36;
  const cardMats = [];

  const buildCard = (spec, i) => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 440; c.height = 600;
      const g = c.getContext('2d');
      const r = 22;
      const round = (x, y, w, h, rad) => {
        g.beginPath();
        g.roundRect(x, y, w, h, rad);
      };
      // face
      round(0, 0, 440, 600, r);
      g.fillStyle = '#15130f';
      g.fill();
      g.save();
      round(0, 0, 440, 600, r);
      g.clip();
      g.drawImage(img, 0, 0, 440, 440);
      // the app's own scrim: art melts into the name plate
      const grad = g.createLinearGradient(0, 220, 0, 470);
      grad.addColorStop(0, 'rgba(21,19,15,0)');
      grad.addColorStop(1, 'rgba(21,19,15,1)');
      g.fillStyle = grad;
      g.fillRect(0, 220, 440, 260);
      // rank chip
      g.font = '700 17px Cinzel, serif';
      g.fillStyle = 'rgba(11,10,8,.82)';
      const chipW = g.measureText(spec.rank).width + 26;
      round(16, 16, chipW, 34, 6); g.fill();
      g.strokeStyle = spec.color; g.lineWidth = 1.5;
      round(16, 16, chipW, 34, 6); g.stroke();
      g.fillStyle = spec.color;
      g.fillText(spec.rank, 29, 40);
      // power medallion
      const ptxt = '⚡ ' + spec.power;
      g.font = '700 22px "JetBrains Mono", monospace';
      const pw = g.measureText(ptxt).width + 28;
      g.fillStyle = 'rgba(11,10,8,.85)';
      round(440 - 16 - pw, 14, pw, 40, 20); g.fill();
      g.strokeStyle = spec.color;
      round(440 - 16 - pw, 14, pw, 40, 20); g.stroke();
      g.fillStyle = '#f0e9da';
      g.fillText(ptxt, 440 - 2 - pw, 43);
      // name
      g.font = '700 34px Cinzel, serif';
      g.fillStyle = '#f0e9da';
      g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 10;
      const words = spec.name.split(' ');
      const mid = Math.ceil(words.length / 2);
      const lines = spec.name.length > 16
        ? [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] : [spec.name];
      lines.forEach((ln, li) => g.fillText(ln, 26, 505 + li * 42));
      g.shadowBlur = 0;
      g.font = '600 15px Outfit, sans-serif';
      g.fillStyle = spec.color;
      g.fillText(spec.type, 27, 505 + lines.length * 42);
      g.restore();
      // frame stroke, the rank's material
      g.strokeStyle = spec.color; g.lineWidth = i === 3 ? 5 : 3;
      round(g.lineWidth / 2, g.lineWidth / 2, 440 - g.lineWidth, 600 - g.lineWidth, r); g.stroke();

      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      cardMats.push(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), mat);
      // the fan: rank rises left to right, the Sovereign catches the light
      const t = i - 1.5;
      mesh.position.set(t * CARD_W * 0.72, -Math.abs(t) * 0.16 + (i === 3 ? 0.05 : 0), i * 0.09);
      mesh.rotation.z = -t * 0.13;
      mesh.rotation.y = -t * 0.07;
      hand.add(mesh);
      resolve();
    };
    img.onerror = () => resolve(); // a missing art file costs one card, not the scene
    img.src = spec.art;
  });

  /* place the hand at the bottom edge of the first viewport */
  let handBaseY = -3;
  const layout = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    handBaseY = -visH / 2 + (MOBILE ? 0.72 : 1.3);
    hand.position.y = handBaseY;
    hand.rotation.x = -0.10;
  };
  layout();
  addEventListener('resize', layout);

  /* pointer parallax, spring-smoothed; scroll sinks the hand */
  let px = 0, py = 0, tx = 0, ty = 0;
  addEventListener('pointermove', e => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
  let scrollP = 0;
  const onScroll = () => { scrollP = Math.min(1, scrollY / (innerHeight * 0.9)); };
  addEventListener('scroll', onScroll, { passive: true });

  const clock = new THREE.Clock();
  const frame = () => {
    const t = clock.getElapsedTime();
    px += (tx - px) * 0.05;
    py += (ty - py) * 0.05;
    emberMat.uniforms.uTime.value = t;
    emberMat.uniforms.uCalm.value = scrollP;
    hand.rotation.z = px * 0.05;
    hand.rotation.x = -0.10 + py * 0.04;
    hand.position.y = handBaseY + Math.sin(t * 0.8) * 0.045 - scrollP * 2.6;
    const fade = Math.max(0, 1 - scrollP * 1.35);
    cardMats.forEach(m => { m.opacity = fade; });
    glow.material.opacity = 1 - scrollP * 0.55;
    camera.position.x = px * 0.25;
    camera.position.y = -py * 0.15;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };

  Promise.all(CARDS.map(buildCard)).then(() => {
    if (REDUCED) { frame(); return; } // one composed still, no loop
    renderer.setAnimationLoop(() => { if (!document.hidden) frame(); });
  });
}
