-- BankCore live mock test schema + RLS
-- Safe to run multiple times where possible.

create extension if not exists pgcrypto;

-- =========================
-- 1) Mock tests master table
-- =========================
create table if not exists public.mock_tests (
  id text primary key,
  title text not null,
  exam text not null,
  payload jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mock_tests_exam on public.mock_tests (exam);
create index if not exists idx_mock_tests_active on public.mock_tests (is_active);

-- =========================
-- 2) Attempts table
-- =========================
create table if not exists public.mock_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id text not null references public.mock_tests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  covered jsonb not null default '{}'::jsonb,
  saved_for_review jsonb not null default '{}'::jsonb,
  section_seconds_left jsonb not null default '{}'::jsonb,
  time_spent_seconds integer not null default 0,
  score_total numeric(10,2) not null default 0,
  attempted_total integer not null default 0,
  total_questions integer not null default 0,
  subject_scores jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mock_test_attempts_test_id on public.mock_test_attempts (test_id);
create index if not exists idx_mock_test_attempts_user_id on public.mock_test_attempts (user_id);
create index if not exists idx_mock_test_attempts_submitted_at on public.mock_test_attempts (submitted_at desc);

-- =========================
-- 3) Leaderboard table
-- =========================
create table if not exists public.mock_test_leaderboard (
  id uuid primary key default gen_random_uuid(),
  test_id text not null references public.mock_tests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  score numeric(10,2) not null default 0,
  rank integer not null default 0,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_mock_test_leaderboard_test_user unique (test_id, user_id)
);

create index if not exists idx_mock_test_leaderboard_test_id on public.mock_test_leaderboard (test_id);
create index if not exists idx_mock_test_leaderboard_test_rank on public.mock_test_leaderboard (test_id, rank);
create index if not exists idx_mock_test_leaderboard_test_score on public.mock_test_leaderboard (test_id, score desc);

-- =========================
-- 4) Updated_at trigger util
-- =========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mock_tests_set_updated_at on public.mock_tests;
create trigger trg_mock_tests_set_updated_at
before update on public.mock_tests
for each row
execute function public.set_updated_at();

drop trigger if exists trg_mock_test_attempts_set_updated_at on public.mock_test_attempts;
create trigger trg_mock_test_attempts_set_updated_at
before update on public.mock_test_attempts
for each row
execute function public.set_updated_at();

drop trigger if exists trg_mock_test_leaderboard_set_updated_at on public.mock_test_leaderboard;
create trigger trg_mock_test_leaderboard_set_updated_at
before update on public.mock_test_leaderboard
for each row
execute function public.set_updated_at();

-- ==================================
-- 5) Leaderboard rank recalculation
-- ==================================
create or replace function public.recompute_mock_test_ranks(p_test_id text)
returns void
language plpgsql
as $$
begin
  with ranked as (
    select
      id,
      dense_rank() over (
        partition by test_id
        order by score desc, submitted_at asc, created_at asc
      ) as new_rank
    from public.mock_test_leaderboard
    where test_id = p_test_id
  )
  update public.mock_test_leaderboard l
  set rank = r.new_rank,
      updated_at = now()
  from ranked r
  where l.id = r.id;
end;
$$;

create or replace function public.trg_recompute_mock_test_ranks()
returns trigger
language plpgsql
as $$
declare
  v_test_id text;
begin
  v_test_id := coalesce(new.test_id, old.test_id);
  perform public.recompute_mock_test_ranks(v_test_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_mock_test_leaderboard_recompute_rank_ins on public.mock_test_leaderboard;
create trigger trg_mock_test_leaderboard_recompute_rank_ins
after insert on public.mock_test_leaderboard
for each row
execute function public.trg_recompute_mock_test_ranks();

drop trigger if exists trg_mock_test_leaderboard_recompute_rank_upd on public.mock_test_leaderboard;
create trigger trg_mock_test_leaderboard_recompute_rank_upd
after update of score, submitted_at on public.mock_test_leaderboard
for each row
execute function public.trg_recompute_mock_test_ranks();

drop trigger if exists trg_mock_test_leaderboard_recompute_rank_del on public.mock_test_leaderboard;
create trigger trg_mock_test_leaderboard_recompute_rank_del
after delete on public.mock_test_leaderboard
for each row
execute function public.trg_recompute_mock_test_ranks();

-- ==================================
-- 6) RLS + policies
-- ==================================
alter table public.mock_tests enable row level security;
alter table public.mock_test_attempts enable row level security;
alter table public.mock_test_leaderboard enable row level security;

-- mock_tests: public read, no client writes

drop policy if exists "mock_tests_read_active" on public.mock_tests;
create policy "mock_tests_read_active"
on public.mock_tests
for select
to authenticated, anon
using (is_active = true);

-- attempts: users manage only their own attempts

drop policy if exists "attempts_insert_own" on public.mock_test_attempts;
create policy "attempts_insert_own"
on public.mock_test_attempts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "attempts_select_own" on public.mock_test_attempts;
create policy "attempts_select_own"
on public.mock_test_attempts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "attempts_update_own" on public.mock_test_attempts;
create policy "attempts_update_own"
on public.mock_test_attempts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- leaderboard: everyone can read, authenticated users upsert only their own row

drop policy if exists "leaderboard_read_all" on public.mock_test_leaderboard;
create policy "leaderboard_read_all"
on public.mock_test_leaderboard
for select
to authenticated, anon
using (true);

drop policy if exists "leaderboard_insert_own" on public.mock_test_leaderboard;
create policy "leaderboard_insert_own"
on public.mock_test_leaderboard
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "leaderboard_update_own" on public.mock_test_leaderboard;
create policy "leaderboard_update_own"
on public.mock_test_leaderboard
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- =========================
-- 7) Helpful seed example
-- =========================
-- Insert your mock.json payload into mock_tests.payload.
-- Example:
-- insert into public.mock_tests (id, title, exam, payload, is_active)
-- values ('sbi_po_001', 'SBI PO Mock Test 1', 'SBI PO', '<PASTE_JSON_HERE>'::jsonb, true)
-- on conflict (id) do update
-- set title = excluded.title,
--     exam = excluded.exam,
--     payload = excluded.payload,
--     is_active = excluded.is_active,
--     updated_at = now();
