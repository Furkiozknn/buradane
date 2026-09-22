"""OSM'in kendi etiketlerinden dolan alanlar.

Veritabanı gerekmiyor: `_apply_amenity_hints` bir `Place` nesnesi ile bir
etiket sözlüğü alıyor, ikisi de bellekte kuruluyor. Bu testlerin ucuz
olması önemli, çünkü ölçtükleri şey içe aktarımın **sessiz** tarafı: bir
etiket eşlenmezse hiçbir şey hata vermez, sadece 167.829 satırın o sütunu
boş kalır ve arayüz onsuz "çalışmaya" devam eder.

`access` ve `operator` tam olarak öyle kaybolmuştu -
docs/api-sozlesme-farklari.md §4, frontend'in ikisini de kullandığını ve
backend'in hiçbir şemada üretmediğini yazıyordu.
"""

from __future__ import annotations

import pytest

from app.ingest.osm_overpass import _apply_amenity_hints
from app.models.place import Place, PriceType


def _bos_yer() -> Place:
    return Place(name="deneme", country_code="TR")


def test_access_etiketi_oldugu_gibi_tasiniyor():
    p = _bos_yer()
    _apply_amenity_hints(p, {"access": "customers"})
    assert p.access == "customers"


@pytest.mark.parametrize("deger", ["private", "customers", "permissive", "destination", "no"])
def test_gorulmemis_access_degerleri_de_gecer(deger):
    """OSM'in sözlüğünün uzun bir kuyruğu var.

    Bunu bir enum yapmak, görülmemiş bir değerin bir ilin içe aktarımını
    düşürmesi demekti; alan düz metin ve hangi değerlerin anlamlı olduğuna
    okuyan taraf karar veriyor.
    """
    p = _bos_yer()
    _apply_amenity_hints(p, {"access": deger})
    assert p.access == deger


def test_uzun_bir_deger_sutun_genisligine_kirpiliyor():
    p = _bos_yer()
    _apply_amenity_hints(p, {"access": "x" * 200, "operator": "y" * 500})
    assert len(p.access) == 40
    assert len(p.operator) == 200


def test_operator_etiketi_tasiniyor():
    p = _bos_yer()
    _apply_amenity_hints(p, {"operator": "İstanbul Büyükşehir Belediyesi"})
    assert p.operator == "İstanbul Büyükşehir Belediyesi"


def test_etiket_yoksa_alan_bilinmiyor_kalir():
    """Eksik bir olgu, bir iddiaya dönüşmemeli.

    Bu şemanın amenity sütunlarının `Optional[bool]` olmasının sebebi bu;
    aynı kural bu iki sütun için de geçerli. `access` boşsa "herkese açık"
    demek, kilitli bir servis avlusunu en yakın tuvalet diye önermenin
    sessiz yoludur.
    """
    p = _bos_yer()
    _apply_amenity_hints(p, {"wheelchair": "yes"})
    assert p.access is None
    assert p.operator is None


def test_bos_etiket_degeri_yazilmiyor():
    p = _bos_yer()
    _apply_amenity_hints(p, {"access": "", "operator": ""})
    assert p.access is None
    assert p.operator is None


def test_eski_eslemeler_bozulmadi():
    p = _bos_yer()
    _apply_amenity_hints(p, {
        "wheelchair": "yes", "drinking_water": "no", "fee": "no",
        "opening_hours": "24/7", "internet_access": "wlan",
        "access": "yes", "operator": "Belediye",
    })
    assert p.wheelchair_accessible is True
    assert p.has_drinking_water is False
    assert p.price_type is PriceType.free
    assert p.opening_hours_raw == "24/7"
    assert p.has_wifi is True
    assert p.access == "yes"
    assert p.operator == "Belediye"
