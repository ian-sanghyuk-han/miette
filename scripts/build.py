# -*- coding: utf-8 -*-
"""Build Miette's static data from raw open-data snapshots.

Sources (all licence-clean, see docs/SOURCES.md):
  _osm-raw.json  OpenStreetMap via Overpass       ODbL
  _arr.geojson   opendata.paris.fr arrondissements Licence Ouverte / Etalab
  _seine.json    OpenStreetMap via Overpass        ODbL
"""
import json, math, os, re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HERE, "data")


def load(n):
    with open(os.path.join(D, n), encoding="utf-8") as f:
        return json.load(f)


def dump(n, obj):
    with open(os.path.join(D, n), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(os.path.join(D, n))


# ---------------------------------------------------------------- geometry
def rdp(pts, eps):
    """Ramer-Douglas-Peucker. Keeps the shape, drops the vertices nobody sees."""
    if len(pts) < 3:
        return pts
    ax, ay = pts[0]
    bx, by = pts[-1]
    dx, dy = bx - ax, by - ay
    n2 = dx * dx + dy * dy
    worst, wi = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        if n2 == 0:
            d = math.hypot(px - ax, py - ay)
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / n2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d > worst:
            worst, wi = d, i
    if worst <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:wi + 1], eps)[:-1] + rdp(pts[wi:], eps)


def ring_of(coords, eps=0.00012):
    r = [(round(x, 5), round(y, 5)) for x, y in coords]
    if r[0] != r[-1]:
        r.append(r[0])
    s = rdp(r, eps)
    return [c for p in s for c in p]          # flat [x,y,x,y,...] — half the bytes


def in_ring(x, y, flat):
    inside = False
    n = len(flat) // 2
    j = n - 1
    for i in range(n):
        xi, yi = flat[2 * i], flat[2 * i + 1]
        xj, yj = flat[2 * j], flat[2 * j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ------------------------------------------------------------ arrondissements
arr = load("_arr.geojson")
ARR = []
for f in arr["features"]:
    p = f["properties"]
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    outer = max((pp[0] for pp in polys), key=len)
    ARR.append({
        "n": int(p["c_ar"]),
        "name": p["l_aroff"],                 # "Louvre", "Bourse", ...
        "c": [round(p["geom_x_y"]["lon"], 5), round(p["geom_x_y"]["lat"], 5)],
        "r": ring_of(outer),
    })
ARR.sort(key=lambda a: a["n"])


def which_arr(lon, lat):
    for a in ARR:
        if in_ring(lon, lat, a["r"]):
            return a["n"]
    return 0


# -------------------------------------------------------------------- water
seine = load("_seine.json")
WATER = []
for e in seine["elements"]:
    if e["type"] == "way":
        WATER.append(ring_of([(p["lon"], p["lat"]) for p in e["geometry"]], 0.00008))
    else:
        for m in e.get("members", []):
            if m.get("role") == "outer" and len(m.get("geometry", [])) > 3:
                WATER.append(ring_of([(p["lon"], p["lat"]) for p in m["geometry"]], 0.00008))
WATER = [w for w in WATER if len(w) >= 8]

# ----------------------------------------------------------------- bakeries
KIND = {"bakery": 0, "pastry": 1, "chocolate": 2, "confectionery": 3}
osm = load("_osm-raw.json")
seen, OUT = set(), []
for e in osm["elements"]:
    t = e.get("tags", {})
    name = (t.get("name") or "").strip()
    if not name:
        continue
    lat = e.get("lat") or (e.get("center") or {}).get("lat")
    lon = e.get("lon") or (e.get("center") or {}).get("lon")
    if lat is None:
        continue
    a = which_arr(lon, lat)
    if not a:                                  # outside the 20 — Paris only for now
        continue
    key = (name.lower(), round(lat, 4), round(lon, 4))
    if key in seen:
        continue
    seen.add(key)
    num = t.get("addr:housenumber") or t.get("contact:housenumber")
    st = t.get("addr:street") or t.get("contact:street")
    street = " ".join(x for x in (num, st) if x)
    rec = {
        "id": "%s%d" % (e["type"][0], e["id"]),
        "n": name,
        "y": round(lat, 5),
        "x": round(lon, 5),
        "a": a,
        "k": KIND.get(t.get("shop"), 0),
        "s": street or "",
        "h": t.get("opening_hours", ""),
        "w": t.get("website") or t.get("contact:website") or "",
        "t": t.get("phone") or t.get("contact:phone") or "",
    }
    if t.get("brand"):
        rec["b"] = t["brand"]                  # a chain — several shops share the name
    flags = ""
    if t.get("wheelchair") in ("yes", "limited"):
        flags += "w"
    if t.get("outdoor_seating") == "yes":
        flags += "o"
    if t.get("indoor_seating") == "yes":
        flags += "i"
    if t.get("takeaway") in ("yes", "only"):
        flags += "t"
    if flags:
        rec["f"] = flags
    OUT.append(rec)
OUT.sort(key=lambda b: (b["a"], b["n"]))

sz1 = dump("places.json", {
    "v": 1, "city": "paris", "count": len(OUT),
    "kinds": ["bakery", "pastry", "chocolate", "confectionery"],
    "attribution": "© OpenStreetMap contributors — ODbL",
    "places": OUT,
})
sz2 = dump("paris.json", {
    "v": 1,
    "attribution": "Arrondissements: Ville de Paris (opendata.paris.fr), Licence Ouverte 2.0. "
                   "Water: © OpenStreetMap contributors, ODbL.",
    "arr": ARR, "water": WATER,
})

from collections import Counter
c = Counter(b["a"] for b in OUT)
print("places  %5d  (%.0f KB)" % (len(OUT), sz1 / 1024))
print("paris   %5d arr, %d water rings  (%.0f KB)" % (len(ARR), len(WATER), sz2 / 1024))
print("kinds  ", Counter(b["k"] for b in OUT))
print("per arr", " ".join("%d:%d" % (k, c[k]) for k in range(1, 21)))
