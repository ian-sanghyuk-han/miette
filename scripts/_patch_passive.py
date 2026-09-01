# -*- coding: utf-8 -*-
"""Drop the 전체 button, float open-now under the map.

"Everything" is not a choice you make, it is where you start — so it does not
need a button, and the whole first row goes with it. Coming back is a gesture
instead: untick the last trade still on and they all come back, which is what
"none selected" ought to mean anyway.

Open-now is about the world rather than about the map's contents, so it stops
competing with the category chips and floats at the foot of the map, over the
city it describes.

That leaves two rows where there were three, and the trade row finally has slack:
it was fitting in exactly 347 of 347 px, which is not fitting, it is touching.
"""
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------- index.html
h = os.path.join(HERE, 'index.html')
t = open(h, encoding='utf-8').read()


def rep(old, new):
    global t
    assert old in t, old[:70]
    t = t.replace(old, new, 1)


rep(""".trade{height:27px;padding:0 11px;""", """.trade{height:27px;padding:0 9px;""")
rep(""".tgroup{display:flex;align-items:center;gap:5px;flex:0 0 auto;padding:3px;""",
    """.tgroup{display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:3px;""")

# the lamp leaves the header and floats over the city it describes
rep("""#tools{position:absolute;right:16px;bottom:14px;""",
    """#lamp{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:2;
  display:flex;align-items:center;gap:6px;height:34px;padding:0 15px;
  border:1.5px solid #E0B26A;border-radius:17px;background:rgba(252,248,238,.94);
  color:#8C5216;font-size:12px;white-space:nowrap;
  box-shadow:0 2px 10px rgba(42,33,24,.12)}
#lamp.on{border-color:#D9962F;background:#E8A33A;color:#FCF8EE;font-weight:600;
  box-shadow:0 2px 14px rgba(217,150,47,.42)}
#tools{position:absolute;right:16px;bottom:14px;""")

rep("""      <div id="bar">
        <div id="chips"></div>
      </div>
""", "")
rep("""    <div id="tools">""",
    """    <button id="lamp"></button>
    <div id="tools">""")
open(h, 'w', encoding='utf-8').write(t)
print('index.html: first row gone, lamp floats at the foot of the map')

# -------------------------------------------------------------------- app.js
p = os.path.join(HERE, 'app.js')
s = open(p, encoding='utf-8').read()


def sub(old, new):
    global s
    assert old in s, old[:80]
    s = s.replace(old, new, 1)


sub("""function paintChips() {
  const all = state.kinds.every(Boolean);
  // "everything" needs no icon — there is nothing to tell apart
  $('#chips').innerHTML =
    `<button class="chip ${all ? 'on' : ''}" data-f="all">${esc(T('g_all'))}</button>` +
    `<div class="spacer"></div>` +
    `<button class="tog lamp ${state.onlyOpen ? 'on' : ''}" data-t="onlyOpen">${MARK.glow}${esc(T('f_open'))}</button>`;""",
    """function paintChips() {
  // "everything" is where you start, not a button you press
  $('#lamp').className = state.onlyOpen ? 'on' : '';
  $('#lamp').innerHTML = MARK.glow + esc(T('f_open'));""")

sub("""$('#chips').addEventListener('click', onChipRow);
$('#chips3').addEventListener('click', onChipRow);""",
    """$('#chips3').addEventListener('click', onChipRow);
$('#lamp').onclick = () => {
  state.onlyOpen = !state.onlyOpen;
  paintChips(); paintStrip(); render();
  if (state.onlyOpen) openNearby(); else closeSheets();
};""")

# untick the last one and they all come back — which is what "none" should mean
sub("""  else if (b.dataset.k !== undefined) {
    const i = +b.dataset.k;
    const next = state.kinds.slice();
    next[i] = !next[i];
    if (next.some(Boolean)) state.kinds = next;   // never leave an empty map
  }""",
    """  else if (b.dataset.k !== undefined) {
    const i = +b.dataset.k;
    if (state.kinds.every(Boolean)) {
      state.kinds = [0, 1, 2, 3].map(k => k === i);   // out of "everything": just this
    } else {
      const next = state.kinds.slice();
      next[i] = !next[i];
      state.kinds = next.some(Boolean) ? next : [true, true, true, true];
    }
  }""")

sub("const BUILD = 'v29';", "const BUILD = 'v30';")
open(p, 'w', encoding='utf-8').write(s)
print('app.js: passive everything, floating lamp')
