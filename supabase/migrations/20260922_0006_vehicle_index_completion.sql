-- Refresh completion metadata for public.vehicle_index_cache.
-- Incomplete/throttled Shopify walks must not replace a complete snapshot.

alter table public.vehicle_index_cache
  add column if not exists complete boolean not null default false,
  add column if not exists page_count integer not null default 0,
  add column if not exists source_has_next_page boolean not null default false,
  add column if not exists schema_version text not null default 'vehicle-index-v2',
  add column if not exists last_error text;

comment on column public.vehicle_index_cache.complete is
  'True only when Shopify vehicle pagination reached hasNextPage=false.';
