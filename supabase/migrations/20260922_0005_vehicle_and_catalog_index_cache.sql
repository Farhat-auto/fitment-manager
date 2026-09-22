-- Durable Fitment Manager runtime caches.
-- shopify_sessions already proved Supabase is the serverless source of truth.
-- These tables hold the Shopify vehicle picker index and catalogue hierarchy so
-- Vercel cold starts read the same shop-scoped snapshot. They are NOT Ocean
-- fitment authority and do not replace public.vehicles / product_fitment.

create table if not exists public.vehicle_index_cache (
  shop_domain text primary key,
  built_at timestamptz not null,
  vehicle_count integer not null default 0,
  vehicles_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_index_cache (
  shop_domain text primary key,
  built_at timestamptz not null,
  categories_json jsonb not null default '[]'::jsonb,
  system_groups_json jsonb not null default '[]'::jsonb,
  subcategories_json jsonb not null default '[]'::jsonb,
  parent_field_probe jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists vehicle_index_cache_set_updated_at on public.vehicle_index_cache;
create trigger vehicle_index_cache_set_updated_at
before update on public.vehicle_index_cache
for each row execute function public.set_updated_at();

drop trigger if exists catalog_index_cache_set_updated_at on public.catalog_index_cache;
create trigger catalog_index_cache_set_updated_at
before update on public.catalog_index_cache
for each row execute function public.set_updated_at();

alter table public.vehicle_index_cache enable row level security;
alter table public.catalog_index_cache enable row level security;
