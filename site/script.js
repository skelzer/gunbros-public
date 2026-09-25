/**
 * Where PLAY goes. Leave it empty while the game is not online: PLAY then shows a
 * disabled "Coming soon" key and the hero says online play is on its way. Put the
 * game's address here (for example 'https://play.gunbros.example.com') and PLAY
 * turns on everywhere on the page.
 */
const GAME_URL = 'https://play.gunbros.example.com';

(() => {
  'use strict';

  // --- PLAY ----------------------------------------------------------------------
  const url = typeof GAME_URL === 'string' ? GAME_URL.trim() : '';
  const plays = document.querySelectorAll('#play, [data-play]');
  if (url) {
    for (const a of plays) {
      a.href = url;
      a.removeAttribute('role');
      a.removeAttribute('aria-disabled');
      a.classList.remove('is-soon');
      const sub = a.querySelector('.btn-sub');
      if (sub) sub.textContent = '';
    }
    const soon = document.getElementById('soon');
    if (soon) soon.hidden = true;
  } else {
    for (const a of plays) a.addEventListener('click', (e) => e.preventDefault());
  }

  // --- the roster ---------------------------------------------------------------
  // Each portrait gets the largest whole-pixel scale its card has room for, up to 2x.
  // A mobile too wide for one column at 2x (triclops, orbital, wyvern on most screens)
  // spans two columns instead of shrinking to 1x (see `.is-wide` in style.css).
  const roster = document.querySelector('.roster');
  const stages = document.querySelectorAll('.mobile-stage');
  const fit = () => {
    if (!roster) return;
    const cols = getComputedStyle(roster).gridTemplateColumns.split(' ');
    const colW = parseFloat(cols[0]);
    for (const stage of stages) {
      const card = stage.closest('.mobile-card');
      if (!card) continue;
      const cs = getComputedStyle(card);
      const fw = parseFloat(cs.getPropertyValue('--fw'));
      const fh = parseFloat(cs.getPropertyValue('--fh'));
      const ay = parseFloat(cs.getPropertyValue('--ay'));
      if (!fw || !fh) continue;
      // Room above the grass line (20 px) for the part of the frame above the feet.
      const h = stage.clientHeight - 20 - 4;
      const byHeight = Math.floor(h / (ay || fh));
      // The stage width this card would have in a single column, whatever it spans now.
      const single = colW - (card.offsetWidth - stage.clientWidth) - 4;
      const wide = cols.length > 1 && Math.floor(single / fw) < 2 && byHeight >= 2;
      card.classList.toggle('is-wide', wide);
      const w = stage.clientWidth - 4;             // measured after the span changed
      stage.style.setProperty('--fit', String(Math.max(1, Math.min(2, Math.floor(w / fw), byHeight))));
    }
  };
  fit();
  if ('ResizeObserver' in window) {
    new ResizeObserver(fit).observe(roster || document.body);
  } else {
    window.addEventListener('resize', fit);
  }

  // --- the hero scene ------------------------------------------------------------
  const canvas = document.getElementById('scene');
  const hero = canvas && canvas.parentElement;
  const dataEl = document.getElementById('hero-data');
  if (!canvas || !hero || !dataEl) return;
  let data;
  try {
    data = JSON.parse(dataEl.textContent);
  } catch {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const map = data.map;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const load = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rampAt = (colors, t) => {
    const stops = colors.map(hex);
    const f = Math.min(1, Math.max(0, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const k = f - i;
    const c = [0, 1, 2].map((j) => Math.round(stops[i][j] + (stops[i + 1][j] - stops[i][j]) * k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };

  // A pixel cloud: overlapping discs, lit white on top, blue-grey underneath.
  const makeCloud = (w, seed) => {
    let s = seed;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const h = Math.round(w * 0.42);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const discs = [];
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const r = h * (0.28 + rnd() * 0.22);
      const x = r + ((w - 2 * r) * i) / (n - 1);
      discs.push([x, h - r - 1 - rnd() * h * 0.25 * Math.sin((Math.PI * i) / (n - 1)) * 2, r]);
    }
    const inside = (x, y) => discs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
    const base = h - 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y > base || !inside(x + 0.5, y + 0.5)) continue;
        g.fillStyle = y > base - h * 0.18 ? '#c4d8ea' : y > base - h * 0.34 ? '#e7f1fa' : '#ffffff';
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  };

  // A pixel sun: a disc with two stepped rings of glow.
  const makeSun = (r, glow) => {
    const size = (r + glow) * 2 + 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    const rings = [
      [r + glow, 'rgba(255,246,200,0.18)'],
      [r + glow * 0.5, 'rgba(255,226,122,0.28)'],
      [r, '#ffe27a'],
      [r - 3, '#fff6c8'],
    ];
    for (const [rad, color] of rings) {
      g.fillStyle = color;
      for (let y = 0; y < size; y++) {
        const dy = y + 0.5 - m;
        if (Math.abs(dy) > rad) continue;
        const half = Math.round(Math.sqrt(rad * rad - dy * dy));
        g.fillRect(Math.round(m - half), y, half * 2, 1);
      }
    }
    return c;
  };

  const plates = map.plates;
  let terrain = null;
  const plateImgs = [];
  const mobiles = data.mobiles.map((m) => ({ ...m, img: null, ground: null, phase: Math.random() * 1000 }));
  const clouds = [];
  const sun = makeSun(26, 18);
  for (let i = 0; i < 8; i++) {
    clouds.push({
      img: makeCloud(70 + ((i * 53) % 120), 7 + i * 31),
      x: (i * 457) % 1800,
      y: 20 + ((i * 71) % 150),
    });
  }

  // View: world pixels, blown up by a whole number to cover the hero.
  let W = 0;
  let H = 0;
  let scale = 1;
  let camY = 0;
  let camXMax = 0;
  const layout = () => {
    const cssW = hero.clientWidth;
    const cssH = hero.clientHeight;
    // About 420 x 480 world px or more on screen, whatever the shape.
    scale = Math.max(1, Math.round(Math.min(cssH / 420, cssW / 480)), Math.ceil(cssW / map.width));
    W = Math.ceil(cssW / scale);
    H = Math.ceil(cssH / scale);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    ctx.imageSmoothingEnabled = false;
    // The hilltops (y ≈ 490) sit about two thirds down, under the title.
    const portrait = cssH > cssW;
    const short = cssH < 520;
    camY = Math.round(490 - H * (portrait ? 0.74 : short ? 0.8 : 0.7));
    camY = Math.min(camY, map.height - H);
    // The camera sweeps only as far as every plate still covers the view.
    camXMax = map.width - W;
    for (const p of plates) camXMax = Math.min(camXMax, (p.x + p.width - W) / p.parallax);
    camXMax = Math.max(0, Math.floor(camXMax));
  };

  const draw = (now) => {
    const still = motion.matches;
    // Slow sweep across the hills and back; parked on the tank for reduced motion.
    const period = 90000;
    // Start (and, for reduced motion, stay) with the first mobile in view.
    const first = mobiles[0];
    const u0 = camXMax > 0 ? Math.min(1, Math.max(0, (first.x - W * 0.55) / camXMax)) : 0;
    const t0 = (Math.acos(1 - 2 * u0) / (Math.PI * 2)) * period;
    const u = still ? u0 : (1 - Math.cos(((now + t0) / period) * Math.PI * 2)) / 2;
    const camX = Math.round(camXMax * u);

    // Sky: banded, as the game paints it.
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = rampAt(map.sky, i / (bands - 1));
      const y0 = Math.floor((i * H) / bands);
      ctx.fillRect(0, y0, W, Math.floor(((i + 1) * H) / bands) - y0);
    }
    // Up in the right-hand corner, clear of the title; on a tall narrow screen the
    // title fills the top, so the sun sits lower, half behind the mountains.
    const sunY = H > W ? H * 0.3 : Math.max(12, H * 0.06);
    ctx.drawImage(sun, Math.round(W * 0.88 - camX * 0.04 - sun.width / 2), Math.round(sunY));

    plates.forEach((p, i) => {
      const img = plateImgs[i];
      if (img) {
        const x = Math.round(p.x - camX * p.parallax);
        const y = Math.round(p.y - camY * p.parallax);
        if (p.fillAbove && y > 0) {
          ctx.fillStyle = p.fillAbove;
          ctx.fillRect(0, 0, W, y);
        }
        if (p.fillBelow && y + p.height < H) {
          ctx.fillStyle = p.fillBelow;
          ctx.fillRect(0, y + p.height, W, H - y - p.height);
        }
        ctx.drawImage(img, x, y);
      }
      // Clouds drift in front of the farthest plate, behind the rest.
      if (i === 0) {
        const drift = still ? 0 : now * 0.004;
        const span = map.width * 0.4 + W + 300;
        for (const c of clouds) {
          let x = (c.x - camX * 0.18 + drift) % span;
          if (x < 0) x += span;
          x -= 200;
          ctx.drawImage(c.img, Math.round(x), Math.round(c.y - camY * 0.18));
        }
      }
    });

    if (terrain) {
      ctx.drawImage(terrain, -camX, -camY);
      const bottom = map.height - camY;
      if (bottom < H) {
        ctx.fillStyle = '#3a3345';
        ctx.fillRect(0, bottom, W, H - bottom);
      }
    }

    for (const m of mobiles) {
      if (!m.img || m.ground == null) continue;
      const frame = still ? 0 : Math.floor((now + m.phase) / m.ms) % m.n;
      const sx = frame * m.fw;
      const sy = m.fh; // row 1: barrel raised
      const x = m.x - camX;
      const y = m.ground - camY;
      if (x + m.fw < 0 || x - m.fw > W) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(m.facing, 1);
      ctx.drawImage(m.img, sx, sy, m.fw, m.fh, -m.ax, -m.ay, m.fw, m.fh);
      ctx.restore();
    }
  };

  // First solid pixel under each mobile, read once from the terrain's alpha.
  const findGround = () => {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = map.height;
    const g = probe.getContext('2d', { willReadFrequently: true });
    for (const m of mobiles) {
      g.clearRect(0, 0, 1, map.height);
      g.drawImage(terrain, -m.x, 0);
      const alpha = g.getImageData(0, 0, 1, map.height).data;
      let y = 300;
      while (y < map.height && alpha[y * 4 + 3] === 0) y++;
      m.ground = y;
    }
  };

  let running = false;
  let visible = true;
  let raf = 0;
  const tick = (now) => {
    raf = 0;
    draw(now);
    if (running && visible && !motion.matches) raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  layout();
  draw(0);
  window.addEventListener('resize', () => {
    layout();
    kick();
  });
  motion.addEventListener?.('change', kick);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) kick();
    }).observe(hero);
  }

  Promise.all([
    load(map.terrain).then((img) => {
      terrain = img;
      findGround();
    }),
    ...plates.map((p, i) => load(p.src).then((img) => (plateImgs[i] = img))),
    ...mobiles.map((m) => load(m.src).then((img) => (m.img = img))),
  ])
    .catch(() => {})
    .finally(() => {
      running = true;
      kick();
    });
})();
