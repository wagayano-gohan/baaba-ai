// confirm-note-upload: notes-images へアップロードされた実ファイルの検証と notes.image_path 更新。
// 呼び出し元: owner_admin。JWT必須。service roleのみが notes.image_path を更新できる。
// 重要: クライアント申告のMIME/サイズは信用しない。必ずストレージ上の実バイト列を取得し、
// マジックバイトによる実MIME確認とサイズ上限確認をサーバ側で行う。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'

interface ConfirmNoteUploadRequest {
  profileId: string
  noteId: string
  storagePath: string
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

// 代表的な画像形式のマジックバイト定義（先頭バイトで実MIMEを判定する）
const MAGIC_BYTES: Array<{ mime: string; signature: number[] }> = [
  { mime: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46] }, // 'RIFF'、'WEBP'はoffset 8以降で追加確認が必要
]

function detectMime(bytes: Uint8Array): string | null {
  for (const { mime, signature } of MAGIC_BYTES) {
    if (signature.every((byte, i) => bytes[i] === byte)) {
      return mime
    }
  }
  return null
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: ConfirmNoteUploadRequest
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
  if (!body.storagePath || typeof body.storagePath !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'storagePathは必須です', 400)
  }
  // アップロードパスがprofileId配下であることを念のため確認（他プロフィールのパス指定を防ぐ）
  if (!body.storagePath.startsWith(`${body.profileId}/`)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'storagePathが不正です', 400)
  }

  // 2. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（owner_adminのみ許可）
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

  // 5. ストレージから実ファイルを取得（クライアント申告のMIME/サイズは一切信用しない）
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from('notes-images')
    .download(body.storagePath)

  if (downloadError || !fileBlob) {
    return jsonError(ErrorCode.UPLOAD_NOT_FOUND, 'アップロードされたファイルが見つかりません', 404)
  }

  // 6. サイズ上限確認
  if (fileBlob.size > MAX_FILE_SIZE_BYTES) {
    await supabase.storage.from('notes-images').remove([body.storagePath])
    return jsonError(ErrorCode.FILE_TOO_LARGE, `ファイルサイズが上限(${MAX_FILE_SIZE_BYTES}バイト)を超えています`, 400)
  }

  // 7. マジックバイトによる実MIME確認
  const headerBytes = new Uint8Array(await fileBlob.slice(0, 16).arrayBuffer())
  const detectedMime = detectMime(headerBytes)
  if (!detectedMime) {
    await supabase.storage.from('notes-images').remove([body.storagePath])
    return jsonError(ErrorCode.FILE_TYPE_INVALID, '許可されていないファイル形式です', 400)
  }

  // 8. notes.image_path 更新（service roleのみが実行可能な更新）
  const { error: updateError } = await supabase
    .from('notes')
    .update({ image_path: body.storagePath, updated_at: nowUtcIso() })
    .eq('id', body.noteId)

  if (updateError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'ノートの更新に失敗しました', 500, updateError.message)
  }

  // 9. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authContext.authUserId,
    action: 'confirm_note_upload',
    targetTable: 'notes',
    targetId: body.noteId,
    detail: { storagePath: body.storagePath, detectedMime, sizeBytes: fileBlob.size },
  })

  return jsonSuccess({ confirmed: true, imagePath: body.storagePath, detectedMime })
})
