# Miette

A paper map of Paris bakeries you can stamp. Offline, no account, no server.

**Personal project. Not a service.**

## Data & attribution

- Bakeries, water: (c) OpenStreetMap contributors, licensed under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/) (ODbL).
  Derived data in `data/` is published under the same licence.
- Arrondissement boundaries: Ville de Paris (opendata.paris.fr),
  Licence Ouverte / Open Licence 2.0 (Etalab).
- Competition results: published by the Ville de Paris and the Confederation
  nationale de la boulangerie-patisserie francaise. Facts only — no jury prose,
  no photographs, no third-party ratings.

See `MIETTE-KICKOFF.md` for the full specification.

## Rebuilding the data

```
python scripts/build.py
```

Raw snapshots (`data/_*.json`) are fetched from Overpass and opendata.paris.fr;
they are gitignored. `scripts/build.py` turns them into the shipped files.
