"""`docs/api-sozlesme-farklari.md` hâlâ doğru mu?

O belge geçişin planı: frontend'in beklediği ile backend'in döndürdüğü
arasındaki her fark orada alan alan yazılı, ve ROADMAP "Demo ↔ backend
geçişi" maddesi ona işaret ediyor.

Bir plan belgesinin en sessiz bozulma biçimi şudur: fark kapanır, belge
kapanmaz. Sonraki katkıcı kapalı bir farkı kapatmaya oturur. Ya da tersi:
şemaya yeni bir alan girer, belgede karşılığı yoktur, ve "eksik alanlar"
listesi artık eksiktir.

Bu dosya belgeyi çalıştırılabilir hâle getiriyor. `PlaceListItem` alanları
backend kaynağından AST ile, `Place` alanları frontend'in tip dosyasından
okunuyor; ikisinin farkı belgede yazan farkla karşılaştırılıyor. Bir fark
kapandığında bu test kırmızı yanar — ve doğrusu budur: kapanan farkın
belgeden de silinmesi gerekiyor.

Veritabanı gerektirmez, hiçbir şey import etmez, yalnızca kaynağı okur.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

KOK = Path(__file__).resolve().parents[2]
SEMA = KOK / "backend" / "app" / "schemas" / "place.py"
TIPLER = KOK / "frontend" / "src" / "lib" / "types.ts"
BELGE = KOK / "docs" / "api-sozlesme-farklari.md"


# --------------------------------------------------------------------------
# okuma
# --------------------------------------------------------------------------


def pydantic_alanlari(yol: Path, sinif: str) -> set[str]:
    """Bir Pydantic modelinin alan adları, kaynaktan - import etmeden.

    Import etmek SQLAlchemy'yi, geoalchemy2'yi ve dolaylı olarak bir
    veritabanı sürücüsünü getirirdi; bu testin onların hiçbirine ihtiyacı
    yok ve olmamalı.
    """
    agac = ast.parse(yol.read_text(encoding="utf-8"))
    for dugum in ast.walk(agac):
        if isinstance(dugum, ast.ClassDef) and dugum.name == sinif:
            alanlar = set()
            for govde in dugum.body:
                if isinstance(govde, ast.AnnAssign) and isinstance(govde.target, ast.Name):
                    ad = govde.target.id
                    if not ad.startswith("_") and ad != "model_config":
                        alanlar.add(ad)
            return alanlar
    raise AssertionError("%s icinde %s sinifi yok" % (yol.name, sinif))


def ts_arayuz_alanlari(yol: Path, arayuz: str) -> set[str]:
    """Bir TypeScript arayüzünün alan adları.

    Yorumlar ve iç içe objeler atlanıyor; burada gereken şey tip değil,
    alan adlarının kümesi.
    """
    metin = yol.read_text(encoding="utf-8")
    m = re.search(r"export interface %s\s*\{" % re.escape(arayuz), metin)
    assert m, "%s icinde %s arayuzu yok" % (yol.name, arayuz)
    i = m.end()
    derinlik = 1
    govde = []
    while i < len(metin) and derinlik:
        c = metin[i]
        if c == "{":
            derinlik += 1
        elif c == "}":
            derinlik -= 1
            if not derinlik:
                break
        govde.append(c)
        i += 1
    ham = "".join(govde)
    ham = re.sub(r"/\*[\s\S]*?\*/", " ", ham)
    ham = re.sub(r"//[^\n]*", " ", ham)
    # Yalnizca en ust seviyedeki alanlar: ic ice obje govdelerini at.
    duz, derinlik = [], 0
    for c in ham:
        if c == "{":
            derinlik += 1
        elif c == "}":
            derinlik -= 1
        elif derinlik == 0:
            duz.append(c)
    return set(re.findall(r"(?:^|;|\n)\s*([A-Za-z_]\w*)\s*\??\s*:", "".join(duz)))


def belgedeki_eksik_alanlar() -> set[str]:
    """§4 tablosunda *eksik* olduğu yazan alan adları.

    "✓ var" işaretli satırlar sayılmıyor: tablo eksikleri sayarken bir iki
    satırda "bu zaten var" da diyor, ve onları eksik listesine katmak testi
    kendi belgesine karşı yalancı çıkarırdı.
    """
    metin = BELGE.read_text(encoding="utf-8")
    bolum = metin.split("## 4. Liste yanıtında eksik alanlar", 1)
    assert len(bolum) == 2, "belgede '## 4. Liste yanitinda eksik alanlar' yok"
    govde = bolum[1].split("\n## ", 1)[0]
    alanlar: set[str] = set()
    for satir in govde.splitlines():
        if not satir.startswith("|") or satir.startswith("|---"):
            continue
        hucre = [h.strip() for h in satir.strip("|").split("|")]
        if not hucre or hucre[0] in ("Alan", ""):
            continue
        durum = hucre[1] if len(hucre) > 1 else ""
        if durum.startswith("✓"):
            continue
        # `source {slug, name, ...}` gibi hucrelerde bastaki tanimlayici alinir.
        for span in re.findall(r"`([^`]+)`", hucre[0]):
            m = re.match(r"([a-z_][a-z0-9_]*)", span)
            if m:
                alanlar.add(m.group(1))
    assert alanlar, "§4 tablosundan hic alan adi cikmadi"
    return alanlar


# --------------------------------------------------------------------------
# okumanin kendisi calisiyor mu
# --------------------------------------------------------------------------


def test_her_uc_kaynak_da_yerinde():
    for yol in (SEMA, TIPLER, BELGE):
        assert yol.is_file(), "yok: %s" % yol


def test_backend_liste_sekli_okunabiliyor():
    alanlar = pydantic_alanlari(SEMA, "PlaceListItem")
    assert {"id", "name", "lat", "lon", "categories"} <= alanlar
    assert "model_config" not in alanlar


def test_frontend_yer_tipi_okunabiliyor():
    alanlar = ts_arayuz_alanlari(TIPLER, "Place")
    assert {"id", "name", "lat", "lon", "categories", "amenities"} <= alanlar


def test_ts_okuyucusu_ic_ice_obje_alanlarini_almiyor(tmp_path):
    p = tmp_path / "t.ts"
    p.write_text(
        "export interface Place {\n"
        "  id: string;\n"
        "  /** yorum: tuzak: alan gibi */\n"
        "  nested: { gizli: string; ayrica: number };\n"
        "  son: boolean;\n"
        "}\n",
        encoding="utf-8",
    )
    assert ts_arayuz_alanlari(p, "Place") == {"id", "nested", "son"}


def test_belgedeki_tablo_okunabiliyor():
    assert "access" in belgedeki_eksik_alanlar()


# --------------------------------------------------------------------------
# belge ile gercek ayristi mi
# --------------------------------------------------------------------------


def test_belgede_eksik_denen_alanlar_gercekten_eksik():
    """Kapanan bir fark belgede kapalı görünmeye devam edemez."""
    backend = pydantic_alanlari(SEMA, "PlaceListItem")
    hala_eksik_denen = belgedeki_eksik_alanlar()
    kapanmis = sorted(hala_eksik_denen & backend)
    assert not kapanmis, (
        "Bu alanlar PlaceListItem'a eklenmis ama docs/api-sozlesme-farklari.md "
        "hala eksik diyor: %s. Belgeyi guncelleyin." % ", ".join(kapanmis)
    )


def test_frontendin_bekleyip_backendin_hic_vermedigi_alan_belgede_yazili():
    """Şemaya yeni bir boşluk açıldığında plan belgesi sessizce eskimesin.

    Ölçülen şey "listede yok" değil, **hiçbir şemada yok**. Bir alanın
    yalnızca `PlaceDetail`'de olması bilinçli bir tasarım ve belge onu ayrı
    bir satırda zaten anlatıyor; asıl boşluk, frontend'in beklediği ama
    backend'in hiçbir yanıtta üretmediği alandır.
    """
    liste = pydantic_alanlari(SEMA, "PlaceListItem")
    detay = pydantic_alanlari(SEMA, "PlaceDetail")
    frontend = ts_arayuz_alanlari(TIPLER, "Place")
    belgeli = belgedeki_eksik_alanlar()

    # raw_tags liste yanitindan bilerek cikariliyor ve tipin kendisi bunu
    # yorumunda soyluyor; amenities backend'de duz sutunlar olarak yasiyor
    # ve belge bunu §4'te ayri bir satirda anlatiyor.
    muaf = {"raw_tags", "amenities"}

    bosluk = frontend - liste - detay - muaf
    yazilmamis = sorted(bosluk - belgeli)
    assert not yazilmamis, (
        "Frontend bu alanlari bekliyor, backend hicbir semada vermiyor ve "
        "docs/api-sozlesme-farklari.md §4 bunlari saymiyor: %s"
        % ", ".join(yazilmamis)
    )


def test_yalniz_detayda_olan_alanlar_listede_de_yok(monkeypatch=None):
    """Belgenin "Yalnız Detail'de" dediği alanlar hâlâ öyle mi."""
    liste = pydantic_alanlari(SEMA, "PlaceListItem")
    detay = pydantic_alanlari(SEMA, "PlaceDetail")
    for ad in ("opening_hours_raw", "is_24h"):
        assert ad in detay, "%s artik PlaceDetail'de yok" % ad
        assert ad not in liste, (
            "%s artik PlaceListItem'da da var; docs/api-sozlesme-farklari.md "
            "hala 'Yalniz Detail'de' diyor." % ad
        )


def test_amenity_anahtar_farki_belgede_yazildigi_gibi():
    """§4'ün sonundaki iki cümle sayılabilir bir iddia; sayılıyor."""
    metin = BELGE.read_text(encoding="utf-8")
    m = re.search(r"Backend'de olup frontend'de olmayan: (.+)", metin)
    assert m, "belge amenity farkini artik yazmiyor"
    iddia = set(re.findall(r"`([a-z_]+)`", m.group(1)))

    # Frontend tarafi bir birlesim tipi (union), obje degil.
    ts = TIPLER.read_text(encoding="utf-8")
    ma = re.search(r"export type AmenityKey\s*=([\s\S]*?);", ts)
    assert ma, "frontend'de AmenityKey tipi yok"
    fe = set(re.findall(r'"([a-z_]+)"', ma.group(1)))
    assert fe, "AmenityKey'den hic anahtar cikmadi"

    be = pydantic_alanlari(SEMA, "PlaceDetail") | pydantic_alanlari(SEMA, "PlaceListItem")
    # `is_24h` de bir boolean ama amenity degil; belge onu §4'te acilis
    # saatleri satirinda sayiyor, o yuzden amenity farkindan dusuluyor.
    gercek = {
        a for a in (be - fe)
        if a.startswith(("has_", "is_", "near_"))
    } - belgedeki_eksik_alanlar()

    assert iddia == gercek, (
        "belge 'Backend'de olup frontend'de olmayan: %s' diyor, semadan cikan "
        "fark ise '%s'" % (", ".join(sorted(iddia)) or "-", ", ".join(sorted(gercek)) or "-")
    )


def test_belge_ve_yol_haritasi_birbirine_bagli():
    """İki belge birlikte güncellenmeli deniyor; bağ hâlâ duruyor mu."""
    yol = KOK / "ROADMAP.md"
    if not yol.is_file():
        pytest.skip("ROADMAP.md yok")
    assert "api-sozlesme-farklari.md" in yol.read_text(encoding="utf-8")
