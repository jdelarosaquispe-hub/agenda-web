create table if not exists public.agenda_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#44d7a8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists agenda_categories_user_name_idx
  on public.agenda_categories (user_id, lower(name));

create table if not exists public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null default 'Nota',
  event_time time not null default '09:00',
  category text not null default 'Sin categoria',
  category_id uuid references public.agenda_categories(id) on delete set null,
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
  add column if not exists category text not null default 'Sin categoria';

alter table public.agenda_events
  alter column category set default 'Sin categoria';

alter table public.agenda_events
  add column if not exists category_id uuid;

alter table public.agenda_events
  add column if not exists has_reminder boolean not null default false;

alter table public.agenda_events
  add column if not exists reminder_at timestamptz;

alter table public.agenda_events
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.agenda_events
  drop constraint if exists agenda_events_category_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agenda_events_category_id_fkey'
      and conrelid = 'public.agenda_events'::regclass
  ) then
    alter table public.agenda_events
      add constraint agenda_events_category_id_fkey
      foreign key (category_id)
      references public.agenda_categories(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists agenda_events_user_date_idx
  on public.agenda_events (user_id, date, event_time);

insert into public.agenda_categories (user_id, name, color)
select distinct on (legacy.user_id, lower(legacy.name))
  legacy.user_id,
  legacy.name,
  case legacy.name
    when 'Trabajo' then '#7dd3fc'
    when 'Personal' then '#ffd166'
    when 'Estudio' then '#c4b5fd'
    when 'Salud' then '#86efac'
    else '#44d7a8'
  end as color
from (
  select distinct user_id, trim(category) as name
  from public.agenda_events
  where coalesce(trim(category), '') <> ''
    and trim(category) <> 'Sin categoria'
) as legacy
where not exists (
  select 1
  from public.agenda_categories existing
  where existing.user_id = legacy.user_id
    and lower(existing.name) = lower(legacy.name)
)
order by legacy.user_id, lower(legacy.name), legacy.name;

update public.agenda_events events
set category_id = categories.id
from public.agenda_categories categories
where events.category_id is null
  and categories.user_id = events.user_id
  and lower(categories.name) = lower(trim(events.category))
  and coalesce(trim(events.category), '') <> ''
  and trim(events.category) <> 'Sin categoria';

alter table public.agenda_categories enable row level security;
alter table public.agenda_events enable row level security;

drop policy if exists "Users can read own agenda categories" on public.agenda_categories;
create policy "Users can read own agenda categories"
  on public.agenda_categories
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own agenda categories" on public.agenda_categories;
create policy "Users can insert own agenda categories"
  on public.agenda_categories
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own agenda categories" on public.agenda_categories;
create policy "Users can update own agenda categories"
  on public.agenda_categories
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own agenda categories" on public.agenda_categories;
create policy "Users can delete own agenda categories"
  on public.agenda_categories
  for delete
  to authenticated
  using (auth.uid() = user_id);

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

drop trigger if exists set_agenda_categories_updated_at on public.agenda_categories;
create trigger set_agenda_categories_updated_at
  before update on public.agenda_categories
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_agenda_events_updated_at on public.agenda_events;
create trigger set_agenda_events_updated_at
  before update on public.agenda_events
  for each row
  execute function public.set_updated_at();
