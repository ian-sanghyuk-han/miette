# -*- coding: utf-8 -*-
"""Turn data/paris.json + data/places.json into SVG fragments for the design canvas.

The mockups draw the real city, not a sketch of one: same arrondissement outlines,
same river, real bakeries at their real coordinates.

Two projections, because Paris is 18 km wide and 9.7 km tall — the whole city on a
phone is a flat band, so the map screen zooms to a walkable district and keeps the
whole city as a small inset.

  city  — all 20 arrondissements, fit to width (inset, and the completion board)
  zoom  — a ~2.5 km window around the walk, full-bleed on a 390-wide screen
"""
import json, math, os, random

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "design")
os.makedirs(OUT, exist_ok=True)

paris = json.load(open(os.path.join(D, "paris.json"), encoding="utf-8"))
places = json.load(open(os.path.join(D, "places.json"), encoding="utf-8"))
KX = math.cos(math.radians(48.858))              # east-west squeeze at Paris' latitude


class View:
    """A window on the city: geographic centre + scale + pixel size."""

    def __init__(self, w, h, lon_c, lat_c, sc):
        self.w, self.h, self.sc = w, h, sc
        self.lon_c, self.lat_c = lon_c, lat_c

    def __call__(self, lon, lat):
        return (self.w / 2 + (lon - self.lon_c) * KX * self.sc,
                self.h / 2 - (lat - self.lat_c) * self.sc)

    def inside(self, lon, lat, m=8):
        x, y = self(lon, lat)
        return -m < x < self.w + m and -m < y < self.h + m


def path(view, flat, close=True):
    pts = [view(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
    return "M" + " L".join("%.1f %.1f" % p for p in pts) + ("Z" if close else "")


def bounds():
    xs, ys = [], []
    for a in paris["arr"]:
        xs += a["r"][0::2]
        ys += a["r"][1::2]
    return min(xs), max(xs), min(ys), max(ys)


lon0, lon1, lat0, lat1 = bounds()

# a plausible morning on the left bank, walked in order
TRAIL = ["Bergeron", "Borissou", "Le Moulin de la Croix Nivert",
         "L'Artisan des gourmands"]
by_name = {}
for p in places["places"]:
    by_name.setdefault(p["n"], p)
trail = [by_name[n] for n in TRAIL if n in by_name]


def fragment(view, dot_r, star_r, sample_n, seed=7):
    arr, labels, water, dots, stars = [], [], [], [], []
    for a in paris["arr"]:
        arr.append('<path id="a%d" d="%s"/>' % (a["n"], path(view, a["r"])))
        if view.inside(a["c"][0], a["c"][1], -20):
            cx, cy = view(a["c"][0], a["c"][1])
            labels.append('<text x="%.1f" y="%.1f">%d</text>' % (cx, cy, a["n"]))
    for w in paris["water"]:
        if len(w) >= 12:
            water.append('<path d="%s"/>' % path(view, w))

    random.seed(seed)
    pts = [p for p in places["places"] if view.inside(p["x"], p["y"])]
    aw = [p for p in pts if p.get("aw")]
    rest = [p for p in pts if not p.get("aw")]
    for p in aw:
        x, y = view(p["x"], p["y"])
        stars.append('<circle cx="%.1f" cy="%.1f" r="%s"/>' % (x, y, star_r))
    for p in random.sample(rest, min(sample_n, len(rest))):
        x, y = view(p["x"], p["y"])
        dots.append('<circle cx="%.1f" cy="%.1f" r="%s"/>' % (x, y, dot_r))

    return {
        "w": view.w, "h": view.h,
        "arr": "\n".join(arr), "labels": "\n".join(labels), "water": "\n".join(water),
        "dots": "\n".join(dots), "stars": "\n".join(stars),
        "n_dots": len(dots), "n_stars": len(stars),
    }


# ------------------------------------------------------------------ city view
CW, CH = 352, 200
csc = (CW - 10) / ((lon1 - lon0) * KX)
city_view = View(CW, CH, (lon0 + lon1) / 2, (lat0 + lat1) / 2, csc)
city = fragment(city_view, 0.9, 1.5, 260)
city["trail"] = [{"n": t["n"], "x": round(city_view(t["x"], t["y"])[0], 1),
                  "y": round(city_view(t["x"], t["y"])[1], 1)} for t in trail]

# ------------------------------------------------------------------ zoom view
ZW, ZH = 390, 700
lon_c = sum(t["x"] for t in trail) / len(trail)
lat_c = sum(t["y"] for t in trail) / len(trail)
zsc = ZW / (0.042 * KX)                          # ~3.1 km across the short side
zoom_view = View(ZW, ZH, lon_c, lat_c, zsc)
zoom = fragment(zoom_view, 2.6, 4.0, 260, seed=11)
zoom["trail_d"] = "M" + " L".join(
    "%.1f %.1f" % zoom_view(t["x"], t["y"]) for t in trail)
zoom["trail"] = [{"n": t["n"], "a": t["a"], "s": t["s"],
                  "x": round(zoom_view(t["x"], t["y"])[0], 1),
                  "y": round(zoom_view(t["x"], t["y"])[1], 1)} for t in trail]

json.dump({"city": city, "zoom": zoom},
          open(os.path.join(OUT, "_mapfrag.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

print("city %dx%d  dots %d  awarded %d" % (CW, CH, city["n_dots"], city["n_stars"]))
print("zoom %dx%d  dots %d  awarded %d   (%.1f km across)"
      % (ZW, ZH, zoom["n_dots"], zoom["n_stars"], 0.042 * KX * 111.32))
for t in zoom["trail"]:
    print("   %-22s %2d구  %-30s  (%.0f, %.0f)" % (t["n"], t["a"], t["s"], t["x"], t["y"]))
print("bytes:", os.path.getsize(os.path.join(OUT, "_mapfrag.json")))
