# -*- coding: utf-8 -*-
"""Launch images, so the tower is there before the page is.

Opened from the home screen, iOS paints its own splash before a single line of our
HTML runs — a flat background_color at best. apple-touch-startup-image replaces
that with a real picture, but only when the size matches the device exactly, so
one file per iPhone geometry.

The drawing is the same tower and river the boot screen draws, in the same ink.
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "icons", "splash")
os.makedirs(OUT, exist_ok=True)

PAPER = (247, 240, 223)
INK = (140, 82, 22)
CRUST = (196, 131, 46)
SEINE = (157, 174, 172)
MUTE = (111, 98, 80)

# logical size, scale — the iPhones this is likely to meet
DEVICES = [
    (440, 956, 3), (430, 932, 3), (402, 874, 3), (393, 852, 3),
    (428, 926, 3), (414, 896, 3), (414, 896, 2), (390, 844, 3),
    (375, 812, 3), (375, 667, 2),
]

FONTS = [r"C:\Windows\Fonts\georgia.ttf", r"C:\Windows\Fonts\times.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"]
ITALICS = [r"C:\Windows\Fonts\georgiai.ttf", r"C:\Windows\Fonts\timesi.ttf",
           "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"]


def font(paths, size):
    for f in paths:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    return ImageFont.load_default()


def tracked(d, cx, y, text, f, fill, track):
    """Draw letterspaced text centred on cx — PIL has no tracking of its own."""
    widths = [d.textlength(c, font=f) for c in text]
    total = sum(widths) + track * (len(text) - 1)
    x = cx - total / 2
    for c, w in zip(text, widths):
        d.text((x, y), c, font=f, fill=fill)
        x += w + track


def draw(W, H, scale):
    S = 4                                        # supersample for clean strokes
    w, h = W * scale, H * scale
    im = Image.new("RGB", (w * 1, h * 1), PAPER)
    big = Image.new("RGB", (w // 2 * 2, h), PAPER)
    im = Image.new("RGB", (w, h), PAPER)
    art = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(art)

    u = w / 220.0                                # the boot svg is 220 wide
    cx, cy = w / 2, h * 0.44
    ox, oy = cx - 110 * u, cy - 150 * u

    def P(x, y):
        return (ox + x * u, oy + y * u)

    lw = max(2, int(1.5 * u))
    # the tower
    for a, b in ((74, 118), (146, 118)):
        pass
    d.line([P(74, 118), P(84, 88), P(92, 70), P(99, 50)], fill=INK, width=lw, joint="curve")
    d.line([P(146, 118), P(136, 88), P(128, 70), P(121, 50)], fill=INK, width=lw, joint="curve")
    d.line([P(79, 96), P(110, 84), P(141, 96)], fill=INK, width=lw, joint="curve")
    d.line([P(84, 90), P(136, 90)], fill=INK, width=lw)
    d.line([P(95, 62), P(125, 62)], fill=INK, width=lw)
    d.line([P(99, 50), P(104, 24)], fill=INK, width=lw)
    d.line([P(121, 50), P(116, 24)], fill=INK, width=lw)
    d.line([P(103, 24), P(117, 24)], fill=INK, width=lw)
    d.line([P(104, 24), P(110, 8), P(116, 24)], fill=INK, width=lw, joint="curve")
    d.line([P(110, 8), P(110, 2)], fill=INK, width=lw)
    # the river
    d.line([P(6, 132), P(46, 124), P(76, 138), P(112, 134), P(150, 128), P(178, 142), P(214, 132)],
           fill=SEINE, width=max(3, int(4.5 * u)), joint="curve")
    d.line([P(8, 143), P(48, 135), P(78, 149), P(114, 145), P(152, 139), P(180, 153), P(216, 143)],
           fill=SEINE, width=max(1, int(1.2 * u)), joint="curve")
    # four shops along it
    for x, y in ((36, 120), (63, 127), (160, 130), (192, 123)):
        px, py = P(x, y)
        rr = 3 * u
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=CRUST)

    fw = font(FONTS, int(34 * scale))
    fi = font(ITALICS, int(16 * scale))
    tracked(d, cx, cy + 100 * u, "MIETTE", fw, (42, 33, 24), int(9 * scale))
    t = "in Paris"
    d.text((cx - d.textlength(t, font=fi) / 2, cy + 100 * u + 46 * scale), t, font=fi, fill=INK)
    return art


for W, H, sc in DEVICES:
    im = draw(W, H, sc)
    name = "splash-%dx%d@%dx.png" % (W, H, sc)
    im.convert("P", palette=Image.ADAPTIVE, colors=32).save(
        os.path.join(OUT, name), optimize=True)
    print("%-26s %4dx%-4d  %5.0f KB" % (name, W * sc, H * sc,
          os.path.getsize(os.path.join(OUT, name)) / 1024))

# the <link> tags to paste into the head
links = []
for W, H, sc in DEVICES:
    links.append(
        '<link rel="apple-touch-startup-image" href="icons/splash/splash-%dx%d@%dx.png" '
        'media="(device-width: %dpx) and (device-height: %dpx) and '
        '(-webkit-device-pixel-ratio: %d) and (orientation: portrait)">' % (W, H, sc, W, H, sc))
open(os.path.join(OUT, "_links.html"), "w", encoding="utf-8").write("\n".join(links))
print("\nlink tags written to icons/splash/_links.html")
