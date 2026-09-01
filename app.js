/* Miette — the map, the card, the stamp.
   No tile server, no CDN, no account: everything here is drawn from two static
   JSON files and everything she does is kept in this phone's IndexedDB. */
'use strict';

/* ------------------------------------------------------------------ basics */
const $ = s => document.querySelector(s);

/* One missing element should cost one button, not the whole script. */
function on(sel, ev, fn) {
  const el = $(sel);
  if (el) el.addEventListener(ev, fn);
  return el;
}

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* A home-screen app has no second tab to open into, so target="_blank" silently
   does nothing. Hand the URL to the system instead, and fall back if it refuses. */
function openExternal(url) {
  if (/^(tel:|maps:|comgooglemaps:)/.test(url)) { location.href = url; return; }
  let w = null;
  try { w = window.open(url, '_blank', 'noopener'); } catch (e) { /* blocked */ }
  if (!w) location.href = url;
}
const KX = Math.cos(48.858 * Math.PI / 180);   // east-west squeeze at Paris' latitude
const S = 40000;                               // world px per degree of latitude
const KM = S / 111.32;                         // world px per kilometre
let LON0 = 2.224, LAT1 = 48.902;               // world origin, set once data lands

const wx = lon => (lon - LON0) * KX * S;
const wy = lat => (LAT1 - lat) * S;
const lonOf = x => x / (KX * S) + LON0;
const latOf = y => LAT1 - y / S;

const C = {
  paper: '#F7F0DF', paperDeep: '#EFE4C9', card: '#FCF8EE',
  ink: '#2A2118', ink2: '#544737', mute: '#6F6250', line: '#E2D6B9',
  faint: '#CFC0A0', crust: '#C4832E', crustDeep: '#8C5216',
  olive: '#77794F', seine: '#9DAEAC', glow: '#E8A33A',
  /* Her own record is drawn in the map's own ink — the one dark tone nothing else
     uses, so it never blends with a trade colour, and so the thing she put there
     is the strongest mark on the page. Overlapping stamps really do darken. */
  mine: '#2A2118',
  road: '#FDFAF3', roadEdge: '#DFCFA9', park: '#A8B183'
};

// one hue per trade — the map should say what a shop is before you read a word
/* Lightness groups, hue separates.
   The first palette had gold reading with cocoa and rose with plum — the colour
   pairs ran across the families instead of with them, and plum said nothing about
   sweets. Now the two bread trades are both light and warm, the two sweet trades
   both deep, so the grouping is legible before any label is read. */
const KIND = ['#C4832E', '#CE7150', '#6E4A34', '#7B4257'];
// the same hues, dark enough to read at 11 px on paper
const KIND_INK = ['#8C5216', '#8E4327', '#553627', '#5E3040'];

const state = {
  lang: 'ko', paris: null, places: [], comps: {},
  visits: {}, wish: {}, meta: {}, verdict: {}, duels: [], items: {},
  diaryView: 'time', rankKind: 'all', tasteScope: 'all', rankView: 'list',
  kinds: [true, true, true, true],
  onlyAward: false, onlyOpen: false, onlyIndie: false,
  onlyWish: false, onlyUnvisited: false, onlyChain: false, onlyVisited: false,
  awardComps: [], onlyWinner: false, onlyMulti: false, awardNat: null,
  cx: 0, cy: 0, k: 0.3, kMin: 0.05, kMax: 7,
  here: null, sel: null, ready: false
};

const T = (key, ...args) => {
  let s = (window.I18N[state.lang] || {})[key];
  if (s === undefined) s = (window.I18N.ko[key] !== undefined ? window.I18N.ko[key] : key);
  args.forEach(a => { s = s.replace('%s', a); });
  return s;
};

/* ------------------------------------------------------------------- store */
const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('miette', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('state');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('state', mode), st = t.objectStore('state');
    const q = fn(st);
    t.oncomplete = () => res(q && q.result);
    t.onerror = () => rej(t.error);
  }));
  return {
    get: k => tx('readonly', st => st.get(k)),
    set: (k, v) => tx('readwrite', st => st.put(v, k))
  };
})();

async function loadRecords() {
  try {
    state.visits = (await DB.get('visits')) || {};
    state.wish = (await DB.get('wish')) || {};
    state.meta = (await DB.get('meta')) || {};
    state.verdict = (await DB.get('verdict')) || {};
    state.duels = (await DB.get('duels')) || [];
    state.items = (await DB.get('items')) || {};
  } catch (e) { /* private mode or blocked storage — run without a record */ }
}
const saveRecords = () => Promise.all([
  DB.set('visits', state.visits), DB.set('wish', state.wish), DB.set('meta', state.meta),
  DB.set('verdict', state.verdict), DB.set('duels', state.duels),
  DB.set('items', state.items)
]).catch(() => {});

/* ---------------------------------------------------------------- geometry */
const canvas = $('#map'), ctx = canvas.getContext('2d');
let VW = 0, VH = 0, DPR = 1;

function resize() {
  const st = $('#stage');
  VW = st.clientWidth; VH = st.clientHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
  if (state.ready) { clampView(); render(); }
}

const sx = x => (x - state.cx) * state.k + VW / 2;
const sy = y => (y - state.cy) * state.k + VH / 2;

function fitAll() {
  const b = state.bounds;
  state.kMin = Math.min(VW / (b.w * 1.06), VH / (b.h * 1.35));
  state.k = state.kMin; state.cx = b.cx; state.cy = b.cy;
}

function clampView() {
  const b = state.bounds;
  state.k = Math.max(state.kMin * 0.9, Math.min(state.kMax, state.k));
  const mx = b.w / 2 + VW / state.k * 0.4, my = b.h / 2 + VH / state.k * 0.4;
  state.cx = Math.max(b.cx - mx, Math.min(b.cx + mx, state.cx));
  state.cy = Math.max(b.cy - my, Math.min(b.cy + my, state.cy));
}

/* ------------------------------------------------------------------ render */
function linePath(flat) {
  ctx.moveTo(sx(flat[0]), sy(flat[1]));
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(sx(flat[i]), sy(flat[i + 1]));
}

function onScreen(o) {
  const k = state.k, hw = VW / 2 / k, hh = VH / 2 / k;
  return o.x1 > state.cx - hw && o.x0 < state.cx + hw &&
         o.y1 > state.cy - hh && o.y0 < state.cy + hh;
}

function ringPath(flat) {
  ctx.moveTo(sx(flat[0]), sy(flat[1]));
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(sx(flat[i]), sy(flat[i + 1]));
  ctx.closePath();
}

/* Layer one and two choose a set of trades. Layer three subtracts from it. */
const ERRAND = [
  { id: 'all',   kinds: [0, 1, 2, 3] },
  { id: 'bread', kinds: [0, 1] },
  { id: 'sweet', kinds: [2, 3] }
];
/* Emphasis, not narrowing: these two light a subset and dim the rest. */
const EMPH = [
  { id: 'onlyOpen',  test: p => p.O === true },
  { id: 'onlyAward', test: p => awardOk(p) }
];
function emphasis() {
  const on = EMPH.filter(e => state[e.id]);
  if (!on.length) return null;
  return p => on.every(e => e.test(p));          // both on means both must hold
}

const COND = [
  { id: 'onlyIndie',     test: p => !p.b },
  { id: 'onlyChain',     test: p => !!p.b },
  { id: 'onlyWish',      test: p => !!state.wish[p.id] },
  { id: 'onlyUnvisited', test: p => !(state.visits[p.id] || []).length },
  { id: 'onlyVisited',   test: p => !!(state.visits[p.id] || []).length }
];

const ofKind = p => state.kinds[p.k];
const isChain = p => !!p.b;

/* A prize for the city's baguette, a prize for the whole house and a placing for
   one pastry are different claims. The competition's own subject decides which. */
const NATURE = { baguette: 'baguette', artisan: 'shop' };
function awNature(compId) {
  const c = state.comps[compId];
  return (c && NATURE[c.bread]) || 'item';
}
const NAT_ORDER = { baguette: 0, shop: 1, item: 2 };
function topNature(p) {
  let best = null;
  for (const a of (p.aw || [])) {
    const n = awNature(a.c);
    if (best === null || NAT_ORDER[n] < NAT_ORDER[best]) best = n;
  }
  return best;
}
/* The prize marks had been borrowing the trade palette — item was literally
   boulangerie's gold — so the laurel said nothing the dot underneath had not
   already said. An honour belongs to its own register: laurel green, which is
   what a laurel is, and which no trade, the water or the stamp is using. Depth
   separates the three claims. */
const AWARD = '#35573F';
const NAT_COL = { baguette: '#24402C', shop: '#35573F', item: '#4A6B4E' };

/* The competitions are per-item, so "awarded" can be too. With nothing chosen it
   means any placing; choose a contest and it means that contest. */
function awardOk(p) {
  if (!p.aw) return false;
  let list = p.aw;
  if (state.onlyWinner) list = list.filter(a => a.r === 1);
  if (state.awardComps.length) list = list.filter(a => state.awardComps.indexOf(a.c) >= 0);
  if (state.awardNat) list = list.filter(a => awNature(a.c) === state.awardNat);
  if (state.onlyMulti && p.aw.length < 2) return false;
  return list.length > 0;
}
function compsInData() {
  const n = {};
  for (const p of state.places) for (const a of (p.aw || [])) n[a.c] = (n[a.c] || 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a]);
}

function visible(p) {
  if (!state.kinds[p.k]) return false;
  for (const c of COND) if (state[c.id] && !c.test(p)) return false;
  return true;
}

const condCount = () =>
  COND.reduce((n, c) => n + (state[c.id] ? 1 : 0), 0) +
  EMPH.reduce((n, e) => n + (state[e.id] ? 1 : 0), 0);

function errandNow() {
  for (const e of ERRAND) {
    if (state.kinds.every((on, i) => on === e.kinds.includes(i))) return e.id;
  }
  return null;                                   // she picked trades by hand
}
function setErrand(id) {
  const e = ERRAND.find(x => x.id === id);
  state.kinds = [0, 1, 2, 3].map(i => e.kinds.includes(i));
}

/* a circle is one house; a square is a name with several doors */
function markPath(p, r) {
  if (p.b) { ctx.rect(p.sx - r, p.sy - r, r * 2, r * 2); return; }
  ctx.moveTo(p.sx + r, p.sy); ctx.arc(p.sx, p.sy, r, 0, 6.284);
}

function render() {
  const k = state.k;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, VW, VH);

  // arrondissements — fill, then the visited ones over the top, then the outline
  ctx.beginPath(); state.paris.arr.forEach(a => ringPath(a.W));
  ctx.fillStyle = C.paperDeep; ctx.globalAlpha = .95; ctx.fill(); ctx.globalAlpha = 1;

  const done = arrDone();
  if (done.size) {
    ctx.beginPath();
    state.paris.arr.forEach(a => { if (done.has(a.n)) ringPath(a.W); });
    ctx.fillStyle = C.crust; ctx.globalAlpha = .14; ctx.fill(); ctx.globalAlpha = 1;
  }

  // parks and woods
  if (state.green) {
    ctx.beginPath();
    for (const g of state.green) { if (!onScreen(g)) continue; ringPath(g.W); }
    ctx.fillStyle = C.park; ctx.globalAlpha = .30; ctx.fill(); ctx.globalAlpha = 1;
  }

  ctx.beginPath(); state.paris.water.forEach(w => ringPath(w));
  ctx.fillStyle = C.seine; ctx.globalAlpha = .34; ctx.fill(); ctx.globalAlpha = 1;

  // the streets, pale channels cut through the block colour
  if (state.roads) {
    const WID = [
      Math.max(1.6, 7.5 * k), Math.max(1.0, 4.6 * k),
      Math.max(0.7, 3.0 * k), Math.max(0.5, 2.0 * k), Math.max(0.4, 1.5 * k)
    ];
    const SHOW = [0, 0, .16, .30, .52];         // a tier appears once it can be seen
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // a casing under the boulevards, so they read as avenues and not scratches
    ctx.strokeStyle = C.roadEdge; ctx.globalAlpha = .75;
    for (let t = 2; t >= 0; t--) {
      if (k < SHOW[t]) continue;
      ctx.beginPath();
      for (const w of state.roads[t]) { if (!onScreen(w)) continue; linePath(w.W); }
      ctx.lineWidth = WID[t] + Math.max(1, 1.4 * Math.min(k, 1.6));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let t = state.roads.length - 1; t >= 0; t--) {
      if (k < SHOW[t]) continue;
      ctx.beginPath();
      for (const w of state.roads[t]) { if (!onScreen(w)) continue; linePath(w.W); }
      ctx.strokeStyle = C.road; ctx.lineWidth = WID[t];
      ctx.globalAlpha = t >= 3 ? .82 : 1; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  ctx.beginPath(); state.paris.arr.forEach(a => ringPath(a.W));
  ctx.strokeStyle = C.line; ctx.lineWidth = 1.1; ctx.globalAlpha = .85; ctx.stroke(); ctx.globalAlpha = 1;

  // arrondissement numbers, while the city still reads as a whole
  if (k < .5) {
    ctx.fillStyle = C.mute; ctx.globalAlpha = .6;
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    state.paris.arr.forEach(a => {
      const x = sx(a.WX), y = sy(a.WY);
      if (x > -20 && x < VW + 20 && y > -20 && y < VH + 20) ctx.fillText(a.n, x, y);
    });
    ctx.globalAlpha = 1;
  }

  // the shops — colour says the trade, filled-or-hollow says whether the door is open
  const r = Math.max(1.6, Math.min(6, 1.4 + k * 5.6));
  const pad = 24, seen = [], live = [];
  for (const p of state.places) {
    const x = sx(p.WX), y = sy(p.WY);
    if (x < -pad || x > VW + pad || y < -pad || y > VH + pad) continue;
    p.sx = x; p.sy = y; seen.push(p);
    if (visible(p) && !state.visits[p.id]) live.push(p);
  }
  // whatever is being pointed at keeps its colour; the city behind it steps back
  const hot = emphasis();
  const lit = hot ? live.filter(hot) : live;
  const dim = hot ? live.filter(q => !hot(q)) : [];
  const DIM = 0.26;

  // an open door throws light — but only while she has asked to see it
  if (state.onlyOpen) {
    // a halo four dot-widths across is weather, not a signal — keep it close in
    const RAD = [2.35, 1.75, 1.32], ALPHA = [.17, .25, .34], CAP = [15, 11, 8];
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      let any = false;
      for (const q of lit) {
        if (q.O !== true) continue;
        any = true;
        const R = Math.min(Math.max(r * RAD[pass], 4.6 - pass), CAP[pass]);
        ctx.moveTo(q.sx + R, q.sy); ctx.arc(q.sx, q.sy, R, 0, 6.284);
      }
      if (!any) break;
      ctx.fillStyle = C.glow; ctx.globalAlpha = ALPHA[pass]; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const drawKinds = (list, mul) => {
    for (let kind = 0; kind < 4; kind++) {
      // open — a solid dot
      ctx.beginPath();
      for (const p of list) {
        if (p.k !== kind || p.O !== true) continue;
        markPath(p, r);
      }
      ctx.fillStyle = KIND[kind]; ctx.globalAlpha = .92 * mul; ctx.fill();

      // hours unknown — the same dot, quieter
      ctx.beginPath();
      for (const p of list) {
        if (p.k !== kind || p.O !== null) continue;
        markPath(p, r);
      }
      ctx.globalAlpha = .42 * mul; ctx.fill(); ctx.globalAlpha = 1;

      // shut — an empty shutter
      ctx.beginPath();
      for (const p of list) {
        if (p.k !== kind || p.O !== false) continue;
        markPath(p, r);
      }
      if (r > 2) {
        ctx.strokeStyle = KIND[kind]; ctx.lineWidth = Math.min(1.6, r * .5);
        ctx.globalAlpha = .78 * mul; ctx.stroke();
      } else {
        ctx.globalAlpha = .34 * mul; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };
  drawKinds(dim, DIM);
  drawKinds(lit, 1);

  // the prizes — one mark per kind of claim, stacked once per placing.
  // Drawn when she has asked for them, so the default map stays calm.
  if (r >= 2.4 && state.onlyAward) {
    const lr = r + 3.2, step = Math.max(1.7, r * .48);
    ctx.lineCap = 'round';
    for (const nat of ['item', 'shop', 'baguette']) {
      ctx.beginPath();
      let any = false;
      for (const p of lit) {
        if (!p.aw || topNature(p) !== nat) continue;
        any = true;
        const layers = Math.min(p.aw.length, 3);
        for (let j = 0; j < layers; j++) {
          const R = lr + j * step;
          if (nat === 'shop') {                  // the whole house — a closed ring
            ctx.moveTo(p.sx + R * 1.1, p.sy); ctx.arc(p.sx, p.sy, R * 1.1, 0, 6.284);
          } else {                               // laurel brackets
            ctx.moveTo(p.sx - R, p.sy - R * .58);
            ctx.quadraticCurveTo(p.sx - R * 1.42, p.sy, p.sx - R, p.sy + R * .58);
            ctx.moveTo(p.sx + R, p.sy - R * .58);
            ctx.quadraticCurveTo(p.sx + R * 1.42, p.sy, p.sx + R, p.sy + R * .58);
          }
        }
        if (nat === 'baguette' && r >= 3) {      // the loaf's own bar over the laurel
          ctx.moveTo(p.sx - lr * .8, p.sy - lr - 2.6);
          ctx.lineTo(p.sx + lr * .8, p.sy - lr - 2.6);
        }
      }
      if (!any) continue;
      ctx.strokeStyle = NAT_COL[nat]; ctx.lineWidth = Math.min(1.7, r * .44);
      ctx.globalAlpha = .88; ctx.stroke(); ctx.globalAlpha = 1;
    }

    // a laureate wears a seed above it all
    if (r >= 3.4) {
      ctx.beginPath();
      let any = false;
      for (const p of lit) {
        if (!p.aw || !p.aw.some(a => a.r === 1)) continue;
        any = true;
        const y = p.sy - lr - (topNature(p) === 'baguette' ? 6.4 : 2.4);
        ctx.moveTo(p.sx + 1.6, y); ctx.arc(p.sx, y, 1.6, 0, 6.284);
      }
      if (any) { ctx.fillStyle = NAT_COL.baguette; ctx.fill(); }
    }
  }

  // want-to-go — an olive ring, and the steam its chip is drawn with
  {
    ctx.beginPath();
    let any = false;
    for (const p of seen) {
      if (!state.wish[p.id] || state.visits[p.id]) continue;
      any = true;
      ctx.moveTo(p.sx + r + 3.4, p.sy); ctx.arc(p.sx, p.sy, r + 3.4, 0, 6.284);
    }
    if (any) {
      ctx.strokeStyle = C.mine; ctx.lineWidth = 1.7;
      ctx.setLineDash([Math.max(2.4, r * .6), Math.max(2, r * .5)]);
      ctx.globalAlpha = .85; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    if (any && r >= 3) {                          // three curls rising off it
      const w = r * .62, h = r * 1.5, top = -(r + 5.6);
      ctx.beginPath();
      for (const p of seen) {
        if (!state.wish[p.id] || state.visits[p.id]) continue;
        for (let i = -1; i <= 1; i++) {
          const x = p.sx + i * w * 1.5, y = p.sy + top;
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + w, y - h * .45, x, y - h);
        }
      }
      ctx.strokeStyle = C.mine; ctx.lineWidth = Math.min(1.5, r * .38);
      ctx.lineCap = 'round'; ctx.globalAlpha = .8; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  // the trail, oldest to newest
  const walked = stampedInOrder();
  if (walked.length > 1) {
    ctx.beginPath();
    walked.forEach((p, i) => i ? ctx.lineTo(sx(p.WX), sy(p.WY)) : ctx.moveTo(sx(p.WX), sy(p.WY)));
    ctx.strokeStyle = C.mine; ctx.lineWidth = Math.max(2, 4 * Math.min(k, 1));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([1, Math.max(6, 9 * Math.min(k, 1))]);
    ctx.globalAlpha = .55; ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // stamps — every visit lands slightly off the last and darkens the mark
  for (const p of seen) {
    const n = (state.visits[p.id] || []).length;
    if (!n) continue;
    const rr = r + 2.4;
    for (let i = 0; i < Math.min(n, 4); i++) {
      const a = (p.WX * 7.3 + i * 2.1) % 6.283;
      const off = i * rr * 0.26;
      ctx.beginPath();
      ctx.arc(p.sx + Math.cos(a) * off, p.sy + Math.sin(a) * off, rr, 0, 6.284);
      ctx.fillStyle = C.mine; ctx.globalAlpha = 0.40 + 0.17 * i; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, rr + 3.2, 0, 6.284);
    ctx.strokeStyle = C.mine; ctx.lineWidth = 1; ctx.globalAlpha = .45; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (state.sel) {
    const p = state.sel, x = sx(p.WX), y = sy(p.WY);
    ctx.beginPath(); ctx.arc(x, y, r + 16, 0, 6.284);
    ctx.fillStyle = C.crustDeep; ctx.globalAlpha = .10; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(x, y, r + 9, 0, 6.284);
    ctx.strokeStyle = C.crustDeep; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r + 13.5, 0, 6.284);
    ctx.lineWidth = 1; ctx.globalAlpha = .5; ctx.stroke(); ctx.globalAlpha = 1;
  }

  if (state.here) {
    const x = sx(state.here.x), y = sy(state.here.y);
    if (state.here.acc) {
      const ar = Math.max(10, (state.here.acc / 111320) * S * k);
      ctx.beginPath(); ctx.arc(x, y, Math.min(ar, 160), 0, 6.284);
      ctx.fillStyle = C.seine; ctx.globalAlpha = .13; ctx.fill();
      ctx.globalAlpha = .3; ctx.strokeStyle = C.seine; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(x, y, 6.4, 0, 6.284);
    ctx.fillStyle = C.seine; ctx.fill();
    ctx.strokeStyle = C.card; ctx.lineWidth = 2.2; ctx.stroke();
  }

  if (k > .55) labels(seen, k);
}

function labels(seen, k) {
  const rank = p => (state.visits[p.id] ? 0 : state.wish[p.id] ? 1 : p.aw ? 2 : 3);
  const cand = seen.filter(visible).sort((a, b) => rank(a) - rank(b) || a.sy - b.sy);
  const rows = [], lim = k > 1.1 ? 34 : 18;
  ctx.font = '600 11px "Cormorant Garamond", Georgia, serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let n = 0;
  for (const p of cand) {
    if (n >= lim) break;
    if (p.sx < 4 || p.sx > VW - 60 || p.sy < 96 || p.sy > VH - 20) continue;
    const w = ctx.measureText(p.n).width, box = { x: p.sx + 7, y: p.sy - 7, w: w + 4, h: 14 };
    if (rows.some(q => !(box.x > q.x + q.w || box.x + box.w < q.x ||
                         box.y > q.y + q.h || box.y + box.h < q.y))) continue;
    rows.push(box); n++;
    ctx.fillStyle = 'rgba(247,240,223,.82)';
    ctx.fillRect(box.x - 2, box.y - 1, box.w, box.h);
    ctx.fillStyle = state.visits[p.id] ? C.crustDeep : C.ink;
    ctx.fillText(p.n, p.sx + 8, p.sy);
  }
}

/* ---------------------------------------------------------- opening hours */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function parseHours(h) {
  if (!h) return null;
  if (/24\/7/.test(h)) return { always: true, rules: [] };
  const rules = [];
  for (const part of h.split(';')) {
    const m = part.trim().match(/^([A-Za-z,\-]+)?\s*(.*)$/);
    if (!m) continue;
    const daySpec = (m[1] || '').trim(), timeSpec = (m[2] || '').trim();
    const days = new Set();
    if (!daySpec || /^(PH|SH)$/i.test(daySpec)) { for (let i = 0; i < 7; i++) days.add(i); }
    else {
      for (const chunk of daySpec.split(',')) {
        const rr = chunk.match(/^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/);
        if (rr) {
          let a = DAYS.indexOf(cap(rr[1])), b = DAYS.indexOf(cap(rr[2]));
          if (a < 0 || b < 0) continue;
          for (let i = 0; i < 7; i++) { const d = (a + i) % 7; days.add(d); if (d === b) break; }
        } else {
          const d = DAYS.indexOf(cap(chunk.trim()));
          if (d >= 0) days.add(d);
        }
      }
    }
    if (!days.size) continue;
    if (/^off|closed$/i.test(timeSpec)) { rules.push({ days, spans: [] }); continue; }
    const spans = [];
    (timeSpec.match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g) || []).forEach(t => {
      const [a, b] = t.split('-').map(s => s.trim());
      spans.push([mins(a), mins(b)]);
    });
    if (spans.length) rules.push({ days, spans });
    else rules.push({ days, spans: [] });
  }
  return rules.length ? { always: false, rules } : null;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1, 2).toLowerCase();
const mins = t => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// the shops keep Paris hours; the phone may be anywhere
function parisNow() {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  } catch (e) { return new Date(); }
}
const AWAY = (() => {
  try {
    return (Intl.DateTimeFormat().resolvedOptions().timeZone || '') !== 'Europe/Paris';
  } catch (e) { return false; }
})();
function parisClock() {
  const d = parisNow(), q = n => String(n).padStart(2, '0');
  return q(d.getHours()) + ':' + q(d.getMinutes());
}

const HCACHE = new Map();
function hoursOf(h) {
  if (!h) return null;
  if (!HCACHE.has(h)) HCACHE.set(h, parseHours(h));
  return HCACHE.get(h);
}
function openNow(h, now) {
  const P = hoursOf(h);
  if (!P) return null;
  if (P.always) return true;
  now = now || parisNow();
  const d = now.getDay(), t = now.getHours() * 60 + now.getMinutes();
  let known = false;
  for (const r of P.rules) {
    if (!r.days.has(d)) continue;
    known = true;
    for (const [a, b] of r.spans) if (t >= a && t < b) return true;
  }
  return known ? false : false;
}

function hoursLine(h) {
  const P = hoursOf(h);
  if (!P) return { text: T('no_hours'), open: null, off: '' };
  const now = parisNow(), d = now.getDay(), t = now.getHours() * 60 + now.getMinutes();
  let closeAt = null, nextOpen = null;
  for (const r of P.rules) {
    if (!r.days.has(d)) continue;
    for (const [a, b] of r.spans) {
      if (t >= a && t < b) closeAt = b;
      else if (t < a && nextOpen === null) nextOpen = a;
    }
  }
  const openDays = new Set();
  P.rules.forEach(r => { if (r.spans.length) r.days.forEach(x => openDays.add(x)); });
  const shut = [];
  for (let i = 1; i <= 7; i++) { const dd = i % 7; if (!openDays.has(dd)) shut.push(dayName(dd)); }
  const off = shut.length && shut.length < 7 ? T('closed_days', shut.join('·')) : '';
  if (closeAt !== null) return { text: T('until', hhmm(closeAt)), open: true, off };
  if (nextOpen !== null) return { text: T('opens', hhmm(nextOpen)), open: false, off };
  return { text: T('closed_now'), open: false, off };
}
function dayName(d) {
  const ko = ['일', '월', '화', '수', '목', '금', '토'];
  const en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fr = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  return (state.lang === 'ko' ? ko : state.lang === 'fr' ? fr : en)[d];
}

/* ------------------------------------------------------------------ counts */
const stampedIds = () => Object.keys(state.visits).filter(id => (state.visits[id] || []).length);
function stampedInOrder() {
  const out = [];
  for (const id of stampedIds()) {
    const p = state.byId[id];
    if (p) out.push({ p, t: state.visits[id][0], WX: p.WX, WY: p.WY });
  }
  return out.sort((a, b) => a.t - b.t);
}
function arrDone() {
  const s = new Set();
  stampedIds().forEach(id => { const p = state.byId[id]; if (p) s.add(p.a); });
  return s;
}

/* ------------------------------------------------------------- interaction */
let drag = null, pinch = null, moved = 0;

function pt(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
const pts = new Map();

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, pt(e));
  if (pts.size === 1) { drag = { ...pt(e), cx: state.cx, cy: state.cy }; moved = 0; }
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: state.k, cx: state.cx, cy: state.cy,
              mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    drag = null;
  }
});

canvas.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, pt(e));
  if (pinch && pts.size === 2) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const nk = Math.max(state.kMin * 0.9, Math.min(state.kMax, pinch.k * (d / pinch.d)));
    const wxm = pinch.cx + (pinch.mx - VW / 2) / pinch.k;
    const wym = pinch.cy + (pinch.my - VH / 2) / pinch.k;
    state.k = nk;
    state.cx = wxm - (pinch.mx - VW / 2) / nk;
    state.cy = wym - (pinch.my - VH / 2) / nk;
    clampView(); render(); moved = 99;
  } else if (drag && pts.size === 1) {
    const q = pt(e);
    const dx = q.x - drag.x, dy = q.y - drag.y;
    moved = Math.max(moved, Math.hypot(dx, dy));
    state.cx = drag.cx - dx / state.k;
    state.cy = drag.cy - dy / state.k;
    clampView(); render();
  }
});

function endPointer(e) {
  const was = pts.get(e.pointerId);
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = null;
  if (pts.size === 0) {
    if (drag && moved < 7 && was) tap(was);
    drag = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const q = pt(e);
  const nk = Math.max(state.kMin * 0.9, Math.min(state.kMax, state.k * Math.exp(-e.deltaY * 0.0016)));
  const wxm = state.cx + (q.x - VW / 2) / state.k, wym = state.cy + (q.y - VH / 2) / state.k;
  state.k = nk;
  state.cx = wxm - (q.x - VW / 2) / nk; state.cy = wym - (q.y - VH / 2) / nk;
  clampView(); render();
}, { passive: false });

function tap(q) {
  let best = null, bd = 26 * 26;
  for (const p of state.places) {
    if (p.sx === undefined || !visible(p)) continue;
    const d = (p.sx - q.x) ** 2 + (p.sy - q.y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  if (best) openPlace(best); else closeSheets();
}

/* ----------------------------------------------------------------- sheets */
const scrim = $('#scrim');
function closeSheets() {
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));
  scrim.classList.remove('on');
  if (state.sel) { state.sel = null; render(); }
}
scrim.addEventListener('click', closeSheets);
function show(id) {
  document.querySelectorAll('.sheet').forEach(s => { if (s.id !== id) s.classList.remove('open'); });
  $('#' + id).classList.add('open'); $('#' + id).scrollTop = 0; scrim.classList.add('on');
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function compName(id) {
  const c = state.comps[id];
  return c ? (c.name[state.lang] || c.name.en || id) : id;
}
function compFr(id) {
  const c = state.comps[id];
  return c ? (c.name.fr || '') : '';
}

/* A laurel wreath drawn by us. Never a competition's own mark — we set their
   name in their own language instead, which is a fact and costs nobody. */
function crest(size, label, sub) {
  const w = size, h = size;
  return `<svg width="${w}" height="${h}" viewBox="0 0 60 60" style="flex:0 0 auto">
    <g fill="none" stroke="${AWARD}" stroke-width="1.6" stroke-linecap="round">
      <path d="M22 12 Q8 24 15 42 Q18 49 26 52"/>
      <path d="M38 12 Q52 24 45 42 Q42 49 34 52"/>
    </g>
    <g fill="${AWARD}" opacity=".85">
      <ellipse cx="16.5" cy="20" rx="3.4" ry="1.9" transform="rotate(-46 16.5 20)"/>
      <ellipse cx="12.6" cy="28" rx="3.4" ry="1.9" transform="rotate(-22 12.6 28)"/>
      <ellipse cx="12.8" cy="36.5" rx="3.4" ry="1.9" transform="rotate(6 12.8 36.5)"/>
      <ellipse cx="16.8" cy="44" rx="3.4" ry="1.9" transform="rotate(30 16.8 44)"/>
      <ellipse cx="43.5" cy="20" rx="3.4" ry="1.9" transform="rotate(46 43.5 20)"/>
      <ellipse cx="47.4" cy="28" rx="3.4" ry="1.9" transform="rotate(22 47.4 28)"/>
      <ellipse cx="47.2" cy="36.5" rx="3.4" ry="1.9" transform="rotate(-6 47.2 36.5)"/>
      <ellipse cx="43.2" cy="44" rx="3.4" ry="1.9" transform="rotate(-30 43.2 44)"/>
    </g>
    <circle cx="30" cy="9" r="2.6" fill="${C.crust}"/>
    <text x="30" y="31" text-anchor="middle" font-family="Cormorant Garamond,Georgia,serif"
          font-size="17" font-weight="700" fill="${AWARD}">${label}</text>
    <text x="30" y="42" text-anchor="middle" font-family="IBM Plex Mono,monospace"
          font-size="7.5" letter-spacing="1" fill="${C.mute}">${sub}</text>
  </svg>`;
}

/* Centre puts a shop under the card that is about to cover the lower half, so
   aim for the middle of what will still be visible. */
function focusPlace(p, zoom) {
  state.cx = p.WX;
  state.cy = p.WY + (VH * 0.22) / Math.max(state.k, 0.001);
  if (zoom) state.k = Math.max(state.k, zoom);
  state.cy = p.WY + (VH * 0.22) / state.k;
  clampView();
}

/* 75001 … 75020 — the arrondissement is the last two digits of the postcode */
function postcode(a) { return '750' + String(a).padStart(2, '0'); }

function addressLine(p) {
  if (p.s) return p.n + ', ' + p.s + ', ' + postcode(p.a) + ' Paris';
  return p.n + ', ' + postcode(p.a) + ' Paris (' + p.y + ', ' + p.x + ')';
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);       // iOS wants the range spelled out
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function openPlace(p) {
  state.sel = p; render();
  const n = (state.visits[p.id] || []).length;
  const hl = hoursLine(p.h);
  const aw = (p.aw || []).slice(0, 6);
  const gmaps = 'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(p.n + ' ' + (p.s || '') + ' Paris');
  // on iPhone, walk her there in the app she already has
  const route = IOS
    ? 'maps://?daddr=' + p.y + ',' + p.x + '&dirflg=w'
    : 'https://www.google.com/maps/dir/?api=1&destination=' + p.y + ',' + p.x +
      '&travelmode=walking';

  $('#placeSheet').innerHTML = `
    <div class="grip"></div>
    <div class="name">${esc(p.n)}</div>
    <div class="meta">
      <div>${esc(T('kind')[p.k])}</div><div class="dot"></div>
      <div>${p.a}${esc(T('arr_suffix'))}</div>
      ${p.s ? '<div class="dot"></div><div class="mono" style="font-size:10.5px;color:var(--ink2)">' + esc(p.s) + '</div>'
             : '<div class="dot"></div><div class="mono" style="font-size:10.5px;color:var(--mute)">' + esc(T('no_addr')) + '</div>'}
      <button class="copy mono" id="doCopy">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="12" height="12" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        ${esc(T('copy'))}</button>
      ${p.b ? '<div class="dot"></div><div style="color:var(--mute)">' + esc(T('chain')) + '</div>' : ''}
    </div>
    ${aw.length ? `
      <div class="rule"></div>
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div class="lbl">${esc(T('best_at'))}</div>
        <div class="mono" style="font-size:9.5px;color:var(--mute)">${esc(T('wins', p.aw.length))}</div>
      </div>
      ${p.aw.some(a => a.r === 1) ? (() => {
        const w = p.aw.find(a => a.r === 1);
        return `<div style="display:flex;align-items:center;gap:14px;margin-top:10px;padding:12px 13px;
             border:1px solid ${C.crust};background:rgba(196,131,46,.08)">
          ${crest(58, '1', String(w.y))}
          <div style="min-width:0">
            <div class="ser" style="font-size:15.5px;font-weight:600;line-height:1.2;color:${C.crustDeep}">${esc(compFr(w.c) || compName(w.c))}</div>
            <div style="font-size:10.5px;color:var(--mute);margin-top:3px;line-height:1.35">${esc(compName(w.c))}</div>
            <div class="mono" style="font-size:10px;color:${C.crustDeep};margin-top:4px">${esc(T('win_1st'))}${w.who ? ' · ' + esc(w.who) : ''}</div>
          </div></div>`;
      })() : ''}
      <div style="margin-top:8px">${aw.filter(a => a.r !== 1).map(a => `
        <div class="aw">
          <div class="awy">${String(a.y).slice(2)}</div>
          <div class="awn">
            <div class="ser" style="font-size:14px;font-weight:600;line-height:1.2">${esc(compFr(a.c) || compName(a.c))}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
              <span style="display:inline-block;width:7px;height:7px;border-radius:4px;
                background:${NAT_COL[awNature(a.c)]}"></span>
              <span style="font-size:9.5px;color:${NAT_COL[awNature(a.c)]}">${esc(T('nat_' + awNature(a.c)))}</span>
              <span style="font-size:9.5px;color:var(--mute)">${esc(compName(a.c))}</span>
            </div>
          </div>
          <div class="awr">${esc(T('rank_n', a.r))}</div>
        </div>`).join('')}
      </div>` : ''}

    <div class="rule"></div>
    <div style="display:flex;align-items:center;gap:9px">
      ${hl.open === null ? '' :
        '<div style="width:7px;height:7px;border-radius:4px;background:' + (hl.open ? C.olive : C.faint) + '"></div>'}
      <div style="font-size:12.5px;font-weight:500">${esc(hl.open === null ? T('no_hours') : hl.open ? T('open_now') : T('closed_now'))}</div>
      ${hl.open === null ? '' : '<div class="mono" style="font-size:10.5px;color:var(--mute)">' + esc(hl.text) + '</div>'}
      <div style="flex:1 1 auto"></div>
      ${hl.off ? '<div class="mono" style="font-size:10.5px;color:var(--mute)">' + esc(hl.off) + '</div>' : ''}
    </div>
    ${AWAY && hl.open !== null ? '<div class="mono" style="font-size:9.5px;color:var(--mute);margin-top:6px">' +
      esc(T('paris_time', parisClock())) + '</div>' : ''}

    ${!p.s ? `<div class="small" style="margin-top:6px">${esc(T('no_addr_d'))}</div>` : ''}
    <div class="acts">
      ${p.t ? `<button class="act" data-url="tel:${esc(p.t.replace(/\s/g, ''))}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.6" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.8a16 16 0 006 6l1.3-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.8 2.1z"/></svg>
        <span>${esc(T('call'))}</span></button>` : ''}
      <button class="act" data-url="${esc(route)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-8-8 19-2-8z"/></svg>
        <span>${esc(T('route'))}</span></button>
      <button class="act" data-url="${esc(gmaps)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/></svg>
        <span>${esc(T('gmaps'))}</span></button>
    </div>
    <div class="note">${esc(T('outside'))}</div>

    <div class="rule"></div>
    <div style="display:flex;align-items:center;gap:12px">
      <div style="flex:1 1 auto">
        <div class="lbl">${esc(T('mine'))}</div>
        <div style="font-size:12px;color:var(--mute);margin-top:5px">
          ${n ? esc(T('stamped_n', n)) + ' · ' + esc(T('visited_on', fmtDate(state.visits[p.id][n - 1]))) +
                (state.verdict[p.id] !== undefined ? ' · ' + esc(T(VKEY[state.verdict[p.id]])) : '')
              : esc(T('not_yet'))}
        </div>
      </div>
      <button class="cta" style="width:auto;padding:0 20px" id="doStamp">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${C.card}" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5"/><path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2"/></svg>
        <span>${esc(T('stamp'))}</span>
      </button>
    </div>
    ${itemsOf(p.id).length ? `<div style="margin-top:12px">
      ${itemsOf(p.id).slice().reverse().slice(0, 6).map(it => `
        <div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--divider)">
          ${breadIcon(it.b, 18, C.ink2)}
          <div class="ser" style="flex:1 1 auto;font-size:14px;font-weight:600;min-width:0">${esc(BREAD[it.b] ? BREAD[it.b].fr : it.b)}</div>
          ${it.n ? `<div style="font-size:10.5px;color:var(--mute);flex:1 1 auto;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(it.n)}</div>` : ''}
          ${it.p ? `<div class="mono" style="font-size:11.5px;color:${C.crustDeep};flex:0 0 auto">${eur(it.p)}</div>` : ''}
        </div>`).join('')}
    </div>` : ''}
    <button class="cta ghost" style="margin-top:9px" id="doBasket">${esc(T('i_edit'))}</button>
    <button class="cta ghost" style="margin-top:9px" id="doWish">${esc(state.wish[p.id] ? T('wish_remove') : T('wish_add'))}</button>
  `;
  $('#doCopy').onclick = async () => {
    const ok = await copyText(addressLine(p));
    toast(ok ? T('copied') : T('copy_fail'));
  };
  $('#placeSheet').querySelectorAll('[data-url]').forEach(b => {
    b.onclick = () => openExternal(b.dataset.url);
  });
  $('#doStamp').onclick = () => stamp(p);
  const bb = $('#doBasket'); if (bb) bb.onclick = () => openBasket(p);
  $('#doWish').onclick = () => {
    if (state.wish[p.id]) delete state.wish[p.id]; else state.wish[p.id] = 1;
    saveRecords(); render(); openPlace(p);
  };
  show('placeSheet');
}

const fmtDate = t => {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return state.lang === 'ko' ? `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
    : state.lang === 'fr' ? `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
      : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ------------------------------------------------------------------ stamp */
function stamp(p) {
  (state.visits[p.id] = state.visits[p.id] || []).push(Date.now());
  delete state.wish[p.id];
  saveRecords(); render(); paintStrip();
  const n = state.visits[p.id].length;
  const now = new Date(), pad = x => String(x).padStart(2, '0');

  $('#stampSheet').innerHTML = `
    <div class="grip"></div>
    <div style="text-align:center">
      <div class="lbl">${esc(T('stamp_title'))}</div>
      <div class="ser" style="font-size:22px;font-weight:600;line-height:1.15;margin-top:12px">${esc(p.n)}</div>
      <div class="mono" style="font-size:10.5px;color:var(--mute);margin-top:6px">
        PARIS ${p.a}e · ${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} · ${pad(now.getHours())}:${pad(now.getMinutes())}</div>
    </div>
    <div style="display:flex;justify-content:center;margin:18px 0 4px">${stampSVG(p, n)}</div>
    <div style="text-align:center">
      <div style="font-size:14px;font-weight:600">${esc(n === 1 ? T('stamp_first') : T('stamp_again', n))}</div>
      <div class="ser" style="font-style:italic;font-size:13.5px;color:var(--ink2);margin-top:6px">${esc(T('stamp_line'))}</div>
    </div>
    <div class="rule"></div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="flex:0 0 auto">${overlapSVG()}</div>
      <div>
        <div style="font-size:12.5px;font-weight:600">${esc(T('stamp_overlap'))}</div>
        <div class="body" style="margin-top:4px;white-space:pre-line">${esc(T('stamp_overlap_sub'))}</div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="lbl">${esc(T('v_ask'))}</div>
    <div style="display:flex;gap:7px;margin-top:9px">
      ${[[2, T('v_again')], [1, T('v_ok')], [0, T('v_once')]].map(([v, l]) => `
        <button class="cta ${state.verdict[p.id] === v ? '' : 'ghost'}" data-v="${v}"
          style="flex:1 1 0;height:48px;font-size:12.5px">${esc(l)}</button>`).join('')}
    </div>
    <button class="cta" style="margin-top:14px" id="goBasket">${esc(T('i_ask'))}</button>
    <button class="cta ghost" style="margin-top:8px" id="stampDone">${esc(T('later'))}</button>
  `;
  $('#goBasket').onclick = () => openBasket(p);
  $('#stampSheet').querySelectorAll('[data-v]').forEach(b => {
    b.onclick = () => { state.verdict[p.id] = +b.dataset.v; saveRecords(); stampRefresh(p); };
  });
  $('#stampDone').onclick = closeSheets;
  show('stampSheet');
  if (navigator.vibrate) try { navigator.vibrate(18); } catch (e) {}
}

// re-paint the sheet in place, without adding another stamp
function stampRefresh(p) {
  const n = (state.visits[p.id] || []).length;
  state.visits[p.id].pop();
  stamp(p);
}

function stampSVG(p, n) {
  const d = new Date(), pad = x => String(x).padStart(2, '0');
  const date = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
  return `<svg width="216" height="216" viewBox="0 0 200 200">
    <g transform="rotate(-6 100 100)">
      <circle cx="100" cy="100" r="78" fill="none" stroke="${C.crust}" stroke-width="3.6"/>
      <circle cx="100" cy="100" r="68" fill="none" stroke="${C.crust}" stroke-width="1"/>
      <defs>
        <path id="at" d="M 100 100 m -55 0 a 55 55 0 1 1 110 0" fill="none"/>
        <path id="ab" d="M 100 100 m -52 0 a 52 52 0 1 0 104 0" fill="none"/>
      </defs>
      <text font-family="Cormorant Garamond,Georgia,serif" font-size="20" font-weight="600" letter-spacing="7" fill="${C.crust}">
        <textPath href="#at" startOffset="50%" text-anchor="middle">MIETTE</textPath></text>
      <text font-family="IBM Plex Mono,monospace" font-size="9.5" letter-spacing="2.6" fill="${C.crust}">
        <textPath href="#ab" startOffset="50%" text-anchor="middle">PARIS ${p.a}e</textPath></text>
      <g stroke="${C.crust}" stroke-width="4.4" stroke-linecap="round">
        <path d="M78 112 L92 84"/><path d="M93 116 L107 88"/><path d="M108 112 L122 84"/></g>
      <path d="M62 118 H138" stroke="${C.crust}" stroke-width="1" opacity=".6"/>
      <text x="100" y="132" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="9" letter-spacing="1.6" fill="${C.crust}">${date}</text>
    </g></svg>`;
}

function overlapSVG() {
  const one = (tx, rot, op, col) => `<g transform="translate(${tx} 36)"><g transform="rotate(${rot})" opacity="${op}">
    <circle r="25" fill="none" stroke="${col}" stroke-width="2.4"/>
    <circle r="20" fill="none" stroke="${col}" stroke-width=".7"/>
    <g stroke="${col}" stroke-width="2.6" stroke-linecap="round"><path d="M-11 6 L-5 -6"/><path d="M-2 8 L4 -4"/><path d="M7 6 L13 -6"/></g>
  </g></g>`;
  return `<svg width="112" height="72" viewBox="0 0 112 72">
    ${one(30, -14, .3, C.crust)}${one(46, 9, .52, C.crust)}${one(62, -3, .92, C.crustDeep)}</svg>`;
}

/* --------------------------------------------------------------- settings */
function openSettings() {
  $('#setSheet').onclick = null;
  const ids = stampedIds();
  const nb = ids.reduce((s, id) => s + state.visits[id].length, 0);
  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('settings'))}</div>

    <div class="lbl" style="margin-top:20px">${esc(T('language'))}</div>
    <div class="seg" id="langSeg">
      ${['ko', 'en', 'fr'].map(l => `<button data-l="${l}" class="${l === state.lang ? 'on' : ''}">${esc(window.I18N[l].lang)}</button>`).join('')}
    </div>
    <div class="small">${esc(T('proper_note'))}</div>

    <div class="lbl" style="margin-top:20px">${esc(T('install'))}</div>
    <div style="border:1px solid var(--line);background:var(--card);padding:13px 14px;margin-top:9px">
      <div class="body">${esc(T('install_intro'))}</div>
      <div class="step"><div class="stepn">1</div><div class="body">${esc(T('install_1'))}</div></div>
      <div class="step"><div class="stepn">2</div><div class="body" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span>${esc(T('install_2'))}</span>
        <svg width="15" height="17" viewBox="0 0 20 22" fill="none" stroke="${C.crustDeep}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14V2"/><path d="M6 6l4-4 4 4"/><path d="M4 10H2v10h16V10h-2"/></svg>
      </div></div>
      <div class="step"><div class="stepn">3</div><div class="body">${esc(T('install_3'))}</div></div>
      <div class="hair" style="margin:12px 0 10px"></div>
      <div class="small" style="margin-top:0">${esc(T('install_why'))}</div>
    </div>

    <button class="cta ghost" style="margin-top:18px" id="againIntro">${esc(T('intro_again'))}</button>

    <div class="lbl" style="margin-top:20px">${esc(T('build'))}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:9px">
      <div class="mono" style="flex:1 1 auto;font-size:11px;color:var(--ink2)">Miette ${BUILD}</div>
      <button class="act" style="flex:0 0 auto;padding:0 14px" id="hardRefresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3.2-6.9"/><path d="M21 3v6h-6"/></svg>
        <span>${esc(T('build_refresh'))}</span></button>
    </div>
    <div class="small">${esc(T('build_d'))}</div>

    <div class="lbl" style="margin-top:20px">${esc(T('records'))}</div>
    <div class="acts">
      <button class="act" id="doExport">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        <span>${esc(T('export'))}</span></button>
      <button class="act" id="doImport">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
        <span>${esc(T('import'))}</span></button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:9px">
      <div style="width:6px;height:6px;border-radius:3px;background:${state.meta.backup ? C.olive : C.faint}"></div>
      <div class="mono" style="font-size:10px;color:var(--mute)">
        ${esc(state.meta.backup ? T('backup_last', fmtDate(state.meta.backup)) : T('backup_none'))} · ${esc(T('counts', ids.length, nb))}</div>
    </div>
    <div class="small">${esc(T('local_only'))}</div>

    <div class="lbl" style="margin-top:20px">${esc(T('sources'))}</div>
    <div class="mono" style="font-size:9.5px;color:var(--mute);line-height:1.85;margin-top:8px">
      © OpenStreetMap contributors (ODbL)<br>
      Ville de Paris — Licence Ouverte 2.0<br>
      Syndicat des Boulangers du Grand Paris<br>
      Grand Prix de la Baguette — Ville de Paris</div>
    <div class="small">${esc(T('addr_note'))}</div>
    <div class="small">${esc(T('no_ads'))}</div>
    <div style="border:1px solid var(--line);background:var(--paper);padding:12px 13px;margin-top:11px">
      ${[T('welcome_b1'), T('welcome_b2'), T('welcome_b3')].map(x => `
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
          <svg width="12" height="12" viewBox="0 0 14 14"><circle cx="7" cy="7" r="3" fill="${C.crust}"/></svg>
          <div style="font-size:12px;color:var(--ink2)">${esc(x)}</div></div>`).join('')}
    </div>
    <div style="border:1px solid var(--line);background:var(--paper);padding:11px 12px;margin-top:9px">
      <div class="lbl">${esc(T('personal'))}</div>
      <div class="small" style="margin-top:5px">${esc(T('personal_note'))}</div>
    </div>

    <div style="text-align:center;margin-top:26px">
      <svg width="34" height="12" viewBox="0 0 34 12" style="opacity:.5">
        <g stroke="${C.crust}" stroke-width="2" stroke-linecap="round">
          <path d="M6 9L11 3"/><path d="M14.5 9.8L19.5 3.8"/><path d="M23 9L28 3"/></g></svg>
      <div class="ser" style="font-style:italic;font-size:13.5px;color:var(--mute);margin-top:8px">${esc(T('dedication'))}</div>
    </div>`;
  $('#langSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    setLang(b.dataset.l); openSettings();
  };
  $('#againIntro').onclick = () => { closeSheets(); setTimeout(openWelcome, 240); };
  $('#hardRefresh').onclick = async () => {
    toast(T('build_working'));
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) { /* nothing kept here is worth failing over */ }
    location.replace(location.pathname + '?r=' + Date.now());
  };
  $('#doExport').onclick = exportRecords;
  $('#doImport').onclick = () => $('#fileIn').click();
  show('setSheet');
}

/* ----------------------------------------------------------- export/import */
async function exportRecords() {
  const payload = {
    app: 'miette', v: 1, exported: new Date().toISOString(),
    visits: state.visits, wish: state.wish,
    verdict: state.verdict, duels: state.duels, items: state.items
  };
  const text = JSON.stringify(payload, null, 1);
  const name = 'miette-' + new Date().toISOString().slice(0, 10) + '.json';
  const file = new File([text], name, { type: 'application/json' });
  state.meta.backup = Date.now(); saveRecords();
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Miette' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
}

on('#fileIn', 'change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'miette' || !d.visits) throw new Error('shape');
    let n = 0;
    for (const [id, ts] of Object.entries(d.visits)) {
      const cur = new Set(state.visits[id] || []);
      ts.forEach(t => cur.add(t));
      state.visits[id] = [...cur].sort((a, b) => a - b);
      n += ts.length;
    }
    Object.assign(state.wish, d.wish || {});
    Object.assign(state.verdict, d.verdict || {});
    for (const [id, list] of Object.entries(d.items || {})) {
      const cur = state.items[id] || (state.items[id] = []);
      list.forEach(it => { if (!cur.some(c => c.t === it.t)) cur.push(it); });
    }
    (d.duels || []).forEach(x => {
      if (Array.isArray(x) && x.length === 2 &&
          !state.duels.some(y => y[0] === x[0] && y[1] === x[1])) state.duels.push(x);
    });
    await saveRecords(); render(); paintStrip(); openSettings();
    toast(T('imported', n));
  } catch (err) { toast(T('import_bad')); }
  e.target.value = '';
});

let toastT = null;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600);
}

/* -------------------------------------------------------------- chrome */
/* marks for the things that are not about what a shop sells */
const MARK = {
  bread: `<svg width="17" height="17" viewBox="0 0 20 20" fill="none" style="flex:0 0 auto">
    <g transform="rotate(-38 10 10)" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
      <ellipse cx="10" cy="10" rx="3" ry="7.6"/>
      <path d="M8.2 6.4l3.6-1.1M8.1 9.9l3.8-1.1M8.2 13.4l3.6-1.1"/></g></svg>`,
  sweet: `<svg width="17" height="17" viewBox="0 0 20 20" fill="none" style="flex:0 0 auto">
    <g stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="6" y="6" width="8" height="8" rx="1.4"/>
      <path d="M6 6l8 8"/><path d="M4.4 7.4L2.4 5.6v4.2l2-1.2M15.6 12.6l2 1.8v-4.2l-2 1.2"/></g></svg>`,
  glow: `<svg width="15" height="15" viewBox="0 0 16 16" style="flex:0 0 auto">
    <circle cx="8" cy="8" r="7" fill="#E8A33A" opacity=".38"/>
    <circle cx="8" cy="8" r="3.4" fill="currentColor"/></svg>`,
  award: `<svg width="16" height="14" viewBox="0 0 18 15" fill="none" style="flex:0 0 auto">
    <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <path d="M5 4 Q1.6 7.5 5 11"/><path d="M13 4 Q16.4 7.5 13 11"/></g>
    <circle cx="9" cy="7.5" r="2.6" fill="currentColor"/>
    <circle cx="9" cy="2" r="1.5" fill="currentColor"/></svg>`,
  been: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" style="flex:0 0 auto">
    <g stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <path d="M3.4 11.2 L6.2 5.6"/><path d="M6.8 12 L9.6 6.4"/><path d="M10.2 11.2 L13 5.6"/></g></svg>`,
  steam: `<svg width="15" height="16" viewBox="0 0 16 17" fill="none" style="flex:0 0 auto">
    <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <path d="M4.6 5.2c-.9-1 .6-1.9-.3-2.9M8 4.9c-.9-1 .6-1.9-.3-2.9M11.4 5.2c-.9-1 .6-1.9-.3-2.9"/>
      <path d="M2.2 14.4c0-3.2 2.6-5.8 5.8-5.8s5.8 2.6 5.8 5.8z"/>
      <path d="M1.4 14.4h13.2"/></g></svg>`
};

/* the same dots the map uses, so the row reads as its key */
function kindDots(kinds, on) {
  const r = 3.4, gap = 8.6, w = kinds.length * gap;
  return `<svg width="${w}" height="9" viewBox="0 0 ${w} 9" style="flex:0 0 auto">
    ${kinds.map((k, i) => `<circle cx="${(i * gap + r + .8).toFixed(1)}" cy="4.5" r="${r}"
      fill="${on ? '#FCF8EE' : KIND[k]}" fill-opacity="${on ? .95 : 1}"/>`).join('')}</svg>`;
}

const TRADE = [T => T('f_bakery'), T => T('f_pastry'), T => T('f_choc'), T => T('f_bonbon')];

function tradeChip(k) {
  const on = state.kinds[k];
  return `<button class="trade" data-k="${k}" style="border-color:${KIND[k]};
    background:${on ? KIND[k] : 'rgba(252,248,238,.9)'};
    color:${on ? '#FCF8EE' : KIND_INK[k]}">${esc(TRADE[k](T))}</button>`;
}
const MINE_CHIP = { onlyVisited: 1, onlyWish: 1 };
function markChip(id, label, mark) {
  const on = state[id];
  const ink = MINE_CHIP[id];
  const style = on
    ? (ink ? `background:${C.mine};border-color:${C.mine};color:#FCF8EE` : '')
    : `color:${ink ? C.mine : C.ink2}${ink ? ';border-color:rgba(42,33,24,.34)' : ''}`;
  return `<button class="tog ${on ? 'on' : ''}" data-t="${id}" style="${style}">${MARK[mark]}${esc(label)}</button>`;
}

function paintChips() {
  // "everything" is where you start, not a button you press
  $('#lamp').className = state.onlyOpen ? 'on' : '';
  $('#lamp').innerHTML = MARK.glow + esc(T('f_open'));
  // the groups are labels; the trades belonging to them are the buttons
  // two fields, each tinted with its own family — bread and sweets are not the
  // same errand, and the ground they sit on should say so before the words do
  const field = (tint, edge, title, inner) =>
    `<div class="tgroup" title="${esc(title)}" style="background:${tint};border-color:${edge}">${inner}</div>`;
  $('#chips2').innerHTML =
    field('rgba(196,131,46,.10)', 'rgba(196,131,46,.34)', T('g_bread'),
          tradeChip(0) + tradeChip(1)) +
    field('rgba(110,74,52,.11)', 'rgba(110,74,52,.34)', T('g_sweet'),
          tradeChip(2) + tradeChip(3));

  $('#chips3').innerHTML =
    markChip('onlyAward', awardChipLabel(), 'award') +
    markChip('onlyVisited', T('f_visited'), 'been') +
    markChip('onlyWish', T('wish'), 'steam');

  const n = condCount();
  $('#filterLbl').textContent = T('f_cond');
  $('#filterBtn').classList.toggle('on', n > 0);
  paintOpenBtn();
  const badge = $('#filterBtn').querySelector('b');
  if (n) {
    if (badge) badge.textContent = n;
    else $('#filterBtn').insertAdjacentHTML('beforeend', `<b>${n}</b>`);
  } else if (badge) badge.remove();
}
function onChipRow(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.f) setErrand(b.dataset.f);
  else if (b.dataset.k !== undefined) {
    // a lit chip is a lit toggle: pressing it turns that one off, nothing else.
    // Turning off the last one still on brings them all back, so the map is never
    // empty and "none selected" means what it looks like it means.
    const i = +b.dataset.k;
    const next = state.kinds.slice();
    next[i] = !next[i];
    state.kinds = next.some(Boolean) ? next : [true, true, true, true];
  } else if (b.dataset.t) {
    const id = b.dataset.t;
    state[id] = !state[id];
    if (id === 'onlyVisited' && state.onlyVisited) state.onlyUnvisited = false;
    if (id === 'onlyIndie' && state.onlyIndie) state.onlyChain = false;
    if (id === 'onlyChain' && state.onlyChain) state.onlyIndie = false;
    if (id === 'onlyAward' && !state.onlyAward) {
      state.awardComps = []; state.onlyWinner = false; state.onlyMulti = false; state.awardNat = null;
    }
  } else return;
  paintChips(); paintStrip(); render();
}
on('#chips3', 'click', onChipRow);
on('#lamp', 'click', () => {
  state.onlyOpen = !state.onlyOpen;
  paintChips(); paintStrip(); render();
});
on('#chips2', 'click', onChipRow);
on('#filterBtn', 'click', openFilters);

function awardChipLabel() {
  if (state.awardComps.length === 1) return compShort(state.awardComps[0]);
  if (state.awardComps.length > 1) return T('f_award') + ' ' + state.awardComps.length;
  if (state.onlyWinner) return T('f_winner');
  if (state.onlyMulti) return T('f_multi');
  if (state.awardNat) return T('nat_' + state.awardNat);
  return T('f_award');
}
function compShort(id) {
  const c = state.comps[id];
  if (!c) return id;
  return (c.name[state.lang] || c.name.en || id)
    .replace(/^(그랑파리 최고|일드프랑스 최고|Greater Paris Best|Île-de-France Best|Meilleure? |Trophée de la meilleure |Concours de la )/, '')
    .replace(/ \(.*\)$/, '').trim();
}

const TICK = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#FCF8EE"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5l3 3 6-7"/></svg>`;

function openFilters() {
  const cur = errandNow();
  const inKind = k => state.places.filter(p => p.k === k).length;

  const errandRow = (e, name, desc) => `
    <div class="frow" data-e="${e.id}">
      <div class="fbox rnd ${cur === e.id ? 'on' : ''}">${cur === e.id ? TICK : ''}</div>
      <div style="flex:1 1 auto;min-width:0">
        <div class="fname" style="display:flex;align-items:center;gap:7px">${kindDots(e.kinds, false)}${esc(name)}</div>
        <div class="fdesc">${esc(desc)}</div>
      </div>
      <div class="fcount">${state.places.filter(p => e.kinds.includes(p.k)).length}</div>
    </div>`;

  const tradeRow = (k, name) => `
    <div class="frow" data-k="${k}" style="padding:9px 0">
      <div class="fbox ${state.kinds[k] ? 'on' : ''}">${state.kinds[k] ? TICK : ''}</div>
      <div style="flex:1 1 auto;min-width:0">
        <div class="fname" style="font-size:12.5px;font-weight:400;display:flex;align-items:center;gap:7px">
          ${kindDots([k], false)}${esc(name)}</div>
      </div>
      <div class="fcount">${inKind(k)}</div>
    </div>`;

  const base = state.places.filter(ofKind);
  const condRow = (id, name, desc) => {
    const c = COND.find(x => x.id === id);
    return `<div class="frow" data-c="${id}">
      <div class="fbox ${state[id] ? 'on' : ''}">${state[id] ? TICK : ''}</div>
      <div style="flex:1 1 auto;min-width:0">
        <div class="fname">${esc(name)}</div>
        <div class="fdesc">${esc(desc)}</div>
      </div>
      <div class="fcount">${base.filter(c.test).length}</div>
    </div>`;
  };

  $('#setSheet').onclick = null;
  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('f_title'))}</div>

    <div class="fhead" style="margin-top:16px">${esc(T('f_errand'))}</div>
    <div style="font-size:11px;color:var(--mute);margin-top:4px">${esc(T('f_errand_help'))}</div>
    <div style="margin-top:4px">
      ${errandRow(ERRAND[1], T('g_bread'), T('g_bread_d'))}
      ${errandRow(ERRAND[2], T('g_sweet'), T('g_sweet_d'))}
      ${errandRow(ERRAND[0], T('g_all'), T('g_all_d'))}
    </div>

    <div class="fhead">${esc(T('f_trade'))}</div>
    <div style="font-size:11px;color:var(--mute);margin-top:4px">${esc(T('f_trade_help'))}</div>
    <div class="fsub" style="margin-top:4px">
      ${tradeRow(0, T('f_bakery'))}${tradeRow(1, T('f_pastry'))}
      ${tradeRow(2, T('f_choc'))}${tradeRow(3, T('f_bonbon'))}
    </div>

    <div class="fhead">${esc(T('f_cond'))}</div>
    <div style="font-size:11px;color:var(--mute);margin-top:4px">${esc(T('f_cond_help'))}</div>
    <div style="margin-top:4px">
      ${condRow('onlyOpen', T('f_open'), T('f_open_d'))}
      ${condRow('onlyAward', T('f_award'), T('f_award_d'))}
      ${state.onlyAward ? `<div class="fsub" style="margin-top:2px;margin-bottom:10px">
        <div style="font-size:10.5px;color:var(--mute);padding:7px 0 2px">${esc(T('f_award_by'))}</div>
        <div style="display:flex;gap:6px;margin:2px 0 8px">
          ${['baguette', 'shop', 'item'].map(nat => {
            const n = base.filter(q => (q.aw || []).some(a => awNature(a.c) === nat)).length;
            if (!n) return '';                    // an empty class reads as a broken one
            const on = state.awardNat === nat;
            return `<button class="chip sub ${on ? 'on' : ''}" data-an="${nat}"
              style="border-color:${on ? NAT_COL[nat] : 'var(--line)'}">
              <span style="display:inline-block;width:8px;height:8px;border-radius:5px;
                background:${NAT_COL[nat]}"></span>${esc(T('nat_' + nat))} ${n}</button>`;
          }).join('')}
        </div>
        <div class="frow" data-m="1" style="padding:8px 0">
          <div class="fbox ${state.onlyMulti ? 'on' : ''}" style="width:19px;height:19px">${state.onlyMulti ? TICK : ''}</div>
          <div style="flex:1 1 auto"><div class="fname" style="font-size:12.5px;font-weight:400">${esc(T('f_multi'))}</div>
            <div class="fdesc" style="font-size:10px;margin-top:2px">${esc(T('f_multi_d'))}</div></div>
          <div class="fcount">${base.filter(p => (p.aw || []).length >= 2).length}</div>
        </div>
        <div class="frow" data-w="1" style="padding:8px 0">
          <div class="fbox ${state.onlyWinner ? 'on' : ''}" style="width:19px;height:19px">${state.onlyWinner ? TICK : ''}</div>
          <div style="flex:1 1 auto"><div class="fname" style="font-size:12.5px;font-weight:400">${esc(T('f_winner'))}</div></div>
          <div class="fcount">${base.filter(p => (p.aw || []).some(a => a.r === 1)).length}</div>
        </div>
        ${compsInData().map(id => {
          const on = state.awardComps.indexOf(id) >= 0;
          const n = base.filter(p => (p.aw || []).some(a => a.c === id &&
            (!state.onlyWinner || a.r === 1))).length;
          return `<div class="frow" data-ac="${esc(id)}" style="padding:8px 0">
            <div class="fbox ${on ? 'on' : ''}" style="width:19px;height:19px">${on ? TICK : ''}</div>
            <div style="flex:1 1 auto;min-width:0">
              <div class="fname" style="font-size:12.5px;font-weight:400">${esc(compShort(id))}</div>
              <div class="fdesc" style="font-size:10px;margin-top:2px">${esc(compFr(id))}</div>
            </div>
            <div class="fcount">${n}</div></div>`;
        }).join('')}
      </div>` : ''}
      ${condRow('onlyIndie', T('f_indie'), T('f_indie_d'))}
      ${condRow('onlyChain', T('f_chain'), T('f_chain_d'))}
      ${condRow('onlyWish', T('wish'), T('f_wish_d'))}
      ${condRow('onlyUnvisited', T('f_unvisited'), T('f_unvisited_d'))}
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:18px;
         padding-top:13px;border-top:1px solid var(--line)">
      <div style="font-size:12.5px;font-weight:600">${esc(T('f_showing'))}</div>
      <div class="mono" style="font-size:16px;font-weight:500;color:${C.crustDeep}">${state.places.filter(visible).length}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="cta ghost" style="flex:0 0 auto;padding:0 18px" id="fReset">${esc(T('f_reset'))}</button>
      <button class="cta" style="flex:1 1 auto" id="fDone">${esc(T('done'))}</button>
    </div>`;

  $('#setSheet').onclick = ev => {
    const e = ev.target.closest('[data-e]');
    const k = ev.target.closest('[data-k]');
    const c = ev.target.closest('[data-c]');
    const ac = ev.target.closest('[data-ac]');
    const w = ev.target.closest('[data-w]');
    const m = ev.target.closest('[data-m]');
    const an = ev.target.closest('[data-an]');
    if (an) {
      state.awardNat = state.awardNat === an.dataset.an ? null : an.dataset.an;
      state.onlyAward = true;
    } else if (ac) {
      const id = ac.dataset.ac, i = state.awardComps.indexOf(id);
      if (i >= 0) state.awardComps.splice(i, 1); else state.awardComps.push(id);
      state.onlyAward = true;
    } else if (m) { state.onlyMulti = !state.onlyMulti; state.onlyAward = true; }
    else if (w) { state.onlyWinner = !state.onlyWinner; state.onlyAward = true; }
    else if (e) setErrand(e.dataset.e);
    else if (k) {
      const i = +k.dataset.k;
      const next = state.kinds.slice();
      next[i] = !next[i];
      if (next.some(Boolean)) state.kinds = next;   // never leave an empty map
    } else if (c) state[c.dataset.c] = !state[c.dataset.c];
    else return;
    paintChips(); paintStrip(); render(); openFilters();
  };
  $('#fReset').onclick = () => {
    setErrand('all');
    state.awardComps = []; state.onlyWinner = false; state.onlyMulti = false;
    state.awardNat = null;
    COND.forEach(c => { state[c.id] = false; });
    paintChips(); paintStrip(); render(); openFilters();
  };
  $('#fDone').onclick = closeSheets;
  show('setSheet');
}

function paintStrip() {
  const v = stampedIds().length, a = arrDone().size;
  $('#strip').innerHTML =
    `<div>${esc(T('stat_visited'))} <b>${v}</b></div><div class="sep"></div>` +
    `<div>${esc(T('stat_arr'))} <b style="color:var(--crustDeep)">${a}</b></div><div class="sep"></div>` +
    `<div class="mono" style="font-size:10.5px">${state.places.filter(visible).length} ${esc(T('stat_of'))}</div>`;
}

function paintTabs() {
  const T4 = [
    ['map', T('tab_map'), 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14'],
    ['log', T('tab_log'), 'M5 3h11l3 3v15H5z M16 3v4h3 M8 11h8 M8 15h6'],
    ['rank', T('tab_rank'), 'M4 20V9 M10 20V4 M16 20V13 M2 20h20'],
    ['trail', T('tab_trail'), 'M5 19c4 0 3-6 7-6s3-6 7-6 M5 19h.01 M19 7h.01']
  ];
  $('#tabs').innerHTML = T4.map(([id, label, d], i) =>
    `<button class="tab ${i === 0 ? 'on' : ''}" data-tab="${id}">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>
      <span>${esc(label)}</span></button>`).join('');
}
on('#tabs', 'click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  const t = b.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  if (t === 'map') closeSheets();
  else if (t === 'log') openLog();
  else if (t === 'trail') openTrail();
  else { state.diaryView = 'rank'; openLog(); }
});
function backToMap() {
  closeSheets();
  document.querySelectorAll('.tab').forEach((x, i) => x.classList.toggle('on', i === 0));
}

function setLang(l) {
  state.lang = l;
  try { localStorage.setItem('miette.lang', l); } catch (e) {}
  document.documentElement.lang = l;
  $('#langbtn').textContent = l.toUpperCase();
  $('#searchFieldLbl').textContent = T('s_ph');
  paintChips(); paintStrip(); paintTabs(); render();
}
on('#langbtn', 'click', openLangs);
on('#wordmark', 'click', openSettings);

on('#zoomAll', 'click', () => { fitAll(); render(); });
on('#legendBtn', 'click', openLegend);
/* metres, from the world units the map is drawn in */
const metres = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) / S * 111320;
const walk = m => Math.max(1, Math.round(m / 80));      // 80 m a minute, unhurried
function dist(m) {
  return m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km';
}

function paintOpenBtn() { /* the open-now switch lives on the chip row now */ }

function openLegend() {
  const swatch = (i) => `<span style="display:inline-flex;width:14px;height:14px;border-radius:8px;background:${KIND[i]};flex:0 0 auto"></span>`;
  const row = (mark, label) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--divider)">
      <div style="width:34px;display:flex;justify-content:center;flex:0 0 auto">${mark}</div>
      <div style="font-size:12px;color:var(--ink2)">${esc(label)}</div></div>`;
  const dot = (fill, hollow) => `<svg width="26" height="26" viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="6" ${hollow ? `fill="none" stroke="${fill}" stroke-width="2"` : `fill="${fill}"`}/></svg>`;
  $('#setSheet').onclick = null;
  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('legend'))}</div>

    <div class="lbl" style="margin-top:18px">${esc(T('legend_kind'))}</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin-top:10px">
      ${[0, 1, 2, 3].map(i => `<div style="display:flex;align-items:center;gap:8px">
        ${swatch(i)}<div style="font-size:12px">${esc(T('kind')[i])}</div></div>`).join('')}
    </div>

    <div class="lbl" style="margin-top:20px">${esc(T('legend_hours'))}</div>
    <div style="margin-top:6px">
      ${row(dot(C.crust, false), T('legend_open'))}
      ${row(dot(C.crust, true), T('legend_shut'))}
      ${row(`<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="6" fill="${C.crust}" opacity=".42"/></svg>`, T('legend_unknown'))}
    </div>

    <div class="lbl" style="margin-top:20px">${esc(T('legend_marks'))}</div>
    <div style="margin-top:6px">
      ${row(`<svg width="30" height="26" viewBox="0 0 30 26"><circle cx="15" cy="13" r="5" fill="${C.crust}"/>
        <g fill="none" stroke="${C.crustDeep}" stroke-width="1.5" stroke-linecap="round">
        <path d="M7.4 8.6 Q3.6 13 7.4 17.4"/><path d="M22.6 8.6 Q26.4 13 22.6 17.4"/></g>
        <circle cx="15" cy="3.6" r="1.7" fill="${C.crustDeep}"/></svg>`, T('legend_award'))}
      ${row(`<svg width="34" height="26" viewBox="0 0 34 26"><circle cx="17" cy="13" r="5" fill="${C.crust}"/>
        <g fill="none" stroke="${C.crustDeep}" stroke-width="1.4" stroke-linecap="round">
        <path d="M9.4 8.6 Q5.6 13 9.4 17.4"/><path d="M24.6 8.6 Q28.4 13 24.6 17.4"/>
        <path d="M6.6 7.4 Q1.8 13 6.6 18.6"/><path d="M27.4 7.4 Q32.2 13 27.4 18.6"/></g>
        <circle cx="17" cy="3.4" r="1.7" fill="${C.crustDeep}"/></svg>`, T('legend_multi'))}
      ${row(`<svg width="30" height="26" viewBox="0 0 30 26"><circle cx="15" cy="15" r="4.4" fill="${C.crust}" opacity=".45"/>
        <circle cx="15" cy="15" r="8.4" fill="none" stroke="${C.mine}" stroke-width="1.7" stroke-dasharray="3.4 2.8"/>
        <g stroke="${C.mine}" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".8">
        <path d="M9.5 3.6 q3 -2.4 0 -5"/><path d="M15 2.6 q3 -2.4 0 -5"/><path d="M20.5 3.6 q3 -2.4 0 -5"/></g></svg>`, T('legend_wish'))}
      ${row(`<svg width="30" height="26" viewBox="0 0 30 26">
        <circle cx="12" cy="13" r="6.4" fill="${C.mine}" opacity=".5"/>
        <circle cx="16" cy="13" r="6.4" fill="${C.mine}" opacity=".85"/>
        <circle cx="14" cy="13" r="9.6" fill="none" stroke="${C.mine}" stroke-width="1" opacity=".45"/></svg>`, T('legend_stamp'))}
      ${row(`<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="${C.seine}" opacity=".16"/>
        <circle cx="13" cy="13" r="5" fill="${C.seine}" stroke="${C.card}" stroke-width="2"/></svg>`, T('legend_here'))}
    </div>
    <div class="small">${esc(T('legend_note'))}</div>`;
  show('setSheet');
}
let watchId = null;
function startWatch(recentre) {
  if (!navigator.geolocation) { toast(T('geo_no')); return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  let first = true;
  watchId = navigator.geolocation.watchPosition(pos => {
    const x = wx(pos.coords.longitude), y = wy(pos.coords.latitude);
    state.here = { x, y, acc: pos.coords.accuracy || 0 };
    const b = state.bounds;
    const inParis = Math.abs(x - b.cx) < b.w * .9 && Math.abs(y - b.cy) < b.h * .9;
    if ((first && recentre) || state.follow) {
      if (inParis) { state.cx = x; state.cy = y; if (first) state.k = Math.max(state.k, 1.1); }
      else if (first && recentre) toast(T('geo_far'));
    }
    first = false;
    clampView(); render();
  }, err => {
    state.follow = false; paintLocateBtn();
    toast(err.code === 1 ? T('geo_denied') : T('geo_no'));
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
}
function paintLocateBtn() {
  $('#locate').style.borderColor = state.follow ? C.seine : C.line;
  $('#locate').style.background = state.follow ? 'rgba(157,174,172,.18)' : C.card;
}
on('#locate', 'click', () => {
  state.follow = !state.follow;
  paintLocateBtn();
  if (state.follow) startWatch(true);
  render();
});


/* ------------------------------------------------------------- what she ate */
const BREADS = [
  ['baguette', 'baguette',
   '<g transform="rotate(-38 12 12)"><ellipse cx="12" cy="12" rx="3.5" ry="9.2"/><path d="M9.8 7.6l4.4-1.4M9.6 11.8l4.6-1.4M9.8 16l4.4-1.4"/></g>'],
  ['croissant', 'croissant',
   '<path d="M3.6 15.8c0-5.5 3.8-9.4 8.4-9.4s8.4 3.9 8.4 9.4c-1.8-2.5-4.6-3.9-8.4-3.9s-6.6 1.4-8.4 3.9z"/><path d="M3.6 15.8c-.9-.2-1.2-1.4-.5-2.1M20.4 15.8c.9-.2 1.2-1.4.5-2.1"/>'],
  ['painchoc', 'pain au chocolat',
   '<rect x="3.5" y="7.5" width="17" height="9" rx="2.2"/><path d="M8.4 7.5v9M15.6 7.5v9"/>'],
  ['flan', 'flan',
   '<path d="M4 10.5h16V15a3.2 3.2 0 01-3.2 3.2H7.2A3.2 3.2 0 014 15z"/><path d="M4 10.5c0-2.2 3.6-4 8-4s8 1.8 8 4"/>'],
  ['galette', 'galette des rois',
   '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8c2.6 2.8 2.6 5.6 0 8.2M12 20.2c-2.6-2.8-2.6-5.6 0-8.2"/><path d="M3.8 12c2.8-2.6 5.6-2.6 8.2 0M20.2 12c-2.8 2.6-5.6 2.6-8.2 0"/>'],
  ['eclair', 'éclair',
   '<rect x="2.6" y="9" width="18.8" height="6" rx="3"/><path d="M5.4 10.8h13.2"/>'],
  ['chausson', 'chausson aux pommes',
   '<path d="M3.8 17.2a8.2 8.2 0 0116.4 0z"/><path d="M3.8 17.2q2-1.5 4.1 0t4.1 0 4.1 0 4.1 0"/><path d="M9 12.2l2.6-2.4M13 13l2.6-2.4"/>'],
  ['campagne', 'pain de campagne',
   '<circle cx="12" cy="12" r="8.2"/><path d="M8.4 8.4l7.2 7.2M15.6 8.4l-7.2 7.2"/>'],
  ['citron', 'tarte au citron',
   '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8V12l6.6 4.8"/>'],
  ['kouign', 'kouign-amann',
   '<circle cx="12" cy="12" r="8.2"/><path d="M6.6 6.6l4.4 4.4M17.4 6.6L13 11M17.4 17.4L13 13M6.6 17.4L11 13"/>'],
  ['raisin', 'pain aux raisins',
   '<circle cx="12" cy="12" r="8.2"/><path d="M12 12a3.2 3.2 0 113.2-3.2c0 3-3.2 3.7-3.2 7"/>'],
  ['sandwich', 'sandwich',
   '<path d="M3.4 13.6h17.2a1.6 1.6 0 010 3.2H3.4a1.6 1.6 0 010-3.2z"/><path d="M4.6 13.6c0-3.4 3.3-6 7.4-6s7.4 2.6 7.4 6"/>']
];
const BREAD = {};
BREADS.forEach(b => { BREAD[b[0]] = { fr: b[1], icon: b[2] }; });

const breadIcon = (code, size, col) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24"
  fill="none" stroke="${col}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"
  style="flex:0 0 auto">${BREAD[code] ? BREAD[code].icon : ''}</svg>`;
const breadName = code => (T('bread')[code] || (BREAD[code] ? BREAD[code].fr : code));
const itemsOf = id => state.items[id] || [];
const eur = c => '€' + (c / 100).toFixed(2);

function breadStats(code) {
  const prices = [];
  let shops = 0;
  for (const [id, list] of Object.entries(state.items)) {
    const mine = list.filter(i => i.b === code);
    if (!mine.length) continue;
    shops++;
    mine.forEach(i => { if (i.p) prices.push(i.p); });
  }
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  return { shops, avg, n: prices.length };
}

/* ------------------------------------------------------------ her taste shape */
/* Every bread belongs to exactly one leaning, so the six shares always sum. */
const AXES = [
  ['plain',   ['baguette', 'campagne']],
  ['butter',  ['croissant', 'painchoc', 'kouign']],
  ['cream',   ['flan', 'eclair']],
  ['fruit',   ['citron', 'chausson']],
  ['almond',  ['galette', 'raisin']],
  ['savoury', ['sandwich']]
];
const AXIS_OF = {};
AXES.forEach(([id, list], i) => list.forEach(c => { AXIS_OF[c] = i; }));

/* count = how often, liking = the mean verdict of the visits it came from
   (again 1.0, fine 0.5, once 0.0; unanswered counts as fine). */
function tasteProfile(scope) {
  const n = new Array(6).fill(0), like = new Array(6).fill(0), lw = new Array(6).fill(0);
  for (const [id, list] of Object.entries(state.items)) {
    if (scope !== 'all' && id !== scope) continue;
    if (!state.byId[id]) continue;
    const v = state.verdict[id];
    const score = v === undefined ? 0.5 : v / 2;
    for (const it of list) {
      const a = AXIS_OF[it.b];
      if (a === undefined) continue;
      n[a]++; like[a] += score; lw[a]++;
    }
  }
  const total = n.reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...n);
  return {
    total,
    count: n.map(v => v / peak),                 // shape, not proportion of the whole
    share: n.map(v => (total ? v / total : 0)),
    liking: like.map((v, i) => (lw[i] ? v / lw[i] : 0)),
    raw: n
  };
}

function hexagon(prof, size) {
  const R = size / 2 - 54, cx = size / 2, cy = size / 2;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r];
  };
  const poly = vals => vals.map((v, i) => pt(i, Math.max(v, 0.04)).map(x => x.toFixed(1)).join(',')).join(' ');
  const web = [0.25, 0.5, 0.75, 1].map(r =>
    `<polygon points="${poly(new Array(6).fill(r))}" fill="none" stroke="${C.line}" stroke-width="${r === 1 ? 1.1 : 0.7}"/>`).join('');
  const spokes = [0, 1, 2, 3, 4, 5].map(i => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.line}" stroke-width="0.7"/>`;
  }).join('');
  const labels = AXES.map(([id], i) => {
    const [x, y] = pt(i, 1.17);
    const mid = i === 0 || i === 3;
    const anchor = mid ? 'middle' : (x > cx ? 'start' : 'end');
    const lx = mid ? x : (x > cx ? x + 4 : x - 4);
    const ly = i === 0 ? y - 4 : i === 3 ? y + 12 : y + 1;
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}"
      font-family="'IBM Plex Sans KR',sans-serif" font-size="10.5" fill="${C.ink2}">${esc(T('t_axis')[id])}</text>
      <text x="${lx.toFixed(1)}" y="${(ly + 12).toFixed(1)}" text-anchor="${anchor}"
      font-family="'IBM Plex Mono',monospace" font-size="8.5" fill="${C.mute}">${prof.raw[i]}</text>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${web}${spokes}
    <polygon points="${poly(prof.count)}" fill="${C.crust}" fill-opacity=".22" stroke="${C.crustDeep}" stroke-width="1.8" stroke-linejoin="round"/>
    <polygon points="${poly(prof.liking)}" fill="none" stroke="${C.olive}" stroke-width="1.6"
      stroke-dasharray="4 3" stroke-linejoin="round"/>
    ${labels}
  </svg>`;
}

/* --------------------------------------------------------------- her ranking */
/* Bradley-Terry by MM iteration. Order-independent, stable on a dozen answers,
   and transitive for free — she never has to compare every pair. */
function btRank(ids) {
  const n = ids.length;
  if (!n) return [];
  const idx = {};
  ids.forEach((id, i) => { idx[id] = i; });
  const wins = new Array(n).fill(0), met = new Array(n).fill(0);
  const pair = {};
  for (const [a, b] of state.duels) {
    const i = idx[a], j = idx[b];
    if (i === undefined || j === undefined) continue;
    wins[i]++; met[i]++; met[j]++;
    const k = i < j ? i + ':' + j : j + ':' + i;
    pair[k] = (pair[k] || 0) + 1;
  }
  let p = new Array(n).fill(1);
  for (let it = 0; it < 160; it++) {
    const np = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let d = 2 / (p[i] + 1);                    // one phantom win, one phantom loss
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const k = i < j ? i + ':' + j : j + ':' + i;
        const c = pair[k];
        if (c) d += c / (p[i] + p[j]);
      }
      np[i] = d > 0 ? (wins[i] + 1) / d : p[i];
    }
    const mean = np.reduce((a, b) => a + b, 0) / n || 1;
    p = np.map(v => Math.max(v / mean, 1e-9));
  }
  return ids.map((id, i) => ({ id, score: p[i], met: met[i] }))
            .sort((a, b) => b.score - a.score);
}

/* A league key is a shop id, or "shopId#bread" when the league is one item. */
function rankable(kind) {
  if (kind.slice(0, 2) === 'b:') {
    const code = kind.slice(2), out = [];
    for (const [id, list] of Object.entries(state.items)) {
      if (state.byId[id] && list.some(i => i.b === code)) out.push(id + '#' + code);
    }
    return out;
  }
  return stampedIds().filter(id => {
    const q = state.byId[id];
    return q && (kind === 'all' || q.k === +kind);
  });
}
const keyPlace = k => state.byId[k.split('#')[0]];
const keyBread = k => (k.indexOf('#') > 0 ? k.split('#')[1] : null);
function keyPrice(k) {
  const [id, code] = k.split('#');
  const mine = itemsOf(id).filter(i => i.p && (!code || i.b === code));
  return mine.length ? mine.reduce((a, b) => a + b.p, 0) / mine.length : 0;
}
function breadLeagues() {
  const n = {};
  for (const [id, list] of Object.entries(state.items)) {
    if (!state.byId[id]) continue;
    new Set(list.map(i => i.b)).forEach(c => { n[c] = (n[c] || 0) + 1; });
  }
  return Object.keys(n).filter(c => n[c] >= 2).sort((a, b) => n[b] - n[a]);
}

/* Whoever has been compared least, against someone they have not met. */
function nextPair(kind) {
  const ids = rankable(kind);
  if (ids.length < 2) return null;
  const met = {}, seen = {};
  ids.forEach(id => { met[id] = 0; });
  for (const [a, b] of state.duels) {
    if (met[a] !== undefined) met[a]++;
    if (met[b] !== undefined) met[b]++;
    seen[a + '|' + b] = seen[b + '|' + a] = 1;
  }
  const order = ids.slice().sort((x, y) => met[x] - met[y]);
  for (const a of order) {
    for (const b of order) {
      if (a === b || seen[a + '|' + b]) continue;
      return [a, b];
    }
  }
  return null;                                   // everyone has met everyone
}

/* ------------------------------------------------------------- the log tab */
const VCOL = ['#6F6250', '#8E7098', '#77794F'];   // once / fine / again
const VKEY = ['v_once', 'v_ok', 'v_again'];

function verdictDot(id, size) {
  const v = state.verdict[id];
  if (v === undefined) return '';
  const r = size || 7;
  return `<svg width="${r * 2}" height="${r * 2}" viewBox="0 0 ${r * 2} ${r * 2}" style="flex:0 0 auto">
    <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${v === 2 ? VCOL[2] : 'none'}"
      stroke="${VCOL[v]}" stroke-width="1.6"/></svg>`;
}

function openLog() {
  const V = [['time', T('d_time')], ['good', T('d_good')],
             ['taste', T('t_title')], ['rank', T('d_rank')]];
  const head = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('d_title'))}</div>
    <div class="seg" style="margin-top:12px">
      ${V.map(([v, l]) => `<button data-dv="${v}" class="${state.diaryView === v ? 'on' : ''}">${esc(l)}</button>`).join('')}
    </div>`;
  const bind = () => {
    $('#setSheet').querySelectorAll('[data-dv]').forEach(b => {
      b.onclick = () => { state.diaryView = b.dataset.dv; openLog(); };
    });
    $('#setSheet').onclick = e => {
      const row = e.target.closest('[data-id]'); if (!row) return;
      const q = state.byId[row.dataset.id];
      if (q) { focusPlace(q, 1.1); backToMap(); openPlace(q); }
    };
  };
  if (state.diaryView === 'good') { diaryGood(head, bind); return; }
  if (state.diaryView === 'taste') { diaryTaste(head, bind); return; }
  if (state.diaryView === 'rank') { diaryRank(head, bind); return; }
  diaryTime(head, bind);
}

/* ---------- the ones she would go back to */
function diaryGood(head, bind) {
  const ids = stampedIds().filter(id => state.verdict[id] === 2);
  const byKind = [0, 1, 2, 3].map(k => ids.filter(id => state.byId[id] && state.byId[id].k === k));
  const body = ids.length ? byKind.map((list, k) => !list.length ? '' : `
      <div class="fhead" style="margin-top:16px">${esc(T('kind')[k])} · ${list.length}</div>
      ${list.map(id => {
        const q = state.byId[id];
        return `<div class="aw" data-id="${esc(id)}">
          ${verdictDot(id)}
          <div class="awn" class="ser" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;font-weight:600">${esc(q.n)}</div>
          ${q.aw ? `<svg width="16" height="14" viewBox="0 0 16 14" style="flex:0 0 auto"><g fill="none" stroke="${C.crustDeep}" stroke-width="1.3" stroke-linecap="round"><path d="M4.6 3.4 Q1.4 7 4.6 10.6"/><path d="M11.4 3.4 Q14.6 7 11.4 10.6"/></g></svg>` : ''}
          <div class="mono" style="font-size:10px;color:var(--mute);flex:0 0 auto">${q.a}e</div>
        </div>`;
      }).join('')}`).join('') : `
      <div style="text-align:center;padding:44px 0 24px">
        <div style="font-size:13px;font-weight:600">${esc(T('d_good_empty'))}</div>
        <div style="font-size:11.5px;color:var(--mute);margin-top:6px">${esc(T('d_good_empty_d'))}</div>
      </div>`;
  $('#setSheet').innerHTML = head + body;
  bind();
  show('setSheet');
}

/* ---------- the shape of what she likes */
function diaryTaste(head, bind) {
  const shops = Object.keys(state.items)
    .filter(id => state.byId[id] && state.items[id].length >= 2)
    .sort((a, b) => state.items[b].length - state.items[a].length);
  if (state.tasteScope !== 'all' && shops.indexOf(state.tasteScope) < 0) state.tasteScope = 'all';

  const prof = tasteProfile(state.tasteScope);
  const chips = `<div style="display:flex;gap:6px;margin-top:12px;overflow-x:auto">
    <button class="chip ${state.tasteScope === 'all' ? 'on' : ''}" data-ts="all">${esc(T('t_me'))}</button>
    ${shops.map(id => `<button class="chip ${state.tasteScope === id ? 'on' : ''}" data-ts="${esc(id)}">${esc(state.byId[id].n)}</button>`).join('')}
  </div>`;

  let body;
  if (!prof.total) {
    body = `<div style="text-align:center;padding:40px 0 26px">
      <div style="font-size:13px;font-weight:600">${esc(T('t_thin'))}</div>
      <div style="font-size:11.5px;color:var(--mute);margin-top:6px">${esc(T('t_thin_d'))}</div></div>`;
  } else {
    let most = 0, fav = 0;
    prof.raw.forEach((v, i) => { if (v > prof.raw[most]) most = i; });
    prof.liking.forEach((v, i) => { if (prof.raw[i] && v > prof.liking[fav]) fav = i; });
    const same = most === fav;
    body = `
      <div style="display:flex;justify-content:center;margin-top:8px">${hexagon(prof, 334)}</div>
      <div style="display:flex;gap:16px;justify-content:center;margin-top:2px">
        <div style="display:flex;align-items:center;gap:6px">
          <svg width="16" height="10"><rect width="16" height="10" fill="${C.crust}" fill-opacity=".22" stroke="${C.crustDeep}" stroke-width="1.4"/></svg>
          <div style="font-size:10.5px;color:var(--ink2)">${esc(T('t_amount'))}</div></div>
        <div style="display:flex;align-items:center;gap:6px">
          <svg width="16" height="10"><line x1="0" y1="5" x2="16" y2="5" stroke="${C.olive}" stroke-width="1.6" stroke-dasharray="4 3"/></svg>
          <div style="font-size:10.5px;color:var(--ink2)">${esc(T('t_liking'))}</div></div>
      </div>
      <div style="border-left:3px solid ${C.crust};padding:3px 0 3px 12px;margin-top:18px">
        <div style="font-size:12.5px;line-height:1.6">
          ${esc(T('t_most'))} <strong style="font-weight:600">${esc(T('t_axis')[AXES[most][0]])}</strong>
          · ${esc(T('t_fav'))} <strong style="font-weight:600;color:${C.olive}">${esc(T('t_axis')[AXES[fav][0]])}</strong>
        </div>
        <div style="font-size:11px;color:var(--mute);margin-top:5px;line-height:1.55">
          ${esc(same ? T('t_same') : T('t_differ'))}</div>
      </div>
      <div class="mono" style="font-size:10px;color:var(--mute);text-align:center;margin-top:14px">
        ${esc(T('t_from', prof.total))}</div>`;
  }
  $('#setSheet').innerHTML = head + chips + body;
  bind();
  $('#setSheet').querySelectorAll('[data-ts]').forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); state.tasteScope = b.dataset.ts; openLog(); };
  });
  show('setSheet');
}

/* ---------- the same ranking, laid against what she paid */
function valueChart(ranked) {
  const pts = ranked.map((r, i) => ({ k: r.id, rank: i + 1, price: keyPrice(r.id) }))
                    .filter(o => o.price > 0);
  if (pts.length < 3) return null;

  const W = 334, H = 330, L = 30, Rr = 14, Tp = 14, B = 40;
  const prices = pts.map(o => o.price).sort((a, b) => a - b);
  const lo = prices[0], hi = prices[prices.length - 1];
  const span = Math.max(hi - lo, 20);
  const pad = span * 0.14;
  const x0 = lo - pad, x1 = hi + pad;
  const maxRank = ranked.length;
  const X = v => L + (v - x0) / (x1 - x0) * (W - L - Rr);
  const Y = v => Tp + (v - 1) / Math.max(maxRank - 1, 1) * (H - Tp - B);

  const mid = prices.length % 2 ? prices[(prices.length - 1) / 2]
    : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  const midRank = (1 + maxRank) / 2;
  const mx = X(mid), my = Y(midRank);

  // the honest headline: only claims that hold for these points
  const cheap = pts.filter(o => o.price < mid);
  const treasure = cheap.slice().sort((a, b) => a.rank - b.rank)[0];
  const top = pts.slice().sort((a, b) => a.rank - b.rank)[0];
  const cheapest = pts.slice().sort((a, b) => a.price - b.price)[0];
  const inCorner = treasure && treasure.rank < midRank && treasure.price < mid;
  let line;
  if (top && cheapest && top.k === cheapest.k) line = T('q_top_cheap');
  else if (inCorner) line = T('q_treasure_is', keyPlace(treasure.k).n);
  else line = T('q_none_yet');
  const mark = inCorner ? treasure : null;

  const dot = o => {
    const best = mark && o.k === mark.k;
    return `<circle cx="${X(o.price).toFixed(1)}" cy="${Y(o.rank).toFixed(1)}"
      r="${best ? 7 : 4.4}" fill="${best ? C.crust : C.mute}" fill-opacity="${best ? 1 : .72}"/>` +
      (best ? `<circle cx="${X(o.price).toFixed(1)}" cy="${Y(o.rank).toFixed(1)}" r="11"
        fill="none" stroke="${C.crustDeep}" stroke-width="1" opacity=".45"/>` : '');
  };

  const label = (o, dx, dy, anchor) => {
    const q = keyPlace(o.k); if (!q) return '';
    const lx = Math.max(L + 4, Math.min(W - Rr - 4, X(o.price) + dx));
    const ly = Math.max(Tp + 14, Math.min(H - B - 18, Y(o.rank) + dy));
    const name = q.n.length > 20 ? q.n.slice(0, 19) + '…' : q.n;
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"
      text-anchor="${anchor}" font-family="'Cormorant Garamond',Georgia,serif" font-size="12.5"
      font-weight="600" fill="${C.ink}">${esc(name)}</text>
      <text x="${lx.toFixed(1)}" y="${(ly + 12).toFixed(1)}"
      text-anchor="${anchor}" font-family="'IBM Plex Mono',monospace" font-size="9"
      fill="${C.crustDeep}">${o.rank}${esc(T('q_place'))} · ${eur(o.price)}</text>`;
  };
  const side = mark && X(mark.price) > W * 0.55 ? -1 : 1;

  return { svg: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="${L}" y="${Tp}" width="${(mx - L).toFixed(1)}" height="${(my - Tp).toFixed(1)}"
      fill="${C.crust}" opacity=".06"/>
    <line x1="${mx.toFixed(1)}" y1="${Tp}" x2="${mx.toFixed(1)}" y2="${H - B}"
      stroke="${C.faint}" stroke-width="1" stroke-dasharray="3 4"/>
    <line x1="${L}" y1="${my.toFixed(1)}" x2="${W - Rr}" y2="${my.toFixed(1)}"
      stroke="${C.faint}" stroke-width="1" stroke-dasharray="3 4"/>
    <g font-family="'IBM Plex Sans KR',sans-serif" font-size="9.5">
      <text x="${L + 6}" y="${Tp + 12}" fill="${C.crustDeep}" font-weight="600">${esc(T('q_treasure'))}</text>
      <text x="${W - Rr - 4}" y="${Tp + 12}" text-anchor="end" fill="${C.mute}">${esc(T('q_worth'))}</text>
      <text x="${L + 6}" y="${H - B - 5}" fill="${C.mute}">${esc(T('q_meh'))}</text>
      <text x="${W - Rr - 4}" y="${H - B - 5}" text-anchor="end" fill="${C.mute}">${esc(T('q_no'))}</text>
    </g>
    <g stroke="${C.ink}" stroke-width=".9" opacity=".55">
      <line x1="${L}" y1="${Tp}" x2="${L}" y2="${H - B}"/>
      <line x1="${L}" y1="${H - B}" x2="${W - Rr}" y2="${H - B}"/>
    </g>
    <g font-family="'IBM Plex Mono',monospace" font-size="8.5" fill="${C.mute}">
      <text x="${L - 5}" y="${Tp + 4}" text-anchor="end">1</text>
      <text x="${L - 5}" y="${(H - B)}" text-anchor="end">${maxRank}</text>
      <text x="${L}" y="${H - B + 15}" text-anchor="start">${eur(lo)}</text>
      <text x="${mx.toFixed(1)}" y="${H - B + 15}" text-anchor="middle">${eur(mid)}</text>
      <text x="${W - Rr}" y="${H - B + 15}" text-anchor="end">${eur(hi)}</text>
      <text x="${L}" y="${H - 6}" text-anchor="start">${esc(T('q_rank_axis'))}</text>
      <text x="${W - Rr}" y="${H - 6}" text-anchor="end">${esc(T('q_price_axis'))}</text>
    </g>
    ${pts.map(dot).join('')}
    ${mark ? label(mark, side * 14, -12, side > 0 ? 'start' : 'end') : ''}
  </svg>`, line, n: pts.length, lo, hi, mid };
}

/* ---------- her ranking, and the duel that builds it */
function diaryRank(head, bind) {
  const K = [['all', T('r_shop')], ['0', T('f_bakery')], ['1', T('f_pastry')], ['2', T('f_choc')]]
    .concat(breadLeagues().map(c => ['b:' + c, breadName(c)]));
  const ids = rankable(state.rankKind);
  const ranked = btRank(ids);
  const pair = nextPair(state.rankKind);
  const duelsHere = state.duels.filter(([a, b]) =>
    ids.indexOf(a) >= 0 && ids.indexOf(b) >= 0).length;

  const chips = `<div style="display:flex;gap:6px;margin-top:12px;overflow-x:auto">
    ${K.map(([v, l]) => `<button class="chip ${state.rankKind === v ? 'on' : ''}" data-rk="${v}">${esc(l)}</button>`).join('')}
  </div>`;
  const chart = ids.length >= 2 ? valueChart(ranked) : null;
  const swap = `<div class="seg" style="margin-top:10px">
    <button data-rv="list" class="${state.rankView === 'list' ? 'on' : ''}">${esc(T('q_list'))}</button>
    <button data-rv="value" class="${state.rankView === 'value' ? 'on' : ''}">${esc(T('q_value'))}</button>
  </div>`;

  let body;
  if (ids.length < 2) {
    body = `<div style="text-align:center;padding:44px 0 24px">
      <div style="font-size:13px;font-weight:600">${esc(T('r_need'))}</div>
      <div style="font-size:11.5px;color:var(--mute);margin-top:6px">${esc(T('r_need_d'))}</div></div>`;
  } else {
    body = `
      <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
        <div class="mono" style="font-size:10.5px;color:var(--mute)">${esc(T('r_duels', duelsHere))}</div>
        <div style="flex:1 1 auto;height:1px;background:var(--line)"></div>
        ${(() => {
          if (state.rankKind.slice(0, 2) !== 'b:') return `<div class="mono" style="font-size:10.5px;color:var(--mute)">${ids.length}</div>`;
          const st = breadStats(state.rankKind.slice(2));
          return `<div class="mono" style="font-size:10.5px;color:var(--mute)">${st.avg ? esc(T('r_avg', eur(st.avg))) + ' · ' : ''}${ids.length}</div>`;
        })()}
      </div>
      ${ranked.map((r, i) => {
        const q = keyPlace(r.id);
        if (!q) return '';
        const sure = r.met >= 2;
        const pr = keyPrice(r.id);
        return `<div class="aw" data-id="${esc(r.id.split('#')[0])}">
          <div class="mono" style="width:20px;text-align:center;flex:0 0 auto;font-size:14px;
               color:${i === 0 ? C.crustDeep : C.mute};font-weight:${i === 0 ? 600 : 400}">${i + 1}</div>
          <div class="awn" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;font-weight:600">${esc(q.n)}</div>
          ${verdictDot(r.id.split('#')[0], 6)}
          ${pr ? `<div class="mono" style="font-size:10.5px;color:${C.crustDeep};flex:0 0 auto">${eur(pr)}</div>` : ''}
          <div class="mono" style="font-size:10px;color:var(--mute);flex:0 0 auto">${q.a}e</div>
          <div class="mono" style="font-size:9.5px;flex:0 0 auto;width:44px;text-align:right;
               color:${sure ? C.olive : C.faint}">${sure ? esc(T('r_sure')) : esc(T('r_judging'))}</div>
        </div>`;
      }).join('')}
      ${pair ? `<button class="cta" style="margin-top:16px" id="goDuel">${esc(T('r_duel'))}</button>`
             : `<div class="small" style="text-align:center;margin-top:16px">${esc(T('r_done'))}</div>`}`;
  }

  if (state.rankView === 'value' && ids.length >= 2) {
    body = chart ? `
      <div style="display:flex;justify-content:center;margin-top:12px">${chart.svg}</div>
      <div style="border-left:3px solid ${C.crust};padding:3px 0 3px 12px;margin-top:6px">
        <div style="font-size:12.5px;line-height:1.6">${esc(chart.line)}</div>
      </div>
      <div style="display:flex;gap:7px;margin-top:16px">
        <div style="flex:1 1 0;border:1px solid var(--line);background:var(--card);padding:10px 11px">
          <div class="mono" style="font-size:16px;font-weight:500;color:${C.crustDeep}">${eur(chart.mid)}</div>
          <div style="font-size:10px;color:var(--mute);margin-top:2px">${esc(T('q_mid'))}</div></div>
        <div style="flex:1 1 0;border:1px solid var(--line);background:var(--card);padding:10px 11px">
          <div class="mono" style="font-size:16px;font-weight:500">${eur(chart.hi - chart.lo)}</div>
          <div style="font-size:10px;color:var(--mute);margin-top:2px">${esc(T('q_spread'))}</div></div>
        <div style="flex:1 1 0;border:1px solid var(--line);background:var(--card);padding:10px 11px">
          <div class="mono" style="font-size:16px;font-weight:500">${chart.n}</div>
          <div style="font-size:10px;color:var(--mute);margin-top:2px">${esc(T('q_priced'))}</div></div>
      </div>`
    : `<div style="text-align:center;padding:40px 0 26px">
        <div style="font-size:13px;font-weight:600">${esc(T('q_need'))}</div>
        <div style="font-size:11.5px;color:var(--mute);margin-top:6px">${esc(T('q_need_d'))}</div></div>`;
  }

  $('#setSheet').innerHTML = head + chips + (ids.length >= 2 ? swap : '') + body;
  bind();
  $('#setSheet').querySelectorAll('[data-rv]').forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); state.rankView = b.dataset.rv; openLog(); };
  });
  $('#setSheet').querySelectorAll('[data-rk]').forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); state.rankKind = b.dataset.rk; openLog(); };
  });
  const g = $('#goDuel');
  if (g) g.onclick = ev => { ev.stopPropagation(); openDuel(); };
  show('setSheet');
}

function openDuel() {
  const pair = nextPair(state.rankKind);
  if (!pair) { openLog(); return; }
  const P0 = keyPlace(pair[0]), P1 = keyPlace(pair[1]);
  if (!P0 || !P1) { openLog(); return; }
  const card = (k, side) => {
    const q = keyPlace(k);
    const code = keyBread(k);
    q.key = k;
    return `
    <button data-win="${esc(k)}" style="display:block;width:100%;text-align:left;
        border:1px solid var(--line);background:var(--card);padding:15px 16px">
      <div class="mono" style="font-size:9px;letter-spacing:2px;color:${C.crustDeep}">${side}</div>
      <div class="ser" style="font-size:21px;font-weight:600;line-height:1.15;margin-top:6px">${esc(q.n)}</div>
      ${code ? `<div style="display:flex;align-items:center;gap:7px;margin-top:7px">
        ${breadIcon(code, 18, C.crustDeep)}
        <div class="ser" style="font-size:14px;font-weight:600;color:${C.crustDeep}">${esc(BREAD[code] ? BREAD[code].fr : code)}</div>
        ${keyPrice(q.key) ? `<div class="mono" style="font-size:12px;color:var(--ink2)">${eur(keyPrice(q.key))}</div>` : ''}
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <div class="mono" style="font-size:10.5px;color:var(--mute)">${q.a}e</div>
        <div class="dot"></div>
        <div style="font-size:11px;color:var(--ink2)">${esc(T('kind')[q.k])}</div>
        ${state.verdict[q.id] !== undefined ? '<div class="dot"></div><div style="font-size:11px;color:var(--ink2)">' + esc(T(VKEY[state.verdict[q.id]])) + '</div>' : ''}
      </div>
      ${q.aw ? `<div class="mono" style="font-size:9.5px;color:${C.crustDeep};margin-top:7px">${esc(T('wins', q.aw.length))}</div>` : ''}
      ${(() => {
        const note = code ? (itemsOf(q.id).filter(i => i.b === code && i.n).slice(-1)[0] || {}).n : '';
        return note ? `<div style="font-size:11.5px;color:var(--ink2);line-height:1.5;margin-top:8px;
          padding-top:8px;border-top:1px solid var(--divider)">${esc(note)}</div>` : '';
      })()}
      <div class="mono" style="font-size:9.5px;color:var(--mute);margin-top:5px">${esc(T('stamped_n', (state.visits[q.id] || []).length))}</div>
    </button>`;
  };

  $('#stampSheet').innerHTML = `
    <div class="grip"></div>
    <div style="text-align:center">
      <div class="lbl">${esc(T('d_rank'))}</div>
      <div class="ser" style="font-size:25px;font-weight:600;margin-top:10px">${esc(T('r_which'))}</div>
      <div style="font-size:11.5px;color:var(--mute);margin-top:5px">${esc(T('r_which_d'))}</div>
    </div>
    <div style="margin-top:18px">${card(pair[0], 'A')}</div>
    <div style="display:flex;align-items:center;gap:12px;margin:12px 0">
      <div style="flex:1 1 auto;height:1px;background:var(--line)"></div>
      <div class="ser" style="font-size:19px;font-weight:700;letter-spacing:3px;color:var(--mute)">VS</div>
      <div style="flex:1 1 auto;height:1px;background:var(--line)"></div>
    </div>
    <div>${card(pair[1], 'B')}</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="cta ghost" style="flex:1 1 0" id="duelSkip">${esc(T('r_skip'))}</button>
      <button class="cta ghost" style="flex:1 1 0" id="duelStop">${esc(T('done'))}</button>
    </div>`;
  $('#stampSheet').querySelectorAll('[data-win]').forEach(b => {
    b.onclick = () => {
      const win = b.dataset.win;
      const lose = pair[0] === win ? pair[1] : pair[0];
      state.duels.push([win, lose]);
      saveRecords();
      const more = nextPair(state.rankKind);
      if (more) openDuel(); else { closeSheets(); state.diaryView = 'rank'; openLog(); }
    };
  });
  $('#duelSkip').onclick = () => {
    state.duels.push([pair[0], pair[1]]);        // a draw is one win each way
    state.duels.push([pair[1], pair[0]]);
    saveRecords();
    const more = nextPair(state.rankKind);
    if (more) openDuel(); else { closeSheets(); state.diaryView = 'rank'; openLog(); }
  };
  $('#duelStop').onclick = () => { closeSheets(); state.diaryView = 'rank'; openLog(); };
  show('stampSheet');
}

/* ---------- every stamp, in the order it happened */
function diaryTime(head, bind) {
  const rows = [];
  for (const id of stampedIds()) {
    const p = state.byId[id]; if (!p) continue;
    state.visits[id].forEach((t, i) => rows.push({ p, t, n: i + 1 }));
  }
  rows.sort((a, b) => b.t - a.t);
  const shops = stampedIds().length;

  let body;
  if (!rows.length) {
    body = `<div style="text-align:center;padding:46px 0 30px">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="${C.faint}" stroke-width="1.2" stroke-linecap="round">
        <circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5"/></svg>
      <div style="font-size:13.5px;font-weight:600;margin-top:14px">${esc(T('log_empty'))}</div>
      <div style="font-size:11.5px;color:var(--mute);margin-top:6px">${esc(T('log_empty_sub'))}</div>
    </div>`;
  } else {
    let last = '';
    body = rows.map(r => {
      const d = fmtDate(r.t);
      const head = d === last ? '' :
        `<div class="mono" style="font-size:10px;color:var(--mute);letter-spacing:1.4px;margin:16px 0 6px">${esc(d)}</div>`;
      last = d;
      return head + `<div class="aw" data-id="${esc(r.p.id)}">
        ${verdictDot(r.p.id, 6)}
        <svg width="18" height="18" viewBox="0 0 20 20" style="flex:0 0 auto">
          <circle cx="10" cy="10" r="7.4" fill="${C.crust}" opacity="${Math.min(1, .45 + r.n * .18)}"/>
          <circle cx="10" cy="10" r="9" fill="none" stroke="${C.crustDeep}" stroke-width=".9" opacity=".45"/></svg>
        <div class="awn" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;font-weight:600">${esc(r.p.n)}</div>
        <div class="mono" style="font-size:10px;color:var(--mute);flex:0 0 auto">${r.p.a}e</div>
        ${r.n > 1 ? '<div class="mono" style="font-size:10px;color:' + C.crustDeep + ';flex:0 0 auto">' + esc(T('nth', r.n)) + '</div>' : ''}
      </div>`;
    }).join('');
  }

  $('#setSheet').innerHTML = head +
    `<div class="mono" style="font-size:10.5px;color:var(--mute);margin-top:12px">${esc(T('log_sum', shops, rows.length))}</div>` +
    body;
  bind();
  show('setSheet');
}

/* ----------------------------------------------------------- the trail tab */
function openTrail() {
  const done = arrDone();
  const cells = state.paris.arr.map(a => {
    const on = done.has(a.n);
    return `<div style="border:1px solid ${on ? C.crust : C.line};background:${on ? 'rgba(196,131,46,.12)' : C.card};padding:7px 6px 8px;min-height:46px;display:flex;flex-direction:column;gap:2px">
      <div class="mono" style="font-size:13px;font-weight:500;color:${on ? C.crustDeep : C.mute}">${a.n}</div>
      <div style="font-size:8.5px;color:${on ? C.ink2 : C.mute};line-height:1.15;overflow:hidden">${esc(a.name || '')}</div>
    </div>`;
  }).join('');

  const gp = (state.awards && state.awards.length) ? state.awards.slice().reverse().slice(0, 8) : [];
  const gpRows = gp.map(w => `
    <div class="aw">
      <div class="mono" style="font-size:10.5px;color:var(--mute);width:30px;flex:0 0 auto">${w.y}</div>
      <div class="awn" style="font-size:12.5px">${esc(w.shop || w.who)}
        ${w.shop ? '<div class="mono" style="font-size:9px;color:var(--mute);margin-top:1px">' + esc(w.who) + '</div>' : ''}</div>
      <div class="mono" style="font-size:10px;color:var(--mute);flex:0 0 auto">${w.arr ? w.arr + 'e' : '—'}</div>
    </div>`).join('');

  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('trail_title'))}</div>
    <div style="font-size:11.5px;color:var(--mute);margin-top:3px">${esc(T('trail_sub'))}</div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:20px">
      <div style="font-size:12.5px;font-weight:600">${esc(T('trail_arr'))}</div>
      <div class="mono" style="font-size:11px;color:${C.crustDeep}">${done.size} / 20</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin-top:9px">${cells}</div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:22px">
      <div style="font-size:12.5px;font-weight:600">${esc(T('trail_gp'))}</div>
      <div class="mono" style="font-size:11px;color:var(--mute)">${state.awards ? state.awards.length : 33}</div>
    </div>
    <div class="small" style="margin-top:4px">${esc(T('trail_gp_sub'))}</div>
    <div style="margin-top:6px">${gpRows}</div>

    <div style="font-size:12.5px;font-weight:600;margin-top:22px">${esc(T('trail_book'))}</div>
    <div class="small" style="margin-top:4px">${esc(T('trail_book_soon'))}</div>`;
  $('#setSheet').onclick = null;
  show('setSheet');
}

/* ------------------------------------------------------- what she bought today */
function openBasket(p) {
  const day = new Date().setHours(0, 0, 0, 0);
  const today = itemsOf(p.id).filter(i => i.t >= day);
  const total = today.reduce((a, b) => a + (b.p || 0), 0);

  const cell = ([code, fr]) => {
    const on = today.some(i => i.b === code);
    return `<button data-b="${code}" style="display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:4px;height:64px;border:1px solid ${on ? C.crust : C.line};
        background:${on ? 'rgba(196,131,46,.10)' : C.card};width:100%">
      ${breadIcon(code, 25, on ? C.crustDeep : C.ink2)}
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:10.5px;font-weight:600;
           line-height:1;color:${on ? C.crustDeep : C.ink2};text-align:center">${esc(fr)}</div>
    </button>`;
  };

  const row = it => `
    <div style="border:1px solid var(--line);background:var(--card);padding:11px 12px">
      <div style="display:flex;align-items:center;gap:9px">
        ${breadIcon(it.b, 20, C.crustDeep)}
        <div class="ser" style="flex:1 1 auto;font-size:15px;font-weight:600;min-width:0">${esc(BREAD[it.b] ? BREAD[it.b].fr : it.b)}</div>
        <div style="display:flex;align-items:center;border:1px solid var(--line)">
          <button data-p="-" data-t="${it.t}" style="width:32px;height:32px">−</button>
          <div class="mono" style="min-width:52px;text-align:center;font-size:12.5px;color:${it.p ? C.crustDeep : C.mute}">${it.p ? eur(it.p) : '—'}</div>
          <button data-p="+" data-t="${it.t}" style="width:32px;height:32px">+</button>
        </div>
        <button data-x="${it.t}" style="width:26px;height:32px;color:var(--mute)">×</button>
      </div>
      <input data-n="${it.t}" placeholder="${esc(T('i_note'))}" value="${esc(it.n || '')}"
        style="width:100%;margin-top:8px;padding:7px 0 0;border:none;border-top:1px solid var(--divider);
        background:none;font:inherit;font-size:11.5px;color:var(--ink2);outline:none">
    </div>`;

  $('#stampSheet').innerHTML = `
    <div class="grip"></div>
    <div class="lbl">${esc(T('i_ask'))}</div>
    <div class="ser" style="font-size:20px;font-weight:600;line-height:1.15;margin-top:8px">${esc(p.n)}</div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:14px">
      ${BREADS.map(cell).join('')}
    </div>
    ${today.length ? `
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:18px">
        <div class="lbl">${esc(T('i_basket', today.length))}</div>
        <div class="mono" style="font-size:12px;color:${C.crustDeep}">${eur(total)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-top:9px">${today.map(row).join('')}</div>`
    : `<div class="small" style="text-align:center;margin-top:18px">${esc(T('i_none'))}</div>`}
    <button class="cta" style="margin-top:16px" id="basketDone">${esc(T('done'))}</button>`;

  const redraw = () => { saveRecords(); openBasket(p); };
  $('#stampSheet').querySelectorAll('[data-b]').forEach(b => {
    b.onclick = () => {
      const code = b.dataset.b;
      const list = state.items[p.id] || (state.items[p.id] = []);
      const at = list.findIndex(i => i.b === code && i.t >= day);
      if (at >= 0) list.splice(at, 1); else list.push({ b: code, p: 0, n: '', t: Date.now() });
      redraw();
    };
  });
  $('#stampSheet').querySelectorAll('[data-p]').forEach(b => {
    b.onclick = () => {
      const it = itemsOf(p.id).find(i => String(i.t) === b.dataset.t);
      if (!it) return;
      it.p = Math.max(0, (it.p || 0) + (b.dataset.p === '+' ? 10 : -10));
      redraw();
    };
  });
  $('#stampSheet').querySelectorAll('[data-x]').forEach(b => {
    b.onclick = () => {
      const list = state.items[p.id] || [];
      const at = list.findIndex(i => String(i.t) === b.dataset.x);
      if (at >= 0) list.splice(at, 1);
      redraw();
    };
  });
  $('#stampSheet').querySelectorAll('[data-n]').forEach(inp => {
    inp.onchange = () => {
      const it = itemsOf(p.id).find(i => String(i.t) === inp.dataset.n);
      if (it) { it.n = inp.value.slice(0, 200); saveRecords(); }
    };
  });
  $('#basketDone').onclick = closeSheets;
  show('stampSheet');
}

/* --------------------------------------------------------- the ranking tab */
function openRanking() {
  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('rank_title'))}</div>
    <div style="display:flex;justify-content:center;margin:26px 0 18px">
      <svg width="230" height="96" viewBox="0 0 230 96">
        <rect x="4" y="8" width="96" height="80" fill="${C.card}" stroke="${C.line}"/>
        <rect x="130" y="8" width="96" height="80" fill="${C.card}" stroke="${C.line}"/>
        <g stroke="${C.crust}" stroke-width="1.3" fill="none" stroke-linecap="round">
          <g transform="translate(52 40) rotate(-38)"><ellipse rx="3.2" ry="8.6"/><path d="M-2 -4.6l4.2-1.3M-2.2 -.4l4.4-1.3M-2 3.8l4.2-1.3"/></g>
          <g transform="translate(178 40) rotate(-38)"><ellipse rx="3.2" ry="8.6"/><path d="M-2 -4.6l4.2-1.3M-2.2 -.4l4.4-1.3M-2 3.8l4.2-1.3"/></g>
        </g>
        <line x1="24" y1="66" x2="80" y2="66" stroke="${C.line}"/>
        <line x1="150" y1="66" x2="206" y2="66" stroke="${C.line}"/>
        <line x1="30" y1="76" x2="66" y2="76" stroke="${C.line}"/>
        <line x1="156" y1="76" x2="192" y2="76" stroke="${C.line}"/>
        <text x="115" y="52" text-anchor="middle" font-family="Cormorant Garamond,Georgia,serif" font-size="19" font-weight="700" letter-spacing="2" fill="${C.mute}">VS</text>
      </svg>
    </div>
    <div style="text-align:center">
      <div style="font-size:14px;font-weight:600">${esc(T('rank_soon'))}</div>
    </div>
    <div class="body" style="white-space:pre-line;margin-top:12px;text-align:center">${esc(T('rank_soon_body'))}</div>
    <button class="cta" style="margin-top:22px" id="rankBack">${esc(T('tab_map'))}</button>`;
  $('#setSheet').onclick = null;
  $('#rankBack').onclick = backToMap;
  show('setSheet');
}

/* -------------------------------------------------------------- first open */
/* ------------------------------------------------------------------ search */
const fold = str => (str || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function buildIndex() {
  for (const q of state.places) {
    q.F = fold(q.n);
    q.FS = fold(q.s);
    q.FW = ' ' + q.F;                            // word starts, for cheap testing
  }
}

function searchPlaces(raw, limit) {
  const t = fold(raw);
  if (!t) return [];
  const parts = t.split(' ').filter(Boolean);
  const out = [];
  for (const q of state.places) {
    let score = 0;
    for (const w of parts) {
      let sc = 0;
      if (q.F.startsWith(w)) sc = 100;
      else if (q.FW.indexOf(' ' + w) >= 0) sc = 70;
      else if (q.F.indexOf(w) >= 0) sc = 40;
      else if (q.FS && q.FS.indexOf(w) >= 0) sc = 25;
      if (!sc) { score = -1; break; }
      score += sc;
    }
    if (score <= 0) continue;
    if (q.aw) score += 6;                        // a judged shop is likelier the one meant
    if (state.visits[q.id]) score += 4;          // and so is one she has been to
    out.push({ q, score });
  }
  out.sort((a, b) => b.score - a.score || a.q.n.length - b.q.n.length);
  return out.slice(0, limit || 40).map(o => o.q);
}

function searchRow(q) {
  const open = q.O === true;
  return `<button class="sres" data-sid="${esc(q.id)}">
    <svg width="14" height="14" viewBox="0 0 14 14" style="flex:0 0 auto">
      ${open ? `<circle cx="7" cy="7" r="6.5" fill="${C.glow}" opacity=".28"/>` : ''}
      <circle cx="7" cy="7" r="4" fill="${KIND[q.k]}" fill-opacity="${open ? 1 : .5}"/></svg>
    <div style="flex:1 1 auto;min-width:0">
      <div class="ser" style="font-size:15.5px;font-weight:600;line-height:1.2;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.n)}</div>
      <div class="mono" style="font-size:10px;color:var(--mute);margin-top:3px;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.s || '')}${q.s ? ' · ' : ''}${q.a}e${open ? ' · ' + esc(T('s_open_now')) : ''}</div>
    </div>
    ${q.aw ? `<svg width="18" height="16" viewBox="0 0 18 16" style="flex:0 0 auto">
      <g fill="none" stroke="${C.crustDeep}" stroke-width="1.3" stroke-linecap="round">
      <path d="M5.2 4 Q1.8 8 5.2 12"/><path d="M12.8 4 Q16.2 8 12.8 12"/></g>
      <circle cx="9" cy="8" r="2.6" fill="${C.crust}"/></svg>` : ''}
    ${state.visits[q.id] ? `<svg width="15" height="15" viewBox="0 0 15 15" style="flex:0 0 auto">
      <circle cx="7.5" cy="7.5" r="5" fill="${C.crust}"/>
      <circle cx="7.5" cy="7.5" r="6.8" fill="none" stroke="${C.crustDeep}" stroke-width=".9" opacity=".5"/></svg>` : ''}
  </button>`;
}

function paintSearch() {
  const v = $('#searchIn').value;
  const out = $('#searchOut');
  if (!fold(v)) {
    const picks = state.places.filter(q => q.aw && q.aw.length >= 2).slice(0, 8);
    out.innerHTML = `<div class="lbl" style="margin:16px 0 2px">${esc(T('s_hint'))}</div>` +
      picks.map(searchRow).join('');
  } else {
    const hits = searchPlaces(v);
    out.innerHTML = hits.length
      ? `<div class="lbl" style="margin:16px 0 2px">${esc(T('s_count', hits.length))}</div>` +
        hits.map(searchRow).join('')
      : `<div style="text-align:center;padding:48px 0 20px">
          <div style="font-size:13px;font-weight:600">${esc(T('s_none'))}</div>
          <div style="font-size:11.5px;color:var(--mute);margin-top:6px;line-height:1.55">${esc(T('s_none_d'))}</div></div>`;
  }
}

function openSearch() {
  $('#searchIn').placeholder = T('s_ph');
  $('#search').classList.add('on');
  paintSearch();
  setTimeout(() => $('#searchIn').focus(), 60);
}
function closeSearch() { $('#search').classList.remove('on'); }

on('#searchField', 'click', openSearch);
on('#searchBack', 'click', closeSearch);
on('#searchClear', 'click', () => { $('#searchIn').value = ''; paintSearch(); $('#searchIn').focus(); });
on('#searchIn', 'input', paintSearch);
on('#searchIn', 'keydown', e => {
  if (e.key !== 'Enter') return;
  const first = $('#searchOut').querySelector('[data-sid]');
  if (first) first.click();
});
on('#searchOut', 'click', e => {
  const b = e.target.closest('[data-sid]'); if (!b) return;
  const q = state.byId[b.dataset.sid]; if (!q) return;
  closeSearch();
  focusPlace(q, 1.6); render(); openPlace(q);
});

/* ------------------------------------------------------------- the language */
function openLangs() {
  $('#setSheet').onclick = null;
  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('language'))}</div>
    <div class="seg" style="margin-top:14px">
      ${['ko', 'en', 'fr'].map(l => `<button data-l="${l}" class="${l === state.lang ? 'on' : ''}">${esc(window.I18N[l].lang)}</button>`).join('')}
    </div>
    <div class="small">${esc(T('proper_note'))}</div>
    <button class="cta ghost" style="margin-top:16px" id="toSettings">${esc(T('settings'))}</button>`;
  $('#setSheet').querySelectorAll('[data-l]').forEach(b => {
    b.onclick = () => { setLang(b.dataset.l); openLangs(); };
  });
  $('#toSettings').onclick = openSettings;
  show('setSheet');
}

/* Paris as it actually is — the outer edge of the twenty rings, plus the river. */
function parisSilhouette(w, h) {
  const arr = state.paris.arr, water = state.paris.water;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  arr.forEach(a => {
    for (let i = 0; i < a.W.length; i += 2) {
      if (a.W[i] < x0) x0 = a.W[i]; if (a.W[i] > x1) x1 = a.W[i];
      if (a.W[i + 1] < y0) y0 = a.W[i + 1]; if (a.W[i + 1] > y1) y1 = a.W[i + 1];
    }
  });
  const pad = 6;
  const k = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
  const ox = (w - (x1 - x0) * k) / 2 - x0 * k;
  const oy = (h - (y1 - y0) * k) / 2 - y0 * k;
  const d = flat => {
    let out = '';
    for (let i = 0; i < flat.length; i += 2) {
      out += (i ? 'L' : 'M') + (flat[i] * k + ox).toFixed(1) + ' ' + (flat[i + 1] * k + oy).toFixed(1);
    }
    return out + 'Z';
  };
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <g fill="${C.paperDeep}" opacity=".9">${arr.map(a => `<path d="${d(a.W)}"/>`).join('')}</g>
    <g fill="${C.seine}" opacity=".55">${water.filter(x => x.length > 40).map(x => `<path d="${d(x)}"/>`).join('')}</g>
    <g fill="none" stroke="${C.line}" stroke-width=".8">${arr.map(a => `<path d="${d(a.W)}"/>`).join('')}</g>
  </svg>`;
}

function openWelcome() {
  $('#stampSheet').innerHTML = `
    <div class="grip"></div>
    <div style="text-align:center;padding-top:6px">
      <svg width="54" height="20" viewBox="0 0 54 20">
        <g stroke="${C.crust}" stroke-width="3.4" stroke-linecap="round">
          <path d="M9 15L18 5"/><path d="M22.5 16.4L31.5 6.4"/><path d="M36 15L45 5"/></g></svg>
      <div class="ser" style="font-size:32px;font-weight:600;letter-spacing:9px;margin-top:14px">MIETTE</div>
      <div class="ser" style="font-style:italic;font-size:15px;color:${C.crustDeep};letter-spacing:1px;margin-top:2px">in Paris</div>
      <div class="ser" style="font-style:italic;font-size:14px;color:var(--mute);margin-top:5px">${esc(T('tagline'))}</div>
      <div style="display:flex;justify-content:center;margin-top:16px">${parisSilhouette(300, 158)}</div>
    </div>
    <div class="rule" style="margin:20px 0 16px"></div>
    <div style="font-size:13.5px;line-height:1.65">${esc(T('welcome_hi'))}</div>
    <div class="ser" style="font-style:italic;font-size:15px;color:var(--ink2);white-space:pre-line;margin-top:14px;line-height:1.5">${esc(T('welcome_2'))}</div>
    <div style="text-align:center;margin:26px 0 4px">
      <svg width="34" height="12" viewBox="0 0 34 12" style="opacity:.5">
        <g stroke="${C.crust}" stroke-width="2" stroke-linecap="round">
          <path d="M6 9L11 3"/><path d="M14.5 9.8L19.5 3.8"/><path d="M23 9L28 3"/></g></svg>
      <div class="ser" style="font-style:italic;font-size:14.5px;color:${C.crustDeep};margin-top:10px;line-height:1.55">${esc(T('dedication'))}</div>
    </div>
    <button class="cta" style="margin-top:24px" id="welcomeGo">${esc(T('welcome_go'))}</button>`;
  $('#welcomeGo').onclick = () => { state.meta.seen = Date.now(); saveRecords(); closeSheets(); };
  show('stampSheet');
}

/* -------------------------------------------------------------------- boot */
const BUILD = 'v40';
const BOOT_AT = Date.now();

async function boot() {
  try { state.lang = localStorage.getItem('miette.lang') || navLang(); } catch (e) { state.lang = navLang(); }
  document.documentElement.lang = state.lang;

  const [paris, places, comps, awards, streets] = await Promise.all([
    fetch('data/paris.json').then(r => r.json()),
    fetch('data/places.json').then(r => r.json()),
    fetch('data/competitions.json').then(r => r.json()).catch(() => ({ competitions: [] })),
    fetch('data/awards.json').then(r => r.json()).catch(() => null),
    fetch('data/streets.json').then(r => r.json()).catch(() => null)
  ]);
  await loadRecords();

  // world origin from the city itself, so the projection matches the drawing
  let lo = 999, la = -999;
  paris.arr.forEach(a => {
    for (let i = 0; i < a.r.length; i += 2) { lo = Math.min(lo, a.r[i]); la = Math.max(la, a.r[i + 1]); }
  });
  LON0 = lo; LAT1 = la;

  paris.arr.forEach(a => {
    a.W = new Float64Array(a.r.length);
    for (let i = 0; i < a.r.length; i += 2) { a.W[i] = wx(a.r[i]); a.W[i + 1] = wy(a.r[i + 1]); }
    a.WX = wx(a.c[0]); a.WY = wy(a.c[1]);
  });
  paris.water = paris.water.map(w => {
    const W = new Float64Array(w.length);
    for (let i = 0; i < w.length; i += 2) { W[i] = wx(w[i]); W[i + 1] = wy(w[i + 1]); }
    return W;
  });
  state.paris = paris;

  if (streets) {
    const unpack = way => {
      const n = way.length / 2, W = new Float64Array(way.length);
      let px = 0, py = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < n; i++) {
        px = i ? px + way[i * 2] : way[0];
        py = i ? py + way[i * 2 + 1] : way[1];
        const X = wx(px / streets.q), Y = wy(py / streets.q);
        W[i * 2] = X; W[i * 2 + 1] = Y;
        if (X < x0) x0 = X; if (X > x1) x1 = X;
        if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      }
      return { W, x0, x1, y0, y1 };
    };
    state.roads = streets.tiers.map(t => t.map(unpack));
    state.green = streets.green.map(unpack);
  } else { state.roads = null; state.green = null; }

  state.places = places.places;
  state.byId = {};
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of state.places) {
    p.WX = wx(p.x); p.WY = wy(p.y); state.byId[p.id] = p;
    x0 = Math.min(x0, p.WX); x1 = Math.max(x1, p.WX);
    y0 = Math.min(y0, p.WY); y1 = Math.max(y1, p.WY);
  }
  state.bounds = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  buildIndex();
  refreshHours();
  setInterval(() => { refreshHours(); if (state.ready) render(); }, 60000);
  (comps.competitions || []).forEach(c => { state.comps[c.id] = c; });
  state.awards = awards && awards.competitions && awards.competitions[0]
    ? awards.competitions[0].winners : [];

  resize();
  fitAll();
  state.k = Math.min(state.kMax, state.kMin * 5.2);   // open on a walkable district
  state.ready = true;
  paintChips(); paintStrip(); paintTabs();
  $('#langbtn').textContent = state.lang.toUpperCase();
  $('#searchFieldLbl').textContent = T('s_ph');
  clampView(); render();
  // on a warm cache the data is back in 80 ms and the tower never gets seen
  const held = Math.max(0, 1500 - (Date.now() - BOOT_AT));
  setTimeout(() => {
    window.__miette_ok = true;
  $('#boot').classList.add('fading');
    setTimeout(() => $('#boot').classList.add('gone'), 760);
    if (!state.meta.seen) setTimeout(openWelcome, 300);
  }, held);

  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {}
}
const navLang = () => {
  const l = (navigator.language || 'ko').slice(0, 2).toLowerCase();
  return ['ko', 'en', 'fr'].includes(l) ? l : 'ko';
};

function refreshHours() {
  const now = parisNow();
  for (const p of state.places) p.O = p.h ? openNow(p.h, now) : null;
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 260));

boot().catch(err => {
  console.error(err);
  const m = $('#bootMsg'), f = $('#bootFix');
  if (m) m.textContent = T('load_fail');
  if (f) f.className = 'show';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // an older cache-first worker can outlive several releases; retire it at once
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) location.reload();
        });
      });
      reg.update();
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    }).catch(() => {});
  });
}
