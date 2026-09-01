# -*- coding: utf-8 -*-
"""The stamp diary: what she has been to, which ones were good, and her own ranking.

Three views behind the Log tab.

  여정    every stamp in order, the way it happened
  좋았던 곳  the ones she said she would go back to
  순위    her ranking, built from duels rather than stars

Ranking uses Bradley-Terry solved by MM iteration, not Elo: Elo depends on the
order the duels arrived, so the same set of answers gives different rankings
depending on when each was given. Bradley-Terry takes the whole record at once,
which is what you want when there are only a dozen comparisons. Everyone gets one
phantom win and one phantom loss so a shop that has only ever lost still has a
finite place, and transitivity comes free — beat A, A beat B, and B sinks without
her ever comparing the two.
"""
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, 'app.js')
s = open(p, encoding='utf-8').read()


def sub(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


sub("  visits: {}, wish: {}, meta: {},",
    "  visits: {}, wish: {}, meta: {}, verdict: {}, duels: [],\n"
    "  diaryView: 'time', rankKind: 'all',")

sub("""    state.visits = (await DB.get('visits')) || {};
    state.wish = (await DB.get('wish')) || {};
    state.meta = (await DB.get('meta')) || {};""",
    """    state.visits = (await DB.get('visits')) || {};
    state.wish = (await DB.get('wish')) || {};
    state.meta = (await DB.get('meta')) || {};
    state.verdict = (await DB.get('verdict')) || {};
    state.duels = (await DB.get('duels')) || [];""")

sub("""const saveRecords = () => Promise.all([
  DB.set('visits', state.visits), DB.set('wish', state.wish), DB.set('meta', state.meta)
]).catch(() => {});""",
    """const saveRecords = () => Promise.all([
  DB.set('visits', state.visits), DB.set('wish', state.wish), DB.set('meta', state.meta),
  DB.set('verdict', state.verdict), DB.set('duels', state.duels)
]).catch(() => {});""")

# carry the verdict and the duels through export/import
sub("""    visits: state.visits, wish: state.wish
  };""",
    """    visits: state.visits, wish: state.wish,
    verdict: state.verdict, duels: state.duels
  };""")
sub("""    Object.assign(state.wish, d.wish || {});""",
    """    Object.assign(state.wish, d.wish || {});
    Object.assign(state.verdict, d.verdict || {});
    (d.duels || []).forEach(x => {
      if (Array.isArray(x) && x.length === 2 &&
          !state.duels.some(y => y[0] === x[0] && y[1] === x[1])) state.duels.push(x);
    });""")

# ------------------------------------------------------- verdict, after a stamp
sub("""    <button class="cta" style="margin-top:18px" id="stampDone">${esc(T('done'))}</button>
  `;
  $('#stampDone').onclick = closeSheets;""",
    """    <div class="rule"></div>
    <div class="lbl">${esc(T('v_ask'))}</div>
    <div style="display:flex;gap:7px;margin-top:9px">
      ${[[2, T('v_again')], [1, T('v_ok')], [0, T('v_once')]].map(([v, l]) => `
        <button class="cta ${state.verdict[p.id] === v ? '' : 'ghost'}" data-v="${v}"
          style="flex:1 1 0;height:48px;font-size:12.5px">${esc(l)}</button>`).join('')}
    </div>
    <button class="cta" style="margin-top:14px" id="stampDone">${esc(T('done'))}</button>
  `;
  $('#stampSheet').querySelectorAll('[data-v]').forEach(b => {
    b.onclick = () => { state.verdict[p.id] = +b.dataset.v; saveRecords(); stampRefresh(p); };
  });
  $('#stampDone').onclick = closeSheets;""")

sub("""function stampSVG(p, n) {""",
    """// re-paint the sheet in place, without adding another stamp
function stampRefresh(p) {
  const n = (state.visits[p.id] || []).length;
  state.visits[p.id].pop();
  stamp(p);
}

function stampSVG(p, n) {""")

# ------------------------------------------------------------- the ranking maths
sub("""/* ------------------------------------------------------------- the log tab */""",
    """/* --------------------------------------------------------------- her ranking */
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

function rankable(kind) {
  return stampedIds().filter(id => {
    const q = state.byId[id];
    return q && (kind === 'all' || q.k === +kind);
  });
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
      return [state.byId[a], state.byId[b]];
    }
  }
  return null;                                   // everyone has met everyone
}

/* ------------------------------------------------------------- the log tab */""")

open(p, 'w', encoding='utf-8').write(s)
print('app.js: verdict stored, Bradley-Terry added')
