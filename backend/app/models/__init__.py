"""SQLAlchemy models. Import order matters for Alembic autogenerate (all
models must be imported somewhere before `Base.metadata` is inspected) -
this module re-exports everything so `import app.models` is enough."""

from app.models.admin_region import AdminRegion, AdminRegionLevel
from app.models.category import Category, PlaceCategory
from app.models.data_source import DataSource, DataSourceType, PlaceSourceRecord
from app.models.place import Place
from app.models.review import PlacePhoto, PlaceReview
from app.models.signal import PlaceReport, PlaceVerification, ReportType
from app.models.user import User

__all__ = [
    "AdminRegion",
    "AdminRegionLevel",
    "Category",
    "PlaceCategory",
    "DataSource",
    "DataSourceType",
    "PlaceSourceRecord",
    "Place",
    "PlacePhoto",
    "PlaceReview",
    "PlaceReport",
    "PlaceVerification",
    "ReportType",
    "User",
]
