# -*- coding: utf-8 -*-
"""Draw the app icons — the grigne, the three cuts a baker scores into the dough.

iOS wants a real PNG for apple-touch-icon; the manifest wants 192 and 512.
"""
import math, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "icons")
os.makedirs(OUT, exist_ok=True)

PAPER = (247, 240, 223)
CRUST = (196, 131, 46)


def draw(size, bg=PAPER, fg=CRUST, radius_frac=0.0):
    S = 8                                    # supersample, then downscale
    n = size * S
    im = Image.new("RGB", (n, n), bg)
    d = ImageDraw.Draw(im)
    w = int(n * 0.094)                       # stroke width
    # three cuts, lower-left to upper-right, the middle one dropped a little
    cuts = [(0.244, 0.644, 0.411, 0.344),
            (0.417, 0.689, 0.583, 0.389),
            (0.589, 0.644, 0.756, 0.344)]
    for x1, y1, x2, y2 in cuts:
        d.line([(x1 * n, y1 * n), (x2 * n, y2 * n)], fill=fg, width=w)
        for (px, py) in ((x1, y1), (x2, y2)):
            r = w / 2
            d.ellipse([px * n - r, py * n - r, px * n + r, py * n + r], fill=fg)
    return im.resize((size, size), Image.LANCZOS)


for size, name in ((180, "apple-touch-icon.png"), (192, "icon-192.png"),
                   (512, "icon-512.png"), (32, "favicon-32.png")):
    draw(size).save(os.path.join(OUT, name))
    print("icons/%s  %dx%d" % (name, size, size))

# maskable: the safe zone is the middle 80%, so the mark shrinks inside a full bleed
m = Image.new("RGB", (512, 512), PAPER)
inner = draw(410)
m.paste(inner, (51, 51))
m.save(os.path.join(OUT, "icon-512-maskable.png"))
print("icons/icon-512-maskable.png  512x512")
