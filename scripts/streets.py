# -*- coding: utf-8 -*-
"""Put the streets on the map.

Arrondissement outlines and the Seine are enough to recognise Paris from above,
and nothing at all once you zoom into a district. So: the boulevard structure in
four tiers, and the parks big enough to walk in.

Stored as integers in units of 1e-5 degrees, delta-encoded along each way. That
is roughly a metre of precision — finer than anyone can tap — and it is what
keeps the file small enough to live in a phone's cache.
"""
import json, math, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HERE, "data")
Q = 100000.0                                   # 1e-5 degrees per unit
KX = math.cos(math.radians(48.858))


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = (bx - ax) * KX, by - ay
        n2 = dx * dx + dy * dy
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            ex, ey = (px - ax) * KX, py - ay
            if n2 == 0:
                d = math.hypot(ex, ey)
            else:
                t = max(0.0, min(1.0, (ex * dx + ey * dy) / n2))
                d = math.hypot(ex - t * dx, ey - t * dy)
            if d > worst:
                worst, wi = d, i
        if worst > eps:
            keep[wi] = True
            stack.append((a, wi))
            stack.append((wi, b))
    return [p for p, k in zip(pts, keep) if k]


def span_m(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return math.hypot((max(xs) - min(xs)) * KX, max(ys) - min(ys)) * 111320


TIER = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3}
EPS = {0: 0.00010, 1: 0.00010, 2: 0.00012, 3: 0.00016}
MINLEN = {0: 0, 1: 0, 2: 30, 3: 55}            # metres — drop the stubs

raw = json.load(open(os.path.join(D, "_streets.json"), encoding="utf-8"))
lines = {0: [], 1: [], 2: [], 3: []}
green = []
kept_pts = 0

for e in raw["elements"]:
    g = e.get("geometry")
    if not g or len(g) < 2:
        continue
    pts = [(p["lon"], p["lat"]) for p in g]
    t = e.get("tags", {})
    hw = t.get("highway")
    if hw in TIER:
        tier = TIER[hw]
        if span_m(pts) < MINLEN[tier]:
            continue
        s = rdp(pts, EPS[tier])
        if len(s) < 2:
            continue
        lines[tier].append(s)
        kept_pts += len(s)
    elif t.get("leisure") in ("park", "garden") or t.get("landuse") in ("forest", "cemetery"):
        if span_m(pts) < 90:                   # a pocket garden is noise at this scale
            continue
        s = rdp(pts, 0.00016)
        if len(s) < 4:
            continue
        green.append(s)
        kept_pts += len(s)


def pack(way):
    """[x0,y0, dx,dy, ...] in 1e-5 degree units."""
    out = []
    px = py = 0
    for i, (lon, lat) in enumerate(way):
        x = int(round(lon * Q))
        y = int(round(lat * Q))
        if i == 0:
            out += [x, y]
        else:
            out += [x - px, y - py]
        px, py = x, y
    return out


doc = {
    "v": 1,
    "q": 100000,
    "attribution": "© OpenStreetMap contributors — ODbL",
    "tiers": [[pack(w) for w in lines[t]] for t in (0, 1, 2, 3)],
    "green": [pack(w) for w in green],
}
path = os.path.join(D, "streets.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(doc, f, separators=(",", ":"))

kb = os.path.getsize(path) / 1024
print("tiers  %d / %d / %d / %d ways" % tuple(len(lines[t]) for t in (0, 1, 2, 3)))
print("green  %d shapes" % len(green))
print("points %d   file %.0f KB" % (kept_pts, kb))
