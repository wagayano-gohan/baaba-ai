import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface AuditLogInput {
  profileId: string
  /** 家族アカウントによる操作ならauth_user_id、principalデバイスによる操作ならnullを想定 */
  actorAuthUserId: string | null
  /** principalデバイスによる操作ならdevice_id、家族アカウントによる操作ならnullを想定（audit_logs.actor_device_id対応） */
  actorDeviceId?: string | null
  action: string
  targetTable?: string
  targetId?: string
  detail?: Record<string, unknown>
}

/**
 * audit_logs への記録。重要操作（データ変更・削除・PIN関連等）は必ずこれを呼ぶこと。
 * 方針: ログ記録の失敗で主処理全体を失敗させない（サーバログにのみエラーを残す）。
 * ただしこの方針は雛形時点の暫定判断であり、正式実装時に要件と合わせて再確認すること。
 */
export async function writeAuditLog(serviceClient: SupabaseClient, input: AuditLogInput): Promise<void> {
  const { error } = await serviceClient.from('audit_logs').insert({
    profile_id: input.profileId,
    actor_auth_user_id: input.actorAuthUserId,
    actor_device_id: input.actorDeviceId ?? null,
    action: input.action,
    target_table: input.targetTable ?? null,
    target_id: input.targetId ?? null,
    detail: input.detail ?? null,
  })

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[audit_logs] insert failed', error)
  }
}
