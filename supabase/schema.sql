create table if not exists public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null default 'Nota',
  event_time time not null default '09:00',
  category text not null check (category in ('Trabajo', 'Personal', 'Estudio', 'Salud')),
  notes text not null default '',
  done boolean not null default false,
  has_reminder boolean not null default false,
  reminder_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.agenda_events
  add column if not exists title text not null default 'Nota';

alter table public.agenda_events
  add column if not exists has_reminder boolean not null default false;

alter table public.agenda_events
  add column if not exists reminder_at timestamptz;

alter table public.agenda_events
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists agenda_events_user_date_idx
  on public.agenda_events (user_id, date, event_time);

alter table public.agenda_events enable row level security;

drop policy if exists "Users can read own agenda events" on public.agenda_events;
create policy "Users can read own agenda events"
  on public.agenda_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own agenda events" on public.agenda_events;
create policy "Users can insert own agenda events"
  on public.agenda_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own agenda events" on public.agenda_events;
create policy "Users can update own agenda events"
  on public.agenda_events
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own agenda events" on public.agenda_events;
create policy "Users can delete own agenda events"
  on public.agenda_events
  for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_agenda_events_updated_at on public.agenda_events;
create trigger set_agenda_events_updated_at
  before update on public.agenda_events
  for each row
  execute function public.set_updated_at();
