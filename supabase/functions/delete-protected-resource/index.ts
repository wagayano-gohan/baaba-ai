// delete-protected-resource: 保護対象リソースの削除、audit_logs記録。
// 呼び出し元: owner_admin。JWT必須 + 重要操作のためPIN確認済みセッション必須。
//
// 実マイグレーション準拠: contacts/events/tasks/medication_logs/locations/notes/deliveries は
// いずれも「論理削除はdeleted_atで表現（物理削除はしない）」方針（各テーブルのコメントに明記）。
// そのため本Functionの削除は deleted_at への日時セットのみを行い、物理DELETEは行わない。

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

type ResourceType = 'contact' | 'event' | 'task' | 'medication_log' | 'location' | 'note' | 'delivery'

const RESOURCE_TABLE: Record<ResourceType, string> = {
  contact: 'contacts',
  event: 'events',
  task: 'tasks',
  medication_log: 'medication_logs',
  location: 'locations',
  note: 'notes',
  delivery: 'deliveries',
}

interface DeleteProtectedResourceRequest {
  profileId: string
  resourceType: ResourceType
  resourceId: string
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: DeleteProtectedResourceRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!body.resourceId || typeof body.resourceId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'resourceIdは必須です', 400)
  }
  const table = RESOURCE_TABLE[body.resourceType]
  if (!table) {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'resourceTypeが不正です', 400)
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

  // 4. PIN確認済みセッションの確認（削除は重要操作のため必須）
  const pinVerified = await hasValidPinSession(supabase, authContext.authUserId, authContext.authSessionId)
  if (!pinVerified) {
    return jsonError(ErrorCode.PIN_REQUIRED, 'この操作にはPIN確認が必要です', 403)
  }

  // 5. 対象リソースが同一profile配下・未削除であることを確認
  const { data: resource, error: fetchError } = await supabase
    .from(table)
    .select('id, deleted_at')
    .eq('id', body.resourceId)
    .eq('profile_id', body.profileId)
    .maybeSingle()

  if (fetchError || !resource) {
    return jsonError(ErrorCode.NOT_FOUND, '対象リソースが見つかりません', 404)
  }
  if (resource.deleted_at) {
    return jsonError(ErrorCode.NOT_FOUND, '対象リソースは既に削除されています', 404)
  }

  // 6. 削除実行（論理削除: deleted_atをセットする。物理削除はしない）
  const { error: deleteError } = await supabase
    .from(table)
    .update({ deleted_at: nowUtcIso() })
    .eq('id', body.resourceId)

  if (deleteError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'リソースの削除に失敗しました', 500, deleteError.message)
  }

  // 7. audit_logs記録
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authContext.authUserId,
    action: 'delete_protected_resource',
    targetTable: table,
    targetId: body.resourceId,
    detail: { resourceType: body.resourceType, deletedAt: nowUtcIso() },
  })

  return jsonSuccess({ deleted: true })
})
