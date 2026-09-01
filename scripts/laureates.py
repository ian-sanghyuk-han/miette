# -*- coding: utf-8 -*-
"""Parse the Grand Paris bakers' union competition rankings into data/laureates.json.

Source: Syndicat des Boulangers du Grand Paris (boulangersdugrandparis.com), which
publishes each competition's full ranking as a public results post or PDF.

Facts only: rank, baker name, bakery name, address. No jury prose, no photographs.
"""
import glob, html, json, os, re, unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(HERE, "data")
PDF = os.path.join(D, "pdf")

# ---------------------------------------------------------------- competitions
# slug -> (competition id, what the bread is, jurisdiction)
COMPS = {
    "galette":    ("galette",    "galette-des-rois", "grand-paris"),
    "patisserie": ("patisserie", "eclair|tarte-citron", "grand-paris"),
    "flan":       ("flan",       "flan", "idf"),
    "croissant":  ("croissant",  "croissant", "grand-paris"),
    "tarte-aux-pommes": ("tarte-pommes", "tarte-aux-pommes", "idf"),
    "pain-de-campagne-bio": ("pain-bio", "pain-de-campagne-bio", "idf"),
    "pain-bio":   ("pain-bio",   "pain-de-campagne-bio", "idf"),
    "sandwich":   ("sandwich",   "sandwich", "grand-paris"),
    "baguette-de-tradition-de-la-seine-saint-denis": ("baguette-93", "baguette", "93"),
    "baguette-du-val-de-marne": ("baguette-94", "baguette", "94"),
    "baguette-de-tradition-du-val-de-marne": ("baguette-94", "baguette", "94"),
    "artisan-boulanger-des-hauts-de-seine": ("artisan-92", "artisan", "92"),
    "artisans-boulanger-des-hauts-de-seine": ("artisan-92", "artisan", "92"),
    "baguette-des-hauts-de-seine": ("baguette-92", "baguette", "92"),
}


def comp_of(slug):
    for k in sorted(COMPS, key=len, reverse=True):
        if k in slug:
            return COMPS[k]
    return None


def year_of(slug):
    m = re.findall(r"(20\d\d)", slug)
    return int(m[0]) if m else None


def section_of(slug, chunk):
    s = (slug + " " + chunk).lower()
    if "apprenti" in s or "cfa" in s or "ecoles" in s or "salaries" in s:
        return "apprentice"
    return "chef"


# --------------------------------------------------------------------- parsing
ROW1 = re.compile(
    r"^(\d{1,2})(?:\s*(?:er|e|eme|ème)?\s*(?:ex\s*aequo)?)?\s+"   # rank
    r"(.+?)\s+"                                                    # baker + bakery
    r"(\d{1,4}\s*(?:bis|ter)?[,]?\s+[^,]*?)\s+"                    # street
    r"(\d{5})\s+"                                                  # postcode
    r"([A-Za-zÀ-ÿ' \-]+)$",                                        # town
    re.U)
PC = re.compile(r"^\d{5}$")
RANK = re.compile(r"^(\d{1,2})(?:\s*(?:er|e|ème|eme))?(?:\s*ex\s*aequo)?$", re.I)


def split_names(blob):
    """'Patrick DUMONT MAISON DUMONT' -> ('Patrick DUMONT', 'MAISON DUMONT').

    The baker's surname is upper-case and the bakery name follows it. Cut after the
    last token that still looks like part of a person's name."""
    toks = blob.split()
    if len(toks) < 3:
        return blob, ""
    # a person is typically Firstname SURNAME (possibly 'X et Y', hyphenated)
    for i in range(len(toks) - 1, 0, -1):
        if toks[i].isupper() and len(toks[i]) > 1 and i < len(toks) - 1:
            return " ".join(toks[:i + 1]), " ".join(toks[i + 1:])
    return " ".join(toks[:2]), " ".join(toks[2:])


def parse_flat(lines, slug):
    """Format A — the whole row on one line."""
    out, section = [], "chef"
    for l in lines:
        low = l.lower()
        if re.search(r"apprenti|cfa|ecoles boulangeri|salari", low) and len(l) < 40:
            section = "apprentice"
        elif re.search(r"chefs? d.entreprise|classement$|boulangeries$", low) and len(l) < 40:
            section = "chef"
        m = ROW1.match(l)
        if not m:
            continue
        rank, blob, street, pc, town = m.groups()
        who, shop = split_names(blob.strip())
        out.append({"rank": int(rank), "who": who, "shop": shop,
                    "street": street.strip(" ,"), "pc": pc, "town": town.strip(),
                    "section": section})
    return out


ADDR = re.compile(r"^(.*?)[, ]\s*(\d{5})\s+([A-Za-zÀ-ÿ' \-]+)$", re.U)


def parse_cells(lines, slug):
    """One table cell per line. Two shapes occur, so find the postcode and work back:

    B:  rank / baker / bakery / street / 75013 / PARIS
    C:  rank / baker / bakery / '2, rue Butte aux Cailles 75013 PARIS'
    """
    out, section = [], "chef"
    i = 0
    while i < len(lines):
        l = lines[i]
        low = l.lower()
        if re.search(r"apprenti|cfa|ecoles boulangeri|salari", low) and len(l) < 40:
            section = "apprentice"
        elif re.search(r"chefs? d.entreprise|boulangeries?$", low) and len(l) < 40:
            section = "chef"
        m = RANK.match(l)
        if m:
            win = lines[i + 1:i + 8]
            hit = next((j for j, w in enumerate(win) if re.search(r"\b\d{5}\b", w)), None)
            if hit is not None and hit >= 1:
                who = win[0]
                if PC.match(win[hit]):                       # shape B
                    street, pc = win[hit - 1], win[hit]
                    town = win[hit + 1] if hit + 1 < len(win) else ""
                    shop = " ".join(win[1:hit - 1])
                    step = hit + 2
                else:                                        # shape C
                    a = ADDR.match(win[hit])
                    if not a:
                        i += 1
                        continue
                    street, pc, town = a.group(1), a.group(2), a.group(3)
                    shop = " ".join(win[1:hit])
                    step = hit + 1
                if who and not PC.match(who) and 1 < len(who) < 90:
                    out.append({"rank": int(m.group(1)), "who": who,
                                "shop": shop.strip(), "street": street.strip(" ,"),
                                "pc": pc, "town": town.strip(), "section": section})
                    i += step
                    continue
        i += 1
    return out


def html_lines(path):
    s = open(path, encoding="utf-8", errors="ignore").read()
    m = re.search(r"<div[^>]*entry-content.*?</article>", s, re.S) or \
        re.search(r"<article.*?</article>", s, re.S)
    b = m.group(0) if m else s
    b = re.sub(r"<(script|style).*?</\1>", "", b, flags=re.S)
    b = re.sub(r"<(br|/p|/td|/tr|/li|/h[1-6])[^>]*>", "\n", b)
    t = html.unescape(re.sub(r"<[^>]+>", " ", b))
    return [re.sub(r"\s+", " ", x).strip() for x in t.split("\n") if x.strip()]


# ----------------------------------------------------------------------- build
rows = []

for f in sorted(glob.glob(os.path.join(PDF, "html", "*.html"))):
    slug = os.path.basename(f)[:-5]
    c = comp_of(slug)
    y = year_of(slug)
    if not c or not y:
        continue
    lines = html_lines(f)
    got = parse_flat(lines, slug) or parse_cells(lines, slug)
    for r in got:
        r.update({"comp": c[0], "bread": c[1], "area": c[2], "year": y, "src": slug})
    rows += got

txt = json.load(open(os.path.join(PDF, "_text.json"), encoding="utf-8"))
for name, body in txt.items():
    slug = name[:-4].lower()
    c = comp_of(slug)
    y = year_of(slug)
    if not c:
        continue
    lines = [re.sub(r"\s+", " ", x).strip() for x in body.split("\n") if x.strip()]
    if not y:                                   # e.g. tarte-aux-pommes-…-site.pdf
        for l in lines[:4]:
            m = re.search(r"(20\d\d)", l)
            if m:
                y = int(m.group(1))
                break
    if not y:
        continue
    got = parse_flat(lines, slug)
    for r in got:
        r.update({"comp": c[0], "bread": c[1], "area": c[2], "year": y, "src": name})
    rows += got

# ---------------------------------------------------------------------- clean
# Some pages are nominee lists rather than rankings, and apprentice rows name a
# school instead of a shop. A row only earns its place if it points at a bakery.
SCHOOL = re.compile(r"^(EBP|FERRANDI|EPMT|CMA ?\d*|Campus|CFA)\b", re.I)
BAD_SRC = {"meilleur-artisans-boulanger-des-hauts-de-seine-2023-les-resultats"}

rows = [r for r in rows
        if r["src"] not in BAD_SRC
        and r["shop"] and len(r["shop"]) > 2
        and not SCHOOL.match(r["shop"])
        and not r["who"].lower().startswith("monsieur")
        and r["rank"] <= 30]

# de-duplicate (a post and its PDF can carry the same table)
seen, uniq = set(), []
for r in rows:
    k = (r["comp"], r["year"], r["section"], r["rank"], r["who"].lower())
    if k in seen:
        continue
    seen.add(k)
    uniq.append(r)
uniq.sort(key=lambda r: (r["comp"], -r["year"], r["section"], r["rank"]))

path = os.path.join(D, "laureates.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "v": 1,
        "source": "Syndicat des Boulangers du Grand Paris — published competition rankings",
        "url": "https://boulangersdugrandparis.com/category/concours/",
        "note": "Facts only: rank, laureate, bakery, address. No jury commentary, no images.",
        "laureates": uniq,
    }, f, ensure_ascii=False, indent=1)

from collections import Counter
print("rows", len(uniq), " (%.0f KB)" % (os.path.getsize(path) / 1024))
for k, v in sorted(Counter((r["comp"], r["year"]) for r in uniq).items()):
    print("  %-14s %d  %d" % (k[0], k[1], v))
print("in Paris (75):", sum(1 for r in uniq if r["pc"].startswith("75")))
