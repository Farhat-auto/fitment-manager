-- Phase 1: Supabase as primary source of truth for fitment.
-- Adds:
--  - public.vehicles: canonical vehicle rows (vehicle_key primary key)
--  - public.product_fitment: product_id (Shopify GID) ↔ vehicle_key join table
--  - public.products_search_cache (optional for later): denormalized vehicle keys per product
--
-- NOTE: This does NOT remove/alter existing tables (public.fitment / public.fitments).

create extension if not exists "pgcrypto";

-- Vehicles table (high volume; intended as SoT, but can start empty and fill over time).
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  vehicle_key text not null,

  make text,
  model text,
  series text,
  year_from integer,
  year_to integer,
  engine text,
  fuel text,
  transmission text,
  body_type text,
  market_region text,
  vehicle_type text,

  -- Optional: Shopify vehicle metaobject GID when synced for “hero” vehicles.
  shopify_gid text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enforce per-shop uniqueness for vehicle_key.
create unique index if not exists vehicles_shop_vehicle_key_unique
  on public.vehicles (shop_domain, vehicle_key);

create index if not exists vehicles_shop_vehicle_key_idx
  on public.vehicles (shop_domain, vehicle_key);

create index if not exists vehicles_shopify_gid_idx
  on public.vehicles (shop_domain, shopify_gid);

-- Optional text search for make/model (later search UI / API).
create index if not exists vehicles_make_model_fts_idx
  on public.vehicles using gin (to_tsvector('english', coalesce(make,'') || ' ' || coalesce(model,'')));

-- Product ↔ Vehicle join table (fitment at scale).
create table if not exists public.product_fitment (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  product_id text not null, -- Shopify Product GID
  vehicle_key text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent duplicates.
create unique index if not exists product_fitment_unique_shop_product_vehicle
  on public.product_fitment (shop_domain, product_id, vehicle_key);

-- Requested indexes.
create index if not exists product_fitment_vehicle_key_idx
  on public.product_fitment (vehicle_key);

create index if not exists product_fitment_product_id_idx
  on public.product_fitment (product_id);

create index if not exists product_fitment_vehicle_key_product_id_idx
  on public.product_fitment (vehicle_key, product_id);

-- Optional denormalized cache table (not required for Phase 1, but included as a placeholder).
create table if not exists public.products_search_cache (
  product_id text primary key,
  shop_domain text not null,
  vehicle_keys_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists products_search_cache_shop_idx
  on public.products_search_cache (shop_domain);

-- updated_at trigger helper (created in older migrations but safe to re-create).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

drop trigger if exists product_fitment_set_updated_at on public.product_fitment;
create trigger product_fitment_set_updated_at
before update on public.product_fitment
for each row execute function public.set_updated_at();

-- RLS enabled; server uses service role key.
alter table public.vehicles enable row level security;
alter table public.product_fitment enable row level security;
alter table public.products_search_cache enable row level security;

