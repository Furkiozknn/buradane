"""Repairs data defects found in an already-fetched snapshot, without
re-hitting Overpass (which rate-limits hard).

Currently fixes:
  1. Address lines containing a literal "None" - an earlier version of
     _address_from_tags interpolated a missing house number unconditionally,
     so records shipped as "Yerebatan Caddesi None".
  2. `opening_hours` values that are literally "closed" - OSM uses this to
     mean "permanently closed as a rule", which our parser correctly reads as
     closed, but on a public drinking fountain it is almost always a tagging
     mistake and rendering "Şu an kapalı" on every fountain is worse than
     saying nothing. Cleared to null (unknown).

Re-runnable and idempotent. Run after fetch_demo_data.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_PATH = Path(__file__).resolve().parent.parent / "frontend" / "data" / "places.istanbul.json"


def rebuild_address(tags: dict) -> str | None:
    street = tags.get("addr:street")
    number = tags.get("addr:housenumber")
    district = tags.get("addr:district") or tags.get("addr:suburb")
    city = tags.get("addr:city")
    street_line = " ".join(part for part in (street, number) if part) or None
    parts = [p for p in (street_line, district, city) if p]
    return ", ".join(parts) if parts else None


def main() -> None:
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    places = dataset["places"]

    fixed_addresses = 0
    cleared_hours = 0

    for place in places:
        address = place.get("address_line")
        if address and "None" in address:
            place["address_line"] = rebuild_address(place.get("raw_tags", {}))
            fixed_addresses += 1

        if place.get("opening_hours_raw") in {"closed", "off"}:
            place["opening_hours_raw"] = None
            place["is_24h"] = None
            cleared_hours += 1

    DATA_PATH.write_text(json.dumps(dataset, ensure_ascii=False), encoding="utf-8")
    print(f"✓ {fixed_addresses} adres düzeltildi, {cleared_hours} hatalı 'closed' saat bilgisi temizlendi")


if __name__ == "__main__":
    main()
