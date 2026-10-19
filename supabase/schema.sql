-- =========================================================
-- BEES — Supabase database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.
--
-- How it keeps the leaderboard honest:
-- 1. The browser can READ the leaderboard but can never write to any
--    table directly (row level security + revoked privileges).
-- 2. The only way in is through three functions:
--      start_run()             → a new game begins, returns a run id
--      record_catch(run_id)    → the server adds 1 honey to ITS OWN count
--      finish_run(run_id, name)→ the server writes ITS count to the board
--    The game never sends a score, so there is no number to fake.
-- 3. The functions reject impossible play: catches too close together,
--    runs older than 2 hours, and finishing the same run twice.
-- 4. The leaderboard resets every day at midnight UTC. Old scores are kept
--    in the table; todays_leaderboard() simply only returns today's.
-- =========================================================


-- ---------- 1. TABLES ----------

-- One row per game played. Only the functions below can touch it.
create table if not exists public.runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  last_catch_at timestamptz,
  honey         integer not null default 0 check (honey >= 0),
  finished      boolean not null default false
);

-- The public leaderboard. Rows are only ever created by finish_run().
create table if not exists public.leaderboard (
  id         bigint generated always as identity primary key,
  run_id     uuid not null unique references public.runs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 16),
  honey      integer not null check (honey > 0),
  level      integer not null check (level >= 1),
  created_at timestamptz not null default now()
);

-- Makes "top 10" and "today only" queries fast
create index if not exists leaderboard_rank_idx
  on public.leaderboard (honey desc, level desc, created_at asc);
create index if not exists leaderboard_created_idx
  on public.leaderboard (created_at);


-- ---------- 2. LOCK THE TABLES DOWN ----------

alter table public.runs enable row level security;
alter table public.leaderboard enable row level security;

-- Nobody using the public key may write to either table, or read runs at all
revoke all on public.runs from anon, authenticated;
revoke all on public.leaderboard from anon, authenticated;

-- Everyone may read these leaderboard columns (run_id stays private)
grant select (id, name, honey, level, created_at) on public.leaderboard to anon, authenticated;

drop policy if exists "Anyone can read the leaderboard" on public.leaderboard;
create policy "Anyone can read the leaderboard"
  on public.leaderboard
  for select
  to anon, authenticated
  using (true);


-- ---------- 3. HELPERS ----------

-- Work out the level from total honey, using the same rule as the game:
-- level 1 needs 5 bees, then each level needs 2 more (5, 7, 9, ...).
-- Reaching level L takes (L - 1) * (L + 3) honey, so L = floor(sqrt(honey + 4)) - 1.
create or replace function public.level_for_honey(p_honey integer)
returns integer
language sql
immutable
as $$
  select greatest(1, floor(sqrt(greatest(p_honey, 0) + 4))::integer - 1);
$$;


-- ---------- 4. GAME FUNCTIONS (the only way to write data) ----------
-- "security definer" lets these functions write to the locked tables
-- on the player's behalf, but only in the ways written here.

-- A new game starts: create a run and hand back its id
create or replace function public.start_run()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into runs default values returning id into new_id;
  return new_id;
end;
$$;


-- A bee was caught: the server adds 1 to its own honey count for this run
create or replace function public.record_catch(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r runs%rowtype;
begin
  -- Lock the row so two quick requests can't both count
  select * into r from runs where id = p_run_id for update;

  if not found then
    raise exception 'Unknown run';
  end if;
  if r.finished then
    raise exception 'This run is already finished';
  end if;
  if now() - r.started_at > interval '2 hours' then
    raise exception 'This run has expired';
  end if;

  -- Faster than a human can click: ignore this catch
  if r.last_catch_at is not null and now() - r.last_catch_at < interval '400 milliseconds' then
    return r.honey;
  end if;

  update runs
     set honey = honey + 1,
         last_catch_at = now()
   where id = p_run_id
  returning honey into r.honey;

  return r.honey;
end;
$$;


-- The game ended: close the run and put the server's score on the board
create or replace function public.finish_run(p_run_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r runs%rowtype;
  clean_name text;
begin
  select * into r from runs where id = p_run_id for update;

  if not found then
    raise exception 'Unknown run';
  end if;
  if r.finished then
    raise exception 'This run is already finished';
  end if;

  update runs set finished = true where id = p_run_id;

  -- No honey, no leaderboard entry
  if r.honey <= 0 then
    return;
  end if;

  -- Tidy the name: trim, squash spaces, max 16 characters
  clean_name := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 16);
  if clean_name = '' then
    clean_name := 'Anonymous Bee';
  end if;

  insert into leaderboard (run_id, name, honey, level)
  values (p_run_id, clean_name, r.honey, level_for_honey(r.honey));
end;
$$;


-- Today's top 10. "Today" starts at midnight UTC, so the board resets daily.
create or replace function public.todays_leaderboard()
returns table (id bigint, name text, honey integer, level integer, created_at timestamptz)
language sql
stable
set search_path = public
as $$
  select l.id, l.name, l.honey, l.level, l.created_at
    from leaderboard l
   where l.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
   order by l.honey desc, l.level desc, l.created_at asc
   limit 10;
$$;


-- ---------- 5. WHO MAY CALL WHAT ----------

-- Only the game functions can be called from the browser
revoke execute on function public.start_run() from public;
revoke execute on function public.record_catch(uuid) from public;
revoke execute on function public.finish_run(uuid, text) from public;
revoke execute on function public.todays_leaderboard() from public;

grant execute on function public.start_run() to anon, authenticated;
grant execute on function public.record_catch(uuid) to anon, authenticated;
grant execute on function public.finish_run(uuid, text) to anon, authenticated;
grant execute on function public.todays_leaderboard() to anon, authenticated;


-- ---------- 6. HOUSEKEEPING (optional, run by hand when you like) ----------
-- Old days' scores stay in the table but never show on the board.
-- To clear out everything before today:
--
--   delete from public.leaderboard
--    where created_at < date_trunc('day', now() at time zone 'utc') at time zone 'utc';
--
-- Unfinished runs pile up when people close the tab mid-game.
-- This removes old ones that never reached the leaderboard:
--
--   delete from public.runs
--    where started_at < now() - interval '1 day'
--      and id not in (select run_id from public.leaderboard);
--
-- To remove a suspicious score:
--
--   delete from public.leaderboard where id = <the row id>;
