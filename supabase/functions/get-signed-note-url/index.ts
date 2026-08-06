// get-signed-note-url: notes-images の署名付きURL発行（閲覧用）。
// 呼び出し元: owner_admin / viewer（読み取りのみのため両ロール許可）。JWT必須。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'

interface GetSignedNoteUrlRequest {
  profileId: string
  noteId: string
}

const SIGNED_URL_EXPIRES_SECONDS = 60 * 5 // 5分

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: GetSignedNoteUrlRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!body.noteId || typeof body.noteId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'noteIdは必須です', 400)
  }

  // 2. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（閲覧のみのためowner_admin/viewer両方許可）
  const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId, [
    'owner_admin',
    'viewer',
  ])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 4. 対象noteの取得
  const { data: note, error: fetchError } = await supabase
    .from('notes')
    .select('id, image_path')
    .eq('id', body.noteId)
    .eq('profile_id', body.profileId)
    .maybeSingle()

  if (fetchError || !note) {
    return jsonError(ErrorCode.NOT_FOUND, 'ノートが見つかりません', 404)
  }
  if (!note.image_path) {
    return jsonError(ErrorCode.NOT_FOUND, 'このノートには画像がありません', 404)
  }

  // 5. 署名付きURLの発行
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('notes-images')
    .createSignedUrl(note.image_path as string, SIGNED_URL_EXPIRES_SECONDS)

  if (signedUrlError || !signedUrlData) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '署名付きURLの発行に失敗しました', 500, signedUrlError?.message)
  }

  return jsonSuccess({ signedUrl: signedUrlData.signedUrl, expiresIn: SIGNED_URL_EXPIRES_SECONDS })
})
