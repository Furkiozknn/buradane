"""Pulls REAL OpenStreetMap data for the İstanbul pilot and normalizes it into
the exact JSON shape the demo API serves.

Why this exists separately from backend/app/ingest/osm_overpass.py: that one
writes into PostGIS (the production path). This one writes a flat JSON file
so the demo runs with zero infrastructure - no Postgres, no Docker - while
still being **real data**, not mock data. The shape it emits is deliberately
the same shape the FastAPI backend's PlaceListItem/PlaceDetail schemas
produce, so swapping the demo adapter for the real backend later is a base-URL
change, not a rewrite.

License: OSM data is ODbL 1.0 - see docs/DATA_SOURCES.md. Attribution is
rendered in the app's map corner and in the place detail's "Kaynak" row.

Run:  uv run --no-project python scripts/fetch_demo_data.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Windows consoles default to a legacy codepage (cp1254 on a Turkish-locale
# machine), which cannot encode the arrows/checkmarks below and kills the
# script with a UnicodeEncodeError before it does any work. Forcing UTF-8 on
# our own stdout is the fix; it's a no-op on platforms that already are.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",  # mirror, used if the primary is busy
]

# İstanbul core (European + Asian urban area). Deliberately not the whole
# province - the demo wants density, not 5000 parking lots in Silivri. The
# data model itself is not bounded to this box; see README.
BBOX = (40.85, 28.55, 41.25, 29.45)  # south, west, north, east

OUT_PATH = Path(__file__).resolve().parent.parent / "frontend" / "data" / "places.istanbul.json"

# category slug -> (OSM selectors, per-category cap)
# The cap exists because some categories (parking, benches) would otherwise
# dominate the file and the map. Sorted-by-nothing truncation is fine for a
# demo; the production pipeline has no such cap.
CATEGORIES: dict[str, dict] = {
    "tuvalet": {"selectors": ['["amenity"="toilets"]'], "cap": 900},
    "park": {"selectors": ['["leisure"="park"]'], "cap": 900},
    "su": {"selectors": ['["amenity"="drinking_water"]'], "cap": 500},
    "dinlenme": {"selectors": ['["amenity"="bench"]'], "cap": 700},
    "cocuk-alani": {"selectors": ['["leisure"="playground"]'], "cap": 700},
    "spor": {
        "selectors": ['["leisure"="pitch"]', '["leisure"="fitness_station"]', '["leisure"="sports_centre"]'],
        "cap": 700,
    },
    "otopark": {"selectors": ['["amenity"="parking"]["access"!="private"]'], "cap": 700},
    "dus": {"selectors": ['["amenity"="shower"]'], "cap": 200},
    "wifi": {"selectors": ['["internet_access"="wlan"]'], "cap": 300},
}

# Fallback display names for unnamed OSM features - a huge share of toilets,
# benches and drinking fountains carry no `name` tag at all, and "İsimsiz"
# everywhere would read as broken. See CATEGORY_META in the frontend for the
# user-facing labels; these mirror them.
UNNAMED_LABEL = {
    "tuvalet": "Umumi Tuvalet",
    "park": "Park",
    "su": "İçme Suyu Çeşmesi",
    "dinlenme": "Oturma Alanı",
    "cocuk-alani": "Çocuk Oyun Alanı",
    "spor": "Spor Alanı",
    "otopark": "Otopark",
    "dus": "Duş",
    "wifi": "Ücretsiz Wi-Fi Noktası",
}


def overpass_query(selectors: list[str]) -> str:
    south, west, north, east = BBOX
    parts = []
    for selector in selectors:
        parts.append(f"  node{selector}({south},{west},{north},{east});")
        parts.append(f"  way{selector}({south},{west},{north},{east});")
    body = "\n".join(parts)
    return f"[out:json][timeout:180];\n(\n{body}\n);\nout center tags;"


def run_query(query: str, *, max_rounds: int = 4) -> list[dict]:
    """Overpass' free endpoints rate-limit aggressively (HTTP 429) and its
    mirrors intermittently 502. A single pass over the endpoint list is not
    enough - the first real run of this script lost 7 of 9 categories that
    way. So: several rounds over all endpoints, with exponential backoff
    between rounds, since a 429 specifically means "come back later", not
    "this endpoint is broken"."""
    payload = urllib.parse.urlencode({"data": query}).encode()
    last_error: Exception | None = None

    for round_index in range(max_rounds):
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                req = urllib.request.Request(
                    endpoint, data=payload, headers={"User-Agent": "buradane-demo-fetch/0.1 (civic places finder)"}
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return json.loads(resp.read().decode("utf-8")).get("elements", [])
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
                last_error = e
                print(f"  ! {endpoint.split('/')[2]} başarısız ({e})")
                time.sleep(5)

        if round_index < max_rounds - 1:
            backoff = 30 * (round_index + 1)
            print(f"  … tüm endpoint'ler başarısız, {backoff}s bekleyip tekrar denenecek "
                  f"(tur {round_index + 2}/{max_rounds})")
            time.sleep(backoff)

    raise RuntimeError(f"Overpass'ın tüm endpoint'leri {max_rounds} turda da başarısız: {last_error}")


def _tri_state(value: str | None, true_values: set[str], false_values: set[str]) -> bool | None:
    """OSM tag -> True/False/None. `None` means genuinely unknown and must
    never be rendered as "no" in the UI - the whole reason the schema uses
    `bool | None` rather than `bool`."""
    if value is None:
        return None
    if value in true_values:
        return True
    if value in false_values:
        return False
    return None


def normalize(element: dict, category: str) -> dict | None:
    tags = element.get("tags", {})

    if element["type"] == "node":
        lat, lon = element.get("lat"), element.get("lon")
    else:
        center = element.get("center") or {}
        lat, lon = center.get("lat"), center.get("lon")
    if lat is None or lon is None:
        return None

    name = tags.get("name") or tags.get("name:tr") or UNNAMED_LABEL.get(category, "İsimsiz Alan")

    fee = tags.get("fee")
    price_type = "free" if fee == "no" else "paid" if fee == "yes" else "unknown"
    # A public park/bench/drinking fountain with no fee tag is free in
    # practice - assuming "unknown" there would make the "Ücretsiz" filter
    # useless for exactly the categories users care most about.
    if fee is None and category in {"park", "dinlenme", "su", "cocuk-alani", "wifi"}:
        price_type = "free"

    opening_hours = tags.get("opening_hours")

    return {
        "id": f"{element['type']}/{element['id']}",
        "name": name,
        "lat": lat,
        "lon": lon,
        "categories": [category],
        "status": "active",
        "price_type": price_type,
        "address_line": _address_from_tags(tags),
        "opening_hours_raw": opening_hours,
        "is_24h": True if opening_hours == "24/7" else None,
        "website": tags.get("website") or tags.get("contact:website"),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "description": tags.get("description"),
        "operator": tags.get("operator"),
        "amenities": {
            "wheelchair_accessible": _tri_state(tags.get("wheelchair"), {"yes"}, {"no"}),
            "has_ramp": _tri_state(tags.get("ramp"), {"yes"}, {"no"}),
            "baby_changing": _tri_state(tags.get("changing_table"), {"yes"}, {"no"}),
            "child_friendly": True if category == "cocuk-alani" else _tri_state(tags.get("playground"), {"yes"}, {"no"}),
            "pet_friendly": _tri_state(tags.get("dog"), {"yes", "leashed"}, {"no"}),
            "has_drinking_water": True
            if category == "su"
            else _tri_state(tags.get("drinking_water"), {"yes"}, {"no"}),
            "has_wifi": True if category == "wifi" else _tri_state(tags.get("internet_access"), {"wlan", "yes"}, {"no"}),
            "has_shower": True if category == "dus" else _tri_state(tags.get("shower"), {"yes"}, {"no"}),
            "has_seating": True if category == "dinlenme" else _tri_state(tags.get("bench"), {"yes"}, {"no"}),
            "has_shade": _tri_state(tags.get("shelter") or tags.get("covered"), {"yes"}, {"no"}),
            "has_parking": True if category == "otopark" else _tri_state(tags.get("parking"), {"yes"}, {"no"}),
            "is_quiet": None,
        },
        "source": {
            "slug": "osm",
            "name": "OpenStreetMap",
            "license": "ODbL 1.0",
            "url": f"https://www.openstreetmap.org/{element['type']}/{element['id']}",
        },
        "raw_tags": tags,
    }


def _address_from_tags(tags: dict) -> str | None:
    street = tags.get("addr:street")
    number = tags.get("addr:housenumber")
    district = tags.get("addr:district") or tags.get("addr:suburb")
    city = tags.get("addr:city")

    # Build the street line from the parts that actually exist - an earlier
    # version interpolated `number` unconditionally and shipped literal
    # "Yerebatan Caddesi None" strings into the UI.
    street_line = " ".join(part for part in (street, number) if part) or None

    parts = [p for p in (street_line, district, city) if p]
    return ", ".join(parts) if parts else None


def merge_multi_category(places: list[dict]) -> list[dict]:
    """One real place can legitimately match several category queries (a
    sports centre tagged with both leisure=sports_centre and a playground, a
    park with a drinking fountain mapped on the same way). The data model's
    core promise is that this stays ONE place with several categories - so
    merge on OSM id rather than emitting duplicates."""
    by_id: dict[str, dict] = {}
    for place in places:
        existing = by_id.get(place["id"])
        if existing is None:
            by_id[place["id"]] = place
            continue
        for category in place["categories"]:
            if category not in existing["categories"]:
                existing["categories"].append(category)
        for key, value in place["amenities"].items():
            if existing["amenities"].get(key) is None and value is not None:
                existing["amenities"][key] = value
    return list(by_id.values())


CACHE_DIR = Path(__file__).resolve().parent.parent / ".overpass-cache"


def fetch_category(category: str, config: dict) -> list[dict]:
    """Per-category checkpoint on disk. Overpass will rate-limit partway
    through a 9-category run sooner or later; without this, every failure
    threw away every category already fetched (which is exactly what
    happened on the first run). Re-running now resumes instead of restarting.
    Delete .overpass-cache/ to force a genuinely fresh pull."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{category}.json"

    if cache_file.exists():
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        print(f"→ {category}: önbellekten {len(cached)} mekan (yeniden çekilmedi)")
        return cached

    print(f"→ {category} çekiliyor...")
    elements = run_query(overpass_query(config["selectors"]))
    normalized = [p for p in (normalize(e, category) for e in elements) if p is not None]
    capped = normalized[: config["cap"]]
    print(f"  {len(elements)} OSM elemanı → {len(normalized)} geçerli → {len(capped)} alındı (cap {config['cap']})")
    cache_file.write_text(json.dumps(capped, ensure_ascii=False), encoding="utf-8")
    return capped


def main() -> None:
    all_places: list[dict] = []
    for category, config in CATEGORIES.items():
        all_places.extend(fetch_category(category, config))
        time.sleep(8)  # be polite to a free public API - 2s was too aggressive and got us 429'd

    merged = merge_multi_category(all_places)
    multi = [p for p in merged if len(p["categories"]) > 1]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "OpenStreetMap via Overpass API",
                "license": "ODbL 1.0",
                "attribution": "© OpenStreetMap katkıda bulunanları",
                "bbox": {"south": BBOX[0], "west": BBOX[1], "north": BBOX[2], "east": BBOX[3]},
                "count": len(merged),
                "places": merged,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    size_mb = OUT_PATH.stat().st_size / 1024 / 1024
    print(f"\n✓ {len(merged)} mekan yazıldı → {OUT_PATH} ({size_mb:.1f} MB)")
    print(f"  {len(multi)} mekan birden fazla kategoriye ait (çoklu-kategori modeli çalışıyor)")


if __name__ == "__main__":
    main()
