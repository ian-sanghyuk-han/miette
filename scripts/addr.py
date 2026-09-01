# -*- coding: utf-8 -*-
"""Give every shop an address.

OpenStreetMap tags a shop's own address only about half the time, but Paris has
near-complete address coverage from the BANO import — on the building the shop
sits in, or on a point by its door. So: snap each shop with no address of its own
to the nearest addressed point, and take that.

Only within 28 m, and only when there is no tie between two different streets at
similar distance — a wrong address sends her to the wrong door, which is worse
than none at all.
"""
import glob, json, math, os
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HERE, "data")
KX = math.cos(math.radians(48.858))
CELL = 0.0008                                    # ~60 m north-south
MAXD = 28.0                                      # metres

pts = []
for f in sorted(glob.glob(os.path.join(D, "_addr*.json"))):
    try:
        raw = json.load(open(f, encoding="utf-8"))
    except Exception:
        print("skipped", os.path.basename(f))
        continue
    for e in raw.get("elements", []):
        t = e.get("tags", {})
        hn, st = t.get("addr:housenumber"), t.get("addr:street")
        if not hn or not st:
            continue
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None:
            continue
        pts.append((lon, lat, hn, st))

grid = defaultdict(list)
for i, (lon, lat, hn, st) in enumerate(pts):
    grid[(int(lon / CELL), int(lat / CELL))].append(i)

print("address points: %d" % len(pts))


def nearest(lon, lat):
    gx, gy = int(lon / CELL), int(lat / CELL)
    best, second = None, None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for i in grid.get((gx + dx, gy + dy), ()):
                plon, plat, hn, st = pts[i]
                d = math.hypot((plon - lon) * KX, plat - lat) * 111320
                if d > MAXD:
                    continue
                if best is None or d < best[0]:
                    second = best
                    best = (d, hn, st)
                elif second is None or d < second[0]:
                    second = (d, hn, st)
    if best is None:
        return None
    # a tie between two different streets is a coin flip; refuse it
    if second and second[2] != best[2] and second[0] - best[0] < 6:
        return None
    return best[1] + " " + best[2]


def street_only(lon, lat, radius=70.0):
    """No door number nearby, but if the neighbours agree on a street, name it."""
    gx, gy = int(lon / CELL), int(lat / CELL)
    near = []
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            for i in grid.get((gx + dx, gy + dy), ()):
                plon, plat, hn, st = pts[i]
                d = math.hypot((plon - lon) * KX, plat - lat) * 111320
                if d <= radius:
                    near.append((d, st))
    if len(near) < 3:
        return None
    near.sort()
    top = [st for _, st in near[:5]]
    winner = max(set(top), key=top.count)
    return winner if top.count(winner) >= 3 else None


places = json.load(open(os.path.join(D, "places.json"), encoding="utf-8"))
own = door = street = still = 0
for p in places["places"]:
    if p.get("s") and not p.get("sa"):
        own += 1
        continue
    p.pop("s", None); p.pop("sa", None)          # re-derive, so the script can be re-run
    a = nearest(p["x"], p["y"])
    if a:
        p["s"] = a; p["sa"] = 1                  # the building's number, not the shop's own tag
        door += 1
        continue
    st = street_only(p["x"], p["y"])
    if st:
        p["s"] = st; p["sa"] = 2                 # the street only — no number to be had
        street += 1
    else:
        still += 1

places["address_note"] = ("sa=1: the nearest OpenStreetMap address point within 28 m. "
                          "sa=2: the street the neighbours agree on, with no number.")
with open(os.path.join(D, "places.json"), "w", encoding="utf-8") as f:
    json.dump(places, f, ensure_ascii=False, separators=(",", ":"))

n = len(places["places"])
print("own tags         %4d  (%.0f%%)" % (own, 100 * own / n))
print("door nearby      %4d  (%.0f%%)" % (door, 100 * door / n))
print("street only      %4d  (%.0f%%)" % (street, 100 * street / n))
print("still without    %4d  (%.0f%%)" % (still, 100 * still / n))
print("with an address  %4d  (%.0f%%)" % (n - still, 100 * (n - still) / n))
print("file  %.0f KB" % (os.path.getsize(os.path.join(D, "places.json")) / 1024))
