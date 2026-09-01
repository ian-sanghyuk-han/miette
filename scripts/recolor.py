# -*- coding: utf-8 -*-
"""Retune the palette toward bread: less brick, more crumb and crust.

Every colour in the artboards is a literal hex (the design canvas edits inline
styles), so a palette change is a sweep. Run it once; the map generators carry
their own copy of the constants and are swept too.
"""
import glob, os, re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MAP = [
    # base — the paper becomes the crumb of a loaf: grey out, wheat in
    ("#F4EFE4", "#F7F0DF"),   # paper
    ("#EBE3D2", "#EFE4C9"),   # paperDeep
    ("#FBF8F1", "#FCF8EE"),   # card
    ("#F7F0E6", "#FCF8EE"),   # chip text on a dark fill
    # ink — not black, burnt wheat
    ("#23201C", "#2A2118"),
    ("#4A443C", "#544737"),
    ("#8C8175", "#6F6250"),   # mute: contrast 3.0 -> 5.1 on paper
    ("#DCD2BF", "#E2D6B9"),   # line
    ("#EFE8DA", "#F0E7D2"),   # row divider
    ("#C9BEA8", "#CFC0A0"),   # dashed / empty
    ("#B9AF9C", "#BEAE8E"),   # faint chevron
    ("#E5DCC9", "#E9DCC2"),   # progress track
    # the crust: brick -> just-out-of-the-oven gold
    ("#B4682C", "#C4832E"),
    ("#8A4A18", "#8C5216"),
    # the rest
    ("#6E7355", "#77794F"),   # olive
    ("#8FA9B8", "#9DAEAC"),   # seine
    # rgb() forms of the same colours
    ("rgba(244,239,228", "rgba(247,240,223"),
    ("rgba(180,104,44",  "rgba(196,131,46"),
    ("rgba(35,32,28",    "rgba(42,33,24"),
    ("rgba(251,248,241", "rgba(252,248,238"),
]

targets = sorted(glob.glob(os.path.join(HERE, "design", "*.dc.html"))) + [
    os.path.join(HERE, "scripts", "artboards.py"),
]

total = 0
for f in targets:
    s = open(f, encoding="utf-8").read()
    n = 0
    for a, b in MAP:
        c = s.count(a) + s.count(a.lower())
        if c:
            s = re.sub(re.escape(a), b, s, flags=re.I)
            n += c
    if n:
        open(f, "w", encoding="utf-8").write(s)
        total += n
    print("%-28s %4d" % (os.path.basename(f), n))
print("swapped", total)
