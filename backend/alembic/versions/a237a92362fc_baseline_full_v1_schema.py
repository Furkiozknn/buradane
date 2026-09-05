"""baseline: full v1 schema

Revision ID: a237a92362fc
Revises: 
Create Date: 2026-09-05 01:30:19.657986

"""
from __future__ import annotations

from typing import Sequence, Union

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'a237a92362fc'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Hand-adjusted after autogenerate: PostGIS extension guard added;
    # the spurious drop of PostGIS's own spatial_ref_sys removed (env.py
    # now excludes it from comparison); GeoAlchemy2's implicit duplicate
    # spatial index removed (see models/place.py spatial_index=False).
    # Creating the extension needs sufficient privileges; on managed
    # Postgres enable PostGIS through the provider first, and this
    # statement then no-ops.
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table('admin_regions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('country_code', sa.String(length=2), nullable=False),
    sa.Column('level', sa.Enum('country', 'province', 'district', 'municipality', 'neighborhood', 'village', name='adminregionlevel'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('external_id', sa.String(length=64), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('population', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['parent_id'], ['admin_regions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_admin_regions_country_level', 'admin_regions', ['country_code', 'level'], unique=False)
    op.create_index('ix_admin_regions_external', 'admin_regions', ['country_code', 'level', 'external_id'], unique=False)
    op.create_index('ix_admin_regions_parent', 'admin_regions', ['parent_id'], unique=False)
    op.create_table('categories',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('name_tr', sa.String(length=120), nullable=False),
    sa.Column('name_en', sa.String(length=120), nullable=False),
    sa.Column('icon', sa.String(length=40), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('osm_tag_mappings', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['parent_id'], ['categories.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('data_sources',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('source_type', sa.Enum('openstreetmap', 'municipality_ckan', 'government_other', 'user_submission', 'manual_curation', name='datasourcetype'), nullable=False),
    sa.Column('license', sa.String(length=200), nullable=True),
    sa.Column('license_url', sa.String(length=500), nullable=True),
    sa.Column('homepage_url', sa.String(length=500), nullable=True),
    sa.Column('api_url', sa.String(length=500), nullable=True),
    sa.Column('reliability_weight', sa.Float(), nullable=False),
    sa.Column('last_synced_at', sa.DateTime(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('hashed_password', sa.String(length=200), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=True),
    sa.Column('contribution_count', sa.Integer(), nullable=False),
    sa.Column('verification_count', sa.Integer(), nullable=False),
    sa.Column('trust_weight', sa.Float(), nullable=False),
    sa.Column('is_admin', sa.Boolean(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('places',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('location', geoalchemy2.types.Geography(geometry_type='POINT', srid=4326, dimension=2, from_text='ST_GeogFromText', name='geography', nullable=False, spatial_index=False), nullable=False),
    sa.Column('address_line', sa.String(length=400), nullable=True),
    sa.Column('country_code', sa.String(length=2), nullable=False),
    sa.Column('admin_region_id', sa.UUID(), nullable=True),
    sa.Column('website', sa.String(length=500), nullable=True),
    sa.Column('phone', sa.String(length=40), nullable=True),
    sa.Column('opening_hours_raw', sa.String(length=300), nullable=True),
    sa.Column('is_24h', sa.Boolean(), nullable=True),
    sa.Column('price_type', sa.Enum('free', 'paid', 'unknown', name='pricetype'), nullable=False),
    sa.Column('price_note', sa.String(length=300), nullable=True),
    sa.Column('wheelchair_accessible', sa.Boolean(), nullable=True),
    sa.Column('has_ramp', sa.Boolean(), nullable=True),
    sa.Column('has_elevator', sa.Boolean(), nullable=True),
    sa.Column('baby_changing', sa.Boolean(), nullable=True),
    sa.Column('child_friendly', sa.Boolean(), nullable=True),
    sa.Column('pet_friendly', sa.Boolean(), nullable=True),
    sa.Column('has_drinking_water', sa.Boolean(), nullable=True),
    sa.Column('has_wifi', sa.Boolean(), nullable=True),
    sa.Column('has_shower', sa.Boolean(), nullable=True),
    sa.Column('has_seating', sa.Boolean(), nullable=True),
    sa.Column('has_shade', sa.Boolean(), nullable=True),
    sa.Column('has_parking', sa.Boolean(), nullable=True),
    sa.Column('near_public_transport', sa.Boolean(), nullable=True),
    sa.Column('is_quiet', sa.Boolean(), nullable=True),
    sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.Enum('active', 'temporarily_closed', 'permanently_closed', 'pending_review', name='placestatus'), nullable=False),
    sa.Column('last_verified_at', sa.DateTime(), nullable=True),
    sa.Column('last_reported_at', sa.DateTime(), nullable=True),
    sa.Column('reliability_score', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['admin_region_id'], ['admin_regions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_places_admin_region', 'places', ['admin_region_id'], unique=False)
    op.create_index('ix_places_country_status', 'places', ['country_code', 'status'], unique=False)
    op.create_index('ix_places_location', 'places', ['location'], unique=False, postgresql_using='gist')
    op.create_index('ix_places_location_geom', 'places', [sa.literal_column('CAST(location AS geometry(POINT,4326))')], unique=False, postgresql_using='gist')
    op.create_table('place_categories',
    sa.Column('place_id', sa.UUID(), nullable=False),
    sa.Column('category_id', sa.UUID(), nullable=False),
    sa.Column('is_primary', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['place_id'], ['places.id'], ),
    sa.PrimaryKeyConstraint('place_id', 'category_id')
    )
    op.create_table('place_photos',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('place_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('storage_url', sa.String(length=500), nullable=False),
    sa.Column('caption', sa.String(length=300), nullable=True),
    sa.Column('is_approved', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['place_id'], ['places.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('place_reports',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('place_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('device_token_hash', sa.String(length=64), nullable=True),
    sa.Column('report_type', sa.Enum('closed', 'reopened', 'broken_amenity', 'under_maintenance', 'overcrowded', 'incorrect_location', 'incorrect_info', 'other', name='reporttype'), nullable=False),
    sa.Column('field', sa.String(length=80), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('status', sa.Enum('pending', 'accepted', 'rejected', name='reportstatus'), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['place_id'], ['places.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('place_reviews',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('place_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('rating', sa.Integer(), nullable=False),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('cleanliness_rating', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('cleanliness_rating IS NULL OR (cleanliness_rating >= 1 AND cleanliness_rating <= 5)', name='ck_place_reviews_cleanliness_range'),
    sa.CheckConstraint('rating >= 1 AND rating <= 5', name='ck_place_reviews_rating_range'),
    sa.ForeignKeyConstraint(['place_id'], ['places.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('place_source_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('place_id', sa.UUID(), nullable=False),
    sa.Column('data_source_id', sa.UUID(), nullable=False),
    sa.Column('external_id', sa.String(length=200), nullable=False),
    sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('fetched_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['data_source_id'], ['data_sources.id'], ),
    sa.ForeignKeyConstraint(['place_id'], ['places.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('place_verifications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('place_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('device_token_hash', sa.String(length=64), nullable=True),
    sa.Column('field', sa.String(length=80), nullable=False),
    sa.Column('confirmed_value', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['place_id'], ['places.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_place_verifications_place_field', 'place_verifications', ['place_id', 'field'], unique=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    # The postgis extension is deliberately NOT dropped on downgrade -
    # other schemas/databases in the same cluster may use it.
    op.drop_index('ix_place_verifications_place_field', table_name='place_verifications')
    op.drop_table('place_verifications')
    op.drop_table('place_source_records')
    op.drop_table('place_reviews')
    op.drop_table('place_reports')
    op.drop_table('place_photos')
    op.drop_table('place_categories')
    op.drop_index('ix_places_location_geom', table_name='places', postgresql_using='gist')
    op.drop_index('ix_places_location', table_name='places', postgresql_using='gist')
    op.drop_index('ix_places_country_status', table_name='places')
    op.drop_index('ix_places_admin_region', table_name='places')
    op.drop_table('places')
    op.drop_table('users')
    op.drop_table('data_sources')
    op.drop_table('categories')
    op.drop_index('ix_admin_regions_parent', table_name='admin_regions')
    op.drop_index('ix_admin_regions_external', table_name='admin_regions')
    op.drop_index('ix_admin_regions_country_level', table_name='admin_regions')
    op.drop_table('admin_regions')
    # sa.Enum columns auto-create their Postgres enum TYPEs on upgrade, but
    # drop_table does NOT drop the types - without this, downgrade leaves six
    # orphaned enums and a second upgrade dies on DuplicateObject (found by
    # actually running upgrade -> downgrade -> upgrade; the first review
    # only ran the cycle one way).
    for enum_name in (
        'reportstatus', 'reporttype', 'placestatus', 'pricetype',
        'datasourcetype', 'adminregionlevel',
    ):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
    # ### end Alembic commands ###
