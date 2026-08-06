// update-family-permissions: family_access_permissions の更新。
// 呼び出し元: owner_admin。JWT必須 + 重要操作のためPIN確認済みセッション必須。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import {
  requireAuthContextWithSession,
  requireProfileMembership,
  hasValidPinSession,
} from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'

// family_access_permissions.resource_category のCHECK制約と一致させること
const ALLOWED_CATEGORIES = [
  'events',
  'tasks',
  'medication_logs',
  'notes',
  'locations',
  'deliveries',
  'contacts',
  'voice_requests',
  'weather',
] as const

interface UpdateFamilyPermissionsRequest {
  profileId: string
  targetMembershipId: string
  /** カテゴリ名 -> can_view のマップ。1カテゴリ = family_access_permissions の1行に対応する */
  permissions: Record<string, boolean>
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: UpdateFamilyPermissionsRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!body.targetMembershipId || typeof body.targetMembershipId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'targetMembershipIdは必須です', 400)
  }
  if (!body.permissions || typeof body.permissions !== 'object') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'permissionsは必須です', 400)
  }
  const permissionEntries = Object.entries(body.permissions)
  for (const [category, canView] of permissionEntries) {
    if (!ALLOWED_CATEGORIES.includes(category as (typeof ALLOWED_CATEGORIES)[number])) {
      return jsonError(ErrorCode.VALIDATION_ERROR, `不正なカテゴリです: ${category}`, 400)
    }
    if (typeof canView !== 'boolean') {
      return jsonError(ErrorCode.VALIDATION_ERROR, `${category}の値はbooleanである必要があります`, 400)
    }
  }
  if (permissionEntries.length === 0) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'permissionsは1件以上指定してください', 400)
  }

  // 2. 認証確認（JWT検証 + session_id取得。PIN確認セッションの照合に必要）
  const auth = await requireAuthContextWithSession(req)
  if (!auth.ok) return auth.response
  const authContext = auth.context

  const supabase = createServiceRoleClient()

  // 3. profile_memberships確認（owner_adminのみ許可）
  const membership = await requireProfileMembership(supabase, authContext.authUserId, body.profileId, [
    'owner_admin',
  ])
  if (!membership) {
    return jsonError(ErrorCode.PROFILE_ACCESS_DENIED, 'この操作を行う権限がありません', 403)
  }

  // 4. PIN確認済みセッションの確認（重要操作のため必須）
  const pinVerified = await hasValidPinSession(supabase, authContext.authUserId, authContext.authSessionId)
  if (!pinVerified) {
    return jsonError(ErrorCode.PIN_REQUIRED, 'この操作にはPIN確認が必要です', 403)
  }

  // 5. 対象membershipが同一profile配下であることを確認（主キーはmembership_id）
  const { data: targetMembership, error: fetchError } = await supabase
    .from('profile_memberships')
    .select('membership_id, profile_id')
    .eq('membership_id', body.targetMembershipId)
    .eq('profile_id', body.profileId)
    .maybeSingle()

  if (fetchError || !targetMembership) {
    return jsonError(ErrorCode.NOT_FOUND, '対象メンバーシップが見つかりません', 404)
  }

  // 6. family_access_permissions を更新
  // 実スキーマは「membership_id × resource_category ごとに1行、can_viewがbooleanのカテゴリ別モデル」
  // （UNIQUE制約は(membership_id, resource_category)）。permissionsのキー(カテゴリ)ごとに1行として
  // upsertする（他カテゴリの既存行には影響しない＝差分更新）。
  const rows = permissionEntries.map(([resourceCategory, canView]) => ({
    membership_id: body.targetMembershipId,
    resource_category: resourceCategory,
    can_view: canView,
    updated_at: nowUtcIso(),
  }))

  const { error: upsertError } = await supabase
    .from('family_access_permissions')
    .upsert(rows, { onConflict: 'membership_id,resource_category' })

  if (upsertError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, '権限の更新に失敗しました', 500, upsertError.message)
  }

  // 7. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authContext.authUserId,
    action: 'update_family_permissions',
    targetTable: 'family_access_permissions',
    targetId: body.targetMembershipId,
    detail: { permissions: body.permissions },
  })

  return jsonSuccess({ updated: true })
})
