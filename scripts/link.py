# -*- coding: utf-8 -*-
"""Attach competition results to the bakeries on the map.

Reads data/places.json + data/laureates.json, matches each Paris laureate row to an
OpenStreetMap shop, and writes the awards back into places.json as `aw`.

A laureate only attaches when the arrondissement agrees AND either the shop names
match closely or the street address does. Everything unmatched is reported, never
guessed — a badge on the wrong bakery is worse than no badge.
"""
import difflib, json, os, re, unicodedata
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HERE, "data")

NOISE = re.compile(
    r"\b(BOULANGERIE|PATISSERIE|PATISSIER|MAISON|LA|LE|LES|DU|DE|DES|D|L|AU|AUX|"
    r"ARTISAN|ARTISANALE|CHEZ|ET|SARL|EURL|SAS)\b")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9 ]", " ", s.upper())
    return re.sub(r"\s+", " ", s).strip()


def key(s):
    return re.sub(r"\s+", " ", NOISE.sub(" ", norm(s))).strip()


def street_key(s):
    s = norm(s)
    s = re.sub(r"\b(RUE|AVENUE|AV|BOULEVARD|BLD|BD|PLACE|PL|IMPASSE|ALLEE|QUAI|"
               r"COURS|FBG|FAUBOURG|GRANDE)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def num_of(s):
    m = re.match(r"\s*(\d+)", norm(s))
    return m.group(1) if m else None


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio() if a and b else 0.0


places = json.load(open(os.path.join(D, "places.json"), encoding="utf-8"))
laur = json.load(open(os.path.join(D, "laureates.json"), encoding="utf-8"))

by_arr = defaultdict(list)
for p in places["places"]:
    by_arr[p["a"]].append(p)

awards = defaultdict(list)
matched = unmatched = 0
misses = []

for r in laur["laureates"]:
    if not r["pc"].startswith("75"):
        continue                                    # Paris map only, for now
    arr = int(r["pc"][3:]) if r["pc"] != "75116" else 16
    if not 1 <= arr <= 20:
        continue
    lk, ls, ln = key(r["shop"]), street_key(r["street"]), num_of(r["street"])

    best, score = None, 0.0
    for p in by_arr.get(arr, []):
        name_r = max(ratio(lk, key(p["n"])), ratio(norm(r["shop"]), norm(p["n"])))
        addr_r = 0.0
        if ln and p["s"] and num_of(p["s"]) == ln:
            addr_r = ratio(ls, street_key(p["s"]))
        # a strong name, a decent name backed by the same door number, or — in a city
        # where one door holds one shop — the same door on the same street
        s = max(name_r, (name_r * 0.45 + addr_r * 0.55) if addr_r > 0.75 else 0)
        if addr_r >= 0.88:
            s = max(s, 0.80 + 0.15 * name_r)
        if s > score:
            best, score = p, s

    if best and score >= 0.80:
        awards[best["id"]].append({
            "c": r["comp"], "y": r["year"], "r": r["rank"],
            "s": r["section"], "who": r["who"],
        })
        matched += 1
    else:
        unmatched += 1
        misses.append((r["comp"], r["year"], r["rank"], r["shop"], r["street"], r["pc"],
                       round(score, 2), best["n"] if best else "-"))

for p in places["places"]:
    a = awards.get(p["id"])
    if a:
        a.sort(key=lambda x: (-x["y"], x["r"]))
        p["aw"] = a

places["awards_source"] = laur["source"]
places["awards_url"] = laur["url"]
with open(os.path.join(D, "places.json"), "w", encoding="utf-8") as f:
    json.dump(places, f, ensure_ascii=False, separators=(",", ":"))

print("Paris laureate rows matched: %d   unmatched: %d" % (matched, unmatched))
print("bakeries carrying at least one award: %d" % len(awards))
top = sorted(awards.items(), key=lambda kv: -len(kv[1]))[:10]
names = {p["id"]: p["n"] for p in places["places"]}
for pid, aws in top:
    tags = " ".join("%s%d/%d" % (a["c"], a["y"] % 100, a["r"]) for a in aws[:6])
    print("   %-34s %s" % (names[pid][:34], tags))
print("\nunmatched (needs a look):")
for m in misses[:14]:
    print("   %-12s %d #%-2d %-30s %-26s  best=%.2f %s" %
          (m[0], m[1], m[2], m[3][:30], m[4][:26], m[6], m[7][:24]))
print("   ... %d total" % len(misses))
