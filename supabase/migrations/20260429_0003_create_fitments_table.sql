create extension if not exists "pgcrypto";

create table if not exists public.fitments (
  id uuid primary key default gen_random_uuid(),
  shop text not null,
  product_id text not null,
  product_title text,
  make text not null,
  model text not null,
  year_from integer,
  year_to integer,
  engine text,
  variant text,
  body_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fitments_product_id_idx
on public.fitments (product_id);

create index if not exists fitments_shop_idx
on public.fitments (shop);

drop trigger if exists fitments_set_updated_at on public.fitments;
create trigger fitments_set_updated_at
before update on public.fitments
for each row execute function public.set_updated_at();

