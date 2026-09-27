-- Pinewoods CRM database. Paste into Supabase → SQL Editor → Run.

create table if not exists bookings (
  id                bigint generated always as identity primary key,
  cabin             text not null check (cabin in ('summit','sunset','sunrise1','sunrise2')),
  stay_date         date not null,
  client_name       text not null,
  phone             text default '',
  persons           int,
  total             numeric(12,2) not null default 0,
  down_payment      numeric(12,2) not null default 0,
  commission        numeric(12,2) not null default 0,
  complimentary     boolean not null default false,
  balance_collected boolean not null default false,
  commission_paid   boolean not null default false,
  notes             text default '',
  created_by        text default (auth.jwt() ->> 'email'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- one booking per cabin per night: this is what stops double bookings
  unique (cabin, stay_date)
);

create table if not exists expenses (
  id           bigint generated always as identity primary key,
  spent_on     date not null,
  -- '' = shared across the whole resort, otherwise the cabin this cost belongs to
  cabin        text not null default '' check (cabin in ('','summit','sunset','sunrise1','sunrise2')),
  category     text not null,
  sub_category text default '',
  amount       numeric(12,2) not null check (amount >= 0),
  notes        text default '',
  created_by   text default (auth.jwt() ->> 'email'),
  created_at   timestamptz not null default now()
);

create index if not exists bookings_date_idx on bookings (stay_date);
create index if not exists expenses_date_idx on expenses (spent_on);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists bookings_touch on bookings;
create trigger bookings_touch before update on bookings
  for each row execute function touch_updated_at();

-- Only signed-in team members can read or write. Turn OFF public sign-ups in
-- Authentication → Providers → Email, then invite each person from Authentication → Users.
alter table bookings enable row level security;
alter table expenses enable row level security;

drop policy if exists "team full access" on bookings;
create policy "team full access" on bookings
  for all to authenticated using (true) with check (true);

drop policy if exists "team full access" on expenses;
create policy "team full access" on expenses
  for all to authenticated using (true) with check (true);

-- Let signed-in team members use the tables through the app (row security above still applies).
grant select, insert, update, delete on bookings, expenses to authenticated;

-- Live updates so everyone's calendar refreshes when someone books.
alter publication supabase_realtime add table bookings, expenses;
