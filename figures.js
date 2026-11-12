'use strict';

/* =========================================================
   Streckgubbar i SVG – sidovy, ansiktet åt höger.
   Varje övning = två ställningar (A och B). Figuren glider A → B → A.
   En ställning beskrivs av:
     P  = höft [x, y]           F  = fot [x, y] (står still)
     t  = bålens vinkel från lodrätt i grader (+ = lutar framåt)
     arm = [överarm, underarm] i grader (0 = rakt ned, 90 = framåt, 180 = upp, -90 = bakåt)
     wr  = alternativt: handens position relativt axeln [dx, dy] (för låsta händer, t.ex. armhävningar)
   Knän och armbågar räknas ut automatiskt (två-leds-IK),
   så fötterna står kvar och armarna behåller sin längd.
   ========================================================= */

const Figures = (() => {
  const L = { torso: 55, neck: 15, head: 9, thigh: 42, shin: 42, upper: 30, fore: 28, bell: 9 };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const DEFS = {
    row: {
      period: 2400, kb: 'arm',
      A: { P: [78, 112], F: [112, 180], t: 72, arm: [2, 0] },
      B: { P: [78, 112], F: [112, 180], t: 72, arm: [-125, -5] },
    },
    squat: {
      period: 2800, kb: 'down',
      A: { P: [98, 98], F: [106, 180], t: 4, arm: [25, 160] },
      B: { P: [72, 146], F: [106, 180], t: 30, arm: [45, 175] },
    },
    pushup: {
      period: 2400, kb: 'down', toe: false,
      A: { P: [110.4, 134.3], F: [40, 180], t: 57, wr: [-4.6, 55.7] },
      B: { P: [120.4, 155.8], F: [40, 180], t: 73, wr: [-21, 20] },
    },
    curl: {
      period: 2400, kb: 'arm',
      A: { P: [98, 98], F: [100, 180], t: 0, arm: [8, 10] },
      B: { P: [98, 98], F: [100, 180], t: 0, arm: [8, 150] },
    },
    swing: {
      period: 1700, kb: 'arm',
      A: { P: [76, 108], F: [108, 180], t: 62, arm: [-18, -22] },
      B: { P: [96, 98], F: [108, 180], t: -4, arm: [88, 90] },
    },
    thruster: {
      period: 2600, kb: 'arm',
      A: { P: [72, 146], F: [106, 180], t: 28, arm: [55, 165] },
      B: { P: [98, 98], F: [106, 180], t: 2, arm: [176, 178] },
    },
  };

  // Ordningen spelar roll: "thruster" och "swing" först, "squat" sist.
  const MATCHERS = [
    ['thruster', /thruster/],
    ['swing', /swing/],
    ['row', /row|rodd/],
    ['curl', /curl/],
    ['pushup', /push|armhävning/],
    ['squat', /squat|knäböj|goblet/],
  ];

  function match(name) {
    const n = String(name || '').toLowerCase();
    const hit = MATCHERS.find(([, re]) => re.test(n));
    return hit ? hit[0] : null;
  }

  /* ---------- Geometri ---------- */

  const lerp = (a, b, k) => a + (b - a) * k;
  const lerp2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const rad = (d) => (d * Math.PI) / 180;

  // Två-leds-IK: rot A, mål C, längder l1/l2, s = böjriktning. Ger mellanled och ändpunkt.
  function ik(A, C, l1, l2, s) {
    const dx = C[0] - A[0];
    const dy = C[1] - A[1];
    const base = Math.atan2(dy, dx);
    let d = Math.hypot(dx, dy);
    if (d >= l1 + l2 - 0.01) {
      const ux = Math.cos(base), uy = Math.sin(base);
      return { mid: [A[0] + ux * l1, A[1] + uy * l1], end: [A[0] + ux * (l1 + l2), A[1] + uy * (l1 + l2)] };
    }
    d = Math.max(d, Math.abs(l1 - l2) + 0.01);
    const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    return { mid: [A[0] + l1 * Math.cos(base + s * a), A[1] + l1 * Math.sin(base + s * a)], end: C };
  }

  function solve(def, k) {
    const P = lerp2(def.A.P, def.B.P, k);
    const F = lerp2(def.A.F, def.B.F, k);
    const t = rad(lerp(def.A.t, def.B.t, k));
  
    const dir = [Math.sin(t), -Math.cos(t)];
    const N = [P[0] + dir[0] * L.torso, P[1] + dir[1] * L.torso];
    const H = [N[0] + dir[0] * L.neck, N[1] + dir[1] * L.neck];
    const leg = ik(P, F, L.thigh, L.shin, -1);           // knä framåt
    let arm;
    if (def.A.arm) {
      const ua = rad(lerp(def.A.arm[0], def.B.arm[0], k));
      const fa = rad(lerp(def.A.arm[1], def.B.arm[1], k));
      const E = [N[0] + Math.sin(ua) * L.upper, N[1] + Math.cos(ua) * L.upper];
      arm = { mid: E, end: [E[0] + Math.sin(fa) * L.fore, E[1] + Math.cos(fa) * L.fore] };
    } else {
      const wr = lerp2(def.A.wr, def.B.wr, k);
      arm = ik(N, [N[0] + wr[0], N[1] + wr[1]], L.upper, L.fore, 1);
    }
    const W = arm.end;

    let C;
    if (def.kb === 'down') C = [W[0], W[1] + L.bell + 3];
    else {
      const ex = W[0] - arm.mid[0], ey = W[1] - arm.mid[1];
      const len = Math.hypot(ex, ey) || 1;
      C = [W[0] + (ex / len) * (L.bell + 3), W[1] + (ey / len) * (L.bell + 3)];
    }
    return { P, F: leg.end, K: leg.mid, N, H, E: arm.mid, W, C };
  }

  /* ---------- Rendering ---------- */

  let svg = null;
  let parts = null;
  let current = null;
  let raf = 0;
  let t0 = 0;

  const mk = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const setLine = (n, a, b) => {
    n.setAttribute('x1', a[0].toFixed(1)); n.setAttribute('y1', a[1].toFixed(1));
    n.setAttribute('x2', b[0].toFixed(1)); n.setAttribute('y2', b[1].toFixed(1));
  };
  const setCircle = (n, c) => { n.setAttribute('cx', c[0].toFixed(1)); n.setAttribute('cy', c[1].toFixed(1)); };

  function mount(svgEl) {
    svg = svgEl;
    svg.setAttribute('viewBox', '0 -45 210 235');
    svg.replaceChildren();
    const ground = mk('line', { x1: 10, y1: 186, x2: 200, y2: 186, class: 'fig-ground' });
    parts = {
      ground,
      handle: mk('line', { class: 'fig-kb-handle' }),
      bell: mk('circle', { r: L.bell, class: 'fig-kb' }),
      shin: mk('line', { class: 'fig-limb' }),
      thigh: mk('line', { class: 'fig-limb' }),
      toe: mk('line', { class: 'fig-limb' }),
      torso: mk('line', { class: 'fig-limb' }),
      upper: mk('line', { class: 'fig-limb' }),
      fore: mk('line', { class: 'fig-limb' }),
      head: mk('circle', { r: L.head, class: 'fig-head' }),
    };
    svg.append(ground, parts.shin, parts.thigh, parts.toe, parts.torso, parts.head, parts.handle, parts.bell, parts.upper, parts.fore);
  }

  function draw(def, k) {
    const j = solve(def, k);
    setLine(parts.thigh, j.P, j.K);
    setLine(parts.shin, j.K, j.F);
    setLine(parts.toe, j.F, [j.F[0] + 10, j.F[1] + 1]);
    parts.toe.style.display = def.toe === false ? 'none' : '';
    setLine(parts.torso, j.P, j.N);
    setCircle(parts.head, j.H);
    setLine(parts.upper, j.N, j.E);
    setLine(parts.fore, j.E, j.W);
    setLine(parts.handle, j.W, j.C);
    setCircle(parts.bell, j.C);
  }

  function frame(ts) {
    if (!current) return;
    const def = DEFS[current];
    const phase = ((ts - t0) % def.period) / def.period;
    const k = (1 - Math.cos(phase * 2 * Math.PI)) / 2; // mjuk in/ut, A→B→A
    draw(def, k);
    raf = requestAnimationFrame(frame);
  }

  function play(key) {
    if (!svg) return false;
    if (!key || !DEFS[key]) { stop(); svg.setAttribute('hidden', ''); return false; }
    svg.removeAttribute('hidden');
    if (key === current) return true;
    cancelAnimationFrame(raf);
    current = key;
    t0 = performance.now();
    draw(DEFS[key], 0);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    current = null;
  }

  function pose(key, k) { if (svg && DEFS[key]) { stop(); svg.removeAttribute('hidden'); draw(DEFS[key], k); } }

  return { match, mount, play, stop, pose, keys: Object.keys(DEFS) };
})();
