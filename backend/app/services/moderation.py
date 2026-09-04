"""Where community contributions actually mutate state - the brief is
explicit that none of this should publish automatically. A suggested place
lands as `pending_review` (invisible to public search - see
search.py/PlaceStatus filtering); a report lands `pending` and does NOT
touch the target Place's fields until a moderator (or, for verifications,
enough independent agreement) accepts it; a verification updates
last_verified_at and recomputes the reliability score immediately, since a
verification is inherently lower-risk than a report (it confirms an
existing fact rather than asserting a change) and time-decay already
bounds any single bad-faith verification's damage.
"""

from __future__ import annotations

from datetime import datetime, timezone

from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.category import Category, PlaceCategory
from app.models.data_source import DataSource, DataSourceType, PlaceSourceRecord
from app.models.place import Place, PlaceStatus
from app.models.review import PlacePhoto
from app.models.signal import PlaceReport, PlaceVerification, ReportStatus, ReportType
from app.models.user import User
from app.schemas.place import PlaceSuggestionIn
from app.services.reliability import ReliabilityInputs, compute_reliability_score

_USER_SUBMISSION_SOURCE_SLUG = "user-submission"


def _get_or_create_user_submission_source(db: Session) -> DataSource:
    source = db.execute(select(DataSource).where(DataSource.slug == _USER_SUBMISSION_SOURCE_SLUG)).scalar_one_or_none()
    if source is not None:
        return source
    source = DataSource(
        slug=_USER_SUBMISSION_SOURCE_SLUG,
        name="Kullanıcı Katkısı",
        source_type=DataSourceType.user_submission,
        reliability_weight=0.4,  # lower than an official source until independently verified
    )
    db.add(source)
    db.flush()
    return source


def create_place_suggestion(db: Session, *, payload: PlaceSuggestionIn, categories: list[Category], user: User | None) -> Place:
    point = ST_SetSRID(ST_MakePoint(payload.lon, payload.lat), 4326)
    place = Place(
        name=payload.name,
        description=payload.description,
        location=point,
        address_line=payload.address_line,
        country_code=settings.active_country,
        status=PlaceStatus.pending_review,
        reliability_score=0.3,  # low starting score - unverified, single-source, pending
    )
    db.add(place)
    db.flush()

    for category in categories:
        db.add(PlaceCategory(place_id=place.id, category_id=category.id, is_primary=(category is categories[0])))

    source = _get_or_create_user_submission_source(db)
    db.add(
        PlaceSourceRecord(
            place_id=place.id,
            data_source_id=source.id,
            external_id=str(place.id),
            raw_data={"submitted_by": str(user.id) if user else None, "note": payload.note},
        )
    )
    if user is not None:
        user.contribution_count += 1

    return place


def create_place_report(
    db: Session,
    *,
    place: Place,
    report_type: ReportType,
    field: str | None,
    note: str | None,
    user: User | None,
    device_token_hash: str | None = None,
) -> PlaceReport:
    report = PlaceReport(
        place_id=place.id,
        user_id=user.id if user else None,
        device_token_hash=device_token_hash,
        report_type=report_type,
        field=field,
        note=note,
        status=ReportStatus.pending,
    )
    db.add(report)
    place.last_reported_at = datetime.now(timezone.utc)
    if user is not None:
        user.contribution_count += 1

    _recompute_reliability(db, place)
    return report


def _verification_identity(user: User | None, device_token_hash: str | None) -> str | None:
    """One string per submitter, or None when there is nothing to tell
    submitters apart by. An account outranks a device token: the same
    person logged in on their phone is still one person."""
    if user is not None:
        return f"user:{user.id}"
    if device_token_hash:
        return f"device:{device_token_hash}"
    return None


def create_place_verification(
    db: Session,
    *,
    place: Place,
    field: str,
    confirmed_value: bool,
    user: User | None,
    device_token_hash: str | None = None,
) -> PlaceVerification:
    """Record a "this is still true/false" signal, and apply it to the
    public record only on consensus.

    The previous behavior applied the field immediately, and the audit
    demonstrated the consequence live: 21 unauthenticated requests from one
    shell loop flipped wheelchair_accessible and pumped the reliability
    score. Now a field changes only when at least
    ``settings.verification_consensus`` DISTINCT submitters (accounts or
    anonymous device tokens - see api/deps.py) confirm the same value
    inside the freshness window, and supporters strictly outnumber recent
    contradicters. A verification carrying no identity at all is stored as
    a weak signal but can neither flip a field nor refresh
    last_verified_at - otherwise omitting the header would be the bypass.
    """
    verification = PlaceVerification(
        place_id=place.id,
        user_id=user.id if user else None,
        device_token_hash=device_token_hash,
        field=field,
        confirmed_value=confirmed_value,
    )
    db.add(verification)
    db.flush()

    identity = _verification_identity(user, device_token_hash)
    if identity is not None:
        window_start = datetime.now(timezone.utc) - _stale_window()
        supporters = _distinct_verifier_count(db, place, field, confirmed_value, window_start)
        contradicters = _distinct_verifier_count(db, place, field, not confirmed_value, window_start)
        if (
            supporters >= settings.verification_consensus
            and supporters > contradicters
            and hasattr(place, field)
        ):
            setattr(place, field, confirmed_value)
        place.last_verified_at = datetime.now(timezone.utc)

    if user is not None:
        user.verification_count += 1

    _recompute_reliability(db, place)
    return verification


def _distinct_verifier_count(
    db: Session, place: Place, field: str, confirmed_value: bool, window_start: datetime
) -> int:
    return db.execute(
        select(func.count(func.distinct(_identity_expr())))
        .select_from(PlaceVerification)
        .where(
            PlaceVerification.place_id == place.id,
            PlaceVerification.field == field,
            PlaceVerification.confirmed_value == confirmed_value,
            PlaceVerification.created_at >= window_start,
            _identity_expr().is_not(None),
        )
    ).scalar_one()


def _identity_expr():
    from sqlalchemy import String as SAString
    from sqlalchemy import cast as sa_cast

    return func.coalesce(sa_cast(PlaceVerification.user_id, SAString), PlaceVerification.device_token_hash)


def _recompute_reliability(db: Session, place: Place) -> None:
    now = datetime.now(timezone.utc)
    window_start = now - _stale_window()

    source_weights = list(
        db.execute(
            select(DataSource.reliability_weight)
            .join(PlaceSourceRecord, PlaceSourceRecord.data_source_id == DataSource.id)
            .where(PlaceSourceRecord.place_id == place.id)
        )
        .scalars()
        .all()
    )
    # Distinct submitters, not rows: the same device confirming twenty
    # times is one signal, not twenty - counting rows is how one shell
    # loop pumped a score from 0.5 to 0.85 in the audit. Identity-less
    # verifications contribute nothing here for the same reason.
    recent_verification_count = db.execute(
        select(func.count(func.distinct(_identity_expr())))
        .select_from(PlaceVerification)
        .where(
            PlaceVerification.place_id == place.id,
            PlaceVerification.created_at >= window_start,
            _identity_expr().is_not(None),
        )
    ).scalar_one()
    pending_conflicting_reports = db.execute(
        select(func.count())
        .select_from(PlaceReport)
        .where(PlaceReport.place_id == place.id, PlaceReport.status == ReportStatus.pending)
    ).scalar_one()
    has_photos = (
        db.execute(
            select(func.count())
            .select_from(PlacePhoto)
            .where(PlacePhoto.place_id == place.id, PlacePhoto.is_approved.is_(True))
        ).scalar_one()
        > 0
    )

    place.reliability_score = compute_reliability_score(
        ReliabilityInputs(
            source_weights=source_weights,
            last_verified_at=place.last_verified_at,
            last_reported_at=place.last_reported_at,
            recent_verification_count=recent_verification_count,
            pending_conflicting_reports=pending_conflicting_reports,
            has_photos=has_photos,
            stale_after_days=settings.stale_after_days,
            now=now,
        )
    )


def _stale_window():
    from datetime import timedelta

    return timedelta(days=settings.stale_after_days)
