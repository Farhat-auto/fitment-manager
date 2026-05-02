create table if not exists public.shopify_sessions (
  id text primary key,
  shop text not null,
  is_online boolean not null default false,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopify_sessions_shop_idx on public.shopify_sessions (shop);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shopify_sessions_set_updated_at on public.shopify_sessions;
create trigger shopify_sessions_set_updated_at
before update on public.shopify_sessions
for each row execute function public.set_updated_at();

