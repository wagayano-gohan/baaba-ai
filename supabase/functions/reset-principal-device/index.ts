// reset-principal-device: 本人(principal)デバイスの再設定（デバイストークンの再発行）。
// 呼び出し元: owner_admin。JWT必須。
// 重要操作だが、PINロック中でも「別経路の再認証（例: パスワード再入力による直近再認証）」があれば
// 実行可能とする設計上の特例のため、通常のPINセッション必須チェックは行わず、
// reauth トークン/直近認証時刻の確認に置き換える。
//
// 実マイグレーション準拠: registered_devices にpairing_code等のカラムは存在しないため、
// 「再設定」は当該デバイス行の device_token_hash を新しいトークンで差し替え、
// revoked_at が設定されていれば解除する（紛失・故障時の再発行フロー）実装とする。

import { handlePreflight } from '../_shared/cors.ts'
import { jsonError, jsonSuccess, ErrorCode } from '../_shared/errors.ts'
import { getAuthContext, requireProfileMembership } from '../_shared/auth.ts'
import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { writeAuditLog } from '../_shared/audit.ts'
import { nowUtcIso } from '../_shared/datetime.ts'
import { generateDeviceToken, sha256Hex } from '../_shared/crypto.ts'

interface ResetPrincipalDeviceRequest {
  profileId: string
  deviceId: string
  /**
   * パスワード再入力等、直近の再認証が完了したことを示すフラグ。
   * PINがロック中でもこれがtrueであれば実行を許可する特例。
   * TODO: 実際にはSupabase Authの再認証結果(例: 直近ログイン時刻 or 専用reauthトークン)を検証すること。
   */
  reauthConfirmed: boolean
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return jsonError(ErrorCode.METHOD_NOT_ALLOWED, 'POSTのみ許可されています', 405)
  }

  // 1. リクエストボディの取得・バリデーション
  let body: ResetPrincipalDeviceRequest
  try {
    body = await req.json()
  } catch {
    return jsonError(ErrorCode.INVALID_JSON, 'リクエストボディがJSONとして不正です', 400)
  }
  if (!body.profileId || typeof body.profileId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'profileIdは必須です', 400)
  }
  if (!body.deviceId || typeof body.deviceId !== 'string') {
    return jsonError(ErrorCode.VALIDATION_ERROR, 'deviceIdは必須です', 400)
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

  // 4. 再認証確認（PINロック中でも実行可能にするための代替確認経路）
  if (!body.reauthConfirmed) {
    return jsonError(ErrorCode.FORBIDDEN, '直近の再認証が必要です', 403)
  }

  // 5. 対象デバイスの存在確認
  const { data: device, error: fetchError } = await supabase
    .from('registered_devices')
    .select('id, profile_id')
    .eq('id', body.deviceId)
    .eq('profile_id', body.profileId)
    .maybeSingle()

  if (fetchError || !device) {
    return jsonError(ErrorCode.DEVICE_NOT_REGISTERED, '対象デバイスが見つかりません', 404)
  }

  // 6. 新しいデバイストークンを発行し、device_token_hashを差し替え。revoked_atは解除する。
  const deviceToken = generateDeviceToken()
  const deviceTokenHash = await sha256Hex(deviceToken)

  const { error: updateError } = await supabase
    .from('registered_devices')
    .update({
      device_token_hash: deviceTokenHash,
      revoked_at: null,
      updated_at: nowUtcIso(),
    })
    .eq('id', device.id)

  if (updateError) {
    return jsonError(ErrorCode.INTERNAL_ERROR, 'デバイスのリセットに失敗しました', 500, updateError.message)
  }

  // 7. audit_logs記録（PINロック中の特例操作である旨をdetailに残す）
  await writeAuditLog(supabase, {
    profileId: body.profileId,
    actorAuthUserId: authContext.authUserId,
    action: 'reset_principal_device',
    targetTable: 'registered_devices',
    targetId: device.id as string,
    detail: { reauthConfirmed: true, note: 'PINロック中の再認証による特例実行の可能性あり' },
  })

  // 8. 生トークンはこのレスポンスでのみ返却する
  return jsonSuccess({ deviceId: device.id, deviceToken })
})
