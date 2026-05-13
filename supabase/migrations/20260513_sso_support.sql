create extension if not exists pgcrypto;

alter table public.user_profiles
  add column if not exists email text,
  add column if not exists external_id text,
  add column if not exists auth_source text,
  add column if not exists last_seen_at timestamptz default now();

create index if not exists idx_user_profiles_email on public.user_profiles (email);
create index if not exists idx_user_profiles_external_id on public.user_profiles (external_id);

create table if not exists public.sso_identities (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  email text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  last_sign_in_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_sso_identities_provider_external unique (provider, external_id)
);

create index if not exists idx_sso_identities_email on public.sso_identities (email);
create index if not exists idx_sso_identities_user_id on public.sso_identities (user_id);

create table if not exists public.sso_consumed_tokens (
  id uuid primary key default gen_random_uuid(),
  jti text not null unique,
  issuer text not null,
  audience text not null,
  external_id text not null,
  email text not null,
  consumed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sso_consumed_tokens_external_id on public.sso_consumed_tokens (external_id);
create index if not exists idx_sso_consumed_tokens_email on public.sso_consumed_tokens (email);

create or replace function public.set_sso_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sso_identities_updated_at on public.sso_identities;
create trigger trg_sso_identities_updated_at
before update on public.sso_identities
for each row
execute function public.set_sso_updated_at();

alter table public.sso_identities enable row level security;
alter table public.sso_consumed_tokens enable row level security;
