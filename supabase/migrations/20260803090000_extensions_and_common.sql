-- Phase1 DBスキーマ: 共通拡張・共通トリガー関数・weather_refresh_attempts用ENUM型
-- 全19テーブルの土台となる共通部品のみをここに定義する。

create extension if not exists pgcrypto;

-- 全テーブル共通の updated_at 自動更新トリガー関数
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- weather_refresh_attempts.result はアプリ側で取り得る値が完全に固定・少数のため
-- Postgres ENUM型を採用する（他テーブルのstatus系はCHECK制約を採用。詳細は各ファイル参照）。
do $$
begin
  if not exists (select 1 from pg_type where typname = 'weather_refresh_result') then
    create type public.weather_refresh_result as enum (
      'allowed',
      'rate_limited',
      'api_success',
      'api_failed',
      'cache_returned'
    );
  end if;
end;
$$;
