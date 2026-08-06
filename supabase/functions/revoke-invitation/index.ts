// revoke-invitation: 送信済み招待の取り消し。
// 呼び出し元: owner_admin。JWT必須。
//
// 正式確定仕様: profile_invitations に status/revoked_at/revoked_by_user_id カラムが追加された
// （マイグレーション側で別途対応中）。取り消しは行の物理削除ではなく、
// status='revoked' への更新として表現する。以後の accept-invitation は
// status='pending' の招待のみを有効として扱う。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'

interface RevokeInvitationRequest {
  invitationId: string
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: RevokeInvitationRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.invitationId || typeof body.invitationId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'invitationIdは必須です', 400)
  }

  // 2. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. 招待レコード取得
  const { data: invitation, error: fetchError } = await supabase
    .from('profile_invitations')
    .select('id, profile_id, status')
    .eq('id', body.invitationId)
    .maybeSingle()

  if (fetchError || !invitation) {
    return jsonError(ErrorCode.NOT_FOUND, '招待が見つかりません', 404)
  }

  // 4. profile_memberships確認（owner_adminのみ許可）
  const membership = await requireProfileMembership(
    supabase,
    authContext.authUserId,
    invitation.profile_id as string,
    ['owner_admin'],
  )
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  if (invitation.status === 'accepted') {
    return jsonError(ErrorCode.INVITATION_ALREADY_ACCEPTED, '承諾済みの招待は取り消せません', 409)
  }
  if (invitation.status === 'revoked') {
    return jsonError(ErrorCode.INVITATION_REVOKED, 'この招待は既に取り消されています', 409)
  }
  if (invitation.status === 'expired') {
    return jsonError(ErrorCode.INVITATION_EXPIRED, '期限切れの招待は取り消せません', 409)
  }

  // 5. 招待の取り消し = status更新（物理削除は行わない）
  const { error: updateError } = await supabase
    .from('profile_invitations')
    .update({
      status: 'revoked',
      revoked_at: nowUtcIso(),
      revoked_by_user_id: authContext.authUserId,
      updated_at: nowUtcIso(),
    })
    .eq('id', invitation.id)

  if (updateError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '招待の取り消しに失敗しました', 500, updateError.message)
  }

  // 6. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: invitation.profile_id as string,
    actorAuthUserId: authContext.authUserId,
    action: 'revoke_invitation',
    targetTable: 'profile_invitations',
    targetId: invitation.id as string,
  })

  return jsonSuccess({ revoked: true })
})
