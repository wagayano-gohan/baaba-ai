-- appointments テーブル: 予定（病院、受け取り、外食など）を保持する。
-- 認証機能は今回のスコープ外のため、RLSは「認証不要・全件許可」のシンプルな構成にする。
-- 認証導入時にはポリシーを見直すこと。

create extension if not exists pgcrypto;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  scheduled_at timestamptz not null,
  location text,
  departure_note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists appointments_scheduled_at_idx on public.appointments (scheduled_at);
create index if not exists appointments_deleted_at_idx on public.appointments (deleted_at);

-- updated_at を更新時に自動でセットする
create or replace function public.set_appointments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_appointments_set_updated_at on public.appointments;
create trigger trg_appointments_set_updated_at
before update on public.appointments
for each row
execute function public.set_appointments_updated_at();

-- RLS: 今回は認証機能なしのため全件許可（後回しにした認証導入時に要見直し）
alter table public.appointments enable row level security;

drop policy if exists "appointments_select_all" on public.appointments;
create policy "appointments_select_all" on public.appointments
  for select using (true);

drop policy if exists "appointments_insert_all" on public.appointments;
create policy "appointments_insert_all" on public.appointments
  for insert with check (true);

drop policy if exists "appointments_update_all" on public.appointments;
create policy "appointments_update_all" on public.appointments
  for update using (true) with check (true);

drop policy if exists "appointments_delete_all" on public.appointments;
create policy "appointments_delete_all" on public.appointments
  for delete using (true);
