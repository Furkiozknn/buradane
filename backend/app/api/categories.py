from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DbSession
from app.models.category import Category
from app.schemas.place import CategoryOut

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(db: DbSession) -> list[CategoryOut]:
    categories = db.execute(select(Category).where(Category.is_active.is_(True)).order_by(Category.name_tr)).scalars().all()
    return [CategoryOut.model_validate(c) for c in categories]
