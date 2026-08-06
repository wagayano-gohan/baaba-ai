-- Phase1 DBスキーマ: profiles / profile_memberships / profile_invitations / family_access_permissions
-- + アクセス権判定用の共有ヘルパー関数（SECURITY DEFINERでRLS再帰を回避）
--
-- 注意: LANGUAGE sql の関数はCREATE FUNCTION時に本文がパース解析され、参照するテーブルが
-- 実在している必要がある（plpgsqlと異なり遅延解決されない）。そのため本ファイルでは
-- 「テーブルを先にすべて作成 → その後に共有ヘルパー関数 → 最後にポリシー」の順で構成する。

-- =========================================================
-- 1. profiles
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  full_name_kana text,
  birth_date date,
  phone_number text,
  postal_code text,
  address text,
  timezone text not null default 'Asia/Tokyo',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- =========================================================
-- 3. profile_memberships（auth_user_id と profile_id の多対多。role: owner_admin/viewer）
-- =========================================================
create table if not exists public.profile_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner_admin', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, auth_user_id)
);

create index if not exists profile_memberships_auth_user_id_idx on public.profile_memberships (auth_user_id);
create index if not exists profile_memberships_profile_id_idx on public.profile_memberships (profile_id);

drop trigger if exists trg_profile_memberships_set_updated_at on public.profile_memberships;
create trigger trg_profile_memberships_set_updated_at
before update on public.profile_memberships
for each row execute function public.set_updated_at();

alter table public.profile_memberships enable row level security;

-- =========================================================
-- 2. profile_invitations
-- =========================================================
-- 物理削除禁止・履歴保持: このテーブルの行は無効化・失効・使用済みになっても削除しない。
-- 状態遷移は status 列で表現し、無効化は revoked_at / revoked_by_user_id を伴うUPDATEで行う
-- （下部のRLSポリシーにDELETEポリシーを設けないことで物理削除を禁止する）。
create table if not exists public.profile_invitations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  invited_email text not null,
  invited_by_auth_user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  role text not null default 'viewer' check (role in ('owner_admin', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- status='accepted' の場合は使用済み日時(used_at)が必ずセットされていること
  constraint profile_invitations_accepted_has_used_at
    check (status <> 'accepted' or used_at is not null),
  -- status='revoked' の場合は失効日時(revoked_at)が必ずセットされていること
  constraint profile_invitations_revoked_has_revoked_at
    check (status <> 'revoked' or revoked_at is not null)
);

create index if not exists profile_invitations_profile_id_idx on public.profile_invitations (profile_id);
create index if not exists profile_invitations_invited_email_idx on public.profile_invitations (invited_email);
create index if not exists profile_invitations_profile_status_idx on public.profile_invitations (profile_id, status);

drop trigger if exists trg_profile_invitations_set_updated_at on public.profile_invitations;
create trigger trg_profile_invitations_set_updated_at
before update on public.profile_invitations
for each row execute function public.set_updated_at();

alter table public.profile_invitations enable row level security;

-- =========================================================
-- 17. family_access_permissions
-- role（書き込み権限の根拠）とは別に、viewer の閲覧範囲を membership_id 単位・
-- カテゴリ単位で制御する。制限行が存在しない場合はデフォルトで閲覧許可。
-- =========================================================
create table if not exists public.family_access_permissions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.profile_memberships(membership_id) on delete cascade,
  resource_category text not null check (resource_category in (
    'events', 'tasks', 'medication_logs', 'notes', 'locations',
    'deliveries', 'contacts', 'voice_requests', 'weather'
  )),
  can_view boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, resource_category)
);

create index if not exists family_access_permissions_membership_id_idx
  on public.family_access_permissions (membership_id);

drop trigger if exists trg_family_access_permissions_set_updated_at on public.family_access_permissions;
create trigger trg_family_access_permissions_set_updated_at
before update on public.family_access_permissions
for each row execute function public.set_updated_at();

alter table public.family_access_permissions enable row level security;

-- =========================================================
-- 共有ヘルパー関数（全テーブル作成後に定義）
-- SECURITY DEFINER + postgres所有（マイグレーション実行ロール）によりRLSをバイパスして
-- profile_memberships / family_access_permissions を参照する。これにより各テーブルの
-- ポリシーで自己参照的な再帰評価を避ける。
-- =========================================================
create or replace function public.is_profile_owner_admin(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profile_memberships pm
    where pm.profile_id = p_profile_id
      and pm.auth_user_id = auth.uid()
      and pm.role = 'owner_admin'
  );
$$;

create or replace function public.has_profile_access(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profile_memberships pm
    where pm.profile_id = p_profile_id
      and pm.auth_user_id = auth.uid()
  );
$$;

-- 書き込み可否の根拠は role（owner_admin のみ書き込み可）
create or replace function public.has_profile_write_access(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_profile_owner_admin(p_profile_id);
$$;

-- 閲覧範囲は role とは別に family_access_permissions で制御する。
-- owner_admin は常に閲覧可。viewer はカテゴリごとの制限行が can_view=false の場合のみ閲覧不可
-- （制限行が無い場合はデフォルト許可）。
create or replace function public.has_category_view_access(p_profile_id uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_memberships pm
    left join public.family_access_permissions fap
      on fap.membership_id = pm.membership_id
     and fap.resource_category = p_category
    where pm.profile_id = p_profile_id
      and pm.auth_user_id = auth.uid()
      and (
        pm.role = 'owner_admin'
        or fap.can_view is distinct from false
      )
  );
$$;

-- =========================================================
-- ポリシー（全テーブル・全ヘルパー関数の定義後にまとめて設置）
-- =========================================================

-- --- profiles ---
-- INSERT / DELETE はクライアントに許可しない。プロフィール作成は
-- 「profiles作成 + profile_memberships(owner_admin)作成」を不可分に行う必要があるため、
-- Edge Function（service role）経由のみとする。
drop policy if exists "profiles_select_members" on public.profiles;
create policy "profiles_select_members" on public.profiles
  for select to authenticated
  using (public.has_profile_access(id));

drop policy if exists "profiles_update_owner_admin" on public.profiles;
create policy "profiles_update_owner_admin" on public.profiles
  for update to authenticated
  using (public.has_profile_write_access(id))
  with check (public.has_profile_write_access(id));

-- --- profile_memberships ---
-- INSERT/UPDATE/DELET はクライアントに許可しない。招待受諾によるメンバー追加・role変更・
-- 削除は accept-invitation 等の Edge Function（service role）でのみ行う（権限昇格防止）。
drop policy if exists "profile_memberships_select_self_or_admin" on public.profile_memberships;
create policy "profile_memberships_select_self_or_admin" on public.profile_memberships
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_profile_owner_admin(profile_id)
  );

-- --- profile_invitations ---
-- 招待の閲覧・発行・失効操作は owner_admin のみ（トークンを含む機微データのため viewer は不可）。
-- 招待受諾時のトークン検証は未メンバーの第三者が行うため、accept-invitation Edge Function
-- （service role）経由で行い、クライアント直接SELECTには依存しない。
drop policy if exists "profile_invitations_select_owner_admin" on public.profile_invitations;
create policy "profile_invitations_select_owner_admin" on public.profile_invitations
  for select to authenticated
  using (public.has_profile_write_access(profile_id));

drop policy if exists "profile_invitations_insert_owner_admin" on public.profile_invitations;
create policy "profile_invitations_insert_owner_admin" on public.profile_invitations
  for insert to authenticated
  with check (
    public.has_profile_write_access(profile_id)
    and invited_by_auth_user_id = auth.uid()
  );

drop policy if exists "profile_invitations_update_owner_admin" on public.profile_invitations;
create policy "profile_invitations_update_owner_admin" on public.profile_invitations
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

-- 物理削除禁止・履歴保持のため、profile_invitations には意図的にDELETEポリシーを設けない。
-- 招待の取り消しは status='revoked' + revoked_at/revoked_by_user_id を設定するUPDATEで行う
-- （上記 profile_invitations_update_owner_admin ポリシーの範囲内）。
drop policy if exists "profile_invitations_delete_owner_admin" on public.profile_invitations;

-- --- family_access_permissions ---
drop policy if exists "family_access_permissions_select" on public.family_access_permissions;
create policy "family_access_permissions_select" on public.family_access_permissions
  for select to authenticated
  using (
    exists (
      select 1 from public.profile_memberships pm
      where pm.membership_id = family_access_permissions.membership_id
        and (pm.auth_user_id = auth.uid() or public.is_profile_owner_admin(pm.profile_id))
    )
  );

drop policy if exists "family_access_permissions_insert_owner_admin" on public.family_access_permissions;
create policy "family_access_permissions_insert_owner_admin" on public.family_access_permissions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profile_memberships pm
      where pm.membership_id = family_access_permissions.membership_id
        and public.is_profile_owner_admin(pm.profile_id)
    )
  );

drop policy if exists "family_access_permissions_update_owner_admin" on public.family_access_permissions;
create policy "family_access_permissions_update_owner_admin" on public.family_access_permissions
  for update to authenticated
  using (
    exists (
      select 1 from public.profile_memberships pm
      where pm.membership_id = family_access_permissions.membership_id
        and public.is_profile_owner_admin(pm.profile_id)
    )
  )
  with check (
    exists (
      select 1 from public.profile_memberships pm
      where pm.membership_id = family_access_permissions.membership_id
        and public.is_profile_owner_admin(pm.profile_id)
    )
  );

drop policy if exists "family_access_permissions_delete_owner_admin" on public.family_access_permissions;
create policy "family_access_permissions_delete_owner_admin" on public.family_access_permissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.profile_memberships pm
      where pm.membership_id = family_access_permissions.membership_id
        and public.is_profile_owner_admin(pm.profile_id)
    )
  );
