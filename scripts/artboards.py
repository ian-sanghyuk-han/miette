# -*- coding: utf-8 -*-
"""Emit the two map-bearing artboards (Main, Trail) with the real city inlined.

The other artboards are hand-authored; these two are generated because their
geometry comes from data and must stay true to it.
"""
import json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DES = os.path.join(HERE, "design")
frag = json.load(open(os.path.join(DES, "_mapfrag.json"), encoding="utf-8"))
Z, C = frag["zoom"], frag["city"]

PAPER, DEEP, CARD = "#F7F0DF", "#EFE4C9", "#FCF8EE"
INK, INK2, MUTE, LINE = "#2A2118", "#544737", "#6F6250", "#E2D6B9"
CRUST, CRUSTD, OLIVE, SEINE = "#C4832E", "#8C5216", "#77794F", "#9DAEAC"

HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=IBM+Plex+Sans+KR:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
  <style>
    body { margin: 0; }
    a { color: %s; text-decoration: none; } a:hover { color: %s; }
    .ser { font-family: 'Cormorant Garamond', Georgia, serif; }
    .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
  </style>
</helmet>
""" % (CRUSTD, CRUST)

FOOT = """</x-dc>
</body>
</html>
"""

BODY = ("font-family: 'IBM Plex Sans KR', system-ui, sans-serif; "
        "width: 390px; height: 844px; box-sizing: border-box; position: relative; "
        "overflow: hidden; background: %s; color: %s;" % (PAPER, INK))


def tabbar(active):
    """The four tabs. 76px tall, every target well over 44px."""
    tabs = [
        ("지도", "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14"),
        ("기록", "M5 3h11l3 3v15H5z M16 3v4h3 M8 11h8 M8 15h6"),
        ("순위", "M4 20V9 M10 20V4 M16 20V13 M2 20h20"),
        ("여정", "M5 19c4 0 3-6 7-6s3-6 7-6 M5 19h.01 M19 7h.01"),
    ]
    out = []
    for name, d in tabs:
        on = name == active
        col = CRUSTD if on else MUTE
        out.append(
            '<div style="flex: 1 1 0; display: flex; flex-direction: column; '
            'align-items: center; justify-content: center; gap: 5px; height: 100%%; '
            'min-height: 48px;">'
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="%s" '
            'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="%s"/></svg>'
            '<div style="font-size: 10px; letter-spacing: 0.6px; color: %s; '
            'font-weight: %d;">%s</div></div>' % (col, d, col, 600 if on else 400, name))
    return ('<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 76px; '
            'display: flex; align-items: stretch; background: %s; '
            'border-top: 1px solid %s; padding-bottom: 8px;">%s</div>'
            % (CARD, LINE, "".join(out)))


def chip(text, on=False):
    if on:
        return ('<div style="padding: 6px 12px; border-radius: 14px; background: %s; '
                'color: %s; font-size: 11.5px; font-weight: 500; white-space: nowrap;">'
                '%s</div>' % (CRUSTD, "#FCF8EE", text))
    return ('<div style="padding: 6px 12px; border-radius: 14px; '
            'border: 1px solid %s; background: rgba(252,248,238,0.82); color: %s; '
            'font-size: 11.5px; white-space: nowrap;">%s</div>' % (LINE, INK2, text))


# ============================================================== Main — the map
stamps = []
for i, t in enumerate(Z["trail"]):
    stamps.append(
        '<circle cx="%.1f" cy="%.1f" r="8.5" fill="none" stroke="%s" stroke-width="1" '
        'opacity="0.5"/>'
        '<circle cx="%.1f" cy="%.1f" r="5" fill="%s"/>'
        % (t["x"], t["y"], CRUSTD, t["x"], t["y"], CRUST))

wish = [(96, 250), (300, 512), (215, 560), (58, 330)]
wishes = "".join(
    '<circle cx="%d" cy="%d" r="5.5" fill="none" stroke="%s" stroke-width="1.6"/>' % (x, y, OLIVE)
    for x, y in wish)


def callout(t, dx, dy, badge, anchor="left"):
    x = min(max(t["x"] + dx, 12), 390 - 12 - 158)      # never past either edge
    y = t["y"] + dy
    align = "flex-start" if anchor == "left" else "flex-end"
    return (
        '<div style="position: absolute; left: %.0fpx; top: %.0fpx; width: 158px; '
        'display: flex; flex-direction: column; align-items: %s; gap: 3px;">'
        '<div style="background: %s; border: 1px solid %s; border-left: 3px solid %s; '
        'padding: 6px 9px 7px; box-shadow: 0 2px 8px rgba(42,33,24,0.10);">'
        '<div style="font-size: 12.5px; font-weight: 600; letter-spacing: -0.1px;">%s</div>'
        '<div class="mono" style="font-size: 9.5px; color: %s; margin-top: 2px;">%s</div>'
        '</div></div>' % (x, y, align, CARD, LINE, CRUST, t["n"], CRUSTD, badge))


MAIN = HEAD + """<div style="%s">

  <svg width="390" height="700" viewBox="0 0 390 700" style="position: absolute; top: 0; left: 0;">
    <rect width="390" height="700" fill="%s"/>
    <g fill="%s" opacity="0.55">%s</g>
    <g fill="none" stroke="%s" stroke-width="0.7" opacity="0.45">%s</g>
    <g fill="%s" opacity="0.30">%s</g>
    <g fill="none" stroke="%s" stroke-width="4.5" stroke-linecap="round"
       stroke-linejoin="round" stroke-dasharray="1 9" opacity="0.55">
      <path d="%s"/>
    </g>
    <g fill="none" stroke="%s" stroke-width="1.2" opacity="0.85">%s</g>
    <g fill="%s" opacity="0.55">%s</g>
    %s
  </svg>

  <div style="position: absolute; top: 0; left: 0; right: 0; height: 200px;
       background: linear-gradient(180deg, %s 0%%, rgba(247,240,223,0.94) 46%%, rgba(247,240,223,0) 100%%);
       pointer-events: none;"></div>

  <div style="position: absolute; top: 22px; left: 20px; right: 20px;">
    <div style="display: flex; align-items: baseline; justify-content: space-between;">
      <div class="ser" style="font-size: 25px; font-weight: 600; letter-spacing: 7px;">MIETTE</div>
      <div class="mono" style="font-size: 10px; letter-spacing: 1.4px; color: %s;
           border: 1px solid %s; padding: 3px 8px;">KO</div>
    </div>
    <div class="ser" style="font-style: italic; font-size: 14px; color: %s; margin-top: 1px;">
      빵자취를 따라서</div>
    <div style="display: flex; gap: 6px; margin-top: 14px; overflow: hidden;">
      %s%s%s%s%s
    </div>
  </div>

  %s
  %s

  <div style="position: absolute; left: 0; right: 0; bottom: 76px; height: 40px;
       display: flex; align-items: center; gap: 14px; padding: 0 20px;
       background: %s; border-top: 1px solid %s;">
    <div style="font-size: 11.5px;"><span style="color: %s;">다녀온 곳</span>
      <span class="mono" style="font-weight: 500; margin-left: 3px;">14</span></div>
    <div style="width: 1px; height: 12px; background: %s;"></div>
    <div style="font-size: 11.5px;"><span style="color: %s;">20구 중</span>
      <span class="mono" style="font-weight: 500; margin-left: 3px; color: %s;">6</span></div>
    <div style="width: 1px; height: 12px; background: %s;"></div>
    <div style="font-size: 11.5px; color: %s;">오늘 아침
      <span class="mono" style="color: %s;">2.2km</span></div>
  </div>

  %s
</div>
""" % (BODY,
       PAPER,
       DEEP, Z["arr"],
       LINE, Z["arr"],
       SEINE, Z["water"],
       CRUSTD, Z["trail_d"],
       INK, Z["stars"],
       INK, Z["dots"],
       "".join(stamps) + wishes,
       PAPER,
       CRUSTD, LINE,
       MUTE,
       chip("전체", True), chip("빵집"), chip("파티스리"), chip("수상점"), chip("지금 열림"),
       callout(Z["trail"][0], -166, -34, "플랑 6위 · 파티스리 5위"),
       callout(Z["trail"][2], 18, 14, "크루아상 3위 · 플랑 3위"),
       CARD, LINE,
       MUTE, LINE, MUTE, CRUSTD, LINE, MUTE, INK2,
       tabbar("지도")) + FOOT

open(os.path.join(DES, "Main.dc.html"), "w", encoding="utf-8").write(MAIN)

# ======================================================== Trail — the three boards
DONE = [1, 5, 6, 7, 13, 15]      # arrondissements with at least one stamp

# the done arrondissements are the same paths, painted over the top
city_paths = C["arr"].split("\n")
done_paths = [p for p in city_paths
              if any(p.startswith('<path id="a%d"' % n) for n in DONE)]

BREADS = [
    ("baguette", "바게트", True), ("croissant", "크루아상", True),
    ("pain au chocolat", "뺑오쇼콜라", True), ("flan", "플랑", True),
    ("chausson aux pommes", "쇼송오폼", False), ("éclair", "에클레르", True),
    ("galette des rois", "갈레트", False), ("kouign-amann", "쿠이냐망", False),
    ("pain de campagne", "캉파뉴", True), ("tarte au citron", "레몬 타르트", False),
    ("pain aux raisins", "팽오레쟁", False), ("sandwich", "샌드위치", True),
]

cells = []
for fr, ko, done in BREADS:
    cells.append(
        '<div style="border: 1px solid %s; background: %s; padding: 9px 8px 10px; '
        'display: flex; flex-direction: column; gap: 2px; min-height: 52px;">'
        '<div class="ser" style="font-size: 13px; font-weight: 600; color: %s; '
        'line-height: 1.15;">%s</div>'
        '<div style="font-size: 9.5px; color: %s;">%s</div></div>'
        % (CRUST if done else LINE,
           "rgba(196,131,46,0.10)" if done else CARD,
           CRUSTD if done else MUTE, fr, MUTE if not done else CRUSTD, ko))

GRANDS = [("2026", "Fournil Didot", 14, True), ("2025", "La Parisienne", 10, True),
          ("2024", "Utopie", 11, False), ("2023", "Au Levain des Pyrénées", 20, False),
          ("2022", "Frédéric Comyn", 15, False)]
rows = []
for y, n, a, done in GRANDS:
    rows.append(
        '<div style="display: flex; align-items: center; gap: 10px; padding: 7px 0; '
        'border-bottom: 1px solid %s;">'
        '<div class="mono" style="font-size: 11px; color: %s; width: 32px;">%s</div>'
        '<div style="flex: 1 1 auto; font-size: 12.5px; color: %s; font-weight: %d;">%s</div>'
        '<div class="mono" style="font-size: 10px; color: %s;">%d구</div>'
        '<svg width="14" height="14" viewBox="0 0 14 14">%s</svg></div>'
        % (LINE, MUTE, y, INK if done else INK2, 600 if done else 400, n, MUTE, a,
           ('<circle cx="7" cy="7" r="5" fill="%s"/>' % CRUST) if done else
           ('<circle cx="7" cy="7" r="4.6" fill="none" stroke="%s" stroke-width="1.2" '
            'opacity="0.55"/>' % LINE)))

TRAIL = HEAD + """<div style="%s">
  <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 76px; overflow: hidden;
       padding: 22px 20px 0;">

    <div class="ser" style="font-size: 22px; font-weight: 600; letter-spacing: 1px;">여정</div>
    <div style="font-size: 11.5px; color: %s; margin-top: 2px;">
      세 가지를 채운다 — 지리 · 권위 · 종류</div>

    <div style="margin-top: 18px; border: 1px solid %s; background: %s; padding: 12px 12px 8px;">
      <div style="display: flex; align-items: baseline; justify-content: space-between;">
        <div style="font-size: 12.5px; font-weight: 600;">파리 20구</div>
        <div class="mono" style="font-size: 11px; color: %s;">6 / 20</div>
      </div>
      <svg width="330" height="188" viewBox="0 0 352 200" style="margin-top: 4px;">
        <g fill="%s" opacity="0.5">%s</g>
        <g fill="%s" opacity="0.30">%s</g>
        <g fill="none" stroke="%s" stroke-width="0.6" opacity="0.5">%s</g>
        <g fill="%s" opacity="0.22">%s</g>
        <g fill="%s" opacity="0.55">%s</g>
        <g class="mono" fill="%s" font-size="6.5" text-anchor="middle" opacity="0.65">%s</g>
      </svg>
    </div>

    <div style="margin-top: 16px; display: flex; align-items: baseline; justify-content: space-between;">
      <div style="font-size: 12.5px; font-weight: 600;">빵 도감</div>
      <div class="mono" style="font-size: 11px; color: %s;">7 / 12</div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;
         margin-top: 8px;">%s</div>

    <div style="margin-top: 16px; display: flex; align-items: baseline; justify-content: space-between;">
      <div style="font-size: 12.5px; font-weight: 600;">바게트 그랑프리 역대 수상점</div>
      <div class="mono" style="font-size: 11px; color: %s;">2 / 33</div>
    </div>
    <div style="margin-top: 4px;">%s</div>
  </div>
  %s
</div>
""" % (BODY,
       MUTE,
       LINE, CARD,
       CRUSTD,
       DEEP, C["arr"],
       SEINE, C["water"],
       LINE, C["arr"],
       CRUST, "\n".join(done_paths),
       INK, C["dots"],
       INK, C["labels"],
       CRUSTD, "".join(cells),
       CRUSTD, "".join(rows),
       tabbar("여정")) + FOOT

open(os.path.join(DES, "Trail.dc.html"), "w", encoding="utf-8").write(TRAIL)

for f in ("Main.dc.html", "Trail.dc.html"):
    print("%-16s %6.1f KB" % (f, os.path.getsize(os.path.join(DES, f)) / 1024))
