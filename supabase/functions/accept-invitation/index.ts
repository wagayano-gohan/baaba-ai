// accept-invitation: 招待トークンを検証し、profile_memberships を作成する。
// 呼び出し元: 招待されたユーザー本人。事前にSupabase Authでサインアップ/ログイン済みでJWTを持つ想定。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso, isExpired } from '../_shared/datetime.ts'

interface AcceptInvitationRequest {
  token: string
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: AcceptInvitationRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.token || typeof body.token !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'tokenは必須です', 400)
  }

  // 2. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 3. 招待レコードの取得（status: 'pending' | 'accepted' | 'revoked' | 'expired'）
  const { data: invitation, error: fetchError } = await supabase
    .from('profile_invitations')
    .select('id, profile_id, invited_email, role, status, expires_at')
    .eq('token', body.token)
    .maybeSingle()

  if (fetchError || !invitation) {
    return jsonError(ErrorCode.INVITATION_INVALID, '招待が見つかりません', 404)
  }

  // 4. 招待の状態確認
  if (invitation.status === 'accepted') {
    return jsonError(ErrorCode.INVITATION_ALREADY_ACCEPTED, 'この招待は既に承諾済みです', 409)
  }
  if (invitation.status === 'revoked') {
    return jsonError(ErrorCode.INVITATION_REVOKED, 'この招待は取り消されています', 409)
  }
  if (invitation.status === 'expired') {
    return jsonError(ErrorCode.INVITATION_EXPIRED, 'この招待の有効期限が切れています', 410)
  }
  // status='pending'でも期限切れの場合はここでexpiredへ遷移させてから終了する
  if (isExpired(invitation.expires_at as string)) {
    await supabase
      .from('profile_invitations')
      .update({ status: 'expired', updated_at: nowUtcIso() })
      .eq('id', invitation.id)
    return jsonError(ErrorCode.INVITATION_EXPIRED, 'この招待の有効期限が切れています', 410)
  }

  // 5. 招待先メールアドレスとログインユーザーのメールアドレスが一致するか確認
  if (
    !authContext.email ||
    authContext.email.toLowerCase() !== String(invitation.invited_email).toLowerCase()
  ) {
    return jsonError(ErrorCode.INVITATION_EMAIL_MISMATCH, '招待されたメールアドレスと一致しません', 403)
  }

  // 6. profile_memberships 作成（既存メンバーシップがあれば重複エラー。主キーはmembership_id）
  const { data: membership, error: membershipError } = await supabase
    .from('profile_memberships')
    .insert({
      profile_id: invitation.profile_id,
      auth_user_id: authContext.authUserId,
      role: invitation.role,
      created_at: nowUtcIso(),
    })
    .select('membership_id')
    .single()

  if (membershipError || !membership) {
    // TODO: 一意制約違反(23505)の場合はALREADY_EXISTSとして扱う等、エラーコードの詳細分岐を実装時に追加
    return jsonError(ErrorCode.INTERNAL_ERROR, 'メンバーシップの作成に失敗しました', 500, membershipError?.message)
  }

  // 7. 招待をstatus='accepted'に更新（used_atも引き続き使用済み日時として維持する）
  await supabase
    .from('profile_invitations')
    .update({ status: 'accepted', used_at: nowUtcIso(), updated_at: nowUtcIso() })
    .eq('id', invitation.id)

  // 8. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: invitation.profile_id as string,
    actorAuthUserId: authContext.authUserId,
    action: 'accept_invitation',
    targetTable: 'profile_memberships',
    targetId: membership.membership_id as string,
    detail: { role: invitation.role },
  })

  return jsonSuccess(
    { profileId: invitation.profile_id, membershipId: membership.membership_id, role: invitation.role },
    201,
  )
})
