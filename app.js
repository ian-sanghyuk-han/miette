/* Miette — the map, the card, the stamp.
   No tile server, no CDN, no account: everything here is drawn from two static
   JSON files and everything she does is kept in this phone's IndexedDB. */
'use strict';

/* ------------------------------------------------------------------ basics */
const $ = s => document.querySelector(s);
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
  olive: '#77794F', seine: '#9DAEAC'
};

// one hue per trade — the map should say what a shop is before you read a word
const KIND = ['#C4832E', '#A65B72', '#6E4A34', '#8E7098'];

const state = {
  lang: 'ko', paris: null, places: [], comps: {},
  visits: {}, wish: {}, meta: {},
  filter: 'all', onlyAward: false, onlyOpen: false, onlyIndie: false,
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
  } catch (e) { /* private mode or blocked storage — run without a record */ }
}
const saveRecords = () => Promise.all([
  DB.set('visits', state.visits), DB.set('wish', state.wish), DB.set('meta', state.meta)
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
function ringPath(flat) {
  ctx.moveTo(sx(flat[0]), sy(flat[1]));
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(sx(flat[i]), sy(flat[i + 1]));
  ctx.closePath();
}

function visible(p) {
  if (state.filter !== 'all' && p.k !== +state.filter) return false;
  if (state.onlyAward && !p.aw) return false;
  if (state.onlyIndie && p.b) return false;
  if (state.onlyOpen && openNow(p.h) !== true) return false;
  return true;
}

function render() {
  const k = state.k;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, VW, VH);

  // arrondissements — fill, then the visited ones over the top, then the outline
  ctx.beginPath(); state.paris.arr.forEach(a => ringPath(a.W));
  ctx.fillStyle = C.paperDeep; ctx.globalAlpha = .55; ctx.fill(); ctx.globalAlpha = 1;

  const done = arrDone();
  if (done.size) {
    ctx.beginPath();
    state.paris.arr.forEach(a => { if (done.has(a.n)) ringPath(a.W); });
    ctx.fillStyle = C.crust; ctx.globalAlpha = .14; ctx.fill(); ctx.globalAlpha = 1;
  }

  ctx.beginPath(); state.paris.water.forEach(w => ringPath(w));
  ctx.fillStyle = C.seine; ctx.globalAlpha = .32; ctx.fill(); ctx.globalAlpha = 1;

  ctx.beginPath(); state.paris.arr.forEach(a => ringPath(a.W));
  ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.globalAlpha = .8; ctx.stroke(); ctx.globalAlpha = 1;

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

  for (let kind = 0; kind < 4; kind++) {
    // open — a solid dot
    ctx.beginPath();
    for (const p of live) {
      if (p.k !== kind || p.O !== true) continue;
      ctx.moveTo(p.sx + r, p.sy); ctx.arc(p.sx, p.sy, r, 0, 6.284);
    }
    ctx.fillStyle = KIND[kind]; ctx.globalAlpha = .92; ctx.fill();

    // hours unknown — the same dot, quieter
    ctx.beginPath();
    for (const p of live) {
      if (p.k !== kind || p.O !== null) continue;
      ctx.moveTo(p.sx + r, p.sy); ctx.arc(p.sx, p.sy, r, 0, 6.284);
    }
    ctx.globalAlpha = .42; ctx.fill(); ctx.globalAlpha = 1;

    // shut — an empty shutter
    if (r > 2) {
      ctx.beginPath();
      for (const p of live) {
        if (p.k !== kind || p.O !== false) continue;
        ctx.moveTo(p.sx + r, p.sy); ctx.arc(p.sx, p.sy, r, 0, 6.284);
      }
      ctx.strokeStyle = KIND[kind]; ctx.lineWidth = Math.min(1.6, r * .5);
      ctx.globalAlpha = .78; ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      for (const p of live) {
        if (p.k !== kind || p.O !== false) continue;
        ctx.moveTo(p.sx + r, p.sy); ctx.arc(p.sx, p.sy, r, 0, 6.284);
      }
      ctx.globalAlpha = .34; ctx.fill(); ctx.globalAlpha = 1;
    }
  }

  // a laurel around the awarded — our own mark, never a competition's
  if (r >= 2.4) {
    const lr = r + 3.2;
    ctx.strokeStyle = C.crustDeep; ctx.lineWidth = Math.min(1.6, r * .42);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const p of live) {
      if (!p.aw) continue;
      ctx.moveTo(p.sx - lr, p.sy - lr * .58);
      ctx.quadraticCurveTo(p.sx - lr * 1.42, p.sy, p.sx - lr, p.sy + lr * .58);
      ctx.moveTo(p.sx + lr, p.sy - lr * .58);
      ctx.quadraticCurveTo(p.sx + lr * 1.42, p.sy, p.sx + lr, p.sy + lr * .58);
    }
    ctx.globalAlpha = .85; ctx.stroke(); ctx.globalAlpha = 1;

    // a laureate wears a seed above the laurel
    if (r >= 3.4) {
      ctx.beginPath();
      for (const p of live) {
        if (!p.aw || !p.aw.some(a => a.r === 1)) continue;
        ctx.moveTo(p.sx + 1.5, p.sy - lr - 2.4); ctx.arc(p.sx, p.sy - lr - 2.4, 1.5, 0, 6.284);
      }
      ctx.fillStyle = C.crustDeep; ctx.fill();
    }
  }

  // want-to-go — an outer ring, in the trade's own colour
  for (let kind = 0; kind < 4; kind++) {
    ctx.beginPath();
    let any = false;
    for (const p of seen) {
      if (p.k !== kind || !state.wish[p.id] || state.visits[p.id]) continue;
      any = true;
      ctx.moveTo(p.sx + r + 3.4, p.sy); ctx.arc(p.sx, p.sy, r + 3.4, 0, 6.284);
    }
    if (!any) continue;
    ctx.strokeStyle = C.olive; ctx.lineWidth = 1.8; ctx.stroke();
  }

  // the trail, oldest to newest
  const walked = stampedInOrder();
  if (walked.length > 1) {
    ctx.beginPath();
    walked.forEach((p, i) => i ? ctx.lineTo(sx(p.WX), sy(p.WY)) : ctx.moveTo(sx(p.WX), sy(p.WY)));
    ctx.strokeStyle = C.crustDeep; ctx.lineWidth = Math.max(2, 4 * Math.min(k, 1));
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
      ctx.fillStyle = C.crust; ctx.globalAlpha = 0.42 + 0.16 * i; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, rr + 3.2, 0, 6.284);
    ctx.strokeStyle = C.crustDeep; ctx.lineWidth = 1; ctx.globalAlpha = .5; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (state.sel) {
    const p = state.sel;
    ctx.beginPath(); ctx.arc(sx(p.WX), sy(p.WY), r + 9, 0, 6.284);
    ctx.strokeStyle = C.crustDeep; ctx.lineWidth = 1.6; ctx.stroke();
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

function openPlace(p) {
  state.sel = p; render();
  const n = (state.visits[p.id] || []).length;
  const hl = hoursLine(p.h);
  const aw = (p.aw || []).slice(0, 6);
  const gmaps = 'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(p.n + ' ' + (p.s || '') + ' Paris');
  const route = 'https://www.google.com/maps/dir/?api=1&destination=' + p.y + ',' + p.x;

  $('#placeSheet').innerHTML = `
    <div class="grip"></div>
    <div class="name">${esc(p.n)}</div>
    <div class="meta">
      <div>${esc(T('kind')[p.k])}</div><div class="dot"></div>
      <div>${p.a}${esc(T('arr_suffix'))}</div>
      ${p.s ? '<div class="dot"></div><div class="mono" style="font-size:10.5px;color:var(--mute)">' + esc(p.s) + '</div>' : ''}
      ${p.b ? '<div class="dot"></div><div style="color:var(--mute)">' + esc(T('chain')) + '</div>' : ''}
    </div>
    ${aw.length ? `
      <div class="rule"></div>
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div class="lbl">${esc(T('best_at'))}</div>
        <div class="mono" style="font-size:9.5px;color:var(--mute)">${esc(T('wins', p.aw.length))}</div>
      </div>
      <div style="margin-top:8px">${aw.map(a => `
        <div class="aw">
          <div class="awy">${a.r === 1 ? '<svg width="18" height="18" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="' + C.crust + '"/><text x="10" y="13.4" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="9.5" fill="' + C.card + '">1</text></svg>' : String(a.y).slice(2)}</div>
          <div class="awn">${esc(compName(a.c))}
            ${a.r === 1 ? '<div class="mono" style="font-size:9px;color:var(--mute);margin-top:1px">' + a.y + '</div>' : ''}
          </div>
          <div class="${a.r === 1 ? 'first' : 'awr'}">${a.r === 1 ? esc(T('win_1st')) : esc(T('rank_n', a.r))}</div>
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

    <div class="acts">
      ${p.t ? `<a class="act" href="tel:${esc(p.t.replace(/\s/g, ''))}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.6" stroke-linecap="round"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.8a16 16 0 006 6l1.3-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.8 2.1z"/></svg>
        <span>${esc(T('call'))}</span></a>` : ''}
      <a class="act" href="${route}" target="_blank" rel="noopener">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-8-8 19-2-8z"/></svg>
        <span>${esc(T('route'))}</span></a>
      <a class="act" href="${gmaps}" target="_blank" rel="noopener">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${C.ink2}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/></svg>
        <span>${esc(T('gmaps'))}</span></a>
    </div>
    <div class="note">${esc(T('outside'))}</div>

    <div class="rule"></div>
    <div style="display:flex;align-items:center;gap:12px">
      <div style="flex:1 1 auto">
        <div class="lbl">${esc(T('mine'))}</div>
        <div style="font-size:12px;color:var(--mute);margin-top:5px">
          ${n ? esc(T('stamped_n', n)) + ' · ' + esc(T('visited_on', fmtDate(state.visits[p.id][n - 1]))) : esc(T('not_yet'))}
        </div>
      </div>
      <button class="cta" style="width:auto;padding:0 20px" id="doStamp">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${C.card}" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5"/><path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2"/></svg>
        <span>${esc(T('stamp'))}</span>
      </button>
    </div>
    <button class="cta ghost" style="margin-top:9px" id="doWish">${esc(state.wish[p.id] ? T('wish_remove') : T('wish_add'))}</button>
  `;
  $('#doStamp').onclick = () => stamp(p);
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
    <button class="cta" style="margin-top:18px" id="stampDone">${esc(T('done'))}</button>
  `;
  $('#stampDone').onclick = closeSheets;
  show('stampSheet');
  if (navigator.vibrate) try { navigator.vibrate(18); } catch (e) {}
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
    <div class="small">${esc(T('no_ads'))}</div>

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
  $('#doExport').onclick = exportRecords;
  $('#doImport').onclick = () => $('#fileIn').click();
  show('setSheet');
}

/* ----------------------------------------------------------- export/import */
async function exportRecords() {
  const payload = {
    app: 'miette', v: 1, exported: new Date().toISOString(),
    visits: state.visits, wish: state.wish
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

$('#fileIn').addEventListener('change', async e => {
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
function paintChips() {
  const F = [
    ['all', T('f_all')], ['0', T('f_bakery')], ['1', T('f_pastry')], ['2', T('f_choc')]
  ];
  $('#chips').innerHTML =
    F.map(([v, l]) => `<button class="chip ${state.filter === v ? 'on' : ''}" data-f="${v}">${esc(l)}</button>`).join('') +
    `<button class="chip ${state.onlyAward ? 'on' : ''}" data-t="onlyAward">${esc(T('f_award'))}</button>` +
    `<button class="chip ${state.onlyOpen ? 'on' : ''}" data-t="onlyOpen">${esc(T('f_open'))}</button>` +
    `<button class="chip ${state.onlyIndie ? 'on' : ''}" data-t="onlyIndie">${esc(T('f_indie'))}</button>`;
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.f !== undefined) state.filter = b.dataset.f;
  else state[b.dataset.t] = !state[b.dataset.t];
  paintChips(); render();
});

function paintStrip() {
  const v = stampedIds().length, a = arrDone().size;
  $('#strip').innerHTML =
    `<div>${esc(T('stat_visited'))} <b>${v}</b></div><div class="sep"></div>` +
    `<div>${esc(T('stat_arr'))} <b style="color:var(--crustDeep)">${a}</b></div><div class="sep"></div>` +
    `<div class="mono" style="font-size:10.5px">${state.places.length} ${esc(T('stat_of'))}</div>`;
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
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  const t = b.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
  if (t === 'map') closeSheets();
  else if (t === 'log') openLog();
  else if (t === 'trail') openTrail();
  else openRanking();
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
  $('#tagline').textContent = T('tagline');
  $('#bootMsg').textContent = T('loading');
  paintChips(); paintStrip(); paintTabs(); render();
}
$('#langbtn').onclick = openSettings;
$('#wordmark').onclick = openSettings;

$('#zoomAll').onclick = () => { fitAll(); render(); };
$('#legendBtn').onclick = openLegend;

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
      ${row(`<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="5" fill="${C.crust}" opacity=".5"/>
        <circle cx="13" cy="13" r="9" fill="none" stroke="${C.olive}" stroke-width="1.8"/></svg>`, T('legend_wish'))}
      ${row(`<svg width="30" height="26" viewBox="0 0 30 26">
        <circle cx="12" cy="13" r="6.4" fill="${C.crust}" opacity=".5"/>
        <circle cx="16" cy="13" r="6.4" fill="${C.crust}" opacity=".8"/>
        <circle cx="14" cy="13" r="9.6" fill="none" stroke="${C.crustDeep}" stroke-width="1" opacity=".5"/></svg>`, T('legend_stamp'))}
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
$('#locate').onclick = () => {
  state.follow = !state.follow;
  paintLocateBtn();
  if (state.follow) startWatch(true);
  render();
};


/* ------------------------------------------------------------- the log tab */
function openLog() {
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
        <svg width="18" height="18" viewBox="0 0 20 20" style="flex:0 0 auto">
          <circle cx="10" cy="10" r="7.4" fill="${C.crust}" opacity="${Math.min(1, .45 + r.n * .18)}"/>
          <circle cx="10" cy="10" r="9" fill="none" stroke="${C.crustDeep}" stroke-width=".9" opacity=".45"/></svg>
        <div class="awn" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;font-weight:600">${esc(r.p.n)}</div>
        <div class="mono" style="font-size:10px;color:var(--mute);flex:0 0 auto">${r.p.a}e</div>
        ${r.n > 1 ? '<div class="mono" style="font-size:10px;color:' + C.crustDeep + ';flex:0 0 auto">' + esc(T('nth', r.n)) + '</div>' : ''}
      </div>`;
    }).join('');
  }

  $('#setSheet').innerHTML = `
    <div class="grip"></div>
    <div style="display:flex;align-items:baseline;justify-content:space-between">
      <div class="ser" style="font-size:22px;font-weight:600;letter-spacing:1px">${esc(T('log_title'))}</div>
      <div class="mono" style="font-size:10.5px;color:var(--mute)">${esc(T('log_sum', shops, rows.length))}</div>
    </div>
    ${body}`;
  $('#setSheet').onclick = e => {
    const row = e.target.closest('[data-id]'); if (!row) return;
    const p = state.byId[row.dataset.id];
    if (p) { state.cx = p.WX; state.cy = p.WY; state.k = Math.max(state.k, .8); clampView(); backToMap(); openPlace(p); }
  };
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
function openWelcome() {
  const bullet = t => `<div style="display:flex;align-items:center;gap:9px;margin-top:8px">
    <svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="3.2" fill="${C.crust}"/></svg>
    <div style="font-size:12px;color:var(--ink2)">${esc(t)}</div></div>`;
  $('#stampSheet').innerHTML = `
    <div class="grip"></div>
    <div style="text-align:center;padding-top:6px">
      <svg width="54" height="20" viewBox="0 0 54 20">
        <g stroke="${C.crust}" stroke-width="3.4" stroke-linecap="round">
          <path d="M9 15L18 5"/><path d="M22.5 16.4L31.5 6.4"/><path d="M36 15L45 5"/></g></svg>
      <div class="ser" style="font-size:32px;font-weight:600;letter-spacing:9px;margin-top:14px">MIETTE</div>
      <div class="ser" style="font-style:italic;font-size:14px;color:var(--mute);margin-top:4px">${esc(T('tagline'))}</div>
    </div>
    <div class="rule" style="margin:20px 0 16px"></div>
    <div style="font-size:13.5px;line-height:1.65">${esc(T('welcome_hi'))}</div>
    <div style="font-size:13.5px;line-height:1.65;margin-top:6px;color:var(--ink2)">${esc(T('welcome_1'))}</div>
    <div class="ser" style="font-style:italic;font-size:14.5px;color:var(--ink2);white-space:pre-line;margin-top:16px;line-height:1.5">${esc(T('welcome_2'))}</div>
    <div style="margin-top:18px">${bullet(T('welcome_b1'))}${bullet(T('welcome_b2'))}${bullet(T('welcome_b3'))}</div>
    <button class="cta" style="margin-top:22px" id="welcomeGo">${esc(T('welcome_go'))}</button>
    <div class="ser" style="font-style:italic;font-size:12.5px;color:var(--mute);text-align:center;margin-top:20px;line-height:1.5">${esc(T('dedication'))}</div>`;
  $('#welcomeGo').onclick = () => { state.meta.seen = Date.now(); saveRecords(); closeSheets(); };
  show('stampSheet');
}

/* -------------------------------------------------------------------- boot */
async function boot() {
  try { state.lang = localStorage.getItem('miette.lang') || navLang(); } catch (e) { state.lang = navLang(); }
  document.documentElement.lang = state.lang;
  $('#bootMsg').textContent = T('loading');

  const [paris, places, comps, awards] = await Promise.all([
    fetch('data/paris.json').then(r => r.json()),
    fetch('data/places.json').then(r => r.json()),
    fetch('data/competitions.json').then(r => r.json()).catch(() => ({ competitions: [] })),
    fetch('data/awards.json').then(r => r.json()).catch(() => null)
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

  state.places = places.places;
  state.byId = {};
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of state.places) {
    p.WX = wx(p.x); p.WY = wy(p.y); state.byId[p.id] = p;
    x0 = Math.min(x0, p.WX); x1 = Math.max(x1, p.WX);
    y0 = Math.min(y0, p.WY); y1 = Math.max(y1, p.WY);
  }
  state.bounds = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
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
  $('#tagline').textContent = T('tagline');
  clampView(); render();
  $('#boot').classList.add('gone');
  if (!state.meta.seen) setTimeout(openWelcome, 380);

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
  $('#bootMsg').textContent = T('load_fail');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
