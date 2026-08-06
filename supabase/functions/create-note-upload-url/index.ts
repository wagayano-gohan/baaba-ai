// create-note-upload-url: notes-images アップロード用署名付きURL発行。
// 呼び出し元: owner_admin（viewerは閲覧専用のため不可）。JWT必須。
// 注意: ここで発行するのはアップロード用URLのみ。実ファイルの検証(MIME/サイズ)は
// confirm-note-upload で行い、notes.image_path はそちらで初めて更新される。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'

interface CreateNoteUploadUrlRequest {
  profileId: string
  noteId: string
  fileExtension: string
}

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'webp']

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: CreateNoteUploadUrlRequest
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
  const ext = (body.fileExtension ?? '').toLowerCase().replace(/^\./, '')
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    // クライアント申告の拡張子はあくまでパス生成用の参考情報。実MIMEはconfirm-note-uploadで検証する。
    return jsonError(ErrorCode.FILE_TYPE_INVALID, '対応していないファイル形式です', 400)
  }

  // 2. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（owner_adminのみ許可。viewerは書き込み不可）
  const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId, [
    'owner_admin',
  ])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 4. 対象noteの存在確認
  const { data: note, error: fetchError } = await supabase
    .from('notes')
    .select('id')
    .eq('id', body.noteId)
    .eq('profile_id', body.profileId)
    .maybeSingle()

  if (fetchError || !note) {
    return jsonError(ErrorCode.NOT_FOUND, 'ノートが見つかりません', 404)
  }

  // 5. アップロード先パスの生成（他ノートと衝突しないようuuidを付与）
  const storagePath = `${body.profileId}/${body.noteId}/${crypto.randomUUID()}.${ext}`

  // 6. 署名付きアップロードURLの発行
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('notes-images')
    .createSignedUploadUrl(storagePath)

  if (uploadError || !uploadData) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'アップロードURLの発行に失敗しました', 500, uploadError?.message)
  }

  // このエンドポイントはaudit_logs対象外（実データ変更を伴わないため）。
  // 実ファイル確定はconfirm-note-uploadで行い、そこでaudit_logsに記録する。

  return jsonSuccess({
    storagePath,
    signedUrl: uploadData.signedUrl,
    token: uploadData.token,
  })
})
