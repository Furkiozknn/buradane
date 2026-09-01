"""Seeds the starting category tree (~55 categories under ~10 UI-grouping
parents) - see app/models/category.py's module docstring for why this is
data, not an enum. Idempotent: matched/updated by `slug`, safe to re-run as
the list grows ("araştırma sırasında yeni kategoriler keşfedersen genişlet").

Parent rows exist purely for UI grouping (accordion sections in the category
filter) and are never themselves assigned to a Place - only leaf categories
are. `osm_tags` on each leaf is an ingest-time hint for app/ingest/
osm_overpass.py, consumed as `key=value` OSM tag pairs; a leaf can map to
several OSM tags (e.g. "Spor Alanı" covers multiple `sport=*` values).

Run: `uv run python -m app.ingest.seed_categories`
"""

from __future__ import annotations

from app.core.db import SessionLocal
from app.models.category import Category

CATEGORY_TREE: list[dict] = [
    {
        "slug": "temel-ihtiyaclar",
        "name_tr": "Temel İhtiyaçlar",
        "name_en": "Basic Needs",
        "icon": "circle-dot",
        "children": [
            {"slug": "tuvalet", "name_tr": "Tuvalet", "name_en": "Toilet", "icon": "toilet", "osm_tags": ["amenity=toilets"]},
            {"slug": "engelli-tuvaleti", "name_tr": "Engelli Tuvaleti", "name_en": "Accessible Toilet", "icon": "accessibility", "osm_tags": ["amenity=toilets;wheelchair=yes"]},
            {"slug": "icme-suyu", "name_tr": "İçme Suyu / Çeşme", "name_en": "Drinking Water", "icon": "droplet", "osm_tags": ["amenity=drinking_water"]},
            {"slug": "oturma-alani", "name_tr": "Oturma Alanı / Bank", "name_en": "Seating / Bench", "icon": "armchair", "osm_tags": ["amenity=bench"]},
            {"slug": "golgelik", "name_tr": "Gölgelik / Pergole", "name_en": "Shade Structure", "icon": "umbrella", "osm_tags": ["leisure=pitch;shelter"]},
            {"slug": "dus", "name_tr": "Duş", "name_en": "Shower", "icon": "shower-head", "osm_tags": ["amenity=shower"]},
            {"slug": "bebek-bakim-odasi", "name_tr": "Bebek Bakım Odası", "name_en": "Baby Changing Room", "icon": "baby", "osm_tags": ["amenity=baby_hatch;changing_table=yes"]},
            {"slug": "wifi-noktasi", "name_tr": "Ücretsiz Wi-Fi Noktası", "name_en": "Free Wi-Fi Spot", "icon": "wifi", "osm_tags": ["internet_access=wlan"]},
        ],
    },
    {
        "slug": "yesil-alanlar",
        "name_tr": "Yeşil Alanlar",
        "name_en": "Green Spaces",
        "icon": "trees",
        "children": [
            {"slug": "park", "name_tr": "Park", "name_en": "Park", "icon": "trees", "osm_tags": ["leisure=park"]},
            {"slug": "oyun-parki", "name_tr": "Oyun Parkı", "name_en": "Playground", "icon": "ferris-wheel", "osm_tags": ["leisure=playground"]},
            {"slug": "piknik-alani", "name_tr": "Piknik Alanı", "name_en": "Picnic Area", "icon": "utensils", "osm_tags": ["tourism=picnic_site", "leisure=picnic_table"]},
            {"slug": "kosu-parkuru", "name_tr": "Koşu / Yürüyüş Parkuru", "name_en": "Running / Walking Track", "icon": "footprints", "osm_tags": ["leisure=track"]},
            {"slug": "botanik-bahcesi", "name_tr": "Botanik Bahçesi", "name_en": "Botanical Garden", "icon": "flower-2", "osm_tags": ["leisure=garden;garden:type=botanical"]},
            {"slug": "orman-koru", "name_tr": "Orman / Koru Alanı", "name_en": "Forest / Grove", "icon": "trees", "osm_tags": ["landuse=forest", "natural=wood"]},
        ],
    },
    {
        "slug": "spor-alanlari",
        "name_tr": "Spor Alanları",
        "name_en": "Sports Facilities",
        "icon": "dumbbell",
        "children": [
            {"slug": "basketbol-sahasi", "name_tr": "Basketbol Sahası", "name_en": "Basketball Court", "icon": "circle", "osm_tags": ["sport=basketball"]},
            {"slug": "futbol-sahasi", "name_tr": "Halı Saha / Futbol Sahası", "name_en": "Football Pitch", "icon": "circle", "osm_tags": ["sport=soccer"]},
            {"slug": "tenis-kortu", "name_tr": "Tenis Kortu", "name_en": "Tennis Court", "icon": "circle", "osm_tags": ["sport=tennis"]},
            {"slug": "voleybol-sahasi", "name_tr": "Voleybol Sahası", "name_en": "Volleyball Court", "icon": "circle", "osm_tags": ["sport=volleyball"]},
            {"slug": "yuzme-havuzu", "name_tr": "Yüzme Havuzu", "name_en": "Swimming Pool", "icon": "waves", "osm_tags": ["leisure=swimming_pool"]},
            {"slug": "fitness-istasyonu", "name_tr": "Açık Hava Spor / Fitness İstasyonu", "name_en": "Outdoor Fitness Station", "icon": "dumbbell", "osm_tags": ["leisure=fitness_station"]},
            {"slug": "skate-parki", "name_tr": "Skate Parkı", "name_en": "Skate Park", "icon": "activity", "osm_tags": ["sport=skateboard"]},
            {"slug": "bisiklet-parkuru", "name_tr": "Bisiklet Parkuru", "name_en": "Cycling Track", "icon": "bike", "osm_tags": ["sport=cycling", "highway=cycleway"]},
            {"slug": "spor-salonu", "name_tr": "Spor Salonu", "name_en": "Sports Hall", "icon": "dumbbell", "osm_tags": ["leisure=sports_centre"]},
        ],
    },
    {
        "slug": "deniz-sahil",
        "name_tr": "Deniz ve Sahil",
        "name_en": "Sea & Coast",
        "icon": "waves",
        "children": [
            {"slug": "plaj", "name_tr": "Plaj", "name_en": "Beach", "icon": "umbrella-beach", "osm_tags": ["natural=beach", "leisure=beach_resort"]},
            {"slug": "halk-plaji", "name_tr": "Halk Plajı (Ücretsiz)", "name_en": "Public Free Beach", "icon": "umbrella-beach", "osm_tags": ["natural=beach;fee=no"]},
            {"slug": "iskele-rihtim", "name_tr": "İskele / Rıhtım", "name_en": "Pier / Waterfront", "icon": "anchor", "osm_tags": ["man_made=pier"]},
            {"slug": "balik-tutma-alani", "name_tr": "Balık Tutma Alanı", "name_en": "Fishing Spot", "icon": "fish", "osm_tags": ["leisure=fishing"]},
        ],
    },
    {
        "slug": "ulasim",
        "name_tr": "Ulaşım",
        "name_en": "Transport",
        "icon": "bus",
        "children": [
            {"slug": "otobus-duragi", "name_tr": "Otobüs Durağı", "name_en": "Bus Stop", "icon": "bus", "osm_tags": ["highway=bus_stop"]},
            {"slug": "metro-tramvay-istasyonu", "name_tr": "Metro / Tramvay İstasyonu", "name_en": "Metro / Tram Station", "icon": "train-front", "osm_tags": ["railway=station", "railway=tram_stop"]},
            {"slug": "vapur-iskelesi", "name_tr": "Vapur İskelesi", "name_en": "Ferry Terminal", "icon": "ship", "osm_tags": ["amenity=ferry_terminal"]},
            {"slug": "otopark", "name_tr": "Otopark", "name_en": "Parking", "icon": "parking-circle", "osm_tags": ["amenity=parking"]},
            {"slug": "engelli-otoparki", "name_tr": "Engelli Otoparkı", "name_en": "Accessible Parking", "icon": "parking-circle", "osm_tags": ["amenity=parking;capacity:disabled>0"]},
            {"slug": "elektrikli-sarj-istasyonu", "name_tr": "Elektrikli Araç Şarj İstasyonu", "name_en": "EV Charging Station", "icon": "plug-zap", "osm_tags": ["amenity=charging_station"]},
            {"slug": "bisiklet-parki", "name_tr": "Bisiklet Park Yeri", "name_en": "Bicycle Parking", "icon": "bike", "osm_tags": ["amenity=bicycle_parking"]},
            {"slug": "paylasimli-bisiklet-istasyonu", "name_tr": "Paylaşımlı Bisiklet İstasyonu", "name_en": "Bike-Share Station", "icon": "bike", "osm_tags": ["amenity=bicycle_rental"]},
        ],
    },
    {
        "slug": "kultur-toplum",
        "name_tr": "Kültür ve Toplum",
        "name_en": "Culture & Community",
        "icon": "landmark",
        "children": [
            {"slug": "kutuphane", "name_tr": "Kütüphane", "name_en": "Library", "icon": "book-open", "osm_tags": ["amenity=library"]},
            {"slug": "kultur-merkezi", "name_tr": "Kültür Merkezi", "name_en": "Cultural Center", "icon": "landmark", "osm_tags": ["amenity=community_centre"]},
            {"slug": "genclik-merkezi", "name_tr": "Gençlik Merkezi", "name_en": "Youth Center", "icon": "users", "osm_tags": ["amenity=community_centre;community_centre=youth_centre"]},
            {"slug": "muze", "name_tr": "Müze", "name_en": "Museum", "icon": "landmark", "osm_tags": ["tourism=museum"]},
            {"slug": "sergi-alani", "name_tr": "Sergi / Sanat Alanı", "name_en": "Exhibition / Art Space", "icon": "image", "osm_tags": ["tourism=gallery"]},
            {"slug": "meydan", "name_tr": "Meydan", "name_en": "Public Square / Plaza", "icon": "landmark", "osm_tags": ["place=square"]},
            {"slug": "cocuk-oyun-salonu", "name_tr": "Çocuk Oyun Salonu (Kapalı)", "name_en": "Indoor Children's Play Area", "icon": "ferris-wheel", "osm_tags": ["leisure=indoor_play"]},
        ],
    },
    {
        "slug": "ibadet",
        "name_tr": "İbadet Alanları",
        "name_en": "Places of Worship",
        "icon": "landmark",
        "children": [
            {"slug": "cami", "name_tr": "Cami", "name_en": "Mosque", "icon": "landmark", "osm_tags": ["amenity=place_of_worship;religion=muslim"]},
            {"slug": "mescit-namaz-odasi", "name_tr": "Mescit / Namaz Odası", "name_en": "Prayer Room", "icon": "landmark", "osm_tags": ["amenity=place_of_worship;room=prayer_room"]},
            {"slug": "diger-ibadethane", "name_tr": "Diğer İbadethane", "name_en": "Other Place of Worship", "icon": "landmark", "osm_tags": ["amenity=place_of_worship"]},
        ],
    },
    {
        "slug": "saglik",
        "name_tr": "Sağlık",
        "name_en": "Health",
        "icon": "cross",
        "children": [
            {"slug": "eczane", "name_tr": "Eczane", "name_en": "Pharmacy", "icon": "cross", "osm_tags": ["amenity=pharmacy"]},
            {"slug": "aile-sagligi-merkezi", "name_tr": "Aile Sağlığı Merkezi", "name_en": "Family Health Center", "icon": "cross", "osm_tags": ["amenity=clinic;healthcare=centre"]},
            {"slug": "ilk-yardim-noktasi", "name_tr": "İlk Yardım / AED Noktası", "name_en": "First Aid / AED Point", "icon": "cross", "osm_tags": ["emergency=defibrillator"]},
        ],
    },
    {
        "slug": "guvenlik-acil-durum",
        "name_tr": "Güvenlik ve Acil Durum",
        "name_en": "Safety & Emergency",
        "icon": "shield-alert",
        "children": [
            {"slug": "deprem-toplanma-alani", "name_tr": "Afet / Deprem Toplanma Alanı", "name_en": "Emergency Assembly Point", "icon": "shield-alert", "osm_tags": ["emergency=assembly_point"]},
            {"slug": "itfaiye", "name_tr": "İtfaiye", "name_en": "Fire Station", "icon": "flame", "osm_tags": ["amenity=fire_station"]},
            {"slug": "polis-merkezi", "name_tr": "Polis Merkezi", "name_en": "Police Station", "icon": "shield", "osm_tags": ["amenity=police"]},
        ],
    },
    {
        "slug": "evcil-hayvan",
        "name_tr": "Evcil Hayvan Alanları",
        "name_en": "Pet-Friendly Areas",
        "icon": "dog",
        "children": [
            {"slug": "kopek-parki", "name_tr": "Köpek Parkı", "name_en": "Dog Park", "icon": "dog", "osm_tags": ["leisure=dog_park"]},
            {"slug": "evcil-hayvan-su-kabi", "name_tr": "Evcil Hayvan İçme Suyu", "name_en": "Pet Water Bowl", "icon": "dog", "osm_tags": ["amenity=drinking_water;dog=yes"]},
        ],
    },
]


def seed_categories() -> None:
    db = SessionLocal()
    try:
        existing = {c.slug: c for c in db.query(Category).all()}
        seeded, updated = 0, 0

        for parent_data in CATEGORY_TREE:
            children = parent_data["children"]
            parent = existing.get(parent_data["slug"])
            if parent is None:
                parent = Category(
                    slug=parent_data["slug"],
                    name_tr=parent_data["name_tr"],
                    name_en=parent_data["name_en"],
                    icon=parent_data["icon"],
                )
                db.add(parent)
                existing[parent.slug] = parent
                seeded += 1
            else:
                parent.name_tr = parent_data["name_tr"]
                parent.name_en = parent_data["name_en"]
                parent.icon = parent_data["icon"]
                updated += 1
            db.flush()  # need parent.id before assigning children below

            for child_data in children:
                child = existing.get(child_data["slug"])
                if child is None:
                    child = Category(
                        slug=child_data["slug"],
                        name_tr=child_data["name_tr"],
                        name_en=child_data["name_en"],
                        icon=child_data["icon"],
                        osm_tag_mappings=child_data["osm_tags"],
                        parent_id=parent.id,
                    )
                    db.add(child)
                    existing[child.slug] = child
                    seeded += 1
                else:
                    child.name_tr = child_data["name_tr"]
                    child.name_en = child_data["name_en"]
                    child.icon = child_data["icon"]
                    child.osm_tag_mappings = child_data["osm_tags"]
                    child.parent_id = parent.id
                    updated += 1

        db.commit()
        print(f"Kategoriler seed edildi: {seeded} yeni, {updated} güncellendi.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_categories()
