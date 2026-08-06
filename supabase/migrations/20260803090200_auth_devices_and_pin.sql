-- Phase1 DBスキーマ: admin_pin_credentials / pin_verification_sessions / registered_devices
-- 本ファイルで追加されるテーブルは3つ。プロジェクト全体のテーブル総数は確定どおり19。

-- =========================================================
-- 4. admin_pin_credentials（PK=auth_user_id、1家族管理者アカウントにつき1PIN）
-- service role専用。5回失敗でauth_user_id単位で15分ロック（ロック判定・カウントは
-- Edge Function側のロジックで行い、ここではその状態を保持するのみ）。
-- =========================================================
create table if not exists public.admin_pin_credentials (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_admin_pin_credentials_set_updated_at on public.admin_pin_credentials;
create trigger trg_admin_pin_credentials_set_updated_at
before update on public.admin_pin_credentials
for each row execute function public.set_updated_at();

alter table public.admin_pin_credentials enable row level security;
-- ポリシーなし: anon/authenticatedからのアクセスは一切不可。service_roleのみ（RLSをバイパス）。

-- =========================================================
-- 5. pin_verification_sessions（PIN確認成功後10分間の確認済み状態）
-- キーは (auth_user_id, auth_session_id)。auth_session_id は Supabase Auth の
-- auth.sessions.id を参照する（ログインセッション単位で確認状態を保持するため）。
-- service role専用。
-- =========================================================
create table if not exists public.pin_verification_sessions (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null references auth.sessions(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  primary key (auth_user_id, auth_session_id)
);

create index if not exists pin_verification_sessions_expires_at_idx
  on public.pin_verification_sessions (expires_at);

alter table public.pin_verification_sessions enable row level security;
-- ポリシーなし: service_roleのみ。

-- =========================================================
-- 6. registered_devices（本人用デバイス登録。デバイスベースセッションの実体）
-- デバイスの実利用時の認証・照合は Edge Function（service role）が
-- device_token_hash を検証して行う想定。クライアント直接アクセスは家族の管理画面のみ。
-- registration_source: この登録がどの経路で作られたかを示す。
--   owner_admin … 通常運用（家族owner_adminによる登録操作）。registered_by_auth_user_id必須。
--   system      … システム処理（バッチ等）による登録。registered_by_auth_user_id はnull許容。
--   migration   … データ移行による登録。registered_by_auth_user_id はnull許容。
--   test        … テスト用登録。registered_by_auth_user_id はnull許容。
--
-- 「registration_source='owner_admin' なら registered_by_auth_user_id 必須」というルールは
-- CHECK制約ではなく BEFORE INSERT トリガー（下記 check_registered_device_registrant）で検証する
-- （INSERT時のみ検証。UPDATE時は検証しない＝Edge Function側での担保に委ねる確定方針のため）。
-- これにより、FKの ON DELETE SET NULL（owner_adminのauth.users削除時にこの列をNULL化する）が
-- 発生させる内部UPDATEと、アプリ由来の明示的なUPDATEとを区別する必要はそもそも生じない。
-- =========================================================
create table if not exists public.registered_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_name text,
  device_token_hash text not null unique,
  last_seen_at timestamptz,
  registration_source text not null default 'owner_admin'
    check (registration_source in ('owner_admin', 'system', 'migration', 'test')),
  registered_by_auth_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists registered_devices_profile_id_idx on public.registered_devices (profile_id);

-- INSERT時のみ「registration_source='owner_admin' なら registered_by_auth_user_id 必須」を検証。
-- UPDATE時のトリガー検証は行わない（Edge Function側で同ルールを担保する方針に確定済み）。
create or replace function public.check_registered_device_registrant()
returns trigger
language plpgsql
as $$
begin
  if new.registration_source = 'owner_admin' and new.registered_by_auth_user_id is null then
    raise exception
      'registered_devices: registration_source=owner_admin には registered_by_auth_user_id が必須です'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registered_devices_check_registrant on public.registered_devices;
create trigger trg_registered_devices_check_registrant
before insert on public.registered_devices
for each row execute function public.check_registered_device_registrant();

drop trigger if exists trg_registered_devices_set_updated_at on public.registered_devices;
create trigger trg_registered_devices_set_updated_at
before update on public.registered_devices
for each row execute function public.set_updated_at();

alter table public.registered_devices enable row level security;

-- デバイス一覧の閲覧はプロフィールメンバー全員、登録・改名・失効(revoke)はowner_adminのみ。
drop policy if exists "registered_devices_select_members" on public.registered_devices;
create policy "registered_devices_select_members" on public.registered_devices
  for select to authenticated
  using (public.has_profile_access(profile_id));

drop policy if exists "registered_devices_insert_owner_admin" on public.registered_devices;
create policy "registered_devices_insert_owner_admin" on public.registered_devices
  for insert to authenticated
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "registered_devices_update_owner_admin" on public.registered_devices;
create policy "registered_devices_update_owner_admin" on public.registered_devices
  for update to authenticated
  using (public.has_profile_write_access(profile_id))
  with check (public.has_profile_write_access(profile_id));

drop policy if exists "registered_devices_delete_owner_admin" on public.registered_devices;
create policy "registered_devices_delete_owner_admin" on public.registered_devices
  for delete to authenticated
  using (public.has_profile_write_access(profile_id));
