-- Track Builder 3D: cloud saves. One row per player holding everything the
-- game saves (settings, saved tracks, best laps and ghosts), as key -> value.
--
--   player 'sb:<auth user id>'      web players (an anonymous Supabase sign-in per browser)
--   player 'cg:<CrazyGames userId>' CrazyGames players, written only by the cg-save function
--                                   after it has checked their CrazyGames token

create table if not exists public.saves (
  player text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint saves_player check (player ~ '^(sb|cg):[^[:space:]]{1,128}$'),
  constraint saves_data check (jsonb_typeof(data) = 'object'),
  -- About 2 MB at most (the game sends at most 1.9 MB).
  constraint saves_size check (pg_column_size(data) <= 2000000)
);

alter table public.saves enable row level security;

-- Web players read and write their own row only. (Anonymous sign-ins have the
-- authenticated role.) Nobody can delete rows from the game.
drop policy if exists "own save: read" on public.saves;
drop policy if exists "own save: add" on public.saves;
drop policy if exists "own save: change" on public.saves;
create policy "own save: read" on public.saves
  for select to authenticated using (player = 'sb:' || auth.uid()::text);
create policy "own save: add" on public.saves
  for insert to authenticated with check (player = 'sb:' || auth.uid()::text);
create policy "own save: change" on public.saves
  for update to authenticated using (player = 'sb:' || auth.uid()::text) with check (player = 'sb:' || auth.uid()::text);
-- CrazyGames players' rows: no policy, so only the service role (the cg-save function) can reach them.

-- updated_at is always the server's clock: the newest save wins between devices.
create or replace function public.saves_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists saves_touch on public.saves;
create trigger saves_touch before insert or update on public.saves
  for each row execute function public.saves_touch();
