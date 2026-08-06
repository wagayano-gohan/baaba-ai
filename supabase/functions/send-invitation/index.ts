// send-invitation: profile_invitations を作成し、招待メール送信を行う（想定）。
// 呼び出し元: owner_admin（家族・管理者）のみ。JWT必須。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso, addMinutesIso } from '../_shared/datetime.ts'

interface SendInvitationRequest {
  profileId: string
  inviteeEmail: string
  role: 'owner_admin' | 'viewer'
}

const INVITATION_EXPIRES_MINUTES = 7 * 24 * 60 // 7日間
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得
  let body: SendInvitationRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }

  // 2. 入力バリデーション
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!body.inviteeEmail || !EMAIL_RE.test(body.inviteeEmail)) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'inviteeEmailの形式が不正です', 400)
  }
  if (body.role !== 'owner_admin' && body.role !== 'viewer') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'roleはowner_adminまたはviewerである必要があります', 400)
  }

  // 3. 認証確認（JWT検証）
  const authContext = await getAuthContext(req)
  if (!authContext) {
    return jsonError(ErrorCode.UNAUTHENTICATED, '認証情報が無効です', 401)
  }

  const supabase = createServiceRoleClient()

  // 4. 招待元がowner_adminとして対象profileへのアクセス権を持つか確認
  const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId, [
    'owner_admin',
  ])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 5. 招待トークン発行
  const token = crypto.randomUUID()
  const expiresAt = addMinutesIso(INVITATION_EXPIRES_MINUTES)

  // 6. profile_invitations へ挿入（新規招待は必ずstatus='pending'で作成）
  const { data: invitation, error: insertError } = await supabase
    .from('profile_invitations')
    .insert({
      profile_id: body.profileId,
      invited_email: body.inviteeEmail,
      role: body.role,
      token,
      status: 'pending',
      invited_by_auth_user_id: authContext.authUserId,
      expires_at: expiresAt,
      created_at: nowUtcIso(),
    })
    .select('id')
    .single()

  if (insertError || !invitation) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '招待の作成に失敗しました', 500, insertError?.message)
  }

  // 7. 招待メール送信（想定）
  // TODO: 外部メール送信サービス（例: Resend, SendGrid等）を呼び出し、招待URL(token含む)を送信する

  // 8. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authContext.authUserId,
    action: 'send_invitation',
    targetTable: 'profile_invitations',
    targetId: invitation.id as string,
    detail: { inviteeEmail: body.inviteeEmail, role: body.role },
  })

  return jsonSuccess({ invitationId: invitation.id, expiresAt }, 201)
})
