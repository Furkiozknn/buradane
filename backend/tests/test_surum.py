"""API'nin /openapi.json'da bildirdigi surum paket surumuyle ayni mi.

FastAPI(version=...) elle yaziliyordu ve paket 1.0.0'a cikarken 0.1.0'da
kalmisti; /docs sayfasi ve istemci ureticileri yanlis surumu gosteriyordu.
"""
import tomllib
from pathlib import Path

from app.main import app


def test_api_surumu_paket_surumuyle_ayni():
    pyproject = tomllib.loads((Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(encoding="utf-8"))
    assert app.version == pyproject["project"]["version"]
