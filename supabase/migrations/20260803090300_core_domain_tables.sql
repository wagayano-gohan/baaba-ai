-- Phase1 DBスキーマ: contacts / locations / events / tasks / medication_logs / notes / deliveries
-- 全テーブル共通パターン:
--   - profile_id は public.profiles(id) 参照、on delete cascade
--   - RLS: SELECT は has_category_view_access（owner_adminは常時可、viewerはfamily_access_permissions次第）
--          INSERT/UPDATE/DELETE は has_profile_write_access（owner_adminのみ）
--   - 論理削除は deleted_at で表現（物理削除はしない）

-- =========================================================
-- 7. contacts（連絡先。旧family_members相当を統合）
-- =========================================================
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  relationship text,
  phone_number text,
  email text,
  linked_auth_user_id uuid references auth.users(id) on delete set null,
  is_favorite boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists contacts_profile_id_active_idx
  on public.contacts (profile_id) where deleted_at is null;
create index if not exists contacts_linked_auth_user_id_idx
  on public.contacts (linked_auth_user_id);

drop trigger if exists trg_contacts_set_updated_at on public.contacts;
create trigger trg_contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

alter table public.contacts enable row level security;

drop policy if exists "contacts_select" on public.contacts;
create policy "contacts_select" on public.contacts
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'contacts'));

drop policy if exists "contacts_insert" on public.contacts;
create policy "contacts_insert" on public.contacts
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "contacts_update" on public.contacts;
create policy "contacts_update" on public.contacts
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "contacts_delete" on public.contacts;
create policy "contacts_delete" on public.contacts
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));

-- =========================================================
-- 11. locations（場所。地図・経路案内用）
-- 緯度経度は表示・経路計算精度上、小数第6位程度で保持（weather_cacheの丸め要件とは別）。
-- =========================================================
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null default 'other'
    check (category in ('home', 'hospital', 'store', 'family', 'other')),
  address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists locations_profile_id_active_idx
  on public.locations (profile_id) where deleted_at is null;

drop trigger if exists trg_locations_set_updated_at on public.locations;
create trigger trg_locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

alter table public.locations enable row level security;

drop policy if exists "locations_select" on public.locations;
create policy "locations_select" on public.locations
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'locations'));

drop policy if exists "locations_insert" on public.locations;
create policy "locations_insert" on public.locations
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "locations_update" on public.locations;
create policy "locations_update" on public.locations
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "locations_delete" on public.locations;
create policy "locations_delete" on public.locations
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));

-- =========================================================
-- 8. events（予定）
-- =========================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'other'
    check (category in ('hospital', 'pickup', 'meal', 'visit', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location_id uuid references public.locations(id) on delete set null,
  location_text text,
  departure_note text,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_ends_after_starts check (ends_at is null or ends_at >= starts_at)
);

create index if not exists events_profile_starts_at_idx
  on public.events (profile_id, starts_at) where deleted_at is null;
create index if not exists events_profile_status_idx
  on public.events (profile_id, status) where deleted_at is null;
create index if not exists events_location_id_idx on public.events (location_id);

drop trigger if exists trg_events_set_updated_at on public.events;
create trigger trg_events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

alter table public.events enable row level security;

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'events'));

drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "events_update" on public.events;
create policy "events_update" on public.events
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "events_delete" on public.events;
create policy "events_delete" on public.events
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));

-- =========================================================
-- 9. tasks（タスク・買い物リスト等）
-- =========================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'other'
    check (category in ('shopping', 'errand', 'other')),
  due_at timestamptz,
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),
  completed_at timestamptz,
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists tasks_profile_status_idx
  on public.tasks (profile_id, status) where deleted_at is null;
create index if not exists tasks_profile_due_at_idx
  on public.tasks (profile_id, due_at) where deleted_at is null;

drop trigger if exists trg_tasks_set_updated_at on public.tasks;
create trigger trg_tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'tasks'));

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));

-- =========================================================
-- 10. medication_logs（服薬記録・リマインド）
-- =========================================================
create table if not exists public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  medication_name text not null,
  dosage text,
  scheduled_at timestamptz not null,
  taken_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'taken', 'skipped', 'missed')),
  reminder_sent_at timestamptz,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists medication_logs_profile_scheduled_at_idx
  on public.medication_logs (profile_id, scheduled_at) where deleted_at is null;
create index if not exists medication_logs_profile_status_idx
  on public.medication_logs (profile_id, status) where deleted_at is null;

drop trigger if exists trg_medication_logs_set_updated_at on public.medication_logs;
create trigger trg_medication_logs_set_updated_at
before update on public.medication_logs
for each row execute function public.set_updated_at();

alter table public.medication_logs enable row level security;

drop policy if exists "medication_logs_select" on public.medication_logs;
create policy "medication_logs_select" on public.medication_logs
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'medication_logs'));

drop policy if exists "medication_logs_insert" on public.medication_logs;
create policy "medication_logs_insert" on public.medication_logs
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "medication_logs_update" on public.medication_logs;
create policy "medication_logs_update" on public.medication_logs
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "medication_logs_delete" on public.medication_logs;
create policy "medication_logs_delete" on public.medication_logs
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));

-- =========================================================
-- 12. notes（メモ）
-- image_path はクライアントから直接書き込み禁止。confirm-note-upload Edge Function
-- （service role）のみが更新できる。RLSは行単位のみのため、カラム単位の権限は
-- REVOKE/GRANT (column privileges) で別途制御する。
-- =========================================================
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  body text,
  image_path text,
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notes_profile_id_active_idx
  on public.notes (profile_id) where deleted_at is null;

drop trigger if exists trg_notes_set_updated_at on public.notes;
create trigger trg_notes_set_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

alter table public.notes enable row level security;

drop policy if exists "notes_select" on public.notes;
create policy "notes_select" on public.notes
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'notes'));

drop policy if exists "notes_insert" on public.notes;
create policy "notes_insert" on public.notes
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "notes_update" on public.notes;
create policy "notes_update" on public.notes
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "notes_delete" on public.notes;
create policy "notes_delete" on public.notes
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));

-- カラム権限: authenticated ロールの INSERT/UPDATE から image_path を除外する。
-- (SELECTは行単位のRLSのみで制御。画像URLの表示自体は許可する。)
revoke insert, update on public.notes from authenticated;
grant insert (profile_id, title, body, created_by_auth_user_id) on public.notes to authenticated;
grant update (title, body, deleted_at) on public.notes to authenticated;
-- service_role は notes に対する全カラムの権限を保持したまま（REVOKE対象外）。
-- confirm-note-upload はservice_role接続でimage_pathを更新する。

-- =========================================================
-- 13. deliveries（配達物追跡）
-- =========================================================
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_name text,
  carrier text,
  tracking_number text,
  status text not null default 'in_transit'
    check (status in ('in_transit', 'out_for_delivery', 'delivered', 'delayed', 'unknown')),
  expected_at timestamptz,
  delivered_at timestamptz,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists deliveries_profile_status_idx
  on public.deliveries (profile_id, status) where deleted_at is null;
create index if not exists deliveries_profile_expected_at_idx
  on public.deliveries (profile_id, expected_at) where deleted_at is null;

drop trigger if exists trg_deliveries_set_updated_at on public.deliveries;
create trigger trg_deliveries_set_updated_at
before update on public.deliveries
for each row execute function public.set_updated_at();

alter table public.deliveries enable row level security;

drop policy if exists "deliveries_select" on public.deliveries;
create policy "deliveries_select" on public.deliveries
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'deliveries'));

drop policy if exists "deliveries_insert" on public.deliveries;
create policy "deliveries_insert" on public.deliveries
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "deliveries_update" on public.deliveries;
create policy "deliveries_update" on public.deliveries
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "deliveries_delete" on public.deliveries;
create policy "deliveries_delete" on public.deliveries
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));
