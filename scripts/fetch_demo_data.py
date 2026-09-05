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

import argparse
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

# Pilot cities, in rollout order. Each is the dense urban core rather than
# the whole province - the demo wants the area people actually walk around
# in, not 5000 parking lots in the outer districts. Nothing in the data
# model is bounded to these boxes; adding a city is a row here plus a run.
CITIES: dict[str, dict] = {
    "istanbul": {
        "label": "İstanbul",
        "bbox": (40.85, 28.55, 41.25, 29.45),  # south, west, north, east
        "cap_scale": 1.0,
    },
    "ankara": {
        "label": "Ankara",
        "bbox": (39.78, 32.62, 40.03, 33.00),
        # Smaller cores need smaller caps; the point is coverage, not volume,
        # and the committed dataset shouldn't balloon for it.
        "cap_scale": 0.45,
    },
    "izmir": {
        "label": "İzmir",
        "bbox": (38.32, 26.98, 38.53, 27.25),
        "cap_scale": 0.45,
    },
    # Beyond the three pilot cities the caps drop again: the goal is that a
    # user in Bursa or Gaziantep opens the app and finds their own street,
    # not that the committed snapshot grows another 30 MB. Each of these is
    # the metropolitan core, not the whole province - a province bbox would
    # pull in hundreds of km of farmland for a handful of nodes.
    "bursa": {
        "label": "Bursa",
        "bbox": (40.15, 28.85, 40.28, 29.20),
        "cap_scale": 0.3,
    },
    "antalya": {
        "label": "Antalya",
        "bbox": (36.82, 30.60, 36.95, 30.83),
        "cap_scale": 0.3,
    },
    "adana": {
        "label": "Adana",
        "bbox": (36.94, 35.20, 37.07, 35.42),
        "cap_scale": 0.3,
    },
    "konya": {
        "label": "Konya",
        "bbox": (37.82, 32.40, 37.95, 32.60),
        "cap_scale": 0.3,
    },
    "gaziantep": {
        "label": "Gaziantep",
        "bbox": (36.98, 37.28, 37.13, 37.45),
        "cap_scale": 0.3,
    },
    "trabzon": {
        "label": "Trabzon",
        "bbox": (40.96, 39.63, 41.03, 39.83),
        "cap_scale": 0.3,
    },
    # Batch three: the remaining largest metropolitan cores, still tightest-box
    # first. Every bbox is the contiguous urban core, not the province - the
    # test suite asserts each city's derived centre lands among its own
    # places, so a box drawn too wide (farmland dragging the median off the
    # city) fails loudly instead of shipping a map that opens on empty fields.
    "kayseri": {
        "label": "Kayseri",
        "bbox": (38.66, 35.40, 38.78, 35.58),
        "cap_scale": 0.3,
    },
    "mersin": {
        "label": "Mersin",
        "bbox": (36.75, 34.50, 36.85, 34.70),
        "cap_scale": 0.3,
    },
    "eskisehir": {
        "label": "Eskişehir",
        "bbox": (39.72, 30.42, 39.82, 30.62),
        "cap_scale": 0.3,
    },
    "samsun": {
        "label": "Samsun",
        "bbox": (41.24, 36.25, 41.34, 36.42),
        "cap_scale": 0.3,
    },
    "denizli": {
        "label": "Denizli",
        "bbox": (37.72, 29.02, 37.82, 29.16),
        "cap_scale": 0.3,
    },
    "kocaeli": {
        "label": "Kocaeli",
        # The İzmit core. Gebze is a second, separate urban area in the same
        # province; it can come later as its own box rather than one giant
        # rectangle full of the bay and industrial void between them.
        "bbox": (40.70, 29.80, 40.82, 30.05),
        "cap_scale": 0.3,
    },
    "diyarbakir": {
        "label": "Diyarbakır",
        "bbox": (37.86, 40.16, 37.98, 40.32),
        "cap_scale": 0.3,
    },
    "sanliurfa": {
        "label": "Şanlıurfa",
        "bbox": (37.10, 38.72, 37.22, 38.87),
        "cap_scale": 0.3,
    },
    "malatya": {
        "label": "Malatya",
        "bbox": (38.30, 38.24, 38.40, 38.40),
        "cap_scale": 0.3,
    },
    "van": {
        "label": "Van",
        "bbox": (38.44, 43.30, 38.56, 43.45),
        "cap_scale": 0.3,
    },
}

DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "data"

ADMIN_DIVISIONS_PATH = DATA_DIR / "admin-divisions.json"


def _slugify_tr(name: str) -> str:
    """ASCII slug in the exact style the hand-written entries use:
    Sanliurfa-style folding (Şanlıurfa -> sanliurfa, Eskişehir -> eskisehir).
    The slug is an identifier (file names, city picker keys), so it must be
    stable and diacritic-free; the label keeps the real spelling."""
    table = str.maketrans("çğıöşüâîûÇĞİÖŞÜ", "cgiosuaiucgiosu")
    folded = name.translate(table).lower()
    return "".join(ch for ch in folded if ch.isalnum())


def synthesized_cities() -> dict[str, dict]:
    """Fetch configs for every province NOT hand-configured above, generated
    from OSM's own admin boundaries (scripts/fetch_admin_divisions.py).

    Generated rather than hand-written on purpose: 62 hand-typed bounding
    boxes are 62 chances to drop a city in a field, and the test suite would
    only catch it after a long fetch had already burned the API budget. The
    anchor is the province's admin_centre node - the capital city - NOT the
    polygon centroid, which for oddly shaped provinces lands in empty
    terrain. A province whose anchor fell back to the centroid is skipped
    loudly instead of fetched wrongly.

    Box size: half-height 0.055 deg lat, half-width 0.07 deg lon (~12x12 km)
    covers a mid-size Turkish city's contiguous core. The buyuksehir with
    wider sprawl are all in the hand-written set already.
    """
    if not ADMIN_DIVISIONS_PATH.exists():
        return {}
    data = json.loads(ADMIN_DIVISIONS_PATH.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for province in data.get("provinces", []):
        slug = _slugify_tr(province["name"])
        if slug in CITIES or slug in out:
            continue
        if not province.get("center_is_capital", False):
            print(f"  ! {province['name']}: merkez şehre çapalanamadı (centroid) - atlanıyor, elle bbox gerekli")
            continue
        center = province["center"]
        out[slug] = {
            "label": province["name"],
            "bbox": (
                round(center["lat"] - 0.055, 4),
                round(center["lon"] - 0.07, 4),
                round(center["lat"] + 0.055, 4),
                round(center["lon"] + 0.07, 4),
            ),
            "cap_scale": 0.2,
        }
    return out


def all_city_configs() -> dict[str, dict]:
    return {**CITIES, **synthesized_cities()}

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
    # --- Türkiye-specific additions ---------------------------------------
    # These are where a general "toilet finder" stops and a Turkish civic
    # tool starts. A mosque is the most widely available public facility in
    # Turkey (and the most reliable place to find a toilet and running water
    # in a neighbourhood you don't know); assembly points are the country's
    # standing earthquake-preparedness infrastructure and are exactly what
    # nobody can find when it matters.
    "cami": {
        "selectors": ['["amenity"="place_of_worship"]["religion"="muslim"]'],
        "cap": 700,
    },
    "eczane": {"selectors": ['["amenity"="pharmacy"]'], "cap": 700},
    "toplanma-alani": {"selectors": ['["emergency"="assembly_point"]'], "cap": 500},
    "kutuphane": {"selectors": ['["amenity"="library"]'], "cap": 300},
    "sarj": {"selectors": ['["amenity"="charging_station"]'], "cap": 300},
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
    "cami": "Cami",
    "eczane": "Eczane",
    "toplanma-alani": "Acil Toplanma Alanı",
    "kutuphane": "Kütüphane",
    "sarj": "Elektrikli Araç Şarj Noktası",
}


def overpass_query(selectors: list[str], bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
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


def _access_from_tags(tags: dict[str, str]) -> str:
    """Who can actually walk in.

    This is not decoration. A toilet tagged ``access=private`` is a toilet
    inside someone's property; listing it as a public toilet sends a person
    in a hurry to a door that will not open, which is the single worst thing
    this app can do. 146 places in the current snapshot carry a restricting
    value - 17 of them toilets - and every one of them was being served as
    freely usable.

    ``customers`` and ``permit`` are kept, because they *are* usable under a
    condition a person can meet ("buy a tea, use the toilet" is how most of
    Istanbul's usable toilets actually work). They are labelled rather than
    hidden. ``private``/``no`` are not public facilities at all.
    """
    value = (tags.get("access") or "").strip().lower()
    if value in {"private", "no"}:
        return "private"
    if value == "customers":
        return "customers"
    if value in {"permit", "permissive"}:
        return "permit"
    # Missing means unrestricted for civic features in OSM practice, and
    # "yes"/"designated"/"public" say so explicitly.
    return "public"


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
    if fee is None and category in {
        "park",
        "dinlenme",
        "su",
        "cocuk-alani",
        "wifi",
        # Public by definition in Turkey - a mosque, an assembly point or a
        # municipal library never charges entry, and leaving these "unknown"
        # would make the "Ücretsiz" filter useless for exactly the places
        # people fall back on.
        "cami",
        "toplanma-alani",
        "kutuphane",
    }:
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
        "access": _access_from_tags(tags),
        "address_line": _address_from_tags(tags),
        # Raw values only. Canonicalisation (Turkish folding, the 2018 Eyüp
        # rename, neighbourhoods mislabelled as districts, "İlçe/İl" crammed
        # into one field) happens in frontend/src/lib/administrative.ts,
        # which is where it can be tested and where a snapshot taken before
        # any of it existed still benefits.
        "district_raw": tags.get("addr:district") or tags.get("addr:suburb"),
        "province_raw": tags.get("addr:province") or tags.get("addr:city"),
        "opening_hours_raw": opening_hours,
        "is_24h": True if opening_hours == "24/7" else None,
        "website": tags.get("website") or tags.get("contact:website"),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "description": tags.get("description"),
        "operator": tags.get("operator"),
        "amenities": {
            # `designated` is OSM's strongest accessibility claim - purpose-built
            # for wheelchair users - and treating it as unknown understated
            # exactly the places that took the trouble to say so.
            # `limited` stays unknown: it means partially accessible, which is
            # neither a yes nor a no, and it is surfaced verbatim on the
            # detail page instead of being flattened into a boolean.
            "wheelchair_accessible": _tri_state(tags.get("wheelchair"), {"yes", "designated"}, {"no"}),
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


def fetch_category(city: str, category: str, config: dict, bbox, cap: int) -> list[dict]:
    """Per-city, per-category checkpoint on disk. Overpass will rate-limit
    partway through a multi-category run sooner or later; without this, every
    failure threw away every category already fetched (which is exactly what
    happened on the first run). Re-running now resumes instead of restarting.
    Delete .overpass-cache/ to force a genuinely fresh pull."""
    cache_dir = CACHE_DIR / city
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{category}.json"

    if cache_file.exists():
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        print(f"  → {category}: önbellekten {len(cached)} mekan")
        return cached

    print(f"  → {category} çekiliyor...")
    elements = run_query(overpass_query(config["selectors"], bbox))
    normalized = [p for p in (normalize(e, category) for e in elements) if p is not None]
    capped = normalized[:cap]
    print(f"    {len(elements)} OSM elemanı → {len(normalized)} geçerli → {len(capped)} alındı (cap {cap})")
    cache_file.write_text(json.dumps(capped, ensure_ascii=False), encoding="utf-8")
    return capped


def fetch_city(city: str, city_config: dict) -> int:
    """Each city gets its own file rather than one merged blob: a city can be
    re-pulled, added or dropped without touching the others, and the read
    side just globs the directory."""
    bbox = city_config["bbox"]
    scale = city_config.get("cap_scale", 1.0)

    print(f"\n=== {city_config['label']} ===")
    places: list[dict] = []
    for category, config in CATEGORIES.items():
        cap = max(50, int(config["cap"] * scale))
        places.extend(fetch_category(city, category, config, bbox, cap))
        time.sleep(8)  # be polite to a free public API - 2s got us 429'd

    merged = merge_multi_category(places)
    for place in merged:
        place["city"] = city

    out_path = DATA_DIR / f"places.{city}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "city": city,
                "city_label": city_config["label"],
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "OpenStreetMap via Overpass API",
                "license": "ODbL 1.0",
                "attribution": "© OpenStreetMap katkıda bulunanları",
                "bbox": {"south": bbox[0], "west": bbox[1], "north": bbox[2], "east": bbox[3]},
                "count": len(merged),
                "places": merged,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"  ✓ {len(merged)} mekan → {out_path.name} ({size_mb:.1f} MB)")
    return len(merged)


def main() -> None:
    cities = all_city_configs()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--city",
        choices=sorted(cities),
        action="append",
        help="Sadece bu şehri çek (birden fazla kez verilebilir). Varsayılan: hepsi.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Yalnızca henüz places.<il>.json dosyası olmayan illeri çek - "
        "81 ilin kalanını tamamlarken tek doğru mod: bitenler atlanır, "
        "yarıda kesilen koşu kaldığı yerden sürer.",
    )
    args = parser.parse_args()

    selected = args.city or sorted(cities)
    if args.only_missing:
        selected = [c for c in selected if not (DATA_DIR / f"places.{c}.json").exists()]
        print(f"--only-missing: {len(selected)} il eksik: {', '.join(selected) or '(hiç)'}")

    total = 0
    for city in selected:
        total += fetch_city(city, cities[city])

    print(f"\n✓ Toplam {total} mekan, {len(selected)} şehir: {', '.join(selected)}")


if __name__ == "__main__":
    main()
