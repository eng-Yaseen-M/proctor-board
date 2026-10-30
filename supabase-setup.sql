-- نفّذ في Supabase → SQL Editor

-- جدول المسجّلين
create table if not exists public.proctors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.proctors enable row level security;

create policy "Allow insert for anon" on public.proctors
  for insert to anon with check (true);
create policy "Allow select for anon" on public.proctors
  for select to anon using (true);
create policy "Allow update for anon" on public.proctors
  for update to anon using (true);

-- جدول لتتبع آخر نسخة من الجدول (للإشعارات)
create table if not exists public.schedule_meta (
  id int primary key default 1,
  fingerprint text,
  assignment_count int,
  updated_at timestamptz default now()
);

alter table public.schedule_meta enable row level security;

create policy "Allow all for service" on public.schedule_meta
  for all using (true) with check (true);
