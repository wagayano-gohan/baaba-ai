-- Phase1 DBスキーマ: voice_requests / weather_cache / audit_logs / client_error_logs / weather_refresh_attempts

-- =========================================================
-- 14. voice_requests（音声リクエストの構造化ログ）
-- source: 'principal_voice'（本人デバイス起点の音声操作） / 'family'（家族の認証アカウント起点）
--         / 'system'（システム処理等の例外）
-- 作成者列は created_by_auth_user_id（auth.users参照） / created_by_device_id
-- （registered_devices参照）の2列構成を正式仕様として採用する。
-- 書き込みは音声処理パイプライン（Edge Function, service role）のみ。クライアントは閲覧のみ。
-- =========================================================
create table if not exists public.voice_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('principal_voice', 'family', 'system')),
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_by_device_id uuid references public.registered_devices(id) on delete set null,
  raw_transcript text,
  interpreted_intent text,
  interpreted_payload jsonb,
  status text not null default 'received'
    check (status in ('received', 'confirmed', 'executed', 'rejected', 'failed')),
  created_at timestamptz not null default now(),
  -- 本人デバイス起点（principal_voice）の場合は created_by_device_id のみ必須とする。
  -- 本人はSupabase Authアカウントを持たない設計のため created_by_auth_user_id は
  -- null許容とし（owner_admin削除後も本人端末からの音声登録を継続させるため）、
  -- 履歴追跡は created_by_device_id 側で行う。
  -- family / system は既存ルール通り、どちらの列も必須にはしない。
  constraint voice_requests_source_actor_check check (
    (source = 'principal_voice' and created_by_device_id is not null)
    or (source <> 'principal_voice')
  )
);

create index if not exists voice_requests_profile_created_at_idx
  on public.voice_requests (profile_id, created_at desc);

alter table public.voice_requests enable row level security;

-- 閲覧はプロフィールメンバー（カテゴリ制限対象）。書き込みはservice roleのみ
-- （音声処理パイプラインが記録するログのため、クライアントからのINSERT/UPDATEは許可しない）。
drop policy if exists "voice_requests_select" on public.voice_requests;
create policy "voice_requests_select" on public.voice_requests
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'voice_requests'));

-- =========================================================
-- 15. weather_cache（profile_id単位でキャッシュ）
-- 緯度経度は小数第3位に丸めて保存（キャッシュキーの粒度をそろえるため）。
-- 書き込みは refresh-weather-cache Edge Function（service role）のみ。
-- =========================================================
create table if not exists public.weather_cache (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  forecast_date date not null,
  latitude numeric(5, 3) not null,
  longitude numeric(6, 3) not null,
  weather_summary text,
  temperature_max numeric(4, 1),
  temperature_min numeric(4, 1),
  precipitation_probability numeric(4, 1),
  raw_response jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, forecast_date)
);

create index if not exists weather_cache_profile_forecast_date_idx
  on public.weather_cache (profile_id, forecast_date);

drop trigger if exists trg_weather_cache_set_updated_at on public.weather_cache;
create trigger trg_weather_cache_set_updated_at
before update on public.weather_cache
for each row execute function public.set_updated_at();

alter table public.weather_cache enable row level security;

drop policy if exists "weather_cache_select" on public.weather_cache;
create policy "weather_cache_select" on public.weather_cache
  for select to authenticated
  using (public.has_category_view_access(profile_id, 'weather'));

-- =========================================================
-- 16. audit_logs（サーバー側で検証済みの公式監査ログ。Edge Function経由のみ記録）
-- service role専用。
-- =========================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  actor_device_id uuid references public.registered_devices(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_profile_created_at_idx
  on public.audit_logs (profile_id, created_at desc);
create index if not exists audit_logs_actor_auth_user_id_idx
  on public.audit_logs (actor_auth_user_id);

alter table public.audit_logs enable row level security;
-- ポリシーなし: anon/authenticatedからのアクセス不可。service_roleのみ。

-- ---------------------------------------------------------
-- registered_devices.registered_by_auth_user_id が NULL化されたことを検知して
-- audit_logs に記録するトリガー（registered_devicesは20260803090200で作成済み）。
-- 原因（owner_adminアカウント削除によるFKのON DELETE SET NULL／その他のUPDATE）を問わず、
-- 「参照が解除された」という事実自体を履歴として残す。RLSを回避するためSECURITY DEFINER。
-- ---------------------------------------------------------
create or replace function public.log_registered_device_registrant_cleared()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.registered_by_auth_user_id is not null and new.registered_by_auth_user_id is null then
    insert into public.audit_logs (
      profile_id, actor_auth_user_id, actor_device_id, action, target_table, target_id, detail
    )
    values (
      new.profile_id,
      null,
      null,
      'registered_device_registrant_cleared',
      'registered_devices',
      new.id,
      jsonb_build_object(
        'previous_registered_by_auth_user_id', old.registered_by_auth_user_id,
        'registration_source', new.registration_source
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_registered_device_registrant_cleared() from public;

drop trigger if exists trg_registered_devices_log_registrant_cleared on public.registered_devices;
create trigger trg_registered_devices_log_registrant_cleared
after update of registered_by_auth_user_id on public.registered_devices
for each row
execute function public.log_registered_device_registrant_cleared();

-- =========================================================
-- 18. client_error_logs（クライアント申告のエラー情報。公式監査証跡ではない）
-- request_id にUNIQUE制約を持たせ、report-client-error からの冪等な記録を可能にする。
-- 書き込みはreport-client-error Edge Function（service role）のみ。
-- 閲覧はスタックトレース等の機微情報を含み得るためowner_adminのみに限定する。
-- =========================================================
create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  device_id uuid references public.registered_devices(id) on delete set null,
  request_id text not null unique,
  error_code text,
  error_message text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_error_logs_profile_created_at_idx
  on public.client_error_logs (profile_id, created_at desc);

alter table public.client_error_logs enable row level security;

drop policy if exists "client_error_logs_select_owner_admin" on public.client_error_logs;
create policy "client_error_logs_select_owner_admin" on public.client_error_logs
  for select to authenticated
  using (profile_id is not null and public.has_profile_write_access(profile_id));
-- INSERT/UPDATE/DELETE ポリシーなし: クライアント直接書き込み不可。service_roleのみ。

-- =========================================================
-- 19. weather_refresh_attempts（force_refreshのレート制限カウント用）
-- service role専用。RLSはポリシーなし＝anon/authenticatedアクセス不可。
-- =========================================================
create table if not exists public.weather_refresh_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  force_refresh boolean not null default false,
  result public.weather_refresh_result not null,
  error_code text,
  created_at timestamptz not null default now()
);

-- レート制限判定用インデックス（force_refresh=trueの行のみが対象のため部分インデックス）
create index if not exists weather_refresh_attempts_profile_rate_idx
  on public.weather_refresh_attempts (profile_id, requested_at desc) where force_refresh;
create index if not exists weather_refresh_attempts_user_rate_idx
  on public.weather_refresh_attempts (auth_user_id, requested_at desc) where force_refresh;
create index if not exists weather_refresh_attempts_created_at_idx
  on public.weather_refresh_attempts (created_at);

alter table public.weather_refresh_attempts enable row level security;
-- ポリシーなし: service_roleのみ。

-- ---------------------------------------------------------
-- レート制限のチェック＋allowed/rate_limited記録を原子的に行う関数。
-- force_refresh=false の通常アクセスはカウント対象外のためこの関数は呼ばない想定
-- （refresh-weather-cache側でcache_returned等を記録する場合は直接INSERTしてよい）。
--
-- 判定条件（両方満たせば許可）:
--   1) 同一profile_idで直近1時間のforce_refresh=true かつ
--      result in (allowed, api_success, api_failed) が3件未満
--   2) 同一auth_user_idで直近5分の同条件が0件
--
-- pg_advisory_xact_lock で profile_id 単位にロックし、チェックとINSERTの原子性を担保する。
-- SECURITY DEFINER + マイグレーション実行ロール所有によりRLSをバイパスする。
-- 実行権限はservice_roleのみに限定する（下部のREVOKE/GRANTを参照）。
-- ---------------------------------------------------------
create or replace function public.check_and_record_weather_refresh_attempt(
  p_profile_id uuid,
  p_auth_user_id uuid,
  p_force_refresh boolean
)
returns table (allowed boolean, attempt_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_count integer;
  v_user_count integer;
  v_allowed boolean;
  v_attempt_id uuid;
begin
  if not p_force_refresh then
    -- 通常アクセスはレート制限集計対象外。attempt行も作らない。
    return query select true, null::uuid;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_profile_id::text));

  select count(*) into v_profile_count
  from public.weather_refresh_attempts
  where profile_id = p_profile_id
    and force_refresh = true
    and result in ('allowed', 'api_success', 'api_failed')
    and requested_at > now() - interval '1 hour';

  select count(*) into v_user_count
  from public.weather_refresh_attempts
  where auth_user_id = p_auth_user_id
    and force_refresh = true
    and result in ('allowed', 'api_success', 'api_failed')
    and requested_at > now() - interval '5 minutes';

  v_allowed := (v_profile_count < 3) and (v_user_count = 0);

  insert into public.weather_refresh_attempts (profile_id, auth_user_id, force_refresh, result)
  values (
    p_profile_id,
    p_auth_user_id,
    true,
    case when v_allowed then 'allowed'::public.weather_refresh_result
         else 'rate_limited'::public.weather_refresh_result end
  )
  returning id into v_attempt_id;

  return query select v_allowed, v_attempt_id;
end;
$$;

revoke all on function public.check_and_record_weather_refresh_attempt(uuid, uuid, boolean) from public;
grant execute on function public.check_and_record_weather_refresh_attempt(uuid, uuid, boolean) to service_role;

-- allowed記録後、Open-Meteo呼び出し結果でresultをapi_success/api_failedに更新するための関数。
create or replace function public.update_weather_refresh_attempt_result(
  p_attempt_id uuid,
  p_result public.weather_refresh_result,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.weather_refresh_attempts
  set result = p_result, error_code = p_error_code
  where id = p_attempt_id;
$$;

revoke all on function public.update_weather_refresh_attempt_result(uuid, public.weather_refresh_result, text) from public;
grant execute on function public.update_weather_refresh_attempt_result(uuid, public.weather_refresh_result, text) to service_role;

-- 保持期間30日。実行スケジューリング（pg_cron等）自体は今回スコープ外。
-- 定期実行を設定する場合は、例えば pg_cron 拡張で
--   select cron.schedule('purge_weather_refresh_attempts', '0 3 * * *',
--     $$select public.purge_old_weather_refresh_attempts();$$);
-- のように呼び出す方針とする。
create or replace function public.purge_old_weather_refresh_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.weather_refresh_attempts
  where created_at < now() - interval '30 days';
$$;

revoke all on function public.purge_old_weather_refresh_attempts() from public;
grant execute on function public.purge_old_weather_refresh_attempts() to service_role;
