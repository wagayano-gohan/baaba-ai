-- Phase1 DBスキーマ: Storageバケット notes-images
-- 非公開バケット。署名付きURLのみで配信し、公開URLでの直接配信は行わない。
-- クライアントからの直接アップロード/ダウンロードは想定せず、Edge Function
-- （confirm-note-upload等、service role）経由の署名URL発行が前提。
-- 署名付きURL経由のPUT/GETは通常のポリシーチェックをバイパスするため、
-- ここでは authenticated 等への緩いポリシーは追加せず、service_role専用とする。

insert into storage.buckets (id, name, public)
values ('notes-images', 'notes-images', false)
on conflict (id) do nothing;

drop policy if exists "notes_images_service_role_all" on storage.objects;
create policy "notes_images_service_role_all" on storage.objects
  for all
  to service_role
  using (bucket_id = 'notes-images')
  with check (bucket_id = 'notes-images');

-- anon/authenticated向けのポリシーは意図的に作成しない。
-- storage.objects はSupabaseデフォルトでRLSが有効化されており、
-- 上記以外のロールに対する許可ポリシーが無い限りアクセスは拒否される。
